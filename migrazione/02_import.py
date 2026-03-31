#!/usr/bin/env python3
"""
EasyWin Database Import - Da CSV (sqlcmd) a PostgreSQL
Pulisce i CSV esportati da sqlcmd e li importa in PostgreSQL usando COPY.
"""

import os
import sys
import csv
import io
import re
import psycopg2
from pathlib import Path

# Configurazione
DB_CONFIG = {
    'host': 'localhost',
    'port': 5433,  # PostgreSQL Docker port
    'dbname': 'easywin',
    'user': 'easywin',
    'password': 'easywin2026'
}

EXPORT_DIR = os.path.expanduser('~/Downloads/easywin_export')

# Mappa CSV file → nome tabella PostgreSQL (in ordine di importazione per FK)
IMPORT_ORDER = [
    # 1. Lookup tables (nessuna dipendenza)
    ('regioni.csv', 'regioni'),
    ('province.csv', 'province'),
    ('comuni.csv', 'comuni'),
    ('soa.csv', 'soa'),
    ('attestazioni.csv', 'attestazioni'),
    ('criteri.csv', 'criteri'),
    ('tipo_dati_gara.csv', 'tipo_dati_gara'),
    ('tipologia_bandi.csv', 'tipologia_bandi'),
    ('tipologia_gare.csv', 'tipologia_gare'),
    ('soa_corrispondenze.csv', 'soa_corrispondenze'),
    ('piattaforme.csv', 'piattaforme'),

    # 2. Aziende e Stazioni
    ('stazioni.csv', 'stazioni'),
    ('aziende.csv', 'aziende'),
    ('concorrenti.csv', 'concorrenti'),
    ('consorzi.csv', 'consorzi'),
    ('attestazioni_aziende.csv', 'attestazioni_aziende'),
    ('azienda_personale.csv', 'azienda_personale'),
    ('modifiche_azienda.csv', 'modifiche_azienda'),
    ('note_aziende.csv', 'note_aziende'),

    # 3. Bandi
    ('bandi.csv', 'bandi'),
    ('bandi_province.csv', 'bandi_province'),
    ('bandi_soa_sec.csv', 'bandi_soa_sec'),
    ('bandi_soa_alt.csv', 'bandi_soa_alt'),
    ('bandi_soa_app.csv', 'bandi_soa_app'),
    ('bandi_modifiche.csv', 'bandi_modifiche'),
    ('bandi_probabilita.csv', 'bandi_probabilita'),
    ('allegati_bando.csv', 'allegati_bando'),

    # 4. Gare (Esiti)
    ('gare.csv', 'gare'),
    ('dettaglio_gara.csv', 'dettaglio_gara'),
    ('ati_gare_01.csv', 'ati_gare_01'),
    ('punteggi.csv', 'punteggi'),
    ('gare_province.csv', 'gare_province'),
    ('gare_soa_sec.csv', 'gare_soa_sec'),
    ('gare_soa_alt.csv', 'gare_soa_alt'),
    ('gare_soa_app.csv', 'gare_soa_app'),
    ('gare_soa_sost.csv', 'gare_soa_sost'),
    ('gare_invii.csv', 'gare_invii'),
    ('gare_ricorsi.csv', 'gare_ricorsi'),
    ('assistenti_gara.csv', 'assistenti_gara'),
    ('registro_gare.csv', 'registro_gare'),

    # 5. Simulazioni
    ('simulazioni.csv', 'simulazioni'),
    ('simulazioni_dettagli.csv', 'simulazioni_dettagli'),
    ('simulazioni_gare.csv', 'simulazioni_gare'),
    ('simulazione_pesi.csv', 'simulazione_pesi'),
    ('simulazioni_province.csv', 'simulazioni_province'),
    ('simulazioni_soa_sec.csv', 'simulazioni_soa_sec'),
    ('simulazioni_tipologie.csv', 'simulazioni_tipologie'),

    # 6. Sopralluoghi
    ('sopralluoghi.csv', 'sopralluoghi'),
    ('sopralluoghi_date.csv', 'sopralluoghi_date'),
    ('sopralluoghi_richieste.csv', 'sopralluoghi_richieste'),
    ('date_sopralluoghi.csv', 'date_sopralluoghi'),

    # 7. Utenti
    ('users.csv', 'users'),
    ('users_periodi.csv', 'users_periodi'),
    ('partecipazioni.csv', 'partecipazioni'),
    ('richieste_servizi.csv', 'richieste_servizi'),
]


def clean_value(val):
    """Pulisce un valore da sqlcmd per PostgreSQL."""
    val = val.strip()
    if val == 'NULL' or val == '':
        return None
    # Rimuovi trailing spaces da sqlcmd
    val = val.rstrip()
    return val


def is_separator_line(line):
    """Controlla se è la linea di separazione sqlcmd (------|------|...) ."""
    stripped = line.strip()
    if not stripped:
        return False
    return all(c in '-|' for c in stripped)


def clean_csv_to_rows(filepath):
    """
    Legge un CSV esportato da sqlcmd (pipe-separated) e restituisce
    (headers, rows) puliti.
    """
    headers = None
    rows = []

    with open(filepath, 'r', encoding='utf-8', errors='replace') as f:
        line_num = 0
        for line in f:
            line_num += 1
            line = line.rstrip('\n').rstrip('\r')

            # Riga 1: headers
            if line_num == 1:
                headers = [h.strip() for h in line.split('|')]
                continue

            # Riga 2: separatore (-----|------|...)
            if line_num == 2 and is_separator_line(line):
                continue

            # Ultime righe: possono essere "(N rows affected)" o vuote
            if line.strip() == '' or line.strip().startswith('(') and 'rows affected' in line:
                continue

            # Riga dati
            values = line.split('|')

            # Assicurati che il numero di colonne corrisponda
            if len(values) < len(headers):
                values.extend([None] * (len(headers) - len(values)))
            elif len(values) > len(headers):
                # Potrebbe essere un campo con | nel testo
                # Unisci i campi extra nell'ultimo
                extra = values[len(headers)-1:]
                values = values[:len(headers)-1] + ['|'.join(extra)]

            cleaned = [clean_value(v) for v in values[:len(headers)]]
            rows.append(cleaned)

    return headers, rows


def copy_to_postgres(conn, table_name, headers, rows, batch_size=10000):
    """Importa righe in PostgreSQL usando COPY per massima velocità."""
    if not rows:
        print(f"  {table_name}: 0 righe (vuota)")
        return 0

    cur = conn.cursor()
    total = 0

    # Usa COPY via StringIO per velocità
    for i in range(0, len(rows), batch_size):
        batch = rows[i:i+batch_size]
        buf = io.StringIO()

        for row in batch:
            # Converti in formato TSV per COPY
            line_parts = []
            for val in row:
                if val is None:
                    line_parts.append('\\N')
                else:
                    # Escape backslash, tab, newline per COPY
                    escaped = val.replace('\\', '\\\\').replace('\t', '\\t').replace('\n', '\\n').replace('\r', '\\r')
                    line_parts.append(escaped)
            buf.write('\t'.join(line_parts) + '\n')

        buf.seek(0)

        try:
            col_list = ', '.join(f'"{h.lower()}"' for h in headers)
            cur.copy_expert(
                f'COPY {table_name} ({col_list}) FROM STDIN WITH (FORMAT text, NULL \'\\N\')',
                buf
            )
            total += len(batch)
        except Exception as e:
            conn.rollback()
            print(f"  ERRORE COPY su {table_name} (batch {i}): {e}")
            # Fallback: INSERT uno alla volta per trovare la riga problematica
            total += insert_fallback(conn, cur, table_name, headers, batch)

    conn.commit()
    return total


def insert_fallback(conn, cur, table_name, headers, rows):
    """Fallback: INSERT riga per riga quando COPY fallisce."""
    col_list = ', '.join(f'"{h.lower()}"' for h in headers)
    placeholders = ', '.join(['%s'] * len(headers))
    sql = f'INSERT INTO {table_name} ({col_list}) VALUES ({placeholders})'

    inserted = 0
    for row in rows:
        try:
            cur.execute(sql, row)
            conn.commit()
            inserted += 1
        except Exception as e:
            conn.rollback()
            # Salta righe problematiche silenziosamente
            pass

    return inserted


def main():
    print("=" * 60)
    print("  EasyWin PostgreSQL Import")
    print("=" * 60)
    print()

    # Connessione a PostgreSQL
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        conn.set_client_encoding('UTF8')
        print("Connesso a PostgreSQL!")
    except Exception as e:
        print(f"ERRORE connessione: {e}")
        print("\nAssicurati che PostgreSQL sia avviato in Docker:")
        print("  docker run -e POSTGRES_DB=easywin -e POSTGRES_USER=easywin \\")
        print("    -e POSTGRES_PASSWORD=easywin2026 -p 5433:5432 \\")
        print("    -d --name postgres postgres:16")
        sys.exit(1)

    # Disabilita FK temporaneamente per velocità
    cur = conn.cursor()
    cur.execute("SET session_replication_role = 'replica';")
    conn.commit()

    print()
    total_rows = 0

    for csv_file, table_name in IMPORT_ORDER:
        filepath = os.path.join(EXPORT_DIR, csv_file)
        if not os.path.exists(filepath):
            print(f"  SKIP {csv_file} (file non trovato)")
            continue

        file_size = os.path.getsize(filepath)
        size_str = f"{file_size / 1024 / 1024:.1f}MB" if file_size > 1024*1024 else f"{file_size / 1024:.0f}KB"

        print(f"Importando {table_name} ({size_str})...", end='', flush=True)

        try:
            headers, rows = clean_csv_to_rows(filepath)
            count = copy_to_postgres(conn, table_name, headers, rows)
            total_rows += count
            print(f" {count:,} righe OK")
        except Exception as e:
            print(f" ERRORE: {e}")

    # Riabilita FK
    cur = conn.cursor()
    cur.execute("SET session_replication_role = 'origin';")
    conn.commit()

    # Aggiorna sequenze per tabelle con ID seriale
    print("\nAggiornamento sequenze...")
    for table, col in [('gare', 'id'), ('aziende', 'id'), ('stazioni', 'id'),
                        ('punteggi', 'id_punteggio'), ('concorrenti', 'id')]:
        try:
            cur.execute(f"SELECT setval(pg_get_serial_sequence('{table}', '{col}'), COALESCE(MAX({col}), 1)) FROM {table}")
            conn.commit()
        except:
            conn.rollback()

    conn.close()

    print()
    print("=" * 60)
    print(f"  IMPORTAZIONE COMPLETATA! Totale: {total_rows:,} righe")
    print("=" * 60)


if __name__ == '__main__':
    main()
