import { mailSendSchema, MailSendError } from './schema.js';

const PROVIDER = (process.env.MAIL_PROVIDER || 'smtp').toLowerCase();

async function loadAdapter() {
  if (PROVIDER === 'ses') {
    return import('./provider-ses.js');
  }
  return import('./provider-smtp.js');
}

export const mailProvider = {
  async send(input) {
    const parsed = mailSendSchema.safeParse(input);
    if (!parsed.success) {
      throw new MailSendError(
        `Invalid mail payload: ${parsed.error}`,
        { provider: PROVIDER, retriable: false }
      );
    }
    const adapter = await loadAdapter();
    return adapter.send(parsed.data);
  },
};

export function getActiveProvider() {
  return PROVIDER;
}

export { MailSendError } from './schema.js';
