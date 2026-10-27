// Replays the three-market picks (1X2, BTTS, Over/Under 2.5) for chosen days and settles them with real scores.
// Picks come from fixtures.csv (with Bet365 opening odds) and a model fitted only on matches before that day.
// Scores come from ESPN's public scoreboard, because football-data.co.uk posts weekend results a few days late.
// Usage: node tools/weekend-replay.mjs <outFile> 24/10/2026 25/10/2026   (server.js must be running)
import fs from 'node:fs/promises';
import { parseCsv } from '../js/util/csv.js';
import { toMatchRecord } from '../js/data/matchRecord.js';
import { DEFAULT_SETTINGS, leagueByCode } from '../js/config.js';
import { LeagueModel } from '../js/model/leagueModel.js';
import { THREE_MARKETS, similarPicks, threeMarketPicks } from '../js/model/threeMarkets.js';
import { TeamNameMatcher } from '../js/data/teamNameMatcher.js';
import { loadLeagueSeasons } from './historyLoader.mjs';

const PROXY = process.env.PROXY || 'http://127.0.0.1:5350/api/fd';
const ESPN_SLUGS = {
  E0: 'eng.1', E1: 'eng.2', E2: 'eng.3', E3: 'eng.4', SP1: 'esp.1', SP2: 'esp.2', I1: 'ita.1', I2: 'ita.2',
  D1: 'ger.1', D2: 'ger.2', F1: 'fra.1', F2: 'fra.2', N1: 'ned.1', P1: 'por.1', B1: 'bel.1', T1: 'tur.1',
  G1: 'gre.1', SC0: 'sco.1', SC1: 'sco.2', SC2: 'sco.3', SC3: 'sco.4'
};
// Short forms in football-data names that fuzzy matching cannot expand on its own.
const ABBREVIATIONS = [[/\bRvs\b/, 'Rovers'], [/\bWeds\b/, 'Wednesday'], [/^Inverness C$/, 'Inverness Caledonian']];
const [outFile, ...days] = process.argv.slice(2);

const study = JSON.parse(await fs.readFile('data/three-markets-study.json', 'utf8'));
const fixtures = await weekendFixtures();
const rows = [];
for (const league of [...new Set(fixtures.map((f) => f.league))]) {
  rows.push(...await replayLeague(league, fixtures.filter((f) => f.league === league)));
}
rows.sort((a, b) => a.kickoff.localeCompare(b.kickoff) || a.league.localeCompare(b.league));
await fs.writeFile(outFile, JSON.stringify({ days, generatedAt: new Date().toISOString(), rows }, null, 1));
console.log(`${rows.length} matches, ${rows.filter((r) => r.score).length} with a final score`);

// The chosen days' rows from this week's fixture file, limited to leagues the model has history for.
async function weekendFixtures() {
  const response = await fetch(`${PROXY}/fixtures.csv`);
  return parseCsv(await response.text())
    .filter((row) => days.includes(row.Date) && ESPN_SLUGS[row.Div])
    .map((row) => toMatchRecord(row));
}

// Fit the league once per day on earlier matches only, price each fixture, then attach its final score.
async function replayLeague(league, leagueFixtures) {
  const history = await loadLeagueSeasons(league, 3);
  const scores = await espnScores(league);
  const teams = leagueFixtures.flatMap((f) => [f.home, f.away]);
  const longNames = new Map(teams.map((team) => [expand(team), team]));
  const matcher = new TeamNameMatcher({ [league]: league }, new Map([[league, [...longNames.keys()]]]));
  const nameOf = (espnName) => longNames.get(matcher.match(espnName, league).name);
  const fits = new Map();
  return leagueFixtures.map((fixture) => {
    const dayStart = new Date(fixture.kickoff.toISOString().slice(0, 10));
    if (!fits.has(dayStart.getTime())) fits.set(dayStart.getTime(), LeagueModel.fit(history, dayStart, DEFAULT_SETTINGS));
    const priced = threeMarketPicks(fits.get(dayStart.getTime()), fixture);
    const score = findScore(scores, fixture, nameOf);
    return settle(league, fixture, priced, score);
  });
}

function expand(name) {
  return ABBREVIATIONS.reduce((text, [pattern, full]) => text.replace(pattern, full), name);
}

// Each team plays once a weekend, so one recognised side is enough; both sides are tried first.
function findScore(scores, fixture, nameOf) {
  const both = scores.find((s) => nameOf(s.home) === fixture.home && nameOf(s.away) === fixture.away);
  if (both) return both;
  const either = scores.filter((s) => nameOf(s.home) === fixture.home || nameOf(s.away) === fixture.away);
  return either.length === 1 ? either[0] : undefined;
}

// Final scores for the league across the chosen days (ESPN dates are US time, so the day after is included).
async function espnScores(league) {
  const isoDays = days.map((d) => d.split('/').reverse().join(''));
  const lastDay = new Date(`${isoDays[isoDays.length - 1].replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3')}T00:00:00Z`);
  const dayAfter = new Date(lastDay.getTime() + 86400000).toISOString().slice(0, 10).replace(/-/g, '');
  const all = [];
  for (const day of [...isoDays, dayAfter]) {
    const response = await fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${ESPN_SLUGS[league]}/scoreboard?dates=${day}`);
    if (!response.ok) continue;
    const body = await response.json();
    (body.events || []).forEach((event) => {
      const competition = event.competitions[0];
      if (competition.status.type.name !== 'STATUS_FULL_TIME' && !competition.status.type.completed) return;
      const side = (where) => competition.competitors.find((c) => c.homeAway === where);
      all.push({ home: side('home').team.displayName, away: side('away').team.displayName, homeGoals: Number(side('home').score), awayGoals: Number(side('away').score) });
    });
  }
  return all;
}

// Win/loss and flat 1-unit profit for each of the three picks.
function settle(league, fixture, priced, score) {
  const base = {
    league, leagueName: `${leagueByCode(league).country} · ${leagueByCode(league).name}`,
    kickoff: fixture.kickoff.toISOString(), home: fixture.home, away: fixture.away,
    covered: priced.covered, score: score ? `${score.homeGoals}-${score.awayGoals}` : null
  };
  if (!priced.covered) return { ...base, picks: [] };
  const picks = THREE_MARKETS.map((market) => {
    const pick = priced.picks[market];
    const won = score ? pickWon(market, pick.choice, score) : null;
    const odds = Number.isFinite(pick.odds) ? pick.odds : null;
    const history = similarPicks(study, market, pick.probability);
    return {
      market, label: pick.label, probability: pick.probability, odds, won,
      profit: won === null || odds === null ? null : (won ? odds - 1 : -1),
      historicalHitRate: history?.hitRate ?? null
    };
  });
  return { ...base, picks };
}

function pickWon(market, choice, { homeGoals, awayGoals }) {
  if (market === 'result') return choice === (homeGoals > awayGoals ? 'home' : homeGoals === awayGoals ? 'draw' : 'away');
  if (market === 'btts') return (homeGoals > 0 && awayGoals > 0) === (choice === 'yes');
  return (homeGoals + awayGoals > 2.5) === (choice === 'over');
}
