# Guida Setup Backend easyWin

## Prerequisiti da installare

### 1. Node.js (versione 20 o superiore)

Vai su https://nodejs.org e scarica la versione **LTS** (Long Term Support).
Installalo seguendo il wizard (clicca sempre "Next").

Per verificare che sia installato, apri il **Terminale** (Mac) o **Prompt dei comandi** (Windows) e scrivi:

```
node --version
```

Deve mostrare qualcosa tipo `v20.x.x` o superiore.

---

### 2. PostgreSQL (versione 15 o 16)

**Su Mac:**
Il modo più semplice è usare l'app Postgres.app:
- Vai su https://postgresapp.com
- Scarica e installa
- Aprila: il server parte automaticamente

**Su Windows:**
- Vai su https://www.postgresql.org/download/windows/
- Scarica l'installer e seguilo
- **IMPORTANTE**: durante l'installazione ti chiederà una password per l'utente `postgres`. Sceglila e **annotala**, ti servirà dopo
- Lascia la porta di default **5432**

---

## Setup del progetto

### Passo 1: Apri il Terminale nella cartella backend

**Su Mac:** Apri Finder, vai nella cartella `sito easywin/backend`, poi clic destro → "Apri Terminale" (oppure trascina la cartella nel Terminale).

**Su Windows:** Apri la cartella `sito easywin\backend` in Esplora File, clicca sulla barra dell'indirizzo, scrivi `cmd` e premi Invio.

---

### Passo 2: Installa le dipendenze

```
npm install
```

Aspetta che finisca (può volerci 1-2 minuti). Vedrai una barra di progresso.

---

### Passo 3: Crea il database

Apri un nuovo terminale e connettiti a PostgreSQL:

**Su Mac (con Postgres.app):**
```
psql -U postgres
```

**Su Windows:**
```
psql -U postgres -h localhost
```

Ti chiederà la password (quella che hai scelto durante l'installazione di PostgreSQL).

Una volta dentro psql (vedrai il prompt `postgres=#`), esegui questi comandi uno alla volta:

```sql
CREATE USER easywin WITH PASSWORD 'EasyWin2026!';
CREATE DATABASE easywin OWNER easywin;
GRANT ALL PRIVILEGES ON DATABASE easywin TO easywin;
\q
```

L'ultimo comando (`\q`) ti fa uscire da psql.

---

### Passo 4: Esegui la migrazione (crea le tabelle)

Torna nel terminale della cartella `backend` e connettiti al database appena creato:

```
psql -U easywin -d easywin -h localhost
```

La password è `EasyWin2026!` (quella del Passo 3).

Ora esegui lo script SQL che crea tutte le tabelle:

```
\i src/db/migrations/001_bandi_schema.sql
```

Vedrai molte righe tipo `CREATE TABLE`, `INSERT`, `CREATE INDEX`. È tutto normale.

Quando finisce, esci con:
```
\q
```

---

### Passo 5: Configura il file .env

Nella cartella `backend`, copia il file di esempio:

**Su Mac:**
```
cp .env.example .env
```

**Su Windows:**
```
copy .env.example .env
```

Ora apri il file `.env` con un editor di testo (anche Blocco Note va bene) e modifica queste righe:

```
# La password che hai usato nel Passo 3
DATABASE_URL=postgresql://easywin:EasyWin2026!@localhost:5432/easywin
DB_PASSWORD=EasyWin2026!

# Scegli una stringa casuale per la sicurezza (almeno 32 caratteri)
JWT_SECRET=easywin-secret-2026-cambiare-in-produzione

# La tua chiave API Claude (opzionale per ora, serve per la funzione AI)
ANTHROPIC_API_KEY=sk-ant-xxxxx

# Le tue credenziali Presidia (quelle che usi già nel vecchio sito)
PRESIDIA_USERNAME=il_tuo_utente_presidia
PRESIDIA_PASSWORD=la_tua_password_presidia
```

**Salva e chiudi il file.**

---

### Passo 6: Crea la cartella uploads

```
mkdir uploads
```

---

### Passo 7: Avvia il server

```
npm run dev
```

Se tutto è andato bene, vedrai:

```
easyWin Backend avviato su http://0.0.0.0:3001
```

Il server si riavvia automaticamente quando modifichi i file (modalità sviluppo).

---

## Verificare che funzioni

Con il server avviato, apri il browser e vai a:

- **Health check:** http://localhost:3001/api/health
  Deve mostrare: `{"status":"ok","timestamp":"..."}`

- **Lista regioni:** http://localhost:3001/api/lookups/regioni
  Deve mostrare le 20 regioni italiane in JSON

- **Lista SOA:** http://localhost:3001/api/lookups/soa
  Deve mostrare le 48 categorie SOA

- **Lista bandi:** http://localhost:3001/api/bandi
  Deve mostrare un array vuoto `[]` (non ci sono ancora bandi)

---

## Comandi utili

| Comando | Cosa fa |
|---------|---------|
| `npm run dev` | Avvia il server in modalità sviluppo |
| `npm start` | Avvia il server in produzione |
| `Ctrl + C` | Ferma il server |

---

## Problemi comuni

**"ECONNREFUSED" o "Connection refused"**
PostgreSQL non è avviato. Su Mac apri Postgres.app, su Windows avvia il servizio PostgreSQL da Servizi.

**"password authentication failed"**
La password nel file `.env` non corrisponde a quella del database. Verifica di aver usato la stessa password del Passo 3.

**"relation does not exist"**
Non hai eseguito la migrazione (Passo 4). Rieseguila.

**"ANTHROPIC_API_KEY not set" quando usi la funzione AI**
Devi inserire la chiave API Claude nel file `.env`. La puoi ottenere su https://console.anthropic.com

**Porta 3001 già in uso**
Cambia la porta nel file `.env` (es. `PORT=3002`).
