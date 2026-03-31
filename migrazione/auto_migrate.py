#!/usr/bin/env python3
"""
EasyWin Auto-Migration: Legge i CSV, crea schema PostgreSQL automaticamente,
importa tutti i dati. Usa i nomi colonne originali dal CSV.
"""

import os
import sys
import io
import re
import psycopg2

DB_CONFIG = {
    'host': 'localhost',
    'port': 5433,
    'dbname': 'easywin',
    'user': 'easywin',
    'password': 'easywin2026'
}

EXPORT_DIR = os.path.expanduser('~/Downloads/easywin_export')

# Ordine di importazione (per rispettare le FK)
IMPORT_ORDER = [
    'regioni', 'province', 'comuni', 'soa', 'attestazioni', 'criteri',
    'tipo_dati_gara', 'tipologia_bandi', 'tipologia_gare',
    'soa_corrispondenze', 'piattaforme',
    'stazioni', 'aziende', 'concorrenti', 'consorzi',
    'attestazioni_aziende', 'azienda_personale', 'modifiche_azienda', 'note_aziende',
    'bandi', 'bandi_province', 'bandi_soa_sec', 'bandi_soa_alt', 'bandi_soa_app',
    'bandi_modifiche', 'bandi_probabilita', 'allegati_bando',
    'gare', 'dettaglio_gara', 'ati_gare_01', 'punteggi',
    'gare_province', 'gare_soa_sec', 'gare_soa_alt', 'gare_soa_app', 'gare_soa_sost',
    'gare_invii', 'gare_ricorsi', 'assistenti_gara', 'registro_gare',
    'simulazioni', 'simulazioni_dettagli', 'simulazioni_gare',
    'simulazione_pesi', 'simulazioni_province', 'simulazioni_soa_sec', 'simulazioni_tipologie',
    'sopralluoghi', 'sopralluoghi_date', 'sopralluoghi_richieste', 'date_sopralluoghi',
    'users', 'users_periodi', 'partecipazioni', 'richieste_servizi',
]

# Colonne UUID note (dal campionamento)
UUID_COLUMNS = {
    'id_bando', 'id_visione', 'id_simulazione', 'id_sopralluogo',
    'idsopralluogo', 'idbando',
}

# Tabelle con PK UUID
UUID_PK_TABLES = {
    'bandi': 'id_bando',
    'simulazioni': 'id',
    'sopralluoghi': 'id_visione',
}

# Tabelle con PK integer
INT_PK_TABLES = {
    'gare': 'id',
    'aziende': 'id',
    'stazioni': 'id',
    'concorrenti': 'ID',
    'punteggi': 'id_punteggio',
    'regioni': 'id_regione',
    'province': 'id_provincia',
    'attestazioni': 'id_Attestazione',
    'criteri': 'id_criterio',
    'sopralluoghi_richieste': 'ID',
    'date_sopralluoghi': 'id_datasopralluogo',
    'richieste_servizi': 'id',
}

UUID_PATTERN = re.compile(r'^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$')
DATE_PATTERN = re.compile(r'^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}')
INT_PATTERN = re.compile(r'^-?\d+$')
FLOAT_PATTERN = re.compile(r'^-?\d+\.\d+$')


def is_separator_line(line):
    stripped = line.strip()
    if not stripped:
        return False
    return all(c in '-| ' for c in stripped) and '-' in stripped


def read_csv(filepath):
    """Legge CSV sqlcmd e ritorna (headers, rows)."""
    headers = None
    rows = []

    with open(filepath, 'r', encoding='utf-8', errors='replace') as f:
        for i, line in enumerate(f):
            line = line.rstrip('\n').rstrip('\r')

            if i == 0:
                headers = [h.strip() for h in line.split('|')]
                continue

            if i == 1 and is_separator_line(line):
                continue

            if not line.strip() or ('rows affected' in line and line.strip().startswith('(')):
                continue

            values = line.split('|')
            n = len(headers)

            if len(values) > n:
                # Campi con | nel testo: unisci gli extra nell'ultimo campo
                values = values[:n-1] + ['|'.join(values[n-1:])]
            elif len(values) < n:
                values.extend([''] * (n - len(values)))

            cleaned = []
            for v in values[:n]:
                v = v.strip()
                if v == 'NULL' or v == '':
                    cleaned.append(None)
                else:
                    cleaned.append(v)
            rows.append(cleaned)

    return headers, rows


def guess_column_type(col_name, values):
    """Indovina il tipo PostgreSQL da un campione di valori."""
    col_lower = col_name.lower()

    # UUID noti
    if col_lower in UUID_COLUMNS or col_lower == 'userid' or col_lower == 'user_id':
        return 'UUID'

    # Campiona valori non-null
    sample = [v for v in values if v is not None][:200]
    if not sample:
        return 'TEXT'

    # Controlla UUID dal contenuto
    uuid_count = sum(1 for v in sample if UUID_PATTERN.match(v))
    if uuid_count > len(sample) * 0.5:
        return 'UUID'

    # Controlla date
    date_count = sum(1 for v in sample if DATE_PATTERN.match(v))
    if date_count > len(sample) * 0.5:
        return 'TIMESTAMP'

    # Controlla interi
    int_count = sum(1 for v in sample if INT_PATTERN.match(v))
    if int_count > len(sample) * 0.8:
        # Controlla range
        try:
            vals = [int(v) for v in sample if INT_PATTERN.match(v)]
            if vals:
                max_val = max(abs(v) for v in vals)
                if max_val > 2147483647:
                    return 'BIGINT'
                return 'INTEGER'
        except:
            pass
        return 'INTEGER'

    # Controlla float/decimal
    float_count = sum(1 for v in sample if FLOAT_PATTERN.match(v))
    if float_count > len(sample) * 0.5:
        # Controlla se ha 4 decimali (money)
        money = sum(1 for v in sample if FLOAT_PATTERN.match(v) and len(v.split('.')[1]) == 4)
        if money > float_count * 0.5:
            return 'DECIMAL(18,4)'
        return 'DOUBLE PRECISION'

    # Controlla lunghezza testo
    max_len = max(len(v) for v in sample) if sample else 0
    if max_len <= 20:
        return f'VARCHAR({max(max_len * 2, 50)})'
    elif max_len <= 200:
        return f'VARCHAR({max(max_len + 50, 200)})'
    else:
        return 'TEXT'


def generate_create_table(table_name, headers, rows):
    """Genera CREATE TABLE SQL."""
    cols = []
    for h in headers:
        col_values = [row[headers.index(h)] for row in rows[:500]]
        col_type = guess_column_type(h, col_values)

        # PK detection
        pk = ''
        if table_name in INT_PK_TABLES and h == INT_PK_TABLES[table_name]:
            pk = ' PRIMARY KEY'
        elif table_name in UUID_PK_TABLES and h == UUID_PK_TABLES[table_name]:
            pk = ' PRIMARY KEY'
        elif table_name == 'users' and h == 'UserName':
            pk = ' PRIMARY KEY'

        # Quote il nome colonna per sicurezza
        cols.append(f'    "{h}" {col_type}{pk}')

    return f'DROP TABLE IF EXISTS "{table_name}" CASCADE;\nCREATE TABLE "{table_name}" (\n' + ',\n'.join(cols) + '\n);\n'


def copy_data(conn, table_name, headers, rows, batch_size=50000):
    """Importa con COPY."""
    if not rows:
        return 0

    cur = conn.cursor()
    total = 0

    for i in range(0, len(rows), batch_size):
        batch = rows[i:i+batch_size]
        buf = io.StringIO()

        for row in batch:
            parts = []
            for val in row:
                if val is None:
                    parts.append('\\N')
                else:
                    escaped = val.replace('\\', '\\\\').replace('\t', '\\t').replace('\n', '\\n').replace('\r', '\\r')
                    parts.append(escaped)
            buf.write('\t'.join(parts) + '\n')

        buf.seek(0)
        col_list = ', '.join(f'"{h}"' for h in headers)

        try:
            cur.copy_expert(
                f'COPY "{table_name}" ({col_list}) FROM STDIN WITH (FORMAT text, NULL \'\\N\')',
                buf
            )
            conn.commit()
            total += len(batch)
        except Exception as e:
            conn.rollback()
            print(f"\n  ERRORE batch {i}: {e}")
            # Skip this batch

    return total


def main():
    print("=" * 60)
    print("  EasyWin Auto-Migration")
    print("  SQL Server CSV → PostgreSQL")
    print("=" * 60)
    print()

    # Connessione
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        conn.set_client_encoding('UTF8')
        print("Connesso a PostgreSQL!")
    except Exception as e:
        print(f"ERRORE: {e}")
        sys.exit(1)

    cur = conn.cursor()

    # Estensioni
    cur.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm;")
    cur.execute("CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\";")
    conn.commit()

    # Disabilita FK check
    cur.execute("SET session_replication_role = 'replica';")
    conn.commit()

    print()
    grand_total = 0

    for table_name in IMPORT_ORDER:
        filepath = os.path.join(EXPORT_DIR, f'{table_name}.csv')
        if not os.path.exists(filepath):
            print(f"  SKIP {table_name} (non trovato)")
            continue

        file_size = os.path.getsize(filepath)
        if file_size < 1024:
            size_str = f"{file_size}B"
        elif file_size < 1024*1024:
            size_str = f"{file_size/1024:.0f}KB"
        else:
            size_str = f"{file_size/1024/1024:.1f}MB"

        print(f"[{table_name}] ({size_str}) ", end='', flush=True)

        # Leggi CSV
        print("lettura...", end='', flush=True)
        headers, rows = read_csv(filepath)

        if not headers:
            print("VUOTO")
            continue

        # Crea tabella
        print("schema...", end='', flush=True)
        create_sql = generate_create_table(table_name, headers, rows)
        try:
            cur.execute(create_sql)
            conn.commit()
        except Exception as e:
            conn.rollback()
            print(f"ERRORE SCHEMA: {e}")
            continue

        # Importa
        print("import...", end='', flush=True)
        count = copy_data(conn, table_name, headers, rows)
        grand_total += count
        print(f" {count:,} righe OK")

    # Riabilita FK
    cur.execute("SET session_replication_role = 'origin';")
    conn.commit()

    # Crea indici utili
    print("\nCreazione indici...")
    indexes = [
        'CREATE INDEX IF NOT EXISTS idx_gare_codice_cig ON "gare"("CodiceCIG")',
        'CREATE INDEX IF NOT EXISTS idx_gare_id_soa ON "gare"("id_soa")',
        'CREATE INDEX IF NOT EXISTS idx_gare_id_stazione ON "gare"("id_stazione")',
        'CREATE INDEX IF NOT EXISTS idx_gare_data ON "gare"("Data")',
        'CREATE INDEX IF NOT EXISTS idx_gare_titolo_trgm ON "gare" USING gin("Titolo" gin_trgm_ops)',
        'CREATE INDEX IF NOT EXISTS idx_bandi_codice_cig ON "bandi"("CodiceCIG")',
        'CREATE INDEX IF NOT EXISTS idx_bandi_id_stazione ON "bandi"("id_stazione")',
        'CREATE INDEX IF NOT EXISTS idx_bandi_id_soa ON "bandi"("id_soa")',
        'CREATE INDEX IF NOT EXISTS idx_bandi_titolo_trgm ON "bandi" USING gin("Titolo" gin_trgm_ops)',
        'CREATE INDEX IF NOT EXISTS idx_dettaglio_gara_gara ON "dettaglio_gara"("id_gara")',
        'CREATE INDEX IF NOT EXISTS idx_dettaglio_gara_azienda ON "dettaglio_gara"("id_azienda")',
        'CREATE INDEX IF NOT EXISTS idx_aziende_piva ON "aziende"("PartitaIva")',
        'CREATE INDEX IF NOT EXISTS idx_aziende_cf ON "aziende"("CodiceFiscale")',
        'CREATE INDEX IF NOT EXISTS idx_aziende_nome_trgm ON "aziende" USING gin("RagioneSociale" gin_trgm_ops)',
        'CREATE INDEX IF NOT EXISTS idx_bandi_province_bando ON "bandi_province"("id_bando")',
        'CREATE INDEX IF NOT EXISTS idx_bandi_soa_sec_bando ON "bandi_soa_sec"("id_bando")',
        'CREATE INDEX IF NOT EXISTS idx_gare_province_gara ON "gare_province"("id_gara")',
        'CREATE INDEX IF NOT EXISTS idx_gare_soa_sec_gara ON "gare_soa_sec"("id_gara")',
        'CREATE INDEX IF NOT EXISTS idx_sim_dettagli ON "simulazioni_dettagli"("id_simulazione")',
        'CREATE INDEX IF NOT EXISTS idx_sim_gare ON "simulazioni_gare"("id_simulazione")',
        'CREATE INDEX IF NOT EXISTS idx_allegati_bando ON "allegati_bando"("id_bando")',
        'CREATE INDEX IF NOT EXISTS idx_punteggi_gara ON "punteggi"("id_gara")',
        'CREATE INDEX IF NOT EXISTS idx_ati_gare_gara ON "ati_gare_01"("id_gara")',
    ]

    for idx_sql in indexes:
        try:
            cur.execute(idx_sql)
            conn.commit()
            print(f"  OK: {idx_sql.split(' ON ')[0].split('idx_')[1]}")
        except Exception as e:
            conn.rollback()
            print(f"  SKIP: {e}")

    conn.close()

    print()
    print("=" * 60)
    print(f"  MIGRAZIONE COMPLETATA!")
    print(f"  Totale righe importate: {grand_total:,}")
    print("=" * 60)


if __name__ == '__main__':
    main()
