// Builds a static copy of the app in _site/ for GitHub Pages: the app files plus a snapshot of every data file
// the browser would otherwise ask server.js for. Run by .github/workflows/pages.yml every few hours.
// Usage: node tools/build-static.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHAMPIONS_LEAGUE, LEAGUES, seasonCodes } from '../js/config.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = path.join(ROOT, '_site');
const APP_FILES = ['index.html', 'script.js', 'style.css', 'js', 'data', 'ml/output'];
const FOOTBALL_DATA = 'https://www.football-data.co.uk';
const ESPN_SCOREBOARD = 'https://site.api.espn.com/apis/site/v2/sports/soccer/all/scoreboard';
const OPENFOOTBALL = 'https://raw.githubusercontent.com/openfootball/football.json/master';
const ESPN_DAYS = 7;
const DAY_MS = 86400000;

await fs.rm(SITE, { recursive: true, force: true });
await copyAppFiles();
await writeDataSnapshot();
console.log(`Static site ready in ${SITE}`);

async function copyAppFiles() {
  await Promise.all(APP_FILES.map((file) => fs.cp(path.join(ROOT, file), path.join(SITE, file), { recursive: true })));
}

async function writeDataSnapshot() {
  const downloads = [
    ['api/fd/fixtures.csv', `${FOOTBALL_DATA}/fixtures.csv`],
    ...LEAGUES.filter((league) => !league.pooled).flatMap((league) => seasonCodes().map((season) =>
      [`api/fd/mmz4281/${season}/${league.code}.csv`, `${FOOTBALL_DATA}/mmz4281/${season}/${league.code}.csv`])),
    ...espnDays().map((day) => [`api/espn/scoreboard/${day}.json`, `${ESPN_SCOREBOARD}?dates=${day}`]),
    ...CHAMPIONS_LEAGUE.pastSeasonFiles.map((season) => [`api/of/${season}/uefa.cl.json`, `${OPENFOOTBALL}/${season}/uefa.cl.json`])
  ];
  const failures = [];
  for (const [target, source] of downloads) {
    try {
      await saveDownload(target, source);
    } catch (error) {
      failures.push(`${target}: ${error.message}`);
    }
  }
  await saveText('api/status', JSON.stringify({
    footballData: { configured: true, snapshot: true },
    apiFootball: { configured: false },
    footballDataOrg: { configured: false },
    serverTime: new Date().toISOString()
  }));
  console.log(`${downloads.length - failures.length} of ${downloads.length} data files saved.`);
  failures.forEach((failure) => console.warn(`Skipped ${failure}`));
}

function espnDays() {
  return Array.from({ length: ESPN_DAYS }, (_, index) => new Date(Date.now() + index * DAY_MS).toISOString().slice(0, 10).replaceAll('-', ''));
}

async function saveDownload(target, source) {
  const response = await fetch(source, { redirect: 'follow', signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  await saveText(target, Buffer.from(await response.arrayBuffer()));
}

async function saveText(target, body) {
  const file = path.join(SITE, target);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, body);
}
