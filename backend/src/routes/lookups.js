import { query } from '../db/pool.js';

export default async function lookupRoutes(fastify, opts) {

  // GET /api/lookups/regioni
  fastify.get('/regioni', async () => {
    const result = await query(
      'SELECT id, nome, codice_istat AS posizione FROM regioni ORDER BY nome'
    );
    return result.rows;
  });

  // GET /api/lookups/province?regione=id
  fastify.get('/province', async (request) => {
    const { regione } = request.query;
    let sql = `SELECT p.id AS id, p.nome AS nome, p.sigla AS sigla,
               r.nome AS regione
               FROM province p LEFT JOIN regioni r ON p.id_regione = r.id`;
    const params = [];
    if (regione) {
      sql += ' WHERE p.id_regione = $1';
      params.push(parseInt(regione));
    }
    sql += ' ORDER BY p.nome';
    const result = await query(sql, params);
    return result.rows;
  });

  // GET /api/lookups/stazioni?search=term
  fastify.get('/stazioni', async (request) => {
    const { search, limit = 20 } = request.query;
    if (search && search.length >= 2) {
      const result = await query(
        `SELECT id, nome AS nome, citta
         FROM stazioni WHERE attivo = true AND nome ILIKE $1
         ORDER BY nome LIMIT $2`,
        [`%${search}%`, parseInt(limit)]
      );
      return result.rows;
    }
    const result = await query(
      `SELECT id, nome AS nome, citta
       FROM stazioni WHERE attivo = true ORDER BY nome LIMIT $1`,
      [parseInt(limit)]
    );
    return result.rows;
  });

  // GET /api/lookups/soa
  fastify.get('/soa', async () => {
    const result = await query(
      'SELECT id, codice, descrizione, tipo FROM soa ORDER BY codice'
    );
    return result.rows;
  });

  // GET /api/lookups/tipologie-gare
  fastify.get('/tipologie-gare', async () => {
    const result = await query(
      `SELECT "id" AS id, "nome" AS nome
       FROM tipologia_gare WHERE "attivo" = true ORDER BY "nome"`
    );
    return result.rows;
  });

  // GET /api/lookups/tipologie-bandi
  fastify.get('/tipologie-bandi', async () => {
    const result = await query(
      `SELECT id, nome
       FROM tipologia_bandi WHERE attivo = true ORDER BY nome`
    );
    return result.rows;
  });

  // GET /api/lookups/criteri
  fastify.get('/criteri', async () => {
    const result = await query(
      `SELECT id, nome
       FROM criteri WHERE attivo = true ORDER BY nome`
    );
    return result.rows;
  });

  // GET /api/lookups/piattaforme
  fastify.get('/piattaforme', async () => {
    const result = await query(
      'SELECT id, nome, url FROM piattaforme ORDER BY nome'
    );
    return result.rows;
  });

  // GET /api/lookups/stats - Statistiche generali
  fastify.get('/stats', async () => {
    const result = await query(`
      SELECT
        (SELECT COUNT(*) FROM bandi) AS totale_bandi,
        (SELECT COUNT(*) FROM gare WHERE annullato = false) AS totale_gare,
        (SELECT COUNT(*) FROM aziende WHERE attivo = true) AS totale_aziende,
        (SELECT COUNT(*) FROM stazioni WHERE attivo = true) AS totale_stazioni,
        (SELECT COUNT(*) FROM simulazioni) AS totale_simulazioni,
        (SELECT COUNT(*) FROM users) AS totale_utenti
    `);
    return result.rows[0];
  });
}
