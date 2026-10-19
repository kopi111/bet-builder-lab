import { createLeg } from './legs.js';
import { assessConfidence } from './confidence.js';
import { asianHandicapExpectedValue, asianHandicapSettlement, compareWithOdds, removeMargin } from './value.js';

const GOAL_LINES = [0.5, 1.5, 2.5, 3.5, 4.5];
const SIDES = ['home', 'away'];

export function linesAround(mean, spread = 2) {
  const centre = Math.floor(mean) + 0.5;
  return Array.from({ length: spread * 2 + 1 }, (_, i) => centre + (i - spread)).filter((line) => line > 0);
}

export function buildMarketTables(model) {
  const tables = [resultTable(model), goalTotalsTable(model), teamGoalsTable(model), halvesTable(model), correctScoreTable(model)];
  if (model.hasCountModel('corners')) tables.push(cornersTable(model));
  if (model.hasCountModel('cards')) tables.push(cardsTable(model));
  if (model.hasCountModel('shotsOnTarget')) tables.push(shotsTable(model));
  return tables;
}

export function priceLeg(model, spec, odds = NaN, fairImplied = NaN) {
  const leg = createLeg(spec);
  const estimate = model.probability([leg]);
  return {
    leg, spec,
    label: leg.label(model.fixture),
    estimate,
    probability: estimate.value,
    comparison: compareWithOdds(estimate.value, odds, fairImplied),
    confidence: assessConfidence(model, leg.family)
  };
}

function resultTable(model) {
  const odds = model.fixture.odds.opening;
  const fair = removeMargin([odds.home, odds.draw, odds.away]);
  const rows = [
    priceLeg(model, { type: 'matchResult', side: 'home' }, odds.home, fair.fair[0]),
    priceLeg(model, { type: 'matchResult', side: 'draw' }, odds.draw, fair.fair[1]),
    priceLeg(model, { type: 'matchResult', side: 'away' }, odds.away, fair.fair[2]),
    ...['1X', 'X2', '12'].map((pair) => priceLeg(model, { type: 'doubleChance', pair })),
    ...SIDES.map((side) => priceLeg(model, { type: 'winningMargin', side, margin: 2 }))
  ];
  return { id: 'result', title: 'Match result', rows, margin: fair.margin, extras: [drawNoBet(model), asianHandicap(model)] };
}

function drawNoBet(model) {
  const home = model.matrix.sumWhere((h, a) => h > a);
  const draw = model.matrix.sumWhere((h, a) => h === a);
  return {
    title: 'Draw no bet (stake returned on a draw)',
    rows: SIDES.map((side) => {
      const win = side === 'home' ? home : 1 - home - draw;
      return { label: `${side === 'home' ? model.fixture.home : model.fixture.away} DNB`, win, push: draw, fairOdds: (1 - draw) / win };
    })
  };
}

function asianHandicap(model) {
  const odds = model.fixture.odds.opening;
  const mainLine = Number.isFinite(odds.handicapLine) ? odds.handicapLine : Math.round((model.expectedGoals.away - model.expectedGoals.home) * 4) / 4;
  const lines = [...new Set([mainLine - 0.5, mainLine, mainLine + 0.5])];
  return {
    title: `Asian handicap (home line; Bet365 main line ${Number.isFinite(odds.handicapLine) ? odds.handicapLine : 'not supplied'})`,
    rows: lines.map((line) => {
      const settlement = asianHandicapSettlement(model.matrix, line);
      const isMain = line === odds.handicapLine;
      return {
        label: `${model.fixture.home} ${line > 0 ? '+' : ''}${line}`,
        win: settlement.win, push: settlement.push, lose: settlement.lose,
        fairOdds: 1 + settlement.lose / Math.max(settlement.win, 1e-9),
        odds: isMain ? odds.handicapHome : NaN,
        expectedValue: isMain ? asianHandicapExpectedValue(settlement, odds.handicapHome) : NaN
      };
    })
  };
}

function goalTotalsTable(model) {
  const odds = model.fixture.odds.opening;
  const fair = removeMargin([odds.over25, odds.under25]);
  const rows = GOAL_LINES.flatMap((line) => ['over', 'under'].map((direction) => {
    const isMain = line === 2.5;
    const price = isMain ? (direction === 'over' ? odds.over25 : odds.under25) : NaN;
    const fairPrice = isMain ? fair.fair[direction === 'over' ? 0 : 1] : NaN;
    return priceLeg(model, { type: 'totalGoals', direction, line }, price, fairPrice);
  }));
  rows.push(priceLeg(model, { type: 'bothTeamsToScore', answer: 'yes' }), priceLeg(model, { type: 'bothTeamsToScore', answer: 'no' }));
  return { id: 'goals', title: 'Match goals & both teams to score', rows, margin: fair.margin };
}

function teamGoalsTable(model) {
  const rows = SIDES.flatMap((side) => [
    ...[0.5, 1.5, 2.5].map((line) => priceLeg(model, { type: 'teamGoals', side, direction: 'over', line })),
    priceLeg(model, { type: 'cleanSheet', side }),
    priceLeg(model, { type: 'winToNil', side }),
    priceLeg(model, { type: 'resultAndBtts', side, answer: 'yes' })
  ]);
  return { id: 'team-goals', title: 'Team goals, clean sheets, win to nil', rows };
}

function halvesTable(model) {
  const rows = [
    ...['first', 'second'].flatMap((half) => [0.5, 1.5].map((line) => priceLeg(model, { type: 'halfGoals', half, direction: 'over', line }))),
    ...['home', 'draw', 'away'].map((side) => priceLeg(model, { type: 'firstHalfResult', side }))
  ];
  return { id: 'halves', title: 'First-half and second-half goals', rows };
}

function correctScoreTable(model) {
  const rows = model.matrix.mostLikelyScores(10).map((score) => priceLeg(model, { type: 'correctScore', home: score.home, away: score.away }));
  return { id: 'scores', title: 'Most likely correct scores', rows };
}

function cornersTable(model) {
  const means = model.countMeans.corners;
  const rows = [
    ...linesAround(means.home + means.away).map((line) => priceLeg(model, { type: 'totalCorners', direction: 'over', line })),
    ...SIDES.flatMap((side) => linesAround(means[side], 1).map((line) => priceLeg(model, { type: 'teamCorners', side, direction: 'over', line }))),
    priceLeg(model, { type: 'cornerHandicap', side: means.home >= means.away ? 'home' : 'away', line: -1.5 })
  ];
  return { id: 'corners', title: 'Corners', rows, expected: means };
}

function cardsTable(model) {
  const means = model.countMeans.cards;
  const rows = [
    ...linesAround(means.home + means.away).map((line) => priceLeg(model, { type: 'totalCards', direction: 'over', line })),
    ...SIDES.flatMap((side) => linesAround(means[side], 1).map((line) => priceLeg(model, { type: 'teamCards', side, direction: 'over', line })))
  ];
  return { id: 'cards', title: 'Cards (yellow + red as recorded by the source)', rows, expected: means };
}

function shotsTable(model) {
  const means = model.countMeans.shotsOnTarget;
  const rows = [
    ...SIDES.flatMap((side) => linesAround(means[side], 1).map((line) => priceLeg(model, { type: 'teamShotsOnTarget', side, direction: 'over', line }))),
    ...SIDES.map((side) => priceLeg(model, { type: 'goalkeeperSaves', side, direction: 'over', line: 2.5 }))
  ];
  return { id: 'shots', title: 'Shots on target & goalkeeper saves (team level)', rows, expected: means };
}
