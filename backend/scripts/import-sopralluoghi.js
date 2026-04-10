/**
 * Import sopralluoghi data from old EasyWin CSV export
 * Run: node backend/scripts/import-sopralluoghi.js
 */

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXPORT_DIR = join(__dirname, '..', '..', '..', 'easywin_export');

const DATABASE_URL = 'postgresql://neondb_owner:npg_yI4wt1vXhCGf@ep-young-shadow-ag24ppum-pooler.c-2.eu-central-1.aws.neon.tech/neondb?sslmode=require';

const pool = new pg.Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

function parseVal(val) {
  if (val === 'NULL' || val === '' || val === undefined) return null;
  return val;
}

function parseBool(val) {
  if (val === 'NULL' || val === '' || val === undefined) return false;
  if (val === '1' || val === 'True' || val === 'true') return true;
  return false;
}

function parseNum(val) {
  if (val === 'NULL' || val === '' || val === undefined) return null;
  const n = parseFloat(val);
  return isNaN(n) ? null : n;
}

function parseInt2(val) {
  if (val === 'NULL' || val === '' || val === undefined) return null;
  const n = parseInt(val);
  return isNaN(n) ? null : n;
}

function parseDate(val) {
  if (val === 'NULL' || val === '' || val === undefined) return null;
  try {
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d.toISOString();
  } catch { return null; }
}

async function main() {
  const client = await pool.connect();

  try {
    // Read CSV
    const csv = readFileSync(join(EXPORT_DIR, 'sopralluoghi.csv'), 'utf-8');
    const lines = csv.split('\n').filter(l => l.trim());

    // Skip header and separator
    const header = lines[0].split('|');
    console.log(`Header columns: ${header.length}`);
    console.log(`Data lines: ${lines.length - 2}`);

    let imported = 0, skipped = 0, errors = 0;

    for (let i = 2; i < lines.length; i++) {
      const cols = lines[i].split('|');
      if (cols.length < 10) { skipped++; continue; }

      const id_visione = parseVal(cols[0]);
      const id_bando = parseVal(cols[1]);

      if (!id_visione || !id_bando) { skipped++; continue; }

      // Check if bando exists in new DB (UUID)
      const bandoCheck = await client.query('SELECT id FROM bandi WHERE id = $1', [id_bando]);
      if (bandoCheck.rows.length === 0) {
        // Bando not migrated yet - skip but count
        skipped++;
        continue;
      }

      // Check if id_azienda exists
      const id_azienda = parseInt2(cols[13]);
      if (id_azienda) {
        const azCheck = await client.query('SELECT id FROM aziende WHERE id = $1', [id_azienda]);
        if (azCheck.rows.length === 0) {
          skipped++;
          continue;
        }
      }

      try {
        await client.query(`
          INSERT INTO sopralluoghi (
            id_visione, id_bando,
            "DataSopralluogo", "Prenotato", "TipoPrenotazione",
            "Fax", "Telefono", "Email", "Username",
            "Indirizzo", "Cap", id_provincia, "Citta", id_azienda,
            "Note", "DataInserimento", "InseritoDa", "DataModifica", "ModificatoDa",
            "PresaVisione", "DataRichiesta",
            "RiferimentoAziendaRichiedente",
            "RiferimentoIntermediarioRichiedente",
            "RiferimentoIntermediarioEsecutore",
            "GestoreRichiesta",
            "IDIntermediarioRichiedente", "IDIntermediarioEsecutore",
            "IDTipoEsecutore", "IDEsecutoreEsterno",
            "Richiesta", "Esecuzione",
            "PagatoDaAziendaAEdra", "ImponibileDaAziendaAEdra", "IvaDaAziendaAEdra",
            "TotaleDaAziendaAEdra", "DataPagamentoDaAziendaAEdra",
            "PagatoDaEdraAlGestoreChiamata", "ImponibileDaEdraAGestoreChiamata",
            "IvaDaEdraAGestoreChiamata", "TotaleDaEdraAGestoreChiamata",
            "DataPagamentoDaEdraAGestoreChiamata",
            "PagatoDaEdraACollaboratore", "ImponibileDaEdraACollaboratore",
            "IvaDaEdraACollaboratore", "TotaleDaEdraACollaboratore",
            "DataPagamentoDaEdraACollaboratore",
            "PagatoDaEdraAIntermediari", "ImponibileDaEdraAIntermediari",
            "IvaDaEdraAIntermediari", "TotaleDaEdraAIntermediari",
            "DataPagamentoDaEdraAIntermediari",
            "PagatoDaIntermediariAEdra", "ImponibileDaIntermediariAEdra",
            "IvaDaIntermediariAEdra", "TotaleDaIntermediariAEdra",
            "DataPagamentoDaIntermediariAEdra",
            "DataPrenotazione", "ProformaInviato", "FatturaElettronicaGenerata",
            "Eseguito", "Annullato",
            "NumATI", "IDAziendaATI01", "IDAziendaATI02", "IDAziendaATI03", "IDAziendaATI04",
            "AziendaAbbonataSopralluoghi"
          ) VALUES (
            $1, $2,
            $3, $4, $5,
            $6, $7, $8, $9,
            $10, $11, $12, $13, $14,
            $15, $16, $17, $18, $19,
            $20, $21,
            $22, $23, $24, $25,
            $26, $27, $28, $29,
            $30, $31,
            $32, $33, $34, $35, $36,
            $37, $38, $39, $40, $41,
            $42, $43, $44, $45, $46,
            $47, $48, $49, $50, $51,
            $52, $53, $54, $55, $56,
            $57, $58, $59, $60, $61,
            $62, $63, $64, $65, $66
          )
          ON CONFLICT (id_visione) DO NOTHING
        `, [
          id_visione,                           // $1
          id_bando,                             // $2
          parseDate(cols[2]),                    // $3 DataSopralluogo
          parseBool(cols[3]),                    // $4 Prenotato
          parseVal(cols[4]),                     // $5 TipoPrenotazione
          parseVal(cols[5]),                     // $6 Fax
          parseVal(cols[6]),                     // $7 Telefono
          parseVal(cols[7]),                     // $8 Email
          parseVal(cols[8]),                     // $9 Username
          parseVal(cols[9]),                     // $10 Indirizzo
          parseVal(cols[10]),                    // $11 Cap
          parseInt2(cols[11]),                   // $12 id_provincia
          parseVal(cols[12]),                    // $13 Citta
          id_azienda || 1,                      // $14 id_azienda (default 1 if null - required field)
          parseVal(cols[14]),                    // $15 Note
          parseDate(cols[15]),                   // $16 DataInserimento
          parseVal(cols[16]),                    // $17 InseritoDa
          parseDate(cols[17]),                   // $18 DataModifica
          parseVal(cols[18]),                    // $19 ModificatoDa
          parseBool(cols[19]),                   // $20 PresaVisione
          parseDate(cols[20]),                   // $21 DataRichiesta
          parseVal(cols[21]),                    // $22 RiferimentoAziendaRichiedente
          parseVal(cols[22]),                    // $23 RiferimentoIntermediarioRichiedente
          parseVal(cols[23]),                    // $24 RiferimentoIntermediarioEsecutore
          parseVal(cols[24]),                    // $25 GestoreRichiesta
          parseVal(cols[25]),                    // $26 IDIntermediarioRichiedente (UUID)
          parseVal(cols[26]),                    // $27 IDIntermediarioEsecutore (UUID)
          parseInt2(cols[27]),                   // $28 IDTipoEsecutore
          parseInt2(cols[28]),                   // $29 IDEsecutoreEsterno
          parseInt2(cols[29]),                   // $30 Richiesta
          parseInt2(cols[30]),                   // $31 Esecuzione
          parseBool(cols[31]),                   // $32 PagatoDaAziendaAEdra
          parseNum(cols[32]),                    // $33 ImponibileDaAziendaAEdra
          parseNum(cols[33]),                    // $34 IvaDaAziendaAEdra
          parseNum(cols[34]),                    // $35 TotaleDaAziendaAEdra
          parseDate(cols[35]),                   // $36 DataPagamentoDaAziendaAEdra
          parseBool(cols[36]),                   // $37 PagatoDaEdraAlGestoreChiamata
          parseNum(cols[37]),                    // $38 ImponibileDaEdraAGestoreChiamata
          parseNum(cols[38]),                    // $39 IvaDaEdraAGestoreChiamata
          parseNum(cols[39]),                    // $40 TotaleDaEdraAGestoreChiamata
          parseDate(cols[40]),                   // $41 DataPagamentoDaEdraAGestoreChiamata
          parseBool(cols[41]),                   // $42 PagatoDaEdraACollaboratore
          parseNum(cols[42]),                    // $43 ImponibileDaEdraACollaboratore
          parseNum(cols[43]),                    // $44 IvaDaEdraACollaboratore
          parseNum(cols[44]),                    // $45 TotaleDaEdraACollaboratore
          parseDate(cols[45]),                   // $46 DataPagamentoDaEdraACollaboratore
          parseBool(cols[46]),                   // $47 PagatoDaEdraAIntermediari
          parseNum(cols[47]),                    // $48 ImponibileDaEdraAIntermediari
          parseNum(cols[48]),                    // $49 IvaDaEdraAIntermediari
          parseNum(cols[49]),                    // $50 TotaleDaEdraAIntermediari
          parseDate(cols[50]),                   // $51 DataPagamentoDaEdraAIntermediari
          parseBool(cols[51]),                   // $52 PagatoDaIntermediariAEdra
          parseNum(cols[52]),                    // $53 ImponibileDaIntermediariAEdra
          parseNum(cols[53]),                    // $54 IvaDaIntermediariAEdra
          parseNum(cols[54]),                    // $55 TotaleDaIntermediariAEdra
          parseDate(cols[55]),                   // $56 DataPagamentoDaIntermediariAEdra
          parseDate(cols[56]),                   // $57 DataPrenotazione
          parseBool(cols[57]),                   // $58 ProformaInviato
          parseBool(cols[58]),                   // $59 FatturaElettronicaGenerata
          parseBool(cols[59]),                   // $60 Eseguito
          parseBool(cols[60]),                   // $61 Annullato
          parseInt2(cols[61]),                   // $62 NumATI
          parseInt2(cols[62]),                   // $63 IDAziendaATI01
          parseInt2(cols[63]),                   // $64 IDAziendaATI02
          parseInt2(cols[64]),                   // $65 IDAziendaATI03
          parseInt2(cols[65]),                   // $66 IDAziendaATI04 / AziendaAbbonataSopralluoghi
        ]);

        imported++;
      } catch (err) {
        errors++;
        if (errors <= 5) console.error(`Row ${i}: ${err.message}`);
      }
    }

    console.log(`\n=== Import Sopralluoghi Complete ===`);
    console.log(`Imported: ${imported}`);
    console.log(`Skipped (bando/azienda not found): ${skipped}`);
    console.log(`Errors: ${errors}`);

    // Also import sopralluoghi_date
    console.log('\n--- Importing sopralluoghi_date ---');
    const dateCsv = readFileSync(join(EXPORT_DIR, 'sopralluoghi_date.csv'), 'utf-8');
    const dateLines = dateCsv.split('\n').filter(l => l.trim());
    let dateImported = 0, dateSkipped = 0;

    for (let i = 2; i < dateLines.length; i++) {
      const [id_bando_d, dataSopr] = dateLines[i].split('|');
      if (!id_bando_d || id_bando_d === 'NULL' || !dataSopr || dataSopr === 'NULL') { dateSkipped++; continue; }

      const bandoCheck = await client.query('SELECT id FROM bandi WHERE id = $1', [id_bando_d]);
      if (bandoCheck.rows.length === 0) { dateSkipped++; continue; }

      try {
        await client.query(`
          INSERT INTO sopralluoghi_date (id_bando, "DataSopralluogo")
          VALUES ($1, $2)
          ON CONFLICT (id_bando, "DataSopralluogo") DO NOTHING
        `, [id_bando_d, parseDate(dataSopr)]);
        dateImported++;
      } catch { dateSkipped++; }
    }
    console.log(`Date imported: ${dateImported}, skipped: ${dateSkipped}`);

    // Import sopralluoghi_richieste
    console.log('\n--- Importing sopralluoghi_richieste ---');
    const richCsv = readFileSync(join(EXPORT_DIR, 'sopralluoghi_richieste.csv'), 'utf-8');
    const richLines = richCsv.split('\n').filter(l => l.trim());
    let richImported = 0, richSkipped = 0;

    for (let i = 2; i < richLines.length; i++) {
      const cols = richLines[i].split('|');
      if (cols.length < 8) { richSkipped++; continue; }

      const idBando = parseVal(cols[4]);
      if (!idBando) { richSkipped++; continue; }

      const bandoCheck = await client.query('SELECT id FROM bandi WHERE id = $1', [idBando]);
      if (bandoCheck.rows.length === 0) { richSkipped++; continue; }

      try {
        await client.query(`
          INSERT INTO sopralluoghi_richieste (
            id_bando, id_sopralluogo, "Username",
            data_richiesta, stato, note
          ) VALUES ($1, $2, $3, $4, $5, $6)
        `, [
          idBando,
          parseVal(cols[5]),                    // IDSopralluogo
          parseVal(cols[3]),                    // UserName
          parseDate(cols[2]),                   // DataInserimento
          parseVal(cols[10]) || 'completata',   // Stato
          `Esecuzione: ${cols[6]||'N/A'}, Esecutore: ${cols[7]||'N/A'}`
        ]);
        richImported++;
      } catch { richSkipped++; }
    }
    console.log(`Richieste imported: ${richImported}, skipped: ${richSkipped}`);

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
