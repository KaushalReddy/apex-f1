# APEX F1: Design system

Direction: a precise, technical, restrained motorsport engineering environment. Dark-first. Flat surfaces separated by hairline borders and
tone (not shadows or glows). Red is a signal, not decoration. Everything here is original: no series, team or sponsor branding is imitated.

## Colour (`apps/web/src/app/globals.css`, `@theme`)
| Role | Token | Value | Notes |
|---|---|---|---|
| Page | `bg` | `#090b0e` | |
| Panel / hover / elevated | `surface` / `surface-2` / `surface-3` | `#14181e` / `#1b2028` / `#252b34` | elevation is tone, not shadow |
| Separators | `line` / `line-strong` | `#242a33` / `#394150` | `line-strong` for interactive outlines |
| Text | `fg` / `muted` / `subtle` | `#f3f5f7` / `#929ba8` / `#8a94a2` | all >= 4.5:1 on every surface (tested) |
| Brand red, fill | `accent` | `#f04444` | buttons and indicators; text on it is dark (white would be 3.7:1) |
| Brand red, text/hover | `accent-strong` | `#ff6b63` | >= 5.1:1 on every surface |
| Status | `success` `warning` `danger` `info` | | always paired with words; `danger` is deliberately not the brand red |
| Data viz | `viz-1..6`, `timing-*` | | reserved for telemetry phases |

Use red for: the active route, the one primary action per view, selected/focused state, key data and genuine alerts. Not for every
border, heading or card. `src/app/design-tokens.test.ts` reads the real stylesheet and fails if a text token drops below 4.5:1 on any surface.

## Typography
- **Inter** (variable, latin subset): all interface text and numerals. Use `tabular-nums` wherever figures align (lap times, positions, timestamps, tables).
- **Barlow Condensed SemiBold**: wordmark, page titles, section titles and large metrics only (`font-display`).
- Micro-labels (`eyebrow`): Inter 600, 12 px, uppercase, wide tracking. Uppercase is limited to micro-labels and badges.
- Both fonts are self-hosted with `next/font/local` (`src/fonts`, SIL OFL, licences included): no network at build or run time, no new npm dependency,
  about 68 KB of woff2 on the first page. Characters outside the latin subset fall back to the system stack.

## Graphic language
One recurring device: a short red tick (`SectionMarker`) before a micro-label. Fine 1 px separators, indexed rows (01, 02, ...) for lists of
capabilities and tools, compact status badges. No gradients, glows, textures or racing stripes. The wordmark is Barlow Condensed with a red "F1";
the mark is an apex with a racing-line arc.

## Components (`src/components`)
| Folder | Components |
|---|---|
| `ui` | `Button`/`ButtonLink` (md 44 px, sm 36 px; primary is the only red fill), `Badge`/`DemoBadge`, `StatusDot`, `Panel` (static, never hover-styled), `PageHeader`, `SectionHeader`/`SectionMarker`, `EmptyState`, `ComingSoon`, `InfoTip`, `CardArrow` + `CARD_LINK` |
| `layout` | `SiteHeader`, `Brand`, `NavLink`, `MobileNav`, `LiveIndicator`, `SiteFooter` |
| `data` | `KeyValueList`, `TeamMarker`, `DriverCard`, `TeamCard`, `CircuitCard`, `CapabilityCard` (indexed row) |

Interactive vs static: anything clickable is a real link or button, shows the pointer cursor, has hover and visible `:focus-visible` states and (for cards)
an arrow affordance. Static panels have none of these. Controls are never styled as interactive without an action.

## Navigation
Primary: Live, Drivers, Teams, Cars, Circuits, Standings. Secondary: Analysis, Replay, Telemetry, Strategy, Race Engineer. All are `next/link`.
`ANALYSIS_HUB` (`/analysis`) is a real index page of the tools. It was previously a bare `<span>` label in the secondary row: it looked like a nav item
but, being text, rightly showed no pointer, and nothing happened on click. The active route gets an animated red indicator plus `aria-current="page"`.
`src/domain/navigation.test.ts` checks that every link has a page (no dead links) and that active matching never confuses prefix siblings.

## Data states
- **Loading:** skeleton or status text only while a request is genuinely in flight (`loading.tsx`, replay page).
- **Empty / unavailable / unfinished:** `EmptyState` or `ComingSoon` with a plain-language reason and a next step. No placeholder rows. Standings, the season
  panels and the replay page use these. Nothing is invented: no positions, points or times appear without a data source.
- **Error:** `role="alert"`, what failed, what to check, and a retry where one is possible.
- **Static preview:** content from `domain/demo.ts` is always marked with `DemoBadge`.

## Motion
Tokens: `--duration-fast` 120 ms (hover, press, tooltip, menu), `--duration-base` 200 ms (page entrance, nav indicator), `--duration-slow` 320 ms (reserved),
easing `--ease-apex` (`cubic-bezier(0.22, 1, 0.36, 1)`). Utilities: `motion-interactive`, `page-in`, `pop-in`. In use: a 200 ms fade-and-rise on page change,
hover/active colour and border transitions, a 1 px press on buttons, a sliding active-route indicator, a quick pop for the mobile menu and tooltips, and a nudge on
the card arrow. No count-ups, parallax, scaling or continuous animation on static content. `prefers-reduced-motion` collapses all of it. State is never conveyed by
motion alone. Circuit rendering has its own, separate motion (none).

## Accessibility
Skip link, one `main`, labelled `nav`s, one `h1` per page with no skipped levels, `aria-current`, `:focus-visible` ring, 44 px touch targets for the menu button, mobile
links and primary buttons, table `caption`/`scope`, `aria-valuetext` on the replay slider, status badges that carry words. Checked: `npm run verify:routes` (HTML-level
rules), axe-core in jsdom (structure/ARIA only; 0 violations on 17 pages) and the contrast tests. Not checked without a browser: rendered focus order, layout at real viewport
widths, real contrast of anti-aliased text.
