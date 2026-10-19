// Replays the 2024-25 Champions League: rates clubs only on matches before each kick-off and scores the 1X2 forecasts.
// Usage: node tools/check-champions-league.mjs   (server.js must be running for the proxies)
import { parseCsv } from '../js/util/csv.js';
import { toMatchRecord } from '../js/data/matchRecord.js';
import { CHAMPIONS_LEAGUE, DEFAULT_SETTINGS } from '../js/config.js';
import { openFootballRecords } from '../js/data/championsLeague.js';
import { TeamNameMatcher } from '../js/data/teamNameMatcher.js';
import { LeagueModel } from '../js/model/leagueModel.js';
import { ScoreMatrix } from '../js/model/scoreMatrix.js';

const SERVER = 'http://127.0.0.1:5350';
const DOMESTIC_SEASONS = ['2122', '2223', '2324', '2425'];
const OUTCOMES = ['home', 'draw', 'away'];

const leagueCodes = [...new Set(Object.values(CHAMPIONS_LEAGUE.countryLeagues))];
const domestic = new Map(await Promise.all(leagueCodes.map(async (code) => [code, await loadDomestic(code)])));
const matcher = new TeamNameMatcher(CHAMPIONS_LEAGUE.countryLeagues, new Map([...domestic].map(([code, list]) => [code, [...new Set(list.flatMap((m) => [m.home, m.away]))]])));
const european = openFootballRecords(await (await fetch(`${SERVER}/api/of/2024-25/uefa.cl.json`)).json(), matcher).filter((m) => m.played);
const pool = [...[...domestic.values()].flat(), ...european].sort((a, b) => a.kickoff - b.kickoff);

const pooled = score((match) => forecast(LeagueModel.fit(pool, match.kickoff, DEFAULT_SETTINGS), match));
const withoutEurope = score((match) => forecast(LeagueModel.fit(pool.filter((m) => m.league !== 'CL'), match.kickoff, DEFAULT_SETTINGS), match));
report('Pooled model (domestic + earlier CL games)', pooled);
report('Same model without CL games (no league-strength link)', withoutEurope);

async function loadDomestic(code) {
  const seasons = await Promise.all(DOMESTIC_SEASONS.map(async (season) => {
    const response = await fetch(`${SERVER}/api/fd/mmz4281/${season}/${code}.csv`);
    if (!response.ok) return [];
    return parseCsv(await response.text()).filter((row) => row.HomeTeam && row.Date).flatMap((row) => {
      try { return [toMatchRecord(row)]; } catch { return []; }
    });
  }));
  return seasons.flat().filter((m) => m.played);
}

function forecast(model, match) {
  const sample = (team) => model.teamSample(team).matches;
  if (Math.min(sample(match.home), sample(match.away)) < DEFAULT_SETTINGS.minimumTeamMatches) return undefined;
  const expected = model.goals.table.expected(match.home, match.away);
  const matrix = new ScoreMatrix(expected.home, expected.away, DEFAULT_SETTINGS.dixonColesRho);
  return [matrix.sumWhere((h, a) => h > a), matrix.sumWhere((h, a) => h === a), matrix.sumWhere((h, a) => h < a)];
}

function score(predict) {
  const rows = [];
  european.forEach((match) => {
    const probabilities = predict(match);
    if (!probabilities) return;
    const s = match.stats;
    const actual = s.homeGoals > s.awayGoals ? 0 : s.homeGoals === s.awayGoals ? 1 : 2;
    rows.push({ probabilities, actual });
  });
  return rows;
}

function report(label, rows) {
  const counts = [0, 0, 0];
  rows.forEach((r) => counts[r.actual]++);
  const base = counts.map((c) => c / rows.length);
  const logLoss = rows.reduce((sum, r) => sum - Math.log(r.probabilities[r.actual]), 0) / rows.length;
  const baseLoss = rows.reduce((sum, r) => sum - Math.log(base[r.actual]), 0) / rows.length;
  const hits = rows.filter((r) => r.probabilities.indexOf(Math.max(...r.probabilities)) === r.actual).length;
  console.log(`${label}\n  matches rated: ${rows.length} of ${european.length} (rest have a club with <${DEFAULT_SETTINGS.minimumTeamMatches} matches)\n  log loss ${logLoss.toFixed(4)} vs base rate ${baseLoss.toFixed(4)}  (skill ${(100 * (1 - logLoss / baseLoss)).toFixed(1)}%)\n  favourite won ${(100 * hits / rows.length).toFixed(1)}%  | outcome mix ${OUTCOMES.map((o, i) => `${o} ${(100 * base[i]).toFixed(0)}%`).join(', ')}`);
}
