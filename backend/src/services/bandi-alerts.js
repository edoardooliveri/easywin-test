/**
 * EasyWin Bandi Alerts Service
 *
 * Sends email alerts for:
 * 1. Apertura Buste (3 days and 1 day before)
 * 2. Sopralluoghi (3 days and 1 day before)
 * 3. Esiti pubblicati (same day)
 *
 * Uses user newsletter preferences and filter rules for matching.
 */

import { query } from '../db/pool.js';
import { send as mailSend } from '../lib/mail-transport.js';
import { emailLayout, sectionTitle, infoRow, alertBox, ctaButton, spacer } from './email-templates.js';

const FRONTEND_URL = process.env.FRONTEND_URL || 'https://easywin.it';

/**
 * Format importo as currency
 */
function formatImporto(val) {
  if (!val) return '-';
  const num = parseFloat(val);
  if (isNaN(num)) return '-';
  return num.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' });
}

/**
 * Format date as DD/MM/YYYY
 */
function formatDate(d) {
  if (!d) return '-';
  const date = new Date(d);
  return date.toLocaleDateString('it-IT');
}

/**
 * Find users whose filters match the given bando
 */
async function findMatchingUsers(bando) {
  try {
    // Get bando's provinces
    const bandoProvRes = await query(
      `SELECT id_provincia FROM bandi_province WHERE id_bando = $1`,
      [bando.id]
    );
    const bandoProvinces = bandoProvRes.rows.map(r => r.id_provincia);

    // Get importo
    const importo = parseFloat(bando.importo_so) || parseFloat(bando.importo_co) || 0;

    // Get all users with active newsletter preference
    const usersRes = await query(`
      SELECT DISTINCT u.id, u.email, u.username
      FROM users u
      WHERE u.attivo = true
        AND u.newsletter_bandi = true
        AND u.email IS NOT NULL
      ORDER BY u.id
    `);

    const matchedUsers = [];

    for (const user of usersRes.rows) {
      // Get user's filter rules
      const filtersRes = await query(`
        SELECT * FROM utenti_filtri_bandi
        WHERE id_utente = $1 AND attivo = true
      `, [user.id]);

      // Check if bando matches any of user's rules
      let matches = false;

      for (const filter of filtersRes.rows) {
        // Check province match (if filter specifies provinces)
        if (filter.province_ids && filter.province_ids.length > 0) {
          const filterProvinces = Array.isArray(filter.province_ids)
            ? filter.province_ids
            : JSON.parse(filter.province_ids || '[]');
          const hasProvMatch = filterProvinces.some(p => bandoProvinces.includes(p));
          if (!hasProvMatch) continue;
        }

        // Check importo range
        if (filter.importo_min && importo < parseFloat(filter.importo_min)) continue;
        if (filter.importo_max && importo > parseFloat(filter.importo_max)) continue;

        // Check SOA code
        if (filter.id_soa && bando.id_soa !== filter.id_soa) continue;

        // Filter matched
        matches = true;
        break;
      }

      if (matches) {
        matchedUsers.push(user);
      }
    }

    return matchedUsers;
  } catch (err) {
    console.error('Error finding matching users:', err);
    return [];
  }
}

/**
 * Build apertura/sopralluoghi alert email
 */
function buildAlertEmail(bando, alertType, daysUntil) {
  const titolo = bando.titolo || bando.Titolo || 'N/D';
  const stazione = bando.stazione_nome || 'N/D';
  const cig = bando.codice_cig || bando.CodiceCIG || 'N/D';
  const importo = formatImporto(bando.importo_so || bando.importo_co);

  let alertTitle = '';
  let alertDate = '';
  let alertColor = 'info';

  if (alertType === 'apertura') {
    alertTitle = `Apertura buste tra ${daysUntil} ${daysUntil === 1 ? 'giorno' : 'giorni'}`;
    alertDate = formatDate(bando.data_apertura);
    alertColor = daysUntil === 1 ? 'warning' : 'info';
  } else if (alertType === 'sopralluogo') {
    alertTitle = `Sopralluogo tra ${daysUntil} ${daysUntil === 1 ? 'giorno' : 'giorni'}`;
    alertDate = formatDate(bando.data_sop_start);
    alertColor = daysUntil === 1 ? 'warning' : 'info';
  }

  const bandoUrl = `${FRONTEND_URL}/bandi/${bando.id}`;

  let html = emailLayout(`
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      ${sectionTitle('Avviso importante')}
      ${alertBox(alertTitle, alertColor)}
      ${spacer(16)}
      ${infoRow('Gara', titolo)}
      ${infoRow('Stazione', stazione)}
      ${infoRow('CIG', cig)}
      ${infoRow('Importo', importo)}
      ${infoRow('Data ' + (alertType === 'apertura' ? 'apertura' : 'sopralluogo'), alertDate)}
      ${spacer(16)}
      ${alertBox('Accedi alla tua area riservata per consultare i dettagli completi della gara', 'info')}
      ${spacer(16)}
      ${ctaButton('Visualizza la gara', bandoUrl)}
    </table>
  `, {
    preheader: alertTitle,
    showUnsubscribe: true,
    unsubscribeUrl: `${FRONTEND_URL}/account/newsletter`
  });

  return {
    subject: `EasyWin - ${alertTitle}`,
    html
  };
}

/**
 * Build esiti alert email
 */
function buildEsitiAlertEmail(gara) {
  const titolo = gara.titolo || gara.Titolo || 'N/D';
  const stazione = gara.stazione_nome || 'N/D';
  const cig = gara.codice_cig || gara.CodiceCIG || 'N/D';
  const importo = formatImporto(gara.importo);
  const data = formatDate(gara.created_at);

  const garaUrl = `${FRONTEND_URL}/esiti/${gara.id}`;

  let html = emailLayout(`
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      ${sectionTitle('Nuovo esito pubblicato')}
      ${alertBox('Un nuovo esito di gara è stato pubblicato', 'success')}
      ${spacer(16)}
      ${infoRow('Gara', titolo)}
      ${infoRow('Stazione', stazione)}
      ${infoRow('CIG', cig)}
      ${infoRow('Importo', importo)}
      ${infoRow('Data pubblicazione', data)}
      ${spacer(16)}
      ${ctaButton('Visualizza l\'esito', garaUrl)}
    </table>
  `, {
    preheader: `Nuovo esito: ${titolo}`,
    showUnsubscribe: true,
    unsubscribeUrl: `${FRONTEND_URL}/account/newsletter`
  });

  return {
    subject: `EasyWin - Nuovo esito pubblicato`,
    html
  };
}

/**
 * Send alert email to user via unified mail-transport
 */
async function sendAlertEmail(user, email, channel, meta = {}) {
  try {
    const result = await mailSend({
      to: user.email,
      subject: email.subject,
      html: email.html,
      channel,
      meta: { user_id: user.id, ...meta }
    });

    console.log(`🔔 Alert inviato a ${user.email} - ${email.subject} (${result.status})`);
    return { status: result.status === 'failed' ? 'failed' : 'sent', error: result.error };
  } catch (err) {
    console.error(`🔔 Errore invio alert a ${user.email}:`, err.message);
    return { status: 'failed', error: err.message };
  }
}

/**
 * Run apertura buste alerts
 * Remind users about bandi apertura buste in 3 days or 1 day
 */
export async function runAperturaAlerts() {
  console.log('🔔 Inizio runAperturaAlerts');
  const stats = { sent: 0, failed: 0, skipped: 0, details: [] };

  try {
    // Find bandi with apertura in 3 days or 1 day
    const bandRes = await query(`
      SELECT b.id, b.titolo, b.codice_cig, b.importo_so, b.importo_co,
             b.data_apertura, b.stazione_nome, b.id_soa
      FROM bandi b
      WHERE (b.data_apertura::date = CURRENT_DATE + INTERVAL '3 days'
         OR b.data_apertura::date = CURRENT_DATE + INTERVAL '1 day')
        AND COALESCE(b.privato, 0) = 0
        AND COALESCE(b.annullato, false) = false
      ORDER BY b.data_apertura ASC
    `);

    const bandi = bandRes.rows;
    console.log(`🔔 Trovati ${bandi.length} bandi con apertura tra 1-3 giorni`);

    for (const bando of bandi) {
      const daysUntil = bando.data_apertura.getTime() > new Date().getTime() + 2 * 24 * 60 * 60 * 1000 ? 3 : 1;
      const matchedUsers = await findMatchingUsers(bando);

      console.log(`🔔 Bando ${bando.id}: ${matchedUsers.length} utenti corrispondono ai filtri`);

      for (const user of matchedUsers) {
        const emailData = buildAlertEmail(bando, 'apertura', daysUntil);
        const result = await sendAlertEmail(user, emailData, 'alert_apertura', { bando_id: bando.id });

        if (result.status === 'sent') {
          stats.sent++;
        } else if (result.status === 'failed') {
          stats.failed++;
        } else {
          stats.skipped++;
        }

        stats.details.push({
          bando_id: bando.id,
          user_id: user.id,
          user_email: user.email,
          status: result.status,
          error: result.error
        });
      }
    }
  } catch (err) {
    console.error('🔔 Errore in runAperturaAlerts:', err);
  }

  console.log(`🔔 Fine runAperturaAlerts: ${stats.sent} inviati, ${stats.failed} falliti, ${stats.skipped} skipped`);
  return stats;
}

/**
 * Run sopralluoghi alerts
 * Remind users about sopralluoghi in 3 days or 1 day
 */
export async function runSopralluoghiAlerts() {
  console.log('🔔 Inizio runSopralluoghiAlerts');
  const stats = { sent: 0, failed: 0, skipped: 0, details: [] };

  try {
    // Find bandi with sopralluogo in 3 days or 1 day
    const bandRes = await query(`
      SELECT b.id, b.titolo, b.codice_cig, b.importo_so, b.importo_co,
             b.data_sop_start, b.stazione_nome, b.id_soa
      FROM bandi b
      WHERE (b.data_sop_start::date = CURRENT_DATE + INTERVAL '3 days'
         OR b.data_sop_start::date = CURRENT_DATE + INTERVAL '1 day')
        AND COALESCE(b.privato, 0) = 0
        AND COALESCE(b.annullato, false) = false
      ORDER BY b.data_sop_start ASC
    `);

    const bandi = bandRes.rows;
    console.log(`🔔 Trovati ${bandi.length} bandi con sopralluogo tra 1-3 giorni`);

    for (const bando of bandi) {
      const daysUntil = bando.data_sop_start.getTime() > new Date().getTime() + 2 * 24 * 60 * 60 * 1000 ? 3 : 1;
      const matchedUsers = await findMatchingUsers(bando);

      console.log(`🔔 Bando ${bando.id}: ${matchedUsers.length} utenti corrispondono ai filtri`);

      for (const user of matchedUsers) {
        const emailData = buildAlertEmail(bando, 'sopralluogo', daysUntil);
        const result = await sendAlertEmail(user, emailData, 'alert_sopralluogo', { bando_id: bando.id });

        if (result.status === 'sent') {
          stats.sent++;
        } else if (result.status === 'failed') {
          stats.failed++;
        } else {
          stats.skipped++;
        }

        stats.details.push({
          bando_id: bando.id,
          user_id: user.id,
          user_email: user.email,
          status: result.status,
          error: result.error
        });
      }
    }
  } catch (err) {
    console.error('🔔 Errore in runSopralluoghiAlerts:', err);
  }

  console.log(`🔔 Fine runSopralluoghiAlerts: ${stats.sent} inviati, ${stats.failed} falliti, ${stats.skipped} skipped`);
  return stats;
}

/**
 * Run esiti alerts
 * Notify users about new esiti published today
 */
export async function runEsitiAlerts() {
  console.log('🔔 Inizio runEsitiAlerts');
  const stats = { sent: 0, failed: 0, skipped: 0, details: [] };

  try {
    // Find gare with esiti published today
    const gareRes = await query(`
      SELECT g.id, g.titolo, g.codice_cig, g.importo,
             g.stazione_nome, g.created_at
      FROM gare g
      WHERE g.enabled = true
        AND g.created_at::date = CURRENT_DATE
      ORDER BY g.created_at DESC
    `);

    const gare = gareRes.rows;
    console.log(`🔔 Trovati ${gare.length} esiti pubblicati oggi`);

    // Get all users with newsletter_esiti enabled
    const usersRes = await query(`
      SELECT id, email, username
      FROM users
      WHERE attivo = true
        AND newsletter_esiti = true
        AND email IS NOT NULL
      ORDER BY id
    `);

    const users = usersRes.rows;

    for (const gara of gare) {
      console.log(`🔔 Esito ${gara.id}: inviando a ${users.length} utenti`);

      for (const user of users) {
        const emailData = buildEsitiAlertEmail(gara);
        const result = await sendAlertEmail(user, emailData, 'alert_esiti_pubblicazione', { gara_id: gara.id });

        if (result.status === 'sent') {
          stats.sent++;
        } else if (result.status === 'failed') {
          stats.failed++;
        } else {
          stats.skipped++;
        }

        stats.details.push({
          gara_id: gara.id,
          user_id: user.id,
          user_email: user.email,
          status: result.status,
          error: result.error
        });
      }
    }
  } catch (err) {
    console.error('🔔 Errore in runEsitiAlerts:', err);
  }

  console.log(`🔔 Fine runEsitiAlerts: ${stats.sent} inviati, ${stats.failed} falliti, ${stats.skipped} skipped`);
  return stats;
}

/**
 * Run all alerts
 * Returns combined statistics
 */
export async function runAllAlerts() {
  console.log('🔔 Inizio runAllAlerts (apertura + sopralluoghi + esiti)');
  const startTime = Date.now();

  const results = {
    apertura: await runAperturaAlerts(),
    sopralluoghi: await runSopralluoghiAlerts(),
    esiti: await runEsitiAlerts(),
    totalTime: Date.now() - startTime
  };

  const totalSent = results.apertura.sent + results.sopralluoghi.sent + results.esiti.sent;
  const totalFailed = results.apertura.failed + results.sopralluoghi.failed + results.esiti.failed;
  const totalSkipped = results.apertura.skipped + results.sopralluoghi.skipped + results.esiti.skipped;

  console.log(`🔔 Fine runAllAlerts: ${totalSent} totali inviati, ${totalFailed} falliti, ${totalSkipped} skipped (${results.totalTime}ms)`);

  return {
    apertura: results.apertura,
    sopralluoghi: results.sopralluoghi,
    esiti: results.esiti,
    summary: {
      sent: totalSent,
      failed: totalFailed,
      skipped: totalSkipped,
      totalTime: results.totalTime
    }
  };
}
