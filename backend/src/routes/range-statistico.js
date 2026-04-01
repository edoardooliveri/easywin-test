import { query } from '../db/pool.js';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export default async function rangeStatisticoRoutes(fastify) {

  // ============================================================
  // POST /api/range-statistico/calcola - Calculate winning range
  // ============================================================
  fastify.post('/calcola', async (request, reply) => {
    const {
      id_regione, id_stazione, id_soa, id_criterio,
      classifica_soa, importo_min, importo_max,
      data_min, data_max
    } = request.body;

    // Build query to fetch matching historical esiti
    const conditions = ['eliminata = false', 'g.ribasso IS NOT NULL', 'g.n_partecipanti > 2'];
    const params = [];
    let idx = 1;

    if (id_regione) { conditions.push(`p.id_regione = $${idx}`); params.push(id_regione); idx++; }
    if (id_stazione) { conditions.push(`g.id_stazione = $${idx}`); params.push(id_stazione); idx++; }
    if (id_soa) { conditions.push(`g.id_soa = $${idx}`); params.push(id_soa); idx++; }
    if (id_criterio) { conditions.push(`b.id_criterio = $${idx}`); params.push(id_criterio); idx++; }
    if (importo_min) { conditions.push(`g.importo >= $${idx}`); params.push(importo_min); idx++; }
    if (importo_max) { conditions.push(`g.importo <= $${idx}`); params.push(importo_max); idx++; }
    if (data_min) { conditions.push(`g.data >= $${idx}`); params.push(data_min); idx++; }
    if (data_max) { conditions.push(`g.data <= $${idx}`); params.push(data_max); idx++; }

    const result = await query(`
      SELECT g.id, g.data, g.importo, g.ribasso, g.n_partecipanti,
        g.media_ar, g.soglia_an, g.codice_cig,
        s.nome AS stazione_nome,
        soa.descrizione AS soa_categoria,
        c.nome AS criterio,
        r.regione AS regione_nome
      FROM gare g
      LEFT JOIN stazioni s ON g.id_stazione = s.id
      LEFT JOIN province p ON s.id_provincia = p.id_provincia
      LEFT JOIN regioni r ON p.id_regione = r.id_regione
      LEFT JOIN bandi b ON g.id_bando = b.id_bando
      LEFT JOIN soa ON g.id_soa = soa.id
      LEFT JOIN criteri c ON b.id_criterio = c.id
      WHERE ${conditions.join(' AND ')}
      ORDER BY g.data DESC
      LIMIT 500
    `, params);

    const gare = result.rows;

    if (gare.length < 3) {
      return reply.status(404).send({
        error: 'Dati insufficienti per calcolare il range',
        n_gare_trovate: gare.length,
        suggestion: 'Servono almeno 3 esiti storici. Prova ad ampliare i filtri.'
      });
    }

    // Calculate statistical range
    const ribassi = gare.map(g => parseFloat(g.ribasso)).filter(r => !isNaN(r));
    const range = calculateRange(ribassi);

    // Distribution analysis
    const distribution = calculateDistribution(ribassi);

    // Trend analysis (how winning ribassi have changed over time)
    const trend = calculateTrend(gare);

    // AI-powered insight
    let aiInsight = null;
    if (process.env.ANTHROPIC_API_KEY) {
      try {
        aiInsight = await getAiRangeInsight(range, distribution, trend, gare.length, request.body);
      } catch (e) {
        fastify.log.warn('AI insight failed:', e.message);
      }
    }

    return {
      n_gare_analizzate: gare.length,
      filtri_applicati: { id_regione, id_stazione, id_soa, id_criterio },
      range_vincente: range,
      distribuzione: distribution,
      trend,
      ai_insight: aiInsight,
      campione: gare.slice(0, 20).map(g => ({
        data: g.data,
        ribasso: g.ribasso,
        n_partecipanti: g.n_partecipanti,
        importo: g.importo,
        stazione: g.stazione_nome
      }))
    };
  });

  // ============================================================
  // GET /api/range-statistico/quick - Quick range by SOA + criterio
  // ============================================================
  fastify.get('/quick', async (request) => {
    const { soa_categoria, criterio } = request.query;

    if (!soa_categoria) {
      return { error: 'Parametro soa_categoria richiesto' };
    }

    // Find SOA id
    const soaResult = await query(
      `SELECT id FROM soa WHERE descrizione ILIKE $1 LIMIT 1`,
      [`%${soa_categoria}%`]
    );

    if (soaResult.rows.length === 0) {
      return { error: `SOA ${soa_categoria} non trovata` };
    }

    const conditions = ['eliminata = false', 'g.ribasso IS NOT NULL', 'g.n_partecipanti > 2',
      `g.id_soa = $1`];
    const params = [soaResult.rows[0].id];

    if (criterio) {
      const critResult = await query(
        `SELECT id_criterio FROM criteri WHERE nome ILIKE $1 LIMIT 1`,
        [`%${criterio}%`]
      );
      if (critResult.rows.length > 0) {
        conditions.push(`b.id_criterio = $2`);
        params.push(critResult.rows[0].id_criterio);
      }
    }

    const result = await query(`
      SELECT g.ribasso
      FROM gare g
      LEFT JOIN bandi b ON g.id_bando = b.id_bando
      WHERE ${conditions.join(' AND ')}
      ORDER BY g.data DESC LIMIT 200
    `, params);

    const ribassi = result.rows.map(r => parseFloat(r.ribasso)).filter(r => !isNaN(r));

    if (ribassi.length < 3) {
      return { error: 'Dati insufficienti', n_gare: ribassi.length };
    }

    const range = calculateRange(ribassi);
    return {
      soa: soa_categoria,
      n_gare: ribassi.length,
      range_vincente: range
    };
  });

  // ============================================================
  // GET /api/range-statistico/heatmap - Range by SOA categories
  // ============================================================
  fastify.get('/heatmap', async () => {
    const result = await query(`
      SELECT
        soa.descrizione,
        soa.tipo,
        COUNT(*) AS n_gare,
        AVG(g.ribasso)::DECIMAL(10,3) AS media_ribasso,
        MIN(g.ribasso)::DECIMAL(10,3) AS min_ribasso,
        MAX(g.ribasso)::DECIMAL(10,3) AS max_ribasso,
        PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY g.ribasso)::DECIMAL(10,3) AS p25,
        PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY g.ribasso)::DECIMAL(10,3) AS mediana,
        PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY g.ribasso)::DECIMAL(10,3) AS p75
      FROM gare g
      JOIN soa ON g.id_soa = soa.id
      WHERE eliminata = false AND g.ribasso IS NOT NULL AND g.n_partecipanti > 2
      GROUP BY soa.descrizione, soa.tipo
      HAVING COUNT(*) >= 3
      ORDER BY COUNT(*) DESC
    `);

    return result.rows;
  });
}

// ============================================================
// Calculate winning range
// ============================================================
function calculateRange(ribassi) {
  const sorted = [...ribassi].sort((a, b) => a - b);
  const n = sorted.length;
  const sum = ribassi.reduce((a, b) => a + b, 0);
  const media = sum / n;

  const variance = ribassi.reduce((acc, r) => acc + Math.pow(r - media, 2), 0) / n;
  const stdDev = Math.sqrt(variance);

  const p10 = sorted[Math.floor(n * 0.10)];
  const p25 = sorted[Math.floor(n * 0.25)];
  const p50 = sorted[Math.floor(n * 0.50)];
  const p75 = sorted[Math.floor(n * 0.75)];
  const p90 = sorted[Math.floor(n * 0.90)];

  // IQR-based range (most likely winning zone)
  const iqr = p75 - p25;

  return {
    media: round(media),
    mediana: round(p50),
    deviazione_standard: round(stdDev),
    minimo: round(sorted[0]),
    massimo: round(sorted[n - 1]),
    range_25_75: { min: round(p25), max: round(p75) },
    range_10_90: { min: round(p10), max: round(p90) },
    iqr: round(iqr),
    range_consigliato: {
      min: round(Math.max(p25 - iqr * 0.1, sorted[0])),
      max: round(Math.min(p75 + iqr * 0.1, media + stdDev)),
      label: `${round(Math.max(p25 - iqr * 0.1, sorted[0]))}% - ${round(Math.min(p75 + iqr * 0.1, media + stdDev))}%`
    }
  };
}

// ============================================================
// Distribution in buckets
// ============================================================
function calculateDistribution(ribassi) {
  const min = Math.floor(Math.min(...ribassi));
  const max = Math.ceil(Math.max(...ribassi));
  const step = Math.max(1, Math.round((max - min) / 10));
  const buckets = [];

  for (let start = min; start < max; start += step) {
    const end = start + step;
    const count = ribassi.filter(r => r >= start && r < end).length;
    buckets.push({
      range: `${start}%-${end}%`,
      from: start,
      to: end,
      count,
      percentage: round((count / ribassi.length) * 100, 1)
    });
  }

  return buckets;
}

// ============================================================
// Trend analysis
// ============================================================
function calculateTrend(gare) {
  // Group by quarter
  const byQuarter = {};
  for (const g of gare) {
    if (!g.data || !g.ribasso) continue;
    const d = new Date(g.data);
    const q = `${d.getFullYear()}-Q${Math.ceil((d.getMonth() + 1) / 3)}`;
    if (!byQuarter[q]) byQuarter[q] = [];
    byQuarter[q].push(parseFloat(g.ribasso));
  }

  const quarters = Object.keys(byQuarter).sort();
  const trendData = quarters.map(q => ({
    periodo: q,
    media: round(byQuarter[q].reduce((a, b) => a + b, 0) / byQuarter[q].length),
    n_gare: byQuarter[q].length,
    min: round(Math.min(...byQuarter[q])),
    max: round(Math.max(...byQuarter[q]))
  }));

  // Determine trend direction
  let direzione = 'stabile';
  if (trendData.length >= 2) {
    const last = trendData[trendData.length - 1].media;
    const prev = trendData[trendData.length - 2].media;
    if (last > prev + 1) direzione = 'in_aumento';
    else if (last < prev - 1) direzione = 'in_diminuzione';
  }

  return { dati: trendData, direzione };
}

// ============================================================
// AI Insight
// ============================================================
async function getAiRangeInsight(range, distribution, trend, nGare, filters) {
  const prompt = `Sei un consulente esperto di gare d'appalto italiane. Analizza questo range statistico e fornisci un consiglio strategico in 3-4 frasi in italiano.

RANGE STATISTICO (basato su ${nGare} esiti):
- Media ribassi vincenti: ${range.media}%
- Mediana: ${range.mediana}%
- Range consigliato: ${range.range_consigliato.label}
- Range 25°-75° percentile: ${range.range_25_75.min}% - ${range.range_25_75.max}%
- Trend: ${trend.direzione}

Rispondi SOLO con il testo del consiglio, senza JSON, senza bullet points. Scrivi come se stessi parlando direttamente all'imprenditore.`;

  const response = await anthropic.messages.create({
    model: process.env.AI_MODEL_INTERACTIVE || 'claude-sonnet-4-20250514',
    max_tokens: 400,
    messages: [{ role: 'user', content: prompt }]
  });

  return response.content[0]?.text || null;
}

function round(val, dec = 3) {
  const f = Math.pow(10, dec);
  return Math.round(val * f) / f;
}
