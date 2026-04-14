// ═══════════════════════════════════════════════════════════════════════════
//  MOTORE DI CALCOLO DEI CRITERI DI AGGIUDICAZIONE
//
//  Ogni criterio nel DB ha un campo `metodo_calcolo` che fa riferimento a
//  una delle funzioni esportate qui. Il dispatcher `computeGraduatoria`
//  riceve il metodo + l'elenco offerte e restituisce:
//    {
//      ok:           boolean,
//      metodo:       string,
//      aggiudicatario: { id, denominazione, ribasso_percentuale },
//      soglia_anomalia: number|null,
//      graduatoria:  [ { posizione, id, denominazione, ribasso, stato } ],
//      steps:        [ { label, valore, formula?, nota? } ],   // passaggi testuali
//      warnings:     [ string ],
//    }
//
//  IMPORTANTE: le formule qui implementate sono basate sulle normative
//  italiane vigenti. Verifiche di accuratezza con esempi reali sono
//  fortemente consigliate per i metodi di Esclusione Automatica.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Offerta shape attesa:
 *   {
 *     id:                   string|number,
 *     denominazione:        string,
 *     ribasso_percentuale:  number (es. 15.5 per 15,5%),
 *     punteggio_tecnico?:   number (solo OEPV),
 *     punteggio_economico?: number (solo OEPV)
 *   }
 */

// ──────────────────────────────────────────────────────────────────────────
//  Helpers
// ──────────────────────────────────────────────────────────────────────────

const r2 = (n) => Math.round(Number(n) * 100) / 100;
const r4 = (n) => Math.round(Number(n) * 10000) / 10000;
const esc = (n) => Number(n || 0);

function mediaAritmetica(arr) {
  if (!arr.length) return 0;
  return arr.reduce((s, v) => s + Number(v), 0) / arr.length;
}

function mediana(arr) {
  if (!arr.length) return 0;
  const s = arr.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
}

/**
 * Taglio delle ali: esclude il 10% (arrotondato all'unità superiore) delle
 * offerte con maggior ribasso e il 10% di quelle con minor ribasso.
 * Restituisce: { ribassiResidui, esclusiAlto, esclusiBasso, quantita }
 */
function taglioDelleAli(ribassi) {
  if (!ribassi.length) return { ribassiResidui: [], esclusiAlto: [], esclusiBasso: [], quantita: 0 };
  const ordinati = ribassi.slice().sort((a, b) => a - b); // crescente
  const n = ordinati.length;
  const q = Math.ceil(n * 0.1); // 10% arrotondato per eccesso
  const esclusiBasso = ordinati.slice(0, q);        // i più bassi
  const esclusiAlto = ordinati.slice(n - q);         // i più alti
  const ribassiResidui = ordinati.slice(q, n - q);
  return { ribassiResidui, esclusiAlto, esclusiBasso, quantita: q };
}

/**
 * Scarto medio aritmetico dei ribassi che SUPERANO la media indicata.
 * Se nessun ribasso supera la media, restituisce 0.
 */
function scartoMedioSopraMedia(ribassi, media) {
  const sopra = ribassi.filter((r) => r > media);
  if (!sopra.length) return 0;
  const sommaScarti = sopra.reduce((s, r) => s + (r - media), 0);
  return sommaScarti / sopra.length;
}

/**
 * Costruisce la graduatoria finale ordinando le offerte per ribasso
 * decrescente e marcando quelle anomale.
 */
function buildGraduatoria(offerte, sogliaAnomalia = null, opts = {}) {
  const ordinate = offerte
    .slice()
    .sort((a, b) => Number(b.ribasso_percentuale || 0) - Number(a.ribasso_percentuale || 0));

  return ordinate.map((o, i) => {
    const ribasso = Number(o.ribasso_percentuale || 0);
    let stato = 'ammessa';
    if (sogliaAnomalia != null && opts.esclusioneAutomatica && ribasso >= sogliaAnomalia) {
      stato = 'anomala_esclusa';
    }
    return {
      posizione: i + 1,
      id: o.id,
      denominazione: o.denominazione || '—',
      ribasso: r4(ribasso),
      stato,
    };
  });
}

function firstAdmitted(graduatoria) {
  return graduatoria.find((g) => g.stato === 'ammessa') || null;
}

// ──────────────────────────────────────────────────────────────────────────
//  1) MASSIMO RIBASSO (valido per tutte le varianti normative semplici)
// ──────────────────────────────────────────────────────────────────────────
function calcMassimoRibasso(offerte) {
  const graduatoria = buildGraduatoria(offerte);
  const agg = graduatoria[0] || null;
  return {
    ok: true,
    metodo: 'MAX_RIBASSO',
    titolo: 'Massimo Ribasso',
    aggiudicatario: agg ? { id: agg.id, denominazione: agg.denominazione, ribasso_percentuale: agg.ribasso } : null,
    soglia_anomalia: null,
    graduatoria,
    steps: [
      { label: `Numero offerte ammesse`, valore: offerte.length },
      { label: `Ordinamento per ribasso percentuale decrescente`, nota: 'Nessun taglio delle ali, nessuna esclusione automatica.' },
      { label: `Aggiudicatario`, valore: agg ? `${agg.denominazione} — ribasso ${agg.ribasso}%` : 'Nessuno' },
    ],
    warnings: [],
  };
}

// ──────────────────────────────────────────────────────────────────────────
//  2) OEPV — Offerta Economicamente Più Vantaggiosa
// ──────────────────────────────────────────────────────────────────────────
function calcOEPV(offerte, opts = {}) {
  const pesoTec = opts.peso_tecnico != null ? Number(opts.peso_tecnico) : 70;
  const pesoEco = opts.peso_economico != null ? Number(opts.peso_economico) : 30;
  const warnings = [];

  const hasPunti = offerte.every((o) => o.punteggio_tecnico != null && o.punteggio_economico != null);
  if (!hasPunti) {
    warnings.push('Alcune offerte non hanno punteggio tecnico/economico valorizzato. OEPV richiede entrambi i punteggi assegnati dalla commissione.');
  }

  const con_totale = offerte.map((o) => {
    const pt = Number(o.punteggio_tecnico || 0);
    const pe = Number(o.punteggio_economico || 0);
    const totale = (pt * pesoTec / 100) + (pe * pesoEco / 100);
    return { ...o, punteggio_totale: r4(totale) };
  });

  const ordinate = con_totale.slice().sort((a, b) => b.punteggio_totale - a.punteggio_totale);
  const graduatoria = ordinate.map((o, i) => ({
    posizione: i + 1,
    id: o.id,
    denominazione: o.denominazione || '—',
    ribasso: r4(Number(o.ribasso_percentuale || 0)),
    punteggio_tecnico: r2(Number(o.punteggio_tecnico || 0)),
    punteggio_economico: r2(Number(o.punteggio_economico || 0)),
    punteggio_totale: o.punteggio_totale,
    stato: 'ammessa',
  }));

  const agg = graduatoria[0] || null;
  return {
    ok: true,
    metodo: 'OEPV',
    titolo: 'Offerta Economicamente Più Vantaggiosa',
    aggiudicatario: agg ? {
      id: agg.id,
      denominazione: agg.denominazione,
      punteggio_totale: agg.punteggio_totale,
      ribasso_percentuale: agg.ribasso,
    } : null,
    soglia_anomalia: null,
    graduatoria,
    steps: [
      { label: `Numero offerte valutate`, valore: offerte.length },
      { label: `Peso punteggio tecnico`, valore: `${pesoTec}%` },
      { label: `Peso punteggio economico`, valore: `${pesoEco}%` },
      { label: `Formula punteggio totale`, formula: `Ptot = Pt × (PesoT/100) + Pe × (PesoE/100)` },
      { label: `Aggiudicatario`, valore: agg ? `${agg.denominazione} — punteggio totale ${agg.punteggio_totale}` : 'Nessuno' },
    ],
    warnings,
  };
}

// ──────────────────────────────────────────────────────────────────────────
//  3) Funzione generica di ESCLUSIONE AUTOMATICA con taglio delle ali
//      Usata da tutti i metodi basati sul meccanismo classico:
//      media post-taglio + scarto medio dei ribassi sopra la media.
// ──────────────────────────────────────────────────────────────────────────
function calcEsclusioneAutomaticaBase(offerte, opts = {}) {
  const minOfferte = opts.min_offerte || 5;
  const label = opts.label || 'Esclusione Automatica';
  const metodo = opts.metodo || 'ESCL_AUTOMATICA';
  const coeffScarto = opts.coeff_scarto != null ? Number(opts.coeff_scarto) : 1; // 1 = scarto puro
  const aggiuntaFissa = opts.aggiunta_fissa != null ? Number(opts.aggiunta_fissa) : 0;
  const warnings = [];

  const n = offerte.length;
  if (n < minOfferte) {
    // Fallback: nessuna esclusione, aggiudicatario = massimo ribasso
    const base = calcMassimoRibasso(offerte);
    base.titolo = label + ' (non applicabile)';
    base.metodo = metodo;
    base.warnings.push(`Numero offerte (${n}) inferiore al minimo richiesto (${minOfferte}). L'esclusione automatica NON si applica. Aggiudicazione al massimo ribasso.`);
    base.steps.unshift({ label: `Verifica minimo offerte`, valore: `${n} < ${minOfferte}`, nota: 'Esclusione automatica disapplicata' });
    return base;
  }

  const ribassi = offerte.map((o) => Number(o.ribasso_percentuale || 0));
  const taglio = taglioDelleAli(ribassi);
  const mediaPost = mediaAritmetica(taglio.ribassiResidui);
  const scarto = scartoMedioSopraMedia(taglio.ribassiResidui, mediaPost);
  const soglia = r4(mediaPost + (scarto * coeffScarto) + aggiuntaFissa);

  const graduatoria = buildGraduatoria(offerte, soglia, { esclusioneAutomatica: true });
  const agg = firstAdmitted(graduatoria);

  return {
    ok: true,
    metodo,
    titolo: label,
    aggiudicatario: agg ? { id: agg.id, denominazione: agg.denominazione, ribasso_percentuale: agg.ribasso } : null,
    soglia_anomalia: soglia,
    graduatoria,
    steps: [
      { label: `Numero offerte ammesse`, valore: n },
      { label: `Taglio delle ali (10% + 10%)`, valore: `esclusi ${taglio.quantita} ribassi più alti e ${taglio.quantita} più bassi`, nota: `Residui: ${taglio.ribassiResidui.length} offerte` },
      { label: `Ribassi residui (ordinati)`, valore: taglio.ribassiResidui.map(r4).join(', ') + '%' },
      { label: `Media aritmetica dei residui (M)`, valore: `${r4(mediaPost)}%`, formula: 'M = Σ(ribassi_residui) / N_residui' },
      { label: `Scarto medio dei ribassi > M (S)`, valore: `${r4(scarto)}%`, formula: 'S = Σ(ribassi > M − M) / N(ribassi > M)' },
      coeffScarto !== 1
        ? { label: `Coefficiente correttivo scarto`, valore: coeffScarto }
        : null,
      aggiuntaFissa !== 0
        ? { label: `Aggiunta fissa soglia`, valore: `${aggiuntaFissa}%` }
        : null,
      { label: `Soglia di anomalia`, valore: `${soglia}%`, formula: coeffScarto !== 1 ? `Soglia = M + ${coeffScarto} × S` : 'Soglia = M + S' },
      { label: `Offerte escluse (anomale)`, valore: graduatoria.filter((g) => g.stato === 'anomala_esclusa').length },
      { label: `Aggiudicatario`, valore: agg ? `${agg.denominazione} — ribasso ${agg.ribasso}% (prima offerta non anomala)` : 'Nessuno' },
    ].filter(Boolean),
    warnings,
  };
}

// ──────────────────────────────────────────────────────────────────────────
//  4) Media 163/2006 e varianti regionali legacy
// ──────────────────────────────────────────────────────────────────────────
function calcMedia1632006(offerte) {
  const r = calcEsclusioneAutomaticaBase(offerte, {
    min_offerte: 5,
    label: 'Media — D.Lgs. 163/2006 (art. 86, 122 c. 9)',
    metodo: 'MEDIA_163_2006',
  });
  r.warnings.push('Criterio derivato da normativa ABROGATA. Conservato per bandi storici — non utilizzare per gare attuali.');
  return r;
}

function calcMediaVDA(offerte) {
  const r = calcEsclusioneAutomaticaBase(offerte, {
    min_offerte: 5,
    label: 'Media Valle D\'Aosta (L.R. 12/96 art. 25 c. 7)',
    metodo: 'MEDIA_VDA',
  });
  r.warnings.push('Variante regionale Valle d\'Aosta. Verificare coefficienti specifici della L.R. 12/96 vigente al momento della gara.');
  return r;
}

function calcMediaTrentino(offerte) {
  // Variante: usa mediana anziché media aritmetica
  const minOfferte = 5;
  const n = offerte.length;
  const warnings = [];
  if (n < minOfferte) {
    const base = calcMassimoRibasso(offerte);
    base.metodo = 'MEDIA_TRENTINO';
    base.titolo = 'Media Trentino (non applicabile)';
    base.warnings.push(`Numero offerte (${n}) < ${minOfferte}. Aggiudicazione al massimo ribasso.`);
    return base;
  }
  const ribassi = offerte.map((o) => Number(o.ribasso_percentuale || 0));
  const taglio = taglioDelleAli(ribassi);
  const med = mediana(taglio.ribassiResidui);
  const scarto = scartoMedioSopraMedia(taglio.ribassiResidui, med);
  const soglia = r4(med + scarto);
  const graduatoria = buildGraduatoria(offerte, soglia, { esclusioneAutomatica: true });
  const agg = firstAdmitted(graduatoria);
  return {
    ok: true,
    metodo: 'MEDIA_TRENTINO',
    titolo: 'Media Trentino (50° percentile)',
    aggiudicatario: agg ? { id: agg.id, denominazione: agg.denominazione, ribasso_percentuale: agg.ribasso } : null,
    soglia_anomalia: soglia,
    graduatoria,
    steps: [
      { label: `Numero offerte ammesse`, valore: n },
      { label: `Taglio delle ali (10% + 10%)`, valore: `esclusi ${taglio.quantita * 2} ribassi`, nota: `Residui: ${taglio.ribassiResidui.length}` },
      { label: `Mediana dei ribassi residui (M50)`, valore: `${r4(med)}%`, formula: 'M50 = 50° percentile dei ribassi residui' },
      { label: `Scarto medio dei ribassi > M50 (S)`, valore: `${r4(scarto)}%` },
      { label: `Soglia di anomalia`, valore: `${soglia}%`, formula: 'Soglia = M50 + S' },
      { label: `Aggiudicatario`, valore: agg ? `${agg.denominazione} — ribasso ${agg.ribasso}%` : 'Nessuno' },
    ],
    warnings,
  };
}

function calcProceduraPubliacqua(offerte) {
  const r = calcEsclusioneAutomaticaBase(offerte, {
    min_offerte: 5,
    label: 'Procedura Publiacqua',
    metodo: 'PROCEDURA_PUBLIACQUA',
  });
  r.warnings.push('Procedura personalizzata Publiacqua S.p.A. Verificare le regole specifiche del disciplinare di gara Publiacqua di riferimento: il calcolo qui è approssimato su base standard.');
  return r;
}

function calcMediaPuraFVG(offerte) {
  // Media pura senza taglio ali, aggiudicatario = offerta più vicina (per difetto) alla media
  const n = offerte.length;
  if (!n) return calcMassimoRibasso(offerte);
  const ribassi = offerte.map((o) => Number(o.ribasso_percentuale || 0));
  const media = mediaAritmetica(ribassi);
  // Aggiudicatario: offerta con ribasso più vicino alla media (per difetto)
  const candidati = offerte.filter((o) => Number(o.ribasso_percentuale || 0) <= media);
  const scelta = candidati.length
    ? candidati.sort((a, b) => Number(b.ribasso_percentuale) - Number(a.ribasso_percentuale))[0]
    : offerte.sort((a, b) => Number(a.ribasso_percentuale) - Number(b.ribasso_percentuale))[0];
  const graduatoria = buildGraduatoria(offerte);
  // Rimetto in cima la scelta
  const idx = graduatoria.findIndex((g) => g.id === scelta.id);
  if (idx > 0) {
    const [picked] = graduatoria.splice(idx, 1);
    graduatoria.unshift(picked);
    graduatoria.forEach((g, i) => { g.posizione = i + 1; });
  }
  return {
    ok: true,
    metodo: 'MEDIA_PURA_FVG',
    titolo: 'Media Pura (Friuli Venezia Giulia)',
    aggiudicatario: scelta ? { id: scelta.id, denominazione: scelta.denominazione, ribasso_percentuale: r4(Number(scelta.ribasso_percentuale)) } : null,
    soglia_anomalia: null,
    graduatoria,
    steps: [
      { label: `Numero offerte`, valore: n },
      { label: `Media aritmetica dei ribassi (senza taglio ali)`, valore: `${r4(media)}%`, formula: 'M = Σ(ribassi) / N' },
      { label: `Criterio di scelta`, nota: 'Aggiudicatario = offerta con ribasso più vicino (per difetto) alla media' },
      { label: `Aggiudicatario`, valore: scelta ? `${scelta.denominazione} — ribasso ${r4(scelta.ribasso_percentuale)}%` : 'Nessuno' },
    ],
    warnings: ['Variante regionale Friuli Venezia Giulia: verificare regolamento regionale specifico.'],
  };
}

// ──────────────────────────────────────────────────────────────────────────
//  5) Esclusione automatica — D.Lgs. 50/2016 e varianti
// ──────────────────────────────────────────────────────────────────────────
function calcEscl50_2016(offerte) {
  return calcEsclusioneAutomaticaBase(offerte, {
    min_offerte: 10,
    label: 'Esclusione Automatica — D.Lgs. 50/2016 (art. 97 c. 2, c. 8)',
    metodo: 'ESCL_AUTOMATICA_50_2016',
  });
}

function calcEsclSbloccaCantieri(offerte) {
  return calcEsclusioneAutomaticaBase(offerte, {
    min_offerte: 10,
    label: 'Esclusione Automatica — D.L. 32/2019 "Sblocca Cantieri"',
    metodo: 'ESCL_AUTOMATICA_SBLOCCA_2019',
  });
}

function calcEsclSicilia(offerte) {
  const r = calcEsclusioneAutomaticaBase(offerte, {
    min_offerte: 5,
    label: 'Esclusione Automatica — L.R. Sicilia 13/2019',
    metodo: 'ESCL_AUTOMATICA_SICILIA',
  });
  r.warnings.push('Normativa regionale siciliana: verificare parametri specifici della L.R. 13/2019 vigenti.');
  return r;
}

function calcEsclDL76_2020(offerte) {
  return calcEsclusioneAutomaticaBase(offerte, {
    min_offerte: 5,
    label: 'Esclusione Automatica — D.L. 76/2020 "Semplificazioni"',
    metodo: 'ESCL_AUTOMATICA_DL76_2020',
  });
}

// ──────────────────────────────────────────────────────────────────────────
//  6) Esclusione automatica — D.Lgs. 36/2023 (nuovo Codice Contratti)
// ──────────────────────────────────────────────────────────────────────────
function calcEscl36_2023_generica(offerte) {
  return calcEsclusioneAutomaticaBase(offerte, {
    min_offerte: 5,
    label: 'Esclusione Automatica — D.Lgs. 36/2023 (All. II.2, art. 54)',
    metodo: 'ESCL_AUTOMATICA_36_2023_GENERICA',
  });
}

function calcEscl36_2023_A(offerte) {
  return calcEsclusioneAutomaticaBase(offerte, {
    min_offerte: 5,
    label: 'Esclusione Automatica — D.Lgs. 36/2023 METODO A',
    metodo: 'ESCL_AUTOMATICA_36_2023_A',
  });
}

function calcEscl36_2023_B(offerte) {
  // METODO B: coefficiente correttivo basato sulla prima cifra decimale
  // della somma dei ribassi (variabile indicativamente 0,6–1,4)
  const ribassi = offerte.map((o) => Number(o.ribasso_percentuale || 0));
  const somma = ribassi.reduce((s, v) => s + v, 0);
  const primaDecimale = Math.floor((somma * 10) % 10);
  // Coefficiente: mappa euristica 0..9 → 0.6..1.4
  const coeff = 0.6 + (primaDecimale / 9) * 0.8;
  const r = calcEsclusioneAutomaticaBase(offerte, {
    min_offerte: 5,
    label: 'Esclusione Automatica — D.Lgs. 36/2023 METODO B',
    metodo: 'ESCL_AUTOMATICA_36_2023_B',
    coeff_scarto: r4(coeff),
  });
  r.steps.splice(5, 0, { label: `Somma dei ribassi`, valore: `${r4(somma)}%` });
  r.steps.splice(6, 0, { label: `Prima cifra decimale della somma`, valore: primaDecimale, nota: 'Determina il coefficiente correttivo' });
  r.warnings.push('METODO B: il coefficiente correttivo (0,6–1,4) qui è calcolato con mappa lineare sulla prima decimale della somma dei ribassi. Il legislatore può aver specificato una tabella differente — verificare con testo vigente dell\'Allegato II.2.');
  return r;
}

function calcEscl36_2023_C(offerte) {
  // METODO C: come METODO A con aggiunta fissa basata sulla decima cifra
  // dei ribassi (interpretata in modo conservativo)
  const ribassi = offerte.map((o) => Number(o.ribasso_percentuale || 0));
  const somma = ribassi.reduce((s, v) => s + v, 0);
  const aggiunta = (Math.floor((somma * 100) % 10)) / 10; // 0.0 .. 0.9 come decimi di %
  const r = calcEsclusioneAutomaticaBase(offerte, {
    min_offerte: 5,
    label: 'Esclusione Automatica — D.Lgs. 36/2023 METODO C',
    metodo: 'ESCL_AUTOMATICA_36_2023_C',
    aggiunta_fissa: r4(aggiunta),
  });
  r.steps.splice(5, 0, { label: `Aggiunta aleatoria alla soglia`, valore: `+${aggiunta}%`, nota: 'Derivata dalla 2ª decimale della somma dei ribassi' });
  r.warnings.push('METODO C: l\'aggiunta fissa alla soglia è qui calcolata con formula conservativa. Verificare il testo esatto dell\'Allegato II.2 D.Lgs. 36/2023.');
  return r;
}

// ──────────────────────────────────────────────────────────────────────────
//  7) Non indicato
// ──────────────────────────────────────────────────────────────────────────
function calcNonIndicato(offerte) {
  const graduatoria = buildGraduatoria(offerte);
  return {
    ok: false,
    metodo: 'NON_INDICATO',
    titolo: 'Criterio non indicato',
    aggiudicatario: null,
    soglia_anomalia: null,
    graduatoria,
    steps: [
      { label: 'Stato', nota: 'La stazione appaltante non ha specificato il criterio di aggiudicazione nel bando. Il calcolo automatico non è disponibile.' },
      { label: 'Graduatoria provvisoria', nota: 'Le offerte sono comunque ordinate per ribasso decrescente come riferimento visivo.' },
    ],
    warnings: ['Criterio non determinato. Consultare il disciplinare di gara per individuare il metodo effettivo.'],
  };
}

// ──────────────────────────────────────────────────────────────────────────
//  DISPATCHER
// ──────────────────────────────────────────────────────────────────────────

const DISPATCH = {
  MAX_RIBASSO: calcMassimoRibasso,
  OEPV: calcOEPV,
  MEDIA_163_2006: calcMedia1632006,
  MEDIA_VDA: calcMediaVDA,
  MEDIA_TRENTINO: calcMediaTrentino,
  PROCEDURA_PUBLIACQUA: calcProceduraPubliacqua,
  MEDIA_PURA_FVG: calcMediaPuraFVG,
  ESCL_AUTOMATICA_50_2016: calcEscl50_2016,
  ESCL_AUTOMATICA_SBLOCCA_2019: calcEsclSbloccaCantieri,
  ESCL_AUTOMATICA_SICILIA: calcEsclSicilia,
  ESCL_AUTOMATICA_DL76_2020: calcEsclDL76_2020,
  ESCL_AUTOMATICA_36_2023_GENERICA: calcEscl36_2023_generica,
  ESCL_AUTOMATICA_36_2023_A: calcEscl36_2023_A,
  ESCL_AUTOMATICA_36_2023_B: calcEscl36_2023_B,
  ESCL_AUTOMATICA_36_2023_C: calcEscl36_2023_C,
  NON_INDICATO: calcNonIndicato,
};

/**
 * Compute the graduatoria for a given metodo_calcolo and a list of offerte.
 *
 * @param {string} metodo   Metodo_calcolo key (see DISPATCH above)
 * @param {Array}  offerte  Array of offerta objects
 * @param {Object} [opts]   Optional params (weights, etc.)
 * @returns {Object}        Result with graduatoria + steps + warnings
 */
export function computeGraduatoria(metodo, offerte, opts = {}) {
  if (!Array.isArray(offerte) || !offerte.length) {
    return {
      ok: false,
      metodo: metodo || 'UNKNOWN',
      titolo: 'Nessuna offerta',
      aggiudicatario: null,
      soglia_anomalia: null,
      graduatoria: [],
      steps: [{ label: 'Errore', nota: 'Nessuna offerta fornita' }],
      warnings: ['Impossibile calcolare la graduatoria senza offerte.'],
    };
  }

  const fn = DISPATCH[metodo];
  if (!fn) {
    // Fallback: massimo ribasso con warning
    const r = calcMassimoRibasso(offerte);
    r.metodo = metodo || 'UNKNOWN';
    r.titolo = `Metodo "${metodo}" non supportato`;
    r.warnings.push(`Il metodo di calcolo "${metodo}" non è implementato. È stata usata la logica di fallback "Massimo Ribasso".`);
    return r;
  }

  return fn(offerte, opts);
}

/**
 * Lista dei metodi disponibili (per popolare il select nel form admin).
 */
export const METODI_DISPONIBILI = [
  { value: 'MAX_RIBASSO',                       label: 'Massimo Ribasso (universale)' },
  { value: 'OEPV',                              label: 'Offerta Economicamente Più Vantaggiosa (OEPV)' },
  { value: 'MEDIA_163_2006',                    label: 'Media D.Lgs. 163/2006 (legacy)' },
  { value: 'MEDIA_VDA',                         label: 'Media Valle d\'Aosta (L.R. 12/96)' },
  { value: 'MEDIA_TRENTINO',                    label: 'Media Trentino (50° percentile)' },
  { value: 'PROCEDURA_PUBLIACQUA',              label: 'Procedura Publiacqua Firenze' },
  { value: 'MEDIA_PURA_FVG',                    label: 'Media Pura Friuli Venezia Giulia' },
  { value: 'ESCL_AUTOMATICA_50_2016',           label: 'Esclusione Automatica D.Lgs. 50/2016 (art. 97)' },
  { value: 'ESCL_AUTOMATICA_SBLOCCA_2019',      label: 'Esclusione Automatica D.L. 32/2019 "Sblocca Cantieri"' },
  { value: 'ESCL_AUTOMATICA_SICILIA',           label: 'Esclusione Automatica L.R. Sicilia 13/2019' },
  { value: 'ESCL_AUTOMATICA_DL76_2020',         label: 'Esclusione Automatica D.L. 76/2020 "Semplificazioni"' },
  { value: 'ESCL_AUTOMATICA_36_2023_GENERICA',  label: 'Esclusione Automatica D.Lgs. 36/2023 (All. II.2)' },
  { value: 'ESCL_AUTOMATICA_36_2023_A',         label: 'Esclusione Automatica D.Lgs. 36/2023 METODO A' },
  { value: 'ESCL_AUTOMATICA_36_2023_B',         label: 'Esclusione Automatica D.Lgs. 36/2023 METODO B' },
  { value: 'ESCL_AUTOMATICA_36_2023_C',         label: 'Esclusione Automatica D.Lgs. 36/2023 METODO C' },
  { value: 'NON_INDICATO',                      label: 'Non indicato (no calcolo)' },
];
