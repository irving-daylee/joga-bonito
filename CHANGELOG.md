# Changelog

Alle noemenswaardige wijzigingen aan de app. Het versienummer staat in de
topbar, zodat je op je telefoon kunt zien wat je draait.

Nummering: **major** bij een volledige herziening of een wijziging aan hoe data
wordt opgeslagen, **minor** bij een nieuwe functie of zichtbare gedragsverandering,
**patch** bij een bugfix.

---

## [2.7.0] — 1 september 2026

### Toegevoegd
- **Matchday-kaart** om op wedstrijddag in de groep te delen: tegenstander,
  datum, tijd, hal, thuis of uit, en wie er wel en niet bij is. De knop staat op
  het selectiescherm.
- De aanwezigheidslijst is gewoon de selectie: tik iemand aan of uit en de kaart
  volgt, dus een late aanmelding voeg je tot het laatste moment toe.

---

## [2.6.1] — 1 september 2026

### Opgelost
- Een wedstrijd legde het seizoen niet vast. Bij de jaarwissel zouden alle
  wedstrijden van dit seizoen meeverhuizen naar het nieuwe, waardoor 2026/27
  leeg zou lijken. Vanaf nu draagt elke wedstrijd zijn eigen seizoen mee.

---

## [2.6.0] — 1 september 2026

### Gewijzigd
- srza.nl is verbouwd en levert zijn gegevens nu op een andere manier aan. De
  koppeling is daarop aangepast, zodat stand, programma en uitslagen blijven
  binnenkomen. Jullie spelen dit seizoen in de **Eerste Klasse A**.

### Toegevoegd
- De zaaldienst-avonden uit het competitieprogramma worden meegenomen
  (14 december en 10 mei).

### Opgelost
- Vóór de eerste speelronde staat iedereen op nul punten. De app presenteerde
  die volgorde als een echte klassering; nu toont hij tot de aftrap de eindstand
  van vorig seizoen.
- De koppeling probeert het opnieuw bij een tijdelijke storing, en overschrijft
  goede gegevens niet meer met een lege oogst.

---

## [2.5.2] — 17 augustus 2026

### Opgelost
- srza.nl toont de poule van vorig seizoen inmiddels zonder Mladost, waardoor
  Joga Bonito daar op de 2e plaats staat. De app hield die stand voor de actuele
  en sprak zichzelf tegen: Stats zei 3e, Analyse 2e. De app herkent nu dat een
  opgehaalde stand niet bij het huidige programma hoort en houdt de eindstand
  aan zoals die bij het afsluiten van het seizoen was: **3e**.

---

## [2.5.1] — 17 augustus 2026

### Toegevoegd
- Het wedstrijdprogramma van 2026/27 staat in de app: 22 wedstrijden, opgehaald
  van srza.nl.

### Opgelost
- Data van het programma werden door srza.nl in woorden geschreven ("woensdag 7
  oktober 2026"). De app kon maart, mei en oktober niet lezen, waardoor zeven
  wedstrijden een onleesbare datum zouden tonen.

---

## [2.5.0] — 26 juli 2026

### Toegevoegd
- **Doelpuntenmakers bij historische wedstrijden.** De 45 wedstrijden van
  2024/25 en 2025/26 tonen nu wie er scoorde, wie kaarten kreeg en wie er in de
  selectie zat — overgenomen uit de seizoensadministratie. Assists staan er
  apart bij: de administratie noteert aantallen per speler, niet welke assist
  bij welk doelpunt hoorde, dus die worden niet aan een goal gekoppeld.
- Seizoen 2024/25 heeft nu ook een uitslagenlijst.
- **Zaaldienst** bijhouden, met dezelfde keuze- en lotingsknop als de vlagger,
  en een eigen tabblad in Stats.

### Gewijzigd
- Het vlaggericoon is nu de geblokte rood-gele grensrechtersvlag in plaats van
  een rode driehoek.

---

## [2.4.0] — 26 juli 2026

### Toegevoegd
- **Vlaggers bijhouden.** Op het selectiescherm leg je vast wie vlagt of een
  vlagger regelt. Onder Stats staat een tabblad **Vlaggen** met de verdeling per
  seizoen en all-time, en in het wedstrijddetail zie je wie het die avond deed.
- Knop **Wijs aan** die loot onder de aanwezigen die dit seizoen het minst
  gevlagd hebben, zodat het niet steeds bij dezelfde persoon belandt.
- De vlaggers van 2024/25 en 2025/26 zijn overgenomen uit de
  seizoensadministratie: 40 wedstrijden, waarvan 19 gekoppeld aan de wedstrijd zelf.

### Opgelost
- Meldingen met een knop werden samengeperst tot één woord per regel.

---

## [2.3.0] — 26 juli 2026

### Toegevoegd
- Versienummer in de topbar, altijd zichtbaar. Tikken erop geeft uitleg.
- Deze changelog.

### Gewijzigd
- De service worker cache krijgt bij het uitrollen automatisch een nieuwe naam,
  dus een update komt door zonder dat er met de hand iets gebumpt hoeft te worden.

---

## [2.2.0] — 26 juli 2026

### Toegevoegd
- **Straftijd bij kaarten.** Groen (2 min) en geel (5 min) verschijnen als
  kaartje met aftelklok in het scorebord. De straf start pas als je zelf op play
  drukt, want de klok gaat pas lopen bij de hervatting. Hij telt op de
  wedstrijdklok, dus onderbrekingen tellen niet mee, hij overleeft een herstart
  en loopt door in de tweede helft. Met × geef je iemand handmatig vrij.
- Een rode kaart toont de speler als "uit" in het scorebord en telt mee in
  "man minder".
- **Sync-indicator** in de topbar: goud is opgeslagen, grijs is bezig, amber
  betekent dat er nog iets niet is doorgekomen.

### Gewijzigd
- De tabbladen op Stats volgen nu de data. Na een jaarwissel verschijnt het
  afgelopen seizoen vanzelf, berekend uit je eigen wedstrijden.
- Knoppen bij de straftijd hebben een aanraakgebied van 44 pixels; je tikt er
  tijdens een wedstrijd op.

### Opgelost
- De Analyse-pagina rekende op álle wedstrijden en presenteerde zo een reeks van
  vorig seizoen als actuele vorm.
- Lange clubnamen werden afgekapt of braken middenin een woord.

---

## [2.1.0] — 25 juli 2026

### Toegevoegd
- **Offline-veilige opslag.** Leg je een wedstrijd vast zonder bereik, dan wordt
  die niet meer overschreven door oudere gegevens van de server.
- Automatische backups van de database, twee versies die meedraaien.
- De app publiceert alleen nog als de geautomatiseerde controles slagen.

### Gewijzigd
- De wedstrijdklok hangt aan een vast eindtijdstip en staat na een herstart nog
  op de juiste stand. Daardoor kloppen ook de minuten bij goals.
- De srza-scraper stopt met een foutmelding als hij het team niet in de
  opgehaalde stand vindt, in plaats van stilzwijgend een verkeerde poule te
  publiceren.

### Verwijderd
- Spelersfoto's zijn volledig uit de app gehaald (AVG). Avatars zijn het
  rugnummer.

---

## [2.0.1] — 25 juli 2026

### Opgelost
- Wedstrijd en Stats bleven leeg na het inloggen. Firebase slaat lege lijsten
  niet op, waardoor de app struikelde over gegevens die het zelf had weggeschreven.
- Wedstrijden stonden dubbel in de lijst.
- De uitslag tegen Jai Hanuman van 14 april stond verkeerd om (3–1 gewonnen).
- Het keepersprofiel toonde twee keer assists in plaats van tegengoals per wedstrijd.
- Stats van het lopende seizoen telden wedstrijden van vorig seizoen mee.

---

## [2.0.0] — 23–25 juli 2026

### Gewijzigd
- **Volledig nieuw uiterlijk**: van navy/wit naar zwart met goud, passend bij
  het nieuwe tenue.
- **Data staat nu in de cloud.** Inloggen met e-mail of Google, en je wedstrijden
  synchroniseren tussen telefoon en desktop. localStorage blijft als offline
  reserve. Alleen drie vaste accounts hebben toegang.
- Historische wedstrijden van seizoen 2025/26 staan automatisch in de app.

---

## [1.0.0] — 19–21 juli 2026

De eerste werkende versie, met gegevens alleen op het eigen toestel.

- Wedstrijdverloop bijhouden: opstelling, goals, assists, kaarten, Power Play,
  man of the match
- Statistieken per seizoen en all-time, met klassementen
- Spelersprofielen met carrièrecijfers en formatieweergave
- Deelbare kaarten voor wedstrijden, stats en spelers
- AI-analyse met inzichten uit de eigen wedstrijden en de competitiestand
- Automatisch opgehaalde stand en uitslagen van srza.nl
- Installeerbaar als app op de telefoon
