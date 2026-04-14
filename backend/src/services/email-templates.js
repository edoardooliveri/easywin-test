/**
 * EasyWin Email Template System
 *
 * Unified dark-theme email templates with:
 * - EasyWin logo
 * - Comfortaa font (Google Fonts with fallbacks)
 * - Dark background (#0F1923) with gold (#F5C518) accents
 * - High contrast, modern design
 * - Responsive table-based layout for email client compatibility
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Resolve paths relative to project root
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');

// Load logo as base64 data URI for reliable rendering in all email clients
let LOGO_URL = process.env.LOGO_URL || 'https://easywin.it/assets/logo.png';
try {
  const logoPath = path.join(PROJECT_ROOT, 'logo.png');
  if (fs.existsSync(logoPath)) {
    const logoBuffer = fs.readFileSync(logoPath);
    LOGO_URL = `data:image/png;base64,${logoBuffer.toString('base64')}`;
  }
} catch (e) {
  // Fallback to URL if file read fails
}

const HERO_BG_URL = process.env.HERO_BG_URL || 'https://www.easywin.it/application/themes/easywin/images/gare-di-appalto-italia.jpg';
const SITE_URL = process.env.FRONTEND_URL || 'https://easywin.it';

// Brand colors
const C = {
  bg: '#0F1923',
  dark: '#1E2D3D',
  darkAlt: '#253748',
  gold: '#F5C518',
  goldDark: '#D4A812',
  orange: '#FF8C00',
  white: '#FFFFFF',
  lightGray: '#B8C4CE',
  midGray: '#6B7C8D',
  green: '#2ecc71',
  red: '#e74c3c',
  redBg: 'rgba(231,76,60,0.15)',
  greenBg: 'rgba(46,204,113,0.15)',
  orangeBg: 'rgba(255,140,0,0.15)',
  goldBg: 'rgba(245,197,24,0.08)',
};

/**
 * Wraps content in the standard EasyWin email layout
 */
export function emailLayout(content, options = {}) {
  const {
    preheader = '',
    showUnsubscribe = false,
    unsubscribeUrl = '#',
    footerExtra = ''
  } = options;

  return `<!DOCTYPE html>
<html lang="it" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>EasyWin</title>
  <!--[if mso]><style>*{font-family:Arial,sans-serif!important;}</style><![endif]-->
  <link href="https://fonts.googleapis.com/css2?family=Comfortaa:wght@400;600;700&display=swap" rel="stylesheet">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Comfortaa:wght@400;600;700&display=swap');
    body,table,td,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}
    table,td{mso-table-lspace:0;mso-table-rspace:0}
    img{-ms-interpolation-mode:bicubic;border:0;outline:none;text-decoration:none}
    body{margin:0;padding:0;width:100%!important;background-color:${C.bg}}
    .comfortaa{font-family:'Comfortaa',Verdana,Geneva,sans-serif}
    .body-text{font-family:'Segoe UI',Helvetica,Arial,sans-serif;color:${C.lightGray};font-size:14px;line-height:1.6}
  </style>
</head>
<body style="margin:0;padding:0;background-color:${C.bg};">
  ${preheader ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${preheader}</div>` : ''}

  <!-- OUTER WRAPPER -->
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${C.bg};">
    <tr><td align="center" style="padding:20px 12px;">

      <!-- MAIN CONTAINER -->
      <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;border-radius:12px;overflow:hidden;border:1px solid ${C.darkAlt};">

        <!-- HEADER WITH HERO BG + LOGO -->
        <tr>
          <td style="background-image:url('${HERO_BG_URL}');background-size:cover;background-position:center top;background-color:${C.dark};">
            <!--[if gte mso 9]>
            <v:rect xmlns:v="urn:schemas-microsoft-com:vml" fill="true" stroke="false" style="width:640px;height:180px;">
            <v:fill type="frame" src="${HERO_BG_URL}" color="${C.dark}"/>
            <v:textbox inset="0,0,0,0"><![endif]-->
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr><td style="background:linear-gradient(180deg,rgba(15,25,35,0.55) 0%,rgba(15,25,35,0.75) 50%,rgba(15,25,35,0.92) 100%);padding:40px 32px 36px;text-align:center;">
                <img src="${LOGO_URL}" alt="easyWin" width="180" height="98" style="display:block;margin:0 auto;max-width:180px;height:auto;filter:drop-shadow(0 4px 12px rgba(0,0,0,0.5));">
              </td></tr>
            </table>
            <!--[if gte mso 9]></v:textbox></v:rect><![endif]-->
          </td>
        </tr>
        <tr><td style="background:linear-gradient(90deg,${C.gold} 0%,${C.orange} 100%);height:3px;font-size:0;line-height:0;">&nbsp;</td></tr>

        <!-- CONTENT -->
        ${content}

        <!-- FOOTER -->
        <tr>
          <td style="background:${C.dark};padding:24px 32px;border-top:1px solid ${C.darkAlt};">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="font-family:'Comfortaa',Verdana,sans-serif;font-size:11px;color:${C.midGray};text-align:center;line-height:1.8;">
                  ${footerExtra ? `<p style="margin:0 0 12px;">${footerExtra}</p>` : ''}
                  <p style="margin:0;">Edra Servizi s.r.l. &mdash; Genova</p>
                  <p style="margin:4px 0 0;">
                    <a href="${SITE_URL}" style="color:${C.gold};text-decoration:none;font-weight:600;">easywin.it</a>
                  </p>
                  ${showUnsubscribe ? `
                  <p style="margin:12px 0 0;padding-top:12px;border-top:1px solid ${C.darkAlt};">
                    <a href="${unsubscribeUrl}" style="color:${C.midGray};text-decoration:underline;font-size:10px;">Disiscriviti dalla newsletter</a>
                  </p>` : ''}
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>

    </td></tr>
  </table>
</body>
</html>`;
}

/**
 * Gold accent bar (thin decorative element)
 */
export function goldBar() {
  return `<tr><td style="background:${C.gold};height:2px;font-size:0;line-height:0;">&nbsp;</td></tr>`;
}

/**
 * Section title row
 */
export function sectionTitle(title, subtitle = '') {
  return `<tr>
    <td style="background:${C.bg};padding:28px 32px 16px;">
      <h2 style="font-family:'Comfortaa',Verdana,sans-serif;color:${C.gold};font-size:18px;font-weight:700;margin:0;letter-spacing:0.5px;">${title}</h2>
      ${subtitle ? `<p style="font-family:'Segoe UI',Arial,sans-serif;color:${C.midGray};font-size:13px;margin:6px 0 0;">${subtitle}</p>` : ''}
    </td>
  </tr>`;
}

/**
 * Info row with label/value pairs
 */
export function infoRow(label, value) {
  return `<tr>
    <td style="padding:0 32px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-bottom:1px solid ${C.darkAlt};">
        <tr>
          <td width="40%" style="padding:10px 0;font-family:'Comfortaa',Verdana,sans-serif;font-size:11px;color:${C.midGray};text-transform:uppercase;letter-spacing:0.8px;font-weight:600;">${label}</td>
          <td width="60%" style="padding:10px 0;font-family:'Segoe UI',Arial,sans-serif;font-size:14px;color:${C.white};font-weight:500;text-align:right;">${value}</td>
        </tr>
      </table>
    </td>
  </tr>`;
}

/**
 * Stat card (for grids of 2-4 KPI boxes)
 */
export function statCard(label, value, accent = false) {
  const bg = accent ? `${C.gold}` : `${C.darkAlt}`;
  const textColor = accent ? '#1a1a1a' : C.gold;
  const labelColor = accent ? 'rgba(0,0,0,0.6)' : C.midGray;
  return `<td style="width:25%;padding:6px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${bg};border-radius:8px;${accent ? '' : `border:1px solid rgba(245,197,24,0.15);`}">
      <tr><td style="padding:14px 8px;text-align:center;">
        <div style="font-family:'Comfortaa',Verdana,sans-serif;font-size:10px;color:${labelColor};text-transform:uppercase;letter-spacing:0.5px;font-weight:600;margin-bottom:6px;">${label}</div>
        <div style="font-family:'Comfortaa',Verdana,sans-serif;font-size:18px;color:${textColor};font-weight:700;">${value}</div>
      </td></tr>
    </table>
  </td>`;
}

/**
 * CTA button
 */
export function ctaButton(text, url, style = 'gold') {
  const bg = style === 'gold' ? C.gold : style === 'orange' ? C.orange : C.dark;
  const color = style === 'gold' ? '#1a1a1a' : C.white;
  return `<tr>
    <td style="padding:20px 32px;text-align:center;">
      <a href="${url}" style="display:inline-block;background:${bg};color:${color};font-family:'Comfortaa',Verdana,sans-serif;font-size:14px;font-weight:700;padding:14px 36px;border-radius:8px;text-decoration:none;letter-spacing:0.5px;">${text}</a>
    </td>
  </tr>`;
}

/**
 * Alert/highlight box
 */
export function alertBox(text, type = 'info') {
  const colors = {
    success: { bg: C.greenBg, border: C.green, text: C.green },
    error: { bg: C.redBg, border: C.red, text: C.red },
    warning: { bg: C.orangeBg, border: C.orange, text: C.orange },
    info: { bg: C.goldBg, border: C.gold, text: C.gold },
  };
  const c = colors[type] || colors.info;
  return `<tr>
    <td style="padding:8px 32px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${c.bg};border-radius:8px;border-left:4px solid ${c.border};">
        <tr><td style="padding:16px 20px;font-family:'Segoe UI',Arial,sans-serif;font-size:14px;color:${c.text};line-height:1.5;">${text}</td></tr>
      </table>
    </td>
  </tr>`;
}

/**
 * Text paragraph
 */
export function textBlock(html, options = {}) {
  const { padding = '12px 32px', size = '14px', color = C.lightGray } = options;
  return `<tr>
    <td style="padding:${padding};font-family:'Segoe UI',Arial,sans-serif;font-size:${size};color:${color};line-height:1.6;">${html}</td>
  </tr>`;
}

/**
 * Spacer
 */
export function spacer(height = 16) {
  return `<tr><td style="height:${height}px;font-size:0;line-height:0;">&nbsp;</td></tr>`;
}

/**
 * Region header for newsletter
 */
export function regionHeader(name) {
  return `<tr>
    <td style="padding:20px 32px 8px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="background:linear-gradient(90deg,${C.gold} 0%,${C.orange} 100%);padding:10px 16px;border-radius:6px;">
            <span style="font-family:'Comfortaa',Verdana,sans-serif;font-size:13px;font-weight:700;color:#1a1a1a;letter-spacing:1px;text-transform:uppercase;">${name}</span>
          </td>
        </tr>
      </table>
    </td>
  </tr>`;
}

/**
 * Newsletter bando/esito item card
 */
export function newsletterItem(item, type = 'bandi') {
  const isEsiti = type === 'esiti';
  const titolo = item.Titolo || item.titolo || 'N/D';
  const stazione = item.stazione_nome || item.stazione || 'N/D';
  const provincia = item.Provincia || item.provincia || '';
  const cig = item.CodiceCIG || item.cig || 'N/D';
  const soa = item.soa_categoria || item.soa || '';
  const importoRaw = item.Importo || item.importo;
  const importo = typeof importoRaw === 'number' ? importoRaw.toLocaleString('it-IT', {minimumFractionDigits: 2}) : (importoRaw || '0');
  const scadenza = item.scadenza || item.Data || item.data || 'N/D';
  const vincitore = item.vincitrice_nome || item.vincitore || 'N/D';
  const ribasso = item.Ribasso || item.ribasso || '0';
  return `<tr>
    <td style="padding:6px 32px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.dark};border-radius:8px;border:1px solid ${C.darkAlt};">
        <tr><td style="padding:16px 18px;">
          <div style="font-family:'Comfortaa',Verdana,sans-serif;font-size:13px;font-weight:600;color:${C.white};margin-bottom:8px;line-height:1.4;">${titolo}</div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-family:'Segoe UI',Arial,sans-serif;font-size:11px;color:${C.midGray};line-height:1.8;">
            <tr><td width="50%">Stazione: <span style="color:${C.lightGray};">${stazione}</span></td>
                <td width="50%">Provincia: <span style="color:${C.lightGray};">${provincia || 'N/D'}</span></td></tr>
            <tr><td>CIG: <span style="color:${C.gold};font-weight:600;">${cig}</span></td>
                <td>SOA: <span style="color:${C.lightGray};">${soa || 'N/D'}</span></td></tr>
            <tr><td>Importo: <span style="color:${C.gold};font-weight:600;">&euro;${importo}</span></td>
                <td>${isEsiti ? `Vincitore: <span style="color:${C.green};font-weight:600;">${vincitore}</span>` : `Scadenza: <span style="color:${C.lightGray};">${scadenza}</span>`}</td></tr>
            ${isEsiti ? `<tr><td colspan="2">Ribasso: <span style="color:${C.orange};font-weight:600;">${ribasso}%</span></td></tr>` : ''}
          </table>
        </td></tr>
      </table>
    </td>
  </tr>`;
}

/**
 * Graduatoria table (full or partial)
 */
export function graduatoriaTable(graduatoria, currentPosition = null, isFull = true) {
  let rows = '';

  graduatoria.forEach((row) => {
    const risultato = row.Vincitrice ? 'VINCITRICE' : row.Esclusa ? 'ESCLUSA' : row.Anomala ? 'ANOMALA' : 'AMMESSA';
    const ribasso = row.Ribasso ? Number(row.Ribasso).toFixed(5) + '%' : '-';
    const isCurrent = row.Posizione === currentPosition;

    let bgColor = C.dark;
    let risultatoColor = C.lightGray;
    if (row.Vincitrice) { bgColor = 'rgba(46,204,113,0.12)'; risultatoColor = C.green; }
    else if (row.Esclusa) { bgColor = 'rgba(150,150,150,0.12)'; risultatoColor = '#999'; }
    else if (row.Anomala) { bgColor = 'rgba(231,76,60,0.12)'; risultatoColor = C.red; }

    if (isCurrent) bgColor = 'rgba(245,197,24,0.12)';

    rows += `<tr style="background:${bgColor};${isCurrent ? `border-left:3px solid ${C.gold};` : ''}">
      <td style="padding:10px 12px;font-family:'Comfortaa',Verdana,sans-serif;font-size:13px;color:${isCurrent ? C.gold : C.white};font-weight:${isCurrent ? '700' : '400'};border-bottom:1px solid ${C.darkAlt};text-align:center;width:40px;">${row.Posizione}</td>
      <td style="padding:10px 12px;font-family:'Segoe UI',Arial,sans-serif;font-size:13px;color:${isCurrent ? C.gold : C.white};font-weight:${isCurrent ? '600' : '400'};border-bottom:1px solid ${C.darkAlt};">${row.azienda_rs || row.RagioneSociale || ''}</td>
      <td style="padding:10px 12px;font-family:'Segoe UI',Arial,sans-serif;font-size:13px;color:${isCurrent ? C.gold : C.white};border-bottom:1px solid ${C.darkAlt};text-align:right;">${ribasso}</td>
      <td style="padding:10px 12px;font-family:'Comfortaa',Verdana,sans-serif;font-size:11px;color:${risultatoColor};font-weight:700;border-bottom:1px solid ${C.darkAlt};text-align:center;letter-spacing:0.5px;">${risultato}</td>
    </tr>`;
  });

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-radius:8px;overflow:hidden;border:1px solid ${C.darkAlt};">
    <thead>
      <tr style="background:${C.darkAlt};">
        <th style="padding:12px;font-family:'Comfortaa',Verdana,sans-serif;font-size:10px;color:${C.gold};text-transform:uppercase;letter-spacing:1px;font-weight:700;border-bottom:2px solid ${C.gold};text-align:center;width:40px;">N&deg;</th>
        <th style="padding:12px;font-family:'Comfortaa',Verdana,sans-serif;font-size:10px;color:${C.gold};text-transform:uppercase;letter-spacing:1px;font-weight:700;border-bottom:2px solid ${C.gold};text-align:left;">Ragione Sociale</th>
        <th style="padding:12px;font-family:'Comfortaa',Verdana,sans-serif;font-size:10px;color:${C.gold};text-transform:uppercase;letter-spacing:1px;font-weight:700;border-bottom:2px solid ${C.gold};text-align:right;">Ribasso</th>
        <th style="padding:12px;font-family:'Comfortaa',Verdana,sans-serif;font-size:10px;color:${C.gold};text-transform:uppercase;letter-spacing:1px;font-weight:700;border-bottom:2px solid ${C.gold};text-align:center;">Risultato</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`;
}

// ============================================================
// COMPLETE EMAIL BUILDERS
// ============================================================

/**
 * Build Esito notification email (single company)
 */
export function buildEsitoNotificationEmail(gara, partecipante) {
  const isWinner = partecipante.Vincitrice === true;
  const isExcluded = partecipante.Esclusa === true;
  const isAnomala = partecipante.Anomala === true;
  const nome = partecipante.RagioneSociale || partecipante.rs_fallback || 'Gentile Partecipante';
  const ribasso = partecipante.Ribasso ? Number(partecipante.Ribasso).toFixed(3) + '%' : '-';

  let statusType = 'info';
  let statusText = `La Sua offerta (ribasso ${ribasso}, posizione ${partecipante.Posizione || '-'}) risulta <strong>AMMESSA</strong>.`;
  if (isWinner) {
    statusType = 'success';
    statusText = `<strong>CONGRATULAZIONI!</strong> La Sua offerta risulta <strong>VINCITRICE</strong> di questa gara con ribasso ${ribasso}.`;
  } else if (isExcluded) {
    statusType = 'error';
    statusText = `La Sua offerta (ribasso ${ribasso}) è stata <strong>ESCLUSA</strong> dalla gara.`;
  } else if (isAnomala) {
    statusType = 'warning';
    statusText = `La Sua offerta (ribasso ${ribasso}) è risultata <strong>ANOMALA</strong> (sopra la soglia: ${gara.SogliaAn ? Number(gara.SogliaAn).toFixed(3) + '%' : '-'}).`;
  }

  const importo = gara.Importo ? Number(gara.Importo).toLocaleString('it-IT', {minimumFractionDigits: 2}) + ' &euro;' : '-';

  const content = `
    ${sectionTitle('Comunicazione Esito di Gara')}
    ${textBlock(`Gentile <strong style="color:${C.white};">${nome}</strong>,<br>La informiamo che è stato pubblicato l'esito della seguente gara:`)}
    ${spacer(8)}
    ${infoRow('Oggetto', gara.Titolo || '-')}
    ${infoRow('Stazione Appaltante', gara.stazione_nome || '-')}
    ${infoRow('CIG', `<span style="color:${C.gold};font-weight:600;">${gara.CodiceCIG || '-'}</span>`)}
    ${infoRow('Importo', `<span style="color:${C.gold};font-weight:600;">${importo}</span>`)}
    ${infoRow('Partecipanti', gara.NPartecipanti || '-')}
    ${infoRow('La Sua Posizione', `<span style="color:${C.gold};font-weight:700;">${partecipante.Posizione || '-'}&deg;</span>`)}
    ${spacer(8)}
    ${alertBox(statusText, statusType)}
    ${spacer(4)}
  `;

  return emailLayout(content, { preheader: `Esito gara: ${gara.Titolo?.substring(0, 60) || 'Comunicazione'}` });
}

/**
 * Build participant email (differentiated client/non-client)
 */
export function buildParticipantEmail(gara, graduatoria, partecipante, isCliente) {
  const nome = partecipante.azienda_rs || partecipante.RagioneSociale || 'Partecipante';
  const risultato = partecipante.Vincitrice ? 'VINCITRICE' : partecipante.Esclusa ? 'ESCLUSA' : partecipante.Anomala ? 'ANOMALA' : 'AMMESSA';
  const ribasso = partecipante.Ribasso ? Number(partecipante.Ribasso).toFixed(5) + '%' : '-';
  const importo = gara.Importo ? Number(gara.Importo).toLocaleString('it-IT', {minimumFractionDigits: 2}) + ' &euro;' : '-';

  let statsRow = `<tr>
    ${statCard('Media Aritm.', gara.MediaAr ? Number(gara.MediaAr).toFixed(3) + '%' : '-')}
    ${statCard('Soglia Anom.', gara.SogliaAn ? Number(gara.SogliaAn).toFixed(3) + '%' : '-')}
    ${statCard('Partecipanti', gara.NPartecipanti || '-')}
    ${statCard('Vostra Pos.', (partecipante.Posizione || '-') + '°', true)}
  </tr>`;

  const gradData = isCliente ? graduatoria : getPartialGrad(graduatoria, partecipante.Posizione);
  const gradTitle = isCliente ? 'Graduatoria Completa' : 'La Vostra Posizione';

  let content = `
    ${sectionTitle(`Esito di Gara #${gara.id}`, gara.Titolo || '')}
    ${infoRow('Stazione Appaltante', gara.stazione_nome || '-')}
    ${infoRow('CIG', `<span style="color:${C.gold};font-weight:600;">${gara.CodiceCIG || '-'}</span>`)}
    ${infoRow('Importo', `<span style="color:${C.gold};font-weight:600;">${importo}</span>`)}
    ${spacer(8)}
    <tr><td style="padding:4px 32px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${statsRow}</table>
    </td></tr>
    ${spacer(8)}
    <tr><td style="padding:8px 32px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.dark};border-radius:8px;border:1px solid ${C.darkAlt};">
        <tr><td style="padding:18px 20px;">
          <div style="font-family:'Comfortaa',Verdana,sans-serif;font-size:10px;color:${C.midGray};text-transform:uppercase;letter-spacing:1px;font-weight:600;margin-bottom:10px;">La Vostra Offerta</div>
          <div style="font-family:'Comfortaa',Verdana,sans-serif;font-size:15px;color:${C.white};font-weight:600;margin-bottom:12px;">${nome}</div>
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td style="padding-right:32px;"><span style="font-family:'Segoe UI',Arial,sans-serif;font-size:12px;color:${C.midGray};">Ribasso</span><br><span style="font-family:'Comfortaa',Verdana,sans-serif;font-size:18px;color:${C.gold};font-weight:700;">${ribasso}</span></td>
            <td><span style="font-family:'Segoe UI',Arial,sans-serif;font-size:12px;color:${C.midGray};">Risultato</span><br><span style="font-family:'Comfortaa',Verdana,sans-serif;font-size:18px;color:${C.gold};font-weight:700;">${risultato}</span></td>
          </tr></table>
        </td></tr>
      </table>
    </td></tr>
    ${spacer(12)}
    ${sectionTitle(gradTitle)}
    <tr><td style="padding:0 32px 16px;">
      ${graduatoriaTable(gradData, partecipante.Posizione, isCliente)}
    </td></tr>
  `;

  if (!isCliente) {
    content += alertBox(
      `<strong style="font-family:'Comfortaa',Verdana,sans-serif;">Vuoi la graduatoria completa?</strong><br>Attiva il tuo abbonamento EasyWin per accedere a tutte le informazioni di gara, simulazioni e molto altro.`,
      'info'
    );
    content += ctaButton('Scopri i Piani EasyWin', `${SITE_URL}/prezzi`);
  }

  if (isCliente) {
    content += ctaButton('Vedi Dettaglio Completo', `${SITE_URL}/clienti/#esiti/${gara.id}`);
  }

  return emailLayout(content, { preheader: `Esito gara #${gara.id} - ${risultato}` });
}

/**
 * Build newsletter HTML (bandi or esiti)
 */
export function buildNewsletterEmail(type, items, dateRange, noteAggiuntive = '') {
  const isEsiti = type === 'esiti';
  const title = isEsiti ? 'Newsletter Esiti' : 'Newsletter Bandi';

  // Group by regione
  const byRegione = {};
  items.forEach(item => {
    const reg = item.Regione || item.regione || 'Non specificata';
    if (!byRegione[reg]) byRegione[reg] = [];
    byRegione[reg].push(item);
  });

  let itemsContent = '';
  Object.keys(byRegione).sort().forEach(reg => {
    itemsContent += regionHeader(reg);
    byRegione[reg].forEach(item => {
      itemsContent += newsletterItem(item, type);
    });
  });

  const content = `
    ${sectionTitle(title, `Periodo: ${dateRange.da || dateRange.from || ''} &ndash; ${dateRange.a || dateRange.to || ''}`)}
    ${noteAggiuntive ? textBlock(`<em>${noteAggiuntive}</em>`, { color: C.midGray }) : ''}
    <tr><td style="padding:4px 32px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.darkAlt};border-radius:8px;border:1px solid rgba(245,197,24,0.15);">
        <tr>
          <td style="padding:12px 16px;text-align:center;">
            <span style="font-family:'Comfortaa',Verdana,sans-serif;font-size:24px;color:${C.gold};font-weight:700;">${items.length}</span>
            <span style="font-family:'Segoe UI',Arial,sans-serif;font-size:13px;color:${C.midGray};margin-left:8px;">${isEsiti ? 'esiti' : 'bandi'} in ${Object.keys(byRegione).length} regioni</span>
          </td>
        </tr>
      </table>
    </td></tr>
    ${spacer(4)}
    ${itemsContent}
    ${spacer(8)}
    ${ctaButton(isEsiti ? 'Vedi Tutti gli Esiti' : 'Vedi Tutti i Bandi', `${SITE_URL}/clienti/#${type}`)}
  `;

  return emailLayout(content, {
    preheader: `${items.length} nuovi ${type} - ${dateRange.da || dateRange.from || ''}`,
    showUnsubscribe: true,
    unsubscribeUrl: `${SITE_URL}/newsletter/unsubscribe`
  });
}

/**
 * Build password reset email
 */
export function buildPasswordResetEmail(userName, resetLink) {
  const content = `
    ${sectionTitle('Reset Password')}
    ${textBlock(`Ciao <strong style="color:${C.white};">${userName || 'Utente'}</strong>,<br>Hai richiesto il reset della tua password. Clicca il pulsante sottostante per procedere:`)}
    ${ctaButton('Reimposta Password', resetLink)}
    ${alertBox('Questo link è valido per <strong>24 ore</strong>. Se non hai richiesto il reset, ignora questo messaggio.', 'warning')}
  `;
  return emailLayout(content, { preheader: 'Richiesta reset password EasyWin' });
}

/**
 * Build contact form notification (to admin)
 */
export function buildContactFormEmail(contact) {
  const content = `
    ${sectionTitle('Nuovo Messaggio dal Sito', new Date().toLocaleDateString('it-IT') + ' ' + new Date().toLocaleTimeString('it-IT'))}
    ${infoRow('Nome', contact.nome || '-')}
    ${infoRow('Email', `<a href="mailto:${contact.email}" style="color:${C.gold};text-decoration:none;">${contact.email || '-'}</a>`)}
    ${infoRow('Telefono', contact.telefono || '-')}
    ${infoRow('Oggetto', contact.oggetto || '-')}
    ${contact.newsletter ? infoRow('Newsletter', `<span style="color:${C.green};">Iscritto</span>`) : ''}
    ${spacer(8)}
    <tr><td style="padding:0 32px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.dark};border-radius:8px;border-left:4px solid ${C.gold};">
        <tr><td style="padding:20px;font-family:'Segoe UI',Arial,sans-serif;font-size:14px;color:${C.white};line-height:1.7;">
          ${(contact.messaggio || '').replace(/\n/g, '<br>')}
        </td></tr>
      </table>
    </td></tr>
    ${spacer(4)}
  `;
  return emailLayout(content, { preheader: `Contatto: ${contact.nome} - ${contact.oggetto}` });
}

// ============================================================
// FUTURE EMAILS (to be completed)
// ============================================================

/**
 * Build subscription expiry reminder (to client)
 */
export function buildScadenzaClienteEmail(user, daysLeft, scadenza) {
  const urgency = daysLeft <= 10 ? 'error' : daysLeft <= 20 ? 'warning' : 'info';
  const content = `
    ${sectionTitle('Promemoria Scadenza Abbonamento')}
    ${textBlock(`Gentile <strong style="color:${C.white};">${user.nome || user.username}</strong>,`)}
    ${alertBox(
      daysLeft === 0
        ? `Il tuo abbonamento EasyWin <strong>scade oggi</strong> (${scadenza}).`
        : `Il tuo abbonamento EasyWin scade tra <strong>${daysLeft} giorni</strong> (${scadenza}).`,
      urgency
    )}
    ${textBlock(`Per continuare ad accedere ai servizi di monitoraggio bandi, esiti, simulazioni e tutte le funzionalità premium, ti consigliamo di rinnovare il prima possibile.`)}
    ${ctaButton('Rinnova il Tuo Abbonamento', `${SITE_URL}/clienti/#abbonamento`)}
    ${textBlock(`Per qualsiasi domanda, contattaci a <a href="mailto:info@easywin.it" style="color:${C.gold};text-decoration:none;">info@easywin.it</a>`, { size: '12px', color: C.midGray })}
  `;
  return emailLayout(content, { preheader: `Scadenza abbonamento tra ${daysLeft} giorni` });
}

/**
 * Build subscription expiry reminder (to admin)
 */
export function buildScadenzaAdminEmail(scadenze) {
  let tableRows = '';
  scadenze.forEach(s => {
    const urgencyColor = s.daysLeft <= 0 ? C.red : s.daysLeft <= 10 ? C.orange : C.gold;
    tableRows += `<tr style="border-bottom:1px solid ${C.darkAlt};">
      <td style="padding:10px 12px;font-family:'Segoe UI',Arial,sans-serif;font-size:13px;color:${C.white};">${s.username}</td>
      <td style="padding:10px 12px;font-family:'Segoe UI',Arial,sans-serif;font-size:13px;color:${C.lightGray};">${s.email}</td>
      <td style="padding:10px 12px;font-family:'Segoe UI',Arial,sans-serif;font-size:13px;color:${C.lightGray};">${s.scadenza}</td>
      <td style="padding:10px 12px;font-family:'Comfortaa',Verdana,sans-serif;font-size:13px;color:${urgencyColor};font-weight:700;text-align:center;">${s.daysLeft <= 0 ? 'SCADUTO' : s.daysLeft + 'gg'}</td>
    </tr>`;
  });

  const content = `
    ${sectionTitle('Report Scadenze Abbonamenti', new Date().toLocaleDateString('it-IT'))}
    ${textBlock(`<strong style="color:${C.gold};">${scadenze.length}</strong> abbonamenti in scadenza.`)}
    <tr><td style="padding:0 32px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${C.darkAlt};border-radius:8px;overflow:hidden;">
        <thead><tr style="background:${C.darkAlt};">
          <th style="padding:12px;font-family:'Comfortaa',Verdana,sans-serif;font-size:10px;color:${C.gold};text-transform:uppercase;letter-spacing:1px;text-align:left;">Utente</th>
          <th style="padding:12px;font-family:'Comfortaa',Verdana,sans-serif;font-size:10px;color:${C.gold};text-transform:uppercase;letter-spacing:1px;text-align:left;">Email</th>
          <th style="padding:12px;font-family:'Comfortaa',Verdana,sans-serif;font-size:10px;color:${C.gold};text-transform:uppercase;letter-spacing:1px;text-align:left;">Scadenza</th>
          <th style="padding:12px;font-family:'Comfortaa',Verdana,sans-serif;font-size:10px;color:${C.gold};text-transform:uppercase;letter-spacing:1px;text-align:center;">GG</th>
        </tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
    </td></tr>
    ${ctaButton('Gestisci Abbonamenti', `${SITE_URL}/admin/#utenti`)}
  `;
  return emailLayout(content, { preheader: `${scadenze.length} abbonamenti in scadenza` });
}

/**
 * Build import alert email (to admin)
 */
export function buildImportAlertEmail(stats) {
  const content = `
    ${sectionTitle('Importazione Bandi Completata', new Date().toLocaleTimeString('it-IT'))}
    <tr><td style="padding:4px 32px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          ${statCard('Nuovi', stats.nuovi || 0, true)}
          ${statCard('Aggiornati', stats.aggiornati || 0)}
          ${statCard('Errori', stats.errori || 0)}
          ${statCard('Totali', stats.totali || 0)}
        </tr>
      </table>
    </td></tr>
    ${stats.errori > 0 ? alertBox(`${stats.errori} errori durante l'importazione. Controlla il log nel gestionale.`, 'error') : alertBox('Importazione completata senza errori.', 'success')}
  `;
  return emailLayout(content, { preheader: `Importazione: ${stats.nuovi} nuovi bandi` });
}

/**
 * Build aperture alert email (tomorrow's openings)
 */
export function buildApertureAlertEmail(aperture, destinatario, data) {
  let tableRows = '';
  aperture.forEach((a, i) => {
    tableRows += `<tr style="background:${i % 2 === 0 ? C.dark : C.bg};border-bottom:1px solid ${C.darkAlt};">
      <td style="padding:10px 12px;font-family:'Segoe UI',Arial,sans-serif;font-size:12px;color:${C.lightGray};">${a.ora || '-'}</td>
      <td style="padding:10px 12px;font-family:'Segoe UI',Arial,sans-serif;font-size:12px;color:${C.white};">${a.oggetto || '-'}</td>
      <td style="padding:10px 12px;font-family:'Segoe UI',Arial,sans-serif;font-size:12px;color:${C.lightGray};">${a.stazione || '-'}</td>
      <td style="padding:10px 12px;font-family:'Segoe UI',Arial,sans-serif;font-size:12px;color:${a.incaricato ? C.green : C.orange};font-weight:600;">${a.incaricato || 'NON ASSEGNATA'}</td>
    </tr>`;
  });

  const content = `
    ${sectionTitle(`Aperture di Domani`, data)}
    ${textBlock(`Ciao <strong style="color:${C.white};">${destinatario}</strong>, ecco le aperture previste per domani:`)}
    <tr><td style="padding:4px 32px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.darkAlt};border-radius:8px;border:1px solid rgba(245,197,24,0.15);">
        <tr><td style="padding:12px 16px;text-align:center;">
          <span style="font-family:'Comfortaa',Verdana,sans-serif;font-size:28px;color:${C.gold};font-weight:700;">${aperture.length}</span>
          <span style="font-family:'Segoe UI',Arial,sans-serif;font-size:13px;color:${C.midGray};margin-left:8px;">aperture</span>
        </td></tr>
      </table>
    </td></tr>
    ${spacer(8)}
    <tr><td style="padding:0 32px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${C.darkAlt};border-radius:8px;overflow:hidden;">
        <thead><tr style="background:${C.darkAlt};">
          <th style="padding:10px 12px;font-family:'Comfortaa',Verdana,sans-serif;font-size:10px;color:${C.gold};text-transform:uppercase;letter-spacing:1px;text-align:left;">Ora</th>
          <th style="padding:10px 12px;font-family:'Comfortaa',Verdana,sans-serif;font-size:10px;color:${C.gold};text-transform:uppercase;letter-spacing:1px;text-align:left;">Oggetto</th>
          <th style="padding:10px 12px;font-family:'Comfortaa',Verdana,sans-serif;font-size:10px;color:${C.gold};text-transform:uppercase;letter-spacing:1px;text-align:left;">Stazione</th>
          <th style="padding:10px 12px;font-family:'Comfortaa',Verdana,sans-serif;font-size:10px;color:${C.gold};text-transform:uppercase;letter-spacing:1px;text-align:left;">Incaricato</th>
        </tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
    </td></tr>
    ${ctaButton('Vedi nel Gestionale', `${SITE_URL}/admin/#aperture`)}
  `;
  return emailLayout(content, { preheader: `${aperture.length} aperture domani ${data}` });
}

/**
 * Build sopralluoghi alert email
 */
export function buildSopralluoghiAlertEmail(sopralluoghi, destinatario, data) {
  let items = '';
  sopralluoghi.forEach(s => {
    items += `<tr><td style="padding:6px 32px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.dark};border-radius:8px;border:1px solid ${C.darkAlt};">
        <tr><td style="padding:14px 18px;">
          <div style="font-family:'Comfortaa',Verdana,sans-serif;font-size:13px;font-weight:600;color:${C.white};margin-bottom:6px;">${s.oggetto || 'Sopralluogo'}</div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-family:'Segoe UI',Arial,sans-serif;font-size:11px;color:${C.midGray};line-height:1.8;">
            <tr><td>Luogo: <span style="color:${C.lightGray};">${s.luogo || '-'}</span></td></tr>
            <tr><td>Ora: <span style="color:${C.gold};font-weight:600;">${s.ora || '-'}</span> | Incaricato: <span style="color:${s.incaricato ? C.green : C.orange};font-weight:600;">${s.incaricato || 'NON ASSEGNATO'}</span></td></tr>
          </table>
        </td></tr>
      </table>
    </td></tr>`;
  });

  const content = `
    ${sectionTitle(`Sopralluoghi di Domani`, data)}
    ${textBlock(`Ciao <strong style="color:${C.white};">${destinatario}</strong>, ecco i sopralluoghi previsti per domani:`)}
    <tr><td style="padding:4px 32px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.darkAlt};border-radius:8px;border:1px solid rgba(245,197,24,0.15);">
        <tr><td style="padding:12px 16px;text-align:center;">
          <span style="font-family:'Comfortaa',Verdana,sans-serif;font-size:28px;color:${C.gold};font-weight:700;">${sopralluoghi.length}</span>
          <span style="font-family:'Segoe UI',Arial,sans-serif;font-size:13px;color:${C.midGray};margin-left:8px;">sopralluoghi</span>
        </td></tr>
      </table>
    </td></tr>
    ${spacer(4)}
    ${items}
    ${spacer(8)}
    ${ctaButton('Vedi nel Gestionale', `${SITE_URL}/admin/#sopralluoghi`)}
  `;
  return emailLayout(content, { preheader: `${sopralluoghi.length} sopralluoghi domani` });
}

/**
 * Build event notification (posticipo seduta / assegnazione apertura)
 */
export function buildEventNotificationEmail(tipo, details) {
  const titles = {
    posticipo: 'Posticipo Seduta di Gara',
    assegnazione: 'Assegnazione Apertura',
    cambio_incaricato: 'Cambio Incaricato Apertura',
  };

  // Normalize field names (accept both snake_case and camelCase)
  const oggetto = details.oggetto || details.garaTitle || details.Titolo || '';
  const stazione = details.stazione || details.stazione_nome || '';
  const cig = details.CodiceCIG || details.cig || '';
  const dataOriginale = details.data_originale || details.dataOriginale || '';
  const nuovaData = details.nuova_data || details.nuovaData || '';
  const dataApertura = details.dataApertura || details.data_apertura || '';
  const incaricato = details.incaricato || '';
  const motivo = details.motivo || '';
  const importo = details.Importo || details.importo;

  // Build contextual message
  let messaggio = details.messaggio;
  if (!messaggio) {
    if (tipo === 'posticipo') {
      messaggio = `La seduta di gara "<strong>${oggetto}</strong>" (CIG: ${cig}) prevista per il <strong>${dataOriginale}</strong> è stata posticipata al <strong style="color:${C.gold};">${nuovaData}</strong>.${motivo ? `<br>Motivo: ${motivo}` : ''}`;
    } else if (tipo === 'assegnazione') {
      messaggio = `L'apertura della gara "<strong>${oggetto}</strong>" (CIG: ${cig}) è stata assegnata a <strong style="color:${C.green};">${incaricato}</strong> per il <strong>${dataApertura}</strong>.`;
    } else if (tipo === 'cambio_incaricato') {
      messaggio = `L'incaricato per l'apertura della gara "<strong>${oggetto}</strong>" (CIG: ${cig}) è stato modificato in <strong style="color:${C.green};">${incaricato}</strong>.`;
    }
  }

  let rows = '';
  if (oggetto) rows += infoRow('Oggetto', oggetto);
  if (stazione) rows += infoRow('Stazione Appaltante', stazione);
  if (cig) rows += infoRow('CIG', `<span style="color:${C.gold};font-weight:600;">${cig}</span>`);
  if (importo) rows += infoRow('Importo', `<span style="color:${C.gold};font-weight:600;">&euro;${typeof importo === 'number' ? importo.toLocaleString('it-IT', {minimumFractionDigits: 2}) : importo}</span>`);
  if (dataOriginale) rows += infoRow('Data Originale', dataOriginale);
  if (nuovaData) rows += infoRow('Nuova Data', `<span style="color:${C.gold};font-weight:700;">${nuovaData}</span>`);
  if (dataApertura) rows += infoRow('Data Apertura', `<span style="color:${C.gold};font-weight:600;">${dataApertura}</span>`);
  if (incaricato) rows += infoRow('Incaricato', `<span style="color:${C.green};font-weight:600;">${incaricato}</span>`);

  const content = `
    ${sectionTitle(titles[tipo] || 'Notifica')}
    ${textBlock(`Gentile <strong style="color:${C.white};">${details.destinatario || 'Operatore'}</strong>,`)}
    ${alertBox(messaggio, tipo === 'posticipo' ? 'warning' : 'info')}
    ${rows}
    ${spacer(8)}
    ${ctaButton('Vedi Dettaglio', `${SITE_URL}/admin/#aperture`)}
  `;
  return emailLayout(content, { preheader: `${titles[tipo]}: ${oggetto?.substring(0, 50) || ''}` });
}

// Helper
function getPartialGrad(graduatoria, currentPosition) {
  const idx = graduatoria.findIndex(p => p.Posizione === currentPosition);
  if (idx === -1) return graduatoria.slice(0, 1);
  return graduatoria.slice(Math.max(0, idx - 2), Math.min(graduatoria.length, idx + 3));
}

// ================================================================
// NEWSLETTER PERSONALIZZATE (filtri utente)
// ================================================================

function fmtImportoEmail(v) {
  if (v == null || v === 0) return '—';
  return '\u20AC ' + Number(v).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function buildRegoleChips(regole) {
  if (!regole || regole.length === 0) return '';
  return regole.map(r => {
    const parts = [];
    if (r.soa_codice) parts.push(`SOA ${r.soa_codice}`);
    if (r.province && r.province.length > 0) parts.push(r.province.map(p => p.sigla || p.nome || p).join(', '));
    const mn = parseFloat(r.importo_min) || 0;
    const mx = parseFloat(r.importo_max) || 0;
    if (mn > 0 || mx > 0) parts.push(`${fmtImportoEmail(mn)} — ${mx > 0 ? fmtImportoEmail(mx) : 'illimitato'}`);
    return `<span style="display:inline-block;background:${C.darkAlt};color:${C.gold};padding:4px 10px;border-radius:12px;font-size:11px;font-weight:600;margin:2px 4px 2px 0;border:1px solid rgba(245,197,24,0.2);">${parts.join(' &middot; ') || 'Tutti'}</span>`;
  }).join('');
}

function bandoRow(b, idx) {
  const bg = idx % 2 === 0 ? C.bg : C.dark;
  return `<tr style="background:${bg};">
    <td style="padding:14px 16px;border-bottom:1px solid ${C.darkAlt};">
      <div style="font-family:'Comfortaa',Verdana,sans-serif;font-size:13px;font-weight:700;color:${C.white};margin-bottom:4px;">
        <a href="${SITE_URL}/clienti/bando-dettaglio.html?id=${b.id || ''}" style="color:${C.gold};text-decoration:none;">${(b.titolo || '').substring(0, 100)}</a>
      </div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:4px;">
        <tr>
          <td style="font-size:11px;color:${C.midGray};padding:2px 0;"><strong style="color:${C.lightGray};">Stazione:</strong> ${b.stazione || '—'}</td>
          <td style="font-size:11px;color:${C.midGray};padding:2px 0;text-align:right;"><strong style="color:${C.lightGray};">Provincia:</strong> ${b.provincia || b.regione || '—'}</td>
        </tr>
        <tr>
          <td style="font-size:11px;color:${C.midGray};padding:2px 0;"><strong style="color:${C.lightGray};">Importo:</strong> <span style="color:${C.green};font-weight:600;">${fmtImportoEmail(b.importo)}</span></td>
          <td style="font-size:11px;color:${C.midGray};padding:2px 0;text-align:right;">${b.soa ? `<span style="background:${C.darkAlt};color:${C.orange};padding:2px 6px;border-radius:4px;font-size:10px;font-weight:700;">SOA ${b.soa}</span>` : ''}</td>
        </tr>
        <tr>
          <td colspan="2" style="font-size:11px;color:${C.midGray};padding:2px 0;"><strong style="color:${C.lightGray};">Scadenza:</strong> ${b.data_offerta || b.data || '—'} ${b.cig ? ` &middot; CIG: ${b.cig}` : ''}</td>
        </tr>
      </table>
    </td>
  </tr>`;
}

/**
 * Newsletter Bandi personalizzata per utente con filtri
 */
export function newsletterBandiPersonalizzata(user, bandi, regole) {
  const nomeUtente = user.nome || user.username || 'Utente';
  const nBandi = bandi.length;

  const regoleHtml = regole && regole.length > 0
    ? `${alertBox(`<strong>Risultati per i tuoi filtri:</strong><br>${buildRegoleChips(regole)}`, 'info')}`
    : `${alertBox('Stai ricevendo tutti i bandi pubblicati. <a href="${SITE_URL}/clienti/profilo.html#filtri" style="color:${C.gold};font-weight:700;">Configura i tuoi filtri</a> per ricevere solo quelli di tuo interesse.', 'info')}`;

  const bandiRows = bandi.map((b, i) => bandoRow(b, i)).join('');

  const content = `
    ${sectionTitle(`Ciao ${nomeUtente}`, `${nBandi} nuovi bandi corrispondono ai tuoi criteri`)}
    ${regoleHtml}
    <tr><td style="padding:0 16px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-radius:8px;overflow:hidden;border:1px solid ${C.darkAlt};">
        ${bandiRows}
      </table>
    </td></tr>
    ${ctaButton('Vedi tutti i bandi', `${SITE_URL}/clienti/index.html#bandi`)}
    ${textBlock(`<a href="${SITE_URL}/clienti/profilo.html#filtri" style="color:${C.midGray};text-decoration:underline;font-size:12px;">Modifica i tuoi filtri newsletter</a>`, { padding: '0 32px 16px', size: '12px' })}
  `;

  return emailLayout(content, {
    preheader: `${nBandi} nuovi bandi per te — EasyWin`,
    showUnsubscribe: true,
    unsubscribeUrl: `${SITE_URL}/clienti/profilo.html#newsletter`,
    footerExtra: 'Hai ricevuto questa email perch\u00E9 sei abbonato a EasyWin.'
  });
}

function esitoRow(e, idx) {
  const bg = idx % 2 === 0 ? C.bg : C.dark;
  return `<tr style="background:${bg};">
    <td style="padding:14px 16px;border-bottom:1px solid ${C.darkAlt};">
      <div style="font-family:'Comfortaa',Verdana,sans-serif;font-size:13px;font-weight:700;color:${C.white};margin-bottom:4px;">
        ${(e.titolo || '').substring(0, 100)}
      </div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:4px;">
        <tr>
          <td style="font-size:11px;color:${C.midGray};padding:2px 0;"><strong style="color:${C.lightGray};">Stazione:</strong> ${e.stazione || '—'}</td>
          <td style="font-size:11px;color:${C.midGray};padding:2px 0;text-align:right;"><strong style="color:${C.lightGray};">Data:</strong> ${e.data || '—'}</td>
        </tr>
        <tr>
          <td style="font-size:11px;color:${C.midGray};padding:2px 0;"><strong style="color:${C.lightGray};">Importo:</strong> <span style="color:${C.green};font-weight:600;">${fmtImportoEmail(e.importo)}</span></td>
          <td style="font-size:11px;color:${C.midGray};padding:2px 0;text-align:right;">${e.soa ? `<span style="background:${C.darkAlt};color:${C.orange};padding:2px 6px;border-radius:4px;font-size:10px;font-weight:700;">SOA ${e.soa}</span>` : ''}</td>
        </tr>
        <tr>
          <td style="font-size:11px;color:${C.midGray};padding:2px 0;"><strong style="color:${C.lightGray};">Vincitore:</strong> <span style="color:${C.gold};font-weight:600;">${e.vincitore || '—'}</span></td>
          <td style="font-size:11px;color:${C.midGray};padding:2px 0;text-align:right;"><strong style="color:${C.lightGray};">Ribasso:</strong> ${e.ribasso ? Number(e.ribasso).toFixed(3) + '%' : '—'} ${e.n_partecipanti ? `&middot; ${e.n_partecipanti} partec.` : ''}</td>
        </tr>
      </table>
    </td>
  </tr>`;
}

/**
 * Newsletter Esiti personalizzata per utente con filtri
 */
export function newsletterEsitiPersonalizzata(user, esiti, regole) {
  const nomeUtente = user.nome || user.username || 'Utente';
  const nEsiti = esiti.length;

  const regoleHtml = regole && regole.length > 0
    ? `${alertBox(`<strong>Risultati per i tuoi filtri:</strong><br>${buildRegoleChips(regole)}`, 'info')}`
    : `${alertBox('Stai ricevendo tutti gli esiti pubblicati. <a href="${SITE_URL}/clienti/profilo.html#filtri" style="color:${C.gold};font-weight:700;">Configura i tuoi filtri</a> per ricevere solo quelli di tuo interesse.', 'info')}`;

  const esitiRows = esiti.map((e, i) => esitoRow(e, i)).join('');

  const content = `
    ${sectionTitle(`Ciao ${nomeUtente}`, `${nEsiti} nuovi esiti corrispondono ai tuoi criteri`)}
    ${regoleHtml}
    <tr><td style="padding:0 16px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-radius:8px;overflow:hidden;border:1px solid ${C.darkAlt};">
        ${esitiRows}
      </table>
    </td></tr>
    ${ctaButton('Vedi tutti gli esiti', `${SITE_URL}/clienti/index.html#esiti`)}
    ${textBlock(`<a href="${SITE_URL}/clienti/profilo.html#filtri" style="color:${C.midGray};text-decoration:underline;font-size:12px;">Modifica i tuoi filtri newsletter</a>`, { padding: '0 32px 16px', size: '12px' })}
  `;

  return emailLayout(content, {
    preheader: `${nEsiti} nuovi esiti per te — EasyWin`,
    showUnsubscribe: true,
    unsubscribeUrl: `${SITE_URL}/clienti/profilo.html#newsletter`,
    footerExtra: 'Hai ricevuto questa email perch\u00E9 sei abbonato a EasyWin.'
  });
}
