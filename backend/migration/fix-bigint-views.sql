-- Fix the 2 columns that failed because of views
-- Drop views, alter columns, recreate views

-- 1. Drop the views that depend on aziende.id and gare.id_vincitore
DROP VIEW IF EXISTS v_esiti_completi CASCADE;
DROP VIEW IF EXISTS v_esiti_stats CASCADE;
DROP VIEW IF EXISTS v_bandi_attivi CASCADE;

-- 2. Now alter the columns
ALTER TABLE aziende ALTER COLUMN id SET DATA TYPE BIGINT;
ALTER TABLE gare ALTER COLUMN id_vincitore SET DATA TYPE BIGINT;

-- 3. Recreate v_esiti_completi
CREATE OR REPLACE VIEW v_esiti_completi AS
SELECT
    g.id,
    g.id_bando,
    g.data,
    g.titolo,
    g.codice_cig,
    g.codice_cup,
    g.importo,
    g.n_partecipanti,
    g.ribasso AS ribasso_vincitore,
    g.media_ar,
    g.soglia_an,
    g.variante,
    g.ai_processed,
    g.ai_confidence,
    g.provenienza,
    s.nome AS stazione_nome,
    soa.codice AS soa_categoria,
    soa.descrizione AS soa_descrizione,
    tg.nome AS tipologia,
    c.nome AS criterio,
    p.nome AS provincia_nome,
    r.nome AS regione_nome,
    az.ragione_sociale AS vincitore_nome,
    az.partita_iva AS vincitore_piva,
    (SELECT COUNT(*) FROM dettaglio_gara dg WHERE dg.id_gara = g.id) AS n_dettagli
FROM gare g
LEFT JOIN stazioni s ON g.id_stazione = s.id
LEFT JOIN soa ON g.id_soa = soa.id
LEFT JOIN tipologia_gare tg ON g.id_tipologia = tg.id
LEFT JOIN criteri c ON g.id_criterio = c.id
LEFT JOIN province p ON g.id_provincia = p.id
LEFT JOIN regioni r ON p.id_regione = r.id
LEFT JOIN aziende az ON g.id_vincitore = az.id
WHERE g.annullato = false;

-- 4. Recreate v_esiti_stats
CREATE OR REPLACE VIEW v_esiti_stats AS
SELECT
    g.id,
    g.data,
    g.importo,
    g.n_partecipanti,
    g.ribasso,
    g.media_ar,
    g.soglia_an,
    g.id_soa,
    soa.codice AS soa_categoria,
    g.id_criterio,
    c.nome AS criterio,
    g.id_stazione,
    s.nome AS stazione_nome,
    p.id_regione,
    r.nome AS regione_nome,
    g.id_tipologia,
    tg.nome AS tipologia
FROM gare g
LEFT JOIN soa ON g.id_soa = soa.id
LEFT JOIN criteri c ON g.id_criterio = c.id
LEFT JOIN stazioni s ON g.id_stazione = s.id
LEFT JOIN province p ON g.id_provincia = p.id
LEFT JOIN regioni r ON p.id_regione = r.id
LEFT JOIN tipologia_gare tg ON g.id_tipologia = tg.id
WHERE g.annullato = false
  AND g.ribasso IS NOT NULL
  AND g.n_partecipanti > 0;

-- 5. Recreate v_bandi_attivi (in case CASCADE dropped it)
CREATE OR REPLACE VIEW v_bandi_attivi AS
SELECT
    b.id,
    b.titolo,
    b.codice_cig,
    b.codice_cup,
    b.data_pubblicazione,
    b.data_offerta,
    b.data_apertura,
    b.importo_so,
    b.importo_co,
    b.importo_eco,
    COALESCE(b.importo_so, 0) + COALESCE(b.importo_co, 0) + COALESCE(b.importo_eco, 0) AS importo_totale,
    b.regione,
    b.citta,
    b.provenienza,
    b.ai_processed,
    b.ai_confidence,
    s.nome AS stazione_nome_rel,
    COALESCE(b.stazione_nome, s.nome) AS stazione_display,
    soa.codice AS soa_codice,
    soa.descrizione AS soa_descrizione,
    tg.nome AS tipologia_nome,
    c.nome AS criterio_nome,
    p.nome AS piattaforma_nome
FROM bandi b
LEFT JOIN stazioni s ON b.id_stazione = s.id
LEFT JOIN soa ON b.id_soa = soa.id
LEFT JOIN tipologia_gare tg ON b.id_tipologia = tg.id
LEFT JOIN criteri c ON b.id_criterio = c.id
LEFT JOIN piattaforme p ON b.id_piattaforma = p.id
WHERE b.annullato = false;

SELECT 'All views recreated, BIGINT fix complete!' AS status;
