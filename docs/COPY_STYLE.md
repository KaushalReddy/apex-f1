# APEX F1: Copy style

How APEX F1 sounds, so new text matches what is already there.

## Voice
- **Confident, precise, motorsport-native.** Write like a race engineer briefing a fan who watches the gaps, not just the order.
- **Specific over grand.** "Two fastest laps, trace against trace" beats "unlock powerful insights". If a sentence would fit any app, rewrite it.
- **Short.** Lead with the point; one idea per sentence. Page descriptions stay under about 35 words.
- **Honest about data.** Say what the data is (published, calculated, simulated, AI) at the point of use. Never claim live, official or
  exact when it is not. OpenF1 is "an unofficial community API"; its data originates from Formula 1 timing.

## Never in the product
- Development stages, phases, roadmap numbers or "coming in vX".
- Build or tooling language: "in this build", "exported", "dataset", "snapshot", tool paths (`tools/...`), environment variables, file
  names. Operator instructions live in the docs and READMEs, not on pages.
- Invented statistics, achievements or claims. Marketing superlatives ("ultimate", "revolutionary"), exclamation marks.

## Terms
| Use | Not |
|---|---|
| Grand Prix (plural Grands Prix), race, session, Qualifying, Practice 1 | GP in running text |
| running order, gap, interval, pit stop, stint, tyre (British spelling), degradation | position list, tire |
| Safety Car, Virtual Safety Car (VSC), red flag, race control | |
| recorded / published (from OpenF1), calculated (ours), simulation (what-if), AI (engineer) | real-time unless it is |
| recorded by OpenF1 at ... (source time) vs received / synced ... ago (APEX F1 retrieval time) | "updated" for either |
| driver codes (VER, NOR) in dense UI; full names in headings and profiles | mixed in one list |

## Mechanics
- **Capitalisation:** sentence case for headings, buttons and labels ("Compare drivers", "Watch the latest race"). Product areas are
  proper nouns: Race Replay, Telemetry Lab, Car Lab, Race Engineer, Strategy.
- **Buttons say what happens:** "Replay the race", "Tyre strategy", "Explore the circuits". Not "Learn more" or "Click here".
- **Empty and error states:** say what is missing and what still works, in one or two sentences ("Nothing is shown rather than
  invented" where a guess would be tempting). Errors name the problem and the recovery.
- **Numbers:** lap times `1:36.784`; gaps `+1.234`; positions `P4`; units with a space (`5.513 km`, `42 °C`); en dash for ranges
  (`2024–2026`, `laps 1–32`); ` · ` as the separator in compact metadata.
- **Punctuation:** no exclamation marks; colons over dashes for "here is what"; typographic apostrophes in prose.
