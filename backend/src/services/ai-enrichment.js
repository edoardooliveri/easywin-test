import Anthropic from '@anthropic-ai/sdk';
import { query } from '../db/pool.js';

/**
 * AI Enrichment Service
 *
 * Shared functions for AI-based bando enrichment.
 * Called from:
 * - presidia.js (after Presidia import)
 * - bandi-ai.js (manual and batch endpoints)
 */

const ENRICHMENT_PROMPT = `Sei un esperto di gare d'appalto italiano. Analizza questo documento (disciplinare/capitolato/bando) ed estrai TUTTI i seguenti campi.
IMPORTANTE: Questo bando è già stato parzialmente compilato da un sistema automatico (Presidia) che spesso commette errori sugli importi, le date, le categorie SOA e il criterio di aggiudicazione. Il tuo compito è VERIFICARE e CORREGGERE i dati, estraendo i valori corretti dal documento.

Restituisci un JSON con ESATTAMENTE questa struttura:
{
  "titolo": "Oggetto completo della gara",
  "stazione_appaltante": "Nome completo della stazione appaltante",
  "codice_cig": "CIG (10 caratteri)",
  "codice_cup": "CUP se presente",
  "data_pubblicazione": "YYYY-MM-DD",
  "data_scadenza_offerta": "YYYY-MM-DD HH:mm",
  "data_apertura": "YYYY-MM-DD HH:mm se indicata",
  "importo_lavori": numero (importo soggetto a ribasso),
  "importo_sicurezza": numero (oneri sicurezza NON soggetti a ribasso),
  "importo_totale": numero (importo complessivo),
  "oneri_progettazione": numero o null,
  "importo_manodopera": numero (costo manodopera se indicato),
  "categoria_soa_principale": {"codice": "OGx/OSx", "classifica": "I-VIII"},
  "categorie_soa_scorporabili": [{"codice": "...", "classifica": "...", "importo": numero, "subappaltabile": true/false}],
  "criterio_aggiudicazione": "Prezzo più basso | OEPV | Costo fisso",
  "tipo_procedura": "Aperta | Ristretta | Negoziata | ...",
  "luogo_esecuzione": {"indirizzo": "", "citta": "", "provincia": "", "regione": "", "cap": ""},
  "sopralluogo": {"obbligatorio": true/false, "date_disponibili": "", "modalita_prenotazione": ""},
  "decimali_ribasso": numero (quanti decimali ammessi per il ribasso, default 3),
  "cauzione_provvisoria": "importo o percentuale",
  "subappalto_ammesso": true/false,
  "rup": "Nome RUP",
  "piattaforma_telematica": "MePA/SINTEL/START/etc se specificata",
  "durata_lavori": "numero giorni o descrizione",
  "requisiti_partecipazione": "breve sintesi dei requisiti",
  "confidence": 0.0-1.0,
  "campi_incerti": ["lista campi dove non sei sicuro"],
  "note_ai": "osservazioni importanti"
}

REGOLE:
- Gli importi devono essere NUMERI PURI (senza €, senza punti migliaia, punto decimale)
- Le date sempre in formato YYYY-MM-DD
- Se non trovi un campo, metti null
- ATTENZIONE a distinguere importo soggetto a ribasso da oneri sicurezza
- Le categorie SOA sono OG1-OG13 e OS1-OS35
- Rispondi SOLO con il JSON`;

// Smart PDF filter: prioritize relevant documents, exclude junk
const ALLEGATI_PDF_QUERY = `
  SELECT "nome_file", "documento" FROM allegati_bando
  WHERE "id_bando" = $1
    AND "nome_file" ILIKE '%.pdf'
    AND "nome_file" !~* '(planimetri|modello|dgue|schema|offerta.?economic|patto|integrit|garanzi|cauzion|certificat|autodichiarazion|domanda.?partecipazion|sopralluogo|ricevut|allegato.?modello)'
  ORDER BY
    CASE
      WHEN "nome_file" ILIKE '%disciplinare%' THEN 1
      WHEN "nome_file" ILIKE '%bando%' THEN 2
      WHEN "nome_file" ILIKE '%capitolato%' THEN 3
      WHEN "nome_file" ILIKE '%lettera%invito%' THEN 4
      WHEN "nome_file" ILIKE '%chiariment%' OR "nome_file" ILIKE '%faq%' THEN 5
      WHEN "nome_file" ILIKE '%avviso%' THEN 6
      WHEN "nome_file" ILIKE '%determina%' THEN 7
      ELSE 8
    END,
    length("documento") DESC
  LIMIT 3`;

// Fallback: if no relevant PDFs found, pick top 2 largest
const ALLEGATI_PDF_FALLBACK_QUERY = `
  SELECT "nome_file", "documento" FROM allegati_bando
  WHERE "id_bando" = $1
    AND "nome_file" ILIKE '%.pdf'
  ORDER BY length("documento") DESC
  LIMIT 2`;

/**
 * Get relevant PDF allegati for a bando (smart filter with fallback)
 */
export async function getRelevantAllegati(bandoId) {
  let res = await query(ALLEGATI_PDF_QUERY, [bandoId]);
  if (res.rows.length === 0) {
    res = await query(ALLEGATI_PDF_FALLBACK_QUERY, [bandoId]);
  }
  return res.rows;
}

/**
 * Main entry point: process a bando with AI enrichment after Presidia import
 *
 * @param {string} bandoId - ID of the imported bando
 * @param {object} presidiaData - Original Presidia data
 * @param {object} fastify - Fastify instance for logging
 */
export async function enrichBandoWithAI(bandoId, presidiaData, fastify) {
  // 1. Check if Presidia provided PDF URLs
  const pdfUrls = [];
  if (presidiaData.allegati) {
    const allegatiArray = Array.isArray(presidiaData.allegati) ? presidiaData.allegati : [presidiaData.allegati];
    for (const a of allegatiArray) {
      if (a.url || a.Url || a.URL) {
        pdfUrls.push(a.url || a.Url || a.URL);
      }
    }
  }
  if (presidiaData.url_disciplinare) pdfUrls.push(presidiaData.url_disciplinare);
  if (presidiaData.url_capitolato) pdfUrls.push(presidiaData.url_capitolato);
  if (presidiaData.url_bando) pdfUrls.push(presidiaData.url_bando);

  if (pdfUrls.length === 0) {
    // No PDFs from Presidia, check if we already have allegati in DB
    const allegati = await getRelevantAllegati(bandoId);
    if (allegati.length === 0) {
      fastify.log.info({ bando_id: bandoId }, 'No PDFs available for AI enrichment');
      return;
    }
    // Use existing DB allegati (already filtered & prioritized)
    for (const row of allegati) {
      await processAllegatoWithAI(bandoId, row.documento, row.nome_file, fastify);
    }
    return;
  }

  // Download PDFs from Presidia and store as allegati
  const PRESIDIA_BASE = process.env.PRESIDIA_BASE_URL;
  const PRESIDIA_USER = process.env.PRESIDIA_USERNAME;
  const PRESIDIA_PASS = process.env.PRESIDIA_PASSWORD;

  for (const url of pdfUrls) {
    try {
      const fullUrl = url.startsWith('http') ? url : `${PRESIDIA_BASE}/${url}`;
      const response = await fetch(fullUrl, {
        headers: {
          'Authorization': `Basic ${Buffer.from(`${PRESIDIA_USER}:${PRESIDIA_PASS}`).toString('base64')}`
        }
      });
      if (!response.ok) continue;

      const buffer = Buffer.from(await response.arrayBuffer());
      const fileName = url.split('/').pop() || 'documento.pdf';

      // Save allegato to DB
      await query(
        `INSERT INTO allegati_bando ("id_bando", "nome_file", "documento", "last_update", "username")
         VALUES ($1, $2, $3, NOW(), 'Presidia-Import')`,
        [bandoId, fileName, buffer]
      );

      // Process with AI
      await processAllegatoWithAI(bandoId, buffer, fileName, fastify);
    } catch (err) {
      fastify.log.warn({ err: err.message, url }, 'Failed to download/process Presidia PDF');
    }
  }
}

/**
 * Process a single PDF allegato with Claude AI
 * Extracts bando data and updates the bando record
 *
 * @param {string} bandoId - ID of the bando
 * @param {Buffer} pdfBuffer - PDF file content
 * @param {string} fileName - Name of the file
 * @param {object} fastify - Fastify instance for logging
 */
export async function processAllegatoWithAI(bandoId, pdfBuffer, fileName, fastify) {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  try {
    const response = await anthropic.messages.create({
      model: process.env.AI_MODEL_BULK || 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: pdfBuffer.toString('base64')
            }
          },
          { type: 'text', text: ENRICHMENT_PROMPT }
        ]
      }]
    });

    const aiText = response.content[0]?.text;
    if (!aiText) {
      fastify.log.warn({ bando_id: bandoId, file: fileName }, 'AI returned empty response');
      return;
    }

    const jsonMatch = aiText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      fastify.log.warn({ bando_id: bandoId, file: fileName }, 'No JSON found in AI response');
      return;
    }

    const extracted = JSON.parse(jsonMatch[0]);

    // Update bando with AI-extracted data
    await updateBandoFromAiEnrichment(bandoId, extracted);
  } catch (err) {
    fastify.log.error({ err: err.message, bando_id: bandoId, file: fileName }, 'AI enrichment processing error');
  }
}

/**
 * Update bando with AI-extracted data
 * Only overwrites fields that are null/empty or clearly incorrect
 *
 * @param {string} bandoId - ID of the bando
 * @param {object} aiData - Extracted AI data
 */
export async function updateBandoFromAiEnrichment(bandoId, aiData) {
  // First, get current bando data to compare
  const current = await query(
    `SELECT "titolo", "codice_cig", "importo_so", "importo_co", "data_offerta",
            "id_soa", "id_criterio", "id_stazione", "stazione_nome",
            "indirizzo", "citta", "regione", "cap", "n_decimali",
            "ai_extracted_data"
     FROM bandi WHERE "id" = $1`,
    [bandoId]
  );

  if (current.rows.length === 0) return;
  const bando = current.rows[0];

  const updates = [];
  const values = [];
  let idx = 1;
  const correctedFields = [];
  const unmatchedEntities = {};

  // Helper: update field if current is null/empty or zero (likely Presidia didn't have it)
  function maybeUpdate(dbField, aiValue, fieldName) {
    if (aiValue === null || aiValue === undefined) return;
    const currentVal = bando[dbField];
    if (currentVal === null || currentVal === '' || currentVal === 0) {
      updates.push(`"${dbField}" = $${idx}`);
      values.push(aiValue);
      idx++;
      correctedFields.push({ field: fieldName, old: currentVal, new: aiValue, reason: 'campo mancante' });
    }
  }

  // Helper: force update (AI is more reliable than Presidia for these)
  function forceUpdate(dbField, aiValue, fieldName) {
    if (aiValue === null || aiValue === undefined) return;
    const currentVal = bando[dbField];
    if (String(currentVal) !== String(aiValue)) {
      updates.push(`"${dbField}" = $${idx}`);
      values.push(aiValue);
      idx++;
      correctedFields.push({ field: fieldName, old: currentVal, new: aiValue, reason: 'corretto da AI' });
    }
  }

  // Title - use AI if more complete
  if (aiData.titolo && (!bando.titolo || aiData.titolo.length > bando.titolo.length * 1.3)) {
    forceUpdate('titolo', aiData.titolo, 'titolo');
  }

  // CIG
  if (aiData.codice_cig && aiData.codice_cig.length === 10) {
    forceUpdate('codice_cig', aiData.codice_cig, 'codice_cig');
  }

  // Importi - AI is more reliable than Presidia here
  if (aiData.importo_lavori) forceUpdate('importo_so', parseFloat(aiData.importo_lavori), 'importo_lavori');
  if (aiData.importo_sicurezza) forceUpdate('importo_co', parseFloat(aiData.importo_sicurezza), 'importo_sicurezza');
  maybeUpdate('oneri_progettazione', aiData.oneri_progettazione ? parseFloat(aiData.oneri_progettazione) : null, 'oneri_progettazione');
  maybeUpdate('importo_manodopera', aiData.importo_manodopera ? parseFloat(aiData.importo_manodopera) : null, 'importo_manodopera');

  // Date
  if (aiData.data_scadenza_offerta) maybeUpdate('data_offerta', aiData.data_scadenza_offerta, 'data_scadenza');

  // Location
  maybeUpdate('indirizzo', aiData.luogo_esecuzione?.indirizzo, 'indirizzo');
  maybeUpdate('citta', aiData.luogo_esecuzione?.citta, 'citta');
  maybeUpdate('regione', aiData.luogo_esecuzione?.regione, 'regione');
  maybeUpdate('cap', aiData.luogo_esecuzione?.cap, 'cap');

  // Decimali
  if (aiData.decimali_ribasso) {
    forceUpdate('n_decimali', parseInt(aiData.decimali_ribasso), 'decimali_ribasso');
  }

  // Stazione appaltante name
  if (aiData.stazione_appaltante) {
    maybeUpdate('stazione_nome', aiData.stazione_appaltante, 'stazione');

    // Try to match stazione in DB
    if (!bando.id_stazione) {
      const stazRes = await query(
        `SELECT "id" FROM stazioni WHERE "nome" ILIKE $1 LIMIT 1`,
        [`%${aiData.stazione_appaltante}%`]
      );
      if (stazRes.rows.length > 0) {
        updates.push(`"id_stazione" = $${idx}`);
        values.push(stazRes.rows[0].id);
        idx++;
      } else {
        // Stazione not found — create it (new enti appear continuously)
        const newStaz = await query(
          `INSERT INTO stazioni ("nome") VALUES ($1) RETURNING "id"`,
          [aiData.stazione_appaltante]
        );
        updates.push(`"id_stazione" = $${idx}`);
        values.push(newStaz.rows[0].id);
        idx++;
        correctedFields.push({ field: 'stazione', old: null, new: aiData.stazione_appaltante, reason: 'stazione creata da AI' });
      }
    }
  }

  // Criterio di aggiudicazione — lookup only, never create
  if (aiData.criterio_aggiudicazione) {
    const critRes = await query(
      `SELECT "id" FROM criteri WHERE "nome" ILIKE $1 LIMIT 1`,
      [`%${aiData.criterio_aggiudicazione}%`]
    );
    if (critRes.rows.length > 0) {
      forceUpdate('id_criterio', critRes.rows[0].id, 'criterio');
    } else {
      unmatchedEntities.criterio_non_trovato = aiData.criterio_aggiudicazione;
    }
  }

  // SOA principale — lookup only, never create
  if (aiData.categoria_soa_principale?.codice) {
    const soaRes = await query(
      `SELECT "id" FROM soa WHERE "codice" = $1`,
      [aiData.categoria_soa_principale.codice]
    );
    if (soaRes.rows.length > 0) {
      forceUpdate('id_soa', soaRes.rows[0].id, 'soa_principale');
    } else {
      unmatchedEntities.categoria_soa_non_trovata = aiData.categoria_soa_principale;
    }
  }

  // Save AI data + unmatched entities for manual review
  const aiRecord = {
    ...((bando.ai_extracted_data && typeof bando.ai_extracted_data === 'object') ? bando.ai_extracted_data : {}),
    ai_extraction: aiData,
    ai_corrections: correctedFields,
    ai_enriched_at: new Date().toISOString(),
    ...unmatchedEntities
  };

  updates.push(`"ai_extracted_data" = $${idx}`);
  values.push(JSON.stringify(aiRecord));
  idx++;

  updates.push(`"ai_processed" = $${idx}`);
  values.push(true);
  idx++;

  updates.push(`"ai_confidence" = $${idx}`);
  values.push(aiData.confidence || 0.8);
  idx++;

  updates.push(`"ai_processed_at" = $${idx}`);
  values.push(new Date().toISOString());
  idx++;

  if (updates.length > 0) {
    values.push(bandoId);
    await query(
      `UPDATE bandi SET ${updates.join(', ')} WHERE "id" = $${idx}`,
      values
    );
  }
}
