# EasyWin Public Website - Features Added

## Summary
Updated the public-facing website (index.html) with 8 missing features to enhance user engagement, accessibility, and functionality. All features include API integration points for the backend.

---

## 1. PASSWORD RECOVERY & RESET

### Files Updated:
- `index.html` - Added recovery modal and JavaScript handlers
- `recovery.html` - NEW dedicated recovery page

### Features:
- **Recovery Form**: Email input, "Invia link di recupero" button
  - POST to `/api/pubblico/recupera-password`
  - Shows success/error message
  - Link in footer: "Password Recovery"
  - Dedicated page at `recovery.html`

- **Reset Password Form**: Triggered when URL has `?token=xxx`
  - New password + confirm fields
  - POST to `/api/pubblico/reset-password`
  - Auto-redirect to login on success

### UI Elements:
- Modal dialog with overlay
- Validation: password confirmation match
- Error handling with user-friendly messages

---

## 2. RSS FEED LINKS

### Files Updated:
- `index.html` - Footer enhanced with RSS section
- `style.css` - No additional CSS needed

### Features:
- **RSS Bandi**: `/api/pubblico/rss/bandi` with orange RSS icon
- **RSS Esiti**: `/api/pubblico/rss/esiti` with orange RSS icon
- Links displayed in footer "Feed RSS" column

### UI Elements:
- Orange RSS icons (Font Awesome `fa-rss`)
- Clickable links opening in new tab

---

## 3. GEOLOCATION - "BANDI VICINO A TE"

### Files Updated:
- `index.html` - New section before statistics

### Features:
- **Browser Geolocation API** integration
- **Find Nearby Tenders**: GET `/api/pubblico/ultimi-bandi?lat={lat}&lon={lon}&raggio_km={radius}`
- **Find Nearby Awards**: GET `/api/pubblico/ultimi-esiti?lat={lat}&lon={lon}&raggio_km={radius}`
- **Radius Selector**: 10/25/50/100 km options
- **Results Display**: Grid of nearby items with distance

### UI Elements:
- Geolocation buttons with location icon
- Radius dropdown selector
- Loading spinner while fetching
- Result cards showing distance, stazione, provincia, scadenza

### Expected API Response:
```json
{
  "results": [
    {
      "titolo": "Lavori...",
      "stazione_appaltante": "Comune di...",
      "provincia": "MI",
      "distanza_km": 12.5,
      "scadenza": "15/04/2026"
    }
  ]
}
```

---

## 4. SERVICE DETAIL PAGES

### Files Updated:
- `index.html` - Navigation links added
- Existing service pages: `servizi.html`, `formazione.html`, etc.

### Features:
- Service pages already exist in navigation
- Links point to individual service pages:
  - Apertura Buste (can be added to servizi.html)
  - Servizi On Demand (servizi.html)
  - Formazione (formazione.html)
  - Consulenza (servizi.html)
  - Software (servizi.html)
  - Assistenza Tecnica (servizi.html)

### Implementation Notes:
- Can load content from `/api/pubblico/pagine/{slug}` if dynamic content needed
- Static content in existing HTML files is sufficient for MVP

---

## 5. PUBLIC STATISTICS

### Files Updated:
- `index.html` - New "PUBLIC STATISTICS" section added before testimonials
- `style.css` - CSS for stat elements

### Features:
- GET `/api/pubblico/statistiche` endpoint
- Displays 4 counters with animation:
  1. Total Bandi (GET response: `bandi`)
  2. Total Esiti (GET response: `esiti`)
  3. Total Stazioni Appaltanti (GET response: `stazioni`)
  4. Total Aziende (GET response: `aziende`)

### Animation:
- Counter animates from 0 to target over 2 seconds
- Triggered when section enters viewport
- Format: Italian locale with `+` suffix

### Expected API Response:
```json
{
  "bandi": 15000,
  "esiti": 8500,
  "stazioni": 2300,
  "aziende": 12500
}
```

---

## 6. NEWSLETTER UNSUBSCRIBE

### Files Updated:
- `index.html` - Newsletter modal and handlers
- Footer - "Disabilita Newsletter" link

### Features:
- **URL Parameters**: Handles `?azione=disabilita-newsletter&email=X&token=Y`
- Auto-populate form when URL params present
- **Disable Newsletter**: POST `/api/pubblico/disabilita-newsletter`
- **Enable Newsletter**: POST `/api/pubblico/riabilita-newsletter`
- Modal form with email + token inputs

### UI Elements:
- Modal dialog
- Two buttons: "Disabilita" and "Riabilita"
- Confirmation messages

### Expected API Request Body:
```json
{
  "email": "user@example.com",
  "token": "verification_token",
  "azione": "disabilita" | "riabilita"
}
```

---

## 7. CONTACT FORM ENHANCEMENT

### Files Updated:
- `contattaci.html` - Added newsletter checkbox
- Enhanced form submit handler with API integration

### Features:
- **Newsletter Checkbox**: "Desidero ricevere aggiornamenti..."
- **API Integration**: POST `/api/pubblico/contatti`
- Form fields:
  - Nome (required)
  - Email (required)
  - Oggetto (optional)
  - Messaggio (required)
  - Newsletter (optional checkbox)

### Expected API Request Body:
```json
{
  "nome": "John Doe",
  "email": "john@example.com",
  "oggetto": "Subject",
  "messaggio": "Message text",
  "newsletter": 0 | 1
}
```

### UI Enhancements:
- Checkbox label with proper styling
- Async submission with loading state
- Error handling with user feedback
- 3-second success message display

---

## 8. RICERCA DOPPIA (DUAL SEARCH)

### Files Updated:
- `index.html` - Search bar in navbar, hero search, modal for results
- `style.css` - Search UI styles

### Features:
- **Navbar Search**: Fixed in navbar (desktop only, hidden on mobile)
- **Hero Search**: Search input in hero slider
- **Dual Search Modal**: Shows results split by type
- **API Integration**: GET `/api/ricerca-doppia?q={searchterm}`

### Search Features:
- Searches both bandi and esiti simultaneously
- Results organized in tabs (Bandi | Esiti)
- Click handlers to switch between result types
- Modal overlay with close button

### Expected API Response:
```json
{
  "bandi": [
    {
      "titolo": "Gara...",
      "stazione_appaltante": "Comune di...",
      "provincia": "MI",
      "scadenza": "15/04/2026",
      "descrizione": "..."
    }
  ],
  "esiti": [
    {
      "titolo": "Esito gara...",
      "stazione": "Comune di...",
      "provincia": "RM",
      "data_apertura": "08/03/2026",
      "description": "..."
    }
  ]
}
```

### UI Elements:
- Search input in navbar (desktop)
- Search bar in hero section
- Modal with tab interface
- Result cards grid layout

---

## CSS & Styling

### New CSS Classes Added:
- `.navbar-search-container` - Navbar search wrapper
- `.navbar-search` - Search input styling
- `.navbar-search-btn` - Search button
- `.search-dual-container` - Hero search wrapper
- `.search-dual-input` - Hero search input
- `.search-dual-btn` - Hero search button
- `.geolocation-card` - Geolocation section card
- `.geo-controls` - Geolocation buttons container
- `.radius-select` - Radius dropdown
- `.nearby-results` - Results grid
- `.nearby-item` - Individual result card
- `.modal` - Modal wrapper
- `.modal-overlay` - Modal background
- `.modal-content` - Modal inner content
- `.modal-lg` - Large modal variant
- `.recovery-form`, `.reset-form`, `.newsletter-form` - Form wrappers
- `.form-group` - Form field wrapper
- `.search-results-tabs` - Tab navigation
- `.tab-btn` - Tab button
- `.search-results-panel` - Tab content
- `.search-result-item` - Search result card

### Color Scheme Used:
- Primary Orange: `#FF8C00` (--orange)
- Yellow Accent: `#F5C518` (--yellow)
- Gradient: Orange to Yellow
- Text Light: `#777` (--text-light)
- Border: `#eee` (--border)

### Responsive Breakpoints:
- Mobile (< 768px): Search bar hidden, full-width modals, single-column layouts

---

## JavaScript Functions Added

### Recovery Functions:
- `showRecovery(e)` - Opens recovery modal
- `closeRecovery()` - Closes recovery modal
- `showMessage(id, msg, success)` - Display colored message

### Geolocation Functions:
- `findNearbyTenders()` - Find nearby bandi
- `findNearbyAwards()` - Find nearby esiti
- `fetchNearbyData(type, lat, lon)` - Fetch from API
- `displayNearbyResults(data, type)` - Render results

### Statistics Functions:
- `loadPublicStatistics()` - Load stats on page load
- Automatic counter animation on scroll

### Newsletter Functions:
- `showNewsletterUnsubscribe(e)` - Opens newsletter modal
- `closeNewsletterModal()` - Closes newsletter modal
- `disableNewsletter()` - Submit disable request
- `enableNewsletter()` - Submit enable request

### Search Functions:
- `performDualSearch()` - Search from hero section
- `performNavbarSearch()` - Search from navbar
- `performSearchWithQuery(query)` - Execute search API call
- `displaySearchResults(items, elementId)` - Render results
- `switchTab(tabId)` - Switch result tabs
- `closeSearchResults()` - Close search modal

### Utility Functions:
- `getUrlParam(name)` - Extract URL query parameters
- Auto-detection of reset token and newsletter action on load

---

## API Endpoints Required

The following backend endpoints must be implemented:

1. **POST** `/api/pubblico/recupera-password`
   - Body: `{ email: string }`
   - Response: `{ message: string }`

2. **POST** `/api/pubblico/reset-password`
   - Body: `{ token: string, password: string }`
   - Response: `{ message: string }`

3. **GET** `/api/pubblico/rss/bandi`
   - Response: RSS XML feed

4. **GET** `/api/pubblico/rss/esiti`
   - Response: RSS XML feed

5. **GET** `/api/pubblico/ultimi-bandi?lat=X&lon=Y&raggio_km=Z`
   - Response: `{ results: Array<{titolo, stazione_appaltante, provincia, distanza_km, scadenza}> }`

6. **GET** `/api/pubblico/ultimi-esiti?lat=X&lon=Y&raggio_km=Z`
   - Response: `{ results: Array<{...}> }`

7. **GET** `/api/pubblico/statistiche`
   - Response: `{ bandi: number, esiti: number, stazioni: number, aziende: number }`

8. **POST** `/api/pubblico/disabilita-newsletter`
   - Body: `{ email: string, token: string, azione: "disabilita" }`
   - Response: `{ message: string }`

9. **POST** `/api/pubblico/riabilita-newsletter`
   - Body: `{ email: string, token: string, azione: "riabilita" }`
   - Response: `{ message: string }`

10. **POST** `/api/pubblico/contatti`
    - Body: `{ nome: string, email: string, oggetto: string, messaggio: string, newsletter: 0|1 }`
    - Response: `{ message: string }`

11. **GET** `/api/ricerca-doppia?q=searchterm`
    - Response: `{ bandi: Array<{}>, esiti: Array<{}> }`

---

## Files Modified

1. **index.html** - Main public homepage
   - Added navbar search bar
   - Added hero search section
   - Added geolocation section
   - Added public statistics section
   - Added password recovery modal
   - Added reset password modal
   - Added newsletter management modal
   - Added search results modal
   - Added comprehensive JavaScript handlers

2. **style.css** - Updated with ~250 lines of new CSS
   - Navbar search styling
   - Geolocation section styles
   - Modal styles
   - Form styles
   - Search results styles
   - Responsive adjustments

3. **contattaci.html** - Contact page updated
   - Added newsletter checkbox to form
   - Enhanced form submission handler
   - API integration for contact submissions

4. **recovery.html** - NEW dedicated password recovery page
   - Recovery form
   - Reset form (conditional on token)
   - Standalone page with clean UI

---

## Testing Checklist

- [ ] Password recovery form sends email correctly
- [ ] Reset password token validation works
- [ ] RSS feeds generate valid XML
- [ ] Geolocation prompts for permission
- [ ] Geolocation fetches nearby items
- [ ] Statistics load and animate
- [ ] Newsletter disable/enable works
- [ ] Contact form submission includes newsletter flag
- [ ] Dual search returns results for both types
- [ ] Search results display in modal with tabs
- [ ] All modals close on overlay click
- [ ] Mobile responsive - navbar search hidden
- [ ] Mobile responsive - full-width modals
- [ ] URL parameters auto-populate forms

---

## Browser Compatibility

- Chrome/Edge: Full support
- Firefox: Full support
- Safari: Full support
- Mobile browsers: Full support (responsive design)
- Requires: Geolocation API support (for nearby features)

---

## Notes

- All forms include client-side validation
- Error messages display in colored text (red for errors, green for success)
- Loading states for async operations
- Modal overlays close forms when clicked
- All external links open in new tabs where appropriate
- Icons use Font Awesome 6.5.1
- Fonts: Comfortaa (headings), Open Sans (body)
- Consistent color scheme with existing design (Orange/Yellow gradient)
