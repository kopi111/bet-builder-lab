// The three core markets for one fixture: match result (1X2), both teams to score, over/under 2.5 goals.
// Each pick is the model's most likely answer in that market, with its fair price and, where Bet365 publishes one, the value gap.
import { ScoreMatrix } from './scoreMatrix.js';
import { expectedValue, removeMargin } from './value.js';

export const THREE_MARKETS = ['result', 'btts', 'goals'];

export function threeMarketPicks(league, fixture) {
  const expectedGoals = league.goals.table.expected(fixture.home, fixture.away);
  const matrix = new ScoreMatrix(expectedGoals.home, expectedGoals.away, league.settings.dixonColesRho);
  const odds = fixture.odds.opening;
  const best = fixture.odds.best || {};
  return {
    fixture,
    expectedGoals,
    covered: teamsCovered(league, fixture),
    picks: {
      result: resultPick(matrix, fixture, odds, best),
      btts: bttsPick(matrix),
      goals: goalsPick(matrix, odds, best)
    }
  };
}

// Both teams need enough league matches in the data, or the ratings are mostly guesswork.
function teamsCovered(league, fixture) {
  const fewest = Math.min(league.goals.table.team(fixture.home).matches, league.goals.table.team(fixture.away).matches);
  return fewest >= league.settings.minimumTeamMatches;
}

function resultPick(matrix, fixture, odds, bestPrices) {
  const probabilities = {
    home: matrix.sumWhere((h, a) => h > a),
    draw: matrix.sumWhere((h, a) => h === a),
    away: matrix.sumWhere((h, a) => h < a)
  };
  const side = Object.keys(probabilities).reduce((best, key) => (probabilities[key] > probabilities[best] ? key : best), 'home');
  const fair = removeMargin([odds.home, odds.draw, odds.away]).fair[['home', 'draw', 'away'].indexOf(side)];
  const label = { home: `${fixture.home} to win`, draw: 'Draw', away: `${fixture.away} to win` }[side];
  return pick('1X2', side, label, probabilities[side], odds[side], fair, probabilities, bestPrices[side]);
}

function bttsPick(matrix) {
  const yes = matrix.sumWhere((h, a) => h > 0 && a > 0);
  const choice = yes >= 0.5 ? 'yes' : 'no';
  return pick('BTTS', choice, choice === 'yes' ? 'Both teams score: Yes' : 'Both teams score: No', choice === 'yes' ? yes : 1 - yes, NaN, NaN, { yes, no: 1 - yes });
}

function goalsPick(matrix, odds, bestPrices) {
  const over = matrix.sumWhere((h, a) => h + a > 2.5);
  const choice = over >= 0.5 ? 'over' : 'under';
  const fair = removeMargin([odds.over25, odds.under25]).fair[choice === 'over' ? 0 : 1];
  const price = choice === 'over' ? odds.over25 : odds.under25;
  return pick('Goals 2.5', choice, choice === 'over' ? 'Over 2.5 goals' : 'Under 2.5 goals', choice === 'over' ? over : 1 - over, price, fair, { over, under: 1 - over },
    choice === 'over' ? bestPrices.over25 : bestPrices.under25);
}

function pick(market, choice, label, probability, odds, bookmakerFair, all, bestOdds = NaN) {
  return {
    market, choice, label, probability, all,
    fairOdds: probability > 0 ? 1 / probability : NaN,
    odds: validOdds(odds),
    bestOdds: validOdds(bestOdds),
    bookmakerFair,
    expectedValue: expectedValue(probability, odds)
  };
}

function validOdds(odds) {
  return Number.isFinite(odds) && odds > 1 ? odds : NaN;
}

// How picks with the same confidence did in the walk-forward study (band record from data/three-markets-study.json).
export function similarPicks(study, market, probability) {
  const bands = study?.markets?.[market]?.bands || [];
  return bands.find((band) => probability >= band.from && probability < band.to) || bands[bands.length - 1];
}

// A strong pick is one whose confidence band historically won at least this often.
export const STRONG_HIT_RATE = 0.6;

export function isStrong(study, market, probability) {
  return (similarPicks(study, market, probability)?.hitRate || 0) >= STRONG_HIT_RATE;
}

// How strong picks have done in a league over five seasons: 'good' if positive overall and in both halves, 'avoid' if it lost 5%+ at Bet365.
export function leagueRating(stakingStudy, leagueCode) {
  const entry = stakingStudy?.leagues?.find((league) => league.league === leagueCode);
  if (!entry) return { rating: 'unknown', entry };
  const best = entry.best;
  if (best.roi > 0.02 && best.before > 0 && best.after > 0) return { rating: 'good', entry };
  if (entry.bet365.roi <= -0.05) return { rating: 'avoid', entry };
  return { rating: 'neutral', entry };
}
