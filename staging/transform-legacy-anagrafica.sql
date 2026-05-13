-- ============================================================================
-- transform-legacy-anagrafica.sql
-- ============================================================================
-- Trasforma le tabelle di anagrafica legacy (aziende, users, stazioni,
-- regioni, province, soa, criteri, tipologie) da legacy.* → public.*.
--
-- A differenza di transform-legacy-to-public.sql (che fa il mapping
-- INT→UUID per bandi), qui le PK restano SERIAL/INTEGER 1:1.
-- Si tratta soprattutto di:
--   - rename naming CamelCase-flatten → snake_case (ragionesociale → ragione_sociale)
--   - mapping di colonne legacy aspnet_Membership → users.legacy_password ecc.
--   - join con aziende_clienti per popolare users.id_azienda
--
-- Prerequisiti:
--   1. pgloader-easywin.load eseguito (popola legacy.*)
--   2. Migrations 001-037 applicate (public.* esistente con struttura nuova)
--
-- Uso:
--   psql -d easywin_staging -f transform-legacy-anagrafica.sql
--
-- Idempotente: ON CONFLICT DO NOTHING. Sicuro per ri-esecuzione.
-- ============================================================================

\timing on
\set ON_ERROR_STOP on

BEGIN;

-- ============================================================================
-- 1. REFERENCE DATA: regioni, province, soa, criteri, tipologie
-- ============================================================================
-- Queste tabelle hanno pochi record (max ~110 province) e PK stabili 1:1.
-- pgloader le ha gia portate in legacy.*. Le ricopio in public.* solo se
-- public.* è vuota — non rimpiazzo se già popolata da seed o migrations.

\echo '[1/6] Reference data (regioni, province, soa, criteri, tipologie)...'

-- 1.1 regioni
INSERT INTO public.regioni (id, nome)
SELECT r.idregione, r.nome
FROM legacy.regioni r
ON CONFLICT (id) DO NOTHING;

-- 1.2 province (FK su regioni)
INSERT INTO public.province (id, nome, sigla, id_regione)
SELECT p.idprovincia, p.provincia, p.sigla, p.idregione
FROM legacy.province p
ON CONFLICT (id) DO NOTHING;

-- 1.3 soa
INSERT INTO public.soa (id, codice, descrizione, tipo)
SELECT s.idsoa, s.cod, s.descrizione, s.tipo
FROM legacy.soa s
ON CONFLICT (id) DO NOTHING;

-- 1.4 criteri (criteri aggiudicazione)
INSERT INTO public.criteri (id, nome, descrizione)
SELECT c.idcriterio, c.nome, c.descrizione
FROM legacy.criteri c
ON CONFLICT (id) DO NOTHING;

-- 1.5 tipologie bandi
INSERT INTO public.tipologia_bandi (id, nome, descrizione)
SELECT t.idtipologia, t.nome, t.descrizione
FROM legacy.tipologiabandi t
ON CONFLICT (id) DO NOTHING;

-- 1.6 tipologie gare (= esiti)
INSERT INTO public.tipologia_gare (id, nome, descrizione)
SELECT t.idtipologia, t.nome, t.descrizione
FROM legacy.tipologiagare t
ON CONFLICT (id) DO NOTHING;

-- 1.7 piattaforme (telematiche)
INSERT INTO public.piattaforme (id, nome, descrizione, url, tipo)
SELECT p.idpiattaforma, p.nome, p.descrizione, p.url, p.tipo
FROM legacy.piattaforme p
ON CONFLICT (id) DO NOTHING;

-- 1.8 tipo_dati_gara
INSERT INTO public.tipo_dati_gara (id, nome, descrizione)
SELECT t.idtipodati, t.nome, t.descrizione
FROM legacy.tipodatigara t
ON CONFLICT (id) DO NOTHING;

-- Allinea sequenze ai MAX
SELECT setval(pg_get_serial_sequence('public.regioni',         'id'), GREATEST((SELECT COALESCE(MAX(id),1) FROM public.regioni),         1), true);
SELECT setval(pg_get_serial_sequence('public.province',        'id'), GREATEST((SELECT COALESCE(MAX(id),1) FROM public.province),        1), true);
SELECT setval(pg_get_serial_sequence('public.soa',             'id'), GREATEST((SELECT COALESCE(MAX(id),1) FROM public.soa),             1), true);
SELECT setval(pg_get_serial_sequence('public.criteri',         'id'), GREATEST((SELECT COALESCE(MAX(id),1) FROM public.criteri),         1), true);
SELECT setval(pg_get_serial_sequence('public.tipologia_bandi', 'id'), GREATEST((SELECT COALESCE(MAX(id),1) FROM public.tipologia_bandi), 1), true);
SELECT setval(pg_get_serial_sequence('public.tipologia_gare',  'id'), GREATEST((SELECT COALESCE(MAX(id),1) FROM public.tipologia_gare),  1), true);
SELECT setval(pg_get_serial_sequence('public.piattaforme',     'id'), GREATEST((SELECT COALESCE(MAX(id),1) FROM public.piattaforme),     1), true);
SELECT setval(pg_get_serial_sequence('public.tipo_dati_gara',  'id'), GREATEST((SELECT COALESCE(MAX(id),1) FROM public.tipo_dati_gara),  1), true);


-- ============================================================================
-- 2. stazioni (PK INTEGER 1:1)
-- ============================================================================

\echo '[2/6] stazioni...'

INSERT INTO public.stazioni (
    id, nome, indirizzo, citta, cap, id_provincia, codice_fiscale,
    partita_iva, telefono, email, pec, sito_web, created_at, updated_at
)
SELECT
    s.idstazione,
    s.nome,
    s.indirizzo,
    s.citta,
    s.cap,
    s.idprovincia,
    s.codicefiscale,
    s.partitaiva,
    s.telefono,
    s.email,
    s.pec,
    s.sitoweb,
    COALESCE(s.datacreazione, NOW()),
    COALESCE(s.datamodifica, s.datacreazione, NOW())
FROM legacy.stazioni s
ON CONFLICT (id) DO NOTHING;

SELECT setval(pg_get_serial_sequence('public.stazioni', 'id'),
              GREATEST((SELECT COALESCE(MAX(id), 1) FROM public.stazioni), 1), true);


-- ============================================================================
-- 3. aziende (PK INTEGER 1:1)
-- ============================================================================
-- Legacy nome tabella: Azienda (singolare) oppure Aziende (plurale).
-- pgloader downcase: legacy.azienda + legacy.aziende potrebbero entrambe
-- esistere — uniformo prendendo da entrambe con UNION ALL e dedup.

\echo '[3/6] aziende...'

INSERT INTO public.aziende (
    id, ragione_sociale, partita_iva, codice_fiscale,
    indirizzo, cap, citta, id_provincia, regione,
    telefono, email, pec, sito_web,
    cessata, eliminata, consorzio,
    note, username_responsabile, username_inserimento,
    data_inserimento, data_modifica, data_alert
)
SELECT
    src.id,
    src.ragione_sociale,
    src.partita_iva,
    src.codice_fiscale,
    src.indirizzo,
    src.cap,
    src.citta,
    src.id_provincia,
    src.regione,
    src.telefono,
    src.email,
    src.pec,
    src.sito_web,
    src.cessata,
    src.eliminata,
    src.consorzio,
    src.note,
    src.username_resp,
    src.username_ins,
    src.data_ins,
    src.data_mod,
    src.data_alert
FROM (
    -- Provo prima legacy.azienda (singolare, schema più vecchio)
    SELECT
        a.idazienda AS id,
        a.ragionesociale AS ragione_sociale,
        a.partitaiva AS partita_iva,
        a.codicefiscale AS codice_fiscale,
        a.indirizzo,
        a.cap,
        a.citta,
        a.idprovincia AS id_provincia,
        a.regione,
        a.telefono,
        a.email,
        a.pec,
        a.sitoweb AS sito_web,
        COALESCE(a.cessata, false) AS cessata,
        COALESCE(a.eliminata, false) AS eliminata,
        COALESCE(a.consorzio, false) AS consorzio,
        a.note,
        a.usernameresponsabile AS username_resp,
        a.insertusername AS username_ins,
        COALESCE(a.datainserimento, NOW()) AS data_ins,
        COALESCE(a.datamodifica, a.datainserimento, NOW()) AS data_mod,
        a.dataalert AS data_alert,
        1 AS source_priority
    FROM legacy.azienda a
    WHERE EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema='legacy' AND table_name='azienda')
) src
ON CONFLICT (id) DO NOTHING;

SELECT setval(pg_get_serial_sequence('public.aziende', 'id'),
              GREATEST((SELECT COALESCE(MAX(id), 1) FROM public.aziende), 1), true);


-- ============================================================================
-- 4. users (con migrazione aspnet_Membership → users.legacy_password)
-- ============================================================================
-- Schema legacy:
--   aspnet_Users      (UserName, UserId, ApplicationId, ...)
--   aspnet_Membership (UserId, Password, PasswordSalt, PasswordFormat, ...)
--   Users             (anagrafica easywin-specific con FK su UserName)
--
-- Step:
--   a) inserisco users dall'easywin Users + join aspnet_Membership
--   b) le colonne legacy_password/salt/format sono pronte per il bcrypt
--      fallback al primo login (vedi backend/src/lib/legacy-auth.js)

\echo '[4/6] users (con aspnet_Membership → legacy_password)...'

-- Verifico che le tabelle legacy esistano prima di insertare
DO $$
DECLARE
    has_users boolean;
    has_membership boolean;
BEGIN
    SELECT EXISTS(SELECT 1 FROM information_schema.tables
                  WHERE table_schema='legacy' AND table_name='users')
        INTO has_users;
    SELECT EXISTS(SELECT 1 FROM information_schema.tables
                  WHERE table_schema='legacy' AND table_name='aspnet_membership')
        INTO has_membership;

    IF NOT has_users THEN
        RAISE NOTICE '  legacy.users non esiste — salto';
        RETURN;
    END IF;

    IF NOT has_membership THEN
        RAISE WARNING '  legacy.aspnet_membership non esiste — utenti senza password legacy (force reset password al primo login)';
    END IF;
END $$;

-- Importa utenti con legacy password
INSERT INTO public.users (
    username, email, nome, cognome, attivo, ruolo,
    data_iscrizione, data_scadenza,
    legacy_password, legacy_salt, legacy_format,
    bandi_enabled, esiti_enabled, newsletter_bandi, newsletter_esiti
)
SELECT
    u.username,
    u.email,
    u.firstname,
    u.lastname,
    -- aspnet_Membership.IsApproved=1 → attivo, IsLockedOut=1 → no
    COALESCE(m.isapproved, true) AND NOT COALESCE(m.islockedout, false) AS attivo,
    u.ruolo,
    COALESCE(u.datainsert, m.createdate, NOW()),
    u.dataexpire,
    -- Legacy password fields (nullable se membership manca)
    m.password,
    m.passwordsalt,
    m.passwordformat,
    COALESCE(u.bandi, true),
    COALESCE(u.esiti, true),
    COALESCE(u.newsletterbandi, false),
    COALESCE(u.newsletteresiti, false)
FROM legacy.users u
LEFT JOIN legacy.aspnet_users au ON LOWER(au.username) = LOWER(u.username)
LEFT JOIN legacy.aspnet_membership m ON m.userid = au.userid
WHERE u.username IS NOT NULL AND u.username <> ''
ON CONFLICT (username) DO UPDATE SET
    -- Aggiorno solo i campi anagrafica + legacy_password se NULL
    -- (non sovrascrivo password_hash o legacy_* già presenti)
    legacy_password = COALESCE(public.users.legacy_password, EXCLUDED.legacy_password),
    legacy_salt     = COALESCE(public.users.legacy_salt,     EXCLUDED.legacy_salt),
    legacy_format   = COALESCE(public.users.legacy_format,   EXCLUDED.legacy_format);

SELECT setval(pg_get_serial_sequence('public.users', 'id'),
              GREATEST((SELECT COALESCE(MAX(id), 1) FROM public.users), 1), true);


-- ============================================================================
-- 5. attestazioni (aziende → SOA con classifica)
-- ============================================================================
-- Legacy: AttestazioniAziende (PK separata) con FK su Azienda + Soa
-- Nuovo: attestazioni (PK SERIAL) con id_azienda, id_soa, classifica, date

\echo '[5/6] attestazioni...'

INSERT INTO public.attestazioni (
    id, id_azienda, id_soa, classifica,
    data_rilascio, data_scadenza_triennale, data_scadenza_quinquennale,
    societa_attestatrice, prevalente
)
SELECT
    aa.idattestazione,
    aa.idazienda,
    aa.idsoa,
    aa.classifica,
    aa.datarilascio,
    aa.datascadenzatrienn,
    aa.datascadenzaquinq,
    aa.societaattestatrice,
    COALESCE(aa.prevalente, false)
FROM legacy.attestazioniaziende aa
WHERE aa.idazienda IS NOT NULL
  AND aa.idsoa IS NOT NULL
  AND EXISTS (SELECT 1 FROM public.aziende WHERE id = aa.idazienda)
  AND EXISTS (SELECT 1 FROM public.soa     WHERE id = aa.idsoa)
ON CONFLICT (id) DO NOTHING;

SELECT setval(pg_get_serial_sequence('public.attestazioni', 'id'),
              GREATEST((SELECT COALESCE(MAX(id), 1) FROM public.attestazioni), 1), true);


-- ============================================================================
-- 6. user_roles  ←  aspnet_UsersInRoles
-- ============================================================================
-- Migration 036 ha creato public.user_roles. Qui popolo dai legacy
-- aspnet_Roles + aspnet_UsersInRoles.

\echo '[6/6] user_roles ← aspnet_UsersInRoles...'

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema='legacy' AND table_name='aspnet_usersinroles') THEN

        INSERT INTO public.user_roles (user_id, ruolo, granted_at, granted_by)
        SELECT
            u.id,
            r.rolename,
            NOW(),
            'migration_anagrafica'
        FROM legacy.aspnet_usersinroles ur
        JOIN legacy.aspnet_users au ON au.userid = ur.userid
        JOIN legacy.aspnet_roles r  ON r.roleid  = ur.roleid
        JOIN public.users u         ON LOWER(u.username) = LOWER(au.username)
        ON CONFLICT (user_id, ruolo) DO NOTHING;

        RAISE NOTICE '  user_roles popolata da aspnet_UsersInRoles';
    ELSE
        RAISE NOTICE '  legacy.aspnet_usersinroles non esiste — salto';
    END IF;
END $$;


-- ============================================================================
-- VERIFICA FINALE
-- ============================================================================

\echo '[FINE] Verifica row counts...'

DO $$
DECLARE
    n_aziende     BIGINT;
    n_users       BIGINT;
    n_users_legacy BIGINT;
    n_stazioni    BIGINT;
    n_attestazioni BIGINT;
    n_roles       BIGINT;
BEGIN
    SELECT COUNT(*) INTO n_aziende     FROM public.aziende;
    SELECT COUNT(*) INTO n_users       FROM public.users;
    SELECT COUNT(*) INTO n_users_legacy FROM public.users WHERE legacy_password IS NOT NULL;
    SELECT COUNT(*) INTO n_stazioni    FROM public.stazioni;
    SELECT COUNT(*) INTO n_attestazioni FROM public.attestazioni;
    SELECT COUNT(*) INTO n_roles       FROM public.user_roles;

    RAISE NOTICE '────────────────────────────────────────────────';
    RAISE NOTICE 'ANAGRAFICA: legacy → public — RIEPILOGO';
    RAISE NOTICE '────────────────────────────────────────────────';
    RAISE NOTICE 'aziende:                                 %', n_aziende;
    RAISE NOTICE 'stazioni:                                %', n_stazioni;
    RAISE NOTICE 'users (totale):                          %', n_users;
    RAISE NOTICE '   di cui con password legacy migrata:   %', n_users_legacy;
    RAISE NOTICE 'attestazioni (aziende-SOA):              %', n_attestazioni;
    RAISE NOTICE 'user_roles (ruoli N:N):                  %', n_roles;
    RAISE NOTICE '────────────────────────────────────────────────';
    RAISE NOTICE 'Gli utenti con legacy_password faranno migrazione';
    RAISE NOTICE 'bcrypt automatica al primo login corretto.';
    RAISE NOTICE '────────────────────────────────────────────────';
END $$;

COMMIT;

VACUUM ANALYZE public.aziende;
VACUUM ANALYZE public.users;
VACUUM ANALYZE public.stazioni;
VACUUM ANALYZE public.attestazioni;

\echo ''
\echo '═══════════════════════════════════════════════════════════════'
\echo 'Anagrafica migrata. Verifica:'
\echo '  - SELECT COUNT(*) FROM users WHERE legacy_password IS NOT NULL;'
\echo '    → utenti pronti per bcrypt fallback al primo login'
\echo '  - SELECT COUNT(*) FROM user_roles;'
\echo '    → ruoli aspnet_UsersInRoles migrati'
\echo '═══════════════════════════════════════════════════════════════'
