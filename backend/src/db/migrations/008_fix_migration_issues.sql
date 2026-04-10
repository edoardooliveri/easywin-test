-- ============================================================
-- FIX MIGRATION ISSUES
-- Risolve problemi riscontrati durante import CSV da SQL Server
-- ============================================================

-- 1. tipo_dati_gara: aggiungere colonna 'nome' come alias di 'tipo'
--    (il vecchio sistema usava 'nome', il nuovo usa 'tipo')
ALTER TABLE tipo_dati_gara ADD COLUMN IF NOT EXISTS nome VARCHAR(200);
UPDATE tipo_dati_gara SET nome = tipo WHERE nome IS NULL;

-- 2. aziende: espandere campi varchar troppo corti
--    partita_iva e codice_fiscale possono contenere codici esteri più lunghi
ALTER TABLE aziende ALTER COLUMN partita_iva TYPE VARCHAR(50);
ALTER TABLE aziende ALTER COLUMN codice_fiscale TYPE VARCHAR(50);

-- 3. stazioni: espandere per coerenza
ALTER TABLE stazioni ALTER COLUMN codice_fiscale TYPE VARCHAR(50);
ALTER TABLE stazioni ALTER COLUMN partita_iva TYPE VARCHAR(50);

-- 4. aziende: telefono deve essere VARCHAR, non integer
--    Verificare che sia già VARCHAR (dovrebbe esserlo dallo schema)
--    Se è integer, convertire:
-- ALTER TABLE aziende ALTER COLUMN telefono TYPE VARCHAR(50);

-- 5. province: verificare che i dati siano completi (112 province italiane)
--    Il CSV ha id_provincia che potrebbero essere 0 o NULL per righe estere
--    Le righe con id_provincia invalido vengono gestite nel codice migration
