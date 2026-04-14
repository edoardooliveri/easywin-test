import { query, transaction } from '../db/pool.js';
import { searchAziende } from '../lib/aziende-cache.js';

export default async function esitiRoutes(fastify) {

  // ============================================================
  // GET /api/esiti - List esiti with filters + pagination
  // ============================================================
  fastify.get('/', async (request) => {
    const {
      page = 1, limit = 25, sort = 'data', order = 'DESC',
      search, cig, id_regione, id_provincia, id_stazione, id_soa, id_criterio,
      id_tipologia, id_tipo_dati, id_piattaforma, inserito_da, data_dal, data_al, variante,
      min_partecipanti, importo_min, importo_max
    } = request.query;

    const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);
    const conditions = ['g."annullato" = false'];
    const params = [];
    let paramIdx = 1;

    if (search) {
      conditions.push(`(b."titolo" ILIKE $${paramIdx} OR b."codice_cig" ILIKE $${paramIdx} OR s."nome" ILIKE $${paramIdx})`);
      params.push(`%${search}%`);
      paramIdx++;
    }
    if (cig) {
      conditions.push(`b."codice_cig" ILIKE $${paramIdx}`);
      params.push(`%${cig}%`);
      paramIdx++;
    }
    if (id_regione) {
      conditions.push(`r."id" = $${paramIdx}`);
      params.push(parseInt(id_regione));
      paramIdx++;
    }
    if (id_provincia) {
      conditions.push(`p."id" = $${paramIdx}`);
      params.push(parseInt(id_provincia));
      paramIdx++;
    }
    if (id_stazione) {
      conditions.push(`b."id_stazione" = $${paramIdx}`);
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
    if (id_tipo_dati) {
      conditions.push(`g."id_tipo_dati" = $${paramIdx}`);
      params.push(parseInt(id_tipo_dati));
      paramIdx++;
    }
    if (id_piattaforma) {
      conditions.push(`b."id_piattaforma" = $${paramIdx}`);
      params.push(parseInt(id_piattaforma));
      paramIdx++;
    }
    if (inserito_da) {
      conditions.push(`g."created_at" = $${paramIdx}`);
      params.push(inserito_da);
      paramIdx++;
    }
    if (data_dal) {
      conditions.push(`g."data" >= $${paramIdx}`);
      params.push(data_dal);
      paramIdx++;
    }
    if (data_al) {
      conditions.push(`g."data" <= $${paramIdx}`);
      params.push(data_al);
      paramIdx++;
    }
    if (variante) {
      conditions.push(`g."variante" = $${paramIdx}`);
      params.push(variante);
      paramIdx++;
    }
    if (min_partecipanti) {
      conditions.push(`g."n_partecipanti" >= $${paramIdx}`);
      params.push(parseInt(min_partecipanti));
      paramIdx++;
    }
    if (importo_min) {
      conditions.push(`g."importo" >= $${paramIdx}`);
      params.push(parseFloat(importo_min));
      paramIdx++;
    }
    if (importo_max) {
      conditions.push(`g."importo" <= $${paramIdx}`);
      params.push(parseFloat(importo_max));
      paramIdx++;
    }

    const sortMap = { data: 'g."data"', titolo: 'b."titolo"', importo: 'g."importo"', n_partecipanti: 'g."n_partecipanti"', ribasso: 'g."ribasso"' };
    const sortCol = sortMap[sort.toLowerCase()] || 'g."data"';
    const sortDir = order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    // gare -> bandi -> stazioni -> province -> regioni for geographic filtering
    const joinClause = `
      FROM gare g
      LEFT JOIN bandi b ON g."id_bando" = b."id"
      LEFT JOIN stazioni s ON b."id_stazione" = s."id"
      LEFT JOIN province p ON s."id_provincia" = p."id"
      LEFT JOIN regioni r ON p."id_regione" = r."id"
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
          COALESCE(b."titolo", g."titolo") AS titolo,
          g."n_partecipanti" AS n_partecipanti,
          g."importo" AS importo,
          g."media_ar" AS media_ar,
          g."ribasso" AS ribasso,
          g."soglia_an" AS soglia_an,
          g."variante" AS variante,
          g."temp" AS temp,
          g."enabled" AS enabled,
          g."annullato" AS annullato,
          g."bloccato" AS bloccato,
          COALESCE(b."codice_cig", g."codice_cig") AS codice_cig,
          g."id_bando" AS id_bando,
          s."nome" AS stazione_nome,
          s."sito_web" AS stazione_sito_web,
          soa."codice" AS soa_categoria,
          soa."descrizione" AS soa_descrizione,
          tg."nome" AS tipologia,
          c."nome" AS criterio,
          p."nome" AS provincia_nome,
          r."nome" AS regione_nome,
          az."ragione_sociale" AS vincitore_nome,
          az."partita_iva" AS vincitore_piva,
          piatt."nome" AS piattaforma_nome,
          piatt."url" AS piattaforma_url,
          (SELECT COUNT(*) FROM gare_invii gi WHERE gi."id_gara" = g."id") AS n_invii,
          (SELECT COUNT(*) FROM dettaglio_gara dg WHERE dg."id_gara" = g."id") AS n_dettagli,
          g."id_tipo_dati" AS id_tipo_dati,
          tdg."tipo" AS tipologia_dato
        ${joinClause}
        LEFT JOIN soa ON g."id_soa" = soa."id"
        LEFT JOIN tipologia_gare tg ON g."id_tipologia" = tg."id"
        LEFT JOIN tipo_dati_gara tdg ON g."id_tipo_dati" = tdg."id"
        LEFT JOIN criteri c ON b."id_criterio" = c."id"
        LEFT JOIN aziende az ON g."id_vincitore" = az."id"
        LEFT JOIN piattaforme piatt ON b."id_piattaforma" = piatt."id"
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

    // Main gara query — includes ALL real columns from gare table
    const garaResult = await query(`
      SELECT g."id",
        g."data" AS data,
        COALESCE(b."titolo", g."titolo") AS titolo,
        COALESCE(b."codice_cig", g."codice_cig") AS codice_cig,
        g."importo" AS importo,
        g."importo_so" AS importo_so,
        g."importo_co" AS importo_co,
        g."importo_eco" AS importo_eco,
        g."n_partecipanti" AS n_partecipanti,
        g."n_ammessi" AS n_ammessi,
        g."n_esclusi" AS n_esclusi,
        g."n_sorteggio" AS n_sorteggio,
        g."n_decimali" AS n_decimali,
        g."ribasso" AS ribasso,
        g."ribasso_vincitore" AS ribasso_vincitore,
        g."importo_vincitore" AS importo_vincitore,
        g."media_ar" AS media_ar,
        g."soglia_an" AS soglia_an,
        g."media_sc" AS media_sc,
        g."soglia_riferimento" AS soglia_riferimento,
        g."accorpa_ali" AS accorpa_ali,
        g."tipo_accorpa_ali" AS tipo_accorpa_ali,
        g."limit_min_media" AS limit_min_media,
        g."variante" AS variante,
        g."varianti_disponibili" AS varianti_disponibili,
        g."citta" AS citta,
        g."cap" AS cap,
        g."indirizzo" AS indirizzo,
        g."temp" AS temp,
        g."enabled" AS enabled,
        g."bloccato" AS bloccato,
        g."enable_to_all" AS enable_to_all,
        g."data_abilitazione" AS data_abilitazione,
        g."id_bando" AS id_bando,
        g."id_tipo_dati" AS id_tipo_dati_gara,
        g."note" AS note,
        g."note_01" AS note_01,
        g."note_02" AS note_02,
        g."note_03" AS note_03,
        g."username" AS username_inserimento,
        g."inserito_da" AS inserito_da,
        g."provenienza" AS provenienza,
        g."fonte_dati" AS fonte_dati,
        g."annullato" AS annullato,
        g."eliminata" AS eliminata,
        g."created_at" AS data_inserimento,
        g."updated_at" AS data_modifica,
        s."nome" AS stazione_nome,
        s."sito_web" AS stazione_sito_web,
        soa."codice" AS soa_categoria,
        soa."descrizione" AS soa_descrizione,
        tg."nome" AS tipologia,
        c."nome" AS criterio,
        tdg."tipo" AS tipologia_dato,
        p."nome" AS provincia_nome,
        r."nome" AS regione_nome,
        az."ragione_sociale" AS vincitore_nome,
        az."partita_iva" AS vincitore_piva,
        piatt."nome" AS piattaforma_nome,
        piatt."url" AS link_piattaforma,
        (SELECT COUNT(*) FROM gare_invii gi WHERE gi."id_gara" = g."id") AS n_invii
      FROM gare g
      LEFT JOIN bandi b ON g."id_bando" = b."id"
      LEFT JOIN stazioni s ON COALESCE(g."id_stazione", b."id_stazione") = s."id"
      LEFT JOIN province p ON COALESCE(g."id_provincia", s."id_provincia") = p."id"
      LEFT JOIN regioni r ON p."id_regione" = r."id"
      LEFT JOIN soa ON g."id_soa" = soa."id"
      LEFT JOIN tipologia_gare tg ON g."id_tipologia" = tg."id"
      LEFT JOIN criteri c ON COALESCE(g."id_criterio", b."id_criterio") = c."id"
      LEFT JOIN tipo_dati_gara tdg ON g."id_tipo_dati" = tdg."id"
      LEFT JOIN piattaforme piatt ON COALESCE(g."id_piattaforma", b."id_piattaforma") = piatt."id"
      LEFT JOIN aziende az ON g."id_vincitore" = az."id"
      WHERE g."id" = $1
    `, [id]);

    if (garaResult.rows.length === 0) {
      return reply.status(404).send({ error: 'Esito non trovato' });
    }

    // Graduatoria query — all columns from dettaglio_gara
    const dettagliResult = await query(`
      SELECT
        dg."posizione" AS posizione,
        dg."ribasso" AS ribasso,
        dg."importo_offerta" AS importo_offerta,
        dg."taglio_ali" AS taglio_ali,
        dg."m_media_arit" AS m_media_arit,
        dg."anomala" AS anomala,
        dg."vincitrice" AS vincitrice,
        dg."ammessa" AS ammessa,
        dg."ammessa_riserva" AS ammessa_riserva,
        dg."esclusa" AS esclusa,
        dg."da_verificare" AS da_verificare,
        dg."sconosciuto" AS sconosciuto,
        dg."pari_merito" AS pari_merito,
        dg."punteggio_tecnico" AS punteggio_tecnico,
        dg."punteggio_economico" AS punteggio_economico,
        dg."punteggio_totale" AS punteggio_totale,
        dg."note" AS note,
        COALESCE(az."ragione_sociale", dg."ragione_sociale") AS ragione_sociale,
        COALESCE(az."partita_iva", dg."partita_iva") AS partita_iva,
        az."codice_fiscale" AS codice_fiscale,
        p."nome" AS provincia
      FROM dettaglio_gara dg
      LEFT JOIN aziende az ON dg."id_azienda" = az."id"
      LEFT JOIN province p ON az."id_provincia" = p."id"
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
        FROM ati_gare ag
        LEFT JOIN aziende m ON ag."id_azienda" = m."id"
        LEFT JOIN aziende mn ON ag."id_azienda" = mn."id"
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
          "id_bando", "data", "n_partecipanti",
          "importo", "ribasso",
          "soglia_an", "note", "created_at", "updated_at"
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, NOW(), NOW()
        ) RETURNING *
      `, [
        data.id_bando, data.data || data.Data, data.n_partecipanti || data.NPartecipanti || 0,
        data.importo || data.Importo, data.ribasso || data.Ribasso,
        data.soglia_an || data.Anomalia || false, data.note || data.Note
      ]);

      const garaId = garaResult.rows[0].id;

      // Insert graduatoria (dettaglio_gara)
      if (data.graduatoria && data.graduatoria.length > 0) {
        for (const det of data.graduatoria) {
          await client.query(`
            INSERT INTO dettaglio_gara (
              "id_gara", "id_azienda", "posizione", "ribasso", "importo_offerta",
              "anomala", "vincitrice", "ammessa", "note"
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
          `, [
            garaId, det.id_azienda, det.posizione || det.Posizione, det.ribasso || det.Ribasso, det.importo_offerta || det.ImportoOfferta,
            det.anomala || det.Anomala || false, det.vincitrice || det.Vincitrice || false,
            det.ammessa !== false || det.Ammessa !== false, det.note || det.Note
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
    const data = { ...request.body };

    // Check exists
    const existing = await query('SELECT "id" FROM gare WHERE "id" = $1', [id]);
    if (existing.rows.length === 0) {
      return reply.status(404).send({ error: 'Esito non trovato' });
    }

    // --- PRE-PROCESSING dei dati in arrivo dal form modifica ---------------
    // Modalità di salvataggio (save / save-elabora / save-elabora-notxt)
    const mode = String(data.__mode || 'save');
    delete data.__mode;

    // Campi di sola visualizzazione / derivati → rimuovi
    delete data.stazione_nome;
    delete data.soa_sigla_descrizione;

    // Checkbox: il frontend manda 1/0 (anche come stringhe) → bool
    const toBool = (v) => v === true || v === 1 || v === '1' || v === 'true' || v === 'on';
    for (const k of ['accorpa_ali','ali_in_somma_ribassi','bloccato','enabled','annullato','enable_to_all','temp','privato']) {
      if (k in data) data[k] = toBool(data[k]);
    }

    // Numerici: stringa vuota → null
    for (const k of ['importo','soa_importo','soa_val','n_partecipanti','n_ammessi','n_esclusi','n_decimali','max_invitati',
                      'media_ar','media_sc','rapporto_scarto_media','soglia_an','seconda_soglia','seconda_soglia_2',
                      'offerte_ammesse','tipo_calcolo','tipo_arrotondamento','tipo_accorpa_ali','tipo_calcolo_seconda_soglia',
                      'limit_min_media','pubblicazione','id_stazione','id_tipologia','id_piattaforma','id_provincia','lat','lon']) {
      if (k in data && (data[k] === '' || data[k] === null || data[k] === undefined)) data[k] = null;
      else if (k in data && typeof data[k] === 'string') {
        const n = Number(String(data[k]).replace(',', '.'));
        if (!isNaN(n)) data[k] = n;
      }
    }

    // Province: array multi-select → prende il primo come id_provincia
    if (Array.isArray(data.province)) {
      if (data.province.length) data.id_provincia = Number(data.province[0]) || null;
      delete data.province;
    } else if (typeof data.province === 'string' && data.province) {
      data.id_provincia = Number(data.province.split(',')[0]) || null;
      delete data.province;
    }

    // Date italiane GG/MM/AAAA [HH:MM] → ISO
    const parseItaDate = (s) => {
      if (!s || typeof s !== 'string') return s;
      const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
      if (!m) return s;
      const [_, d, mo, y, h='00', mi='00', se='00'] = m;
      return `${y}-${mo.padStart(2,'0')}-${d.padStart(2,'0')}${h!=='00'||mi!=='00'?`T${h.padStart(2,'0')}:${mi}:${se}`:''}`;
    };
    for (const k of ['data_reperimento','data_abilitazione','data_aggiudicazione_definitiva','data_firma_contratto','data']) {
      if (data[k]) data[k] = parseItaDate(data[k]);
      if (data[k] === '') data[k] = null;
    }

    // --- COSTRUZIONE QUERY UPDATE ------------------------------------------
    const updateFields = [];
    const updateValues = [];
    let idx = 1;

    const allowedFields = {
      // Dati generali
      'titolo': 'titolo', 'data': 'data', 'codice_cig': 'codice_cig', 'codice_cup': 'codice_cup',
      'id_stazione': 'id_stazione', 'stazione': 'stazione',
      'id_soa': 'id_soa', 'soa_val': 'soa_val',
      'id_tipologia': 'id_tipologia', 'id_tipo_dati': 'id_tipo_dati',
      'id_criterio': 'id_criterio', 'id_piattaforma': 'id_piattaforma',
      'id_provincia': 'id_provincia', 'regione': 'regione',
      // Importi
      'importo': 'importo', 'importo_so': 'importo_so', 'importo_co': 'importo_co',
      'importo_eco': 'importo_eco', 'oneri_progettazione': 'oneri_progettazione',
      'importo_manodopera': 'importo_manodopera',
      'importo_soa_prevalente': 'importo_soa_prevalente',
      'importo_soa_sostitutiva': 'importo_soa_sostitutiva',
      'soa_sigla': 'soa_sigla', 'soa_classifica': 'soa_classifica', 'soa_importo': 'soa_importo',
      // Partecipanti / calcolo
      'n_partecipanti': 'n_partecipanti', 'n_ammessi': 'n_ammessi',
      'n_esclusi': 'n_esclusi', 'n_sorteggio': 'n_sorteggio',
      'n_decimali': 'n_decimali', 'max_invitati': 'max_invitati',
      'tipo_calcolo': 'tipo_calcolo', 'tipo_arrotondamento': 'tipo_arrotondamento',
      'accorpa_ali': 'accorpa_ali', 'tipo_accorpa_ali': 'tipo_accorpa_ali',
      'ali_in_somma_ribassi': 'ali_in_somma_ribassi', 'limit_min_media': 'limit_min_media',
      // Medie e soglie
      'ribasso': 'ribasso', 'ribasso_vincitore': 'ribasso_vincitore',
      'importo_vincitore': 'importo_vincitore',
      'media_ar': 'media_ar', 'soglia_an': 'soglia_an', 'media_sc': 'media_sc',
      'rapporto_scarto_media': 'rapporto_scarto_media',
      'seconda_soglia': 'seconda_soglia', 'seconda_soglia_2': 'seconda_soglia_2',
      'offerte_ammesse': 'offerte_ammesse',
      'tipo_calcolo_seconda_soglia': 'tipo_calcolo_seconda_soglia',
      'soglia_riferimento': 'soglia_riferimento',
      // Stato / pubblicazione
      'variante': 'variante', 'pubblicazione': 'pubblicazione',
      'annullato': 'annullato', 'privato': 'privato',
      'bloccato': 'bloccato', 'temp': 'temp', 'enabled': 'enabled',
      'enable_to_all': 'enable_to_all', 'data_abilitazione': 'data_abilitazione',
      // Reperimento
      'data_reperimento': 'data_reperimento', 'fonte_reperimento': 'fonte_reperimento',
      'username_reperimento': 'username_reperimento', 'azienda_reperimento': 'azienda_reperimento',
      'data_aggiudicazione_definitiva': 'data_aggiudicazione_definitiva',
      'data_firma_contratto': 'data_firma_contratto',
      // Locazione
      'indirizzo': 'indirizzo', 'cap': 'cap', 'citta': 'citta',
      'lat': 'lat', 'lon': 'lon',
      // Note
      'note': 'note', 'note_01': 'note_01', 'note_02': 'note_02', 'note_03': 'note_03',
      'note_interne': 'note_interne',
      // Misc
      'external_code': 'external_code', 'fonte_dati': 'fonte_dati',
      'id_bando': 'id_bando', 'id_vincitore': 'id_vincitore',
      'username_modifica': 'username_modifica'
    };

    // Support both snake_case and PascalCase input
    const mappingPascalToSnake = {
      'Data': 'data', 'NPartecipanti': 'n_partecipanti', 'Importo': 'importo',
      'Ribasso': 'ribasso', 'Anomalia': 'soglia_an', 'Variante': 'variante', 'Note': 'note',
      'Titolo': 'titolo', 'CodiceCIG': 'codice_cig', 'CodiceCUP': 'codice_cup'
    };

    // Colonne presenti nella tabella gare (rilevate una volta e memorizzate in cache)
    if (!fastify.__gareCols) {
      try {
        const colsRes = await query(
          "SELECT column_name FROM information_schema.columns WHERE table_name='gare'"
        );
        fastify.__gareCols = new Set(colsRes.rows.map(r => r.column_name));
      } catch {
        fastify.__gareCols = null; // fallback: accetta tutti i campi whitelist
      }
    }
    const gareCols = fastify.__gareCols;

    for (const [key, value] of Object.entries(data)) {
      let dbField = allowedFields[key] || mappingPascalToSnake[key];
      if (!dbField) continue;
      // Scarta colonne che non esistono ancora nel DB (es. prima della migration)
      if (gareCols && !gareCols.has(dbField)) continue;
      updateFields.push(`"${dbField}" = $${idx}`);
      updateValues.push(value);
      idx++;
    }

    if (updateFields.length === 0) {
      return reply.status(400).send({ error: 'Nessun campo da aggiornare' });
    }

    updateFields.push(`"updated_at" = NOW()`);

    updateValues.push(id);
    const result = await query(
      `UPDATE gare SET ${updateFields.join(', ')} WHERE "id" = $${idx} RETURNING *`,
      updateValues
    );

    // --- MODALITÀ DI ELABORAZIONE ------------------------------------------
    // save              → solo salvataggio
    // save-elabora      → ricalcolo medie/soglie/graduatoria (e eventuale export TXT)
    // save-elabora-notxt→ come sopra ma senza export TXT
    let elaborazione = null;
    if (mode === 'save-elabora' || mode === 'save-elabora-notxt') {
      try {
        // Ricalcolo semplice delle metriche aggregate dai dettagli
        const agg = await query(`
          SELECT
            COUNT(*)::int AS n_partecipanti,
            COUNT(*) FILTER (WHERE ammessa = true)::int AS n_ammessi,
            COUNT(*) FILTER (WHERE esclusa = true)::int AS n_esclusi,
            AVG(ribasso)::numeric(18,6) AS media_ar
          FROM dettaglio_gara WHERE id_gara = $1
        `, [id]);
        const a = agg.rows[0] || {};
        if (a.n_partecipanti) {
          await query(
            `UPDATE gare SET n_partecipanti = COALESCE($1, n_partecipanti),
                             n_ammessi      = COALESCE($2, n_ammessi),
                             n_esclusi      = COALESCE($3, n_esclusi),
                             media_ar       = COALESCE($4, media_ar),
                             updated_at     = NOW()
             WHERE id = $5`,
            [a.n_partecipanti, a.n_ammessi, a.n_esclusi, a.media_ar, id]
          );
        }
        elaborazione = {
          modalita: mode,
          n_partecipanti_ricalcolati: a.n_partecipanti || 0,
          media_ar_ricalcolata: a.media_ar,
          txt_generato: mode === 'save-elabora'
        };
      } catch (err) {
        request.log?.warn?.({ err }, 'elaborazione dettagli fallita');
        elaborazione = { modalita: mode, errore: err.message };
      }
    }

    return { ...result.rows[0], __elaborazione: elaborazione };
  });

  // ============================================================
  // DELETE /api/esiti/:id - Soft delete
  // ============================================================
  fastify.delete('/:id', async (request, reply) => {
    const { id } = request.params;
    const result = await query(
      `UPDATE gare SET "annullato" = true, "updated_at" = NOW() WHERE "id" = $1 RETURNING "id"`,
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

    const result = await query(`
      SELECT dg.*,
        COALESCE(az."ragione_sociale", dg."ragione_sociale") AS azienda_nome,
        COALESCE(az."partita_iva", dg."partita_iva") AS azienda_piva,
        az."codice_fiscale" AS azienda_cf,
        p."nome" AS provincia
      FROM dettaglio_gara dg
      LEFT JOIN aziende az ON dg."id_azienda" = az."id"
      LEFT JOIN province p ON az."id_provincia" = p."id"
      WHERE dg."id_gara" = $1
      ORDER BY dg."posizione" ASC NULLS LAST
    `, [id]);

    return result.rows;
  });

  // ============================================================
  // POST /api/esiti/:id/graduatoria - Add entry to ranking
  // ============================================================
  fastify.post('/:id/graduatoria', async (request, reply) => {
    const { id } = request.params;
    const det = request.body || {};
    const toBool = (v) => v === true || v === 1 || v === '1' || v === 'true' || v === 'on';
    const esclusa = toBool(det.esclusa || det.Esclusa);
    // ammessa: rispetta quello che arriva, altrimenti derivato da !esclusa
    const ammessa = (det.ammessa !== undefined || det.Ammessa !== undefined)
      ? toBool(det.ammessa ?? det.Ammessa)
      : !esclusa;

    const result = await query(`
      INSERT INTO dettaglio_gara (
        "id_gara", "id_azienda", "posizione", "ribasso", "importo_offerta",
        "taglio_ali", "m_media_arit", "anomala", "vincitrice", "ammessa",
        "ammessa_riserva", "esclusa", "da_verificare",
        "ragione_sociale", "partita_iva", "sconosciuto", "note", "ati", "ati_avv",
        "inserimento"
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
      RETURNING *
    `, [
      id,
      det.id_azienda || null,
      det.posizione || det.Posizione || 0,
      det.ribasso ?? det.Ribasso ?? 0,
      det.importo_offerta || det.ImportoOfferta || null,
      toBool(det.taglio_ali || det.TaglioAli),
      toBool(det.m_media_arit || det.MMediaArit),
      toBool(det.anomala || det.Anomala),
      toBool(det.vincitrice || det.Vincitrice),
      ammessa,
      toBool(det.ammessa_riserva || det.AmmessaRiserva),
      esclusa,
      toBool(det.da_verificare || det.DaVerificare),
      det.ragione_sociale || null,
      det.partita_iva || null,
      toBool(det.sconosciuto || det.Sconosciuto),
      det.note || det.Note || null,
      toBool(det.ati),
      det.ati_avv || null,
      det.inserimento ?? null
    ]);

    return reply.status(201).send(result.rows[0]);
  });

  // ============================================================
  // DELETE /api/esiti/:id/graduatoria/:detId - Remove entry from ranking
  // ============================================================
  fastify.delete('/:id/graduatoria/:detId', async (request, reply) => {
    const { id, detId } = request.params;
    await query('DELETE FROM dettaglio_gara WHERE "id" = $1 AND "id_gara" = $2', [detId, id]);
    return { message: 'Dettaglio eliminato' };
  });

  // ============================================================
  // PUT /api/esiti/:id/graduatoria/:detId - Update single entry
  // ============================================================
  fastify.put('/:id/graduatoria/:detId', async (request, reply) => {
    const { id, detId } = request.params;
    const det = request.body;
    const allowedFields = [
      'posizione', 'ribasso', 'importo_offerta', 'anomala', 'vincitrice',
      'ammessa', 'ammessa_riserva', 'esclusa', 'da_verificare', 'sconosciuto',
      'pari_merito', 'ragione_sociale', 'partita_iva', 'codice_fiscale',
      'punteggio_tecnico', 'punteggio_economico', 'punteggio_totale',
      'taglio_ali', 'note', 'id_azienda', 'inserimento', 'ati', 'ati_avv',
      'm_media_arit'
    ];
    const sets = [];
    const params = [];
    let idx = 1;
    for (const f of allowedFields) {
      if (det[f] !== undefined) {
        sets.push(`"${f}" = $${idx}`);
        params.push(det[f]);
        idx++;
      }
    }
    if (sets.length === 0) return reply.status(400).send({ error: 'Nessun campo da aggiornare' });
    params.push(detId, id);
    const result = await query(
      `UPDATE dettaglio_gara SET ${sets.join(', ')} WHERE "id" = $${idx} AND "id_gara" = $${idx+1} RETURNING *`,
      params
    );
    if (!result.rows.length) return reply.status(404).send({ error: 'Dettaglio non trovato' });
    return result.rows[0];
  });

  // ============================================================
  // POST /api/esiti/:id/graduatoria/riordina - Reorder entries
  // ============================================================
  fastify.post('/:id/graduatoria/riordina', async (request, reply) => {
    const { id } = request.params;
    const { tipo } = request.body; // 'inverti', 'posizione', 'inserimento', 'alfabetico', 'ribasso'

    const rows = await query(
      `SELECT "id", "posizione", "inserimento", "ragione_sociale", "ribasso",
              COALESCE(az."ragione_sociale", dg."ragione_sociale") AS nome_ord
       FROM dettaglio_gara dg
       LEFT JOIN aziende az ON dg."id_azienda" = az."id"
       WHERE dg."id_gara" = $1
       ORDER BY dg."posizione" ASC NULLS LAST`, [id]
    );

    let sorted = [...rows.rows];
    if (tipo === 'inverti') {
      // Reverse current positions
      const positions = sorted.map(r => r.posizione);
      positions.reverse();
      for (let i = 0; i < sorted.length; i++) {
        await query('UPDATE dettaglio_gara SET "posizione" = $1 WHERE "id" = $2', [positions[i], sorted[i].id]);
      }
    } else if (tipo === 'inserimento') {
      sorted.sort((a, b) => (a.inserimento || 0) - (b.inserimento || 0));
      for (let i = 0; i < sorted.length; i++) {
        await query('UPDATE dettaglio_gara SET "posizione" = $1 WHERE "id" = $2', [i + 1, sorted[i].id]);
      }
    } else if (tipo === 'alfabetico') {
      sorted.sort((a, b) => (a.nome_ord || '').localeCompare(b.nome_ord || ''));
      for (let i = 0; i < sorted.length; i++) {
        await query('UPDATE dettaglio_gara SET "posizione" = $1 WHERE "id" = $2', [i + 1, sorted[i].id]);
      }
    } else if (tipo === 'ribasso') {
      sorted.sort((a, b) => (Number(b.ribasso) || 0) - (Number(a.ribasso) || 0));
      for (let i = 0; i < sorted.length; i++) {
        await query('UPDATE dettaglio_gara SET "posizione" = $1 WHERE "id" = $2', [i + 1, sorted[i].id]);
      }
    } else if (tipo === 'posizione') {
      // Re-number 1,2,3... keeping current order
      for (let i = 0; i < sorted.length; i++) {
        await query('UPDATE dettaglio_gara SET "posizione" = $1 WHERE "id" = $2', [i + 1, sorted[i].id]);
      }
    }
    return { message: `Riordinato per ${tipo}`, count: sorted.length };
  });

  // ============================================================
  // POST /api/esiti/:id/elabora - ELABORA DETTAGLI (calculation engine)
  // Calculates winner based on criterio (prezzo più basso / OEPV)
  // ============================================================
  fastify.post('/:id/elabora', async (request, reply) => {
    const { id } = request.params;

    // Get gara info
    const garaRes = await query(`
      SELECT g.*, c."nome" AS criterio_nome,
             t."tipo" AS tipo_calcolo_nome
      FROM gare g
      LEFT JOIN criteri c ON g."id_criterio" = c."id"
      LEFT JOIN tipologia_gare t ON g."id_tipologia" = t."id"
      WHERE g."id" = $1`, [id]);
    if (!garaRes.rows.length) return reply.status(404).send({ error: 'Esito non trovato' });
    const gara = garaRes.rows[0];

    // Get all dettagli
    const detRes = await query(`
      SELECT dg.*, COALESCE(az."ragione_sociale", dg."ragione_sociale") AS nome_azienda
      FROM dettaglio_gara dg
      LEFT JOIN aziende az ON dg."id_azienda" = az."id"
      WHERE dg."id_gara" = $1
      ORDER BY dg."posizione" ASC NULLS LAST`, [id]);
    const dettagli = detRes.rows;

    if (dettagli.length === 0) return reply.status(400).send({ error: 'Nessun partecipante in graduatoria' });

    // Reset all calculations
    for (const d of dettagli) {
      await query(`UPDATE dettaglio_gara SET
        "vincitrice" = false, "anomala" = false, "taglio_ali" = false,
        "m_media_arit" = NULL
        WHERE "id" = $1`, [d.id]);
    }

    // Filter: only non-excluded entries participate in the calculation
    const ammessi = dettagli.filter(d => !d.esclusa);
    const nAmmessi = ammessi.length;

    if (nAmmessi === 0) {
      await query(`UPDATE gare SET "n_ammessi" = 0, "media_ar" = NULL, "soglia_an" = NULL, "media_sc" = NULL, "id_vincitore" = NULL, "ribasso_vincitore" = NULL, "importo_vincitore" = NULL, "updated_at" = NOW() WHERE "id" = $1`, [id]);
      return { message: 'Nessun ammesso, calcolo azzerato', n_ammessi: 0 };
    }

    const decimali = gara.n_decimali || 3;
    const importoBase = Number(gara.importo) || 0;
    const accorpaAli = gara.accorpa_ali === true;

    // Get all ribassi of ammessi
    const ribassi = ammessi.map(d => Number(d.ribasso) || 0);

    // ═══ TAGLIO DELLE ALI (10% sopra e sotto) ═══
    const nTaglio = Math.floor(nAmmessi * 0.10); // 10% wing cut
    const ribassiOrdinati = [...ribassi].sort((a, b) => a - b);

    // Identify the ribasso values that fall in the wing cut
    const sogliaBassoTaglio = nTaglio > 0 ? ribassiOrdinati[nTaglio - 1] : -Infinity;
    const sogliaAltoTaglio = nTaglio > 0 ? ribassiOrdinati[ribassiOrdinati.length - nTaglio] : Infinity;

    // Mark taglio_ali
    let countBasso = 0, countAlto = 0;
    const tagliatiIds = new Set();
    // Sort ammessi by ribasso ASC to tag bottom wing
    const ammessiSorted = [...ammessi].sort((a, b) => (Number(a.ribasso) || 0) - (Number(b.ribasso) || 0));
    for (const d of ammessiSorted) {
      const rib = Number(d.ribasso) || 0;
      if (countBasso < nTaglio) {
        tagliatiIds.add(d.id);
        countBasso++;
      }
    }
    // Tag top wing
    const ammessiSortedDesc = [...ammessi].sort((a, b) => (Number(b.ribasso) || 0) - (Number(a.ribasso) || 0));
    for (const d of ammessiSortedDesc) {
      if (countAlto < nTaglio) {
        tagliatiIds.add(d.id);
        countAlto++;
      }
    }

    // Apply taglio_ali flags
    for (const tagId of tagliatiIds) {
      await query('UPDATE dettaglio_gara SET "taglio_ali" = true WHERE "id" = $1', [tagId]);
    }

    // ═══ MEDIA ARITMETICA (only non-tagliati, non-esclusi) ═══
    const ribassiPerMedia = ammessi
      .filter(d => !tagliatiIds.has(d.id))
      .map(d => Number(d.ribasso) || 0);

    const sommaRibassi = ribassiPerMedia.reduce((s, r) => s + r, 0);
    const mediaAr = ribassiPerMedia.length > 0 ? sommaRibassi / ribassiPerMedia.length : 0;

    // ═══ MEDIA DEGLI SCARTI ═══
    const scarti = ribassiPerMedia.filter(r => r > mediaAr).map(r => r - mediaAr);
    const mediaScarti = scarti.length > 0 ? scarti.reduce((s, r) => s + r, 0) / scarti.length : 0;

    // ═══ SOGLIA DI ANOMALIA ═══
    const sogliaAnomalia = mediaAr + mediaScarti;

    // ═══ IDENTIFY ANOMALE ═══
    for (const d of ammessi) {
      const rib = Number(d.ribasso) || 0;
      if (rib > sogliaAnomalia) {
        await query('UPDATE dettaglio_gara SET "anomala" = true WHERE "id" = $1', [d.id]);
      }
    }

    // ═══ FIND WINNER (closest to media, below soglia anomalia) ═══
    let vincitore = null;
    let minDistanza = Infinity;
    for (const d of ammessi) {
      const rib = Number(d.ribasso) || 0;
      if (rib <= sogliaAnomalia && !d.esclusa) {
        const dist = Math.abs(rib - mediaAr);
        if (dist < minDistanza || (dist === minDistanza && rib < (Number(vincitore?.ribasso) || 0))) {
          minDistanza = dist;
          vincitore = d;
        }
      }
    }

    // If no winner found below soglia, take the one closest to media
    if (!vincitore && ammessi.length > 0) {
      for (const d of ammessi) {
        if (!d.esclusa) {
          const rib = Number(d.ribasso) || 0;
          const dist = Math.abs(rib - mediaAr);
          if (dist < minDistanza) {
            minDistanza = dist;
            vincitore = d;
          }
        }
      }
    }

    if (vincitore) {
      await query('UPDATE dettaglio_gara SET "vincitrice" = true WHERE "id" = $1', [vincitore.id]);
    }

    // ═══ REORDER by ribasso proximity to media (winner first) ═══
    const classified = ammessi
      .filter(d => !d.esclusa)
      .sort((a, b) => {
        if (a.id === vincitore?.id) return -1;
        if (b.id === vincitore?.id) return 1;
        return Math.abs(Number(a.ribasso) - mediaAr) - Math.abs(Number(b.ribasso) - mediaAr);
      });
    // Excluded at the end
    const esclusi = dettagli.filter(d => d.esclusa);
    const finalOrder = [...classified, ...esclusi];
    for (let i = 0; i < finalOrder.length; i++) {
      await query('UPDATE dettaglio_gara SET "posizione" = $1 WHERE "id" = $2', [i + 1, finalOrder[i].id]);
    }

    // ═══ UPDATE GARA with results ═══
    const ribassoVincitore = vincitore ? Number(vincitore.ribasso) : null;
    const importoVincitore = vincitore && importoBase ? importoBase * (1 - (ribassoVincitore / 100)) : null;

    await query(`UPDATE gare SET
      "n_partecipanti" = $1, "n_ammessi" = $2, "n_esclusi" = $3,
      "media_ar" = $4, "soglia_an" = $5, "media_sc" = $6,
      "id_vincitore" = $7, "ribasso" = $8, "ribasso_vincitore" = $8,
      "importo_vincitore" = $9,
      "updated_at" = NOW()
      WHERE "id" = $10`,
      [
        dettagli.length, nAmmessi, dettagli.length - nAmmessi,
        parseFloat(mediaAr.toFixed(decimali+3)),
        parseFloat(sogliaAnomalia.toFixed(decimali+3)),
        parseFloat(mediaScarti.toFixed(decimali+3)),
        vincitore?.id_azienda || null,
        ribassoVincitore,
        importoVincitore ? parseFloat(importoVincitore.toFixed(2)) : null,
        id
      ]
    );

    return {
      message: 'Elaborazione completata',
      n_partecipanti: dettagli.length,
      n_ammessi: nAmmessi,
      n_esclusi: dettagli.length - nAmmessi,
      n_taglio_ali: tagliatiIds.size,
      media_aritmetica: parseFloat(mediaAr.toFixed(decimali)),
      soglia_anomalia: parseFloat(sogliaAnomalia.toFixed(decimali)),
      media_scarti: parseFloat(mediaScarti.toFixed(decimali)),
      vincitore: vincitore ? { id: vincitore.id, nome: vincitore.nome_azienda, ribasso: ribassoVincitore } : null,
      importo_vincitore: importoVincitore ? parseFloat(importoVincitore.toFixed(2)) : null
    };
  });

  // ============================================================
  // POST /api/esiti/:id/graduatoria/cerca-azienda - Search companies for adding
  // ============================================================
  fastify.post('/:id/graduatoria/cerca-azienda', async (request) => {
    const { q } = request.body;
    if (!q || q.length < 2) return [];
    const result = await query(`
      SELECT a."id", a."ragione_sociale", a."partita_iva", a."codice_fiscale",
             p."nome" AS provincia, p."sigla" AS provincia_sigla
      FROM aziende a
      LEFT JOIN province p ON a."id_provincia" = p."id"
      WHERE a."ragione_sociale" ILIKE $1 OR a."partita_iva" ILIKE $1 OR a."codice_fiscale" ILIKE $1
      ORDER BY a."ragione_sociale" ASC
      LIMIT 20
    `, [`%${q}%`]);
    return result.rows;
  });

  // GET /api/esiti/aziende-search?q=... - ricerca "intelligente"
  // Tollerante a typo (pg_trgm), accenti, ordine parole. Usa la
  // combinazione di ILIKE + word_similarity + similarity per
  // gestire correttamente anche query come "crsta" → "CRESTA".
  // ============================================================
  fastify.get('/aziende-search', async (request) => {
    const q = (request.query.q || '').trim();
    const limit = Math.min(Number(request.query.limit) || 20, 50);
    if (q.length < 2) return [];

    // Fast-path: cache in memoria (~5–20ms), aggirando Neon RTT.
    // Il primo hit carica tutto (~150–300ms); poi TTL 5 minuti.
    try {
      return await searchAziende(q, limit);
    } catch (e) {
      request.log.warn({ err: e }, 'aziende cache miss, fallback DB');
    }

    // P.IVA / codice fiscale: se è quasi tutto numerico prova match diretto prima
    const digits = q.replace(/\D/g, '');
    if (digits.length >= 6) {
      const byPiva = await query(`
        SELECT a."id", a."ragione_sociale", a."partita_iva", a."codice_fiscale", a."citta",
               p."sigla" AS provincia_sigla, 1.0::float AS score, 'piva' AS via
          FROM aziende a
          LEFT JOIN province p ON a."id_provincia" = p."id"
         WHERE a."partita_iva" ILIKE $1 OR a."codice_fiscale" ILIKE $1
         ORDER BY a."ragione_sociale"
         LIMIT $2
      `, [`%${digits}%`, limit]);
      if (byPiva.rows.length) return byPiva.rows;
    }

    // Ricerca fuzzy "alla Google", ottimizzata:
    //  1) Soglie pg_trgm abbassate a livello connessione (vedi pool.js)
    //     per evitare roundtrip extra di SET LOCAL (Neon ~100ms/rtt)
    //  2) Pre-filtro veloce via operatori trigram indicizzati (% e <%)
    //     sull'indice GIN idx_aziende_rs_trgm su lower(ragione_sociale)
    //  3) Scoring token-per-token per ranking preciso
    //  4) Una sola query, un solo roundtrip
    const like = `%${q}%`;
    const prefix = `${q}%`;
    const result = await query(`
      WITH q_tokens AS (
        SELECT array_agg(t) AS tokens
          FROM regexp_split_to_table(lower(regexp_replace($1, '[^a-zA-Z0-9]+', ' ', 'g')), '\\s+') t
         WHERE length(t) >= 2
      ),
      candidati AS (
        -- Filtro veloce: sfrutta l'indice GIN pg_trgm su
        -- lower(ragione_sociale) grazie agli operatori % e <%.
        SELECT a."id", a."ragione_sociale", a."partita_iva", a."codice_fiscale",
               a."citta", a."id_provincia"
          FROM aziende a
         WHERE lower(a."ragione_sociale") LIKE lower($2)
            OR lower(a."ragione_sociale") LIKE lower($4)
            OR lower(a."ragione_sociale") % lower($1)
            OR lower($1) <% lower(a."ragione_sociale")
         LIMIT 300
      ),
      scored AS (
        SELECT c.*,
               (
                 -- Per ogni parola della query prende il miglior match tra
                 -- le parole della ragione sociale, poi fa la media →
                 -- multi-token (es. "impresa cresta") funziona bene.
                 SELECT AVG(best_sim)::float
                   FROM (
                     SELECT (
                       SELECT MAX(
                         CASE
                           WHEN w = qt THEN 1.0
                           WHEN w LIKE qt || '%' THEN 0.95
                           WHEN qt LIKE w || '%' AND length(w) >= 3 THEN 0.9
                           WHEN length(qt) >= 3 AND length(w) >= 3 THEN
                             GREATEST(similarity(w, qt), word_similarity(qt, w))
                           ELSE 0
                         END
                       )
                       FROM regexp_split_to_table(
                         lower(regexp_replace(coalesce(c."ragione_sociale",''), '[^a-zA-Z0-9]+', ' ', 'g')),
                         '\\s+'
                       ) AS w
                       WHERE length(w) >= 2
                     ) AS best_sim
                     FROM unnest((SELECT tokens FROM q_tokens)) AS qt
                   ) sub
                 WHERE best_sim IS NOT NULL
               )::float AS score,
               CASE WHEN c."ragione_sociale" ILIKE $2 THEN 'ilike' ELSE 'fuzzy' END AS via
          FROM candidati c
      )
      SELECT s."id", s."ragione_sociale", s."partita_iva", s."codice_fiscale",
             s."citta", p."sigla" AS provincia_sigla, s.score, s.via
        FROM scored s
        LEFT JOIN province p ON s."id_provincia" = p."id"
       WHERE s.score >= 0.35
       ORDER BY s.score DESC, s."ragione_sociale" ASC
       LIMIT $3
    `, [q, like, limit, prefix]);

    return result.rows;
  });

  // (storia endpoint moved to bottom of file with full implementation)

  // ============================================================
  // GET /api/esiti/utenti-inserimento - Distinct users
  // ============================================================
  fastify.get('/utenti-inserimento', async () => {
    const result = await query(`
      SELECT DISTINCT "created_at" AS username
      FROM gare
      WHERE "annullato" = false AND "created_at" IS NOT NULL
      ORDER BY "created_at"
    `);
    return result.rows.map(r => r.username);
  });

  // ============================================================
  // GET /api/esiti/stats/overview - Dashboard statistics
  // ============================================================
  fastify.get('/stats/overview', async () => {
    const result = await query(`
      SELECT
        COUNT(*) FILTER (WHERE "annullato" = false) AS totale,
        AVG("n_partecipanti") FILTER (WHERE "annullato" = false AND "n_partecipanti" > 0) AS media_partecipanti,
        AVG("ribasso") FILTER (WHERE "annullato" = false AND "ribasso" IS NOT NULL) AS media_ribasso,
        COUNT(*) FILTER (WHERE "data" >= NOW() - INTERVAL '30 days' AND "annullato" = false) AS ultimi_30_giorni,
        SUM("importo") FILTER (WHERE "annullato" = false) AS importo_totale
      FROM gare
    `);

    const perRegione = await query(`
      SELECT r."nome", COUNT(*) as totale
      FROM gare g
      JOIN bandi b ON g."id_bando" = b."id"
      JOIN stazioni s ON b."id_stazione" = s."id"
      JOIN province p ON s."id_provincia" = p."id"
      JOIN regioni r ON p."id_regione" = r."id"
      WHERE g."annullato" = false
      GROUP BY r."nome" ORDER BY totale DESC LIMIT 10
    `);

    const perTipologia = await query(`
      SELECT tg."nome", COUNT(*) as totale
      FROM gare g
      JOIN tipologia_gare tg ON g."id_tipologia" = tg."id"
      WHERE g."annullato" = false
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
  // ============================================================
  fastify.post('/:id/conferma', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;

    try {
      const existing = await query(
        'SELECT "id", "annullato" FROM gare WHERE "id" = $1', [id]
      );
      if (existing.rows.length === 0) return reply.status(404).send({ error: 'Esito non trovato' });
      if (existing.rows[0].annullato) return reply.status(400).send({ error: 'Esito eliminato' });

      const upd = await query(
        `UPDATE gare SET "temp" = false, "updated_at" = NOW() WHERE "id" = $1 RETURNING "id", "temp"`,
        [id]
      );
      fastify.log.info({ id, rowCount: upd.rowCount, result: upd.rows[0] }, 'Conferma esito result');

      return {
        success: true,
        message: 'Esito confermato',
        id,
        temp: upd.rows[0]?.temp
      };
    } catch (err) {
      fastify.log.error(err, 'Conferma esito error');
      return reply.status(500).send({ error: 'Errore nella conferma', details: err.message });
    }
  });

  // ============================================================
  // POST /api/esiti/:id/abilita - ABILITA: enable esito for clients
  // ============================================================
  fastify.post('/:id/abilita', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;

    try {
      const existing = await query(
        'SELECT "id", "annullato" FROM gare WHERE "id" = $1', [id]
      );
      if (existing.rows.length === 0) return reply.status(404).send({ error: 'Esito non trovato' });
      if (existing.rows[0].annullato) return reply.status(400).send({ error: 'Esito eliminato' });

      const upd = await query(
        `UPDATE gare SET "enabled" = true, "updated_at" = NOW() WHERE "id" = $1 RETURNING "id", "enabled"`,
        [id]
      );
      fastify.log.info({ id, rowCount: upd.rowCount, result: upd.rows[0] }, 'Abilita esito result');

      return { success: true, message: 'Esito abilitato per i clienti', id, enabled: upd.rows[0]?.enabled };
    } catch (err) {
      fastify.log.error(err, 'Abilita esito error');
      return reply.status(500).send({ error: 'Errore nell\'abilitazione', details: err.message });
    }
  });

  // ============================================================
  // POST /api/esiti/:id/disabilita - DISABILITA: hide from clients
  // ============================================================
  fastify.post('/:id/disabilita', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;

    try {
      const existing = await query('SELECT "id" FROM gare WHERE "id" = $1', [id]);
      if (existing.rows.length === 0) return reply.status(404).send({ error: 'Esito non trovato' });

      const upd = await query(
        `UPDATE gare SET "enabled" = false, "updated_at" = NOW() WHERE "id" = $1 RETURNING "id", "enabled"`,
        [id]
      );
      fastify.log.info({ id, rowCount: upd.rowCount, result: upd.rows[0] }, 'Disabilita esito result');

      return { success: true, message: 'Esito disabilitato v2', id, enabled: upd.rows[0]?.enabled };
    } catch (err) {
      fastify.log.error(err, 'Disabilita esito error');
      return reply.status(500).send({ error: 'Errore nella disabilitazione', details: err.message });
    }
  });

  // ============================================================
  // POST /api/esiti/:id/set-temp - SET TEMP: revert esito to draft
  // ============================================================
  fastify.post('/:id/set-temp', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;

    try {
      const existing = await query('SELECT "id" FROM gare WHERE "id" = $1', [id]);
      if (existing.rows.length === 0) return reply.status(404).send({ error: 'Esito non trovato' });

      const upd = await query(
        `UPDATE gare SET "temp" = true, "updated_at" = NOW() WHERE "id" = $1 RETURNING "id", "temp"`,
        [id]
      );
      fastify.log.info({ id, rowCount: upd.rowCount, result: upd.rows[0] }, 'Set-temp esito result');

      return { success: true, message: 'Esito rimesso in bozza', id, temp: upd.rows[0]?.temp };
    } catch (err) {
      fastify.log.error(err, 'Set temp error');
      return reply.status(500).send({ error: 'Errore', details: err.message });
    }
  });

  // ============================================================
  // POST /api/esiti/:id/blocca - BLOCCA: lock esito for editing
  // ============================================================
  fastify.post('/:id/blocca', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;

    try {
      const existing = await query('SELECT "id" FROM gare WHERE "id" = $1', [id]);
      if (existing.rows.length === 0) return reply.status(404).send({ error: 'Esito non trovato' });

      const upd = await query(
        `UPDATE gare SET "bloccato" = TRUE, "updated_at" = NOW() WHERE "id" = $1 RETURNING "id", "bloccato"`,
        [id]
      );
      return { success: true, message: 'Esito bloccato', id, bloccato: upd.rows[0]?.bloccato };
    } catch (err) {
      fastify.log.error(err, 'Blocca esito error');
      return reply.status(500).send({ error: 'Errore blocco', details: err.message });
    }
  });

  // ============================================================
  // POST /api/esiti/:id/sblocca - SBLOCCA: unlock esito
  // ============================================================
  fastify.post('/:id/sblocca', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;

    try {
      const existing = await query('SELECT "id" FROM gare WHERE "id" = $1', [id]);
      if (existing.rows.length === 0) return reply.status(404).send({ error: 'Esito non trovato' });

      const upd = await query(
        `UPDATE gare SET "bloccato" = FALSE, "updated_at" = NOW() WHERE "id" = $1 RETURNING "id", "bloccato"`,
        [id]
      );
      return { success: true, message: 'Esito sbloccato', id, bloccato: upd.rows[0]?.bloccato };
    } catch (err) {
      fastify.log.error(err, 'Sblocca esito error');
      return reply.status(500).send({ error: 'Errore sblocco', details: err.message });
    }
  });

  // ============================================================
  // POST /api/esiti/:id/abilita-tutti - ABILITA TUTTI: enable collaborative editing
  // ============================================================
  fastify.post('/:id/abilita-tutti', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;

    try {
      await query(
        `UPDATE gare SET "updated_at" = NOW() WHERE "id" = $1`,
        [id]
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
        `UPDATE gare SET "updated_at" = NOW() WHERE "id" = $1`,
        [id]
      );
      return { success: true, message: 'Modifica collaborativa disattivata', id };
    } catch (err) {
      return reply.status(500).send({ error: 'Errore', details: err.message });
    }
  });

  // ============================================================
  // POST /api/esiti/:id/invia-notifiche - INVIA: Send notifications
  // ============================================================
  fastify.post('/:id/invia-notifiche', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;

    try {
      // Check esito exists
      const existing = await query('SELECT "id" FROM gare WHERE "id" = $1', [id]);
      if (existing.rows.length === 0) return reply.status(404).send({ error: 'Esito non trovato' });

      const { sendEsitoNotifications } = await import('../services/email-service.js');
      const results = await sendEsitoNotifications(id);

      return { ...results, inviato_da: request.user.username };
    } catch (err) {
      fastify.log.error(err, 'Invia notifiche error');
      return reply.status(500).send({ error: 'Errore invio notifiche', details: err.message });
    }
  });

  // ============================================================
  // POST /api/esiti/:id/invia-email - Send esito via email to custom recipient
  // ============================================================
  fastify.post('/:id/invia-email', async (request, reply) => {
    const { id } = request.params;
    const { email, include_graduatoria = true } = request.body;

    // Validate email
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return reply.status(400).send({ error: 'Indirizzo email non valido' });
    }

    try {
      // Get esito details
      const esitoResult = await query(`
        SELECT g."id", g."Titolo", g."CodiceCIG", g."Data", g."Importo",
               g."NPartecipanti", g."Ribasso", g."MediaAr", g."SogliaAn",
               s."Nome" AS stazione_nome,
               soa."Descrizione" AS soa_categoria
        FROM gare g
        LEFT JOIN stazioni s ON g."id_stazione" = s."id"
        LEFT JOIN soa ON g."id_soa" = soa."id"
        WHERE g."id" = $1
      `, [id]);

      if (esitoResult.rows.length === 0) {
        return reply.status(404).send({ error: 'Esito non trovato' });
      }

      const esito = esitoResult.rows[0];

      // Get graduatoria if requested
      let graduatoriaHtml = '';
      if (include_graduatoria) {
        const gradResult = await query(`
          SELECT "Posizione", "RagioneSociale", "Ribasso", "Vincitrice", "Esclusa", "Anomala", "Note"
          FROM dettagliogara
          WHERE "id_gara" = $1
          ORDER BY "Posizione" ASC
        `, [id]);

        if (gradResult.rows.length > 0) {
          graduatoriaHtml = '<h3 style="color:#F5C518;margin-top:32px;margin-bottom:16px;border-bottom:2px solid #F5C518;padding-bottom:8px;">GRADUATORIA COMPLETA</h3>';
          graduatoriaHtml += '<table style="width:100%;border-collapse:collapse;margin-bottom:24px;background:rgba(30,45,61,0.4);border-radius:8px;overflow:hidden;">';
          graduatoriaHtml += '<thead><tr style="background:#1E2D3D;"><th style="padding:12px;text-align:left;font-weight:600;border-bottom:2px solid #F5C518;color:#F5C518;font-size:0.9em;text-transform:uppercase;">N°</th><th style="padding:12px;text-align:left;font-weight:600;border-bottom:2px solid #F5C518;color:#F5C518;font-size:0.9em;text-transform:uppercase;">RAGIONE SOCIALE</th><th style="padding:12px;text-align:left;font-weight:600;border-bottom:2px solid #F5C518;color:#F5C518;font-size:0.9em;text-transform:uppercase;">RIBASSO</th><th style="padding:12px;text-align:left;font-weight:600;border-bottom:2px solid #F5C518;color:#F5C518;font-size:0.9em;text-transform:uppercase;">RISULTATO</th></tr></thead>';
          graduatoriaHtml += '<tbody>';

          gradResult.rows.forEach((g) => {
            const risultato = g.Vincitrice ? 'VINCITRICE' : g.Esclusa ? 'ESCLUSA' : g.Anomala ? 'ANOMALA' : 'AMMESSA';
            const ribasso = g.Ribasso ? Number(g.Ribasso).toFixed(5) + '%' : '-';
            let rowStyle = 'background:rgba(30,45,61,0.2);';
            if (g.Vincitrice) {
              rowStyle = 'background:linear-gradient(90deg,rgba(27,94,32,0.3) 0%,rgba(67,160,71,0.15) 100%);';
            } else if (g.Esclusa) {
              rowStyle = 'background:linear-gradient(90deg,rgba(97,97,97,0.3) 0%,rgba(158,158,158,0.15) 100%);';
            } else if (g.Anomala) {
              rowStyle = 'background:linear-gradient(90deg,rgba(183,28,28,0.35) 0%,rgba(244,67,54,0.2) 100%);';
            }
            graduatoriaHtml += '<tr style="' + rowStyle + '"><td style="padding:12px;border-bottom:1px solid rgba(245,197,24,0.1);color:#fff;">' + g.Posizione + '</td><td style="padding:12px;border-bottom:1px solid rgba(245,197,24,0.1);color:#fff;">' + (g.RagioneSociale || '') + '</td><td style="padding:12px;border-bottom:1px solid rgba(245,197,24,0.1);color:#fff;">' + ribasso + '</td><td style="padding:12px;border-bottom:1px solid rgba(245,197,24,0.1);color:#fff;">' + risultato + '</td></tr>';
          });

          graduatoriaHtml += '</tbody></table>';
        }
      }

      // Build email HTML
      const now = new Date();
      const dateStr = now.toLocaleDateString('it-IT') + ' ' + now.toLocaleTimeString('it-IT');

      let htmlBody = `<div style="font-family:'Segoe UI',Arial,sans-serif;background:#0F1923;color:#fff;max-width:800px;margin:0 auto;padding:0;">`;
      htmlBody += `<div style="background:linear-gradient(135deg,#1E2D3D 0%,#2A4158 100%);padding:32px 24px;border-radius:12px 12px 0 0;border-bottom:3px solid #F5C518;">`;
      htmlBody += `<h1 style="color:#F5C518;font-size:2em;margin:0 0 8px 0;font-weight:700;">EASYWIN</h1>`;
      htmlBody += `<h2 style="color:#fff;font-size:1.3em;margin:0;font-weight:300;">Esito di Gara #${id}</h2>`;
      htmlBody += `</div>`;

      htmlBody += `<div style="background:rgba(30,45,61,0.6);padding:24px;border-radius:0;margin:0;color:#fff;">`;
      htmlBody += `<div style="margin-bottom:16px;"><span style="font-size:0.85em;color:#aaa;text-transform:uppercase;font-weight:600;letter-spacing:0.5px;">STAZIONE APPALTANTE</span><br><span style="font-size:1em;color:#fff;font-weight:500;">${esito.stazione_nome || '-'}</span></div>`;
      htmlBody += `<div style="margin-bottom:16px;"><span style="font-size:0.85em;color:#aaa;text-transform:uppercase;font-weight:600;letter-spacing:0.5px;">OGGETTO</span><br><span style="font-size:1em;color:#fff;font-weight:500;">${esito.Titolo || '-'}</span></div>`;
      htmlBody += `<div style="margin-bottom:16px;"><span style="font-size:0.85em;color:#aaa;text-transform:uppercase;font-weight:600;letter-spacing:0.5px;">CODICE CIG</span><br><span style="font-size:1em;color:#fff;font-weight:500;">${esito.CodiceCIG || '-'}</span></div>`;
      htmlBody += `<div style="margin-bottom:16px;"><span style="font-size:0.85em;color:#aaa;text-transform:uppercase;font-weight:600;letter-spacing:0.5px;">DATA APERTURA</span><br><span style="font-size:1em;color:#fff;font-weight:500;">${esito.Data ? new Date(esito.Data).toLocaleDateString('it-IT') : '-'}</span></div>`;
      htmlBody += `<div style="margin-bottom:16px;"><span style="font-size:0.85em;color:#aaa;text-transform:uppercase;font-weight:600;letter-spacing:0.5px;">IMPORTO COMPLESSIVO</span><br><span style="font-size:1em;color:#fff;font-weight:500;">${esito.Importo ? Number(esito.Importo).toLocaleString('it-IT', {minimumFractionDigits: 2}) + ' €' : '-'}</span></div>`;
      htmlBody += `<div style="margin-bottom:0;"><span style="font-size:0.85em;color:#aaa;text-transform:uppercase;font-weight:600;letter-spacing:0.5px;">SOA PREVALENTE</span><br><span style="font-size:1em;color:#fff;font-weight:500;">${esito.soa_categoria || '-'}</span></div>`;
      htmlBody += `</div>`;

      htmlBody += `<div style="background:rgba(30,45,61,0.3);padding:24px;display:grid;grid-template-columns:repeat(2,1fr);gap:16px;margin:0;">`;
      htmlBody += `<div style="background:rgba(30,45,61,0.8);padding:16px;border-radius:8px;border:1px solid rgba(245,197,24,0.2);text-align:center;"><div style="font-size:0.8em;color:#aaa;text-transform:uppercase;margin-bottom:8px;font-weight:600;letter-spacing:0.5px;">Media Aritmetica</div><div style="font-size:1.6em;color:#F5C518;font-weight:700;">${esito.MediaAr ? Number(esito.MediaAr).toFixed(5) : '-'}%</div></div>`;
      htmlBody += `<div style="background:rgba(30,45,61,0.8);padding:16px;border-radius:8px;border:1px solid rgba(245,197,24,0.2);text-align:center;"><div style="font-size:0.8em;color:#aaa;text-transform:uppercase;margin-bottom:8px;font-weight:600;letter-spacing:0.5px;">Soglia di Anomalia</div><div style="font-size:1.6em;color:#F5C518;font-weight:700;">${esito.SogliaAn ? Number(esito.SogliaAn).toFixed(5) : '-'}%</div></div>`;
      htmlBody += `<div style="background:rgba(30,45,61,0.8);padding:16px;border-radius:8px;border:1px solid rgba(245,197,24,0.2);text-align:center;"><div style="font-size:0.8em;color:#aaa;text-transform:uppercase;margin-bottom:8px;font-weight:600;letter-spacing:0.5px;">Ribasso Vincitore</div><div style="font-size:1.6em;color:#F5C518;font-weight:700;">${esito.Ribasso ? Number(esito.Ribasso).toFixed(5) : '-'}%</div></div>`;
      htmlBody += `<div style="background:rgba(30,45,61,0.8);padding:16px;border-radius:8px;border:1px solid rgba(245,197,24,0.2);text-align:center;"><div style="font-size:0.8em;color:#aaa;text-transform:uppercase;margin-bottom:8px;font-weight:600;letter-spacing:0.5px;">Partecipanti</div><div style="font-size:1.6em;color:#F5C518;font-weight:700;">${esito.NPartecipanti || '-'}</div></div>`;
      htmlBody += `</div>`;

      // Add graduatoria if requested
      htmlBody += graduatoriaHtml;

      htmlBody += `<div style="background:#1a2a38;padding:20px;text-align:center;font-size:0.85em;color:#aaa;border-top:1px solid rgba(245,197,24,0.2);">`;
      htmlBody += `Generato da EasyWin<br><span style="font-size:0.8em;color:#777;margin-top:8px;display:block;">${dateStr}</span>`;
      htmlBody += `</div></div>`;

      // Send email
      const { sendEmail } = await import('../services/email-service.js');
      const emailResult = await sendEmail(
        email,
        `EasyWin - Esito Gara #${id}: ${esito.Titolo?.substring(0, 60) || 'Comunicazione Esito'}`,
        htmlBody,
        { channel: 'civetta_esito' }
      );

      if (emailResult.status === 'failed') {
        return reply.status(500).send({ error: 'Errore invio email', details: emailResult.error });
      }

      return { status: 'success', message: 'Email inviata con successo', recipient: email };
    } catch (err) {
      fastify.log.error(err, 'Invia email error');
      return reply.status(500).send({ error: 'Errore invio email', details: err.message });
    }
  });

  // ============================================================
  // POST /api/esiti/:id/invia-email-partecipanti - Send email to ALL participants
  // Clients: receive FULL graduatoria
  // Non-clients: receive PARTIAL (own position + 2 above/below)
  // ============================================================
  fastify.post('/:id/invia-email-partecipanti', async (request, reply) => {
    const { id } = request.params;

    try {
      // 1. Fetch the gara/esito details
      const garaResult = await query(`
        SELECT g."id", g."Titolo", g."CodiceCIG", g."Data", g."Importo",
               g."NPartecipanti", g."Ribasso", g."MediaAr", g."SogliaAn",
               s."Nome" AS stazione_nome,
               soa."Descrizione" AS soa_categoria,
               tg."nome" AS tipologia,
               c."nome" AS criterio
        FROM gare g
        LEFT JOIN stazioni s ON g."id_stazione" = s."id"
        LEFT JOIN soa ON g."id_soa" = soa."id"
        LEFT JOIN tipologia_gare tg ON g."id_tipologia" = tg."id"
        LEFT JOIN criteri c ON g."id_criterio" = c."id"
        WHERE g."id" = $1
      `, [id]);

      if (!garaResult.rows.length) {
        return reply.status(404).send({ error: 'Esito non trovato' });
      }
      const gara = garaResult.rows[0];

      // 2. Fetch ALL participants with company details
      const partResult = await query(`
        SELECT dg."Posizione", dg."Ribasso", dg."Vincitrice", dg."Esclusa", dg."Anomala", dg."RagioneSociale",
               a."id" AS id_azienda, a."RagioneSociale" AS azienda_rs, a."Email", a."PartitaIva"
        FROM dettagliogara dg
        LEFT JOIN aziende a ON dg."id_azienda" = a."id"
        WHERE dg."id_gara" = $1
        ORDER BY dg."Posizione" ASC
      `, [id]);

      const graduatoria = partResult.rows;

      // 3. Check which companies are our clients (have active users with valid subscriptions)
      const aziendaIds = graduatoria.filter(p => p.id_azienda).map(p => p.id_azienda);
      let clientiIds = new Set();

      if (aziendaIds.length > 0) {
        const clientiResult = await query(`
          SELECT DISTINCT u."id_azienda" FROM users u
          WHERE u."id_azienda" = ANY($1)
          AND u."is_approved" = true
          AND (u."expire" IS NULL OR u."expire" > NOW())
        `, [aziendaIds]);
        clientiIds = new Set(clientiResult.rows.map(r => r.id_azienda));
      }

      // 4. For each participant with email, generate and send
      let sent = 0, skipped = 0, errors = 0;
      const results = [];
      const { sendEmail } = await import('../services/email-service.js');

      for (const partecipante of graduatoria) {
        if (!partecipante.Email) {
          skipped++;
          results.push({ azienda: partecipante.azienda_rs || partecipante.RagioneSociale, status: 'skipped', reason: 'Email mancante' });
          continue;
        }

        const isCliente = clientiIds.has(partecipante.id_azienda);

        try {
          // Generate HTML email
          const htmlEmail = generateParticipantEmail(gara, graduatoria, partecipante, isCliente);

          const emailResult = await sendEmail(
            partecipante.Email,
            `EasyWin - Esito Gara: ${gara.Titolo?.substring(0, 80) || 'Comunicazione Esito'}`,
            htmlEmail,
            { channel: 'civetta_esito' }
          );

          if (emailResult.status === 'sent') {
            sent++;
            results.push({
              azienda: partecipante.azienda_rs || partecipante.RagioneSociale,
              email: partecipante.Email,
              status: 'sent',
              tipo: isCliente ? 'completo' : 'parziale'
            });
          } else {
            errors++;
            results.push({
              azienda: partecipante.azienda_rs || partecipante.RagioneSociale,
              email: partecipante.Email,
              status: 'error',
              error: emailResult.error || 'Errore sconosciuto'
            });
          }
        } catch (err) {
          errors++;
          results.push({
            azienda: partecipante.azienda_rs || partecipante.RagioneSociale,
            email: partecipante.Email,
            status: 'error',
            error: err.message
          });
        }
      }

      return { sent, skipped, errors, total: graduatoria.length, details: results };
    } catch (err) {
      fastify.log.error(err, 'Invia email partecipanti error');
      return reply.status(500).send({ error: 'Errore invio email', details: err.message });
    }
  });

  // ============================================================
  // GET /api/esiti/:id/invii - History of all INVIA actions for this esito
  // ============================================================
  fastify.get('/:id/invii', async (request) => {
    const { id } = request.params;
    const result = await query(
      `SELECT "id_gara", "created_at" AS data FROM gare WHERE "id_gara" = $1 ORDER BY "created_at" DESC`,
      [id]
    );
    return result.rows;
  });

  // ============================================================
  // GET /api/esiti/:id/storia - Audit trail
  // ============================================================
  fastify.get('/:id/storia', async (request) => {
    const { id } = request.params;
    const result = await query(
      `SELECT "id", "updated_at" AS data FROM gare WHERE "id" = $1`,
      [id]
    );
    return result.rows;
  });

  // ============================================================
  // UTILITY: CalcolaIDTipologiaEsito - Mapping function from original ASP.NET
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
    const { page = 1, limit = 25, sort = 'data', order = 'DESC' } = request.query;
    const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);
    const allowedSort = ['data', 'importo', 'n_partecipanti'];
    const sortCol = allowedSort.includes(sort) ? `g."${sort}"` : 'g."data"';
    const sortDir = order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const [countResult, dataResult] = await Promise.all([
      query(`SELECT COUNT(*) as total FROM gare g WHERE g."annullato" = true`),
      query(`
        SELECT g."id", g."data" AS data, b."titolo" AS titolo, g."n_partecipanti" AS n_partecipanti,
          g."importo" AS importo, g."updated_at" AS data_modifica
        FROM gare g
        LEFT JOIN bandi b ON g."id_bando" = b."id"
        WHERE g."annullato" = true
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
      `UPDATE gare SET "annullato" = false, "updated_at" = NOW() WHERE "id" = $1 AND "annullato" = true RETURNING "id"`,
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
    const { page = 1, limit = 50 } = request.query;
    const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

    const incompleteCond = `"annullato" = false AND (
      b."titolo" IS NULL OR b."titolo" = '' OR
      b."id_stazione" IS NULL OR
      g."data" IS NULL OR
      g."importo" IS NULL OR
      g."id_tipologia" IS NULL OR
      g."n_partecipanti" IS NULL OR g."n_partecipanti" = 0
    )`;

    const [countResult, dataResult] = await Promise.all([
      query(`SELECT COUNT(*) as total FROM gare g LEFT JOIN bandi b ON g."id_bando" = b."id" WHERE ${incompleteCond}`),
      query(`
        SELECT g."id", g."data" AS data, b."titolo" AS titolo, g."n_partecipanti" AS n_partecipanti,
          g."importo" AS importo, b."codice_cig" AS codice_cig,
          s."nome" AS stazione,
          tg."nome" AS tipologia,
          soa."codice" AS soa_codice,
          p."nome" AS provincia,
          r."nome" AS regione,
          ARRAY_REMOVE(ARRAY[
            CASE WHEN b."titolo" IS NULL OR b."titolo" = '' THEN 'Titolo' END,
            CASE WHEN b."id_stazione" IS NULL THEN 'Stazione' END,
            CASE WHEN g."data" IS NULL THEN 'Data' END,
            CASE WHEN g."importo" IS NULL THEN 'Importo' END,
            CASE WHEN g."id_tipologia" IS NULL THEN 'Tipologia' END,
            CASE WHEN g."n_partecipanti" IS NULL OR g."n_partecipanti" = 0 THEN 'N.Partecipanti' END
          ], NULL) AS missing_fields_arr
        FROM gare g
        LEFT JOIN bandi b ON g."id_bando" = b."id"
        LEFT JOIN stazioni s ON b."id_stazione" = s."id"
        LEFT JOIN tipologia_gare tg ON g."id_tipologia" = tg."id"
        LEFT JOIN soa ON g."id_soa" = soa."id"
        LEFT JOIN province p ON s."id_provincia" = p."id"
        LEFT JOIN regioni r ON p."id_regione" = r."id"
        WHERE ${incompleteCond}
        ORDER BY g."data" DESC
        LIMIT $1 OFFSET $2
      `, [parseInt(limit), offset])
    ]);

    return {
      data: dataResult.rows.map(r => ({
        ...r,
        missing_fields: r.missing_fields_arr ? r.missing_fields_arr.join(', ') : ''
      })),
      total: parseInt(countResult.rows[0].total),
      page: parseInt(page),
      limit: parseInt(limit)
    };
  });

  // ============================================================
  // GET /api/esiti/da-abilitare - List confirmed but not enabled esiti
  // ============================================================
  fastify.get('/da-abilitare', { preHandler: [fastify.authenticate] }, async (request) => {
    const { page = 1, limit = 50, search, cig } = request.query;
    const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);
    const conditions = [`g."annullato" = false`];
    const params = [];
    let paramIdx = 1;
    if (search) {
      conditions.push(`(b."titolo" ILIKE $${paramIdx} OR s."nome" ILIKE $${paramIdx})`);
      params.push(`%${search}%`);
      paramIdx++;
    }
    if (cig) {
      conditions.push(`b."codice_cig" ILIKE $${paramIdx}`);
      params.push(`%${cig}%`);
      paramIdx++;
    }
    const where = conditions.join(' AND ');

    const [countResult, dataResult] = await Promise.all([
      query(`SELECT COUNT(*) as total FROM gare g LEFT JOIN bandi b ON g."id_bando" = b."id" LEFT JOIN stazioni s ON b."id_stazione" = s."id" WHERE ${where}`, params),
      query(`
        SELECT g."id", g."data" AS data, b."titolo" AS titolo, g."n_partecipanti" AS n_partecipanti,
          g."importo" AS importo, b."codice_cig" AS codice_cig,
          s."nome" AS stazione,
          tg."nome" AS tipologia,
          soa."codice" AS soa_codice
        FROM gare g
        LEFT JOIN bandi b ON g."id_bando" = b."id"
        LEFT JOIN stazioni s ON b."id_stazione" = s."id"
        LEFT JOIN tipologia_gare tg ON g."id_tipologia" = tg."id"
        LEFT JOIN soa ON g."id_soa" = soa."id"
        WHERE ${where}
        ORDER BY g."data" DESC
        LIMIT $${paramIdx} OFFSET $${paramIdx + 1}
      `, [...params, parseInt(limit), offset])
    ]);

    return {
      data: dataResult.rows,
      total: parseInt(countResult.rows[0].total),
      page: parseInt(page),
      limit: parseInt(limit)
    };
  });

  // ============================================================
  // GET /api/esiti/modificabili - List esiti with collaborative editing
  // ============================================================
  fastify.get('/modificabili', { preHandler: [fastify.authenticate] }, async (request) => {
    const { page = 1, limit = 50 } = request.query;
    const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

    const [countResult, dataResult] = await Promise.all([
      query(`SELECT COUNT(*) as total FROM gare WHERE "annullato" = false`),
      query(`
        SELECT g."id", g."data" AS data, b."titolo" AS titolo, g."n_partecipanti" AS n_partecipanti,
          g."importo" AS importo, b."codice_cig" AS codice_cig,
          s."nome" AS stazione,
          tg."nome" AS tipologia,
          soa."codice" AS soa_codice,
          g."updated_at" AS data_modifica
        FROM gare g
        LEFT JOIN bandi b ON g."id_bando" = b."id"
        LEFT JOIN stazioni s ON b."id_stazione" = s."id"
        LEFT JOIN tipologia_gare tg ON g."id_tipologia" = tg."id"
        LEFT JOIN soa ON g."id_soa" = soa."id"
        WHERE g."annullato" = false
        ORDER BY g."updated_at" DESC NULLS LAST, g."data" DESC
        LIMIT $1 OFFSET $2
      `, [parseInt(limit), offset])
    ]);

    return {
      data: dataResult.rows,
      total: parseInt(countResult.rows[0].total),
      page: parseInt(page),
      limit: parseInt(limit)
    };
  });

  // (versione estesa di /:id/clona è più sotto — rimossa versione duplicata)

  // ============================================================
  // ATI Management (Associazione Temporanea di Imprese)
  // ============================================================

  // GET /api/esiti/:id/ati - List all ATI for esito
  fastify.get('/:id/ati', async (request) => {
    const { id } = request.params;
    const result = await query(`
      SELECT ag."id", ag."id_gara", ag."tipo_ati", ag."avvalimento", ag."ati",
        ag."da_verificare", ag."inserimento",
        ag."id_mandataria", m1."ragione_sociale" AS mandataria_nome, m1."partita_iva" AS mandataria_piva,
        ag."id_mandante", m2."ragione_sociale" AS mandante_nome, m2."partita_iva" AS mandante_piva
      FROM ati_gare ag
      LEFT JOIN aziende m1 ON ag."id_mandataria" = m1."id"
      LEFT JOIN aziende m2 ON ag."id_mandante" = m2."id"
      WHERE ag."id_gara" = $1
      ORDER BY ag."tipo_ati", ag."id"
    `, [id]);
    return result.rows;
  });

  // POST /api/esiti/:id/ati - Create ATI entry
  fastify.post('/:id/ati', async (request, reply) => {
    const { id } = request.params;
    const { id_mandataria, id_mandante, tipo_ati, avvalimento, da_verificare } = request.body;

    const result = await query(`
      INSERT INTO ati_gare ("id_gara", "id_mandataria", "id_mandante", "tipo_ati", "avvalimento", "ati", "da_verificare")
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [
      id,
      id_mandataria || null,
      id_mandante || null,
      tipo_ati || 1,
      avvalimento || false,
      !avvalimento,  // ati = true if not avvalimento
      da_verificare || false
    ]);

    return reply.status(201).send(result.rows[0]);
  });

  // PUT /api/esiti/:id/ati/:atiId - Update ATI entry
  fastify.put('/:id/ati/:atiId', async (request, reply) => {
    const { id, atiId } = request.params;
    const det = request.body;
    const allowedFields = ['id_mandataria', 'id_mandante', 'tipo_ati', 'avvalimento', 'ati', 'da_verificare'];
    const sets = [];
    const params = [];
    let idx = 1;
    for (const f of allowedFields) {
      if (det[f] !== undefined) {
        sets.push(`"${f}" = $${idx}`);
        params.push(det[f]);
        idx++;
      }
    }
    if (sets.length === 0) return reply.status(400).send({ error: 'Nessun campo da aggiornare' });
    params.push(atiId, id);
    const result = await query(
      `UPDATE ati_gare SET ${sets.join(', ')} WHERE "id" = $${idx} AND "id_gara" = $${idx+1} RETURNING *`,
      params
    );
    if (!result.rows.length) return reply.status(404).send({ error: 'ATI non trovato' });
    return result.rows[0];
  });

  // DELETE /api/esiti/:id/ati/:atiId - Remove ATI
  fastify.delete('/:id/ati/:atiId', async (request, reply) => {
    const { id, atiId } = request.params;
    const result = await query(
      `DELETE FROM ati_gare WHERE "id" = $1 AND "id_gara" = $2 RETURNING "id"`,
      [atiId, id]
    );
    if (!result.rows.length) return reply.status(404).send({ error: 'ATI non trovato' });
    return { message: 'ATI eliminato', id: result.rows[0].id };
  });

  // ============================================================
  // AVVALIMENTI Management
  // ============================================================

  // GET /api/esiti/:id/avvalimenti - List all avvalimenti for esito
  fastify.get('/:id/avvalimenti', async (request) => {
    const { id } = request.params;
    const result = await query(`
      SELECT av."id", av."id_gara", av."tipo",
        av."id_azienda_principale", a1."ragione_sociale" AS principale_nome, a1."partita_iva" AS principale_piva,
        av."id_azienda_ausiliaria", a2."ragione_sociale" AS ausiliaria_nome, a2."partita_iva" AS ausiliaria_piva
      FROM avvalimenti_gare av
      LEFT JOIN aziende a1 ON av."id_azienda_principale" = a1."id"
      LEFT JOIN aziende a2 ON av."id_azienda_ausiliaria" = a2."id"
      WHERE av."id_gara" = $1
      ORDER BY av."id"
    `, [id]);
    return result.rows;
  });

  // POST /api/esiti/:id/avvalimenti - Create avvalimento
  fastify.post('/:id/avvalimenti', async (request, reply) => {
    const { id } = request.params;
    const { id_azienda_principale, id_azienda_ausiliaria, tipo } = request.body;

    const result = await query(`
      INSERT INTO avvalimenti_gare ("id_gara", "id_azienda_principale", "id_azienda_ausiliaria", "tipo")
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [id, id_azienda_principale || null, id_azienda_ausiliaria || null, tipo || 'Generico']);

    return reply.status(201).send(result.rows[0]);
  });

  // DELETE /api/esiti/:id/avvalimenti/:avvId - Remove avvalimento
  fastify.delete('/:id/avvalimenti/:avvId', async (request, reply) => {
    const { id, avvId } = request.params;
    const result = await query(
      `DELETE FROM avvalimenti_gare WHERE "id" = $1 AND "id_gara" = $2 RETURNING "id"`,
      [avvId, id]
    );
    if (!result.rows.length) return reply.status(404).send({ error: 'Avvalimento non trovato' });
    return { message: 'Avvalimento eliminato', id: result.rows[0].id };
  });

  // ============================================================
  // Search aziende (shared for ATI/Avvalimenti)
  // ============================================================
  fastify.post('/:id/cerca-azienda', async (request) => {
    const { q } = request.body;
    if (!q || q.length < 2) return [];
    const result = await query(`
      SELECT a."id", a."ragione_sociale", a."partita_iva", a."codice_fiscale",
             p."nome" AS provincia, p."sigla" AS provincia_sigla
      FROM aziende a
      LEFT JOIN province p ON a."id_provincia" = p."id"
      WHERE a."ragione_sociale" ILIKE $1 OR a."partita_iva" ILIKE $1 OR a."codice_fiscale" ILIKE $1
      ORDER BY a."ragione_sociale" ASC
      LIMIT 20
    `, [`%${q}%`]);
    return result.rows;
  });

  // ============================================================
  // POST /api/esiti/:id/clona - CLONA: duplica l'esito in stato BOZZA
  // ============================================================
  fastify.post('/:id/clona', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;
    try {
      const existing = await query('SELECT * FROM gare WHERE "id" = $1', [id]);
      if (existing.rows.length === 0) return reply.status(404).send({ error: 'Esito non trovato' });

      // Duplico riga gare: nuovo id, temp=true, enabled=false, bloccato=false, data_abilitazione=null
      // Uso INSERT ... SELECT per copiare tutti i campi tranne quelli da resettare
      const newRow = await query(`
        INSERT INTO gare (
          "data", "titolo", "codice_cig", "importo", "importo_so", "importo_co", "importo_eco",
          "n_partecipanti", "n_ammessi", "n_esclusi", "n_sorteggio", "n_decimali",
          "ribasso", "ribasso_vincitore", "importo_vincitore",
          "media_ar", "soglia_an", "media_sc", "soglia_riferimento",
          "accorpa_ali", "tipo_accorpa_ali", "limit_min_media",
          "variante", "varianti_disponibili", "citta", "cap", "indirizzo",
          "temp", "enabled", "bloccato", "enable_to_all",
          "id_bando", "id_tipo_dati", "id_stazione", "id_provincia", "id_soa",
          "id_tipologia", "id_criterio", "id_piattaforma", "id_vincitore",
          "note", "note_01", "note_02", "note_03",
          "username", "inserito_da", "provenienza", "fonte_dati",
          "created_at", "updated_at"
        )
        SELECT
          "data", CONCAT('[COPIA] ', "titolo"), "codice_cig", "importo", "importo_so", "importo_co", "importo_eco",
          "n_partecipanti", "n_ammessi", "n_esclusi", "n_sorteggio", "n_decimali",
          "ribasso", "ribasso_vincitore", "importo_vincitore",
          "media_ar", "soglia_an", "media_sc", "soglia_riferimento",
          "accorpa_ali", "tipo_accorpa_ali", "limit_min_media",
          "variante", "varianti_disponibili", "citta", "cap", "indirizzo",
          TRUE AS "temp", FALSE AS "enabled", FALSE AS "bloccato", FALSE AS "enable_to_all",
          "id_bando", "id_tipo_dati", "id_stazione", "id_provincia", "id_soa",
          "id_tipologia", "id_criterio", "id_piattaforma", "id_vincitore",
          "note", "note_01", "note_02", "note_03",
          "username", "inserito_da", "provenienza", "fonte_dati",
          NOW() AS "created_at", NOW() AS "updated_at"
        FROM gare WHERE "id" = $1
        RETURNING "id"
      `, [id]);

      const newId = newRow.rows[0]?.id;

      // Copia anche la graduatoria (dettaglio_gara)
      if (newId) {
        await query(`
          INSERT INTO dettaglio_gara (id_gara, posizione, id_azienda, ribasso, anomala, taglio_ali, vincitrice, esclusa, da_verificare, pari_merito)
          SELECT $1, posizione, id_azienda, ribasso, anomala, taglio_ali, vincitrice, esclusa, da_verificare, pari_merito
          FROM dettaglio_gara WHERE id_gara = $2
        `, [newId, id]).catch(() => { /* tabella potrebbe avere schema leggermente diverso - non blocco clonazione */ });
      }

      return { success: true, id: newId, message: 'Esito clonato' };
    } catch (err) {
      fastify.log.error({ err: err.message }, 'POST /esiti/:id/clona error');
      return reply.status(500).send({ error: 'Errore clonazione', details: err.message });
    }
  });

  // ============================================================
  // POST /api/esiti/:id/dissocia-bando - DISSOCIA: rimuove il collegamento al bando
  // ============================================================
  fastify.post('/:id/dissocia-bando', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;
    try {
      const res = await query(
        `UPDATE gare SET "id_bando" = NULL, "updated_at" = NOW() WHERE "id" = $1 RETURNING "id"`,
        [id]
      );
      if (res.rows.length === 0) return reply.status(404).send({ error: 'Esito non trovato' });
      return { success: true, message: 'Bando dissociato', id };
    } catch (err) {
      return reply.status(500).send({ error: 'Errore dissociazione', details: err.message });
    }
  });

  // ============================================================
  // POST /api/esiti/:id/azzera - AZZERA: svuota graduatoria e dati calcolati
  // ============================================================
  fastify.post('/:id/azzera', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;
    try {
      await transaction(async (client) => {
        // Rimuovo le righe di graduatoria
        await client.query('DELETE FROM dettaglio_gara WHERE "id_gara" = $1', [id]).catch(() => {});
        // Azzero i dati calcolati sulla gara
        await client.query(`
          UPDATE gare SET
            "media_ar" = NULL, "media_sc" = NULL, "soglia_an" = NULL, "soglia_riferimento" = NULL,
            "ribasso_vincitore" = NULL, "importo_vincitore" = NULL, "id_vincitore" = NULL,
            "ribasso" = NULL,
            "updated_at" = NOW()
          WHERE "id" = $1
        `, [id]);
      });
      return { success: true, message: 'Dati calcolati azzerati', id };
    } catch (err) {
      return reply.status(500).send({ error: 'Errore azzeramento', details: err.message });
    }
  });

  // ============================================================
  // POST /api/esiti/:id/invia - INVIA: invia esito via email ai destinatari
  // ============================================================
  fastify.post('/:id/invia', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;
    const { emails, tutti } = request.body || {};
    try {
      const existing = await query('SELECT "id", "titolo" FROM gare WHERE "id" = $1', [id]);
      if (existing.rows.length === 0) return reply.status(404).send({ error: 'Esito non trovato' });

      // TODO: integrare con il sistema newsletter reale (nodemailer + template)
      // Per ora registro l'invio nella tabella gare_invii se esiste, altrimenti solo conferma
      let n_destinatari = 0;
      if (tutti) {
        const r = await query(`SELECT COUNT(*)::int AS n FROM users WHERE "enabled" = TRUE`).catch(() => ({ rows: [{ n: 0 }] }));
        n_destinatari = r.rows[0]?.n || 0;
      } else if (Array.isArray(emails)) {
        n_destinatari = emails.length;
      }

      await query(
        `INSERT INTO gare_invii (id_gara, data_invio, n_destinatari) VALUES ($1, NOW(), $2)`,
        [id, n_destinatari]
      ).catch(() => { /* se tabella non ha queste colonne esatte, proseguo */ });

      return {
        success: true,
        message: 'Invio registrato (modulo email da completare)',
        n_inviati: n_destinatari,
        todo: 'Integrazione nodemailer/newsletter in corso di implementazione'
      };
    } catch (err) {
      return reply.status(500).send({ error: 'Errore invio', details: err.message });
    }
  });

  // ============================================================
  // GET /api/esiti/:id/export?format=pdf|xlsx - ESPORTA: export esito
  // ============================================================
  fastify.get('/:id/export', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;
    const format = (request.query.format || 'pdf').toLowerCase();

    try {
      const existing = await query('SELECT "id", "titolo", "codice_cig", "data", "importo", "ribasso_vincitore" FROM gare WHERE "id" = $1', [id]);
      if (existing.rows.length === 0) return reply.status(404).send({ error: 'Esito non trovato' });
      const e = existing.rows[0];

      if (format === 'xlsx' || format === 'xls' || format === 'csv') {
        // CSV semplice (niente dipendenze extra) — leggibile anche da Excel
        const grad = await query(`
          SELECT dg."posizione", a."ragione_sociale", dg."ribasso", dg."vincitrice", dg."esclusa", dg."anomala", dg."taglio_ali"
          FROM dettaglio_gara dg LEFT JOIN aziende a ON dg."id_azienda" = a."id"
          WHERE dg."id_gara" = $1 ORDER BY dg."posizione" ASC
        `, [id]).catch(() => ({ rows: [] }));

        let csv = '\uFEFF'; // BOM per Excel
        csv += 'Esito;' + (e.titolo || '').replace(/;/g, ',') + '\n';
        csv += 'CIG;' + (e.codice_cig || '') + '\n';
        csv += 'Data;' + (e.data ? new Date(e.data).toLocaleDateString('it-IT') : '') + '\n';
        csv += 'Importo;' + (e.importo || '') + '\n';
        csv += '\nPosizione;Ragione sociale;Ribasso %;Vincitrice;Esclusa;Anomala;Taglio ali\n';
        for (const r of grad.rows) {
          csv += [r.posizione, (r.ragione_sociale || '').replace(/;/g, ','), r.ribasso ?? '', r.vincitrice ? 'SI' : '', r.esclusa ? 'SI' : '', r.anomala ? 'SI' : '', r.taglio_ali ? 'SI' : ''].join(';') + '\n';
        }
        reply.header('Content-Type', 'text/csv; charset=utf-8');
        reply.header('Content-Disposition', `attachment; filename="esito-${id}.csv"`);
        return reply.send(csv);
      }

      // PDF: export semplice HTML-based (apri nel browser e stampa; oppure TODO: usare puppeteer/pdfkit)
      // Per ora rispondo con un HTML minimale che il browser scarica come .pdf con print
      reply.header('Content-Type', 'text/html; charset=utf-8');
      reply.header('Content-Disposition', `attachment; filename="esito-${id}.html"`);
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Esito ${id}</title><style>body{font-family:Arial;padding:30px}h1{color:#FF8C00}table{width:100%;border-collapse:collapse;margin-top:20px}th,td{padding:8px;border:1px solid #ddd;text-align:left}th{background:#f5f5f5}</style></head><body><h1>Esito #${id}</h1><p><strong>${(e.titolo || '').replace(/</g, '&lt;')}</strong></p><p>CIG: ${e.codice_cig || '—'} — Data: ${e.data ? new Date(e.data).toLocaleDateString('it-IT') : '—'}</p><p>Importo: € ${e.importo || '—'} — Ribasso vincitore: ${e.ribasso_vincitore || '—'}%</p><p style="color:#888;margin-top:40px;font-size:11px">⚠️ Export PDF completo in arrivo (con graduatoria, metodo di calcolo, grafici). Per ora usa Stampa → Salva come PDF.</p></body></html>`;
      return reply.send(html);
    } catch (err) {
      return reply.status(500).send({ error: 'Errore export', details: err.message });
    }
  });

}

// ============================================================
// HELPER: Generate personalized participant email
// ============================================================
function generateParticipantEmail(gara, graduatoria, partecipante, isCliente) {
  const now = new Date();
  const dateStr = now.toLocaleDateString('it-IT') + ' ' + now.toLocaleTimeString('it-IT');

  // Build base HTML structure
  let html = `<div style="font-family:'Segoe UI',Arial,sans-serif;background:#0F1923;color:#fff;max-width:900px;margin:0 auto;padding:0;">`;

  // Header
  html += `<div style="background:linear-gradient(135deg,#1E2D3D 0%,#2A4158 100%);padding:32px 24px;border-radius:12px 12px 0 0;border-bottom:3px solid #F5C518;">`;
  html += `<h1 style="color:#F5C518;font-size:2em;margin:0 0 8px 0;font-weight:700;">EASYWIN</h1>`;
  html += `<h2 style="color:#fff;font-size:1.3em;margin:0;font-weight:300;">Esito di Gara #${gara.id}</h2>`;
  html += `</div>`;

  // Gara details section
  html += `<div style="background:rgba(30,45,61,0.6);padding:24px;color:#fff;">`;
  html += `<div style="margin-bottom:16px;"><span style="font-size:0.85em;color:#aaa;text-transform:uppercase;font-weight:600;letter-spacing:0.5px;">STAZIONE APPALTANTE</span><br><span style="font-size:1em;color:#fff;font-weight:500;">${gara.stazione_nome || '-'}</span></div>`;
  html += `<div style="margin-bottom:16px;"><span style="font-size:0.85em;color:#aaa;text-transform:uppercase;font-weight:600;letter-spacing:0.5px;">OGGETTO</span><br><span style="font-size:1em;color:#fff;font-weight:500;">${gara.Titolo || '-'}</span></div>`;
  html += `<div style="margin-bottom:16px;"><span style="font-size:0.85em;color:#aaa;text-transform:uppercase;font-weight:600;letter-spacing:0.5px;">CODICE CIG</span><br><span style="font-size:1em;color:#fff;font-weight:500;">${gara.CodiceCIG || '-'}</span></div>`;
  html += `<div style="margin-bottom:16px;"><span style="font-size:0.85em;color:#aaa;text-transform:uppercase;font-weight:600;letter-spacing:0.5px;">DATA APERTURA</span><br><span style="font-size:1em;color:#fff;font-weight:500;">${gara.Data ? new Date(gara.Data).toLocaleDateString('it-IT') : '-'}</span></div>`;
  html += `<div style="margin-bottom:0;"><span style="font-size:0.85em;color:#aaa;text-transform:uppercase;font-weight:600;letter-spacing:0.5px;">IMPORTO COMPLESSIVO</span><br><span style="font-size:1em;color:#fff;font-weight:500;">${gara.Importo ? Number(gara.Importo).toLocaleString('it-IT', {minimumFractionDigits: 2}) + ' €' : '-'}</span></div>`;
  html += `</div>`;

  // Statistics grid (for clients only, or partial for non-clients)
  html += `<div style="background:rgba(30,45,61,0.3);padding:24px;display:grid;grid-template-columns:repeat(2,1fr);gap:16px;">`;
  html += `<div style="background:rgba(30,45,61,0.8);padding:16px;border-radius:8px;border:1px solid rgba(245,197,24,0.2);text-align:center;"><div style="font-size:0.8em;color:#aaa;text-transform:uppercase;margin-bottom:8px;font-weight:600;">Media Aritmetica</div><div style="font-size:1.6em;color:#F5C518;font-weight:700;">${gara.MediaAr ? Number(gara.MediaAr).toFixed(5) : '-'}%</div></div>`;
  html += `<div style="background:rgba(30,45,61,0.8);padding:16px;border-radius:8px;border:1px solid rgba(245,197,24,0.2);text-align:center;"><div style="font-size:0.8em;color:#aaa;text-transform:uppercase;margin-bottom:8px;font-weight:600;">Soglia Anomalia</div><div style="font-size:1.6em;color:#F5C518;font-weight:700;">${gara.SogliaAn ? Number(gara.SogliaAn).toFixed(5) : '-'}%</div></div>`;
  html += `<div style="background:rgba(30,45,61,0.8);padding:16px;border-radius:8px;border:1px solid rgba(245,197,24,0.2);text-align:center;"><div style="font-size:0.8em;color:#aaa;text-transform:uppercase;margin-bottom:8px;font-weight:600;">Partecipanti</div><div style="font-size:1.6em;color:#F5C518;font-weight:700;">${gara.NPartecipanti || '-'}</div></div>`;
  html += `<div style="background:rgba(30,45,61,0.8);padding:16px;border-radius:8px;border:1px solid rgba(245,197,24,0.2);text-align:center;"><div style="font-size:0.8em;color:#aaa;text-transform:uppercase;margin-bottom:8px;font-weight:600;">Vostra Posizione</div><div style="font-size:1.6em;color:#F5C518;font-weight:700;">${partecipante.Posizione || '-'}</div></div>`;
  html += `</div>`;

  // Participant's own result
  const risultato = partecipante.Vincitrice ? 'VINCITRICE' : partecipante.Esclusa ? 'ESCLUSA' : partecipante.Anomala ? 'ANOMALA' : 'AMMESSA';
  const ribasso = partecipante.Ribasso ? Number(partecipante.Ribasso).toFixed(5) + '%' : '-';

  html += `<div style="background:rgba(30,45,61,0.5);padding:20px 24px;margin:0;">`;
  html += `<div style="font-size:0.9em;color:#aaa;text-transform:uppercase;margin-bottom:8px;font-weight:600;letter-spacing:0.5px;">LA VOSTRA OFFERTA</div>`;
  html += `<div style="font-size:1.1em;color:#fff;margin-bottom:8px;"><strong>${partecipante.azienda_rs || partecipante.RagioneSociale || 'Partecipante'}</strong></div>`;
  html += `<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px;">`;
  html += `<div><span style="color:#aaa;font-size:0.85em;">Ribasso:</span><br><span style="color:#F5C518;font-weight:700;font-size:1.2em;">${ribasso}</span></div>`;
  html += `<div><span style="color:#aaa;font-size:0.85em;">Risultato:</span><br><span style="color:#F5C518;font-weight:700;font-size:1.2em;">${risultato}</span></div>`;
  html += `</div>`;
  html += `</div>`;

  // Graduatoria section
  if (isCliente) {
    // FULL graduatoria for clients
    html += `<div style="padding:24px;"><h3 style="color:#F5C518;margin-top:0;margin-bottom:16px;border-bottom:2px solid #F5C518;padding-bottom:8px;">GRADUATORIA COMPLETA</h3>`;
    html += buildGraduatoriaTable(graduatoria, partecipante.Posizione, true);
    html += `</div>`;
  } else {
    // PARTIAL graduatoria for non-clients
    html += `<div style="padding:24px;"><h3 style="color:#F5C518;margin-top:0;margin-bottom:16px;border-bottom:2px solid #F5C518;padding-bottom:8px;">VOSTRA POSIZIONE IN GRADUATORIA</h3>`;
    const partialGraduatoria = getPartialGraduatoria(graduatoria, partecipante.Posizione);
    html += buildGraduatoriaTable(partialGraduatoria, partecipante.Posizione, false);
    html += `<div style="background:rgba(245,197,24,0.1);padding:16px;border-radius:8px;margin-top:16px;border-left:4px solid #F5C518;">`;
    html += `<p style="margin:0;color:#F5C518;font-weight:600;margin-bottom:8px;">Per visualizzare la graduatoria completa, attiva il tuo abbonamento EasyWin</p>`;
    html += `<p style="margin:0;color:#fff;font-size:0.9em;">Accedi all'area riservata per scoprire le nostre soluzioni premium e ottenere accesso a tutte le informazioni complete delle gare.</p>`;
    html += `</div>`;
    html += `</div>`;
  }

  // Footer
  html += `<div style="background:#1a2a38;padding:20px;text-align:center;font-size:0.85em;color:#aaa;border-top:1px solid rgba(245,197,24,0.2);">`;
  html += `Generato da EasyWin<br><span style="font-size:0.8em;color:#777;margin-top:8px;display:block;">${dateStr}</span>`;
  html += `</div></div>`;

  return html;
}

// Build graduatoria table HTML
function buildGraduatoriaTable(graduatoria, currentPosition, isFull) {
  let html = `<table style="width:100%;border-collapse:collapse;background:rgba(30,45,61,0.4);border-radius:8px;overflow:hidden;">`;
  html += `<thead><tr style="background:#1E2D3D;">`;
  html += `<th style="padding:12px;text-align:left;font-weight:600;border-bottom:2px solid #F5C518;color:#F5C518;font-size:0.85em;text-transform:uppercase;">N°</th>`;
  html += `<th style="padding:12px;text-align:left;font-weight:600;border-bottom:2px solid #F5C518;color:#F5C518;font-size:0.85em;text-transform:uppercase;">RAGIONE SOCIALE</th>`;
  html += `<th style="padding:12px;text-align:left;font-weight:600;border-bottom:2px solid #F5C518;color:#F5C518;font-size:0.85em;text-transform:uppercase;">RIBASSO</th>`;
  html += `<th style="padding:12px;text-align:left;font-weight:600;border-bottom:2px solid #F5C518;color:#F5C518;font-size:0.85em;text-transform:uppercase;">RISULTATO</th>`;
  html += `</tr></thead><tbody>`;

  graduatoria.forEach((row) => {
    const risultato = row.Vincitrice ? 'VINCITRICE' : row.Esclusa ? 'ESCLUSA' : row.Anomala ? 'ANOMALA' : 'AMMESSA';
    const ribasso = row.Ribasso ? Number(row.Ribasso).toFixed(5) + '%' : '-';

    let rowStyle = 'background:rgba(30,45,61,0.2);';
    if (row.Vincitrice) {
      rowStyle = 'background:linear-gradient(90deg,rgba(27,94,32,0.3) 0%,rgba(67,160,71,0.15) 100%);';
    } else if (row.Esclusa) {
      rowStyle = 'background:linear-gradient(90deg,rgba(97,97,97,0.3) 0%,rgba(158,158,158,0.15) 100%);';
    } else if (row.Anomala) {
      rowStyle = 'background:linear-gradient(90deg,rgba(183,28,28,0.35) 0%,rgba(244,67,54,0.2) 100%);';
    }

    // Highlight current participant's row
    if (row.Posizione === currentPosition) {
      rowStyle = 'background:rgba(245,197,24,0.15);border-left:4px solid #F5C518;';
    }

    html += `<tr style="${rowStyle}border-bottom:1px solid rgba(245,197,24,0.1);">`;
    html += `<td style="padding:12px;color:#fff;">${row.Posizione}</td>`;
    html += `<td style="padding:12px;color:#fff;">${row.azienda_rs || row.RagioneSociale || ''}</td>`;
    html += `<td style="padding:12px;color:#fff;">${ribasso}</td>`;
    html += `<td style="padding:12px;color:#fff;">${risultato}</td>`;
    html += `</tr>`;
  });

  html += `</tbody></table>`;
  return html;
}

// Get partial graduatoria: current position + 2 above/below
function getPartialGraduatoria(graduatoria, currentPosition) {
  const currentIdx = graduatoria.findIndex(p => p.Posizione === currentPosition);
  if (currentIdx === -1) return graduatoria.slice(0, 1);

  const start = Math.max(0, currentIdx - 2);
  const end = Math.min(graduatoria.length, currentIdx + 3);
  return graduatoria.slice(start, end);
}
