# Quick Start Guide - Simulation Engine

## Installation

1. Copy the engine file to your routes:
   ```bash
   cp src/routes/simulazioni-engine.js <your-backend>/src/routes/
   ```

2. Register with Fastify in your main app:
   ```javascript
   import simulazioniEngine from './src/routes/simulazioni-engine.js';
   
   fastify.register(simulazioniEngine, { 
     prefix: '/api/simulazioni-engine' 
   });
   ```

3. Ensure PostgreSQL database has these tables:
   - `simulazioni`
   - `dettagli_simulazione`
   - `varianti_simulazione`

## Basic Workflow

### 1. Create Simulation
```bash
curl -X POST http://localhost:3000/api/simulazioni-engine/crea \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "titolo": "Simulazione Q4 2024",
    "id_regione": 12,
    "id_tipologia": 15,
    "data_min": "2024-01-01",
    "data_max": "2024-12-31"
  }'
```

Response:
```json
{
  "simulazione": {
    "id": "abc-123-def-456",
    "titolo": "Simulazione Q4 2024",
    ...
  },
  "n_esiti_disponibili": 284,
  "step": 1
}
```

### 2. Select Historical Esiti
```bash
curl -X POST http://localhost:3000/api/simulazioni-engine/abc-123-def-456/seleziona-esiti \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "esiti_ids": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
  }'
```

### 3. Add Participants

#### Add Real Companies:
```bash
curl -X POST http://localhost:3000/api/simulazioni-engine/abc-123-def-456/aggiungi-aziende-db \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "ids": [100, 200, 300]
  }'
```

#### Add Fake Company:
```bash
curl -X POST http://localhost:3000/api/simulazioni-engine/abc-123-def-456/aggiungi-azienda \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "nome": "Impresa Test SRL",
    "ribasso": 15.5
  }'
```

#### Add Range of Companies:
```bash
curl -X POST http://localhost:3000/api/simulazioni-engine/abc-123-def-456/aggiungi-range \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "ribasso_min": 10.0,
    "ribasso_max": 20.0,
    "step": 2.5
  }'
```

### 4. Confirm Simulation
```bash
curl -X POST http://localhost:3000/api/simulazioni-engine/abc-123-def-456/conferma \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "algoritmo": "OLD"
  }'
```

### 5. Run Calculation
```bash
curl -X POST http://localhost:3000/api/simulazioni-engine/abc-123-def-456/ricalcola \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "algoritmo": "OLD"
  }'
```

Response:
```json
{
  "simulazione": {...},
  "risultati": {
    "media_aritmetica": 12.345,
    "soglia_anomalia": 14.567,
    "media_scarti": 2.222,
    "id_vincitore": 5,
    "ribasso_vincitore": 13.5,
    "n_partecipanti": 45,
    "n_classificati": 38
  }
}
```

### 6. View Results
```bash
curl -X GET http://localhost:3000/api/simulazioni-engine/abc-123-def-456/dettagli \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### 7. Export
```bash
# JSON export
curl -X GET http://localhost:3000/api/simulazioni-engine/abc-123-def-456/esporta-json \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -o simulazione.json

# CSV export (for Excel)
curl -X GET http://localhost:3000/api/simulazioni-engine/abc-123-def-456/esporta-csv \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -o simulazione.csv
```

## Key Calculation Concepts

### Media Aritmetica (MA)
Average of all valid bids:
```
MA = Sum(ribasso) / Count(ribasso)
```

### Media Scarti (MS)
Average deviation from MA:
```
Scarti[i] = |ribasso[i] - MA|
MS = Sum(Scarti) / Count(Scarti)
```

### Soglia Anomalia (SA)
Threshold for anomalous bids:
```
SA = MA + MS
```

### Classification
- **Classificata:** ribasso ≤ SA (not anomalous)
- **Anomala:** ribasso > SA (anomalous)
- **Vincitrice:** Highest classificata bid (the winner)

### Wing Clipping (Taglio Ali)
Removes extreme bids before calculation:
- Mode 0/2: Cut by count (top N and bottom N)
- Mode 1: Cut by unique values (top N unique and bottom N unique)
- Percentage: 10%, 15%, or 20% depending on tipologia

## Tipologia Reference

### Massimo Ribasso Types (Winner = Highest Bid)
3, 4, 6, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 45, 46, 51, 52, 61, 62, 63, 64, 65, 66

### Escludi Taglio Ali (No Wing Clipping)
17, 18, 23, 24, 31, 36, 32, 37

### Sempre 15% (Always 15% Wing Clipping)
54, 58, 62, 65, 55, 59, 63, 66

## Common Tasks

### Modify a Participant's Discount
```bash
curl -X PUT http://localhost:3000/api/simulazioni-engine/abc-123-def-456/azienda/5/ribasso \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "ribasso": 16.75
  }'
```

### Remove a Participant
```bash
curl -X DELETE http://localhost:3000/api/simulazioni-engine/abc-123-def-456/azienda/5 \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Clone Simulation
```bash
curl -X POST http://localhost:3000/api/simulazioni-engine/abc-123-def-456/clona \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "titolo": "Copia di Simulazione Q4 2024"
  }'
```

### Create Official Esito
```bash
curl -X POST http://localhost:3000/api/simulazioni-engine/abc-123-def-456/crea-esito \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "id_gara": 123
  }'
```

## Troubleshooting

### "Simulazione non trovata" (404)
- Verify simulation ID is correct
- Verify you own the simulation (created with your user)

### "Nessun partecipante in simulazione" (400)
- Add at least one participant before calculating
- Use any of: aggiungi-azienda, aggiungi-range, aggiungi-aziende-db

### "Non autenticato" (401)
- Verify Authorization header is present and valid

### Calculation results seem wrong
- Check that participants have valid ribasso values (numbers)
- Verify tipologia is set (affects wing clipping rules)
- Ensure decimal places setting is correct
- Try with NEW algorithm if results differ

## Performance Tips

1. **Large Simulations:** Add 100+ participants in batches
2. **Batch Adds:** Use aggiungi-range for many participants at once
3. **Export:** CSV exports are faster than JSON for large datasets
4. **Calculation:** Caching can speed up identical calculations
5. **Variants:** Create variants instead of cloning for parameter testing

## API Reference

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/crea` | Initialize simulation |
| POST | `/:id/seleziona-esiti` | Select historical esiti |
| POST | `/:id/conferma` | Confirm and activate |
| POST | `/:id/aggiungi-azienda` | Add fake company |
| POST | `/:id/aggiungi-range` | Add range |
| POST | `/:id/aggiungi-aziende-db` | Add real companies |
| PUT | `/:id/azienda/:id/ribasso` | Modify discount |
| DELETE | `/:id/azienda/:id` | Remove company |
| POST | `/:id/ricalcola` | Run calculation |
| GET | `/:id/dettagli` | View participants |
| GET | `/:id/esporta-csv` | Export CSV |
| GET | `/:id/esporta-json` | Export JSON |
| POST | `/:id/clona` | Clone |
| POST | `/:id/variante` | Create variant |
| POST | `/:id/crea-esito` | Create official result |

## See Also

- Full Specification: `SIMULAZIONI_ENGINE_SPEC.md`
- Database Schema: `SIMULAZIONI_ENGINE_SPEC.md` (Database Schema section)
- Source Code: `src/routes/simulazioni-engine.js`
