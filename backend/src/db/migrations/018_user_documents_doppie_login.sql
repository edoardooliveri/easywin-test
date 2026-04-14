-- =====================================================
-- 018: User Documents + Doppie Login tracking
-- Idempotente: usa IF NOT EXISTS / ADD COLUMN IF NOT EXISTS.
-- =====================================================

-- Documenti utente (caricabili dall'admin)
CREATE TABLE IF NOT EXISTS user_documents (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nome_file       VARCHAR(500) NOT NULL,
  tipo_mime       VARCHAR(100),
  dimensione      INTEGER DEFAULT 0,
  categoria       VARCHAR(100),
  note            TEXT,
  uploaded_by     VARCHAR(200),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ud_user ON user_documents(user_id);

-- Tracking doppie login: aggiunge colonne mancanti alla tabella preesistente
-- (la tabella potrebbe già esistere con schema legacy: username, data, ip)
ALTER TABLE doppie_login ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE doppie_login ADD COLUMN IF NOT EXISTS ip_address VARCHAR(45);
ALTER TABLE doppie_login ADD COLUMN IF NOT EXISTS user_agent TEXT;
ALTER TABLE doppie_login ADD COLUMN IF NOT EXISTS login_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE doppie_login ADD COLUMN IF NOT EXISTS session_token VARCHAR(500);
CREATE INDEX IF NOT EXISTS idx_dl_user ON doppie_login(user_id);
CREATE INDEX IF NOT EXISTS idx_dl_login_at ON doppie_login(login_at);
