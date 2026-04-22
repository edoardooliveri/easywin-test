#!/usr/bin/env node
// ──────────────────────────────────────────────────────────────
// scripts/ses-verify-emails.js — Verifica identità email su SES
//
// Registra email come identità verificate in SES sandbox.
// Il destinatario riceverà una mail di conferma da AWS.
//
// Usage:
//   node scripts/ses-verify-emails.js info@easywin.it paolo@easywin.it
// ──────────────────────────────────────────────────────────────
import { fileURLToPath } from 'url';
import path from 'path';
import { SESv2Client, CreateEmailIdentityCommand } from '@aws-sdk/client-sesv2';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendDir = path.join(__dirname, '..', 'backend');

const dotenv = await import(path.join(backendDir, 'node_modules', 'dotenv', 'lib', 'main.js'));
dotenv.default.config({ path: path.join(backendDir, '.env') });

const client = new SESv2Client({
  region: process.env.SES_REGION || 'eu-south-1',
  credentials: {
    accessKeyId: process.env.SES_ACCESS_KEY_ID,
    secretAccessKey: process.env.SES_SECRET_ACCESS_KEY,
  },
});

const emails = process.argv.slice(2);
if (emails.length === 0) {
  console.error('Uso: node scripts/ses-verify-emails.js email1@example.com email2@example.com');
  process.exit(1);
}

console.log('─── SES Email Identity Verification ─────────────');
console.log(`Region: ${process.env.SES_REGION || 'eu-south-1'}`);
console.log('');

for (const email of emails) {
  try {
    await client.send(new CreateEmailIdentityCommand({
      EmailIdentity: email,
    }));
    console.log(`✓ ${email} — richiesta verifica inviata. Controllare inbox e cliccare il link AWS.`);
  } catch (err) {
    if (err.name === 'AlreadyExistsException') {
      console.log(`● ${email} — già registrata come identità SES.`);
    } else {
      console.error(`✗ ${email} — errore: ${err.message}`);
    }
  }
}

console.log('');
console.log('Dopo che i destinatari cliccano il link di verifica,');
console.log('le email dal contact form arriveranno correttamente.');
