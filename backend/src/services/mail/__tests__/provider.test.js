import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { mailSendSchema, MailSendError } from '../schema.js';

// ── SMTP mock ────────────────────────────────────────────────
const mockSendMail = vi.fn();
vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn(() => ({ sendMail: mockSendMail })),
  },
}));

// ── SES mock ─────────────────────────────────────────────────
const sesMock = mockClient(SESv2Client);

// ── Imports (after mocks) ────────────────────────────────────
import * as smtpProvider from '../provider-smtp.js';
import * as sesProvider from '../provider-ses.js';
import { getActiveProvider, mailProvider } from '../index.js';

const validPayload = {
  to: 'test@example.com',
  subject: 'Test Subject',
  html: '<p>Hello</p>',
};

beforeEach(() => {
  mockSendMail.mockReset();
  sesMock.reset();
  smtpProvider._resetTransporter();
  sesProvider._resetClient();
});

describe('schema validation', () => {
  it('accepts a valid payload', () => {
    const r = mailSendSchema.safeParse(validPayload);
    expect(r.success).toBe(true);
  });

  it('rejects payload without html and text', () => {
    const r = mailSendSchema.safeParse({ to: 'a@b.com', subject: 'X' });
    expect(r.success).toBe(false);
  });
});

describe('SMTP adapter', () => {
  it('sends successfully and returns messageId', async () => {
    mockSendMail.mockResolvedValue({ messageId: 'smtp-abc-123' });
    const result = await smtpProvider.send(validPayload);
    expect(result).toEqual({ ok: true, messageId: 'smtp-abc-123', provider: 'smtp' });
    expect(mockSendMail).toHaveBeenCalledOnce();
  });

  it('throws retriable MailSendError on network failure', async () => {
    const err = new Error('Connection refused');
    err.code = 'ECONNREFUSED';
    mockSendMail.mockRejectedValue(err);
    await expect(smtpProvider.send(validPayload)).rejects.toThrow(MailSendError);
    try {
      await smtpProvider.send(validPayload);
    } catch (e) {
      expect(e.provider).toBe('smtp');
      expect(e.retriable).toBe(true);
    }
  });
});

describe('SES adapter', () => {
  it('sends successfully and returns MessageId', async () => {
    sesMock.on(SendEmailCommand).resolves({ MessageId: 'ses-xyz-789' });
    const result = await sesProvider.send(validPayload);
    expect(result).toEqual({ ok: true, messageId: 'ses-xyz-789', provider: 'ses' });
  });

  it('throws retriable MailSendError on throttle', async () => {
    const err = new Error('Rate exceeded');
    err.name = 'ThrottlingException';
    err.$retryable = { throttling: true };
    sesMock.on(SendEmailCommand).rejects(err);
    await expect(sesProvider.send(validPayload)).rejects.toThrow(MailSendError);
    try {
      await sesProvider.send(validPayload);
    } catch (e) {
      expect(e.provider).toBe('ses');
      expect(e.retriable).toBe(true);
    }
  });
});

describe('index (mailProvider)', () => {
  it('getActiveProvider() returns smtp by default', () => {
    expect(getActiveProvider()).toBe('smtp');
  });

  it('mailProvider.send() rejects invalid payload with non-retriable MailSendError', async () => {
    await expect(
      mailProvider.send({ to: 'a@b.com' })
    ).rejects.toThrow(MailSendError);
    try {
      await mailProvider.send({ to: 'a@b.com' });
    } catch (e) {
      expect(e.retriable).toBe(false);
    }
  });

  it('mailProvider.send() delegates to SMTP adapter on valid payload', async () => {
    mockSendMail.mockResolvedValue({ messageId: 'via-index-001' });
    const result = await mailProvider.send(validPayload);
    expect(result).toEqual({ ok: true, messageId: 'via-index-001', provider: 'smtp' });
  });
});
