// Walk-forward picks for every match (21 leagues, 6 seasons) with Bet365, best-bookmaker and Betfair exchange prices,
// written as one row per match so staking strategies (singles, 2/3/5/10-match tickets) can be compared weekend by weekend.
// Usage: node tools/strategy-backtest.mjs <outFile>   (server.js must be running)
import fs from 'node:fs/promises';
import { DEFAULT_SETTINGS, LEAGUES } from '../js/config.js';
import { walkForwardPredictions } from '../js/model/backtest.js';
import { loadLeagueSeasons } from './historyLoader.mjs';

const [outFile] = process.argv.slice(2);
const SEASONS = Number(process.env.SEASONS || 6);
const rows = [];
for (const league of LEAGUES.filter((l) => !l.pooled)) {
  const matches = await loadLeagueSeasons(league.code, SEASONS);
  const byId = new Map(matches.map((m) => [m.id, m]));
  const predictions = await walkForwardPredictions(matches, DEFAULT_SETTINGS);
  rows.push(...predictions.map((prediction) => matchRow(prediction, byId.get(prediction.match.id))));
  console.log(`${league.code}: ${predictions.length}`);
}
await fs.writeFile(outFile, JSON.stringify(rows));
console.log(`wrote ${rows.length} rows`);

// The model's pick in 1X2 and Over/Under 2.5 (the two markets with prices), its probability, and whether it won.
function matchRow({ match, probabilities: p, outcome }, source) {
  const side = ['home', 'draw', 'away'].reduce((best, key) => (p[key] > p[best] ? key : best), 'home');
  const goals = p.over25 >= 0.5 ? 'over25' : 'under25';
  const prices = (key) => ({ bet365: match.odds.opening[key] || null, best: source.otherOdds.best[key], exchange: source.otherOdds.exchange[key] });
  return {
    league: match.league, kickoff: match.kickoff.toISOString(),
    result: { probability: p[side], won: outcome.result === side, odds: prices(side) },
    goals: { probability: goals === 'over25' ? p.over25 : 1 - p.over25, won: goals === 'over25' ? outcome.over25 : !outcome.over25, odds: prices(goals) }
  };
}
