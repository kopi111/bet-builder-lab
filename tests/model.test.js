import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv } from '../js/util/csv.js';
import { parseUkKickoff } from '../js/util/time.js';
import { negativeBinomialTable, poissonTable } from '../js/util/distributions.js';
import { ScoreMatrix } from '../js/model/scoreMatrix.js';
import { createLeg, settleLeg } from '../js/model/legs.js';
import { asianHandicapSettlement, expectedValue, removeMargin } from '../js/model/value.js';
import { fitRatingTable } from '../js/model/ratingTable.js';
import { LeagueModel } from '../js/model/leagueModel.js';
import { MatchModel } from '../js/model/matchModel.js';
import { NoPlayerContext } from '../js/model/playerContext.js';
import { DEFAULT_SETTINGS } from '../js/config.js';

const sum = (values) => values.reduce((a, b) => a + b, 0);

test('CSV parser strips BOM and keeps empty cells', () => {
  const rows = parseCsv('﻿Div,HomeTeam,FTHG\nE0,Arsenal,\n');
  assert.deepEqual(rows, [{ Div: 'E0', HomeTeam: 'Arsenal', FTHG: '' }]);
});

test('UK kick-off converts to UTC across summer and winter time', () => {
  assert.equal(parseUkKickoff('19/10/2026', '20:00').toISOString(), '2026-10-19T19:00:00.000Z');
  assert.equal(parseUkKickoff('15/01/2026', '15:00').toISOString(), '2026-01-15T15:00:00.000Z');
});

test('Poisson and negative binomial tables sum to one with the right mean', () => {
  for (const table of [poissonTable(2.7, 60), negativeBinomialTable(10.2, 8, 120)]) {
    assert.ok(Math.abs(sum(table) - 1) < 1e-9);
  }
  const nb = negativeBinomialTable(10.2, 8, 120);
  assert.ok(Math.abs(sum(Array.from(nb, (p, k) => p * k)) - 10.2) < 1e-6);
});

test('score matrix is a probability distribution and 1X2 sums to one', () => {
  const matrix = new ScoreMatrix(1.6, 1.1, -0.06);
  const home = matrix.sumWhere((h, a) => h > a);
  const draw = matrix.sumWhere((h, a) => h === a);
  const away = matrix.sumWhere((h, a) => h < a);
  assert.ok(Math.abs(home + draw + away - 1) < 1e-9);
  assert.ok(home > away);
});

test('legs settle against real outcomes and player legs need manual settlement', () => {
  const outcome = { homeGoals: 2, awayGoals: 1, homeCorners: 6, awayCorners: 3 };
  assert.equal(settleLeg(createLeg({ type: 'totalGoals', direction: 'over', line: 2.5 }), outcome), 'won');
  assert.equal(settleLeg(createLeg({ type: 'bothTeamsToScore', answer: 'no' }), outcome), 'lost');
  assert.equal(settleLeg(createLeg({ type: 'cornerHandicap', side: 'home', line: -2.5 }), outcome), 'won');
  assert.equal(settleLeg(createLeg({ type: 'playerAnytimeGoal', playerId: 1, name: 'X', side: 'home' }), outcome), 'manual');
  assert.equal(settleLeg(createLeg({ type: 'totalCards', direction: 'over', line: 3.5 }), outcome), 'manual');
});

test('value maths: margin removal, EV and quarter-line Asian handicap', () => {
  const { fair, margin } = removeMargin([2, 2]);
  assert.deepEqual(fair, [0.5, 0.5]);
  assert.equal(margin, 0);
  assert.ok(Math.abs(expectedValue(0.55, 2) - 0.1) < 1e-12);
  const matrix = new ScoreMatrix(1.4, 1.4, 0);
  const level = asianHandicapSettlement(matrix, 0);
  assert.ok(Math.abs(level.push - matrix.sumWhere((h, a) => h === a)) < 1e-9);
  const quarter = asianHandicapSettlement(matrix, -0.25);
  assert.ok(Math.abs(quarter.push - level.push / 2) < 1e-9);
});

test('rating fit recovers a stronger team from synthetic results', () => {
  const observations = [];
  for (let i = 0; i < 40; i++) {
    observations.push({ home: 'Strong', away: 'Weak', homeValue: 3, awayValue: 0, weight: 1 });
    observations.push({ home: 'Weak', away: 'Strong', homeValue: 0, awayValue: 2, weight: 1 });
    observations.push({ home: 'Mid', away: 'Weak', homeValue: 1, awayValue: 1, weight: 1 });
    observations.push({ home: 'Strong', away: 'Mid', homeValue: 2, awayValue: 1, weight: 1 });
  }
  const table = fitRatingTable(observations, 4);
  assert.ok(table.team('Strong').for > table.team('Mid').for);
  assert.ok(table.team('Strong').against < table.team('Weak').against);
});

test('joint probability respects dependence: impossible combos are zero, goal-only combos are exact', () => {
  const teams = ['A', 'B', 'C', 'D', 'E', 'F'];
  const matches = [];
  let day = 0;
  for (let round = 0; round < 8; round++) {
    for (const home of teams) {
      for (const away of teams) {
        if (home === away) continue;
        day++;
        const homeGoals = (day * 7) % 4;
        const awayGoals = (day * 3) % 3;
        matches.push({
          id: `${day}`, league: 'T', kickoff: new Date(Date.UTC(2025, 0, 1) + day * 86400000), home, away, referee: '', played: true,
          stats: { homeGoals, awayGoals, homeHalfGoals: Math.min(1, homeGoals), awayHalfGoals: 0, homeShotsOnTarget: homeGoals + 3, awayShotsOnTarget: awayGoals + 2,
            homeShots: homeGoals + 9, awayShots: awayGoals + 7, homeCorners: 4 + (day % 5), awayCorners: 3 + (day % 4), homeYellow: day % 3, awayYellow: (day + 1) % 3,
            homeRed: 0, awayRed: 0, homeFouls: 10 + (day % 4), awayFouls: 11 + (day % 3) },
          odds: { opening: {}, closing: {} }
        });
      }
    }
  }
  const league = LeagueModel.fit(matches, new Date(Date.UTC(2026, 0, 1)), { ...DEFAULT_SETTINGS, simulations: 20000 });
  const fixture = { id: 'x', league: 'T', home: 'A', away: 'B', referee: '', kickoff: new Date(Date.UTC(2026, 0, 1)), odds: { opening: {}, closing: {} } };
  const model = new MatchModel(league, fixture, new NoPlayerContext('none'));
  const homeWin = createLeg({ type: 'matchResult', side: 'home' });
  const under = createLeg({ type: 'totalGoals', direction: 'under', line: 0.5 });
  const impossible = model.probability([homeWin, under]);
  assert.equal(impossible.method, 'exact');
  assert.equal(impossible.value, 0);
  const corners = createLeg({ type: 'totalCorners', direction: 'over', line: 8.5 });
  const mixed = model.probability([homeWin, corners]);
  assert.equal(mixed.method, 'simulation');
  assert.ok(mixed.value > 0 && mixed.value < model.probability([homeWin]).value);
  const playerLeg = createLeg({ type: 'playerAnytimeGoal', playerId: 9, name: 'Nobody', side: 'home' });
  assert.equal(model.probability([playerLeg]).available, false);
});
