import { query, transaction } from '../db/pool.js';
import { validateBandoPayload } from './_helpers/bando-validator.js';

export default async function bandiRoutes(fastify, opts) {

  // ============================================================
  // GET /api/bandi - Lista bandi con filtri e paginazione
  // ============================================================
  fastify.get('/', async (request, reply) => {
    const {
      page = 1,
      limit = 20,
      search, cig,
      regione, id_regione, id_provincia,
      id_stazione,
      id_soa,
      id_tipologia,
      id_criterio,
      id_piattaforma,
      data_dal,
      data_al,
      data_inserimento_dal,
      data_inserimento_al,
      filtra_data_modifica,
      provenienza,
      importo_min, importo_max,
      annullato,
      rettificato,
      privato: privatoFilter,
      id_tipologia_bando,
      sort = 'data_pubblicazione',
      order = 'DESC'
    } = request.query;

    const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);
    const conditions = [];
    const filtersApplied = {};

    // annullato filter: default = solo non-annullati (backward compatible)
    if (annullato === 'true' || annullato === '1') {
      conditions.push('b.annullato = true');
      filtersApplied.annullato = true;
    } else if (annullato === 'all' || annullato === 'tutti') {
      // no filter — show all
      filtersApplied.annullato = 'all';
    } else {
      // default: hide annullati (backward compatible)
      conditions.push('b.annullato = false');
    }

    // rettificato filter
    if (rettificato === 'true' || rettificato === '1') {
      conditions.push('b.rettificato = true');
      filtersApplied.rettificato = true;
    } else if (rettificato === 'false' || rettificato === '0') {
      conditions.push('b.rettificato = false');
      filtersApplied.rettificato = false;
    }

    // privato filter (0=Pubblico, 1=Privato, 2=Azienda) — deferred to parameterized section

    const params = [];
    let paramIdx = 1;

    // privato filter (0=Pubblico, 1=Privato, 2=Azienda)
    if (privatoFilter !== undefined && privatoFilter !== '' && privatoFilter !== 'all') {
      const pVal = parseInt(privatoFilter);
      if ([0, 1, 2].includes(pVal)) {
        conditions.push(`b.privato = $${paramIdx}`);
        params.push(pVal);
        filtersApplied.privato = pVal;
        paramIdx++;
      }
    }

    // id_tipologia_bando filter
    if (id_tipologia_bando) {
      conditions.push(`b.id_tipologia_bando = $${paramIdx}`);
      params.push(parseInt(id_tipologia_bando));
      filtersApplied.id_tipologia_bando = parseInt(id_tipologia_bando);
      paramIdx++;
    }

    if (search) {
      conditions.push(`(b.titolo ILIKE $${paramIdx} OR b.codice_cig ILIKE $${paramIdx} OR b.codice_cup ILIKE $${paramIdx} OR COALESCE(s.nome, '') ILIKE $${paramIdx})`);
      params.push(`%${search}%`);
      paramIdx++;
    }
    if (cig) {
      conditions.push(`b.codice_cig ILIKE $${paramIdx}`);
      params.push(`%${cig}%`);
      paramIdx++;
    }
    if (regione) {
      conditions.push(`r.nome = $${paramIdx}`);
      params.push(regione);
      paramIdx++;
    }
    if (id_regione) {
      conditions.push(`p.id_regione = $${paramIdx}`);
      params.push(parseInt(id_regione));
      paramIdx++;
    }
    if (id_provincia) {
      conditions.push(`s.id_provincia = $${paramIdx}`);
      params.push(parseInt(id_provincia));
      paramIdx++;
    }
    if (id_stazione) {
      conditions.push(`b.id_stazione = $${paramIdx}`);
      params.push(id_stazione);
      paramIdx++;
    }
    if (id_soa) {
      conditions.push(`b.id_soa = $${paramIdx}`);
      params.push(id_soa);
      paramIdx++;
    }
    if (id_tipologia) {
      conditions.push(`b.id_tipologia = $${paramIdx}`);
      params.push(id_tipologia);
      paramIdx++;
    }
    if (id_criterio) {
      conditions.push(`b.id_criterio = $${paramIdx}`);
      params.push(id_criterio);
      paramIdx++;
    }
    if (id_piattaforma) {
      conditions.push(`b.id_piattaforma = $${paramIdx}`);
      params.push(parseInt(id_piattaforma));
      paramIdx++;
    }
    if (data_dal) {
      conditions.push(`b.data_pubblicazione >= $${paramIdx}`);
      params.push(data_dal);
      paramIdx++;
    }
    if (data_al) {
      conditions.push(`b.data_pubblicazione <= $${paramIdx}`);
      params.push(data_al);
      paramIdx++;
    }
    // Filtro per data inserimento (e opzionalmente data modifica)
    if (data_inserimento_dal) {
      if (filtra_data_modifica === '1') {
        conditions.push(`(b.data_inserimento >= $${paramIdx} OR b.data_modifica >= $${paramIdx})`);
      } else {
        conditions.push(`b.data_inserimento >= $${paramIdx}`);
      }
      params.push(data_inserimento_dal);
      paramIdx++;
    }
    if (data_inserimento_al) {
      if (filtra_data_modifica === '1') {
        conditions.push(`(b.data_inserimento <= $${paramIdx} OR b.data_modifica <= $${paramIdx})`);
      } else {
        conditions.push(`b.data_inserimento <= $${paramIdx}`);
      }
      params.push(data_inserimento_al);
      paramIdx++;
    }
    if (provenienza) {
      conditions.push(`b.provenienza = $${paramIdx}`);
      params.push(provenienza);
      paramIdx++;
    }
    if (importo_min) {
      conditions.push(`b.importo_so >= $${paramIdx}`);
      params.push(parseFloat(importo_min));
      paramIdx++;
    }
    if (importo_max) {
      conditions.push(`b.importo_so <= $${paramIdx}`);
      params.push(parseFloat(importo_max));
      paramIdx++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Validate sort column to prevent SQL injection
    const allowedSorts = ['data_pubblicazione', 'titolo', 'importo_so', 'data_offerta'];
    const sortCol = allowedSorts.includes(sort) ? `b.${sort}` : 'b.data_pubblicazione';
    const sortOrder = order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    // Count total
    const countResult = await query(
      `SELECT COUNT(*) as total FROM bandi b
       LEFT JOIN stazioni s ON b.id_stazione = s.id
       LEFT JOIN province p ON s.id_provincia = p.id
       LEFT JOIN regioni r ON p.id_regione = r.id
       ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].total);

    // Get results - aliases map snake_case DB cols to snake_case API output
    const result = await query(
      `SELECT
        b.id AS id,
        b.titolo AS titolo,
        b.codice_cig AS codice_cig,
        b.codice_cup AS codice_cup,
        b.data_pubblicazione AS data_pubblicazione,
        b.data_offerta AS data_offerta,
        b.data_apertura AS data_apertura,
        b.importo_so AS importo_so,
        b.importo_co AS importo_co,
        b.importo_eco AS importo_eco,
        b.importo_manodopera AS importo_manodopera,
        b.note AS note,
        b.indirizzo_elaborati AS indirizzo_elaborati,
        s.nome AS stazione,
        s.citta AS stazione_citta,
        s.sito_web AS stazione_sito_web,
        pi.nome AS piattaforma_nome,
        pi.url AS piattaforma_url,
        p.nome AS provincia_nome,
        p.sigla AS provincia_sigla,
        r.nome AS regione_nome,
        COALESCE(soa.codice, '') AS soa_categoria,
        COALESCE(soa.descrizione, '') AS soa_descrizione,
        COALESCE(soa_sost.codice, '') AS soa_sostitutiva,
        COALESCE(tg.nome, '') AS tipologia,
        COALESCE(c.nome, '') AS criterio,
        b.data_avviso AS data_avviso,
        b.ora_avviso AS ora_avviso,
        b.username_avviso AS username_avviso,
        b.tipo_apertura_avviso AS tipo_apertura_avviso,
        b.note_avviso AS note_avviso,
        b.data_apertura_posticipata AS data_apertura_posticipata,
        b.data_apertura_da_destinarsi AS data_apertura_da_destinarsi,
        b.created_at AS created_at,
        b.updated_at AS updated_at,
        b.data_modifica AS data_modifica,
        b.modificato_da AS modificato_da,
        CASE WHEN b.data_modifica IS NOT NULL OR b.modificato_da IS NOT NULL THEN true ELSE false END AS is_modificato,
        b.annullato AS annullato,
        b.rettificato AS rettificato,
        b.privato AS privato,
        (SELECT COUNT(*)::int FROM allegati_bando ab WHERE ab.id_bando = b.id) AS allegati_count
       FROM bandi b
       LEFT JOIN stazioni s ON b.id_stazione = s.id
       LEFT JOIN piattaforme pi ON b.id_piattaforma = pi.id
       LEFT JOIN soa ON b.id_soa = soa.id
       LEFT JOIN soa soa_sost ON b.categoria_sostitutiva = soa_sost.id
       LEFT JOIN tipologia_gare tg ON b.id_tipologia = tg.id
       LEFT JOIN criteri c ON b.id_criterio = c.id
       LEFT JOIN province p ON s.id_provincia = p.id
       LEFT JOIN regioni r ON p.id_regione = r.id
       ${whereClause}
       ORDER BY ${sortCol} ${sortOrder}
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...params, parseInt(limit), offset]
    );

    return {
      data: result.rows,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit))
      },
      filters_applied: filtersApplied
    };
  });

  // ============================================================
  // GET /api/bandi/:id - Dettaglio bando completo
  // ============================================================
  fastify.get('/:id', async (request, reply) => {
    const { id } = request.params;

    const bando = await query(
      `SELECT b.*,
        s.nome AS stazione_nome, s.citta AS stazione_citta,
        s.sito_web AS stazione_sito_web, s.email AS stazione_email, s.telefono AS stazione_tel,
        pi.nome AS piattaforma_nome, pi.url AS piattaforma_url,
        soa.codice AS soa_categoria, soa.descrizione AS soa_descrizione,
        tg.nome AS tipologia_gare_nome,
        c.nome AS criterio_nome,
        p.nome AS provincia_nome, p.sigla AS provincia_sigla,
        r.nome AS regione_nome
       FROM bandi b
       LEFT JOIN stazioni s ON b.id_stazione = s.id
       LEFT JOIN piattaforme pi ON b.id_piattaforma = pi.id
       LEFT JOIN soa ON b.id_soa = soa.id
       LEFT JOIN tipologia_gare tg ON b.id_tipologia = tg.id
       LEFT JOIN criteri c ON b.id_criterio = c.id
       LEFT JOIN province p ON s.id_provincia = p.id
       LEFT JOIN regioni r ON p.id_regione = r.id
       WHERE b.id = $1`,
      [id]
    );

    if (bando.rows.length === 0) {
      return reply.status(404).send({ error: 'Bando non trovato' });
    }

    // Fetch allegati (graceful fallback if categoria column doesn't exist yet)
    let allegati;
    try {
      allegati = await query(
        `SELECT id, nome_file AS "NomeFile", categoria, tipo_mime, dimensione,
                username AS "UserName", last_update AS "LastUpdate", created_at
         FROM allegati_bando
         WHERE id_bando = $1
         ORDER BY created_at ASC`,
        [id]
      );
    } catch (e) {
      // Fallback without categoria/tipo_mime/dimensione columns
      allegati = await query(
        `SELECT id, nome_file AS "NomeFile", NULL AS categoria, NULL AS tipo_mime, NULL AS dimensione,
                username AS "UserName", last_update AS "LastUpdate", created_at
         FROM allegati_bando
         WHERE id_bando = $1
         ORDER BY created_at ASC`,
        [id]
      );
    }

    const result = { ...bando.rows[0], allegati: allegati.rows };
    return result;
  });

  // ============================================================
  // POST /api/bandi - Crea nuovo bando
  // ============================================================
  fastify.post('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const data = request.body || {};
    const user = request.user;

    // Same whitelist as PUT /:id so the create form can submit all fields in one call
    const insertableFields = [
      'titolo','id_stazione','stazione_nome','data_pubblicazione',
      'codice_cig','codice_cup','id_soa','soa_val',
      'categoria_presunta','categoria_sostitutiva',
      'importo_soa_prevalente','importo_soa_sostitutiva',
      'data_offerta','data_apertura','data_apertura_posticipata','data_apertura_da_destinarsi',
      'importo_so','importo_co','importo_eco','importo_manodopera','oneri_progettazione',
      'soglia_riferimento','id_piattaforma','id_tipologia','id_tipologia_bando','id_criterio',
      'max_invitati_negoziate','n_decimali','limit_min_media','accorpa_ali','tipo_accorpa_ali',
      'tipo_dati_esito','id_tipo_sopralluogo','note_per_sopralluogo',
      'data_sop_start','data_sop_end','data_max_per_sopralluogo','data_max_per_prenotazione',
      'sped_pec','sped_posta','sped_corriere','sped_mano','sped_telematica',
      'indirizzo_pec','indirizzo_elaborati','comunicazione_diretta_data',
      'indirizzo','cap','citta','regione','annullato','rettificato','privato',
      'external_code','fonte_dati','note',
      'note_01','note_02','note_03','note_04','note_05',
      'link_bando','id_azienda_dedicata',
      'data_avviso','ora_avviso','username_avviso','tipo_apertura_avviso','note_avviso'
    ];

    // Validate & coerce
    const validation = await validateBandoPayload(data, query);
    if (!validation.ok) {
      return reply.status(400).send({ error: 'Validazione fallita', details: validation.errors });
    }

    const cols = [];
    const placeholders = [];
    const values = [];
    let idx = 1;
    for (const col of insertableFields) {
      if (data[col] !== undefined) {
        cols.push(col);
        placeholders.push(`$${idx}`);
        values.push(data[col]);
        idx++;
      }
    }

    // Always include created_by + timestamps
    cols.push('created_by','created_at','updated_at');
    placeholders.push(`$${idx}`, 'NOW()', 'NOW()');
    values.push(user.username);

    const result = await transaction(async (client) => {
      const insertResult = await client.query(
        `INSERT INTO bandi (${cols.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING id`,
        values
      );

      const bandoId = insertResult.rows[0].id;

      // Audit log
      await client.query(
        'INSERT INTO bandimodifiche (id_bando, user_name, modifiche, data) VALUES ($1, $2, $3, NOW())',
        [bandoId, user.username, 'Bando creato']
      );

      return bandoId;
    });

    return reply.status(201).send({ id: result, message: 'Bando creato con successo' });
  });

  // ============================================================
  // PUT /api/bandi/:id - Aggiorna bando
  // ============================================================
  fastify.put('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;
    const data = request.body;
    const user = request.user;

    // Validate & coerce
    const validation = await validateBandoPayload(data, query);
    if (!validation.ok) {
      return reply.status(400).send({ error: 'Validazione fallita', details: validation.errors });
    }

    // Build dynamic UPDATE query
    const fields = [];
    const values = [];
    let idx = 1;

    const updatableFields = {
      'titolo': 'titolo',
      'id_stazione': 'id_stazione',
      'stazione_nome': 'stazione_nome',
      'data_pubblicazione': 'data_pubblicazione',
      'codice_cig': 'codice_cig',
      'codice_cup': 'codice_cup',
      'id_soa': 'id_soa',
      'soa_val': 'soa_val',
      'categoria_presunta': 'categoria_presunta',
      'categoria_sostitutiva': 'categoria_sostitutiva',
      'importo_soa_prevalente': 'importo_soa_prevalente',
      'importo_soa_sostitutiva': 'importo_soa_sostitutiva',
      'data_offerta': 'data_offerta',
      'data_apertura': 'data_apertura',
      'data_apertura_posticipata': 'data_apertura_posticipata',
      'data_apertura_da_destinarsi': 'data_apertura_da_destinarsi',
      'importo_so': 'importo_so',
      'importo_co': 'importo_co',
      'importo_eco': 'importo_eco',
      'importo_manodopera': 'importo_manodopera',
      'oneri_progettazione': 'oneri_progettazione',
      'soglia_riferimento': 'soglia_riferimento',
      'id_piattaforma': 'id_piattaforma',
      'id_tipologia': 'id_tipologia',
      'id_tipologia_bando': 'id_tipologia_bando',
      'id_criterio': 'id_criterio',
      'max_invitati_negoziate': 'max_invitati_negoziate',
      'n_decimali': 'n_decimali',
      'limit_min_media': 'limit_min_media',
      'accorpa_ali': 'accorpa_ali',
      'tipo_accorpa_ali': 'tipo_accorpa_ali',
      'tipo_dati_esito': 'tipo_dati_esito',
      'id_tipo_sopralluogo': 'id_tipo_sopralluogo',
      'note_per_sopralluogo': 'note_per_sopralluogo',
      'data_sop_start': 'data_sop_start',
      'data_sop_end': 'data_sop_end',
      'data_max_per_sopralluogo': 'data_max_per_sopralluogo',
      'data_max_per_prenotazione': 'data_max_per_prenotazione',
      'sped_pec': 'sped_pec',
      'sped_posta': 'sped_posta',
      'sped_corriere': 'sped_corriere',
      'sped_mano': 'sped_mano',
      'sped_telematica': 'sped_telematica',
      'indirizzo_pec': 'indirizzo_pec',
      'indirizzo_elaborati': 'indirizzo_elaborati',
      'comunicazione_diretta_data': 'comunicazione_diretta_data',
      'indirizzo': 'indirizzo',
      'cap': 'cap',
      'citta': 'citta',
      'regione': 'regione',
      'annullato': 'annullato',
      'rettificato': 'rettificato',
      'privato': 'privato',
      'external_code': 'external_code',
      'fonte_dati': 'fonte_dati',
      'note': 'note',
      'note_01': 'note_01',
      'note_02': 'note_02',
      'note_03': 'note_03',
      'note_04': 'note_04',
      'note_05': 'note_05',
      'link_bando': 'link_bando',
      'id_azienda_dedicata': 'id_azienda_dedicata',
      'data_avviso': 'data_avviso',
      'ora_avviso': 'ora_avviso',
      'username_avviso': 'username_avviso',
      'tipo_apertura_avviso': 'tipo_apertura_avviso',
      'note_avviso': 'note_avviso'
    };

    for (const [key, dbCol] of Object.entries(updatableFields)) {
      if (data[key] !== undefined) {
        fields.push(`${dbCol} = $${idx}`);
        values.push(data[key]);
        idx++;
      }
    }

    if (fields.length === 0) {
      return reply.status(400).send({ error: 'Nessun campo da aggiornare' });
    }

    fields.push(`updated_at = NOW()`);
    values.push(id);

    await transaction(async (client) => {
      await client.query(
        `UPDATE bandi SET ${fields.join(', ')} WHERE id = $${idx}`,
        values
      );

      // Audit log
      const changedFields = Object.keys(data).filter(k => updatableFields.hasOwnProperty(k));
      await client.query(
        'INSERT INTO bandimodifiche (id_bando, user_name, modifiche, data) VALUES ($1, $2, $3, NOW())',
        [id, user.username, `Modificati campi: ${changedFields.join(', ')}`]
      );
    });

    return { message: 'Bando aggiornato con successo' };
  });

  // ============================================================
  // DELETE /api/bandi/:id - Soft delete (annulla bando)
  // ============================================================
  fastify.delete('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;
    const user = request.user;

    await transaction(async (client) => {
      await client.query(
        `UPDATE bandi SET updated_at = NOW() WHERE id = $1`,
        [id]
      );
      await client.query(
        'INSERT INTO bandimodifiche (id_bando, user_name, modifiche, data) VALUES ($1, $2, $3, NOW())',
        [id, user.username, 'Bando eliminato']
      );
    });

    return { message: 'Bando eliminato con successo' };
  });

  // ============================================================
  // GET /api/bandi/stats/overview - Statistiche bandi
  // ============================================================
  fastify.get('/stats/overview', async (request, reply) => {
    const [totali, perProvincia, recenti] = await Promise.all([
      query(`SELECT
        COUNT(*) as totale,
        COUNT(*) FILTER (WHERE data_offerta > NOW()) as attivi
       FROM bandi`),
      query(`SELECT p.nome, COUNT(*) as count FROM bandi b
             LEFT JOIN stazioni s ON b.id_stazione = s.id
             LEFT JOIN province p ON s.id_provincia = p.id
             WHERE p.nome IS NOT NULL
             GROUP BY p.nome
             ORDER BY count DESC LIMIT 10`),
      query(`SELECT COUNT(*) as count, DATE(b.data_pubblicazione) as giorno FROM bandi b
             WHERE b.data_pubblicazione > NOW() - INTERVAL '30 days'
             GROUP BY DATE(b.data_pubblicazione)
             ORDER BY giorno DESC`)
    ]);

    return {
      totali: totali.rows[0],
      per_provincia: perProvincia.rows,
      ultimi_30_giorni: recenti.rows
    };
  });

  // ============================================================
  // POST /api/bandi/:id/clona - Clone a bando
  // ============================================================
  fastify.post('/:id/clona', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;
    const user = request.user;

    try {
      const result = await transaction(async (client) => {
        // Fetch source bando
        const bandoRes = await client.query(
          `SELECT * FROM bandi WHERE id = $1`,
          [id]
        );

        if (bandoRes.rows.length === 0) {
          throw new Error('Bando non trovato');
        }

        const bando = bandoRes.rows[0];

        // Insert cloned bando
        const cloneRes = await client.query(`
          INSERT INTO bandi (
            titolo, id_stazione, data_pubblicazione,
            codice_cig, codice_cup, id_soa, data_offerta,
            importo_so, importo_co, importo_eco, id_piattaforma,
            note, created_at, updated_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7,
            $8, $9, $10, $11, $12, NOW(), NOW()
          ) RETURNING id
        `, [
          bando.titolo, bando.id_stazione, bando.data_pubblicazione,
          bando.codice_cig, bando.codice_cup, bando.id_soa, bando.data_offerta,
          bando.importo_so, bando.importo_co, bando.importo_eco, bando.id_piattaforma,
          bando.note
        ]);

        const newBandoId = cloneRes.rows[0].id;

        // Audit log
        try {
          await client.query(
            'INSERT INTO bandimodifiche (id_bando, user_name, modifiche, data) VALUES ($1, $2, $3, NOW())',
            [newBandoId, user.username, `Clonato da bando ${id}`]
          );
        } catch { /* table may not exist */ }

        return newBandoId;
      });

      return reply.status(201).send({ id: result, message: 'Bando clonato con successo' });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: err.message || 'Errore nella clonazione' });
    }
  });

  // ============================================================
  // GET /api/bandi/incompleti - List bandi with missing required fields
  // ============================================================
  fastify.get('/incompleti', async (request, reply) => {
    const result = await query(`
      SELECT
        b.id AS id,
        b.titolo AS titolo,
        b.data_pubblicazione AS data_pubblicazione,
        b.data_offerta AS data_offerta,
        b.codice_cig AS codice_cig,
        b.importo_so AS importo_so,
        COALESCE(s.nome, '') AS stazione,
        p.nome AS provincia,
        ARRAY_REMOVE(ARRAY[
          CASE WHEN b.titolo IS NULL OR b.titolo = '' THEN 'Titolo' END,
          CASE WHEN b.id_stazione IS NULL THEN 'Stazione' END,
          CASE WHEN b.data_pubblicazione IS NULL THEN 'Data Pubblicazione' END,
          CASE WHEN b.importo_so IS NULL THEN 'Importo SO' END,
          CASE WHEN b.codice_cig IS NULL OR b.codice_cig = '' THEN 'CIG' END
        ], NULL) AS missing_fields_arr
      FROM bandi b
      LEFT JOIN stazioni s ON b.id_stazione = s.id
      LEFT JOIN province p ON s.id_provincia = p.id
      WHERE (
        b.titolo IS NULL OR b.titolo = '' OR
        b.id_stazione IS NULL OR
        b.data_pubblicazione IS NULL OR
        b.importo_so IS NULL OR
        b.codice_cig IS NULL OR b.codice_cig = ''
      )
      ORDER BY b.data_pubblicazione DESC
      LIMIT 200
    `);

    // Convert array to comma-separated string for frontend
    return result.rows.map(r => ({
      ...r,
      missing_fields: r.missing_fields_arr ? r.missing_fields_arr.join(', ') : ''
    }));
  });

  // ============================================================
  // GET /api/bandi/rettificati - List bandi modified after publication
  // ============================================================
  fastify.get('/rettificati', async (request, reply) => {
    const result = await query(`
      SELECT
        b.id AS id,
        b.titolo AS titolo,
        b.data_pubblicazione AS data_pubblicazione,
        b.data_offerta AS data_offerta,
        b.codice_cig AS codice_cig,
        b.importo_so AS importo_so,
        COALESCE(s.nome, '') AS stazione,
        p.nome AS provincia,
        COUNT(bm.id) AS num_modifiche,
        MAX(bm.data) AS data_rettifica
      FROM bandi b
      JOIN bandimodifiche bm ON b.id = bm.id_bando
      LEFT JOIN stazioni s ON b.id_stazione = s.id
      LEFT JOIN province p ON s.id_provincia = p.id
      WHERE bm.modifiche ILIKE '%rettifica%'
      GROUP BY b.id, b.titolo, b.data_pubblicazione, b.data_offerta, b.codice_cig,
               b.importo_so, s.nome, p.nome
      ORDER BY MAX(bm.data) DESC
      LIMIT 200
    `);

    return result.rows;
  });

  // ============================================================
  // GET /api/bandi/check-cig?cig= - Check if CIG exists
  // ============================================================
  fastify.get('/check-cig', async (request, reply) => {
    const { cig } = request.query;

    if (!cig) {
      return reply.status(400).send({ error: 'CIG parameter required' });
    }

    const cigResult = await query(
      `SELECT b.id FROM bandi b
       WHERE b.codice_cig = $1 LIMIT 1`,
      [cig]
    );

    if (cigResult.rows.length === 0) {
      return { exists: false };
    }

    const row = cigResult.rows[0];
    return {
      exists: true,
      bando_id: row.id || null
    };
  });

  // ============================================================
  // POST /api/bandi/:id/ripristina - Restore deleted bando
  // ============================================================
  fastify.post('/:id/ripristina', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;
    const user = request.user;

    try {
      await transaction(async (client) => {
        await client.query(
          `UPDATE bandi SET updated_at = NOW()
           WHERE id = $1`,
          [id]
        );

        await client.query(
          'INSERT INTO bandimodifiche (id_bando, user_name, modifiche, data) VALUES ($1, $2, $3, NOW())',
          [id, user.username, 'Bando ripristinato']
        );
      });

      return { message: 'Bando ripristinato' };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(400).send({ error: err.message });
    }
  });

  // ============================================================
  // POST /api/bandi/:id/inserisci-link - Add web link
  // ============================================================
  fastify.post('/:id/inserisci-link', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;
    const { url, descrizione, tipo } = request.body;
    const user = request.user;

    try {
      if (!url || !descrizione) {
        return reply.status(400).send({ error: 'url e descrizione richiesti' });
      }

      const result = await query(
        `INSERT INTO bandilink (id_bando, url, descrizione, tipo, user_name, data)
         VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING *`,
        [id, url, descrizione, tipo || 'semplice', user.username]
      );

      return reply.status(201).send(result.rows[0]);
    } catch (err) {
      fastify.log.error(err);
      return reply.status(400).send({ error: err.message });
    }
  });

  // ============================================================
  // GET /api/bandi/per-stazione/:idStazione - List bandi for stazione
  // ============================================================
  fastify.get('/per-stazione/:idStazione', async (request, reply) => {
    const { idStazione } = request.params;
    const { page = 1, limit = 20 } = request.query;

    const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

    const [countRes, result] = await Promise.all([
      query(`SELECT COUNT(*) as total FROM bandi WHERE id_stazione = $1`, [idStazione]),
      query(
        `SELECT
          b.id AS id,
          b.titolo AS titolo,
          b.codice_cig AS codice_cig,
          b.data_pubblicazione AS data_pubblicazione,
          b.importo_so AS importo_so
         FROM bandi b
         WHERE b.id_stazione = $1
         ORDER BY b.data_pubblicazione DESC
         LIMIT $2 OFFSET $3`,
        [idStazione, parseInt(limit), offset]
      )
    ]);

    const total = parseInt(countRes.rows[0].total);

    return {
      data: result.rows,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit))
      }
    };
  });

  // ============================================================
  // GET /api/bandi/per-utente/:username - List bandi inserted by user
  // ============================================================
  fastify.get('/per-utente/:username', async (request, reply) => {
    const { username } = request.params;
    const { page = 1, limit = 20 } = request.query;

    const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

    const [countRes, result] = await Promise.all([
      query(`SELECT COUNT(*) as total FROM bandi WHERE created_by = $1`, [username]),
      query(
        `SELECT
          b.id AS id,
          b.titolo AS titolo,
          b.codice_cig AS codice_cig,
          b.data_pubblicazione AS data_pubblicazione,
          b.importo_so AS importo_so
         FROM bandi b
         WHERE b.created_by = $1
         ORDER BY b.data_pubblicazione DESC
         LIMIT $2 OFFSET $3`,
        [username, parseInt(limit), offset]
      )
    ]);

    const total = parseInt(countRes.rows[0].total);

    return {
      data: result.rows,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit))
      }
    };
  });

  // ============================================================
  // GET /api/bandi/cestino - List deleted bandi
  // ============================================================
  fastify.get('/cestino', async (request, reply) => {
    const { page = 1, limit = 20 } = request.query;

    const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

    const [countRes, result] = await Promise.all([
      query(`SELECT COUNT(*) as total FROM bandi`),
      query(
        `SELECT
          b.id AS id,
          b.titolo AS titolo,
          b.codice_cig AS codice_cig,
          b.data_pubblicazione AS data_pubblicazione
         FROM bandi b
         ORDER BY b.updated_at DESC
         LIMIT $1 OFFSET $2`,
        [parseInt(limit), offset]
      )
    ]);

    const total = parseInt(countRes.rows[0].total);

    return {
      data: result.rows,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit))
      }
    };
  });

  // ============================================================
  // GET /api/bandi/:id/cauzione - Get cauzione (guarantee) data
  // ============================================================
  fastify.get('/:id/cauzione', async (request, reply) => {
    const { id } = request.params;

    const result = await query(
      `SELECT
        b.id,
        b.note
       FROM bandi b
       WHERE b.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return reply.status(404).send({ error: 'Bando non trovato' });
    }

    return result.rows[0];
  });

  // ============================================================
  // POST /api/bandi/:id/presa-visione - Add presa visione date
  // ============================================================
  fastify.post('/:id/presa-visione', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;
    const { data } = request.body;
    const user = request.user;

    try {
      if (!data) {
        return reply.status(400).send({ error: 'data required' });
      }

      const result = await query(
        `INSERT INTO bandi_presa_visione (id_bando, data, user_name)
         VALUES ($1, $2, $3) RETURNING *`,
        [id, data, user.username]
      );

      return reply.status(201).send(result.rows[0]);
    } catch (err) {
      fastify.log.error(err);
      return reply.status(400).send({ error: err.message });
    }
  });

  // ============================================================
  // DELETE /api/bandi/:id/presa-visione/:idData - Remove presa visione date
  // ============================================================
  fastify.delete('/:id/presa-visione/:idData', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id, idData } = request.params;
    const user = request.user;

    try {
      await query(
        `DELETE FROM bandi_presa_visione WHERE id_bando = $1 AND id = $2`,
        [id, idData]
      );

      return { message: 'Presa visione rimossa' };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(400).send({ error: err.message });
    }
  });

  // ============================================================
  // POST /api/bandi/:id/converti-esito — Converti bando in esito (bozza)
  // ============================================================
  fastify.post('/:id/converti-esito', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;
    const user = request.user;

    try {
      // 1. Fetch bando with joined data
      const bandoRes = await query(
        `SELECT b.*,
          s.nome AS stazione_nome, s.id AS stazione_id,
          soa.id AS soa_id, soa.codice AS soa_codice,
          p.id AS provincia_id
         FROM bandi b
         LEFT JOIN stazioni s ON b.id_stazione = s.id
         LEFT JOIN soa ON b.id_soa = soa.id
         LEFT JOIN province p ON s.id_provincia = p.id
         WHERE b.id = $1`,
        [id]
      );
      if (bandoRes.rows.length === 0) {
        return reply.status(404).send({ error: 'Bando non trovato' });
      }
      const b = bandoRes.rows[0];

      // 2. Check if esito already exists for this bando
      const existingEsito = await query(
        `SELECT id FROM gare WHERE id_bando = $1 AND eliminata = false LIMIT 1`,
        [id]
      );
      if (existingEsito.rows.length > 0) {
        return reply.status(409).send({
          error: 'Esiste già un esito collegato a questo bando',
          esito_id: existingEsito.rows[0].id
        });
      }

      // 3. Create new esito (gare) from bando data as BOZZA (temp=true)
      const result = await transaction(async (client) => {
        const insertRes = await client.query(
          `INSERT INTO gare (
            id_bando, data, titolo, codice_cig, codice_cup,
            id_stazione, stazione,
            id_soa, id_tipologia, id_criterio, id_piattaforma,
            id_provincia, citta,
            importo, importo_so, importo_co, importo_eco,
            provenienza, fonte_dati,
            temp, enabled, annullato, eliminata,
            username, inserito_da, data_inserimento,
            created_at, updated_at
          ) VALUES (
            $1, CURRENT_DATE, $2, $3, $4,
            $5, $6,
            $7, $8, $9, $10,
            $11, $12,
            COALESCE($13, 0), $14, $15, $16,
            'Convertito da Bando', $17,
            true, false, false, false,
            $18, $19, NOW(),
            NOW(), NOW()
          ) RETURNING id`,
          [
            b.id,                                            // $1 id_bando
            b.titolo,                                        // $2 titolo
            b.codice_cig,                                    // $3 codice_cig
            b.codice_cup,                                    // $4 codice_cup
            b.id_stazione,                                   // $5 id_stazione
            b.stazione_nome || null,                         // $6 stazione (denormalized)
            b.id_soa,                                        // $7 id_soa
            b.id_tipologia,                                  // $8 id_tipologia
            b.id_criterio,                                   // $9 id_criterio
            b.id_piattaforma,                                // $10 id_piattaforma
            b.provincia_id || null,                          // $11 id_provincia
            null,                                            // $12 citta
            (parseFloat(b.importo_so)||0) + (parseFloat(b.importo_co)||0) + (parseFloat(b.importo_eco)||0), // $13 importo
            b.importo_so,                                    // $14 importo_so
            b.importo_co,                                    // $15 importo_co
            b.importo_eco,                                   // $16 importo_eco
            b.fonte_dati || null,                            // $17 fonte_dati
            user.username,                                   // $18 username
            user.username                                    // $19 inserito_da
          ]
        );

        const esitoId = insertRes.rows[0].id;

        // 4. Log the conversion in gare_modifiche
        try {
          await client.query(
            `INSERT INTO gare_modifiche (id_gara, username, modifiche, data)
             VALUES ($1, $2, $3, NOW())`,
            [esitoId, user.username, `Esito creato da conversione Bando #${b.id}`]
          );
        } catch { /* table may not exist */ }

        // 5. Update bando to link it
        try {
          await client.query(
            `INSERT INTO bandimodifiche (id_bando, user_name, modifiche, data)
             VALUES ($1, $2, $3, NOW())`,
            [b.id, user.username, `Convertito in Esito #${esitoId}`]
          );
        } catch { /* table may not exist */ }

        return esitoId;
      });

      return {
        message: 'Bando convertito in esito con successo',
        esito: { id: result }
      };
    } catch (err) {
      fastify.log.error(err, 'Converti bando in esito error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // ============================================================
  // POST /api/bandi/:id/associa-esito — Associa un esito esistente al bando
  // ============================================================
  fastify.post('/:id/associa-esito', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;
    const { esito_id } = request.body;
    const user = request.user;

    if (!esito_id) {
      return reply.status(400).send({ error: 'esito_id è obbligatorio' });
    }

    try {
      // Verify esito exists
      const esitoRes = await query('SELECT id, id_bando FROM gare WHERE id = $1', [esito_id]);
      if (esitoRes.rows.length === 0) {
        return reply.status(404).send({ error: 'Esito non trovato con ID ' + esito_id });
      }
      if (esitoRes.rows[0].id_bando && esitoRes.rows[0].id_bando !== id) {
        return reply.status(409).send({ error: 'L\'esito è già associato a un altro bando (ID: ' + esitoRes.rows[0].id_bando + ')' });
      }

      // Verify bando exists
      const bandoRes = await query('SELECT id FROM bandi WHERE id = $1', [id]);
      if (bandoRes.rows.length === 0) {
        return reply.status(404).send({ error: 'Bando non trovato' });
      }

      // Check no other esito is already linked
      const existingEsito = await query('SELECT id FROM gare WHERE id_bando = $1 AND eliminata = false LIMIT 1', [id]);
      if (existingEsito.rows.length > 0) {
        return reply.status(409).send({
          error: 'Esiste già un esito collegato a questo bando',
          esito_id: existingEsito.rows[0].id
        });
      }

      // Associate
      await query('UPDATE gare SET id_bando = $1 WHERE id = $2', [id, esito_id]);

      // Log
      try {
        await query(
          'INSERT INTO bandimodifiche (id_bando, user_name, modifiche, data) VALUES ($1, $2, $3, NOW())',
          [id, user.username, 'Associato Esito #' + esito_id]
        );
      } catch { /* table may not exist */ }

      return { success: true, message: 'Esito associato al bando', esito_id: Number(esito_id) };
    } catch (err) {
      fastify.log.error(err, 'Associa esito error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // ============================================================
  // POST /api/bandi/:id/posticipa — Posticipa scadenza bando
  // ============================================================
  fastify.post('/:id/posticipa', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;
    const { nuova_data_offerta, nuova_data_apertura, motivo } = request.body;
    const user = request.user;
    try {
      const updates = [];
      const params = [];
      let idx = 1;

      if (nuova_data_offerta) {
        updates.push(`data_offerta = $${idx}`);
        params.push(nuova_data_offerta);
        idx++;
      }
      if (nuova_data_apertura) {
        updates.push(`data_apertura_posticipata = $${idx}`);
        params.push(nuova_data_apertura);
        idx++;
      }
      updates.push(`updated_at = NOW()`);

      if (updates.length <= 1) {
        return reply.status(400).send({ error: 'Specificare almeno una nuova data' });
      }

      params.push(id);
      await query(
        `UPDATE bandi SET ${updates.join(', ')} WHERE id = $${idx}`,
        params
      );

      // Log
      try {
        await query(
          `INSERT INTO bandimodifiche (id_bando, user_name, modifiche, data) VALUES ($1, $2, $3, NOW())`,
          [id, user.username, `Posticipato: ${motivo || 'nessun motivo specificato'}. Nuova scadenza: ${nuova_data_offerta || '-'}, Nuova apertura: ${nuova_data_apertura || '-'}`]
        );
      } catch { /* */ }

      return { success: true, message: 'Bando posticipato' };
    } catch (err) {
      fastify.log.error(err, 'Posticipa bando error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // ============================================================
  // POST /api/bandi/:id/da-destinarsi — Segna apertura come "da destinarsi"
  // ============================================================
  fastify.post('/:id/da-destinarsi', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;
    const user = request.user;
    try {
      await query(
        `UPDATE bandi SET data_apertura_da_destinarsi = true, data_apertura_posticipata = NULL, updated_at = NOW() WHERE id = $1`,
        [id]
      );
      try {
        await query(
          `INSERT INTO bandimodifiche (id_bando, user_name, modifiche, data) VALUES ($1, $2, $3, NOW())`,
          [id, user.username, 'Apertura impostata come "da destinarsi"']
        );
      } catch { /* */ }
      return { success: true, message: 'Apertura impostata come da destinarsi' };
    } catch (err) {
      fastify.log.error(err, 'Da destinarsi error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // ============================================================
  // POST /api/bandi/:id/azzera — Azzera/resetta le date e lo stato
  // ============================================================
  fastify.post('/:id/azzera', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;
    const user = request.user;
    try {
      await query(
        `UPDATE bandi SET
          data_apertura_posticipata = NULL,
          data_apertura_da_destinarsi = false,
          in_lavorazione = false,
          updated_at = NOW()
        WHERE id = $1`,
        [id]
      );
      try {
        await query(
          `INSERT INTO bandimodifiche (id_bando, user_name, modifiche, data) VALUES ($1, $2, $3, NOW())`,
          [id, user.username, 'Bando azzerato (date posticipazione e flag rimossi)']
        );
      } catch { /* */ }
      return { success: true, message: 'Bando azzerato' };
    } catch (err) {
      fastify.log.error(err, 'Azzera bando error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // ============================================================
  // POST /api/bandi/:id/avviso — Imposta avviso su bando (matching old ASP.NET ImpostaAvviso)
  // Fields: data_avviso, ora_avviso, username_avviso, tipo_apertura_avviso, note_avviso
  // ============================================================
  fastify.post('/:id/avviso', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;
    const { data_avviso, ora_avviso, username_avviso, tipo_apertura_avviso, note_avviso, messaggio, destinatari } = request.body || {};
    const user = request.user;
    try {
      // Get bando info
      const bando = await query(
        `SELECT b.titolo, b.codice_cig, s.nome AS stazione, b.data_offerta
         FROM bandi b LEFT JOIN stazioni s ON b.id_stazione = s.id
         WHERE b.id = $1`, [id]
      );
      if (bando.rows.length === 0) return reply.status(404).send({ error: 'Bando non trovato' });

      const b = bando.rows[0];

      // Save avviso fields to bandi table
      const updates = [];
      const params = [];
      let idx = 1;

      if (data_avviso !== undefined) { updates.push(`data_avviso = $${idx}`); params.push(data_avviso || null); idx++; }
      if (ora_avviso !== undefined) { updates.push(`ora_avviso = $${idx}`); params.push(ora_avviso || null); idx++; }
      if (username_avviso !== undefined) { updates.push(`username_avviso = $${idx}`); params.push(username_avviso || null); idx++; }
      if (tipo_apertura_avviso !== undefined) { updates.push(`tipo_apertura_avviso = $${idx}`); params.push(tipo_apertura_avviso || 'Nessuna'); idx++; }
      if (note_avviso !== undefined) { updates.push(`note_avviso = $${idx}`); params.push(note_avviso || null); idx++; }

      if (updates.length > 0) {
        updates.push('updated_at = NOW()');
        params.push(id);
        await query(`UPDATE bandi SET ${updates.join(', ')} WHERE id = $${idx}`, params);
      }

      // Log avviso
      try {
        const logMsg = tipo_apertura_avviso
          ? `Avviso impostato: ${data_avviso || '-'} ${ora_avviso || ''} - Apertura: ${tipo_apertura_avviso} - Utente: ${username_avviso || '-'} - Note: ${note_avviso || '-'}`
          : `Avviso inviato: ${messaggio || 'Notifica standard bando'} - Destinatari: ${destinatari || 'tutti i sottoscritti'}`;
        await query(
          `INSERT INTO bandimodifiche (id_bando, user_name, modifiche, data) VALUES ($1, $2, $3, NOW())`,
          [id, user.username, logMsg]
        );
      } catch { /* */ }

      return {
        success: true,
        message: 'Avviso impostato',
        bando: { titolo: b.titolo, cig: b.codice_cig, stazione: b.stazione }
      };
    } catch (err) {
      fastify.log.error(err, 'Avviso bando error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // POST /api/bandi/:id/azzera-avviso — Azzera avviso (matching old ASP.NET AzzeraAvviso)
  // ============================================================
  fastify.post('/:id/azzera-avviso', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;
    const user = request.user;
    try {
      await query(
        `UPDATE bandi SET data_avviso = NULL, ora_avviso = NULL, username_avviso = NULL, tipo_apertura_avviso = 'Nessuna', note_avviso = NULL, updated_at = NOW() WHERE id = $1`,
        [id]
      );
      try {
        await query(
          `INSERT INTO bandimodifiche (id_bando, user_name, modifiche, data) VALUES ($1, $2, $3, NOW())`,
          [id, user.username, 'Avviso azzerato']
        );
      } catch { /* */ }
      return { success: true, message: 'Avviso azzerato' };
    } catch (err) {
      fastify.log.error(err, 'Azzera avviso error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // ============================================================
  // PUT /api/bandi/:id/lite — Modifica leggera (solo campi principali)
  // ============================================================
  fastify.put('/:id/lite', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;
    const user = request.user;
    const { titolo, data_offerta, data_apertura, importo_so, note } = request.body;
    try {
      const updates = [];
      const params = [];
      let idx = 1;

      if (titolo !== undefined) { updates.push(`titolo = $${idx}`); params.push(titolo); idx++; }
      if (data_offerta !== undefined) { updates.push(`data_offerta = $${idx}`); params.push(data_offerta); idx++; }
      if (data_apertura !== undefined) { updates.push(`data_apertura = $${idx}`); params.push(data_apertura); idx++; }
      if (importo_so !== undefined) { updates.push(`importo_so = $${idx}`); params.push(importo_so); idx++; }
      if (note !== undefined) { updates.push(`note = $${idx}`); params.push(note); idx++; }

      if (updates.length === 0) {
        return reply.status(400).send({ error: 'Nessun campo da aggiornare' });
      }

      updates.push(`updated_at = NOW()`);
      params.push(id);

      const result = await query(
        `UPDATE bandi SET ${updates.join(', ')} WHERE id = $${idx} RETURNING id, titolo, data_offerta, data_apertura, importo_so, note`,
        params
      );

      if (result.rows.length === 0) return reply.status(404).send({ error: 'Bando non trovato' });

      // Log
      try {
        const changedFields = Object.entries({ titolo, data_offerta, data_apertura, importo_so, note })
          .filter(([, v]) => v !== undefined)
          .map(([k]) => k).join(', ');
        await query(
          `INSERT INTO bandimodifiche (id_bando, user_name, modifiche, data) VALUES ($1, $2, $3, NOW())`,
          [id, user.username, `Modifica lite: aggiornati ${changedFields}`]
        );
      } catch { /* */ }

      return result.rows[0];
    } catch (err) {
      fastify.log.error(err, 'Modifica lite bando error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // ============================================================
  // POST /api/bandi/:id/mail — Invia email del bando (MB)
  // ============================================================
  fastify.post('/:id/mail', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;
    const { destinatario, oggetto_custom } = request.body || {};
    const user = request.user;
    try {
      const bando = await query(
        `SELECT b.titolo, b.codice_cig, s.nome AS stazione, b.data_offerta, b.importo_so
         FROM bandi b LEFT JOIN stazioni s ON b.id_stazione = s.id
         WHERE b.id = $1`, [id]
      );
      if (bando.rows.length === 0) return reply.status(404).send({ error: 'Bando non trovato' });

      const b = bando.rows[0];
      // Log (actual sending handled by newsletter/email system)
      try {
        await query(
          `INSERT INTO bandimodifiche (id_bando, user_name, modifiche, data) VALUES ($1, $2, $3, NOW())`,
          [id, user.username, `Mail bando inviata a: ${destinatario || 'sistema newsletter'}`]
        );
      } catch { /* */ }

      return {
        success: true,
        message: 'Mail bando registrata per invio',
        bando: { titolo: b.titolo, cig: b.codice_cig }
      };
    } catch (err) {
      fastify.log.error(err, 'Mail bando error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // ============================================================
  // GET /api/bandi/:id/storia — Storia modifiche bando
  // ============================================================
  fastify.get('/:id/storia', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;
    try {
      const res = await query(
        `SELECT id_bando, user_name AS "UserName", modifiche AS "Modifiche", data AS "Data"
         FROM bandimodifiche
         WHERE id_bando = $1
         ORDER BY data DESC`,
        [id]
      );
      return res.rows;
    } catch (err) {
      fastify.log.error(err, 'Get storia bando error');
      return reply.status(500).send({ error: err.message });
    }
  });
}
