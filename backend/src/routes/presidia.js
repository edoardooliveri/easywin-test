import { query, transaction } from '../db/pool.js';
import { parseStringPromise } from 'xml2js';
import { enrichBandoWithAI } from '../services/ai-enrichment.js';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Presidia Integration Routes
 *
 * Presidia è il web service esterno che fornisce bandi di gara.
 * Il vecchio sistema usava:
 * - SOAP/REST calls a Presidia per ottenere nuovi bandi
 * - ExternalCode per deduplica (se già importato, skip)
 * - Mapping dei campi Presidia → campi EasyWin
 * - Task schedulato (Quartz.NET) che eseguiva l'import periodicamente
 */
export default async function presidiaRoutes(fastify, opts) {

  const PRESIDIA_BASE = process.env.PRESIDIA_BASE_URL || 'https://ws.presidia.it/api';
  const PRESIDIA_USER = process.env.PRESIDIA_USERNAME;
  const PRESIDIA_PASS = process.env.PRESIDIA_PASSWORD;

  // ============================================================
  // POST /api/presidia/import - Import bandi da Presidia
  // ============================================================
  fastify.post('/import', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { data_dal, data_al, regione, max_results = 100 } = request.body;
    const user = request.user;

    if (!PRESIDIA_USER || !PRESIDIA_PASS) {
      return reply.status(503).send({
        error: 'Credenziali Presidia non configurate',
        hint: 'Configurare PRESIDIA_USERNAME e PRESIDIA_PASSWORD nel file .env'
      });
    }

    try {
      // 1. Fetch bandi from Presidia
      const presidiaData = await fetchFromPresidia({
        data_dal, data_al, regione, max_results
      });

      if (!presidiaData || presidiaData.length === 0) {
        return { imported: 0, skipped: 0, errors: 0, message: 'Nessun bando trovato su Presidia' };
      }

      // 2. Process each bando
      let imported = 0, skipped = 0, errors = 0;
      const errorDetails = [];

      for (const bandoPresidia of presidiaData) {
        try {
          // Check if already imported (deduplica via external_code)
          const existing = await query(
            'SELECT "id_bando" FROM bandi WHERE "ExternalCode" = $1 AND "Provenienza" = $2',
            [bandoPresidia.codice, 'Presidia']
          );

          if (existing.rows.length > 0) {
            skipped++;
            continue;
          }

          // Map Presidia fields to EasyWin schema
          const mapped = mapPresidiaToBando(bandoPresidia);

          // Find or create stazione appaltante
          let id_stazione = null;
          if (bandoPresidia.stazione) {
            id_stazione = await findOrCreateStazione(bandoPresidia.stazione);
          }

          // Find SOA category
          let id_soa = null;
          if (mapped.soa_codice) {
            const soaResult = await query(
              'SELECT "id" FROM soa WHERE "cod" = $1',
              [mapped.soa_codice]
            );
            if (soaResult.rows.length > 0) {
              id_soa = soaResult.rows[0].id;
            }
          }

          // Find tipologia
          let id_tipologia = null;
          if (mapped.tipologia_nome) {
            const tipResult = await query(
              'SELECT "id_tipologia" FROM tipologiagare WHERE "Tipologia" ILIKE $1',
              [`%${mapped.tipologia_nome}%`]
            );
            if (tipResult.rows.length > 0) {
              id_tipologia = tipResult.rows[0].id_tipologia;
            }
          }

          // Find criterio
          let id_criterio = null;
          if (mapped.criterio_nome) {
            const critResult = await query(
              'SELECT "id_criterio" FROM criteri WHERE "Criterio" ILIKE $1',
              [`%${mapped.criterio_nome}%`]
            );
            if (critResult.rows.length > 0) {
              id_criterio = critResult.rows[0].id_criterio;
            }
          }

          // Insert bando with RETURNING to get the id
          const insertResult = await query(
            `INSERT INTO bandi (
              "Titolo", "id_stazione", "Stazione", "DataPubblicazione",
              "CodiceCIG", "id_soa", "ImportoSO", "ImportoCO",
              "id_tipologia", "id_criterio", "DataOfferta",
              "Indirizzo", "CAP", "Citta", "Regione",
              "Provenienza", "ExternalCode",
              "InseritoDa", "Note"
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
            RETURNING "id_bando"`,
            [
              mapped.titolo, id_stazione, mapped.stazione_nome, mapped.data_pubblicazione,
              mapped.codice_cig, id_soa, mapped.importo_so, mapped.importo_co,
              id_tipologia, id_criterio, mapped.data_offerta,
              mapped.indirizzo, mapped.cap, mapped.citta, mapped.regione,
              'Presidia', bandoPresidia.codice,
              user.username, `Import automatico da Presidia - ${new Date().toISOString()}`
            ]
          );

          const newBandoId = insertResult.rows[0].id_bando;

          // Save original Presidia data for comparison
          await query(
            `UPDATE bandi SET "ai_extracted_data" = $1 WHERE "id_bando" = $2`,
            [JSON.stringify({ presidia_original: bandoPresidia, mapped: mapped }), newBandoId]
          );

          // Try to enrich with AI if Anthropic API is configured
          if (process.env.ANTHROPIC_API_KEY) {
            try {
              await enrichBandoWithAI(newBandoId, bandoPresidia, fastify);
            } catch (aiErr) {
              fastify.log.warn({ err: aiErr.message, bando_id: newBandoId }, 'AI enrichment failed, bando saved with Presidia data only');
            }
          }

          imported++;
        } catch (err) {
          errors++;
          errorDetails.push({
            codice: bandoPresidia.codice,
            titolo: bandoPresidia.titolo?.substring(0, 80),
            error: err.message
          });
        }
      }

      return {
        imported,
        skipped,
        errors,
        total_presidia: presidiaData.length,
        error_details: errorDetails.length > 0 ? errorDetails : undefined,
        message: `Import completato: ${imported} nuovi, ${skipped} già presenti, ${errors} errori`
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({
        error: 'Errore durante l\'import da Presidia',
        details: err.message
      });
    }
  });

  // ============================================================
  // GET /api/presidia/status - Check connessione Presidia
  // ============================================================
  fastify.get('/status', async (request, reply) => {
    const configured = !!(PRESIDIA_USER && PRESIDIA_PASS);

    // Last import stats
    const lastImport = await query(
      `SELECT
        MAX("DataPubblicazione") as ultimo_import,
        COUNT(*) FILTER (WHERE "DataPubblicazione" > NOW() - INTERVAL '24 hours') as ultimi_24h,
        COUNT(*) FILTER (WHERE "DataPubblicazione" > NOW() - INTERVAL '7 days') as ultimi_7_giorni,
        COUNT(*) as totale
       FROM bandi WHERE "Provenienza" = 'Presidia'`
    );

    return {
      presidia_configurato: configured,
      base_url: PRESIDIA_BASE,
      statistiche: lastImport.rows[0]
    };
  });

  // ============================================================
  // POST /api/presidia/sync - Sincronizzazione automatica
  // ============================================================
  fastify.post('/sync', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const user = request.user;

    // Auto-sync: import last 7 days
    const oggi = new Date();
    const settimanaFa = new Date(oggi);
    settimanaFa.setDate(settimanaFa.getDate() - 7);

    const body = {
      data_dal: settimanaFa.toISOString().split('T')[0],
      data_al: oggi.toISOString().split('T')[0],
      max_results: 500
    };

    // Reuse import logic
    request.body = body;
    const fakeReply = {
      status: (code) => ({ send: (data) => data }),
    };

    // Forward to import
    return fastify.inject({
      method: 'POST',
      url: '/api/presidia/import',
      payload: body,
      headers: request.headers
    });
  });
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Fetch bandi list from Presidia web service
 * Il vecchio sistema usava SOAP, qui usiamo REST se disponibile
 */
async function fetchFromPresidia({ data_dal, data_al, regione, max_results }) {
  const PRESIDIA_BASE = process.env.PRESIDIA_BASE_URL;
  const PRESIDIA_USER = process.env.PRESIDIA_USERNAME;
  const PRESIDIA_PASS = process.env.PRESIDIA_PASSWORD;

  const params = new URLSearchParams({
    dataDal: data_dal,
    dataAl: data_al,
    maxResults: max_results.toString()
  });
  if (regione) params.append('regione', regione);

  const response = await fetch(`${PRESIDIA_BASE}/bandi?${params}`, {
    headers: {
      'Authorization': `Basic ${Buffer.from(`${PRESIDIA_USER}:${PRESIDIA_PASS}`).toString('base64')}`,
      'Accept': 'application/json, application/xml'
    }
  });

  if (!response.ok) {
    throw new Error(`Presidia API error: ${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get('content-type');

  if (contentType?.includes('xml')) {
    // Parse XML response (legacy SOAP)
    const xmlText = await response.text();
    const parsed = await parseStringPromise(xmlText, { explicitArray: false });
    return normalizePresidiaXml(parsed);
  } else {
    // JSON response
    const data = await response.json();
    return Array.isArray(data) ? data : data.bandi || data.results || [];
  }
}

/**
 * Normalize Presidia XML response to standard format
 */
function normalizePresidiaXml(parsed) {
  const bandi = parsed?.BandiResponse?.Bando || parsed?.response?.bandi?.bando || [];
  return (Array.isArray(bandi) ? bandi : [bandi]).map(b => ({
    codice: b.Codice || b.codice || b.ID,
    titolo: b.Titolo || b.titolo || b.Oggetto || b.oggetto,
    stazione: {
      nome: b.StazioneAppaltante || b.stazioneAppaltante || b.Ente,
      indirizzo: b.Indirizzo || b.indirizzo,
      citta: b.Citta || b.citta,
      provincia: b.Provincia || b.provincia,
      cap: b.Cap || b.cap,
      id_presidia: b.IDStazione || b.idStazione
    },
    data_pubblicazione: b.DataPubblicazione || b.dataPubblicazione,
    data_scadenza: b.DataScadenza || b.dataScadenza,
    importo: b.Importo || b.importo,
    importo_co: b.ImportoCO || b.importoCo,
    cig: b.CIG || b.Cig || b.cig,
    cup: b.CUP || b.Cup || b.cup,
    soa: b.SOA || b.Soa || b.categoriaSoa,
    tipologia: b.Tipologia || b.tipologia,
    criterio: b.CriterioAggiudicazione || b.criterio,
    regione: b.Regione || b.regione,
    citta: b.Citta || b.citta,
    indirizzo: b.Indirizzo || b.indirizzo,
    cap: b.Cap || b.cap,
    allegati: b.Allegati || b.allegati || b.Documenti || b.documenti || [],
    url_disciplinare: b.UrlDisciplinare || b.urlDisciplinare || null,
    url_capitolato: b.UrlCapitolato || b.urlCapitolato || null,
    url_bando: b.UrlBando || b.urlBando || null
  }));
}

/**
 * Map Presidia data to EasyWin bando fields
 */
function mapPresidiaToBando(p) {
  return {
    titolo: p.titolo || 'Bando senza titolo',
    stazione_nome: p.stazione?.nome || null,
    data_pubblicazione: parseDate(p.data_pubblicazione) || new Date(),
    data_offerta: parseDate(p.data_scadenza),
    codice_cig: p.cig || null,
    importo_so: parseDecimal(p.importo),
    importo_co: parseDecimal(p.importo_co),
    soa_codice: p.soa || null,
    tipologia_nome: p.tipologia || null,
    criterio_nome: p.criterio || null,
    regione: p.regione || p.stazione?.provincia || null,
    citta: p.citta || p.stazione?.citta || null,
    indirizzo: p.indirizzo || p.stazione?.indirizzo || null,
    cap: p.cap || p.stazione?.cap || null
  };
}

/**
 * Find existing stazione or create new one
 */
async function findOrCreateStazione(stazioneData) {
  // Try to find by name (fuzzy match)
  if (stazioneData.nome) {
    const existing = await query(
      `SELECT "id" FROM stazioni WHERE "Nome" ILIKE $1 LIMIT 1`,
      [stazioneData.nome]
    );
    if (existing.rows.length > 0) return existing.rows[0].id;
  }

  // Create new
  const result = await query(
    `INSERT INTO stazioni ("Nome", "Città")
     VALUES ($1, $2) RETURNING "id"`,
    [stazioneData.nome, stazioneData.citta]
  );

  return result.rows[0].id;
}

function parseDate(str) {
  if (!str) return null;
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

function parseDecimal(val) {
  if (!val) return null;
  const n = typeof val === 'string' ? parseFloat(val.replace(/[^\d.,\-]/g, '').replace(',', '.')) : val;
  return isNaN(n) ? null : n;
}
