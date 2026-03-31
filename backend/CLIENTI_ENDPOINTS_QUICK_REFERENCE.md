# Area Clienti - Quick Endpoint Reference

## All endpoints require JWT authentication

### HOME & PROFILE (5 endpoints)
```
GET    /api/clienti/home                           Dashboard (latest 50 bandi + 50 esiti)
GET    /api/clienti/profilo                        Get profile
PUT    /api/clienti/profilo                        Update profile (nome, cognome, telefono, etc.)
POST   /api/clienti/cambio-password                Change password (requires old password)
```

### BANDI - Browse & Filter (3 endpoints)
```
GET    /api/clienti/bandi                          List bandi (paginated, filtered by subscription)
GET    /api/clienti/bandi/:id                      Get bando detail
POST   /api/clienti/bandi/:id/richiedi-apertura   Request opening service
POST   /api/clienti/bandi/:id/richiedi-servizi    Request other services
```

### BANDI - Registry Management (5 endpoints)
```
GET    /api/clienti/bandi/registro                 List user's registry
POST   /api/clienti/bandi/:id/registro            Add to registry
PUT    /api/clienti/bandi/registro/:id            Update registry notes
DELETE /api/clienti/bandi/registro/:id            Remove from registry
GET    /api/clienti/bandi/registro/esporta        Export registry (JSON)
```

### BANDI - Writing/Entry Management (3 endpoints)
```
PUT    /api/clienti/bandi/scritture/:id/stato      Update entry status
PUT    /api/clienti/bandi/scritture/:id/eseguito   Mark as executed
```

### BANDI - Create/Modify (2 endpoints)
```
POST   /api/clienti/bandi/crea                     Create new bando (client submission)
PUT    /api/clienti/bandi/:id/modifica             Modify own bando
```

### ESITI - Browse & Filter (3 endpoints)
```
GET    /api/clienti/esiti                          List esiti (paginated, filtered by subscription)
GET    /api/clienti/esiti/:id                      Get esito detail
GET    /api/clienti/esiti/:id/mappa               Get map coordinates
```

### ESITI - Favorites (3 endpoints)
```
GET    /api/clienti/esiti/preferiti               List favorite esiti
POST   /api/clienti/esiti/:id/preferiti           Add to favorites
DELETE /api/clienti/esiti/:id/preferiti           Remove from favorites
```

### ESITI - Actions (1 endpoint)
```
POST   /api/clienti/esiti/:id/invia-mail          Send esito via email
```

### SIMULAZIONI (3 endpoints)
```
GET    /api/clienti/simulazioni                    List user's simulations
GET    /api/clienti/simulazioni/:id               Get simulation detail with participants
DELETE /api/clienti/simulazioni/:id               Delete own simulation
```

### ATI / AVVALIMENTI (4 endpoints)
```
GET    /api/clienti/ati/:idGara/:idMandataria     Get ATI detail
GET    /api/clienti/ati/esiti                     ATI esiti between companies
GET    /api/clienti/avvalimenti/:idGara/:idAzienda  Get avvalimento detail
GET    /api/clienti/avvalimenti/esiti             Avvalimento esiti between companies
```

### COMPANY ANALYTICS (3 endpoints)
```
GET    /api/clienti/aziende/:id                    Get company card
GET    /api/clienti/aziende/:id/ribassi           Discount history & stats
GET    /api/clienti/aziende/:id/risultati         Results breakdown by position
```

### NEWSLETTER (2 endpoints)
```
GET    /api/clienti/newsletter/bandi              Bandi newsletter history
GET    /api/clienti/newsletter/esiti              Esiti newsletter history
```

### GEOLOCATION (2 endpoints)
```
GET    /api/clienti/ultimi-bandi?lat=&lon=&raggio=50    Recent bandi near location
GET    /api/clienti/ultimi-esiti?lat=&lon=&raggio=50    Recent esiti near location
```

---

## Total: 44 Client-Facing Endpoints

### By Category
- Home & Profile: 5
- Bandi (all): 13
- Esiti (all): 7
- Simulazioni: 3
- ATI/Avvalimenti: 4
- Company Analytics: 3
- Newsletter: 2
- Geolocation: 2

---

## Key Features

✅ **Subscription-based filtering** - All data filtered by user's regions, provinces, SOA
✅ **Registry management** - Save and annotate bandi
✅ **Favorites system** - Mark favorite esiti
✅ **Company analytics** - Discount trends, position statistics
✅ **Service requests** - Request tender openings, email sends
✅ **Client submissions** - Create and modify own bandi
✅ **Simulations** - List and manage tender simulations
✅ **Partnership tracking** - ATI and Avvalimenti relationships
✅ **Geolocation search** - Find bandi/esiti by coordinates
✅ **Newsletter history** - Access past email campaigns

---

## Data Model Notes

**Subscription filtering** applied to all lists via users_regioni and users_soa tables.

**No duplicates** - Registry and favorites prevent double-adds (409 Conflict).

**Access control** - Client bandi/esiti only shown if user subscribed to region OR SOA.

**Ownership verification** - User can only modify/delete their own records (created_by check).

**Password security** - Bcryptjs hashing with verification of old password before change.

---

## Standard Query Parameters

**Pagination**: `page`, `limit` (default 20)
**Search**: `search` (fuzzy on titolo/codice_cig for bandi)
**Filters**: `regione`, `id_soa` (varies by endpoint)
**Sort**: `sort`, `order` (ASC/DESC)
**Geolocation**: `lat`, `lon`, `raggio` (in km)

---

## Error Codes

| Code | Meaning |
|------|---------|
| 400 | Bad request - missing required fields |
| 401 | Unauthorized - invalid JWT token |
| 403 | Forbidden - access denied (wrong user/subscription) |
| 404 | Not found - resource doesn't exist |
| 409 | Conflict - duplicate entry (already exists) |
| 500 | Server error |

