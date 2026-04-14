-- 026_tipo_sopralluogo.sql
-- Lookup table per tipo sopralluogo (seed 0-4)
CREATE TABLE IF NOT EXISTS tipo_sopralluogo (
  id SMALLINT PRIMARY KEY,
  nome VARCHAR(100) NOT NULL,
  attivo BOOLEAN DEFAULT true
);

INSERT INTO tipo_sopralluogo (id, nome) VALUES
  (0, 'Non specificato'),
  (1, 'Obbligatorio'),
  (2, 'Facoltativo'),
  (3, 'Non richiesto'),
  (4, 'Da verificare')
ON CONFLICT (id) DO NOTHING;
