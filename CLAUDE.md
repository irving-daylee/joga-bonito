# Joga Bonito

Futsal team management app voor zaalvoetbalteam Joga Bonito (Almere). Eigenaar: Irving Liesdek.

## Architectuur

Single-file HTML app (`index.html`, ~2600 regels). Alle CSS + JS inline, geen build step, geen framework. Draait op `python3 -m http.server 8777` via `.claude/launch.json`.

**Data**: localStorage key `jogaBonito_v2`. Geen backend/database. Alle state zit in het globale `DB` object (geladen bij start, gesaved na elke mutatie).

**Structuur van index.html**:
- Regels 1–1065: HTML + CSS (brand guide in commentaar bovenaan CSS)
- Regels 1067–1115: Data layer (DEFAULT_PLAYERS, load/save, helpers)
- Regels 1116–1127: Avatar + Power Play icon helpers
- Regels 1129–1180: Timer systeem (countdown 2x20 min)
- Regels 1182–1250: Navigation, modals, toasts, phase overlay
- Regels 1257–1420: Team page (spelers CRUD, foto-upload)
- Regels 1423–1784: Match flow (setup → squad → lineup → live play)
- Regels 1785–1903: Goal systeem (modal, save, celebration overlay)
- Regels 1905–1980: Event editing (timeline click-to-edit)
- Regels 1982–2070: Cards + MOTM + match finish
- Regels 2075–2270: Match detail + Stats page
- Regels 2271–2350: Schedule page (programma + wedstrijd toevoegen)
- Regels 2351–2600: Retroactive match entry (achteraf invoeren)
- Regels 2607–2627: Helpers + init

## Brand guide

| Element | Waarde |
|---|---|
| Logo font | Pirata One (title case, nooit all-caps) |
| Headings | Montserrat 600–800 |
| Body | Nunito 400–700 |
| Primary | `#1B2A4A` (navy) |
| Secondary | `#2C3E6B` (navy-light) |
| Surface | `#FFFFFF` |
| Background | `#F0F2F5` |
| Cards | Groen `#10B981` (2 min), Geel `#F59E0B` (5 min), Rood `#EF4444` (uit) |

Gradient header: `linear-gradient(135deg, navy, navy-light)`. Goal-knop gebruikt navy-light. Altijd witte achtergrond voor visuals.

## Futsal-specifiek

- **Speeltijd**: 2x 20 minuten, countdown timer
- **Kaarten**: Groen (2 min straf), Geel (5 min straf), Rood (uitsluiting) — Almere-regels
- **Power Play**: Keeper eruit, extra veldspeler (5v4 zonder keeper)
- **Eigen goal**: Telt voor het thuisteam (`scoreHome++`), geen speler-selectie
- **Opstelling**: 1 keeper + 4 veldspelers (futsal = 5v5)

## Match flow (state machine)

`setup` → `squad` → `lineup` → `half1` → `halftime` → `half2` → `fulltime` → `motm` → `finished`

Timer start NIET automatisch — gebruiker drukt zelf op play.

## Spelers (pre-loaded)

Marco (#1, keeper), Irving (#7, aanvoerder), Lyzairo (#8), Rayvano (#9), Bobby (#10), Gregory (#11), Lawin (#20), Erfan (#12, keeper), Kenneth (#14), Said (#24), Amine (#59), Fouad (#99).

Foto's worden opgeslagen als base64 JPEG (200x200 crop) in het player object.

## Key patterns

- **Modals**: `openModal(html)` zet innerHTML van `#modalContent`. Enkele modal tegelijk.
- **Toast**: `showToast(text, undoFn)` — 3 sec zichtbaar, fade-out, optionele undo-knop.
- **Goal celebration**: Fullscreen overlay bij thuisgoals (niet bij eigen goals/tegengoals), auto-dismiss na 2.5s.
- **Timeline events**: `{ type, minute, half, team, ... }`. Bij retroactieve invoer is `minute: null` → toont "–" in timeline, wordt overgeslagen in fase-analyse.
- **retroState**: Tijdelijke state voor achteraf-invoer modal. Goals worden in sub-modal toegevoegd.

## Openstaande punten

- [ ] **PWA / native wrapper** — manifest.json + service worker, app installeerbaar op telefoon.
- [ ] **Share-functie** — wedstrijdsamenvatting/stats delen via WhatsApp na een wedstrijd.
- [x] **Dynamische AI analyse** — `generateInsights()` berekent 10 insights uit SRZA + HISTORY data: positie, vorm, topscorer, afhankelijkheid, doelsaldo, thuis/uit, top-tegenstanders, x-factor, groei, beker.
- [ ] **Formatie-visualisatie** — bij lineup een veldje tonen met spelers op positie (1-2-2, 1-3-1, etc).
- [x] **srza.nl integratie** — `scripts/scrape-srza.js` (Node.js + cheerio), `.github/workflows/srza.yml` (daily cron 07:00 CET, sep–jun). Output `data/srza.json`. Config bovenaan scraper: `TEAM_ID=358`, `COMP_NR=3`. Update config bij start nieuw seizoen. App laadt srza.json async en toont SRZA programma + data footer op Wedstrijden page.
- [ ] **Firebase migratie** — data sync tussen devices, multi-user (teamgenoten).

## Conventies

- Geen comments in code tenzij niet-obvious waarom.
- Geen externe dependencies in index.html behalve Google Fonts CDN. Scraper gebruikt cheerio (package.json).
- Test altijd op mobile (375x812) — dit is primair een telefoon-app.
- localStorage limiet (~5-10MB) — foto's eten dit op, hou er rekening mee.
