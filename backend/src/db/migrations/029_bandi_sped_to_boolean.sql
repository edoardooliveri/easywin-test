-- 029_bandi_sped_to_boolean.sql
-- Conversione sicura TEXT→BOOLEAN con preservazione dati
DO $$
DECLARE
  col TEXT;
  cols TEXT[] := ARRAY['sped_pec','sped_posta','sped_corriere','sped_mano','sped_telematica'];
BEGIN
  FOREACH col IN ARRAY cols LOOP
    -- Solo se è ancora TEXT
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name='bandi' AND column_name=col AND data_type='text'
    ) THEN
      EXECUTE format('ALTER TABLE bandi ALTER COLUMN %I DROP DEFAULT', col);
      EXECUTE format('ALTER TABLE bandi ALTER COLUMN %I TYPE BOOLEAN USING (CASE WHEN lower(coalesce(%I,''false'')) IN (''true'',''t'',''1'',''yes'',''si'',''sì'') THEN true ELSE false END)', col, col);
      EXECUTE format('ALTER TABLE bandi ALTER COLUMN %I SET DEFAULT false', col);
      EXECUTE format('ALTER TABLE bandi ALTER COLUMN %I SET NOT NULL', col);
    END IF;
  END LOOP;
END $$;
