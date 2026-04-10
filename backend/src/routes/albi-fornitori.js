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
    const conditions = ['s."attivo" = true'];
    const params = [];
    let idx = 1;

    if (search) {
      conditions.push(`(s.nome ILIKE $${idx} OR s."citta" ILIKE $${idx} OR p."nome" ILIKE $${idx} OR r."nome" ILIKE $${idx} OR COALESCE(af.nome_albo,'') ILIKE $${idx})`);
      params.push(`%${search}%`);
      idx++;
    }
    if (regione) {
      conditions.push(`r."nome" = $${idx}`);
      params.push(regione);
      idx++;
    }
    if (has_albo === 'true') {
      conditions.push(`EXISTS (SELECT 1 FROM albi_fornitori af WHERE af.id_stazione = s."id" AND af.attivo = true)`);
    }

    const where = conditions.join(' AND ');

    const countRes = await query(
      `SELECT COUNT(*) as total FROM stazioni s
       LEFT JOIN province p ON s."id_provincia" = p."id"
       LEFT JOIN regioni r ON p."id_regione" = r."id"
       LEFT JOIN albi_fornitori af ON af.id_stazione = s."id" AND af.attivo = true
       WHERE ${where}`, params
    );

    const dataParams = [...params, parseInt(limit), offset];
    const result = await query(`
      SELECT
        s."id", s.nome AS nome_stazione, s."citta" AS citta,
        p."nome" AS provincia, p."sigla" AS sigla_provincia,
        r."nome" AS regione,
        s."email" AS email, s."telefono" AS telefono, s."indirizzo" AS indirizzo,
        (SELECT COUNT(*) FROM bandi b WHERE b."id_stazione" = s."id" AND b."annullato" = false) AS n_bandi,
        af.id AS albo_id,
        af.nome_albo,
        af.url_albo,
        af.piattaforma,
        af.scadenza_iscrizione,
        af.categorie_soa,
        CASE WHEN af.id IS NOT NULL THEN true ELSE false END AS has_albo
      FROM stazioni s
      LEFT JOIN province p ON s."id_provincia" = p."id"
      LEFT JOIN regioni r ON p."id_regione" = r."id"
      LEFT JOIN albi_fornitori af ON af.id_stazione = s."id" AND af.attivo = true
      WHERE ${where}
      ORDER BY af.id IS NOT NULL DESC, s.nome ASC
      LIMIT $${idx} OFFSET $${idx + 1}
    `, dataParams);

    const total = parseInt(countRes.rows[0].total);
    const pages = Math.ceil(total / parseInt(limit));

    // Map fields to frontend-expected camelCase names
    const albi = result.rows.map(r => ({
      ...r,
      stazioneNome: r.nome_stazione,
      scadenza: r.scadenza_iscrizione,
      soaCategorie: r.categorie_soa ? (Array.isArray(r.categorie_soa) ? r.categorie_soa : [r.categorie_soa]) : [],
      tipo: r.piattaforma || 'Generico'
    }));

    return {
      data: result.rows,
      albi,
      totalPages: pages,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages
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
      WHERE s."attivo" = true
    `);

    const regioniRes = await query(`
      SELECT r."nome" AS regione,
        COUNT(DISTINCT s."id") AS n_stazioni,
        COUNT(DISTINCT af.id) AS n_albi
      FROM stazioni s
      LEFT JOIN province p ON s."id_provincia" = p."id"
      LEFT JOIN regioni r ON p."id_regione" = r."id"
      LEFT JOIN albi_fornitori af ON af.id_stazione = s."id" AND af.attivo = true
      WHERE s."attivo" = true AND r."nome" IS NOT NULL
      GROUP BY r."nome"
      ORDER BY n_albi DESC, n_stazioni DESC
    `);

    const s = stats.rows[0];
    return {
      stats: s,
      albiTotali: parseInt(s.totale_albi) || 0,
      stazioniCoinvolte: parseInt(s.totale_stazioni) || 0,
      soaCoperte: parseInt(s.albi_attivi) || 0,
      copertura_regioni: regioniRes.rows
    };
  });

  // ============================================================
  // GET /api/albi-fornitori/:id - Dettaglio stazione + albo
  // ============================================================
  fastify.get('/:id', async (request, reply) => {
    const { id } = request.params;

    const staRes = await query(`
      SELECT s.id, s.nome AS nome_stazione, s.nome AS ragione_sociale,
        s.indirizzo, s.cap, s.citta, s.telefono,
        s.email, s.codice_fiscale AS partita_iva,
        p.nome AS provincia, p.sigla AS sigla_provincia,
        r.nome AS regione
      FROM stazioni s
      LEFT JOIN province p ON s.id_provincia = p.id
      LEFT JOIN regioni r ON p.id_regione = r.id
      WHERE s.id = $1 AND s.attivo = true
    `, [id]);

    if (staRes.rows.length === 0) return reply.status(404).send({ error: 'Stazione non trovata' });

    // Get albo info
    const alboRes = await query(`
      SELECT * FROM albi_fornitori WHERE id_stazione = $1 AND attivo = true ORDER BY id DESC LIMIT 1
    `, [id]);

    // Recent bandi
    const bandiRes = await query(`
      SELECT id, titolo, data_pubblicazione,
        data_offerta, codice_cig AS cig,
        COALESCE(importo_so,0) + COALESCE(importo_co,0) AS importo_totale
      FROM bandi WHERE id_stazione = $1 AND annullato = false
      ORDER BY data_pubblicazione DESC NULLS LAST LIMIT 20
    `, [id]);

    // Recent esiti (gare aggiudicate)
    const esitiRes = await query(`
      SELECT g.id, g.titolo, g.data AS data_esito,
        g.importo, g.n_partecipanti
      FROM gare g
      WHERE g.id_stazione = $1
      ORDER BY g.data DESC NULLS LAST LIMIT 10
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
      const staRes = await query('SELECT nome FROM stazioni WHERE id = $1', [id]);
      if (staRes.rows.length === 0) return reply.status(404).send({ error: 'Stazione non trovata' });

      alboRes = await query(
        `INSERT INTO albi_fornitori (id_stazione, nome_albo, attivo) VALUES ($1, $2, true) RETURNING id`,
        [id, `Albo Fornitori - ${staRes.rows[0].nome}`]
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
      SELECT r.*, af.nome_albo, s.nome AS stazione_nome, s."citta" AS stazione_citta
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
      SELECT r.*, af.nome_albo, s.nome AS stazione_nome,
        a."ragione_sociale" AS azienda_nome
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
      const staRes = await query('SELECT nome FROM stazioni WHERE id = $1', [id_stazione]);
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
      SELECT r.*, af.nome_albo, s.nome AS stazione_nome, s."citta" AS stazione_citta,
        a."ragione_sociale" AS azienda_nome, a."codice_fiscale" AS azienda_piva,
        a."telefono" AS azienda_tel, a."email" AS azienda_email
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
  // GET /api/albi-fornitori/admin/iscrizioni - Lista completa iscrizioni con filtri
  // ============================================================
  fastify.get('/admin/iscrizioni', { preHandler: [fastify.authenticate] }, async (request) => {
    const { stato, albo_id, search, page = 1, limit = 50 } = request.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let conditions = ['1=1'];
    const params = [];
    let paramIdx = 0;

    if (stato) {
      paramIdx++;
      conditions.push(`i.stato = $${paramIdx}`);
      params.push(stato);
    }
    if (albo_id) {
      paramIdx++;
      conditions.push(`i.id_albo = $${paramIdx}`);
      params.push(parseInt(albo_id));
    }
    if (search) {
      paramIdx++;
      conditions.push(`(a."ragione_sociale" ILIKE $${paramIdx} OR i.numero_iscrizione ILIKE $${paramIdx})`);
      params.push('%' + search + '%');
    }

    const where = conditions.join(' AND ');

    // Count
    const countRes = await query(`
      SELECT COUNT(*) AS total
      FROM iscrizioni_albo i
      LEFT JOIN aziende a ON i.id_azienda = a."id"
      WHERE ${where}
    `, params);
    const total = parseInt(countRes.rows[0].total);

    // Data
    paramIdx++;
    params.push(parseInt(limit));
    paramIdx++;
    params.push(offset);

    const result = await query(`
      SELECT i.*,
             a."ragione_sociale" AS azienda_nome, a."email" AS azienda_email,
             a."partita_iva" AS azienda_piva, a."telefono" AS azienda_telefono,
             af.nome_albo, af.piattaforma,
             s.nome AS stazione_nome
      FROM iscrizioni_albo i
      LEFT JOIN aziende a ON i.id_azienda = a."id"
      LEFT JOIN albi_fornitori af ON i.id_albo = af.id
      LEFT JOIN stazioni s ON af.id_stazione = s."id"
      WHERE ${where}
      ORDER BY i.updated_at DESC NULLS LAST, i.created_at DESC
      LIMIT $${paramIdx - 1} OFFSET $${paramIdx}
    `, params);

    return {
      data: result.rows,
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      pages: Math.ceil(total / parseInt(limit))
    };
  });

  // ============================================================
  // GET /api/albi-fornitori/admin/scadenze - Iscrizioni in scadenza
  // ============================================================
  fastify.get('/admin/scadenze', { preHandler: [fastify.authenticate] }, async (request) => {
    const { giorni = 60 } = request.query;
    const scadenza = new Date(Date.now() + parseInt(giorni) * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const result = await query(`
      SELECT i.id, i.id_albo, i.id_azienda, i.data_scadenza, i.stato, i.numero_iscrizione,
             a."ragione_sociale" AS azienda_nome, a."email" AS azienda_email, a."telefono" AS azienda_telefono,
             af.nome_albo, af.piattaforma,
             s.nome AS stazione_nome,
             EXTRACT(DAY FROM i.data_scadenza::timestamp - NOW()) AS giorni_rimasti
      FROM iscrizioni_albo i
      JOIN albi_fornitori af ON i.id_albo = af.id
      JOIN stazioni s ON af.id_stazione = s."id"
      LEFT JOIN aziende a ON i.id_azienda = a."id"
      WHERE i.data_scadenza <= $1
        AND i.data_scadenza >= CURRENT_DATE
        AND i.stato IN ('iscritto', 'da_verificare')
      ORDER BY i.data_scadenza ASC
    `, [scadenza]);

    // Count already notified (if log table exists)
    let notificati = 0;
    try {
      const logRes = await query(`
        SELECT COUNT(DISTINCT id_iscrizione) AS n
        FROM albi_notifiche_log
        WHERE created_at >= NOW() - INTERVAL '30 days'
      `);
      notificati = parseInt(logRes.rows[0]?.n || 0);
    } catch { /* table may not exist */ }

    return {
      data: result.rows,
      total: result.rows.length,
      giorni_filtro: parseInt(giorni),
      notificati_recenti: notificati
    };
  });

  // ============================================================
  // PUT /api/albi-fornitori/admin/iscrizioni/:id - Aggiorna iscrizione
  // ============================================================
  fastify.put('/admin/iscrizioni/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;
    const { stato, data_scadenza, numero_iscrizione, note, iscritto } = request.body;

    const updates = [];
    const params = [];
    let paramIdx = 0;

    if (stato !== undefined) { paramIdx++; updates.push(`stato = $${paramIdx}`); params.push(stato); }
    if (data_scadenza !== undefined) { paramIdx++; updates.push(`data_scadenza = $${paramIdx}`); params.push(data_scadenza); }
    if (numero_iscrizione !== undefined) { paramIdx++; updates.push(`numero_iscrizione = $${paramIdx}`); params.push(numero_iscrizione); }
    if (note !== undefined) { paramIdx++; updates.push(`note = $${paramIdx}`); params.push(note); }
    if (iscritto !== undefined) { paramIdx++; updates.push(`iscritto = $${paramIdx}`); params.push(iscritto); }
    updates.push('updated_at = NOW()');

    if (updates.length <= 1) return reply.status(400).send({ error: 'Nessun campo da aggiornare' });

    paramIdx++;
    params.push(parseInt(id));
    const result = await query(`UPDATE iscrizioni_albo SET ${updates.join(', ')} WHERE id = $${paramIdx} RETURNING *`, params);

    if (result.rows.length === 0) return reply.status(404).send({ error: 'Iscrizione non trovata' });
    return { success: true, iscrizione: result.rows[0] };
  });

  // ============================================================
  // GET /api/albi-fornitori/raccomandazioni - Albi consigliati per il cliente
  // ============================================================
  fastify.get('/raccomandazioni', async (request) => {
    const username = request.user?.username || request.user?.email;
    const idAzienda = request.user?.id_azienda;
    const { limit: maxResults = 20, azienda: aziendaSearch, regione: regioneFilter, soa: soaFilter } = request.query;

    let clientSoaIds = [];
    let clientRegioniIds = [];

    // Admin mode: search by azienda name/piva, or apply filters directly
    if (aziendaSearch) {
      // Find azienda by name or P.IVA
      const azRes = await query(`
        SELECT id, "ragione_sociale" AS ragione_sociale FROM aziende
        WHERE ("ragione_sociale" ILIKE $1 OR "codice_fiscale" ILIKE $1) AND "attivo" = true
        LIMIT 1
      `, ['%' + aziendaSearch + '%']);

      if (azRes.rows.length > 0) {
        const azId = azRes.rows[0].id;
        // Get azienda SOA from attestazioni
        const azSoaRes = await query(`
          SELECT DISTINCT aa."id_soa" AS id_soa FROM attestazioni_aziende aa WHERE aa."id_azienda" = $1
        `, [azId]);
        clientSoaIds = azSoaRes.rows.map(r => r.id_soa);

        // Get azienda region from province
        const azRegRes = await query(`
          SELECT p."id_regione" FROM aziende a
          JOIN province p ON a."id_provincia" = p."id"
          WHERE a.id = $1 AND p."id_regione" IS NOT NULL
        `, [azId]);
        clientRegioniIds = azRegRes.rows.map(r => r.id_regione);
      }
    }

    // Override with explicit filters if provided
    if (regioneFilter) {
      clientRegioniIds = [parseInt(regioneFilter)];
    }
    if (soaFilter) {
      clientSoaIds = [parseInt(soaFilter)];
    }

    // Fallback: try user's SOA and regions from contract
    if (clientSoaIds.length === 0 && !aziendaSearch && !soaFilter && username) {
      try {
        const soaRes = await query(`
          SELECT DISTINCT id_soa FROM (
            SELECT id_soa FROM users_soa WHERE username = $1
            UNION
            SELECT id_soa FROM users_soa_bandi WHERE username = $1
          ) combined
        `, [username]);
        clientSoaIds = soaRes.rows.map(r => r.id_soa);
      } catch(e) { /* tables may not exist */ }
    }
    if (clientRegioniIds.length === 0 && !aziendaSearch && !regioneFilter && username) {
      try {
        const regioniRes = await query(`
          SELECT DISTINCT id_regione FROM (
            SELECT id_regione FROM users_regioni WHERE username = $1
            UNION
            SELECT id_regione FROM users_regioni_bandi WHERE username = $1
          ) combined
        `, [username]);
        clientRegioniIds = regioniRes.rows.map(r => r.id_regione);
      } catch(e) { /* tables may not exist */ }
    }

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
    const conditions = ['s."attivo" = true', 'af.attivo = true'];
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
      SELECT "id" AS id FROM tipologia_bandi WHERE "nome" ILIKE '%negoziata%' LIMIT 1
    `);
    const negoziataId = tipoRes.rows[0]?.id;

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
        s.nome AS nome_stazione,
        s."citta" AS citta,
        r."nome" AS regione,
        p."nome" AS provincia,
        af.id AS albo_id,
        af.nome_albo,
        af.piattaforma,
        af.url_albo,

        -- Totale bandi nelle SOA del cliente
        (SELECT COUNT(*)
         FROM bandi b
         WHERE b."id_stazione" = s."id"
         AND b."annullato" = false
         ${soaCondition}
        ) AS bandi_matching_soa,

        -- Totale procedure negoziate nelle SOA del cliente
        (SELECT COUNT(*)
         FROM bandi b
         WHERE b."id_stazione" = s."id"
         AND b."annullato" = false
         ${soaCondition}
         ${negoziataCondition}
        ) AS procedure_negoziate,

        -- Totale bandi ultimi 12 mesi
        (SELECT COUNT(*)
         FROM bandi b
         WHERE b."id_stazione" = s."id"
         AND b."annullato" = false
         AND b."data_pubblicazione" >= NOW() - INTERVAL '12 months'
        ) AS bandi_recenti,

        -- SOA matching per questa stazione
        (SELECT array_agg(DISTINCT soa."codice" ORDER BY soa."codice")
         FROM bandi b
         JOIN soa ON b."id_soa" = soa."id"
         WHERE b."id_stazione" = s."id"
         AND b."annullato" = false
         ${soaParamIdx ? `AND b."id_soa" = ANY($${soaParamIdx})` : ''}
        ) AS soa_matching

      FROM stazioni s
      JOIN albi_fornitori af ON af.id_stazione = s."id" AND af.attivo = true
      LEFT JOIN province p ON s."id_provincia" = p."id"
      LEFT JOIN regioni r ON p."id_regione" = r."id"
      WHERE ${conditions.join(' AND ')}

      -- Ordine: più procedure negoziate → più bandi SOA → più bandi recenti
      ORDER BY
        (SELECT COUNT(*) FROM bandi b
         WHERE b."id_stazione" = s."id" AND b."annullato" = false
         ${soaCondition} ${negoziataCondition}
        ) DESC,
        (SELECT COUNT(*) FROM bandi b
         WHERE b."id_stazione" = s."id" AND b."annullato" = false
         ${soaCondition}
        ) DESC,
        (SELECT COUNT(*) FROM bandi b
         WHERE b."id_stazione" = s."id" AND b."annullato" = false
         AND b."data_pubblicazione" >= NOW() - INTERVAL '12 months'
        ) DESC
      LIMIT $${limitParamIdx}
    `, params);

    // Get SOA names for the profile info
    let soaNames = [];
    if (clientSoaIds.length > 0) {
      const soaNamesRes = await query(
        `SELECT "codice" AS codice, "descrizione" AS descrizione FROM soa WHERE "id" = ANY($1) ORDER BY "codice"`,
        [clientSoaIds]
      );
      soaNames = soaNamesRes.rows;
    }

    let regioniNames = [];
    if (clientRegioniIds.length > 0) {
      const regNamesRes = await query(
        `SELECT "nome" AS regione FROM regioni WHERE "id" = ANY($1) ORDER BY "nome"`,
        [clientRegioniIds]
      );
      regioniNames = regNamesRes.rows.map(r => r.regione);
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
  // POST /api/albi-fornitori/admin/notifica-scadenza - Invia notifica scadenza singola
  // ============================================================
  fastify.post('/admin/notifica-scadenza', { preHandler: [fastify.authenticate] }, async (request) => {
    const { id_iscrizione, id_azienda, email, nome_azienda, stazione, data_scadenza, tipo_scadenza } = request.body;
    if (!email) return { success: false, error: 'Email destinatario mancante' };

    let sendEmail;
    try {
      const mod = await import('../services/email-service.js');
      sendEmail = mod.sendEmail;
    } catch {
      return { success: false, error: 'Servizio email non disponibile' };
    }

    const subject = `[EasyWin] Promemoria scadenza ${tipo_scadenza || 'iscrizione albo'} - ${stazione || ''}`;
    const htmlBody = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
        <div style="background:#1a5276;color:#fff;padding:20px;border-radius:8px 8px 0 0">
          <h2 style="margin:0">Promemoria Scadenza Albo Fornitori</h2>
        </div>
        <div style="padding:20px;background:#f8f9fa;border:1px solid #ddd">
          <p>Gentile <strong>${nome_azienda || 'Utente'}</strong>,</p>
          <p>Le ricordiamo che la sua <strong>${tipo_scadenza || 'iscrizione'}</strong> presso la stazione appaltante
             <strong>${stazione || ''}</strong> risulta in scadenza il <strong>${data_scadenza || 'N/D'}</strong>.</p>
          <p>La invitiamo a provvedere al rinnovo per non perdere la possibilità di partecipare alle gare.</p>
          <hr style="border-color:#ddd">
          <p style="font-size:12px;color:#666">Questa email è stata inviata automaticamente da EasyWin. Per informazioni: info@easywin.it</p>
        </div>
      </div>
    `;

    const result = await sendEmail(email, subject, htmlBody);

    // Log the notification
    try {
      await query(`INSERT INTO albi_notifiche_log (id_iscrizione, id_azienda, email, tipo, esito, inviata_da, created_at)
                   VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [id_iscrizione || null, id_azienda || null, email, tipo_scadenza || 'scadenza', result.status, request.user?.username]);
    } catch { /* tabella potrebbe non esistere ancora */ }

    return { success: result.status === 'sent', result };
  });

  // ============================================================
  // POST /api/albi-fornitori/admin/notifiche-scadenze-bulk - Invia notifiche in blocco
  // ============================================================
  fastify.post('/admin/notifiche-scadenze-bulk', { preHandler: [fastify.authenticate] }, async (request) => {
    const { giorni = 30 } = request.body || {};
    const scadenza = new Date(Date.now() + giorni * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    // Trova tutte le iscrizioni in scadenza con email
    const res = await query(`
      SELECT i.id, i.id_azienda, i.data_scadenza, i.stato,
             a."ragione_sociale" AS nome_azienda, a."email" AS email,
             af.nome_albo, s.nome AS stazione_nome
      FROM iscrizioni_albo i
      JOIN albi_fornitori af ON i.id_albo = af.id
      JOIN stazioni s ON af.id_stazione = s."id"
      LEFT JOIN aziende a ON i.id_azienda = a."id"
      WHERE i.data_scadenza <= $1
        AND i.data_scadenza >= CURRENT_DATE
        AND i.stato IN ('iscritto', 'da_verificare')
        AND a."email" IS NOT NULL AND a."email" != ''
      ORDER BY i.data_scadenza ASC
    `, [scadenza]);

    if (res.rows.length === 0) return { success: true, inviate: 0, messaggio: 'Nessuna scadenza con email valida nel periodo' };

    let sendEmail;
    try {
      const mod = await import('../services/email-service.js');
      sendEmail = mod.sendEmail;
    } catch {
      return { success: false, error: 'Servizio email non disponibile' };
    }

    let sent = 0, failed = 0, skipped = 0;
    const details = [];

    for (const row of res.rows) {
      const subject = `[EasyWin] Scadenza iscrizione albo - ${row.stazione_nome || ''}`;
      const gg = Math.ceil((new Date(row.data_scadenza) - new Date()) / (1000*60*60*24));
      const html = `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
          <div style="background:#e65100;color:#fff;padding:20px;border-radius:8px 8px 0 0">
            <h2 style="margin:0">Scadenza Iscrizione Albo tra ${gg} giorni</h2>
          </div>
          <div style="padding:20px;background:#f8f9fa;border:1px solid #ddd">
            <p>Gentile <strong>${row.nome_azienda || 'Utente'}</strong>,</p>
            <p>La sua iscrizione all'albo <strong>${row.nome_albo || ''}</strong> della stazione <strong>${row.stazione_nome || ''}</strong>
               scade il <strong>${new Date(row.data_scadenza).toLocaleDateString('it-IT')}</strong> (tra ${gg} giorni).</p>
            <p>Rinnovi per tempo per continuare a ricevere inviti alle procedure negoziate.</p>
          </div>
        </div>`;
      const result = await sendEmail(row.email, subject, html);
      if (result.status === 'sent') sent++;
      else if (result.status === 'skipped') skipped++;
      else failed++;
      details.push({ azienda: row.nome_azienda, email: row.email, esito: result.status });
    }

    return { success: true, inviate: sent, fallite: failed, saltate: skipped, totale: res.rows.length, dettagli: details };
  });

  // ============================================================
  // GET /api/albi-fornitori/regioni/lista - Lista regioni per filtro
  // ============================================================
  fastify.get('/regioni/lista', async () => {
    const result = await query(`
      SELECT DISTINCT r."nome" AS regione
      FROM stazioni s
      JOIN province p ON s."id_provincia" = p."id"
      JOIN regioni r ON p."id_regione" = r."id"
      WHERE s."attivo" = true AND r."nome" IS NOT NULL
      ORDER BY r."nome"
    `);
    return { regioni: result.rows.map(r => r.regione) };
  });
}
