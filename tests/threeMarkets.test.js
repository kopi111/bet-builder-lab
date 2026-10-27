import test from 'node:test';
import assert from 'node:assert/strict';
import { RatingTable } from '../js/model/ratingTable.js';
import { leagueRating, similarPicks, threeMarketPicks } from '../js/model/threeMarkets.js';
import { DEFAULT_SETTINGS } from '../js/config.js';

// A stand-in league: Strong attacks well, Weak concedes a lot, both have a full season of matches.
function league() {
  const teams = new Map([
    ['Strong', { for: 1.5, against: 0.7, matches: 20 }],
    ['Weak', { for: 0.7, against: 1.4, matches: 20 }],
    ['Promoted', { for: 1, against: 1, matches: 2 }]
  ]);
  return { goals: { table: new RatingTable(1.5, 1.2, teams) }, settings: DEFAULT_SETTINGS };
}

function fixture(home, away) {
  const odds = { home: 1.5, draw: 4.2, away: 6.5, over25: 1.7, under25: 2.15 };
  return { id: 't', league: 'E0', home, away, kickoff: new Date(), odds: { opening: odds } };
}

test('three picks choose the most likely answer in each market', () => {
  const { picks, covered } = threeMarketPicks(league(), fixture('Strong', 'Weak'));
  assert.equal(covered, true);
  assert.equal(picks.result.choice, 'home');
  assert.ok(picks.result.probability > picks.result.all.draw && picks.result.probability > picks.result.all.away);
  assert.ok(Math.abs(picks.result.all.home + picks.result.all.draw + picks.result.all.away - 1) < 1e-9);
  for (const pick of [picks.btts, picks.goals]) assert.ok(pick.probability >= 0.5);
  assert.equal(picks.goals.odds, picks.goals.choice === 'over' ? 1.7 : 2.15);
  assert.ok(Number.isNaN(picks.btts.odds));
});

test('a side with too few league matches is not covered', () => {
  assert.equal(threeMarketPicks(league(), fixture('Promoted', 'Weak')).covered, false);
});

test('similar picks finds the confidence band a probability falls in', () => {
  const study = { markets: { goals: { bands: [{ from: 0.5, to: 0.6, hitRate: 0.55 }, { from: 0.6, to: 1, hitRate: 0.66 }] } } };
  assert.equal(similarPicks(study, 'goals', 0.63).hitRate, 0.66);
  assert.equal(similarPicks(study, 'goals', 0.52).hitRate, 0.55);
});

test('league rating: good needs a positive record in both halves, avoid means 5%+ lost at Bet365', () => {
  const entry = (league, best, before, after, bet365) => ({ league, best: { roi: best, before, after }, bet365: { roi: bet365 } });
  const staking = { leagues: [entry('SP1', 0.06, 0.06, 0.08, 0.03), entry('B1', 0.06, 0.07, -0.01, 0.03), entry('I2', -0.07, -0.13, 0.1, -0.1)] };
  assert.equal(leagueRating(staking, 'SP1').rating, 'good');
  assert.equal(leagueRating(staking, 'B1').rating, 'neutral');
  assert.equal(leagueRating(staking, 'I2').rating, 'avoid');
  assert.equal(leagueRating(staking, 'E0').rating, 'unknown');
});
