-- =====================================================
-- 031: Allineamento schema aziende/albi al DB legacy
-- Gap Analysis: colonne presenti nel legacy ma assenti
-- nel nuovo sito. Solo ALTER TABLE ADD COLUMN.
-- Idempotente: usa ADD COLUMN IF NOT EXISTS.
-- =====================================================

-- =====================================================
-- 1. AZIENDE — 39 colonne mancanti
-- =====================================================

DO $$ BEGIN

  -- Anagrafica
  ALTER TABLE aziende ADD COLUMN IF NOT EXISTS nome_breve VARCHAR(255);                      -- Legacy "Nome": alias/nome breve azienda
  ALTER TABLE aziende ADD COLUMN IF NOT EXISTS cod UUID;                                     -- Legacy "COD": codice univoco esterno
  ALTER TABLE aziende ADD COLUMN IF NOT EXISTS username VARCHAR(100);                        -- Legacy "username": utente associato
  ALTER TABLE aziende ADD COLUMN IF NOT EXISTS consorzio BOOLEAN DEFAULT false;              -- Legacy "Consorzio": flag consorzio

  -- CRM / Contatti
  ALTER TABLE aziende ADD COLUMN IF NOT EXISTS send_email BOOLEAN DEFAULT false;             -- Legacy "SendEmail": flag invio email
  ALTER TABLE aziende ADD COLUMN IF NOT EXISTS ultimo_invio_email TIMESTAMPTZ;               -- Legacy "LastEmailSend"
  ALTER TABLE aziende ADD COLUMN IF NOT EXISTS username_responsabile VARCHAR(100);           -- Legacy "UsernameResponsabile": operatore assegnato
  ALTER TABLE aziende ADD COLUMN IF NOT EXISTS referente VARCHAR(100);                       -- Legacy "Referente": persona di riferimento azienda
  ALTER TABLE aziende ADD COLUMN IF NOT EXISTS telefono_referente VARCHAR(50);               -- Legacy "TelefonoReferente"

  -- Camera di Commercio
  ALTER TABLE aziende ADD COLUMN IF NOT EXISTS cciaa VARCHAR(50);                            -- Legacy "CCIA": numero CCIAA
  ALTER TABLE aziende ADD COLUMN IF NOT EXISTS iscrizione_cciaa VARCHAR(200);                -- Legacy "IscrizioneCCIA": dettagli iscrizione
  ALTER TABLE aziende ADD COLUMN IF NOT EXISTS data_iscrizione_cciaa TIMESTAMPTZ;            -- Legacy "DataIscrizioneCCIA"

  -- Attestazione SOA (dati riepilogo a livello azienda)
  ALTER TABLE aziende ADD COLUMN IF NOT EXISTS tipologia_attestazione VARCHAR(200);          -- Legacy "TipologiaAttestazione"
  ALTER TABLE aziende ADD COLUMN IF NOT EXISTS soa_attestatrice VARCHAR(200);                -- Legacy "SocAttestatriceSoa": società attestatrice
  ALTER TABLE aziende ADD COLUMN IF NOT EXISTS numero_soa VARCHAR(200);                      -- Legacy "NumeroSoa": numero certificato
  ALTER TABLE aziende ADD COLUMN IF NOT EXISTS data_rilascio_attestazione_orig TIMESTAMPTZ;  -- Legacy "DataRilascioAttestazioneOriginaria"
  ALTER TABLE aziende ADD COLUMN IF NOT EXISTS validita_triennale TIMESTAMPTZ;               -- Legacy "ValiditàTriennale"
  ALTER TABLE aziende ADD COLUMN IF NOT EXISTS validita_quinquennale TIMESTAMPTZ;            -- Legacy "ValiditàQuinquennale"
  ALTER TABLE aziende ADD COLUMN IF NOT EXISTS data_rilascio_attestazione_corso TIMESTAMPTZ; -- Legacy "DataRilascioAttestazioneInCorso"
  ALTER TABLE aziende ADD COLUMN IF NOT EXISTS data_verifica_triennale TIMESTAMPTZ;          -- Legacy "DataVerificaTriennale"

  -- Stato commerciale
  ALTER TABLE aziende ADD COLUMN IF NOT EXISTS stato_non_interessato BOOLEAN DEFAULT false;  -- Legacy "StatoNonInteressato"
  ALTER TABLE aziende ADD COLUMN IF NOT EXISTS data_non_interessato TIMESTAMPTZ;             -- Legacy "DataNonInteressato"
  ALTER TABLE aziende ADD COLUMN IF NOT EXISTS username_non_interessato VARCHAR(100);        -- Legacy "UsernameNonInteressato"
  ALTER TABLE aziende ADD COLUMN IF NOT EXISTS note_non_interessato TEXT;                    -- Legacy "NoteNonInteressato"
  ALTER TABLE aziende ADD COLUMN IF NOT EXISTS nascondi_stato BOOLEAN DEFAULT false;         -- Legacy "NascondiStato"
  ALTER TABLE aziende ADD COLUMN IF NOT EXISTS cessata BOOLEAN DEFAULT false;                -- Legacy "Cessata": azienda cessata

  -- Fatturazione elettronica
  ALTER TABLE aziende ADD COLUMN IF NOT EXISTS codice_sdi VARCHAR(7);                        -- Legacy "CodiceSDI": codice SDI

  -- Abbonamenti servizi
  ALTER TABLE aziende ADD COLUMN IF NOT EXISTS abbonato_sopralluoghi BOOLEAN DEFAULT false;  -- Legacy "AbbonatoSopralluoghi"
  ALTER TABLE aziende ADD COLUMN IF NOT EXISTS abbonato_aperture BOOLEAN DEFAULT false;      -- Legacy "AbbonatoAperture"

  -- Documenti — flag presenza e scadenze
  ALTER TABLE aziende ADD COLUMN IF NOT EXISTS presente_doc_delega BOOLEAN DEFAULT false;    -- Legacy "PresenteDocumentoDelega"
  ALTER TABLE aziende ADD COLUMN IF NOT EXISTS presente_doc_identita BOOLEAN DEFAULT false;  -- Legacy "PresenteDocumentoIdentita"
  ALTER TABLE aziende ADD COLUMN IF NOT EXISTS presente_doc_soa BOOLEAN DEFAULT false;       -- Legacy "PresenteDocumentoSOA"
  ALTER TABLE aziende ADD COLUMN IF NOT EXISTS presente_doc_cciaa BOOLEAN DEFAULT false;     -- Legacy "PresenteDocumentoCCIAA"
  ALTER TABLE aziende ADD COLUMN IF NOT EXISTS data_scadenza_delega TIMESTAMPTZ;             -- Legacy "DataScadenzaDelega"
  ALTER TABLE aziende ADD COLUMN IF NOT EXISTS data_scadenza_identita TIMESTAMPTZ;           -- Legacy "DataScadenzaIdentita"
  ALTER TABLE aziende ADD COLUMN IF NOT EXISTS data_scadenza_soa TIMESTAMPTZ;                -- Legacy "DataScadenzaSOA"
  ALTER TABLE aziende ADD COLUMN IF NOT EXISTS data_scadenza_cciaa TIMESTAMPTZ;              -- Legacy "DataScadenzaCCIAA"

  -- Certificazioni ISO
  ALTER TABLE aziende ADD COLUMN IF NOT EXISTS iso_scadenza TIMESTAMPTZ;                     -- Legacy "ISOScadenza"
  ALTER TABLE aziende ADD COLUMN IF NOT EXISTS iso_rilasciato_da VARCHAR(255);               -- Legacy "ISORilasciatoDa"

END $$;

-- =====================================================
-- 2. AZIENDA_PERSONALE — 1 colonna mancante
-- =====================================================

ALTER TABLE azienda_personale ADD COLUMN IF NOT EXISTS codice_fiscale VARCHAR(50);           -- Legacy "CodiceFiscale"

-- =====================================================
-- 3. ATTESTAZIONI — 2 colonne mancanti
-- =====================================================

ALTER TABLE attestazioni ADD COLUMN IF NOT EXISTS anno INTEGER;                              -- Legacy "Anno": anno di riferimento
ALTER TABLE attestazioni ADD COLUMN IF NOT EXISTS username VARCHAR(100);                     -- Legacy "Username": chi ha inserito

-- =====================================================
-- 4. EVENTI_AZIENDE — 5 colonne mancanti
-- =====================================================

ALTER TABLE eventi_aziende ADD COLUMN IF NOT EXISTS stato INTEGER DEFAULT 0;                 -- Legacy "Stato": stato workflow evento
ALTER TABLE eventi_aziende ADD COLUMN IF NOT EXISTS data_invio TIMESTAMPTZ;                  -- Legacy "DataInvio": data invio comunicazione
ALTER TABLE eventi_aziende ADD COLUMN IF NOT EXISTS id_esito INTEGER;                        -- Legacy "IDEsito": ref a esito/risultato
ALTER TABLE eventi_aziende ADD COLUMN IF NOT EXISTS data_risposta TIMESTAMPTZ;               -- Legacy "DataRisposta"
ALTER TABLE eventi_aziende ADD COLUMN IF NOT EXISTS username_risposta VARCHAR(100);          -- Legacy "UserNameRisposta"

-- =====================================================
-- 5. NOTE_AZIENDE — 1 colonna mancante
-- =====================================================

ALTER TABLE note_aziende ADD COLUMN IF NOT EXISTS data_alert TIMESTAMPTZ;                    -- Legacy "DataAlert": data reminder/alert

-- =====================================================
-- INDICI per le nuove colonne più utilizzate
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_aziende_username ON aziende(username);
CREATE INDEX IF NOT EXISTS idx_aziende_cessata ON aziende(cessata) WHERE cessata = true;
CREATE INDEX IF NOT EXISTS idx_aziende_consorzio ON aziende(consorzio) WHERE consorzio = true;
CREATE INDEX IF NOT EXISTS idx_aziende_codice_sdi ON aziende(codice_sdi);
CREATE INDEX IF NOT EXISTS idx_aziende_responsabile ON aziende(username_responsabile);
CREATE INDEX IF NOT EXISTS idx_aziende_non_interessato ON aziende(stato_non_interessato) WHERE stato_non_interessato = true;
CREATE INDEX IF NOT EXISTS idx_attestazioni_anno ON attestazioni(anno);
CREATE INDEX IF NOT EXISTS idx_eventi_aziende_stato ON eventi_aziende(stato);
CREATE INDEX IF NOT EXISTS idx_eventi_aziende_data_invio ON eventi_aziende(data_invio);
CREATE INDEX IF NOT EXISTS idx_note_aziende_alert ON note_aziende(data_alert) WHERE data_alert IS NOT NULL;

-- =====================================================
-- 6. ATTESTAZIONI — colonna REVIEW approvata
-- =====================================================

ALTER TABLE attestazioni ADD COLUMN IF NOT EXISTS id_tipo_attestazione INTEGER;              -- Legacy "id_attestazione": tipo attestazione (SOA, ISO, ecc.)
CREATE INDEX IF NOT EXISTS idx_attestazioni_tipo ON attestazioni(id_tipo_attestazione);

-- =====================================================
-- 7. MODIFICHE_AZIENDA — colonna REVIEW approvata
-- =====================================================

ALTER TABLE modifiche_azienda ADD COLUMN IF NOT EXISTS note TEXT;                            -- Legacy "Note": descrizione libera della modifica

-- Fine migrazione 031
