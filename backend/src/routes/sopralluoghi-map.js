import { query, transaction } from '../db/pool.js';
import fetch from 'node-fetch';
import { sendEmail } from '../services/email-service.js';

export default async function sopralluoghiMapRoutes(fastify, opts) {

  // ============================================================
  // PUBLIC MAP ENDPOINTS
  // ============================================================

  // GET /api/sopralluoghi-map - Get sopralluoghi markers for map display
  fastify.get('/', async (request, reply) => {
    const {
      id_regione,
      id_provincia,
      data_dal,
      data_al,
      solo_attivi = 'true',
      soa_categoria,
      importo_min,
      importo_max,
      search
    } = request.query;

    const conditions = ['s."Annullato" = false'];
    const params = [];
    let idx = 1;

    // Only sopralluoghi with valid dates
    conditions.push(`s."DataSopralluogo" IS NOT NULL`);

    if (solo_attivi === 'true') {
      conditions.push(`s."DataSopralluogo" >= NOW()`);
    }

    if (id_regione) {
      conditions.push(`p."id_regione" = $${idx}`);
      params.push(id_regione);
      idx++;
    }

    if (id_provincia) {
      conditions.push(`s.id_provincia = $${idx}`);
      params.push(id_provincia);
      idx++;
    }

    if (data_dal) {
      conditions.push(`s."DataSopralluogo" >= $${idx}`);
      params.push(data_dal);
      idx++;
    }

    if (data_al) {
      conditions.push(`s."DataSopralluogo" <= $${idx}`);
      params.push(data_al);
      idx++;
    }

    if (soa_categoria) {
      conditions.push(`soa.codice = $${idx}`);
      params.push(soa_categoria);
      idx++;
    }

    if (importo_min) {
      conditions.push(`(b.importo_so + COALESCE(b.importo_co, 0) + COALESCE(b.importo_eco, 0)) >= $${idx}`);
      params.push(parseFloat(importo_min));
      idx++;
    }

    if (importo_max) {
      conditions.push(`(b.importo_so + COALESCE(b.importo_co, 0) + COALESCE(b.importo_eco, 0)) <= $${idx}`);
      params.push(parseFloat(importo_max));
      idx++;
    }

    if (search) {
      conditions.push(`(b.titolo ILIKE $${idx} OR b.codice_cig ILIKE $${idx})`);
      params.push(`%${search}%`);
      idx++;
    }

    try {
      const result = await query(`
        SELECT
          b.id,
          b.titolo,
          b.codice_cig,
          b.indirizzo,
          b.cap,
          b.citta,
          s."DataSopralluogo",
          b.importo_so + COALESCE(b.importo_co, 0) + COALESCE(b.importo_eco, 0) AS importo_totale,
          st.nome AS stazione_nome,
          st.id AS id_stazione,
          soa.descrizione AS soa_categoria,
          soa.codice AS soa_cod,
          p.nome AS provincia_nome,
          p.sigla AS provincia_sigla,
          r.nome AS regione_nome
        FROM sopralluoghi s
        JOIN bandi b ON s.id_bando = b.id
        LEFT JOIN stazioni st ON b.id_stazione = st.id
        LEFT JOIN soa ON b.id_soa = soa.id
        LEFT JOIN province p ON s.id_provincia = p.id
        LEFT JOIN regioni r ON p.id_regione = r.id
        WHERE ${conditions.join(' AND ')}
        ORDER BY s."DataSopralluogo" ASC NULLS LAST
        LIMIT 500
      `, params);

      const totalResult = await query(`
        SELECT COUNT(*) as total FROM sopralluoghi s
        JOIN bandi b ON s.id_bando = b.id
        LEFT JOIN stazioni st ON b.id_stazione = st.id
        LEFT JOIN soa ON b.id_soa = soa.id
        LEFT JOIN province p ON s.id_provincia = p.id
        LEFT JOIN regioni r ON p.id_regione = r.id
        WHERE ${conditions.join(' AND ')}
      `, params);

      const markers = result.rows.map(row => ({
        id: row.id,
        titolo: row.titolo,
        cig: row.codice_cig,
        stazione: row.stazione_nome,
        soa: row.soa_categoria,
        soa_cod: row.soa_cod,
        indirizzo: [row.indirizzo, row.cap, row.citta, row.provincia_sigla].filter(Boolean).join(', '),
        citta: row.citta,
        provincia: row.provincia_nome,
        regione: row.regione_nome,
        importo: row.importo_totale,
        data_sopralluogo: row.DataSopralluogo
      }));

      return reply.send({
        total: parseInt(totalResult.rows[0].total),
        markers
      });
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ error: 'Database error' });
    }
  });

  // ============================================================
  // GET /api/sopralluoghi-map/bandi-sopralluogo - Bandi attivi con sopralluogo obbligatorio
  // Mostra sulla mappa i bandi che richiedono sopralluogo, con "Richiedi Preventivo"
  // ============================================================
  fastify.get('/bandi-sopralluogo', async (request, reply) => {
    const {
      id_regione,
      id_provincia,
      soa_categoria,
      importo_min,
      importo_max,
      search
    } = request.query;

    const conditions = [
      'b.annullato IS NOT TRUE',
      'b.id_tipo_sopralluogo > 0',                           // Sopralluogo obbligatorio
      '(b.data_sop_end IS NULL OR b.data_sop_end >= NOW())'  // Non ancora scaduto
    ];
    const params = [];
    let idx = 1;

    if (id_regione) {
      conditions.push(`reg.id = $${idx}`);
      params.push(id_regione);
      idx++;
    }

    if (id_provincia) {
      conditions.push(`st.id_provincia = $${idx}`);
      params.push(id_provincia);
      idx++;
    }

    if (soa_categoria) {
      conditions.push(`soa.codice = $${idx}`);
      params.push(soa_categoria);
      idx++;
    }

    if (importo_min) {
      conditions.push(`(b.importo_so + COALESCE(b.importo_co, 0) + COALESCE(b.importo_eco, 0)) >= $${idx}`);
      params.push(parseFloat(importo_min));
      idx++;
    }

    if (importo_max) {
      conditions.push(`(b.importo_so + COALESCE(b.importo_co, 0) + COALESCE(b.importo_eco, 0)) <= $${idx}`);
      params.push(parseFloat(importo_max));
      idx++;
    }

    if (search) {
      conditions.push(`(b.titolo ILIKE $${idx} OR b.codice_cig ILIKE $${idx} OR st.nome ILIKE $${idx})`);
      params.push(`%${search}%`);
      idx++;
    }

    try {
      const result = await query(`
        SELECT
          b.id,
          b.titolo,
          b.codice_cig,
          b.indirizzo,
          b.cap,
          b.citta,
          b.data_sop_start,
          b.data_sop_end,
          b.data_offerta,
          b.data_max_per_sopralluogo,
          b.note_per_sopralluogo,
          b.id_tipo_sopralluogo,
          b.importo_so + COALESCE(b.importo_co, 0) + COALESCE(b.importo_eco, 0) AS importo_totale,
          st.nome AS stazione_nome,
          st.id AS id_stazione,
          soa.descrizione AS soa_categoria,
          soa.codice AS soa_cod,
          p.nome AS provincia_nome,
          p.sigla AS provincia_sigla,
          reg.nome AS regione_nome,
          -- Controlla se esiste già un sopralluogo associato
          EXISTS(SELECT 1 FROM sopralluoghi s WHERE s.id_bando = b.id) AS ha_sopralluogo_esistente
        FROM bandi b
        LEFT JOIN stazioni st ON b.id_stazione = st.id
        LEFT JOIN soa ON b.id_soa = soa.id
        LEFT JOIN province p ON st.id_provincia = p.id
        LEFT JOIN regioni reg ON p.id_regione = reg.id
        WHERE ${conditions.join(' AND ')}
        ORDER BY b.data_sop_end ASC NULLS LAST, b.data_pubblicazione DESC
        LIMIT 500
      `, params);

      const totalResult = await query(`
        SELECT COUNT(*) as total FROM bandi b
        LEFT JOIN stazioni st ON b.id_stazione = st.id
        LEFT JOIN soa ON b.id_soa = soa.id
        LEFT JOIN province p ON st.id_provincia = p.id
        LEFT JOIN regioni reg ON p.id_regione = reg.id
        WHERE ${conditions.join(' AND ')}
      `, params);

      const markers = result.rows.map(row => ({
        id: row.id,
        titolo: row.titolo,
        cig: row.codice_cig,
        stazione: row.stazione_nome,
        soa: row.soa_categoria,
        soa_cod: row.soa_cod,
        indirizzo: [row.indirizzo, row.cap, row.citta, row.provincia_sigla].filter(Boolean).join(', '),
        citta: row.citta,
        provincia: row.provincia_nome,
        regione: row.regione_nome,
        importo: row.importo_totale,
        data_sop_start: row.data_sop_start,
        data_sop_end: row.data_sop_end,
        data_offerta: row.data_offerta,
        data_max_sopralluogo: row.data_max_per_sopralluogo,
        note_sopralluogo: row.note_per_sopralluogo,
        tipo_sopralluogo: row.id_tipo_sopralluogo,
        ha_sopralluogo: row.ha_sopralluogo_esistente
      }));

      return reply.send({
        total: parseInt(totalResult.rows[0].total),
        markers
      });
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ error: 'Database error' });
    }
  });

  // GET /api/sopralluoghi-map/stats - Statistics for dashboard cards
  fastify.get('/stats', async (request, reply) => {
    try {
      const stats = await query(`
        SELECT
          COUNT(DISTINCT s.id_visione) AS totale_sopralluoghi,
          COUNT(DISTINCT s.id_visione) FILTER (
            WHERE s."DataSopralluogo" >= NOW()
          ) AS attivi,
          COUNT(DISTINCT r.id) AS regioni_coperte
        FROM sopralluoghi s
        JOIN bandi b ON s.id_bando = b.id
        LEFT JOIN province p ON s.id_provincia = p.id
        LEFT JOIN regioni r ON p.id_regione = r.id
        WHERE s."Annullato" = false
          AND s."DataSopralluogo" IS NOT NULL
      `);

      const perRegione = await query(`
        SELECT r.nome, COUNT(DISTINCT s.id_visione) AS totale
        FROM sopralluoghi s
        JOIN bandi b ON s.id_bando = b.id
        LEFT JOIN province p ON s.id_provincia = p.id
        LEFT JOIN regioni r ON p.id_regione = r.id
        WHERE s."Annullato" = false
          AND s."DataSopralluogo" >= NOW()
        GROUP BY r.id, r.nome
        ORDER BY totale DESC
      `);

      const upcoming = await query(`
        SELECT COUNT(DISTINCT s.id_visione) AS upcoming_this_week
        FROM sopralluoghi s
        WHERE s."Annullato" = false
          AND s."DataSopralluogo" IS NOT NULL
          AND s."DataSopralluogo" >= NOW()
          AND s."DataSopralluogo" <= NOW() + INTERVAL '7 days'
      `);

      return reply.send({
        totale_sopralluoghi: parseInt(stats.rows[0].totale_sopralluoghi),
        attivi: parseInt(stats.rows[0].attivi),
        regioni_coperte: parseInt(stats.rows[0].regioni_coperte),
        upcoming_this_week: parseInt(upcoming.rows[0].upcoming_this_week),
        per_regione: perRegione.rows.map(r => ({
          regione: r.nome,
          totale: parseInt(r.totale)
        }))
      });
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ error: 'Database error' });
    }
  });

  // GET /api/sopralluoghi-map/:id/dettaglio - Full detail of a bando's sopralluoghi
  fastify.get('/:id/dettaglio', async (request, reply) => {
    const { id } = request.params;

    try {
      const bandoRes = await query(`
        SELECT
          b.id,
          b.titolo,
          b.codice_cig,
          b.indirizzo,
          b.cap,
          b.citta,
          b.data_sop_start AS data_inizio,
          b.data_sop_end AS data_fine,
          b.data_offerta,
          b.note_per_sopralluogo,
          b.importo_so,
          b.importo_co,
          b.importo_eco,
          st.nome AS stazione_nome,
          st.id AS id_stazione,
          soa.codice AS soa_cod,
          soa.descrizione AS soa_categoria,
          p.nome AS provincia_nome,
          p.id AS id_provincia
        FROM bandi b
        LEFT JOIN stazioni st ON b.id_stazione = st.id
        LEFT JOIN soa ON b.id_soa = soa.id
        LEFT JOIN province p ON st.id_provincia = p.id
        WHERE b.id = $1
      `, [id]);

      if (bandoRes.rows.length === 0) {
        return reply.code(404).send({ error: 'Bando non trovato' });
      }

      const bando = bandoRes.rows[0];

      // Fetch date sopralluoghi
      const dateRes = await query(`
        SELECT id, "DataSopralluogo", "OraSopralluogo", note
        FROM sopralluoghi_date
        WHERE id_bando = $1
        ORDER BY "DataSopralluogo" ASC
      `, [id]);

      // Fetch existing sopralluoghi records
      const sopraRes = await query(`
        SELECT
          s.id_visione,
          s.id_bando,
          s.id_azienda,
          a.ragione_sociale AS azienda_nome,
          s."DataSopralluogo",
          s."Prenotato",
          s."Eseguito",
          s."Annullato",
          s."PresaVisione",
          s."IDTipoEsecutore",
          s."DataInserimento"
        FROM sopralluoghi s
        LEFT JOIN aziende a ON s.id_azienda = a.id
        WHERE s.id_bando = $1
        ORDER BY s."DataSopralluogo" ASC
      `, [id]);

      return reply.send({
        bando,
        date_disponibili: dateRes.rows.map(d => ({
          id: d.id,
          data_sopralluogo: d.DataSopralluogo,
          ora_sopralluogo: d.OraSopralluogo,
          note: d.note
        })),
        sopralluoghi_esistenti: sopraRes.rows.map(s => ({
          id_visione: s.id_visione,
          azienda_nome: s.azienda_nome,
          data_sopralluogo: s.DataSopralluogo,
          prenotato: s.Prenotato,
          eseguito: s.Eseguito,
          annullato: s.Annullato,
          presa_visione: s.PresaVisione,
          tipo_esecutore: s.IDTipoEsecutore,
          data_inserimento: s.DataInserimento
        }))
      });
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ error: 'Database error' });
    }
  });

  // POST /api/sopralluoghi-map/:id/richiedi-preventivo - Public quote request
  fastify.post('/:id/richiedi-preventivo', async (request, reply) => {
    const { id } = request.params;
    const { nome_azienda, email, telefono, note, data_preferita } = request.body;

    if (!nome_azienda || !email) {
      return reply.code(400).send({ error: 'nome_azienda e email sono obbligatori' });
    }

    try {
      // Store contact info in note field as JSON since table doesn't have dedicated columns
      const contact_info = JSON.stringify({ nome_azienda, email, telefono });
      const combined_note = note ? `${contact_info}\nNote: ${note}` : contact_info;

      const result = await query(`
        INSERT INTO sopralluoghi_richieste (
          id_bando,
          data_richiesta,
          data_preferita,
          note,
          stato,
          created_at,
          updated_at
        ) VALUES ($1, NOW(), $2, $3, 'pendente', NOW(), NOW())
        RETURNING *
      `, [id, data_preferita, combined_note]);

      // Send email notification to admin
      try {
        const bandoRes = await query(`
          SELECT b.titolo, b.codice_cig FROM bandi b WHERE b.id = $1
        `, [id]);
        const bandoTitolo = bandoRes.rows[0]?.titolo || 'N/D';
        const bandiCig = bandoRes.rows[0]?.codice_cig || 'N/D';
        const adminEmail = process.env.ADMIN_EMAIL || process.env.SMTP_USER;
        if (adminEmail) {
          await sendEmail(adminEmail, `Nuova Richiesta Preventivo Sopralluogo - ${bandiCig}`,
            `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
              <div style="background:linear-gradient(135deg,#F5C518,#FF8C00);padding:20px;border-radius:8px 8px 0 0;">
                <h2 style="color:#fff;margin:0;">Nuova Richiesta Preventivo</h2>
              </div>
              <div style="background:#1a2a3a;padding:24px;color:#e0e0e0;border-radius:0 0 8px 8px;">
                <p><strong>Bando:</strong> ${bandoTitolo}</p>
                <p><strong>CIG:</strong> ${bandiCig}</p>
                <hr style="border-color:rgba(255,255,255,0.1);">
                <p><strong>Azienda:</strong> ${nome_azienda}</p>
                <p><strong>Email:</strong> ${email}</p>
                <p><strong>Telefono:</strong> ${telefono || 'Non specificato'}</p>
                <p><strong>Data preferita:</strong> ${data_preferita || 'Non specificata'}</p>
                <p><strong>Note:</strong> ${note || 'Nessuna nota'}</p>
                <hr style="border-color:rgba(255,255,255,0.1);">
                <p style="font-size:0.85em;color:#999;">Accedi al pannello amministrazione per rispondere alla richiesta.</p>
              </div>
            </div>`
          );
        }
      } catch (emailErr) {
        fastify.log.warn('Email notification failed:', emailErr.message);
      }

      return reply.code(201).send({
        success: true,
        message: 'Richiesta preventivo inviata. Ti contatteremo al più presto.',
        id: result.rows[0].id
      });
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ error: 'Database error' });
    }
  });

  // GET /api/sopralluoghi-map/geocode - Geocode an address
  fastify.get('/geocode', async (request, reply) => {
    const { indirizzo } = request.query;

    if (!indirizzo) {
      return reply.code(400).send({ error: 'indirizzo parametro obbligatorio' });
    }

    try {
      // Check geocoding cache first
      const cached = await query(`
        SELECT lat, lng FROM geocoding_cache
        WHERE indirizzo_normalizzato = $1
        LIMIT 1
      `, [indirizzo]);

      if (cached.rows.length > 0) {
        return reply.send({
          lat: cached.rows[0].lat,
          lng: cached.rows[0].lng,
          cached: true
        });
      }

      // Call Nominatim API
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(indirizzo)}`,
        {
          headers: {
            'User-Agent': 'EasyWin-Sopralluoghi/1.0'
          }
        }
      );

      const data = await response.json();

      if (!data || data.length === 0) {
        return reply.code(404).send({ error: 'Indirizzo non trovato' });
      }

      const result = data[0];
      const lat = parseFloat(result.lat);
      const lng = parseFloat(result.lon);

      // Store in cache
      await query(`
        INSERT INTO geocoding_cache (indirizzo_normalizzato, lat, lng, provider, data_geocoding, successo)
        VALUES ($1, $2, $3, 'nominatim', NOW(), true)
        ON CONFLICT (indirizzo_normalizzato) DO NOTHING
      `, [indirizzo, lat, lng]);

      return reply.send({
        lat,
        lng,
        cached: false
      });
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ error: 'Geocoding error' });
    }
  });

  // GET /api/sopralluoghi-map/province-coords - Get all provinces with coordinates
  fastify.get('/province-coords', async (request, reply) => {
    try {
      const result = await query(`
        SELECT
          id,
          nome,
          sigla,
          lat,
          lng,
          id_regione
        FROM province
        WHERE lat IS NOT NULL AND lng IS NOT NULL
        ORDER BY nome ASC
      `);

      return reply.send(
        result.rows.map(p => ({
          id: p.id,
          nome: p.nome,
          sigla: p.sigla,
          lat: p.lat,
          lng: p.lng,
          id_regione: p.id_regione
        }))
      );
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ error: 'Database error' });
    }
  });

  // ============================================================
  // ADMIN ENDPOINTS (require authentication)
  // ============================================================

  // GET /api/sopralluoghi-map/admin/lista - List all sopralluoghi with filters
  fastify.get(
    '/admin/lista',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const {
        page = 1,
        limit = 20,
        data_dal,
        data_al,
        id_azienda,
        id_provincia,
        eseguito,
        annullato,
        prenotato,
        presa_visione,
        search
      } = request.query;

      const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);
      const conditions = [];
      const params = [];
      let idx = 1;

      if (data_dal) {
        conditions.push(`s."DataSopralluogo" >= $${idx}`);
        params.push(data_dal);
        idx++;
      }

      if (data_al) {
        conditions.push(`s."DataSopralluogo" <= $${idx}`);
        params.push(data_al);
        idx++;
      }

      if (id_azienda) {
        conditions.push(`s.id_azienda = $${idx}`);
        params.push(id_azienda);
        idx++;
      }

      if (id_provincia) {
        conditions.push(`s.id_provincia = $${idx}`);
        params.push(id_provincia);
        idx++;
      }

      if (eseguito === 'true') {
        conditions.push(`s."Eseguito" = true`);
      } else if (eseguito === 'false') {
        conditions.push(`s."Eseguito" = false`);
      }

      if (annullato === 'true') {
        conditions.push(`s."Annullato" = true`);
      } else if (annullato === 'false') {
        conditions.push(`s."Annullato" = false`);
      }

      if (prenotato === 'true') {
        conditions.push(`s."Prenotato" = true`);
      } else if (prenotato === 'false') {
        conditions.push(`s."Prenotato" = false`);
      }

      if (presa_visione === 'true') {
        conditions.push(`s."PresaVisione" = true`);
      } else if (presa_visione === 'false') {
        conditions.push(`s."PresaVisione" = false`);
      }

      if (search) {
        conditions.push(`(b.titolo ILIKE $${idx} OR b.codice_cig ILIKE $${idx} OR a.ragione_sociale ILIKE $${idx})`);
        params.push(`%${search}%`);
        idx++;
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      try {
        const result = await query(`
          SELECT
            s.id_visione,
            s.id_bando,
            s.id_azienda,
            a.ragione_sociale AS azienda_nome,
            b.titolo AS bando_titolo,
            b.codice_cig AS codice_cig,
            s."DataSopralluogo",
            s."Prenotato",
            s."Eseguito",
            s."Annullato",
            s."PresaVisione",
            s."IDTipoEsecutore",
            s."Citta",
            p.nome AS provincia_nome,
            p.sigla AS provincia_sigla,
            s."DataInserimento"
          FROM sopralluoghi s
          LEFT JOIN aziende a ON s.id_azienda = a.id
          LEFT JOIN bandi b ON s.id_bando = b.id
          LEFT JOIN province p ON s.id_provincia = p.id
          ${whereClause}
          ORDER BY s."DataSopralluogo" DESC
          LIMIT $${idx} OFFSET $${idx + 1}
        `, [...params, limit, offset]);

        const totalResult = await query(`
          SELECT COUNT(*) as total FROM sopralluoghi s
          LEFT JOIN aziende a ON s.id_azienda = a.id
          LEFT JOIN bandi b ON s.id_bando = b.id
          ${whereClause}
        `, params);

        return reply.send({
          data: result.rows,
          total: parseInt(totalResult.rows[0].total),
          page: parseInt(page),
          limit: parseInt(limit)
        });
      } catch (error) {
        fastify.log.error(error);
        return reply.code(500).send({ error: 'Database error' });
      }
    }
  );

  // GET /api/sopralluoghi-map/admin/:id - Get single sopralluogo detail
  fastify.get(
    '/admin/:id',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const { id } = request.params;

      try {
        const result = await query(`
          SELECT
            s.id_visione,
            s.id_bando,
            s.id_azienda,
            a.ragione_sociale AS azienda_nome,
            a.partita_iva,
            b.titolo AS bando_titolo,
            b.codice_cig AS codice_cig,
            b.indirizzo AS bando_indirizzo,
            s."DataSopralluogo",
            s."Prenotato",
            s."TipoPrenotazione",
            s."DataPrenotazione",
            s."Eseguito",
            s."Annullato",
            s."PresaVisione",
            s."IDTipoEsecutore",
            s."IDEsecutoreEsterno",
            s."NumATI",
            s."IDAziendaATI01", s."IDAziendaATI02", s."IDAziendaATI03", s."IDAziendaATI04",
            s."Indirizzo", s."Cap", s."Citta",
            s."Fax", s."Telefono", s."Email", s."Username",
            s."Note",
            s."GestoreRichiesta",
            s."RiferimentoAziendaRichiedente",
            s."RiferimentoIntermediarioRichiedente",
            s."RiferimentoIntermediarioEsecutore",
            s."IDIntermediarioRichiedente", s."IDIntermediarioEsecutore",
            s."Richiesta", s."Esecuzione",
            s."DataRichiesta",
            s."ImponibileDaAziendaAEdra", s."IvaDaAziendaAEdra", s."TotaleDaAziendaAEdra", s."DataPagamentoDaAziendaAEdra",
            s."ImponibileDaEdraAGestoreChiamata", s."IvaDaEdraAGestoreChiamata", s."TotaleDaEdraAGestoreChiamata", s."DataPagamentoDaEdraAGestoreChiamata",
            s."ImponibileDaEdraACollaboratore", s."IvaDaEdraACollaboratore", s."TotaleDaEdraACollaboratore", s."DataPagamentoDaEdraACollaboratore",
            s."ImponibileDaEdraAIntermediari", s."IvaDaEdraAIntermediari", s."TotaleDaEdraAIntermediari", s."DataPagamentoDaEdraAIntermediari",
            s."ImponibileDaIntermediariAEdra", s."IvaDaIntermediariAEdra", s."TotaleDaIntermediariAEdra", s."DataPagamentoDaIntermediariAEdra",
            s."PagatoDaAziendaAEdra",
            s."PagatoDaEdraAlGestoreChiamata",
            s."PagatoDaEdraACollaboratore",
            s."PagatoDaEdraAIntermediari",
            s."PagatoDaIntermediariAEdra",
            s."ProformaInviato", s."FatturaElettronicaGenerata",
            s."AziendaAbbonataSopralluoghi",
            p.nome AS provincia_nome,
            p.sigla AS provincia_sigla,
            s.id_provincia,
            i.ragione_sociale AS intermediario_nome,
            s."DataInserimento",
            s."InseritoDa",
            s."DataModifica",
            s."ModificatoDa"
          FROM sopralluoghi s
          LEFT JOIN aziende a ON s.id_azienda = a.id
          LEFT JOIN bandi b ON s.id_bando = b.id
          LEFT JOIN province p ON s.id_provincia = p.id
          LEFT JOIN aziende i ON s."IDIntermediarioEsecutore" = i.id
          WHERE s.id_visione = $1
        `, [id]);

        if (result.rows.length === 0) {
          return reply.code(404).send({ error: 'Sopralluogo non trovato' });
        }

        return reply.send(result.rows[0]);
      } catch (error) {
        fastify.log.error(error);
        return reply.code(500).send({ error: 'Database error' });
      }
    }
  );

  // POST /api/sopralluoghi-map/admin - Create new sopralluogo
  fastify.post(
    '/admin',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const {
        id_bando,
        id_azienda,
        DataSopralluogo,
        TipoEsecutore,
        id_intermediario,
        NumATI,
        ImponibileDaAziendaAEdra,
        ImponibileDaEdraAGestoreChiamata,
        ImponibileDaEdraACollaboratore,
        ImponibileDaEdraAIntermediari,
        ImponibileDaIntermediariAEdra,
        Note
      } = request.body;

      if (!id_bando || !id_azienda) {
        return reply.code(400).send({ error: 'id_bando e id_azienda sono obbligatori' });
      }

      try {
        const result = await query(`
          INSERT INTO sopralluoghi (
            id_bando,
            id_azienda,
            "DataSopralluogo",
            "IDTipoEsecutore",
            "IDIntermediarioEsecutore",
            "NumATI",
            "ImponibileDaAziendaAEdra",
            "ImponibileDaEdraAGestoreChiamata",
            "ImponibileDaEdraACollaboratore",
            "ImponibileDaEdraAIntermediari",
            "ImponibileDaIntermediariAEdra",
            "Note",
            "Prenotato",
            "Eseguito",
            "Annullato",
            "PresaVisione",
            "DataInserimento",
            "InseritoDa"
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, false, false, false, false, NOW(), $13
          )
          RETURNING *
        `, [
          id_bando,
          id_azienda,
          DataSopralluogo,
          TipoEsecutore,
          id_intermediario,
          NumATI || 0,
          ImponibileDaAziendaAEdra || 0,
          ImponibileDaEdraAGestoreChiamata || 0,
          ImponibileDaEdraACollaboratore || 0,
          ImponibileDaEdraAIntermediari || 0,
          ImponibileDaIntermediariAEdra || 0,
          Note,
          request.user.username
        ]);

        return reply.code(201).send(result.rows[0]);
      } catch (error) {
        fastify.log.error(error);
        return reply.code(500).send({ error: 'Database error' });
      }
    }
  );

  // PUT /api/sopralluoghi-map/admin/:id - Update sopralluogo
  fastify.put(
    '/admin/:id',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const { id } = request.params;
      const updates = request.body;

      if (Object.keys(updates).length === 0) {
        return reply.code(400).send({ error: 'Nessun campo da aggiornare' });
      }

      const allowedFields = [
        'id_azienda', 'DataSopralluogo', 'IDTipoEsecutore',
        'IDIntermediarioEsecutore', 'NumATI', 'ImponibileDaAziendaAEdra', 'ImponibileDaEdraAGestoreChiamata',
        'ImponibileDaEdraACollaboratore', 'ImponibileDaEdraAIntermediari',
        'ImponibileDaIntermediariAEdra', 'PagatoDaAziendaAEdra', 'PagatoDaEdraAlGestoreChiamata',
        'PagatoDaEdraACollaboratore', 'PagatoDaEdraAIntermediari',
        'PagatoDaIntermediariAEdra', 'Note', 'Prenotato', 'Eseguito', 'PresaVisione'
      ];

      const setClause = [];
      const params = [];
      let idx = 1;

      for (const [key, value] of Object.entries(updates)) {
        if (allowedFields.includes(key)) {
          setClause.push(`"${key}" = $${idx}`);
          params.push(value);
          idx++;
        }
      }

      if (setClause.length === 0) {
        return reply.code(400).send({ error: 'Nessun campo valido da aggiornare' });
      }

      setClause.push(`"DataModifica" = NOW()`);
      setClause.push(`"ModificatoDa" = $${idx}`);
      params.push(request.user.username);
      idx++;

      params.push(id);

      try {
        const result = await query(`
          UPDATE sopralluoghi
          SET ${setClause.join(', ')}
          WHERE id_visione = $${idx}
          RETURNING *
        `, params);

        if (result.rows.length === 0) {
          return reply.code(404).send({ error: 'Sopralluogo non trovato' });
        }

        return reply.send(result.rows[0]);
      } catch (error) {
        fastify.log.error(error);
        return reply.code(500).send({ error: 'Database error' });
      }
    }
  );

  // DELETE /api/sopralluoghi-map/admin/:id - Soft delete
  fastify.delete(
    '/admin/:id',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const { id } = request.params;

      try {
        const result = await query(`
          UPDATE sopralluoghi
          SET "Annullato" = true, "DataModifica" = NOW(), "ModificatoDa" = $1
          WHERE id_visione = $2
          RETURNING id_visione
        `, [request.user.username, id]);

        if (result.rows.length === 0) {
          return reply.code(404).send({ error: 'Sopralluogo non trovato' });
        }

        return reply.send({ success: true, id: result.rows[0].id_visione });
      } catch (error) {
        fastify.log.error(error);
        return reply.code(500).send({ error: 'Database error' });
      }
    }
  );

  // POST /api/sopralluoghi-map/admin/:id/eseguito - Mark as executed
  fastify.post(
    '/admin/:id/eseguito',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const { id } = request.params;

      try {
        const result = await query(`
          UPDATE sopralluoghi
          SET "Eseguito" = true, "DataModifica" = NOW(), "ModificatoDa" = $1
          WHERE id_visione = $2
          RETURNING *
        `, [request.user.username, id]);

        if (result.rows.length === 0) {
          return reply.code(404).send({ error: 'Sopralluogo non trovato' });
        }

        return reply.send(result.rows[0]);
      } catch (error) {
        fastify.log.error(error);
        return reply.code(500).send({ error: 'Database error' });
      }
    }
  );

  // POST /api/sopralluoghi-map/admin/:id/prenotato - Mark as booked
  fastify.post(
    '/admin/:id/prenotato',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const { id } = request.params;

      try {
        const result = await query(`
          UPDATE sopralluoghi
          SET "Prenotato" = true, "DataPrenotazione" = NOW(), "DataModifica" = NOW(), "ModificatoDa" = $1
          WHERE id_visione = $2
          RETURNING *
        `, [request.user.username, id]);

        if (result.rows.length === 0) {
          return reply.code(404).send({ error: 'Sopralluogo non trovato' });
        }

        return reply.send(result.rows[0]);
      } catch (error) {
        fastify.log.error(error);
        return reply.code(500).send({ error: 'Database error' });
      }
    }
  );

  // GET /api/sopralluoghi-map/admin/appuntamenti - Get appointments for calendar
  fastify.get(
    '/admin/appuntamenti',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const { start, end } = request.query;

      if (!start || !end) {
        return reply.code(400).send({ error: 'start e end (ISO dates) sono obbligatori' });
      }

      try {
        const result = await query(`
          SELECT
            s.id_visione,
            s.id_bando,
            b.titolo,
            b.codice_cig,
            s."DataSopralluogo",
            s."Prenotato",
            s."Eseguito",
            s."Annullato",
            s."PresaVisione",
            a.ragione_sociale AS azienda_nome
          FROM sopralluoghi s
          LEFT JOIN bandi b ON s.id_bando = b.id
          LEFT JOIN aziende a ON s.id_azienda = a.id
          WHERE s."DataSopralluogo"::date >= $1::date
            AND s."DataSopralluogo"::date <= $2::date
            AND s."Annullato" = false
          ORDER BY s."DataSopralluogo" ASC
        `, [start, end]);

        const events = result.rows.map(row => {
          let color = '#007F0E'; // Green for regular

          if (row.PresaVisione) {
            color = '#00137F'; // Blue for prese visioni
          } else if (row.Annullato) {
            color = '#FF0000'; // Red for cancelled
          } else if (!row.Prenotato) {
            color = '#FF8C00'; // Orange for unbooked
          }

          const startTime = row.DataSopralluogo;

          // End time is 4 hours after start
          const startDate = new Date(startTime);
          const endDate = new Date(startDate.getTime() + 4 * 60 * 60 * 1000);

          return {
            id: row.id_visione,
            title: `${row.titolo} - ${row.azienda_nome}`,
            start: startTime,
            end: endDate.toISOString().substring(0, 19),
            color,
            allDay: false,
            extendedProps: {
              id_bando: row.id_bando,
              cig: row.codice_cig,
              azienda: row.azienda_nome,
              prenotato: row.Prenotato,
              eseguito: row.Eseguito,
              presa_visione: row.PresaVisione
            }
          };
        });

        return reply.send(events);
      } catch (error) {
        fastify.log.error(error);
        return reply.code(500).send({ error: 'Database error' });
      }
    }
  );
}
