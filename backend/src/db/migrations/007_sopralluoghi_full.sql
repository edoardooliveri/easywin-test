-- ============================================================
-- EASYWIN - PostgreSQL Schema Migration 007
-- Module: Full Sopralluoghi Management System
-- Date: March 2026
-- ============================================================

-- ============================================================
-- SOPRALLUOGHI (Site Inspections) - Full management table
-- Mirrors original SQL Server Sopralluoghi table + export columns
-- ============================================================

CREATE TABLE IF NOT EXISTS sopralluoghi (
    id_visione UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    id_bando UUID NOT NULL REFERENCES bandi(id) ON DELETE CASCADE,

    -- Scheduling
    "DataSopralluogo" TIMESTAMPTZ NOT NULL,
    "DataPrenotazione" TIMESTAMPTZ,
    "DataRichiesta" TIMESTAMPTZ,

    -- Status flags
    "Prenotato" BOOLEAN DEFAULT false,
    "Eseguito" BOOLEAN DEFAULT false,
    "Annullato" BOOLEAN DEFAULT false,
    "PresaVisione" BOOLEAN DEFAULT false,  -- true = document review, false = physical inspection

    -- Type
    "TipoPrenotazione" VARCHAR(200),  -- Diretta, Intermediata

    -- Contact info (for the sopralluogo location)
    "Fax" VARCHAR(200),
    "Telefono" VARCHAR(200),
    "Email" VARCHAR(200),
    "Indirizzo" TEXT,
    "Cap" VARCHAR(6),
    "Citta" VARCHAR(100),
    id_provincia INTEGER REFERENCES province(id),

    -- Requesting company
    id_azienda INTEGER NOT NULL REFERENCES aziende(id),
    "Username" VARCHAR(256),
    "RiferimentoAziendaRichiedente" VARCHAR(500),

    -- Request / Execution status (enum-like)
    -- Richiesta: 0=pendente, 1=confermata, 2=rifiutata
    -- Esecuzione: 0=interna_sede, 1=interna_fuori, 2=esterna
    "Richiesta" INTEGER DEFAULT 0,
    "Esecuzione" INTEGER DEFAULT 0,

    -- Intermediary (who requested on behalf)
    "IDIntermediarioRichiedente" UUID,
    "RiferimentoIntermediarioRichiedente" VARCHAR(500),

    -- Executor (intermediary or external who does the inspection)
    "IDIntermediarioEsecutore" UUID,
    "RiferimentoIntermediarioEsecutore" VARCHAR(500),
    "IDTipoEsecutore" INTEGER DEFAULT 0,  -- 0=interno, 1=intermediario, 2=esterno
    "IDEsecutoreEsterno" INTEGER REFERENCES esecutori_esterni(id),

    -- Call manager
    "GestoreRichiesta" VARCHAR(256),

    -- === PAYMENT FLOWS (5 separate flows) ===

    -- 1) Company → Edra
    "PagatoDaAziendaAEdra" BOOLEAN DEFAULT false,
    "ImponibileDaAziendaAEdra" NUMERIC(12,2) DEFAULT 0,
    "IvaDaAziendaAEdra" NUMERIC(12,2) DEFAULT 0,
    "TotaleDaAziendaAEdra" NUMERIC(12,2) DEFAULT 0,
    "DataPagamentoDaAziendaAEdra" TIMESTAMPTZ,

    -- 2) Edra → Gestore Chiamata
    "PagatoDaEdraAlGestoreChiamata" BOOLEAN DEFAULT false,
    "ImponibileDaEdraAGestoreChiamata" NUMERIC(12,2) DEFAULT 0,
    "IvaDaEdraAGestoreChiamata" NUMERIC(12,2) DEFAULT 0,
    "TotaleDaEdraAGestoreChiamata" NUMERIC(12,2) DEFAULT 0,
    "DataPagamentoDaEdraAGestoreChiamata" TIMESTAMPTZ,

    -- 3) Edra → Collaboratore
    "PagatoDaEdraACollaboratore" BOOLEAN DEFAULT false,
    "ImponibileDaEdraACollaboratore" NUMERIC(12,2) DEFAULT 0,
    "IvaDaEdraACollaboratore" NUMERIC(12,2) DEFAULT 0,
    "TotaleDaEdraACollaboratore" NUMERIC(12,2) DEFAULT 0,
    "DataPagamentoDaEdraACollaboratore" TIMESTAMPTZ,

    -- 4) Edra → Intermediari
    "PagatoDaEdraAIntermediari" BOOLEAN DEFAULT false,
    "ImponibileDaEdraAIntermediari" NUMERIC(12,2) DEFAULT 0,
    "IvaDaEdraAIntermediari" NUMERIC(12,2) DEFAULT 0,
    "TotaleDaEdraAIntermediari" NUMERIC(12,2) DEFAULT 0,
    "DataPagamentoDaEdraAIntermediari" TIMESTAMPTZ,

    -- 5) Intermediari → Edra
    "PagatoDaIntermediariAEdra" BOOLEAN DEFAULT false,
    "ImponibileDaIntermediariAEdra" NUMERIC(12,2) DEFAULT 0,
    "IvaDaIntermediariAEdra" NUMERIC(12,2) DEFAULT 0,
    "TotaleDaIntermediariAEdra" NUMERIC(12,2) DEFAULT 0,
    "DataPagamentoDaIntermediariAEdra" TIMESTAMPTZ,

    -- Billing
    "ProformaInviato" BOOLEAN DEFAULT false,
    "FatturaElettronicaGenerata" BOOLEAN DEFAULT false,

    -- ATI (Consortium) support
    "NumATI" INTEGER DEFAULT 0,
    "IDAziendaATI01" INTEGER REFERENCES aziende(id),
    "IDAziendaATI02" INTEGER REFERENCES aziende(id),
    "IDAziendaATI03" INTEGER REFERENCES aziende(id),
    "IDAziendaATI04" INTEGER REFERENCES aziende(id),
    "AziendaAbbonataSopralluoghi" BOOLEAN DEFAULT false,

    -- Notes
    "Note" TEXT,

    -- Audit
    "DataInserimento" TIMESTAMPTZ DEFAULT NOW(),
    "InseritoDa" VARCHAR(256),
    "DataModifica" TIMESTAMPTZ,
    "ModificatoDa" VARCHAR(256)
);

-- Indexes
CREATE INDEX idx_sopr_bando ON sopralluoghi(id_bando);
CREATE INDEX idx_sopr_azienda ON sopralluoghi(id_azienda);
CREATE INDEX idx_sopr_data ON sopralluoghi("DataSopralluogo");
CREATE INDEX idx_sopr_username ON sopralluoghi("Username");
CREATE INDEX idx_sopr_eseguito ON sopralluoghi("Eseguito");
CREATE INDEX idx_sopr_annullato ON sopralluoghi("Annullato");
CREATE INDEX idx_sopr_provincia ON sopralluoghi(id_provincia);
CREATE INDEX idx_sopr_prenotato ON sopralluoghi("Prenotato");

-- ============================================================
-- SOPRALLUOGHI_DATE (Available dates for sopralluoghi per bando)
-- ============================================================

CREATE TABLE IF NOT EXISTS sopralluoghi_date (
    id SERIAL PRIMARY KEY,
    id_bando UUID NOT NULL REFERENCES bandi(id) ON DELETE CASCADE,
    "DataSopralluogo" TIMESTAMPTZ NOT NULL,
    "OraSopralluogo" TIME,
    note TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(id_bando, "DataSopralluogo")
);

CREATE INDEX idx_sopr_date_bando ON sopralluoghi_date(id_bando);

-- ============================================================
-- SOPRALLUOGHI_TPL (Templates for sopralluoghi)
-- ============================================================

CREATE TABLE IF NOT EXISTS sopralluoghi_tpl (
    id SERIAL PRIMARY KEY,
    id_bando UUID REFERENCES bandi(id) ON DELETE CASCADE,
    "TipoPrenotazione" VARCHAR(200),
    "Telefono" VARCHAR(200),
    "Email" VARCHAR(200),
    "Fax" VARCHAR(200),
    "Indirizzo" TEXT,
    "Cap" VARCHAR(6),
    "Citta" VARCHAR(100),
    id_provincia INTEGER REFERENCES province(id),
    "Note" TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- SOPRALLUOGHI_RICHIESTE (Availability/quote requests)
-- ============================================================

CREATE TABLE IF NOT EXISTS sopralluoghi_richieste (
    id SERIAL PRIMARY KEY,
    id_bando UUID NOT NULL REFERENCES bandi(id),
    id_sopralluogo UUID REFERENCES sopralluoghi(id_visione),
    id_azienda INTEGER REFERENCES aziende(id),
    "Username" VARCHAR(256),

    -- Request details
    data_richiesta TIMESTAMPTZ DEFAULT NOW(),
    data_preferita DATE,
    note TEXT,
    stato VARCHAR(50) DEFAULT 'pendente',  -- pendente, confermata, rifiutata, completata

    -- Response
    risposta TEXT,
    data_risposta TIMESTAMPTZ,
    risposta_da VARCHAR(256),

    -- Pricing (quote)
    importo_preventivo NUMERIC(12,2),
    iva_preventivo NUMERIC(12,2),
    preventivo_accettato BOOLEAN,
    data_accettazione TIMESTAMPTZ,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sopr_rich_bando ON sopralluoghi_richieste(id_bando);
CREATE INDEX idx_sopr_rich_azienda ON sopralluoghi_richieste(id_azienda);
CREATE INDEX idx_sopr_rich_stato ON sopralluoghi_richieste(stato);

-- ============================================================
-- GEOCODING CACHE (Cache geocoded addresses for map performance)
-- ============================================================

CREATE TABLE IF NOT EXISTS geocoding_cache (
    id SERIAL PRIMARY KEY,
    indirizzo_normalizzato VARCHAR(500) UNIQUE NOT NULL,
    lat DOUBLE PRECISION,
    lng DOUBLE PRECISION,
    provider VARCHAR(50) DEFAULT 'nominatim',
    data_geocoding TIMESTAMPTZ DEFAULT NOW(),
    successo BOOLEAN DEFAULT true
);

CREATE INDEX idx_geocoding_indirizzo ON geocoding_cache(indirizzo_normalizzato);

-- ============================================================
-- Add geocoding columns to province table if not exists
-- ============================================================

DO $$ BEGIN
    ALTER TABLE province ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION;
    ALTER TABLE province ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- ============================================================
-- Insert Italian province coordinates for map display
-- ============================================================

DO $$ BEGIN
    -- Update provinces with coordinates (capoluoghi di provincia)
    UPDATE province SET lat = 45.4642, lng = 9.1900 WHERE LOWER("Provincia") = 'milano' OR LOWER("siglaprovincia") = 'mi';
    UPDATE province SET lat = 41.9028, lng = 12.4964 WHERE LOWER("Provincia") = 'roma' OR LOWER("siglaprovincia") = 'rm';
    UPDATE province SET lat = 40.8518, lng = 14.2681 WHERE LOWER("Provincia") = 'napoli' OR LOWER("siglaprovincia") = 'na';
    UPDATE province SET lat = 45.0703, lng = 7.6869 WHERE LOWER("Provincia") = 'torino' OR LOWER("siglaprovincia") = 'to';
    UPDATE province SET lat = 38.1157, lng = 13.3615 WHERE LOWER("Provincia") = 'palermo' OR LOWER("siglaprovincia") = 'pa';
    UPDATE province SET lat = 44.4056, lng = 8.9463 WHERE LOWER("Provincia") = 'genova' OR LOWER("siglaprovincia") = 'ge';
    UPDATE province SET lat = 44.4949, lng = 11.3426 WHERE LOWER("Provincia") = 'bologna' OR LOWER("siglaprovincia") = 'bo';
    UPDATE province SET lat = 43.7696, lng = 11.2558 WHERE LOWER("Provincia") = 'firenze' OR LOWER("siglaprovincia") = 'fi';
    UPDATE province SET lat = 41.1171, lng = 16.8719 WHERE LOWER("Provincia") = 'bari' OR LOWER("siglaprovincia") = 'ba';
    UPDATE province SET lat = 37.5079, lng = 15.0830 WHERE LOWER("Provincia") = 'catania' OR LOWER("siglaprovincia") = 'ct';
    UPDATE province SET lat = 45.4408, lng = 12.3155 WHERE LOWER("Provincia") = 'venezia' OR LOWER("siglaprovincia") = 've';
    UPDATE province SET lat = 45.4384, lng = 10.9916 WHERE LOWER("Provincia") = 'verona' OR LOWER("siglaprovincia") = 'vr';
    UPDATE province SET lat = 38.1938, lng = 15.5540 WHERE LOWER("Provincia") = 'messina' OR LOWER("siglaprovincia") = 'me';
    UPDATE province SET lat = 45.4064, lng = 11.8768 WHERE LOWER("Provincia") = 'padova' OR LOWER("siglaprovincia") = 'pd';
    UPDATE province SET lat = 45.6495, lng = 13.7768 WHERE LOWER("Provincia") = 'trieste' OR LOWER("siglaprovincia") = 'ts';
    UPDATE province SET lat = 45.5416, lng = 10.2118 WHERE LOWER("Provincia") = 'brescia' OR LOWER("siglaprovincia") = 'bs';
    UPDATE province SET lat = 44.8015, lng = 10.3279 WHERE LOWER("Provincia") = 'parma' OR LOWER("siglaprovincia") = 'pr';
    UPDATE province SET lat = 44.6471, lng = 10.9252 WHERE LOWER("Provincia") = 'modena' OR LOWER("siglaprovincia") = 'mo';
    UPDATE province SET lat = 38.1113, lng = 15.6474 WHERE LOWER("Provincia") = 'reggio calabria' OR LOWER("siglaprovincia") = 'rc';
    UPDATE province SET lat = 43.1107, lng = 12.3908 WHERE LOWER("Provincia") = 'perugia' OR LOWER("siglaprovincia") = 'pg';
    UPDATE province SET lat = 39.2238, lng = 9.1217 WHERE LOWER("Provincia") = 'cagliari' OR LOWER("siglaprovincia") = 'ca';
    UPDATE province SET lat = 43.5485, lng = 10.3106 WHERE LOWER("Provincia") = 'livorno' OR LOWER("siglaprovincia") = 'li';
    UPDATE province SET lat = 44.4184, lng = 12.2035 WHERE LOWER("Provincia") = 'ravenna' OR LOWER("siglaprovincia") = 'ra';
    UPDATE province SET lat = 44.0594, lng = 12.5683 WHERE LOWER("Provincia") = 'rimini' OR LOWER("siglaprovincia") = 'rn';
    UPDATE province SET lat = 40.6824, lng = 14.7681 WHERE LOWER("Provincia") = 'salerno' OR LOWER("siglaprovincia") = 'sa';
    UPDATE province SET lat = 44.8378, lng = 11.6199 WHERE LOWER("Provincia") = 'ferrara' OR LOWER("siglaprovincia") = 'fe';
    UPDATE province SET lat = 40.7259, lng = 8.5590 WHERE LOWER("Provincia") = 'sassari' OR LOWER("siglaprovincia") = 'ss';
    UPDATE province SET lat = 41.4676, lng = 12.9036 WHERE LOWER("Provincia") = 'latina' OR LOWER("siglaprovincia") = 'lt';
    UPDATE province SET lat = 45.6983, lng = 9.6773 WHERE LOWER("Provincia") = 'bergamo' OR LOWER("siglaprovincia") = 'bg';
    UPDATE province SET lat = 43.6158, lng = 13.5189 WHERE LOWER("Provincia") = 'ancona' OR LOWER("siglaprovincia") = 'an';
    UPDATE province SET lat = 42.3498, lng = 13.3995 WHERE LOWER("Provincia") = 'l''aquila' OR LOWER("siglaprovincia") = 'aq';
    UPDATE province SET lat = 40.6404, lng = 15.8056 WHERE LOWER("Provincia") = 'potenza' OR LOWER("siglaprovincia") = 'pz';
    UPDATE province SET lat = 38.9104, lng = 16.5872 WHERE LOWER("Provincia") = 'catanzaro' OR LOWER("siglaprovincia") = 'cz';
    UPDATE province SET lat = 41.5600, lng = 14.6684 WHERE LOWER("Provincia") = 'campobasso' OR LOWER("siglaprovincia") = 'cb';
    UPDATE province SET lat = 45.7372, lng = 7.3209 WHERE LOWER("Provincia") = 'aosta' OR LOWER("siglaprovincia") = 'ao';
    UPDATE province SET lat = 46.0748, lng = 11.1217 WHERE LOWER("Provincia") = 'trento' OR LOWER("siglaprovincia") = 'tn';
    UPDATE province SET lat = 46.4993, lng = 11.3548 WHERE LOWER("Provincia") = 'bolzano' OR LOWER("siglaprovincia") = 'bz';
    UPDATE province SET lat = 46.0711, lng = 13.2346 WHERE LOWER("Provincia") = 'udine' OR LOWER("siglaprovincia") = 'ud';
    UPDATE province SET lat = 45.8066, lng = 13.2343 WHERE LOWER("Provincia") = 'gorizia' OR LOWER("siglaprovincia") = 'go';
    UPDATE province SET lat = 46.1598, lng = 12.2015 WHERE LOWER("Provincia") = 'pordenone' OR LOWER("siglaprovincia") = 'pn';
    UPDATE province SET lat = 45.1873, lng = 9.1562 WHERE LOWER("Provincia") = 'pavia' OR LOWER("siglaprovincia") = 'pv';
    UPDATE province SET lat = 45.1868, lng = 8.6210 WHERE LOWER("Provincia") = 'alessandria' OR LOWER("siglaprovincia") = 'al';
    UPDATE province SET lat = 44.3945, lng = 8.9453 WHERE LOWER("Provincia") = 'savona' OR LOWER("siglaprovincia") = 'sv';
    UPDATE province SET lat = 43.8777, lng = 8.0578 WHERE LOWER("Provincia") = 'imperia' OR LOWER("siglaprovincia") = 'im';
    UPDATE province SET lat = 44.1039, lng = 9.8244 WHERE LOWER("Provincia") = 'la spezia' OR LOWER("siglaprovincia") = 'sp';
    UPDATE province SET lat = 45.1667, lng = 10.7914 WHERE LOWER("Provincia") = 'mantova' OR LOWER("siglaprovincia") = 'mn';
    UPDATE province SET lat = 45.1329, lng = 10.0227 WHERE LOWER("Provincia") = 'cremona' OR LOWER("siglaprovincia") = 'cr';
    UPDATE province SET lat = 45.3517, lng = 9.0847 WHERE LOWER("Provincia") = 'lodi' OR LOWER("siglaprovincia") = 'lo';
    UPDATE province SET lat = 45.4643, lng = 9.8759 WHERE LOWER("Provincia") = 'monza e brianza' OR LOWER("siglaprovincia") = 'mb';
    UPDATE province SET lat = 45.8986, lng = 9.0094 WHERE LOWER("Provincia") = 'como' OR LOWER("siglaprovincia") = 'co';
    UPDATE province SET lat = 45.8342, lng = 9.3907 WHERE LOWER("Provincia") = 'lecco' OR LOWER("siglaprovincia") = 'lc';
    UPDATE province SET lat = 46.1699, lng = 10.1777 WHERE LOWER("Provincia") = 'sondrio' OR LOWER("siglaprovincia") = 'so';
    UPDATE province SET lat = 45.8139, lng = 8.8271 WHERE LOWER("Provincia") = 'varese' OR LOWER("siglaprovincia") = 'va';
    UPDATE province SET lat = 45.4646, lng = 8.6213 WHERE LOWER("Provincia") = 'novara' OR LOWER("siglaprovincia") = 'no';
    UPDATE province SET lat = 45.9226, lng = 8.5519 WHERE LOWER("Provincia") = 'verbano-cusio-ossola' OR LOWER("siglaprovincia") = 'vb';
    UPDATE province SET lat = 45.3766, lng = 8.4246 WHERE LOWER("Provincia") = 'vercelli' OR LOWER("siglaprovincia") = 'vc';
    UPDATE province SET lat = 45.5781, lng = 8.0478 WHERE LOWER("Provincia") = 'biella' OR LOWER("siglaprovincia") = 'bi';
    UPDATE province SET lat = 44.7000, lng = 8.6145 WHERE LOWER("Provincia") = 'asti' OR LOWER("siglaprovincia") = 'at';
    UPDATE province SET lat = 44.5476, lng = 7.7336 WHERE LOWER("Provincia") = 'cuneo' OR LOWER("siglaprovincia") = 'cn';
    UPDATE province SET lat = 45.4535, lng = 11.0001 WHERE LOWER("Provincia") = 'vicenza' OR LOWER("siglaprovincia") = 'vi';
    UPDATE province SET lat = 45.6495, lng = 12.2453 WHERE LOWER("Provincia") = 'treviso' OR LOWER("siglaprovincia") = 'tv';
    UPDATE province SET lat = 46.1381, lng = 12.1700 WHERE LOWER("Provincia") = 'belluno' OR LOWER("siglaprovincia") = 'bl';
    UPDATE province SET lat = 45.0690, lng = 11.7903 WHERE LOWER("Provincia") = 'rovigo' OR LOWER("siglaprovincia") = 'ro';
    UPDATE province SET lat = 44.2943, lng = 11.8798 WHERE LOWER("Provincia") = 'forli''-cesena' OR LOWER("siglaprovincia") = 'fc';
    UPDATE province SET lat = 44.1391, lng = 12.2430 WHERE LOWER("Provincia") = 'cesena' OR LOWER("siglaprovincia") = 'fc';
    UPDATE province SET lat = 44.2225, lng = 12.0408 WHERE LOWER("Provincia") = 'forli' OR LOWER("siglaprovincia") = 'fc';
    UPDATE province SET lat = 44.7139, lng = 11.2954 WHERE LOWER("Provincia") = 'reggio emilia' OR LOWER("siglaprovincia") = 're';
    UPDATE province SET lat = 44.9249, lng = 11.1081 WHERE LOWER("Provincia") = 'reggio nell''emilia' OR LOWER("siglaprovincia") = 're';
    UPDATE province SET lat = 44.6989, lng = 10.6312 WHERE LOWER("Provincia") = 'parma' OR LOWER("siglaprovincia") = 'pr';
    UPDATE province SET lat = 45.0534, lng = 9.6929 WHERE LOWER("Provincia") = 'piacenza' OR LOWER("siglaprovincia") = 'pc';
    UPDATE province SET lat = 43.8430, lng = 10.5027 WHERE LOWER("Provincia") = 'lucca' OR LOWER("siglaprovincia") = 'lu';
    UPDATE province SET lat = 43.8800, lng = 10.2500 WHERE LOWER("Provincia") = 'pistoia' OR LOWER("siglaprovincia") = 'pt';
    UPDATE province SET lat = 43.7230, lng = 10.4017 WHERE LOWER("Provincia") = 'pisa' OR LOWER("siglaprovincia") = 'pi';
    UPDATE province SET lat = 43.3188, lng = 11.3308 WHERE LOWER("Provincia") = 'siena' OR LOWER("siglaprovincia") = 'si';
    UPDATE province SET lat = 42.5638, lng = 11.7840 WHERE LOWER("Provincia") = 'grosseto' OR LOWER("siglaprovincia") = 'gr';
    UPDATE province SET lat = 43.4623, lng = 11.8802 WHERE LOWER("Provincia") = 'arezzo' OR LOWER("siglaprovincia") = 'ar';
    UPDATE province SET lat = 43.0953, lng = 12.3858 WHERE LOWER("Provincia") = 'terni' OR LOWER("siglaprovincia") = 'tr';
    UPDATE province SET lat = 43.2098, lng = 13.7153 WHERE LOWER("Provincia") = 'macerata' OR LOWER("siglaprovincia") = 'mc';
    UPDATE province SET lat = 42.8529, lng = 13.5740 WHERE LOWER("Provincia") = 'ascoli piceno' OR LOWER("siglaprovincia") = 'ap';
    UPDATE province SET lat = 42.9351, lng = 13.8826 WHERE LOWER("Provincia") = 'fermo' OR LOWER("siglaprovincia") = 'fm';
    UPDATE province SET lat = 43.7216, lng = 13.2137 WHERE LOWER("Provincia") = 'pesaro e urbino' OR LOWER("siglaprovincia") = 'pu';
    UPDATE province SET lat = 42.4618, lng = 14.2139 WHERE LOWER("Provincia") = 'pescara' OR LOWER("siglaprovincia") = 'pe';
    UPDATE province SET lat = 42.3515, lng = 13.3979 WHERE LOWER("Provincia") = 'l''aquila' OR LOWER("siglaprovincia") = 'aq';
    UPDATE province SET lat = 42.4644, lng = 14.2139 WHERE LOWER("Provincia") = 'chieti' OR LOWER("siglaprovincia") = 'ch';
    UPDATE province SET lat = 42.1920, lng = 13.7213 WHERE LOWER("Provincia") = 'teramo' OR LOWER("siglaprovincia") = 'te';
    UPDATE province SET lat = 41.1307, lng = 14.7828 WHERE LOWER("Provincia") = 'benevento' OR LOWER("siglaprovincia") = 'bn';
    UPDATE province SET lat = 41.0746, lng = 14.3329 WHERE LOWER("Provincia") = 'caserta' OR LOWER("siglaprovincia") = 'ce';
    UPDATE province SET lat = 40.9180, lng = 14.7906 WHERE LOWER("Provincia") = 'avellino' OR LOWER("siglaprovincia") = 'av';
    UPDATE province SET lat = 41.4602, lng = 15.5446 WHERE LOWER("Provincia") = 'foggia' OR LOWER("siglaprovincia") = 'fg';
    UPDATE province SET lat = 40.3515, lng = 18.1718 WHERE LOWER("Provincia") = 'lecce' OR LOWER("siglaprovincia") = 'le';
    UPDATE province SET lat = 40.6318, lng = 17.9417 WHERE LOWER("Provincia") = 'brindisi' OR LOWER("siglaprovincia") = 'br';
    UPDATE province SET lat = 40.4827, lng = 17.2297 WHERE LOWER("Provincia") = 'taranto' OR LOWER("siglaprovincia") = 'ta';
    UPDATE province SET lat = 41.1253, lng = 16.8661 WHERE LOWER("Provincia") = 'barletta-andria-trani' OR LOWER("siglaprovincia") = 'bt';
    UPDATE province SET lat = 40.6325, lng = 15.8058 WHERE LOWER("Provincia") = 'potenza' OR LOWER("siglaprovincia") = 'pz';
    UPDATE province SET lat = 40.6654, lng = 16.6044 WHERE LOWER("Provincia") = 'matera' OR LOWER("siglaprovincia") = 'mt';
    UPDATE province SET lat = 39.0819, lng = 16.5145 WHERE LOWER("Provincia") = 'cosenza' OR LOWER("siglaprovincia") = 'cs';
    UPDATE province SET lat = 38.6780, lng = 16.0788 WHERE LOWER("Provincia") = 'vibo valentia' OR LOWER("siglaprovincia") = 'vv';
    UPDATE province SET lat = 39.1522, lng = 16.5175 WHERE LOWER("Provincia") = 'crotone' OR LOWER("siglaprovincia") = 'kr';
    UPDATE province SET lat = 37.0755, lng = 15.2866 WHERE LOWER("Provincia") = 'siracusa' OR LOWER("siglaprovincia") = 'sr';
    UPDATE province SET lat = 37.3277, lng = 13.5839 WHERE LOWER("Provincia") = 'agrigento' OR LOWER("siglaprovincia") = 'ag';
    UPDATE province SET lat = 37.0990, lng = 14.0934 WHERE LOWER("Provincia") = 'caltanissetta' OR LOWER("siglaprovincia") = 'cl';
    UPDATE province SET lat = 37.5615, lng = 14.2748 WHERE LOWER("Provincia") = 'enna' OR LOWER("siglaprovincia") = 'en';
    UPDATE province SET lat = 36.9257, lng = 14.7306 WHERE LOWER("Provincia") = 'ragusa' OR LOWER("siglaprovincia") = 'rg';
    UPDATE province SET lat = 37.8160, lng = 12.4362 WHERE LOWER("Provincia") = 'trapani' OR LOWER("siglaprovincia") = 'tp';
    UPDATE province SET lat = 40.8400, lng = 9.4520 WHERE LOWER("Provincia") = 'nuoro' OR LOWER("siglaprovincia") = 'nu';
    UPDATE province SET lat = 39.8628, lng = 8.5374 WHERE LOWER("Provincia") = 'oristano' OR LOWER("siglaprovincia") = 'or';
    UPDATE province SET lat = 39.1563, lng = 9.0610 WHERE LOWER("Provincia") = 'carbonia-iglesias' OR LOWER("siglaprovincia") = 'ci';
    UPDATE province SET lat = 38.9121, lng = 8.8620 WHERE LOWER("Provincia") = 'medio campidano' OR LOWER("siglaprovincia") = 'vs';
    UPDATE province SET lat = 40.6140, lng = 9.4526 WHERE LOWER("Provincia") = 'ogliastra' OR LOWER("siglaprovincia") = 'og';
    UPDATE province SET lat = 40.9267, lng = 9.5008 WHERE LOWER("Provincia") = 'olbia-tempio' OR LOWER("siglaprovincia") = 'ot';
    UPDATE province SET lat = 41.5588, lng = 14.2270 WHERE LOWER("Provincia") = 'isernia' OR LOWER("siglaprovincia") = 'is';
    UPDATE province SET lat = 41.6394, lng = 12.8964 WHERE LOWER("Provincia") = 'frosinone' OR LOWER("siglaprovincia") = 'fr';
    UPDATE province SET lat = 42.0667, lng = 12.5895 WHERE LOWER("Provincia") = 'rieti' OR LOWER("siglaprovincia") = 'ri';
    UPDATE province SET lat = 42.4174, lng = 12.1057 WHERE LOWER("Provincia") = 'viterbo' OR LOWER("siglaprovincia") = 'vt';
    UPDATE province SET lat = 43.8813, lng = 11.0973 WHERE LOWER("Provincia") = 'prato' OR LOWER("siglaprovincia") = 'po';
    UPDATE province SET lat = 43.3506, lng = 10.5093 WHERE LOWER("Provincia") = 'massa-carrara' OR LOWER("siglaprovincia") = 'ms';
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
