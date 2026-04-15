#!/usr/bin/env node
// ──────────────────────────────────────────────────────────────
// scripts/test-ses-send.js — One-shot SES send test
//
// Sends a single email via the SES provider to a verified identity.
// Useful for validating DKIM/SPF/DMARC after domain verification.
//
// Usage (run from repo root):
//   SES_FROM_ADDRESS=noreply@aura-proptech.com \
//     node scripts/test-ses-send.js edoardo.oliveri07@gmail.com
//
// Reads credentials from backend/.env automatically.
// ──────────────────────────────────────────────────────────────
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendDir = path.join(__dirname, '..', 'backend');

// Load backend/.env (where SES credentials live)
const dotenv = await import(path.join(backendDir, 'node_modules', 'dotenv', 'lib', 'main.js'));
dotenv.default.config({ path: path.join(backendDir, '.env') });

// Force SES provider for this test — local override, NOT touching .env
process.env.MAIL_PROVIDER = 'ses';

const { mailProvider, getActiveProvider, MailSendError } = await import(
  path.join(backendDir, 'src', 'services', 'mail', 'index.js')
);

const to = process.argv[2];
const from = process.env.SES_FROM_ADDRESS;

if (!to) {
  console.error('Uso: node scripts/test-ses-send.js <destinatario@verificato>');
  console.error('  Il destinatario deve essere verificato in SES sandbox.');
  process.exit(1);
}
if (!from) {
  console.error('Errore: SES_FROM_ADDRESS non impostata.');
  console.error('  Esempio: SES_FROM_ADDRESS=noreply@aura-proptech.com node scripts/test-ses-send.js ...');
  process.exit(1);
}

console.log('─── SES Live Send Test ───────────────────────────');
console.log(`Provider:  ${getActiveProvider()}`);
console.log(`Region:    ${process.env.SES_REGION || '(default)'}`);
console.log(`From:      ${from}`);
console.log(`To:        ${to}`);
console.log(`ConfigSet: ${process.env.SES_CONFIGURATION_SET || '(nessuno)'}`);
console.log('──────────────────────────────────────────────────');

try {
  const result = await mailProvider.send({
    to,
    from,
    subject: '[SES Test] aura-proptech.com DKIM live',
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
        <h2 style="color:#1a5276">\u2713 SES Test \u2014 aura-proptech.com</h2>
        <p>Test invio reale via <strong>Amazon SES</strong> da dominio <code>aura-proptech.com</code>.</p>
        <p>Se vedi questa mail con <strong>DKIM/SPF/DMARC PASS</strong>, il setup funziona.</p>
        <hr style="border:none;border-top:1px solid #ddd;margin:24px 0">
        <p style="color:#888;font-size:12px">
          Inviato da EasyWin mail provider (SES v2) \u2014 ${new Date().toISOString()}
        </p>
      </div>
    `,
    text: 'Test invio reale via Amazon SES da dominio aura-proptech.com. Se vedi questa mail con DKIM/SPF/DMARC PASS, il setup funziona.',
  });

  console.log('\n\u2713 INVIO RIUSCITO');
  console.log(`  MessageId: ${result.messageId}`);
  console.log(`  Provider:  ${result.provider}`);
  console.log('\nControlla la casella del destinatario e verifica gli headers:');
  console.log('  Gmail \u2192 \u22ee \u2192 Mostra originale \u2192 cerca DKIM=PASS, SPF=PASS, DMARC=PASS');
} catch (err) {
  console.error('\n\u2717 INVIO FALLITO');
  if (err instanceof MailSendError) {
    console.error(`  Provider:  ${err.provider}`);
    console.error(`  Retriable: ${err.retriable}`);
    console.error(`  Message:   ${err.message}`);
  } else {
    console.error(`  ${err.name}: ${err.message}`);
  }
  if (err.message?.includes('MessageRejected') || err.message?.includes('not verified')) {
    console.error('\n  \u26a0 Il dominio o il destinatario non \u00e8 ancora verificato in SES.');
    console.error('    Attendi la propagazione DKIM (10-40 min) e riprova.');
  }
  if (err.message?.includes('AccessDenied') || err.message?.includes('AccessDeniedException')) {
    console.error('\n  \u26a0 Le credenziali IAM non hanno i permessi ses:SendEmail.');
    console.error("    Verifica la policy dell'utente easywin-ses-sender.");
  }
  process.exit(1);
}
