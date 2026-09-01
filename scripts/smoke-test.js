// Draait de app in jsdom en voert de echte inlog- en sync-flow uit met data
// die exact de vorm heeft die Firebase teruggeeft. Firebase Realtime Database
// slaat lege arrays en null niet op, dus `events: []` verdwijnt volledig —
// precies de vorm waarop de app in juli 2026 stukliep met lege Wedstrijd- en
// Stats-pagina's.
//
// De test praat alleen met de app zoals de gebruiker dat doet (inloggen, data
// binnenkrijgen, pagina's bekijken), niet met interne hulpfuncties. Zo blijft
// hij geldig als de implementatie verandert.
//
// Gebruik: node scripts/smoke-test.js [pad/naar/index.html]

import fs from 'fs';
import path from 'path';
import { JSDOM, VirtualConsole } from 'jsdom';

// Fouten in de app komen niet altijd via een return of throw terug: een crash
// in een promise-callback (zoals het inlezen van Firebase-data) belandt als
// unhandled rejection buiten elke try/catch om. Die vangen we hier op, zodat
// de test ze als nette failure rapporteert in plaats van eraan onderdoor te gaan.
const pageErrors = [];
const noteError = e => pageErrors.push(e && e.message ? e.message : String(e));
process.on('unhandledRejection', noteError);
process.on('uncaughtException', noteError);
const drainErrors = () => pageErrors.splice(0, pageErrors.length);

const HTML_PATH = path.resolve(process.argv[2] || path.join(process.cwd(), 'index.html'));

// Bootst na wat Firebase met een object doet bij opslaan: lege arrays en
// null-waarden verdwijnen, lege objecten bestaan niet.
function fbShape(value) {
  if (Array.isArray(value)) {
    if (value.length === 0) return undefined;
    return value.map(fbShape).filter(v => v !== undefined);
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      const shaped = fbShape(v);
      if (shaped !== undefined) out[k] = shaped;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return value === null ? undefined : value;
}

const failures = [];
let total = 0;
async function check(name, fn) {
  total++;
  try {
    const detail = await fn();
    console.log(`  ok   ${name}${detail ? ` — ${detail}` : ''}`);
  } catch (e) {
    failures.push(name);
    console.log(`  FAIL ${name}\n         ${e.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const tick = () => new Promise(r => setTimeout(r, 0));

function stubScript(snapshot, localStorageSeed) {
  return `<script>
${Object.entries(localStorageSeed || {})
  .map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(v)});`)
  .join('\n')}
window.__fb = { writes: [], authCb: null, valueCb: null, snapshot: ${JSON.stringify(snapshot)} };
window.firebase = {
  initializeApp() {},
  auth: Object.assign(() => ({
    onAuthStateChanged(cb) { window.__fb.authCb = cb; },
    signInWithEmailAndPassword: () => Promise.resolve(),
    signInWithPopup: () => Promise.resolve(),
    signOut: () => Promise.resolve()
  }), { GoogleAuthProvider: function () {} }),
  database: () => ({
    goOnline() {},
    ref: () => ({
      set(data) { window.__fb.writes.push(JSON.parse(JSON.stringify(data))); return Promise.resolve(); },
      once: () => Promise.resolve({ val: () => window.__fb.snapshot }),
      on(_evt, cb) { window.__fb.valueCb = cb; },
      off() { window.__fb.valueCb = null; }
    })
  })
};
</script>`;
}

// Start de app met een gegeven Firebase-snapshot en logt in, zodat de app die
// data via zijn eigen pad inleest. Een crash tijdens het inladen wordt
// teruggegeven in plaats van doorgegooid, zodat de test hem als nette
// failure kan rapporteren in plaats van er zelf op stuk te lopen.
async function loadAndLogin(snapshot, localStorageSeed) {
  const html = fs.readFileSync(HTML_PATH, 'utf8')
    .replace(/<script src="https:\/\/www\.gstatic\.com\/firebasejs[^"]*"><\/script>\s*/g, '')
    .replace('</head>', `${stubScript(snapshot, localStorageSeed)}\n</head>`);

  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', noteError);

  // pretendToBeVisual levert requestAnimationFrame, die de app gebruikt om
  // een toast in te faden.
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', url: 'http://localhost/', virtualConsole, pretendToBeVisual: true,
  });
  const w = dom.window;
  assert(typeof w.__fb.authCb === 'function', 'app registreert geen auth-listener');
  drainErrors();

  let loginError = null;
  try {
    w.__fb.authCb({ uid: 'test', email: 'irving@example.com', photoURL: null });
    await tick();
    await tick();
  } catch (e) {
    loginError = e.message;
  }
  return { w, loginError: loginError || drainErrors()[0] || null };
}

const getDB = w => JSON.parse(w.eval('JSON.stringify(DB)'));

const PAGES = [
  ['Wedstrijd', 'renderMatchView', 'matchContent'],
  ['Stats', 'renderStatsPage', 'statsContent'],
  ['Wedstrijden', 'renderSchedulePage', null],
  ['Team', 'renderTeamPage', null],
  ['Analyse', 'renderAnalysePage', null],
];

function renderAllPages(w, situatie) {
  for (const [naam, fn, containerId] of PAGES) {
    try {
      w[fn]();
    } catch (e) {
      throw new Error(`${naam} crasht ${situatie}: ${e.message}`);
    }
    if (containerId) {
      const el = w.document.getElementById(containerId);
      assert(el && el.innerHTML.length > 0, `${naam} rendert leeg ${situatie}`);
    }
  }
}

const wedstrijd = (id, date, opp, hs, as, extra = {}) => ({
  id, date, opponent: opp, sporthal: 'Buiten', comp: 'comp',
  squad: [], lineup: [], events: [], keeper: null, captain: null, motm: null,
  flyingKeeper: false, scoreHome: hs, scoreAway: as, half: 2,
  status: 'finished', ...extra,
});

const spelers = [
  { id: 'p1', name: 'Marco', number: 1, isKeeper: true, isCaptain: false, foot: 'R', photo: null },
  { id: 'p2', name: 'Irving', number: 7, isKeeper: false, isCaptain: true, foot: 'R', photo: null },
];

// De situatie zoals die op 25 juli 2026 echt in Firebase stond: wedstrijden
// uit een oude seed zonder _seeded vlag, en een blijven hangen testwedstrijd.
const productieSnapshot = fbShape({
  teamName: 'Joga Bonito', season: '2026/27', players: spelers,
  nextPlayerId: 13, nextMatchId: 24,
  currentMatch: {
    id: 'm2', date: '2026-07-25', opponent: 'FC Test', sporthal: 'Stedenwijk',
    comp: 'comp', squad: [], lineup: [], events: [], keeper: null, captain: null,
    motm: null, flyingKeeper: false, scoreHome: 0, scoreAway: 0, half: 1,
    status: 'squad',
  },
  matches: [
    wedstrijd('m1', '2025-09-11', 'Weddingcars by DK', 2, 1),
    wedstrijd('m20', '2026-04-14', 'Jai Hanuman 1', 1, 3),
    wedstrijd('m99', '2026-09-10', 'Nieuwe Tegenstander', 4, 2),
  ],
});

console.log(`\nSmoke test: ${HTML_PATH}\n`);

const { w, loginError } = await loadAndLogin(productieSnapshot);

await check('alle pagina\'s renderen na inloggen met Firebase-data', () => {
  assert(!loginError, `inloggen crasht de app: ${loginError}`);
  renderAllPages(w, 'na inloggen');
});

await check('dubbele wedstrijden uit een oudere seed worden opgeruimd', () => {
  const keys = getDB(w).matches.map(m => `${m.date}|${m.opponent}`);
  const dubbel = keys.length - new Set(keys).size;
  assert(dubbel === 0, `${dubbel} dubbele wedstrijden`);
  return `${keys.length} unieke wedstrijden`;
});

await check('zelf ingevoerde wedstrijd blijft behouden', () => {
  const eigen = getDB(w).matches.filter(m => m.opponent === 'Nieuwe Tegenstander');
  assert(eigen.length === 1, `gevonden: ${eigen.length}`);
});

await check('gecorrigeerde data wordt naar Firebase weggeschreven', () => {
  // Zonder deze check belandt een datacorrectie alleen in localStorage en
  // laadt elke login opnieuw de foute data terug.
  const writes = w.__fb.writes;
  assert(writes.length > 0, 'app schreef niets terug naar Firebase');
  const laatste = writes[writes.length - 1];
  const jh = (laatste.matches || []).find(m => m.date === '2026-04-14');
  assert(jh, 'wedstrijd van 14 april ontbreekt in wat is weggeschreven');
  assert(jh.scoreHome === 3 && jh.scoreAway === 1,
    `Jai Hanuman weggeschreven als ${jh.scoreHome}-${jh.scoreAway}, verwacht 3-1`);
  return `${writes.length} write(s)`;
});

await check('stats van dit seizoen tellen geen wedstrijden van vorig seizoen', () => {
  // De seed zet 23 wedstrijden van 2025/26 in de DB. Die horen niet mee te
  // tellen onder het tabblad van het lopende seizoen.
  w.renderStatsPage();
  const stats = w.document.getElementById('statsContent').textContent || '';
  // Redeneer op datum, niet op een veld dat de app misschien niet zet: het
  // seizoen 2026/27 begint op 1 juli 2026.
  const alle = getDB(w).matches.filter(m => m.status === 'finished');
  const vorigSeizoen = alle.filter(m => m.date < '2026-07-01');
  const ditSeizoen = alle.filter(m => m.date >= '2026-07-01');
  assert(vorigSeizoen.length > 0, 'testopzet klopt niet: geen wedstrijden uit een vorig seizoen');
  const gespeeld = /(\d+)\s*Gespeeld/i.exec(stats);
  assert(gespeeld, 'kon "Gespeeld" niet vinden in de stats-pagina');
  assert(Number(gespeeld[1]) === ditSeizoen.length,
    `stats tonen ${gespeeld[1]} gespeeld terwijl er dit seizoen ${ditSeizoen.length} wedstrijd(en) zijn; ${vorigSeizoen.length} van vorig seizoen worden meegeteld`);
  return `${gespeeld[1]} dit seizoen, ${vorigSeizoen.length} uit vorig seizoen niet meegeteld`;
});

await check('het huidige seizoen wordt niet overschreven door de seed', () => {
  const db = getDB(w);
  assert(db.season === '2026/27', `seizoen werd ${db.season}`);
  const badge = w.document.getElementById('seasonBadge').textContent;
  assert(badge === '2026/27', `badge toont ${badge}`);
  return db.season;
});

await check('sync-update vanaf een ander apparaat crasht de app niet', () => {
  assert(typeof w.__fb.valueCb === 'function', 'app luistert niet op wijzigingen');
  w.__fb.valueCb({ val: () => fbShape({
    teamName: 'Joga Bonito', season: '2026/27', players: spelers,
    nextPlayerId: 13, nextMatchId: 4, currentMatch: null,
    matches: [wedstrijd('m1', '2026-09-17', 'Ander Apparaat', 5, 2)],
  }) });
  const fouten = drainErrors();
  assert(fouten.length === 0, `fout bij verwerken sync: ${fouten[0]}`);
  renderAllPages(w, 'na sync vanaf ander apparaat');
});

await check('spelersfoto\'s worden niet bewaard of weggeschreven (AVG)', async () => {
  // Een oude opslag kan nog base64-foto's bevatten; die moeten bij het inlezen
  // verdwijnen en niet opnieuw naar Firebase gaan.
  const metFoto = await loadAndLogin(fbShape({
    teamName: 'Joga Bonito', season: '2026/27', nextPlayerId: 13, nextMatchId: 2,
    players: spelers.map(p => ({ ...p, photo: 'data:image/jpeg;base64,AAAA' })),
    matches: [wedstrijd('m1', '2026-09-10', 'Test', 1, 0)], currentMatch: null,
  }));
  const db = getDB(metFoto.w);
  const nog = db.players.filter(p => p.photo);
  assert(nog.length === 0, `${nog.length} speler(s) hebben nog een foto in de app-data`);
  const writes = metFoto.w.__fb.writes;
  const inFirebase = JSON.stringify(writes).includes('base64');
  assert(!inFirebase, 'er is een foto naar Firebase weggeschreven');
  const bronCode = fs.readFileSync(HTML_PATH, 'utf8');
  assert(!/type="file"/.test(bronCode), 'er zit nog een bestandsupload in de app');
  return `${db.players.length} spelers, geen foto's`;
});

await check('offline vastgelegde wedstrijd wordt niet overschreven door de server', async () => {
  // Sporthal zonder bereik: de wedstrijd staat in localStorage, de markering
  // dat er nog iets openstaat ook, maar Firebase heeft hem nooit gekregen.
  const lokaal = {
    teamName: 'Joga Bonito', season: '2026/27', players: spelers,
    nextPlayerId: 13, nextMatchId: 3, currentMatch: null, _seedVersion: 4,
    updatedAt: 2000,
    matches: [wedstrijd('lokaal1', '2026-09-24', 'In De Sporthal', 6, 2, { season: '2026/27' })],
  };
  const ouderOpServer = fbShape({
    teamName: 'Joga Bonito', season: '2026/27', players: spelers,
    nextPlayerId: 13, nextMatchId: 2, currentMatch: null, _seedVersion: 4,
    updatedAt: 1000,
    matches: [wedstrijd('hs1', '2025-09-11', 'Weddingcars by DK', 2, 1, { _seeded: true, season: '2025/26' })],
  });

  const { w: w2, loginError: err2 } = await loadAndLogin(ouderOpServer, {
    jogaBonito_v2: JSON.stringify(lokaal),
    jogaBonito_unsynced: '1',
  });
  assert(!err2, `inloggen crasht: ${err2}`);

  const db = getDB(w2);
  const bewaard = db.matches.find(m => m.opponent === 'In De Sporthal');
  assert(bewaard, 'de offline vastgelegde wedstrijd is weg na het inloggen');
  assert(bewaard.scoreHome === 6 && bewaard.scoreAway === 2, 'de uitslag klopt niet meer');

  const weggeschreven = JSON.stringify(w2.__fb.writes).includes('In De Sporthal');
  assert(weggeschreven, 'de wedstrijd is niet alsnog naar Firebase gestuurd');
  return 'lokale wedstrijd behouden en alsnog gesynct';
});

await check('server wint wel als er lokaal niets openstaat', async () => {
  // Spiegelbeeld: zonder openstaande wijzigingen moet de app gewoon de server
  // volgen, anders zou een oud apparaat verse data van het andere overschrijven.
  const oudLokaal = {
    teamName: 'Joga Bonito', season: '2026/27', players: spelers,
    nextPlayerId: 13, nextMatchId: 2, currentMatch: null, _seedVersion: 4,
    updatedAt: 1000, matches: [wedstrijd('oud1', '2026-09-01', 'Oud Apparaat', 1, 1, { season: '2026/27' })],
  };
  const nieuwerOpServer = fbShape({
    teamName: 'Joga Bonito', season: '2026/27', players: spelers,
    nextPlayerId: 13, nextMatchId: 2, currentMatch: null, _seedVersion: 4,
    updatedAt: 5000, matches: [wedstrijd('nieuw1', '2026-09-20', 'Van Erfan', 3, 0, { season: '2026/27' })],
  });

  const { w: w3 } = await loadAndLogin(nieuwerOpServer, { jogaBonito_v2: JSON.stringify(oudLokaal) });
  const db = getDB(w3);
  assert(db.matches.some(m => m.opponent === 'Van Erfan'), 'de server-versie is niet overgenomen');
  assert(!db.matches.some(m => m.opponent === 'Oud Apparaat'), 'oude lokale data overschrijft de server');
  return 'server-versie gevolgd';
});

await check('de wedstrijdklok overleeft een herstart', async () => {
  // De app is gesloten terwijl de klok liep met nog 12 minuten te gaan.
  const overGeblevenMs = 12 * 60 * 1000;
  const lopendeWedstrijd = fbShape({
    teamName: 'Joga Bonito', season: '2026/27', players: spelers,
    nextPlayerId: 13, nextMatchId: 2, matches: [], _seedVersion: 4, updatedAt: 1,
    currentMatch: {
      id: 'm1', date: '2026-09-24', opponent: 'Lopende Wedstrijd', sporthal: 'Haven',
      comp: 'comp', squad: [spelers[0].id, spelers[1].id], lineup: [spelers[0].id],
      keeper: spelers[0].id, captain: spelers[1].id, motm: null, events: [],
      flyingKeeper: false, scoreHome: 1, scoreAway: 0, half: 1, status: 'half1',
      timerEndsAt: Date.now() + overGeblevenMs, timerRemaining: null,
    },
  });

  const { w: w4, loginError: err4 } = await loadAndLogin(lopendeWedstrijd);
  assert(!err4, `inloggen crasht: ${err4}`);
  const resterend = Number(w4.eval('timerSeconds'));
  assert(Math.abs(resterend - 720) <= 5,
    `klok staat op ${Math.floor(resterend / 60)}:${String(resterend % 60).padStart(2, '0')} in plaats van 12:00`);

  // De minuut van een goal wordt uit de klok berekend; die moet dus ook kloppen.
  const minuut = Number(w4.eval('getCurrentMinute()'));
  assert(minuut === 8, `goal zou op minuut ${minuut} komen in plaats van 8`);
  w4.eval('stopTimer()');
  return `klok op ${Math.round(resterend / 60)} min, goal op minuut ${minuut}`;
});

await check('straftijd start pas als je zelf op play drukt', async () => {
  const { w: w5, loginError } = await loadAndLogin(fbShape({
    teamName: 'Joga Bonito', season: '2026/27', players: spelers,
    nextPlayerId: 13, nextMatchId: 2, matches: [], _seedVersion: 4, updatedAt: 1, currentMatch: null,
  }));
  assert(!loginError, `inloggen crasht: ${loginError}`);

  // Wedstrijd opzetten en een groene kaart geven.
  w5.eval(`
    startNewMatch();
    DB.currentMatch.opponent = 'Test';
    DB.currentMatch.squad = DB.players.map(p => p.id);
    DB.currentMatch.keeper = DB.players[0].id;
    DB.currentMatch.lineup = DB.players.slice(0, 5).map(p => p.id);
    startMatch();
    cardState = { playerId: DB.players[1].id, cardType: 'green' };
    saveCard();
  `);

  const lees = () => JSON.parse(w5.eval(`JSON.stringify({
    aantal: (DB.currentMatch.penalties||[]).length,
    loopt: DB.currentMatch.penalties[0] ? penaltyRunning(DB.currentMatch.penalties[0]) : null,
    rest: DB.currentMatch.penalties[0] ? penaltyRemaining(DB.currentMatch.penalties[0]) : null,
    klok: timerSeconds
  })`));

  let s = lees();
  assert(s.aantal === 1, `${s.aantal} straffen na een groene kaart in plaats van 1`);
  assert(s.loopt === false, 'de straftijd loopt meteen, terwijl je zelf op play moet drukken');
  assert(s.rest === 120, `groene kaart geeft ${s.rest} sec in plaats van 120`);

  // De wedstrijdklok loopt door zonder dat de straf begint.
  w5.eval('timerSeconds -= 30');
  s = lees();
  assert(s.rest === 120, `straftijd liep mee met de klok zonder play (${s.rest} sec over)`);

  // Nu starten en 45 seconden spelen.
  w5.eval(`startPenalty(DB.players[1].id); timerSeconds -= 45;`);
  s = lees();
  assert(s.loopt === true, 'straftijd loopt niet na play');
  assert(s.rest === 75, `na 45 sec spelen nog ${s.rest} sec over in plaats van 75`);

  // Straftijd hangt aan de wedstrijdklok: een herstart mag niets veranderen.
  w5.eval('DB.currentMatch = normalizeMatch(JSON.parse(JSON.stringify(DB.currentMatch)))');
  assert(lees().rest === 75, 'straftijd klopt niet meer na een herstart');

  // Uitzitten: de straf verdwijnt en de speler mag terug.
  w5.eval('timerSeconds -= 75; checkPenalties();');
  assert(lees().aantal === 0, 'de straf blijft staan nadat hij is uitgezeten');
  return 'gepauzeerd bij kaart, loopt na play, overleeft herstart';
});

await check('straftijd loopt door in de tweede helft', async () => {
  const { w: w6 } = await loadAndLogin(fbShape({
    teamName: 'Joga Bonito', season: '2026/27', players: spelers,
    nextPlayerId: 13, nextMatchId: 2, matches: [], _seedVersion: 4, updatedAt: 1, currentMatch: null,
  }));
  // Gele kaart (5 min) met nog anderhalve minuut te spelen in de eerste helft.
  w6.eval(`
    startNewMatch();
    DB.currentMatch.opponent = 'Test';
    DB.currentMatch.squad = DB.players.map(p => p.id);
    DB.currentMatch.keeper = DB.players[0].id;
    DB.currentMatch.lineup = DB.players.slice(0, 5).map(p => p.id);
    startMatch();
    timerSeconds = 90;
    cardState = { playerId: DB.players[1].id, cardType: 'yellow' };
    saveCard();
    startPenalty(DB.players[1].id);
    timerSeconds = 0;
  `);
  const restEindeHelft = Number(w6.eval('penaltyRemaining(DB.currentMatch.penalties[0])'));
  assert(restEindeHelft === 210, `aan het eind van de helft ${restEindeHelft} sec over in plaats van 210`);

  // Helftwissel zoals de app die uitvoert.
  w6.eval(`
    DB.currentMatch.half = 2; timerSeconds = 20*60;
    DB.currentMatch.penalties.forEach(p => { if (p.endsAtClock != null) p.endsAtClock += 20*60; });
  `);
  const restNaRust = Number(w6.eval('penaltyRemaining(DB.currentMatch.penalties[0])'));
  assert(restNaRust === 210, `na de rust ${restNaRust} sec over in plaats van 210`);
  return '1:30 uitgezeten, 3:30 loopt door na rust';
});

await check('de analyse gaat over dit seizoen, niet over vorig seizoen', () => {
  // Zet zelf de situatie op in plaats van te leunen op wat eerdere checks
  // hebben achtergelaten: 23 wedstrijden van 2025/26 plus één van dit seizoen.
  w.eval(`
    DB.matches = []; DB._seedVersion = 0; seedMatchesFromHistory();
    DB.season = '2026/27'; DB.currentMatch = null;
    DB.matches.push({ id:'dit1', season:'2026/27', date:'2026-09-10', opponent:'Dit Seizoen',
      sporthal:'Haven', comp:'comp', squad:[], lineup:[], keeper:null, captain:null, motm:null,
      flyingKeeper:false, events:[], scoreHome:5, scoreAway:2, half:2, status:'finished' });
    renderAnalysePage();
  `);
  const totaal = Number(w.eval('DB.matches.filter(m => m.status === "finished").length'));
  const ditSeizoen = Number(w.eval('seasonMatches(DB.season).length'));
  assert(totaal > ditSeizoen,
    'testopzet klopt niet: er staan geen wedstrijden van een ander seizoen in de DB');

  const t = w.document.getElementById('analyseContent').textContent.replace(/\s+/g, ' ');
  const geanalyseerd = /(\d+)\s*wedstrijd/i.exec(t);
  assert(geanalyseerd, 'kon het aantal geanalyseerde wedstrijden niet vinden');
  assert(Number(geanalyseerd[1]) === ditSeizoen,
    `analyse telt ${geanalyseerd[1]} wedstrijden terwijl er dit seizoen ${ditSeizoen} is; de andere ${totaal - ditSeizoen} zijn van vorig seizoen`);
  assert(t.includes(w.eval('DB.season')), 'de analyse noemt niet over welk seizoen het gaat');
  return `${ditSeizoen} van ${totaal} wedstrijden meegeteld`;
});

await check('een rode kaart toont de speler als uitgesloten in het scorebord', async () => {
  const { w: w7 } = await loadAndLogin(fbShape({
    teamName: 'Joga Bonito', season: '2026/27', players: spelers,
    nextPlayerId: 13, nextMatchId: 2, matches: [], _seedVersion: 4, updatedAt: 1, currentMatch: null,
  }));
  w7.eval(`
    startNewMatch();
    DB.currentMatch.opponent = 'Test';
    DB.currentMatch.squad = DB.players.map(p => p.id);
    DB.currentMatch.keeper = DB.players[0].id;
    DB.currentMatch.lineup = DB.players.slice(0, 5).map(p => p.id);
    startMatch();
    cardState = { playerId: DB.players[1].id, cardType: 'red' };
    saveCard();
  `);
  const uitgesloten = Number(w7.eval('excludedPlayers().length'));
  assert(uitgesloten === 1, `${uitgesloten} uitgesloten spelers na een rode kaart in plaats van 1`);

  const strip = w7.document.getElementById('penaltyStrip');
  assert(strip && /UIT/.test(strip.textContent), 'de uitsluiting staat niet in het scorebord');
  assert(/1 man minder/.test(strip.textContent), `telling klopt niet: "${strip.textContent.trim()}"`);

  // Een rode kaart geeft geen straftijd met countdown.
  const straffen = Number(w7.eval('(DB.currentMatch.penalties||[]).length'));
  assert(straffen === 0, 'een rode kaart heeft ten onrechte een aftellende straftijd gekregen');

  // Draai de kaart terug via de tijdlijn: de uitsluiting hoort mee te verdwijnen.
  w7.eval('DB.currentMatch.events = []');
  assert(Number(w7.eval('excludedPlayers().length')) === 0,
    'de uitsluiting blijft staan nadat de rode kaart is teruggedraaid');
  return 'uit in scorebord, geen countdown, verdwijnt bij terugdraaien';
});

await check('Matchday werkt zonder dat er een wedstrijd bestaat', async () => {
  const { w: w11 } = await loadAndLogin(fbShape({
    teamName: 'Joga Bonito', season: '2026/27', players: spelers,
    nextPlayerId: 13, nextMatchId: 2, matches: [], _seedVersion: 6, updatedAt: 1, currentMatch: null,
  }));
  const datum = '2026-09-03';
  w11.eval(`srzaData = { programma: [{ date: '${datum}', opp: 'Limako', time: '20:24', hal: 'BUITEN', home: true }],
                         uitslagen: [], standen: [] };
            renderSchedulePage();`);

  // De knop hoort bij het programma, niet in de wedstrijdflow.
  const knop = w11.document.querySelector(`button[onclick="openMatchdayModal('${datum}')"]`);
  assert(knop, 'geen Matchday-knop bij de aankomende wedstrijd');
  assert(w11.eval('DB.currentMatch') === null, 'er is een wedstrijd aangemaakt terwijl dat niet hoeft');

  // Verzameltijd wordt afgeleid van de aanvang.
  const verzamel = w11.eval(`matchdayVoor('${datum}').verzameltijd`);
  assert(verzamel === '20:10', `verzameltijd werd ${verzamel} in plaats van 20:10 bij aanvang 20:24`);

  // Tikken loopt rond: aanwezig → afwezig → niets gehoord.
  const speler = w11.eval('DB.players[0].id');
  const status = () => w11.eval(`matchdayStatus('${datum}', ${JSON.stringify(speler)})`);
  assert(status() === 'onbekend', `begint op ${status()}`);
  w11.eval(`cycleMatchday('${datum}', ${JSON.stringify(speler)})`);
  assert(status() === 'aanwezig', `na één tik ${status()}`);
  w11.eval(`cycleMatchday('${datum}', ${JSON.stringify(speler)})`);
  assert(status() === 'afgemeld', `na twee tikken ${status()}`);
  w11.eval(`cycleMatchday('${datum}', ${JSON.stringify(speler)})`);
  assert(status() === 'onbekend', `na drie tikken ${status()}`);

  // De selectie vult zich later vanuit deze lijst, en blijft aanpasbaar.
  w11.eval(`cycleMatchday('${datum}', ${JSON.stringify(speler)});
            startNewMatch();
            DB.currentMatch.date = '${datum}';
            document.getElementById('oppInput') || (() => { DB.currentMatch.status='setup'; renderMatchView(); })();
            document.getElementById('oppInput').value = 'Limako';
            document.getElementById('dateInput').value = '${datum}';
            proceedToSquad();`);
  const squad = JSON.parse(w11.eval('JSON.stringify(DB.currentMatch.squad)'));
  assert(squad.length === 1 && squad[0] === speler,
    `selectie is niet voorgevuld uit de Matchday (${squad.length} spelers)`);
  w11.eval(`toggleSquad(DB.players[1].id)`);
  assert(JSON.parse(w11.eval('JSON.stringify(DB.currentMatch.squad)')).length === 2,
    'een late aanmelding is niet toe te voegen');
  return 'knop bij het programma, voorgevuld en aanpasbaar';
});

await check('een wedstrijd blijft bij zijn eigen seizoen na de jaarwissel', async () => {
  const { w: w10 } = await loadAndLogin(fbShape({
    teamName: 'Joga Bonito', season: '2026/27', players: spelers,
    nextPlayerId: 13, nextMatchId: 2, matches: [], _seedVersion: 6, updatedAt: 1, currentMatch: null,
  }));
  // Speel een wedstrijd zoals de app dat doet, en zet daarna het seizoen door.
  w10.eval(`
    startNewMatch();
    DB.currentMatch.opponent = 'Limako';
    DB.currentMatch.squad = DB.players.map(p => p.id);
    DB.currentMatch.keeper = DB.players[0].id;
    DB.currentMatch.lineup = DB.players.slice(0, 5).map(p => p.id);
    startMatch();
    DB.currentMatch.scoreHome = 2; DB.currentMatch.scoreAway = 1;
    DB.currentMatch.status = 'fulltime';
    finishMatch();
  `);
  const gespeeld = JSON.parse(w10.eval("JSON.stringify(DB.matches.find(m => m.opponent === 'Limako'))"));
  assert(gespeeld, 'de gespeelde wedstrijd staat niet in de lijst');
  assert(gespeeld.season === '2026/27',
    `de wedstrijd draagt geen seizoen mee (season = ${JSON.stringify(gespeeld.season)})`);

  w10.eval("DB.season = '2027/28'");
  const naWissel = w10.eval("matchSeason(DB.matches.find(m => m.opponent === 'Limako'))");
  assert(naWissel === '2026/27',
    `na de jaarwissel hoort de wedstrijd ineens bij ${naWissel} in plaats van 2026/27`);
  const ditSeizoen = Number(w10.eval("seasonMatches('2027/28').length"));
  assert(ditSeizoen === 0, `${ditSeizoen} wedstrijd(en) meeverhuisd naar het nieuwe seizoen`);
  return 'blijft bij 2026/27';
});

await check('een afgelopen seizoen krijgt vanzelf een eigen tabblad', () => {
  const lees = () => w.document.getElementById('statsContent').textContent.replace(/\s+/g, ' ');

  // Ingevoerde seizoenen houden hun rijke HISTORY-cijfers, inclusief poulestand.
  w.eval("DB.season = '2026/27'; selectedStatsSeason = '2025/26'; renderStatsPage()");
  assert(lees().includes('Eindstand'), 'het tabblad 2025/26 toont geen eindstand meer uit HISTORY');

  // Zet zelf de uitgangssituatie op, zodat deze check niet afhangt van wat
  // eerdere checks aan de DB veranderd hebben.
  w.eval(`
    DB.matches = []; DB._seedVersion = 0; seedMatchesFromHistory();
    DB.season = '2026/27'; DB.currentMatch = null;
    DB.matches.push({ id:'nieuw1', season:'2026/27', date:'2026-10-01', opponent:'Volgend Seizoen',
      sporthal:'Haven', comp:'comp', squad:[], lineup:[], keeper:null, captain:null, motm:null,
      flyingKeeper:false, events:[], scoreHome:4, scoreAway:2, half:2, status:'finished' });
    DB.season = '2027/28';
  `);
  const tabs = JSON.parse(w.eval('JSON.stringify(statsSeasons().map(s => s.label))'));
  assert(tabs.includes('2026/27'), `2026/27 ontbreekt in de tabbladen: ${tabs.join(', ')}`);
  assert(tabs[0] === '2027/28', `het eerste tabblad is ${tabs[0]} in plaats van het nieuwe seizoen`);

  w.eval("selectedStatsSeason = '2026/27'; renderStatsPage()");
  const gespeeld = /(\d+)\s*Gespeeld/i.exec(lees());
  assert(gespeeld && gespeeld[1] === '1',
    `het afgelopen seizoen toont ${gespeeld ? gespeeld[1] : '?'} gespeeld in plaats van 1`);

  w.eval("DB.season = '2026/27'; selectedStatsSeason = 'current'");
  return tabs.join(', ');
});

await check('de vlagger overleeft een rondje Firebase en staat op de historie', async () => {
  const { w: w8, loginError } = await loadAndLogin(fbShape({
    teamName: 'Joga Bonito', season: '2026/27', players: spelers,
    nextPlayerId: 13, nextMatchId: 2, matches: [], _seedVersion: 0, updatedAt: 1, currentMatch: null,
  }));
  assert(!loginError, `inloggen crasht: ${loginError}`);

  const metVlagger = Number(w8.eval('DB.matches.filter(m => m.vlaggerNaam).length'));
  assert(metVlagger === 39, `${metVlagger} geseede wedstrijden met een vlagger in plaats van 39`);
  // Zaaldienst is historisch niet per wedstrijd bijgehouden maar per
  // zaaldienstavond, dus die telling staat als seizoenstotaal in HISTORY.
  const zaaldienstTotalen = Number(w8.eval("HISTORY['2025/26'].zaaldiensten.reduce((s,z) => s+z.count, 0)"));
  assert(zaaldienstTotalen === 8, `${zaaldienstTotalen} zaaldiensten in 2025/26 in plaats van 8`);

  // Doelpuntenmakers uit de administratie moeten optellen tot de uitslag.
  const klopt = w8.eval(`(() => {
    const fout = DB.matches.filter(m => m._seeded && (m.events||[]).some(e => e.type === 'goal'))
      .filter(m => m.events.filter(e => e.type === 'goal' && e.team === 'home').length !== m.scoreHome);
    return JSON.stringify(fout.map(m => m.date + ' ' + m.opponent));
  })()`);
  const mismatch = JSON.parse(klopt);
  assert(mismatch.length === 0, `doelpuntenmakers tellen niet op tot de uitslag: ${mismatch.join(', ')}`);

  // Firebase stript null-velden; de vlagger moet daar tegen kunnen.
  const heen = JSON.parse(w8.eval('JSON.stringify(DB.matches.find(m => m.vlaggerNaam))'));
  const terug = fbShape(heen);
  w8.eval(`(() => { const m = normalizeMatch(${JSON.stringify(terug)}); window.__t = vlaggerVan(m); })()`);
  assert(w8.__t === heen.vlaggerNaam,
    `na een rondje Firebase is de vlagger "${w8.__t}" in plaats van "${heen.vlaggerNaam}"`);
  return `${metVlagger} wedstrijden, ${heen.date}: ${heen.vlaggerNaam}`;
});

await check('de loting kiest wie het minst gevlagd heeft', async () => {
  const { w: w9 } = await loadAndLogin(fbShape({
    teamName: 'Joga Bonito', season: '2026/27', players: spelers,
    nextPlayerId: 13, nextMatchId: 2, matches: [], _seedVersion: 0, updatedAt: 1, currentMatch: null,
  }));
  // Twee wedstrijden dit seizoen die speler 1 al gevlagd heeft.
  w9.eval(`
    ['2026-09-10','2026-09-17'].forEach((d, i) => DB.matches.push({
      id: 'v'+i, season: '2026/27', date: d, opponent: 'Test', sporthal: 'Haven', comp: 'comp',
      squad: [], lineup: [], keeper: null, captain: null, motm: null, flyingKeeper: false,
      events: [], scoreHome: 1, scoreAway: 0, half: 2, status: 'finished',
      vlagger: DB.players[0].id, vlaggerNaam: DB.players[0].name }));
    startNewMatch();
    DB.currentMatch.squad = [DB.players[0].id, DB.players[1].id];
  `);
  const tel = JSON.parse(w9.eval('JSON.stringify(vlaggerTellingen(DB.season))'));
  const veelvlagger = JSON.parse(w9.eval('JSON.stringify(DB.players[0].name)'));
  assert(tel[veelvlagger] === 2, `testopzet klopt niet: ${veelvlagger} staat op ${tel[veelvlagger]}`);

  // 25 lotingen: degene die al twee keer vlagde mag er geen enkele keer uitkomen.
  const uitkomsten = new Set();
  for (let i = 0; i < 25; i++) {
    w9.eval("wijsTaakAan('vlagger')");
    uitkomsten.add(w9.eval('vlaggerVan(DB.currentMatch)'));
  }
  assert(!uitkomsten.has(veelvlagger),
    `${veelvlagger} werd geloot terwijl een teamgenoot minder vaak vlagde`);
  assert(uitkomsten.size === 1, `onverwachte uitkomsten: ${[...uitkomsten].join(', ')}`);
  return `altijd ${[...uitkomsten][0]}, nooit ${veelvlagger}`;
});

await check('het versienummer staat in de topbar en is stempelbaar', () => {
  const el = w.document.getElementById('appVersion');
  assert(el, 'er staat geen versie-element in de topbar');
  const getoond = el.textContent.trim();
  assert(/^v\d+\.\d+\.\d+$/.test(getoond), `de topbar toont "${getoond}" in plaats van bijv. v1.1.0`);

  const dir = path.dirname(HTML_PATH);
  const bron = fs.readFileSync(HTML_PATH, 'utf8');
  const sw = fs.readFileSync(path.join(dir, 'sw.js'), 'utf8');

  // De deploy leest APP_VERSION met dit patroon; wijkt de regel af, dan
  // stempelt hij niets en blijft iedereen op een oude cache hangen.
  const gelezen = /^const APP_VERSION = '(\d+\.\d+\.\d+)';$/m.exec(bron);
  assert(gelezen, 'deploy.yml kan APP_VERSION niet uit index.html lezen met zijn sed-patroon');
  assert('v' + gelezen[1] === getoond, `topbar toont ${getoond} maar APP_VERSION is ${gelezen[1]}`);
  assert(sw.includes("const CACHE_NAME = 'joga-bonito-dev';"),
    "sw.js mist de regel die deploy.yml vervangt: const CACHE_NAME = 'joga-bonito-dev';");

  const workflow = path.join(dir, '.github/workflows/deploy.yml');
  if (fs.existsSync(workflow)) {
    const yml = fs.readFileSync(workflow, 'utf8');
    assert(yml.includes("const CACHE_NAME = 'joga-bonito-dev';"),
      'deploy.yml zoekt naar een andere cacheregel dan er in sw.js staat');
    assert(yml.includes('APP_VERSION'), 'deploy.yml leest het versienummer niet meer uit');
  }

  // De changelog moet de versie beschrijven die daadwerkelijk uitgerold wordt.
  const changelog = path.join(dir, 'CHANGELOG.md');
  assert(fs.existsSync(changelog), 'CHANGELOG.md ontbreekt');
  const bovenste = /^##\s*\[(\d+\.\d+\.\d+)\]/m.exec(fs.readFileSync(changelog, 'utf8'));
  assert(bovenste, 'geen versiekop gevonden in CHANGELOG.md');
  assert(bovenste[1] === gelezen[1],
    `changelog begint bij ${bovenste[1]} maar de app draait op ${gelezen[1]}`);
  return `${getoond}, changelog gelijk`;
});

await check('een stand uit een andere poule wordt niet als actueel gepresenteerd', () => {
  // srza publiceert de nieuwe poulestand pas bij de competitiestart en herziet
  // ondertussen soms de oude. De app moet dan onze eigen eindstand aanhouden.
  w.eval(`srzaData = {
    programma: [{ date:'2026-09-03', opp:'Limako', comp:'1A', time:'20:24', hal:'BUITEN', home:true },
                { date:'2026-09-09', opp:'Ally United', comp:'1A', time:'20:24', hal:'WATERWIJK', home:false }],
    uitslagen: [],
    standen: [{ pos:1, team:'As Sport Events', g:20, w:15, gl:3, v:2, dv:141, dt:76, ds:65, p:48 },
              { pos:2, team:'Joga Bonito', g:20, w:14, gl:2, v:4, dv:130, dt:63, ds:67, p:44 },
              { pos:3, team:'Old Legends', g:20, w:9, gl:3, v:8, dv:81, dt:73, ds:8, p:30 }],
    team: { position: 2 }
  };
  DB.season = '2026/27'; DB.matches = []; DB._seedVersion = 0; seedMatchesFromHistory();
  renderAnalysePage();`);

  const t = w.document.getElementById('analyseContent').textContent.replace(/\s+/g, ' ');
  assert(!/Podiumplaats: 2e|Positie 2 in de stand/.test(t),
    'de app presenteert een stand uit een andere poule als de huidige positie');
  assert(/3e/.test(t), `de vastgelegde eindstand (3e) komt niet terug: ${t.slice(0, 160)}`);

  // Spiegelbeeld: hoort de stand wél bij het programma, dan is hij actueel.
  const actueel = w.eval(`srzaStandVanDitSeizoen({
    programma: [{ opp: 'Old Legends' }, { opp: 'As Sport Events' }],
    standen: [{ team: 'As Sport Events', g: 5 }, { team: 'Joga Bonito', g: 5 }, { team: 'Old Legends', g: 5 }]
  })`);
  assert(actueel === true, 'een stand die wél bij het programma hoort wordt onterecht als oud gezien');
  return 'eindstand 2025/26 blijft 3e';
});

await check('srza-datums zijn ISO en renderen zonder NaN', () => {
  // new Date() struikelt over de Nederlandse maandnamen maart, mei en oktober,
  // dus de scraper moet alles als ISO wegschrijven.
  const srza = JSON.parse(fs.readFileSync(path.join(path.dirname(HTML_PATH), 'data/srza.json'), 'utf8'));
  const alle = [...(srza.programma || []), ...(srza.uitslagen || [])];
  const nietIso = alle.filter(m => !/^\d{4}-\d{2}-\d{2}$/.test(String(m.date || '')));
  assert(nietIso.length === 0,
    `${nietIso.length} datum(s) niet als ISO weggeschreven, bijv. "${nietIso[0] && nietIso[0].date}"`);

  const onleesbaar = alle.filter(m => isNaN(new Date(m.date)));
  assert(onleesbaar.length === 0, `${onleesbaar.length} datum(s) die de app niet kan lezen`);
  return `${(srza.programma||[]).length} aankomend, ${(srza.uitslagen||[]).length} uitslagen`;
});

await check('HISTORY uitslagen komen overeen met srza.json', () => {
  const srzaPad = path.join(path.dirname(HTML_PATH), 'data/srza.json');
  const srza = JSON.parse(fs.readFileSync(srzaPad, 'utf8'));
  const history = JSON.parse(w.eval("JSON.stringify(HISTORY['2025/26'].results)"));
  // srza.json bevat het lopende seizoen. Zodra dat niet meer 2025/26 is, valt er
  // niets te vergelijken — dat moet zichtbaar zijn en niet als "geslaagd" langs
  // glippen met nul controles.
  const overlap = srza.uitslagen.filter(s => history.some(r => r.date === s.date));
  if (!overlap.length) {
    return `overgeslagen — srza.json bevat geen wedstrijden uit 2025/26 (${srza.uitslagen.length} uitslagen)`;
  }

  const fouten = [];
  for (const s of overlap) {
    const h = history.find(r => r.date === s.date);
    if (!h) { fouten.push(`${s.date} ontbreekt in HISTORY`); continue; }
    if (h.jb !== s.jb || h.opp_s !== s.opp_s) {
      fouten.push(`${s.date} ${s.opp}: HISTORY ${h.jb}-${h.opp_s}, srza ${s.jb}-${s.opp_s}`);
    }
    if (h.home !== s.home) fouten.push(`${s.date} ${s.opp}: thuis/uit wijkt af`);
  }
  assert(fouten.length === 0, fouten.join('; '));
  return `${overlap.length} uitslagen gecontroleerd`;
});

console.log('');
if (failures.length) {
  console.error(`${failures.length} van de ${total} checks gefaald\n`);
  process.exit(1);
}
console.log(`Alle ${total} checks geslaagd\n`);
// pretendToBeVisual houdt een animatielus aan; expliciet afsluiten.
process.exit(0);
