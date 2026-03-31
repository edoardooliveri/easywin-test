#!/usr/bin/env python3
"""
EasyWin Direct Transfer: SQL Server → PostgreSQL
Connessione diretta senza CSV intermedi. Gestisce correttamente tutti i tipi di dati.
"""

import sys
import uuid
import pymssql
import psycopg2
import psycopg2.extras
from psycopg2.extensions import register_adapter, AsIs

# Registra adapter per UUID di Python → PostgreSQL
register_adapter(uuid.UUID, lambda u: AsIs(f"'{u}'"))

# Configurazione SQL Server (Docker)
MSSQL_CONFIG = {
    'server': 'localhost',
    'port': '1433',
    'user': 'SA',
    'password': 'TempPass123!',
    'database': 'Gare05'
}

# Configurazione PostgreSQL (Docker)
PG_CONFIG = {
    'host': 'localhost',
    'port': 5433,
    'dbname': 'easywin',
    'user': 'easywin',
    'password': 'easywin2026'
}

# Tabelle da trasferire, in ordine (per FK)
TABLES = [
    'Regioni', 'Province', 'Comuni', 'Soa', 'Attestazioni', 'Criteri',
    'TipoDatiGara', 'TipologiaBandi', 'TipologiaGare',
    'SoaCorrispondenze', 'Piattaforme',
    'Stazioni', 'Aziende', 'Concorrenti', 'Consorzi',
    'AttestazioniAziende', 'AziendaPersonale', 'ModificheAzienda', 'NoteAziende',
    'Bandi', 'BandiProvince', 'BandiSoaSec', 'BandiSoaAlt', 'BandiSoaApp',
    'BandiModifiche', 'BandiProbabilita', 'AllegatiBando',
    'Gare', 'DettaglioGara', 'AtiGare01', 'Punteggi',
    'GareProvince', 'GareSoaSec', 'GareSoaAlt', 'GareSoaApp', 'GareSoaSost',
    'GareInvii', 'GareRicorsi', 'AssistentiGara', 'RegistroGare',
    'Simulazioni', 'SimulazioniDettagli', 'SimulazioniGare',
    'SimulazionePesi', 'SimulazioniProvince', 'SimulazioniSoaSec', 'SimulazioniTipologie',
    'Sopralluoghi', 'SopralluoghiDate', 'SopralluoghiRichieste', 'DateSopralluoghi',
    'Users', 'UsersPeriodi', 'Partecipazioni', 'RichiesteServizi',
]

# Mapping tipi SQL Server → PostgreSQL
def mssql_type_to_pg(type_name, max_length, precision, scale):
    t = type_name.lower()
    if t in ('int',):
        return 'INTEGER'
    if t in ('bigint',):
        return 'BIGINT'
    if t in ('smallint', 'tinyint'):
        return 'SMALLINT'
    if t in ('bit',):
        return 'BOOLEAN'
    if t in ('decimal', 'numeric', 'money', 'smallmoney'):
        return f'DECIMAL({precision},{scale})'
    if t in ('float', 'real'):
        return 'DOUBLE PRECISION'
    if t in ('datetime', 'datetime2', 'smalldatetime'):
        return 'TIMESTAMP'
    if t in ('date',):
        return 'DATE'
    if t in ('time',):
        return 'TIME'
    if t in ('uniqueidentifier',):
        return 'UUID'
    if t in ('nvarchar', 'varchar', 'nchar', 'char', 'ntext', 'text', 'xml'):
        return 'TEXT'  # Usa sempre TEXT per evitare errori di lunghezza
    if t in ('varbinary', 'binary', 'image'):
        return 'BYTEA'
    return 'TEXT'


def get_table_columns(mssql_cursor, table_name):
    """Ottiene le colonne e i tipi dalla tabella SQL Server."""
    mssql_cursor.execute(f"""
        SELECT c.name, t.name as type_name, c.max_length, c.precision, c.scale, c.is_nullable
        FROM sys.columns c
        JOIN sys.types t ON c.user_type_id = t.user_type_id
        WHERE c.object_id = OBJECT_ID('{table_name}')
        ORDER BY c.column_id
    """)
    return mssql_cursor.fetchall()


def create_pg_table(pg_cursor, table_name, columns):
    """Crea la tabella in PostgreSQL."""
    pg_table = table_name.lower()

    # Drop se esiste
    pg_cursor.execute(f'DROP TABLE IF EXISTS "{pg_table}" CASCADE')

    cols = []
    for col_name, type_name, max_length, precision, scale, is_nullable in columns:
        pg_type = mssql_type_to_pg(type_name, max_length, precision, scale)
        # Nessun vincolo NOT NULL per evitare errori di importazione
        cols.append(f'    "{col_name}" {pg_type}')

    sql = f'CREATE TABLE "{pg_table}" (\n' + ',\n'.join(cols) + '\n)'
    pg_cursor.execute(sql)


def transfer_table(mssql_conn, pg_conn, table_name, batch_size=10000):
    """Trasferisce una tabella da SQL Server a PostgreSQL."""
    mssql_cursor = mssql_conn.cursor()
    pg_cursor = pg_conn.cursor()

    # 1. Ottieni struttura colonne
    columns = get_table_columns(mssql_cursor, table_name)
    if not columns:
        return 0, "tabella non trovata"

    col_names = [c[0] for c in columns]

    # 2. Crea tabella in PostgreSQL
    create_pg_table(pg_cursor, table_name, columns)
    pg_conn.commit()

    # 3. Conta righe
    mssql_cursor.execute(f'SELECT COUNT(*) FROM [{table_name}]')
    total_rows = mssql_cursor.fetchone()[0]

    if total_rows == 0:
        return 0, "vuota"

    # 4. Leggi e inserisci a batch
    pg_table = table_name.lower()
    col_list = ', '.join(f'"{c}"' for c in col_names)
    placeholders = ', '.join(['%s'] * len(col_names))
    insert_sql = f'INSERT INTO "{pg_table}" ({col_list}) VALUES ({placeholders})'

    mssql_cursor.execute(f'SELECT * FROM [{table_name}]')

    inserted = 0
    batch = []
    errors = 0
    first_error = None

    while True:
        row = mssql_cursor.fetchone()
        if row is None:
            if batch:
                try:
                    psycopg2.extras.execute_batch(pg_cursor, insert_sql, batch, page_size=1000)
                    pg_conn.commit()
                    inserted += len(batch)
                except Exception as e:
                    pg_conn.rollback()
                    if not first_error:
                        first_error = str(e)[:200]
                    for r in batch:
                        try:
                            pg_cursor.execute(insert_sql, r)
                            pg_conn.commit()
                            inserted += 1
                        except Exception as e2:
                            pg_conn.rollback()
                            if not first_error:
                                first_error = str(e2)[:200]
                            errors += 1
            break

        # Converti valori
        cleaned = []
        for i, val in enumerate(row):
            if val is None:
                cleaned.append(None)
            elif isinstance(val, uuid.UUID):
                cleaned.append(str(val))
            elif isinstance(val, bytes):
                cleaned.append(psycopg2.Binary(val))
            elif isinstance(val, str):
                cleaned.append(val.replace('\x00', ''))
            else:
                cleaned.append(val)
        batch.append(tuple(cleaned))

        if len(batch) >= batch_size:
            try:
                psycopg2.extras.execute_batch(pg_cursor, insert_sql, batch, page_size=1000)
                pg_conn.commit()
                inserted += len(batch)
            except Exception as e:
                pg_conn.rollback()
                if not first_error:
                    first_error = str(e)[:200]
                for r in batch:
                    try:
                        pg_cursor.execute(insert_sql, r)
                        pg_conn.commit()
                        inserted += 1
                    except Exception as e2:
                        pg_conn.rollback()
                        if not first_error:
                            first_error = str(e2)[:200]
                        errors += 1

            pct = int((inserted + errors) / total_rows * 100) if total_rows > 0 else 0
            print(f"\r  {inserted:,}/{total_rows:,} ({pct}%)", end='', flush=True)
            batch = []

    status = f"{inserted:,} OK"
    if errors > 0:
        status += f" ({errors} errori)"
        if first_error:
            status += f"\n    → {first_error}"
    return inserted, status


def create_indexes(pg_conn):
    """Crea gli indici principali."""
    pg_cursor = pg_conn.cursor()
    indexes = [
        ('idx_gare_cig', 'CREATE INDEX IF NOT EXISTS idx_gare_cig ON gare("CodiceCIG")'),
        ('idx_gare_soa', 'CREATE INDEX IF NOT EXISTS idx_gare_soa ON gare("id_soa")'),
        ('idx_gare_staz', 'CREATE INDEX IF NOT EXISTS idx_gare_staz ON gare("id_stazione")'),
        ('idx_gare_data', 'CREATE INDEX IF NOT EXISTS idx_gare_data ON gare("Data")'),
        ('idx_gare_titolo', 'CREATE INDEX IF NOT EXISTS idx_gare_titolo ON gare USING gin("Titolo" gin_trgm_ops)'),
        ('idx_bandi_cig', 'CREATE INDEX IF NOT EXISTS idx_bandi_cig ON bandi("CodiceCIG")'),
        ('idx_bandi_staz', 'CREATE INDEX IF NOT EXISTS idx_bandi_staz ON bandi("id_stazione")'),
        ('idx_bandi_soa', 'CREATE INDEX IF NOT EXISTS idx_bandi_soa ON bandi("id_soa")'),
        ('idx_bandi_titolo', 'CREATE INDEX IF NOT EXISTS idx_bandi_titolo ON bandi USING gin("Titolo" gin_trgm_ops)'),
        ('idx_bandi_data', 'CREATE INDEX IF NOT EXISTS idx_bandi_data ON bandi("DataPubblicazione")'),
        ('idx_dett_gara', 'CREATE INDEX IF NOT EXISTS idx_dett_gara ON dettagliogara("id_gara")'),
        ('idx_dett_azienda', 'CREATE INDEX IF NOT EXISTS idx_dett_azienda ON dettagliogara("id_azienda")'),
        ('idx_az_piva', 'CREATE INDEX IF NOT EXISTS idx_az_piva ON aziende("PartitaIva")'),
        ('idx_az_cf', 'CREATE INDEX IF NOT EXISTS idx_az_cf ON aziende("CodiceFiscale")'),
        ('idx_az_nome', 'CREATE INDEX IF NOT EXISTS idx_az_nome ON aziende USING gin("RagioneSociale" gin_trgm_ops)'),
        ('idx_bp_bando', 'CREATE INDEX IF NOT EXISTS idx_bp_bando ON bandiprovince("id_bando")'),
        ('idx_bss_bando', 'CREATE INDEX IF NOT EXISTS idx_bss_bando ON bandisoasec("id_bando")'),
        ('idx_gp_gara', 'CREATE INDEX IF NOT EXISTS idx_gp_gara ON gareprovince("id_gara")'),
        ('idx_gss_gara', 'CREATE INDEX IF NOT EXISTS idx_gss_gara ON garesoasec("id_gara")'),
        ('idx_sd_sim', 'CREATE INDEX IF NOT EXISTS idx_sd_sim ON simulazionidettagli("id_simulazione")'),
        ('idx_sg_sim', 'CREATE INDEX IF NOT EXISTS idx_sg_sim ON simulazionigare("id_simulazione")'),
        ('idx_ab_bando', 'CREATE INDEX IF NOT EXISTS idx_ab_bando ON allegatibando("id_bando")'),
        ('idx_punt_gara', 'CREATE INDEX IF NOT EXISTS idx_punt_gara ON punteggi("id_gara")'),
        ('idx_ati_gara', 'CREATE INDEX IF NOT EXISTS idx_ati_gara ON atigare01("id_gara")'),
    ]

    for name, sql in indexes:
        try:
            pg_cursor.execute(sql)
            pg_conn.commit()
            print(f"  OK: {name}")
        except Exception as e:
            pg_conn.rollback()
            print(f"  SKIP {name}: {e}")


def main():
    print("=" * 60)
    print("  EasyWin Direct Transfer")
    print("  SQL Server → PostgreSQL")
    print("=" * 60)
    print()

    # Connessione SQL Server
    print("Connessione a SQL Server...", end='', flush=True)
    try:
        mssql_conn = pymssql.connect(**MSSQL_CONFIG)
        print(" OK")
    except Exception as e:
        print(f"\nERRORE SQL Server: {e}")
        sys.exit(1)

    # Connessione PostgreSQL
    print("Connessione a PostgreSQL...", end='', flush=True)
    try:
        pg_conn = psycopg2.connect(**PG_CONFIG)
        pg_conn.set_client_encoding('UTF8')
        print(" OK")
    except Exception as e:
        print(f"\nERRORE PostgreSQL: {e}")
        sys.exit(1)

    # Estensioni
    pg_cursor = pg_conn.cursor()
    pg_cursor.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm;")
    pg_cursor.execute('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";')
    pg_conn.commit()

    print()
    grand_total = 0

    for table_name in TABLES:
        print(f"[{table_name}] ", end='', flush=True)
        try:
            count, status = transfer_table(mssql_conn, pg_conn, table_name)
            grand_total += count
            print(f"\r[{table_name}] {status}" + " " * 40)
        except Exception as e:
            print(f"\r[{table_name}] ERRORE: {e}" + " " * 40)

    # Indici
    print("\nCreazione indici...")
    create_indexes(pg_conn)

    mssql_conn.close()
    pg_conn.close()

    print()
    print("=" * 60)
    print(f"  TRASFERIMENTO COMPLETATO!")
    print(f"  Totale righe: {grand_total:,}")
    print("=" * 60)


if __name__ == '__main__':
    main()
