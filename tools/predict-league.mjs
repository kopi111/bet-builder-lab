// Walk-forward predictions for one league over several seasons, written as one bet candidate per market.
// Usage: node tools/predict-league.mjs <leagueCode> <outDir>   (server.js must be running for the CSV proxy)
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseCsv } from '../js/util/csv.js';
import { toMatchRecord } from '../js/data/matchRecord.js';
import { DEFAULT_SETTINGS, seasonCodes } from '../js/config.js';
import { walkForwardPredictions } from '../js/model/backtest.js';
import { ScoreMatrix } from '../js/model/scoreMatrix.js';
import { asianHandicapSettlement, removeMargin } from '../js/model/value.js';

const PROXY = process.env.PROXY || 'http://127.0.0.1:5350/api/fd';
const SEASONS = Number(process.env.SEASONS || 6);
const [leagueCode, outDir] = process.argv.slice(2);

const matches = await loadMatches(leagueCode);
const predictions = await walkForwardPredictions(matches, DEFAULT_SETTINGS);
const candidates = predictions.flatMap(betCandidates);
await fs.writeFile(path.join(outDir, `${leagueCode}.json`), JSON.stringify(candidates));
console.log(`${leagueCode}: ${matches.length} matches, ${predictions.length} predicted, ${candidates.length} priced candidates`);

async function loadMatches(code) {
  const seasons = await Promise.all(seasonCodes(new Date(), SEASONS).map((season) => loadSeason(code, season)));
  return seasons.flat().sort((a, b) => a.kickoff - b.kickoff);
}

async function loadSeason(code, season) {
  const response = await fetch(`${PROXY}/mmz4281/${season}/${code}.csv`);
  if (!response.ok) return [];
  return parseCsv(await response.text())
    .filter((row) => row.Div && row.HomeTeam && row.AwayTeam && row.Date)
    .flatMap((row) => {
      try { return [{ ...toMatchRecord(row), season }]; } catch { return []; }
    });
}

function betCandidates(prediction) {
  const { match, probabilities: p } = prediction;
  const { opening, closing } = match.odds;
  const s = match.stats;
  const result = s.homeGoals > s.awayGoals ? 'home' : s.homeGoals === s.awayGoals ? 'draw' : 'away';
  const goals = s.homeGoals + s.awayGoals;
  const threeWay = [closing.home, closing.draw, closing.away];
  const totals = [closing.over25, closing.under25];
  const rows = [
    candidate('home', p.home, opening.home, result === 'home' ? 1 : 0, threeWay, 0),
    candidate('draw', p.draw, opening.draw, result === 'draw' ? 1 : 0, threeWay, 1),
    candidate('away', p.away, opening.away, result === 'away' ? 1 : 0, threeWay, 2),
    candidate('over25', p.over25, opening.over25, goals > 2.5 ? 1 : 0, totals, 0),
    candidate('under25', 1 - p.over25, opening.under25, goals < 2.5 ? 1 : 0, totals, 1),
    ...handicapCandidates(prediction)
  ];
  return rows.filter(Boolean).map((row) => ({
    league: match.league, season: match.season, date: match.kickoff.toISOString().slice(0, 10), home: match.home, away: match.away, ...row
  }));
}

function candidate(market, probability, odds, won, closingSet, index) {
  if (!Number.isFinite(odds) || odds <= 1 || !Number.isFinite(probability)) return undefined;
  const fairClosing = removeMargin(closingSet).fair[index];
  return {
    market, probability: round(probability), odds, edge: round(probability * odds - 1),
    profit: round(won * odds - 1), won, clv: Number.isFinite(fairClosing) ? round(odds * fairClosing - 1) : null
  };
}

function handicapCandidates({ match, expectedGoals }) {
  const { handicapLine: line, handicapHome, handicapAway } = match.odds.opening;
  if (![line, handicapHome, handicapAway].every(Number.isFinite)) return [];
  const matrix = new ScoreMatrix(expectedGoals.home, expectedGoals.away, DEFAULT_SETTINGS.dixonColesRho);
  const margin = match.stats.homeGoals - match.stats.awayGoals;
  return [
    handicapCandidate('ahHome', asianHandicapSettlement(matrix, line), handicapHome, settleHandicap(margin, line)),
    handicapCandidate('ahAway', awaySettlement(asianHandicapSettlement(matrix, line)), handicapAway, settleHandicap(-margin, -line))
  ];
}

function awaySettlement({ win, push, lose }) {
  return { win: lose, push, lose: win };
}

function handicapCandidate(market, settlement, odds, payout) {
  const edge = settlement.win * (odds - 1) - settlement.lose;
  return { market, probability: round(settlement.win), odds, edge: round(edge), profit: round(payout(odds)), won: payout(odds) > 0 ? 1 : 0, clv: null };
}

function settleHandicap(margin, line) {
  const quarter = Math.round(line * 4) % 2 !== 0;
  const parts = quarter ? [line - 0.25, line + 0.25] : [line];
  return (odds) => parts.reduce((total, part) => {
    const adjusted = margin + part;
    const outcome = Math.abs(adjusted) < 1e-9 ? 0 : adjusted > 0 ? odds - 1 : -1;
    return total + outcome / parts.length;
  }, 0);
}

function round(value) {
  return Math.round(value * 10000) / 10000;
}
