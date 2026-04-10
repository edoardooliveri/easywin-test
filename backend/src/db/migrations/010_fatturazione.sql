-- Fatturazione System - Periodi, Fatture, and Pagamenti Tables

-- Periodi (subscription periods)
CREATE TABLE IF NOT EXISTS periodi (
  id SERIAL PRIMARY KEY,
  username VARCHAR(200) NOT NULL,
  data_inizio DATE NOT NULL,
  data_fine DATE NOT NULL,
  tipo VARCHAR(50) DEFAULT 'standard',
  prezzo_esiti NUMERIC(10,2) DEFAULT 0,
  prezzo_bandi NUMERIC(10,2) DEFAULT 0,
  prezzo_newsletter_esiti NUMERIC(10,2) DEFAULT 0,
  prezzo_newsletter_bandi NUMERIC(10,2) DEFAULT 0,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Fatture (invoices)
CREATE TABLE IF NOT EXISTS fatture (
  id SERIAL PRIMARY KEY,
  username VARCHAR(200) NOT NULL,
  numero VARCHAR(50),
  tipo VARCHAR(20) DEFAULT 'fattura', -- fattura, proforma
  data_emissione DATE NOT NULL DEFAULT CURRENT_DATE,
  data_scadenza DATE,
  importo NUMERIC(10,2) NOT NULL DEFAULT 0,
  iva NUMERIC(10,2) DEFAULT 0,
  totale NUMERIC(10,2) NOT NULL DEFAULT 0,
  stato VARCHAR(20) DEFAULT 'da_pagare', -- da_pagare, pagata, parziale, annullata
  id_periodo INTEGER REFERENCES periodi(id),
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Pagamenti (payments)
CREATE TABLE IF NOT EXISTS pagamenti (
  id SERIAL PRIMARY KEY,
  id_fattura INTEGER NOT NULL REFERENCES fatture(id) ON DELETE CASCADE,
  data_pagamento DATE NOT NULL DEFAULT CURRENT_DATE,
  importo NUMERIC(10,2) NOT NULL,
  metodo VARCHAR(50) DEFAULT 'bonifico',
  riferimento VARCHAR(200),
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_periodi_username ON periodi(username);
CREATE INDEX IF NOT EXISTS idx_periodi_dates ON periodi(data_inizio, data_fine);
CREATE INDEX IF NOT EXISTS idx_fatture_username ON fatture(username);
CREATE INDEX IF NOT EXISTS idx_fatture_stato ON fatture(stato);
CREATE INDEX IF NOT EXISTS idx_fatture_periodo ON fatture(id_periodo);
CREATE INDEX IF NOT EXISTS idx_pagamenti_fattura ON pagamenti(id_fattura);
