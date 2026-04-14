// ============================================================================
// APPUNTAMENTI — Sopralluoghi, Aperture, Scritture
// Unified endpoints that query the real domain tables
// (sopralluoghi / apertura_bandi / scrittura_bandi) joined with bandi/stazioni/aziende.
// Also exposes a calendar-aggregation endpoint that returns events from
// all 3 tables merged into a single, uniformly-shaped list.
// ============================================================================

import { query } from '../db/pool.js';

export default async function appuntamentiRoutes(fastify, opts) {

  // ---- common helpers --------------------------------------------------
  const parseBool = (v) => {
    if (v === undefined || v === null || v === '') return null;
    const s = String(v).toLowerCase();
    if (['1', 'true', 'yes', 'si', 'sì'].includes(s)) return true;
    if (['0', 'false', 'no'].includes(s)) return false;
    return null;
  };
  const parseTriState = (v) => {
    // "tutti" / null = no filter ; "si"/"eseguito"/"pagato"/"annullato" = true ;
    // "no"/"non_eseguito"/"non_pagato"/"non_annullato" = false
    if (!v || v === 'tutti' || v === '') return null;
    const s = String(v).toLowerCase();
    if (['si', 'sì', 'eseguito', 'pagato', 'annullato', 'true', '1'].includes(s)) return true;
    if (['no', 'non_eseguito', 'non_pagato', 'non_annullato', 'false', '0'].includes(s)) return false;
    return null;
  };
  const toDate = (v) => {
    if (!v) return null;
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  };

  // ======================================================================
  // GET /api/appuntamenti/sopralluoghi
  // Returns rich rows from `sopralluoghi` + joined bando/stazione/azienda.
  // Filters mirror the old site AppuntamentiSopralluoghi page.
  // ======================================================================
  fastify.get('/sopralluoghi', async (request, reply) => {
    try {
      const q = request.query || {};
      const conds = [];
      const params = [];
      const add = (sql, val) => { params.push(val); conds.push(sql.replace('?', '$' + params.length)); };

      const dri = toDate(q.data_richiesta_inizio);
      const drf = toDate(q.data_richiesta_fine);
      if (dri) add('s.data_richiesta >= ?', dri);
      if (drf) add('s.data_richiesta <= ?', drf);
      if (q.data_richiesta_filtro === 'con')  conds.push('s.data_richiesta IS NOT NULL');
      if (q.data_richiesta_filtro === 'senza') conds.push('s.data_richiesta IS NULL');

      const dei = toDate(q.data_esecuzione_inizio);
      const def = toDate(q.data_esecuzione_fine);
      if (dei) add('s.data_sopralluogo >= ?', dei);
      if (def) add('s.data_sopralluogo <= ?', def);
      if (q.data_esecuzione_filtro === 'con')  conds.push('s.data_sopralluogo IS NOT NULL');
      if (q.data_esecuzione_filtro === 'senza') conds.push('s.data_sopralluogo IS NULL');

      const eseguito = parseTriState(q.eseguito);
      if (eseguito !== null) add('COALESCE(s.eseguito,false) = ?', eseguito);

      const annullato = parseTriState(q.annullato);
      if (annullato !== null) add('COALESCE(s.annullato,false) = ?', annullato);

      const pagAz = parseTriState(q.pagato_azienda);
      if (pagAz !== null) add('COALESCE(s.pagato_azienda,false) = ?', pagAz);

      const pagUt = parseTriState(q.pagato_utente);
      if (pagUt !== null) add('COALESCE(s.pagato_utente,false) = ?', pagUt);

      if (q.id_bando)     add('s.id_bando = ?', String(q.id_bando));
      if (q.presa_visione === 'true')  conds.push('COALESCE(s.presa_visione,false) = true');
      if (q.presa_visione === 'false') conds.push('COALESCE(s.presa_visione,false) = false');
      if (q.id_azienda)   add('s.id_azienda = ?', parseInt(q.id_azienda));
      if (q.id_stazione)  add('b.id_stazione = ?', parseInt(q.id_stazione));
      if (q.stazione_nome) add('LOWER(b.stazione_nome) LIKE ?', '%' + String(q.stazione_nome).toLowerCase() + '%');
      if (q.oggetto)      add('LOWER(b.titolo) LIKE ?', '%' + String(q.oggetto).toLowerCase() + '%');
      if (q.codice_cig)   add('LOWER(b.codice_cig) LIKE ?', '%' + String(q.codice_cig).toLowerCase() + '%');
      if (q.id_criterio)  add('b.id_criterio = ?', parseInt(q.id_criterio));
      if (q.id_tipologia) add('b.id_tipologia_bando = ?', parseInt(q.id_tipologia));

      const whereClause = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
      const limit = Math.min(parseInt(q.limit || '200'), 1000);

      const sql = `
        SELECT
          s.id,
          s.id_bando,
          s.data_sopralluogo,
          s.data_richiesta,
          s.data_prenotazione,
          s.prenotato,
          s.eseguito,
          s.annullato,
          s.pagato_azienda,
          s.pagato_utente,
          s.presa_visione,
          s.prezzo,
          s.prezzo_utente,
          s.indirizzo,
          s.citta,
          s.cap,
          s.telefono,
          s.email,
          s.note,
          s.tipo_prenotazione,
          s.riferimento_azienda_richiedente,
          s.riferimento_intermediario_richiedente,
          s.riferimento_intermediario_esecutore,
          s.gestore_richiesta,
          s.username,
          b.titolo AS bando_titolo,
          b.codice_cig,
          b.importo_so,
          b.importo_co,
          b.data_offerta,
          b.stazione_nome,
          b.citta AS bando_citta,
          b.regione AS bando_regione,
          az.ragione_sociale AS azienda_nome,
          az.partita_iva AS azienda_piva
        FROM sopralluoghi s
        LEFT JOIN bandi b ON s.id_bando = b.id
        LEFT JOIN aziende az ON s.id_azienda = az.id
        ${whereClause}
        ORDER BY COALESCE(s.data_sopralluogo, s.data_richiesta) DESC NULLS LAST
        LIMIT ${limit}
      `;
      const r = await query(sql, params);
      return reply.send({ success: true, total: r.rows.length, data: r.rows });
    } catch (err) {
      fastify.log.error(err, 'appuntamenti/sopralluoghi failed');
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  // ======================================================================
  // GET /api/appuntamenti/sopralluoghi/:id — single record (full detail)
  // ======================================================================
  fastify.get('/sopralluoghi/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      const r = await query(
        `SELECT s.*,
                b.titolo AS bando_titolo, b.codice_cig, b.data_offerta,
                b.stazione_nome, b.importo_so, b.citta AS bando_citta, b.regione AS bando_regione,
                az.ragione_sociale AS azienda_nome, az.partita_iva AS azienda_piva
         FROM sopralluoghi s
         LEFT JOIN bandi b ON s.id_bando = b.id
         LEFT JOIN aziende az ON s.id_azienda = az.id
         WHERE s.id = $1 LIMIT 1`,
        [id]
      );
      if (r.rows.length === 0) return reply.status(404).send({ error: 'Sopralluogo non trovato' });
      return reply.send({ success: true, data: r.rows[0] });
    } catch (err) {
      fastify.log.error(err, 'appuntamenti/sopralluoghi/:id failed');
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  // ======================================================================
  // PUT /api/appuntamenti/sopralluoghi/:id — update editable fields
  // ======================================================================
  fastify.put('/sopralluoghi/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      const b = request.body || {};
      // Whitelist di campi modificabili
      const editable = [
        'data_sopralluogo', 'data_prenotazione', 'data_richiesta',
        'prenotato', 'eseguito', 'annullato', 'presa_visione',
        'tipo_prenotazione', 'telefono', 'email', 'fax',
        'indirizzo', 'cap', 'citta', 'id_provincia',
        'prezzo', 'iva', 'prezzo_utente', 'iva_utente',
        'pagato_azienda', 'pagato_utente',
        'gestore_richiesta', 'note',
        'riferimento_azienda_richiedente',
        'riferimento_intermediario_richiedente',
        'riferimento_intermediario_esecutore'
      ];
      const sets = [];
      const params = [];
      for (const k of editable) {
        if (k in b) {
          params.push(b[k] === '' ? null : b[k]);
          sets.push(`${k} = $${params.length}`);
        }
      }
      if (sets.length === 0) {
        return reply.status(400).send({ error: 'Nessun campo da aggiornare' });
      }
      sets.push(`data_modifica = NOW()`);
      params.push(id);
      const sql = `UPDATE sopralluoghi SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`;
      const r = await query(sql, params);
      if (r.rows.length === 0) return reply.status(404).send({ error: 'Sopralluogo non trovato' });
      return reply.send({ success: true, data: r.rows[0] });
    } catch (err) {
      fastify.log.error(err, 'PUT sopralluoghi/:id failed');
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  // ======================================================================
  // DELETE /api/appuntamenti/sopralluoghi/:id
  // ======================================================================
  fastify.delete('/sopralluoghi/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      const r = await query(`DELETE FROM sopralluoghi WHERE id = $1 RETURNING id`, [id]);
      if (r.rows.length === 0) return reply.status(404).send({ error: 'Sopralluogo non trovato' });
      return reply.send({ success: true, id: r.rows[0].id });
    } catch (err) {
      fastify.log.error(err, 'DELETE sopralluoghi/:id failed');
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  // ======================================================================
  // PATCH /api/appuntamenti/sopralluoghi/:id/esegui
  // Marca come eseguito, imposta data_sopralluogo se non già valorizzata.
  // ======================================================================
  fastify.patch('/sopralluoghi/:id/esegui', async (request, reply) => {
    try {
      const { id } = request.params;
      const b = request.body || {};
      const dataEsec = b.data_sopralluogo ? new Date(b.data_sopralluogo) : new Date();
      const r = await query(
        `UPDATE sopralluoghi
           SET eseguito = true,
               annullato = false,
               data_sopralluogo = COALESCE(data_sopralluogo, $1),
               data_modifica = NOW()
         WHERE id = $2
         RETURNING *`,
        [dataEsec, id]
      );
      if (r.rows.length === 0) return reply.status(404).send({ error: 'Sopralluogo non trovato' });
      return reply.send({ success: true, data: r.rows[0] });
    } catch (err) {
      fastify.log.error(err, 'PATCH sopralluoghi/:id/esegui failed');
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  // ======================================================================
  // PATCH /api/appuntamenti/sopralluoghi/:id/annulla
  // ======================================================================
  fastify.patch('/sopralluoghi/:id/annulla', async (request, reply) => {
    try {
      const { id } = request.params;
      const r = await query(
        `UPDATE sopralluoghi
           SET annullato = true, eseguito = false, data_modifica = NOW()
         WHERE id = $1 RETURNING *`,
        [id]
      );
      if (r.rows.length === 0) return reply.status(404).send({ error: 'Sopralluogo non trovato' });
      return reply.send({ success: true, data: r.rows[0] });
    } catch (err) {
      fastify.log.error(err, 'PATCH sopralluoghi/:id/annulla failed');
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  // ======================================================================
  // APERTURE — PUT / DELETE / PATCH esegui|annulla
  // ======================================================================
  fastify.put('/aperture/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      const b = request.body || {};
      const editable = ['data', 'eseguito', 'indirizzo', 'note', 'username'];
      const sets = [], params = [];
      editable.forEach(k => {
        if (b[k] !== undefined) { params.push(b[k]); sets.push(`${k} = $${params.length}`); }
      });
      if (!sets.length) return reply.send({ success: true, data: null, note: 'no fields to update' });
      params.push(id);
      const r = await query(
        `UPDATE apertura_bandi SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
        params
      );
      if (r.rows.length === 0) return reply.status(404).send({ error: 'Apertura non trovata' });
      return reply.send({ success: true, data: r.rows[0] });
    } catch (err) {
      fastify.log.error(err, 'PUT aperture/:id failed');
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  fastify.delete('/aperture/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      const r = await query(`DELETE FROM apertura_bandi WHERE id = $1 RETURNING id`, [id]);
      if (r.rows.length === 0) return reply.status(404).send({ error: 'Apertura non trovata' });
      return reply.send({ success: true, id: r.rows[0].id });
    } catch (err) {
      fastify.log.error(err, 'DELETE aperture/:id failed');
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  fastify.patch('/aperture/:id/esegui', async (request, reply) => {
    try {
      const { id } = request.params;
      const r = await query(
        `UPDATE apertura_bandi SET eseguito = true WHERE id = $1 RETURNING *`, [id]
      );
      if (r.rows.length === 0) return reply.status(404).send({ error: 'Apertura non trovata' });
      return reply.send({ success: true, data: r.rows[0] });
    } catch (err) {
      fastify.log.error(err, 'PATCH aperture/:id/esegui failed');
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  // Toggle bidirezionale eseguito (Togli/Rendi Eseguito del vecchio sito)
  fastify.patch('/aperture/:id/toggle-eseguito', async (request, reply) => {
    try {
      const { id } = request.params;
      const r = await query(
        `UPDATE apertura_bandi
            SET eseguito = NOT COALESCE(eseguito, false)
          WHERE id = $1
          RETURNING id, eseguito`,
        [id]
      );
      if (r.rows.length === 0) return reply.status(404).send({ error: 'Apertura non trovata' });
      return reply.send({ success: true, data: r.rows[0] });
    } catch (err) {
      fastify.log.error(err, 'PATCH aperture/:id/toggle-eseguito failed');
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  // ======================================================================
  // SCRITTURE — PUT / DELETE / PATCH esegui
  // ======================================================================
  fastify.put('/scritture/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      const b = request.body || {};
      const editable = [
        'prezzo', 'iva', 'bollettino', 'cauzione', 'eseguito',
        'stato_sopralluogo', 'stato_passoe', 'stato_avcp', 'stato_dare_cauzione',
        'bollettino_pagato', 'cauzione_versata', 'tipologia_spedizione',
        'note', 'username'
      ];
      const sets = [], params = [];
      editable.forEach(k => {
        if (b[k] !== undefined) { params.push(b[k]); sets.push(`${k} = $${params.length}`); }
      });
      if (!sets.length) return reply.send({ success: true, data: null, note: 'no fields to update' });
      params.push(id);
      const r = await query(
        `UPDATE scrittura_bandi SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
        params
      );
      if (r.rows.length === 0) return reply.status(404).send({ error: 'Scrittura non trovata' });
      return reply.send({ success: true, data: r.rows[0] });
    } catch (err) {
      fastify.log.error(err, 'PUT scritture/:id failed');
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  fastify.delete('/scritture/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      const r = await query(`DELETE FROM scrittura_bandi WHERE id = $1 RETURNING id`, [id]);
      if (r.rows.length === 0) return reply.status(404).send({ error: 'Scrittura non trovata' });
      return reply.send({ success: true, id: r.rows[0].id });
    } catch (err) {
      fastify.log.error(err, 'DELETE scritture/:id failed');
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  fastify.patch('/scritture/:id/esegui', async (request, reply) => {
    try {
      const { id } = request.params;
      const r = await query(
        `UPDATE scrittura_bandi SET eseguito = true WHERE id = $1 RETURNING *`, [id]
      );
      if (r.rows.length === 0) return reply.status(404).send({ error: 'Scrittura non trovata' });
      return reply.send({ success: true, data: r.rows[0] });
    } catch (err) {
      fastify.log.error(err, 'PATCH scritture/:id/esegui failed');
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  // Toggle bidirezionale eseguito (Togli/Rendi Eseguito del vecchio sito)
  fastify.patch('/scritture/:id/toggle-eseguito', async (request, reply) => {
    try {
      const { id } = request.params;
      const r = await query(
        `UPDATE scrittura_bandi
            SET eseguito = NOT COALESCE(eseguito, false)
          WHERE id = $1
          RETURNING id, eseguito`,
        [id]
      );
      if (r.rows.length === 0) return reply.status(404).send({ error: 'Scrittura non trovata' });
      return reply.send({ success: true, data: r.rows[0] });
    } catch (err) {
      fastify.log.error(err, 'PATCH scritture/:id/toggle-eseguito failed');
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  // Stato rapido: setta uno dei 4 campi-stato di scrittura_bandi.
  // I campi sono INTEGER nel DB. Mapping convenzione (replica del vecchio sito):
  //   stato_sopralluogo   : 0=DaPrenotare, 1=Prenotato,  2=Eseguito
  //   stato_dare_cauzione : 0=DaRichiedere,1=Richiesta,  2=Ricevuta
  //   stato_avcp          : 0=DaPagare,    1=Pagato,     2=NonRichiesto
  //   stato_passoe        : 0=DaGenerare,  1=Generato,   2=NonRichiesto
  // body: { campo, valore }   (valore null = reset a 0)
  fastify.patch('/scritture/:id/stato', async (request, reply) => {
    try {
      const { id } = request.params;
      const { campo, valore } = request.body || {};
      const allowedFields = ['stato_sopralluogo', 'stato_dare_cauzione', 'stato_avcp', 'stato_passoe'];
      if (!allowedFields.includes(campo)) {
        return reply.status(400).send({ error: 'Campo stato non valido', allowed: allowedFields });
      }
      // Il campo è INTEGER: accetto solo 0,1,2
      let intVal;
      if (valore === null || valore === '' || valore === undefined) {
        intVal = 0;
      } else {
        intVal = parseInt(valore, 10);
        if (Number.isNaN(intVal) || intVal < 0 || intVal > 2) {
          return reply.status(400).send({ error: 'Valore stato non valido per ' + campo + ' — attesi 0,1,2', ricevuto: valore });
        }
      }
      const r = await query(
        `UPDATE scrittura_bandi SET ${campo} = $1 WHERE id = $2 RETURNING id, ${campo} AS nuovo_valore`,
        [intVal, id]
      );
      if (r.rows.length === 0) return reply.status(404).send({ error: 'Scrittura non trovata' });
      return reply.send({ success: true, data: r.rows[0] });
    } catch (err) {
      fastify.log.error(err, 'PATCH scritture/:id/stato failed');
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  // ======================================================================
  // GET /api/appuntamenti/aperture
  // ======================================================================
  fastify.get('/aperture', async (request, reply) => {
    try {
      const q = request.query || {};
      const conds = [];
      const params = [];
      const add = (sql, val) => { params.push(val); conds.push(sql.replace('?', '$' + params.length)); };

      const di = toDate(q.data_inizio);
      const df = toDate(q.data_fine);
      if (di) add('ab.data >= ?', di);
      if (df) add('ab.data <= ?', df);

      const eseguito = parseTriState(q.eseguito);
      if (eseguito !== null) add('COALESCE(ab.eseguito,false) = ?', eseguito);

      if (q.id_bando)   add('ab.id_bando = ?', String(q.id_bando));
      if (q.id_azienda) add('ab.id_azienda = ?', parseInt(q.id_azienda));
      if (q.id_stazione) add('b.id_stazione = ?', parseInt(q.id_stazione));
      if (q.username)   add('LOWER(ab.username) = ?', String(q.username).toLowerCase());
      if (q.stazione_nome) add('LOWER(b.stazione_nome) LIKE ?', '%' + String(q.stazione_nome).toLowerCase() + '%');
      if (q.oggetto)    add('LOWER(b.titolo) LIKE ?', '%' + String(q.oggetto).toLowerCase() + '%');
      if (q.codice_cig) add('LOWER(b.codice_cig) LIKE ?', '%' + String(q.codice_cig).toLowerCase() + '%');

      const whereClause = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
      const limit = Math.min(parseInt(q.limit || '200'), 1000);

      const sql = `
        SELECT
          ab.id,
          ab.id_bando,
          ab.data,
          ab.indirizzo,
          ab.citta,
          ab.cap,
          ab.username,
          ab.eseguito,
          ab.note,
          b.titolo AS bando_titolo,
          b.codice_cig,
          b.importo_totale,
          b.importo_so,
          b.stazione_nome,
          b.citta AS bando_citta,
          az.ragione_sociale AS azienda_nome
        FROM apertura_bandi ab
        LEFT JOIN bandi b ON ab.id_bando = b.id
        LEFT JOIN aziende az ON ab.id_azienda = az.id
        ${whereClause}
        ORDER BY ab.data ASC NULLS LAST
        LIMIT ${limit}
      `;
      const r = await query(sql, params);
      return reply.send({ success: true, total: r.rows.length, data: r.rows });
    } catch (err) {
      fastify.log.error(err, 'appuntamenti/aperture failed');
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  // ======================================================================
  // GET /api/appuntamenti/scritture
  // ======================================================================
  fastify.get('/scritture', async (request, reply) => {
    try {
      const q = request.query || {};
      const conds = [];
      const params = [];
      const add = (sql, val) => { params.push(val); conds.push(sql.replace('?', '$' + params.length)); };

      const di = toDate(q.data_inizio);
      const df = toDate(q.data_fine);
      // Scritture non hanno una "data" propria: filtriamo sulla scadenza del bando
      if (di) add('b.data_offerta >= ?', di);
      if (df) add('b.data_offerta <= ?', df);

      const eseguito = parseTriState(q.eseguito);
      if (eseguito !== null) add('COALESCE(sb.eseguito,false) = ?', eseguito);

      if (q.id_bando)   add('sb.id_bando = ?', String(q.id_bando));
      if (q.id_azienda) add('sb.id_azienda = ?', parseInt(q.id_azienda));
      if (q.username)   add('LOWER(sb.username) = ?', String(q.username).toLowerCase());
      if (q.stazione_nome) add('LOWER(b.stazione_nome) LIKE ?', '%' + String(q.stazione_nome).toLowerCase() + '%');
      if (q.oggetto)    add('LOWER(b.titolo) LIKE ?', '%' + String(q.oggetto).toLowerCase() + '%');
      if (q.codice_cig) add('LOWER(b.codice_cig) LIKE ?', '%' + String(q.codice_cig).toLowerCase() + '%');

      const whereClause = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
      const limit = Math.min(parseInt(q.limit || '200'), 1000);

      const sql = `
        SELECT
          sb.id,
          sb.id_bando,
          sb.username,
          sb.eseguito,
          sb.bollettino,
          sb.bollettino_pagato,
          sb.cauzione,
          sb.cauzione_versata,
          sb.stato_sopralluogo,
          sb.stato_passoe,
          sb.stato_avcp,
          sb.note,
          b.titolo AS bando_titolo,
          b.codice_cig,
          b.data_offerta,
          b.importo_totale,
          b.importo_so,
          b.stazione_nome,
          b.citta AS bando_citta,
          az.ragione_sociale AS azienda_nome
        FROM scrittura_bandi sb
        LEFT JOIN bandi b ON sb.id_bando = b.id
        LEFT JOIN aziende az ON sb.id_azienda = az.id
        ${whereClause}
        ORDER BY b.data_offerta ASC NULLS LAST
        LIMIT ${limit}
      `;
      const r = await query(sql, params);
      return reply.send({ success: true, total: r.rows.length, data: r.rows });
    } catch (err) {
      fastify.log.error(err, 'appuntamenti/scritture failed');
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  // ======================================================================
  // GET /api/appuntamenti/calendario?mese=&anno=
  // Unified calendar aggregator — returns events from all 3 sources with
  // a uniform { id, tipo, titolo, data, stazione, azienda, cig } shape.
  // ======================================================================
  fastify.get('/calendario', async (request, reply) => {
    const mese = parseInt(request.query.mese || (new Date().getMonth() + 1));
    const anno = parseInt(request.query.anno || new Date().getFullYear());
    const di = new Date(Date.UTC(anno, mese - 1, 1));
    const df = new Date(Date.UTC(anno, mese, 0, 23, 59, 59));
    const errors = {};

    // Helper: check if a table exists (so we skip missing ones silently)
    const tableExists = async (name) => {
      try {
        const r = await query(
          "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1 LIMIT 1",
          [name]
        );
        return r.rows.length > 0;
      } catch(_) { return false; }
    };

    const safeRun = async (label, fn) => {
      try { return await fn(); }
      catch (e) {
        errors[label] = e.message;
        fastify.log.error({ err: e }, 'appuntamenti/calendario ' + label);
        return { rows: [] };
      }
    };

    // SOPRALLUOGHI
    // Un sopralluogo appena richiesto ha solo data_richiesta (non ancora schedulato).
    // Usiamo COALESCE per mostrarlo comunque sul calendario alla data della richiesta
    // finché un admin non imposta la data_sopralluogo definitiva.
    const sopr = (await tableExists('sopralluoghi'))
      ? await safeRun('sopralluoghi', () => query(
          `SELECT s.id, s.id_bando,
                  COALESCE(s.data_sopralluogo, s.data_richiesta) AS data,
                  s.data_sopralluogo, s.data_richiesta,
                  s.presa_visione, s.eseguito, s.annullato,
                  s.note AS note,
                  b.titolo AS bando_titolo, b.codice_cig,
                  staz.nome AS stazione_nome, staz.citta AS stazione_citta,
                  az.ragione_sociale AS azienda_nome
           FROM sopralluoghi s
           LEFT JOIN bandi b ON s.id_bando = b.id
           LEFT JOIN stazioni staz ON b.id_stazione = staz.id
           LEFT JOIN aziende az ON s.id_azienda = az.id
           WHERE COALESCE(s.data_sopralluogo, s.data_richiesta) BETWEEN $1 AND $2`,
          [di, df]
        ))
      : { rows: [] };

    // APERTURE
    const aper = (await tableExists('apertura_bandi'))
      ? await safeRun('aperture', () => query(
          `SELECT ab.id, ab.id_bando, ab.data, ab.eseguito,
                  ab.note AS note,
                  b.titolo AS bando_titolo, b.codice_cig,
                  staz.nome AS stazione_nome, staz.citta AS stazione_citta,
                  az.ragione_sociale AS azienda_nome,
                  pi.url AS piattaforma_url, pi.nome AS piattaforma_nome
           FROM apertura_bandi ab
           LEFT JOIN bandi b ON ab.id_bando = b.id
           LEFT JOIN stazioni staz ON b.id_stazione = staz.id
           LEFT JOIN aziende az ON ab.id_azienda = az.id
           LEFT JOIN piattaforme pi ON b.id_piattaforma = pi.id
           WHERE ab.data BETWEEN $1 AND $2`,
          [di, df]
        ))
      : { rows: [] };

    // SCRITTURE — usano la scadenza del bando come "data" sul calendario
    const scri = (await tableExists('scrittura_bandi'))
      ? await safeRun('scritture', () => query(
          `SELECT sb.id, sb.id_bando, b.data_offerta AS data, sb.eseguito,
                  sb.stato_sopralluogo, sb.stato_passoe, sb.stato_avcp, sb.stato_dare_cauzione,
                  sb.prezzo, sb.iva, sb.bollettino, sb.cauzione,
                  sb.note AS note,
                  b.titolo AS bando_titolo, b.codice_cig,
                  staz.nome AS stazione_nome, staz.citta AS stazione_citta,
                  az.ragione_sociale AS azienda_nome,
                  pi.url AS piattaforma_url, pi.nome AS piattaforma_nome
           FROM scrittura_bandi sb
           LEFT JOIN bandi b ON sb.id_bando = b.id
           LEFT JOIN stazioni staz ON b.id_stazione = staz.id
           LEFT JOIN aziende az ON sb.id_azienda = az.id
           LEFT JOIN piattaforme pi ON b.id_piattaforma = pi.id
           WHERE b.data_offerta BETWEEN $1 AND $2`,
          [di, df]
        ))
      : { rows: [] };

    const shape = (tipo, color) => (row) => ({
      id: row.id,
      tipo,
      color,
      data: row.data,
      data_richiesta: row.data_richiesta || null,
      bando_id: row.id_bando,
      titolo: row.bando_titolo || '—',
      codice_cig: row.codice_cig,
      stazione: row.stazione_nome,
      azienda: row.azienda_nome,
      citta: row.stazione_citta,
      note: row.note || null,
      eseguito: row.eseguito || false,
      annullato: row.annullato || false,
      presa_visione: row.presa_visione || false,
      // Campi extra scritture (undefined per sopralluoghi/aperture)
      piattaforma_url: row.piattaforma_url || null,
      piattaforma_nome: row.piattaforma_nome || null,
      stato_sopralluogo: row.stato_sopralluogo || null,
      stato_passoe: row.stato_passoe || null,
      stato_avcp: row.stato_avcp || null,
      stato_dare_cauzione: row.stato_dare_cauzione || null,
      prezzo: row.prezzo || null,
      iva: row.iva || null
    });

    const eventi = [
      ...sopr.rows.map(shape('sopralluogo', '#10b981')),
      ...aper.rows.map(shape('apertura',    '#f59e0b')),
      ...scri.rows.map(shape('scrittura',   '#3b82f6'))
    ].sort((a, b) => new Date(a.data) - new Date(b.data));

    return reply.send({
      success: true,
      mese, anno,
      totali: { sopralluoghi: sopr.rows.length, aperture: aper.rows.length, scritture: scri.rows.length },
      errors: Object.keys(errors).length ? errors : undefined,
      data: eventi
    });
  });

}
