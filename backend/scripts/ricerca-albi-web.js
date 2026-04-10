/**
 * Script: Ricerca Web Albi Fornitori per Stazione
 *
 * Per ogni stazione nel database:
 * 1. Cerca sul web il sito/albo fornitori della stazione
 * 2. Scarica la pagina dell'albo
 * 3. Usa Claude AI per estrarre: ha albo? quali documenti? procedura?
 * 4. Salva i risultati nel database (albi_fornitori)
 *
 * Lo script è INCREMENTALE: salta le stazioni già processate.
 * Può essere interrotto e ripreso in qualsiasi momento.
 *
 * Uso:
 *   node scripts/ricerca-albi-web.js                    # Processa tutte (ordinate per n_bandi)
 *   node scripts/ricerca-albi-web.js --limit 100        # Solo le prime 100
 *   node scripts/ricerca-albi-web.js --offset 500       # Parti dalla 501esima
 *   node scripts/ricerca-albi-web.js --dry-run           # Non scrive nel DB
 *   node scripts/ricerca-albi-web.js --id 1234           # Solo una stazione specifica
 */

import pg from 'pg';
import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';
import { writeFileSync, readFileSync, existsSync } from 'fs';

dotenv.config();

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ══════════════════════════════════════════════════
// CONFIGURAZIONE
// ══════════════════════════════════════════════════
const CONFIG = {
  // Pausa tra le richieste web (ms) per non sovraccaricare i server
  DELAY_BETWEEN_REQUESTS: 2000,
  // Timeout per fetch HTTP (ms)
  FETCH_TIMEOUT: 15000,
  // Max tentativi per stazione
  MAX_RETRIES: 2,
  // File di log progressi
  PROGRESS_FILE: 'scripts/ricerca-albi-progress.json',
  // File report
  REPORT_FILE: 'scripts/ricerca-albi-report.csv',
  // Claude model
  MODEL: 'claude-sonnet-4-20250514',
};

// ══════════════════════════════════════════════════
// FUNZIONI DI RICERCA WEB
// ══════════════════════════════════════════════════

/**
 * Cerca su Google il sito dell'albo fornitori di una stazione
 */
async function cercaAlboWeb(nomeStazione, citta, sitoWeb) {
  const urls = [];

  // Se ha già un sito web, prova prima quello
  if (sitoWeb) {
    urls.push(sitoWeb);
    // Prova anche URL comuni per albo fornitori
    const base = sitoWeb.replace(/\/$/, '');
    urls.push(`${base}/albo-fornitori`);
    urls.push(`${base}/bandi-e-gare`);
    urls.push(`${base}/amministrazione-trasparente/bandi-di-gara-e-contratti`);
  }

  // Cerca su Google
  const searchQuery = `"${nomeStazione}" albo fornitori iscrizione`;
  try {
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(searchQuery)}&num=5`;
    const res = await fetchWithTimeout(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    if (res.ok) {
      const html = await res.text();
      // Estrai URL dai risultati Google
      const urlMatches = html.match(/https?:\/\/[^\s"<>]+alb[oi][^\s"<>]*/gi) || [];
      urls.push(...urlMatches.slice(0, 3));

      // Estrai anche URL generici dei risultati
      const genericMatches = html.match(/https?:\/\/(?:www\.)?[a-zA-Z0-9.-]+\.(?:it|gov\.it|eu)[^\s"<>]*/gi) || [];
      urls.push(...genericMatches.filter(u => !u.includes('google') && !u.includes('youtube')).slice(0, 3));
    }
  } catch (e) {
    // Google potrebbe bloccare, proviamo DuckDuckGo
    try {
      const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(searchQuery)}`;
      const res = await fetchWithTimeout(ddgUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; EasyWin-Bot/1.0)' }
      });
      if (res.ok) {
        const html = await res.text();
        const urlMatches = html.match(/https?:\/\/[^\s"<>]+/gi) || [];
        urls.push(...urlMatches.filter(u =>
          !u.includes('duckduckgo') && !u.includes('google') &&
          (u.includes('.it') || u.includes('.gov') || u.includes('.eu'))
        ).slice(0, 5));
      }
    } catch (e2) { /* ignore */ }
  }

  // Deduplica
  return [...new Set(urls)].slice(0, 8);
}

/**
 * Scarica il contenuto di una pagina web
 */
async function scaricaPagina(url) {
  try {
    const res = await fetchWithTimeout(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'it-IT,it;q=0.9'
      },
      redirect: 'follow'
    });
    if (!res.ok) return null;

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('text/plain')) return null;

    let html = await res.text();
    // Pulisci HTML: rimuovi script, style, commenti
    html = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ');
    html = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ');
    html = html.replace(/<!--[\s\S]*?-->/g, ' ');
    html = html.replace(/<[^>]+>/g, ' ');
    html = html.replace(/\s+/g, ' ');
    // Limita a 8000 caratteri per non superare i limiti del prompt
    return html.substring(0, 8000).trim();
  } catch (e) {
    return null;
  }
}

/**
 * Usa Claude per analizzare il contenuto e estrarre info albo
 */
async function analizzaConAI(nomeStazione, citta, contenuti) {
  const prompt = `Sei un esperto di appalti pubblici italiani. Analizza i seguenti contenuti web relativi alla stazione appaltante "${nomeStazione}" (${citta || 'Italia'}) e determina:

1. La stazione ha un ALBO FORNITORI attivo?
2. Se sì, quali DOCUMENTI sono richiesti per iscriversi?
3. Qual è la PROCEDURA di iscrizione?
4. Qual è l'URL diretto dell'albo fornitori?

CONTENUTI WEB TROVATI:
${contenuti.map((c, i) => `--- Pagina ${i + 1} (${c.url}) ---\n${c.text?.substring(0, 3000) || 'Contenuto non disponibile'}`).join('\n\n')}

Rispondi ESCLUSIVAMENTE in JSON valido con questa struttura:
{
  "ha_albo": true/false,
  "confidenza": "alta"/"media"/"bassa",
  "nome_albo": "nome dell'albo se trovato",
  "url_albo": "URL diretto alla pagina dell'albo",
  "piattaforma": "nome piattaforma se identificata (es. TuttoGare, MePA, Sintel, Net4market...)",
  "documenti_richiesti": [
    {"nome": "nome documento", "obbligatorio": true/false, "note": "eventuali dettagli"}
  ],
  "procedura_iscrizione": "descrizione step-by-step della procedura",
  "categorie_accettate": "se menzionate, quali categorie merceologiche/SOA accetta l'albo",
  "scadenza": "se c'è una scadenza per l'iscrizione",
  "note": "altre informazioni rilevanti trovate"
}

Se NON trovi evidenza di un albo fornitori, rispondi:
{
  "ha_albo": false,
  "confidenza": "alta"/"media"/"bassa",
  "note": "motivo per cui non è stato trovato"
}

IMPORTANTE: Rispondi SOLO con il JSON, senza altro testo.`;

  try {
    const msg = await anthropic.messages.create({
      model: CONFIG.MODEL,
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }]
    });

    const text = msg.content[0].text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return { ha_albo: false, confidenza: 'bassa', note: 'Risposta AI non parsabile' };
  } catch (e) {
    return { ha_albo: false, confidenza: 'bassa', note: `Errore AI: ${e.message}` };
  }
}

// ══════════════════════════════════════════════════
// FUNZIONE PRINCIPALE PER UNA STAZIONE
// ══════════════════════════════════════════════════

async function processaStazione(stazione) {
  const { id, nome, citta, provincia, sito_web, piattaforma_nome } = stazione;

  console.log(`\n  🔍 [${id}] ${nome.substring(0, 50)} (${citta || ''}, ${provincia || ''})`);

  // 1. Cerca URL candidati
  const urls = await cercaAlboWeb(nome, citta, sito_web);
  console.log(`     Trovati ${urls.length} URL candidati`);

  if (urls.length === 0) {
    return {
      id,
      ha_albo: false,
      confidenza: 'bassa',
      note: 'Nessun URL trovato nella ricerca web'
    };
  }

  // 2. Scarica le pagine
  const contenuti = [];
  for (const url of urls.slice(0, 4)) { // Max 4 pagine
    await delay(500);
    const text = await scaricaPagina(url);
    if (text && text.length > 100) {
      contenuti.push({ url, text });
      console.log(`     ✅ ${url.substring(0, 60)}... (${text.length} chars)`);
    }
  }

  if (contenuti.length === 0) {
    return {
      id,
      ha_albo: false,
      confidenza: 'bassa',
      note: 'Nessuna pagina scaricabile tra gli URL trovati'
    };
  }

  // 3. Analizza con AI
  console.log(`     🤖 Analisi AI in corso...`);
  const risultato = await analizzaConAI(nome, citta, contenuti);
  risultato.id_stazione = id;
  risultato.urls_analizzati = contenuti.map(c => c.url);

  if (risultato.ha_albo) {
    console.log(`     ✅ ALBO TROVATO! Docs: ${(risultato.documenti_richiesti || []).length}, Confidenza: ${risultato.confidenza}`);
  } else {
    console.log(`     ❌ Nessun albo trovato (${risultato.confidenza})`);
  }

  return risultato;
}

// ══════════════════════════════════════════════════
// SALVATAGGIO NEL DATABASE
// ══════════════════════════════════════════════════

async function salvaRisultato(risultato, dryRun) {
  if (!risultato.ha_albo) return;
  if (dryRun) {
    console.log(`     [DRY] Salverebbe albo per stazione ${risultato.id_stazione}`);
    return;
  }

  try {
    // Controlla se esiste già
    const existing = await pool.query(
      'SELECT id FROM albi_fornitori WHERE id_stazione = $1 AND attivo = true',
      [risultato.id_stazione]
    );

    if (existing.rows.length > 0) {
      // Aggiorna
      await pool.query(`
        UPDATE albi_fornitori SET
          nome_albo = COALESCE($2, nome_albo),
          url_albo = COALESCE($3, url_albo),
          piattaforma = COALESCE($4, piattaforma),
          documenti_richiesti = COALESCE($5, documenti_richiesti),
          procedura_iscrizione = COALESCE($6, procedura_iscrizione),
          note = COALESCE($7, note),
          verificato = false,
          ultimo_aggiornamento = NOW(),
          updated_at = NOW()
        WHERE id_stazione = $1 AND attivo = true
      `, [
        risultato.id_stazione,
        risultato.nome_albo || null,
        risultato.url_albo || null,
        risultato.piattaforma || null,
        risultato.documenti_richiesti ? JSON.stringify(risultato.documenti_richiesti) : null,
        risultato.procedura_iscrizione || null,
        risultato.note || null
      ]);
      console.log(`     💾 Aggiornato albo esistente`);
    } else {
      // Inserisci nuovo
      await pool.query(`
        INSERT INTO albi_fornitori (
          id_stazione, nome_albo, url_albo, piattaforma,
          documenti_richiesti, procedura_iscrizione, note,
          attivo, verificato, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, true, false, NOW())
      `, [
        risultato.id_stazione,
        risultato.nome_albo || 'Albo Fornitori',
        risultato.url_albo || null,
        risultato.piattaforma || null,
        JSON.stringify(risultato.documenti_richiesti || []),
        risultato.procedura_iscrizione || '',
        `Trovato automaticamente via ricerca web. Confidenza: ${risultato.confidenza}. ${risultato.note || ''}`
      ]);
      console.log(`     💾 Nuovo albo inserito`);
    }
  } catch (e) {
    console.error(`     ❌ Errore salvataggio: ${e.message}`);
  }
}

// ══════════════════════════════════════════════════
// GESTIONE PROGRESSO
// ══════════════════════════════════════════════════

function loadProgress() {
  if (existsSync(CONFIG.PROGRESS_FILE)) {
    return JSON.parse(readFileSync(CONFIG.PROGRESS_FILE, 'utf8'));
  }
  return { processati: [], ultimo_id: 0, stats: { totale: 0, con_albo: 0, senza_albo: 0, errori: 0 } };
}

function saveProgress(progress) {
  writeFileSync(CONFIG.PROGRESS_FILE, JSON.stringify(progress, null, 2), 'utf8');
}

// ══════════════════════════════════════════════════
// UTILITIES
// ══════════════════════════════════════════════════

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CONFIG.FETCH_TIMEOUT);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal, redirect: 'follow' });
    clearTimeout(timeout);
    return res;
  } catch (e) {
    clearTimeout(timeout);
    throw e;
  }
}

// ══════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const limit = parseInt(args.find((a, i) => args[i - 1] === '--limit') || '0') || 99999;
  const offset = parseInt(args.find((a, i) => args[i - 1] === '--offset') || '0') || 0;
  const singleId = parseInt(args.find((a, i) => args[i - 1] === '--id') || '0') || null;

  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║   RICERCA WEB ALBI FORNITORI PER STAZIONE           ║');
  console.log('╠══════════════════════════════════════════════════════╣');
  console.log(`║   Modalità: ${dryRun ? 'DRY RUN' : 'PRODUZIONE'}                                ║`);
  console.log(`║   Limit: ${limit}, Offset: ${offset}                            ║`);
  console.log('╚══════════════════════════════════════════════════════╝\n');

  const progress = loadProgress();

  try {
    let stazioni;

    if (singleId) {
      // Singola stazione
      const res = await pool.query(`
        SELECT s.id, s.nome, s.citta, p.nome AS provincia, s.sito_web,
               (SELECT string_agg(DISTINCT plt.nome, ', ')
                FROM iscrizione_stazioni isc JOIN piattaforme plt ON plt.id = isc.id_piattaforma
                WHERE isc.id_stazione = s.id AND plt.nome NOT IN ('Nessuna','Non indicata')) AS piattaforma_nome
        FROM stazioni s LEFT JOIN province p ON s.id_provincia = p.id
        WHERE s.id = $1
      `, [singleId]);
      stazioni = res.rows;
    } else {
      // Tutte le stazioni, ordinate per importanza (n_bandi DESC)
      // Salta quelle già processate con alta confidenza
      const res = await pool.query(`
        SELECT s.id, s.nome, s.citta, p.nome AS provincia, s.sito_web,
               (SELECT string_agg(DISTINCT plt.nome, ', ')
                FROM iscrizione_stazioni isc JOIN piattaforme plt ON plt.id = isc.id_piattaforma
                WHERE isc.id_stazione = s.id AND plt.nome NOT IN ('Nessuna','Non indicata')) AS piattaforma_nome,
               (SELECT COUNT(*) FROM bandi b WHERE b.id_stazione = s.id) AS n_bandi
        FROM stazioni s
        LEFT JOIN province p ON s.id_provincia = p.id
        WHERE s.attivo = true
          AND NOT EXISTS (
            SELECT 1 FROM albi_fornitori af
            WHERE af.id_stazione = s.id AND af.attivo = true AND af.verificato = true
          )
        ORDER BY (SELECT COUNT(*) FROM bandi b WHERE b.id_stazione = s.id) DESC
        OFFSET $1 LIMIT $2
      `, [offset, limit]);
      stazioni = res.rows;
    }

    console.log(`📊 Stazioni da processare: ${stazioni.length}\n`);

    let processate = 0;
    let conAlbo = 0;
    let senzaAlbo = 0;
    let errori = 0;
    const risultati = [];

    for (const stazione of stazioni) {
      // Salta se già processata in questa sessione
      if (progress.processati.includes(stazione.id)) {
        console.log(`  ⏭️  [${stazione.id}] Già processata, salto`);
        continue;
      }

      try {
        const risultato = await processaStazione(stazione);
        risultati.push(risultato);

        await salvaRisultato(risultato, dryRun);

        if (risultato.ha_albo) conAlbo++;
        else senzaAlbo++;

        // Aggiorna progresso
        progress.processati.push(stazione.id);
        progress.ultimo_id = stazione.id;
        progress.stats.totale++;
        progress.stats.con_albo += risultato.ha_albo ? 1 : 0;
        progress.stats.senza_albo += risultato.ha_albo ? 0 : 1;
        saveProgress(progress);

      } catch (e) {
        errori++;
        progress.stats.errori++;
        console.error(`  ❌ Errore per ${stazione.nome}: ${e.message}`);
      }

      processate++;

      // Pausa tra le richieste
      await delay(CONFIG.DELAY_BETWEEN_REQUESTS);

      // Log ogni 10 stazioni
      if (processate % 10 === 0) {
        console.log(`\n  ── Progresso: ${processate}/${stazioni.length} | Albi: ${conAlbo} | Senza: ${senzaAlbo} | Errori: ${errori} ──\n`);
      }
    }

    // Report finale
    console.log('\n' + '═'.repeat(60));
    console.log('RIEPILOGO FINALE');
    console.log('═'.repeat(60));
    console.log(`  Stazioni processate: ${processate}`);
    console.log(`  Con albo trovato:    ${conAlbo}`);
    console.log(`  Senza albo:         ${senzaAlbo}`);
    console.log(`  Errori:             ${errori}`);
    console.log(`  Totale storico:     ${progress.stats.totale} processate`);

    // Salva report CSV
    let csv = 'ID;Nome;Citta;Ha_Albo;Confidenza;Piattaforma;URL_Albo;N_Documenti;Note\n';
    for (const r of risultati) {
      csv += `${r.id_stazione || r.id};"${(r.nome_albo || '').replace(/"/g, '""')}";"";${r.ha_albo};${r.confidenza || ''};` +
        `"${r.piattaforma || ''}";"${r.url_albo || ''}";${(r.documenti_richiesti || []).length};"${(r.note || '').replace(/"/g, '""').substring(0, 100)}"\n`;
    }
    writeFileSync(CONFIG.REPORT_FILE, csv, 'utf8');
    console.log(`\n📄 Report salvato: ${CONFIG.REPORT_FILE}`);

  } catch (err) {
    console.error('ERRORE FATALE:', err);
  } finally {
    await pool.end();
  }
}

main().catch(console.error);
