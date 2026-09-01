import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as cheerio from 'cheerio';

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- Config (bijwerken bij de start van een nieuw seizoen) ---
// srza.nl is in augustus 2026 verbouwd: team, seizoen en poule gaan nu via een
// POST in plaats van een parameter in de URL. De waarden komen uit de
// keuzelijsten op de site; `node scripts/scrape-srza.js --opties` toont ze.
// Te overschrijven via env vars: POULE=4 node scripts/scrape-srza.js
const TEAM = 'JOGA BONITO';
const TEAM_ID = process.env.TEAM_ID || '358';
const SEIZOEN = process.env.SEIZOEN || '2';  // 2 = 2026/2027
const POULE = process.env.POULE || '2';      // 2 = Eerste Klasse A

const BASIS = 'https://www.srza.nl';
const URLS = {
  standen: `${BASIS}/standen/`,
  uitslagen: `${BASIS}/uitslagen/`,
  programma: `${BASIS}/programma/`,
};

// srza.nl is af en toe even onbereikbaar. Een dagelijkse cron loopt daar vanzelf
// een keer tegenaan, dus opnieuw proberen in plaats van de run rood laten worden.
// De melding noemt de URL en de onderliggende oorzaak; kaal "fetch failed"
// vertelt je niet waar het misging.
async function fetchPage(url, velden = {}, pogingen = 3) {
  let laatste;
  for (let poging = 1; poging <= pogingen; poging++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(velden),
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      laatste = err;
      const oorzaak = err.cause?.code || err.cause?.message || err.message;
      console.warn(`  poging ${poging}/${pogingen} mislukt voor ${url}: ${oorzaak}`);
      if (poging < pogingen) await new Promise(r => setTimeout(r, poging * 3000));
    }
  }
  const oorzaak = laatste.cause?.code || laatste.cause?.message || laatste.message;
  throw new Error(`${url} onbereikbaar na ${pogingen} pogingen → ${oorzaak}`);
}

const MAANDEN = ['januari','februari','maart','april','mei','juni',
                 'juli','augustus','september','oktober','november','december'];
const AFKORTINGEN = ['jan','feb','mrt','apr','mei','jun','jul','aug','sep','okt','nov','dec'];

// De site schrijft datums als "do 3 sep 2026", vroeger als "donderdag 3
// september 2026" of "11-09-2025". Alles wordt ISO, want new Date() struikelt
// over de Nederlandse maandnamen maart, mei en oktober.
function parseDate(str) {
  const tekst = String(str || '').trim();

  const nl = tekst.toLowerCase().match(/(\d{1,2})\s+([a-zé]+)\.?\s+(\d{4})/);
  if (nl) {
    const maand = MAANDEN.indexOf(nl[2]) >= 0
      ? MAANDEN.indexOf(nl[2])
      : AFKORTINGEN.indexOf(nl[2].slice(0, 3));
    if (maand >= 0) {
      return `${nl[3]}-${String(maand + 1).padStart(2, '0')}-${nl[1].padStart(2, '0')}`;
    }
  }

  const [d, m, y] = tekst.split('-');
  if (!d || !m || !y) return tekst;
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

function titleCase(str) {
  return String(str || '').trim().toLowerCase().replace(/(^|\s)\S/g, c => c.toUpperCase());
}

// Kolommen worden op kop gezocht in plaats van op positie: schuift de site er
// een kolom tussen, dan blijft dit werken in plaats van stil te verschuiven.
function leesTabel(html, verplichteKoppen) {
  const $ = cheerio.load(html);
  let resultaat = null;
  $('table').each((_, tbl) => {
    if (resultaat) return;
    const koppen = $(tbl).find('thead th').map((i, th) => $(th).text().trim().toLowerCase()).get();
    if (!verplichteKoppen.every(k => koppen.includes(k))) return;
    const rijen = [];
    $(tbl).find('tbody tr').each((__, tr) => {
      const cellen = $(tr).find('td').map((i, td) => $(td).text().trim().replace(/\s+/g, ' ')).get();
      if (cellen.length < koppen.length - 2) return;
      const rij = {};
      koppen.forEach((k, i) => { rij[k] = cellen[i] ?? ''; });
      rijen.push(rij);
    });
    resultaat = { koppen, rijen };
  });
  return resultaat;
}

// "JOGA BONITO–LIMAKO" (en dash) → thuis- en uitteam.
function splitsWedstrijd(tekst) {
  const delen = String(tekst || '').split(/\s*[–—]\s*/);
  if (delen.length < 2) return null;
  return { home: delen[0].trim(), away: delen[1].trim() };
}

function parseStanden(html) {
  const tabel = leesTabel(html, ['team', 'g', 'w', 'p']);
  if (!tabel) return [];
  const getal = v => parseInt(String(v).replace(/[^\d-]/g, ''), 10) || 0;
  return tabel.rijen
    .filter(r => r['team'])
    .map(r => ({
      pos: getal(r['#']),
      team: titleCase(r['team']),
      g: getal(r['g']), w: getal(r['w']), gl: getal(r['gl']), v: getal(r['v']),
      dv: getal(r['dv']), dt: getal(r['dt']), ds: getal(r['ds']), p: getal(r['p']),
    }));
}

function parseWedstrijden(html, metUitslag) {
  const tabel = leesTabel(html, ['datum', 'wedstrijd']);
  if (!tabel) return [];
  const rows = [];
  for (const r of tabel.rijen) {
    const teams = splitsWedstrijd(r['wedstrijd']);
    if (!teams) continue;
    const isHome = teams.home.toUpperCase().includes(TEAM);
    const isAway = teams.away.toUpperCase().includes(TEAM);
    if (!isHome && !isAway) continue;

    const basis = {
      date: parseDate(r['datum']),
      comp: r['poule'] || '',
      time: r['tijd'] || '',
      hal: r['hal'] || '',
      opp: titleCase(isHome ? teams.away : teams.home),
      home: isHome,
    };

    if (!metUitslag) { rows.push(basis); continue; }

    const score = String(r['uitslag'] || '').split(/\s*-\s*/).map(s => parseInt(s.trim(), 10));
    if (score.length !== 2 || score.some(isNaN)) continue;
    rows.push({ ...basis, jb: isHome ? score[0] : score[1], opp_s: isHome ? score[1] : score[0] });
  }
  return rows;
}

// De programmapagina toont ook een tabelletje met de zaaldiensten van het team.
function parseZaaldiensten(html) {
  const tabel = leesTabel(html, ['datum', 'tijd', 'hal']);
  if (!tabel || tabel.koppen.includes('wedstrijd')) return [];
  return tabel.rijen
    .filter(r => r['datum'])
    .map(r => ({ date: parseDate(r['datum']), time: r['tijd'] || '', hal: r['hal'] || '' }))
    .filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r.date));
}

async function toonOpties() {
  const html = await fetchPage(URLS.standen, {});
  const $ = cheerio.load(html);
  for (const naam of ['srza_seizoen', 'srza_poule']) {
    console.log(`${naam}:`);
    $(`select[name=${naam}] option`).each((_, o) =>
      console.log(`   ${($(o).attr('value') || '(leeg)').padStart(6)} = ${$(o).text().trim()}`));
  }
}

async function main() {
  if (process.argv.includes('--opties')) return toonOpties();

  const maand = new Date().getMonth();
  if (!process.env.FORCE && (maand === 6 || maand === 7)) {
    console.log('Zomerstop (juli/augustus) — overgeslagen. Gebruik FORCE=1 om toch te draaien.');
    return;
  }

  console.log(`Scraping srza.nl (seizoen ${SEIZOEN}, poule ${POULE}, team ${TEAM_ID})...`);
  const [standenHtml, uitslagenHtml, programmaHtml] = await Promise.all([
    fetchPage(URLS.standen, { srza_seizoen: SEIZOEN, srza_poule: POULE }),
    fetchPage(URLS.uitslagen, { srza_team: TEAM_ID, srza_seizoen: SEIZOEN }),
    fetchPage(URLS.programma, { srza_team: TEAM_ID, srza_seizoen: SEIZOEN }),
  ]);

  const standen = parseStanden(standenHtml);
  const uitslagen = parseWedstrijden(uitslagenHtml, true);
  const programma = parseWedstrijden(programmaHtml, false);
  const zaaldiensten = parseZaaldiensten(programmaHtml);

  const jbRow = standen.find(r => r.team.toUpperCase().includes(TEAM));

  // Een verkeerde poule geeft gewoon HTTP 200 met de stand van een ander team.
  // Zonder deze controle publiceren we dan stilletjes vreemde cijfers. Een lege
  // tabel is iets anders: die hoort bij het begin van het seizoen.
  if (!standen.length) {
    console.warn(`Let op: geen stand voor seizoen ${SEIZOEN} poule ${POULE}. ` +
      `Aan het begin van het seizoen is dat normaal; blijft het staan zodra er gespeeld is, ` +
      `controleer dan SEIZOEN/POULE met --opties.`);
  } else if (!jbRow) {
    throw new Error(
      `${TEAM} staat niet in de stand van seizoen ${SEIZOEN}, poule ${POULE}.\n` +
      `Gevonden teams: ${standen.map(r => r.team).join(', ')}\n` +
      `Werk SEIZOEN/POULE bovenaan dit script bij; \`--opties\` toont de keuzes.`
    );
  }

  const wins = uitslagen.filter(r => r.jb > r.opp_s).length;
  const draws = uitslagen.filter(r => r.jb === r.opp_s).length;
  const losses = uitslagen.filter(r => r.jb < r.opp_s).length;

  const data = {
    lastUpdated: new Date().toISOString(),
    team: {
      played: uitslagen.length,
      wins, draws, losses,
      goalsFor: uitslagen.reduce((s, r) => s + r.jb, 0),
      goalsAgainst: uitslagen.reduce((s, r) => s + r.opp_s, 0),
      position: jbRow?.pos ?? null,
      points: jbRow?.p ?? null,
    },
    standen,
    uitslagen,
    programma,
    zaaldiensten,
  };

  const outDir = resolve(__dirname, '..', 'data');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const outPath = resolve(outDir, 'srza.json');

  // Nooit goede gegevens overschrijven met een lege oogst: als de site tijdelijk
  // niets teruggeeft of opnieuw verbouwd wordt, is het bestaande bestand beter
  // dan een leeg bestand.
  if (existsSync(outPath) && !standen.length && !uitslagen.length && !programma.length) {
    const oud = JSON.parse(readFileSync(outPath, 'utf8'));
    const hadInhoud = (oud.standen?.length || 0) + (oud.uitslagen?.length || 0) + (oud.programma?.length || 0);
    if (hadInhoud) {
      throw new Error(
        `Niets gevonden op srza.nl, terwijl het huidige bestand ${hadInhoud} regels heeft.\n` +
        `Waarschijnlijk is de site aangepast. Bestand niet overschreven.`
      );
    }
  }

  writeFileSync(outPath, JSON.stringify(data, null, 2));
  console.log(`Done: ${standen.length} teams, ${uitslagen.length} results, ` +
    `${programma.length} upcoming, ${zaaldiensten.length} zaaldiensten`);
  console.log(`Written to ${outPath}`);
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
