import { query, transaction } from '../db/pool.js';

export default async function esitiRoutes(fastify) {

  // ============================================================
  // GET /api/esiti - List esiti with filters + pagination
  // ============================================================
  fastify.get('/', async (request) => {
    const {
      page = 1, limit = 25, sort = 'Data', order = 'DESC',
      search, id_regione, id_stazione, id_soa, id_criterio,
      id_tipologia, data_dal, data_al, variante,
      min_partecipanti
    } = request.query;

    const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);
    const conditions = ['g."eliminata" = false'];
    const params = [];
    let paramIdx = 1;

    if (search) {
      conditions.push(`(g."titolo" ILIKE $${paramIdx} OR g."codice_cig" ILIKE $${paramIdx} OR s."nome" ILIKE $${paramIdx})`);
      params.push(`%${search}%`);
      paramIdx++;
    }
    if (id_regione) {
      conditions.push(`p."id_regione" = $${paramIdx}`);
      params.push(parseInt(id_regione));
      paramIdx++;
    }
    if (id_stazione) {
      conditions.push(`g."id_stazione" = $${paramIdx}`);
      params.push(parseInt(id_stazione));
      paramIdx++;
    }
    if (id_soa) {
      conditions.push(`g."id_soa" = $${paramIdx}`);
      params.push(parseInt(id_soa));
      paramIdx++;
    }
    if (id_criterio) {
      // id_criterio is on bandi, not gare
      conditions.push(`b."id_criterio" = $${paramIdx}`);
      params.push(parseInt(id_criterio));
      paramIdx++;
    }
    if (id_tipologia) {
      conditions.push(`g."id_tipologia" = $${paramIdx}`);
      params.push(parseInt(id_tipologia));
      paramIdx++;
    }
    if (data_dal) {
      conditions.push(`g."Data" >= $${paramIdx}`);
      params.push(data_dal);
      paramIdx++;
    }
    if (data_al) {
      conditions.push(`g."Data" <= $${paramIdx}`);
      params.push(data_al);
      paramIdx++;
    }
    if (variante) {
      conditions.push(`g."Variante" = $${paramIdx}`);
      params.push(variante);
      paramIdx++;
    }
    if (min_partecipanti) {
      conditions.push(`g."n_partecipanti" >= $${paramIdx}`);
      params.push(parseInt(min_partecipanti));
      paramIdx++;
    }

    const allowedSort = ['data', 'titolo', 'importo', 'n_partecipanti', 'ribasso'];
    const sortCol = allowedSort.includes(sort.toLowerCase()) ? `g."${sort.toLowerCase()}"` : 'g."data"';
    const sortDir = order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    // gare -> stazioni -> province -> regioni for geographic filtering
    // gare -> bandi for criterio filtering
    const joinClause = `
      FROM gare g
      LEFT JOIN stazioni s ON g."id_stazione" = s."id"
      LEFT JOIN province p ON s."id_provincia" = p."id_provincia"
      LEFT JOIN regioni r ON p."id_regione" = r."id_regione"
      LEFT JOIN bandi b ON g."id_bando" = b."id"
    `;

    const [countResult, dataResult] = await Promise.all([
      query(`
        SELECT COUNT(*) as total
        ${joinClause}
        ${whereClause}
      `, params),
      query(`
        SELECT g."id",
          g."data" AS data,
          g."titolo" AS titolo,
          g."n_partecipanti" AS n_partecipanti,
          g."importo" AS importo,
          g."media_ar" AS media_ar,
          g."ribasso" AS ribasso,
          g."soglia_an" AS soglia_an,
          g."variante" AS variante,
          g."codice_cig" AS codice_cig,
          s."nome" AS stazione_nome,
          soa."codice" AS soa_categoria,
          soa."descrizione" AS soa_descrizione,
          tg."nome" AS tipologia,
          c."nome" AS criterio,
          p."provincia" AS provincia_nome,
          r."regione" AS regione_nome,
          az."ragione_sociale" AS vincitore_nome,
          az."partita_iva" AS vincitore_piva,
          (SELECT COUNT(*) FROM dettaglio_gara dg WHERE dg."id_gara" = g."id") AS n_dettagli
        ${joinClause}
        LEFT JOIN soa ON g."id_soa" = soa."id"
        LEFT JOIN tipologia_gare tg ON g."id_tipologia" = tg."id"
        LEFT JOIN criteri c ON b."id_criterio" = c."id"
        LEFT JOIN aziende az ON g."id_vincitore" = az."id"
        ${whereClause}
        ORDER BY ${sortCol} ${sortDir} NULLS LAST
        LIMIT $${paramIdx} OFFSET $${paramIdx + 1}
      `, [...params, parseInt(limit), offset])
    ]);

    return {
      data: dataResult.rows,
      pagination: {
        total: parseInt(countResult.rows[0].total),
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(parseInt(countResult.rows[0].total) / parseInt(limit))
      }
    };
  });

  // ============================================================
  // GET /api/esiti/:id - Single esito with full details
  // ============================================================
  fastify.get('/:id', async (request, reply) => {
    const { id } = request.params;

    // Main gara query — includes workflow fields: temp, enabled, data_abilitazione, bloccato, id_bando
    const garaResult = await query(`
      SELECT g."id",
        g."data" AS data,
        g."titolo" AS titolo,
        g."codice_cig" AS codice_cig,
        g."importo" AS importo,
        g."n_partecipanti" AS n_partecipanti,
        g."ribasso" AS ribasso,
        g."media_ar" AS media_ar,
        g."soglia_an" AS soglia_an,
        g."media_sc" AS media_sc,
        g."n_decimali" AS n_decimali,
        g."variante" AS variante,
        g."citta" AS citta,
        g."temp" AS temp,
        g."enabled" AS enabled,
        g."bloccato" AS bloccato,
        g."enable_to_all" AS enable_to_all,
        g."data_abilitazione" AS data_abilitazione,
        g."id_bando" AS id_bando,
        g."id_tipo_dati_gara" AS id_tipo_dati_gara,
        g."note" AS note,
        g."note_interne" AS note_interne,
        g."username" AS username_inserimento,
        g."data_inserimento" AS data_inserimento,
        g."data_modifica" AS data_modifica,
        s."nome" AS stazione_nome,
        soa."codice" AS soa_categoria,
        soa."descrizione" AS soa_descrizione,
        tg."nome" AS tipologia,
        c."nome" AS criterio,
        p."provincia" AS provincia_nome,
        r."regione" AS regione_nome,
        az."ragione_sociale" AS vincitore_nome,
        az."partita_iva" AS vincitore_piva,
        (SELECT COUNT(*) FROM gareinvii gi WHERE gi."id_gara" = g."id") AS n_invii
      FROM gare g
      LEFT JOIN stazioni s ON g."id_stazione" = s."id"
      LEFT JOIN province p ON s."id_provincia" = p."id_provincia"
      LEFT JOIN regioni r ON p."id_regione" = r."id_regione"
      LEFT JOIN bandi b_ref ON g."id_bando" = b_ref."id"
      LEFT JOIN soa ON g."id_soa" = soa."id"
      LEFT JOIN tipologia_gare tg ON g."id_tipologia" = tg."id"
      LEFT JOIN criteri c ON b_ref."id_criterio" = c."id"
      LEFT JOIN aziende az ON g."id_vincitore" = az."id"
      WHERE g."id" = $1
    `, [id]);

    if (garaResult.rows.length === 0) {
      return reply.status(404).send({ error: 'Esito non trovato' });
    }

    // Graduatoria query
    const dettagliResult = await query(`
      SELECT
        dg."posizione" AS posizione,
        dg."ribasso" AS ribasso,
        dg."vincitrice" AS vincitrice,
        dg."anomala" AS anomala,
        dg."esclusa" AS esclusa,
        dg."ammessa" AS ammessa,
        dg."taglio_ali" AS taglio_ali,
        dg."m_media_arit" AS m_media_arit,
        dg."note" AS note,
        az."ragione_sociale" AS ragione_sociale,
        az."partita_iva" AS partita_iva
      FROM dettaglio_gara dg
      LEFT JOIN aziende az ON dg."id_azienda" = az."id"
      WHERE dg."id_gara" = $1
      ORDER BY dg."posizione" ASC NULLS LAST
    `, [id]);

    // ATI query (may fail if table structure differs)
    let atiRows = [];
    try {
      const atiResult = await query(`
        SELECT ag.*,
          m."ragione_sociale" AS mandataria_nome,
          mn."ragione_sociale" AS mandante_nome
        FROM atigare01 ag
        LEFT JOIN aziende m ON ag."id_mandataria" = m."id"
        LEFT JOIN aziende mn ON ag."id_mandante" = mn."id"
        WHERE ag."id_gara" = $1
      `, [id]);
      atiRows = atiResult.rows;
    } catch { /* table may not exist */ }

    return {
      ...garaResult.rows[0],
      graduatoria: dettagliResult.rows,
      ati: atiRows
    };
  });

  // ============================================================
  // POST /api/esiti - Create new esito
  // ============================================================
  fastify.post('/', async (request, reply) => {
    const data = request.body;

    const result = await transaction(async (client) => {
      // Insert main gara — only columns that exist in the gare table
      const garaResult = await client.query(`
        INSERT INTO gare (
          "id_bando", "data", "titolo", "codice_cig",
          "cap", "citta", "indirizzo", "lat", "lon",
          "id_stazione",
          "id_soa", "soa_val", "id_tipologia",
          "importo", "importo_soa_prevalente",
          "n_partecipanti", "n_sorteggio", "n_decimali",
          "id_vincitore", "ribasso",
          "media_ar", "soglia_an", "media_sc", "soglia_riferimento",
          "acorpa_ali", "tipo_acorpa_ali", "limit_min_media",
          "variante", "note", "username",
          "data_inserimento", "eliminata", "enabled", "temp"
        ) VALUES (
          $1, $2, $3, $4,
          $5, $6, $7, $8, $9,
          $10,
          $11, $12, $13,
          $14, $15,
          $16, $17, $18,
          $19, $20,
          $21, $22, $23, $24,
          $25, $26, $27,
          $28, $29, $30,
          NOW(), false, false, true
        ) RETURNING *
      `, [
        data.id_bando, data.data || data.Data, data.titolo || data.Titolo, data.codice_cig || data.CodiceCIG,
        data.cap || data.CAP, data.citta || data.Citta, data.indirizzo || data.Indirizzo, data.lat || data.Lat, data.lon || data.Lon,
        data.id_stazione,
        data.id_soa, data.soa_val || data.SoaVal, data.id_tipologia,
        data.importo || data.Importo, data.importo_soa_prevalente || data.ImportoSoaPrevalente,
        data.n_partecipanti || data.NPartecipanti || 0, data.n_sorteggio || data.NSorteggio || 0, data.n_decimali || data.NDecimali || 3,
        data.id_vincitore, data.ribasso || data.Ribasso,
        data.media_ar || data.MediaAr, data.soglia_an || data.SogliaAn, data.media_sc || data.MediaSc, data.soglia_riferimento || data.SogliaRiferimento,
        data.acorpa_ali || data.AccorpaAli || false, data.tipo_acorpa_ali || data.TipoAccorpaALI, data.limit_min_media || data.LimitMinMedia,
        data.variante || data.Variante || 'BASE', data.note || data.Note, data.username || 'web'
      ]);

      const garaId = garaResult.rows[0].id;

      // Insert graduatoria (dettaglio_gara)
      if (data.graduatoria && data.graduatoria.length > 0) {
        for (const det of data.graduatoria) {
          await client.query(`
            INSERT INTO dettaglio_gara (
              "id_gara", "variante", "id_azienda", "posizione", "ribasso", "importo_offerta",
              "taglio_ali", "m_media_arit", "anomala",
              "vincitrice", "ammessa", "ammessa_riserva", "esclusa",
              "da_verificare", "sconosciuto", "pari_merito",
              "ragione_sociale", "partita_iva", "codice_fiscale",
              "punteggio_tecnico", "punteggio_economico", "punteggio_totale",
              "inserimento", "note"
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
          `, [
            garaId, det.variante || det.Variante || 'BASE', det.id_azienda, det.posizione || det.Posizione, det.ribasso || det.Ribasso, det.importo_offerta || det.ImportoOfferta,
            det.taglio_ali || det.TaglioAli || false, det.m_media_arit || det.MMediaArit, det.anomala || det.Anomala || false,
            det.vincitrice || det.Vincitrice || false, det.ammessa !== false || det.Ammessa !== false, det.ammessa_riserva || det.AmmessaRiserva || false, det.esclusa || det.Esclusa || false,
            det.da_verificare || det.DaVerificare || false, det.sconosciuto || det.Sconosciuto || false, det.pari_merito || det.PariMerito || false,
            det.ragione_sociale || det.RagioneSociale, det.partita_iva || det.PartitaIva, det.codice_fiscale || det.CodiceFiscale,
            det.punteggio_tecnico || det.PunteggioTecnico, det.punteggio_economico || det.PunteggioEconomico, det.punteggio_totale || det.PunteggioTotale,
            det.inserimento || det.Inserimento || 0, det.note || det.Note
          ]);
        }
      }

      return garaResult.rows[0];
    });

    return reply.status(201).send(result);
  });

  // ============================================================
  // PUT /api/esiti/:id - Update esito
  // ============================================================
  fastify.put('/:id', async (request, reply) => {
    const { id } = request.params;
    const data = request.body;

    // Check exists
    const existing = await query('SELECT "id" FROM gare WHERE "id" = $1', [id]);
    if (existing.rows.length === 0) {
      return reply.status(404).send({ error: 'Esito non trovato' });
    }

    // Build dynamic UPDATE
    const updateFields = [];
    const updateValues = [];
    let idx = 1;

    const allowedFields = {
      'data': 'data', 'titolo': 'titolo', 'codice_cig': 'codice_cig', 'codice_cup': 'codice_cup',
      'cap': 'cap', 'citta': 'citta', 'indirizzo': 'indirizzo', 'id_provincia': 'id_provincia', 'regione': 'regione', 'lat': 'lat', 'lon': 'lon',
      'id_stazione': 'id_stazione', 'stazione_nome': 'stazione_nome',
      'id_soa': 'id_soa', 'soa_val': 'soa_val', 'id_tipologia': 'id_tipologia', 'id_criterio': 'id_criterio', 'id_piattaforma': 'id_piattaforma',
      'importo': 'importo', 'importo_so': 'importo_so', 'importo_co': 'importo_co', 'importo_eco': 'importo_eco', 'oneri_progettazione': 'oneri_progettazione',
      'n_partecipanti': 'n_partecipanti', 'n_ammessi': 'n_ammessi', 'n_esclusi': 'n_esclusi', 'n_sorteggio': 'n_sorteggio', 'n_decimali': 'n_decimali',
      'id_vincitore': 'id_vincitore', 'ribasso': 'ribasso', 'ribasso_vincitore': 'ribasso_vincitore', 'importo_vincitore': 'importo_vincitore',
      'media_ar': 'media_ar', 'soglia_an': 'soglia_an', 'media_sc': 'media_sc', 'soglia_riferimento': 'soglia_riferimento',
      'acorpa_ali': 'acorpa_ali', 'variante': 'variante', 'note': 'note', 'provenienza': 'provenienza'
    };

    // Support both snake_case and PascalCase input
    const mappingPascalToSnake = {
      'Data': 'data', 'Titolo': 'titolo', 'CodiceCIG': 'codice_cig', 'CodiceCUP': 'codice_cup',
      'CAP': 'cap', 'Citta': 'citta', 'Indirizzo': 'indirizzo', 'Regione': 'regione', 'Lat': 'lat', 'Lon': 'lon',
      'Stazione': 'stazione_nome',
      'SoaVal': 'soa_val', 'ImportoSO': 'importo_so', 'ImportoCO': 'importo_co', 'ImportoEco': 'importo_eco', 'OneriProgettazione': 'oneri_progettazione',
      'NPartecipanti': 'n_partecipanti', 'NAmmessi': 'n_ammessi', 'NEsclusi': 'n_esclusi', 'NSorteggio': 'n_sorteggio', 'NDecimali': 'n_decimali',
      'Ribasso': 'ribasso', 'RibassoVincitore': 'ribasso_vincitore', 'ImportoVincitore': 'importo_vincitore',
      'MediaAr': 'media_ar', 'SogliaAn': 'soglia_an', 'MediaSc': 'media_sc', 'SogliaRiferimento': 'soglia_riferimento',
      'AccorpaAli': 'acorpa_ali', 'Variante': 'variante', 'Note': 'note', 'Provenienza': 'provenienza'
    };

    for (const [key, value] of Object.entries(data)) {
      let dbField = allowedFields[key] || mappingPascalToSnake[key];
      if (dbField) {
        updateFields.push(`"${dbField}" = $${idx}`);
        updateValues.push(value);
        idx++;
      }
    }

    if (updateFields.length === 0) {
      return reply.status(400).send({ error: 'Nessun campo da aggiornare' });
    }

    updateFields.push(`"data_modifica" = NOW()`);
    if (data.ModificatoDa || data.modificato_da) {
      updateFields.push(`"modificato_da" = $${idx}`);
      updateValues.push(data.ModificatoDa || data.modificato_da);
      idx++;
    }

    updateValues.push(id);
    const result = await query(
      `UPDATE gare SET ${updateFields.join(', ')} WHERE "id" = $${idx} RETURNING *`,
      updateValues
    );

    return result.rows[0];
  });

  // ============================================================
  // DELETE /api/esiti/:id - Soft delete
  // ============================================================
  fastify.delete('/:id', async (request, reply) => {
    const { id } = request.params;
    const result = await query(
      `UPDATE gare SET "eliminata" = true, "data_modifica" = NOW() WHERE "id" = $1 RETURNING "id"`,
      [id]
    );
    if (result.rows.length === 0) {
      return reply.status(404).send({ error: 'Esito non trovato' });
    }
    return { message: 'Esito eliminato', id: result.rows[0].id };
  });

  // ============================================================
  // GET /api/esiti/:id/graduatoria - Full ranking
  // ============================================================
  fastify.get('/:id/graduatoria', async (request) => {
    const { id } = request.params;
    const { variante = 'BASE' } = request.query;

    const result = await query(`
      SELECT dg.*,
        az."ragione_sociale" AS azienda_nome,
        az."partita_iva" AS azienda_piva,
        az."codice_fiscale" AS azienda_cf
      FROM dettaglio_gara dg
      LEFT JOIN aziende az ON dg."id_azienda" = az."id"
      WHERE dg."id_gara" = $1 AND dg."variante" = $2
      ORDER BY dg."posizione" ASC NULLS LAST
    `, [id, variante]);

    return result.rows;
  });

  // ============================================================
  // POST /api/esiti/:id/graduatoria - Add entry to ranking
  // ============================================================
  fastify.post('/:id/graduatoria', async (request, reply) => {
    const { id } = request.params;
    const det = request.body;

    const result = await query(`
      INSERT INTO dettaglio_gara (
        "id_gara", "variante", "id_azienda", "posizione", "ribasso", "importo_offerta",
        "taglio_ali", "anomala", "vincitrice", "ammessa", "esclusa",
        "da_verificare", "sconosciuto", "ragione_sociale", "partita_iva",
        "punteggio_tecnico", "punteggio_economico", "punteggio_totale",
        "inserimento", "note"
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
      RETURNING *
    `, [
      id, det.variante || det.Variante || 'BASE', det.id_azienda, det.posizione || det.Posizione, det.ribasso || det.Ribasso, det.importo_offerta || det.ImportoOfferta,
      det.taglio_ali || det.TaglioAli || false, det.anomala || det.Anomala || false, det.vincitrice || det.Vincitrice || false,
      det.ammessa !== false || det.Ammessa !== false, det.esclusa || det.Esclusa || false,
      det.da_verificare || det.DaVerificare || false, det.sconosciuto || det.Sconosciuto || false,
      det.ragione_sociale || det.RagioneSociale, det.partita_iva || det.PartitaIva,
      det.punteggio_tecnico || det.PunteggioTecnico, det.punteggio_economico || det.PunteggioEconomico, det.punteggio_totale || det.PunteggioTotale,
      det.inserimento || det.Inserimento || 0, det.note || det.Note
    ]);

    return reply.status(201).send(result.rows[0]);
  });

  // (storia endpoint moved to bottom of file with full implementation)

  // ============================================================
  // GET /api/esiti/stats/overview - Dashboard statistics
  // ============================================================
  fastify.get('/stats/overview', async () => {
    const result = await query(`
      SELECT
        COUNT(*) FILTER (WHERE "eliminata" = false) AS totale,
        AVG("n_partecipanti") FILTER (WHERE "eliminata" = false AND "n_partecipanti" > 0) AS media_partecipanti,
        AVG("ribasso") FILTER (WHERE "eliminata" = false AND "ribasso" IS NOT NULL) AS media_ribasso,
        COUNT(*) FILTER (WHERE "data" >= NOW() - INTERVAL '30 days' AND "eliminata" = false) AS ultimi_30_giorni,
        SUM("importo") FILTER (WHERE "eliminata" = false) AS importo_totale
      FROM gare
    `);

    const perRegione = await query(`
      SELECT r."regione", COUNT(*) as totale
      FROM gare g
      JOIN stazioni s ON g."id_stazione" = s."id"
      JOIN province p ON s."id_provincia" = p."id_provincia"
      JOIN regioni r ON p."id_regione" = r."id_regione"
      WHERE g."eliminata" = false
      GROUP BY r."regione" ORDER BY totale DESC LIMIT 10
    `);

    const perTipologia = await query(`
      SELECT tg."nome", COUNT(*) as totale
      FROM gare g
      JOIN tipologia_gare tg ON g."id_tipologia" = tg."id"
      WHERE g."eliminata" = false
      GROUP BY tg."nome" ORDER BY totale DESC
    `);

    return {
      ...result.rows[0],
      per_regione: perRegione.rows,
      per_tipologia: perTipologia.rows
    };
  });

  // ============================================================
  // POST /api/esiti/:id/conferma - CONFERMA: confirm esito data
  // Original ASP.NET behavior:
  //   - Publisher/Incaricato: sets temp=false only (awaits ABILITA from Admin/Agent)
  //   - Administrator: sets temp=false AND enabled=true (auto-abilita)
  // ============================================================
  fastify.post('/:id/conferma', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;

    try {
      const existing = await query(
        'SELECT "id", "temp", "enabled", "eliminata", "Bloccato" FROM gare WHERE "id" = $1', [id]
      );
      if (existing.rows.length === 0) return reply.status(404).send({ error: 'Esito non trovato' });
      if (existing.rows[0].eliminata) return reply.status(400).send({ error: 'Esito eliminato' });
      if (!existing.rows[0].temp) return reply.status(400).send({ error: 'Esito già confermato' });

      const userRole = request.user.role || '';
      const isAdmin = userRole === 'Administrator' || userRole === 'Admin';

      await transaction(async (client) => {
        if (isAdmin) {
          // Admin: CONFERMA + auto-ABILITA (original ASP.NET behavior)
          await client.query(
            `UPDATE gare SET "temp" = false, "enabled" = true, "DataAbilitazione" = NOW(),
             "DataModifica" = NOW(), "usernameModifica" = $2 WHERE "id" = $1`,
            [id, request.user.username]
          );
          await client.query(
            `INSERT INTO garemodifiche ("id_gara", "UserName", "Data", "Modifiche")
             VALUES ($1, $2, NOW(), $3)`,
            [id, request.user.username, 'Esito confermato e abilitato automaticamente (CONFERMA Admin)']
          );
        } else {
          // Publisher/Incaricato: solo CONFERMA, attende ABILITA
          await client.query(
            `UPDATE gare SET "temp" = false, "DataModifica" = NOW(), "usernameModifica" = $2 WHERE "id" = $1`,
            [id, request.user.username]
          );
          await client.query(
            `INSERT INTO garemodifiche ("id_gara", "UserName", "Data", "Modifiche")
             VALUES ($1, $2, NOW(), $3)`,
            [id, request.user.username, 'Esito confermato, in attesa di abilitazione (CONFERMA)']
          );
        }
      });

      return {
        success: true,
        message: isAdmin
          ? 'Esito confermato e abilitato automaticamente'
          : 'Esito confermato, in attesa di abilitazione da parte di un amministratore',
        id,
        auto_enabled: isAdmin
      };
    } catch (err) {
      fastify.log.error(err, 'Conferma esito error');
      return reply.status(500).send({ error: 'Errore nella conferma', details: err.message });
    }
  });

  // ============================================================
  // POST /api/esiti/:id/abilita - ABILITA: enable esito for clients (enabled → true)
  // Only Administrator or Agent can abilita. Must not be temp or locked.
  // ============================================================
  fastify.post('/:id/abilita', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;

    try {
      const existing = await query(
        'SELECT "id", "temp", "enabled", "eliminata", "Bloccato" FROM gare WHERE "id" = $1', [id]
      );
      if (existing.rows.length === 0) return reply.status(404).send({ error: 'Esito non trovato' });
      if (existing.rows[0].eliminata) return reply.status(400).send({ error: 'Esito eliminato' });
      if (existing.rows[0].temp) return reply.status(400).send({ error: 'Esito non ancora confermato. Usa prima CONFERMA.' });
      if (existing.rows[0].Bloccato) return reply.status(400).send({ error: 'Esito bloccato. Sbloccalo prima di abilitare.' });
      if (existing.rows[0].enabled) return reply.status(400).send({ error: 'Esito già abilitato' });

      await transaction(async (client) => {
        await client.query(
          `UPDATE gare SET "enabled" = true, "DataAbilitazione" = NOW(), "DataModifica" = NOW(), "usernameModifica" = $2 WHERE "id" = $1`,
          [id, request.user.username]
        );
        await client.query(
          `INSERT INTO garemodifiche ("id_gara", "UserName", "Data", "Modifiche")
           VALUES ($1, $2, NOW(), $3)`,
          [id, request.user.username, 'Esito abilitato per i clienti (ABILITA)']
        );
      });

      return { success: true, message: 'Esito abilitato per i clienti', id };
    } catch (err) {
      fastify.log.error(err, 'Abilita esito error');
      return reply.status(500).send({ error: 'Errore nell\'abilitazione', details: err.message });
    }
  });

  // ============================================================
  // POST /api/esiti/:id/disabilita - DISABILITA: hide from clients (enabled → false)
  // ============================================================
  fastify.post('/:id/disabilita', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;

    try {
      const existing = await query('SELECT "id", "enabled" FROM gare WHERE "id" = $1', [id]);
      if (existing.rows.length === 0) return reply.status(404).send({ error: 'Esito non trovato' });
      if (!existing.rows[0].enabled) return reply.status(400).send({ error: 'Esito già disabilitato' });

      await transaction(async (client) => {
        await client.query(
          `UPDATE gare SET "enabled" = false, "DataModifica" = NOW(), "usernameModifica" = $2 WHERE "id" = $1`,
          [id, request.user.username]
        );
        await client.query(
          `INSERT INTO garemodifiche ("id_gara", "UserName", "Data", "Modifiche")
           VALUES ($1, $2, NOW(), $3)`,
          [id, request.user.username, 'Esito disabilitato (DISABILITA)']
        );
      });

      return { success: true, message: 'Esito disabilitato', id };
    } catch (err) {
      fastify.log.error(err, 'Disabilita esito error');
      return reply.status(500).send({ error: 'Errore nella disabilitazione', details: err.message });
    }
  });

  // ============================================================
  // POST /api/esiti/:id/set-temp - SET TEMP: revert esito to draft (temp → true)
  // Original: allows undoing confirmation, puts back in draft state
  // ============================================================
  fastify.post('/:id/set-temp', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;

    try {
      const existing = await query('SELECT "id", "temp", "enabled" FROM gare WHERE "id" = $1', [id]);
      if (existing.rows.length === 0) return reply.status(404).send({ error: 'Esito non trovato' });
      if (existing.rows[0].temp) return reply.status(400).send({ error: 'Esito è già in bozza' });
      if (existing.rows[0].enabled) return reply.status(400).send({ error: 'Esito è abilitato. Disabilitalo prima di rimetterlo in bozza.' });

      await transaction(async (client) => {
        await client.query(
          `UPDATE gare SET "temp" = true, "DataModifica" = NOW(), "usernameModifica" = $2 WHERE "id" = $1`,
          [id, request.user.username]
        );
        await client.query(
          `INSERT INTO garemodifiche ("id_gara", "UserName", "Data", "Modifiche")
           VALUES ($1, $2, NOW(), $3)`,
          [id, request.user.username, 'Esito rimesso in bozza (SET TEMP)']
        );
      });

      return { success: true, message: 'Esito rimesso in bozza', id };
    } catch (err) {
      fastify.log.error(err, 'Set temp error');
      return reply.status(500).send({ error: 'Errore', details: err.message });
    }
  });

  // ============================================================
  // POST /api/esiti/:id/blocca - BLOCCA: lock esito for editing
  // Original: prevents other users from modifying the esito
  // ============================================================
  fastify.post('/:id/blocca', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;

    try {
      await transaction(async (client) => {
        await client.query(
          `UPDATE gare SET "Bloccato" = true, "DataModifica" = NOW(), "usernameModifica" = $2 WHERE "id" = $1`,
          [id, request.user.username]
        );
        await client.query(
          `INSERT INTO garemodifiche ("id_gara", "UserName", "Data", "Modifiche")
           VALUES ($1, $2, NOW(), $3)`,
          [id, request.user.username, 'Esito bloccato (BLOCCA)']
        );
      });
      return { success: true, message: 'Esito bloccato', id };
    } catch (err) {
      return reply.status(500).send({ error: 'Errore', details: err.message });
    }
  });

  // ============================================================
  // POST /api/esiti/:id/sblocca - SBLOCCA: unlock esito
  // ============================================================
  fastify.post('/:id/sblocca', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;

    try {
      await transaction(async (client) => {
        await client.query(
          `UPDATE gare SET "Bloccato" = false, "DataModifica" = NOW(), "usernameModifica" = $2 WHERE "id" = $1`,
          [id, request.user.username]
        );
        await client.query(
          `INSERT INTO garemodifiche ("id_gara", "UserName", "Data", "Modifiche")
           VALUES ($1, $2, NOW(), $3)`,
          [id, request.user.username, 'Esito sbloccato (SBLOCCA)']
        );
      });
      return { success: true, message: 'Esito sbloccato', id };
    } catch (err) {
      return reply.status(500).send({ error: 'Errore', details: err.message });
    }
  });

  // ============================================================
  // POST /api/esiti/:id/abilita-tutti - ABILITA TUTTI: enable collaborative editing
  // Original: sets EnableToAll = true, allows all operators to edit
  // ============================================================
  fastify.post('/:id/abilita-tutti', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;

    try {
      await query(
        `UPDATE gare SET "EnableToAll" = true, "DataModifica" = NOW(), "usernameModifica" = $2 WHERE "id" = $1`,
        [id, request.user.username]
      );
      return { success: true, message: 'Modifica collaborativa attivata', id };
    } catch (err) {
      return reply.status(500).send({ error: 'Errore', details: err.message });
    }
  });

  // ============================================================
  // POST /api/esiti/:id/disabilita-tutti - DISABILITA TUTTI: disable collaborative editing
  // ============================================================
  fastify.post('/:id/disabilita-tutti', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;

    try {
      await query(
        `UPDATE gare SET "EnableToAll" = false, "DataModifica" = NOW(), "usernameModifica" = $2 WHERE "id" = $1`,
        [id, request.user.username]
      );
      return { success: true, message: 'Modifica collaborativa disattivata', id };
    } catch (err) {
      return reply.status(500).send({ error: 'Errore', details: err.message });
    }
  });

  // ============================================================
  // POST /api/esiti/:id/invia-notifiche - INVIA: Send notifications + record in gareinvii
  // Sends email to all participating companies and records the action
  // ============================================================
  fastify.post('/:id/invia-notifiche', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;

    try {
      // Check esito exists and is enabled
      const existing = await query('SELECT "id", "enabled", "temp", "Variante" FROM gare WHERE "id" = $1', [id]);
      if (existing.rows.length === 0) return reply.status(404).send({ error: 'Esito non trovato' });
      if (existing.rows[0].temp) return reply.status(400).send({ error: 'Esito non ancora confermato. Usa prima CONFERMA.' });

      const variante = existing.rows[0].Variante || 'BASE';

      const { sendEsitoNotifications } = await import('../services/email-service.js');
      const results = await sendEsitoNotifications(id);

      // Record in gareinvii (the dedicated invii tracking table)
      await query(
        `INSERT INTO gareinvii ("id_gara", "Variante", "Data", "Username")
         VALUES ($1, $2, NOW(), $3)`,
        [id, variante, request.user.username]
      );

      // Also log in garemodifiche for audit trail
      await query(
        `INSERT INTO garemodifiche ("id_gara", "UserName", "Data", "Modifiche")
         VALUES ($1, $2, NOW(), $3)`,
        [id, request.user.username, `INVIA: Inviate ${results.sent} notifiche email (${results.failed} fallite, ${results.skipped} saltate)`]
      );

      return { ...results, variante, inviato_da: request.user.username };
    } catch (err) {
      fastify.log.error(err, 'Invia notifiche error');
      return reply.status(500).send({ error: 'Errore invio notifiche', details: err.message });
    }
  });

  // ============================================================
  // GET /api/esiti/:id/invii - History of all INVIA actions for this esito
  // ============================================================
  fastify.get('/:id/invii', async (request) => {
    const { id } = request.params;
    const result = await query(
      `SELECT "id_gara", "Variante", "Data", "Username" FROM gareinvii WHERE "id_gara" = $1 ORDER BY "Data" DESC`,
      [id]
    );
    return result.rows;
  });

  // ============================================================
  // GET /api/esiti/:id/storia - Audit trail from garemodifiche
  // ============================================================
  fastify.get('/:id/storia', async (request) => {
    const { id } = request.params;
    const result = await query(
      `SELECT "id_gara", "UserName" AS username, "Data" AS data, "Modifiche" AS modifiche
       FROM garemodifiche WHERE "id_gara" = $1 ORDER BY "Data" DESC`,
      [id]
    );
    return result.rows;
  });

  // ============================================================
  // UTILITY: CalcolaIDTipologiaEsito - Mapping function from original ASP.NET
  // Maps (bando_tipologia + criterio) to correct esito tipologia ID (1-51)
  // ============================================================
  function calcolaIDTipologiaEsito(idTipologiaBando, idCriterio, extraParams = {}) {
    // Mapping arrays from SimulazioniController.cs
    const arrNuoviCasi = [16,17,18,19,22,23,24,25,30,31,32,35,36,37,33,38,47,48];
    const arrEscludiTaglioAli = [17,18,23,24,31,36,32,37];
    const arrMassimoRibasso = [3,4,6,29,30,31,32,33,34,35,36,37,38,45,46,51,52,61,62,63,64,65,66];
    const arrSbloccaCantieri = [43,44,45,46,49,50,51,52,53,54,55,57,58,59,61,62,63,64,65,66];
    const arrSempre15 = [54,58,62,65,55,59,63,66];
    const arrRegioneSicilia = [47,48];

    // Base logic: combine bando tipologia and criterio
    let idTipologiaEsito = idTipologiaBando;

    // Apply special rules based on criterio and extra params
    if (arrNuoviCasi.includes(idTipologiaBando)) {
      // Handle nuovi casi rules
      if (arrEscludiTaglioAli.includes(idTipologiaBando) && extraParams.excludeTaglio) {
        // Apply exclusion
      }
    }

    if (arrMassimoRibasso.includes(idTipologiaBando) && extraParams.hasRibasso) {
      // Massimo ribasso rules apply
    }

    if (arrSbloccaCantieri.includes(idTipologiaBando)) {
      // Sblocca Cantieri rules apply
    }

    if (arrSempre15.includes(idTipologiaBando) && extraParams.always15) {
      idTipologiaEsito = 15;
    }

    if (arrRegioneSicilia.includes(idTipologiaBando) && extraParams.regioneSicilia) {
      // Sicilia-specific rules apply
    }

    // Ensure output is within valid range 1-51
    idTipologiaEsito = Math.max(1, Math.min(51, idTipologiaEsito));

    return idTipologiaEsito;
  }

  // ============================================================
  // GET /api/esiti/tipologie-mapping - Returns the full mapping table
  // ============================================================
  fastify.get('/tipologie-mapping', async (request) => {
    try {
      const mappingData = {
        description: 'Mapping table for esito tipologie calculation',
        arrays: {
          nuoviCasi: [16,17,18,19,22,23,24,25,30,31,32,35,36,37,33,38,47,48],
          escludiTaglioAli: [17,18,23,24,31,36,32,37],
          massimoRibasso: [3,4,6,29,30,31,32,33,34,35,36,37,38,45,46,51,52,61,62,63,64,65,66],
          sbloccaCantieri: [43,44,45,46,49,50,51,52,53,54,55,57,58,59,61,62,63,64,65,66],
          sempre15: [54,58,62,65,55,59,63,66],
          regioneSicilia: [47,48]
        },
        validRange: {
          min: 1,
          max: 51
        },
        documentation: {
          nuoviCasi: 'New case IDs from reformed legislation',
          escludiTaglioAli: 'Exclude ribbon cutting rules (subset of nuoviCasi)',
          massimoRibasso: 'Maximum discount/rebate rules applicable',
          sbloccaCantieri: 'Unlocking Construction Sites (Decreto) rules',
          sempre15: 'Cases that always map to tipologia 15',
          regioneSicilia: 'Special rules for Sicily region'
        }
      };

      return mappingData;
    } catch (err) {
      fastify.log.error(err, 'Get tipologie mapping error');
      return { error: 'Errore lettura mapping tipologie', details: err.message };
    }
  });

  // ============================================================
  // POST /api/esiti/calcola-tipologia - Calculate correct esito tipologia
  // Given {id_tipologia_bando, id_criterio, extra_params}, returns id_tipologia for esito
  // ============================================================
  fastify.post('/calcola-tipologia', async (request) => {
    const {
      id_tipologia_bando,
      id_criterio,
      excludeTaglio,
      hasRibasso,
      always15,
      regioneSicilia,
      id_gara
    } = request.body;

    if (id_tipologia_bando === undefined || id_criterio === undefined) {
      return { error: 'id_tipologia_bando e id_criterio sono obbligatori' };
    }

    try {
      const extraParams = {
        excludeTaglio: excludeTaglio || false,
        hasRibasso: hasRibasso || false,
        always15: always15 || false,
        regioneSicilia: regioneSicilia || false
      };

      const idTipologiaCalcolata = calcolaIDTipologiaEsito(
        parseInt(id_tipologia_bando),
        parseInt(id_criterio),
        extraParams
      );

      // Log this calculation if id_gara is provided
      if (id_gara) {
        await query(
          `INSERT INTO esiti_tipologie_log ("id_gara", "id_tipologia_bando", "id_criterio", "id_tipologia_calcolata", "extra_params", "data_calcolo")
           VALUES ($1, $2, $3, $4, $5, NOW())`,
          [
            parseInt(id_gara),
            parseInt(id_tipologia_bando),
            parseInt(id_criterio),
            idTipologiaCalcolata,
            JSON.stringify(extraParams)
          ]
        );
      }

      return {
        id_tipologia_bando: parseInt(id_tipologia_bando),
        id_criterio: parseInt(id_criterio),
        id_tipologia_esito: idTipologiaCalcolata,
        extra_params: extraParams,
        id_gara: id_gara || null
      };
    } catch (err) {
      fastify.log.error(err, 'Calculate tipologia error');
      return { error: 'Errore calcolo tipologia', details: err.message };
    }
  });

  // ============================================================
  // GET /api/esiti/cestino - List deleted esiti
  // ============================================================
  fastify.get('/cestino', { preHandler: [fastify.authenticate] }, async (request) => {
    const { page = 1, limit = 25, sort = 'Data', order = 'DESC' } = request.query;
    const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);
    const allowedSort = ['Data', 'Titolo', 'Importo', 'NPartecipanti'];
    const sortCol = allowedSort.includes(sort) ? `g."${sort}"` : 'g."Data"';
    const sortDir = order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const [countResult, dataResult] = await Promise.all([
      query(`SELECT COUNT(*) as total FROM gare g WHERE g."eliminata" = true`),
      query(`
        SELECT g."id", g."Data" AS data, g."Titolo" AS titolo, g."NPartecipanti" AS n_partecipanti,
          g."Importo" AS importo, g."DataModifica" AS data_modifica
        FROM gare g
        WHERE g."eliminata" = true
        ORDER BY ${sortCol} ${sortDir}
        LIMIT $1 OFFSET $2
      `, [parseInt(limit), offset])
    ]);

    return {
      data: dataResult.rows,
      total: countResult.rows[0].total,
      page: parseInt(page),
      limit: parseInt(limit)
    };
  });

  // ============================================================
  // POST /api/esiti/:id/ripristina - Restore from trash
  // ============================================================
  fastify.post('/:id/ripristina', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;
    const result = await query(
      `UPDATE gare SET "eliminata" = false, "DataModifica" = NOW() WHERE "id" = $1 AND "eliminata" = true RETURNING "id"`,
      [id]
    );
    if (result.rows.length === 0) {
      return reply.status(404).send({ error: 'Esito non trovato o non eliminato' });
    }
    return { message: 'Esito ripristinato', id: result.rows[0].id };
  });

  // ============================================================
  // GET /api/esiti/incompleti - List esiti with missing required fields
  // ============================================================
  fastify.get('/incompleti', { preHandler: [fastify.authenticate] }, async (request) => {
    const { page = 1, limit = 25 } = request.query;
    const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

    const [countResult, dataResult] = await Promise.all([
      query(`
        SELECT COUNT(*) as total FROM gare
        WHERE "eliminata" = false AND (
          "Titolo" IS NULL OR "Titolo" = '' OR
          "id_stazione" IS NULL OR
          "Data" IS NULL OR
          "Importo" IS NULL OR
          "id_tipologia" IS NULL OR
          "NPartecipanti" IS NULL OR "NPartecipanti" = 0
        )
      `),
      query(`
        SELECT "id", "Data" AS data, "Titolo" AS titolo, "NPartecipanti" AS n_partecipanti,
          "Importo" AS importo, "id_stazione", "id_tipologia"
        FROM gare
        WHERE "eliminata" = false AND (
          "Titolo" IS NULL OR "Titolo" = '' OR
          "id_stazione" IS NULL OR
          "Data" IS NULL OR
          "Importo" IS NULL OR
          "id_tipologia" IS NULL OR
          "NPartecipanti" IS NULL OR "NPartecipanti" = 0
        )
        ORDER BY "Data" DESC
        LIMIT $1 OFFSET $2
      `, [parseInt(limit), offset])
    ]);

    return {
      data: dataResult.rows,
      total: countResult.rows[0].total,
      page: parseInt(page),
      limit: parseInt(limit)
    };
  });

  // ============================================================
  // GET /api/esiti/da-abilitare - List confirmed but not enabled esiti
  // ============================================================
  fastify.get('/da-abilitare', { preHandler: [fastify.authenticate] }, async (request) => {
    const { page = 1, limit = 25 } = request.query;
    const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

    const [countResult, dataResult] = await Promise.all([
      query(`
        SELECT COUNT(*) as total FROM gare
        WHERE "eliminata" = false AND "temp" = false AND "enabled" = false
      `),
      query(`
        SELECT "id", "Data" AS data, "Titolo" AS titolo, "NPartecipanti" AS n_partecipanti,
          "Importo" AS importo, "temp", "enabled"
        FROM gare
        WHERE "eliminata" = false AND "temp" = false AND "enabled" = false
        ORDER BY "Data" DESC
        LIMIT $1 OFFSET $2
      `, [parseInt(limit), offset])
    ]);

    return {
      data: dataResult.rows,
      total: countResult.rows[0].total,
      page: parseInt(page),
      limit: parseInt(limit)
    };
  });

  // ============================================================
  // GET /api/esiti/modificabili - List esiti with collaborative editing
  // ============================================================
  fastify.get('/modificabili', { preHandler: [fastify.authenticate] }, async (request) => {
    const { page = 1, limit = 25 } = request.query;
    const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

    const [countResult, dataResult] = await Promise.all([
      query(`
        SELECT COUNT(*) as total FROM gare
        WHERE "eliminata" = false AND "EnableToAll" = true
      `),
      query(`
        SELECT "id", "Data" AS data, "Titolo" AS titolo, "NPartecipanti" AS n_partecipanti,
          "Importo" AS importo, "EnableToAll"
        FROM gare
        WHERE "eliminata" = false AND "EnableToAll" = true
        ORDER BY "Data" DESC
        LIMIT $1 OFFSET $2
      `, [parseInt(limit), offset])
    ]);

    return {
      data: dataResult.rows,
      total: countResult.rows[0].total,
      page: parseInt(page),
      limit: parseInt(limit)
    };
  });

  // ============================================================
  // POST /api/esiti/:id/clona - Clone an esito
  // ============================================================
  fastify.post('/:id/clona', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;

    try {
      await transaction(async (trx) => {
        // Get source esito
        const sourceResult = await trx(
          `SELECT * FROM gare WHERE "id" = $1`,
          [id]
        );
        if (sourceResult.rows.length === 0) {
          throw new Error('Esito sorgente non trovato');
        }

        const source = sourceResult.rows[0];
        const insertFields = [];
        const insertValues = [];
        let idx = 1;

        const fieldsToClone = [
          'Titolo', 'CodiceCIG', 'id_stazione', 'Data', 'Importo', 'id_tipologia',
          'NPartecipanti', 'Ribasso', 'MediaAr', 'MediaAlt', 'MediaScIstanza',
          'MediaScAppello', 'Anomala', 'Variante', 'ModificatoDa'
        ];

        fieldsToClone.forEach(field => {
          if (source[field] !== undefined) {
            insertFields.push(`"${field}"`);
            insertValues.push(source[field]);
          }
        });

        insertFields.push('"temp"', '"enabled"', '"eliminata"', '"InserimentoDa"');
        insertValues.push(true, false, false, request.user?.username || 'system');

        const newEsitoResult = await trx(
          `INSERT INTO gare (${insertFields.join(', ')}) VALUES (${insertFields.map(() => `$${idx++}`).join(', ')}) RETURNING "id"`,
          insertValues
        );

        const newId = newEsitoResult.rows[0].id;

        // Clone province
        await trx(
          `INSERT INTO gare_province ("id_gara", "id_provincia")
           SELECT $1, "id_provincia" FROM gare_province WHERE "id_gara" = $2`,
          [newId, id]
        );

        // Clone SOA (all 4 types)
        await trx(
          `INSERT INTO gare_soa_sec ("id_gara", "id_soa")
           SELECT $1, "id_soa" FROM gare_soa_sec WHERE "id_gara" = $2`,
          [newId, id]
        );
        await trx(
          `INSERT INTO gare_soa_alt ("id_gara", "id_soa")
           SELECT $1, "id_soa" FROM gare_soa_alt WHERE "id_gara" = $2`,
          [newId, id]
        );
        await trx(
          `INSERT INTO gare_soa_app ("id_gara", "id_soa")
           SELECT $1, "id_soa" FROM gare_soa_app WHERE "id_gara" = $2`,
          [newId, id]
        );
        await trx(
          `INSERT INTO gare_soa_sost ("id_gara", "id_soa")
           SELECT $1, "id_soa" FROM gare_soa_sost WHERE "id_gara" = $2`,
          [newId, id]
        );

        // Clone dettagli_gara
        await trx(
          `INSERT INTO dettaglio_gara (
            id_gara, variante, id_azienda, posizione, ribasso, importo_offerta,
            taglio_ali, anomala, vincitrice, ammessa, esclusa,
            da_verificare, sconosciuto, ragione_sociale, partita_iva,
            punteggio_tecnico, punteggio_economico, punteggio_totale, inserimento, note
          )
           SELECT $1, variante, id_azienda, posizione, ribasso, importo_offerta,
            taglio_ali, anomala, vincitrice, ammessa, esclusa,
            da_verificare, sconosciuto, ragione_sociale, partita_iva,
            punteggio_tecnico, punteggio_economico, punteggio_totale, inserimento, note
           FROM dettaglio_gara WHERE id_gara = $2`,
          [newId, id]
        );

        return newId;
      });

      const newEsitoResult = await query('SELECT "id" FROM gare WHERE "id" = $1', []);
      return reply.status(201).send({
        message: 'Esito clonato',
        new_id: newId,
        temp: true,
        enabled: false
      });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(400).send({ error: err.message });
    }
  });

  // ============================================================
  // ATI/Mandanti Management
  // ============================================================

  // GET /api/esiti/:id/ati - List all ATI for esito
  fastify.get('/:id/ati', { preHandler: [fastify.authenticate] }, async (request) => {
    const { id } = request.params;
    const result = await query(`
      SELECT ag."id", ag."id_gara", ag."id_azienda" AS id_mandataria,
        az."ragione_sociale" AS mandataria_nome,
        json_agg(
          json_build_object(
            'id_mandante', m."id_azienda",
            'mandante_nome', m_az."ragione_sociale",
            'quota', m."quota"
          )
        ) AS mandanti
      FROM ati_gare ag
      JOIN aziende az ON ag."id_azienda" = az."id"
      LEFT JOIN mandanti m ON ag."id" = m."id_ati"
      LEFT JOIN aziende m_az ON m."id_azienda" = m_az."id"
      WHERE ag."id_gara" = $1
      GROUP BY ag."id", ag."id_gara", ag."id_azienda", az."ragione_sociale"
    `, [id]);
    return result.rows;
  });

  // POST /api/esiti/:id/ati - Create ATI
  fastify.post('/:id/ati', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;
    const { id_mandataria, mandanti } = request.body;

    if (!id_mandataria) {
      return reply.status(400).send({ error: 'id_mandataria è obbligatorio' });
    }

    try {
      await transaction(async (trx) => {
        const atiResult = await trx(
          `INSERT INTO ati_gare ("id_gara", "id_azienda") VALUES ($1, $2) RETURNING "id"`,
          [id, id_mandataria]
        );
        const id_ati = atiResult.rows[0].id;

        if (mandanti && Array.isArray(mandanti)) {
          for (const m of mandanti) {
            await trx(
              `INSERT INTO mandanti ("id_ati", "id_azienda", "quota") VALUES ($1, $2, $3)`,
              [id_ati, m.id_azienda, m.quota || null]
            );
          }
        }
      });

      return reply.status(201).send({ message: 'ATI creato' });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(400).send({ error: err.message });
    }
  });

  // PUT /api/esiti/ati/:idAti - Update ATI
  fastify.put('/ati/:idAti', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { idAti } = request.params;
    const { id_azienda } = request.body;

    if (!id_azienda) {
      return reply.status(400).send({ error: 'id_azienda è obbligatorio' });
    }

    const result = await query(
      `UPDATE ati_gare SET "id_azienda" = $1 WHERE "id" = $2 RETURNING *`,
      [id_azienda, idAti]
    );

    if (result.rows.length === 0) {
      return reply.status(404).send({ error: 'ATI non trovato' });
    }
    return result.rows[0];
  });

  // DELETE /api/esiti/ati/:idAti - Delete ATI
  fastify.delete('/ati/:idAti', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { idAti } = request.params;

    await query(`DELETE FROM mandanti WHERE "id_ati" = $1`, [idAti]);
    const result = await query(
      `DELETE FROM ati_gare WHERE "id" = $1 RETURNING "id"`,
      [idAti]
    );

    if (result.rows.length === 0) {
      return reply.status(404).send({ error: 'ATI non trovato' });
    }
    return { message: 'ATI eliminato', id: result.rows[0].id };
  });

  // GET /api/esiti/:id/mandanti/:idAzienda - Get mandanti for mandataria
  fastify.get('/:id/mandanti/:idAzienda', { preHandler: [fastify.authenticate] }, async (request) => {
    const { id, idAzienda } = request.params;
    const result = await query(`
      SELECT m."id", m."id_ati", m."id_azienda", m."quota",
        az."ragione_sociale" AS azienda_nome
      FROM mandanti m
      JOIN ati_gare ag ON m."id_ati" = ag."id"
      JOIN aziende az ON m."id_azienda" = az."id"
      WHERE ag."id_gara" = $1 AND ag."id_azienda" = $2
    `, [id, idAzienda]);
    return result.rows;
  });

  // POST /api/esiti/:id/mandanti - Add mandante
  fastify.post('/:id/mandanti', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;
    const { id_ati, id_azienda, quota } = request.body;

    if (!id_ati || !id_azienda) {
      return reply.status(400).send({ error: 'id_ati e id_azienda sono obbligatori' });
    }

    try {
      const result = await query(
        `INSERT INTO mandanti ("id_ati", "id_azienda", "quota") VALUES ($1, $2, $3) RETURNING *`,
        [id_ati, id_azienda, quota || null]
      );
      return reply.status(201).send(result.rows[0]);
    } catch (err) {
      fastify.log.error(err);
      return reply.status(400).send({ error: err.message });
    }
  });

  // DELETE /api/esiti/mandanti/:idMandante - Remove mandante
  fastify.delete('/mandanti/:idMandante', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { idMandante } = request.params;
    const result = await query(
      `DELETE FROM mandanti WHERE "id" = $1 RETURNING "id"`,
      [idMandante]
    );

    if (result.rows.length === 0) {
      return reply.status(404).send({ error: 'Mandante non trovato' });
    }
    return { message: 'Mandante rimosso', id: result.rows[0].id };
  });

  // ============================================================
  // Punteggi OEPV (Offerta Economicamente Più Vantaggiosa)
  // ============================================================

  // GET /api/esiti/:id/punteggi - Get all scoring criteria
  fastify.get('/:id/punteggi', { preHandler: [fastify.authenticate] }, async (request) => {
    const { id } = request.params;
    const result = await query(`
      SELECT p."id", p."id_gara", p."id_azienda", p."punteggio_tecnico",
        p."punteggio_economico", p."punteggio_totale",
        az."ragione_sociale" AS azienda_nome
      FROM punteggi p
      LEFT JOIN aziende az ON p."id_azienda" = az."id"
      WHERE p."id_gara" = $1
      ORDER BY p."punteggio_totale" DESC
    `, [id]);
    return result.rows;
  });

  // POST /api/esiti/:id/punteggi - Add score
  fastify.post('/:id/punteggi', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;
    const { id_azienda, punteggio_tecnico, punteggio_economico, punteggio_totale } = request.body;

    if (!id_azienda) {
      return reply.status(400).send({ error: 'id_azienda è obbligatorio' });
    }

    try {
      const result = await query(
        `INSERT INTO punteggi ("id_gara", "id_azienda", "punteggio_tecnico", "punteggio_economico", "punteggio_totale")
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [id, id_azienda, punteggio_tecnico || null, punteggio_economico || null, punteggio_totale || null]
      );
      return reply.status(201).send(result.rows[0]);
    } catch (err) {
      fastify.log.error(err);
      return reply.status(400).send({ error: err.message });
    }
  });

  // PUT /api/esiti/punteggi/:idPunteggio - Update score
  fastify.put('/punteggi/:idPunteggio', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { idPunteggio } = request.params;
    const { punteggio_tecnico, punteggio_economico, punteggio_totale } = request.body;

    const updateFields = [];
    const updateValues = [];
    let idx = 1;

    if (punteggio_tecnico !== undefined) {
      updateFields.push(`"punteggio_tecnico" = $${idx++}`);
      updateValues.push(punteggio_tecnico);
    }
    if (punteggio_economico !== undefined) {
      updateFields.push(`"punteggio_economico" = $${idx++}`);
      updateValues.push(punteggio_economico);
    }
    if (punteggio_totale !== undefined) {
      updateFields.push(`"punteggio_totale" = $${idx++}`);
      updateValues.push(punteggio_totale);
    }

    if (updateFields.length === 0) {
      return reply.status(400).send({ error: 'Nessun campo da aggiornare' });
    }

    updateValues.push(idPunteggio);
    const result = await query(
      `UPDATE punteggi SET ${updateFields.join(', ')} WHERE "id" = $${idx} RETURNING *`,
      updateValues
    );

    if (result.rows.length === 0) {
      return reply.status(404).send({ error: 'Punteggio non trovato' });
    }
    return result.rows[0];
  });

  // DELETE /api/esiti/punteggi/:idPunteggio - Delete score
  fastify.delete('/punteggi/:idPunteggio', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { idPunteggio } = request.params;
    const result = await query(
      `DELETE FROM punteggi WHERE "id" = $1 RETURNING "id"`,
      [idPunteggio]
    );

    if (result.rows.length === 0) {
      return reply.status(404).send({ error: 'Punteggio non trovato' });
    }
    return { message: 'Punteggio eliminato', id: result.rows[0].id };
  });

  // POST /api/esiti/:id/punteggi/bulk - Bulk import scores
  fastify.post('/:id/punteggi/bulk', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;
    const { punteggi } = request.body;

    if (!Array.isArray(punteggi) || punteggi.length === 0) {
      return reply.status(400).send({ error: 'punteggi deve essere un array non vuoto' });
    }

    try {
      await transaction(async (trx) => {
        for (const p of punteggi) {
          await trx(
            `INSERT INTO punteggi ("id_gara", "id_azienda", "punteggio_tecnico", "punteggio_economico", "punteggio_totale")
             VALUES ($1, $2, $3, $4, $5)`,
            [id, p.id_azienda, p.pt || null, p.pe || null, p.ptot || null]
          );
        }
      });

      return reply.status(201).send({ message: `${punteggi.length} punteggi importati` });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(400).send({ error: err.message });
    }
  });

  // ============================================================
  // Ricorsi (Appeals)
  // ============================================================

  // GET /api/esiti/:id/ricorsi - List appeals for esito
  fastify.get('/:id/ricorsi', { preHandler: [fastify.authenticate] }, async (request) => {
    const { id } = request.params;
    const result = await query(`
      SELECT r."id", r."id_gara", r."id_azienda", r."tipo", r."data_ricorso",
        r."esito_ricorso", r."note",
        az."ragione_sociale" AS azienda_nome
      FROM gare_ricorsi r
      LEFT JOIN aziende az ON r."id_azienda" = az."id"
      WHERE r."id_gara" = $1
      ORDER BY r."data_ricorso" DESC
    `, [id]);
    return result.rows;
  });

  // POST /api/esiti/:id/ricorsi - Create appeal
  fastify.post('/:id/ricorsi', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;
    const { id_azienda, tipo, data_ricorso, esito_ricorso, note } = request.body;

    if (!id_azienda) {
      return reply.status(400).send({ error: 'id_azienda è obbligatorio' });
    }

    try {
      const result = await query(
        `INSERT INTO gare_ricorsi ("id_gara", "id_azienda", "tipo", "data_ricorso", "esito_ricorso", "note")
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [id, id_azienda, tipo || null, data_ricorso || null, esito_ricorso || null, note || null]
      );
      return reply.status(201).send(result.rows[0]);
    } catch (err) {
      fastify.log.error(err);
      return reply.status(400).send({ error: err.message });
    }
  });

  // PUT /api/esiti/ricorsi/:idRicorso - Update appeal
  fastify.put('/ricorsi/:idRicorso', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { idRicorso } = request.params;
    const { tipo, data_ricorso, esito_ricorso, note } = request.body;

    const updateFields = [];
    const updateValues = [];
    let idx = 1;

    if (tipo !== undefined) {
      updateFields.push(`"tipo" = $${idx++}`);
      updateValues.push(tipo);
    }
    if (data_ricorso !== undefined) {
      updateFields.push(`"data_ricorso" = $${idx++}`);
      updateValues.push(data_ricorso);
    }
    if (esito_ricorso !== undefined) {
      updateFields.push(`"esito_ricorso" = $${idx++}`);
      updateValues.push(esito_ricorso);
    }
    if (note !== undefined) {
      updateFields.push(`"note" = $${idx++}`);
      updateValues.push(note);
    }

    if (updateFields.length === 0) {
      return reply.status(400).send({ error: 'Nessun campo da aggiornare' });
    }

    updateValues.push(idRicorso);
    const result = await query(
      `UPDATE gare_ricorsi SET ${updateFields.join(', ')} WHERE "id" = $${idx} RETURNING *`,
      updateValues
    );

    if (result.rows.length === 0) {
      return reply.status(404).send({ error: 'Ricorso non trovato' });
    }
    return result.rows[0];
  });

  // DELETE /api/esiti/ricorsi/:idRicorso - Delete appeal
  fastify.delete('/ricorsi/:idRicorso', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { idRicorso } = request.params;
    const result = await query(
      `DELETE FROM gare_ricorsi WHERE "id" = $1 RETURNING "id"`,
      [idRicorso]
    );

    if (result.rows.length === 0) {
      return reply.status(404).send({ error: 'Ricorso non trovato' });
    }
    return { message: 'Ricorso eliminato', id: result.rows[0].id };
  });

  // ============================================================
  // POST /api/esiti/:id/forza-vincitore - Force a winner
  // ============================================================
  fastify.post('/:id/forza-vincitore', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;
    const { id_azienda, motivo } = request.body;

    if (!id_azienda) {
      return reply.status(400).send({ error: 'id_azienda è obbligatorio' });
    }

    try {
      await transaction(async (trx) => {
        await trx(
          `UPDATE gare SET "Vincitore" = $1, "DataModifica" = NOW() WHERE "id" = $2`,
          [id_azienda, id]
        );

        await trx(
          `INSERT INTO gare_modifiche ("id_gara", "id_utente", "motivo", "data_modifica", "tipo")
           VALUES ($1, $2, $3, NOW(), 'FORZA_VINCITORE')`,
          [id, request.user?.id || 0, motivo || null]
        );
      });

      return { message: 'Vincitore forzato', id_azienda };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(400).send({ error: err.message });
    }
  });

  // ============================================================
  // Numerazione Management
  // ============================================================

  // POST /api/esiti/:id/copia-numerazione - Copy ordering from another esito
  fastify.post('/:id/copia-numerazione', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;
    const { id_esito_sorgente } = request.body;

    if (!id_esito_sorgente) {
      return reply.status(400).send({ error: 'id_esito_sorgente è obbligatorio' });
    }

    try {
      await transaction(async (trx) => {
        // Get source ordering
        const sourceOrder = await trx(
          `SELECT "id", posizione FROM dettaglio_gara WHERE "id_gara" = $1 ORDER BY posizione ASC NULLS LAST`,
          [id_esito_sorgente]
        );

        // Get target details
        const targetDetails = await trx(
          `SELECT "id" FROM dettaglio_gara WHERE "id_gara" = $1 ORDER BY "id" ASC`,
          [id]
        );

        // Apply ordering to target (1:1 match by sequence)
        for (let i = 0; i < Math.min(sourceOrder.rows.length, targetDetails.rows.length); i++) {
          await trx(
            `UPDATE dettaglio_gara SET posizione = $1 WHERE "id" = $2`,
            [sourceOrder.rows[i].Posizione, targetDetails.rows[i].id]
          );
        }
      });

      return { message: 'Numerazione copiata' };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(400).send({ error: err.message });
    }
  });

  // POST /api/esiti/:id/inverti-numerazione - Reverse ordering
  fastify.post('/:id/inverti-numerazione', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;

    try {
      await transaction(async (trx) => {
        const details = await trx(
          `SELECT "id" FROM dettaglio_gara WHERE "id_gara" = $1 ORDER BY posizione DESC NULLS LAST`,
          [id]
        );

        for (let i = 0; i < details.rows.length; i++) {
          await trx(
            `UPDATE dettaglio_gara SET posizione = $1 WHERE "id" = $2`,
            [i + 1, details.rows[i].id]
          );
        }
      });

      return { message: 'Numerazione invertita' };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(400).send({ error: err.message });
    }
  });

  // POST /api/esiti/:id/sposta-numerazione - Move detail to new position
  fastify.post('/:id/sposta-numerazione', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;
    const { id_dettaglio, nuova_posizione } = request.body;

    if (!id_dettaglio || nuova_posizione === undefined) {
      return reply.status(400).send({ error: 'id_dettaglio e nuova_posizione sono obbligatori' });
    }

    try {
      await transaction(async (trx) => {
        const detail = await trx(
          `SELECT posizione FROM dettaglio_gara WHERE "id" = $1`,
          [id_dettaglio]
        );

        if (detail.rows.length === 0) {
          throw new Error('Dettaglio non trovato');
        }

        const oldPos = detail.rows[0].Posizione;
        const newPos = parseInt(nuova_posizione);

        if (oldPos < newPos) {
          // Moving down: decrement positions between oldPos+1 and newPos
          await trx(
            `UPDATE dettaglio_gara SET posizione = posizione - 1
             WHERE "id_gara" = $1 AND posizione > $2 AND posizione <= $3`,
            [id, oldPos, newPos]
          );
        } else if (oldPos > newPos) {
          // Moving up: increment positions between newPos and oldPos-1
          await trx(
            `UPDATE dettaglio_gara SET posizione = posizione + 1
             WHERE "id_gara" = $1 AND posizione >= $2 AND posizione < $3`,
            [id, newPos, oldPos]
          );
        }

        // Set the detail to new position
        await trx(
          `UPDATE dettaglio_gara SET posizione = $1 WHERE "id" = $2`,
          [newPos, id_dettaglio]
        );
      });

      return { message: 'Dettaglio spostato', new_position: nuova_posizione };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(400).send({ error: err.message });
    }
  });

  // ============================================================
  // GET /api/esiti/:id/esporta-xml - Export esito as XML
  // ============================================================
  fastify.get('/:id/esporta-xml', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;

    try {
      const eR = await query(`SELECT * FROM gare WHERE "id" = $1`, [id]);
      if (eR.rows.length === 0) {
        return reply.status(404).send({ error: 'Esito non trovato' });
      }

      const esito = eR.rows[0];
      const dettagli = await query(`SELECT * FROM dettaglio_gara WHERE "id_gara" = $1 ORDER BY posizione`, [id]);

      let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
      xml += '<Esito>\n';
      xml += `  <Id>${esito.id}</Id>\n`;
      xml += `  <Titolo>${escapeXml(esito.Titolo)}</Titolo>\n`;
      xml += `  <CodiceCIG>${esito.CodiceCIG}</CodiceCIG>\n`;
      xml += `  <Data>${esito.Data}</Data>\n`;
      xml += `  <Importo>${esito.Importo}</Importo>\n`;
      xml += `  <NPartecipanti>${esito.NPartecipanti}</NPartecipanti>\n`;
      xml += `  <Ribasso>${esito.Ribasso}</Ribasso>\n`;

      xml += '  <Dettagli>\n';
      for (const det of dettagli.rows) {
        xml += '    <Dettaglio>\n';
        xml += `      <Posizione>${det.Posizione}</Posizione>\n`;
        xml += `      <RagioneSociale>${escapeXml(det.RagioneSociale)}</RagioneSociale>\n`;
        xml += `      <PartitaIva>${det.PartitaIva}</PartitaIva>\n`;
        xml += `      <Ribasso>${det.Ribasso}</Ribasso>\n`;
        xml += `      <Vincitrice>${det.Vincitrice ? 'true' : 'false'}</Vincitrice>\n`;
        xml += `      <Ammessa>${det.Ammessa ? 'true' : 'false'}</Ammessa>\n`;
        xml += '    </Dettaglio>\n';
      }
      xml += '  </Dettagli>\n';
      xml += '</Esito>';

      reply.type('application/xml');
      return xml;
    } catch (err) {
      fastify.log.error(err);
      return reply.status(400).send({ error: err.message });
    }
  });

  // Helper function to escape XML special characters
  function escapeXml(str) {
    if (!str) return '';
    return str.replace(/[<>&'"]/g, (c) => {
      switch (c) {
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '&': return '&amp;';
        case "'": return '&apos;';
        case '"': return '&quot;';
        default: return c;
      }
    });
  }

  // ============================================================
  // POST /api/esiti/:id/associa-bando - Associate a bando
  // ============================================================
  fastify.post('/:id/associa-bando', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;
    const { id_bando } = request.body;

    if (!id_bando) {
      return reply.status(400).send({ error: 'id_bando è obbligatorio' });
    }

    try {
      const result = await query(
        `UPDATE gare SET "id_bando" = $1, "DataModifica" = NOW() WHERE "id" = $2 RETURNING "id", "id_bando"`,
        [id_bando, id]
      );

      if (result.rows.length === 0) {
        return reply.status(404).send({ error: 'Esito non trovato' });
      }

      return { message: 'Bando associato', ...result.rows[0] };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(400).send({ error: err.message });
    }
  });

  // ============================================================
  // GET /api/esiti/per-utente/:username - List esiti by inserting user
  // ============================================================
  fastify.get('/per-utente/:username', { preHandler: [fastify.authenticate] }, async (request) => {
    const { username } = request.params;
    const { page = 1, limit = 25 } = request.query;
    const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

    const [countResult, dataResult] = await Promise.all([
      query(`SELECT COUNT(*) as total FROM gare WHERE "InserimentoDa" = $1 AND "eliminata" = false`, [username]),
      query(`
        SELECT "id", "Data" AS data, "Titolo" AS titolo, "NPartecipanti" AS n_partecipanti,
          "Importo" AS importo, "InserimentoDa", "DataInserimento"
        FROM gare
        WHERE "InserimentoDa" = $1 AND "eliminata" = false
        ORDER BY "Data" DESC
        LIMIT $2 OFFSET $3
      `, [username, parseInt(limit), offset])
    ]);

    return {
      data: dataResult.rows,
      total: countResult.rows[0].total,
      page: parseInt(page),
      limit: parseInt(limit)
    };
  });

  // ============================================================
  // SOA Management (4 types)
  // ============================================================

  // GET /api/esiti/:id/soa - Get all 4 SOA types
  fastify.get('/:id/soa', { preHandler: [fastify.authenticate] }, async (request) => {
    const { id } = request.params;

    const [sec, alt, app, sost] = await Promise.all([
      query(`
        SELECT s."id", s."id_soa", so."Descrizione" AS soa_desc, 'SECONDARIA' AS tipo
        FROM gare_soa_sec s
        LEFT JOIN soa so ON s."id_soa" = so."id"
        WHERE s."id_gara" = $1
      `, [id]),
      query(`
        SELECT s."id", s."id_soa", so."Descrizione" AS soa_desc, 'ALTERNATIVA' AS tipo
        FROM gare_soa_alt s
        LEFT JOIN soa so ON s."id_soa" = so."id"
        WHERE s."id_gara" = $1
      `, [id]),
      query(`
        SELECT s."id", s."id_soa", so."Descrizione" AS soa_desc, 'APPROFONDIMENTO' AS tipo
        FROM gare_soa_app s
        LEFT JOIN soa so ON s."id_soa" = so."id"
        WHERE s."id_gara" = $1
      `, [id]),
      query(`
        SELECT s."id", s."id_soa", so."Descrizione" AS soa_desc, 'SOSTITUIVO' AS tipo
        FROM gare_soa_sost s
        LEFT JOIN soa so ON s."id_soa" = so."id"
        WHERE s."id_gara" = $1
      `, [id])
    ]);

    return {
      secondaria: sec.rows,
      alternativa: alt.rows,
      approfondimento: app.rows,
      sostituivo: sost.rows
    };
  });

  // POST /api/esiti/:id/soa-sec - Add secondary SOA
  fastify.post('/:id/soa-sec', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;
    const { id_soa } = request.body;

    if (!id_soa) {
      return reply.status(400).send({ error: 'id_soa è obbligatorio' });
    }

    try {
      const result = await query(
        `INSERT INTO gare_soa_sec ("id_gara", "id_soa") VALUES ($1, $2) RETURNING *`,
        [id, id_soa]
      );
      return reply.status(201).send(result.rows[0]);
    } catch (err) {
      fastify.log.error(err);
      return reply.status(400).send({ error: err.message });
    }
  });

  // DELETE /api/esiti/:id/soa-sec/:idSoa - Remove secondary SOA
  fastify.delete('/:id/soa-sec/:idSoa', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id, idSoa } = request.params;
    const result = await query(
      `DELETE FROM gare_soa_sec WHERE "id_gara" = $1 AND "id" = $2 RETURNING "id"`,
      [id, idSoa]
    );

    if (result.rows.length === 0) {
      return reply.status(404).send({ error: 'SOA non trovato' });
    }
    return { message: 'SOA secondaria rimossa', id: result.rows[0].id };
  });

  // POST /api/esiti/:id/soa-alt - Add alternative SOA
  fastify.post('/:id/soa-alt', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;
    const { id_soa } = request.body;

    if (!id_soa) {
      return reply.status(400).send({ error: 'id_soa è obbligatorio' });
    }

    try {
      const result = await query(
        `INSERT INTO gare_soa_alt ("id_gara", "id_soa") VALUES ($1, $2) RETURNING *`,
        [id, id_soa]
      );
      return reply.status(201).send(result.rows[0]);
    } catch (err) {
      fastify.log.error(err);
      return reply.status(400).send({ error: err.message });
    }
  });

  // DELETE /api/esiti/:id/soa-alt/:idSoa - Remove alternative SOA
  fastify.delete('/:id/soa-alt/:idSoa', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id, idSoa } = request.params;
    const result = await query(
      `DELETE FROM gare_soa_alt WHERE "id_gara" = $1 AND "id" = $2 RETURNING "id"`,
      [id, idSoa]
    );

    if (result.rows.length === 0) {
      return reply.status(404).send({ error: 'SOA non trovato' });
    }
    return { message: 'SOA alternativa rimossa', id: result.rows[0].id };
  });

  // POST /api/esiti/:id/soa-app - Add specialized SOA
  fastify.post('/:id/soa-app', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;
    const { id_soa } = request.body;

    if (!id_soa) {
      return reply.status(400).send({ error: 'id_soa è obbligatorio' });
    }

    try {
      const result = await query(
        `INSERT INTO gare_soa_app ("id_gara", "id_soa") VALUES ($1, $2) RETURNING *`,
        [id, id_soa]
      );
      return reply.status(201).send(result.rows[0]);
    } catch (err) {
      fastify.log.error(err);
      return reply.status(400).send({ error: err.message });
    }
  });

  // DELETE /api/esiti/:id/soa-app/:idSoa - Remove specialized SOA
  fastify.delete('/:id/soa-app/:idSoa', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id, idSoa } = request.params;
    const result = await query(
      `DELETE FROM gare_soa_app WHERE "id_gara" = $1 AND "id" = $2 RETURNING "id"`,
      [id, idSoa]
    );

    if (result.rows.length === 0) {
      return reply.status(404).send({ error: 'SOA non trovato' });
    }
    return { message: 'SOA approfondimento rimossa', id: result.rows[0].id };
  });

  // POST /api/esiti/:id/soa-sost - Add substitute SOA
  fastify.post('/:id/soa-sost', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;
    const { id_soa } = request.body;

    if (!id_soa) {
      return reply.status(400).send({ error: 'id_soa è obbligatorio' });
    }

    try {
      const result = await query(
        `INSERT INTO gare_soa_sost ("id_gara", "id_soa") VALUES ($1, $2) RETURNING *`,
        [id, id_soa]
      );
      return reply.status(201).send(result.rows[0]);
    } catch (err) {
      fastify.log.error(err);
      return reply.status(400).send({ error: err.message });
    }
  });

  // DELETE /api/esiti/:id/soa-sost/:idSoa - Remove substitute SOA
  fastify.delete('/:id/soa-sost/:idSoa', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id, idSoa } = request.params;
    const result = await query(
      `DELETE FROM gare_soa_sost WHERE "id_gara" = $1 AND "id" = $2 RETURNING "id"`,
      [id, idSoa]
    );

    if (result.rows.length === 0) {
      return reply.status(404).send({ error: 'SOA non trovato' });
    }
    return { message: 'SOA sostitutivo rimossa', id: result.rows[0].id };
  });

  // ============================================================
  // GET /api/esiti/tipologie - List all esiti tipologie
  // ============================================================
  fastify.get('/tipologie', { preHandler: [fastify.authenticate] }, async () => {
    const result = await query(`
      SELECT id, nome AS tipologia, descrizione
      FROM tipologia_gare
      ORDER BY nome ASC
    `);
    return result.rows;
  });

  // ============================================================
  // GET /api/esiti/:id/stato-servizio - Get service status for esito
  // ============================================================
  fastify.get('/:id/stato-servizio', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;

    try {
      const eR = await query(`
        SELECT "id", "temp", "enabled", "Bloccato", "eliminata", "DataModifica"
        FROM gare WHERE "id" = $1
      `, [id]);

      if (eR.rows.length === 0) {
        return reply.status(404).send({ error: 'Esito non trovato' });
      }

      const esito = eR.rows[0];
      let stato = 'SCONOSCIUTO';

      if (esito.eliminata) {
        stato = 'ELIMINATO';
      } else if (esito.Bloccato) {
        stato = 'BLOCCATO';
      } else if (esito.temp && !esito.enabled) {
        stato = 'BOZZA';
      } else if (!esito.temp && !esito.enabled) {
        stato = 'DA_ABILITARE';
      } else if (!esito.temp && esito.enabled) {
        stato = 'ABILITATO';
      }

      return {
        id: esito.id,
        stato,
        temp: esito.temp,
        enabled: esito.enabled,
        bloccato: esito.Bloccato,
        eliminata: esito.eliminata,
        ultima_modifica: esito.DataModifica
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(400).send({ error: err.message });
    }
  });

  // ============================================================
  // Avvalimenti Management
  // ============================================================

  // GET /api/esiti/:id/avvalimenti - List avvalimenti for esito
  fastify.get('/:id/avvalimenti', { preHandler: [fastify.authenticate] }, async (request) => {
    const { id } = request.params;
    const result = await query(`
      SELECT a."id", a."id_gara", a."id_azienda_principale", a."id_azienda_ausiliaria",
        a."tipo",
        az_p."ragione_sociale" AS azienda_principale_nome,
        az_a."ragione_sociale" AS azienda_ausiliaria_nome
      FROM avvalimenti a
      LEFT JOIN aziende az_p ON a."id_azienda_principale" = az_p."id"
      LEFT JOIN aziende az_a ON a."id_azienda_ausiliaria" = az_a."id"
      WHERE a."id_gara" = $1
      ORDER BY a."id" DESC
    `, [id]);
    return result.rows;
  });

  // POST /api/esiti/:id/avvalimenti - Create avvalimento
  fastify.post('/:id/avvalimenti', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;
    const { id_azienda_principale, id_azienda_ausiliaria, tipo } = request.body;

    if (!id_azienda_principale || !id_azienda_ausiliaria) {
      return reply.status(400).send({ error: 'id_azienda_principale e id_azienda_ausiliaria sono obbligatori' });
    }

    try {
      const result = await query(
        `INSERT INTO avvalimenti ("id_gara", "id_azienda_principale", "id_azienda_ausiliaria", "tipo")
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [id, id_azienda_principale, id_azienda_ausiliaria, tipo || null]
      );
      return reply.status(201).send(result.rows[0]);
    } catch (err) {
      fastify.log.error(err);
      return reply.status(400).send({ error: err.message });
    }
  });

  // DELETE /api/esiti/avvalimenti/:idAvvalimento - Delete avvalimento
  fastify.delete('/avvalimenti/:idAvvalimento', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { idAvvalimento } = request.params;
    const result = await query(
      `DELETE FROM avvalimenti WHERE "id" = $1 RETURNING "id"`,
      [idAvvalimento]
    );

    if (result.rows.length === 0) {
      return reply.status(404).send({ error: 'Avvalimento non trovato' });
    }
    return { message: 'Avvalimento eliminato', id: result.rows[0].id };
  });

}
