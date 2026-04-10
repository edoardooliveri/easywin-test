# EasyWin Public Website - Quick Reference

## Where to Find Each Feature

### 1. Password Recovery
- **Main page**: Footer link "Password Recovery"
- **Dedicated page**: `recovery.html`
- **Modal trigger**: Click "Recupera Password" in navbar or footer
- **Reset flow**: When URL has `?token=xxx` parameter

### 2. RSS Feeds
- **Location**: Footer "Feed RSS" column
- **Icons**: Orange RSS icons (Font Awesome)
- **URLs**:
  - RSS Bandi: `/api/pubblico/rss/bandi`
  - RSS Esiti: `/api/pubblico/rss/esiti`

### 3. Geolocation - Bandi Vicino a Te
- **Location**: Homepage, section between values cards and testimonials
- **Buttons**:
  - "Trova Bandi Vicini" - searches for nearby tenders
  - "Trova Esiti Vicini" - searches for nearby awards
- **Radius**: Dropdown selector (10/25/50/100 km, default 25 km)
- **Result display**: Grid of cards with distance, stazione, provincia

### 4. Service Pages
- **Navigation**: Navbar links to service pages
- **Existing pages**: servizi.html, formazione.html, contattaci.html
- **Can add**: Individual pages for each service (currently in servizi.html)

### 5. Public Statistics
- **Location**: Homepage, NEW section with 4 counters
- **Counters**:
  - Bandi Pubblici
  - Esiti di Gara
  - Stazioni Appaltanti
  - Aziende Partecipanti
- **Animation**: Counts up to target when section enters viewport
- **Data source**: GET `/api/pubblico/statistiche`

### 6. Newsletter Unsubscribe
- **Location**: Footer "Feed RSS" column link "Disabilita Newsletter"
- **Modal**: Opens when clicked
- **URL parameters**: `?azione=disabilita-newsletter&email=X&token=Y`
- **Functions**:
  - Disabilita (disable subscription)
  - Riabilita (re-enable subscription)

### 7. Contact Form Enhancement
- **Location**: `contattaci.html` page
- **New field**: Newsletter checkbox
- **Label**: "Desidero ricevere aggiornamenti, offerte speciali e newsletter da easyWin"
- **API**: POST `/api/pubblico/contatti` with newsletter flag

### 8. Ricerca Doppia (Dual Search)
- **Navbar search**: Fixed search bar (desktop only, hidden on mobile)
- **Hero search**: Search input in hero slider
- **Modal results**: Shows bandi and esiti in tabs
- **API**: GET `/api/ricerca-doppia?q={searchterm}`

---

## Quick Links to Key Sections

| Feature | File | Element | Line |
|---------|------|---------|------|
| Password Recovery Modal | index.html | `<div id="recovery-modal">` | ~530 |
| Reset Password Modal | index.html | `<div id="reset-modal">` | ~549 |
| Newsletter Modal | index.html | `<div id="newsletter-modal">` | ~568 |
| Search Results Modal | index.html | `<div id="search-results-modal">` | ~590 |
| Geolocation Section | index.html | `<!-- BANDI VICINO A TE -->` | ~282 |
| Public Statistics | index.html | `<!-- PUBLIC STATISTICS -->` | ~305 |
| Feature Functions | index.html | `// FEATURE 1-8` (Script section) | ~610-950 |
| Navbar Search | index.html | `.navbar-search-container` | ~18 |
| Hero Search | index.html | `.search-dual-container` | ~44 |
| Contact Form Newsletter | contattaci.html | Newsletter checkbox | ~95 |
| CSS Styles | style.css | New features section | ~1530-1620 |

---

## JavaScript Function Reference

### Recovery Functions
```javascript
showRecovery(e)              // Open recovery modal
closeRecovery()              // Close recovery modal
showReset(e)                 // Open reset modal (auto on token)
closeReset()                 // Close reset modal
showMessage(id, msg, success) // Display colored status message
```

### Geolocation Functions
```javascript
findNearbyTenders()          // Find nearby bandi with geolocation
findNearbyAwards()           // Find nearby esiti with geolocation
fetchNearbyData(type, lat, lon) // API call to fetch nearby data
displayNearbyResults(data, type) // Render results in grid
```

### Statistics Functions
```javascript
loadPublicStatistics()       // Load and display stats on page load
// Counter animation happens automatically
```

### Newsletter Functions
```javascript
showNewsletterUnsubscribe(e) // Open newsletter modal
closeNewsletterModal()       // Close newsletter modal
disableNewsletter()          // Call disable API
enableNewsletter()           // Call enable API
```

### Search Functions
```javascript
performDualSearch()          // Search from hero section
performNavbarSearch()        // Search from navbar
performSearchWithQuery(q)    // Execute search API call
displaySearchResults(items, elementId) // Render results
switchTab(tabId)             // Switch between Bandi/Esiti tabs
closeSearchResults()         // Close search modal
```

### Utility Functions
```javascript
getUrlParam(name)            // Extract URL query parameter
// Auto-detection on load:
// - Check for token parameter → show reset modal
// - Check for azione=disabilita-newsletter → show newsletter modal
```

---

## CSS Classes Reference

### Navigation
- `.navbar-search-container` - Search wrapper in navbar
- `.navbar-search` - Search input field
- `.navbar-search-btn` - Search button

### Hero Section
- `.search-dual-container` - Search wrapper in hero
- `.search-dual-input` - Hero search input
- `.search-dual-btn` - Hero search button

### Geolocation
- `.geolocation-card` - Container card
- `.geo-controls` - Button/select wrapper
- `.radius-select` - Radius dropdown
- `.nearby-results` - Results grid wrapper
- `.nearby-item` - Individual result card

### Modals
- `.modal` - Modal container
- `.modal-overlay` - Dark background
- `.modal-content` - Inner content
- `.modal-lg` - Large variant
- `.modal-close` - Close button

### Forms
- `.recovery-form` - Recovery form wrapper
- `.reset-form` - Reset form wrapper
- `.newsletter-form` - Newsletter form wrapper
- `.form-group` - Field container

### Search Results
- `.search-results-tabs` - Tab navigation
- `.tab-btn` - Tab button
- `.tab-btn.active` - Active tab style
- `.search-results-panel` - Tab content
- `.search-result-item` - Result card

---

## API Integration Checklist

When implementing backend endpoints, ensure:

### Password Recovery
- [ ] Email validation and existence check
- [ ] Generate unique recovery token
- [ ] Send email with recovery link (include token)
- [ ] Token expiration (24-48 hours recommended)

### Reset Password
- [ ] Validate token format and expiration
- [ ] Hash new password with bcrypt/argon2
- [ ] Invalidate all other tokens for user
- [ ] Log security event

### RSS Feeds
- [ ] Valid RSS 2.0 XML format
- [ ] Include title, link, pubDate, description
- [ ] Paginate results (limit 50 items)
- [ ] Set proper Content-Type header

### Geolocation Search
- [ ] Index coordinates for fast lookup
- [ ] Calculate distance using haversine formula
- [ ] Return sorted by distance ascending
- [ ] Include all required fields in response

### Statistics
- [ ] Cache results (update hourly)
- [ ] Handle zero results gracefully
- [ ] Use COUNT(*) queries efficiently

### Newsletter
- [ ] Validate email format
- [ ] Check token validity
- [ ] Update subscription status in DB
- [ ] Send confirmation email on change

### Contact Form
- [ ] Validate all inputs
- [ ] Store in database
- [ ] Send confirmation to user
- [ ] Notify admin/sales team
- [ ] Handle newsletter flag

### Dual Search
- [ ] Index both tables for fast search
- [ ] Support partial/fuzzy matching
- [ ] Sort by relevance + date
- [ ] Return max 20 results per type

---

## Testing Scenarios

### Password Recovery
1. [x] Enter valid email → should show success
2. [x] Enter invalid email → should show error
3. [x] Click recovery link in email → reset form appears
4. [x] Invalid token → error message
5. [x] Token expired → error message

### Geolocation
1. [x] Allow location → results appear
2. [x] Deny location → error message
3. [x] Change radius → refetch with new radius
4. [x] No results → "no results" message

### Statistics
1. [x] Load page → counters animate from 0
2. [x] Scroll to section → animation plays
3. [x] API error → display 0 or cached values

### Newsletter
1. [x] Click disable → API called with correct params
2. [x] Invalid token → error message
3. [x] URL params pre-fill → email/token auto-populated

### Search
1. [x] Hero search → modal opens with results
2. [x] Navbar search → modal opens with results
3. [x] Switch tabs → shows bandi then esiti
4. [x] No results → "no results" message

---

## Browser Support

- Chrome/Chromium: ✓ Full support
- Firefox: ✓ Full support
- Safari: ✓ Full support
- Edge: ✓ Full support
- Mobile Chrome: ✓ Full support (responsive)
- Mobile Safari: ✓ Full support (responsive)

### Specific Features:
- Geolocation API: Chrome, Firefox, Safari, Edge (requires HTTPS in production)
- LocalStorage: All modern browsers
- Fetch API: All modern browsers
- CSS Grid/Flexbox: All modern browsers

---

## Mobile Considerations

### Hidden on Mobile
- Navbar search bar (use hero search instead)

### Responsive Adjustments
- Modals: Full width with padding
- Grids: Single column on mobile
- Buttons: Full width in modals
- Search results: Stack vertically

### Touch-Friendly
- Button sizes: min 44x44px (met)
- Input sizes: min 44px height (met)
- Spacing: 12-16px minimum
- Modal close button: Easy to tap

---

## Performance Notes

- Search results limited to 20 items per type
- Statistics cached (update hourly)
- Geolocation results capped at 50
- Modal content not pre-rendered (loaded on demand)
- CSS uses standard properties (no custom properties needed)
- JavaScript: ~400 lines, unminified

---

## Security Considerations

- [ ] All API endpoints use HTTPS
- [ ] Password recovery tokens are cryptographically secure
- [ ] Tokens are single-use and time-limited
- [ ] Newsletter tokens require validation
- [ ] Form inputs sanitized server-side
- [ ] Rate limiting on password recovery
- [ ] CORS headers properly configured
- [ ] No sensitive data in URL (except recovery token)

---

## Maintenance & Updates

### Updating Statistics
- Edit API response in backend
- Counter animation auto-triggers

### Adding Service Pages
- Create new HTML files
- Link from `servizi.html` or navbar
- Use consistent styling

### Modifying Search Behavior
- Edit `performSearchWithQuery()` function
- Adjust API parameters in fetch call
- Customize result display in `displaySearchResults()`

### Customizing Geolocation Radius
- Edit default in HTML: `value="25"` in select
- Options in: 10, 25, 50, 100 km

---

## Troubleshooting

### Modals not appearing
- Check `display:none` is being toggled to `display:flex`
- Verify modal-overlay click handler exists

### Geolocation not working
- Check browser permissions
- Verify HTTPS in production
- Check browser console for errors

### Statistics not loading
- Check API endpoint response format
- Verify network tab shows 200 response
- Check console for JavaScript errors

### Search results blank
- Verify API response includes `bandi` and `esiti` arrays
- Check result field names match expected in `displaySearchResults()`

---

## Future Enhancements

Potential additions:
- Save searches as favorites
- Email notification preferences
- Advanced filter options for geolocation
- Search history
- Bookmarking tenders
- Export search results to PDF
- Integration with calendar for deadlines
