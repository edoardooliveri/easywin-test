import { query, transaction } from '../db/pool.js';
import Anthropic from '@anthropic-ai/sdk';
import { readFile } from 'fs/promises';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ============================================================
// Prompt per estrazione graduatoria da PDF esiti
// ============================================================
const ESITI_EXTRACTION_PROMPT = `Sei un esperto di appalti pubblici italiani. Analizza questo documento PDF che contiene l'esito/aggiudicazione di una gara d'appalto.

Estrai TUTTI i dati in formato JSON strutturato. Segui queste regole:

1. DATI GENERALI della gara:
   - titolo: titolo completo della gara/procedura
   - stazione_appaltante: nome completo della stazione appaltante
   - codice_cig: codice CIG (10 caratteri alfanumerici)
   - codice_cup: codice CUP se presente
   - data_esito: data dell'aggiudicazione/esito (formato YYYY-MM-DD)
   - importo: importo a base d'asta in euro (solo numero)
   - importo_sicurezza: oneri di sicurezza se indicati
   - criterio_aggiudicazione: "prezzo_piu_basso" oppure "oepv" (offerta economicamente più vantaggiosa)
   - tipologia: tipo di procedura (aperta, ristretta, negoziata, ecc.)
   - n_partecipanti: numero totale di partecipanti
   - categoria_soa: categoria SOA prevalente (es. "OG1", "OS21")
   - classifica_soa: classifica SOA (es. "III", "IV-bis")

2. GRADUATORIA COMPLETA - Per ogni partecipante estrai:
   - posizione: posizione in graduatoria (1 = vincitore)
   - ragione_sociale: nome completo dell'impresa
   - partita_iva: partita IVA se presente nel documento
   - codice_fiscale: codice fiscale se presente
   - ribasso: ribasso percentuale offerto (es. 25.432)
   - importo_offerta: importo offerto se indicato
   - punteggio_tecnico: punteggio tecnico (solo per OEPV)
   - punteggio_economico: punteggio economico (solo per OEPV)
   - punteggio_totale: punteggio totale (solo per OEPV)
   - anomala: true/false se l'offerta è stata segnalata come anomala
   - esclusa: true/false se l'impresa è stata esclusa
   - ammessa: true/false (default true)
   - ati: se è un raggruppamento, lista dei componenti [{ruolo: "mandataria"/"mandante", ragione_sociale: "...", partita_iva: "..."}]
   - taglio_ali: true/false se il ribasso è stato soggetto a taglio delle ali
   - note: eventuali note

3. DATI STATISTICI (se calcolabili):
   - media_aritmetica: media aritmetica dei ribassi
   - soglia_anomalia: soglia di anomalia calcolata
   - media_scarti: media degli scarti (se metodo di esclusione automatica)
   - metodo_calcolo: metodo utilizzato (es. "esclusione automatica art. 97 c. 2", "OEPV art. 95 c. 2")

4. PROCEDURA NEGOZIATA:
   - Se è una procedura negoziata, indicalo: procedura_negoziata: true

Rispondi SOLO con il JSON, senza commenti. Se un campo non è trovabile, usa null.
Se ci sono più varianti/lotti, restituisci un array di oggetti.

IMPORTANTE:
- Riconosci le varie forme di ATI/RTI (Raggruppamento Temporaneo di Imprese)
- Se trovi solo il vincitore senza graduatoria completa, indica tipo_dati: "solo_vincitore"
- Estrai TUTTE le imprese dalla graduatoria, non solo le prime
- I ribassi possono essere espressi come percentuale (25.432%) o come numero decimale (0.25432)
- Normalizza tutto a percentuale senza il simbolo %`;

export default async function esitiAiRoutes(fastify) {

  // ============================================================
  // POST /api/esiti-ai/analyze - Analyze PDF, Excel, or image and extract data
  // ============================================================
  fastify.post('/analyze', async (request, reply) => {
    if (!process.env.ANTHROPIC_API_KEY) {
      return reply.status(500).send({ error: 'ANTHROPIC_API_KEY non configurata' });
    }

    const data = await request.file();
    if (!data) {
      return reply.status(400).send({ error: 'Nessun file caricato' });
    }

    const buffer = await data.toBuffer();
    const base64 = buffer.toString('base64');
    let mimeType = data.mimetype || 'application/pdf';

    // Normalize MIME types for different Excel formats
    if (mimeType === 'application/vnd.ms-excel' ||
        mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
        data.filename?.endsWith('.xlsx') || data.filename?.endsWith('.xls')) {
      mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    }

    try {
      const message = await anthropic.messages.create({
        model: process.env.AI_MODEL_INTERACTIVE || 'claude-sonnet-4-20250514',
        max_tokens: 8000,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'document',
              source: { type: 'base64', media_type: mimeType, data: base64 }
            },
            { type: 'text', text: ESITI_EXTRACTION_PROMPT }
          ]
        }]
      });

      const responseText = message.content[0]?.text || '';

      // Extract JSON from response
      let extracted;
      try {
        const jsonMatch = responseText.match(/\{[\s\S]*\}/) || responseText.match(/\[[\s\S]*\]/);
        extracted = JSON.parse(jsonMatch ? jsonMatch[0] : responseText);
      } catch {
        return reply.status(422).send({
          error: 'Impossibile interpretare la risposta AI',
          raw_response: responseText.substring(0, 2000)
        });
      }

      // If array (multiple lots), wrap it
      const results = Array.isArray(extracted) ? extracted : [extracted];

      // For each result, try to match companies in DB
      for (const result of results) {
        if (result.graduatoria) {
          for (const entry of result.graduatoria) {
            const match = await matchAzienda(
              entry.ragione_sociale,
              entry.partita_iva,
              entry.codice_fiscale,
              { id_soa: result.id_soa, provincia: result.provincia }
            );
            entry._db_match = match;
          }
        }
      }

      // Calculate confidence score
      const confidence = calculateConfidence(results);

      return {
        success: true,
        confidence,
        n_results: results.length,
        results,
        uncertain_fields: findUncertainFields(results),
        unmatched_companies: findUnmatchedCompanies(results),
        filename: data.filename
      };

    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({
        error: 'Errore nell\'analisi AI',
        details: err.message
      });
    }
  });

  // ============================================================
  // POST /api/esiti-ai/create-from-pdf - Full pipeline: analyze + create
  // ============================================================
  fastify.post('/create-from-pdf', async (request, reply) => {
    if (!process.env.ANTHROPIC_API_KEY) {
      return reply.status(500).send({ error: 'ANTHROPIC_API_KEY non configurata' });
    }

    const data = await request.file();
    if (!data) {
      return reply.status(400).send({ error: 'Nessun file caricato' });
    }

    const buffer = await data.toBuffer();
    const base64 = buffer.toString('base64');
    const mimeType = data.mimetype || 'application/pdf';

    try {
      // Step 1: AI Analysis
      const message = await anthropic.messages.create({
        model: process.env.AI_MODEL_BULK || 'claude-haiku-4-5-20251001',
        max_tokens: 8000,
        messages: [{
          role: 'user',
          content: [
            { type: 'document', source: { type: 'base64', media_type: mimeType, data: base64 } },
            { type: 'text', text: ESITI_EXTRACTION_PROMPT }
          ]
        }]
      });

      const responseText = message.content[0]?.text || '';
      let extracted;
      try {
        const jsonMatch = responseText.match(/\{[\s\S]*\}/) || responseText.match(/\[[\s\S]*\]/);
        extracted = JSON.parse(jsonMatch ? jsonMatch[0] : responseText);
      } catch {
        return reply.status(422).send({ error: 'Impossibile interpretare la risposta AI' });
      }

      const results = Array.isArray(extracted) ? extracted : [extracted];
      const createdEsiti = [];

      // Step 2: Create each esito
      for (const aiData of results) {
        const esito = await createEsitoFromAiData(aiData, buffer, data.filename);
        createdEsiti.push(esito);
      }

      return reply.status(201).send({
        success: true,
        created: createdEsiti.length,
        esiti: createdEsiti,
        unmatched_companies: findUnmatchedCompanies(results)
      });

    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Errore nella creazione da PDF', details: err.message });
    }
  });

  // ============================================================
  // GET /api/esiti-ai/pending - Unconfirmed AI esiti
  // ============================================================
  fastify.get('/pending', async () => {
    const result = await query(`
      SELECT g."id", g."Titolo", g."CodiceCIG", g."Data", g."Importo",
        g."NPartecipanti",
        s."Nome" AS stazione_nome
      FROM gare g
      LEFT JOIN stazioni s ON g."id_stazione" = s."id"
      LEFT JOIN bandi b ON g."id_bando" = b."id_bando"
      WHERE b."Provenienza" = 'AI'
      ORDER BY g."Data" DESC
    `);
    return result.rows;
  });

  // ============================================================
  // POST /api/esiti-ai/match-company - Manual company matching
  // ============================================================
  fastify.post('/match-company', async (request) => {
    const { ragione_sociale, partita_iva, codice_fiscale } = request.body;
    const match = await matchAzienda(ragione_sociale, partita_iva, codice_fiscale);
    return match;
  });

  // ============================================================
  // POST /api/esiti-ai/create-from-review - Create esito from human-reviewed data
  // ============================================================
  fastify.post('/create-from-review', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const reviewedData = request.body;

    if (!reviewedData || !reviewedData.titolo) {
      return reply.status(400).send({ error: 'Dati revisione mancanti o incompleti' });
    }

    try {
      // Re-match companies against DB before creating
      if (reviewedData.graduatoria && reviewedData.graduatoria.length > 0) {
        for (const entry of reviewedData.graduatoria) {
          const match = await matchAzienda(
            entry.ragione_sociale,
            entry.partita_iva,
            entry.codice_fiscale
          );
          entry._db_match = match;
        }
      }

      const esito = await createEsitoFromAiData(reviewedData, null, null);

      // Mark as reviewed in gare table
      await query(
        `UPDATE gare SET "Note" = COALESCE("Note",'') || $1 WHERE "id" = $2`,
        [
          `\n[Revisionato: ${reviewedData.reviewed_at || new Date().toISOString()}]` +
          (reviewedData.note_revisore ? ` Note revisore: ${reviewedData.note_revisore}` : ''),
          esito.id
        ]
      );

      const unmatched = [];
      if (reviewedData.graduatoria) {
        for (const entry of reviewedData.graduatoria) {
          if (entry._db_match && !entry._db_match.found) {
            unmatched.push({
              ragione_sociale: entry.ragione_sociale,
              partita_iva: entry.partita_iva,
              posizione: entry.posizione
            });
          }
        }
      }

      return reply.status(201).send({
        success: true,
        id: esito.id,
        esito_id: esito.id,
        titolo: esito.titolo,
        codice_cig: esito.codice_cig,
        id_bando: esito.id_bando,
        n_partecipanti: esito.n_partecipanti,
        reviewed: true,
        unmatched_companies: unmatched
      });

    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({
        error: 'Errore nella creazione dell\'esito revisionato',
        details: err.message
      });
    }
  });

  // ============================================================
  // POST /api/esiti-ai/link-bando/:id - Link esito to bando by CIG
  // ============================================================
  fastify.post('/link-bando/:id', async (request, reply) => {
    const { id } = request.params;
    const { codice_cig, id_bando } = request.body;

    let bandoId = id_bando;

    if (!bandoId && codice_cig) {
      const bando = await query(
        `SELECT "id_bando" FROM bandi WHERE "CodiceCIG" = $1 AND "Annullato" = false LIMIT 1`,
        [codice_cig]
      );
      if (bando.rows.length === 0) {
        return reply.status(404).send({
          error: 'Bando non trovato per questo CIG',
          suggestion: 'Potrebbe essere una procedura negoziata. L\'esito è stato creato come standalone.'
        });
      }
      bandoId = bando.rows[0].id_bando;
    }

    if (bandoId) {
      await query(
        `UPDATE gare SET "id_bando" = $1 WHERE "id" = $2`,
        [bandoId, id]
      );
    }

    return { success: true, id_bando: bandoId };
  });
}

// ============================================================
// HELPER: Match company in database with enhanced matching
// ============================================================
async function matchAzienda(ragioneSociale, partitaIva, codiceFiscale, options = {}) {
  // Priority 1: Match by P.IVA (most reliable)
  if (partitaIva) {
    const byPiva = await query(
      `SELECT "id", "RagioneSociale", "PartitaIva", "CodiceFiscale"
       FROM aziende WHERE "PartitaIva" = $1 LIMIT 1`,
      [partitaIva.replace(/\s/g, '')]
    );
    if (byPiva.rows.length > 0) {
      return { found: true, method: 'partita_iva', azienda: byPiva.rows[0] };
    }
  }

  // Priority 2: Match by codice fiscale
  if (codiceFiscale) {
    const byCf = await query(
      `SELECT "id", "RagioneSociale", "PartitaIva", "CodiceFiscale"
       FROM aziende WHERE "CodiceFiscale" = $1 LIMIT 1`,
      [codiceFiscale.replace(/\s/g, '')]
    );
    if (byCf.rows.length > 0) {
      return { found: true, method: 'codice_fiscale', azienda: byCf.rows[0] };
    }
  }

  // Priority 3: Fuzzy match by name (trigram similarity)
  if (ragioneSociale) {
    const byName = await query(`
      SELECT "id", "RagioneSociale", "PartitaIva", "CodiceFiscale",
        similarity("RagioneSociale", $1) AS sim
      FROM aziende
      WHERE similarity("RagioneSociale", $1) > 0.4
      ORDER BY sim DESC
      LIMIT 3
    `, [ragioneSociale]);

    if (byName.rows.length > 0) {
      return {
        found: true,
        method: 'fuzzy_name',
        confidence: byName.rows[0].sim,
        azienda: byName.rows[0],
        alternatives: byName.rows.slice(1)
      };
    }
  }

  // Priority 4 (NEW): SOA + geographic match for unknown companies
  if (!ragioneSociale) {
    return { found: false, ragione_sociale: ragioneSociale, partita_iva: partitaIva };
  }

  if (options.id_soa && (options.provincia || options.id_provincia)) {
    try {
      const soaMatch = await query(`
        SELECT a."id", a."RagioneSociale", a."PartitaIva", a."Citta", a."Provincia",
               similarity(a."RagioneSociale", $1) AS sim
        FROM aziende a
        INNER JOIN aziende_soa asoa ON a."id" = asoa."id_azienda" AND asoa."id_soa" = $2
        WHERE a."Provincia" = $3 OR a."id_provincia" = $4
        ORDER BY sim DESC
        LIMIT 5
      `, [ragioneSociale, options.id_soa, options.provincia, options.id_provincia]);

      if (soaMatch.rows.length > 0) {
        return {
          found: false,
          method: 'soa_geographic_suggestion',
          suggestions: soaMatch.rows,
          original: { ragione_sociale: ragioneSociale, partita_iva: partitaIva }
        };
      }
    } catch (err) {
      // Table might not exist; continue without SOA matching
    }
  }

  return { found: false, ragione_sociale: ragioneSociale, partita_iva: partitaIva };
}

// ============================================================
// HELPER: Create esito from AI extracted data
// ============================================================
async function createEsitoFromAiData(aiData, pdfBuffer, filename) {
  return await transaction(async (client) => {
    // Find stazione
    let id_stazione = null;
    if (aiData.stazione_appaltante) {
      const st = await client.query(
        `SELECT "id" FROM stazioni WHERE similarity("Nome", $1) > 0.4 ORDER BY similarity("Nome", $1) DESC LIMIT 1`,
        [aiData.stazione_appaltante]
      );
      if (st.rows.length > 0) id_stazione = st.rows[0].id;
    }

    // Find criterio
    let id_criterio = null;
    if (aiData.criterio_aggiudicazione) {
      const critMap = {
        'prezzo_piu_basso': 'Prezzo più basso',
        'oepv': 'Offerta economicamente più vantaggiosa'
      };
      const critName = critMap[aiData.criterio_aggiudicazione] || aiData.criterio_aggiudicazione;
      const cr = await client.query(
        `SELECT "id_criterio" FROM criteri WHERE "Criterio" ILIKE $1 LIMIT 1`,
        [`%${critName}%`]
      );
      if (cr.rows.length > 0) id_criterio = cr.rows[0].id_criterio;
    }

    // Find SOA
    let id_soa = null;
    if (aiData.categoria_soa) {
      const soaResult = await client.query(
        `SELECT "id" FROM soa WHERE "Descrizione" ILIKE $1 LIMIT 1`,
        [`%${aiData.categoria_soa}%`]
      );
      if (soaResult.rows.length > 0) id_soa = soaResult.rows[0].id;
    }

    // Try to find linked bando by CIG
    let id_bando = null;
    let procedura_negoziata = false;
    if (aiData.codice_cig) {
      const bando = await client.query(
        `SELECT "id_bando" FROM bandi WHERE "CodiceCIG" = $1 AND "Annullato" = false LIMIT 1`,
        [aiData.codice_cig]
      );
      if (bando.rows.length > 0) {
        id_bando = bando.rows[0].id_bando;
      } else {
        procedura_negoziata = aiData.procedura_negoziata || false;
      }
    }

    // Create gara
    const garaResult = await client.query(`
      INSERT INTO gare (
        "id_bando", "Data", "Titolo", "CodiceCIG",
        "id_stazione", "Stazione",
        "id_soa", "id_criterio",
        "Importo", "ImportoSO",
        "NPartecipanti", "NDecimali",
        "Ribasso", "MediaAr", "SogliaAn", "MediaSc",
        "Provenienza",
        "Note", "InseritoDa"
      ) VALUES (
        $1, $2, $3, $4,
        $5, $6,
        $7, $8,
        $9, $10,
        $11, 3,
        $12, $13, $14, $15,
        'AI',
        $16, 'AI'
      ) RETURNING "id"
    `, [
      id_bando, aiData.data_esito, aiData.titolo, aiData.codice_cig,
      id_stazione, aiData.stazione_appaltante,
      id_soa, id_criterio,
      aiData.importo, aiData.importo_sicurezza,
      aiData.n_partecipanti || (aiData.graduatoria ? aiData.graduatoria.length : 0),
      aiData.graduatoria?.[0]?.ribasso,
      aiData.media_aritmetica, aiData.soglia_anomalia, aiData.media_scarti,
      procedura_negoziata ? 'Possibile procedura negoziata - CIG non trovato nei bandi' : null
    ]);

    const garaId = garaResult.rows[0].id;

    // Insert graduatoria
    if (aiData.graduatoria && aiData.graduatoria.length > 0) {
      for (const entry of aiData.graduatoria) {
        // Try to match company with SOA and provincia for enhanced matching
        const match = await matchAzienda(
          entry.ragione_sociale,
          entry.partita_iva,
          entry.codice_fiscale,
          { id_soa }
        );

        const isUnmatched = !match.found;
        const hasSuggestions = match.method === 'soa_geographic_suggestion';

        await client.query(`
          INSERT INTO dettaglio_gara (
            "id_gara", "id_azienda", "Posizione", "Ribasso",
            "Anomala", "Vincitrice", "Esclusa",
            "DaVerificare", "Sconosciuto", "RagioneSociale", "PartitaIva",
            "Inserimento", "Note"
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        `, [
          garaId,
          match.found ? match.azienda.id : null,
          entry.posizione,
          entry.ribasso,
          entry.anomala || false,
          entry.posizione === 1 && !entry.esclusa,
          entry.esclusa || false,
          isUnmatched,  // DaVerificare = true if not found
          isUnmatched,  // Sconosciuto = true if not found
          isUnmatched ? entry.ragione_sociale : null,  // Store original name if unmatched
          isUnmatched ? entry.partita_iva : null,      // Store original P.IVA if unmatched
          2,  // Inserimento = 2 (AI-inserted)
          hasSuggestions ? `Suggerimenti: ${JSON.stringify(match.suggestions.map(s => ({ rs: s.RagioneSociale, piva: s.PartitaIva, sim: s.sim.toFixed(3) })))}` : null
        ]);
      }
    }

    // Set winner on gara
    const winner = aiData.graduatoria?.find(e => e.posizione === 1 && !e.esclusa);
    if (winner) {
      const winnerMatch = await matchAzienda(winner.ragione_sociale, winner.partita_iva, winner.codice_fiscale);
      if (winnerMatch.found) {
        await client.query(
          `UPDATE gare SET "id_vincitore" = $1, "Ribasso" = $2 WHERE "id" = $3`,
          [winnerMatch.azienda.id, winner.ribasso, garaId]
        );
      }
    }

    return {
      id: garaId,
      titolo: aiData.titolo,
      codice_cig: aiData.codice_cig,
      id_bando,
      procedura_negoziata,
      n_partecipanti: aiData.graduatoria?.length || 0
    };
  });
}

// ============================================================
// HELPER: Calculate confidence score
// ============================================================
function calculateConfidence(results) {
  let score = 0.5; // Base

  for (const r of results) {
    if (r.codice_cig) score += 0.1;
    if (r.titolo) score += 0.05;
    if (r.stazione_appaltante) score += 0.05;
    if (r.importo) score += 0.05;
    if (r.graduatoria && r.graduatoria.length > 0) score += 0.1;
    if (r.graduatoria && r.graduatoria.length > 3) score += 0.05;
    if (r.media_aritmetica) score += 0.05;
    if (r.criterio_aggiudicazione) score += 0.05;
  }

  return Math.min(1.0, Math.round(score * 100) / 100);
}

// ============================================================
// HELPER: Find uncertain fields
// ============================================================
function findUncertainFields(results) {
  const uncertain = [];
  for (const r of results) {
    if (!r.codice_cig) uncertain.push('codice_cig');
    if (!r.importo) uncertain.push('importo');
    if (!r.data_esito) uncertain.push('data_esito');
    if (!r.criterio_aggiudicazione) uncertain.push('criterio_aggiudicazione');
    if (!r.n_partecipanti && (!r.graduatoria || r.graduatoria.length === 0)) {
      uncertain.push('graduatoria');
    }
    if (r.tipo_dati === 'solo_vincitore') uncertain.push('graduatoria_incompleta');
  }
  return [...new Set(uncertain)];
}

// ============================================================
// HELPER: Find unmatched companies
// ============================================================
function findUnmatchedCompanies(results) {
  const unmatched = [];
  for (const r of results) {
    if (r.graduatoria) {
      for (const entry of r.graduatoria) {
        if (entry._db_match && !entry._db_match.found) {
          unmatched.push({
            ragione_sociale: entry.ragione_sociale,
            partita_iva: entry.partita_iva,
            posizione: entry.posizione,
            action_needed: 'Creare nuova azienda o collegare a esistente'
          });
        }
      }
    }
  }
  return unmatched;
}
