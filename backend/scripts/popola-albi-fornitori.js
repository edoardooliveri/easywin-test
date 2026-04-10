/**
 * Script batch: Popola albi_fornitori per piattaforma
 *
 * Questo script:
 * 1. Analizza tutte le stazioni raggruppate per piattaforma (da iscrizioni + fonti_web)
 * 2. Per le piattaforme note, crea record in albi_fornitori con info standard
 * 3. Genera un report CSV delle stazioni senza piattaforma
 *
 * Uso: node scripts/popola-albi-fornitori.js [--dry-run] [--report-only]
 *   --dry-run     Mostra cosa farebbe senza scrivere nel DB
 *   --report-only Genera solo il report CSV senza inserire nulla
 */

import pg from 'pg';
import dotenv from 'dotenv';
import { writeFileSync } from 'fs';

dotenv.config();

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ══════════════════════════════════════════════════
// MAPPA PIATTAFORME → REQUISITI ALBO FORNITORI
// ══════════════════════════════════════════════════
const PIATTAFORME_ALBO = {
  // MePA / CONSIP - Mercato Elettronico della PA
  'MEPA': {
    ha_albo: true,
    nome_albo: 'MePA - Mercato Elettronico PA',
    url_albo: 'https://www.acquistinretepa.it',
    piattaforma: 'MePA',
    procedura_iscrizione: 'Registrazione su acquistinretepa.it → abilitazione a bandi MePA per categoria merceologica. Richiede firma digitale e PEC. Autocertificazioni da rinnovare ogni 12 mesi.',
    documenti_richiesti: [
      { nome: 'Visura camerale', obbligatorio: true },
      { nome: 'DURC (Documento Unico di Regolarità Contributiva)', obbligatorio: true },
      { nome: 'Fatturato aziendale ultimi 3 anni', obbligatorio: true },
      { nome: 'Autocertificazione requisiti generali (art. 80 D.Lgs 50/2016)', obbligatorio: true },
      { nome: 'Firma digitale del legale rappresentante', obbligatorio: true },
      { nome: 'PEC aziendale', obbligatorio: true }
    ]
  },
  'CONSIP': {
    ha_albo: true,
    nome_albo: 'CONSIP - Sistema Dinamico di Acquisizione',
    url_albo: 'https://www.acquistinretepa.it',
    piattaforma: 'CONSIP',
    procedura_iscrizione: 'Abilitazione tramite portale acquistinretepa.it. Stessa procedura MePA per i sistemi dinamici CONSIP.',
    documenti_richiesti: [
      { nome: 'Visura camerale', obbligatorio: true },
      { nome: 'DURC', obbligatorio: true },
      { nome: 'Firma digitale', obbligatorio: true },
      { nome: 'PEC aziendale', obbligatorio: true },
      { nome: 'Autocertificazione requisiti', obbligatorio: true }
    ]
  },

  // Sintel - Regione Lombardia
  'Sintel': {
    ha_albo: true,
    nome_albo: 'Elenco Fornitori Telematico Sintel',
    url_albo: 'https://www.sintel.regione.lombardia.it',
    piattaforma: 'Sintel',
    procedura_iscrizione: 'Registrazione su sintel.regione.lombardia.it → iscrizione Elenco Fornitori Telematico. Richiede dichiarazione sostitutiva DPR 445/2000 e sottoscrizione Patto di Integrità. Stato: "Registrato" dopo invio domanda. Validità dichiarazioni: 180 giorni.',
    documenti_richiesti: [
      { nome: 'Dichiarazione sostitutiva DPR 445/2000', obbligatorio: true },
      { nome: 'Patto di Integrità Regione Lombardia firmato', obbligatorio: true },
      { nome: 'Firma digitale', obbligatorio: true },
      { nome: 'PEC aziendale', obbligatorio: true }
    ]
  },

  // START - Regione Toscana (by i-Faber)
  'START by FABER': {
    ha_albo: true,
    nome_albo: 'Indirizzario Fornitori START',
    url_albo: 'https://start.toscana.it',
    piattaforma: 'START',
    procedura_iscrizione: 'Registrazione online gratuita su start.toscana.it → sezione "Operatori Economici" → "Iscrizione Indirizzario Fornitori". Selezionare almeno una categoria merceologica. Non richiede firma digitale per la registrazione (solo per partecipare a gare).',
    documenti_richiesti: [
      { nome: 'Nessun documento per la registrazione', obbligatorio: false, note: 'La registrazione è gratuita e senza documenti. Firma digitale necessaria solo per partecipare a gare.' }
    ]
  },
  'FABER': {
    ha_albo: true,
    nome_albo: 'Albo Fornitori i-Faber',
    url_albo: 'https://www.i-faber.com',
    piattaforma: 'FABER',
    procedura_iscrizione: 'Registrazione online sulla piattaforma i-Faber dell\'ente. Procedura analoga a START.',
    documenti_richiesti: [
      { nome: 'Registrazione online (nessun documento specifico)', obbligatorio: false }
    ]
  },

  // Intercent-ER - Regione Emilia-Romagna
  'Intercent-ER': {
    ha_albo: true,
    nome_albo: 'Albo Fornitori SATER',
    url_albo: 'https://intercenter.regione.emilia-romagna.it',
    piattaforma: 'Intercent-ER',
    procedura_iscrizione: 'Registrazione su piattaforma SATER (Sistema Acquisti Telematici Emilia-Romagna). L\'iscrizione al Mercato Elettronico determina l\'iscrizione all\'Albo Fornitori. Richiede firma digitale e registrazione Peppol per documenti elettronici.',
    documenti_richiesti: [
      { nome: 'Firma digitale del legale rappresentante', obbligatorio: true },
      { nome: 'PEC aziendale', obbligatorio: true },
      { nome: 'Registrazione rete Peppol (per ordini/fatture)', obbligatorio: false }
    ]
  },

  // TuttoGare - Usato da ~650 enti
  'TuttoGare': {
    ha_albo: true,
    nome_albo: 'Albo Fornitori TuttoGare',
    url_albo: null, // Ogni ente ha il suo URL
    piattaforma: 'TuttoGare',
    procedura_iscrizione: 'Registrazione sul portale dell\'ente → sezione Albo Fornitori → compilazione modulo online. Ogni stazione appaltante configura i propri requisiti. Possibile allegare DGUE e autodichiarazioni. I documenti hanno scadenza configurata dall\'ente.',
    documenti_richiesti: [
      { nome: 'DGUE (Documento di Gara Unico Europeo)', obbligatorio: true },
      { nome: 'Autodichiarazioni (configurate dall\'ente)', obbligatorio: true },
      { nome: 'PEC aziendale', obbligatorio: true },
      { nome: 'Firma digitale', obbligatorio: true }
    ]
  },
  'Asmecomm by TuttoGare': {
    ha_albo: true,
    nome_albo: 'Albo Fornitori Asmecomm',
    url_albo: 'https://piattaforma.asmecomm.it',
    piattaforma: 'Asmecomm/TuttoGare',
    procedura_iscrizione: 'Come TuttoGare. Registrazione su piattaforma.asmecomm.it → Albo Fornitori.',
    documenti_richiesti: [
      { nome: 'DGUE', obbligatorio: true },
      { nome: 'Autodichiarazioni', obbligatorio: true },
      { nome: 'Firma digitale', obbligatorio: true }
    ]
  },
  'Asmepal by TuttoGare': {
    ha_albo: true,
    nome_albo: 'Albo Fornitori Asmepal',
    url_albo: 'https://piattaforma.asmel.eu',
    piattaforma: 'Asmepal/TuttoGare',
    procedura_iscrizione: 'Come TuttoGare. Registrazione su piattaforma.asmel.eu → Albo Fornitori.',
    documenti_richiesti: [
      { nome: 'DGUE', obbligatorio: true },
      { nome: 'Autodichiarazioni', obbligatorio: true },
      { nome: 'Firma digitale', obbligatorio: true }
    ]
  },

  // NET4MARKET
  'NET4MARKET': {
    ha_albo: true,
    nome_albo: 'Albo Fornitori Net4market',
    url_albo: 'https://www.net4market.com',
    piattaforma: 'NET4MARKET',
    procedura_iscrizione: 'Registrazione su net4market.com → ricerca albo della stazione appaltante → compilazione scheda Preliminare e Principale. Ogni ente configura i propri requisiti documentali. Disponibile iscrizione automatica a più albi.',
    documenti_richiesti: [
      { nome: 'Documenti configurati dall\'ente (variabili)', obbligatorio: true },
      { nome: 'PEC aziendale', obbligatorio: true },
      { nome: 'Firma digitale', obbligatorio: true }
    ]
  },

  // Empulia - Regione Puglia
  'Empulia': {
    ha_albo: true,
    nome_albo: 'Albo Fornitori Empulia',
    url_albo: 'https://eprocurement.empulia.it',
    piattaforma: 'Empulia',
    procedura_iscrizione: 'Registrazione su eprocurement.empulia.it → iscrizione Albo Fornitori regionale. Piattaforma regionale per la Puglia.',
    documenti_richiesti: [
      { nome: 'Registrazione online con dati aziendali', obbligatorio: true },
      { nome: 'Firma digitale', obbligatorio: true },
      { nome: 'PEC aziendale', obbligatorio: true }
    ]
  },

  // BravoSolutions
  'BravoSolutions': {
    ha_albo: true,
    nome_albo: 'Albo Fornitori BravoSolution',
    url_albo: 'https://bravosolution.it',
    piattaforma: 'BravoSolutions',
    procedura_iscrizione: 'Registrazione sulla piattaforma BravoSolution dell\'ente. Ogni ente configura il proprio albo con requisiti specifici.',
    documenti_richiesti: [
      { nome: 'Documenti configurati dall\'ente (variabili)', obbligatorio: true },
      { nome: 'Firma digitale', obbligatorio: true }
    ]
  },

  // eAppaltiFVG
  'eAppaltiFVG by BravoSolutions': {
    ha_albo: true,
    nome_albo: 'Albo Fornitori eAppalti FVG',
    url_albo: 'https://eappalti.regione.fvg.it',
    piattaforma: 'eAppaltiFVG',
    procedura_iscrizione: 'Registrazione su eappalti.regione.fvg.it. Piattaforma regionale Friuli Venezia Giulia basata su BravoSolutions.',
    documenti_richiesti: [
      { nome: 'Registrazione online', obbligatorio: true },
      { nome: 'Firma digitale', obbligatorio: true }
    ]
  },

  // SardegnaCAT
  'SardegnaCAT by BravoSolutions': {
    ha_albo: true,
    nome_albo: 'Albo Fornitori SardegnaCAT',
    url_albo: 'https://www.sardegnacat.it',
    piattaforma: 'SardegnaCAT',
    procedura_iscrizione: 'Registrazione su sardegnacat.it. Piattaforma regionale Sardegna.',
    documenti_richiesti: [
      { nome: 'Registrazione online', obbligatorio: true },
      { nome: 'Firma digitale', obbligatorio: true }
    ]
  },

  // INVA by FABER
  'INVA by FABER': {
    ha_albo: true,
    nome_albo: 'Albo Fornitori INVA',
    url_albo: 'https://inva.i-faber.com',
    piattaforma: 'INVA',
    procedura_iscrizione: 'Registrazione su inva.i-faber.com. Piattaforma regionale Valle d\'Aosta.',
    documenti_richiesti: [
      { nome: 'Registrazione online (come FABER/START)', obbligatorio: false }
    ]
  },

  // DigitalPA
  'DigitalPA': {
    ha_albo: true,
    nome_albo: 'Albo Fornitori DigitalPA',
    url_albo: 'https://www.digitalpa.it',
    piattaforma: 'DigitalPA',
    procedura_iscrizione: 'Registrazione sulla piattaforma DigitalPA dell\'ente. Ogni ente configura i propri requisiti.',
    documenti_richiesti: [
      { nome: 'Documenti configurati dall\'ente (variabili)', obbligatorio: true },
      { nome: 'Firma digitale', obbligatorio: true }
    ]
  },

  // MAGGIOLI
  'MAGGIOLI': {
    ha_albo: true,
    nome_albo: 'Albo Fornitori Appalti&Contratti',
    url_albo: 'http://www.appaltiecontratti.it',
    piattaforma: 'MAGGIOLI',
    procedura_iscrizione: 'Registrazione su appaltiecontratti.it → Albo Fornitori dell\'ente.',
    documenti_richiesti: [
      { nome: 'Documenti configurati dall\'ente (variabili)', obbligatorio: true },
      { nome: 'Firma digitale', obbligatorio: true }
    ]
  },

  // MERCURIO - Provincia di Trento
  'MERCURIO': {
    ha_albo: true,
    nome_albo: 'Albo Fornitori Mercurio',
    url_albo: 'http://www.mercurio.provincia.tn.it',
    piattaforma: 'MERCURIO',
    procedura_iscrizione: 'Registrazione su mercurio.provincia.tn.it. Piattaforma della Provincia Autonoma di Trento.',
    documenti_richiesti: [
      { nome: 'Registrazione online', obbligatorio: true },
      { nome: 'Firma digitale', obbligatorio: true }
    ]
  },

  // TRASPARE
  'TRASPARE': {
    ha_albo: true,
    nome_albo: 'Albo Fornitori Traspare',
    url_albo: 'https://www.traspare.com',
    piattaforma: 'TRASPARE',
    procedura_iscrizione: 'Registrazione su traspare.com → Albo Fornitori dell\'ente.',
    documenti_richiesti: [
      { nome: 'Documenti configurati dall\'ente', obbligatorio: true },
      { nome: 'Firma digitale', obbligatorio: true }
    ]
  },

  // Piattaforme generiche senza albo specifico
  'Nessuna': { ha_albo: false, note: 'Nessuna piattaforma associata' },
  'Non indicata': { ha_albo: false, note: 'Piattaforma non indicata' },
  'PIATTAFORMA COMUNE': { ha_albo: true, nome_albo: 'Albo Fornitori del Comune', piattaforma: 'Piattaforma comunale', procedura_iscrizione: 'Da verificare singolarmente. Ogni comune gestisce il proprio albo.', documenti_richiesti: [{ nome: 'Da verificare', obbligatorio: true }] },
  'PIATTAFORMA CUC': { ha_albo: true, nome_albo: 'Albo Fornitori CUC', piattaforma: 'Centrale Unica di Committenza', procedura_iscrizione: 'Da verificare presso la CUC di riferimento.', documenti_richiesti: [{ nome: 'Da verificare', obbligatorio: true }] },
  'PIATTAFORMA ENTE': { ha_albo: true, nome_albo: 'Albo Fornitori dell\'ente', piattaforma: 'Piattaforma propria', procedura_iscrizione: 'Da verificare sul sito dell\'ente.', documenti_richiesti: [{ nome: 'Da verificare', obbligatorio: true }] },
};

// ══════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const reportOnly = args.includes('--report-only');

  console.log('╔════════════════════════════════════════════════════╗');
  console.log('║   POPOLA ALBI FORNITORI PER PIATTAFORMA           ║');
  console.log('╠════════════════════════════════════════════════════╣');
  console.log(`║   Modalità: ${dryRun ? 'DRY RUN (nessuna scrittura)' : reportOnly ? 'SOLO REPORT' : 'PRODUZIONE (scrive nel DB)'}  ║`);
  console.log('╚════════════════════════════════════════════════════╝\n');

  try {
    // 1. Statistiche generali
    const totalRes = await pool.query('SELECT COUNT(*) FROM stazioni WHERE attivo = true');
    console.log(`📊 Stazioni attive totali: ${totalRes.rows[0].count}`);

    const albiExistRes = await pool.query('SELECT COUNT(DISTINCT id_stazione) FROM albi_fornitori WHERE attivo = true');
    console.log(`📋 Stazioni con albo già configurato: ${albiExistRes.rows[0].count}`);

    // 2. Raggruppa stazioni per piattaforma (da iscrizioni)
    const piattFromIscrizioni = await pool.query(`
      SELECT p.nome AS piattaforma, COUNT(DISTINCT i.id_stazione) AS n_stazioni
      FROM iscrizione_stazioni i
      JOIN piattaforme p ON p.id = i.id_piattaforma
      GROUP BY p.nome
      ORDER BY n_stazioni DESC
    `);

    console.log('\n📊 STAZIONI PER PIATTAFORMA (da iscrizioni):');
    console.log('─'.repeat(60));
    let totalConPiattaforma = 0;
    for (const row of piattFromIscrizioni.rows) {
      const mapped = PIATTAFORME_ALBO[row.piattaforma] ? '✅' : '❓';
      console.log(`  ${mapped} ${row.piattaforma.padEnd(35)} ${row.n_stazioni} stazioni`);
      totalConPiattaforma += parseInt(row.n_stazioni);
    }
    console.log(`\n  Totale con piattaforma: ${totalConPiattaforma}`);

    // 3. Piattaforme da fonti_web
    const piattFromFonti = await pool.query(`
      SELECT p.nome AS piattaforma, COUNT(DISTINCT fw.id_stazione) AS n_stazioni
      FROM fonti_web fw
      JOIN piattaforme p ON p.id = fw.id_piattaforma
      WHERE fw.attivo = true
      GROUP BY p.nome
      ORDER BY n_stazioni DESC
    `);

    console.log('\n📊 STAZIONI PER PIATTAFORMA (da fonti web):');
    console.log('─'.repeat(60));
    for (const row of piattFromFonti.rows) {
      const mapped = PIATTAFORME_ALBO[row.piattaforma] ? '✅' : '❓';
      console.log(`  ${mapped} ${row.piattaforma.padEnd(35)} ${row.n_stazioni} stazioni`);
    }

    // 4. Stazioni SENZA nessuna piattaforma
    const senzaPiattaforma = await pool.query(`
      SELECT COUNT(*) FROM stazioni s
      WHERE s.attivo = true
        AND NOT EXISTS (SELECT 1 FROM iscrizione_stazioni i WHERE i.id_stazione = s.id)
        AND NOT EXISTS (SELECT 1 FROM fonti_web fw WHERE fw.id_stazione = s.id AND fw.id_piattaforma IS NOT NULL AND fw.id_piattaforma > 1)
    `);
    console.log(`\n⚠️  Stazioni SENZA piattaforma associata: ${senzaPiattaforma.rows[0].count}`);

    if (reportOnly) {
      // Solo report - genera CSV
      await generateReport();
      await pool.end();
      return;
    }

    // 5. Popola albi_fornitori
    console.log('\n🔧 INIZIO POPOLAMENTO ALBI FORNITORI...\n');

    let inserted = 0;
    let skipped = 0;
    let errors = 0;

    // Per ogni piattaforma mappata, trova le stazioni e crea albi
    for (const [piattNome, alboInfo] of Object.entries(PIATTAFORME_ALBO)) {
      if (!alboInfo.ha_albo) continue;

      // Trova stazioni su questa piattaforma che NON hanno già un albo
      const stazioni = await pool.query(`
        SELECT DISTINCT s.id, s.nome
        FROM stazioni s
        JOIN iscrizione_stazioni i ON i.id_stazione = s.id
        JOIN piattaforme p ON p.id = i.id_piattaforma
        WHERE p.nome = $1 AND s.attivo = true
          AND NOT EXISTS (
            SELECT 1 FROM albi_fornitori af
            WHERE af.id_stazione = s.id AND af.attivo = true AND af.piattaforma = $2
          )
      `, [piattNome, alboInfo.piattaforma || piattNome]);

      if (stazioni.rows.length === 0) continue;

      console.log(`  📌 ${piattNome}: ${stazioni.rows.length} stazioni da aggiornare`);

      for (const st of stazioni.rows) {
        try {
          if (dryRun) {
            console.log(`    [DRY] Inserirebbe albo per: ${st.nome.substring(0, 50)} (ID ${st.id})`);
          } else {
            await pool.query(`
              INSERT INTO albi_fornitori (
                id_stazione, nome_albo, url_albo, piattaforma,
                documenti_richiesti, procedura_iscrizione,
                categorie_soa, categorie_merceologiche,
                attivo, note, created_at
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, $9, NOW())
              ON CONFLICT DO NOTHING
            `, [
              st.id,
              alboInfo.nome_albo || 'Albo Fornitori',
              alboInfo.url_albo,
              alboInfo.piattaforma || piattNome,
              JSON.stringify(alboInfo.documenti_richiesti || []),
              alboInfo.procedura_iscrizione || '',
              '{}', // categorie_soa - da compilare
              '{}', // categorie_merceologiche - da compilare
              `Popolato automaticamente da piattaforma ${piattNome}`
            ]);
          }
          inserted++;
        } catch (err) {
          errors++;
          if (errors <= 5) console.error(`    ❌ Errore per ${st.nome}: ${err.message}`);
        }
      }
    }

    // Anche da fonti_web (stazioni con piattaforma nelle fonti ma non nelle iscrizioni)
    for (const [piattNome, alboInfo] of Object.entries(PIATTAFORME_ALBO)) {
      if (!alboInfo.ha_albo) continue;

      const stazioniFonti = await pool.query(`
        SELECT DISTINCT s.id, s.nome
        FROM stazioni s
        JOIN fonti_web fw ON fw.id_stazione = s.id
        JOIN piattaforme p ON p.id = fw.id_piattaforma
        WHERE p.nome = $1 AND s.attivo = true AND fw.attivo = true
          AND NOT EXISTS (
            SELECT 1 FROM albi_fornitori af
            WHERE af.id_stazione = s.id AND af.attivo = true
          )
      `, [piattNome]);

      if (stazioniFonti.rows.length === 0) continue;

      console.log(`  📌 ${piattNome} (da fonti web): ${stazioniFonti.rows.length} stazioni`);

      for (const st of stazioniFonti.rows) {
        try {
          if (!dryRun) {
            await pool.query(`
              INSERT INTO albi_fornitori (
                id_stazione, nome_albo, url_albo, piattaforma,
                documenti_richiesti, procedura_iscrizione,
                attivo, note, created_at
              ) VALUES ($1, $2, $3, $4, $5, $6, true, $7, NOW())
              ON CONFLICT DO NOTHING
            `, [
              st.id,
              alboInfo.nome_albo || 'Albo Fornitori',
              alboInfo.url_albo,
              alboInfo.piattaforma || piattNome,
              JSON.stringify(alboInfo.documenti_richiesti || []),
              alboInfo.procedura_iscrizione || '',
              `Popolato automaticamente da fonti web - piattaforma ${piattNome}`
            ]);
          }
          inserted++;
        } catch (err) {
          errors++;
        }
      }
    }

    console.log('\n' + '═'.repeat(60));
    console.log(`✅ Albi inseriti: ${inserted}`);
    console.log(`⏭️  Già presenti (saltati): ${skipped}`);
    console.log(`❌ Errori: ${errors}`);

    // 6. Genera report
    await generateReport();

  } catch (err) {
    console.error('ERRORE FATALE:', err);
  } finally {
    await pool.end();
  }
}

async function generateReport() {
  console.log('\n📄 GENERAZIONE REPORT...');

  // Report 1: Stazioni senza piattaforma e senza albo
  const senzaAlbo = await pool.query(`
    SELECT s.id, s.nome, s.citta, p.nome AS provincia, s.sito_web, s.email, s.pec,
           (SELECT COUNT(*) FROM bandi b WHERE b.id_stazione = s.id) AS n_bandi,
           (SELECT COUNT(*) FROM gare g JOIN bandi b ON g.id_bando = b.id WHERE b.id_stazione = s.id) AS n_esiti,
           (SELECT string_agg(DISTINCT plt.nome, ', ')
            FROM iscrizione_stazioni isc JOIN piattaforme plt ON plt.id = isc.id_piattaforma
            WHERE isc.id_stazione = s.id AND plt.nome NOT IN ('Nessuna','Non indicata')) AS piattaforme
    FROM stazioni s
    LEFT JOIN province p ON s.id_provincia = p.id
    WHERE s.attivo = true
      AND NOT EXISTS (SELECT 1 FROM albi_fornitori af WHERE af.id_stazione = s.id AND af.attivo = true)
    ORDER BY (SELECT COUNT(*) FROM bandi b WHERE b.id_stazione = s.id) DESC
    LIMIT 5000
  `);

  // CSV
  let csv = 'ID;Nome;Citta;Provincia;Sito Web;Email;PEC;N_Bandi;N_Esiti;Piattaforme\n';
  for (const r of senzaAlbo.rows) {
    csv += `${r.id};"${(r.nome||'').replace(/"/g, '""')}";"${r.citta||''}";"${r.provincia||''}";"${r.sito_web||''}";"${r.email||''}";"${r.pec||''}";"${r.n_bandi}";"${r.n_esiti}";"${r.piattaforme||'NESSUNA'}"\n`;
  }

  const reportPath = 'scripts/report-stazioni-senza-albo.csv';
  writeFileSync(reportPath, csv, 'utf8');
  console.log(`📄 Report generato: ${reportPath} (${senzaAlbo.rows.length} stazioni)`);

  // Report 2: Riepilogo albi per piattaforma dopo il popolamento
  const riepilogo = await pool.query(`
    SELECT af.piattaforma, COUNT(*) AS n_albi, COUNT(DISTINCT af.id_stazione) AS n_stazioni
    FROM albi_fornitori af
    WHERE af.attivo = true
    GROUP BY af.piattaforma
    ORDER BY n_stazioni DESC
  `);

  console.log('\n📊 RIEPILOGO ALBI FORNITORI NEL DATABASE:');
  console.log('─'.repeat(60));
  let totAlbi = 0;
  for (const r of riepilogo.rows) {
    console.log(`  ${(r.piattaforma||'N/D').padEnd(35)} ${r.n_stazioni} stazioni`);
    totAlbi += parseInt(r.n_stazioni);
  }
  console.log(`\n  TOTALE stazioni con albo: ${totAlbi}`);
}

main().catch(console.error);
