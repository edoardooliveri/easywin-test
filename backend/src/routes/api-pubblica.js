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
      const conditions = ['b.annullato IS NOT TRUE', 'b.annullato IS NOT TRUE'];
      const params = [];
      let paramIdx = 1;

      if (provincia) {
        conditions.push(`b.regione = $${paramIdx}`);
        params.push(provincia);
        paramIdx++;
      }

      if (id_soa) {
        conditions.push(`b.id_soa = $${paramIdx}`);
        params.push(id_soa);
        paramIdx++;
      }

      if (tipologia) {
        conditions.push(`b.id_tipologia = $${paramIdx}`);
        params.push(tipologia);
        paramIdx++;
      }

      if (data_da) {
        conditions.push(`b.data_pubblicazione >= $${paramIdx}`);
        params.push(data_da);
        paramIdx++;
      }

      if (data_a) {
        conditions.push(`b.data_pubblicazione <= $${paramIdx}`);
        params.push(data_a);
        paramIdx++;
      }

      if (importo_min) {
        conditions.push(`b.importo_so >= $${paramIdx}`);
        params.push(importo_min);
        paramIdx++;
      }

      if (importo_max) {
        conditions.push(`b.importo_so <= $${paramIdx}`);
        params.push(importo_max);
        paramIdx++;
      }

      const whereClause = `WHERE ${conditions.join(' AND ')}`;

      // Validate sort column
      const allowedSorts = ['data_pubblicazione', 'titolo', 'importo_so'];
      const sortColMap = { 'DataPubblicazione': 'b.data_pubblicazione', 'Titolo': 'b.titolo', 'ImportoSO': 'b.importo_so' };
      const sortCol = sortColMap[sort] || 'b.data_pubblicazione';
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
          b.id_bando AS id,
          b.titolo AS titolo,
          b.codice_cig AS codice_cig,
          b.data_pubblicazione AS data_pubblicazione,
          b.importo_so AS importo,
          b.regione AS provincia,
          COALESCE(s.nome, b.stazione) AS stazione,
          b.id_tipologia AS id_tipologia,
          b.id_soa AS id_soa
         FROM bandi b
         LEFT JOIN stazioni s ON b.id_stazione = s.id
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
          b.id_bando AS id,
          b.titolo AS titolo,
          b.codice_cig AS codice_cig,
          b.codice_cup AS codice_cup,
          b.data_pubblicazione AS data_pubblicazione,
          b.data_offerta AS data_offerta,
          b.data_apertura AS data_apertura,
          b.importo_so AS importo,
          b.regione AS provincia,
          b.stazione AS stazione,
          b.id_tipologia AS id_tipologia,
          b.id_soa AS id_soa,
          b.descrizione AS descrizione
         FROM bandi b
         WHERE b.id_bando = $1 AND b.annullato IS NOT TRUE
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
      const conditions = ['g.abilitato = true', 'g.annullato = false'];
      const params = [];
      let paramIdx = 1;

      if (provincia) {
        conditions.push(`g.regione = $${paramIdx}`);
        params.push(provincia);
        paramIdx++;
      }

      if (id_soa) {
        conditions.push(`g.id_soa = $${paramIdx}`);
        params.push(id_soa);
        paramIdx++;
      }

      if (data_da) {
        conditions.push(`g.data >= $${paramIdx}`);
        params.push(data_da);
        paramIdx++;
      }

      if (data_a) {
        conditions.push(`g.data <= $${paramIdx}`);
        params.push(data_a);
        paramIdx++;
      }

      if (importo_min) {
        conditions.push(`g.importo >= $${paramIdx}`);
        params.push(importo_min);
        paramIdx++;
      }

      if (importo_max) {
        conditions.push(`g.importo <= $${paramIdx}`);
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
      const allowedSorts = ['data', 'titolo', 'importo'];
      const sortColMap = { 'Data': 'g.data', 'Titolo': 'g.titolo', 'Importo': 'g.importo' };
      const sortCol = sortColMap[sort] || 'g.data';
      const sortOrder = order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

      // Get paginated results
      const result = await query(
        `SELECT
          g.id AS id,
          g.titolo AS titolo,
          g.data AS data,
          g.importo AS importo,
          g.regione AS provincia,
          COALESCE(s.nome, g.stazione) AS stazione,
          g.id_soa AS id_soa,
          (SELECT COUNT(*) FROM dettaglio_gara WHERE id_gara = g.id) AS n_partecipanti
         FROM gare g
         LEFT JOIN stazioni s ON g.id_stazione = s.id
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
          g.id AS id,
          g.titolo AS titolo,
          g.data AS data,
          g.importo AS importo,
          g.regione AS provincia,
          g.stazione AS stazione,
          g.n_partecipanti AS n_partecipanti,
          g.ribasso AS ribasso_medio,
          g.id_soa AS id_soa
         FROM gare g
         WHERE g.id = $1 AND g.annullato IS NOT TRUE
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
          dg.posizione AS posizione,
          dg.ragione_sociale AS ragione_sociale,
          dg.ribasso AS ribasso,
          dg.vincitrice AS vincitrice,
          dg.esclusa AS esclusa,
          dg.anomala AS anomala
         FROM dettaglio_gara dg
         WHERE dg.id_gara = $1
         ORDER BY dg.posizione ASC`,
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
      const conditions = ['a.abilitato = true', 'a.annullato = false'];
      const params = [];
      let paramIdx = 1;

      if (search) {
        conditions.push(`(a.ragione_sociale ILIKE $${paramIdx} OR a.partita_iva ILIKE $${paramIdx})`);
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
      const sortColMap = { 'RagioneSociale': 'a.ragione_sociale', 'PartitaIva': 'a.partita_iva' };
      const sortCol = sortColMap[sort] || 'a.ragione_sociale';
      const result = await query(
        `SELECT
          a.id AS id,
          a.ragione_sociale AS ragione_sociale,
          a.partita_iva AS partita_iva,
          a.provincia AS provincia,
          a.citta AS citta,
          a.email AS email
         FROM aziende a
         ${whereClause}
         ORDER BY ${sortCol} ${order.toUpperCase()}
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
          a.id AS id,
          a.ragione_sociale AS ragione_sociale,
          a.partita_iva AS partita_iva,
          a.codice_fiscale AS codice_fiscale,
          a.provincia AS provincia,
          a.citta AS citta,
          a.indirizzo AS indirizzo,
          a.telefono AS telefono,
          a.email AS email
         FROM aziende a
         WHERE a.id = $1 AND a.attivo = true
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
          (SELECT COUNT(*) FROM dettaglio_gara WHERE id_azienda = $1) AS total_partecipazioni,
          (SELECT COUNT(*) FROM dettaglio_gara WHERE id_azienda = $1 AND vincitrice = true) AS total_vittorie,
          (SELECT COUNT(*) FROM dettaglio_gara WHERE id_azienda = $1 AND esclusa = true) AS total_esclusioni,
          (SELECT AVG(ribasso) FROM dettaglio_gara WHERE id_azienda = $1) AS ribasso_medio
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
      const conditions = ['s.abilitato = true', 's.annullato = false'];
      const params = [];
      let paramIdx = 1;

      if (search) {
        conditions.push(`(s.nome ILIKE $${paramIdx} OR s.codice_ente ILIKE $${paramIdx})`);
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
      const sortColMap = { 'Nome': 's.nome', 'CodiceEnte': 's.codice_ente' };
      const sortCol = sortColMap[sort] || 's.nome';
      const result = await query(
        `SELECT
          s.id AS id,
          s.nome AS nome,
          s.codice_ente AS codice_ente,
          s.provincia AS provincia,
          s.citta AS citta,
          s.regione AS regione,
          s.email AS email
         FROM stazioni s
         ${whereClause}
         ORDER BY ${sortCol} ${order.toUpperCase()}
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
          s.id AS id,
          s.nome AS nome,
          s.codice_ente AS codice_ente,
          s.provincia AS provincia,
          s.citta AS citta,
          s.regione AS regione,
          s.indirizzo AS indirizzo,
          s.telefono AS telefono,
          s.email AS email,
          s.latitudine AS latitudine,
          s.longitudine AS longitudine
         FROM stazioni s
         WHERE s.id = $1 AND s.attivo = true
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
