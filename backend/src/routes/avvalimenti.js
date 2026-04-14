/**
 * Avvalimenti — porting dei due endpoint del vecchio /Abbonamenti/Avvalimenti:
 *   - Details(idgara, idMandataria) → dettaglio avvalimento per gara+mandataria
 *   - Esiti(idazienda1, idazienda2, TipoRicercaRisultati, TipoEsiti) → lista esiti filtrata
 *
 * Nel nuovo DB le relazioni ATI/avvalimento sono gestite tramite:
 *   - dettaglio_gara.ati_avv (bool), id_azienda, id_gara, variante
 *   - ati_gare01 (id_gara, id_mandataria, id_mandante, variante, ati, avvalimento)
 *
 * Se la tabella ati_gare01 non esiste ancora nel DB mini, gli endpoint ritornano
 * array vuoti senza errore — l'admin UI mostrerà "nessun avvalimento".
 */

import { query } from '../db/pool.js';

const VARIANTE_BASE = 'BASE';

// Check se una tabella esiste (soft detection per il DB mini)
async function tableExists(name) {
  try {
    const r = await query(
      `SELECT 1 FROM information_schema.tables WHERE table_name = $1 LIMIT 1`,
      [name]
    );
    return r.rows.length > 0;
  } catch {
    return false;
  }
}

export default async function avvalimentiRoutes(fastify) {
  /**
   * GET /api/avvalimenti/details?id_gara=X&id_mandataria=Y
   * Ritorna: { id_gara, id_mandataria, mandataria, mandanti: [{id_mandante, mandante, avvalimento, ati}], is_ati, is_avvalimento }
   */
  fastify.get('/details', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const idGara = parseInt(request.query.id_gara, 10);
    const idMandataria = parseInt(request.query.id_mandataria, 10);

    if (!idGara || !idMandataria) {
      return reply.status(400).send({ error: 'id_gara e id_mandataria obbligatori' });
    }

    try {
      // Dettaglio gara (mandataria)
      const dgRes = await query(
        `SELECT dg.id_gara, dg.id_azienda AS id_mandataria, a.ragione_sociale AS mandataria
           FROM dettaglio_gara dg
      LEFT JOIN aziende a ON a.id = dg.id_azienda
          WHERE dg.id_gara = $1
            AND dg.id_azienda = $2
            AND COALESCE(dg.ati_avv::boolean, FALSE) = TRUE
            AND COALESCE(dg.variante, $3) = $3
          LIMIT 1`,
        [idGara, idMandataria, VARIANTE_BASE]
      );

      if (dgRes.rows.length === 0) {
        return { id_gara: idGara, id_mandataria: idMandataria, mandataria: null, mandanti: [], is_ati: false, is_avvalimento: false };
      }

      const base = dgRes.rows[0];

      // Mandanti (ati_gare01)
      let mandanti = [];
      if (await tableExists('ati_gare01')) {
        const mRes = await query(
          `SELECT ag.id_gara, ag.id_mandante, ag.id_mandataria,
                  m.ragione_sociale AS mandante,
                  mt.ragione_sociale AS mandataria,
                  ag.avvalimento, ag.ati
             FROM ati_gare01 ag
        LEFT JOIN aziende m  ON m.id = ag.id_mandante
        LEFT JOIN aziende mt ON mt.id = ag.id_mandataria
            WHERE ag.id_gara = $1
              AND ag.id_mandataria = $2
              AND COALESCE(ag.variante, $3) = $3
         ORDER BY m.ragione_sociale`,
          [idGara, idMandataria, VARIANTE_BASE]
        );
        mandanti = mRes.rows;
      }

      return {
        id_gara: base.id_gara,
        id_mandataria: base.id_mandataria,
        mandataria: base.mandataria,
        mandanti,
        is_ati: mandanti.some(m => m.ati),
        is_avvalimento: mandanti.some(m => m.avvalimento),
      };
    } catch (err) {
      fastify.log.error(err, 'Avvalimenti details error');
      return reply.status(500).send({ error: 'Errore dettaglio avvalimento', details: err.message });
    }
  });

  /**
   * GET /api/avvalimenti/esiti
   *   ?id_azienda1=X&id_azienda2=Y&tipo_risultati=0|1|2&tipo_esiti=0|1|2&page=1&page_size=50&sort_field&sort_dir
   *
   * tipo_risultati: 0=tutti, 1=vincitrice, 2=esclusa
   * tipo_esiti:      0=entrambi, 1=az1 mandataria di az2, 2=az2 mandataria di az1
   */
  fastify.get('/esiti', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const a1 = parseInt(request.query.id_azienda1, 10);
    const a2 = parseInt(request.query.id_azienda2, 10);
    const tRis = parseInt(request.query.tipo_risultati || '0', 10);
    const tEsiti = parseInt(request.query.tipo_esiti || '0', 10);
    const page = Math.max(1, parseInt(request.query.page || '1', 10));
    const pageSize = Math.min(200, Math.max(1, parseInt(request.query.page_size || '50', 10)));
    const sortField = (request.query.sort_field || 'data').toLowerCase();
    const sortDir = String(request.query.sort_dir || 'desc').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    if (!a1 || !a2) {
      return reply.status(400).send({ error: 'id_azienda1 e id_azienda2 obbligatori' });
    }

    if (!(await tableExists('ati_gare01'))) {
      return { azienda1: null, azienda2: null, esiti: [], total: 0, page, page_size: pageSize };
    }

    const sortMap = {
      data: 'g.data',
      stazione: 's.ragione_sociale',
      titolo: 'g.titolo',
      soa: 'g.soa_val',
      importo: 'g.importo',
      vincitore: 'av.ragione_sociale',
      ribasso: 'g.ribasso',
    };
    const orderBy = sortMap[sortField] || 'g.data';

    try {
      // Info aziende
      const azRes = await query(
        `SELECT id, ragione_sociale, citta, cap, tel, partita_iva, indirizzo
           FROM aziende WHERE id = ANY($1::int[])`,
        [[a1, a2]]
      );
      const azMap = Object.fromEntries(azRes.rows.map(r => [r.id, r]));

      const whereTipoRis = tRis === 1
        ? 'AND dg.vincitrice IS TRUE'
        : tRis === 2 ? 'AND dg.esclusa IS TRUE' : '';

      const whereTipoEsiti = tEsiti === 1
        ? `AND ag.id_mandataria = $1 AND ag.id_mandante = $2 AND COALESCE(ag.ati, FALSE) = FALSE`
        : tEsiti === 2
          ? `AND ag.id_mandataria = $2 AND ag.id_mandante = $1 AND COALESCE(ag.ati, FALSE) = FALSE`
          : `AND ((ag.id_mandataria = $1 AND ag.id_mandante = $2) OR (ag.id_mandataria = $2 AND ag.id_mandante = $1)) AND COALESCE(ag.ati, FALSE) = FALSE`;

      const baseSql = `
        FROM gare g
        JOIN dettaglio_gara dg ON dg.id_gara = g.id
        JOIN ati_gare01 ag      ON ag.id_gara = g.id AND ag.id_mandataria = dg.id_azienda
   LEFT JOIN stazioni s         ON s.id = g.id_stazione
   LEFT JOIN aziende  av        ON av.id = g.id_vincitore
       WHERE COALESCE(g.eliminata, FALSE) = FALSE
         AND COALESCE(g.temp, FALSE) = FALSE
         AND COALESCE(dg.ati_avv, FALSE) = TRUE
         AND COALESCE(ag.avvalimento, FALSE) = TRUE
         AND COALESCE(g.variante, 'BASE') = 'BASE'
         AND COALESCE(dg.variante, 'BASE') = 'BASE'
         AND COALESCE(ag.variante, 'BASE') = 'BASE'
         ${whereTipoRis}
         ${whereTipoEsiti}
      `;

      const totalRes = await query(`SELECT COUNT(DISTINCT g.id)::int AS n ${baseSql}`, [a1, a2]);
      const total = totalRes.rows[0].n;

      const rowsRes = await query(
        `SELECT DISTINCT g.id, g.data, g.titolo, g.importo, g.ribasso, g.soa_val,
                s.ragione_sociale AS stazione, av.ragione_sociale AS vincitore
         ${baseSql}
         ORDER BY ${orderBy} ${sortDir}
         LIMIT $3 OFFSET $4`,
        [a1, a2, pageSize, (page - 1) * pageSize]
      );

      return {
        azienda1: azMap[a1] || null,
        azienda2: azMap[a2] || null,
        tipo_risultati: tRis,
        tipo_esiti: tEsiti,
        esiti: rowsRes.rows,
        total,
        page,
        page_size: pageSize,
      };
    } catch (err) {
      fastify.log.error(err, 'Avvalimenti esiti error');
      return reply.status(500).send({ error: 'Errore ricerca esiti avvalimento', details: err.message });
    }
  });
}
