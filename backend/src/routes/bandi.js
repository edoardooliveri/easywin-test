import { query, transaction } from '../db/pool.js';

export default async function bandiRoutes(fastify, opts) {

  // ============================================================
  // GET /api/bandi - Lista bandi con filtri e paginazione
  // ============================================================
  fastify.get('/', async (request, reply) => {
    const {
      page = 1,
      limit = 20,
      search,
      regione,
      id_stazione,
      id_soa,
      id_tipologia,
      id_criterio,
      data_dal,
      data_al,
      provenienza,
      sort = 'data_pubblicazione',
      order = 'DESC'
    } = request.query;

    const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);
    const conditions = ['b.annullato = false'];
    const params = [];
    let paramIdx = 1;

    if (search) {
      conditions.push(`(b.titolo ILIKE $${paramIdx} OR b.codice_cig ILIKE $${paramIdx} OR b.codice_cup ILIKE $${paramIdx} OR COALESCE(b.stazione_nome, '') ILIKE $${paramIdx})`);
      params.push(`%${search}%`);
      paramIdx++;
    }
    if (regione) {
      conditions.push(`b.regione = $${paramIdx}`);
      params.push(regione);
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
    if (provenienza) {
      conditions.push(`b.provenienza = $${paramIdx}`);
      params.push(provenienza);
      paramIdx++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Validate sort column to prevent SQL injection
    const allowedSorts = ['data_pubblicazione', 'titolo', 'importo_so', 'data_offerta'];
    const sortCol = allowedSorts.includes(sort) ? `b.${sort}` : 'b.data_pubblicazione';
    const sortOrder = order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    // Count total
    const countResult = await query(
      `SELECT COUNT(*) as total FROM bandi b ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].total);

    // Get results - aliases map CamelCase DB cols to snake_case API output
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
        COALESCE(b.importo_so, 0) + COALESCE(b.importo_co, 0) + COALESCE(b.importo_eco, 0) AS importo_totale,
        b.regione AS regione,
        b.citta AS citta,
        b.provenienza AS provenienza,
        b.privato AS privato,
        b.fonte_dati AS fonte_dati,
        b.external_code AS external_code,
        COALESCE(b.stazione_nome, s.nome) AS stazione,
        s.sito_web AS stazione_sito_web,
        soa.codice AS soa_codice,
        soa.descrizione AS soa_descrizione,
        tg.nome AS tipologia,
        c.nome AS criterio,
        p2.nome AS piattaforma_nome,
        p2.url AS piattaforma_url
       FROM bandi b
       LEFT JOIN stazioni s ON b.id_stazione = s.id
       LEFT JOIN soa ON b.id_soa = soa.id
       LEFT JOIN tipologia_gare tg ON b.id_tipologia = tg.id
       LEFT JOIN criteri c ON b.id_criterio = c.id
       LEFT JOIN piattaforme p2 ON b.id_piattaforma = p2.id
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
      }
    };
  });

  // ============================================================
  // GET /api/bandi/:id - Dettaglio bando completo
  // ============================================================
  fastify.get('/:id', async (request, reply) => {
    const { id } = request.params;

    const bando = await query(
      `SELECT b.*,
        s.nome AS stazione_rel_nome, s.citta AS stazione_citta,
        s.sito_web AS stazione_sito_web, s.email AS stazione_email, s.tel AS stazione_tel,
        soa.codice AS soa_codice, soa.descrizione AS soa_descrizione,
        tg.nome AS tipologia_nome,
        tb.nome AS tipologia_bando_nome,
        c.nome AS criterio_nome,
        p.nome AS piattaforma_nome, p.url AS piattaforma_url
       FROM bandi b
       LEFT JOIN stazioni s ON b.id_stazione = s.id
       LEFT JOIN soa ON b.id_soa = soa.id
       LEFT JOIN tipologia_gare tg ON b.id_tipologia = tg.id
       LEFT JOIN tipologia_bandi tb ON b.id_tipologia_bando = tb.id
       LEFT JOIN criteri c ON b.id_criterio = c.id
       LEFT JOIN piattaforme p ON b.id_piattaforma = p.id
       WHERE b.id = $1`,
      [id]
    );

    if (bando.rows.length === 0) {
      return reply.status(404).send({ error: 'Bando non trovato' });
    }

    // Fetch related data in parallel
    const [soaSec, soaAlt, soaApp, allegati, province, sopralluoghiDate] = await Promise.all([
      query(`SELECT bs.id_bando, bs.id_soa, s.codice, s.descrizione FROM bandi_soa_sec bs JOIN soa s ON bs.id_soa = s.id WHERE bs.id_bando = $1`, [id]),
      query(`SELECT bs.id_bando, bs.id_soa, s.codice, s.descrizione FROM bandi_soa_alt bs JOIN soa s ON bs.id_soa = s.id WHERE bs.id_bando = $1`, [id]),
      query(`SELECT bs.id_bando, bs.id_soa, s.codice, s.descrizione FROM bandi_soa_app bs JOIN soa s ON bs.id_soa = s.id WHERE bs.id_bando = $1`, [id]),
      query(`SELECT id_bando, nome_file, documento, last_update, user_name FROM allegati_bando WHERE id_bando = $1 ORDER BY last_update DESC`, [id]),
      query(`SELECT bp.id_bando, bp.id_provincia, p.nome, p.sigla FROM bandi_province bp JOIN province p ON bp.id_provincia = p.id WHERE bp.id_bando = $1`, [id]),
      query(`SELECT id_bando FROM date_sopralluoghi WHERE id_bando = $1`, [id]),
    ]);

    return {
      ...bando.rows[0],
      soa_sec: soaSec.rows,
      soa_alt: soaAlt.rows,
      soa_app: soaApp.rows,
      allegati: allegati.rows,
      province: province.rows,
      sopralluoghi_date: sopralluoghiDate.rows
    };
  });

  // ============================================================
  // POST /api/bandi - Crea nuovo bando
  // ============================================================
  fastify.post('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const data = request.body;
    const user = request.user;

    const result = await transaction(async (client) => {
      // Insert main bando
      const insertResult = await client.query(
        `INSERT INTO bandi (
          titolo, id_stazione, stazione_nome, data_pubblicazione,
          codice_cig, codice_cup, id_soa, soa_val,
          categoria_presunta, importo_so, importo_co, importo_eco,
          oneri_progettazione, importo_manodopera, importo_soa_prevalente,
          importo_soa_sostitutiva, soglia_riferimento,
          data_offerta, data_apertura, data_sop_start, data_sop_end,
          indirizzo, cap, citta, regione,
          id_tipologia, id_tipologia_bando, id_criterio, id_piattaforma,
          n_decimali, limit_min_media, acorpa_ali,
          id_tipo_sopralluogo, note_per_sopralluogo,
          sped_pec, sped_posta, sped_corriere, sped_mano, sped_telematica,
          indirizzo_pec, max_invitati_negoziate,
          provenienza, external_code, fonte_dati, note,
          inserito_da, privato
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
          $21, $22, $23, $24, $25, $26, $27, $28, $29, $30,
          $31, $32, $33, $34, $35, $36, $37, $38, $39, $40,
          $41, $42, $43, $44
        ) RETURNING id`,
        [
          data.Titolo, data.id_stazione, data.Stazione, data.DataPubblicazione,
          data.CodiceCIG, data.CodiceCUP, data.id_soa, data.SoaVal,
          data.CategoriaPresunta || false, data.ImportoSO, data.ImportoCO, data.ImportoEco,
          data.OneriProgettazione, data.ImportoManodopera, data.ImportoSoaPrevalente,
          data.ImportoSoaSostitutiva, data.SogliaRiferimento,
          data.DataOfferta, data.DataApertura, data.DataSopStart, data.DataSopEnd,
          data.Indirizzo, data.CAP, data.Citta, data.Regione,
          data.id_tipologia, data.id_tipologia_bando, data.id_criterio, data.id_piattaforma || null,
          data.NDecimali || 3, data.LimitMinMedia, data.AccorpaAli || false,
          data.id_tipo_sopralluogo || null, data.NotePerSopralluogo,
          data.SpedPEC || false, data.SpedPosta || false, data.SpedCorriere || false,
          data.SpedMano || false, data.SpedTelematica || false,
          data.IndirizzoPEC, data.MaxInvitatiNegoziate || 0,
          data.Provenienza || 'Manuale', data.ExternalCode, data.FonteDati, data.Note,
          user.username, data.Privato || false
        ]
      );

      const bandoId = insertResult.rows[0].id;

      // Insert SOA categories if provided
      if (data.soa_sec?.length) {
        for (const soa of data.soa_sec) {
          await client.query(
            'INSERT INTO bandi_soa_sec (id_bando, id_soa) VALUES ($1, $2)',
            [bandoId, soa.id_soa]
          );
        }
      }
      if (data.soa_alt?.length) {
        for (const soa of data.soa_alt) {
          await client.query(
            'INSERT INTO bandi_soa_alt (id_bando, id_soa) VALUES ($1, $2)',
            [bandoId, soa.id_soa]
          );
        }
      }
      if (data.soa_app?.length) {
        for (const soa of data.soa_app) {
          await client.query(
            'INSERT INTO bandi_soa_app (id_bando, id_soa) VALUES ($1, $2)',
            [bandoId, soa.id_soa]
          );
        }
      }

      // Insert province associations
      if (data.province?.length) {
        for (const prov of data.province) {
          await client.query(
            'INSERT INTO bandi_province (id_bando, id_provincia) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [bandoId, prov]
          );
        }
      }

      // Audit log
      await client.query(
        'INSERT INTO bandimodifiche (id_bando, user_name, modifiche) VALUES ($1, $2, $3)',
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

    // Build dynamic UPDATE query
    const fields = [];
    const values = [];
    let idx = 1;

    const updatableFields = {
      'Titolo': 'titolo',
      'id_stazione': 'id_stazione',
      'Stazione': 'stazione_nome',
      'DataPubblicazione': 'data_pubblicazione',
      'CodiceCIG': 'codice_cig',
      'CodiceCUP': 'codice_cup',
      'id_soa': 'id_soa',
      'SoaVal': 'soa_val',
      'CategoriaPresunta': 'categoria_presunta',
      'ImportoSO': 'importo_so',
      'ImportoCO': 'importo_co',
      'ImportoEco': 'importo_eco',
      'OneriProgettazione': 'oneri_progettazione',
      'ImportoManodopera': 'importo_manodopera',
      'ImportoSoaPrevalente': 'importo_soa_prevalente',
      'ImportoSoaSostitutiva': 'importo_soa_sostitutiva',
      'SogliaRiferimento': 'soglia_riferimento',
      'DataOfferta': 'data_offerta',
      'DataApertura': 'data_apertura',
      'DataSopStart': 'data_sop_start',
      'DataSopEnd': 'data_sop_end',
      'Indirizzo': 'indirizzo',
      'CAP': 'cap',
      'Citta': 'citta',
      'Regione': 'regione',
      'id_tipologia': 'id_tipologia',
      'id_tipologia_bando': 'id_tipologia_bando',
      'id_criterio': 'id_criterio',
      'id_piattaforma': 'id_piattaforma',
      'NDecimali': 'n_decimali',
      'LimitMinMedia': 'limit_min_media',
      'AccorpaAli': 'acorpa_ali',
      'id_tipo_sopralluogo': 'id_tipo_sopralluogo',
      'NotePerSopralluogo': 'note_per_sopralluogo',
      'Note': 'note',
      'SpedPEC': 'sped_pec',
      'SpedPosta': 'sped_posta',
      'SpedCorriere': 'sped_corriere',
      'SpedMano': 'sped_mano',
      'SpedTelematica': 'sped_telematica',
      'IndirizzoPEC': 'indirizzo_pec',
      'MaxInvitatiNegoziate': 'max_invitati_negoziate',
      'Annullato': 'annullato',
      'Privato': 'privato'
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

    fields.push(`modificato_da = $${idx}`, `data_modifica = NOW()`);
    values.push(user.username);
    idx++;

    values.push(id);

    await transaction(async (client) => {
      await client.query(
        `UPDATE bandi SET ${fields.join(', ')} WHERE id = $${idx}`,
        values
      );

      // Audit log
      const changedFields = Object.keys(data).filter(k => updatableFields.hasOwnProperty(k));
      await client.query(
        'INSERT INTO bandimodifiche (id_bando, user_name, modifiche) VALUES ($1, $2, $3)',
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
        `UPDATE bandi SET annullato = true, modificato_da = $1, data_modifica = NOW() WHERE id = $2`,
        [user.username, id]
      );
      await client.query(
        'INSERT INTO bandimodifiche (id_bando, user_name, modifiche) VALUES ($1, $2, $3)',
        [id, user.username, 'Bando annullato']
      );
    });

    return { message: 'Bando annullato con successo' };
  });

  // ============================================================
  // GET /api/bandi/:id/allegati - Lista allegati
  // ============================================================
  fastify.get('/:id/allegati', async (request, reply) => {
    const { id } = request.params;
    const result = await query(
      `SELECT id_bando, nome_file, documento, last_update, user_name,
              LENGTH(documento) AS file_size
       FROM allegati_bando WHERE id_bando = $1 ORDER BY last_update DESC`,
      [id]
    );
    return result.rows;
  });

  // ============================================================
  // POST /api/bandi/:id/allegati - Upload allegato
  // ============================================================
  fastify.post('/:id/allegati', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;
    const user = request.user;
    const parts = request.parts();

    const uploaded = [];
    for await (const part of parts) {
      if (part.type === 'file') {
        const buffer = await part.toBuffer();
        const result = await query(
          `INSERT INTO allegati_bando (id_bando, nome_file, documento, last_update, user_name)
           VALUES ($1, $2, $3, NOW(), $4) RETURNING id_bando, nome_file`,
          [id, part.filename, buffer, user.username]
        );
        uploaded.push(result.rows[0]);
      }
    }

    return reply.status(201).send({ uploaded, count: uploaded.length });
  });

  // ============================================================
  // GET /api/bandi/:id/storia - Audit trail
  // ============================================================
  fastify.get('/:id/storia', async (request, reply) => {
    const { id } = request.params;
    const result = await query(
      `SELECT id_bando, user_name, data, modifiche FROM bandimodifiche WHERE id_bando = $1 ORDER BY data DESC`,
      [id]
    );
    return result.rows;
  });

  // ============================================================
  // POST /api/bandi/:id/converti-esito - CONVERTI IN ESITO
  // Creates a new gare (esito) record from this bando, copying shared fields
  // Links them via gare.id_bando
  // ============================================================
  fastify.post('/:id/converti-esito', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;
    const user = request.user;

    try {
      // Fetch the bando with all its data
      const bandoRes = await query(
        `SELECT b.*, s.nome AS stazione_nome, s.citta AS stazione_citta,
                s.id AS stazione_id
         FROM bandi b
         LEFT JOIN stazioni s ON b.id_stazione = s.id
         WHERE b.id = $1 AND b.annullato = false`,
        [id]
      );

      if (bandoRes.rows.length === 0) {
        return reply.status(404).send({ error: 'Bando non trovato o annullato' });
      }

      const bando = bandoRes.rows[0];

      // Check if an esito already exists for this bando
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

      // Calculate total importo from bando (exact copy of stored procedure bandi_trasformaInEsito)
      // Original: ISNULL(ImportoSO, 0) + ISNULL(ImportoCO, 0) + ISNULL(ImportoEco, 0) + ISNULL(OneriProgettazione, 0)
      const importoTotale = (parseFloat(bando.importo_so) || 0)
        + (parseFloat(bando.importo_co) || 0)
        + (parseFloat(bando.importo_eco) || 0)
        + (parseFloat(bando.oneri_progettazione) || 0);

      // Also check if esito with same CIG already exists (like original ConvertiInEsito dialog)
      if (bando.codice_cig) {
        const existingByCig = await query(
          `SELECT id, titolo FROM gare WHERE codice_cig = $1 AND eliminata = false LIMIT 1`,
          [bando.codice_cig]
        );
        if (existingByCig.rows.length > 0) {
          return reply.status(409).send({
            error: 'Esiste già un esito con lo stesso CIG',
            esito_id: existingByCig.rows[0].id,
            esito_titolo: existingByCig.rows[0].titolo
          });
        }
      }

      const result = await transaction(async (client) => {
        // Create new esito from bando data
        // Exact field mapping from stored procedure bandi_trasformaInEsito:
        // DataApertura → Data, NPartecipanti = 0, Note = NULL,
        // id_tipoDatiGara = 1, temp = 1, enabled = 0,
        // LimitMinMedia defaults to 10 if null
        const garaResult = await client.query(`
          INSERT INTO gare (
            id_bando, data, titolo, codice_cig,
            cap, citta, indirizzo,
            id_stazione,
            id_soa, soa_val, id_tipologia, id_tipo_dati_gara,
            importo, importo_soa_prevalente, soglia_riferimento,
            n_partecipanti, n_decimali,
            limit_min_media, acorpa_ali, tipo_acorpa_ali,
            variante, note,
            username, data_inserimento,
            eliminata, enabled, temp
          ) VALUES (
            $1, $2, $3, $4,
            $5, $6, $7,
            $8,
            $9, $10, $11, 1,
            $12, $13, $14,
            0, $15,
            $16, $17, $18,
            'BASE', NULL,
            $19, NOW(),
            false, false, true
          ) RETURNING *
        `, [
          bando.id, bando.data_apertura, bando.titolo, bando.codice_cig,
          bando.cap, bando.citta, bando.indirizzo,
          bando.id_stazione,
          bando.id_soa, bando.soa_val, bando.id_tipologia,
          importoTotale, bando.importo_soa_prevalente, bando.soglia_riferimento,
          bando.n_decimali || 3,
          bando.limit_min_media || 10, bando.acorpa_ali || false, bando.tipo_acorpa_ali,
          user.username
        ]);

        const garaId = garaResult.rows[0].id;

        // Copy provinces from bando to gara (BandiProvince → GareProvince)
        try {
          const provRows = await client.query(
            `SELECT id_provincia FROM bandi_province WHERE id_bando = $1`, [id]
          );
          for (const row of provRows.rows) {
            await client.query(
              `INSERT INTO gareprovince (id_gara, id_provincia) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
              [garaId, row.id_provincia]
            );
          }
        } catch { /* table may not exist */ }

        // Copy SOA categories from bando to gara (sec, alt, app)
        // Exact copy from stored procedure: BandiSoaApp→GareSoaApp, BandiSoaSec→GareSoaSec, BandiSoaAlt→GareSoaAlt
        const soaTypes = ['bandi_soa_app', 'bandi_soa_sec', 'bandi_soa_alt'];
        const garasoaTypes = ['garesoaapp', 'garesoasec', 'garesoaalt'];
        for (let i = 0; i < soaTypes.length; i++) {
          try {
            const soaRows = await client.query(
              `SELECT id_soa FROM ${soaTypes[i]} WHERE id_bando = $1`, [id]
            );
            for (const row of soaRows.rows) {
              await client.query(
                `INSERT INTO ${garasoaTypes[i]} (id_gara, id_soa) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
                [garaId, row.id_soa]
              );
            }
          } catch { /* table may not exist */ }
        }

        // Audit log on both bando and gara
        await client.query(
          'INSERT INTO bandimodifiche (id_bando, user_name, modifiche) VALUES ($1, $2, $3)',
          [id, user.username, `Convertito in esito ID ${garaId}`]
        );
        await client.query(
          `INSERT INTO garemodifiche (id_gara, user_name, data, modifiche)
           VALUES ($1, $2, NOW(), $3)`,
          [garaId, user.username, `Esito creato da conversione bando ID ${bando.id}`]
        );

        return garaResult.rows[0];
      });

      return reply.status(201).send({
        success: true,
        message: 'Bando convertito in esito con successo',
        esito: result
      });
    } catch (err) {
      fastify.log.error(err, 'Bando to esito conversion error');
      return reply.status(500).send({ error: 'Errore nella conversione', details: err.message });
    }
  });

  // ============================================================
  // GET /api/bandi/stats/overview - Statistiche bandi
  // ============================================================
  fastify.get('/stats/overview', async (request, reply) => {
    const [totali, perRegione, perTipologia, recenti] = await Promise.all([
      query(`SELECT
        COUNT(*) as totale,
        COUNT(*) FILTER (WHERE data_offerta > NOW()) as attivi,
        COUNT(*) FILTER (WHERE provenienza = 'Manuale') as manuali
       FROM bandi WHERE annullato = false`),
      query(`SELECT regione, COUNT(*) as count FROM bandi WHERE annullato = false AND regione IS NOT NULL GROUP BY regione ORDER BY count DESC LIMIT 10`),
      query(`SELECT tg.nome, COUNT(*) as count FROM bandi b JOIN tipologia_gare tg ON b.id_tipologia = tg.id WHERE b.annullato = false GROUP BY tg.nome`),
      query(`SELECT COUNT(*) as count, DATE(b.data_pubblicazione) as giorno FROM bandi b WHERE b.data_pubblicazione > NOW() - INTERVAL '30 days' GROUP BY DATE(b.data_pubblicazione) ORDER BY giorno DESC`)
    ]);

    return {
      totali: totali.rows[0],
      per_regione: perRegione.rows,
      per_tipologia: perTipologia.rows,
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
          `SELECT * FROM bandi WHERE id = $1 AND annullato = false`,
          [id]
        );

        if (bandoRes.rows.length === 0) {
          throw new Error('Bando non trovato');
        }

        const bando = bandoRes.rows[0];

        // Insert cloned bando with temp=true, enabled=false
        const cloneRes = await client.query(`
          INSERT INTO bandi (
            titolo, id_stazione, stazione_nome, data_pubblicazione,
            codice_cig, codice_cup, id_soa, soa_val,
            categoria_presunta, importo_so, importo_co, importo_eco,
            oneri_progettazione, importo_manodopera, importo_soa_prevalente,
            importo_soa_sostitutiva, soglia_riferimento,
            data_offerta, data_apertura, data_sop_start, data_sop_end,
            indirizzo, cap, citta, regione,
            id_tipologia, id_tipologia_bando, id_criterio, id_piattaforma,
            n_decimali, limit_min_media, acorpa_ali,
            id_tipo_sopralluogo, note_per_sopralluogo,
            sped_pec, sped_posta, sped_corriere, sped_mano, sped_telematica,
            indirizzo_pec, max_invitati_negoziate,
            provenienza, external_code, fonte_dati, note,
            inserito_da, privato, temp, enabled
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
            $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
            $21, $22, $23, $24, $25, $26, $27, $28, $29, $30,
            $31, $32, $33, $34, $35, $36, $37, $38, $39, $40,
            $41, $42, $43, true, false
          ) RETURNING id
        `, [
          bando.titolo, bando.id_stazione, bando.stazione_nome, bando.data_pubblicazione,
          bando.codice_cig, bando.codice_cup, bando.id_soa, bando.soa_val,
          bando.categoria_presunta, bando.importo_so, bando.importo_co, bando.importo_eco,
          bando.oneri_progettazione, bando.importo_manodopera, bando.importo_soa_prevalente,
          bando.importo_soa_sostitutiva, bando.soglia_riferimento,
          bando.data_offerta, bando.data_apertura, bando.data_sop_start, bando.data_sop_end,
          bando.indirizzo, bando.cap, bando.citta, bando.regione,
          bando.id_tipologia, bando.id_tipologia_bando, bando.id_criterio, bando.id_piattaforma,
          bando.n_decimali, bando.limit_min_media, bando.acorpa_ali,
          bando.id_tipo_sopralluogo, bando.note_per_sopralluogo,
          bando.sped_pec, bando.sped_posta, bando.sped_corriere, bando.sped_mano, bando.sped_telematica,
          bando.indirizzo_pec, bando.max_invitati_negoziate,
          bando.provenienza, bando.external_code, bando.fonte_dati, bando.note,
          user.username, bando.privato
        ]);

        const newBandoId = cloneRes.rows[0].id;

        // Copy provinces
        const provRes = await client.query(
          `SELECT id_provincia FROM bandi_province WHERE id_bando = $1`,
          [id]
        );
        for (const row of provRes.rows) {
          await client.query(
            `INSERT INTO bandi_province (id_bando, id_provincia) VALUES ($1, $2)`,
            [newBandoId, row.id_provincia]
          );
        }

        // Copy SOA categories
        const soaTypes = [
          { table: 'bandi_soa_sec', col: 'id_soa' },
          { table: 'bandi_soa_alt', col: 'id_soa' },
          { table: 'bandi_soa_app', col: 'id_soa' },
          { table: 'bandi_soa_sost', col: 'id_soa' }
        ];
        for (const soaType of soaTypes) {
          const soaRes = await client.query(
            `SELECT id_soa FROM ${soaType.table} WHERE id_bando = $1`,
            [id]
          );
          for (const row of soaRes.rows) {
            await client.query(
              `INSERT INTO ${soaType.table} (id_bando, id_soa) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
              [newBandoId, row.id_soa]
            );
          }
        }

        // Audit log
        await client.query(
          'INSERT INTO bandimodifiche (id_bando, user_name, modifiche) VALUES ($1, $2, $3)',
          [newBandoId, user.username, `Clonato da bando ${id}`]
        );

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
        CASE
          WHEN b.titolo IS NULL OR b.titolo = '' THEN 'titolo'
          WHEN b.id_stazione IS NULL THEN 'id_stazione'
          WHEN b.data_pubblicazione IS NULL THEN 'data_pubblicazione'
          WHEN b.data_apertura IS NULL THEN 'data_apertura'
          WHEN b.importo_so IS NULL THEN 'importo_so'
          WHEN b.id_tipologia IS NULL THEN 'id_tipologia'
          WHEN b.id_criterio IS NULL THEN 'id_criterio'
          WHEN b.codice_cig IS NULL OR b.codice_cig = '' THEN 'codice_cig'
          ELSE 'Completo'
        END AS campo_mancante
      FROM bandi b
      WHERE b.annullato = false
        AND (
          b.titolo IS NULL OR b.titolo = '' OR
          b.id_stazione IS NULL OR
          b.data_pubblicazione IS NULL OR
          b.data_apertura IS NULL OR
          b.importo_so IS NULL OR
          b.id_tipologia IS NULL OR
          b.id_criterio IS NULL OR
          b.codice_cig IS NULL OR b.codice_cig = ''
        )
      ORDER BY b.data_pubblicazione DESC
    `);

    return result.rows;
  });

  // ============================================================
  // GET /api/bandi/rettificati - List bandi modified after publication
  // ============================================================
  fastify.get('/rettificati', async (request, reply) => {
    const result = await query(`
      SELECT DISTINCT
        b.id AS id,
        b.titolo AS titolo,
        b.data_pubblicazione AS data_pubblicazione,
        b.codice_cig AS codice_cig,
        COUNT(bm.id_bando) AS num_modifiche,
        MAX(bm.data) AS ultima_modifica
      FROM bandi b
      JOIN bandimodifiche bm ON b.id = bm.id_bando
      WHERE b.annullato = false
        AND bm.modifiche ILIKE '%rettifica%'
      GROUP BY b.id, b.titolo, b.data_pubblicazione, b.codice_cig
      ORDER BY b.data_pubblicazione DESC
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
      `SELECT b.id, g.id as gara_id FROM bandi b
       LEFT JOIN gare g ON b.codice_cig = g.codice_cig
       WHERE b.codice_cig = $1 AND b.annullato = false LIMIT 1`,
      [cig]
    );

    if (cigResult.rows.length === 0) {
      return { exists: false };
    }

    const row = cigResult.rows[0];
    return {
      exists: true,
      bando_id: row.id || null,
      esito_id: row.gara_id || null
    };
  });

  // ============================================================
  // POST /api/bandi/:id/posticipa-apertura - Postpone opening date
  // ============================================================
  fastify.post('/:id/posticipa-apertura', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;
    const { nuova_data, da_destinarsi } = request.body;
    const user = request.user;

    try {
      await transaction(async (client) => {
        if (da_destinarsi) {
          await client.query(
            `UPDATE bandi SET data_apertura = NULL, modificato_da = $1, data_modifica = NOW()
             WHERE id = $2`,
            [user.username, id]
          );
          await client.query(
            'INSERT INTO bandimodifiche (id_bando, user_name, modifiche) VALUES ($1, $2, $3)',
            [id, user.username, 'Data apertura posticipata (da destinarsi)']
          );
        } else if (nuova_data) {
          await client.query(
            `UPDATE bandi SET data_apertura = $1, modificato_da = $2, data_modifica = NOW()
             WHERE id = $3`,
            [nuova_data, user.username, id]
          );
          await client.query(
            'INSERT INTO bandimodifiche (id_bando, user_name, modifiche) VALUES ($1, $2, $3)',
            [id, user.username, `Data apertura posticipata a ${nuova_data}`]
          );
        } else {
          throw new Error('Specifiare nuova_data o da_destinarsi');
        }
      });

      return { message: 'Data apertura aggiornata' };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(400).send({ error: err.message });
    }
  });

  // ============================================================
  // POST /api/bandi/:id/imposta-avviso - Set alert flag
  // ============================================================
  fastify.post('/:id/imposta-avviso', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;
    const { avviso, note_avviso } = request.body;
    const user = request.user;

    try {
      await transaction(async (client) => {
        await client.query(
          `UPDATE bandi SET avviso = $1, note_avviso = $2, modificato_da = $3, data_modifica = NOW()
           WHERE id = $4`,
          [avviso, note_avviso || null, user.username, id]
        );
        await client.query(
          'INSERT INTO bandimodifiche (id_bando, user_name, modifiche) VALUES ($1, $2, $3)',
          [id, user.username, `Avviso: ${avviso ? 'abilitato' : 'disabilitato'}`]
        );
      });

      return { message: 'Avviso aggiornato' };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(400).send({ error: err.message });
    }
  });

  // ============================================================
  // POST /api/bandi/:id/imposta-controllo - Set control flag
  // ============================================================
  fastify.post('/:id/imposta-controllo', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;
    const { controllo, note_controllo } = request.body;
    const user = request.user;

    try {
      await transaction(async (client) => {
        await client.query(
          `UPDATE bandi SET controllo = $1, note_controllo = $2, modificato_da = $3, data_modifica = NOW()
           WHERE id = $4`,
          [controllo, note_controllo || null, user.username, id]
        );
        await client.query(
          'INSERT INTO bandimodifiche (id_bando, user_name, modifiche) VALUES ($1, $2, $3)',
          [id, user.username, `Controllo: ${controllo ? 'abilitato' : 'disabilitato'}`]
        );
      });

      return { message: 'Controllo aggiornato' };
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
      query(`SELECT COUNT(*) as total FROM bandi WHERE id_stazione = $1 AND annullato = false`, [idStazione]),
      query(
        `SELECT
          b.id AS id,
          b.titolo AS titolo,
          b.codice_cig AS codice_cig,
          b.data_pubblicazione AS data_pubblicazione,
          b.importo_so AS importo_so,
          b.regione AS regione
         FROM bandi b
         WHERE b.id_stazione = $1 AND b.annullato = false
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
      query(`SELECT COUNT(*) as total FROM bandi WHERE inserito_da = $1`, [username]),
      query(
        `SELECT
          b.id AS id,
          b.titolo AS titolo,
          b.codice_cig AS codice_cig,
          b.data_pubblicazione AS data_pubblicazione,
          b.importo_so AS importo_so,
          b.annullato AS annullato
         FROM bandi b
         WHERE b.inserito_da = $1
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
  // POST /api/bandi/:id/associa-esito - Associate existing esito
  // ============================================================
  fastify.post('/:id/associa-esito', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;
    const { id_esito } = request.body;
    const user = request.user;

    try {
      if (!id_esito) {
        return reply.status(400).send({ error: 'id_esito required' });
      }

      // Check esito exists
      const esitoRes = await query(`SELECT id FROM gare WHERE id = $1 AND eliminata = false`, [id_esito]);
      if (esitoRes.rows.length === 0) {
        return reply.status(404).send({ error: 'Esito non trovato' });
      }

      await transaction(async (client) => {
        // Update gare to link to bando
        await client.query(
          `UPDATE gare SET id_bando = $1 WHERE id = $2`,
          [id, id_esito]
        );

        // Audit
        await client.query(
          'INSERT INTO bandimodifiche (id_bando, user_name, modifiche) VALUES ($1, $2, $3)',
          [id, user.username, `Esito ${id_esito} associato`]
        );
      });

      return { message: 'Esito associato con successo' };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(400).send({ error: err.message });
    }
  });

  // ============================================================
  // DELETE /api/bandi/:id/associa-esito - Remove esito association
  // ============================================================
  fastify.delete('/:id/associa-esito', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;
    const user = request.user;

    try {
      await transaction(async (client) => {
        // Find associated esito
        const esitoRes = await client.query(
          `SELECT id FROM gare WHERE id_bando = $1 AND eliminata = false`,
          [id]
        );

        if (esitoRes.rows.length === 0) {
          throw new Error('Nessun esito associato');
        }

        // Remove association
        await client.query(
          `UPDATE gare SET id_bando = NULL WHERE id_bando = $1`,
          [id]
        );

        // Audit
        await client.query(
          'INSERT INTO bandimodifiche (id_bando, user_name, modifiche) VALUES ($1, $2, $3)',
          [id, user.username, 'Associazione esito rimossa']
        );
      });

      return { message: 'Associazione rimossa' };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(400).send({ error: err.message });
    }
  });

  // ============================================================
  // POST /api/bandi/:id/imposta-tipo-esito - Set esito tipologia
  // ============================================================
  fastify.post('/:id/imposta-tipo-esito', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;
    const { id_tipologia_esito } = request.body;
    const user = request.user;

    try {
      if (!id_tipologia_esito) {
        return reply.status(400).send({ error: 'id_tipologia_esito required' });
      }

      await transaction(async (client) => {
        await client.query(
          `UPDATE bandi SET id_tipologia_esito = $1, modificato_da = $2, data_modifica = NOW()
           WHERE id = $3`,
          [id_tipologia_esito, user.username, id]
        );

        await client.query(
          'INSERT INTO bandimodifiche (id_bando, user_name, modifiche) VALUES ($1, $2, $3)',
          [id, user.username, `Tipologia esito impostata a ${id_tipologia_esito}`]
        );
      });

      return { message: 'Tipologia esito impostata' };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(400).send({ error: err.message });
    }
  });

  // ============================================================
  // GET /api/bandi/:id/soa - Get all SOA types for bando
  // ============================================================
  fastify.get('/:id/soa', async (request, reply) => {
    const { id } = request.params;

    const [prevalente, secondarie, alternative, subappaltabili, scorporabili] = await Promise.all([
      query(
        `SELECT b.id_soa, s.codice, s.descrizione
         FROM bandi b
         LEFT JOIN soa s ON b.id_soa = s.id
         WHERE b.id = $1`,
        [id]
      ),
      query(
        `SELECT bs.id_soa, s.codice, s.descrizione FROM bandi_soa_sec bs
         JOIN soa s ON bs.id_soa = s.id
         WHERE bs.id_bando = $1`,
        [id]
      ),
      query(
        `SELECT bs.id_soa, s.codice, s.descrizione FROM bandi_soa_alt bs
         JOIN soa s ON bs.id_soa = s.id
         WHERE bs.id_bando = $1`,
        [id]
      ),
      query(
        `SELECT bs.id_soa, s.codice, s.descrizione FROM bandi_soa_app bs
         JOIN soa s ON bs.id_soa = s.id
         WHERE bs.id_bando = $1`,
        [id]
      ),
      query(
        `SELECT bs.id_soa, s.codice, s.descrizione FROM bandi_soa_sost bs
         JOIN soa s ON bs.id_soa = s.id
         WHERE bs.id_bando = $1`,
        [id]
      )
    ]);

    return {
      prevalente: prevalente.rows[0] || null,
      secondarie: secondarie.rows,
      alternative: alternative.rows,
      subappaltabili: subappaltabili.rows,
      scorporabili: scorporabili.rows
    };
  });

  // ============================================================
  // POST /api/bandi/:id/soa-sec - Add secondary SOA
  // ============================================================
  fastify.post('/:id/soa-sec', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;
    const { codice_soa, classifica } = request.body;
    const user = request.user;

    try {
      // Get SOA id by codice
      const soaRes = await query(`SELECT id FROM soa WHERE cod = $1 LIMIT 1`, [codice_soa]);
      if (soaRes.rows.length === 0) {
        return reply.status(404).send({ error: 'SOA non trovato' });
      }

      const soa_id = soaRes.rows[0].id;

      await transaction(async (client) => {
        const result = await client.query(
          `INSERT INTO bandi_soa_sec (id_bando, id_soa, classifica)
           VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING *`,
          [id, soa_id, classifica || null]
        );

        if (result.rows.length > 0) {
          await client.query(
            'INSERT INTO bandimodifiche (id_bando, user_name, modifiche) VALUES ($1, $2, $3)',
            [id, user.username, `SOA secondaria ${codice_soa} aggiunta`]
          );
        }
      });

      return reply.status(201).send({ message: 'SOA secondaria aggiunta' });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(400).send({ error: err.message });
    }
  });

  // ============================================================
  // DELETE /api/bandi/:id/soa-sec/:idSoa - Remove secondary SOA
  // ============================================================
  fastify.delete('/:id/soa-sec/:idSoa', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id, idSoa } = request.params;
    const user = request.user;

    try {
      await transaction(async (client) => {
        await client.query(
          `DELETE FROM bandi_soa_sec WHERE id_bando = $1 AND id_soa = $2`,
          [id, idSoa]
        );

        await client.query(
          'INSERT INTO bandimodifiche (id_bando, user_name, modifiche) VALUES ($1, $2, $3)',
          [id, user.username, `SOA secondaria ${idSoa} rimossa`]
        );
      });

      return { message: 'SOA secondaria rimossa' };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(400).send({ error: err.message });
    }
  });

  // ============================================================
  // POST /api/bandi/:id/soa-alt - Add alternative SOA
  // ============================================================
  fastify.post('/:id/soa-alt', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;
    const { codice_soa, classifica } = request.body;
    const user = request.user;

    try {
      const soaRes = await query(`SELECT id FROM soa WHERE cod = $1 LIMIT 1`, [codice_soa]);
      if (soaRes.rows.length === 0) {
        return reply.status(404).send({ error: 'SOA non trovato' });
      }

      const soa_id = soaRes.rows[0].id;

      await transaction(async (client) => {
        const result = await client.query(
          `INSERT INTO bandi_soa_alt (id_bando, id_soa, classifica)
           VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING *`,
          [id, soa_id, classifica || null]
        );

        if (result.rows.length > 0) {
          await client.query(
            'INSERT INTO bandimodifiche (id_bando, user_name, modifiche) VALUES ($1, $2, $3)',
            [id, user.username, `SOA alternativa ${codice_soa} aggiunta`]
          );
        }
      });

      return reply.status(201).send({ message: 'SOA alternativa aggiunta' });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(400).send({ error: err.message });
    }
  });

  // ============================================================
  // DELETE /api/bandi/:id/soa-alt/:idSoa - Remove alternative SOA
  // ============================================================
  fastify.delete('/:id/soa-alt/:idSoa', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id, idSoa } = request.params;
    const user = request.user;

    try {
      await transaction(async (client) => {
        await client.query(
          `DELETE FROM bandi_soa_alt WHERE id_bando = $1 AND id_soa = $2`,
          [id, idSoa]
        );

        await client.query(
          'INSERT INTO bandimodifiche (id_bando, user_name, modifiche) VALUES ($1, $2, $3)',
          [id, user.username, `SOA alternativa ${idSoa} rimossa`]
        );
      });

      return { message: 'SOA alternativa rimossa' };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(400).send({ error: err.message });
    }
  });

  // ============================================================
  // POST /api/bandi/:id/soa-app - Add subappaltabile SOA
  // ============================================================
  fastify.post('/:id/soa-app', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;
    const { codice_soa, classifica } = request.body;
    const user = request.user;

    try {
      const soaRes = await query(`SELECT id FROM soa WHERE cod = $1 LIMIT 1`, [codice_soa]);
      if (soaRes.rows.length === 0) {
        return reply.status(404).send({ error: 'SOA non trovato' });
      }

      const soa_id = soaRes.rows[0].id;

      await transaction(async (client) => {
        const result = await client.query(
          `INSERT INTO bandi_soa_app (id_bando, id_soa, classifica)
           VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING *`,
          [id, soa_id, classifica || null]
        );

        if (result.rows.length > 0) {
          await client.query(
            'INSERT INTO bandimodifiche (id_bando, user_name, modifiche) VALUES ($1, $2, $3)',
            [id, user.username, `SOA subappaltabile ${codice_soa} aggiunta`]
          );
        }
      });

      return reply.status(201).send({ message: 'SOA subappaltabile aggiunta' });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(400).send({ error: err.message });
    }
  });

  // ============================================================
  // DELETE /api/bandi/:id/soa-app/:idSoa - Remove subappaltabile SOA
  // ============================================================
  fastify.delete('/:id/soa-app/:idSoa', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id, idSoa } = request.params;
    const user = request.user;

    try {
      await transaction(async (client) => {
        await client.query(
          `DELETE FROM bandi_soa_app WHERE id_bando = $1 AND id_soa = $2`,
          [id, idSoa]
        );

        await client.query(
          'INSERT INTO bandimodifiche (id_bando, user_name, modifiche) VALUES ($1, $2, $3)',
          [id, user.username, `SOA subappaltabile ${idSoa} rimossa`]
        );
      });

      return { message: 'SOA subappaltabile rimossa' };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(400).send({ error: err.message });
    }
  });

  // ============================================================
  // POST /api/bandi/:id/soa-sost - Add scorporabile (substitute) SOA
  // ============================================================
  fastify.post('/:id/soa-sost', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;
    const { codice_soa, classifica } = request.body;
    const user = request.user;

    try {
      const soaRes = await query(`SELECT id FROM soa WHERE cod = $1 LIMIT 1`, [codice_soa]);
      if (soaRes.rows.length === 0) {
        return reply.status(404).send({ error: 'SOA non trovato' });
      }

      const soa_id = soaRes.rows[0].id;

      await transaction(async (client) => {
        const result = await client.query(
          `INSERT INTO bandi_soa_sost (id_bando, id_soa, classifica)
           VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING *`,
          [id, soa_id, classifica || null]
        );

        if (result.rows.length > 0) {
          await client.query(
            'INSERT INTO bandimodifiche (id_bando, user_name, modifiche) VALUES ($1, $2, $3)',
            [id, user.username, `SOA scorporabile ${codice_soa} aggiunta`]
          );
        }
      });

      return reply.status(201).send({ message: 'SOA scorporabile aggiunta' });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(400).send({ error: err.message });
    }
  });

  // ============================================================
  // DELETE /api/bandi/:id/soa-sost/:idSoa - Remove scorporabile SOA
  // ============================================================
  fastify.delete('/:id/soa-sost/:idSoa', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id, idSoa } = request.params;
    const user = request.user;

    try {
      await transaction(async (client) => {
        await client.query(
          `DELETE FROM bandi_soa_sost WHERE id_bando = $1 AND id_soa = $2`,
          [id, idSoa]
        );

        await client.query(
          'INSERT INTO bandimodifiche (id_bando, user_name, modifiche) VALUES ($1, $2, $3)',
          [id, user.username, `SOA scorporabile ${idSoa} rimossa`]
        );
      });

      return { message: 'SOA scorporabile rimossa' };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(400).send({ error: err.message });
    }
  });

  // ============================================================
  // GET /api/bandi/tipologie - List all bandi tipologie
  // ============================================================
  fastify.get('/tipologie', async (request, reply) => {
    const result = await query(
      `SELECT id, nome AS tipologia FROM tipologia_bandi ORDER BY nome`
    );
    return result.rows;
  });

  // ============================================================
  // GET /api/bandi/criteri - List all criteri
  // ============================================================
  fastify.get('/criteri', async (request, reply) => {
    const result = await query(
      `SELECT id_criterio AS id, criterio AS criterio FROM criteri ORDER BY criterio`
    );
    return result.rows;
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
          `UPDATE bandi SET annullato = false, modificato_da = $1, data_modifica = NOW()
           WHERE id = $2`,
          [user.username, id]
        );

        await client.query(
          'INSERT INTO bandimodifiche (id_bando, user_name, modifiche) VALUES ($1, $2, $3)',
          [id, user.username, 'Bando ripristinato dal cestino']
        );
      });

      return { message: 'Bando ripristinato' };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(400).send({ error: err.message });
    }
  });

  // ============================================================
  // GET /api/bandi/cestino - List deleted bandi
  // ============================================================
  fastify.get('/cestino', async (request, reply) => {
    const { page = 1, limit = 20 } = request.query;

    const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

    const [countRes, result] = await Promise.all([
      query(`SELECT COUNT(*) as total FROM bandi WHERE annullato = true`),
      query(
        `SELECT
          b.id AS id,
          b.titolo AS titolo,
          b.codice_cig AS codice_cig,
          b.data_pubblicazione AS data_pubblicazione,
          b.modificato_da AS modificato_da,
          b.data_modifica AS data_modifica
         FROM bandi b
         WHERE b.annullato = true
         ORDER BY b.data_modifica DESC
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
        b.tipo_cauzione AS tipo_cauzione,
        b.importo_cauzione AS importo_cauzione,
        b.percentuale_cauzione AS percentuale_cauzione
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
        `INSERT INTO presavisione (id_bando, data, user_name)
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
        `DELETE FROM presavisione WHERE id_bando = $1 AND id = $2`,
        [id, idData]
      );

      return { message: 'Presa visione rimossa' };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(400).send({ error: err.message });
    }
  });
}
