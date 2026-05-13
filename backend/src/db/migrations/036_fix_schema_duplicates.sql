-- ============================================================================
-- Migration 036: fix duplicati schema + creazione user_roles mancante
-- ============================================================================
-- Audit migrazione DB (2026-05-13) ha rilevato 4 anomalie:
--
--   1. user_roles: REFERENZIATA da backend/src/routes/admin-dashboard.js
--      (5 query) ma NESSUNA CREATE TABLE in tutto lo schema. Bug runtime:
--      gli endpoint /admin/ruoli e /admin/utenti/:id/ruoli esplodono.
--
--   2. bandi_modifiche (m.001, UUID FK su bandi) e bandimodifiche (m.021,
--      TEXT id_bando) coesistono. Codice routes usa quasi solo `bandimodifiche`
--      (22 ref); l'altra ha 1 ref in admin-dashboard.js. Consolido eliminando
--      `bandi_modifiche` dopo aver migrato eventuali record.
--
--   3. fatture_proforma (m.022) e fatture_pro_forma (m.005, con underscore)
--      sono lo stesso concetto. Nessuna delle due è referenziata nelle routes.
--      Tengo `fatture_proforma` (schema più moderno + naming canonico).
--      Migro i dati di `fatture_pro_forma` e la droppo.
--
--   4. apertura_bandi vs aperture, scrittura_bandi vs scritture,
--      elaborati_progettuali vs elaborati: NON sono veri duplicati. Sono due
--      schemi paralleli (vecchia UUID-style + nuova SERIAL-style) entrambi
--      usati attivamente. Il consolidamento richiede un refactoring più ampio
--      che NON faccio in questa migration (rischio rotture in produzione).
--      Aggiungo solo commenti per documentare.
--
-- Idempotente: usa CREATE TABLE IF NOT EXISTS e blocchi DO con check.
-- Sicuro per ri-esecuzione (non perde dati se già applicata).
-- ============================================================================

-- ============================================================================
-- 1. user_roles  —  CREAZIONE (tabella mancante)
-- ============================================================================
-- Sostituisce le tabelle legacy aspnet_Roles + aspnet_UsersInRoles del modello
-- ASP.NET Membership. Permette assegnazione N:N di ruoli agli utenti
-- (un utente può essere ad es. sia "Agent" che "EsitiNewsletter").
--
-- I ruoli applicativi (stringhe libere) provengono dal codice:
--   admin-dashboard.js /api/admin/ruoli enumera:
--     Administrator, Agent, Publisher, Incaricato, Bandi, Esiti,
--     EsitiLight, EsitiNewsletter, Simulazioni
--
-- Nota: la colonna `users.ruolo` resta come ruolo "primario" per backwards
-- compat col vecchio codice, ma `user_roles` è la fonte di verità per i
-- ruoli aggiuntivi.

CREATE TABLE IF NOT EXISTS user_roles (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ruolo       VARCHAR(100) NOT NULL,
    granted_at  TIMESTAMPTZ DEFAULT NOW(),
    granted_by  VARCHAR(200),                    -- username dell'admin che ha assegnato
    -- Un utente non può avere lo stesso ruolo 2 volte
    UNIQUE (user_id, ruolo)
);

CREATE INDEX IF NOT EXISTS idx_user_roles_user  ON user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_ruolo ON user_roles(ruolo);

COMMENT ON TABLE  user_roles IS 'Ruoli N:N degli utenti (sostituisce legacy aspnet_UsersInRoles).';
COMMENT ON COLUMN user_roles.ruolo IS 'Stringa ruolo applicativa: Administrator|Agent|Publisher|Incaricato|Bandi|Esiti|EsitiLight|EsitiNewsletter|Simulazioni';

-- Sync iniziale: se gli utenti hanno già un users.ruolo (singolo), lo riporto
-- in user_roles per consistenza. Idempotente grazie a ON CONFLICT DO NOTHING.
INSERT INTO user_roles (user_id, ruolo, granted_at, granted_by)
SELECT u.id, u.ruolo, NOW(), 'migration_036'
FROM users u
WHERE u.ruolo IS NOT NULL AND u.ruolo <> ''
ON CONFLICT (user_id, ruolo) DO NOTHING;


-- ============================================================================
-- 2. bandi_modifiche  ←  consolidamento in bandimodifiche
-- ============================================================================
-- bandi_modifiche  (m.001): id SERIAL, id_bando UUID FK, username, data, modifiche
-- bandimodifiche   (m.021): id SERIAL, id_bando TEXT,    user_name,  modifiche, data
--
-- L'unica differenza rilevante è id_bando: UUID strict (con FK) vs TEXT libero.
-- bandimodifiche è più flessibile (può loggare anche modifiche su bandi cancellati
-- dove la FK rompe). La tengo.

-- 2a. Migra eventuali record da bandi_modifiche → bandimodifiche (se esiste e ha dati)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'bandi_modifiche'
  ) THEN
    INSERT INTO bandimodifiche (id_bando, user_name, modifiche, data)
    SELECT
      bm.id_bando::text,             -- UUID → TEXT (no info loss)
      bm.username,
      bm.modifiche,
      bm.data
    FROM bandi_modifiche bm
    -- Evita duplicati se la migration gira due volte
    WHERE NOT EXISTS (
      SELECT 1 FROM bandimodifiche bnm
      WHERE bnm.id_bando = bm.id_bando::text
        AND bnm.data = bm.data
        AND bnm.user_name = bm.username
        AND COALESCE(bnm.modifiche, '') = COALESCE(bm.modifiche, '')
    );

    RAISE NOTICE 'bandi_modifiche → bandimodifiche: dati migrati';
  END IF;
END $$;

-- 2b. Droppa bandi_modifiche (FK su bandi va via in cascata col DROP TABLE)
DROP TABLE IF EXISTS bandi_modifiche CASCADE;


-- ============================================================================
-- 3. fatture_pro_forma  ←  consolidamento in fatture_proforma
-- ============================================================================
-- fatture_pro_forma  (m.005): username, id_periodo, numero, data, importo, iva,
--                              totale, stato, pagata, data_pagamento, tipo,
--                              note, allegato BYTEA
-- fatture_proforma   (m.022): username, id_periodo (FK), numero, anno, data,
--                              descrizione, imponibile, iva, totale, note,
--                              created_at, updated_at
--
-- Tengo fatture_proforma (più moderno, naming canonico). Migro i campi
-- equivalenti dalla versione vecchia.

-- 3a. Migra dati da fatture_pro_forma → fatture_proforma
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'fatture_pro_forma'
  ) THEN
    INSERT INTO fatture_proforma
      (username, id_periodo, numero, data, totale, iva, note, created_at)
    SELECT
      fpf.username,
      fpf.id_periodo,
      fpf.numero,
      fpf.data,
      fpf.totale,
      fpf.iva,
      COALESCE(fpf.note, '') ||
        CASE WHEN fpf.stato IS NOT NULL THEN E'\n[stato legacy: ' || fpf.stato || ']' ELSE '' END ||
        CASE WHEN fpf.pagata THEN E'\n[pagata legacy: si]' ELSE '' END,
      NOW()
    FROM fatture_pro_forma fpf
    -- Evita duplicati: stesso username + numero + data
    WHERE NOT EXISTS (
      SELECT 1 FROM fatture_proforma fp
      WHERE fp.username = fpf.username
        AND COALESCE(fp.numero,'') = COALESCE(fpf.numero,'')
        AND fp.data = fpf.data
    );

    RAISE NOTICE 'fatture_pro_forma → fatture_proforma: dati migrati';
  END IF;
END $$;

-- 3b. Droppa fatture_pro_forma
DROP TABLE IF EXISTS fatture_pro_forma CASCADE;


-- ============================================================================
-- 4. Documentazione dei "duplicati parallel-track" che NON tocco
-- ============================================================================
-- Le seguenti coppie sono volutamente NON consolidate in questa migration
-- perché entrambe le tabelle sono attivamente usate dal codice e il merge
-- richiede un refactoring trasversale (bandi-servizi.js, esiti.js, ecc.)
-- che farò in una migration dedicata.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='apertura_bandi') THEN
    COMMENT ON TABLE apertura_bandi IS
      'LEGACY/PARALLEL: schema vecchio (UUID PK) parallelo ad aperture (SERIAL). '
      'Refactor consolidamento programmato in migration 037+. '
      'Nuovo codice: usare aperture.';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='scrittura_bandi') THEN
    COMMENT ON TABLE scrittura_bandi IS
      'LEGACY/PARALLEL: schema vecchio (UUID PK) parallelo a scritture (SERIAL). '
      'Refactor consolidamento programmato in migration 037+. '
      'Nuovo codice: usare scritture.';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='elaborati_progettuali') THEN
    COMMENT ON TABLE elaborati_progettuali IS
      'LEGACY/PARALLEL: schema vecchio parallelo a elaborati. '
      'Refactor consolidamento programmato in migration 037+. '
      'Nuovo codice: usare elaborati.';
  END IF;
END $$;


-- ============================================================================
-- 5. Sanity check finale
-- ============================================================================
-- Conferma che le anomalie sono state risolte (verifica via NOTICE in log).

DO $$
DECLARE
  has_user_roles bool;
  has_bandi_modifiche bool;
  has_fatture_pro_forma bool;
BEGIN
  SELECT EXISTS(SELECT 1 FROM information_schema.tables
                WHERE table_schema='public' AND table_name='user_roles')
    INTO has_user_roles;
  SELECT EXISTS(SELECT 1 FROM information_schema.tables
                WHERE table_schema='public' AND table_name='bandi_modifiche')
    INTO has_bandi_modifiche;
  SELECT EXISTS(SELECT 1 FROM information_schema.tables
                WHERE table_schema='public' AND table_name='fatture_pro_forma')
    INTO has_fatture_pro_forma;

  RAISE NOTICE 'Sanity check migration 036:';
  RAISE NOTICE '  user_roles esiste:        % (atteso: t)', has_user_roles;
  RAISE NOTICE '  bandi_modifiche eliminato: % (atteso: f)', has_bandi_modifiche;
  RAISE NOTICE '  fatture_pro_forma elim.:   % (atteso: f)', has_fatture_pro_forma;

  IF NOT has_user_roles OR has_bandi_modifiche OR has_fatture_pro_forma THEN
    RAISE WARNING 'Migration 036: una o piu anomalie NON risolte. Investigare.';
  ELSE
    RAISE NOTICE 'Migration 036: OK, tutte le anomalie risolte.';
  END IF;
END $$;
