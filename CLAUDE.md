# Joga Bonito

Futsal team management app voor zaalvoetbalteam Joga Bonito (Almere). Eigenaar: Irving Liesdek.

## Architectuur

Single-file HTML app (`index.html`, ~4900 regels). Alle CSS + JS inline, geen build step, geen framework. Draait op `python3 -m http.server 8777` via `.claude/launch.json`.

**Data**: Firebase Realtime Database (`/data`) als bron van waarheid, met localStorage (`jogaBonito_v2`) als offline cache. Alle state zit in het globale `DB` object. Firebase-project `futsal-joga-bonito` staat op Irvings persoonlijke Google-account, niet op de Daylee organization. Drie toegestane accounts, afgedwongen via database rules op e-mailadres.

**Structuur van index.html** — zoek op de blokcommentaren (`// ===== NAAM =====`), niet op regelnummers; die schuiven:
HTML + CSS met brand guide bovenaan → data layer (normalizeDB, saveData, Firebase auth + sync, seed) → HISTORY → timer → navigatie/modals/toasts → Team → match flow (setup → squad → lineup → live) → goals → event editing → kaarten + straftijd + MOTM → match detail → Stats → Wedstrijden → retroactieve invoer → analyse → share cards → helpers + init.

### Firebase-valkuilen

- **Lege arrays en `null` worden niet opgeslagen.** `events: []` verdwijnt volledig uit een teruggeladen object. `normalizeDB()`/`normalizeMatch()` herstellen dat bij élke load; nieuwe velden die een array of null kunnen zijn horen daar ook in. Zonder dat crasht de eerste `.filter()` en blijft een pagina leeg.
- **`saveData()` moet ná `fbReady = true` staan**, anders belandt een correctie alleen in localStorage en laadt elke login de oude data terug.
- **Openstaande schrijfacties**: de webSDK bewaart die alleen in het geheugen. `UNSYNCED_KEY` in localStorage markeert dat er iets openstaat; bij het inloggen wint de lokale versie alleen als die markering er is én lokaal nieuwer is. Het bolletje in de topbar toont de status.
- **`SEED_VERSION` ophogen** forceert dat historische wedstrijden opnieuw uit `HISTORY` gezet worden bij de volgende login. Dedupliceert op `date|opponent` en behoudt zelf ingevoerde wedstrijden (`_seeded` vlag).

## Testen en uitrollen

`npm test` draait de smoke test (`scripts/smoke-test.js`): de app wordt in jsdom geladen en doorloopt de echte inlog- en sync-flow met data in exact de vorm die Firebase teruggeeft. Draai hem vóór elke push die data-flow of rendering raakt — "de pagina laadt zonder console errors" bewijst niets over het gesynchroniseerde pad.

Elke check is geverifieerd tegen een commit waarin de bug nog zat. Voeg bij een bugfix een check toe en controleer dat die faalt op de oude versie:

```bash
git show <oude-commit>:index.html > /tmp/oud.html && node scripts/smoke-test.js /tmp/oud.html
```

GitHub Actions:
- `test.yml` — smoke test op pull requests, en als poort vanuit deploy
- `deploy.yml` — publiceert naar GitHub Pages, alleen als de test slaagt. Draait ook na `Scrape SRZA`, want die commit met het bot-token en zo'n commit start uit zichzelf geen workflow. Publiceert alleen `index.html`, `manifest.json`, `sw.js`, `icons/`, `data/`
- `backup-firebase.yml` — twee roterende backups in `backups/`. Spelersfoto's worden geleegd vóór het wegschrijven: de repo is publiek
- `srza.yml` — dagelijkse scrape

Bump `CACHE_NAME` in `sw.js` bij een wijziging aan de service worker zelf; `index.html` is network-first en ververst vanzelf.

## Brand guide (zwart/goud dark-mode)

| Element | Waarde |
|---|---|
| Logo font | Pirata One (title case, nooit all-caps) |
| Headings | Montserrat 600–800 |
| Body | Nunito 400–700 |
| Accent (goud) | `#C4922E` (--navy), hover `#A07824`, light `#D4A843` |
| Surface | `#1A1A1A` (donkere cards/modals) |
| Background | `#111111` (pagina-achtergrond) |
| Border | `#2A2A2A` |
| Text | `#E8E4DE` (primair), `#888888` (muted) |
| Topbar | `#0A0A0A` (zwart) met goud logo |
| Cards | Groen `#10B981` (2 min), Geel `#F59E0B` (5 min), Rood `#EF4444` (uit) |

Topbar is zwart met goud logo. Knoppen: goud achtergrond, zwart tekst. Share cards: donkere achtergrond met goud gradient header.

## Futsal-specifiek

- **Speeltijd**: 2x 20 minuten, countdown timer
- **Kaarten**: Groen (2 min straf), Geel (5 min straf), Rood (uitsluiting) — Almere-regels
- **Power Play**: Keeper eruit, extra veldspeler (5v4 zonder keeper)
- **Eigen goal**: Telt voor het thuisteam (`scoreHome++`), geen speler-selectie
- **Opstelling**: 1 keeper + 4 veldspelers (futsal = 5v5)

## Match flow (state machine)

`setup` → `squad` → `lineup` → `half1` → `halftime` → `half2` → `fulltime` → `motm` → `finished`

Timer start NIET automatisch — gebruiker drukt zelf op play. Dat geldt ook voor de straftijd bij een kaart: die begint pas bij de hervatting, dus je drukt per straf zelf op play.

### Klok en straftijd

Beide hangen aan een vast punt in plaats van aan een teller in het geheugen, zodat ze een herstart overleven — iOS gooit een PWA in de rust zomaar uit het geheugen.

- **Wedstrijdklok**: `timerEndsAt` (wandklok) als hij loopt, `timerRemaining` als hij gepauzeerd is. `restoreTimer()` zet hem terug bij het laden.
- **Straftijd**: `cm.penalties[]` met `endsAtClock`, de stand van de wédstrijdklok waarop de straf afloopt. Zo telt een onderbreking niet mee. Nog niet gestart? Dan staat de volle duur in `remaining` en is `endsAtClock` null. Bij de helftwissel schuift `endsAtClock` van lopende straffen met 20 minuten mee, zodat resterende tijd doorloopt.

**Een tegengoal beëindigt de straftijd NIET** (bevestigd door Irving voor de Almere-competitie, juli 2026). In veel futsalreglementen mag een speler er wel weer in zodra de tegenstander scoort — bouw dat hier dus niet in, ook niet als het elders de standaard is. De straf loopt puur op tijd. Handmatig vrijgeven kan met de ×.

## Spelers (pre-loaded)

Marco (#1, keeper), Irving (#7, aanvoerder), Lyzairo (#8), Rayvano (#9), Bobby (#10), Gregory (#11), Lawin (#5), Erfan (#12, keeper), Kenneth (#14), Said (#24), Amine (#59), Fouad (#99).

Geen spelersfoto's: avatars zijn het rugnummer. Bewust geen PII buiten voornaam, rugnummer, voorkeursvoet en positie (AVG).

## Key patterns

- **Modals**: `openModal(html)` zet innerHTML van `#modalContent`. Enkele modal tegelijk.
- **Toast**: `showToast(text, undoFn)` — 3 sec zichtbaar, fade-out, optionele undo-knop.
- **Goal celebration**: Fullscreen overlay bij thuisgoals (niet bij eigen goals/tegengoals), auto-dismiss na 2.5s.
- **Timeline events**: `{ type, minute, half, team, ... }`. Bij retroactieve invoer is `minute: null` → toont "–" in timeline, wordt overgeslagen in fase-analyse.
- **retroState**: Tijdelijke state voor achteraf-invoer modal. Goals worden in sub-modal toegevoegd.
- **Seizoenen**: een wedstrijd zonder `season` hoort bij het lopende seizoen; alleen geseede historie draagt zijn eigen seizoen mee. De tabbladen op Stats komen uit `statsSeasons()` en volgen de data, dus na een jaarwissel verschijnt het afgelopen seizoen vanzelf. `HISTORY` gaat voor waar het bestaat (die heeft poulestand en spelerstotalen); seizoenen die je zelf hebt gespeeld worden uit `DB.matches` berekend.

## Openstaande punten

- [x] **PWA / native wrapper** — manifest.json + service worker, app installeerbaar op telefoon. Icons in `icons/`. SW cached assets + fonts, network-first voor srza.json.
- [x] **Share-functie** — wedstrijdsamenvatting/stats delen via WhatsApp na een wedstrijd. Canvas-based match card, Web Share API op mobiel, download fallback op desktop.
- [x] **Dynamische AI analyse** — `generateInsights()` berekent 10 insights uit SRZA + HISTORY data: positie, vorm, topscorer, afhankelijkheid, doelsaldo, thuis/uit, top-tegenstanders, x-factor, groei, beker.
- [x] **Formatie-visualisatie** — navy half-pitch met 4-0 opstelling (2 achter, 2 voor). Keeper geel, veldspelers wit. Aspect-ratio 4:3.
- [x] **srza.nl integratie** — `scripts/scrape-srza.js` (Node.js + cheerio), `.github/workflows/srza.yml` (daily cron 07:00 CET, sep–jun). Output `data/srza.json`. Config bovenaan scraper: `TEAM_ID=358`, `COMP_NR=3`, te overschrijven via env vars. De scraper stopt met exit 1 als Joga Bonito niet in de opgehaalde stand staat — een verkeerd poulenummer geeft namelijk gewoon HTTP 200 met andermans stand. App laadt srza.json async en toont SRZA programma + data footer op Wedstrijden page.
- [x] **Firebase migratie** — auth (e-mail + Google) en Realtime Database sync tussen devices.
- [ ] **Seizoensoverzicht als share card** — op de roadmap, nog niet in scope.

## Bij de start van een nieuw seizoen

1. `TEAM_ID` en `COMP_NR` bovenaan `scripts/scrape-srza.js` bijwerken (test met `COMP_NR=<nr> node scripts/scrape-srza.js`; hij faalt luid bij het verkeerde nummer).
2. `DB.season` aanpassen via Team → seizoen.
3. Afgelopen seizoen verschijnt vanzelf als tabblad op Stats, berekend uit de eigen wedstrijden. Wil je er poulestand en eindpositie bij, voeg dan een `HISTORY`-blok toe.

## Conventies

- Geen comments in code tenzij niet-obvious waarom. De Firebase- en klok-valkuilen hierboven zijn wél toegelicht in de code, want ze zijn niet af te leiden uit wat er staat.
- Geen externe dependencies in index.html behalve Google Fonts CDN en de Firebase compat SDK. Scraper gebruikt cheerio, de smoke test jsdom (devDependency, draait alleen in CI).
- Test altijd op mobile (375x812) — dit is primair een telefoon-app.
- Sla geen PII op: geen foto's, achternamen of geboortedata. Alleen voetbalgerelateerde gegevens. De repo is publiek, dus dat geldt ook voor alles wat een workflow committeert.
