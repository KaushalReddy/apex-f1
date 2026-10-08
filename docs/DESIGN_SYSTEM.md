# APEX F1: Design system (Phase 1)

Direction: dark-first, restrained, technical. One warm accent, flat surfaces separated by hairline
borders, no gradients, no glow, no glassmorphism. Motion is limited to a 220 ms page entrance and
a soft pulse on live status, and both are disabled by `prefers-reduced-motion`.

## Tokens (`apps/web/src/app/globals.css`, `@theme`)

| Group | Tokens |
|---|---|
| Surfaces | `bg` `surface` `surface-2` `surface-3` `line` `line-strong` |
| Text | `fg` `muted` `subtle` |
| Accent | `accent` `accent-strong` `accent-fg` (text on accent) |
| State | `success` `warning` `danger` `info` |
| Data viz | `viz-1`..`viz-6` (categorical); `timing-best` / `timing-personal` / `timing-slower` reserved for lap and sector timing |
| Type | `font-sans`, `font-mono` (system stacks, ADR-013); `eyebrow` utility for small mono labels |
| Shape | radii `sm 4` `md 8` `lg 12`; shadows `shadow-1` (card), `shadow-2` (overlay) |

Contrast (computed, WCAG relative luminance, text tokens against all four surfaces): lowest pair
is `accent` on `surface-3` at 4.77:1; `subtle` is at least 5.19:1; `muted` at least 6.73:1. No pair
is below 4.5:1. Team colours are decorative markers only and never carry text.

## Components

| Folder | Components |
|---|---|
| `components/ui` | `Button`/`ButtonLink`, `Badge`/`DemoBadge`, `StatusDot`, `Panel`, `PageContainer`, `PageHeader`, `SectionHeader`, `InfoTip` (client), `ComingSoon` |
| `components/layout` | `SiteHeader`, `Brand`, `NavLink` (client), `MobileNav` (client), `LiveIndicator`, `SiteFooter` |
| `components/data` | `KeyValueList`, `TeamMarker`, `DriverCard`, `TeamCard`, `CircuitCard`, `CapabilityCard`, `StandingsPlaceholder` |

Rules: server components unless a browser API is needed; no component owns domain data (it comes
from `src/domain`); every "not built yet" state is `ComingSoon`, which never renders fake figures.

## Accessibility conventions
- Skip link, one `<main id="main">`, one `<h1>` per page, no skipped heading levels.
- Distinct `aria-label` per `<nav>`; active link uses `aria-current="page"`.
- Global `:focus-visible` ring on `accent-strong`.
- Mobile menu: button with `aria-expanded`/`aria-controls`, closes on Escape and on navigation.
- Tooltips open on hover and focus and close on Escape.

## Verification
`npm run verify:routes` (also in CI) starts the production server, crawls every internal link and
checks HTML-level basics (lang, title, landmarks, headings, ids, ARIA references, link/button
names, 404 behaviour). It is not a browser test: it cannot check layout, focus order, contrast or
console errors. See the Phase 1 report for what was and was not verified.
