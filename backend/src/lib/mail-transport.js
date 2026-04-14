import nodemailer from 'nodemailer';
import Bottleneck from 'bottleneck';
import { query } from '../db/pool.js';

let transporter = null;
let limiter = null;

function init() {
  if (transporter) return;

  transporter = nodemailer.createTransport({
    host: process.env.BREVO_SMTP_HOST || 'smtp-relay.brevo.com',
    port: parseInt(process.env.BREVO_SMTP_PORT || '587', 10),
    secure: false,
    auth: {
      user: process.env.BREVO_SMTP_USER,
      pass: process.env.BREVO_SMTP_KEY
    },
    pool: true,
    maxConnections: parseInt(process.env.MAIL_POOL_SIZE || '10', 10),
    maxMessages: 100
  });

  const rateLimit = parseInt(process.env.MAIL_RATE_LIMIT || '20', 10);
  limiter = new Bottleneck({
    reservoir: rateLimit,
    reservoirRefreshAmount: rateLimit,
    reservoirRefreshInterval: 1000,
    maxConcurrent: parseInt(process.env.MAIL_POOL_SIZE || '10', 10)
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function sendWithRetry(mailOptions) {
  const maxAttempts = parseInt(process.env.MAIL_RETRY_ATTEMPTS || '2', 10) + 1;
  const backoffs = [0, 30000, 300000]; // 0, 30s, 5min
  let lastErr;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) await sleep(backoffs[attempt] || 300000);
    try {
      return await transporter.sendMail(mailOptions);
    } catch (err) {
      lastErr = err;
      const code = err.responseCode || err.code;
      if ([550, 553, 554].includes(code)) throw err;
      if (![421, 450, 451, 452].includes(code) && attempt === 0) throw err;
    }
  }
  throw lastErr;
}

/**
 * Send an email through the unified transport.
 *
 * @param {object} opts
 * @param {string} opts.to - Recipient email (required)
 * @param {string[]} [opts.cc] - CC recipients (optional)
 * @param {string} opts.subject - Email subject (required)
 * @param {string} opts.html - HTML body (required)
 * @param {string} [opts.text] - Plain text body (optional)
 * @param {string} [opts.from] - Sender (optional, defaults to MAIL_FROM env)
 * @param {string} opts.channel - mail_log channel enum (required)
 * @param {object} [opts.meta] - JSONB metadata for mail_log (optional)
 * @returns {{ messageId: string|null, mailLogId: number, status: string, error?: string }}
 */
export async function send({ to, cc, subject, html, text, from, channel, meta = {} }) {
  if (!to || !subject || !html || !channel) {
    throw new Error('mail-transport.send: to, subject, html, channel are required');
  }

  init();

  const fromAddr = from || process.env.MAIL_FROM || '"EasyWin" <noreply@easywin.it>';

  // 1. INSERT mail_log status='queued'
  const { rows } = await query(
    `INSERT INTO mail_log (channel, to_email, to_user_id, from_email, subject, status, meta, batch_id)
     VALUES ($1, $2, $3, $4, $5, 'queued', $6, $7)
     RETURNING id`,
    [
      channel,
      to,
      meta.user_id || null,
      fromAddr,
      subject.slice(0, 500),
      JSON.stringify(meta),
      meta.batch_id || null
    ]
  );
  const mailLogId = rows[0].id;

  // 2. Dry-run path
  if (process.env.MAIL_DRY_RUN === 'true') {
    await query(
      `UPDATE mail_log SET status='dry_run', sent_at=NOW() WHERE id=$1`,
      [mailLogId]
    );
    return { messageId: null, mailLogId, status: 'dry_run' };
  }

  // 3. Send with rate-limit + retry
  const mailOptions = { from: fromAddr, to, subject, html };
  if (cc && cc.length > 0) mailOptions.cc = cc;
  if (text) mailOptions.text = text;

  try {
    const info = await limiter.schedule(() => sendWithRetry(mailOptions));

    await query(
      `UPDATE mail_log SET status='sent', provider_message_id=$2, sent_at=NOW() WHERE id=$1`,
      [mailLogId, info.messageId || null]
    );

    // If batch_id + username_invio present, update newsletter_invii
    if (meta.batch_id && meta.username_invio) {
      await query(
        `UPDATE newsletter_invii SET username_invio=$2 WHERE id=$1 AND (username_invio IS NULL OR username_invio='')`,
        [meta.batch_id, meta.username_invio]
      ).catch(() => {}); // non-critical
    }

    return { messageId: info.messageId, mailLogId, status: 'sent' };
  } catch (err) {
    await query(
      `UPDATE mail_log SET status='failed', error_message=$2, sent_at=NOW() WHERE id=$1`,
      [mailLogId, String(err.message || err).slice(0, 2000)]
    );
    return { messageId: null, mailLogId, status: 'failed', error: err.message };
  }
}
