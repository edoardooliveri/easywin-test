import { query, transaction } from '../db/pool.js';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export default async function simulazioniRoutes(fastify) {

  // ============================================================
  // POST /api/simulazioni/calculate - AI-powered simulation
  // ============================================================
  fastify.post('/calculate', async (request, reply) => {
    const params = request.body;
    const {
      id_soa, id_regione, id_provincia, id_tipologia, id_criterio,
      data_min, data_max, importo_min, importo_max,
      ribasso_proposto, n_decimali = 3,
      accorpa_ali = false, tipo_calcolo = 0
    } = params;

    // Step 1: Fetch matching historical gare
    const conditions = ['"eliminata" = false', '"NPartecipanti" > 0', '"Ribasso" IS NOT NULL'];
    const values = [];
    let idx = 1;

    if (id_soa) { conditions.push(`g."id_soa" = $${idx}`); values.push(id_soa); idx++; }
    if (id_regione) {
      conditions.push(`p."id_regione" = $${idx}`); values.push(id_regione); idx++;
    }
    if (id_provincia) { conditions.push(`s."id_provincia" = $${idx}`); values.push(id_provincia); idx++; }
    if (id_tipologia) { conditions.push(`g."id_tipologia" = $${idx}`); values.push(id_tipologia); idx++; }
    if (id_criterio) { conditions.push(`b."id_criterio" = $${idx}`); values.push(id_criterio); idx++; }
    if (data_min) { conditions.push(`g."Data" >= $${idx}`); values.push(data_min); idx++; }
    if (data_max) { conditions.push(`g."Data" <= $${idx}`); values.push(data_max); idx++; }
    if (importo_min) { conditions.push(`g."Importo" >= $${idx}`); values.push(importo_min); idx++; }
    if (importo_max) { conditions.push(`g."Importo" <= $${idx}`); values.push(importo_max); idx++; }

    const gareResult = await query(`
      SELECT g."id", g."Data", g."Titolo", g."Importo", g."NPartecipanti",
        g."Ribasso", g."MediaAr", g."SogliaAn", g."MediaSc", g."NDecimali",
        g."CodiceCIG", g."id_vincitore",
        s."Nome" AS stazione_nome,
        soa."Descrizione" AS soa_desc
      FROM gare g
      LEFT JOIN stazioni s ON g."id_stazione" = s."id"
      LEFT JOIN province p ON s."id_provincia" = p."id_provincia"
      LEFT JOIN regioni r ON p."id_regione" = r."id_regione"
      LEFT JOIN soa ON g."id_soa" = soa."id"
      LEFT JOIN bandi b ON g."id_bando" = b."id_bando"
      WHERE ${conditions.join(' AND ')}
      ORDER BY g."Data" DESC
      LIMIT 200
    `, values);

    const gare = gareResult.rows;

    if (gare.length === 0) {
      return reply.status(404).send({
        error: 'Nessun esito trovato con i filtri selezionati',
        suggestion: 'Prova ad ampliare i criteri di ricerca (regione, SOA, date)'
      });
    }

    // Step 2: Calculate statistics
    const ribassi = gare.map(g => parseFloat(g.Ribasso)).filter(r => !isNaN(r));
    const stats = calculateStats(ribassi, n_decimali);

    // Step 3: Simulate with proposed ribasso
    let simulationResult = null;
    if (ribasso_proposto != null) {
      simulationResult = simulateRibasso(
        ribassi, parseFloat(ribasso_proposto), n_decimali, accorpa_ali, tipo_calcolo
      );
    }

    // Step 4: AI explanation (if API key available)
    let aiExplanation = null;
    let aiSuggestions = null;
    if (process.env.ANTHROPIC_API_KEY) {
      try {
        const aiResult = await getAiAnalysis(stats, simulationResult, ribasso_proposto, gare.length, params);
        aiExplanation = aiResult.explanation;
        aiSuggestions = aiResult.suggestions;
      } catch (e) {
        fastify.log.warn('AI analysis failed:', e.message);
      }
    }

    // Step 5: Save simulation
    const saved = await transaction(async (client) => {
      const simResult = await client.query(`
        INSERT INTO simulazioni (
          "id", "id_soa", "id_regione", "id_provincia", "id_tipologia",
          "data_min", "data_max", "importo_min", "importo_max",
          "media", "soglia", "media_scarti", "ribasso",
          "n_gare", "n_partecipanti", "n_decimali",
          "accorpa_ali", "tipo_calcolo"
        ) VALUES (
          uuid_generate_v4(), $1, $2, $3, $4, $5, $6, $7, $8,
          $9, $10, $11, $12, $13, $14, $15, $16, $17
        ) RETURNING "id"
      `, [
        id_soa, id_regione, id_provincia, id_tipologia,
        data_min, data_max, importo_min, importo_max,
        stats.media, stats.soglia_anomalia, stats.media_scarti, ribasso_proposto,
        gare.length, stats.totale_partecipanti, n_decimali,
        accorpa_ali, tipo_calcolo
      ]);

      return simResult.rows[0];
    });

    return {
      id: saved.id,
      n_gare_analizzate: gare.length,
      statistics: stats,
      simulation: simulationResult,
      ai_explanation: aiExplanation,
      ai_suggestions: aiSuggestions,
      gare_sample: gare.slice(0, 10).map(g => ({
        id: g.id, data: g.Data, titolo: g.Titolo,
        importo: g.Importo, ribasso: g.Ribasso,
        n_partecipanti: g.NPartecipanti, stazione: g.stazione_nome
      }))
    };
  });

  // ============================================================
  // GET /api/simulazioni - List user simulations
  // ============================================================
  fastify.get('/', async (request) => {
    const { username, page = 1, limit = 20 } = request.query;
    const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

    const conditions = [];
    const params = [];
    let idx = 1;

    if (username) {
      conditions.push(`s."username" = $${idx}`);
      params.push(username);
      idx++;
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const [countRes, dataRes] = await Promise.all([
      query(`SELECT COUNT(*) as total FROM simulazioni s ${where}`, params),
      query(`
        SELECT s.*, soa."Descrizione" AS soa_desc, r."Regione" AS regione_nome
        FROM simulazioni s
        LEFT JOIN soa ON s."id_soa" = soa."id"
        LEFT JOIN regioni r ON s."id_regione" = r."id_regione"
        ${where}
        ORDER BY s."id" DESC
        LIMIT $${idx} OFFSET $${idx + 1}
      `, [...params, parseInt(limit), offset])
    ]);

    return {
      data: dataRes.rows,
      pagination: {
        total: parseInt(countRes.rows[0].total),
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(parseInt(countRes.rows[0].total) / parseInt(limit))
      }
    };
  });

  // ============================================================
  // GET /api/simulazioni/:id - Detail
  // ============================================================
  fastify.get('/:id', async (request, reply) => {
    const { id } = request.params;

    const simRes = await query(`
      SELECT s.*, soa."Descrizione" AS soa_desc,
        r."Regione" AS regione_nome, p."Provincia" AS provincia_nome,
        tg."Tipologia"
      FROM simulazioni s
      LEFT JOIN soa ON s."id_soa" = soa."id"
      LEFT JOIN regioni r ON s."id_regione" = r."id_regione"
      LEFT JOIN province p ON s."id_provincia" = p."id_provincia"
      LEFT JOIN tipologiagare tg ON s."id_tipologia" = tg."id_tipologia"
      WHERE s."id" = $1
    `, [id]);

    if (simRes.rows.length === 0) {
      return reply.status(404).send({ error: 'Simulazione non trovata' });
    }

    return simRes.rows[0];
  });

  // ============================================================
  // DELETE /api/simulazioni/:id
  // ============================================================
  fastify.delete('/:id', async (request, reply) => {
    const { id } = request.params;
    const result = await query(`DELETE FROM simulazioni WHERE "id" = $1 RETURNING "id"`, [id]);
    if (result.rows.length === 0) {
      return reply.status(404).send({ error: 'Simulazione non trovata' });
    }
    return { message: 'Simulazione eliminata' };
  });
}

// ============================================================
// Calculate statistical values from historical ribassi
// ============================================================
function calculateStats(ribassi, decimali = 3) {
  const n = ribassi.length;
  if (n === 0) return { media: 0, min: 0, max: 0, mediana: 0 };

  const sorted = [...ribassi].sort((a, b) => a - b);
  const sum = ribassi.reduce((a, b) => a + b, 0);
  const media = sum / n;

  // Standard deviation
  const variance = ribassi.reduce((acc, r) => acc + Math.pow(r - media, 2), 0) / n;
  const stdDev = Math.sqrt(variance);

  // Anomaly threshold (simplified: media + scarto)
  const scarti = ribassi.map(r => Math.abs(r - media));
  const mediaScarti = scarti.reduce((a, b) => a + b, 0) / scarti.length;
  const sogliaAnomalia = media + mediaScarti;

  // Percentiles
  const p10 = sorted[Math.floor(n * 0.10)] || sorted[0];
  const p25 = sorted[Math.floor(n * 0.25)] || sorted[0];
  const p50 = sorted[Math.floor(n * 0.50)] || sorted[0];
  const p75 = sorted[Math.floor(n * 0.75)] || sorted[0];
  const p90 = sorted[Math.floor(n * 0.90)] || sorted[0];

  return {
    n_campione: n,
    media: round(media, decimali),
    mediana: round(p50, decimali),
    min: round(sorted[0], decimali),
    max: round(sorted[n - 1], decimali),
    std_dev: round(stdDev, decimali),
    soglia_anomalia: round(sogliaAnomalia, decimali),
    media_scarti: round(mediaScarti, decimali),
    percentile_10: round(p10, decimali),
    percentile_25: round(p25, decimali),
    percentile_75: round(p75, decimali),
    percentile_90: round(p90, decimali),
    range_ottimale: {
      min: round(p25, decimali),
      max: round(p75, decimali)
    },
    totale_partecipanti: 0 // Set from gare data
  };
}

// ============================================================
// Simulate a specific ribasso against historical data
// ============================================================
function simulateRibasso(ribassi, ribassoProposto, decimali, accorpaAli, tipoCalcolo) {
  const n = ribassi.length;
  if (n === 0) return null;

  // Add proposed ribasso to the pool
  const allRibassi = [...ribassi, ribassoProposto].sort((a, b) => a - b);
  const nTot = allRibassi.length;

  // Ali cut (10% upper, 10% lower) if enabled
  let ribassiCalcolo = [...allRibassi];
  let aliTagliate = 0;
  if (accorpaAli) {
    const cut = Math.floor(nTot * 0.10);
    ribassiCalcolo = allRibassi.slice(cut, nTot - cut);
    aliTagliate = cut * 2;
  }

  // Calculate mean and anomaly threshold
  const media = ribassiCalcolo.reduce((a, b) => a + b, 0) / ribassiCalcolo.length;
  const scarti = ribassiCalcolo.map(r => Math.abs(r - media));
  const mediaScarti = scarti.reduce((a, b) => a + b, 0) / scarti.length;
  const sogliaAnomalia = media + mediaScarti;

  // Determine position
  const posizione = allRibassi.indexOf(ribassoProposto) + 1;
  const isAnomalous = ribassoProposto > sogliaAnomalia;
  const distanzaDaMedia = ribassoProposto - media;
  const distanzaDaSoglia = ribassoProposto - sogliaAnomalia;

  // Find winner (closest to threshold without exceeding)
  const ammesse = allRibassi.filter(r => r <= sogliaAnomalia);
  const vincitore = ammesse.length > 0 ? ammesse[ammesse.length - 1] : allRibassi[0];
  const isWinner = Math.abs(ribassoProposto - vincitore) < 0.0001;

  // Win probability estimation
  let probabilitaVittoria = 0;
  if (isAnomalous) {
    probabilitaVittoria = 0.02; // Very unlikely if anomalous
  } else {
    // Distance from winning position
    const winnerIdx = allRibassi.indexOf(vincitore);
    const myIdx = allRibassi.indexOf(ribassoProposto);
    const gap = Math.abs(winnerIdx - myIdx);
    probabilitaVittoria = Math.max(0.05, 1 - (gap / nTot));
    if (isWinner) probabilitaVittoria = 0.95;
  }

  return {
    ribasso_proposto: round(ribassoProposto, decimali),
    posizione,
    totale_partecipanti: nTot,
    media_aritmetica: round(media, decimali),
    soglia_anomalia: round(sogliaAnomalia, decimali),
    media_scarti: round(mediaScarti, decimali),
    anomala: isAnomalous,
    vincitrice: isWinner,
    vincitore_ribasso: round(vincitore, decimali),
    distanza_da_media: round(distanzaDaMedia, decimali),
    distanza_da_soglia: round(distanzaDaSoglia, decimali),
    ali_tagliate: aliTagliate,
    probabilita_vittoria: round(probabilitaVittoria * 100, 1),
    ribasso_ottimale: round(sogliaAnomalia - 0.001, decimali),
    classificazione: isAnomalous ? 'ANOMALA' : isWinner ? 'VINCITRICE' : distanzaDaSoglia < 1 ? 'COMPETITIVA' : 'SICURA'
  };
}

// ============================================================
// AI-powered analysis and explanation
// ============================================================
async function getAiAnalysis(stats, simulation, ribassoProposto, nGare, params) {
  const prompt = `Sei un consulente esperto di gare d'appalto italiane. Analizza questi dati statistici e fornisci un'analisi strategica.

DATI STATISTICI (basati su ${nGare} esiti storici):
- Media ribassi: ${stats.media}%
- Mediana: ${stats.mediana}%
- Range: ${stats.min}% - ${stats.max}%
- Deviazione standard: ${stats.std_dev}%
- Soglia anomalia: ${stats.soglia_anomalia}%
- Range ottimale (25°-75° percentile): ${stats.range_ottimale.min}% - ${stats.range_ottimale.max}%

${simulation ? `
SIMULAZIONE con ribasso proposto ${ribassoProposto}%:
- Posizione: ${simulation.posizione}/${simulation.totale_partecipanti}
- Anomala: ${simulation.anomala ? 'SI' : 'NO'}
- Probabilità vittoria: ${simulation.probabilita_vittoria}%
- Distanza dalla media: ${simulation.distanza_da_media}%
- Distanza dalla soglia: ${simulation.distanza_da_soglia}%
- Ribasso ottimale stimato: ${simulation.ribasso_ottimale}%
` : ''}

Rispondi in italiano con formato JSON:
{
  "explanation": "Spiegazione dettagliata di 3-5 frasi che spiega i risultati in modo comprensibile",
  "risk_level": "basso/medio/alto",
  "suggestions": [
    {"ribasso": numero, "motivazione": "breve spiegazione"},
    {"ribasso": numero, "motivazione": "breve spiegazione"},
    {"ribasso": numero, "motivazione": "breve spiegazione"}
  ],
  "key_insight": "Un insight chiave in una frase"
}`;

  const response = await anthropic.messages.create({
    model: process.env.AI_MODEL_INTERACTIVE || 'claude-sonnet-4-20250514',
    max_tokens: 1500,
    messages: [{ role: 'user', content: prompt }]
  });

  const text = response.content[0]?.text || '';
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text);
    return {
      explanation: parsed.explanation,
      suggestions: parsed.suggestions,
      risk_level: parsed.risk_level,
      key_insight: parsed.key_insight
    };
  } catch {
    return { explanation: text.substring(0, 500), suggestions: null };
  }
}

function round(val, decimals) {
  const factor = Math.pow(10, decimals);
  return Math.round(val * factor) / factor;
}
