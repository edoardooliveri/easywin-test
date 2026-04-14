import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { MailSendError } from './schema.js';

let _client;

function getClient() {
  if (!_client) {
    const config = {
      region: process.env.SES_REGION || 'eu-west-1',
    };
    if (process.env.SES_ACCESS_KEY_ID && process.env.SES_SECRET_ACCESS_KEY) {
      config.credentials = {
        accessKeyId: process.env.SES_ACCESS_KEY_ID,
        secretAccessKey: process.env.SES_SECRET_ACCESS_KEY,
      };
    }
    _client = new SESv2Client(config);
  }
  return _client;
}

export async function send(payload) {
  const client = getClient();

  const toList = Array.isArray(payload.to) ? payload.to : [payload.to];
  const from = payload.from || process.env.SES_FROM_ADDRESS || process.env.SMTP_FROM || '"EasyWin" <noreply@easywin.it>';

  const destination = { ToAddresses: toList };
  if (payload.cc) {
    destination.CcAddresses = Array.isArray(payload.cc) ? payload.cc : [payload.cc];
  }
  if (payload.bcc) {
    destination.BccAddresses = Array.isArray(payload.bcc) ? payload.bcc : [payload.bcc];
  }

  const body = {};
  if (payload.html) body.Html = { Data: payload.html, Charset: 'UTF-8' };
  if (payload.text) body.Text = { Data: payload.text, Charset: 'UTF-8' };

  const params = {
    FromEmailAddress: from,
    Destination: destination,
    Content: {
      Simple: {
        Subject: { Data: payload.subject, Charset: 'UTF-8' },
        Body: body,
      },
    },
  };

  if (payload.replyTo) {
    params.ReplyToAddresses = [payload.replyTo];
  }
  if (payload.configurationSet || process.env.SES_CONFIGURATION_SET) {
    params.ConfigurationSetName = payload.configurationSet || process.env.SES_CONFIGURATION_SET;
  }

  try {
    const result = await client.send(new SendEmailCommand(params));
    return { ok: true, messageId: result.MessageId, provider: 'ses' };
  } catch (err) {
    const retriable = err.$retryable?.throttling ||
      ['ThrottlingException', 'TooManyRequestsException', 'ServiceUnavailableException'].includes(err.name);
    throw new MailSendError(err.message, { cause: err, provider: 'ses', retriable: !!retriable });
  }
}

export function _resetClient() {
  _client = null;
}
