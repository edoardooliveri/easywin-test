# Area Clienti (Client Portal) Routes Documentation

## Overview
The `clienti.js` route file implements all client-facing features from the Abbonamenti (Subscriptions) area of the original ASP.NET system. This is fundamentally different from admin routes—these endpoints are for **logged-in customers who have subscriptions** to specific regions, provinces, and SOA (Stazioni Appaltanti) categories.

**Key Principle**: All client routes filter data based on user's subscription assignments (users_regioni, users_soa, users_soa_bandi_province, users_soa_esiti_province tables).

---

## Authentication
All endpoints require JWT authentication via the `fastify.authenticate` preHandler. The token is validated and the user's username is extracted from `request.user.username`.

---

## Endpoint Categories

### 1. CLIENT HOME & PROFILE
Dashboard and account management for logged-in clients.

#### GET /api/clienti/home
Returns latest 50 bandi + 50 esiti filtered by user's subscription regions/provinces/SOA.
- **Filters**: users_regioni, users_soa
- **Response**: `{ bandi_recent, esiti_recent, total_bandi, total_esiti }`

#### GET /api/clienti/profilo
Full user profile with all personal details.
- **Response**: username, email, nome, cognome, azienda, partita_iva, codice_fiscale, citta, provincia, telefono, approvato, scadenza dates

#### PUT /api/clienti/profilo
Update profile fields (nome, cognome, telefono, citta, provincia, codice_fiscale).
- **Note**: Cannot change role, subscription, or email via this endpoint
- **Body**: `{ nome?, cognome?, telefono?, citta?, provincia?, codice_fiscale? }`

#### POST /api/clienti/cambio-password
Change user's own password. Requires old password verification.
- **Body**: `{ password_attuale, password_nuova }`

---

### 2. CLIENT BANDI (Tender Management)
Browse, filter, and manage bandi (public construction tenders).

#### GET /api/clienti/bandi
Browse bandi with pagination and filters. Only shows bandi matching user's subscription.
- **Query Params**: page, limit, search, regione, id_soa, sort, order
- **Subscription Filter**: User must be subscribed to the bando's region OR SOA
- **Response**: Paginated list with total count

#### GET /api/clienti/bandi/:id
Get single bando detail (with access control check).
- **Access**: Only if user subscribed to bando's region or SOA

#### POST /api/clienti/bandi/:id/richiedi-apertura
Request tender opening service for a bando.
- **Body**: `{ note? }`
- **Creates**: Entry in richieste_servizi table with type 'APERTURA'

#### POST /api/clienti/bandi/:id/richiedi-servizi
Request other services (generic).
- **Body**: `{ tipo_servizio, note? }`
- **Creates**: Entry in richieste_servizi table with specified service type

#### GET /api/clienti/bandi/registro
User's tender registry (saved bandi with personal notes).
- **Query Params**: page, limit
- **Table**: registro_gare_clienti
- **Response**: Paginated list with join to bandi for details

#### POST /api/clienti/bandi/:id/registro
Add bando to user's registry with notes.
- **Body**: `{ note? }`
- **Prevents Duplicates**: Returns 409 if already added

#### PUT /api/clienti/bandi/registro/:id
Update registry notes for a saved bando.
- **Body**: `{ note }`

#### DELETE /api/clienti/bandi/registro/:id
Remove bando from user's registry.

#### GET /api/clienti/bandi/registro/esporta
Export entire user registry as JSON (for frontend to convert to CSV/Excel).
- **Response**: Full data with exported_at timestamp and count

#### PUT /api/clienti/bandi/scritture/:id/stato
Update writing/entry status (AssegnaStato field).
- **Body**: `{ stato }`
- **Table**: dettaglio_gara

#### PUT /api/clienti/bandi/scritture/:id/eseguito
Mark a writing/entry as executed (sets Eseguito=true, DataEsecuzione=NOW()).
- **Table**: dettaglio_gara

#### POST /api/clienti/bandi/crea
Client submission of a new bando. Different from admin creation (records created_by username).
- **Body**: `{ titolo, codice_cig?, codice_cup?, importo_so?, regione, provincia?, id_soa?, descrizione?, data_offerta?, data_apertura? }`
- **Required**: titolo, regione
- **Metadata**: Automatically timestamps with created_by=username, created_at=NOW()

#### PUT /api/clienti/bandi/:id/modifica
Modify own bando (only if user created it via POST /bandi/crea).
- **Access Check**: Verifies created_by = current username
- **Body**: Any subset of { titolo, importo_so, descrizione, data_offerta, data_apertura }

---

### 3. CLIENT ESITI (Outcomes/Results)
Browse, filter, and manage esiti (tender outcomes) with advanced features.

#### GET /api/clienti/esiti
Browse esiti with subscription filtering and pagination.
- **Query Params**: page, limit, search, regione, id_soa, sort, order
- **Subscription Filter**: Same as bandi—only user's subscribed regions/SOAs
- **Response**: Paginated list

#### GET /api/clienti/esiti/:id
Get single esito detail (with access control).
- **Access**: Only if subscribed to esito's region or SOA

#### GET /api/clienti/esiti/preferiti
List user's favorite esiti.
- **Table**: preferiti_esiti
- **Response**: List with data_aggiunta timestamps

#### POST /api/clienti/esiti/:id/preferiti
Add esito to favorites.
- **Prevents Duplicates**: Returns 409 if already favorited

#### DELETE /api/clienti/esiti/:id/preferiti
Remove esito from favorites.

#### POST /api/clienti/esiti/:id/invia-mail
Send esito details via email to a specific company/address.
- **Body**: `{ destinatario_email }`
- **Implementation**: Logs request in richieste_servizi with type 'INVIA_EMAIL'
- **Note**: Actual email sending handled by service layer

#### GET /api/clienti/esiti/:id/mappa
Get map coordinates for an esito (latitudine, longitudine).
- **Response**: id, numero_gara, provincia, regione, latitudine, longitudine

---

### 4. CLIENT SIMULAZIONI (Simulations)
List and manage user's tender outcome simulations.

#### GET /api/clienti/simulazioni
List user's simulations with pagination.
- **Query Params**: page, limit
- **Table**: simulazioni (filtered by created_by=username)
- **Response**: nome_simulazione, id_gara, numero_partecipanti, data_creazione

#### GET /api/clienti/simulazioni/:id
Get simulation detail with all participants.
- **Access**: Only if user created it
- **Joins**: simulazioni + simulazioni_partecipanti
- **Response**: sim details + array of participants with posizioni

#### DELETE /api/clienti/simulazioni/:id
Delete own simulation.
- **Cascade Note**: Depends on DB schema (may need to cascade delete participants)

---

### 5. ATI & AVVALIMENTI (Partnerships)
View ATI (temporary joint ventures) and Avvalimenti (partnership leverage) data between companies.

#### GET /api/clienti/ati/:idGara/:idMandataria
Get ATI detail for a specific tender (gara) with lead company (mandataria).
- **Table**: ati_gare
- **Response**: id_mandante, percentuale_mandante, data_costituzione

#### GET /api/clienti/ati/esiti
Find all esiti (outcomes) where two companies had ATI partnership.
- **Query Params**: id_mandataria, id_mandante (both required)
- **Bidirectional**: Searches both directions (A-B and B-A)

#### GET /api/clienti/avvalimenti/:idGara/:idAzienda
Get avvalimento detail for a company in a specific tender.
- **Table**: dettaglio_gara
- **Response**: Full record

#### GET /api/clienti/avvalimenti/esiti
Find all outcomes where two companies had avvalimento relationship.
- **Query Params**: id_azienda_principale, id_azienda_avvalimento (both required)

---

### 6. COMPANY ANALYTICS
Statistics and charts for company performance analysis.

#### GET /api/clienti/aziende/:id
Get company card with basic info (ragione sociale, partita_iva, codice_fiscale, contacts).
- **Table**: aziende

#### GET /api/clienti/aziende/:id/ribassi
Discount/rebate history chart data (last 40 outcomes).
- **Calculation**: Includes simple statistics (media, min, max ribasso)
- **Note**: Frontend can enhance with regression calculation
- **Response**: Detailed records + statistiche object

#### GET /api/clienti/aziende/:id/risultati
Results breakdown by position (1st place, 2nd, etc.).
- **Table**: dettaglio_gara grouped by Posizione
- **Response**: Array + breakdown object keyed by posizione_N

---

### 7. NEWSLETTER
Email newsletter history and logs.

#### GET /api/clienti/newsletter/bandi
Bandi newsletter send history with pagination.
- **Query Params**: page, limit
- **Table**: newsletter_log (tipo='BANDI')
- **Response**: id, data_invio, numero_bandi, soggetto, stato_invio

#### GET /api/clienti/newsletter/esiti
Esiti newsletter send history with pagination.
- **Query Params**: page, limit
- **Table**: newsletter_log (tipo='ESITI')
- **Response**: id, data_invio, numero_esiti, soggetto, stato_invio

---

### 8. GEOLOCATION
Find bandi/esiti near a geographic location.

#### GET /api/clienti/ultimi-bandi?lat=&lon=&raggio=50
Recent bandi within radius of coordinates.
- **Query Params**: lat (required), lon (required), raggio (default 50km)
- **Algorithm**: Simple lat/lon distance check (not actual Great Circle Distance)
- **Conversion**: 1 degree ≈ 111 km
- **Response**: Array of bandi with coordinates, limit 50

#### GET /api/clienti/ultimi-esiti?lat=&lon=&raggio=50
Recent esiti within radius of coordinates.
- **Same as bandi but for gare table**

---

## Data Access Pattern

### Subscription Filtering
Every user has subscriptions defined through these tables:
- **users_regioni**: Regions user is subscribed to
- **users_soa**: SOA (Stazioni Appaltanti) user is subscribed to
- **users_soa_bandi_province**: Province-level filters for bandi per SOA
- **users_soa_esiti_province**: Province-level filters for esiti per SOA

**Basic filter logic** (used throughout):
```sql
(b."Regione" = ANY(user_regions_array) OR b."id_soa" = ANY(user_soa_array))
```

If user has no subscriptions, return empty results (permission denied via data filtering, not 403).

---

## Error Handling
All routes use standardized error responses:
- **400**: Bad request (missing required fields, invalid input)
- **401**: Unauthorized (missing/invalid JWT token)
- **403**: Forbidden (access control violation)
- **404**: Not found
- **409**: Conflict (duplicate entry, already exists)
- **500**: Server error

Errors logged via `fastify.log.error()` with context.

---

## Database Tables Referenced
- **users**: Core user data
- **users_regioni**: User region subscriptions
- **users_soa**: User SOA subscriptions
- **bandi**: Public tenders
- **gare**: Tender outcomes (esiti)
- **registro_gare_clienti**: User's saved bandi registry
- **preferiti_esiti**: User's favorite esiti
- **richieste_servizi**: Service requests (apertura, email, etc.)
- **simulazioni**: User simulations
- **simulazioni_partecipanti**: Simulation participants
- **ati_gare**: ATI partnership data
- **aziende**: Company master data
- **dettaglio_gara**: Tender outcome details (writings, standings)
- **newsletter_log**: Email send history

---

## Integration Notes
1. **Computed Properties**: Routes use SQL aliases (AS) to map CamelCase DB columns to snake_case API responses for consistency.
2. **Pagination**: All list endpoints use offset/limit with total count and pages calculation.
3. **Timestamps**: Uses NOW() for server-side timestamps (password changes, registry adds, favorites, etc.)
4. **Security**: Password hashing via bcryptjs (same pattern as auth.js), parameterized queries throughout.
5. **Logging**: All errors logged with context for debugging.

---

## Future Enhancements
1. Service layer extraction for complex logic (email sending, simulation calculation)
2. Caching for frequently-accessed company statistics
3. Advanced regression models for discount trends (currently simple mean/min/max)
4. Actual GIS distance calculation (Great Circle Distance) for geolocation
5. Export formats beyond JSON (CSV, PDF via service layer)

