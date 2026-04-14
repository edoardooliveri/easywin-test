import { query } from '../db/pool.js';
import {
  PresidiaClient,
  normalizePresidiaBando,
  downloadAllegato,
  extractCIG,
  extractCUP,
  mapSoaCode,
  DEFAULT_ENDPOINT
} from '../services/presidia-soap.js';
import { runImportPresidia } from '../services/presidia-import.js';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Presidia Integration Routes
 *
 * Integrazione completa con il web service SOAP di Presidia (macsyws.asmx).
 *
 * Endpoint SOAP: http://easywin.presidia.it/macsyws.asmx
 * Namespace: http://www.guru4.net/EuroConv
 *
 * Operazioni:
 * - RecuperaBandiAttivi(dal, al) → Import batch per intervallo date
 * - TrovaBandiPerFiltri(GUID, categorie, province, ...) → Ricerca con filtri
 * - TrovaBandiPerCodice(codice) → Import singolo bando
 * - RecuperaListaCategorie() → Categorie SOA Presidia
 * - Gestione email/esigenze/cliente su Presidia
 */
export default async function presidiaRoutes(fastify, opts) {

  // Singleton client
  let _presidiaClient = null;
  function getClient() {
    if (!_presidiaClient) {
      _presidiaClient = new PresidiaClient(
        process.env.PRESIDIA_SOAP_URL || DEFAULT_ENDPOINT
      );
    }
    return _presidiaClient;
  }

  // ============================================================
  // POST /api/presidia/import — Import batch bandi da Presidia
  // ============================================================
  fastify.post('/import', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { data_dal, data_al, max_results = 500 } = request.body;
    const user = request.user;

    if (!data_dal || !data_al) {
      return reply.status(400).send({ error: 'data_dal e data_al sono obbligatori' });
    }

    try {
      const stats = await runImportPresidia({
        dataDal: data_dal,
        dataAl: data_al,
        tipo: 'manuale',
        createdBy: user.username || user.email || 'admin',
        fastify,
        maxResults: max_results
      });

      // Log nel DB (tipo manuale)
      const today = new Date().toISOString().split('T')[0];
      const slotKey = `${today}_manuale_${Date.now()}`;
      try {
        await query(
          `INSERT INTO presidia_import_runs
           (slot_key, tipo, data_dal, data_al, total_presidia, imported, updated, skipped, errors,
            duration_ms, success, created_by)
           VALUES ($1, 'manuale', $2, $3, $4, $5, $6, $7, $8, 0, true, $9)
           ON CONFLICT (slot_key) DO NOTHING`,
          [slotKey, data_dal, data_al, stats.total_presidia, stats.imported,
           stats.updated || 0, stats.skipped, stats.errors,
           user.username || 'admin']
        );
      } catch (logErr) {
        fastify.log.warn({ err: logErr.message }, 'Errore log import run');
      }

      return {
        imported: stats.imported,
        skipped: stats.skipped,
        updated: stats.updated || 0,
        errors: stats.errors,
        total_presidia: stats.total_presidia,
        processed: Math.min(stats.total_presidia, max_results),
        imported_list: stats.imported_list?.length > 0 ? stats.imported_list : undefined,
        error_details: stats.error_details?.length > 0 ? stats.error_details : undefined,
        message: `Import completato: ${stats.imported} nuovi, ${stats.updated || 0} rettificati, ${stats.skipped} gia\u0027 presenti, ${stats.errors} errori`
      };
    } catch (err) {
      fastify.log.error(err);

      // Log run fallita nel DB
      const today = new Date().toISOString().split('T')[0];
      const slotKey = `${today}_manuale_${Date.now()}`;
      try {
        await query(
          `INSERT INTO presidia_import_runs
           (slot_key, tipo, data_dal, data_al, success, error_detail, created_by)
           VALUES ($1, 'manuale', $2, $3, false, $4, $5)
           ON CONFLICT (slot_key) DO NOTHING`,
          [slotKey, data_dal, data_al,
           JSON.stringify({ message: err.message, stack: err.stack?.slice(0, 500) }),
           user.username || 'admin']
        );
      } catch (logErr) {
        fastify.log.warn({ err: logErr.message }, 'Errore log import run fallita');
      }

      return {
        success: false,
        imported: 0, skipped: 0, updated: 0, errors: 1,
        total_presidia: 0,
        error: err.message,
        message: `Import fallito: ${err.message}`
      };
    }
  });

  // ============================================================
  // POST /api/presidia/search — Ricerca bandi con filtri (UI admin)
  // ============================================================
  fastify.post('/search', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const {
      guid, categorie, province, stato,
      importo_min, importo_max, oggetto,
      id_ente, ente,
      immissione_dal, immissione_al,
      scadenza_dal, scadenza_al,
      scorporabili, page = 1
    } = request.body;

    try {
      const client = getClient();
      const rawBandi = await client.trovaBandiPerFiltri({
        guid: guid || '',
        categorie: categorie || '',
        province: province || '',
        stato: stato || '',
        importoMinimo: importo_min || 0,
        importoMassimo: importo_max || 0,
        oggetto: oggetto || '',
        idEnte: id_ente || '',
        ente: ente || '',
        immissioneDal: immissione_dal || '',
        immissioneAl: immissione_al || '',
        scadenzaDal: scadenza_dal || '',
        scadenzaAl: scadenza_al || '',
        scorporabili: scorporabili || false
      });

      if (!rawBandi || rawBandi.length === 0) {
        return { bandi: [], total: 0, page, message: 'Nessun risultato da Presidia' };
      }

      // Normalizza e verifica duplicati
      const bandi = rawBandi.map(raw => {
        const norm = normalizePresidiaBando(raw);
        return norm;
      });

      // Check quali sono gia' importati
      const codes = bandi.map(b => String(b.external_code)).filter(Boolean);
      const existingResult = await query(
        `SELECT "external_code" FROM bandi WHERE "external_code" = ANY($1) AND "provenienza" = 'Presidia'`,
        [codes]
      );
      const existingSet = new Set(existingResult.rows.map(r => r.external_code));

      const bandiWithStatus = bandi.map(b => ({
        ...b,
        already_imported: existingSet.has(String(b.external_code)),
        _raw: undefined // Rimuovi dati raw dalla risposta
      }));

      // Pagination (50 per pagina come nel vecchio sistema)
      const pageSize = 50;
      const start = (page - 1) * pageSize;
      const paged = bandiWithStatus.slice(start, start + pageSize);

      return {
        bandi: paged,
        total: bandiWithStatus.length,
        page,
        total_pages: Math.ceil(bandiWithStatus.length / pageSize),
        already_imported_count: bandiWithStatus.filter(b => b.already_imported).length
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({
        error: 'Errore ricerca Presidia',
        details: err.message
      });
    }
  });

  // ============================================================
  // POST /api/presidia/import-single — Import singolo bando per codice
  // ============================================================
  fastify.post('/import-single', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { codice } = request.body;
    const user = request.user;

    if (!codice) {
      return reply.status(400).send({ error: 'Codice bando obbligatorio' });
    }

    try {
      // Verifica se gia' importato
      const existing = await query(
        'SELECT "id" FROM bandi WHERE "external_code" = $1 AND "provenienza" = $2',
        [String(codice), 'Presidia']
      );
      if (existing.rows.length > 0) {
        return reply.status(409).send({
          error: 'Bando gia\u0027 importato',
          bando_id: existing.rows[0].id
        });
      }

      const client = getClient();
      const rawBandi = await client.trovaBandiPerCodice(String(codice));

      if (!rawBandi || rawBandi.length === 0) {
        return reply.status(404).send({ error: 'Bando non trovato su Presidia' });
      }

      const bando = normalizePresidiaBando(rawBandi[0]);
      const id_stazione = await findOrCreateStazione(bando.stazione);
      const id_soa = await findSoa(bando.soa_codice);
      const provinceIds = await resolveProvince(bando.province);

      const insertResult = await query(
        `INSERT INTO bandi (
          "titolo", "id_stazione", "stazione_nome",
          "data_pubblicazione", "data_offerta", "data_apertura",
          "data_sop_start", "data_sop_end",
          "codice_cig", "codice_cup",
          "id_soa", "soa_val", "categoria_presunta",
          "importo_so", "importo_co",
          "provenienza", "external_code", "fonte_dati",
          "inserito_da", "note",
          "created_at", "updated_at"
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,NOW(),NOW())
        RETURNING id`,
        [
          bando.titolo, id_stazione, bando.stazione.nome,
          bando.data_pubblicazione, bando.data_offerta, bando.data_apertura,
          bando.data_sop_start, bando.data_sop_end,
          bando.codice_cig, bando.codice_cup,
          id_soa, bando.soa_codice ? 1 : 0, bando.categoria_presunta || false,
          bando.importo_so, bando.importo_co,
          'Presidia', String(bando.external_code), bando.fonte_dati,
          user.username,
          `Import manuale Presidia - ${user.username} - ${new Date().toISOString().split('T')[0]}`
        ]
      );

      const newBandoId = insertResult.rows[0].id;

      // Province e SOA secondarie
      for (const provId of provinceIds) {
        await query(`INSERT INTO bandi_province ("id_bando", "id_provincia") VALUES ($1, $2) ON CONFLICT DO NOTHING`, [newBandoId, provId]);
      }
      for (const soaSec of bando.soa_secondarie) {
        const soaId = await findSoa(soaSec.codice_mappato);
        if (soaId) {
          const table = soaSec.tipo === 'alternativa' ? 'bandi_soa_alt' : 'bandi_soa_sec';
          await query(`INSERT INTO ${table} ("id_bando", "id_soa") VALUES ($1, $2) ON CONFLICT DO NOTHING`, [newBandoId, soaId]);
        }
      }

      // Salva dati originali
      await query(
        `UPDATE bandi SET "ai_extracted_data" = $1 WHERE "id" = $2`,
        [JSON.stringify({ presidia_raw: rawBandi[0], mapped: bando }), newBandoId]
      );

      // Download allegato
      const allegato = await downloadAllegato(bando.external_code);
      if (allegato) {
        await query(
          `INSERT INTO allegati_bando ("id_bando", "nome_file", "tipo", "dimensione", "dati", "created_at")
           VALUES ($1, $2, $3, $4, $5, NOW())`,
          [newBandoId, 'Bando.zip', 'application/zip', allegato.length, allegato]
        );
      }

      return {
        success: true,
        bando_id: newBandoId,
        titolo: bando.titolo.substring(0, 80),
        has_allegato: !!allegato,
        message: `Bando importato con successo${allegato ? ' (con allegato)' : ''}`
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Errore import singolo', details: err.message });
    }
  });

  // ============================================================
  // GET /api/presidia/status — Stato connessione Presidia
  // ============================================================
  fastify.get('/status', async (request, reply) => {
    const soapUrl = process.env.PRESIDIA_SOAP_URL || DEFAULT_ENDPOINT;

    // Test connessione SOAP
    let connected = false;
    let connectionError = null;
    try {
      const client = getClient();
      await client.connect();
      connected = true;
    } catch (err) {
      connectionError = err.message;
    }

    // Stats import
    const stats = await query(
      `SELECT
        MAX("created_at") as ultimo_import,
        COUNT(*) FILTER (WHERE "created_at" > NOW() - INTERVAL '24 hours') as ultimi_24h,
        COUNT(*) FILTER (WHERE "created_at" > NOW() - INTERVAL '7 days') as ultimi_7_giorni,
        COUNT(*) as totale
       FROM bandi WHERE "provenienza" = 'Presidia'`
    );

    return {
      soap_url: soapUrl,
      connected,
      connection_error: connectionError,
      statistiche: stats.rows[0]
    };
  });

  // ============================================================
  // POST /api/presidia/sync — Sincronizzazione ultimi 7 giorni
  // ============================================================
  fastify.post('/sync', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const oggi = new Date();
    const settimanaFa = new Date(oggi);
    settimanaFa.setDate(settimanaFa.getDate() - 7);
    const user = request.user;

    try {
      const stats = await runImportPresidia({
        dataDal: settimanaFa.toISOString().split('T')[0],
        dataAl: oggi.toISOString().split('T')[0],
        tipo: 'sync',
        createdBy: user.username || 'admin',
        fastify,
        maxResults: 500
      });

      return {
        imported: stats.imported,
        skipped: stats.skipped,
        updated: stats.updated || 0,
        errors: stats.errors,
        total_presidia: stats.total_presidia,
        message: `Sync completata: ${stats.imported} nuovi, ${stats.updated || 0} rettificati, ${stats.skipped} esistenti, ${stats.errors} errori`
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Errore sync Presidia', details: err.message });
    }
  });

  // ============================================================
  // GET /api/presidia/categorie — Lista categorie SOA da Presidia
  // ============================================================
  fastify.get('/categorie', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const client = getClient();
      const categorie = await client.recuperaListaCategorie();
      return { categorie };
    } catch (err) {
      return reply.status(500).send({ error: 'Errore recupero categorie', details: err.message });
    }
  });

  // ============================================================
  // GET /api/presidia/fonti — Fonti dati da Presidia
  // ============================================================
  fastify.get('/fonti', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const client = getClient();
      const fonti = await client.recuperaFontiDati();
      return { fonti };
    } catch (err) {
      return reply.status(500).send({ error: 'Errore recupero fonti', details: err.message });
    }
  });

  // ============================================================
  // GET /api/presidia/test — Test connessione SOAP
  // ============================================================
  fastify.get('/test', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const client = getClient();
      await client.connect();

      // Test con una chiamata leggera
      const fonti = await client.recuperaFontiDati();

      return {
        success: true,
        soap_url: client.endpoint,
        fonti_count: Array.isArray(fonti) ? fonti.length : 0,
        message: 'Connessione SOAP a Presidia funzionante'
      };
    } catch (err) {
      return {
        success: false,
        soap_url: process.env.PRESIDIA_SOAP_URL || DEFAULT_ENDPOINT,
        error: err.message,
        message: 'Connessione SOAP a Presidia fallita'
      };
    }
  });

  // ============================================================
  // GET /api/presidia/runs/today — Run di oggi
  // ============================================================
  fastify.get('/runs/today', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const rows = await query('SELECT * FROM v_presidia_runs_oggi');
      return { runs: rows.rows };
    } catch (err) {
      // Se la vista non esiste ancora (migration non applicata)
      return { runs: [], error: err.message };
    }
  });

  // ============================================================
  // GET /api/presidia/runs — Storico run (ultimi N giorni)
  // ============================================================
  fastify.get('/runs', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const days = Math.min(parseInt(request.query.days) || 7, 30);
    try {
      const rows = await query(
        `SELECT * FROM presidia_import_runs
         WHERE run_at > NOW() - $1::interval
         ORDER BY run_at DESC LIMIT 500`,
        [`${days} days`]
      );
      return { runs: rows.rows, days };
    } catch (err) {
      return { runs: [], error: err.message };
    }
  });

  // ============================================================
  // GET /api/presidia/runs/errors — Ultimi 20 run falliti
  // ============================================================
  fastify.get('/runs/errors', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const rows = await query(
        `SELECT * FROM presidia_import_runs WHERE success = false
         ORDER BY run_at DESC LIMIT 20`
      );
      return { runs: rows.rows };
    } catch (err) {
      return { runs: [], error: err.message };
    }
  });

  // ============================================================
  // GET /api/presidia/scheduler-status — Stato scheduler
  // ============================================================
  fastify.get('/scheduler-status', { preHandler: [fastify.authenticate] }, async () => {
    const enabled = process.env.PRESIDIA_AUTO === 'true';
    const slots = [
      '11:00', '12:00', '13:00', '14:00', '15:00', '16:00',
      '16:45', '17:15', '17:45', '18:15', '18:45', '19:15',
      '04:00 (riepilogo)'
    ];
    return { enabled, slots, total_slots: 13 };
  });
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Cerca stazione per nome (fuzzy) o crea nuova
 */
async function findOrCreateStazione(stazioneData) {
  if (!stazioneData || !stazioneData.nome) return null;

  // Prima cerca per id_presidia se disponibile
  if (stazioneData.id_presidia) {
    const byPresidia = await query(
      `SELECT "id" FROM stazioni WHERE "id_presidia" = $1 LIMIT 1`,
      [stazioneData.id_presidia]
    );
    if (byPresidia.rows.length > 0) return byPresidia.rows[0].id;
  }

  // Poi cerca per nome esatto
  const byName = await query(
    `SELECT "id" FROM stazioni WHERE "nome" ILIKE $1 LIMIT 1`,
    [stazioneData.nome]
  );
  if (byName.rows.length > 0) return byName.rows[0].id;

  // Crea nuova stazione
  const result = await query(
    `INSERT INTO stazioni ("nome", "citta", "indirizzo", "cap", "id_presidia", "created_at", "updated_at")
     VALUES ($1, $2, $3, $4, $5, NOW(), NOW()) RETURNING "id"`,
    [
      stazioneData.nome,
      stazioneData.citta || null,
      stazioneData.indirizzo || null,
      stazioneData.cap || null,
      stazioneData.id_presidia || null
    ]
  );

  return result.rows[0].id;
}

/**
 * Cerca SOA per codice (cod o OldCod)
 */
async function findSoa(codice) {
  if (!codice) return null;
  const result = await query(
    `SELECT "id" FROM soa WHERE "cod" = $1 OR "cod" ILIKE $1 LIMIT 1`,
    [codice]
  );
  return result.rows.length > 0 ? result.rows[0].id : null;
}

/**
 * Risolve sigle province in ID database
 */
async function resolveProvince(sigle) {
  if (!sigle || sigle.length === 0) return [];
  const ids = [];
  for (const sigla of sigle) {
    const result = await query(
      `SELECT "id" FROM province WHERE "sigla" ILIKE $1 LIMIT 1`,
      [sigla]
    );
    if (result.rows.length > 0) {
      ids.push(result.rows[0].id);
    }
  }
  return ids;
}

/**
 * Download allegato in background e salva nel DB
 */
async function downloadAllegatoForBando(bandoId, externalCode) {
  if (!externalCode) return;
  const allegato = await downloadAllegato(externalCode);
  if (allegato && allegato.length > 0) {
    await query(
      `INSERT INTO allegati_bando ("id_bando", "nome_file", "tipo", "dimensione", "dati", "created_at")
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT DO NOTHING`,
      [bandoId, 'Bando.zip', 'application/zip', allegato.length, allegato]
    );
  }
}
