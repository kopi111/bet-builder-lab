// Evidence study for the three core markets: match result (1X2), both teams to score, over/under 2.5 goals.
// Every match is predicted walk-forward (the model only sees earlier matches), then we count how often the
// model's pick won and what it would have paid at Bet365's opening price.
// Usage: node tools/three-markets-study.mjs [outFile]   (server.js must be running for the CSV proxy)
import fs from 'node:fs/promises';
import { DEFAULT_SETTINGS, LEAGUES } from '../js/config.js';
import { walkForwardPredictions } from '../js/model/backtest.js';
import { removeMargin } from '../js/model/value.js';
import { seededRandom } from '../js/util/distributions.js';
import { loadLeagueSeasons } from './historyLoader.mjs';

const OUT_FILE = process.argv[2] || 'data/three-markets-study.json';
const SEASONS = Number(process.env.SEASONS || 6);
const UNSEEN_FROM = '2025-07-01';
const VALUE_EDGE = 0.03;
const BOOTSTRAP_SAMPLES = 1000;
const CONFIDENCE_BANDS = [[0, 0.45], [0.45, 0.5], [0.5, 0.55], [0.55, 0.6], [0.6, 0.65], [0.65, 0.7], [0.7, 0.75], [0.75, 1.01]];
const MARKETS = ['result', 'btts', 'goals'];

const picks = await predictEveryLeague();
const study = buildStudy(picks);
await fs.mkdir('data', { recursive: true });
await fs.writeFile(OUT_FILE, JSON.stringify(study, null, 1));
console.log(`Wrote ${OUT_FILE}: ${picks.length} matches`);

// Runs the walk-forward model league by league (one at a time; it is CPU-heavy) and keeps one pick row per match.
async function predictEveryLeague() {
  const domestic = LEAGUES.filter((league) => !league.pooled);
  const rows = [];
  for (const league of domestic) {
    const matches = await loadLeagueSeasons(league.code, SEASONS);
    const predictions = await walkForwardPredictions(matches, DEFAULT_SETTINGS);
    rows.push(...predictions.map(pickRow));
    console.log(`${league.code}: ${predictions.length} matches predicted`);
  }
  return rows;
}

// The model's choice in each of the three markets for one match, plus what actually happened and the prices.
function pickRow({ match, probabilities: p, outcome }) {
  const { opening, closing } = match.odds;
  const resultSides = ['home', 'draw', 'away'];
  const resultPick = resultSides.reduce((best, side) => (p[side] > p[best] ? side : best), 'home');
  const resultIndex = resultSides.indexOf(resultPick);
  const overPicked = p.over25 >= 0.5;
  const bttsPicked = p.bothScore >= 0.5;
  return {
    league: match.league,
    date: match.kickoff.toISOString().slice(0, 10),
    outcome: { result: outcome.result, over25: outcome.over25, btts: outcome.bothScore },
    odds: { home: opening.home, draw: opening.draw, away: opening.away, over25: opening.over25, under25: opening.under25 },
    result: leg(resultPick, p[resultPick], outcome.result === resultPick, opening[resultPick],
      removeMargin([closing.home, closing.draw, closing.away]).fair[resultIndex]),
    btts: leg(bttsPicked ? 'yes' : 'no', bttsPicked ? p.bothScore : 1 - p.bothScore, outcome.bothScore === bttsPicked, NaN, NaN),
    goals: leg(overPicked ? 'over' : 'under', overPicked ? p.over25 : 1 - p.over25, outcome.over25 === overPicked,
      overPicked ? opening.over25 : opening.under25, removeMargin([closing.over25, closing.under25]).fair[overPicked ? 0 : 1])
  };
}

// One market pick: what was chosen, how sure the model was, whether it won, the price and the margin-free closing chance.
function leg(pick, probability, won, odds, closingFair) {
  return { pick, probability, won, odds: validOdds(odds), closingFair: Number.isFinite(closingFair) ? closingFair : null };
}

function validOdds(odds) {
  return Number.isFinite(odds) && odds > 1 ? odds : null;
}

// Everything the dashboard shows, computed from the pick rows.
function buildStudy(rows) {
  const unseen = rows.filter((row) => row.date >= UNSEEN_FROM);
  return {
    generatedAt: new Date().toISOString(),
    matches: rows.length,
    from: rows.reduce((min, row) => (row.date < min ? row.date : min), '9999'),
    to: rows.reduce((max, row) => (row.date > max ? row.date : max), '0000'),
    unseenFrom: UNSEEN_FROM,
    unseenMatches: unseen.length,
    leagues: [...new Set(rows.map((row) => row.league))],
    baseRates: baseRates(rows),
    perLeague: perLeagueBaseRates(rows),
    markets: Object.fromEntries(MARKETS.map((market) => [market, marketEvidence(rows, unseen, market)])),
    blind: blindStrategies(rows),
    combinations: combinations(rows)
  };
}

// How often each outcome happens in general, with no model at all.
function baseRates(rows) {
  const share = (test) => rows.filter(test).length / rows.length;
  return {
    home: share((r) => r.outcome.result === 'home'),
    draw: share((r) => r.outcome.result === 'draw'),
    away: share((r) => r.outcome.result === 'away'),
    bttsYes: share((r) => r.outcome.btts),
    over25: share((r) => r.outcome.over25)
  };
}

function perLeagueBaseRates(rows) {
  const leagues = [...new Set(rows.map((row) => row.league))];
  return Object.fromEntries(leagues.map((code) => {
    const leagueRows = rows.filter((row) => row.league === code);
    return [code, { matches: leagueRows.length, ...baseRates(leagueRows) }];
  }));
}

// For one market: results by how confident the model was, overall, with a value filter, and on unseen seasons only.
function marketEvidence(rows, unseen, market) {
  const legs = rows.map((row) => row[market]);
  const unseenLegs = unseen.map((row) => row[market]);
  return {
    all: legStats(legs),
    unseen: legStats(unseenLegs),
    valueOnly: legStats(legs.filter(hasValue)),
    valueOnlyUnseen: legStats(unseenLegs.filter(hasValue)),
    bands: CONFIDENCE_BANDS.map(([from, to]) => {
      const inBand = (l) => l.probability >= from && l.probability < to;
      return { from, to: Math.min(to, 1), ...legStats(legs.filter(inBand)), unseen: legStats(unseenLegs.filter(inBand)) };
    }).filter((band) => band.bets > 0)
  };
}

function hasValue(l) {
  return l.odds !== null && l.probability * l.odds - 1 >= VALUE_EDGE;
}

// Hit rate, the model's own average confidence, and flat-stake profit where a Bet365 price exists.
function legStats(legs) {
  const priced = legs.filter((l) => l.odds !== null);
  const profits = priced.map((l) => (l.won ? l.odds - 1 : -1));
  const withClosing = priced.filter((l) => l.closingFair !== null);
  return {
    bets: legs.length,
    hitRate: legs.length ? legs.filter((l) => l.won).length / legs.length : null,
    averageProbability: legs.length ? legs.reduce((sum, l) => sum + l.probability, 0) / legs.length : null,
    pricedBets: priced.length,
    priceHitRate: priced.length ? priced.filter((l) => l.won).length / priced.length : null,
    averageOdds: priced.length ? priced.reduce((sum, l) => sum + l.odds, 0) / priced.length : null,
    roi: priced.length ? profits.reduce((a, b) => a + b, 0) / priced.length : null,
    roiInterval: bootstrapInterval(profits),
    closingLineValue: withClosing.length ? withClosing.reduce((sum, l) => sum + l.odds * l.closingFair - 1, 0) / withClosing.length : null
  };
}

// Simple rules that need no model, so the model's picks have something honest to be compared against.
function blindStrategies(rows) {
  const flat = (name, chooser) => {
    const legs = rows.map(chooser).filter(Boolean);
    return { name, ...legStats(legs) };
  };
  return [
    flat('Always back the bookmaker favourite (1X2)', favouriteLeg),
    flat('Always back the home team', (r) => priced(r.odds.home, r.outcome.result === 'home')),
    flat('Always back the draw', (r) => priced(r.odds.draw, r.outcome.result === 'draw')),
    flat('Always back Over 2.5', (r) => priced(r.odds.over25, r.outcome.over25)),
    flat('Always back Under 2.5', (r) => priced(r.odds.under25, !r.outcome.over25)),
    flat('Always back BTTS Yes (no odds in the free data)', (r) => ({ probability: 0, won: r.outcome.btts, odds: null, closingFair: null }))
  ];
}

function favouriteLeg(row) {
  const sides = ['home', 'away'].filter((side) => row.odds[side]);
  if (sides.length < 2) return undefined;
  const side = row.odds.home <= row.odds.away ? 'home' : 'away';
  return priced(row.odds[side], row.outcome.result === side);
}

function priced(odds, won) {
  return validOdds(odds) ? { probability: 0, won, odds, closingFair: null } : undefined;
}

// Putting the three picks together in one bet: how often all of them come in.
function combinations(rows) {
  const allThreeRight = (r) => r.result.won && r.btts.won && r.goals.won;
  const strong = rows.filter((r) => MARKETS.every((m) => r[m].probability >= 0.6));
  const share = (list, test) => (list.length ? list.filter(test).length / list.length : null);
  return {
    trebleAll: { matches: rows.length, hitRate: share(rows, allThreeRight), modelAverage: average(rows.map((r) => r.result.probability * r.btts.probability * r.goals.probability)) },
    trebleStrong: { matches: strong.length, hitRate: share(strong, allThreeRight) },
    homeBttsOver: { label: 'Home win + BTTS Yes + Over 2.5', hitRate: share(rows, (r) => r.outcome.result === 'home' && r.outcome.btts && r.outcome.over25) },
    awayBttsOver: { label: 'Away win + BTTS Yes + Over 2.5', hitRate: share(rows, (r) => r.outcome.result === 'away' && r.outcome.btts && r.outcome.over25) },
    bttsAndOver: { label: 'BTTS Yes + Over 2.5', hitRate: share(rows, (r) => r.outcome.btts && r.outcome.over25) },
    bttsYesGivenOver: { label: 'BTTS Yes when there were 3+ goals', hitRate: share(rows.filter((r) => r.outcome.over25), (r) => r.outcome.btts) }
  };
}

function average(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

// 95% range for ROI by resampling the bets, so a lucky streak is not mistaken for an edge.
function bootstrapInterval(profits) {
  if (profits.length < 30) return null;
  const random = seededRandom(20261026);
  const rois = Array.from({ length: BOOTSTRAP_SAMPLES }, () => {
    let total = 0;
    for (let i = 0; i < profits.length; i++) total += profits[Math.floor(random() * profits.length)];
    return total / profits.length;
  }).sort((a, b) => a - b);
  return { low: rois[Math.floor(BOOTSTRAP_SAMPLES * 0.025)], high: rois[Math.floor(BOOTSTRAP_SAMPLES * 0.975)] };
}
