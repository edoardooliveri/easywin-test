-- =====================================================================
-- Migration 013: descrizione + metodo di calcolo per i criteri di
-- aggiudicazione. Il campo metodo_calcolo è una "chiave" che il motore
-- backend (src/services/criteri-calcolo.js) usa per dispacciare al
-- calcolatore corretto.
-- =====================================================================

ALTER TABLE criteri
  ADD COLUMN IF NOT EXISTS descrizione_calcolo TEXT,
  ADD COLUMN IF NOT EXISTS metodo_calcolo VARCHAR(60);

-- ---------------------------------------------------------------------
--  Pre-popolamento dei 23 criteri storici
-- ---------------------------------------------------------------------

-- 1 — Media (art. 86, 122 c. 9 D.Lgs. 163/2006)
UPDATE criteri SET
  metodo_calcolo = 'MEDIA_163_2006',
  descrizione_calcolo = 'CRITERIO STORICO — D.Lgs. 163/2006 (abrogato). Si calcola la media aritmetica dei ribassi percentuali di tutte le offerte ammesse. Si esclude il 10% (arrotondato all''unità superiore) delle offerte con il maggior ribasso e il 10% di quelle con il minor ribasso (cosiddetto "taglio delle ali"). Sui ribassi rimanenti si calcola una nuova media aritmetica. Si calcola poi lo scarto medio aritmetico dei ribassi che superano la nuova media. La soglia di anomalia è data dalla somma della media + scarto medio. Le offerte con ribasso pari o superiore alla soglia sono considerate anomale. Aggiudicatario = offerta con ribasso più alto NON anomalo.'
WHERE id = 1;

-- 2 — Massimo Ribasso (art. 86, 87, 88 D.Lgs. 163/2006)
UPDATE criteri SET
  metodo_calcolo = 'MAX_RIBASSO',
  descrizione_calcolo = 'MASSIMO RIBASSO — D.Lgs. 163/2006. Le offerte vengono ordinate per ribasso percentuale decrescente sul prezzo a base d''asta. Aggiudicatario = operatore con il maggior ribasso offerto. Nessun taglio delle ali, nessuna esclusione automatica delle offerte anomale: la valutazione di congruità (art. 86) resta facoltativa della stazione appaltante.'
WHERE id = 2;

-- 3 — Offerta Economicamente Più Vantaggiosa (OEPV)
UPDATE criteri SET
  metodo_calcolo = 'OEPV',
  descrizione_calcolo = 'OFFERTA ECONOMICAMENTE PIÙ VANTAGGIOSA. Criterio multi-dimensionale: a ogni offerta viene assegnato un punteggio tecnico (qualità, caratteristiche estetiche/funzionali, assistenza, tempi di consegna, ecc.) e un punteggio economico (ribasso). I pesi di ciascun criterio sono stabiliti dal bando. Il punteggio totale è la somma pesata dei punteggi tecnici ed economici. Aggiudicatario = offerta con il punteggio totale più alto. NOTA: questo criterio richiede i punteggi tecnici assegnati dalla commissione e i pesi definiti nel bando per poter essere calcolato automaticamente.'
WHERE id = 3;

-- 4 — Media Valle D'Aosta (art. 86, 122 c. 9 + art. 25 c. 7 L.R. 12/96)
UPDATE criteri SET
  metodo_calcolo = 'MEDIA_VDA',
  descrizione_calcolo = 'CRITERIO REGIONALE VALLE D''AOSTA. Variante del metodo Media del D.Lgs. 163/2006 prevista dall''art. 25 c. 7 della L.R. 12/1996. Si calcola la media aritmetica di tutti i ribassi, si esclude il 10% delle offerte più alte e il 10% più basse, si ricalcola la media e si somma lo scarto medio dei ribassi sopra la media. La soglia di anomalia segue regole specifiche regionali. Aggiudicatario = offerta più vicina (per difetto) alla soglia.'
WHERE id = 4;

-- 5 — Non Indicato
UPDATE criteri SET
  metodo_calcolo = 'NON_INDICATO',
  descrizione_calcolo = 'Il criterio di aggiudicazione non è stato specificato dalla stazione appaltante nel bando di gara. Il calcolo automatico della graduatoria non è disponibile. È necessario individuare il criterio effettivo consultando il disciplinare di gara oppure contattare la stazione appaltante.'
WHERE id = 5;

-- 7 — Media Trentino (50° percentile)
UPDATE criteri SET
  metodo_calcolo = 'MEDIA_TRENTINO',
  descrizione_calcolo = 'CRITERIO PROVINCIALE TRENTINO. Si utilizza il 50° percentile (mediana) dei ribassi percentuali anziché la media aritmetica. Dopo il taglio delle ali (10% + 10%), si calcola la mediana dei ribassi rimanenti. La soglia di anomalia è data dalla mediana + scarto medio. Aggiudicatario = offerta con ribasso più alto inferiore alla soglia. Vantaggio: la mediana è meno sensibile a outlier rispetto alla media aritmetica.'
WHERE id = 7;

-- 8 — Procedura Publiacqua spa di Firenze
UPDATE criteri SET
  metodo_calcolo = 'PROCEDURA_PUBLIACQUA',
  descrizione_calcolo = 'PROCEDURA SPECIALE PUBLIACQUA S.P.A. (Firenze). Metodo di aggiudicazione personalizzato sviluppato dalla società Publiacqua per le proprie gare. Le regole precise sono definite nel disciplinare di gara Publiacqua. Generalmente prevede un taglio delle ali simmetrico seguito da calcolo soglia anomalia sulla base dei ribassi residui. Verificare sempre il disciplinare specifico.'
WHERE id = 8;

-- 9 — Media Pura (Friuli Venezia Giulia)
UPDATE criteri SET
  metodo_calcolo = 'MEDIA_PURA_FVG',
  descrizione_calcolo = 'CRITERIO REGIONALE FRIULI VENEZIA GIULIA. Si utilizza la media aritmetica "pura" dei ribassi, SENZA taglio delle ali. Aggiudicatario = offerta con ribasso più vicino alla media aritmetica di tutti i ribassi (per difetto o eccesso a seconda del regolamento regionale). Questo metodo premia la prossimità alla media e scoraggia i ribassi eccessivi.'
WHERE id = 9;

-- 10 — Esclusione Automatica Offerte Anomale (art. 97 c. 2, c. 8 D.Lgs. 50/2016)
UPDATE criteri SET
  metodo_calcolo = 'ESCL_AUTOMATICA_50_2016',
  descrizione_calcolo = 'ESCLUSIONE AUTOMATICA — D.Lgs. 50/2016 (ex art. 97 c. 2 e c. 8). La stazione appaltante, all''apertura delle buste, sorteggia uno dei cinque metodi (A, B, C, D, E) previsti dalla norma. Per tutti i metodi: si effettua il "taglio delle ali" escludendo il 10% delle offerte con maggior ribasso e il 10% di quelle con minor ribasso (arrotondamento all''unità superiore). Sui ribassi rimanenti si calcola la media aritmetica. Si somma lo scarto medio dei ribassi che superano la media, applicando eventuali coefficienti moltiplicativi specifici del metodo sorteggiato. La soglia risultante è la soglia di anomalia: tutte le offerte con ribasso pari o superiore sono escluse automaticamente. Aggiudicatario = offerta ammessa con ribasso più alto. Applicabile solo se le offerte ammesse sono almeno 10 (per gare sopra-soglia) o 5 (sotto-soglia).'
WHERE id = 10;

-- 11 — Massimo Ribasso (art. 95 c. 4, art. 97 c. 2 D.Lgs. 50/2016)
UPDATE criteri SET
  metodo_calcolo = 'MAX_RIBASSO',
  descrizione_calcolo = 'MASSIMO RIBASSO — D.Lgs. 50/2016. Le offerte vengono ordinate per ribasso percentuale decrescente. Aggiudicatario = operatore con il maggior ribasso. Utilizzabile per appalti di lavori, servizi o forniture con caratteristiche standardizzate. La verifica di congruità sulle offerte sospette di anomalia (art. 97 c. 6) resta facoltativa e non automatica.'
WHERE id = 11;

-- 12 — Esclusione Automatica (DL 32/2019 "Sblocca Cantieri")
UPDATE criteri SET
  metodo_calcolo = 'ESCL_AUTOMATICA_SBLOCCA_2019',
  descrizione_calcolo = 'ESCLUSIONE AUTOMATICA — D.L. 32/2019 "Sblocca Cantieri". Il decreto ha semplificato la procedura del D.Lgs. 50/2016: si mantiene il meccanismo del taglio delle ali (10% + 10%) ma si elimina il sorteggio fra i metodi A-E, utilizzandone uno fisso. Soglia anomalia = media ribassi (post-taglio ali) + scarto medio dei ribassi che superano la media. Applicabile se N offerte ammesse ≥ 10.'
WHERE id = 12;

-- 13 — Massimo Ribasso (DL 32/2019 "Sblocca Cantieri")
UPDATE criteri SET
  metodo_calcolo = 'MAX_RIBASSO',
  descrizione_calcolo = 'MASSIMO RIBASSO — D.L. 32/2019 "Sblocca Cantieri". Stesso principio del massimo ribasso classico: ordinamento per ribasso decrescente, aggiudicatario = massimo ribasso. Il decreto ha semplificato l''applicabilità di questo criterio per gli appalti di lavori sotto-soglia.'
WHERE id = 13;

-- 14 — Esclusione Automatica (L.R. Sicilia 13/2019)
UPDATE criteri SET
  metodo_calcolo = 'ESCL_AUTOMATICA_SICILIA',
  descrizione_calcolo = 'ESCLUSIONE AUTOMATICA — Legge Regionale Siciliana n. 13 del 19/07/2019. Variante regionale del metodo di esclusione automatica con regole specifiche per gli appalti gestiti dalla Regione Siciliana e dai suoi enti strumentali. Prevede taglio delle ali e calcolo soglia con parametri previsti dalla legge regionale. Verificare il testo della L.R. per il numero minimo di offerte e i coefficienti.'
WHERE id = 14;

-- 15 — Esclusione Automatica (DL 76/2020 "Semplificazioni")
UPDATE criteri SET
  metodo_calcolo = 'ESCL_AUTOMATICA_DL76_2020',
  descrizione_calcolo = 'ESCLUSIONE AUTOMATICA — D.L. 76/2020 "Decreto Semplificazioni" (conv. L. 120/2020). Regime COVID semplificato: applicabile agli affidamenti sotto-soglia (lavori, servizi, forniture) fino al 30/06/2023. N offerte ammesse ≥ 5. Meccanismo: taglio delle ali (10% + 10% arrotondato), media aritmetica dei ribassi residui, scarto medio dei ribassi sopra la media, soglia di anomalia = media + scarto. Esclusione automatica delle offerte con ribasso pari o superiore alla soglia.'
WHERE id = 15;

-- 16 — Massimo Ribasso (DL 76/2020 "Semplificazioni")
UPDATE criteri SET
  metodo_calcolo = 'MAX_RIBASSO',
  descrizione_calcolo = 'MASSIMO RIBASSO — D.L. 76/2020 "Semplificazioni". Utilizzabile per affidamenti diretti sotto-soglia e procedure negoziate semplificate del periodo COVID. Aggiudicazione al maggior ribasso offerto senza alcuna esclusione automatica.'
WHERE id = 16;

-- 17 — Esclusione Automatica (All. II.2 e art. 54 D.Lgs. 36/2023)
UPDATE criteri SET
  metodo_calcolo = 'ESCL_AUTOMATICA_36_2023_GENERICA',
  descrizione_calcolo = 'ESCLUSIONE AUTOMATICA — D.Lgs. 36/2023 (nuovo Codice Contratti 2023). Art. 54 + Allegato II.2 del nuovo codice. Prevede tre metodi alternativi (A, B, C) che la stazione appaltante sceglie nel bando. Per tutti: taglio delle ali (10% + 10%) e calcolo della soglia di anomalia sulla base dei ribassi residui. Le offerte con ribasso ≥ soglia sono automaticamente escluse. Applicabile per gare con almeno 5 offerte ammesse. Per il calcolo specifico, consultare i metodi A, B o C.'
WHERE id = 17;

-- 18 — Massimo Ribasso (All. II.2 e art. 54 D.Lgs. 36/2023)
UPDATE criteri SET
  metodo_calcolo = 'MAX_RIBASSO',
  descrizione_calcolo = 'MASSIMO RIBASSO — D.Lgs. 36/2023 (nuovo Codice Contratti 2023). Art. 50 e segg. Aggiudicazione al maggior ribasso per appalti di lavori/servizi/forniture con caratteristiche standardizzate. Ordinamento delle offerte per ribasso decrescente, aggiudicatario = operatore con il ribasso più alto.'
WHERE id = 18;

-- 19 — Esclusione Automatica D.Lgs. 36/2023 METODO A
UPDATE criteri SET
  metodo_calcolo = 'ESCL_AUTOMATICA_36_2023_A',
  descrizione_calcolo = 'ESCLUSIONE AUTOMATICA — D.Lgs. 36/2023, ALLEGATO II.2, METODO A. Procedura: (1) si escludono il 10% (arrotondamento all''unità superiore) delle offerte di maggior ribasso e il 10% delle offerte di minor ribasso; (2) si calcola la media aritmetica dei ribassi residui; (3) si calcola lo scarto medio aritmetico dei ribassi che superano la media; (4) soglia di anomalia = media + scarto medio. Le offerte con ribasso ≥ soglia sono automaticamente escluse. Richiede almeno 5 offerte ammesse. Aggiudicatario = offerta ammessa con ribasso più alto non anomalo.'
WHERE id = 19;

-- 20 — Esclusione Automatica D.Lgs. 36/2023 METODO B
UPDATE criteri SET
  metodo_calcolo = 'ESCL_AUTOMATICA_36_2023_B',
  descrizione_calcolo = 'ESCLUSIONE AUTOMATICA — D.Lgs. 36/2023, ALLEGATO II.2, METODO B. Variante con calcolo della soglia basato su media + scarto moltiplicato per un coefficiente correttivo (tipicamente variabile tra 0,6 e 1,4) determinato dalla prima cifra decimale della somma dei ribassi. Taglio delle ali come nel metodo A. Obiettivo: rendere la soglia di anomalia meno prevedibile e più resistente ai tentativi di collusione. Richiede almeno 5 offerte.'
WHERE id = 20;

-- 21 — Esclusione Automatica D.Lgs. 36/2023 METODO C
UPDATE criteri SET
  metodo_calcolo = 'ESCL_AUTOMATICA_36_2023_C',
  descrizione_calcolo = 'ESCLUSIONE AUTOMATICA — D.Lgs. 36/2023, ALLEGATO II.2, METODO C. Variante che introduce un ulteriore elemento aleatorio: dopo taglio delle ali e calcolo media+scarto, si applica un ribasso forfettario alla soglia determinato da una cifra estratta dai ribassi stessi. Il risultato è una soglia di anomalia ancora meno prevedibile. Richiede almeno 5 offerte ammesse.'
WHERE id = 21;

-- 22 — Massimo Ribasso D.Lgs. 36/2023 METODO A
UPDATE criteri SET
  metodo_calcolo = 'MAX_RIBASSO',
  descrizione_calcolo = 'MASSIMO RIBASSO — D.Lgs. 36/2023 METODO A. Ordinamento delle offerte per ribasso percentuale decrescente. Aggiudicatario = offerta con il maggior ribasso. Il "METODO A" riferisce alla variante di aggiudicazione prevista dal bando senza meccanismo di esclusione automatica: la verifica di congruità è facoltativa ex art. 110 del nuovo Codice.'
WHERE id = 22;

-- 23 — Massimo Ribasso D.Lgs. 36/2023 METODO B
UPDATE criteri SET
  metodo_calcolo = 'MAX_RIBASSO',
  descrizione_calcolo = 'MASSIMO RIBASSO — D.Lgs. 36/2023 METODO B. Stesso ordinamento decrescente dei ribassi. Variante procedurale del metodo A definita dal bando (può prevedere modalità diverse di verifica documentale o di presentazione delle offerte). Aggiudicatario = maggior ribasso.'
WHERE id = 23;

-- 24 — Massimo Ribasso D.Lgs. 36/2023 METODO C
UPDATE criteri SET
  metodo_calcolo = 'MAX_RIBASSO',
  descrizione_calcolo = 'MASSIMO RIBASSO — D.Lgs. 36/2023 METODO C. Stesso principio dei metodi A e B: aggiudicazione all''offerta con il ribasso più alto. La differenza procedurale è definita dal bando di gara specifico.'
WHERE id = 24;
