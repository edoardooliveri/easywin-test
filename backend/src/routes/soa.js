/**
 * SOA module — porting diretto del vecchio /Abbonamenti/Soa/Index
 *
 * Il vecchio sito mostrava una lista di categorie SOA raggruppate per
 * Tipologia (Lavori / Specialistiche) con codice + descrizione.
 *
 * Nel nuovo gestionale aggiungiamo anche CRUD completo perché
 * l'admin deve poter gestire catalogo, abilitazione e gruppi.
 */

import { query } from '../db/pool.js';

export default async function soaRoutes(fastify) {
  // Raggruppa le tipologie in macro-gruppi leggibili
  const mapTipoGruppo = (tipo) => {
    const t = (tipo || '').toUpperCase();
    if (t === 'OG') return 'Lavori';
    if (t === 'OS') return 'Specialistiche';
    return tipo || 'Altro';
  };

  /**
   * GET /api/soa
   *   - ?grouped=1 → restituisce { Lavori: [...], Specialistiche: [...] }
   *   - altrimenti → array flat ordinato per tipo/codice
   */
  fastify.get('/', async (request) => {
    const grouped = String(request.query.grouped || '') === '1';
    const res = await query(
      `SELECT id, codice, descrizione, tipo, attivo, created_at
         FROM soa
        ORDER BY tipo, codice`
    );

    const rows = res.rows.map(r => ({
      id: r.id,
      codice: (r.codice || '').trim(),
      descrizione: (r.descrizione || '').trim(),
      tipo: r.tipo,
      gruppo: mapTipoGruppo(r.tipo),
      attivo: r.attivo,
      fullName: `${(r.codice || '').trim()} - ${(r.descrizione || '').trim()}`,
    }));

    if (!grouped) return rows;

    // Raggruppamento identico al vecchio .cshtml (Lavori / Specialistiche)
    const out = {};
    for (const r of rows) {
      const g = r.gruppo;
      if (!out[g]) out[g] = [];
      out[g].push(r);
    }
    return out;
  });

  /** GET /api/soa/:id */
  fastify.get('/:id', async (request, reply) => {
    const { id } = request.params;
    const res = await query(
      'SELECT id, codice, descrizione, tipo, attivo, created_at FROM soa WHERE id = $1',
      [id]
    );
    if (res.rows.length === 0) {
      return reply.status(404).send({ error: 'SOA non trovata' });
    }
    const r = res.rows[0];
    return {
      id: r.id,
      codice: (r.codice || '').trim(),
      descrizione: (r.descrizione || '').trim(),
      tipo: r.tipo,
      gruppo: mapTipoGruppo(r.tipo),
      attivo: r.attivo,
      created_at: r.created_at,
    };
  });

  /** POST /api/soa — crea nuova categoria SOA (admin) */
  fastify.post('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { codice, descrizione, tipo, attivo = true } = request.body || {};
    if (!codice || !descrizione || !tipo) {
      return reply.status(400).send({ error: 'codice, descrizione, tipo obbligatori' });
    }
    try {
      const res = await query(
        `INSERT INTO soa (codice, descrizione, tipo, attivo)
         VALUES ($1, $2, $3, $4)
         RETURNING id, codice, descrizione, tipo, attivo, created_at`,
        [String(codice).trim().toUpperCase(), String(descrizione).trim(), String(tipo).trim().toUpperCase(), !!attivo]
      );
      return res.rows[0];
    } catch (err) {
      if (err.code === '23505') {
        return reply.status(409).send({ error: 'Codice SOA già esistente' });
      }
      fastify.log.error(err, 'Create SOA failed');
      return reply.status(500).send({ error: 'Errore creazione SOA', details: err.message });
    }
  });

  /** PUT /api/soa/:id */
  fastify.put('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;
    const { codice, descrizione, tipo, attivo } = request.body || {};
    try {
      const existing = await query('SELECT id FROM soa WHERE id = $1', [id]);
      if (existing.rows.length === 0) {
        return reply.status(404).send({ error: 'SOA non trovata' });
      }
      const res = await query(
        `UPDATE soa
            SET codice      = COALESCE($2, codice),
                descrizione = COALESCE($3, descrizione),
                tipo        = COALESCE($4, tipo),
                attivo      = COALESCE($5, attivo)
          WHERE id = $1
         RETURNING id, codice, descrizione, tipo, attivo, created_at`,
        [
          id,
          codice != null ? String(codice).trim().toUpperCase() : null,
          descrizione != null ? String(descrizione).trim() : null,
          tipo != null ? String(tipo).trim().toUpperCase() : null,
          attivo != null ? !!attivo : null,
        ]
      );
      return res.rows[0];
    } catch (err) {
      if (err.code === '23505') {
        return reply.status(409).send({ error: 'Codice SOA già esistente' });
      }
      fastify.log.error(err, 'Update SOA failed');
      return reply.status(500).send({ error: 'Errore aggiornamento SOA', details: err.message });
    }
  });

  /** DELETE /api/soa/:id — soft delete (attivo=false) */
  fastify.delete('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;
    try {
      const res = await query(
        'UPDATE soa SET attivo = FALSE WHERE id = $1 RETURNING id',
        [id]
      );
      if (res.rows.length === 0) {
        return reply.status(404).send({ error: 'SOA non trovata' });
      }
      return { success: true, id: res.rows[0].id };
    } catch (err) {
      fastify.log.error(err, 'Delete SOA failed');
      return reply.status(500).send({ error: 'Errore disattivazione SOA', details: err.message });
    }
  });

  /**
   * GET /api/soa/:id/usage
   *   Quante entità usano questa SOA (bandi, gare, utenti).
   *   Utile prima di eliminare/disattivare.
   */
  fastify.get('/:id/usage', async (request) => {
    const { id } = request.params;
    const [bandi, gare, utenti] = await Promise.all([
      query('SELECT COUNT(*)::int AS n FROM bandi WHERE id_soa = $1', [id]).catch(() => ({ rows: [{ n: 0 }] })),
      query('SELECT COUNT(*)::int AS n FROM gare WHERE id_soa = $1', [id]).catch(() => ({ rows: [{ n: 0 }] })),
      query('SELECT COUNT(*)::int AS n FROM users_soa WHERE id_soa = $1', [id]).catch(() => ({ rows: [{ n: 0 }] })),
    ]);
    return {
      id: parseInt(id, 10),
      bandi: bandi.rows[0].n,
      gare: gare.rows[0].n,
      utenti: utenti.rows[0].n,
    };
  });
}
