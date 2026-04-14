import { send as mailSend } from '../lib/mail-transport.js';

/**
 * Send esito notification to all participating companies
 */
export async function sendEsitoNotifications(garaId, options = {}) {
  const { query } = await import('../db/pool.js');

  // Get gara details
  const garaRes = await query(`
    SELECT g."id", g."Titolo", g."CodiceCIG", g."Data", g."Importo",
           g."NPartecipanti", g."Ribasso", g."MediaAr", g."SogliaAn",
           s."Nome" AS stazione_nome,
           soa."Descrizione" AS soa_categoria
    FROM gare g
    LEFT JOIN stazioni s ON g."id_stazione" = s."id"
    LEFT JOIN soa ON g."id_soa" = soa."id"
    WHERE g."id" = $1
  `, [garaId]);

  if (garaRes.rows.length === 0) throw new Error('Gara non trovata');
  const gara = garaRes.rows[0];

  // Get all participants with their company emails
  const partecipantiRes = await query(`
    SELECT dg."Posizione", dg."Ribasso", dg."Vincitrice", dg."Anomala", dg."Esclusa",
           dg."RagioneSociale" AS rs_fallback,
           a."id" AS id_azienda, a."RagioneSociale", a."Email", a."PartitaIva"
    FROM dettagliogara dg
    LEFT JOIN aziende a ON dg."id_azienda" = a."id"
    WHERE dg."id_gara" = $1
    ORDER BY dg."Posizione" ASC
  `, [garaId]);

  const results = { sent: 0, failed: 0, skipped: 0, details: [] };

  for (const p of partecipantiRes.rows) {
    const email = p.Email;
    const nome = p.RagioneSociale || p.rs_fallback || 'Gentile Partecipante';

    if (!email) {
      results.skipped++;
      results.details.push({ azienda: nome, status: 'skipped', reason: 'Email mancante' });
      continue;
    }

    // Build email
    const isWinner = p.Vincitrice === true;
    const isExcluded = p.Esclusa === true;
    const isAnomala = p.Anomala === true;

    const subject = `EasyWin - Esito Gara: ${gara.Titolo?.substring(0, 80) || 'Comunicazione Esito'}`;

    let htmlBody = `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">`;
    htmlBody += `<div style="background: #333; padding: 20px; text-align: center;">`;
    htmlBody += `<h1 style="color: #F5C518; font-family: 'Brush Script MT', cursive; margin: 0;">EasyWin</h1>`;
    htmlBody += `</div>`;
    htmlBody += `<div style="padding: 24px; background: #fff;">`;
    htmlBody += `<p>Gentile <strong>${nome}</strong>,</p>`;
    htmlBody += `<p>La informiamo che è stato pubblicato l'esito della seguente gara:</p>`;
    htmlBody += `<table style="width: 100%; border-collapse: collapse; margin: 16px 0;">`;
    htmlBody += `<tr><td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold;">Oggetto</td><td style="padding: 8px; border-bottom: 1px solid #eee;">${gara.Titolo || '-'}</td></tr>`;
    htmlBody += `<tr><td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold;">Stazione Appaltante</td><td style="padding: 8px; border-bottom: 1px solid #eee;">${gara.stazione_nome || '-'}</td></tr>`;
    htmlBody += `<tr><td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold;">CIG</td><td style="padding: 8px; border-bottom: 1px solid #eee;">${gara.CodiceCIG || '-'}</td></tr>`;
    htmlBody += `<tr><td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold;">Importo</td><td style="padding: 8px; border-bottom: 1px solid #eee;">${gara.Importo ? Number(gara.Importo).toLocaleString('it-IT', {minimumFractionDigits: 2}) + ' €' : '-'}</td></tr>`;
    htmlBody += `<tr><td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold;">Partecipanti</td><td style="padding: 8px; border-bottom: 1px solid #eee;">${gara.NPartecipanti || '-'}</td></tr>`;
    htmlBody += `<tr><td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold;">La Sua offerta</td><td style="padding: 8px; border-bottom: 1px solid #eee;">Ribasso: ${p.Ribasso ? Number(p.Ribasso).toFixed(3) + '%' : '-'} - Posizione: ${p.Posizione || '-'}</td></tr>`;
    htmlBody += `</table>`;

    if (isWinner) {
      htmlBody += `<div style="background: #e8f5e9; padding: 16px; border-radius: 4px; border-left: 4px solid #27ae60; margin: 16px 0;">`;
      htmlBody += `<strong style="color: #27ae60;">CONGRATULAZIONI!</strong> La Sua offerta risulta VINCITRICE di questa gara.`;
      htmlBody += `</div>`;
    } else if (isExcluded) {
      htmlBody += `<div style="background: #fde8e8; padding: 16px; border-radius: 4px; border-left: 4px solid #e74c3c; margin: 16px 0;">`;
      htmlBody += `La Sua offerta è stata ESCLUSA dalla gara.`;
      htmlBody += `</div>`;
    } else if (isAnomala) {
      htmlBody += `<div style="background: #fff8e1; padding: 16px; border-radius: 4px; border-left: 4px solid #f39c12; margin: 16px 0;">`;
      htmlBody += `La Sua offerta è risultata ANOMALA (sopra la soglia di anomalia: ${gara.SogliaAn ? Number(gara.SogliaAn).toFixed(3) + '%' : '-'}).`;
      htmlBody += `</div>`;
    }

    htmlBody += `<p style="margin-top: 20px; color: #666; font-size: 12px;">Questa comunicazione è stata inviata automaticamente dal sistema EasyWin. Per maggiori dettagli, acceda alla sua area riservata.</p>`;
    htmlBody += `</div>`;
    htmlBody += `<div style="background: #f5f5f5; padding: 12px; text-align: center; font-size: 11px; color: #999;">`;
    htmlBody += `Edra Servizi s.r.l. - Genova | EasyWin Platform`;
    htmlBody += `</div></div>`;

    try {
      const result = await mailSend({
        to: email,
        subject,
        html: htmlBody,
        channel: 'civetta_esito',
        meta: { gara_id: garaId, id_azienda: p.id_azienda }
      });
      if (result.status === 'sent' || result.status === 'dry_run') {
        results.sent++;
        results.details.push({ azienda: nome, email, status: 'sent' });
      } else {
        results.failed++;
        results.details.push({ azienda: nome, email, status: 'failed', error: result.error });
      }
    } catch (err) {
      results.failed++;
      results.details.push({ azienda: nome, email, status: 'failed', error: err.message });
    }
  }

  return results;
}

/**
 * Send custom email. Callers should pass options.channel for mail_log categorization.
 */
export async function sendEmail(to, subject, htmlBody, options = {}) {
  const { channel = 'generic', ...mailOpts } = options;

  try {
    const result = await mailSend({
      to,
      subject,
      html: htmlBody,
      channel,
      meta: {}
    });
    return { status: result.status === 'failed' ? 'failed' : 'sent', error: result.error };
  } catch (err) {
    return { status: 'failed', error: err.message };
  }
}
