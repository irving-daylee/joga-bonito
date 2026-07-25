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

function stubScript(snapshot) {
  return `<script>
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
async function loadAndLogin(snapshot) {
  const html = fs.readFileSync(HTML_PATH, 'utf8')
    .replace(/<script src="https:\/\/www\.gstatic\.com\/firebasejs[^"]*"><\/script>\s*/g, '')
    .replace('</head>', `${stubScript(snapshot)}\n</head>`);

  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', noteError);

  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'http://localhost/', virtualConsole });
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

await check('HISTORY uitslagen komen overeen met srza.json', () => {
  const srzaPad = path.join(path.dirname(HTML_PATH), 'data/srza.json');
  const srza = JSON.parse(fs.readFileSync(srzaPad, 'utf8'));
  const history = JSON.parse(w.eval("JSON.stringify(HISTORY['2025/26'].results)"));
  const fouten = [];
  for (const s of srza.uitslagen) {
    const h = history.find(r => r.date === s.date);
    if (!h) { fouten.push(`${s.date} ontbreekt in HISTORY`); continue; }
    if (h.jb !== s.jb || h.opp_s !== s.opp_s) {
      fouten.push(`${s.date} ${s.opp}: HISTORY ${h.jb}-${h.opp_s}, srza ${s.jb}-${s.opp_s}`);
    }
    if (h.home !== s.home) fouten.push(`${s.date} ${s.opp}: thuis/uit wijkt af`);
  }
  assert(fouten.length === 0, fouten.join('; '));
  return `${srza.uitslagen.length} uitslagen gecontroleerd`;
});

console.log('');
if (failures.length) {
  console.error(`${failures.length} van de ${total} checks gefaald\n`);
  process.exit(1);
}
console.log(`Alle ${total} checks geslaagd\n`);
