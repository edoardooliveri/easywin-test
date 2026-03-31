import { query } from '../db/pool.js';

export default async function apiPubblicaRoutes(fastify, opts) {

  // ============================================================
  // API KEY AUTHENTICATION MIDDLEWARE
  // ============================================================

  /**
   * Hook to validate API key from X-API-Key header
   */
  const validateApiKey = async (request, reply) => {
    try {
      const apiKey = request.headers['x-api-key'];

      if (!apiKey) {
        return reply.status(401).send({ error: 'API key mancante (header X-API-Key)' });
      }

      // Get API key from database
      const result = await query(
        `SELECT chiave, id_utente, attiva, limiti_giornalieri, utilizzi_oggi, data_scadenza
         FROM api_keys
         WHERE chiave = $1 LIMIT 1`,
        [apiKey]
      );

      if (result.rows.length === 0) {
        return reply.status(401).send({ error: 'API key non valida' });
      }

      const apiKeyRecord = result.rows[0];

      // Check if active
      if (apiKeyRecord.attiva !== true) {
        return reply.status(403).send({ error: 'API key disabilitata' });
      }

      // Check expiration date
      if (apiKeyRecord.data_scadenza && new Date(apiKeyRecord.data_scadenza) < new Date()) {
        return reply.status(403).send({ error: 'API key scaduta' });
      }

      // Check rate limit
      if (apiKeyRecord.utilizzi_oggi >= apiKeyRecord.limiti_giornalieri) {
        return reply.status(429).send({ error: 'Limite giornaliero raggiunto' });
      }

      // Attach API key info to request
      request.apiKey = {
        chiave: apiKeyRecord.chiave,
        id_utente: apiKeyRecord.id_utente,
        limiti_giornalieri: apiKeyRecord.limiti_giornalieri,
        utilizzi_oggi: apiKeyRecord.utilizzi_oggi
      };
    } catch (err) {
      fastify.log.error({ err: err.message }, 'API key validation error');
      return reply.status(500).send({ error: 'Errore nella validazione dell\'API key' });
    }
  };

  /**
   * Hook to increment API key usage
   */
  const incrementApiKeyUsage = async (request, reply) => {
    try {
      if (request.apiKey) {
        await query(
          `UPDATE api_keys SET utilizzi_oggi = utilizzi_oggi + 1 WHERE chiave = $1`,
          [request.apiKey.chiave]
        );
      }
    } catch (err) {
      fastify.log.error({ err: err.message }, 'API key usage increment error');
    }
  };

  // ============================================================
  // BANDI ENDPOINTS
  // ============================================================

  /**
   * GET /api/v1/bandi
   * List bandi with filters
   */
  fastify.get('/bandi', { preHandler: [validateApiKey, incrementApiKeyUsage] }, async (request, reply) => {
    try {
      const {
        page = 1,
        limit = 20,
        provincia,
        id_soa,
        tipologia,
        data_da,
        data_a,
        importo_min,
        importo_max,
        sort = 'DataPubblicazione',
        order = 'DESC'
      } = request.query;

      const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);
      const conditions = ['b."Abilitato" = true', 'b."Annullato" = false'];
      const params = [];
      let paramIdx = 1;

      if (provincia) {
        conditions.push(`b."Regione" = $${paramIdx}`);
        params.push(provincia);
        paramIdx++;
      }

      if (id_soa) {
        conditions.push(`b."id_soa" = $${paramIdx}`);
        params.push(id_soa);
        paramIdx++;
      }

      if (tipologia) {
        conditions.push(`b."id_tipologia" = $${paramIdx}`);
        params.push(tipologia);
        paramIdx++;
      }

      if (data_da) {
        conditions.push(`b."DataPubblicazione" >= $${paramIdx}`);
        params.push(data_da);
        paramIdx++;
      }

      if (data_a) {
        conditions.push(`b."DataPubblicazione" <= $${paramIdx}`);
        params.push(data_a);
        paramIdx++;
      }

      if (importo_min) {
        conditions.push(`b."ImportoSO" >= $${paramIdx}`);
        params.push(importo_min);
        paramIdx++;
      }

      if (importo_max) {
        conditions.push(`b."ImportoSO" <= $${paramIdx}`);
        params.push(importo_max);
        paramIdx++;
      }

      const whereClause = `WHERE ${conditions.join(' AND ')}`;

      // Validate sort column
      const allowedSorts = ['DataPubblicazione', 'Titolo', 'ImportoSO'];
      const sortCol = allowedSorts.includes(sort) ? `b."${sort}"` : 'b."DataPubblicazione"';
      const sortOrder = order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

      // Count total
      const countResult = await query(
        `SELECT COUNT(*) as total FROM bandi b ${whereClause}`,
        params
      );
      const total = parseInt(countResult.rows[0].total);

      // Get paginated results
      const result = await query(
        `SELECT
          b."id_bando" AS id,
          b."Titolo" AS titolo,
          b."CodiceCIG" AS codice_cig,
          b."DataPubblicazione" AS data_pubblicazione,
          b."ImportoSO" AS importo,
          b."Regione" AS provincia,
          COALESCE(s."Nome", b."Stazione") AS stazione,
          b."id_tipologia" AS id_tipologia,
          b."id_soa" AS id_soa
         FROM bandi b
         LEFT JOIN stazioni s ON b."id_stazione" = s."id"
         ${whereClause}
         ORDER BY ${sortCol} ${sortOrder}
         LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
        [...params, limit, offset]
      );

      return {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        total_pages: Math.ceil(total / limit),
        bandi: result.rows
      };
    } catch (err) {
      fastify.log.error({ err: err.message }, 'API bandi list error');
      return reply.status(500).send({ error: 'Errore nel caricamento dei bandi' });
    }
  });

  /**
   * GET /api/v1/bandi/:id
   * Single bando detail
   */
  fastify.get('/bandi/:id', { preHandler: [validateApiKey, incrementApiKeyUsage] }, async (request, reply) => {
    try {
      const { id } = request.params;

      const result = await query(
        `SELECT
          b."id_bando" AS id,
          b."Titolo" AS titolo,
          b."CodiceCIG" AS codice_cig,
          b."CodiceCUP" AS codice_cup,
          b."DataPubblicazione" AS data_pubblicazione,
          b."DataOfferta" AS data_offerta,
          b."DataApertura" AS data_apertura,
          b."ImportoSO" AS importo,
          b."Regione" AS provincia,
          b."Stazione" AS stazione,
          b."id_tipologia" AS id_tipologia,
          b."id_soa" AS id_soa,
          b."Descrizione" AS descrizione
         FROM bandi b
         WHERE b."id_bando" = $1 AND b."Abilitato" = true AND b."Annullato" = false
         LIMIT 1`,
        [id]
      );

      if (result.rows.length === 0) {
        return reply.status(404).send({ error: 'Bando non trovato' });
      }

      return result.rows[0];
    } catch (err) {
      fastify.log.error({ err: err.message }, 'API bandi detail error');
      return reply.status(500).send({ error: 'Errore nel caricamento del bando' });
    }
  });

  // ============================================================
  // ESITI ENDPOINTS
  // ============================================================

  /**
   * GET /api/v1/esiti
   * List esiti with filters
   */
  fastify.get('/esiti', { preHandler: [validateApiKey, incrementApiKeyUsage] }, async (request, reply) => {
    try {
      const {
        page = 1,
        limit = 20,
        provincia,
        id_soa,
        data_da,
        data_a,
        importo_min,
        importo_max,
        sort = 'Data',
        order = 'DESC'
      } = request.query;

      const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);
      const conditions = ['g."Abilitato" = true', 'g."Annullato" = false'];
      const params = [];
      let paramIdx = 1;

      if (provincia) {
        conditions.push(`g."Regione" = $${paramIdx}`);
        params.push(provincia);
        paramIdx++;
      }

      if (id_soa) {
        conditions.push(`g."id_soa" = $${paramIdx}`);
        params.push(id_soa);
        paramIdx++;
      }

      if (data_da) {
        conditions.push(`g."Data" >= $${paramIdx}`);
        params.push(data_da);
        paramIdx++;
      }

      if (data_a) {
        conditions.push(`g."Data" <= $${paramIdx}`);
        params.push(data_a);
        paramIdx++;
      }

      if (importo_min) {
        conditions.push(`g."Importo" >= $${paramIdx}`);
        params.push(importo_min);
        paramIdx++;
      }

      if (importo_max) {
        conditions.push(`g."Importo" <= $${paramIdx}`);
        params.push(importo_max);
        paramIdx++;
      }

      const whereClause = `WHERE ${conditions.join(' AND ')}`;

      // Count total
      const countResult = await query(
        `SELECT COUNT(*) as total FROM gare g ${whereClause}`,
        params
      );
      const total = parseInt(countResult.rows[0].total);

      // Validate sort column
      const allowedSorts = ['Data', 'Titolo', 'Importo'];
      const sortCol = allowedSorts.includes(sort) ? `g."${sort}"` : 'g."Data"';
      const sortOrder = order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

      // Get paginated results
      const result = await query(
        `SELECT
          g."id" AS id,
          g."Titolo" AS titolo,
          g."Data" AS data,
          g."Importo" AS importo,
          g."Regione" AS provincia,
          COALESCE(s."Nome", g."Stazione") AS stazione,
          g."id_soa" AS id_soa,
          (SELECT COUNT(*) FROM dettagliogara WHERE "id_gara" = g."id") AS n_partecipanti
         FROM gare g
         LEFT JOIN stazioni s ON g."id_stazione" = s."id"
         ${whereClause}
         ORDER BY ${sortCol} ${sortOrder}
         LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
        [...params, limit, offset]
      );

      return {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        total_pages: Math.ceil(total / limit),
        esiti: result.rows
      };
    } catch (err) {
      fastify.log.error({ err: err.message }, 'API esiti list error');
      return reply.status(500).send({ error: 'Errore nel caricamento degli esiti' });
    }
  });

  /**
   * GET /api/v1/esiti/:id
   * Single esito detail with graduatoria
   */
  fastify.get('/esiti/:id', { preHandler: [validateApiKey, incrementApiKeyUsage] }, async (request, reply) => {
    try {
      const { id } = request.params;

      const garaResult = await query(
        `SELECT
          g."id" AS id,
          g."Titolo" AS titolo,
          g."Data" AS data,
          g."Importo" AS importo,
          g."Regione" AS provincia,
          g."Stazione" AS stazione,
          g."NPartecipanti" AS n_partecipanti,
          g."Ribasso" AS ribasso_medio,
          g."id_soa" AS id_soa
         FROM gare g
         WHERE g."id" = $1 AND g."Abilitato" = true AND g."Annullato" = false
         LIMIT 1`,
        [id]
      );

      if (garaResult.rows.length === 0) {
        return reply.status(404).send({ error: 'Esito non trovato' });
      }

      const gara = garaResult.rows[0];

      // Get graduatoria
      const graduatoriaResult = await query(
        `SELECT
          dg."Posizione" AS posizione,
          dg."RagioneSociale" AS ragione_sociale,
          dg."Ribasso" AS ribasso,
          dg."Vincitrice" AS vincitrice,
          dg."Esclusa" AS esclusa,
          dg."Anomala" AS anomala
         FROM dettagliogara dg
         WHERE dg."id_gara" = $1
         ORDER BY dg."Posizione" ASC`,
        [id]
      );

      return {
        ...gara,
        graduatoria: graduatoriaResult.rows
      };
    } catch (err) {
      fastify.log.error({ err: err.message }, 'API esiti detail error');
      return reply.status(500).send({ error: 'Errore nel caricamento dell\'esito' });
    }
  });

  // ============================================================
  // AZIENDE ENDPOINTS
  // ============================================================

  /**
   * GET /api/v1/aziende
   * List/search aziende
   */
  fastify.get('/aziende', { preHandler: [validateApiKey, incrementApiKeyUsage] }, async (request, reply) => {
    try {
      const {
        page = 1,
        limit = 20,
        search,
        sort = 'RagioneSociale',
        order = 'ASC'
      } = request.query;

      const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);
      const conditions = ['a."Abilitato" = true', 'a."Annullato" = false'];
      const params = [];
      let paramIdx = 1;

      if (search) {
        conditions.push(`(a."RagioneSociale" ILIKE $${paramIdx} OR a."PartitaIva" ILIKE $${paramIdx})`);
        params.push(`%${search}%`);
        paramIdx++;
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      // Count total
      const countResult = await query(
        `SELECT COUNT(*) as total FROM aziende a ${whereClause}`,
        params
      );
      const total = parseInt(countResult.rows[0].total);

      // Get results
      const result = await query(
        `SELECT
          a."id" AS id,
          a."RagioneSociale" AS ragione_sociale,
          a."PartitaIva" AS partita_iva,
          a."Provincia" AS provincia,
          a."Citta" AS citta,
          a."Email" AS email
         FROM aziende a
         ${whereClause}
         ORDER BY a."${sort}" ${order.toUpperCase()}
         LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
        [...params, limit, offset]
      );

      return {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        total_pages: Math.ceil(total / limit),
        aziende: result.rows
      };
    } catch (err) {
      fastify.log.error({ err: err.message }, 'API aziende list error');
      return reply.status(500).send({ error: 'Errore nel caricamento delle aziende' });
    }
  });

  /**
   * GET /api/v1/aziende/:id
   * Azienda detail with statistics
   */
  fastify.get('/aziende/:id', { preHandler: [validateApiKey, incrementApiKeyUsage] }, async (request, reply) => {
    try {
      const { id } = request.params;

      const result = await query(
        `SELECT
          a."id" AS id,
          a."RagioneSociale" AS ragione_sociale,
          a."PartitaIva" AS partita_iva,
          a."CodiceFiscale" AS codice_fiscale,
          a."Provincia" AS provincia,
          a."Citta" AS citta,
          a."Indirizzo" AS indirizzo,
          a."Telefono" AS telefono,
          a."Email" AS email
         FROM aziende a
         WHERE a."id" = $1 AND a."Abilitato" = true AND a."Annullato" = false
         LIMIT 1`,
        [id]
      );

      if (result.rows.length === 0) {
        return reply.status(404).send({ error: 'Azienda non trovata' });
      }

      const azienda = result.rows[0];

      // Get statistics
      const statsResult = await query(
        `SELECT
          (SELECT COUNT(*) FROM dettagliogara WHERE id_azienda = $1) AS total_partecipazioni,
          (SELECT COUNT(*) FROM dettagliogara WHERE id_azienda = $1 AND "Vincitrice" = true) AS total_vittorie,
          (SELECT COUNT(*) FROM dettagliogara WHERE id_azienda = $1 AND "Esclusa" = true) AS total_esclusioni,
          (SELECT AVG("Ribasso") FROM dettagliogara WHERE id_azienda = $1) AS ribasso_medio
         FROM aziende WHERE id = $1`,
        [id]
      );

      const stats = statsResult.rows[0];

      return {
        ...azienda,
        statistiche: {
          total_partecipazioni: parseInt(stats.total_partecipazioni || 0),
          total_vittorie: parseInt(stats.total_vittorie || 0),
          total_esclusioni: parseInt(stats.total_esclusioni || 0),
          ribasso_medio: stats.ribasso_medio ? parseFloat(stats.ribasso_medio).toFixed(3) : null
        }
      };
    } catch (err) {
      fastify.log.error({ err: err.message }, 'API azienda detail error');
      return reply.status(500).send({ error: 'Errore nel caricamento dell\'azienda' });
    }
  });

  // ============================================================
  // STAZIONI ENDPOINTS
  // ============================================================

  /**
   * GET /api/v1/stazioni
   * List/search stazioni
   */
  fastify.get('/stazioni', { preHandler: [validateApiKey, incrementApiKeyUsage] }, async (request, reply) => {
    try {
      const {
        page = 1,
        limit = 20,
        search,
        sort = 'Nome',
        order = 'ASC'
      } = request.query;

      const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);
      const conditions = ['s."Abilitato" = true', 's."Annullato" = false'];
      const params = [];
      let paramIdx = 1;

      if (search) {
        conditions.push(`(s."Nome" ILIKE $${paramIdx} OR s."CodiceEnte" ILIKE $${paramIdx})`);
        params.push(`%${search}%`);
        paramIdx++;
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      // Count total
      const countResult = await query(
        `SELECT COUNT(*) as total FROM stazioni s ${whereClause}`,
        params
      );
      const total = parseInt(countResult.rows[0].total);

      // Get results
      const result = await query(
        `SELECT
          s."id" AS id,
          s."Nome" AS nome,
          s."CodiceEnte" AS codice_ente,
          s."Provincia" AS provincia,
          s."Citta" AS citta,
          s."Regione" AS regione,
          s."Email" AS email
         FROM stazioni s
         ${whereClause}
         ORDER BY s."${sort}" ${order.toUpperCase()}
         LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
        [...params, limit, offset]
      );

      return {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        total_pages: Math.ceil(total / limit),
        stazioni: result.rows
      };
    } catch (err) {
      fastify.log.error({ err: err.message }, 'API stazioni list error');
      return reply.status(500).send({ error: 'Errore nel caricamento delle stazioni' });
    }
  });

  /**
   * GET /api/v1/stazioni/:id
   * Stazione detail
   */
  fastify.get('/stazioni/:id', { preHandler: [validateApiKey, incrementApiKeyUsage] }, async (request, reply) => {
    try {
      const { id } = request.params;

      const result = await query(
        `SELECT
          s."id" AS id,
          s."Nome" AS nome,
          s."CodiceEnte" AS codice_ente,
          s."Provincia" AS provincia,
          s."Citta" AS citta,
          s."Regione" AS regione,
          s."Indirizzo" AS indirizzo,
          s."Telefono" AS telefono,
          s."Email" AS email,
          s."Latitudine" AS latitudine,
          s."Longitudine" AS longitudine
         FROM stazioni s
         WHERE s."id" = $1 AND s."Abilitato" = true AND s."Annullato" = false
         LIMIT 1`,
        [id]
      );

      if (result.rows.length === 0) {
        return reply.status(404).send({ error: 'Stazione non trovata' });
      }

      return result.rows[0];
    } catch (err) {
      fastify.log.error({ err: err.message }, 'API stazione detail error');
      return reply.status(500).send({ error: 'Errore nel caricamento della stazione' });
    }
  });

}
