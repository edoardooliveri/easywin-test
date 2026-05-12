# easyWin Admin — Design System

Definizione condivisa di palette, tipografia, componenti e
comportamenti per il gestionale (`admin/*.html`). Questo documento è
il **contratto grafico**: ogni prompt di redesign lo include come
riferimento, così tutte le pagine convergono a uno stile coerente.

Aggiornato: 2026-05-12.

---

## 1. Posizionamento

L'admin è uno strumento di lavoro denso, professionale, usato ogni
giorno da operatori interni (1-2 ore di sessione). Priorità:
**leggibilità a colpo d'occhio**, **densità informativa controllata**,
**zero distrazioni**. Niente "marketing" — quello sta nel cliente.

---

## 2. Palette

Dark theme coerente col portale clienti, ma con accent **teal/blu**
invece del giallo, così l'operatore percepisce subito "sono in modalità
gestionale".

| Token | Valore | Uso |
|---|---|---|
| `--bg`            | `#0F1A23` | sfondo pagina principale |
| `--surface`       | `#1E2D3D` | card, modal, sidebar |
| `--surface-2`     | `#243749` | inner card, tabella header |
| `--surface-3`     | `#2D4459` | hover su row, divider attivi |
| `--border`        | `rgba(255,255,255,0.10)` | bordi standard |
| `--border-strong` | `rgba(255,255,255,0.18)` | bordi card, input focus |
| `--text`          | `rgba(255,255,255,0.92)` | testo principale |
| `--text-muted`    | `rgba(255,255,255,0.62)` | label, hint |
| `--text-dim`      | `rgba(255,255,255,0.40)` | placeholder, disabled |
| `--accent`        | `#3DD4D7` | brand teal (CTA, link attivi, focus ring) |
| `--accent-hover`  | `#5AE5E8` | hover su accent |
| `--accent-soft`   | `rgba(61,212,215,0.14)` | bg pill/tag selezionato |
| `--success`       | `#22C55E` | esiti positivi, vincitrice |
| `--warning`       | `#F59E0B` | scadenze, in lavorazione |
| `--danger`        | `#EF4444` | errori, esclusi, anomali |
| `--info`          | `#3B82F6` | classificate, neutrali |

Niente bianco puro come background. Niente azzurro Bootstrap. Niente
ombre nere pure → preferire `rgba(0,0,0,0.35)`.

---

## 3. Tipografia

| Token | Valore | Uso |
|---|---|---|
| `--font-head` | `'Comfortaa', system-ui, sans-serif` | titoli pagina/sezione, KPI |
| `--font-body` | `'Inter', system-ui, sans-serif` | testo, tabelle, form |
| `--font-mono` | `'JetBrains Mono', ui-monospace, monospace` | CIG, CUP, P.IVA, codici SOA |

Scala (rem):

| Token | rem | px (16) | Uso |
|---|---|---|---|
| `--text-xs`  | 0.75 | 12 | label, badge, hint |
| `--text-sm`  | 0.875 | 14 | body table, form input |
| `--text-base`| 1.0  | 16 | body default |
| `--text-md`  | 1.125 | 18 | sottotitoli card |
| `--text-lg`  | 1.375 | 22 | titoli sezione |
| `--text-xl`  | 1.75  | 28 | titoli pagina |
| `--text-2xl` | 2.25  | 36 | KPI number |

Line-height 1.5 standard, 1.25 sui titoli.

---

## 4. Spaziatura, radius, ombre

| Token | Valore |
|---|---|
| `--sp-1`  | 4px  |
| `--sp-2`  | 8px  |
| `--sp-3`  | 12px |
| `--sp-4`  | 16px |
| `--sp-5`  | 20px |
| `--sp-6`  | 24px |
| `--sp-8`  | 32px |
| `--sp-10` | 40px |
| `--radius-sm` | 8px  | input, button piccolo |
| `--radius-md` | 12px | card piccola, badge ampio |
| `--radius-lg` | 16px | card principale |
| `--radius-pill` | 9999px | tag, pill, button CTA |
| `--shadow-sm` | `0 1px 2px rgba(0,0,0,0.20)` | row hover |
| `--shadow-md` | `0 4px 12px rgba(0,0,0,0.30)` | card sollevata |
| `--shadow-lg` | `0 12px 40px rgba(0,0,0,0.45)` | modal, dropdown |

---

## 5. Componenti chiave

### Card
- `background: var(--surface)`, `border: 1px solid var(--border)`, `border-radius: var(--radius-lg)`, `padding: var(--sp-5)`
- Header card: bottom border `var(--border)`, padding bottom `var(--sp-3)`, titolo `var(--text-md)` font-head
- Footer card (azioni): top border, padding top `var(--sp-3)`

### Button
- **Primary** (CTA): `background: var(--accent)`, `color: #0F1A23`, `font-weight: 600`, `border-radius: var(--radius-pill)`, padding `10px 22px`
- **Secondary**: trasparente, `border: 1px solid var(--border-strong)`, hover `background: var(--surface-2)`
- **Danger**: `background: var(--danger)`, color white, stesso shape primary
- **Icon-only**: 32×32, radius md, hover surface-2
- Dimensioni: `--btn-h-sm: 28px`, `--btn-h: 36px`, `--btn-h-lg: 44px`

### Input / Select / Textarea
- `background: var(--surface-2)`, `border: 1px solid var(--border)`, `border-radius: var(--radius-md)`
- Padding `10px 14px`
- Focus: `border-color: var(--accent)`, `box-shadow: 0 0 0 3px rgba(61,212,215,0.20)`
- Disabled: opacity 0.5
- Multi-select (filtri Bandi/Esiti già implementati): Tom-Select con tema dark — vedi `clienti/index.html` per i CSS override (le stesse classi possono essere riusate).

### Tabella
- Header: `background: var(--surface-2)`, `text-transform: uppercase`, `font-size: var(--text-xs)`, `letter-spacing: 0.5px`, `color: var(--text-muted)`, `font-weight: 600`
- Row hover: `background: var(--surface-3)`
- Cell padding `10px 14px`
- Bordo bottom row: `1px solid var(--border)`
- Numeri tabulari: usare `font-variant-numeric: tabular-nums`

### KPI card
- Grande numero `var(--text-2xl) font-head color: var(--text)`
- Label sopra `var(--text-xs) uppercase var(--text-muted)`
- Eventuale variazione: pill verde/rossa accanto, `+12%` / `-3%`

### Badge / Tag
- Pill rounded, `padding: 3px 12px`, `font-size: var(--text-xs)`, `font-weight: 600`
- Varianti: success (verde), warning (giallo), danger (rosso), info (blu), neutral (surface-3 con border)

### Navigation
- Sidebar laterale sticky a sinistra (240-260px), oppure top nav (preferibile per admin denso)
- Active state: `background: var(--accent-soft)`, `color: var(--accent)`, left border 3px accent
- Hover: `background: var(--surface-2)`

### Form layout
- Label: sopra l'input, `var(--text-xs)`, `color: var(--text-muted)`, margin bottom 6px
- Group spacing: `gap: var(--sp-4)` tra campi
- Grid 2/3/4 colonne responsive (auto-fill min 220px)

### Empty state
- Icona FontAwesome grande (48-64px) `color: var(--text-dim)` `opacity: 0.4`
- Titolo `var(--text-md) font-head color: var(--text-muted)`
- Hint description `var(--text-sm) color: var(--text-dim)`
- CTA primary se applicabile

### Modal / Dialog
- Overlay `background: rgba(15,26,35,0.72)`, `backdrop-filter: blur(4px)`
- Box `background: var(--surface)`, `border-radius: var(--radius-lg)`, `box-shadow: var(--shadow-lg)`, max-width 640px
- Header con close icon top-right

---

## 6. Motion

- Transizioni standard: `transition: background 150ms ease, border-color 150ms ease, transform 120ms ease`
- Hover button: `transform: translateY(-1px)`
- Drawer/modal: fade-in 150ms + scale 0.98→1
- **Niente animazioni complesse** — admin deve essere veloce.

---

## 7. Iconografia

- **Font Awesome 6** è già caricato. Usarla per tutte le icone.
- Size standard: 14px (inline), 16px (button), 20px (header), 48-64px (empty state).
- Color: ereditato dal parent (`color: inherit`), oppure `var(--text-muted)` per icone decorative.

---

## 8. Densità

Admin > Cliente in termini di densità informativa:
- Row height tabella: 36-44px (non 56-64 come cliente)
- Card padding: `var(--sp-4)` (cliente usa `var(--sp-5/6)`)
- Font body: `var(--text-sm)` di default in tabelle e form

---

## 9. Accessibilità

- Contrast minimo 4.5:1 per testo body
- Focus ring sempre visibile (3px accent-soft)
- Aria-label sui button icon-only
- Touch target minimo 32×32 (per tablet)

---

## 10. CSS Variables ready-to-use

Inserire all'inizio di ogni pagina admin (o globalmente in
`admin/admin.css`):

```css
:root {
  --bg:            #0F1A23;
  --surface:       #1E2D3D;
  --surface-2:     #243749;
  --surface-3:     #2D4459;
  --border:        rgba(255,255,255,0.10);
  --border-strong: rgba(255,255,255,0.18);
  --text:          rgba(255,255,255,0.92);
  --text-muted:    rgba(255,255,255,0.62);
  --text-dim:      rgba(255,255,255,0.40);
  --accent:        #3DD4D7;
  --accent-hover:  #5AE5E8;
  --accent-soft:   rgba(61,212,215,0.14);
  --success: #22C55E; --warning: #F59E0B; --danger: #EF4444; --info: #3B82F6;

  --font-head: 'Comfortaa', system-ui, sans-serif;
  --font-body: 'Inter', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, monospace;

  --text-xs:.75rem; --text-sm:.875rem; --text-base:1rem;
  --text-md:1.125rem; --text-lg:1.375rem; --text-xl:1.75rem; --text-2xl:2.25rem;

  --sp-1:4px; --sp-2:8px; --sp-3:12px; --sp-4:16px; --sp-5:20px;
  --sp-6:24px; --sp-8:32px; --sp-10:40px;

  --radius-sm:8px; --radius-md:12px; --radius-lg:16px; --radius-pill:9999px;
  --shadow-sm:0 1px 2px rgba(0,0,0,.20);
  --shadow-md:0 4px 12px rgba(0,0,0,.30);
  --shadow-lg:0 12px 40px rgba(0,0,0,.45);
}

body {
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-body);
  font-size: var(--text-base);
  line-height: 1.5;
}
```

---

## 11. Cosa NON cambiare (regole invarianti per il redesign)

- **ID e classi referenziati dal JS**: mai rinominare. Il JS si aspetta
  `#stazioniBody`, `#filtroProvincia`, ecc. Mantenere ESATTAMENTE.
- **Attributi `onclick` e handlers**: lasciare invariati.
- **Struttura del routing** (`data-section`, `data-subpage`, chiamate
  `Router.navigate()`, `selectSubPage()`): non modificare.
- **Endpoint API**: i fetch verso `/api/admin/...` non si toccano.
- **Form input `name` attributes**: il backend si aspetta determinati
  nomi nei body POST. Non modificare.
- **Tabelle dei dati**: gli `<thead>` possono cambiare in stile, ma
  l'ordine delle colonne deve essere coerente col `<tbody>` popolato
  da JS (le row sono iniettate con `innerHTML` posizionale).
