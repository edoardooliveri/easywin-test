import nodemailer from 'nodemailer';
import { MailSendError } from './schema.js';

let _transporter;

function getTransporter() {
  if (!_transporter) {
    _transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }
  return _transporter;
}

export async function send(payload) {
  const t = getTransporter();
  const mailOptions = {
    from: payload.from || process.env.SMTP_FROM || '"EasyWin" <noreply@easywin.it>',
    to: payload.to,
    subject: payload.subject,
  };
  if (payload.html) mailOptions.html = payload.html;
  if (payload.text) mailOptions.text = payload.text;
  if (payload.cc) mailOptions.cc = payload.cc;
  if (payload.bcc) mailOptions.bcc = payload.bcc;
  if (payload.replyTo) mailOptions.replyTo = payload.replyTo;
  if (payload.headers) mailOptions.headers = payload.headers;

  try {
    const info = await t.sendMail(mailOptions);
    return { ok: true, messageId: info.messageId, provider: 'smtp' };
  } catch (err) {
    const retriable = ['ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET', 'ESOCKET'].includes(err.code);
    throw new MailSendError(err.message, { cause: err, provider: 'smtp', retriable });
  }
}

export function _resetTransporter() {
  _transporter = null;
}
