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

### Versienummer en changelog

`APP_VERSION` bovenaan het script in `index.html` is de enige plek waar het versienummer staat; de topbar toont het. **Hoog het op bij elke push en voeg een blok toe aan `CHANGELOG.md`** — niet aan Irving vragen, gewoon doen. Zonder versienummer kan hij op zijn telefoon niet zien of een deploy is doorgekomen.

- **Patch** (2.3.1) — bugfix of kleine aanpassing
- **Minor** (2.4.0) — nieuwe functie of zichtbare gedragsverandering
- **Major** (3.0.0) — volledige herziening of een wijziging aan hoe data wordt opgeslagen

De changelog beschrijft wat de gebruiker merkt, niet wat er in de code veranderde. `CACHE_NAME` hoef je niet mee te bumpen: de deploy leest `APP_VERSION`, plakt het commit-kenmerk erachter en stempelt dat in `sw.js`, dus de cache verloopt bij élke publicatie. Lokaal staat er `joga-bonito-dev`; die regel moet letterlijk zo blijven, want de deploy vervangt hem via `sed` en faalt als hij hem niet vindt. De smoke test bewaakt dat versie, topbar en changelog gelijk lopen.

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
- **Matchday-kaart**: `shareMatchdayCard()` deelt de wedstrijdaankondiging. Aanwezig is `cm.squad`, afwezig is `cm.afgemeld`; wie in geen van beide staat komt niet op de kaart. Een speler kan niet in allebei staan. `cm.verzameltijd` staat standaard op een kwartier voor aanvang (afgerond op vijf minuten) en is aanpasbaar op het wedstrijdscherm. De aanvangstijd staat niet op de wedstrijd maar komt uit `srzaData.programma`, gezocht op datum.
- **Taken (vlagger, zaaldienst)**: beide werken hetzelfde en delen `TAKEN` + `taakVan`/`taakTellingen`/`wijsTaakAan`/`openTaakModal`. Op de wedstrijd staat naast het speler-id ook de naam (`vlaggerNaam`, `zaaldienstNaam`), want een historische vlagger hoeft niet meer in de selectie te zitten. `wijsTaakAan()` loot onder de aanwezigen met de laagste stand van dit seizoen, niet puur willekeurig, anders blijft de scheve verdeling bestaan. Historische tellingen staan als `vlaggers` en `zaaldiensten` in `HISTORY`. **Let op**: zaaldienst is historisch per zaaldienstavond bijgehouden (drie avonden, vier man per keer), niet per wedstrijd — het veld op de wedstrijd is dus alleen voor voortaan.
- **MATCH_DETAILS**: per historische wedstrijd de selectie, doelpuntenmakers, assists, kaarten, vlagger en zaaldienst, gesleuteld op `date|opponent`. Uit de seizoensadministratie. De administratie noteert *aantallen* per speler, niet welke assist bij welk doelpunt hoorde — koppel ze dus niet, dat zou verzonnen data zijn. Doelpunten worden losse events zonder minuut; assists staan als `assistsNamen` op de wedstrijd en worden apart getoond.
- **Seizoenen**: een wedstrijd zonder `season` hoort bij het lopende seizoen; alleen geseede historie draagt zijn eigen seizoen mee. De tabbladen op Stats komen uit `statsSeasons()` en volgen de data, dus na een jaarwissel verschijnt het afgelopen seizoen vanzelf. `HISTORY` gaat voor waar het bestaat (die heeft poulestand en spelerstotalen); seizoenen die je zelf hebt gespeeld worden uit `DB.matches` berekend.

## Openstaande punten

- [x] **PWA / native wrapper** — manifest.json + service worker, app installeerbaar op telefoon. Icons in `icons/`. SW cached assets + fonts, network-first voor srza.json.
- [x] **Share-functie** — wedstrijdsamenvatting/stats delen via WhatsApp na een wedstrijd. Canvas-based match card, Web Share API op mobiel, download fallback op desktop.
- [x] **Dynamische AI analyse** — `generateInsights()` berekent 10 insights uit SRZA + HISTORY data: positie, vorm, topscorer, afhankelijkheid, doelsaldo, thuis/uit, top-tegenstanders, x-factor, groei, beker.
- [x] **Formatie-visualisatie** — navy half-pitch met 4-0 opstelling (2 achter, 2 voor). Keeper geel, veldspelers wit. Aspect-ratio 4:3.
- [x] **srza.nl integratie** — `scripts/scrape-srza.js` (Node.js + cheerio), `.github/workflows/srza.yml` (daily cron 07:00 CET, sep–jun). Output `data/srza.json`. App laadt dat async en toont programma + stand op Wedstrijden.

  **srza.nl is in augustus 2026 verbouwd.** Team, seizoen en poule gaan nu via een POST (`srza_team`, `srza_seizoen`, `srza_poule`) in plaats van een parameter in de URL; de oude `?t=`/`?nr=` links geven een lege pagina. Config staat bovenaan de scraper: `TEAM_ID=358`, `SEIZOEN=2` (2026/2027), `POULE=2` (Eerste Klasse A). `node scripts/scrape-srza.js --opties` toont de actuele keuzelijsten. Kolommen worden op kopnaam gelezen, niet op positie, zodat een layoutwijziging niet stil verschuift. Datums komen als "do 3 sep 2026" binnen en worden ISO — `new Date()` struikelt over maart, mei en oktober.

  Twee vangnetten: de scraper stopt met exit 1 als de stand gevuld is maar Joga Bonito er niet in staat (verkeerde poule geeft gewoon HTTP 200 met andermans stand), en hij weigert een gevuld `srza.json` te overschrijven met een lege oogst. Een lege stand aan het begin van het seizoen is alleen een waarschuwing.
- [x] **Firebase migratie** — auth (e-mail + Google) en Realtime Database sync tussen devices.
- [ ] **Seizoensoverzicht als share card** — op de roadmap, nog niet in scope.

### Eindstand 2025/26 is 3e

srza.nl toont die poule inmiddels met tien teams in plaats van elf (Mladost eruit) en Joga Bonito op 2. **Irving heeft besloten de klassering aan te houden zoals die aan het einde van het seizoen stond: 3e** (augustus 2026). Pas `HISTORY['2025/26']` daar dus niet op aan. `srzaStandVanDitSeizoen()` herkent dat een opgehaalde stand niet bij het huidige programma hoort en valt dan terug op onze eigen vastgelegde eindstand.

## Bij de start van een nieuw seizoen

1. `SEIZOEN` en `POULE` bovenaan `scripts/scrape-srza.js` bijwerken. `node scripts/scrape-srza.js --opties` toont de nummers; testen met `POULE=<nr> FORCE=1 node scripts/scrape-srza.js`, hij faalt luid bij de verkeerde poule.
2. `DB.season` aanpassen via Team → seizoen.
3. Afgelopen seizoen verschijnt vanzelf als tabblad op Stats, berekend uit de eigen wedstrijden. Wil je er poulestand en eindpositie bij, voeg dan een `HISTORY`-blok toe.

## Conventies

- Geen comments in code tenzij niet-obvious waarom. De Firebase- en klok-valkuilen hierboven zijn wél toegelicht in de code, want ze zijn niet af te leiden uit wat er staat.
- Geen externe dependencies in index.html behalve Google Fonts CDN en de Firebase compat SDK. Scraper gebruikt cheerio, de smoke test jsdom (devDependency, draait alleen in CI).
- Test altijd op mobile (375x812) — dit is primair een telefoon-app.
- Sla geen PII op: geen foto's, achternamen of geboortedata. Alleen voetbalgerelateerde gegevens. De repo is publiek, dus dat geldt ook voor alles wat een workflow committeert.
