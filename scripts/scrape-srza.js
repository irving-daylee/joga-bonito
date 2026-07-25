import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as cheerio from 'cheerio';

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- Config (update at start of each season) ---
// Te overschrijven met env vars om een nieuwe poule te proberen zonder het
// script aan te passen: COMP_NR=7 node scripts/scrape-srza.js
const TEAM = 'JOGA BONITO';
const TEAM_ID = Number(process.env.TEAM_ID || 358);
const COMP_NR = Number(process.env.COMP_NR || 3); // Poule 1B = nr 3

const URLS = {
  standen: `https://www.srza.nl/standen/?nr=${COMP_NR}`,
  uitslagen: `https://www.srza.nl/uitslagen/?t=${TEAM_ID}`,
  programma: `https://www.srza.nl/programma/?t=${TEAM_ID}`,
};

async function fetchPage(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.text();
}

function parseDate(str) {
  const [d, m, y] = str.split('-');
  if (!d || !m || !y) return str;
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

function titleCase(str) {
  return str.trim().toLowerCase().replace(/(^|\s)\S/g, c => c.toUpperCase());
}

function parseStanden(html) {
  const $ = cheerio.load(html);
  const rows = [];
  $('table.srza-standings-table tbody tr').each((_, tr) => {
    const td = $(tr).find('td');
    rows.push({
      pos: parseInt(td.filter('.col-position').text().replace('.', '')) || 0,
      team: titleCase(td.filter('.col-team').text()),
      g: parseInt(td.filter('.col-played').text()) || 0,
      w: parseInt(td.filter('.col-won').text()) || 0,
      gl: parseInt(td.filter('.col-draw').text()) || 0,
      v: parseInt(td.filter('.col-lost').text()) || 0,
      dv: parseInt(td.filter('.col-goals-for').text()) || 0,
      dt: parseInt(td.filter('.col-goals-against').text()) || 0,
      ds: parseInt(td.filter('.col-goal-diff').text()) || 0,
      p: parseInt(td.filter('.col-points').text()) || 0,
    });
  });
  return rows;
}

function parseUitslagen(html) {
  const $ = cheerio.load(html);
  const rows = [];
  $('table tbody tr').each((_, tr) => {
    const td = $(tr).find('td');
    if (td.length < 8) return;

    const home = td.eq(5).text().trim();
    const away = td.eq(6).text().trim();
    const scoreStr = td.eq(7).text().trim();
    const parts = scoreStr.split('-').map(s => parseInt(s.trim()));
    if (parts.length !== 2 || isNaN(parts[0]) || isNaN(parts[1])) return;

    const isHome = home.toUpperCase().includes(TEAM);
    rows.push({
      date: parseDate(td.eq(2).text().trim()),
      comp: td.eq(1).text().trim(),
      time: td.eq(3).text().trim(),
      hal: td.eq(4).text().trim(),
      opp: titleCase(isHome ? away : home),
      home: isHome,
      jb: isHome ? parts[0] : parts[1],
      opp_s: isHome ? parts[1] : parts[0],
    });
  });
  return rows;
}

function parseProgramma(html) {
  const $ = cheerio.load(html);
  const rows = [];
  $('table tbody tr').each((_, tr) => {
    const td = $(tr).find('td');
    if (td.length < 6) return;

    let home, away;
    if (td.length >= 7) {
      home = td.eq(5).text().trim();
      away = td.eq(6).text().trim();
    } else {
      const parts = td.eq(5).text().trim().split(/\s*-\s*/);
      home = parts[0] || '';
      away = parts[1] || '';
    }
    if (!home && !away) return;

    const isHome = home.toUpperCase().includes(TEAM);
    rows.push({
      date: parseDate(td.eq(2).text().trim()),
      comp: td.eq(1).text().trim(),
      time: td.eq(3).text().trim(),
      hal: td.eq(4).text().trim(),
      opp: titleCase(isHome ? away : home),
      home: isHome,
    });
  });
  return rows;
}

async function main() {
  const month = new Date().getMonth();
  if ((month === 6 || month === 7) && !process.env.FORCE) {
    console.log('Off-season (jul/aug), skipping. Set FORCE=1 to override.');
    return;
  }

  console.log('Scraping srza.nl...');
  const [standenHtml, uitslagenHtml, programmaHtml] = await Promise.all([
    fetchPage(URLS.standen),
    fetchPage(URLS.uitslagen),
    fetchPage(URLS.programma),
  ]);

  const standen = parseStanden(standenHtml);
  const uitslagen = parseUitslagen(uitslagenHtml);
  const programma = parseProgramma(programmaHtml);

  const wins = uitslagen.filter(r => r.jb > r.opp_s).length;
  const draws = uitslagen.filter(r => r.jb === r.opp_s).length;
  const losses = uitslagen.filter(r => r.jb < r.opp_s).length;
  const goalsFor = uitslagen.reduce((s, r) => s + r.jb, 0);
  const goalsAgainst = uitslagen.reduce((s, r) => s + r.opp_s, 0);

  const jbRow = standen.find(r => r.team.toUpperCase().includes(TEAM));

  // Een verkeerde poule geeft gewoon HTTP 200 met de stand van een ander
  // team. Zonder deze controle publiceren we dan stilletjes vreemde cijfers.
  if (!standen.length) {
    throw new Error(`Geen stand gevonden op ${URLS.standen} — klopt COMP_NR=${COMP_NR} nog?`);
  }
  if (!jbRow) {
    throw new Error(
      `${TEAM} staat niet in de stand van poule nr=${COMP_NR}.\n` +
      `Gevonden teams: ${standen.map(r => r.team).join(', ')}\n` +
      `Werk TEAM_ID/COMP_NR bovenaan dit script bij voor het nieuwe seizoen.`
    );
  }

  const data = {
    lastUpdated: new Date().toISOString(),
    team: {
      played: uitslagen.length,
      wins, draws, losses,
      goalsFor, goalsAgainst,
      position: jbRow?.pos ?? null,
      points: jbRow?.p ?? null,
    },
    standen,
    uitslagen,
    programma,
  };

  const outDir = resolve(__dirname, '..', 'data');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const outPath = resolve(outDir, 'srza.json');
  writeFileSync(outPath, JSON.stringify(data, null, 2));

  console.log(`Done: ${standen.length} teams, ${uitslagen.length} results, ${programma.length} upcoming`);
  console.log(`Written to ${outPath}`);
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
