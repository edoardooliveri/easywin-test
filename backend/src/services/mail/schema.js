import { z } from 'zod';

const emailOrList = z.union([z.string(), z.array(z.string())]);

export const mailSendSchema = z.object({
  to: emailOrList,
  from: z.string().optional(),
  replyTo: z.string().optional(),
  subject: z.string().min(1, 'subject is required'),
  html: z.string().optional(),
  text: z.string().optional(),
  cc: emailOrList.optional(),
  bcc: emailOrList.optional(),
  headers: z.record(z.string(), z.string()).optional(),
  configurationSet: z.string().optional(),
}).refine(d => d.html || d.text, { message: 'Either html or text is required' });

export class MailSendError extends Error {
  constructor(message, { cause, provider, retriable = false } = {}) {
    super(message, { cause });
    this.name = 'MailSendError';
    this.provider = provider;
    this.retriable = retriable;
  }
}
