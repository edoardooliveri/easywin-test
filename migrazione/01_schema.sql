-- =============================================================
-- EasyWin PostgreSQL Schema - Migrazione da SQL Server
-- Creato automaticamente dall'analisi del database originale
-- =============================================================

-- Estensioni necessarie
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- =============================================================
-- TABELLE DI LOOKUP/RIFERIMENTO
-- =============================================================

CREATE TABLE regioni (
    id_regione INTEGER PRIMARY KEY,
    regione VARCHAR(100),
    posizione VARCHAR(50)
);

CREATE TABLE province (
    id_provincia INTEGER PRIMARY KEY,
    provincia VARCHAR(100),
    id_regione INTEGER REFERENCES regioni(id_regione),
    siglaprovincia CHAR(2),
    lat DOUBLE PRECISION,
    lon DOUBLE PRECISION,
    id_istat INTEGER
);

CREATE TABLE comuni (
    id INTEGER PRIMARY KEY,
    nome VARCHAR(200),
    id_provincia INTEGER REFERENCES province(id_provincia),
    cap VARCHAR(10),
    lat DOUBLE PRECISION,
    lon DOUBLE PRECISION,
    id_istat INTEGER,
    regione VARCHAR(100)
);

CREATE TABLE soa (
    id INTEGER PRIMARY KEY,
    cod VARCHAR(10),
    descrizione TEXT,
    tipologia VARCHAR(50),
    alias VARCHAR(10),
    old_cod VARCHAR(10)
);

CREATE TABLE attestazioni (
    id_attestazione INTEGER PRIMARY KEY,
    attestazione VARCHAR(200),
    importo DECIMAL(18,4),
    alias VARCHAR(50)
);

CREATE TABLE criteri (
    id_criterio INTEGER PRIMARY KEY,
    criterio TEXT,
    priority INTEGER,
    visible_to_user INTEGER
);

CREATE TABLE tipo_dati_gara (
    id INTEGER PRIMARY KEY,
    tipo VARCHAR(200),
    priority INTEGER
);

CREATE TABLE tipologia_bandi (
    id_tipologia_bando INTEGER PRIMARY KEY,
    tipologia TEXT,
    priority INTEGER,
    visible_to_user INTEGER
);

CREATE TABLE tipologia_gare (
    id_tipologia INTEGER PRIMARY KEY,
    tipologia TEXT,
    priority INTEGER,
    hidden INTEGER,
    visible_to_user INTEGER
);

CREATE TABLE soa_corrispondenze (
    id_soa_old INTEGER,
    id_soa_new INTEGER,
    note TEXT
);

CREATE TABLE piattaforme (
    id INTEGER PRIMARY KEY,
    nome VARCHAR(200),
    url TEXT,
    regione VARCHAR(100),
    note TEXT
);

-- =============================================================
-- TABELLE AZIENDE E STAZIONI
-- =============================================================

CREATE TABLE stazioni (
    id INTEGER PRIMARY KEY,
    ragione_sociale TEXT,
    nome TEXT,
    indirizzo TEXT,
    cap VARCHAR(10),
    citta VARCHAR(200),
    id_provincia INTEGER REFERENCES province(id_provincia),
    tel VARCHAR(50),
    partita_iva VARCHAR(20),
    cod VARCHAR(50),
    cod2 VARCHAR(50),
    cod3 VARCHAR(50),
    pubblicazione_esito TEXT,
    pubblicazione_bando TEXT,
    username VARCHAR(100),
    eliminata INTEGER DEFAULT 0,
    lat DOUBLE PRECISION,
    lon DOUBLE PRECISION,
    email VARCHAR(200),
    note TEXT,
    tipo_pubblicazione_esito TEXT,
    giorni_alert_pubblicazione INTEGER,
    limita_range INTEGER DEFAULT 0,
    obsoleta INTEGER DEFAULT 0,
    id_piattaforma_digitale INTEGER,
    note_pubblicazione TEXT
);

CREATE TABLE aziende (
    id INTEGER PRIMARY KEY,
    ragione_sociale TEXT,
    nome TEXT,
    indirizzo TEXT,
    cap VARCHAR(10),
    citta VARCHAR(200),
    id_provincia INTEGER REFERENCES province(id_provincia),
    tel VARCHAR(50),
    partita_iva VARCHAR(20),
    email VARCHAR(200),
    note TEXT,
    cod VARCHAR(50),
    username VARCHAR(100),
    eliminata INTEGER DEFAULT 0,
    send_email INTEGER DEFAULT 0,
    last_email_send TIMESTAMP,
    codice_fiscale VARCHAR(20),
    ccia VARCHAR(50),
    iscrizione_ccia TEXT,
    tipologia_attestazione VARCHAR(100),
    soc_attestatrice_soa VARCHAR(200),
    numero_soa VARCHAR(50),
    data_rilascio_attestazione_originaria TIMESTAMP,
    validita_triennale TIMESTAMP,
    validita_quinquennale TIMESTAMP,
    old_name TEXT,
    id_concorrente INTEGER,
    prezzo_bandi DECIMAL(18,4),
    prezzo_esiti DECIMAL(18,4),
    prezzo_bundle DECIMAL(18,4),
    scadenza_esiti TIMESTAMP,
    scadenza_bandi TIMESTAMP,
    scadenza_bundle TIMESTAMP,
    username_responsabile VARCHAR(100),
    referente VARCHAR(200),
    telefono_referente VARCHAR(50),
    stato_non_interessato INTEGER DEFAULT 0,
    data_non_interessato TIMESTAMP,
    username_non_interessato VARCHAR(100),
    note_non_interessato TEXT,
    nascondi_stato INTEGER DEFAULT 0,
    cessata INTEGER DEFAULT 0,
    codice_sdi VARCHAR(20),
    indirizzo_pec VARCHAR(200),
    abbonato_sopralluoghi INTEGER DEFAULT 0,
    abbonato_aperture INTEGER DEFAULT 0,
    presente_documento_delega INTEGER DEFAULT 0,
    presente_documento_identita INTEGER DEFAULT 0,
    presente_documento_soa INTEGER DEFAULT 0,
    presente_documento_cciaa INTEGER DEFAULT 0,
    data_scadenza_delega TIMESTAMP,
    data_scadenza_identita TIMESTAMP,
    data_scadenza_soa TIMESTAMP,
    data_scadenza_cciaa TIMESTAMP,
    documento_delega TEXT,
    documento_identita TEXT,
    documento_soa TEXT,
    documento_cciaa TEXT,
    consorzio INTEGER DEFAULT 0,
    data_creazione TIMESTAMP,
    data_modifica TIMESTAMP,
    data_iscrizione_ccia TIMESTAMP,
    iso_scadenza TIMESTAMP,
    iso_rilasciato_da VARCHAR(200),
    data_rilascio_attestazione_in_corso TIMESTAMP,
    data_verifica_triennale TIMESTAMP
);

CREATE INDEX idx_aziende_partita_iva ON aziende(partita_iva);
CREATE INDEX idx_aziende_codice_fiscale ON aziende(codice_fiscale);
CREATE INDEX idx_aziende_ragione_sociale_trgm ON aziende USING gin(ragione_sociale gin_trgm_ops);

CREATE TABLE concorrenti (
    id INTEGER PRIMARY KEY,
    ragione_sociale TEXT,
    nome TEXT,
    indirizzo TEXT,
    cap VARCHAR(10),
    citta VARCHAR(200),
    id_provincia INTEGER REFERENCES province(id_provincia),
    tel VARCHAR(50),
    email VARCHAR(200),
    partita_iva VARCHAR(20),
    codice_fiscale VARCHAR(20),
    note TEXT,
    persona_riferimento VARCHAR(200),
    prezzo_bandi DECIMAL(18,4),
    prezzo_esiti DECIMAL(18,4),
    prezzo_bundle DECIMAL(18,4)
);

CREATE TABLE consorzi (
    id_consorzio INTEGER REFERENCES aziende(id),
    id_componente INTEGER REFERENCES aziende(id),
    data TIMESTAMP
);

CREATE TABLE attestazioni_aziende (
    id_azienda INTEGER REFERENCES aziende(id),
    id_soa INTEGER REFERENCES soa(id),
    id_attestazione INTEGER REFERENCES attestazioni(id_attestazione),
    anno INTEGER,
    username VARCHAR(100),
    data_inserimento TIMESTAMP
);

CREATE TABLE azienda_personale (
    id_azienda INTEGER,
    id_soa INTEGER,
    id_attestazione INTEGER,
    anno INTEGER,
    username VARCHAR(100),
    data_inserimento TIMESTAMP
);

CREATE TABLE modifiche_azienda (
    id_azienda INTEGER,
    username VARCHAR(100),
    data TIMESTAMP,
    modifiche TEXT
);

CREATE TABLE note_aziende (
    id_azienda INTEGER,
    username VARCHAR(100),
    data TIMESTAMP,
    nota TEXT,
    tipo VARCHAR(50)
);

-- =============================================================
-- TABELLE BANDI
-- =============================================================

CREATE TABLE bandi (
    id_bando UUID PRIMARY KEY,
    id_stazione INTEGER REFERENCES stazioni(id),
    stazione TEXT,
    data_pubblicazione TIMESTAMP,
    titolo TEXT,
    id_soa INTEGER REFERENCES soa(id),
    soa_val VARCHAR(20),
    categoria_presunta VARCHAR(50),
    categoria_sostitutiva VARCHAR(50),
    cap VARCHAR(10),
    citta VARCHAR(200),
    indirizzo TEXT,
    data_sop_start TIMESTAMP,
    data_sop_end TIMESTAMP,
    data_offerta TIMESTAMP,
    data_apertura TIMESTAMP,
    importo_so DECIMAL(18,4),
    importo_co DECIMAL(18,4),
    importo_eco DECIMAL(18,4),
    oneri_progettazione DECIMAL(18,4),
    n_decimali INTEGER,
    id_tipologia INTEGER REFERENCES tipologia_gare(id_tipologia),
    id_criterio INTEGER REFERENCES criteri(id_criterio),
    id_tipologia_bando INTEGER REFERENCES tipologia_bandi(id_tipologia_bando),
    limit_min_media INTEGER DEFAULT 0,
    accorpa_ali INTEGER DEFAULT 0,
    data_inserimento TIMESTAMP,
    inserito_da VARCHAR(100),
    tipo_prenotazione INTEGER,
    esecutore_sl VARCHAR(100),
    esecutore_pv VARCHAR(100),
    privato INTEGER DEFAULT 0,
    provenienza VARCHAR(100),
    external_code VARCHAR(100),
    fonte_dati VARCHAR(200),
    note TEXT,
    data_modifica TIMESTAMP,
    modificato_da VARCHAR(100),
    tipo_accorpa_ali VARCHAR(50),
    tipo_dati_esito VARCHAR(50),
    codice_cig VARCHAR(20),
    id_piattaforma_digitale INTEGER,
    id_tipo_sopralluogo INTEGER,
    id_tipo_spedizione INTEGER,
    data_max_per_prenotazione TIMESTAMP,
    note_per_sopralluogo TEXT,
    note01 TEXT,
    note02 TEXT,
    note03 TEXT,
    note04 TEXT,
    note05 TEXT,
    sped_pec INTEGER DEFAULT 0,
    sped_posta INTEGER DEFAULT 0,
    sped_corriere INTEGER DEFAULT 0,
    sped_mano INTEGER DEFAULT 0,
    sped_telematica INTEGER DEFAULT 0,
    data_max_per_sopralluogo TIMESTAMP,
    indirizzo_pec VARCHAR(200),
    max_invitati_negoziate INTEGER,
    indirizzo_elaborati TEXT,
    annullato INTEGER DEFAULT 0,
    comunicazione_diretta_data TIMESTAMP,
    codice_cup VARCHAR(30),
    data_apertura_posticipata TIMESTAMP,
    data_apertura_da_destinarsi INTEGER DEFAULT 0,
    data_avviso TIMESTAMP,
    creatore_avviso VARCHAR(100),
    data_controllo TIMESTAMP,
    username_controllo VARCHAR(100),
    note_controllo TEXT,
    ora_avviso VARCHAR(20),
    note_avviso TEXT,
    username_avviso VARCHAR(100),
    importo_soa_prevalente DECIMAL(18,4),
    importo_soa_sostitutiva DECIMAL(18,4),
    soglia_riferimento VARCHAR(50),
    importo_manodopera DECIMAL(18,4),
    regione VARCHAR(100)
);

CREATE INDEX idx_bandi_titolo_trgm ON bandi USING gin(titolo gin_trgm_ops);
CREATE INDEX idx_bandi_codice_cig ON bandi(codice_cig);
CREATE INDEX idx_bandi_id_stazione ON bandi(id_stazione);
CREATE INDEX idx_bandi_id_soa ON bandi(id_soa);
CREATE INDEX idx_bandi_data_pubblicazione ON bandi(data_pubblicazione);

CREATE TABLE bandi_province (
    id_bando UUID REFERENCES bandi(id_bando),
    id_provincia INTEGER REFERENCES province(id_provincia)
);
CREATE INDEX idx_bandi_province_bando ON bandi_province(id_bando);

CREATE TABLE bandi_soa_sec (
    id_bando UUID REFERENCES bandi(id_bando),
    id_soa INTEGER REFERENCES soa(id),
    soa_val VARCHAR(20),
    importo DECIMAL(18,4)
);
CREATE INDEX idx_bandi_soa_sec_bando ON bandi_soa_sec(id_bando);

CREATE TABLE bandi_soa_alt (
    id_bando UUID REFERENCES bandi(id_bando),
    id_soa INTEGER REFERENCES soa(id),
    soa_val VARCHAR(20),
    importo DECIMAL(18,4)
);

CREATE TABLE bandi_soa_app (
    id_bando UUID REFERENCES bandi(id_bando),
    id_soa INTEGER REFERENCES soa(id),
    soa_val VARCHAR(20),
    importo DECIMAL(18,4)
);

CREATE TABLE bandi_modifiche (
    id_bando UUID REFERENCES bandi(id_bando),
    username VARCHAR(100),
    data TIMESTAMP,
    modifiche TEXT
);

CREATE TABLE bandi_probabilita (
    id_bando UUID,
    id_gara INTEGER,
    tipo_elaborazione INTEGER,
    data_gara TIMESTAMP,
    id_stazione_gara INTEGER,
    tipo VARCHAR(10),
    range_min DOUBLE PRECISION,
    range_max DOUBLE PRECISION
);

CREATE TABLE allegati_bando (
    id_bando UUID REFERENCES bandi(id_bando),
    nome_file TEXT,
    documento TEXT,
    path TEXT,
    last_update TIMESTAMP,
    username VARCHAR(100),
    user_type VARCHAR(50)
);
CREATE INDEX idx_allegati_bando ON allegati_bando(id_bando);

-- =============================================================
-- TABELLE GARE (ESITI)
-- =============================================================

CREATE TABLE gare (
    id INTEGER PRIMARY KEY,
    data TIMESTAMP,
    cap VARCHAR(10),
    citta VARCHAR(200),
    indirizzo TEXT,
    id_stazione INTEGER REFERENCES stazioni(id),
    titolo TEXT,
    n_partecipanti INTEGER,
    importo DECIMAL(18,4),
    id_soa INTEGER REFERENCES soa(id),
    soa_val VARCHAR(20),
    n_sorteggio INTEGER,
    id_vincitore INTEGER,
    media_ar DOUBLE PRECISION,
    soglia_an DOUBLE PRECISION,
    s_soglia_an DOUBLE PRECISION,
    media_sc DOUBLE PRECISION,
    ribasso DOUBLE PRECISION,
    id_tipologia INTEGER REFERENCES tipologia_gare(id_tipologia),
    id_tipo_dati_gara INTEGER REFERENCES tipo_dati_gara(id),
    n_decimali INTEGER,
    data_inserimento TIMESTAMP,
    data_modifica TIMESTAMP,
    data_abilitazione TIMESTAMP,
    username VARCHAR(100),
    username_modifica VARCHAR(100),
    enabled INTEGER DEFAULT 0,
    eliminata INTEGER DEFAULT 0,
    temp INTEGER DEFAULT 0,
    lat DOUBLE PRECISION,
    lon DOUBLE PRECISION,
    enable_to_all INTEGER DEFAULT 0,
    limit_min_media INTEGER DEFAULT 0,
    accorpa_ali INTEGER DEFAULT 0,
    id_bando UUID,
    note TEXT,
    note_interne TEXT,
    tipo VARCHAR(50),
    variante VARCHAR(20),
    tipo_accorpa_ali VARCHAR(50),
    ali_in_somma_ribassi INTEGER DEFAULT 0,
    tipo_calcolo VARCHAR(50),
    codice_cig VARCHAR(20),
    id_piattaforma_digitale INTEGER,
    max_invitati_negoziate INTEGER,
    sc_offerte_ammesse INTEGER DEFAULT 0,
    sc_rapporto_scarto_media DOUBLE PRECISION,
    sc_seconda_soglia DOUBLE PRECISION,
    sc_primo_dec INTEGER,
    sc_secondo_dec INTEGER,
    sc_tipo_calcolo VARCHAR(50),
    bloccato INTEGER DEFAULT 0,
    media_ar2 DOUBLE PRECISION,
    soglia_an2 DOUBLE PRECISION,
    media_sc2 DOUBLE PRECISION,
    s_soglia_an2 DOUBLE PRECISION,
    ribasso2 DOUBLE PRECISION,
    id_vincitore2 INTEGER,
    sc_rapporto_scarto_media2 DOUBLE PRECISION,
    sc_seconda_soglia2 DOUBLE PRECISION,
    tipo_arrotondamento VARCHAR(50),
    data_reperimento TIMESTAMP,
    fonte_reperimento VARCHAR(200),
    username_reperimento VARCHAR(100),
    id_azienda_reperimento INTEGER,
    controllo INTEGER DEFAULT 0,
    data_aggiudicazione_definitiva TIMESTAMP,
    data_firma_contratto TIMESTAMP,
    annullato INTEGER DEFAULT 0,
    importo_soa_prevalente DECIMAL(18,4),
    soglia_riferimento VARCHAR(50)
);

CREATE INDEX idx_gare_titolo_trgm ON gare USING gin(titolo gin_trgm_ops);
CREATE INDEX idx_gare_codice_cig ON gare(codice_cig);
CREATE INDEX idx_gare_id_stazione ON gare(id_stazione);
CREATE INDEX idx_gare_id_soa ON gare(id_soa);
CREATE INDEX idx_gare_data ON gare(data);
CREATE INDEX idx_gare_id_bando ON gare(id_bando);

CREATE TABLE dettaglio_gara (
    id_gara INTEGER REFERENCES gare(id),
    variante VARCHAR(20),
    id_azienda INTEGER,
    ati_avv VARCHAR(10),
    posizione INTEGER,
    ribasso DOUBLE PRECISION,
    taglio_ali INTEGER DEFAULT 0,
    m_media_arit INTEGER DEFAULT 0,
    anomala INTEGER DEFAULT 0,
    vincitrice INTEGER DEFAULT 0,
    ammessa INTEGER DEFAULT 0,
    ammessa_riserva INTEGER DEFAULT 0,
    esclusa INTEGER DEFAULT 0,
    note TEXT,
    insert_position INTEGER,
    da_verificare INTEGER DEFAULT 0,
    sconosciuto INTEGER DEFAULT 0,
    pari_merito INTEGER DEFAULT 0,
    id_azienda_esecutrice1 INTEGER,
    id_azienda_esecutrice2 INTEGER,
    id_azienda_esecutrice3 INTEGER,
    id_azienda_esecutrice4 INTEGER,
    id_azienda_esecutrice5 INTEGER
);

CREATE INDEX idx_dettaglio_gara_gara ON dettaglio_gara(id_gara);
CREATE INDEX idx_dettaglio_gara_azienda ON dettaglio_gara(id_azienda);
CREATE INDEX idx_dettaglio_gara_variante ON dettaglio_gara(id_gara, variante);

CREATE TABLE ati_gare_01 (
    id_gara INTEGER REFERENCES gare(id),
    variante VARCHAR(20),
    id_mandataria INTEGER,
    id_mandante INTEGER,
    avvalimento INTEGER DEFAULT 0,
    ati INTEGER DEFAULT 0,
    da_verificare INTEGER DEFAULT 0,
    inserimento VARCHAR(50),
    id_azienda_esecutrice1 INTEGER,
    id_azienda_esecutrice2 INTEGER,
    id_azienda_esecutrice3 INTEGER,
    id_azienda_esecutrice4 INTEGER,
    id_azienda_esecutrice5 INTEGER
);
CREATE INDEX idx_ati_gare_01_gara ON ati_gare_01(id_gara);

CREATE TABLE punteggi (
    id_punteggio INTEGER PRIMARY KEY,
    id_gara INTEGER REFERENCES gare(id),
    variante VARCHAR(20),
    id_azienda INTEGER,
    descrizione TEXT,
    punteggio DOUBLE PRECISION,
    punteggio_max DOUBLE PRECISION,
    insert_date TIMESTAMP,
    priority INTEGER
);
CREATE INDEX idx_punteggi_gara ON punteggi(id_gara);

CREATE TABLE gare_province (
    id_gara INTEGER REFERENCES gare(id),
    id_provincia INTEGER REFERENCES province(id_provincia)
);
CREATE INDEX idx_gare_province_gara ON gare_province(id_gara);

CREATE TABLE gare_soa_sec (
    id_gara INTEGER,
    variante VARCHAR(20),
    id_soa INTEGER,
    soa_val VARCHAR(20),
    importo DECIMAL(18,4)
);
CREATE INDEX idx_gare_soa_sec_gara ON gare_soa_sec(id_gara);

CREATE TABLE gare_soa_alt (
    id_gara INTEGER,
    variante VARCHAR(20),
    id_soa INTEGER,
    soa_val VARCHAR(20),
    importo DECIMAL(18,4)
);

CREATE TABLE gare_soa_app (
    id_gara INTEGER,
    variante VARCHAR(20),
    id_soa INTEGER,
    soa_val VARCHAR(20),
    importo DECIMAL(18,4)
);

CREATE TABLE gare_soa_sost (
    id_gara INTEGER,
    variante VARCHAR(20),
    id_soa INTEGER,
    id INTEGER,
    soa_id INTEGER,
    id_attestazione INTEGER,
    soa_val VARCHAR(20),
    importo DECIMAL(18,4)
);

CREATE TABLE gare_invii (
    id_gara INTEGER REFERENCES gare(id),
    variante VARCHAR(20),
    data TIMESTAMP,
    username VARCHAR(100)
);

CREATE TABLE gare_ricorsi (
    codice_cig VARCHAR(20),
    id_esito INTEGER,
    id_azienda INTEGER,
    importo_netto DECIMAL(18,4),
    ribasso DOUBLE PRECISION,
    importo_oneri DECIMAL(18,4),
    percentuale DOUBLE PRECISION,
    importo_risultante DECIMAL(18,4),
    importo_concordato DECIMAL(18,4),
    flag_azienda_contattata INTEGER DEFAULT 0,
    data_azienda_contattata TIMESTAMP,
    metodo_azienda_contattata TEXT,
    flag_esito_del_contatto INTEGER DEFAULT 0,
    flag_lettera_incarico_inviata INTEGER DEFAULT 0,
    data_lettera_incarico_inviata TIMESTAMP,
    flag_lettera_incarico_ricevuta INTEGER DEFAULT 0,
    data_lettera_incarico_ricevuta TIMESTAMP,
    flag_lettera_ricorso_inviata_ad_azienda INTEGER DEFAULT 0,
    data_lettera_ricorso_inviata_ad_azienda TIMESTAMP,
    flag_lettera_inviata_alla_stazione INTEGER DEFAULT 0,
    data_lettera_inviata_alla_stazione TIMESTAMP,
    flag_risposta_stazione INTEGER DEFAULT 0,
    data_risposta_stazione TIMESTAMP,
    flag_riconvocazione_seduta_gara INTEGER DEFAULT 0,
    data_riconvocazione_seduta_gara TIMESTAMP,
    flag_esito_del_ricorso INTEGER DEFAULT 0,
    data_esito_del_ricorso TIMESTAMP,
    acconto DECIMAL(18,4),
    data_acconto TIMESTAMP,
    saldo DECIMAL(18,4),
    data_saldo TIMESTAMP,
    stato_pagamento VARCHAR(50),
    motivazione_ricorso TEXT,
    note_azienda_contattata TEXT,
    note_esito_del_contatto TEXT,
    note_lettera_incarico_inviata TEXT,
    note_lettera_incarico_ricevuta TEXT,
    note_lettera_ricorso_inviata_azienda TEXT,
    note_lettera_ricorso_inviata_stazione TEXT,
    note_risposta_stazione TEXT,
    note_riconvocazione_gara TEXT,
    note_esito_ricorso TEXT
);

CREATE TABLE assistenti_gara (
    id_gara INTEGER,
    variante VARCHAR(20),
    id_azienda INTEGER,
    username VARCHAR(100),
    data TIMESTAMP,
    note TEXT
);

CREATE TABLE registro_gare (
    id_bando UUID,
    username VARCHAR(100),
    note TEXT,
    data_inserimento TIMESTAMP
);

-- =============================================================
-- TABELLE SIMULAZIONI
-- =============================================================

CREATE TABLE simulazioni (
    id UUID PRIMARY KEY,
    titolo TEXT,
    username VARCHAR(100),
    data_inserimento TIMESTAMP,
    stazione TEXT,
    oggetto TEXT,
    id_soa INTEGER,
    data_min TIMESTAMP,
    data_max TIMESTAMP,
    importo_min DECIMAL(18,4),
    importo_max DECIMAL(18,4),
    id_regione INTEGER,
    id_provincia INTEGER,
    id_tipologia INTEGER,
    id_tipo_sim INTEGER,
    id_vincitore INTEGER,
    vincitore TEXT,
    media_ar DOUBLE PRECISION,
    soglia_an DOUBLE PRECISION,
    s_soglia_an DOUBLE PRECISION,
    media_sc DOUBLE PRECISION,
    ribasso DOUBLE PRECISION,
    n_gare INTEGER,
    n_partecipanti INTEGER,
    n_sorteggio INTEGER,
    n_decimali INTEGER,
    accorpa_ali INTEGER DEFAULT 0,
    mode_offset INTEGER,
    tipo_accorpa_ali VARCHAR(50),
    variante VARCHAR(20),
    ali_in_somma_ribassi INTEGER DEFAULT 0,
    modificato INTEGER DEFAULT 0,
    sc_offerte_ammesse INTEGER DEFAULT 0,
    sc_rapporto_scarto_media DOUBLE PRECISION,
    sc_seconda_soglia DOUBLE PRECISION,
    sc_primo_dec INTEGER,
    sc_secondo_dec INTEGER,
    sc_tipo_calcolo VARCHAR(50),
    limit_min_media INTEGER DEFAULT 0,
    esito TEXT,
    codice_cig VARCHAR(20),
    id_attestazione INTEGER,
    data TIMESTAMP,
    importo DECIMAL(18,4),
    id_tipo_dati_gara INTEGER,
    tipo_arrotondamento VARCHAR(50),
    tipo_calcolo VARCHAR(50),
    soglia_riferimento VARCHAR(50)
);

CREATE TABLE simulazioni_dettagli (
    id_simulazione UUID REFERENCES simulazioni(id),
    variante VARCHAR(20),
    id_azienda INTEGER,
    ragione_sociale TEXT,
    ribasso DOUBLE PRECISION,
    taglio_ali INTEGER DEFAULT 0,
    m_media_arit INTEGER DEFAULT 0,
    anomala INTEGER DEFAULT 0,
    vincitrice INTEGER DEFAULT 0,
    posizione INTEGER,
    n_partecipate INTEGER,
    esclusione INTEGER DEFAULT 0,
    note TEXT,
    id_provincia INTEGER
);
CREATE INDEX idx_sim_dettagli_sim ON simulazioni_dettagli(id_simulazione);

CREATE TABLE simulazioni_gare (
    id_simulazione UUID REFERENCES simulazioni(id),
    id_gara INTEGER,
    variante VARCHAR(20),
    soglia_anomalia DOUBLE PRECISION,
    s_soglia_anomalia DOUBLE PRECISION
);
CREATE INDEX idx_sim_gare_sim ON simulazioni_gare(id_simulazione);

CREATE TABLE simulazione_pesi (
    id_simulazione UUID REFERENCES simulazioni(id),
    variante VARCHAR(20),
    classificata DOUBLE PRECISION,
    taglio_ali DOUBLE PRECISION,
    m_m_aritmetica DOUBLE PRECISION,
    anomala DOUBLE PRECISION,
    vincitrice DOUBLE PRECISION
);

CREATE TABLE simulazioni_province (
    id_simulazione UUID,
    id_provincia INTEGER
);

CREATE TABLE simulazioni_soa_sec (
    id_simulazione UUID,
    id_soa INTEGER,
    soa_val VARCHAR(20)
);

CREATE TABLE simulazioni_tipologie (
    id_simulazione UUID,
    id_tipologia INTEGER
);

-- =============================================================
-- TABELLE SOPRALLUOGHI
-- =============================================================

CREATE TABLE sopralluoghi (
    id_visione UUID PRIMARY KEY,
    id_bando UUID,
    data_sopralluogo TIMESTAMP,
    prenotato INTEGER DEFAULT 0,
    tipo_prenotazione INTEGER,
    fax VARCHAR(50),
    telefono VARCHAR(50),
    email VARCHAR(200),
    username VARCHAR(100),
    indirizzo TEXT,
    cap VARCHAR(10),
    id_provincia INTEGER,
    citta VARCHAR(200),
    id_azienda INTEGER,
    note TEXT,
    data_inserimento TIMESTAMP,
    inserito_da VARCHAR(100),
    data_modifica TIMESTAMP,
    modificato_da VARCHAR(100),
    presa_visione INTEGER DEFAULT 0,
    data_richiesta TIMESTAMP,
    riferimento_azienda_richiedente TEXT,
    riferimento_intermediario_richiedente TEXT,
    riferimento_intermediario_esecutore TEXT,
    gestore_richiesta VARCHAR(100),
    id_intermediario_richiedente INTEGER,
    id_intermediario_esecutore INTEGER,
    id_tipo_esecutore INTEGER,
    id_esecutore_esterno INTEGER,
    richiesta INTEGER DEFAULT 0,
    esecuzione INTEGER DEFAULT 0,
    pagato_da_azienda_a_edra INTEGER DEFAULT 0,
    imponibile_da_azienda_a_edra DECIMAL(18,4),
    iva_da_azienda_a_edra DECIMAL(18,4),
    totale_da_azienda_a_edra DECIMAL(18,4),
    data_pagamento_da_azienda_a_edra TIMESTAMP,
    pagato_da_edra_al_gestore_chiamata INTEGER DEFAULT 0,
    imponibile_da_edra_a_gestore_chiamata DECIMAL(18,4),
    iva_da_edra_a_gestore_chiamata DECIMAL(18,4),
    totale_da_edra_a_gestore_chiamata DECIMAL(18,4),
    data_pagamento_da_edra_a_gestore_chiamata TIMESTAMP,
    pagato_da_edra_a_collaboratore INTEGER DEFAULT 0,
    imponibile_da_edra_a_collaboratore DECIMAL(18,4),
    iva_da_edra_a_collaboratore DECIMAL(18,4),
    totale_da_edra_a_collaboratore DECIMAL(18,4),
    data_pagamento_da_edra_a_collaboratore TIMESTAMP,
    pagato_da_edra_a_intermediari INTEGER DEFAULT 0,
    imponibile_da_edra_a_intermediari DECIMAL(18,4),
    iva_da_edra_a_intermediari DECIMAL(18,4),
    totale_da_edra_a_intermediari DECIMAL(18,4),
    data_pagamento_da_edra_a_intermediari TIMESTAMP,
    pagato_da_intermediari_a_edra INTEGER DEFAULT 0,
    imponibile_da_intermediari_a_edra DECIMAL(18,4),
    iva_da_intermediari_a_edra DECIMAL(18,4),
    totale_da_intermediari_a_edra DECIMAL(18,4),
    data_pagamento_da_intermediari_a_edra TIMESTAMP,
    data_prenotazione TIMESTAMP,
    proforma_inviato INTEGER DEFAULT 0,
    fattura_elettronica_generata INTEGER DEFAULT 0,
    eseguito INTEGER DEFAULT 0,
    annullato INTEGER DEFAULT 0,
    num_ati INTEGER,
    id_azienda_ati01 INTEGER,
    id_azienda_ati02 INTEGER,
    id_azienda_ati03 INTEGER,
    id_azienda_ati04 INTEGER,
    azienda_abbonata_sopralluoghi INTEGER DEFAULT 0
);

CREATE TABLE sopralluoghi_date (
    id_bando UUID,
    data_sopralluogo TIMESTAMP
);

CREATE TABLE sopralluoghi_richieste (
    id INTEGER PRIMARY KEY,
    cnt INTEGER,
    data_inserimento TIMESTAMP,
    username VARCHAR(100),
    id_bando UUID,
    id_sopralluogo UUID,
    esecuzione INTEGER,
    username_esecutore VARCHAR(100),
    id_intermediario INTEGER,
    id_esecutore_esterno INTEGER,
    stato INTEGER
);

CREATE TABLE date_sopralluoghi (
    id_datasopralluogo INTEGER PRIMARY KEY,
    id_bando UUID,
    data_inizio TIMESTAMP,
    data_fine TIMESTAMP,
    ora_inizio TIMESTAMP,
    ora_fine TIMESTAMP
);

-- =============================================================
-- TABELLE UTENTI
-- =============================================================

CREATE TABLE users (
    username VARCHAR(100) PRIMARY KEY,
    email VARCHAR(200),
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    company TEXT,
    partita_iva VARCHAR(20),
    codice_fiscale VARCHAR(20),
    citta VARCHAR(200),
    provincia VARCHAR(100),
    indirizzo TEXT,
    cap VARCHAR(10),
    stato VARCHAR(50),
    telefono VARCHAR(50),
    fax VARCHAR(50),
    agente VARCHAR(100),
    is_approved INTEGER DEFAULT 0,
    create_date TIMESTAMP,
    expire TIMESTAMP,
    expire_bandi TIMESTAMP,
    ip_address VARCHAR(50),
    user_id UUID,
    updated TIMESTAMP,
    last_login TIMESTAMP,
    culture VARCHAR(20),
    culture_ui VARCHAR(20),
    page_size INTEGER,
    theme VARCHAR(50),
    renew_esiti INTEGER DEFAULT 0,
    renew_bandi INTEGER DEFAULT 0,
    sync_registro_bandi INTEGER DEFAULT 0,
    badi_username VARCHAR(100),
    badi_password VARCHAR(200),
    renew_presidia INTEGER DEFAULT 0,
    expire_presidia TIMESTAMP,
    user_create VARCHAR(100),
    user_update VARCHAR(100),
    expire_esiti_light TIMESTAMP,
    expire_esiti_newsletter TIMESTAMP,
    expire_bandi_newsletter TIMESTAMP,
    renew_esiti_light INTEGER DEFAULT 0,
    renew_esiti_newsletter INTEGER DEFAULT 0,
    renew_bandi_newsletter INTEGER DEFAULT 0,
    temporaneo INTEGER DEFAULT 0,
    data_inizio_temporaneo TIMESTAMP,
    data_fine_temporaneo TIMESTAMP,
    prezzo_esiti DECIMAL(18,4),
    prezzo_bandi DECIMAL(18,4),
    prezzo_esiti_light DECIMAL(18,4),
    prezzo_esiti_newsletter DECIMAL(18,4),
    prezzo_bandi_newsletter DECIMAL(18,4),
    prezzo DECIMAL(18,4),
    inizio_esiti TIMESTAMP,
    inizio_bandi TIMESTAMP,
    inizio_esiti_light TIMESTAMP,
    inizio_esiti_newsletter TIMESTAMP,
    inizio_bandi_newsletter TIMESTAMP,
    provv_esiti DECIMAL(18,4),
    provv_bandi DECIMAL(18,4),
    provv_esiti_light DECIMAL(18,4),
    provv_esiti_newsletter DECIMAL(18,4),
    provv_bandi_newsletter DECIMAL(18,4),
    email2 VARCHAR(200),
    email_esiti VARCHAR(200),
    newsletter_separata INTEGER DEFAULT 0,
    sub_agente1 VARCHAR(100),
    importo_sub_agente1 DECIMAL(18,4),
    sub_agente2 VARCHAR(100),
    importo_sub_agente2 DECIMAL(18,4),
    codice_sdi VARCHAR(20),
    indirizzo_pec VARCHAR(200),
    abbonato_sopralluoghi INTEGER DEFAULT 0,
    abbonato_aperture INTEGER DEFAULT 0,
    documento_delega TEXT,
    documento_identita TEXT,
    documento_soa TEXT,
    documento_cciaa TEXT,
    scadenza_delega TIMESTAMP,
    scadenza_identita TIMESTAMP,
    scadenza_soa TIMESTAMP,
    scadenza_cciaa TIMESTAMP,
    disabilitato_da VARCHAR(100),
    disabilitato_il TIMESTAMP,
    renew_months INTEGER
);

CREATE TABLE users_periodi (
    username VARCHAR(100),
    tipo VARCHAR(50),
    data_inizio TIMESTAMP,
    data_fine TIMESTAMP,
    prezzo DECIMAL(18,4),
    provvigione DECIMAL(18,4)
);

CREATE TABLE partecipazioni (
    id_azienda INTEGER,
    id_gara INTEGER,
    variante VARCHAR(20),
    data TIMESTAMP,
    username VARCHAR(100)
);

CREATE TABLE richieste_servizi (
    id INTEGER PRIMARY KEY,
    username VARCHAR(100),
    id_bando UUID,
    note TEXT,
    richiesta TEXT,
    data_inserimento TIMESTAMP,
    gestito INTEGER DEFAULT 0
);

-- =============================================================
-- VISTE UTILI
-- =============================================================

CREATE VIEW v_esiti_completi AS
SELECT
    g.id,
    g.data,
    g.titolo,
    g.importo,
    g.n_partecipanti,
    g.media_ar,
    g.soglia_an,
    g.ribasso,
    g.codice_cig,
    g.id_tipologia,
    tg.tipologia AS tipo_gara,
    g.id_soa,
    s.cod AS soa_cod,
    s.descrizione AS soa_descrizione,
    g.id_stazione,
    st.ragione_sociale AS stazione_nome,
    st.citta AS stazione_citta,
    g.id_bando,
    c.criterio,
    g.data_inserimento,
    g.enabled,
    g.eliminata
FROM gare g
LEFT JOIN tipologia_gare tg ON g.id_tipologia = tg.id_tipologia
LEFT JOIN soa s ON g.id_soa = s.id
LEFT JOIN stazioni st ON g.id_stazione = st.id
LEFT JOIN criteri c ON c.id_criterio = (
    SELECT DISTINCT dg2.id_gara FROM dettaglio_gara dg2 WHERE dg2.id_gara = g.id LIMIT 1
);

CREATE VIEW v_esiti_stats AS
SELECT
    g.id,
    g.data,
    g.importo,
    g.n_partecipanti,
    g.media_ar,
    g.soglia_an,
    g.ribasso,
    g.id_soa,
    g.id_tipologia,
    g.id_stazione,
    g.codice_cig,
    s.cod AS soa_cod
FROM gare g
LEFT JOIN soa s ON g.id_soa = s.id
WHERE g.eliminata = 0 AND g.enabled = 1;

-- =============================================================
-- FINE SCHEMA
-- =============================================================
