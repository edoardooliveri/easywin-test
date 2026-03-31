# Comprehensive Simulation Engine (simulazioni-engine.js)

## Overview

This document describes the comprehensive simulation engine that replicates the original ASP.NET `SimulazioniController` (5540 lines, 44 methods) in modern Node.js/Fastify.

**File:** `/sessions/adoring-clever-mayer/mnt/sito easywin/backend/src/routes/simulazioni-engine.js` (1366 lines)

**Purpose:** Complete simulation system for Italian public procurement (appalti) with support for 51 different esito (result) typologies, participant management, and sophisticated calculation algorithms.

---

## Architecture

### Tipologie System

The system supports 51 different "tipologie" (procurement types), each with unique calculation rules:

```javascript
const TIPOLOGIE = {
  NUOVI_CASI: [16,17,18,19,22,23,24,25,30,31,32,35,36,37,33,38,47,48],
  ESCLUDI_TAGLIO_ALI: [17,18,23,24,31,36,32,37],
  MASSIMO_RIBASSO: [3,4,6,29,30,31,32,33,34,35,36,37,38,45,46,51,52,61,62,63,64,65,66],
  SBLOCCA_CANTIERI: [43,44,45,46,49,50,51,52,53,57,61,64,54,58,62,65,55,59,63,66],
  SEMPRE_15: [54,58,62,65,55,59,63,66],
  REGIONE_SICILIA: [47,48],
  TIPO_D: [18,24,32,37],
  TIPO_E: [19,25,33,38]
};
```

### Key Concepts

1. **Media Aritmetica (MA):** Arithmetic mean of all valid bids
2. **Soglia Anomalia (SA):** Anomaly threshold = MA + Media Scarti
3. **Media Scarti (MS):** Mean of deviations from MA
4. **Taglio Ali (Wing Clipping):** Removal of extreme bids (10%, 15%, or 20% depending on tipologia)
5. **Classificata:** Bid is classified (below anomaly threshold)
6. **Anomala:** Bid is anomalous (above anomaly threshold)
7. **Vincitrice:** Bid is winner (highest non-anomalous bid)

---

## API Endpoints (27 Total)

### CRUD Operations (3)
- `GET /api/simulazioni-engine` - List simulations
- `GET /api/simulazioni-engine/:id` - Get full detail
- `DELETE /api/simulazioni-engine/:id` - Delete simulation

### Creation Wizard (3)
- `POST /api/simulazioni-engine/crea` - Step 1: Initialize
- `POST /api/simulazioni-engine/:id/seleziona-esiti` - Step 2: Select esiti
- `POST /api/simulazioni-engine/:id/conferma` - Step 3: Confirm & activate

### Participant Management (7)
- `GET /api/simulazioni-engine/:id/dettagli` - List participants
- `GET /api/simulazioni-engine/:id/azienda/:idAzienda` - Get company detail
- `PUT /api/simulazioni-engine/:id/azienda/:idAzienda/ribasso` - Modify discount
- `DELETE /api/simulazioni-engine/:id/azienda/:idAzienda` - Remove company
- `DELETE /api/simulazioni-engine/:id/aziende` - Remove multiple
- `POST /api/simulazioni-engine/:id/aggiungi-azienda` - Add fake company
- `POST /api/simulazioni-engine/:id/aggiungi-range` - Add discount range
- `POST /api/simulazioni-engine/:id/aggiungi-aziende-db` - Add from database

### Calculations (2)
- `POST /api/simulazioni-engine/:id/ricalcola` - Run calculation
- `PUT /api/simulazioni-engine/:id/soglia-riferimento` - Modify threshold

### Variants (2)
- `GET /api/simulazioni-engine/:id/varianti` - List variants
- `POST /api/simulazioni-engine/:id/variante` - Create variant

### Clone & Export (3)
- `POST /api/simulazioni-engine/:id/clona` - Clone simulation
- `GET /api/simulazioni-engine/:id/esporta-json` - Export JSON
- `GET /api/simulazioni-engine/:id/esporta-csv` - Export CSV

### Esito Creation (2)
- `POST /api/simulazioni-engine/:id/crea-esito` - Create official esito
- `PUT /api/simulazioni-engine/:id/modifica-esito` - Modify esito

---

## Core Calculation Algorithm

### Main Function: `calcolaSimulazione()`

Implements full calculation pipeline:

1. **Input Normalization**
   - Round all ribassi to specified decimals
   - Sort descending by ribasso (highest first)
   - Initialize calculation flags

2. **Select Algorithm**
   - OLD: Classic calculation
   - NEW: Enhanced calculation (variant rules)

3. **Apply Wing Clipping (if applicable)**
   - Check tipologia against ESCLUDI_TAGLIO_ALI
   - Determine cut percentage (10%, 15%, or 20%)
   - Remove extreme bids from top and bottom

4. **Calculate Statistics**
   - Media Aritmetica = Sum(ribassi) / Count
   - Media Scarti = Sum(|ribasso - MA|) / Count
   - Soglia Anomalia = MA + MS

5. **Determine Winner**
   - Find highest bid ≤ Soglia Anomalia
   - If all anomalous, winner is highest bid
   - Mark vincitrice = true

6. **Classify All Bids**
   - classificata = (ribasso ≤ Soglia Anomalia)
   - anomala = (ribasso > Soglia Anomalia)
   - Assign position numbers

### Special Tipologie

**Massimo Ribasso (types 3,4,6,29-38,45-46,51-52,61-66)**
- Winner is simply highest ribasso
- No anomaly threshold applied
- All bids classified

**Type D (18, 24, 32, 37)**
- Cannot win if anomalous
- Requires ribasso < Soglia Anomalia

**Type E (19, 25, 33, 38)**
- Always use 10% wing clipping (not 20%)

**Sblocca Cantieri (43-66)**
- Flexible wing clipping rules
- Multiple variants (A, B, C)

---

## Implementation Highlights

### Security
- All endpoints require authentication
- User ownership verified on every operation
- SQL injection protected via parameterized queries

### Data Integrity
- PostgreSQL transactions for consistency
- Cascade deletes via foreign keys
- Audit timestamps (data_creazione, data_modifica, data_calcolo)

### Calculation Accuracy
- `Math.round()` with proper decimal handling
- Consistent rounding throughout (AwayFromZero semantics)
- No floating-point accumulation errors

### Performance
- Efficient sorting (O(n log n))
- Batch operations for range creation
- Single DB round-trip per operation

---

## Testing & Validation

Key test scenarios:

1. **Tipologia Coverage**
   - Test each MASSIMO_RIBASSO type
   - Test ESCLUDI_TAGLIO_ALI types
   - Test Sblocca Cantieri variants

2. **Wing Clipping Modes**
   - Mode 0/2: Count-based cutting
   - Mode 1: Unique-value cutting

3. **Boundary Conditions**
   - Single participant
   - All identical ribassi
   - All anomalous bids
   - Empty simulation

4. **Calculations**
   - Verify Media Aritmetica formula
   - Verify Soglia Anomalia = MA + MS
   - Verify winner selection logic
   - Verify position assignments

5. **User Operations**
   - Add/remove participants
   - Modify individual discounts
   - Clone with all data
   - Export consistency

---

## File Statistics

```
Lines:             1,366
Functions:         25+
API Endpoints:     27
Tipologie:         51
Comments:          Comprehensive
Calculation Steps: 6
```

---

## Integration Notes

To use this engine in the main application:

```javascript
// In your main fastify app setup
import simulazioniEngine from './src/routes/simulazioni-engine.js';

fastify.register(simulazioniEngine, { prefix: '/api/simulazioni-engine' });
```

Requires:
- PostgreSQL database with proper schema
- Authentication middleware (sets request.user)
- UUID generation library
- Fastify framework

---

## Related Documentation

- Original ASP.NET: SimulazioniController.cs (5540 lines, 44 methods)
- Simple Routes: simulazioni.js (AI-powered version)
- Architecture: project_easywin_architecture.md
- Requirements: project_easywin_newsite_requirements.md
