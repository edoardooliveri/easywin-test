/**
 * Abbonamenti Scheduler
 *
 * Gestisce i rinnovi e le scadenze degli abbonamenti:
 * 1. Reminder emails — 30 giorni e 7 giorni prima della scadenza
 * 2. Auto-renewal — Rinnova automaticamente gli abbonamenti scaduti se rinnovo_automatico=true
 * 3. Deactivation — Disattiva newsletter se rinnovo_automatico=false e TUTTI gli abbonamenti sono scaduti
 *
 * Esecuzione: ogni giorno alle 6:00 (dopo la newsletter alle 4:00)
 * Controlla ogni 5 minuti se è l'ora giusta.
 */

import { query } from '../db/pool.js';
import { send as mailSend } from '../lib/mail-transport.js';
import { canRunToday, markTaskRun } from '../lib/scheduler-helpers.js';
import { emailLayout, sectionTitle, infoRow, alertBox, ctaButton } from './email-templates.js';

const SERVICES = [
  { key: 'bandi', label: 'Bandi', scadField: 'scadenza_bandi', rinField: 'rinnovo_bandi' },
  { key: 'esiti', label: 'Esiti', scadField: 'data_scadenza', rinField: 'rinnovo_esiti' },
  { key: 'esiti_light', label: 'Esiti Light', scadField: 'scadenza_esiti_light', rinField: 'rinnovo_esiti_light' },
  { key: 'newsletter_esiti', label: 'Newsletter Esiti', scadField: 'scadenza_newsletter_esiti', rinField: 'rinnovo_newsletter_esiti' },
  { key: 'newsletter_bandi', label: 'Newsletter Bandi', scadField: 'scadenza_newsletter_bandi', rinField: 'rinnovo_newsletter_bandi' },
  { key: 'presidia', label: 'Presidia', scadField: 'scadenza_presidia', rinField: 'rinnovo_presidia' },
];

let _schedulerInterval = null;

/**
 * Avvia lo scheduler abbonamenti.
 * Controlla ogni 5 minuti se è ora di eseguire i task.
 * Esecuzione prevista: ore 6:00 locali del server.
 */
export function startAbbonamentoScheduler(fastify) {
  const SEND_HOUR = parseInt(process.env.ABBONAMENTI_SEND_HOUR || '6');
  const SEND_MINUTE = parseInt(process.env.ABBONAMENTI_SEND_MINUTE || '0');
  const CHECK_INTERVAL = 5 * 60 * 1000; // 5 minuti

  console.log(`📋 Abbonamenti scheduler avviato — esecuzione prevista alle ${String(SEND_HOUR).padStart(2,'0')}:${String(SEND_MINUTE).padStart(2,'0')}`);

  _schedulerInterval = setInterval(async () => {
    const now = new Date();

    // È l'ora giusta?
    if (now.getHours() < SEND_HOUR) return;
    if (now.getHours() === SEND_HOUR && now.getMinutes() < SEND_MINUTE) return;

    // DB-backed idempotency: già eseguito oggi con successo?
    const canRun = await canRunToday('abbonamenti_scheduler', SEND_HOUR);
    if (!canRun) return;

    // Controlla se il task è attivo
    try {
      const taskCheck = await query(
        `SELECT id FROM tasks WHERE tipo = 'abbonamenti_scheduler' AND attivo = true LIMIT 1`
      );
      if (taskCheck.rows.length === 0) {
        if (process.env.ABBONAMENTI_SCHEDULER !== 'true') return;
      }
    } catch (err) {
      if (process.env.ABBONAMENTI_SCHEDULER !== 'true') return;
    }

    // Esegui scheduler
    console.log(`📋 [${now.toISOString()}] Avvio scheduler abbonamenti...`);

    try {
      let stats = {
        reminders_sent: 0,
        renewed: 0,
        deactivated: 0,
      };

      // 1. Reminder emails
      const reminders = await sendReminderEmails(now);
      stats.reminders_sent = reminders;

      // 2. Auto-renewal
      const renewed = await processAutoRenewal(now);
      stats.renewed = renewed;

      // 3. Deactivation
      const deactivated = await processDeactivation(now);
      stats.deactivated = deactivated;

      console.log(`📋 Scheduler completato:`, stats);

      // Aggiorna task status (idempotent)
      await markTaskRun('abbonamenti_scheduler', 'successo', JSON.stringify(stats), getNextRunDate(SEND_HOUR, SEND_MINUTE).toISOString());

    } catch (err) {
      console.error(`📋 Errore scheduler abbonamenti:`, err.message);
      await markTaskRun('abbonamenti_scheduler', 'errore', err.message, null);
    }
  }, CHECK_INTERVAL);

  return _schedulerInterval;
}

/**
 * Ferma lo scheduler
 */
export function stopAbbonamentoScheduler() {
  if (_schedulerInterval) {
    clearInterval(_schedulerInterval);
    _schedulerInterval = null;
    console.log('📋 Abbonamenti scheduler fermato');
  }
}

/**
 * 1. Invia email di reminder per scadenze a 30 e 7 giorni
 */
async function sendReminderEmails(now) {
  let count = 0;

  try {
    const users = await query(
      `SELECT id, username, email, agente FROM users WHERE attivo = true`
    );

    const today = now.toISOString().split('T')[0];
    const day30 = addDays(now, 30).toISOString().split('T')[0];
    const day7 = addDays(now, 7).toISOString().split('T')[0];

    for (const user of users.rows) {
      const reminderServices = [];

      // Controlla ogni servizio
      for (const svc of SERVICES) {
        const scadField = svc.scadField;
        const scadenza = user[scadField]?.toISOString?.().split('T')[0] || null;

        if (scadenza === day30 || scadenza === day7) {
          const daysLeft = scadenza === day30 ? 30 : 7;
          reminderServices.push({
            service: svc.label,
            scadenza,
            daysLeft,
          });
        }
      }

      if (reminderServices.length === 0) continue;

      // Invia reminder
      const sent = await sendReminderEmail(user, reminderServices);
      if (sent) count++;
    }

    console.log(`📋 Email di reminder inviate: ${count}`);
  } catch (err) {
    console.error(`📋 Errore invio reminder:`, err.message);
  }

  return count;
}

/**
 * Invia email di reminder a client + agent + admin
 */
async function sendReminderEmail(user, services) {
  try {
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@easywin.it';

    // Ricerca agent email
    let agentEmail = null;
    if (user.agente) {
      try {
        const agentRes = await query(
          `SELECT email FROM users WHERE id = $1 LIMIT 1`,
          [user.agente]
        );
        if (agentRes.rows.length > 0) {
          agentEmail = agentRes.rows[0].email;
        }
      } catch (e) { /* ignore */ }
    }

    const ccRecipients = [];
    if (agentEmail && agentEmail !== user.email) ccRecipients.push(agentEmail);
    if (adminEmail && adminEmail !== user.email && !ccRecipients.includes(adminEmail)) ccRecipients.push(adminEmail);

    const servicesList = services
      .map(s => `${s.service}: scade tra ${s.daysLeft} giorni (${s.scadenza})`)
      .join(', ');

    const html = emailLayout(
      sectionTitle('Avviso Scadenza Abbonamento', `Utente: ${user.username}`) +
      alertBox(
        `Uno o più abbonamenti scadranno a breve:<br/><strong>${servicesList}</strong>`,
        'warning'
      ) +
      infoRow('Utente', user.username) +
      infoRow('Email', user.email) +
      ctaButton('Visualizza Abbonamenti', `${process.env.SITE_URL || 'https://easywin.it'}/dashboard/abbonamenti`, 'gold') +
      `<p style="color:#666; font-size:12px; margin-top:20px;">Ricevi questo avviso perché il tuo abbonamento sta per scadere.</p>`,
      { subject: `Avviso Scadenza Abbonamento - ${user.username}` }
    );

    const minDays = Math.min(...services.map(s => s.daysLeft));
    const channel = minDays <= 7 ? 'reminder_scadenza_7' : 'reminder_scadenza_30';

    await mailSend({
      to: user.email,
      cc: ccRecipients.length > 0 ? ccRecipients : undefined,
      subject: `[EasyWin] Avviso Scadenza Abbonamento - ${user.username}`,
      html,
      channel,
      meta: { user_id: user.id, services: services.map(s => s.service) }
    });

    console.log(`📋 Reminder email inviata: ${user.email} (cc: ${ccRecipients.length} destinatari)`);
    return true;
  } catch (err) {
    console.error(`📋 Errore invio reminder per utente ${user.id}:`, err.message);
    return false;
  }
}

/**
 * 2. Auto-renewal — Rinnova automaticamente gli abbonamenti scaduti
 */
async function processAutoRenewal(now) {
  let count = 0;

  try {
    const users = await query(
      `SELECT id, username, email, mesi_rinnovo FROM users WHERE attivo = true`
    );

    const today = now.toISOString().split('T')[0];
    const renewMonths = 12; // default

    for (const user of users.rows) {
      let shouldRenew = false;
      const updateFields = [];

      // Controlla ogni servizio
      for (const svc of SERVICES) {
        const scadField = svc.scadField;
        const rinField = svc.rinField;
        const scadenza = user[scadField]?.toISOString?.().split('T')[0] || null;
        const rinnovo = user[rinField];

        // Se rinnovo_automatico=true AND scadenza < oggi
        if (rinnovo && scadenza && scadenza < today) {
          shouldRenew = true;
          const newScadenza = addMonths(new Date(scadenza), renewMonths || user.mesi_rinnovo || 12);
          updateFields.push({
            field: scadField,
            date: newScadenza,
            service: svc.label,
          });
        }
      }

      if (updateFields.length === 0) continue;

      // Esegui renewal
      const renewed = await renewUserSubscriptions(user.id, updateFields);
      if (renewed) count++;
    }

    console.log(`📋 Abbonamenti rinnovati: ${count}`);
  } catch (err) {
    console.error(`📋 Errore auto-renewal:`, err.message);
  }

  return count;
}

/**
 * Rinnova gli abbonamenti di un utente
 */
async function renewUserSubscriptions(userId, updateFields) {
  try {
    // Costruisce le UPDATE dinamicamente
    const setClauses = updateFields.map((f, i) => `${f.field} = $${i + 2}`).join(', ');
    const values = [userId, ...updateFields.map(f => f.date)];

    await query(
      `UPDATE users SET ${setClauses}, data_ultimo_rinnovo = NOW() WHERE id = $1`,
      values
    );

    const services = updateFields.map(f => f.service).join(', ');
    console.log(`📋 Rinnovato: utente ${userId} - servizi: ${services}`);
    return true;
  } catch (err) {
    console.error(`📋 Errore renewal per utente ${userId}:`, err.message);
    return false;
  }
}

/**
 * 3. Deactivation — Disattiva newsletter se rinnovo_automatico=false E TUTTI gli abbonamenti sono scaduti
 */
async function processDeactivation(now) {
  let count = 0;

  try {
    const users = await query(
      `SELECT id, username, email FROM users WHERE attivo = true`
    );

    const today = now.toISOString().split('T')[0];

    for (const user of users.rows) {
      let allExpired = true;
      let hasAnyService = false;

      // Controlla ogni servizio
      for (const svc of SERVICES) {
        const scadField = svc.scadField;
        const scadenza = user[scadField]?.toISOString?.().split('T')[0] || null;

        if (scadenza) {
          hasAnyService = true;
          if (scadenza >= today) {
            allExpired = false;
            break;
          }
        }
      }

      // Se almeno un servizio è attivo e rinnovo_automatico=false, disattiva newsletter
      if (hasAnyService && allExpired) {
        const deactivated = await deactivateUserNewsletter(user.id);
        if (deactivated) count++;
      }
    }

    console.log(`📋 Newsletter disattivate: ${count}`);
  } catch (err) {
    console.error(`📋 Errore deactivation:`, err.message);
  }

  return count;
}

/**
 * Disattiva le newsletter di un utente
 */
async function deactivateUserNewsletter(userId) {
  try {
    await query(
      `UPDATE users SET
        newsletter_bandi = false,
        newsletter_esiti = false,
        newsletter_esiti_light = false,
        data_ultima_modifica = NOW()
       WHERE id = $1`,
      [userId]
    );

    console.log(`📋 Disattivate newsletter: utente ${userId}`);
    return true;
  } catch (err) {
    console.error(`📋 Errore disattivazione per utente ${userId}:`, err.message);
    return false;
  }
}

/**
 * Utility: aggiungi giorni a una data
 */
function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * Utility: aggiungi mesi a una data
 */
function addMonths(date, months) {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
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
