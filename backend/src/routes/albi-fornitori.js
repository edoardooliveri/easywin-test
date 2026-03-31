import { query, transaction } from '../db/pool.js';

export default async function albiFornitoRoutes(fastify) {

  // ╔════════════════════════════════════════════════════════════╗
  // ║                    PUBLIC ENDPOINTS                        ║
  // ╚════════════════════════════════════════════════════════════╝

  // ============================================================
  // GET /api/albi-fornitori - List stazioni con info albo
  // ============================================================
  fastify.get('/', async (request) => {
    const { page = 1, limit = 20, search, regione, has_albo } = request.query;
    const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);
    const conditions = ['s."eliminata" = false'];
    const params = [];
    let idx = 1;

    if (search) {
      conditions.push(`(s."Nome" ILIKE $${idx} OR s."Città" ILIKE $${idx} OR COALESCE(s."RagioneSociale",'') ILIKE $${idx})`);
      params.push(`%${search}%`);
      idx++;
    }
    if (regione) {
      conditions.push(`r."Regione" = $${idx}`);
      params.push(regione);
      idx++;
    }
    if (has_albo === 'true') {
      conditions.push(`EXISTS (SELECT 1 FROM albi_fornitori af WHERE af.id_stazione = s."id" AND af.attivo = true)`);
    }

    const where = conditions.join(' AND ');

    const countRes = await query(
      `SELECT COUNT(*) as total FROM stazioni s
       LEFT JOIN province p ON s."id_provincia" = p."id_provincia"
       LEFT JOIN regioni r ON p."id_regione" = r."id_regione"
       WHERE ${where}`, params
    );

    const dataParams = [...params, parseInt(limit), offset];
    const result = await query(`
      SELECT
        s."id", s."Nome" AS nome_stazione, s."Città" AS citta,
        p."Provincia" AS provincia, p."siglaprovincia" AS sigla_provincia,
        r."Regione" AS regione,
        s."Email" AS email, s."Tel" AS telefono, s."Indirizzo" AS indirizzo,
        (SELECT COUNT(*) FROM bandi b WHERE b."id_stazione" = s."id" AND b."Annullato" = false) AS n_bandi,
        af.id AS albo_id,
        af.nome_albo,
        af.url_albo,
        af.piattaforma,
        af.scadenza_iscrizione,
        CASE WHEN af.id IS NOT NULL THEN true ELSE false END AS has_albo
      FROM stazioni s
      LEFT JOIN province p ON s."id_provincia" = p."id_provincia"
      LEFT JOIN regioni r ON p."id_regione" = r."id_regione"
      LEFT JOIN albi_fornitori af ON af.id_stazione = s."id" AND af.attivo = true
      WHERE ${where}
      ORDER BY af.id IS NOT NULL DESC, s."Nome" ASC
      LIMIT $${idx} OFFSET $${idx + 1}
    `, dataParams);

    return {
      data: result.rows,
      pagination: {
        total: parseInt(countRes.rows[0].total),
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(parseInt(countRes.rows[0].total) / parseInt(limit))
      }
    };
  });

  // ============================================================
  // GET /api/albi-fornitori/stats/overview - Stats
  // ============================================================
  fastify.get('/stats/overview', async () => {
    const stats = await query(`
      SELECT
        COUNT(DISTINCT s."id") AS totale_stazioni,
        COUNT(DISTINCT af.id) AS totale_albi,
        COUNT(DISTINCT af.id) FILTER (WHERE af.attivo = true) AS albi_attivi,
        COUNT(DISTINCT r.id) AS richieste_totali,
        COUNT(DISTINCT r.id) FILTER (WHERE r.stato = 'ricevuta') AS richieste_nuove,
        COUNT(DISTINCT r.id) FILTER (WHERE r.stato = 'in_lavorazione') AS richieste_in_corso,
        COUNT(DISTINCT r.id) FILTER (WHERE r.stato = 'completata') AS richieste_completate
      FROM stazioni s
      LEFT JOIN albi_fornitori af ON af.id_stazione = s."id"
      LEFT JOIN richieste_servizio_albi r ON r.id_albo = af.id
      WHERE s."eliminata" = false
    `);

    const regioniRes = await query(`
      SELECT r."Regione" AS regione,
        COUNT(DISTINCT s."id") AS n_stazioni,
        COUNT(DISTINCT af.id) AS n_albi
      FROM stazioni s
      LEFT JOIN province p ON s."id_provincia" = p."id_provincia"
      LEFT JOIN regioni r ON p."id_regione" = r."id_regione"
      LEFT JOIN albi_fornitori af ON af.id_stazione = s."id" AND af.attivo = true
      WHERE s."eliminata" = false AND r."Regione" IS NOT NULL
      GROUP BY r."Regione"
      ORDER BY n_albi DESC, n_stazioni DESC
    `);

    return { stats: stats.rows[0], copertura_regioni: regioniRes.rows };
  });

  // ============================================================
  // GET /api/albi-fornitori/:id - Dettaglio stazione + albo
  // ============================================================
  fastify.get('/:id', async (request, reply) => {
    const { id } = request.params;

    const staRes = await query(`
      SELECT s."id", s."Nome" AS nome_stazione, s."RagioneSociale" AS ragione_sociale,
        s."Indirizzo", s."Cap" AS cap, s."Città" AS citta, s."Tel" AS telefono,
        s."Email" AS email, s."Pec" AS pec, s."PartitaIva" AS partita_iva,
        s."SitoWeb" AS sito_web,
        p."Provincia" AS provincia, p."siglaprovincia" AS sigla_provincia,
        r."Regione" AS regione
      FROM stazioni s
      LEFT JOIN province p ON s."id_provincia" = p."id_provincia"
      LEFT JOIN regioni r ON p."id_regione" = r."id_regione"
      WHERE s."id" = $1 AND s."eliminata" = false
    `, [id]);

    if (staRes.rows.length === 0) return reply.status(404).send({ error: 'Stazione non trovata' });

    // Get albo info
    const alboRes = await query(`
      SELECT * FROM albi_fornitori WHERE id_stazione = $1 AND attivo = true ORDER BY id DESC LIMIT 1
    `, [id]);

    // Recent bandi
    const bandiRes = await query(`
      SELECT "id_bando" AS id, "Titolo" AS titolo, "DataPubblicazione" AS data_pubblicazione,
        "DataOfferta" AS data_offerta, "CodiceCIG" AS cig,
        COALESCE("ImportoSO",0) + COALESCE("ImportoCO",0) AS importo_totale
      FROM bandi WHERE "id_stazione" = $1 AND "Annullato" = false
      ORDER BY "DataPubblicazione" DESC NULLS LAST LIMIT 20
    `, [id]);

    // Recent esiti (gare aggiudicate)
    const esitiRes = await query(`
      SELECT g."id", g."Titolo" AS titolo, g."Data" AS data_esito,
        g."Importo" AS importo, g."NPartecipanti" AS n_partecipanti
      FROM gare g
      WHERE g."id_stazione" = $1
      ORDER BY g."Data" DESC NULLS LAST LIMIT 10
    `, [id]);

    return {
      stazione: staRes.rows[0],
      albo: alboRes.rows[0] || null,
      bandi_recenti: bandiRes.rows,
      esiti_recenti: esitiRes.rows
    };
  });

  // ╔════════════════════════════════════════════════════════════╗
  // ║              CLIENT ENDPOINTS (authenticated)              ║
  // ╚════════════════════════════════════════════════════════════╝

  // ============================================================
  // POST /api/albi-fornitori/:id/richiedi-servizio - Richiesta servizio
  // ============================================================
  fastify.post('/:id/richiedi-servizio', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params; // stazione id
    const { tipo_richiesta = 'iscrizione', note, id_azienda } = request.body;

    // Find or get albo
    let alboRes = await query('SELECT id FROM albi_fornitori WHERE id_stazione = $1 AND attivo = true LIMIT 1', [id]);

    // If no albo exists for this stazione, create a placeholder
    if (alboRes.rows.length === 0) {
      const staRes = await query('SELECT "Nome" FROM stazioni WHERE "id" = $1', [id]);
      if (staRes.rows.length === 0) return reply.status(404).send({ error: 'Stazione non trovata' });

      alboRes = await query(
        `INSERT INTO albi_fornitori (id_stazione, nome_albo, attivo) VALUES ($1, $2, true) RETURNING id`,
        [id, `Albo Fornitori - ${staRes.rows[0].Nome}`]
      );
    }

    const alboId = alboRes.rows[0].id;

    // Get user's company
    let aziendaId = id_azienda;
    if (!aziendaId && request.user?.id_azienda) {
      aziendaId = request.user.id_azienda;
    }
    if (!aziendaId) {
      return reply.status(400).send({ error: 'Azienda non specificata. Associa prima la tua azienda al profilo.' });
    }

    // Check for existing pending request
    const existing = await query(
      `SELECT id FROM richieste_servizio_albi
       WHERE id_albo = $1 AND id_azienda = $2 AND stato IN ('ricevuta','in_lavorazione')`,
      [alboId, aziendaId]
    );
    if (existing.rows.length > 0) {
      return reply.status(409).send({
        error: 'Hai già una richiesta in corso per questo albo',
        richiesta_id: existing.rows[0].id
      });
    }

    const result = await query(`
      INSERT INTO richieste_servizio_albi
        (id_albo, id_azienda, username, tipo_richiesta, stato, note)
      VALUES ($1, $2, $3, $4, 'ricevuta', $5)
      RETURNING *
    `, [alboId, aziendaId, request.user?.username || request.user?.email, tipo_richiesta, note]);

    return reply.status(201).send({
      success: true,
      message: 'Richiesta inviata! Il team EasyWin la prenderà in carico.',
      richiesta: result.rows[0]
    });
  });

  // ============================================================
  // GET /api/albi-fornitori/mie-richieste - Le mie richieste servizio
  // ============================================================
  fastify.get('/mie-richieste/lista', { preHandler: [fastify.authenticate] }, async (request) => {
    const username = request.user?.username || request.user?.email;
    const idAzienda = request.user?.id_azienda;

    const conditions = [];
    const params = [];
    let idx = 1;

    if (idAzienda) {
      conditions.push(`r.id_azienda = $${idx}`);
      params.push(idAzienda);
      idx++;
    } else if (username) {
      conditions.push(`r.username = $${idx}`);
      params.push(username);
      idx++;
    }

    if (conditions.length === 0) return { data: [] };

    const result = await query(`
      SELECT r.*, af.nome_albo, s."Nome" AS stazione_nome, s."Città" AS stazione_citta
      FROM richieste_servizio_albi r
      JOIN albi_fornitori af ON r.id_albo = af.id
      JOIN stazioni s ON af.id_stazione = s."id"
      WHERE ${conditions.join(' AND ')}
      ORDER BY r.data_richiesta DESC
    `, params);

    return { data: result.rows };
  });

  // ============================================================
  // GET /api/albi-fornitori/check-iscrizione/:stazioneId/:aziendaId
  // ============================================================
  fastify.get('/check-iscrizione/:stazioneId/:aziendaId', async (request) => {
    const { stazioneId, aziendaId } = request.params;

    const result = await query(`
      SELECT ia.*, af.nome_albo, af.documenti_richiesti, af.procedura_iscrizione
      FROM iscrizioni_albo ia
      JOIN albi_fornitori af ON ia.id_albo = af.id
      WHERE af.id_stazione = $1 AND ia.id_azienda = $2
      ORDER BY ia.data_iscrizione DESC NULLS LAST LIMIT 1
    `, [stazioneId, aziendaId]);

    if (result.rows.length === 0) {
      return { iscritto: false, stato: 'non_verificato', messaggio: 'Nessuna iscrizione trovata per questa azienda' };
    }

    return { iscritto: result.rows[0].iscritto, ...result.rows[0] };
  });

  // ╔════════════════════════════════════════════════════════════╗
  // ║              ADMIN ENDPOINTS (authenticated)               ║
  // ╚════════════════════════════════════════════════════════════╝

  // ============================================================
  // GET /api/albi-fornitori/admin/dashboard - Dashboard admin
  // ============================================================
  fastify.get('/admin/dashboard', { preHandler: [fastify.authenticate] }, async () => {
    const stats = await query(`
      SELECT
        (SELECT COUNT(*) FROM albi_fornitori WHERE attivo = true) AS albi_attivi,
        (SELECT COUNT(*) FROM albi_fornitori WHERE verificato = true) AS albi_verificati,
        (SELECT COUNT(*) FROM richieste_servizio_albi WHERE stato = 'ricevuta') AS richieste_nuove,
        (SELECT COUNT(*) FROM richieste_servizio_albi WHERE stato = 'in_lavorazione') AS richieste_in_corso,
        (SELECT COUNT(*) FROM richieste_servizio_albi WHERE stato = 'completata') AS richieste_completate,
        (SELECT COUNT(*) FROM iscrizioni_albo WHERE iscritto = true) AS iscrizioni_attive
    `);

    // Recent requests
    const recentReqs = await query(`
      SELECT r.*, af.nome_albo, s."Nome" AS stazione_nome,
        a."RagioneSociale" AS azienda_nome
      FROM richieste_servizio_albi r
      JOIN albi_fornitori af ON r.id_albo = af.id
      JOIN stazioni s ON af.id_stazione = s."id"
      LEFT JOIN aziende a ON r.id_azienda = a."id"
      ORDER BY r.data_richiesta DESC LIMIT 20
    `);

    return { stats: stats.rows[0], richieste_recenti: recentReqs.rows };
  });

  // ============================================================
  // POST /api/albi-fornitori/admin/albo - Crea/aggiorna albo per stazione
  // ============================================================
  fastify.post('/admin/albo', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const {
      id_stazione, nome_albo, url_albo, piattaforma,
      scadenza_iscrizione, rinnovo_automatico, frequenza_rinnovo,
      documenti_richiesti, procedura_iscrizione, note,
      categorie_merceologiche, categorie_soa
    } = request.body;

    if (!id_stazione) return reply.status(400).send({ error: 'id_stazione obbligatorio' });

    // Check if albo exists for this stazione
    const existing = await query(
      'SELECT id FROM albi_fornitori WHERE id_stazione = $1 AND attivo = true', [id_stazione]
    );

    let result;
    if (existing.rows.length > 0) {
      // Update
      result = await query(`
        UPDATE albi_fornitori SET
          nome_albo = COALESCE($2, nome_albo),
          url_albo = $3, piattaforma = $4,
          scadenza_iscrizione = $5, rinnovo_automatico = $6, frequenza_rinnovo = $7,
          documenti_richiesti = $8, procedura_iscrizione = $9, note = $10,
          categorie_merceologiche = $11, categorie_soa = $12,
          ultimo_aggiornamento = NOW(), updated_at = NOW(),
          verificato = true, verificato_da = $13, verificato_il = NOW()
        WHERE id = $14
        RETURNING *
      `, [
        id_stazione, nome_albo, url_albo, piattaforma,
        scadenza_iscrizione, rinnovo_automatico || false, frequenza_rinnovo,
        JSON.stringify(documenti_richiesti || []), procedura_iscrizione, note,
        categorie_merceologiche || [], categorie_soa || [],
        request.user?.username, existing.rows[0].id
      ]);
    } else {
      // Create
      const staRes = await query('SELECT "Nome" FROM stazioni WHERE "id" = $1', [id_stazione]);
      result = await query(`
        INSERT INTO albi_fornitori (
          id_stazione, nome_albo, url_albo, piattaforma,
          scadenza_iscrizione, rinnovo_automatico, frequenza_rinnovo,
          documenti_richiesti, procedura_iscrizione, note,
          categorie_merceologiche, categorie_soa,
          attivo, verificato, verificato_da, verificato_il, ultimo_aggiornamento
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true,true,$13,NOW(),NOW())
        RETURNING *
      `, [
        id_stazione, nome_albo || `Albo Fornitori - ${staRes.rows[0]?.Nome || ''}`,
        url_albo, piattaforma,
        scadenza_iscrizione, rinnovo_automatico || false, frequenza_rinnovo,
        JSON.stringify(documenti_richiesti || []), procedura_iscrizione, note,
        categorie_merceologiche || [], categorie_soa || [],
        request.user?.username
      ]);
    }

    return { success: true, albo: result.rows[0] };
  });

  // ============================================================
  // DELETE /api/albi-fornitori/admin/albo/:id - Disattiva albo
  // ============================================================
  fastify.delete('/admin/albo/:id', { preHandler: [fastify.authenticate] }, async (request) => {
    const { id } = request.params;
    // Support both albo ID and stazione ID
    let result = await query('UPDATE albi_fornitori SET attivo = false, updated_at = NOW() WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) {
      // Try as stazione ID
      result = await query('UPDATE albi_fornitori SET attivo = false, updated_at = NOW() WHERE id_stazione = $1 AND attivo = true RETURNING id', [id]);
    }
    return { success: true };
  });

  // ============================================================
  // GET /api/albi-fornitori/admin/richieste - Lista richieste servizio
  // ============================================================
  fastify.get('/admin/richieste', { preHandler: [fastify.authenticate] }, async (request) => {
    const { stato, page = 1, limit = 30 } = request.query;
    const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

    const conditions = [];
    const params = [];
    let idx = 1;

    if (stato) {
      conditions.push(`r.stato = $${idx}`);
      params.push(stato);
      idx++;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(parseInt(limit), offset);

    const result = await query(`
      SELECT r.*, af.nome_albo, s."Nome" AS stazione_nome, s."Città" AS stazione_citta,
        a."RagioneSociale" AS azienda_nome, a."PartitaIva" AS azienda_piva,
        a."Tel" AS azienda_tel, a."Email" AS azienda_email
      FROM richieste_servizio_albi r
      JOIN albi_fornitori af ON r.id_albo = af.id
      JOIN stazioni s ON af.id_stazione = s."id"
      LEFT JOIN aziende a ON r.id_azienda = a."id"
      ${where}
      ORDER BY CASE r.stato
        WHEN 'ricevuta' THEN 1
        WHEN 'in_lavorazione' THEN 2
        WHEN 'completata' THEN 3
        WHEN 'annullata' THEN 4
      END, r.data_richiesta DESC
      LIMIT $${idx} OFFSET $${idx + 1}
    `, params);

    const countRes = await query(
      `SELECT COUNT(*) as total FROM richieste_servizio_albi r ${where}`,
      params.slice(0, -2)
    );

    return {
      data: result.rows,
      pagination: { total: parseInt(countRes.rows[0].total), page: parseInt(page), limit: parseInt(limit) }
    };
  });

  // ============================================================
  // PUT /api/albi-fornitori/admin/richieste/:id - Aggiorna stato richiesta
  // ============================================================
  fastify.put('/admin/richieste/:id', { preHandler: [fastify.authenticate] }, async (request) => {
    const { id } = request.params;
    const { stato, note_easywin, preventivo } = request.body;

    const updates = [];
    const params = [];
    let idx = 1;

    if (stato) {
      updates.push(`stato = $${idx}`);
      params.push(stato);
      idx++;
      if (stato === 'completata') {
        updates.push(`data_completamento = NOW()`);
        updates.push(`completato_da = $${idx}`);
        params.push(request.user?.username);
        idx++;
      }
    }
    if (note_easywin !== undefined) {
      updates.push(`note_easywin = $${idx}`);
      params.push(note_easywin);
      idx++;
    }
    if (preventivo !== undefined) {
      updates.push(`preventivo = $${idx}`);
      params.push(preventivo);
      idx++;
    }

    if (updates.length === 0) return { success: false, error: 'Nessun campo da aggiornare' };

    params.push(id);
    const result = await query(
      `UPDATE richieste_servizio_albi SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
      params
    );

    return { success: true, richiesta: result.rows[0] };
  });

  // ============================================================
  // POST /api/albi-fornitori/admin/iscrizione - Registra iscrizione azienda ad albo
  // ============================================================
  fastify.post('/admin/iscrizione', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id_albo, id_azienda, iscritto, data_iscrizione, data_scadenza, numero_iscrizione, note } = request.body;

    if (!id_albo || !id_azienda) return reply.status(400).send({ error: 'id_albo e id_azienda obbligatori' });

    const result = await query(`
      INSERT INTO iscrizioni_albo (id_albo, id_azienda, iscritto, stato, data_iscrizione, data_scadenza, numero_iscrizione, note)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (id_albo, id_azienda) DO UPDATE SET
        iscritto = $3, stato = $4, data_iscrizione = $5, data_scadenza = $6,
        numero_iscrizione = $7, note = $8, updated_at = NOW()
      RETURNING *
    `, [id_albo, id_azienda, iscritto || false, iscritto ? 'iscritto' : 'non_iscritto',
        data_iscrizione, data_scadenza, numero_iscrizione, note]);

    return { success: true, iscrizione: result.rows[0] };
  });

  // ============================================================
  // GET /api/albi-fornitori/raccomandazioni - Albi consigliati per il cliente
  // ============================================================
  fastify.get('/raccomandazioni', { preHandler: [fastify.authenticate] }, async (request) => {
    const username = request.user?.username || request.user?.email;
    const idAzienda = request.user?.id_azienda;
    const { limit: maxResults = 20 } = request.query;

    // 1. Get client's SOA categories (both bandi and esiti)
    const soaRes = await query(`
      SELECT DISTINCT id_soa FROM (
        SELECT id_soa FROM users_soa WHERE username = $1
        UNION
        SELECT id_soa FROM users_soa_bandi WHERE username = $1
      ) combined
    `, [username]);
    const clientSoaIds = soaRes.rows.map(r => r.id_soa);

    // 2. Get client's regions
    const regioniRes = await query(`
      SELECT DISTINCT id_regione FROM (
        SELECT id_regione FROM users_regioni WHERE username = $1
        UNION
        SELECT id_regione FROM users_regioni_bandi WHERE username = $1
      ) combined
    `, [username]);
    const clientRegioniIds = regioniRes.rows.map(r => r.id_regione);

    if (clientSoaIds.length === 0 && clientRegioniIds.length === 0) {
      return {
        data: [],
        message: 'Configura le tue SOA e regioni nel contratto per ricevere raccomandazioni personalizzate.',
        profilo: { soa: [], regioni: [] }
      };
    }

    // 3. Get client's existing iscrizioni to exclude
    let iscrizioniStazioniIds = [];
    if (idAzienda) {
      const iscrRes = await query(`
        SELECT DISTINCT af.id_stazione
        FROM iscrizioni_albo ia
        JOIN albi_fornitori af ON ia.id_albo = af.id
        WHERE ia.id_azienda = $1 AND ia.iscritto = true
      `, [idAzienda]);
      iscrizioniStazioniIds = iscrRes.rows.map(r => r.id_stazione);
    }

    // Also exclude stazioni with pending requests
    if (idAzienda || username) {
      const pendingRes = await query(`
        SELECT DISTINCT af.id_stazione
        FROM richieste_servizio_albi r
        JOIN albi_fornitori af ON r.id_albo = af.id
        WHERE (r.id_azienda = $1 OR r.username = $2)
        AND r.stato IN ('ricevuta', 'in_lavorazione')
      `, [idAzienda, username]);
      pendingRes.rows.forEach(r => {
        if (!iscrizioniStazioniIds.includes(r.id_stazione)) {
          iscrizioniStazioniIds.push(r.id_stazione);
        }
      });
    }

    // 4. Build the recommendation query
    // Find stazioni with albo that are:
    // - In the client's regions
    // - Have published bandi (especially procedure negoziate) in client's SOA
    // - Client is NOT already registered to
    const conditions = ['s."eliminata" = false', 'af.attivo = true'];
    const params = [];
    let idx = 1;

    // Region filter
    if (clientRegioniIds.length > 0) {
      conditions.push(`p."id_regione" = ANY($${idx})`);
      params.push(clientRegioniIds);
      idx++;
    }

    // Exclude already registered/pending
    if (iscrizioniStazioniIds.length > 0) {
      conditions.push(`s."id" != ALL($${idx})`);
      params.push(iscrizioniStazioniIds);
      idx++;
    }

    // SOA filter — track the param index for reuse in subqueries
    let soaParamIdx = null;
    let soaCondition = '';
    if (clientSoaIds.length > 0) {
      soaParamIdx = idx;
      soaCondition = `AND b."id_soa" = ANY($${idx})`;
      params.push(clientSoaIds);
      idx++;
    }

    // Find tipologia_bando ID for "Procedura Negoziata"
    const tipoRes = await query(`
      SELECT "id_tipologia_bando" FROM tipologiabandi WHERE "Tipologia" ILIKE '%negoziata%' LIMIT 1
    `);
    const negoziataId = tipoRes.rows[0]?.id_tipologia_bando;

    let negoziataParamIdx = null;
    let negoziataCondition = '';
    if (negoziataId) {
      negoziataParamIdx = idx;
      negoziataCondition = `AND b."id_tipologia_bando" = $${idx}`;
      params.push(negoziataId);
      idx++;
    }

    const limitParamIdx = idx;
    params.push(parseInt(maxResults));

    const result = await query(`
      SELECT
        s."id",
        s."Nome" AS nome_stazione,
        s."Città" AS citta,
        r."Regione" AS regione,
        p."Provincia" AS provincia,
        af.id AS albo_id,
        af.nome_albo,
        af.piattaforma,
        af.url_albo,

        -- Totale bandi nelle SOA del cliente
        (SELECT COUNT(*)
         FROM bandi b
         WHERE b."id_stazione" = s."id"
         AND b."Annullato" = false
         ${soaCondition}
        ) AS bandi_matching_soa,

        -- Totale procedure negoziate nelle SOA del cliente
        (SELECT COUNT(*)
         FROM bandi b
         WHERE b."id_stazione" = s."id"
         AND b."Annullato" = false
         ${soaCondition}
         ${negoziataCondition}
        ) AS procedure_negoziate,

        -- Totale bandi ultimi 12 mesi
        (SELECT COUNT(*)
         FROM bandi b
         WHERE b."id_stazione" = s."id"
         AND b."Annullato" = false
         AND b."DataPubblicazione" >= NOW() - INTERVAL '12 months'
        ) AS bandi_recenti,

        -- SOA matching per questa stazione
        (SELECT array_agg(DISTINCT soa."cod" ORDER BY soa."cod")
         FROM bandi b
         JOIN soa ON b."id_soa" = soa."id"
         WHERE b."id_stazione" = s."id"
         AND b."Annullato" = false
         ${soaParamIdx ? `AND b."id_soa" = ANY($${soaParamIdx})` : ''}
        ) AS soa_matching

      FROM stazioni s
      JOIN albi_fornitori af ON af.id_stazione = s."id" AND af.attivo = true
      LEFT JOIN province p ON s."id_provincia" = p."id_provincia"
      LEFT JOIN regioni r ON p."id_regione" = r."id_regione"
      WHERE ${conditions.join(' AND ')}

      -- Ordine: più procedure negoziate → più bandi SOA → più bandi recenti
      ORDER BY
        (SELECT COUNT(*) FROM bandi b
         WHERE b."id_stazione" = s."id" AND b."Annullato" = false
         ${soaCondition} ${negoziataCondition}
        ) DESC,
        (SELECT COUNT(*) FROM bandi b
         WHERE b."id_stazione" = s."id" AND b."Annullato" = false
         ${soaCondition}
        ) DESC,
        (SELECT COUNT(*) FROM bandi b
         WHERE b."id_stazione" = s."id" AND b."Annullato" = false
         AND b."DataPubblicazione" >= NOW() - INTERVAL '12 months'
        ) DESC
      LIMIT $${limitParamIdx}
    `, params);

    // Get SOA names for the profile info
    let soaNames = [];
    if (clientSoaIds.length > 0) {
      const soaNamesRes = await query(
        `SELECT "cod", "Descrizione" FROM soa WHERE "id" = ANY($1) ORDER BY "cod"`,
        [clientSoaIds]
      );
      soaNames = soaNamesRes.rows;
    }

    let regioniNames = [];
    if (clientRegioniIds.length > 0) {
      const regNamesRes = await query(
        `SELECT "Regione" FROM regioni WHERE id = ANY($1) ORDER BY "Regione"`,
        [clientRegioniIds]
      );
      regioniNames = regNamesRes.rows.map(r => r.Regione);
    }

    return {
      data: result.rows,
      profilo: {
        soa: soaNames,
        regioni: regioniNames,
        n_escluse_gia_iscritto: iscrizioniStazioniIds.length
      },
      total: result.rows.length
    };
  });

  // ============================================================
  // GET /api/albi-fornitori/regioni/lista - Lista regioni per filtro
  // ============================================================
  fastify.get('/regioni/lista', async () => {
    const result = await query(`
      SELECT DISTINCT r."Regione" AS regione
      FROM stazioni s
      JOIN province p ON s."id_provincia" = p."id_provincia"
      JOIN regioni r ON p."id_regione" = r."id_regione"
      WHERE s."eliminata" = false AND r."Regione" IS NOT NULL
      ORDER BY r."Regione"
    `);
    return result.rows.map(r => r.regione);
  });
}
