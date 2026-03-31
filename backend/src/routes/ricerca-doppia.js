import { query } from '../db/pool.js';

export default async function ricercaDoppiaRoutes(fastify, opts) {

  // ============================================================
  // GET /api/ricerca-doppia - Ricerca simultanea bandi + esiti
  // ============================================================
  fastify.get('/', async (request, reply) => {
    const {
      q,
      id_stazione,
      id_provincia,
      codice_soa,
      data_da,
      data_a,
      importo_min,
      importo_max,
      id_tipologia,
      codice_cig,
      limit = 20
    } = request.query;

    const bandiConditions = ['b."Annullato" = false'];
    const esitiConditions = ['e."Annullato" = false'];
    const params = [];
    let paramIdx = 1;

    // Search text - applied to both bandi and esiti
    if (q) {
      const searchParam = `%${q}%`;
      bandiConditions.push(`(b."Titolo" ILIKE $${paramIdx} OR b."CodiceCIG" ILIKE $${paramIdx})`);
      esitiConditions.push(`(e."Titolo" ILIKE $${paramIdx} OR e."CodiceCIG" ILIKE $${paramIdx})`);
      params.push(searchParam);
      paramIdx++;
    }

    if (id_stazione) {
      bandiConditions.push(`b."id_stazione" = $${paramIdx}`);
      esitiConditions.push(`e."id_stazione" = $${paramIdx}`);
      params.push(id_stazione);
      paramIdx++;
    }

    if (id_provincia) {
      const bandoProvincia = paramIdx;
      const esitiProvincia = paramIdx + 1;
      bandiConditions.push(`EXISTS (SELECT 1 FROM bandiprovince bp WHERE bp."id_bando" = b."id_bando" AND bp."id_provincia" = $${bandoProvincia})`);
      esitiConditions.push(`EXISTS (SELECT 1 FROM esitiprovince ep WHERE ep."id_esito" = e."id_esito" AND ep."id_provincia" = $${esitiProvincia})`);
      params.push(id_provincia, id_provincia);
      paramIdx += 2;
    }

    if (codice_soa) {
      bandiConditions.push(`b."id_soa" = $${paramIdx}`);
      esitiConditions.push(`e."id_soa" = $${paramIdx}`);
      params.push(codice_soa);
      paramIdx++;
    }

    if (data_da) {
      bandiConditions.push(`b."DataPubblicazione" >= $${paramIdx}`);
      esitiConditions.push(`e."DataPubblicazione" >= $${paramIdx}`);
      params.push(data_da);
      paramIdx++;
    }

    if (data_a) {
      bandiConditions.push(`b."DataPubblicazione" <= $${paramIdx}`);
      esitiConditions.push(`e."DataPubblicazione" <= $${paramIdx}`);
      params.push(data_a);
      paramIdx++;
    }

    if (importo_min) {
      const importoParam = parseFloat(importo_min);
      bandiConditions.push(`(COALESCE(b."ImportoSO", 0) + COALESCE(b."ImportoCO", 0) + COALESCE(b."ImportoEco", 0)) >= $${paramIdx}`);
      esitiConditions.push(`(COALESCE(e."ImportoSO", 0) + COALESCE(e."ImportoCO", 0) + COALESCE(e."ImportoEco", 0)) >= $${paramIdx}`);
      params.push(importoParam);
      paramIdx++;
    }

    if (importo_max) {
      const importoParam = parseFloat(importo_max);
      bandiConditions.push(`(COALESCE(b."ImportoSO", 0) + COALESCE(b."ImportoCO", 0) + COALESCE(b."ImportoEco", 0)) <= $${paramIdx}`);
      esitiConditions.push(`(COALESCE(e."ImportoSO", 0) + COALESCE(e."ImportoCO", 0) + COALESCE(e."ImportoEco", 0)) <= $${paramIdx}`);
      params.push(importoParam);
      paramIdx++;
    }

    if (id_tipologia) {
      bandiConditions.push(`b."id_tipologia" = $${paramIdx}`);
      esitiConditions.push(`e."id_tipologia" = $${paramIdx}`);
      params.push(id_tipologia);
      paramIdx++;
    }

    if (codice_cig) {
      const cigParam = `%${codice_cig}%`;
      bandiConditions.push(`b."CodiceCIG" ILIKE $${paramIdx}`);
      esitiConditions.push(`e."CodiceCIG" ILIKE $${paramIdx}`);
      params.push(cigParam);
      paramIdx++;
    }

    const bandiWhere = `WHERE ${bandiConditions.join(' AND ')}`;
    const esitiWhere = `WHERE ${esitiConditions.join(' AND ')}`;

    // Fetch bandi
    const bandiResult = await query(
      `SELECT
        b."id_bando" AS id,
        b."Titolo" AS titolo,
        'bando' AS tipo,
        COALESCE(b."Stazione", s."Nome") AS stazione,
        b."Regione" AS provincia,
        b."DataPubblicazione" AS data,
        (COALESCE(b."ImportoSO", 0) + COALESCE(b."ImportoCO", 0) + COALESCE(b."ImportoEco", 0)) AS importo,
        b."CodiceCIG" AS cig,
        tg."Tipologia" AS tipologia,
        'pubblicato' AS stato
       FROM bandi b
       LEFT JOIN stazioni s ON b."id_stazione" = s."id"
       LEFT JOIN tipologiagare tg ON b."id_tipologia" = tg."id_tipologia"
       ${bandiWhere}
       ORDER BY b."DataPubblicazione" DESC
       LIMIT $${paramIdx}`,
      [...params, Math.min(parseInt(limit), 100)]
    );

    // Fetch esiti
    const esitiResult = await query(
      `SELECT
        e."id_esito" AS id,
        e."Titolo" AS titolo,
        'esito' AS tipo,
        COALESCE(e."Stazione", s."Nome") AS stazione,
        e."Regione" AS provincia,
        e."DataPubblicazione" AS data,
        (COALESCE(e."ImportoSO", 0) + COALESCE(e."ImportoCO", 0) + COALESCE(e."ImportoEco", 0)) AS importo,
        e."CodiceCIG" AS cig,
        tg."Tipologia" AS tipologia,
        CASE WHEN e."DataOfferta" IS NOT NULL THEN 'concluso' ELSE 'pubblicato' END AS stato
       FROM esiti e
       LEFT JOIN stazioni s ON e."id_stazione" = s."id"
       LEFT JOIN tipologiagare tg ON e."id_tipologia" = tg."id_tipologia"
       ${esitiWhere}
       ORDER BY e."DataPubblicazione" DESC
       LIMIT $${paramIdx}`,
      [...params, Math.min(parseInt(limit), 100)]
    );

    return {
      bandi: bandiResult.rows,
      esiti: esitiResult.rows,
      totale_bandi: bandiResult.rows.length,
      totale_esiti: esitiResult.rows.length,
      query_params: {
        q, id_stazione, id_provincia, codice_soa, data_da, data_a,
        importo_min, importo_max, id_tipologia, codice_cig, limit
      }
    };
  });

  // ============================================================
  // GET /api/ricerca-doppia/per-cig/:cig - Tutti bandi e esiti per CIG
  // ============================================================
  fastify.get('/per-cig/:cig', async (request, reply) => {
    const { cig } = request.params;

    const bandiResult = await query(
      `SELECT
        b."id_bando" AS id,
        b."Titolo" AS titolo,
        'bando' AS tipo,
        COALESCE(b."Stazione", s."Nome") AS stazione,
        b."Regione" AS provincia,
        b."DataPubblicazione" AS data,
        (COALESCE(b."ImportoSO", 0) + COALESCE(b."ImportoCO", 0) + COALESCE(b."ImportoEco", 0)) AS importo,
        b."CodiceCIG" AS cig,
        tg."Tipologia" AS tipologia,
        'pubblicato' AS stato
       FROM bandi b
       LEFT JOIN stazioni s ON b."id_stazione" = s."id"
       LEFT JOIN tipologiagare tg ON b."id_tipologia" = tg."id_tipologia"
       WHERE b."CodiceCIG" = $1 AND b."Annullato" = false
       ORDER BY b."DataPubblicazione" ASC`,
      [cig]
    );

    const esitiResult = await query(
      `SELECT
        e."id_esito" AS id,
        e."Titolo" AS titolo,
        'esito' AS tipo,
        COALESCE(e."Stazione", s."Nome") AS stazione,
        e."Regione" AS provincia,
        e."DataPubblicazione" AS data,
        (COALESCE(e."ImportoSO", 0) + COALESCE(e."ImportoCO", 0) + COALESCE(e."ImportoEco", 0)) AS importo,
        e."CodiceCIG" AS cig,
        tg."Tipologia" AS tipologia,
        CASE WHEN e."DataOfferta" IS NOT NULL THEN 'concluso' ELSE 'pubblicato' END AS stato
       FROM esiti e
       LEFT JOIN stazioni s ON e."id_stazione" = s."id"
       LEFT JOIN tipologiagare tg ON e."id_tipologia" = tg."id_tipologia"
       WHERE e."CodiceCIG" = $1 AND e."Annullato" = false
       ORDER BY e."DataPubblicazione" ASC`,
      [cig]
    );

    return {
      cig: cig,
      bandi: bandiResult.rows,
      esiti: esitiResult.rows,
      totale_bandi: bandiResult.rows.length,
      totale_esiti: esitiResult.rows.length
    };
  });

  // ============================================================
  // GET /api/ricerca-doppia/per-stazione/:id - Bandi e esiti per stazione
  // ============================================================
  fastify.get('/per-stazione/:id', async (request, reply) => {
    const { id } = request.params;
    const { page = 1, limit = 20 } = request.query;
    const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

    // Get stazione info first
    const stazioneResult = await query(
      `SELECT "id" AS id, "Nome" AS nome FROM stazioni WHERE "id" = $1`,
      [id]
    );

    if (stazioneResult.rows.length === 0) {
      return reply.status(404).send({ error: 'Stazione non trovata' });
    }

    const stazione = stazioneResult.rows[0];

    // Count totals
    const countResult = await query(
      `SELECT
        COUNT(DISTINCT CASE WHEN b."id_bando" IS NOT NULL THEN b."id_bando" END) as bandi,
        COUNT(DISTINCT CASE WHEN e."id_esito" IS NOT NULL THEN e."id_esito" END) as esiti
       FROM stazioni s
       LEFT JOIN bandi b ON s."id" = b."id_stazione" AND b."Annullato" = false
       LEFT JOIN esiti e ON s."id" = e."id_stazione" AND e."Annullato" = false
       WHERE s."id" = $1`,
      [id]
    );

    const totale_bandi = parseInt(countResult.rows[0].bandi);
    const totale_esiti = parseInt(countResult.rows[0].esiti);

    // Fetch bandi
    const bandiResult = await query(
      `SELECT
        b."id_bando" AS id,
        b."Titolo" AS titolo,
        'bando' AS tipo,
        s."Nome" AS stazione,
        b."Regione" AS provincia,
        b."DataPubblicazione" AS data,
        (COALESCE(b."ImportoSO", 0) + COALESCE(b."ImportoCO", 0) + COALESCE(b."ImportoEco", 0)) AS importo,
        b."CodiceCIG" AS cig,
        tg."Tipologia" AS tipologia,
        'pubblicato' AS stato
       FROM bandi b
       LEFT JOIN stazioni s ON b."id_stazione" = s."id"
       LEFT JOIN tipologiagare tg ON b."id_tipologia" = tg."id_tipologia"
       WHERE b."id_stazione" = $1 AND b."Annullato" = false
       ORDER BY b."DataPubblicazione" DESC
       LIMIT $2 OFFSET $3`,
      [id, parseInt(limit), offset]
    );

    // Fetch esiti
    const esitiResult = await query(
      `SELECT
        e."id_esito" AS id,
        e."Titolo" AS titolo,
        'esito' AS tipo,
        s."Nome" AS stazione,
        e."Regione" AS provincia,
        e."DataPubblicazione" AS data,
        (COALESCE(e."ImportoSO", 0) + COALESCE(e."ImportoCO", 0) + COALESCE(e."ImportoEco", 0)) AS importo,
        e."CodiceCIG" AS cig,
        tg."Tipologia" AS tipologia,
        CASE WHEN e."DataOfferta" IS NOT NULL THEN 'concluso' ELSE 'pubblicato' END AS stato
       FROM esiti e
       LEFT JOIN stazioni s ON e."id_stazione" = s."id"
       LEFT JOIN tipologiagare tg ON e."id_tipologia" = tg."id_tipologia"
       WHERE e."id_stazione" = $1 AND e."Annullato" = false
       ORDER BY e."DataPubblicazione" DESC
       LIMIT $2 OFFSET $3`,
      [id, parseInt(limit), offset]
    );

    return {
      stazione: stazione,
      bandi: bandiResult.rows,
      esiti: esitiResult.rows,
      totale_bandi: totale_bandi,
      totale_esiti: totale_esiti,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit)
      }
    };
  });

  // ============================================================
  // GET /api/ricerca-doppia/timeline/:cig - Timeline completa per CIG
  // ============================================================
  fastify.get('/timeline/:cig', async (request, reply) => {
    const { cig } = request.params;

    // Fetch bando info
    const bandiResult = await query(
      `SELECT
        b."id_bando" AS id,
        'pubblicazione_bando' AS evento,
        b."DataPubblicazione" AS timestamp,
        b."Titolo" AS titolo,
        'bando' AS tipo,
        (COALESCE(b."ImportoSO", 0) + COALESCE(b."ImportoCO", 0) + COALESCE(b."ImportoEco", 0)) AS importo,
        COALESCE(b."Stazione", s."Nome") AS stazione,
        NULL::text AS aggiudicatario
       FROM bandi b
       LEFT JOIN stazioni s ON b."id_stazione" = s."id"
       WHERE b."CodiceCIG" = $1 AND b."Annullato" = false`,
      [cig]
    );

    // Fetch apertura date
    const apertureResult = await query(
      `SELECT
        b."id_bando" AS id,
        'apertura_offerte' AS evento,
        b."DataApertura" AS timestamp,
        b."Titolo" AS titolo,
        'bando' AS tipo,
        (COALESCE(b."ImportoSO", 0) + COALESCE(b."ImportoCO", 0) + COALESCE(b."ImportoEco", 0)) AS importo,
        COALESCE(b."Stazione", s."Nome") AS stazione,
        NULL::text AS aggiudicatario
       FROM bandi b
       LEFT JOIN stazioni s ON b."id_stazione" = s."id"
       WHERE b."CodiceCIG" = $1 AND b."Annullato" = false AND b."DataApertura" IS NOT NULL`,
      [cig]
    );

    // Fetch esiti
    const esitiResult = await query(
      `SELECT
        e."id_esito" AS id,
        CASE WHEN e."DataOfferta" IS NOT NULL THEN 'esito_pubblicato' ELSE 'risultato_gara' END AS evento,
        CASE WHEN e."DataOfferta" IS NOT NULL THEN e."DataOfferta" ELSE e."DataPubblicazione" END AS timestamp,
        e."Titolo" AS titolo,
        'esito' AS tipo,
        (COALESCE(e."ImportoSO", 0) + COALESCE(e."ImportoCO", 0) + COALESCE(e."ImportoEco", 0)) AS importo,
        COALESCE(e."Stazione", s."Nome") AS stazione,
        e."RagioneSocialeDittoGagliardini" AS aggiudicatario
       FROM esiti e
       LEFT JOIN stazioni s ON e."id_stazione" = s."id"
       WHERE e."CodiceCIG" = $1 AND e."Annullato" = false`,
      [cig]
    );

    // Combine and sort by timestamp
    const events = [
      ...bandiResult.rows.map(r => ({...r, evento: 'pubblicazione_bando'})),
      ...apertureResult.rows.map(r => ({...r, evento: 'apertura_offerte'})),
      ...esitiResult.rows.map(r => ({...r}))
    ];

    events.sort((a, b) => {
      const timeA = new Date(a.timestamp).getTime();
      const timeB = new Date(b.timestamp).getTime();
      return timeA - timeB;
    });

    return {
      cig: cig,
      timeline: events,
      totale_eventi: events.length,
      bandi_count: bandiResult.rows.length,
      esiti_count: esitiResult.rows.length
    };
  });

}
