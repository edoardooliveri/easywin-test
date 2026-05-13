-- ============================================================================
-- transform-legacy-anagrafica.sql  (v2 — defensive)
-- ============================================================================
-- Trasforma le tabelle di anagrafica legacy.* → public.*.
-- Strategia defensive: ogni step in un DO block con EXCEPTION → se una
-- tabella legacy ha schema diverso (colonna mancante, tipo incompatibile),
-- quel singolo step skippa con NOTICE e gli altri continuano.
--
-- Solo colonne MINIME e CERTAMENTE presenti nel public schema (m.001-037):
--   regioni, province, soa, criteri, tipologia_*, piattaforme, tipo_dati_gara
--   stazioni (m.001) — schema minimo: id, nome, indirizzo, citta, cap, id_provincia
--   aziende (m.001) — schema minimo: id, ragione_sociale, partita_iva, ...
--   users (m.001 + 037) — schema minimo: id, username, email, legacy_*
--   attestazioni (m.001) — id, id_azienda, id_soa, classifica, dates
--   user_roles (m.036) — id, user_id, ruolo
--
-- Prerequisiti:
--   1. pgloader-easywin.load eseguito (popola legacy.*)
--   2. Migrations 001-037 applicate (in particolare 037: password_hash NULL OK)
--
-- Uso:
--   psql -d easywin_staging -f transform-legacy-anagrafica.sql
-- ============================================================================

\timing on
-- NO ON_ERROR_STOP: vogliamo continuare anche se un singolo step fallisce


-- ============================================================================
-- 1. REFERENCE DATA (regioni, province, soa, criteri, tipologie, piattaforme)
-- ============================================================================
\echo '[1/6] Reference data'

DO $ref$
DECLARE
    info text;
BEGIN
    -- regioni
    BEGIN
        INSERT INTO public.regioni (id, nome)
        SELECT r.id_regione, r.regione FROM legacy.regioni r
        ON CONFLICT (id) DO NOTHING;
    EXCEPTION WHEN OTHERS THEN RAISE WARNING '  regioni: %', SQLERRM; END;

    -- province (FK su regioni)
    BEGIN
        INSERT INTO public.province (id, nome, sigla, id_regione)
        SELECT p.id_provincia, p.provincia, p.siglaprovincia, p.id_regione FROM legacy.province p
        ON CONFLICT (id) DO NOTHING;
    EXCEPTION WHEN OTHERS THEN RAISE WARNING '  province: %', SQLERRM; END;

    -- soa
    BEGIN
        INSERT INTO public.soa (id, codice, descrizione)
        SELECT s.id, s.cod, s.descrizione FROM legacy.soa s
        ON CONFLICT (id) DO NOTHING;
    EXCEPTION WHEN OTHERS THEN RAISE WARNING '  soa: %', SQLERRM; END;

    -- criteri
    BEGIN
        INSERT INTO public.criteri (id, nome)
        SELECT c.id_criterio, c.criterio FROM legacy.criteri c
        ON CONFLICT (id) DO NOTHING;
    EXCEPTION WHEN OTHERS THEN RAISE WARNING '  criteri: %', SQLERRM; END;

    -- tipologia_bandi
    BEGIN
        INSERT INTO public.tipologia_bandi (id, nome)
        SELECT t.id_tipologia_bando, t.tipologia FROM legacy.tipologiabandi t
        ON CONFLICT (id) DO NOTHING;
    EXCEPTION WHEN OTHERS THEN RAISE WARNING '  tipologia_bandi: %', SQLERRM; END;

    -- tipologia_gare
    BEGIN
        INSERT INTO public.tipologia_gare (id, nome)
        SELECT t.id_tipologia, t.tipologia FROM legacy.tipologiagare t
        ON CONFLICT (id) DO NOTHING;
    EXCEPTION WHEN OTHERS THEN RAISE WARNING '  tipologia_gare: %', SQLERRM; END;

    -- piattaforme
    BEGIN
        INSERT INTO public.piattaforme (id, nome)
        SELECT p.id, p.piattaforma FROM legacy.piattaforme p
        ON CONFLICT (id) DO NOTHING;
    EXCEPTION WHEN OTHERS THEN RAISE WARNING '  piattaforme: %', SQLERRM; END;

    -- tipo_dati_gara
    BEGIN
        INSERT INTO public.tipo_dati_gara (id, nome)
        SELECT t.id_tipo, t.tipo FROM legacy.tipodatigara t
        ON CONFLICT (id) DO NOTHING;
    EXCEPTION WHEN OTHERS THEN RAISE WARNING '  tipo_dati_gara: %', SQLERRM; END;

    -- Reset sequenze SERIAL
    FOR info IN VALUES ('regioni'),('province'),('soa'),('criteri'),
                       ('tipologia_bandi'),('tipologia_gare'),('piattaforme'),
                       ('tipo_dati_gara')
    LOOP
        BEGIN
            EXECUTE format(
                'SELECT setval(pg_get_serial_sequence(''public.%s'', ''id''),
                               GREATEST((SELECT COALESCE(MAX(id),1) FROM public.%s),1), true)',
                info, info);
        EXCEPTION WHEN OTHERS THEN NULL; END;
    END LOOP;
END $ref$;


-- ============================================================================
-- 2. stazioni
-- ============================================================================
-- public.stazioni colonne: id, nome, indirizzo, citta, cap, id_provincia,
--   telefono, fax, email, pec, sito_web, codice_fiscale, partita_iva,
--   id_presidia, codice_ausa, attivo
\echo '[2/6] stazioni'

DO $sta$
BEGIN
    INSERT INTO public.stazioni (
        id, nome, indirizzo, citta, cap, id_provincia,
        codice_fiscale, partita_iva, telefono, email, pec, sito_web
    )
    SELECT
        s.id, s.nome, s.indirizzo, s.citta, s.cap, s.id_provincia,
        NULL, s.partitaiva, s.tel, s.email, s.pec, NULL
    FROM legacy.stazioni s
    ON CONFLICT (id) DO NOTHING;

    PERFORM setval(pg_get_serial_sequence('public.stazioni', 'id'),
                   GREATEST((SELECT COALESCE(MAX(id),1) FROM public.stazioni),1), true);

    RAISE NOTICE '  public.stazioni: % righe', (SELECT COUNT(*) FROM public.stazioni);
EXCEPTION WHEN OTHERS THEN RAISE WARNING '  stazioni: %', SQLERRM; END $sta$;


-- ============================================================================
-- 3. aziende
-- ============================================================================
-- public.aziende colonne SOLO esistenti (m.001 base):
--   id, ragione_sociale, partita_iva, codice_fiscale, indirizzo, cap, citta,
--   id_provincia, telefono, fax, email, pec, sito_web, legale_rappresentante,
--   note, attivo
-- Le colonne legacy specifiche (cessata, eliminata, consorzio, regione,
-- username_*) potrebbero esistere via migrations successive — provo con
-- COALESCE alle colonne new se ci sono, altrimenti skip.
\echo '[3/6] aziende'

DO $azi$
BEGIN
    -- Legacy ha sia "azienda" (singolare) che "aziende" (plurale).
    -- Provo prima azienda, fallback su aziende.
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema='legacy' AND table_name='azienda') THEN
        INSERT INTO public.aziende (
            id, ragione_sociale, partita_iva, codice_fiscale,
            indirizzo, cap, citta, id_provincia,
            telefono, email, pec, sito_web, note
        )
        SELECT
            a.id, a.ragionesociale, a.partitaiva, a.codicefiscale,
            a.indirizzo, a.cap, a.citta, a.id_provincia,
            a.telefono, a.email, a.pec, a.sitoweb, a.note
        FROM legacy.azienda a
        ON CONFLICT (id) DO NOTHING;
    ELSIF EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema='legacy' AND table_name='aziende') THEN
        INSERT INTO public.aziende (
            id, ragione_sociale, partita_iva, codice_fiscale,
            indirizzo, cap, citta, id_provincia,
            telefono, email, pec, sito_web, note
        )
        SELECT
            a.id, a.ragionesociale, a.partitaiva, a.codicefiscale,
            a.indirizzo, a.cap, a.citta, a.id_provincia,
            a.telefono, a.email, a.pec, a.sitoweb, a.note
        FROM legacy.aziende a
        ON CONFLICT (id) DO NOTHING;
    END IF;

    PERFORM setval(pg_get_serial_sequence('public.aziende', 'id'),
                   GREATEST((SELECT COALESCE(MAX(id),1) FROM public.aziende),1), true);

    RAISE NOTICE '  public.aziende: % righe', (SELECT COUNT(*) FROM public.aziende);
EXCEPTION WHEN OTHERS THEN RAISE WARNING '  aziende: %', SQLERRM; END $azi$;


-- ============================================================================
-- 4. users (+ legacy password aspnet_Membership)
-- ============================================================================
-- public.users colonne base: id, username, email, password_hash (NULLABLE
-- post-m.037), nome, cognome, id_azienda, ruolo, attivo
-- Più legacy_password, legacy_salt, legacy_format (m.037)
\echo '[4/6] users + legacy passwords'

DO $usr$
BEGIN
    -- Verifico esistenza tabelle legacy
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                   WHERE table_schema='legacy' AND table_name='users') THEN
        RAISE NOTICE '  legacy.users non esiste, skip';
        RETURN;
    END IF;

    -- INSERT con join opzionale su aspnet_membership (LEFT JOIN)
    INSERT INTO public.users (
        username, email, nome, cognome, ruolo,
        legacy_password, legacy_salt, legacy_format
    )
    SELECT
        u.username,
        u.email,
        u.firstname,
        u.lastname,
        NULL::varchar,
        m.password,
        m.passwordsalt,
        m.passwordformat
    FROM legacy.users u
    LEFT JOIN legacy.aspnet_users au ON LOWER(au.username) = LOWER(u.username)
    LEFT JOIN legacy.aspnet_membership m ON au.userid::text = m.userid::text
    WHERE u.username IS NOT NULL AND u.username <> ''
    ON CONFLICT (username) DO UPDATE SET
        legacy_password = COALESCE(public.users.legacy_password, EXCLUDED.legacy_password),
        legacy_salt     = COALESCE(public.users.legacy_salt,     EXCLUDED.legacy_salt),
        legacy_format   = COALESCE(public.users.legacy_format,   EXCLUDED.legacy_format);

    PERFORM setval(pg_get_serial_sequence('public.users', 'id'),
                   GREATEST((SELECT COALESCE(MAX(id),1) FROM public.users),1), true);

    RAISE NOTICE '  public.users: % totale, % con legacy_password',
        (SELECT COUNT(*) FROM public.users),
        (SELECT COUNT(*) FROM public.users WHERE legacy_password IS NOT NULL);
EXCEPTION WHEN OTHERS THEN RAISE WARNING '  users: %', SQLERRM; END $usr$;


-- ============================================================================
-- 5. attestazioni (aziende → SOA)
-- ============================================================================
\echo '[5/6] attestazioni'

DO $att$
BEGIN
    INSERT INTO public.attestazioni (
        id, id_azienda, id_soa, classifica,
        data_rilascio, data_scadenza, organismo
    )
    SELECT
        aa.id,
        aa.id,
        aa.id_soa,
        aa.classifica,
        aa.datarilascio,
        COALESCE(aa.datascadenzaquinq, aa.datascadenzatrienn),
        aa.societaattestatrice
    FROM legacy.attestazioniaziende aa
    WHERE aa.id IS NOT NULL AND aa.id_soa IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.aziende WHERE id = aa.id)
      AND EXISTS (SELECT 1 FROM public.soa     WHERE id = aa.id_soa)
    ON CONFLICT (id) DO NOTHING;

    PERFORM setval(pg_get_serial_sequence('public.attestazioni', 'id'),
                   GREATEST((SELECT COALESCE(MAX(id),1) FROM public.attestazioni),1), true);

    RAISE NOTICE '  public.attestazioni: % righe', (SELECT COUNT(*) FROM public.attestazioni);
EXCEPTION WHEN OTHERS THEN RAISE WARNING '  attestazioni: %', SQLERRM; END $att$;


-- ============================================================================
-- 6. user_roles  ←  aspnet_UsersInRoles
-- ============================================================================
\echo '[6/6] user_roles'

DO $roles$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                   WHERE table_schema='legacy' AND table_name='aspnet_usersinroles') THEN
        RAISE NOTICE '  legacy.aspnet_usersinroles non esiste, skip';
        RETURN;
    END IF;

    INSERT INTO public.user_roles (user_id, ruolo, granted_at, granted_by)
    SELECT
        u.id,
        r.rolename,
        NOW(),
        'migration_anagrafica'
    FROM legacy.aspnet_usersinroles ur
    JOIN legacy.aspnet_users au ON au.userid::text = ur.userid::text
    JOIN legacy.aspnet_roles r  ON r.roleid::text  = ur.roleid::text
    JOIN public.users u         ON LOWER(u.username) = LOWER(au.username)
    ON CONFLICT (user_id, ruolo) DO NOTHING;

    RAISE NOTICE '  public.user_roles: % righe', (SELECT COUNT(*) FROM public.user_roles);
EXCEPTION WHEN OTHERS THEN RAISE WARNING '  user_roles: %', SQLERRM; END $roles$;


-- ============================================================================
-- VERIFICA FINALE
-- ============================================================================
\echo '[FINE] Riepilogo'

DO $final$
BEGIN
    RAISE NOTICE '────────────────────────────────────────';
    RAISE NOTICE 'ANAGRAFICA: REPORT';
    RAISE NOTICE '────────────────────────────────────────';
    RAISE NOTICE '  aziende:                     %', (SELECT COUNT(*) FROM public.aziende);
    RAISE NOTICE '  stazioni:                    %', (SELECT COUNT(*) FROM public.stazioni);
    RAISE NOTICE '  users (totale):              %', (SELECT COUNT(*) FROM public.users);
    RAISE NOTICE '    con legacy_password:       %', (SELECT COUNT(*) FROM public.users WHERE legacy_password IS NOT NULL);
    RAISE NOTICE '  attestazioni:                %', (SELECT COUNT(*) FROM public.attestazioni);
    RAISE NOTICE '  user_roles:                  %', (SELECT COUNT(*) FROM public.user_roles);
    RAISE NOTICE '────────────────────────────────────────';
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Verifica fallita: %', SQLERRM;
END $final$;

VACUUM ANALYZE public.aziende;
VACUUM ANALYZE public.users;
VACUUM ANALYZE public.stazioni;
VACUUM ANALYZE public.attestazioni;

\echo ''
\echo '═══════════════════════════════════════════════════════════════'
\echo 'Anagrafica migrata. Eventuali WARNING sopra = step skippati'
\echo '(colonna mancante in schema legacy). Non bloccanti.'
\echo '═══════════════════════════════════════════════════════════════'
