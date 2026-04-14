import Anthropic from '@anthropic-ai/sdk';
import { query, transaction } from '../db/pool.js';
import { processAllegatoWithAI } from '../services/ai-enrichment.js';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Bandi AI Routes
 *
 * Analisi automatica di PDF bandi con Claude API.
 * L'AI estrae i campi principali dal documento:
 * - Stazione appaltante
 * - Oggetto/Titolo
 * - CIG / CUP
 * - Importi (SO, CO, oneri, manodopera)
 * - Categorie SOA (principale + scorporabili)
 * - Date (pubblicazione, scadenza, apertura, sopralluogo)
 * - Criterio di aggiudicazione
 * - Tipo di procedura
 * - Requisiti di partecipazione
 */
export default async function bandiAiRoutes(fastify, opts) {

  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY
  });

  const EXTRACTION_PROMPT = `Sei un esperto di gare d'appalto italiano. Analizza il seguente documento di bando di gara ed estrai TUTTI i seguenti campi in formato JSON.

CAMPI DA ESTRARRE:
{
  "titolo": "Oggetto completo della gara",
  "stazione_appaltante": "Nome completo della stazione appaltante/ente",
  "codice_cig": "Codice CIG (10 caratteri alfanumerici)",
  "codice_cup": "Codice CUP se presente",
  "data_pubblicazione": "Data di pubblicazione (formato YYYY-MM-DD)",
  "data_scadenza_offerta": "Data e ora scadenza presentazione offerte (formato YYYY-MM-DD HH:mm)",
  "data_apertura": "Data apertura buste se indicata (formato YYYY-MM-DD HH:mm)",
  "importo_lavori": "Importo lavori a base d'asta soggetto a ribasso (numero decimale)",
  "importo_sicurezza": "Oneri di sicurezza non soggetti a ribasso (numero decimale)",
  "importo_totale": "Importo complessivo dell'appalto (numero decimale)",
  "oneri_progettazione": "Oneri di progettazione se presenti (numero decimale)",
  "importo_manodopera": "Costo manodopera se indicato (numero decimale)",
  "categoria_soa_principale": {
    "codice": "es. OG1, OG3, OS21",
    "classifica": "es. I, II, III, IV, V"
  },
  "categorie_soa_scorporabili": [
    {"codice": "es. OS21", "classifica": "I", "importo": 0, "subappaltabile": true}
  ],
  "criterio_aggiudicazione": "Prezzo più basso | OEPV | Costo fisso",
  "tipo_procedura": "Aperta | Ristretta | Negoziata",
  "luogo_esecuzione": {
    "indirizzo": "",
    "citta": "",
    "provincia": "",
    "regione": "",
    "cap": ""
  },
  "sopralluogo": {
    "obbligatorio": true/false,
    "date_disponibili": "descrizione date se presenti",
    "modalita_prenotazione": "telefono/email/PEC"
  },
  "decimali_ribasso": "Numero di decimali ammessi per il ribasso (default 3)",
  "cauzione_provvisoria": "Importo o percentuale cauzione",
  "subappalto_ammesso": true/false,
  "rup": "Nome del Responsabile Unico del Procedimento",
  "piattaforma_telematica": "Nome della piattaforma per la presentazione (MePA, SINTEL, START, etc.)",
  "confidence": "0.0-1.0 quanto sei sicuro dell'estrazione complessiva",
  "campi_incerti": ["lista dei campi dove non sei sicuro del valore estratto"],
  "note_ai": "eventuali osservazioni importanti sul bando"
}

REGOLE:
- Se un campo non è presente nel documento, usa null
- Per gli importi, restituisci solo numeri (senza €, senza punti delle migliaia, virgola come decimale → converti in punto)
- Per le date, usa sempre il formato YYYY-MM-DD o YYYY-MM-DD HH:mm
- Il codice CIG è sempre di 10 caratteri alfanumerici
- Distingui bene tra importo soggetto a ribasso e oneri di sicurezza
- Le categorie SOA hanno codici come OG1, OG3, OS21, OS28 etc.
- Rispondi SOLO con il JSON, senza testo aggiuntivo`;

  // ============================================================
  // POST /api/bandi-ai/analyze - Analizza PDF bando con AI
  // ============================================================
  fastify.post('/analyze', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const parts = request.parts();
    let fileBuffer = null;
    let fileName = null;
    let bandoId = null;  // Optional: associate with existing bando

    for await (const part of parts) {
      if (part.type === 'file') {
        fileBuffer = await part.toBuffer();
        fileName = part.filename;
      } else if (part.fieldname === 'bando_id') {
        bandoId = part.value;
      }
    }

    if (!fileBuffer) {
      return reply.status(400).send({ error: 'Nessun file caricato' });
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return reply.status(503).send({
        error: 'API key Anthropic non configurata',
        hint: 'Configurare ANTHROPIC_API_KEY nel file .env'
      });
    }

    try {
      // Determine media type
      const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(fileName);
      const isPdf = /\.pdf$/i.test(fileName);

      let messageContent;

      if (isPdf) {
        // Send PDF as document to Claude
        messageContent = [
          {
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: fileBuffer.toString('base64')
            }
          },
          {
            type: 'text',
            text: EXTRACTION_PROMPT
          }
        ];
      } else if (isImage) {
        // Send image to Claude
        const ext = fileName.split('.').pop().toLowerCase();
        const mimeMap = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };
        messageContent = [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mimeMap[ext] || 'image/jpeg',
              data: fileBuffer.toString('base64')
            }
          },
          {
            type: 'text',
            text: EXTRACTION_PROMPT
          }
        ];
      } else {
        return reply.status(400).send({
          error: 'Formato file non supportato. Usa PDF, JPG, PNG o WEBP.'
        });
      }

      // Call Claude API
      const response = await anthropic.messages.create({
        model: process.env.AI_MODEL_INTERACTIVE || 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        messages: [{
          role: 'user',
          content: messageContent
        }]
      });

      // Parse AI response
      const aiText = response.content[0].text;
      let extracted;

      try {
        // Try to parse JSON from response (may be wrapped in markdown code blocks)
        const jsonMatch = aiText.match(/\{[\s\S]*\}/);
        extracted = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(aiText);
      } catch (parseErr) {
        return reply.status(422).send({
          error: 'AI non ha restituito JSON valido',
          ai_response: aiText.substring(0, 500),
          hint: 'Prova a caricare un file più leggibile o in formato diverso'
        });
      }

      // If bando_id provided, update existing bando with AI data
      if (bandoId) {
        await updateBandoFromAi(bandoId, extracted, request.user.username);
        // Mark as AI-processed with confidence and store extracted data
        await query(
          `UPDATE bandi SET "ai_processed" = true, "ai_confidence" = $1,
           "ai_extracted_data" = $2, "updated_at" = NOW()
           WHERE "id" = $3`,
          [extracted.confidence || 0.5, JSON.stringify(extracted), bandoId]
        );
      }

      return {
        success: true,
        file_name: fileName,
        extracted_data: extracted,
        confidence: extracted.confidence || null,
        campi_incerti: extracted.campi_incerti || [],
        bando_id: bandoId,
        ai_model: process.env.AI_MODEL_INTERACTIVE || 'claude-sonnet-4-20250514',
        usage: {
          input_tokens: response.usage.input_tokens,
          output_tokens: response.usage.output_tokens
        }
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({
        error: 'Errore durante l\'analisi AI',
        details: err.message
      });
    }
  });

  // ============================================================
  // POST /api/bandi-ai/create-from-pdf - Crea bando da PDF
  // ============================================================
  fastify.post('/create-from-pdf', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const parts = request.parts();
    let fileBuffer = null;
    let fileName = null;

    for await (const part of parts) {
      if (part.type === 'file') {
        fileBuffer = await part.toBuffer();
        fileName = part.filename;
      }
    }

    if (!fileBuffer) {
      return reply.status(400).send({ error: 'Nessun file caricato' });
    }

    // Call Claude API
    const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(fileName);
    const isPdf = /\.pdf$/i.test(fileName);

    let messageContent;
    if (isPdf) {
      messageContent = [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: fileBuffer.toString('base64') } },
        { type: 'text', text: EXTRACTION_PROMPT }
      ];
    } else if (isImage) {
      const ext = fileName.split('.').pop().toLowerCase();
      const mimeMap = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };
      messageContent = [
        { type: 'image', source: { type: 'base64', media_type: mimeMap[ext] || 'image/jpeg', data: fileBuffer.toString('base64') } },
        { type: 'text', text: EXTRACTION_PROMPT }
      ];
    } else {
      return reply.status(400).send({ error: 'Formato non supportato' });
    }

    const response = await anthropic.messages.create({
      model: process.env.AI_MODEL_BULK || 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      messages: [{ role: 'user', content: messageContent }]
    });

    const aiText = response.content[0].text;
    const jsonMatch = aiText.match(/\{[\s\S]*\}/);
    const extracted = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(aiText);

    // Create bando from extracted data
    const bandoId = await createBandoFromAiData(extracted, fileBuffer, fileName, request.user.username);

    return reply.status(201).send({
      success: true,
      bando_id: bandoId,
      extracted_data: extracted,
      confidence: extracted.confidence,
      campi_incerti: extracted.campi_incerti || [],
      message: 'Bando creato dall\'AI. Verifica i campi evidenziati come incerti.'
    });
  });

  // ============================================================
  // GET /api/bandi-ai/dashboard - Stats + bandi da compilare / compilati
  // ============================================================
  fastify.get('/dashboard', async (request, reply) => {
    // Stats generali
    const stats = await query(`
      SELECT
        COUNT(*) FILTER (WHERE "provenienza" = 'Presidia') AS totale_presidia,
        COUNT(*) FILTER (WHERE "provenienza" = 'Presidia' AND "ai_processed" = true) AS compilati_ai,
        COUNT(*) FILTER (WHERE "provenienza" = 'Presidia' AND ("ai_processed" IS NULL OR "ai_processed" = false)) AS da_compilare,
        COUNT(*) FILTER (WHERE "provenienza" = 'Presidia' AND "ai_confidence" IS NOT NULL AND "ai_confidence" < 0.6) AS bassa_confidenza,
        ROUND(AVG("ai_confidence") FILTER (WHERE "provenienza" = 'Presidia' AND "ai_processed" = true)::numeric, 2) AS media_confidenza
      FROM bandi
      WHERE "annullato" = false
    `);

    // Bandi da compilare (Presidia, non AI-processed, che hanno allegati PDF)
    const pendingWithPdf = await query(`
      SELECT b."id", b."oggetto", b."cig", b."stazione",
             b."data_pubblicazione", b."importo_so",
             COUNT(a."id") AS n_allegati_pdf
      FROM bandi b
      INNER JOIN allegati_bando a ON a."id_bando" = b."id" AND a."nome_file" ILIKE '%.pdf'
      WHERE b."provenienza" = 'Presidia'
        AND (b."ai_processed" IS NULL OR b."ai_processed" = false)
        AND b."annullato" = false
      GROUP BY b."id"
      ORDER BY b."data_pubblicazione" DESC
      LIMIT 50
    `);

    // Bandi da compilare SENZA allegati PDF (non processabili automaticamente)
    const pendingNoPdf = await query(`
      SELECT b."id", b."oggetto", b."cig", b."stazione", b."data_pubblicazione"
      FROM bandi b
      LEFT JOIN allegati_bando a ON a."id_bando" = b."id" AND a."nome_file" ILIKE '%.pdf'
      WHERE b."provenienza" = 'Presidia'
        AND (b."ai_processed" IS NULL OR b."ai_processed" = false)
        AND b."annullato" = false
        AND a."id" IS NULL
      ORDER BY b."data_pubblicazione" DESC
      LIMIT 30
    `);

    // Ultimi bandi compilati dall'AI
    const recentlyProcessed = await query(`
      SELECT b."id", b."oggetto", b."cig", b."stazione",
             b."data_pubblicazione", b."importo_so", b."importo_co",
             b."ai_confidence", b."ai_processed_at",
             b."ai_extracted_data"
      FROM bandi b
      WHERE b."provenienza" = 'Presidia' AND b."ai_processed" = true AND b."annullato" = false
      ORDER BY b."ai_processed_at" DESC
      LIMIT 30
    `);

    return {
      stats: stats.rows[0],
      pending_with_pdf: pendingWithPdf.rows,
      pending_no_pdf: pendingNoPdf.rows,
      recently_processed: recentlyProcessed.rows
    };
  });

  // ============================================================
  // POST /api/bandi-ai/process-single/:id - Compila un singolo bando
  // ============================================================
  fastify.post('/process-single/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;

    // Get bando
    const bandoRes = await query('SELECT "id", "oggetto" FROM bandi WHERE "id" = $1', [id]);
    if (bandoRes.rows.length === 0) return reply.status(404).send({ error: 'Bando non trovato' });

    // Get PDF allegati
    const allegatiRes = await query(
      `SELECT "nome_file", "documento" FROM allegati_bando
       WHERE "id_bando" = $1 AND "nome_file" ILIKE '%.pdf'
       ORDER BY "updated_at" DESC LIMIT 3`,
      [id]
    );

    if (allegatiRes.rows.length === 0) {
      return reply.status(404).send({ error: 'Nessun PDF allegato per questo bando' });
    }

    try {
      const { processAllegatoWithAI } = await import('../services/ai-enrichment.js');

      for (const pdf of allegatiRes.rows) {
        await processAllegatoWithAI(id, pdf.Documento, pdf.NomeFile, fastify);
      }

      // Reload bando for response
      const updated = await query(
        `SELECT "oggetto", "ai_processed", "ai_confidence", "ai_extracted_data", "ai_processed_at"
         FROM bandi WHERE "id" = $1`,
        [id]
      );

      return {
        success: true,
        bando_id: id,
        files_processed: allegatiRes.rows.map(r => r.NomeFile),
        ai_confidence: updated.rows[0]?.ai_confidence,
        corrections: updated.rows[0]?.ai_extracted_data?.ai_corrections || []
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Errore compilazione AI', details: err.message });
    }
  });

  // ============================================================
  // POST /api/bandi-ai/enrich-from-allegati - Enrich existing bando
  // ============================================================
  fastify.post('/enrich-from-allegati', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { bando_id } = request.body;
    if (!bando_id) return reply.status(400).send({ error: 'bando_id richiesto' });

    // Get PDF allegati for this bando
    const allegatiRes = await query(
      `SELECT "nome_file", "documento" FROM allegati_bando
       WHERE "id_bando" = $1 AND "nome_file" ILIKE '%.pdf'
       ORDER BY "updated_at" DESC LIMIT 3`,
      [bando_id]
    );

    if (allegatiRes.rows.length === 0) {
      return reply.status(404).send({ error: 'Nessun PDF allegato trovato per questo bando' });
    }

    // Get current bando data for comparison
    const bandoRes = await query(
      `SELECT "oggetto", "cig", "importo_so", "importo_co", "stazione", "data_scadenza",
              "indirizzo", "citta", "regione", "id_soa", "id_criterio", "ai_extracted_data"
       FROM bandi WHERE "id" = $1`,
      [bando_id]
    );

    if (bandoRes.rows.length === 0) {
      return reply.status(404).send({ error: 'Bando non trovato' });
    }

    const bandoBefore = bandoRes.rows[0];

    try {
      // Process the first PDF (usually the disciplinare)
      const pdf = allegatiRes.rows[0];
      await processAllegatoWithAI(bando_id, pdf.Documento, pdf.NomeFile, fastify);

      // Get updated bando
      const bandoAfter = await query(
        `SELECT "oggetto", "cig", "importo_so", "importo_co", "stazione", "data_scadenza",
                "indirizzo", "citta", "regione", "id_soa", "id_criterio", "ai_extracted_data",
                "ai_confidence", "ai_processed"
         FROM bandi WHERE "id" = $1`,
        [bando_id]
      );

      return {
        success: true,
        bando_id,
        files_analyzed: allegatiRes.rows.map(r => r.NomeFile),
        before: bandoBefore,
        after: bandoAfter.rows[0],
        corrections: bandoAfter.rows[0].ai_extracted_data?.ai_corrections || []
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({
        error: 'Errore durante l\'enrichment AI',
        details: err.message
      });
    }
  });

  // ============================================================
  // POST /api/bandi-ai/enrich-batch - Process bandi for AI enrichment
  // ============================================================
  fastify.post('/enrich-batch', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { limit = 10 } = request.body || {};

    // Find Presidia bandi not yet AI-processed that have PDF allegati
    const bandiRes = await query(
      `SELECT DISTINCT b."id", b."oggetto", b."cig"
       FROM bandi b
       INNER JOIN allegati_bando a ON a."id_bando" = b."id" AND a."nome_file" ILIKE '%.pdf'
       WHERE b."provenienza" = 'Presidia' AND (b."ai_processed" IS NULL OR b."ai_processed" = false)
       ORDER BY b."data_pubblicazione" DESC
       LIMIT $1`,
      [limit]
    );

    const results = { processed: 0, errors: 0, details: [] };

    for (const bando of bandiRes.rows) {
      try {
        // Get PDF
        const pdfRes = await query(
          `SELECT "nome_file", "documento" FROM allegati_bando
           WHERE "id_bando" = $1 AND "nome_file" ILIKE '%.pdf' LIMIT 1`,
          [bando.id]
        );

        if (pdfRes.rows.length > 0) {
          await processAllegatoWithAI(bando.id, pdfRes.rows[0].documento, pdfRes.rows[0].nome_file, fastify);
          results.processed++;
          results.details.push({ id: bando.id, titolo: bando.oggetto, status: 'ok' });
        }
      } catch (err) {
        results.errors++;
        results.details.push({ id: bando.id, titolo: bando.oggetto, status: 'error', error: err.message });
      }
    }

    return results;
  });
}

// ============================================================
// HELPER: Update bando from AI extracted data
// ============================================================
async function updateBandoFromAi(bandoId, data, username, confirmed = false) {
  await transaction(async (client) => {
    const updates = [];
    const values = [];
    let idx = 1;

    // Map AI fields to DB fields
    const mapping = {
      "oggetto": data.titolo,
      "cig": data.codice_cig,
      "importo_so": parseNumber(data.importo_lavori),
      "importo_co": parseNumber(data.importo_sicurezza),
      "oneri_progettazione": parseNumber(data.oneri_progettazione),
      "importo_manodopera": parseNumber(data.importo_manodopera),
      "data_scadenza": data.data_scadenza_offerta || null,
      "indirizzo": data.luogo_esecuzione?.indirizzo,
      "citta": data.luogo_esecuzione?.citta,
      "regione": data.luogo_esecuzione?.regione,
      "cap": data.luogo_esecuzione?.cap,
      "n_decimali": data.decimali_ribasso ? parseInt(data.decimali_ribasso) : null
    };

    for (const [field, value] of Object.entries(mapping)) {
      if (value !== undefined && value !== null) {
        updates.push(`"${field}" = $${idx}`);
        values.push(value);
        idx++;
      }
    }

    // Set stazione if extracted
    if (data.stazione_appaltante) {
      updates.push(`"stazione" = $${idx}`);
      values.push(data.stazione_appaltante);
      idx++;

      // Try to match stazione in DB
      const staz = await client.query(
        `SELECT "id" FROM stazioni WHERE "denominazione" ILIKE $1 LIMIT 1`,
        [`%${data.stazione_appaltante}%`]
      );
      if (staz.rows.length > 0) {
        updates.push(`"id_stazione" = $${idx}`);
        values.push(staz.rows[0].id);
        idx++;
      }
    }

    // Set criterio if extracted
    if (data.criterio_aggiudicazione) {
      const crit = await client.query(
        `SELECT "id" FROM criteri WHERE "nome" ILIKE $1 LIMIT 1`,
        [`%${data.criterio_aggiudicazione}%`]
      );
      if (crit.rows.length > 0) {
        updates.push(`"id_criterio" = $${idx}`);
        values.push(crit.rows[0].id);
        idx++;
      }
    }

    // Set SOA principale
    if (data.categoria_soa_principale?.codice) {
      const soaRes = await client.query(
        'SELECT "id" FROM soa WHERE "cod" = $1',
        [data.categoria_soa_principale.codice]
      );
      if (soaRes.rows.length > 0) {
        updates.push(`"id_soa" = $${idx}`);
        values.push(soaRes.rows[0].id);
        idx++;
      }
    }

    if (updates.length > 0) {
      values.push(bandoId);
      await client.query(
        `UPDATE bandi SET ${updates.join(', ')} WHERE "id" = $${idx}`,
        values
      );
    }
  });
}

// ============================================================
// HELPER: Create new bando from AI data
// ============================================================
async function createBandoFromAiData(data, fileBuffer, fileName, username) {
  return await transaction(async (client) => {
    // Find/create stazione
    let id_stazione = null;
    if (data.stazione_appaltante) {
      const staz = await client.query(
        `SELECT "id" FROM stazioni WHERE "denominazione" ILIKE $1 LIMIT 1`,
        [`%${data.stazione_appaltante}%`]
      );
      if (staz.rows.length > 0) {
        id_stazione = staz.rows[0].id;
      } else {
        const newStaz = await client.query(
          `INSERT INTO stazioni ("denominazione") VALUES ($1) RETURNING "id"`,
          [data.stazione_appaltante]
        );
        id_stazione = newStaz.rows[0].id;
      }
    }

    // Find SOA
    let id_soa = null;
    if (data.categoria_soa_principale?.codice) {
      const soaRes = await client.query('SELECT "id" FROM soa WHERE "cod" = $1', [data.categoria_soa_principale.codice]);
      if (soaRes.rows.length > 0) id_soa = soaRes.rows[0].id;
    }

    // Find criterio
    let id_criterio = null;
    if (data.criterio_aggiudicazione) {
      const crit = await client.query(`SELECT "id" FROM criteri WHERE "nome" ILIKE $1 LIMIT 1`, [`%${data.criterio_aggiudicazione}%`]);
      if (crit.rows.length > 0) id_criterio = crit.rows[0].id;
    }

    // Insert bando
    const bandoResult = await client.query(
      `INSERT INTO bandi (
        "id", "oggetto", "id_stazione", "stazione", "data_pubblicazione",
        "cig", "id_soa", "id_criterio",
        "importo_so", "importo_co", "oneri_progettazione", "importo_manodopera",
        "data_scadenza",
        "indirizzo", "citta", "regione", "cap",
        "n_decimali", "provenienza",
        "created_by"
      ) VALUES (uuid_generate_v4(),$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
      RETURNING "id"`,
      [
        data.titolo || 'Bando da analisi AI',
        id_stazione, data.stazione_appaltante,
        data.data_pubblicazione || new Date().toISOString().split('T')[0],
        data.codice_cig, id_soa, id_criterio,
        parseNumber(data.importo_lavori), parseNumber(data.importo_sicurezza),
        parseNumber(data.oneri_progettazione), parseNumber(data.importo_manodopera),
        data.data_scadenza_offerta,
        data.luogo_esecuzione?.indirizzo, data.luogo_esecuzione?.citta,
        data.luogo_esecuzione?.regione, data.luogo_esecuzione?.cap,
        data.decimali_ribasso ? parseInt(data.decimali_ribasso) : 3,
        'AI',
        username
      ]
    );

    const bandoId = bandoResult.rows[0].id;

    return bandoId;
  });
}

function parseNumber(val) {
  if (val === null || val === undefined) return null;
  const n = typeof val === 'string' ? parseFloat(val.replace(/[^\d.\-]/g, '')) : val;
  return isNaN(n) ? null : n;
}
