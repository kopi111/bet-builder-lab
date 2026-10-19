const unavailable = (category, name, reason) => ({ category, name, unavailableReason: reason });
const entry = (category, name, type, controls, defaults = {}) => ({ category, name, type, controls, defaults });

export const PLAYER_STATS_FOR_TYPE = {
  playerAnytimeGoal: 'goals', playerFirstGoal: 'goals', playerScoreOrAssist: 'goals', playerBooked: 'cards'
};

export const MARKET_CATALOGUE = [
  entry('Match result', 'Match result (1X2)', 'matchResult', ['resultSide'], { side: 'home' }),
  entry('Match result', 'Double chance', 'doubleChance', ['pair'], { pair: '1X' }),
  entry('Match result', 'Match / team handicap (win by N+)', 'winningMargin', ['side', 'margin'], { side: 'home', margin: 2 }),
  entry('Match result', 'Half-time result', 'firstHalfResult', ['resultSide'], { side: 'home' }),
  unavailable('Match result', 'Draw no bet', 'A draw refunds the stake, which cannot be expressed as one leg of a combined bet here. Single-bet DNB prices are in the match report.'),
  unavailable('Match result', 'Team to qualify', 'Only applies to knockout ties; the loaded competitions are leagues.'),
  entry('Goals', 'Match goals over/under', 'totalGoals', ['direction', 'line'], { direction: 'over', line: 2.5 }),
  entry('Goals', 'Team goals over/under', 'teamGoals', ['side', 'direction', 'line'], { side: 'home', direction: 'over', line: 1.5 }),
  entry('Goals', 'First-half goals', 'halfGoals', ['direction', 'line'], { half: 'first', direction: 'over', line: 0.5 }),
  entry('Goals', 'Second-half goals', 'halfGoals', ['direction', 'line'], { half: 'second', direction: 'over', line: 0.5 }),
  entry('Goals', 'Both teams to score', 'bothTeamsToScore', ['answer'], { answer: 'yes' }),
  entry('Goals', 'Team clean sheet', 'cleanSheet', ['side'], { side: 'home' }),
  entry('Goals', 'Win to nil', 'winToNil', ['side'], { side: 'home' }),
  entry('Goals', 'Result and both teams to score', 'resultAndBtts', ['resultSide', 'answer'], { side: 'home', answer: 'yes' }),
  entry('Goals', 'Correct score', 'correctScore', ['score'], { home: 1, away: 1 }),
  entry('Corners', 'Total match corners (any line)', 'totalCorners', ['direction', 'line'], { direction: 'over', line: 9.5 }),
  entry('Corners', 'Home team corners', 'teamCorners', ['direction', 'line'], { side: 'home', direction: 'over', line: 4.5 }),
  entry('Corners', 'Away team corners', 'teamCorners', ['direction', 'line'], { side: 'away', direction: 'over', line: 3.5 }),
  entry('Corners', 'Team corner handicap', 'cornerHandicap', ['side', 'handicap'], { side: 'home', line: -1.5 }),
  unavailable('Corners', 'First-half corners', 'The data source records full-match corners only, so first-half corners cannot be estimated honestly.'),
  entry('Cards', 'Total cards', 'totalCards', ['direction', 'line'], { direction: 'over', line: 3.5 }),
  entry('Cards', 'Team cards', 'teamCards', ['side', 'direction', 'line'], { side: 'home', direction: 'over', line: 1.5 }),
  entry('Cards', 'Team fouls', 'teamFouls', ['side', 'direction', 'line'], { side: 'home', direction: 'over', line: 10.5 }),
  entry('Cards', 'Player to be booked', 'playerBooked', ['player'], {}),
  entry('Cards', 'Player fouls committed', 'playerStat', ['player', 'direction', 'line'], { stat: 'foulsCommitted', direction: 'over', line: 0.5 }),
  unavailable('Cards', 'Player to be sent off', 'Red cards are too rare per player to estimate from season statistics; not modelled.'),
  entry('Shots & saves', 'Team shots on target', 'teamShotsOnTarget', ['side', 'direction', 'line'], { side: 'home', direction: 'over', line: 4.5 }),
  entry('Shots & saves', 'Match shots on target', 'totalShotsOnTarget', ['direction', 'line'], { direction: 'over', line: 8.5 }),
  entry('Shots & saves', 'Team shots', 'teamShots', ['side', 'direction', 'line'], { side: 'home', direction: 'over', line: 12.5 }),
  entry('Shots & saves', 'Team goalkeeper saves', 'goalkeeperSaves', ['side', 'direction', 'line'], { side: 'home', direction: 'over', line: 2.5 }),
  entry('Player', 'Anytime goalscorer', 'playerAnytimeGoal', ['player'], {}),
  entry('Player', 'First goalscorer', 'playerFirstGoal', ['player'], {}),
  entry('Player', 'To score or assist', 'playerScoreOrAssist', ['player'], {}),
  entry('Player', 'Player assists', 'playerStat', ['player', 'direction', 'line'], { stat: 'assists', direction: 'over', line: 0.5 }),
  entry('Player', 'Player shots', 'playerStat', ['player', 'direction', 'line'], { stat: 'shots', direction: 'over', line: 1.5 }),
  entry('Player', 'Player shots on target', 'playerStat', ['player', 'direction', 'line'], { stat: 'shotsOnTarget', direction: 'over', line: 0.5 }),
  entry('Player', 'Player tackles', 'playerStat', ['player', 'direction', 'line'], { stat: 'tackles', direction: 'over', line: 1.5 }),
  entry('Player', 'Player passes', 'playerStat', ['player', 'direction', 'line'], { stat: 'passes', direction: 'over', line: 39.5 }),
  entry('Player', 'Player to be fouled', 'playerStat', ['player', 'direction', 'line'], { stat: 'foulsDrawn', direction: 'over', line: 0.5 }),
  entry('Player', 'Goalkeeper saves (player)', 'playerStat', ['player', 'direction', 'line'], { stat: 'saves', direction: 'over', line: 2.5 })
];

export function playerStatOf(catalogueEntry) {
  return catalogueEntry.defaults.stat || PLAYER_STATS_FOR_TYPE[catalogueEntry.type];
}

export function eligiblePlayers(players, catalogueEntry) {
  const stat = playerStatOf(catalogueEntry);
  return players.filter((p) => p.status !== 'out' && Number.isFinite(p.per90[stat]) && (stat !== 'saves' || p.position === 'Goalkeeper'));
}
