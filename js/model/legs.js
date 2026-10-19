const GOALS = ['homeGoals', 'awayGoals'];

const compare = (direction, value, line) => (direction === 'over' ? value > line : value < line);
const sideName = (side, names) => (side === 'home' ? names.home : names.away);
const overUnder = (spec) => `${spec.direction === 'over' ? 'Over' : 'Under'} ${spec.line}`;
const opposite = (side) => (side === 'home' ? 'away' : 'home');
const goalsOf = (o, side) => o[`${side}Goals`];

const RESULT_TESTS = {
  home: (o) => o.homeGoals > o.awayGoals,
  draw: (o) => o.homeGoals === o.awayGoals,
  away: (o) => o.homeGoals < o.awayGoals
};

const DOUBLE_CHANCE = {
  '1X': { test: (o) => o.homeGoals >= o.awayGoals, label: (n) => `${n.home} or draw` },
  'X2': { test: (o) => o.homeGoals <= o.awayGoals, label: (n) => `${n.away} or draw` },
  '12': { test: (o) => o.homeGoals !== o.awayGoals, label: () => 'Either team to win' }
};

const sideStat = (stat, category, family, noun) => ({
  category, family,
  variables: (s) => [`${s.side}${stat}`],
  test: (s, o) => compare(s.direction, o[`${s.side}${stat}`], s.line),
  label: (s, n) => `${sideName(s.side, n)} ${overUnder(s)} ${noun}`
});

const totalStat = (stat, category, family, noun) => ({
  category, family,
  variables: () => [`home${stat}`, `away${stat}`],
  test: (s, o) => compare(s.direction, o[`home${stat}`] + o[`away${stat}`], s.line),
  label: (s) => `Match ${overUnder(s)} ${noun}`
});

const playerVariable = (s, stat) => `player:${s.playerId}:${stat}`;

const PLAYER_STAT_NAMES = {
  shots: 'shots', shotsOnTarget: 'shots on target', tackles: 'tackles', passes: 'passes',
  foulsCommitted: 'fouls committed', foulsDrawn: 'times fouled', saves: 'saves', assists: 'assists'
};

export const LEG_TYPES = {
  matchResult: {
    category: 'Match result', family: 'result', variables: () => GOALS,
    test: (s, o) => RESULT_TESTS[s.side](o),
    label: (s, n) => (s.side === 'draw' ? 'Draw' : `${sideName(s.side, n)} to win`)
  },
  doubleChance: {
    category: 'Match result', family: 'result', variables: () => GOALS,
    test: (s, o) => DOUBLE_CHANCE[s.pair].test(o),
    label: (s, n) => `Double chance: ${DOUBLE_CHANCE[s.pair].label(n)}`
  },
  winningMargin: {
    category: 'Match result', family: 'result', variables: () => GOALS,
    test: (s, o) => goalsOf(o, s.side) - goalsOf(o, opposite(s.side)) >= s.margin,
    label: (s, n) => `${sideName(s.side, n)} to win by ${s.margin}+ (handicap -${s.margin - 0.5})`
  },
  totalGoals: {
    category: 'Goals', family: 'goals', variables: () => GOALS,
    test: (s, o) => compare(s.direction, o.homeGoals + o.awayGoals, s.line),
    label: (s) => `Match goals ${overUnder(s)}`
  },
  teamGoals: {
    category: 'Goals', family: 'goals', variables: () => GOALS,
    test: (s, o) => compare(s.direction, goalsOf(o, s.side), s.line),
    label: (s, n) => `${sideName(s.side, n)} goals ${overUnder(s)}`
  },
  bothTeamsToScore: {
    category: 'Goals', family: 'goals', variables: () => GOALS,
    test: (s, o) => (o.homeGoals > 0 && o.awayGoals > 0) === (s.answer === 'yes'),
    label: (s) => `Both teams to score: ${s.answer === 'yes' ? 'Yes' : 'No'}`
  },
  cleanSheet: {
    category: 'Goals', family: 'goals', variables: () => GOALS,
    test: (s, o) => goalsOf(o, opposite(s.side)) === 0,
    label: (s, n) => `${sideName(s.side, n)} clean sheet`
  },
  winToNil: {
    category: 'Goals', family: 'result', variables: () => GOALS,
    test: (s, o) => goalsOf(o, s.side) > 0 && goalsOf(o, opposite(s.side)) === 0,
    label: (s, n) => `${sideName(s.side, n)} to win to nil`
  },
  resultAndBtts: {
    category: 'Goals', family: 'result', variables: () => GOALS,
    test: (s, o) => RESULT_TESTS[s.side](o) && (o.homeGoals > 0 && o.awayGoals > 0) === (s.answer === 'yes'),
    label: (s, n) => `${s.side === 'draw' ? 'Draw' : `${sideName(s.side, n)} win`} & BTTS ${s.answer === 'yes' ? 'Yes' : 'No'}`
  },
  correctScore: {
    category: 'Goals', family: 'score', variables: () => GOALS,
    test: (s, o) => o.homeGoals === s.home && o.awayGoals === s.away,
    label: (s, n) => `Correct score ${n.home} ${s.home}-${s.away} ${n.away}`
  },
  halfGoals: {
    category: 'Goals', family: 'halves',
    variables: (s) => (s.half === 'first' ? ['homeHalfGoals', 'awayHalfGoals'] : ['homeSecondHalfGoals', 'awaySecondHalfGoals']),
    test: (s, o) => compare(s.direction, s.half === 'first' ? o.homeHalfGoals + o.awayHalfGoals : o.homeSecondHalfGoals + o.awaySecondHalfGoals, s.line),
    label: (s) => `${s.half === 'first' ? 'First' : 'Second'}-half goals ${overUnder(s)}`
  },
  firstHalfResult: {
    category: 'Match result', family: 'halves', variables: () => ['homeHalfGoals', 'awayHalfGoals'],
    test: (s, o) => RESULT_TESTS[s.side]({ homeGoals: o.homeHalfGoals, awayGoals: o.awayHalfGoals }),
    label: (s, n) => `Half-time result: ${s.side === 'draw' ? 'Draw' : sideName(s.side, n)}`
  },
  totalCorners: totalStat('Corners', 'Corners', 'corners', 'corners'),
  teamCorners: sideStat('Corners', 'Corners', 'corners', 'corners'),
  cornerHandicap: {
    category: 'Corners', family: 'corners', variables: () => ['homeCorners', 'awayCorners'],
    test: (s, o) => o[`${s.side}Corners`] + s.line > o[`${opposite(s.side)}Corners`],
    label: (s, n) => `${sideName(s.side, n)} corners handicap ${s.line > 0 ? '+' : ''}${s.line}`
  },
  totalCards: totalStat('Cards', 'Cards', 'cards', 'cards'),
  teamCards: sideStat('Cards', 'Cards', 'cards', 'cards'),
  totalShotsOnTarget: totalStat('ShotsOnTarget', 'Shots & saves', 'shots', 'shots on target'),
  teamShotsOnTarget: sideStat('ShotsOnTarget', 'Shots & saves', 'shots', 'shots on target'),
  teamShots: sideStat('Shots', 'Shots & saves', 'shots', 'shots'),
  teamFouls: sideStat('Fouls', 'Cards', 'fouls', 'fouls'),
  goalkeeperSaves: sideStat('Saves', 'Shots & saves', 'shots', 'goalkeeper saves'),
  playerAnytimeGoal: {
    category: 'Player', family: 'player', variables: (s) => [playerVariable(s, 'goals')],
    test: (s, o) => o[playerVariable(s, 'goals')] > 0,
    label: (s) => `${s.name} to score anytime`
  },
  playerFirstGoal: {
    category: 'Player', family: 'player', variables: (s) => [playerVariable(s, 'firstGoal')],
    test: (s, o) => o[playerVariable(s, 'firstGoal')] > 0,
    label: (s) => `${s.name} first goalscorer`
  },
  playerScoreOrAssist: {
    category: 'Player', family: 'player', variables: (s) => [playerVariable(s, 'goals'), playerVariable(s, 'assists')],
    test: (s, o) => o[playerVariable(s, 'goals')] + o[playerVariable(s, 'assists')] > 0,
    label: (s) => `${s.name} to score or assist`
  },
  playerBooked: {
    category: 'Player', family: 'player', variables: (s) => [playerVariable(s, 'cards')],
    test: (s, o) => o[playerVariable(s, 'cards')] > 0,
    label: (s) => `${s.name} to be booked`
  },
  playerStat: {
    category: 'Player', family: 'player', variables: (s) => [playerVariable(s, s.stat)],
    test: (s, o) => compare(s.direction, o[playerVariable(s, s.stat)], s.line),
    label: (s) => `${s.name} ${overUnder(s)} ${PLAYER_STAT_NAMES[s.stat]}`
  }
};

export function createLeg(spec) {
  const type = LEG_TYPES[spec.type];
  if (!type) throw new Error(`Unknown selection type ${spec.type}`);
  return {
    spec,
    key: legKey(spec),
    category: type.category,
    family: type.family,
    variables: type.variables(spec),
    test: (outcome) => type.test(spec, outcome),
    label: (names) => type.label(spec, names)
  };
}

export function legKey(spec) {
  return Object.keys(spec).sort().map((name) => `${name}=${spec[name]}`).join(';');
}

export function settleLeg(leg, outcome) {
  if (leg.family === 'player') return 'manual';
  if (!leg.variables.every((variable) => Number.isFinite(outcome[variable]))) return 'manual';
  return leg.test(outcome) ? 'won' : 'lost';
}
