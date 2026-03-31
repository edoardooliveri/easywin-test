import { query } from '../db/pool.js';

export default async function lookupRoutes(fastify, opts) {

  // GET /api/lookups/regioni
  fastify.get('/regioni', async () => {
    const result = await query(
      'SELECT "id_regione" AS id, "Regione" AS nome, "Posizione" AS posizione FROM regioni ORDER BY "Regione"'
    );
    return result.rows;
  });

  // GET /api/lookups/province?regione=id
  fastify.get('/province', async (request) => {
    const { regione } = request.query;
    let sql = `SELECT p."id_provincia" AS id, p."Provincia" AS nome, p."siglaprovincia" AS sigla,
               r."Regione" AS regione
               FROM province p LEFT JOIN regioni r ON p."id_regione" = r."id_regione"`;
    const params = [];
    if (regione) {
      sql += ' WHERE p."id_regione" = $1';
      params.push(parseInt(regione));
    }
    sql += ' ORDER BY p."Provincia"';
    const result = await query(sql, params);
    return result.rows;
  });

  // GET /api/lookups/stazioni?search=term
  fastify.get('/stazioni', async (request) => {
    const { search, limit = 20 } = request.query;
    if (search && search.length >= 2) {
      const result = await query(
        `SELECT "id" AS id, "RagioneSociale" AS nome, "Città" AS citta
         FROM stazioni WHERE "eliminata" = false AND "RagioneSociale" ILIKE $1
         ORDER BY "RagioneSociale" LIMIT $2`,
        [`%${search}%`, parseInt(limit)]
      );
      return result.rows;
    }
    const result = await query(
      `SELECT "id" AS id, "RagioneSociale" AS nome, "Città" AS citta
       FROM stazioni WHERE "eliminata" = false ORDER BY "RagioneSociale" LIMIT $1`,
      [parseInt(limit)]
    );
    return result.rows;
  });

  // GET /api/lookups/soa
  fastify.get('/soa', async () => {
    const result = await query(
      'SELECT "id", "cod" AS codice, "Descrizione" AS descrizione, "Tipologia" AS tipo FROM soa ORDER BY "cod"'
    );
    return result.rows;
  });

  // GET /api/lookups/tipologie-gare
  fastify.get('/tipologie-gare', async () => {
    const result = await query(
      `SELECT "id_tipologia" AS id, "Tipologia" AS nome, "VisibleToUser" AS visibile
       FROM tipologiagare WHERE "VisibleToUser" = true ORDER BY "Tipologia"`
    );
    return result.rows;
  });

  // GET /api/lookups/tipologie-bandi
  fastify.get('/tipologie-bandi', async () => {
    const result = await query(
      `SELECT "id_tipologia_bando" AS id, "Tipologia" AS nome
       FROM tipologiabandi WHERE "VisibleToUser" = true ORDER BY "Tipologia"`
    );
    return result.rows;
  });

  // GET /api/lookups/criteri
  fastify.get('/criteri', async () => {
    const result = await query(
      `SELECT "id_criterio" AS id, "Criterio" AS nome
       FROM criteri WHERE "VisibleToUser" = true ORDER BY "Criterio"`
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
        (SELECT COUNT(*) FROM gare WHERE "eliminata" = false) AS totale_gare,
        (SELECT COUNT(*) FROM aziende WHERE "eliminata" = false) AS totale_aziende,
        (SELECT COUNT(*) FROM stazioni WHERE "eliminata" = false) AS totale_stazioni,
        (SELECT COUNT(*) FROM simulazioni) AS totale_simulazioni,
        (SELECT COUNT(*) FROM users) AS totale_utenti
    `);
    return result.rows[0];
  });
}
