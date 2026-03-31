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

    const conditions = ['"Annullato" = false'];
    const params = [];
    let idx = 1;

    // Only bandi with sopralluogo data
    conditions.push(`("DataSopStart" IS NOT NULL OR "DataSopEnd" IS NOT NULL)`);

    if (solo_attivi === 'true') {
      conditions.push(`("DataSopEnd" >= NOW() OR "DataSopEnd" IS NULL)`);
    }

    if (id_regione) {
      conditions.push(`p."id_regione" = $${idx}`);
      params.push(id_regione);
      idx++;
    }

    if (id_provincia) {
      conditions.push(`b."id_provincia" = $${idx}`);
      params.push(id_provincia);
      idx++;
    }

    if (data_dal) {
      conditions.push(`b."DataSopStart" >= $${idx}`);
      params.push(data_dal);
      idx++;
    }

    if (data_al) {
      conditions.push(`b."DataSopEnd" <= $${idx}`);
      params.push(data_al);
      idx++;
    }

    if (soa_categoria) {
      conditions.push(`soa."cod" = $${idx}`);
      params.push(soa_categoria);
      idx++;
    }

    if (importo_min) {
      conditions.push(`(b."ImportoSO" + COALESCE(b."ImportoCO", 0) + COALESCE(b."ImportoEco", 0)) >= $${idx}`);
      params.push(parseFloat(importo_min));
      idx++;
    }

    if (importo_max) {
      conditions.push(`(b."ImportoSO" + COALESCE(b."ImportoCO", 0) + COALESCE(b."ImportoEco", 0)) <= $${idx}`);
      params.push(parseFloat(importo_max));
      idx++;
    }

    if (search) {
      conditions.push(`(b."Titolo" ILIKE $${idx} OR b."CodiceCIG" ILIKE $${idx})`);
      params.push(`%${search}%`);
      idx++;
    }

    try {
      const result = await query(`
        SELECT
          b."id_bando",
          b."Titolo",
          b."CodiceCIG",
          b."Indirizzo",
          b."CAP",
          b."Citta",
          b."DataSopStart",
          b."DataSopEnd",
          b."NotePerSopralluogo",
          b."DataOfferta",
          b."ImportoSO" + COALESCE(b."ImportoCO", 0) + COALESCE(b."ImportoEco", 0) AS importo_totale,
          s."Nome" AS stazione_nome,
          s."id" AS id_stazione,
          soa."Descrizione" AS soa_categoria,
          soa."cod" AS soa_cod,
          p."Provincia" AS provincia_nome,
          p."siglaprovincia" AS provincia_sigla,
          p."lat",
          p."lng",
          r."Regione" AS regione_nome
        FROM bandi b
        LEFT JOIN stazioni s ON b."id_stazione" = s."id"
        LEFT JOIN soa ON b."id_soa" = soa."id"
        LEFT JOIN province p ON b."id_provincia" = p."id_provincia"
        LEFT JOIN regioni r ON p."id_regione" = r."id_regione"
        WHERE ${conditions.join(' AND ')}
        ORDER BY b."DataSopStart" ASC NULLS LAST
        LIMIT 500
      `, params);

      const totalResult = await query(`
        SELECT COUNT(*) as total FROM bandi b
        LEFT JOIN stazioni s ON b."id_stazione" = s."id"
        LEFT JOIN soa ON b."id_soa" = soa."id"
        LEFT JOIN province p ON b."id_provincia" = p."id_provincia"
        LEFT JOIN regioni r ON p."id_regione" = r."id_regione"
        WHERE ${conditions.join(' AND ')}
      `, params);

      const markers = result.rows.map(row => ({
        id: row.id_bando,
        titolo: row.Titolo,
        cig: row.CodiceCIG,
        stazione: row.stazione_nome,
        soa: row.soa_categoria,
        soa_cod: row.soa_cod,
        indirizzo: [row.Indirizzo, row.CAP, row.Citta, row.provincia_sigla].filter(Boolean).join(', '),
        citta: row.Citta,
        provincia: row.provincia_nome,
        regione: row.regione_nome,
        importo: row.importo_totale,
        data_inizio: row.DataSopStart,
        data_fine: row.DataSopEnd,
        note: row.NotePerSopralluogo,
        data_offerta: row.DataOfferta,
        lat: row.lat,
        lng: row.lng
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
          COUNT(DISTINCT b."id_bando") AS totale_sopralluoghi,
          COUNT(DISTINCT b."id_bando") FILTER (
            WHERE b."DataSopEnd" >= NOW() OR b."DataSopEnd" IS NULL
          ) AS attivi,
          COUNT(DISTINCT r."id_regione") AS regioni_coperte
        FROM bandi b
        LEFT JOIN province p ON b."id_provincia" = p."id_provincia"
        LEFT JOIN regioni r ON p."id_regione" = r."id_regione"
        WHERE b."Annullato" = false
          AND (b."DataSopStart" IS NOT NULL OR b."DataSopEnd" IS NOT NULL)
      `);

      const perRegione = await query(`
        SELECT r."Regione", COUNT(DISTINCT b."id_bando") AS totale
        FROM bandi b
        JOIN province p ON b."id_provincia" = p."id_provincia"
        JOIN regioni r ON p."id_regione" = r."id_regione"
        WHERE b."Annullato" = false
          AND (b."DataSopEnd" >= NOW() OR b."DataSopEnd" IS NULL)
          AND (b."DataSopStart" IS NOT NULL)
        GROUP BY r."id_regione", r."Regione"
        ORDER BY totale DESC
      `);

      const upcoming = await query(`
        SELECT COUNT(DISTINCT b."id_bando") AS upcoming_this_week
        FROM bandi b
        WHERE b."Annullato" = false
          AND b."DataSopStart" IS NOT NULL
          AND b."DataSopStart" >= NOW()
          AND b."DataSopStart" <= NOW() + INTERVAL '7 days'
      `);

      return reply.send({
        totale_sopralluoghi: parseInt(stats.rows[0].totale_sopralluoghi),
        attivi: parseInt(stats.rows[0].attivi),
        regioni_coperte: parseInt(stats.rows[0].regioni_coperte),
        upcoming_this_week: parseInt(upcoming.rows[0].upcoming_this_week),
        per_regione: perRegione.rows.map(r => ({
          regione: r.Regione,
          totale: parseInt(r.totale)
        }))
      });
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ error: 'Database error' });
    }
  });

  // GET /api/sopralluoghi-map/:id/dettaglio - Full detail of a bando's sopralluogo
  fastify.get('/:id/dettaglio', async (request, reply) => {
    const { id } = request.params;

    try {
      const bandoRes = await query(`
        SELECT
          b."id_bando" AS id,
          b."Titolo" AS titolo,
          b."CodiceCIG" AS codice_cig,
          b."Indirizzo" AS indirizzo,
          b."CAP" AS cap,
          b."Citta" AS citta,
          b."DataSopStart" AS data_inizio,
          b."DataSopEnd" AS data_fine,
          b."DataOfferta" AS data_offerta,
          b."NotePerSopralluogo" AS note_per_sopralluogo,
          b."ImportoSO" AS importo_so,
          b."ImportoCO" AS importo_co,
          b."ImportoEco" AS importo_eco,
          s."Nome" AS stazione_nome,
          s."id" AS id_stazione,
          soa."cod" AS soa_cod,
          soa."Descrizione" AS soa_categoria,
          p."Provincia" AS provincia_nome,
          p."id_provincia"
        FROM bandi b
        LEFT JOIN stazioni s ON b."id_stazione" = s."id"
        LEFT JOIN soa ON b."id_soa" = soa."id"
        LEFT JOIN province p ON b."id_provincia" = p."id_provincia"
        WHERE b."id_bando" = $1
      `, [id]);

      if (bandoRes.rows.length === 0) {
        return reply.code(404).send({ error: 'Bando non trovato' });
      }

      const bando = bandoRes.rows[0];

      // Fetch date sopralluoghi
      const dateRes = await query(`
        SELECT * FROM "sopralluoghi_date"
        WHERE "id_bando" = $1
        ORDER BY "DataSopralluogo" ASC
      `, [id]);

      // Fetch existing sopralluoghi records
      const sopraRes = await query(`
        SELECT
          s."id_visione",
          s."id_bando",
          s."id_azienda",
          a."RagioneSociale" AS azienda_nome,
          s."DataSopralluogo",
          s."OraSopralluogo",
          s."Prenotato",
          s."Eseguito",
          s."Annullato",
          s."PresaVisione",
          s."TipoEsecutore",
          s."DataInserimento"
        FROM "sopralluoghi" s
        LEFT JOIN "aziende" a ON s."id_azienda" = a."id"
        WHERE s."id_bando" = $1
        ORDER BY s."DataSopralluogo" ASC
      `, [id]);

      return reply.send({
        bando,
        date_disponibili: dateRes.rows.map(d => ({
          id: d.id,
          data_sopralluogo: d.DataSopralluogo,
          ora_sopralluogo: d.OraSopralluogo,
          note: d.Note
        })),
        sopralluoghi_esistenti: sopraRes.rows.map(s => ({
          id_visione: s.id_visione,
          azienda_nome: s.azienda_nome,
          data_sopralluogo: s.DataSopralluogo,
          ora_sopralluogo: s.OraSopralluogo,
          prenotato: s.Prenotato,
          eseguito: s.Eseguito,
          annullato: s.Annullato,
          presa_visione: s.PresaVisione,
          tipo_esecutore: s.TipoEsecutore,
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
      const result = await query(`
        INSERT INTO "sopralluoghi_richieste" (
          "id_bando",
          "NomeAzienda",
          "Email",
          "Telefono",
          "Note",
          "DataPreferita",
          "Stato",
          "DataInserimento"
        ) VALUES ($1, $2, $3, $4, $5, $6, 'in_attesa', NOW())
        RETURNING *
      `, [id, nome_azienda, email, telefono, note, data_preferita]);

      // Send email notification to admin
      try {
        const bandoRes = await query(`SELECT "Titolo", "CodiceCIG" FROM gare WHERE id = $1`, [id]);
        const bandoTitolo = bandoRes.rows[0]?.Titolo || 'N/D';
        const bandiCig = bandoRes.rows[0]?.CodiceCIG || 'N/D';
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
        SELECT * FROM "geocoding_cache"
        WHERE "Indirizzo" = $1
        LIMIT 1
      `, [indirizzo]);

      if (cached.rows.length > 0) {
        return reply.send({
          lat: cached.rows[0].Lat,
          lng: cached.rows[0].Lng,
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
        INSERT INTO "geocoding_cache" ("Indirizzo", "Lat", "Lng", "DataInserimento")
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT ("Indirizzo") DO NOTHING
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
          "id_provincia",
          "Provincia",
          "siglaprovincia",
          "lat",
          "lng",
          "id_regione"
        FROM "province"
        WHERE "lat" IS NOT NULL AND "lng" IS NOT NULL
        ORDER BY "Provincia" ASC
      `);

      return reply.send(
        result.rows.map(p => ({
          id: p.id_provincia,
          nome: p.Provincia,
          sigla: p.siglaprovincia,
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
        conditions.push(`s."id_azienda" = $${idx}`);
        params.push(id_azienda);
        idx++;
      }

      if (id_provincia) {
        conditions.push(`b."id_provincia" = $${idx}`);
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
        conditions.push(`(b."Titolo" ILIKE $${idx} OR b."CodiceCIG" ILIKE $${idx} OR a."RagioneSociale" ILIKE $${idx})`);
        params.push(`%${search}%`);
        idx++;
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      try {
        const result = await query(`
          SELECT
            s."id_visione",
            s."id_bando",
            s."id_azienda",
            a."RagioneSociale" AS azienda_nome,
            b."Titolo" AS bando_titolo,
            b."CodiceCIG" AS bando_cig,
            s."DataSopralluogo",
            s."OraSopralluogo",
            s."Prenotato",
            s."Eseguito",
            s."Annullato",
            s."PresaVisione",
            s."TipoEsecutore",
            p."Provincia" AS provincia_nome,
            s."DataInserimento"
          FROM "sopralluoghi" s
          LEFT JOIN "aziende" a ON s."id_azienda" = a."id"
          LEFT JOIN "bandi" b ON s."id_bando" = b."id_bando"
          LEFT JOIN "province" p ON b."id_provincia" = p."id_provincia"
          ${whereClause}
          ORDER BY s."DataSopralluogo" DESC
          LIMIT $${idx} OFFSET $${idx + 1}
        `, [...params, limit, offset]);

        const totalResult = await query(`
          SELECT COUNT(*) as total FROM "sopralluoghi" s
          LEFT JOIN "aziende" a ON s."id_azienda" = a."id"
          LEFT JOIN "bandi" b ON s."id_bando" = b."id_bando"
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
            s."id_visione",
            s."id_bando",
            s."id_azienda",
            a."RagioneSociale" AS azienda_nome,
            a."PartitaIVA",
            b."Titolo" AS bando_titolo,
            b."CodiceCIG" AS bando_cig,
            b."Indirizzo" AS bando_indirizzo,
            s."DataSopralluogo",
            s."OraSopralluogo",
            s."Prenotato",
            s."DataPrenotazione",
            s."Eseguito",
            s."DataEsecuzione",
            s."Annullato",
            s."PresaVisione",
            s."TipoEsecutore",
            s."ATI",
            s."Importo_AziendaEdra",
            s."Importo_EdraGestore",
            s."Importo_EdraCollaboratore",
            s."Importo_EdraIntermediario",
            s."Importo_IntermediarioEdra",
            s."Pagato_AziendaEdra",
            s."Pagato_EdraGestore",
            s."Pagato_EdraCollaboratore",
            s."Pagato_EdraIntermediario",
            s."Pagato_IntermediarioEdra",
            p."Provincia" AS provincia_nome,
            i."RagioneSociale" AS intermediario_nome,
            s."DataInserimento",
            s."InseritoDa",
            s."DataModifica",
            s."ModificatoDa"
          FROM "sopralluoghi" s
          LEFT JOIN "aziende" a ON s."id_azienda" = a."id"
          LEFT JOIN "bandi" b ON s."id_bando" = b."id_bando"
          LEFT JOIN "province" p ON b."id_provincia" = p."id_provincia"
          LEFT JOIN "aziende" i ON s."id_intermediario" = i."id"
          WHERE s."id_visione" = $1
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
        OraSopralluogo,
        TipoEsecutore,
        id_intermediario,
        ATI,
        Importo_AziendaEdra,
        Importo_EdraGestore,
        Importo_EdraCollaboratore,
        Importo_EdraIntermediario,
        Importo_IntermediarioEdra,
        Note
      } = request.body;

      if (!id_bando || !id_azienda) {
        return reply.code(400).send({ error: 'id_bando e id_azienda sono obbligatori' });
      }

      try {
        const result = await query(`
          INSERT INTO "sopralluoghi" (
            "id_bando",
            "id_azienda",
            "DataSopralluogo",
            "OraSopralluogo",
            "TipoEsecutore",
            "id_intermediario",
            "ATI",
            "Importo_AziendaEdra",
            "Importo_EdraGestore",
            "Importo_EdraCollaboratore",
            "Importo_EdraIntermediario",
            "Importo_IntermediarioEdra",
            "Note",
            "Prenotato",
            "Eseguito",
            "Annullato",
            "PresaVisione",
            "DataInserimento",
            "InseritoDa"
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, false, false, false, false, NOW(), $14
          )
          RETURNING *
        `, [
          id_bando,
          id_azienda,
          DataSopralluogo,
          OraSopralluogo,
          TipoEsecutore,
          id_intermediario,
          ATI || false,
          Importo_AziendaEdra || 0,
          Importo_EdraGestore || 0,
          Importo_EdraCollaboratore || 0,
          Importo_EdraIntermediario || 0,
          Importo_IntermediarioEdra || 0,
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
        'id_azienda', 'DataSopralluogo', 'OraSopralluogo', 'TipoEsecutore',
        'id_intermediario', 'ATI', 'Importo_AziendaEdra', 'Importo_EdraGestore',
        'Importo_EdraCollaboratore', 'Importo_EdraIntermediario',
        'Importo_IntermediarioEdra', 'Pagato_AziendaEdra', 'Pagato_EdraGestore',
        'Pagato_EdraCollaboratore', 'Pagato_EdraIntermediario',
        'Pagato_IntermediarioEdra', 'Note', 'Prenotato', 'Eseguito', 'PresaVisione'
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
          UPDATE "sopralluoghi"
          SET ${setClause.join(', ')}
          WHERE "id_visione" = $${idx}
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
          UPDATE "sopralluoghi"
          SET "Annullato" = true, "DataModifica" = NOW(), "ModificatoDa" = $1
          WHERE "id_visione" = $2
          RETURNING "id_visione"
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
          UPDATE "sopralluoghi"
          SET "Eseguito" = true, "DataEsecuzione" = NOW(), "DataModifica" = NOW(), "ModificatoDa" = $1
          WHERE "id_visione" = $2
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
          UPDATE "sopralluoghi"
          SET "Prenotato" = true, "DataPrenotazione" = NOW(), "DataModifica" = NOW(), "ModificatoDa" = $1
          WHERE "id_visione" = $2
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
            s."id_visione",
            s."id_bando",
            b."Titolo",
            b."CodiceCIG",
            s."DataSopralluogo",
            s."OraSopralluogo",
            s."Prenotato",
            s."Eseguito",
            s."Annullato",
            s."PresaVisione",
            a."RagioneSociale" AS azienda_nome
          FROM "sopralluoghi" s
          LEFT JOIN "bandi" b ON s."id_bando" = b."id_bando"
          LEFT JOIN "aziende" a ON s."id_azienda" = a."id"
          WHERE s."DataSopralluogo" >= $1::date
            AND s."DataSopralluogo" <= $2::date
            AND s."Annullato" = false
          ORDER BY s."DataSopralluogo" ASC, s."OraSopralluogo" ASC
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

          const startTime = row.OraSopralluogo
            ? `${row.DataSopralluogo}T${row.OraSopralluogo}`
            : row.DataSopralluogo;

          // End time is 4 hours after start
          const startDate = new Date(startTime);
          const endDate = new Date(startDate.getTime() + 4 * 60 * 60 * 1000);

          return {
            id: row.id_visione,
            title: `${row.Titolo} - ${row.azienda_nome}`,
            start: startTime,
            end: endDate.toISOString().substring(0, 19),
            color,
            allDay: false,
            extendedProps: {
              id_bando: row.id_bando,
              cig: row.CodiceCIG,
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

  // GET /api/sopralluoghi-map/admin/richieste - List quote requests
  fastify.get(
    '/admin/richieste',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const { page = 1, limit = 20, stato } = request.query;

      const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);
      const conditions = [];
      const params = [];
      let idx = 1;

      if (stato) {
        conditions.push(`r."Stato" = $${idx}`);
        params.push(stato);
        idx++;
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      try {
        const result = await query(`
          SELECT
            r."id",
            r."id_bando",
            b."Titolo" AS bando_titolo,
            b."CodiceCIG" AS bando_cig,
            r."NomeAzienda",
            r."Email",
            r."Telefono",
            r."Note",
            r."DataPreferita",
            r."Stato",
            r."Risposta",
            r."ImportoPreventivo",
            r."IvaPreventivo",
            r."DataInserimento"
          FROM "sopralluoghi_richieste" r
          LEFT JOIN "bandi" b ON r."id_bando" = b."id_bando"
          ${whereClause}
          ORDER BY r."DataInserimento" DESC
          LIMIT $${idx} OFFSET $${idx + 1}
        `, [...params, limit, offset]);

        const totalResult = await query(`
          SELECT COUNT(*) as total FROM "sopralluoghi_richieste" r
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

  // PUT /api/sopralluoghi-map/admin/richieste/:id - Update request status
  fastify.put(
    '/admin/richieste/:id',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const { id } = request.params;
      const { stato, risposta, importo_preventivo, iva_preventivo } = request.body;

      try {
        const result = await query(`
          UPDATE "sopralluoghi_richieste"
          SET
            "Stato" = COALESCE($1, "Stato"),
            "Risposta" = COALESCE($2, "Risposta"),
            "ImportoPreventivo" = COALESCE($3, "ImportoPreventivo"),
            "IvaPreventivo" = COALESCE($4, "IvaPreventivo")
          WHERE "id" = $5
          RETURNING *
        `, [stato, risposta, importo_preventivo ? parseFloat(importo_preventivo) : null, iva_preventivo ? parseFloat(iva_preventivo) : null, id]);

        if (result.rows.length === 0) {
          return reply.code(404).send({ error: 'Richiesta non trovata' });
        }

        return reply.send(result.rows[0]);
      } catch (error) {
        fastify.log.error(error);
        return reply.code(500).send({ error: 'Database error' });
      }
    }
  );

  // POST /api/sopralluoghi-map/admin/:bandoId/date - Add available date for a bando
  fastify.post(
    '/admin/:bandoId/date',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const { bandoId } = request.params;
      const { DataSopralluogo, OraSopralluogo, note } = request.body;

      if (!DataSopralluogo) {
        return reply.code(400).send({ error: 'DataSopralluogo è obbligatorio' });
      }

      try {
        const result = await query(`
          INSERT INTO "sopralluoghi_date" (
            "id_bando",
            "DataSopralluogo",
            "OraSopralluogo",
            "Note",
            "DataInserimento"
          ) VALUES ($1, $2, $3, $4, NOW())
          RETURNING *
        `, [bandoId, DataSopralluogo, OraSopralluogo, note]);

        return reply.code(201).send(result.rows[0]);
      } catch (error) {
        fastify.log.error(error);
        return reply.code(500).send({ error: 'Database error' });
      }
    }
  );

  // DELETE /api/sopralluoghi-map/admin/date/:id - Remove available date
  fastify.delete(
    '/admin/date/:id',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const { id } = request.params;

      try {
        const result = await query(`
          DELETE FROM "sopralluoghi_date"
          WHERE "id" = $1
          RETURNING "id"
        `, [id]);

        if (result.rows.length === 0) {
          return reply.code(404).send({ error: 'Data non trovata' });
        }

        return reply.send({ success: true, id: result.rows[0].id });
      } catch (error) {
        fastify.log.error(error);
        return reply.code(500).send({ error: 'Database error' });
      }
    }
  );

  // GET /api/sopralluoghi-map/admin/pagamenti - Payment summary
  fastify.get(
    '/admin/pagamenti',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const { data_dal, data_al, tipo_pagamento } = request.query;

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

      let selectFields = `
        s."id_visione",
        s."id_bando",
        b."Titolo",
        b."CodiceCIG",
        s."Importo_AziendaEdra",
        s."Importo_EdraGestore",
        s."Importo_EdraCollaboratore",
        s."Importo_EdraIntermediario",
        s."Importo_IntermediarioEdra",
        s."Pagato_AziendaEdra",
        s."Pagato_EdraGestore",
        s."Pagato_EdraCollaboratore",
        s."Pagato_EdraIntermediario",
        s."Pagato_IntermediarioEdra"
      `;

      if (tipo_pagamento) {
        const flowMapping = {
          'azienda_edra': 's."Importo_AziendaEdra" AS importo, s."Pagato_AziendaEdra" AS pagato',
          'edra_gestore': 's."Importo_EdraGestore" AS importo, s."Pagato_EdraGestore" AS pagato',
          'edra_collaboratore': 's."Importo_EdraCollaboratore" AS importo, s."Pagato_EdraCollaboratore" AS pagato',
          'edra_intermediari': 's."Importo_EdraIntermediario" AS importo, s."Pagato_EdraIntermediario" AS pagato',
          'intermediari_edra': 's."Importo_IntermediarioEdra" AS importo, s."Pagato_IntermediarioEdra" AS pagato'
        };

        if (flowMapping[tipo_pagamento]) {
          selectFields = `
            s."id_visione",
            s."id_bando",
            b."Titolo",
            b."CodiceCIG",
            ${flowMapping[tipo_pagamento]}
          `;
        }
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      try {
        const result = await query(`
          SELECT ${selectFields}
          FROM "sopralluoghi" s
          LEFT JOIN "bandi" b ON s."id_bando" = b."id_bando"
          ${whereClause}
          ORDER BY s."DataSopralluogo" DESC
        `, params);

        return reply.send({
          records: result.rows,
          total_records: result.rows.length
        });
      } catch (error) {
        fastify.log.error(error);
        return reply.code(500).send({ error: 'Database error' });
      }
    }
  );

  // POST /api/sopralluoghi-map/admin/:id/pagamento - Record payment
  fastify.post(
    '/admin/:id/pagamento',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const { id } = request.params;
      const { tipo, importo, iva, data_pagamento } = request.body;

      if (!tipo || !importo) {
        return reply.code(400).send({ error: 'tipo e importo sono obbligatori' });
      }

      const validTipi = [
        'azienda_edra',
        'edra_gestore',
        'edra_collaboratore',
        'edra_intermediari',
        'intermediari_edra'
      ];

      if (!validTipi.includes(tipo)) {
        return reply.code(400).send({ error: 'tipo pagamento non valido' });
      }

      const fieldMapping = {
        'azienda_edra': ['Importo_AziendaEdra', 'Pagato_AziendaEdra'],
        'edra_gestore': ['Importo_EdraGestore', 'Pagato_EdraGestore'],
        'edra_collaboratore': ['Importo_EdraCollaboratore', 'Pagato_EdraCollaboratore'],
        'edra_intermediari': ['Importo_EdraIntermediario', 'Pagato_EdraIntermediario'],
        'intermediari_edra': ['Importo_IntermediarioEdra', 'Pagato_IntermediarioEdra']
      };

      const [importoField, pagatoField] = fieldMapping[tipo];

      try {
        const result = await query(`
          UPDATE "sopralluoghi"
          SET
            "${importoField}" = $1,
            "${pagatoField}" = true,
            "DataModifica" = NOW(),
            "ModificatoDa" = $2
          WHERE "id_visione" = $3
          RETURNING *
        `, [parseFloat(importo), request.user.username, id]);

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

  // GET /api/sopralluoghi-map/admin/templates/:bandoId - Get template for a bando
  fastify.get(
    '/admin/templates/:bandoId',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const { bandoId } = request.params;

      try {
        const result = await query(`
          SELECT *
          FROM "sopralluoghi_tpl"
          WHERE "id_bando" = $1
        `, [bandoId]);

        if (result.rows.length === 0) {
          return reply.code(404).send({ error: 'Template non trovato' });
        }

        return reply.send(result.rows[0]);
      } catch (error) {
        fastify.log.error(error);
        return reply.code(500).send({ error: 'Database error' });
      }
    }
  );

  // POST /api/sopralluoghi-map/admin/templates - Create/update template
  fastify.post(
    '/admin/templates',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const {
        id_bando,
        TipoPrenotazione,
        Telefono,
        Email,
        Fax,
        Indirizzo,
        Cap,
        Citta,
        id_provincia,
        Note
      } = request.body;

      if (!id_bando) {
        return reply.code(400).send({ error: 'id_bando è obbligatorio' });
      }

      try {
        // Check if template exists
        const existing = await query(
          `SELECT "id" FROM "sopralluoghi_tpl" WHERE "id_bando" = $1`,
          [id_bando]
        );

        let result;

        if (existing.rows.length > 0) {
          // Update
          result = await query(`
            UPDATE "sopralluoghi_tpl"
            SET
              "TipoPrenotazione" = COALESCE($1, "TipoPrenotazione"),
              "Telefono" = COALESCE($2, "Telefono"),
              "Email" = COALESCE($3, "Email"),
              "Fax" = COALESCE($4, "Fax"),
              "Indirizzo" = COALESCE($5, "Indirizzo"),
              "Cap" = COALESCE($6, "Cap"),
              "Citta" = COALESCE($7, "Citta"),
              "id_provincia" = COALESCE($8, "id_provincia"),
              "Note" = COALESCE($9, "Note"),
              "DataModifica" = NOW()
            WHERE "id_bando" = $10
            RETURNING *
          `, [
            TipoPrenotazione,
            Telefono,
            Email,
            Fax,
            Indirizzo,
            Cap,
            Citta,
            id_provincia,
            Note,
            id_bando
          ]);
        } else {
          // Create
          result = await query(`
            INSERT INTO "sopralluoghi_tpl" (
              "id_bando",
              "TipoPrenotazione",
              "Telefono",
              "Email",
              "Fax",
              "Indirizzo",
              "Cap",
              "Citta",
              "id_provincia",
              "Note",
              "DataInserimento"
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
            RETURNING *
          `, [
            id_bando,
            TipoPrenotazione,
            Telefono,
            Email,
            Fax,
            Indirizzo,
            Cap,
            Citta,
            id_provincia,
            Note
          ]);
        }

        return reply.code(existing.rows.length > 0 ? 200 : 201).send(result.rows[0]);
      } catch (error) {
        fastify.log.error(error);
        return reply.code(500).send({ error: 'Database error' });
      }
    }
  );
}
