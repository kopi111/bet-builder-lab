import { binomial } from './simulation.js';
import { poissonTable, cumulative, inverseCumulative } from '../util/distributions.js';

const TEAM_COLUMN = {
  goals: (side) => `${side}Goals`,
  assists: (side) => `${side}Goals`,
  shots: (side) => `${side}Shots`,
  shotsOnTarget: (side) => `${side}ShotsOnTarget`,
  foulsCommitted: (side) => `${side}Fouls`,
  foulsDrawn: (side) => `${side === 'home' ? 'away' : 'home'}Fouls`,
  cards: (side) => `${side}Cards`
};

const MAX_SHARE = 0.7;

export class NoPlayerContext {
  constructor(message) {
    this.message = message;
    this.players = [];
    this.lineupsConfirmed = false;
  }

  canProduce() {
    return false;
  }

  simulateColumn(variable) {
    throw new Error(`${variable} needs player data: ${this.message}`);
  }
}

export class PlayerContext {
  constructor(players, details) {
    this.players = players;
    this.lineupsConfirmed = details.lineupsConfirmed;
    this.message = details.message;
    this.fetchedAt = details.fetchedAt;
  }

  canProduce(variable) {
    const [prefix, id, stat] = variable.split(':');
    const player = this.players.find((candidate) => String(candidate.id) === id);
    return prefix === 'player' && Boolean(player) && player.status !== 'out' && Number.isFinite(player.per90[statKey(stat)]);
  }

  simulateColumn(variable, simulation) {
    const [, id, stat] = variable.split(':');
    const player = this.players.find((candidate) => String(candidate.id) === id);
    const playing = this.minutesShares(player, simulation);
    if (stat === 'firstGoal') return firstGoalColumn(player, playing, simulation);
    if (stat === 'saves') return simulation.column(`${player.side}Saves`).map((saves, i) => (playing[i] > 0.5 ? saves : 0));
    const teamColumn = TEAM_COLUMN[stat] && simulation.columns.has(TEAM_COLUMN[stat](player.side))
      ? simulation.column(TEAM_COLUMN[stat](player.side)) : undefined;
    if (!teamColumn) return independentColumn(player.per90[stat], playing, simulation);
    const share = shareOfTeam(player.per90[stat], teamColumn);
    return teamColumn.map((teamCount, i) => binomial(teamCount, share * playing[i], simulation.random));
  }

  minutesShares(player, simulation) {
    const shares = new Float64Array(simulation.size);
    for (let i = 0; i < simulation.size; i++) {
      const starts = simulation.random() < player.startProbability;
      shares[i] = starts ? player.minutesWhenStarting / 90 : 0;
    }
    return shares;
  }
}

function statKey(stat) {
  return stat === 'firstGoal' ? 'goals' : stat;
}

function shareOfTeam(perNinety, teamColumn) {
  const teamMean = teamColumn.reduce((sum, value) => sum + value, 0) / teamColumn.length;
  return Math.min(MAX_SHARE, perNinety / Math.max(teamMean, 0.1));
}

function independentColumn(perNinety, playing, simulation) {
  const activeShare = playing.reduce((largest, share) => Math.max(largest, share), 0);
  const table = cumulative(poissonTable(perNinety * activeShare, 200));
  return Int16Array.from(playing, (share) => (share > 0 ? inverseCumulative(table, simulation.random()) : 0));
}

function firstGoalColumn(player, playing, simulation) {
  const own = simulation.column(`${player.side}Goals`);
  const other = simulation.column(`${player.side === 'home' ? 'away' : 'home'}Goals`);
  const share = shareOfTeam(player.per90.goals, own);
  return Int16Array.from(own, (goals, i) => {
    const total = goals + other[i];
    if (total === 0) return 0;
    const teamScoresFirst = simulation.random() < goals / total;
    return teamScoresFirst && simulation.random() < share * playing[i] ? 1 : 0;
  });
}
