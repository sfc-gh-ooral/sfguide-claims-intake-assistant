# Design: Veltrona Claims Desk

The app is the claims desk of a fictional personal-auto carrier, **Veltrona Mutual**. The same
name appears on every synthetic document (FNOL emails, forms, estimates), so the product and its
paperwork feel like one company. "Veltrona" is a coined name; it is not a real insurer.

## Brand

- **Name:** Veltrona Claims Desk (short: Claims Desk).
- **Audience:** intake specialists, claims adjusters and their team lead. They read documents
  all day, so the brand borrows from the thing they already trust: a marked-up claim file.
- **Logo mark:** a folded page whose corner is a marker stroke, with a check in the fold.

```svg
<svg viewBox="0 0 32 32" aria-hidden="true">
  <rect x="1" y="1" width="30" height="30" rx="8" fill="#0E3B34"/>
  <path d="M10 7h9l5 5v13H10z" fill="#F4F7F6"/>
  <path d="M19 7v5h5" fill="#B9CCC6"/>
  <rect x="12" y="15" width="9" height="3" rx="1.5" fill="#FFD84D"/>
  <path d="M12.5 21.5l2.2 2.1 4.6-4.6" fill="none" stroke="#0E3B34" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
```

- **Voice:** calm, specific, plain. Says what the evidence is and where it came from
  ("Found on page 1 of the repair estimate"), never hypes. AI output is always called a
  *suggestion* and is labeled with the model and time it ran.

## Design direction: "the marked-up file"

Every screen shows the path from paper to decision. Extracted values are shown as marker-yellow
highlights in the source document, and the same yellow marks the field they became.

### Palette (light / dark)

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `canvas` | `#F1F4F5` | `#0A1512` | Page background |
| `surface` | `#FFFFFF` | `#10201C` | Cards, tables, drawers |
| `surface-2` | `#F6F8F8` | `#152A25` | Table headers, insets, inputs |
| `line` | `#DCE3E2` | `#24403A` | Borders and grid lines |
| `ink` | `#0F1E1B` | `#E4EEEB` | Text |
| `ink-2` | `#4B5D59` | `#9DB4AE` | Secondary text (AA on canvas and surface) |
| `spruce` | `#0E3B34` | `#0E3B34` | Pipeline spine (sidebar), logo tile |
| `spruce-2` | `#136B5C` | `#4FC2A9` | Primary buttons, links, series 1, focus |
| `marker` | `#FFD84D` | `#FFD84D` | Extraction highlights, "selected" mark, AI underline |
| `marker-ink` | `#6B5200` | `#FFF4CC` | Text on marker-tinted pills |
| Tier `fast` | `#13795B` | `#4CC79A` | Fast track |
| Tier `std` | `#3D5A99` | `#8EA8E8` | Standard |
| Tier `cx` | `#975406` | `#F0A94B` | Complex |
| Tier `siu` | `#B4235A` | `#F17BA6` | SIU referral, red flags |

Tier colors carry meaning everywhere (lanes, pills, charts, the routing stamp). Pills use the
tier color as text on a 12% tint of itself; `scripts/check-contrast.mjs` checks every pair
against WCAG AA (4.5:1) in both themes.

### Typography

- **Figtree** (UI and headings, 400/500/600/700; headings 700 with -0.02em tracking).
- **JetBrains Mono** for IDs, policy numbers, extracted values and amounts in tables.
- Both are self-hosted through `next/font` at build time (SIL Open Font License). The landing
  page reuses the same woff2 files from `docs/fonts/` with the license. No font CDN.

### Layout model: the pipeline spine

- A 248 px **spruce sidebar** is the navigation *and* a live view of the pipeline. Its four
  destinations are the pipeline stages, each with a live count: **Intake** (documents
  received / needing review), **Claim file** (the claim you are working), **Triage board**
  (claims per lane), **Ask the file**. Under them, a small "pipeline" block shows
  Stage → Directory table → Stream → Task with the last run time.
- The top of the canvas is a 60 px header: page title, claim search, the user/role chip
  ("Avery Lindqvist · Intake lead"), the Sample/Live environment badge and a theme toggle.
- Content uses a 12-column grid, max 1440 px. The claim file is a three-pane workbench:
  document | extracted fields | coverage, AI suggestion and routing.
- Under 1024 px the spine collapses to a top bar with a menu sheet; under 640 px panes stack,
  tables scroll inside their card and drawers become full-height sheets. Nothing scrolls
  sideways at 390 px.

### Density, charts and motion

- Comfortable density: 14 px body, 13 px tables, 40 px rows.
- Charts (Recharts): thin 2 px lines, rounded bar tops, dashed grid in `line`, tooltips and
  legends always on, tier colors as series. A "lane" chart is a stacked horizontal bar per adjuster.
- Motion: 160 ms ease-out on hover and drawers; KPI counters count up once; skeleton shimmer
  while loading; extraction highlights "draw in" left to right when a document opens; AI text
  streams in word by word after staged reasoning steps. Everything honors
  `prefers-reduced-motion`.
- Status pills: Extracted (spruce), Needs review (marker), Queued (neutral).

## Landing page

`docs/index.html` shares the tokens, fonts and logo. The hero is a **marked-up FNOL email**:
a paper card with three marker highlights, each joined by a thin connector to the field chip
it became (policy, loss date, injuries), ending in a stamped tier ("SIU referral"). Headline is
problem-first: "Claim documents arrive as email and paper. Adjusters need a triaged claim."
Below: the four-step flow as a horizontal pipeline strip, captioned screenshots, what runs on
Snowflake, requirements and cost, disclaimer. Dark mode via `prefers-color-scheme`.

## How this pack differs from the catalog

Looked at: Auto Finance Portfolio Analytics, Workforce Intelligence, Wealth Advisor Assistant,
Loss Triangle Analysis, Market Data Discovery (v2), Client Account Views (v2), Governed Context
Layer (v2), Continuous Control Testing (v2).

| Others | Claims Desk avoids it by |
| --- | --- |
| Top bar with tabs (Client Account Views, Governed Context Layer, Continuous Control Testing) | A sidebar that doubles as a live pipeline view |
| Icon rail plus docked agent (Market Data Discovery) | Full labeled spine; Q&A is its own screen scoped to one claim |
| Navy/lime (Auto Finance), violet rail (Workforce), purple (Loss Triangles), graphite/saffron, graphite/lime, paper/vermilion, glacier/harbor blue | Spruce green with marker yellow on a cool grey canvas |
| IBM Plex (Control Testing), Space Grotesk (Client Account Views), serif hero (Auto Finance) | Figtree + JetBrains Mono |
| Hero with a floating screenshot, typographic counter, or ledger strips | A marked-up document hero with connectors to extracted fields |
