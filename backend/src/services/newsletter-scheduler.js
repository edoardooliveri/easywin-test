/**
 * Newsletter Scheduler
 *
 * Esegue l'invio automatico delle newsletter personalizzate.
 * - Bandi: ogni giorno alle 4:00
 * - Esiti: ogni giorno alle 4:00
 *
 * Ogni utente riceve solo i bandi/esiti che matchano i suoi filtri
 * (tabella utenti_filtri_bandi). Utenti senza filtri ricevono tutto.
 *
 * L'invio usa l'endpoint POST /api/admin/newsletter/auto internamente.
 */

import { query } from '../db/pool.js';
import { runAllAlerts } from './bandi-alerts.js';
import { canRunToday, markTaskRun } from '../lib/scheduler-helpers.js';

let _schedulerInterval = null;

/**
 * Avvia lo scheduler.
 * Controlla ogni 5 minuti se è ora di inviare le newsletter.
 * Invio previsto: ore 4:00 locali del server.
 */
export function startNewsletterScheduler(fastify) {
  const SEND_HOUR = parseInt(process.env.NEWSLETTER_SEND_HOUR || '4');
  const SEND_MINUTE = parseInt(process.env.NEWSLETTER_SEND_MINUTE || '30');
  const CHECK_INTERVAL = 5 * 60 * 1000; // 5 minuti

  console.log(`📧 Newsletter scheduler avviato — invio previsto alle ${String(SEND_HOUR).padStart(2,'0')}:${String(SEND_MINUTE).padStart(2,'0')}`);

  _schedulerInterval = setInterval(async () => {
    const now = new Date();

    // È l'ora giusta?
    if (now.getHours() < SEND_HOUR) return;
    if (now.getHours() === SEND_HOUR && now.getMinutes() < SEND_MINUTE) return;

    // DB-backed idempotency: già eseguito oggi con successo?
    const canRun = await canRunToday('newsletter_auto', SEND_HOUR);
    if (!canRun) return;

    // Controlla se ci sono task newsletter_auto attivi nel DB
    try {
      const taskCheck = await query(
        `SELECT id FROM tasks WHERE tipo = 'newsletter_auto' AND attivo = true LIMIT 1`
      );
      if (taskCheck.rows.length === 0) {
        // Nessun task attivo, controlla env
        if (process.env.NEWSLETTER_AUTO !== 'true') return;
      }
    } catch (err) {
      // Se la tabella tasks non esiste, controlla solo l'env
      if (process.env.NEWSLETTER_AUTO !== 'true') return;
    }

    // Esegui invio
    console.log(`📧 [${now.toISOString()}] Avvio invio automatico newsletter...`);

    try {
      // Usa fastify.inject per chiamare l'endpoint /api/admin/newsletter/auto
      // con un token admin interno
      const result = await fastify.inject({
        method: 'POST',
        url: '/api/admin/newsletter/auto',
        payload: { tipo: 'both' },
        headers: {
          'content-type': 'application/json',
          // Genera un token admin interno per l'autenticazione
          authorization: `Bearer ${await generateInternalToken(fastify)}`
        }
      });

      const data = JSON.parse(result.body);
      console.log(`📧 Newsletter auto completata:`, data.message || JSON.stringify(data));

      // Esegui anche gli alert bandi (apertura buste, sopralluoghi, esiti)
      try {
        const alertStats = await runAllAlerts();
        console.log(`🔔 Alert bandi completati:`, alertStats.summary);
      } catch (alertErr) {
        console.error(`🔔 Errore alert bandi:`, alertErr.message);
      }

      // Aggiorna task status nel DB (idempotent)
      await markTaskRun('newsletter_auto', 'successo', data.message || 'OK', getNextRunDate(SEND_HOUR, SEND_MINUTE).toISOString());

    } catch (err) {
      console.error(`📧 Errore invio automatico newsletter:`, err.message);
      await markTaskRun('newsletter_auto', 'errore', err.message, null);
    }
  }, CHECK_INTERVAL);

  return _schedulerInterval;
}

/**
 * Ferma lo scheduler
 */
export function stopNewsletterScheduler() {
  if (_schedulerInterval) {
    clearInterval(_schedulerInterval);
    _schedulerInterval = null;
    console.log('📧 Newsletter scheduler fermato');
  }
}

/**
 * Genera un JWT admin interno per le chiamate automatiche
 */
async function generateInternalToken(fastify) {
  // Cerca un admin nel DB
  try {
    const adminRes = await query(
      `SELECT username FROM users WHERE ruolo = 'admin' AND attivo = true LIMIT 1`
    );
    if (adminRes.rows.length > 0) {
      return fastify.jwt.sign({
        username: adminRes.rows[0].username,
        is_admin: true,
        _internal: true
      }, { expiresIn: '5m' });
    }
  } catch (e) { /* fallthrough */ }

  // Fallback: token system
  return fastify.jwt.sign({
    username: 'system',
    is_admin: true,
    _internal: true
  }, { expiresIn: '5m' });
}

/**
 * Calcola la prossima data di esecuzione
 */
function getNextRunDate(hour, minute) {
  const next = new Date();
  next.setDate(next.getDate() + 1);
  next.setHours(hour, minute, 0, 0);
  return next;
}
