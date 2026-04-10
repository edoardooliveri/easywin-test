#!/bin/bash
# =============================================================
# Script di esportazione database EasyWin da SQL Server a CSV
# Usa sqlcmd (non BCP) per evitare errore SSL
# Esegui con: bash export_database.sh
# =============================================================

CONTAINER="sqlserver"
SA_PASS="TempPass123!"
DB="Gare05"
EXPORT_DIR="$HOME/Downloads/easywin_export"
SQLCMD="/opt/mssql-tools18/bin/sqlcmd"

echo "============================================"
echo "  EasyWin Database Export"
echo "============================================"

mkdir -p "$EXPORT_DIR"
echo "Export directory: $EXPORT_DIR"
echo ""

# Crea la cartella export dentro il container
docker exec $CONTAINER mkdir -p /backup/easywin_export

# Funzione per esportare una tabella usando sqlcmd
export_table() {
    local TABLE=$1
    local FILENAME=$2
    echo -n "Esportando $TABLE..."

    # Esporta con sqlcmd direttamente dentro il container, output su file
    docker exec $CONTAINER $SQLCMD \
        -S localhost -U SA -P "$SA_PASS" -C -d $DB \
        -W -s "|" -w 65535 \
        -Q "SET NOCOUNT ON; SELECT * FROM $TABLE" \
        -o "/backup/easywin_export/$FILENAME.csv" \
        2>/dev/null

    if [ $? -eq 0 ] && [ -f "$EXPORT_DIR/$FILENAME.csv" ]; then
        local ROWS=$(wc -l < "$EXPORT_DIR/$FILENAME.csv" 2>/dev/null)
        echo " OK ($ROWS righe)"
    else
        echo " ERRORE"
    fi
}

echo ""
echo "--- TABELLE PRINCIPALI (Gare/Esiti) ---"
export_table "Gare" "gare"
export_table "DettaglioGara" "dettaglio_gara"
export_table "AtiGare01" "ati_gare_01"
export_table "Punteggi" "punteggi"
export_table "GareProvince" "gare_province"
export_table "GareSoaSec" "gare_soa_sec"
export_table "GareSoaAlt" "gare_soa_alt"
export_table "GareSoaApp" "gare_soa_app"
export_table "GareSoaSost" "gare_soa_sost"
export_table "GareInvii" "gare_invii"
export_table "GareRicorsi" "gare_ricorsi"
export_table "AssistentiGara" "assistenti_gara"
export_table "Concorrenti" "concorrenti"
export_table "RegistroGare" "registro_gare"

echo ""
echo "--- TABELLE BANDI ---"
export_table "Bandi" "bandi"
export_table "BandiProvince" "bandi_province"
export_table "BandiSoaSec" "bandi_soa_sec"
export_table "BandiSoaAlt" "bandi_soa_alt"
export_table "BandiSoaApp" "bandi_soa_app"
export_table "BandiModifiche" "bandi_modifiche"
export_table "BandiProbabilita" "bandi_probabilita"
export_table "AllegatiBando" "allegati_bando"

echo ""
echo "--- TABELLE SIMULAZIONI ---"
export_table "Simulazioni" "simulazioni"
export_table "SimulazioniDettagli" "simulazioni_dettagli"
export_table "SimulazioniGare" "simulazioni_gare"
export_table "SimulazionePesi" "simulazione_pesi"
export_table "SimulazioniProvince" "simulazioni_province"
export_table "SimulazioniSoaSec" "simulazioni_soa_sec"
export_table "SimulazioniTipologie" "simulazioni_tipologie"

echo ""
echo "--- TABELLE SOPRALLUOGHI ---"
export_table "Sopralluoghi" "sopralluoghi"
export_table "SopralluoghiDate" "sopralluoghi_date"
export_table "SopralluoghiRichieste" "sopralluoghi_richieste"
export_table "DateSopralluoghi" "date_sopralluoghi"

echo ""
echo "--- TABELLE AZIENDE ---"
export_table "Aziende" "aziende"
export_table "AttestazioniAziende" "attestazioni_aziende"
export_table "AziendaPersonale" "azienda_personale"
export_table "Consorzi" "consorzi"
export_table "ModificheAzienda" "modifiche_azienda"
export_table "NoteAziende" "note_aziende"
export_table "Partecipazioni" "partecipazioni"

echo ""
echo "--- TABELLE LOOKUP/RIFERIMENTO ---"
export_table "Soa" "soa"
export_table "SoaCorrispondenze" "soa_corrispondenze"
export_table "Province" "province"
export_table "Regioni" "regioni"
export_table "Comuni" "comuni"
export_table "Criteri" "criteri"
export_table "TipoDatiGara" "tipo_dati_gara"
export_table "TipologiaBandi" "tipologia_bandi"
export_table "TipologiaGare" "tipologia_gare"
export_table "Attestazioni" "attestazioni"
export_table "Stazioni" "stazioni"
export_table "Piattaforme" "piattaforme"

echo ""
echo "--- TABELLE UTENTI ---"
export_table "Users" "users"
export_table "UsersPeriodi" "users_periodi"
export_table "RichiesteServizi" "richieste_servizi"

echo ""
echo "============================================"
echo "  ESPORTAZIONE COMPLETATA!"
echo "  File salvati in: $EXPORT_DIR"
echo "============================================"
echo ""
ls -lh "$EXPORT_DIR"/*.csv 2>/dev/null | awk '{print $5, $9}'
echo ""
echo "Totale:"
du -sh "$EXPORT_DIR"
