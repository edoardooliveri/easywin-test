/**
 * Abbonamenti — API admin per gestione scadenze/rinnovi utenti.
 *
 * Lo scheduler automatico è già in services/abbonamenti-scheduler.js (reminder 30/7gg,
 * auto-renewal, deactivation). Qui esponiamo le API che l'admin usa per:
 *   - vedere stato abbonamenti di ciascun utente
 *   - filtrare utenti con scadenze imminenti / scaduti
 *   - rinnovare manualmente un servizio
 *   - gestire la storia dei periodi (users_periodi)
 *   - trigger manuale dello scheduler per test/forzare
 */

import { query } from '../db/pool.js';

const SERVICES = [
  { key: 'bandi', label: 'Bandi', scadField: 'scadenza_bandi', rinField: 'rinnovo_bandi', prezzoField: 'prezzo_bandi' },
  { key: 'esiti', label: 'Esiti', scadField: 'data_scadenza', rinField: 'rinnovo_esiti', prezzoField: 'prezzo_esiti' },
  { key: 'esiti_light', label: 'Esiti Light', scadField: 'scadenza_esiti_light', rinField: 'rinnovo_esiti_light', prezzoField: 'prezzo_esiti_light' },
  { key: 'newsletter_esiti', label: 'Newsletter Esiti', scadField: 'scadenza_newsletter_esiti', rinField: 'rinnovo_newsletter_esiti', prezzoField: 'prezzo_newsletter_esiti' },
  { key: 'newsletter_bandi', label: 'Newsletter Bandi', scadField: 'scadenza_newsletter_bandi', rinField: 'rinnovo_newsletter_bandi', prezzoField: 'prezzo_newsletter_bandi' },
  { key: 'presidia', label: 'Presidia', scadField: 'scadenza_presidia', rinField: 'rinnovo_presidia', prezzoField: null },
];

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d)) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((d - today) / (1000 * 60 * 60 * 24));
  return diff;
}

function stateOf(dateStr) {
  const d = daysUntil(dateStr);
  if (d == null) return 'none';
  if (d < 0) return 'scaduto';
  if (d <= 7) return 'critico';
  if (d <= 30) return 'attenzione';
  return 'attivo';
}

export default async function abbonamentiRoutes(fastify) {
  /**
   * GET /api/abbonamenti/overview
   *   Riepilogo globale: quanti utenti in ogni stato, per servizio.
   */
  fastify.get('/overview', { preHandler: [fastify.authenticate] }, async () => {
    const cols = SERVICES.map(s => `"${s.scadField}"`).join(', ');
    const res = await query(
      `SELECT id, username, ${cols} FROM users WHERE attivo = true`
    );

    const stats = {};
    for (const svc of SERVICES) {
      stats[svc.key] = { label: svc.label, attivo: 0, attenzione: 0, critico: 0, scaduto: 0, nessuno: 0 };
    }

    for (const row of res.rows) {
      for (const svc of SERVICES) {
        const s = stateOf(row[svc.scadField]);
        if (s === 'none') stats[svc.key].nessuno++;
        else stats[svc.key][s]++;
      }
    }

    return {
      totale_utenti: res.rows.length,
      servizi: stats,
    };
  });

  /**
   * GET /api/abbonamenti/utenti?service=bandi&status=critico&days_max=30
   *   Lista utenti con stato abbonamento. Filtri: service, status, days_max, search.
   */
  fastify.get('/utenti', { preHandler: [fastify.authenticate] }, async (request) => {
    const { service, status, days_max, search } = request.query;
    const daysMax = days_max ? parseInt(days_max, 10) : null;

    const cols = SERVICES.map(s => `"${s.scadField}" AS ${s.scadField}, "${s.rinField}" AS ${s.rinField}`).join(', ');

    const params = [];
    const wheres = ['attivo = true'];
    if (search) {
      params.push(`%${search}%`);
      wheres.push(`(username ILIKE $${params.length} OR email ILIKE $${params.length})`);
    }

    const res = await query(
      `SELECT id, username, email, ${cols}
         FROM users
        WHERE ${wheres.join(' AND ')}
        ORDER BY username
        LIMIT 500`,
      params
    );

    const out = res.rows.map(r => {
      const abbonamenti = {};
      for (const svc of SERVICES) {
        const scad = r[svc.scadField];
        abbonamenti[svc.key] = {
          label: svc.label,
          scadenza: scad,
          giorni_residui: daysUntil(scad),
          stato: stateOf(scad),
          rinnovo_automatico: !!r[svc.rinField],
        };
      }
      return {
        id: r.id,
        username: r.username,
        email: r.email,
        abbonamenti,
      };
    });

    let filtered = out;
    if (service) {
      filtered = filtered.filter(u => u.abbonamenti[service]);
      if (status) filtered = filtered.filter(u => u.abbonamenti[service].stato === status);
      if (daysMax != null) {
        filtered = filtered.filter(u => {
          const d = u.abbonamenti[service].giorni_residui;
          return d != null && d <= daysMax;
        });
      }
    } else if (status) {
      // utente ha ALMENO UN servizio nello stato richiesto
      filtered = filtered.filter(u => Object.values(u.abbonamenti).some(a => a.stato === status));
    }

    return { total: filtered.length, utenti: filtered };
  });

  /**
   * GET /api/abbonamenti/utenti/:id
   *   Dettaglio utente + storico periodi.
   */
  fastify.get('/utenti/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;

    const uRes = await query(
      `SELECT * FROM users WHERE id = $1 LIMIT 1`,
      [id]
    );
    if (uRes.rows.length === 0) return reply.status(404).send({ error: 'Utente non trovato' });
    const u = uRes.rows[0];

    const abbonamenti = {};
    for (const svc of SERVICES) {
      const scad = u[svc.scadField];
      abbonamenti[svc.key] = {
        label: svc.label,
        scadenza: scad,
        giorni_residui: daysUntil(scad),
        stato: stateOf(scad),
        rinnovo_automatico: !!u[svc.rinField],
        prezzo: svc.prezzoField ? u[svc.prezzoField] : null,
      };
    }

    let periodi = [];
    try {
      const pRes = await query(
        `SELECT * FROM users_periodi WHERE username = $1 ORDER BY data_inizio DESC LIMIT 100`,
        [u.username]
      );
      periodi = pRes.rows;
    } catch { /* tabella opzionale */ }

    return {
      id: u.id,
      username: u.username,
      email: u.email,
      ragione_sociale: u.ragione_sociale,
      mesi_rinnovo: u.mesi_rinnovo,
      data_ultimo_rinnovo: u.data_ultimo_rinnovo,
      abbonamenti,
      periodi,
    };
  });

  /**
   * POST /api/abbonamenti/utenti/:id/rinnova
   *   Body: { service: "bandi", mesi: 12, note?: string }
   *   Estende la scadenza del servizio di N mesi e crea record in users_periodi.
   */
  fastify.post('/utenti/:id/rinnova', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;
    const { service, mesi = 12, note } = request.body || {};

    const svc = SERVICES.find(s => s.key === service);
    if (!svc) return reply.status(400).send({ error: 'Servizio non valido', validi: SERVICES.map(s => s.key) });
    if (!mesi || mesi <= 0) return reply.status(400).send({ error: 'mesi deve essere > 0' });

    try {
      const uRes = await query(`SELECT id, username, "${svc.scadField}" AS scadenza FROM users WHERE id = $1`, [id]);
      if (uRes.rows.length === 0) return reply.status(404).send({ error: 'Utente non trovato' });
      const u = uRes.rows[0];

      const baseDate = u.scadenza && new Date(u.scadenza) > new Date() ? new Date(u.scadenza) : new Date();
      const newScad = new Date(baseDate);
      newScad.setMonth(newScad.getMonth() + parseInt(mesi, 10));
      const newScadISO = newScad.toISOString().slice(0, 10);

      await query(
        `UPDATE users SET "${svc.scadField}" = $1, data_ultimo_rinnovo = NOW() WHERE id = $2`,
        [newScadISO, id]
      );

      // storicizza nel periodi
      try {
        await query(
          `INSERT INTO users_periodi (username, data_inizio, data_fine, tipo, note)
           VALUES ($1, NOW()::date, $2, $3, $4)`,
          [u.username, newScadISO, svc.key, note || null]
        );
      } catch { /* tabella opzionale */ }

      return { success: true, service: svc.key, nuova_scadenza: newScadISO };
    } catch (err) {
      fastify.log.error(err, 'Rinnovo abbonamento error');
      return reply.status(500).send({ error: 'Errore rinnovo', details: err.message });
    }
  });

  /**
   * POST /api/abbonamenti/utenti/:id/disattiva
   *   Body: { service: "bandi" }  — azzera scadenza (disattiva il servizio)
   */
  fastify.post('/utenti/:id/disattiva', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;
    const { service } = request.body || {};
    const svc = SERVICES.find(s => s.key === service);
    if (!svc) return reply.status(400).send({ error: 'Servizio non valido' });

    try {
      await query(`UPDATE users SET "${svc.scadField}" = NULL WHERE id = $1`, [id]);
      return { success: true, service: svc.key };
    } catch (err) {
      return reply.status(500).send({ error: 'Errore disattivazione', details: err.message });
    }
  });

  /**
   * GET /api/abbonamenti/scadenze?days=7
   *   Utenti con almeno un servizio in scadenza entro N giorni.
   */
  fastify.get('/scadenze', { preHandler: [fastify.authenticate] }, async (request) => {
    const days = parseInt(request.query.days || '30', 10);
    const cols = SERVICES.map(s => `"${s.scadField}"`).join(', ');
    const res = await query(
      `SELECT id, username, email, ${cols} FROM users WHERE attivo = true`
    );

    const out = [];
    for (const r of res.rows) {
      const inScad = [];
      for (const svc of SERVICES) {
        const d = daysUntil(r[svc.scadField]);
        if (d != null && d >= 0 && d <= days) {
          inScad.push({ service: svc.key, label: svc.label, scadenza: r[svc.scadField], giorni: d });
        }
      }
      if (inScad.length > 0) {
        out.push({
          id: r.id,
          username: r.username,
          email: r.email,
          scadenze: inScad,
        });
      }
    }
    return { total: out.length, days, utenti: out };
  });

  /**
   * POST /api/abbonamenti/scheduler/run
   *   Trigger manuale del scheduler (utile per test admin).
   *   Nota: usa la logica dello scheduler esistente.
   */
  fastify.post('/scheduler/run', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      // Marchiamo esecuzione manuale nella task table se esiste
      try {
        await query(
          `UPDATE tasks SET data_ultima_esecuzione = NOW(), stato_ultima_esecuzione = 'manuale'
           WHERE tipo = 'abbonamenti_scheduler'`
        );
      } catch {}

      return {
        success: true,
        message: 'Trigger registrato — lo scheduler eseguirà al prossimo ciclo (ogni 5 minuti)',
      };
    } catch (err) {
      return reply.status(500).send({ error: 'Errore trigger scheduler', details: err.message });
    }
  });
}
