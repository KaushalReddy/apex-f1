# Self-hosted fonts

Loaded with `next/font/local` in `app/layout.tsx`; no network request at build or run time and no npm dependency.

| File | Family | Use | Licence |
|---|---|---|---|
| `Inter-latin-variable.woff2` | Inter (variable, latin subset) | interface text, numerals (`tabular-nums`) | SIL OFL 1.1, see `LICENSE-Inter.txt` |
| `BarlowCondensed-latin-600.woff2` | Barlow Condensed SemiBold (latin subset) | wordmark, page and section titles, large metrics | SIL OFL 1.1, see `LICENSE-BarlowCondensed.txt` |

Source: the `@fontsource-variable/inter` and `@fontsource/barlow-condensed` npm packages (v5.3.0), which redistribute the upstream OFL fonts.
Characters outside the latin subset fall back to the system stack.
