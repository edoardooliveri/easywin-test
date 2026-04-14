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

    const bandiConditions = ['b.annullato = false'];
    const esitiConditions = ['e.annullato = false'];
    const params = [];
    let paramIdx = 1;

    // Search text - applied to both bandi and esiti
    if (q) {
      const searchParam = `%${q}%`;
      bandiConditions.push(`(b.titolo ILIKE $${paramIdx} OR b.codice_cig ILIKE $${paramIdx})`);
      esitiConditions.push(`(e.titolo ILIKE $${paramIdx} OR e.codice_cig ILIKE $${paramIdx})`);
      params.push(searchParam);
      paramIdx++;
    }

    if (id_stazione) {
      bandiConditions.push(`b.id_stazione = $${paramIdx}`);
      esitiConditions.push(`e.id_stazione = $${paramIdx}`);
      params.push(id_stazione);
      paramIdx++;
    }

    if (id_provincia) {
      const bandoProvincia = paramIdx;
      const esitiProvincia = paramIdx + 1;
      bandiConditions.push(`EXISTS (SELECT 1 FROM bandi_province bp WHERE bp.id_bando = b.id AND bp.id_provincia = $${bandoProvincia})`);
      esitiConditions.push(`EXISTS (SELECT 1 FROM gare_province ep WHERE ep.id_esito = e.id AND ep.id_provincia = $${esitiProvincia})`);
      params.push(id_provincia, id_provincia);
      paramIdx += 2;
    }

    if (codice_soa) {
      bandiConditions.push(`b.id_soa = $${paramIdx}`);
      esitiConditions.push(`e.id_soa = $${paramIdx}`);
      params.push(codice_soa);
      paramIdx++;
    }

    if (data_da) {
      bandiConditions.push(`b.data_pubblicazione >= $${paramIdx}`);
      esitiConditions.push(`e.data >= $${paramIdx}`);
      params.push(data_da);
      paramIdx++;
    }

    if (data_a) {
      bandiConditions.push(`b.data_pubblicazione <= $${paramIdx}`);
      esitiConditions.push(`e.data <= $${paramIdx}`);
      params.push(data_a);
      paramIdx++;
    }

    if (importo_min) {
      const importoParam = parseFloat(importo_min);
      bandiConditions.push(`(COALESCE(b.importo_so, 0) + COALESCE(b.importo_co, 0) + COALESCE(b.importo_eco, 0)) >= $${paramIdx}`);
      esitiConditions.push(`(COALESCE(e.importo_so, 0) + COALESCE(e.importo_co, 0) + COALESCE(e.importo_eco, 0)) >= $${paramIdx}`);
      params.push(importoParam);
      paramIdx++;
    }

    if (importo_max) {
      const importoParam = parseFloat(importo_max);
      bandiConditions.push(`(COALESCE(b.importo_so, 0) + COALESCE(b.importo_co, 0) + COALESCE(b.importo_eco, 0)) <= $${paramIdx}`);
      esitiConditions.push(`(COALESCE(e.importo_so, 0) + COALESCE(e.importo_co, 0) + COALESCE(e.importo_eco, 0)) <= $${paramIdx}`);
      params.push(importoParam);
      paramIdx++;
    }

    if (id_tipologia) {
      bandiConditions.push(`b.id_tipologia = $${paramIdx}`);
      esitiConditions.push(`e.id_tipologia = $${paramIdx}`);
      params.push(id_tipologia);
      paramIdx++;
    }

    if (codice_cig) {
      const cigParam = `%${codice_cig}%`;
      bandiConditions.push(`b.codice_cig ILIKE $${paramIdx}`);
      esitiConditions.push(`e.codice_cig ILIKE $${paramIdx}`);
      params.push(cigParam);
      paramIdx++;
    }

    const bandiWhere = `WHERE ${bandiConditions.join(' AND ')}`;
    const esitiWhere = `WHERE ${esitiConditions.join(' AND ')}`;

    // Fetch bandi
    const bandiResult = await query(
      `SELECT
        b.id AS id,
        b.titolo AS titolo,
        'bando' AS tipo,
        COALESCE(b.stazione_nome, s.nome) AS stazione,
        b.regione AS provincia,
        b.data_pubblicazione AS data,
        (COALESCE(b.importo_so, 0) + COALESCE(b.importo_co, 0) + COALESCE(b.importo_eco, 0)) AS importo,
        b.codice_cig AS cig,
        tg.nome AS tipologia,
        'pubblicato' AS stato
       FROM bandi b
       LEFT JOIN stazioni s ON b.id_stazione = s.id
       LEFT JOIN tipologia_gare tg ON b.id_tipologia = tg.id
       ${bandiWhere}
       ORDER BY b.data_pubblicazione DESC
       LIMIT $${paramIdx}`,
      [...params, Math.min(parseInt(limit), 100)]
    );

    // Fetch esiti
    const esitiResult = await query(
      `SELECT
        e.id AS id,
        e.titolo AS titolo,
        'esito' AS tipo,
        COALESCE(e.stazione, s.nome) AS stazione,
        e.regione AS provincia,
        e.data AS data,
        COALESCE(e.importo, 0) AS importo,
        e.codice_cig AS cig,
        tg.nome AS tipologia,
        CASE WHEN e.enabled = true THEN 'pubblicato' ELSE 'bozza' END AS stato
       FROM gare e
       LEFT JOIN stazioni s ON e.id_stazione = s.id
       LEFT JOIN tipologia_gare tg ON e.id_tipologia = tg.id
       ${esitiWhere}
       ORDER BY e.data DESC
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
        b.id AS id,
        b.titolo AS titolo,
        'bando' AS tipo,
        COALESCE(b.stazione_nome, s.nome) AS stazione,
        b.regione AS provincia,
        b.data_pubblicazione AS data,
        (COALESCE(b.importo_so, 0) + COALESCE(b.importo_co, 0) + COALESCE(b.importo_eco, 0)) AS importo,
        b.codice_cig AS cig,
        tg.nome AS tipologia,
        'pubblicato' AS stato
       FROM bandi b
       LEFT JOIN stazioni s ON b.id_stazione = s.id
       LEFT JOIN tipologia_gare tg ON b.id_tipologia = tg.id
       WHERE b.codice_cig = $1 AND b.annullato = false
       ORDER BY b.data_pubblicazione ASC`,
      [cig]
    );

    const esitiResult = await query(
      `SELECT
        e.id AS id,
        e.titolo AS titolo,
        'esito' AS tipo,
        COALESCE(e.stazione, s.nome) AS stazione,
        e.regione AS provincia,
        e.data AS data,
        COALESCE(e.importo, 0) AS importo,
        e.codice_cig AS cig,
        tg.nome AS tipologia,
        CASE WHEN e.enabled = true THEN 'pubblicato' ELSE 'bozza' END AS stato
       FROM gare e
       LEFT JOIN stazioni s ON e.id_stazione = s.id
       LEFT JOIN tipologia_gare tg ON e.id_tipologia = tg.id
       WHERE e.codice_cig = $1 AND e.annullato = false
       ORDER BY e.data ASC`,
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
      `SELECT id, nome FROM stazioni WHERE id = $1`,
      [id]
    );

    if (stazioneResult.rows.length === 0) {
      return reply.status(404).send({ error: 'Stazione non trovata' });
    }

    const stazione = stazioneResult.rows[0];

    // Count totals
    const countResult = await query(
      `SELECT
        COUNT(DISTINCT CASE WHEN b.id IS NOT NULL THEN b.id END) as bandi,
        COUNT(DISTINCT CASE WHEN e.id IS NOT NULL THEN e.id END) as esiti
       FROM stazioni s
       LEFT JOIN bandi b ON s.id = b.id_stazione AND b.annullato = false
       LEFT JOIN esiti e ON s.id = e.id_stazione AND e.annullato = false
       WHERE s.id = $1`,
      [id]
    );

    const totale_bandi = parseInt(countResult.rows[0].bandi);
    const totale_esiti = parseInt(countResult.rows[0].esiti);

    // Fetch bandi
    const bandiResult = await query(
      `SELECT
        b.id AS id,
        b.titolo AS titolo,
        'bando' AS tipo,
        s.nome AS stazione,
        b.regione AS provincia,
        b.data_pubblicazione AS data,
        (COALESCE(b.importo_so, 0) + COALESCE(b.importo_co, 0) + COALESCE(b.importo_eco, 0)) AS importo,
        b.codice_cig AS cig,
        tg.nome AS tipologia,
        'pubblicato' AS stato
       FROM bandi b
       LEFT JOIN stazioni s ON b.id_stazione = s.id
       LEFT JOIN tipologia_gare tg ON b.id_tipologia = tg.id
       WHERE b.id_stazione = $1 AND b.annullato = false
       ORDER BY b.data_pubblicazione DESC
       LIMIT $2 OFFSET $3`,
      [id, parseInt(limit), offset]
    );

    // Fetch esiti
    const esitiResult = await query(
      `SELECT
        e.id AS id,
        e.titolo AS titolo,
        'esito' AS tipo,
        s.nome AS stazione,
        e.regione AS provincia,
        e.data AS data,
        COALESCE(e.importo, 0) AS importo,
        e.codice_cig AS cig,
        tg.nome AS tipologia,
        CASE WHEN e.enabled = true THEN 'pubblicato' ELSE 'bozza' END AS stato
       FROM gare e
       LEFT JOIN stazioni s ON e.id_stazione = s.id
       LEFT JOIN tipologia_gare tg ON e.id_tipologia = tg.id
       WHERE e.id_stazione = $1 AND e.annullato = false
       ORDER BY e.data DESC
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
        b.id AS id,
        'pubblicazione_bando' AS evento,
        b.data_pubblicazione AS timestamp,
        b.titolo AS titolo,
        'bando' AS tipo,
        (COALESCE(b.importo_so, 0) + COALESCE(b.importo_co, 0) + COALESCE(b.importo_eco, 0)) AS importo,
        COALESCE(b.stazione_nome, s.nome) AS stazione,
        NULL::text AS aggiudicatario
       FROM bandi b
       LEFT JOIN stazioni s ON b.id_stazione = s.id
       WHERE b.codice_cig = $1 AND b.annullato = false`,
      [cig]
    );

    // Fetch apertura date
    const apertureResult = await query(
      `SELECT
        b.id AS id,
        'apertura_offerte' AS evento,
        b.data_apertura AS timestamp,
        b.titolo AS titolo,
        'bando' AS tipo,
        (COALESCE(b.importo_so, 0) + COALESCE(b.importo_co, 0) + COALESCE(b.importo_eco, 0)) AS importo,
        COALESCE(b.stazione_nome, s.nome) AS stazione,
        NULL::text AS aggiudicatario
       FROM bandi b
       LEFT JOIN stazioni s ON b.id_stazione = s.id
       WHERE b.codice_cig = $1 AND b.annullato = false AND b.data_apertura IS NOT NULL`,
      [cig]
    );

    // Fetch esiti
    const esitiResult = await query(
      `SELECT
        e.id AS id,
        CASE WHEN e.data_offerta IS NOT NULL THEN 'esito_pubblicato' ELSE 'risultato_gara' END AS evento,
        CASE WHEN e.data_offerta IS NOT NULL THEN e.data_offerta ELSE e.data END AS timestamp,
        e.titolo AS titolo,
        'esito' AS tipo,
        (COALESCE(e.importo_so, 0) + COALESCE(e.importo_co, 0) + COALESCE(e.importo_eco, 0)) AS importo,
        COALESCE(e.stazione, s.nome) AS stazione,
        e.ragione_sociale_ditto_gagliardini AS aggiudicatario
       FROM gare e
       LEFT JOIN stazioni s ON e.id_stazione = s.id
       WHERE e.codice_cig = $1 AND e.annullato = false`,
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
