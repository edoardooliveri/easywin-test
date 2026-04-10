-- ══════════════════════════════════════════════════════════════
-- EasyWin — Seed Dati di Test Realistici
-- Ruoli: admin, agente, intermediario/incaricato, cliente
-- Password per tutti: test123
-- ══════════════════════════════════════════════════════════════

-- Password hash per "test123" (bcrypt)
-- $2a$10$CNo6Qp1ElWWhJqPJ1rkBD.GCuueE.PnvHswSO0YZfx3a.J7BWK14y

-- ══════════════════════════════════════════════════════════════
-- 1. AZIENDE DI TEST
-- ══════════════════════════════════════════════════════════════

INSERT INTO aziende (ragione_sociale, partita_iva, codice_fiscale, indirizzo, citta, id_provincia, cap, telefono, email, pec)
VALUES
  ('Costruzioni Rossi S.r.l.', '01234567890', 'RSSMRA80A01H501Z', 'Via Roma 15', 'Genova', (SELECT id FROM province WHERE nome = 'Genova' LIMIT 1), '16121', '010-555-0101', 'info@costruzionirossi.it', 'costruzionirossi@pec.it'),
  ('Edil Bianchi S.p.A.', '09876543210', 'BNCGPP75B02F205Y', 'Corso Italia 42', 'Milano', (SELECT id FROM province WHERE nome = 'Milano' LIMIT 1), '20122', '02-555-0202', 'info@edilbianchi.it', 'edilbianchi@pec.it'),
  ('Impianti Verdi S.r.l.', '11122233344', 'VRDLGI85C03D969X', 'Via Napoli 8', 'Roma', (SELECT id FROM province WHERE nome = 'Roma' LIMIT 1), '00185', '06-555-0303', 'info@impiantiverdi.it', 'impiantiverdi@pec.it'),
  ('Strade & Ponti S.r.l.', '55566677788', 'STRMRC70D04L219W', 'Via Firenze 22', 'Torino', (SELECT id FROM province WHERE nome = 'Torino' LIMIT 1), '10121', '011-555-0404', 'info@stradeponti.it', 'stradeponti@pec.it'),
  ('Servizi Tecnici Napoli S.r.l.', '99988877766', 'SRVTCN82E05F839V', 'Via Toledo 100', 'Napoli', (SELECT id FROM province WHERE nome = 'Napoli' LIMIT 1), '80134', '081-555-0505', 'info@servizitecnici.it', 'servizitecnici@pec.it')
ON CONFLICT DO NOTHING;

-- ══════════════════════════════════════════════════════════════
-- 2. UTENTI DI TEST (tutti i ruoli del vecchio sistema)
-- ══════════════════════════════════════════════════════════════

-- Ruoli vecchio sistema mappati:
-- Administrator  → ruolo='admin'
-- Agent          → ruolo='agente', ruolo_dettagliato='Agent'
-- Incaricato     → ruolo='incaricato', ruolo_dettagliato='Incaricato'
-- Registered + Bandi + Esiti → ruolo='utente' (cliente standard)
-- ExClient       → ruolo='utente', attivo=false (ex cliente)
-- Publisher/BandiPublisher → ruolo='operatore' (inseritore dati)

INSERT INTO users (username, email, password_hash, nome, cognome, ruolo, ruolo_dettagliato, attivo,
  bandi_enabled, esiti_enabled, esiti_light_enabled, simulazioni_enabled,
  newsletter_bandi, newsletter_esiti,
  data_scadenza, codice_agente, note_admin, id_azienda)
VALUES
  -- ADMIN (accesso completo)
  ('admin', 'admin@easywin.it',
   '$2a$10$CNo6Qp1ElWWhJqPJ1rkBD.GCuueE.PnvHswSO0YZfx3a.J7BWK14y',
   'Paolo', 'Oliveri', 'admin', 'Administrator', true,
   true, true, true, true, true, true,
   '2030-12-31', NULL, 'Amministratore principale', NULL),

  -- AGENTE (gestisce clienti, vede dashboard agente)
  ('agente_marco', 'marco.agente@easywin.it',
   '$2a$10$CNo6Qp1ElWWhJqPJ1rkBD.GCuueE.PnvHswSO0YZfx3a.J7BWK14y',
   'Marco', 'Ferretti', 'agente', 'Agent', true,
   true, true, false, false, false, false,
   '2027-06-30', 'AG001', 'Agente zona Nord-Ovest', NULL),

  -- INCARICATO (simile ad agente ma con meno permessi)
  ('incaricato_anna', 'anna.incaricato@easywin.it',
   '$2a$10$CNo6Qp1ElWWhJqPJ1rkBD.GCuueE.PnvHswSO0YZfx3a.J7BWK14y',
   'Anna', 'Colombo', 'incaricato', 'Incaricato', true,
   true, true, false, false, false, false,
   '2027-03-31', NULL, 'Incaricata aperture e sopralluoghi', NULL),

  -- OPERATORE (inseritore dati / publisher)
  ('operatore_luca', 'luca.operatore@easywin.it',
   '$2a$10$CNo6Qp1ElWWhJqPJ1rkBD.GCuueE.PnvHswSO0YZfx3a.J7BWK14y',
   'Luca', 'Martinelli', 'operatore', 'Publisher', true,
   true, true, false, false, false, false,
   '2027-12-31', NULL, 'Operatore inserimento bandi/esiti', NULL),

  -- CLIENTE COMPLETO (Bandi + Esiti + Simulazioni + Newsletter)
  ('cliente_rossi', 'info@costruzionirossi.it',
   '$2a$10$CNo6Qp1ElWWhJqPJ1rkBD.GCuueE.PnvHswSO0YZfx3a.J7BWK14y',
   'Mario', 'Rossi', 'utente', 'Registered', true,
   true, true, false, true, true, true,
   '2027-07-25', NULL, 'Cliente completo - Bandi+Esiti+Simulazioni',
   (SELECT id FROM aziende WHERE partita_iva = '01234567890' LIMIT 1)),

  -- CLIENTE SOLO BANDI
  ('cliente_bianchi', 'info@edilbianchi.it',
   '$2a$10$CNo6Qp1ElWWhJqPJ1rkBD.GCuueE.PnvHswSO0YZfx3a.J7BWK14y',
   'Giuseppe', 'Bianchi', 'utente', 'Registered', true,
   true, false, false, false, true, false,
   '2027-02-07', NULL, 'Cliente solo Bandi',
   (SELECT id FROM aziende WHERE partita_iva = '09876543210' LIMIT 1)),

  -- CLIENTE SOLO ESITI
  ('cliente_verdi', 'info@impiantiverdi.it',
   '$2a$10$CNo6Qp1ElWWhJqPJ1rkBD.GCuueE.PnvHswSO0YZfx3a.J7BWK14y',
   'Luigi', 'Verdi', 'utente', 'Registered', true,
   false, true, false, false, false, true,
   '2026-12-31', NULL, 'Cliente solo Esiti',
   (SELECT id FROM aziende WHERE partita_iva = '11122233344' LIMIT 1)),

  -- CLIENTE ESITI LIGHT (versione ridotta)
  ('cliente_light', 'info@stradeponti.it',
   '$2a$10$CNo6Qp1ElWWhJqPJ1rkBD.GCuueE.PnvHswSO0YZfx3a.J7BWK14y',
   'Franco', 'Strada', 'utente', 'Registered', true,
   false, false, true, false, false, false,
   '2026-09-30', NULL, 'Cliente Esiti Light',
   (SELECT id FROM aziende WHERE partita_iva = '55566677788' LIMIT 1)),

  -- EX CLIENTE (scaduto, disabilitato)
  ('exclient_napoli', 'info@servizitecnici.it',
   '$2a$10$CNo6Qp1ElWWhJqPJ1rkBD.GCuueE.PnvHswSO0YZfx3a.J7BWK14y',
   'Gennaro', 'De Luca', 'utente', 'ExClient', false,
   false, false, false, false, false, false,
   '2024-06-30', NULL, 'Ex cliente - abbonamento scaduto',
   (SELECT id FROM aziende WHERE partita_iva = '99988877766' LIMIT 1))

ON CONFLICT (username) DO UPDATE SET
  password_hash = EXCLUDED.password_hash,
  nome = EXCLUDED.nome,
  cognome = EXCLUDED.cognome,
  ruolo = EXCLUDED.ruolo,
  ruolo_dettagliato = EXCLUDED.ruolo_dettagliato,
  attivo = EXCLUDED.attivo,
  bandi_enabled = EXCLUDED.bandi_enabled,
  esiti_enabled = EXCLUDED.esiti_enabled,
  esiti_light_enabled = EXCLUDED.esiti_light_enabled,
  simulazioni_enabled = EXCLUDED.simulazioni_enabled,
  newsletter_bandi = EXCLUDED.newsletter_bandi,
  newsletter_esiti = EXCLUDED.newsletter_esiti,
  data_scadenza = EXCLUDED.data_scadenza,
  codice_agente = EXCLUDED.codice_agente,
  note_admin = EXCLUDED.note_admin;

-- ══════════════════════════════════════════════════════════════
-- 3. PERIODI ABBONAMENTO
-- ══════════════════════════════════════════════════════════════

INSERT INTO users_periodi (username, data_inizio, data_fine, tipo, importo_bandi, importo_esiti, importo_simulazioni, attivo)
VALUES
  ('cliente_rossi', '2024-07-25', '2027-07-25', 'annuale', 500.00, 800.00, 300.00, true),
  ('cliente_bianchi', '2022-02-07', '2027-02-07', 'quinquennale', 400.00, 0.00, 0.00, true),
  ('cliente_verdi', '2025-01-01', '2026-12-31', 'biennale', 0.00, 600.00, 0.00, true),
  ('cliente_light', '2025-10-01', '2026-09-30', 'annuale', 0.00, 0.00, 0.00, true),
  ('exclient_napoli', '2023-07-01', '2024-06-30', 'annuale', 300.00, 500.00, 0.00, false)
ON CONFLICT DO NOTHING;

-- ══════════════════════════════════════════════════════════════
-- 4. ASSEGNAZIONI REGIONI PER UTENTI (selezione bandi/esiti)
-- ══════════════════════════════════════════════════════════════

-- Cliente Rossi (Genova) → Liguria, Piemonte, Lombardia
INSERT INTO users_regioni (username, id_regione)
SELECT 'cliente_rossi', id FROM regioni WHERE nome IN ('Liguria', 'Piemonte', 'Lombardia')
ON CONFLICT DO NOTHING;

INSERT INTO users_regioni_bandi (username, id_regione)
SELECT 'cliente_rossi', id FROM regioni WHERE nome IN ('Liguria', 'Piemonte', 'Lombardia')
ON CONFLICT DO NOTHING;

-- Cliente Bianchi (Milano) → Lombardia, Emilia Romagna, Veneto
INSERT INTO users_regioni (username, id_regione)
SELECT 'cliente_bianchi', id FROM regioni WHERE nome IN ('Lombardia', 'Emilia Romagna', 'Veneto')
ON CONFLICT DO NOTHING;

INSERT INTO users_regioni_bandi (username, id_regione)
SELECT 'cliente_bianchi', id FROM regioni WHERE nome IN ('Lombardia', 'Emilia Romagna', 'Veneto')
ON CONFLICT DO NOTHING;

-- Cliente Verdi (Roma) → Lazio, Campania, Toscana
INSERT INTO users_regioni (username, id_regione)
SELECT 'cliente_verdi', id FROM regioni WHERE nome IN ('Lazio', 'Campania', 'Toscana')
ON CONFLICT DO NOTHING;

-- ══════════════════════════════════════════════════════════════
-- 5. STAZIONI APPALTANTI DI TEST
-- ══════════════════════════════════════════════════════════════

INSERT INTO stazioni (nome, indirizzo, citta, id_provincia)
VALUES
  ('Comune di Genova', 'Via Garibaldi 9', 'Genova', (SELECT id FROM province WHERE nome = 'Genova' LIMIT 1)),
  ('Provincia di Milano', 'Via Vivaio 1', 'Milano', (SELECT id FROM province WHERE nome = 'Milano' LIMIT 1)),
  ('ANAS S.p.A. - Compartimento Roma', 'Via Monzambano 10', 'Roma', (SELECT id FROM province WHERE nome = 'Roma' LIMIT 1)),
  ('ASL 3 Genovese', 'Via Bertani 4', 'Genova', (SELECT id FROM province WHERE nome = 'Genova' LIMIT 1)),
  ('Regione Piemonte', 'Piazza Castello 165', 'Torino', (SELECT id FROM province WHERE nome = 'Torino' LIMIT 1))
ON CONFLICT DO NOTHING;

-- ══════════════════════════════════════════════════════════════
-- 6. PIATTAFORME DI TEST (se non esistono)
-- ══════════════════════════════════════════════════════════════

INSERT INTO piattaforme (nome, url)
VALUES
  ('MePA (Consip)', 'https://www.acquistinretepa.it'),
  ('Sintel (ARIA Lombardia)', 'https://www.sintel.regione.lombardia.it'),
  ('START (Regione Toscana)', 'https://start.toscana.it'),
  ('TuttoGare', 'https://www.tuttogare.it'),
  ('Portale Appalti (ANAC)', 'https://portalegare.anticorruzione.it')
ON CONFLICT DO NOTHING;

-- ══════════════════════════════════════════════════════════════
-- 7. BANDI DI TEST
-- ══════════════════════════════════════════════════════════════

INSERT INTO bandi (id, titolo, data_pubblicazione, data_offerta, data_apertura,
  id_stazione, importo_so, id_soa, id_tipologia, id_criterio, id_piattaforma)
VALUES
  (uuid_generate_v4(),
   'Lavori di manutenzione straordinaria strade comunali - Lotto 1',
   '2026-03-15', '2026-04-20', '2026-04-22',
   (SELECT id FROM stazioni WHERE nome LIKE 'Comune di Genova%' LIMIT 1),
   1250000.00,
   (SELECT id FROM soa WHERE codice = 'OG3' LIMIT 1),
   (SELECT id FROM tipologia_gare LIMIT 1),
   (SELECT id FROM criteri LIMIT 1),
   (SELECT id FROM piattaforme WHERE nome LIKE 'MePA%' LIMIT 1)),

  (uuid_generate_v4(),
   'Fornitura e installazione impianti fotovoltaici edifici pubblici',
   '2026-03-20', '2026-04-30', '2026-05-02',
   (SELECT id FROM stazioni WHERE nome LIKE 'Provincia di Milano%' LIMIT 1),
   850000.00,
   (SELECT id FROM soa WHERE codice = 'OG11' LIMIT 1),
   (SELECT id FROM tipologia_gare LIMIT 1 OFFSET 1),
   (SELECT id FROM criteri LIMIT 1),
   (SELECT id FROM piattaforme WHERE nome LIKE 'Sintel%' LIMIT 1)),

  (uuid_generate_v4(),
   'Servizi di progettazione esecutiva ponte sul torrente Bisagno',
   '2026-03-25', '2026-05-10', '2026-05-12',
   (SELECT id FROM stazioni WHERE nome LIKE 'ANAS%' LIMIT 1),
   2300000.00,
   (SELECT id FROM soa WHERE codice = 'OG3' LIMIT 1),
   (SELECT id FROM tipologia_gare LIMIT 1),
   (SELECT id FROM criteri LIMIT 1 OFFSET 1),
   NULL),

  (uuid_generate_v4(),
   'Lavori di ristrutturazione Ospedale San Martino - Padiglione B',
   '2026-02-10', '2026-03-15', '2026-03-17',
   (SELECT id FROM stazioni WHERE nome LIKE 'ASL 3%' LIMIT 1),
   4500000.00,
   (SELECT id FROM soa WHERE codice = 'OG1' LIMIT 1),
   (SELECT id FROM tipologia_gare LIMIT 1),
   (SELECT id FROM criteri LIMIT 1),
   (SELECT id FROM piattaforme WHERE nome LIKE 'TuttoGare%' LIMIT 1)),

  (uuid_generate_v4(),
   'Manutenzione ordinaria edifici scolastici regionali',
   '2026-04-01', '2026-05-15', '2026-05-18',
   (SELECT id FROM stazioni WHERE nome LIKE 'Regione Piemonte%' LIMIT 1),
   780000.00,
   (SELECT id FROM soa WHERE codice = 'OG1' LIMIT 1),
   (SELECT id FROM tipologia_gare LIMIT 1 OFFSET 1),
   (SELECT id FROM criteri LIMIT 1),
   NULL)
ON CONFLICT DO NOTHING;

-- ══════════════════════════════════════════════════════════════
-- 8. GARE (ESITI) DI TEST
-- ══════════════════════════════════════════════════════════════

INSERT INTO gare (titolo, data, importo, n_partecipanti, ribasso, media_ar, soglia_an, media_sc,
  id_stazione, id_soa, id_tipologia, codice_cig, id_vincitore, annullato, id_piattaforma)
VALUES
  ('Manutenzione strade SP 45 - Tratto Genova-Recco',
   '2026-02-28', 890000.00, 12, 18.54321, 19.12345, 17.89012, 1.23456,
   (SELECT id FROM stazioni WHERE nome LIKE 'Comune di Genova%' LIMIT 1),
   (SELECT id FROM soa WHERE codice = 'OG3' LIMIT 1),
   (SELECT id FROM tipologia_gare LIMIT 1),
   'CIG9876543210',
   (SELECT id FROM aziende WHERE partita_iva = '01234567890' LIMIT 1),
   false,
   (SELECT id FROM piattaforme WHERE nome LIKE 'MePA%' LIMIT 1)),

  ('Riqualificazione pavimentazione SR 429 bis Val d''Elsa',
   '2026-01-15', 1500000.00, 8, 22.15678, 21.50000, 19.80000, 1.70000,
   (SELECT id FROM stazioni WHERE nome LIKE 'ANAS%' LIMIT 1),
   (SELECT id FROM soa WHERE codice = 'OG3' LIMIT 1),
   (SELECT id FROM tipologia_gare LIMIT 1),
   'CIG1234509876',
   (SELECT id FROM aziende WHERE partita_iva = '55566677788' LIMIT 1),
   false,
   NULL),

  ('Impianto climatizzazione scuola elementare De Amicis',
   '2026-03-10', 320000.00, 15, 15.78901, 16.50000, 14.20000, 2.30000,
   (SELECT id FROM stazioni WHERE nome LIKE 'Provincia di Milano%' LIMIT 1),
   (SELECT id FROM soa WHERE codice = 'OG11' LIMIT 1),
   (SELECT id FROM tipologia_gare LIMIT 1 OFFSET 1),
   'CIG5555666677',
   (SELECT id FROM aziende WHERE partita_iva = '09876543210' LIMIT 1),
   false,
   (SELECT id FROM piattaforme WHERE nome LIKE 'Sintel%' LIMIT 1)),

  -- Gara NON CONCLUSA (ribasso null)
  ('Consolidamento strutturale viadotto A26 km 12+300',
   '2026-03-28', 6200000.00, 0, NULL, NULL, NULL, NULL,
   (SELECT id FROM stazioni WHERE nome LIKE 'ANAS%' LIMIT 1),
   (SELECT id FROM soa WHERE codice = 'OG3' LIMIT 1),
   (SELECT id FROM tipologia_gare LIMIT 1),
   'CIG8888999900',
   NULL,
   false,
   (SELECT id FROM piattaforme WHERE nome LIKE 'Portale Appalti%' LIMIT 1)),

  ('Rifacimento impermeabilizzazione copertura Padiglione A',
   '2025-11-20', 210000.00, 22, 12.45678, 13.20000, 11.50000, 1.70000,
   (SELECT id FROM stazioni WHERE nome LIKE 'ASL 3%' LIMIT 1),
   (SELECT id FROM soa WHERE codice = 'OG1' LIMIT 1),
   (SELECT id FROM tipologia_gare LIMIT 1),
   'CIG4444333322',
   (SELECT id FROM aziende WHERE partita_iva = '11122233344' LIMIT 1),
   false,
   (SELECT id FROM piattaforme WHERE nome LIKE 'TuttoGare%' LIMIT 1))
ON CONFLICT DO NOTHING;

-- ══════════════════════════════════════════════════════════════
-- 9. DETTAGLIO GARA (graduatorie per gli esiti)
-- ══════════════════════════════════════════════════════════════

-- Graduatoria per prima gara (Manutenzione strade SP 45)
INSERT INTO dettaglio_gara (id_gara, id_azienda, ribasso, posizione, vincitrice, anomala, ammessa)
SELECT g.id, a.id, vals.ribasso, vals.pos, vals.vincitrice, vals.anomala, true
FROM gare g, aziende a,
(VALUES
  ('01234567890', 18.54321, 1, true, false),
  ('09876543210', 19.87654, 2, false, false),
  ('11122233344', 21.12345, 3, false, true),
  ('55566677788', 17.23456, 4, false, false),
  ('99988877766', 15.67890, 5, false, false)
) AS vals(piva, ribasso, pos, vincitrice, anomala)
WHERE g.codice_cig = 'CIG9876543210' AND a.partita_iva = vals.piva
ON CONFLICT DO NOTHING;

-- Graduatoria per terza gara (Impianto climatizzazione)
INSERT INTO dettaglio_gara (id_gara, id_azienda, ribasso, posizione, vincitrice, anomala, ammessa)
SELECT g.id, a.id, vals.ribasso, vals.pos, vals.vincitrice, vals.anomala, true
FROM gare g, aziende a,
(VALUES
  ('09876543210', 15.78901, 1, true, false),
  ('01234567890', 16.54321, 2, false, false),
  ('11122233344', 14.23456, 3, false, false)
) AS vals(piva, ribasso, pos, vincitrice, anomala)
WHERE g.codice_cig = 'CIG5555666677' AND a.partita_iva = vals.piva
ON CONFLICT DO NOTHING;

-- ══════════════════════════════════════════════════════════════
-- 10. TABELLA CONTATTI (per test form contatti)
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS contatti (
  id SERIAL PRIMARY KEY,
  nome VARCHAR(200),
  email VARCHAR(200),
  telefono VARCHAR(50),
  oggetto VARCHAR(500),
  messaggio TEXT,
  data_invio TIMESTAMPTZ DEFAULT NOW(),
  letto BOOLEAN DEFAULT false
);

-- ══════════════════════════════════════════════════════════════
-- 11. SIMULAZIONI DI TEST (per il cliente completo)
-- ══════════════════════════════════════════════════════════════

INSERT INTO simulazioni (titolo, username, id_soa, id_regione, importo, data_inserimento)
VALUES
  ('Test Simulazione OG3 Liguria',
   'cliente_rossi',
   (SELECT id FROM soa WHERE codice = 'OG3' LIMIT 1),
   (SELECT id FROM regioni WHERE nome = 'Liguria' LIMIT 1),
   1000000.00, NOW() - INTERVAL '7 days'),

  ('Simulazione range ribassi OG1',
   'cliente_rossi',
   (SELECT id FROM soa WHERE codice = 'OG1' LIMIT 1),
   (SELECT id FROM regioni WHERE nome = 'Piemonte' LIMIT 1),
   500000.00, NOW() - INTERVAL '3 days')
ON CONFLICT DO NOTHING;

-- Dettagli simulazione (partecipanti)
INSERT INTO simulazioni_dettagli (id_simulazione, ragione_sociale, ribasso, posizione)
SELECT s.id, vals.nome, vals.ribasso, vals.pos
FROM simulazioni s,
(VALUES
  ('Azienda Alpha', 18.500, 1),
  ('Azienda Beta', 19.200, 2),
  ('Azienda Gamma', 17.800, 3),
  ('Azienda Delta', 20.100, 4),
  ('Azienda Epsilon', 16.900, 5),
  ('Azienda Zeta', 21.500, 6),
  ('Azienda Eta', 15.300, 7)
) AS vals(nome, ribasso, pos)
WHERE s.titolo = 'Test Simulazione OG3 Liguria'
ON CONFLICT DO NOTHING;

-- ══════════════════════════════════════════════════════════════
-- FINE SEED
-- ══════════════════════════════════════════════════════════════

-- Riepilogo utenti di test:
-- | Username           | Password | Ruolo       | Accesso a                          |
-- |--------------------|----------|-------------|------------------------------------|
-- | admin              | test123  | admin       | Tutto (gestionale + clienti)       |
-- | agente_marco       | test123  | agente      | Gestionale (propri clienti)        |
-- | incaricato_anna    | test123  | incaricato  | Gestionale (aperture/sopralluoghi) |
-- | operatore_luca     | test123  | operatore   | Gestionale (inserimento dati)      |
-- | cliente_rossi      | test123  | utente      | Clienti (Bandi+Esiti+Simulazioni)  |
-- | cliente_bianchi    | test123  | utente      | Clienti (solo Bandi)               |
-- | cliente_verdi      | test123  | utente      | Clienti (solo Esiti)               |
-- | cliente_light      | test123  | utente      | Clienti (solo Esiti Light)         |
-- | exclient_napoli    | test123  | utente      | BLOCCATO (ex cliente scaduto)      |
