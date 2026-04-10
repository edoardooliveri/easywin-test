#!/bin/bash
# =============================================================
# EasyWin - Migrazione completa SQL Server → PostgreSQL
# Esegui con: bash run_migration.sh
# =============================================================

echo "============================================"
echo "  EasyWin - Migrazione Database"
echo "============================================"
echo ""

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# 1. Avvia PostgreSQL in Docker (se non già avviato)
echo "1. Avvio PostgreSQL in Docker..."
docker ps --filter "name=postgres-easywin" --format '{{.Names}}' | grep -q postgres-easywin
if [ $? -eq 0 ]; then
    echo "   PostgreSQL già in esecuzione!"
else
    docker run \
        -e POSTGRES_DB=easywin \
        -e POSTGRES_USER=easywin \
        -e POSTGRES_PASSWORD=easywin2026 \
        -p 5433:5432 \
        -d --name postgres-easywin \
        postgres:16

    if [ $? -ne 0 ]; then
        echo "ERRORE: impossibile avviare PostgreSQL"
        echo "Prova: docker rm -f postgres-easywin && poi riesegui"
        exit 1
    fi

    echo "   Aspetto che PostgreSQL si avvii..."
    sleep 5
fi

# 2. Crea schema
echo ""
echo "2. Creazione schema PostgreSQL..."
PGPASSWORD=easywin2026 psql -h localhost -p 5433 -U easywin -d easywin -f "$SCRIPT_DIR/01_schema.sql" 2>&1 | tail -5

if [ $? -ne 0 ]; then
    echo "   Provo con psql via Docker..."
    docker exec -i postgres-easywin psql -U easywin -d easywin < "$SCRIPT_DIR/01_schema.sql" 2>&1 | tail -5
fi

echo "   Schema creato!"

# 3. Importa dati
echo ""
echo "3. Importazione dati da CSV..."
echo "   (questo richiederà diversi minuti per le tabelle grandi)"
echo ""

# Controlla se psycopg2 è installato
python3 -c "import psycopg2" 2>/dev/null
if [ $? -ne 0 ]; then
    echo "   Installazione psycopg2..."
    pip3 install psycopg2-binary 2>/dev/null || pip install psycopg2-binary 2>/dev/null
fi

python3 "$SCRIPT_DIR/02_import.py"

echo ""
echo "============================================"
echo "  MIGRAZIONE COMPLETATA!"
echo "============================================"
echo ""
echo "PostgreSQL è accessibile su:"
echo "  Host: localhost"
echo "  Porta: 5433"
echo "  Database: easywin"
echo "  Utente: easywin"
echo "  Password: easywin2026"
echo ""
echo "Per connetterti:"
echo "  psql -h localhost -p 5433 -U easywin -d easywin"
echo "  oppure"
echo "  docker exec -it postgres-easywin psql -U easywin -d easywin"
