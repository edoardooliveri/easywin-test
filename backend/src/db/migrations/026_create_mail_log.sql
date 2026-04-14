-- Migration 026: create unified mail_log table
-- Replaces fragmented logging across newsletter_invii_log and ad-hoc console logs.
-- See DESIGN_MAIL_SYSTEM.md §3.2 for rationale.

CREATE TABLE IF NOT EXISTS mail_log (
    id                  SERIAL PRIMARY KEY,
    channel             VARCHAR(40) NOT NULL,
    to_email            VARCHAR(300) NOT NULL,
    to_user_id          INTEGER REFERENCES users(id) ON DELETE SET NULL,
    from_email          VARCHAR(300),
    subject             VARCHAR(500),
    status              VARCHAR(20) NOT NULL DEFAULT 'queued',
    error_message       TEXT,
    provider_message_id VARCHAR(300),
    batch_id            INTEGER REFERENCES newsletter_invii(id) ON DELETE SET NULL,
    meta                JSONB NOT NULL DEFAULT '{}',
    sent_at             TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mail_log_channel_created ON mail_log(channel, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mail_log_user ON mail_log(to_user_id, created_at DESC) WHERE to_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mail_log_status ON mail_log(status, created_at DESC) WHERE status != 'sent';
CREATE INDEX IF NOT EXISTS idx_mail_log_batch ON mail_log(batch_id) WHERE batch_id IS NOT NULL;

-- Enum suggerito (non enforced a livello DB per flessibilità):
-- newsletter_bandi, newsletter_esiti, newsletter_custom
-- civetta_esito
-- alert_apertura, alert_sopralluogo, alert_scrittura, alert_import
-- reminder_scadenza_30, reminder_scadenza_7, reminder_scadenza_0
-- evento_posticipo, evento_assegnazione, evento_cambio_incaricato
-- password_reset, contact_form
-- generic  (fallback temporaneo per caller non ancora categorizzati, vedi PR futuri)

COMMENT ON TABLE mail_log IS 'Log unificato di ogni email inviata dal sistema. Canale discriminato da colonna channel.';
COMMENT ON COLUMN mail_log.batch_id IS 'FK a newsletter_invii per raggruppare invii batch (newsletter). NULL per invii singoli.';
COMMENT ON COLUMN mail_log.meta IS 'JSONB per metadata specifici canale: user_id, gara_id, registered (civetta), ecc.';
