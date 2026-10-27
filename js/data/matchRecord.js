import { parseUkKickoff } from '../util/time.js';

const STAT_COLUMNS = {
  homeGoals: 'FTHG', awayGoals: 'FTAG', homeHalfGoals: 'HTHG', awayHalfGoals: 'HTAG',
  homeShots: 'HS', awayShots: 'AS', homeShotsOnTarget: 'HST', awayShotsOnTarget: 'AST',
  homeFouls: 'HF', awayFouls: 'AF', homeCorners: 'HC', awayCorners: 'AC',
  homeYellow: 'HY', awayYellow: 'AY', homeRed: 'HR', awayRed: 'AR'
};

const OPENING_ODDS_COLUMNS = {
  home: 'B365H', draw: 'B365D', away: 'B365A', over25: 'B365>2.5', under25: 'B365<2.5',
  handicapLine: 'AHh', handicapHome: 'B365AHH', handicapAway: 'B365AHA'
};

// Highest price across the bookmakers football-data.co.uk tracks, to show what shopping around would get.
const BEST_ODDS_COLUMNS = { home: 'MaxH', draw: 'MaxD', away: 'MaxA', over25: 'Max>2.5', under25: 'Max<2.5' };

const CLOSING_ODDS_COLUMNS = {
  home: 'B365CH', draw: 'B365CD', away: 'B365CA', over25: 'B365C>2.5', under25: 'B365C<2.5',
  handicapLine: 'AHCh', handicapHome: 'B365CAHH', handicapAway: 'B365CAHA'
};

export const STAT_FIELDS = Object.freeze(Object.keys(STAT_COLUMNS));
export const ODDS_FIELDS = Object.freeze(Object.keys(OPENING_ODDS_COLUMNS));

export function matchId(league, kickoff, home, away) {
  return [league, kickoff.toISOString().slice(0, 10), home, away].join('|');
}

export function toMatchRecord(row) {
  const kickoff = parseUkKickoff(row.Date, row.Time);
  const stats = readColumns(row, STAT_COLUMNS);
  return {
    id: matchId(row.Div, kickoff, row.HomeTeam, row.AwayTeam),
    league: row.Div,
    kickoff,
    home: row.HomeTeam,
    away: row.AwayTeam,
    referee: row.Referee || '',
    played: Number.isFinite(stats.homeGoals) && Number.isFinite(stats.awayGoals),
    stats,
    odds: { opening: readColumns(row, OPENING_ODDS_COLUMNS), best: readColumns(row, BEST_ODDS_COLUMNS), closing: readColumns(row, CLOSING_ODDS_COLUMNS) }
  };
}

function readColumns(row, columns) {
  const values = {};
  Object.entries(columns).forEach(([field, column]) => {
    values[field] = toNumber(row[column]);
  });
  return values;
}

function toNumber(text) {
  if (text === undefined || text === '') return NaN;
  const value = Number(text);
  return Number.isFinite(value) ? value : NaN;
}

export function outcomeOf(match) {
  const stats = match.stats;
  return {
    ...stats,
    homeCards: stats.homeYellow + stats.homeRed,
    awayCards: stats.awayYellow + stats.awayRed,
    homeSecondHalfGoals: stats.homeGoals - stats.homeHalfGoals,
    awaySecondHalfGoals: stats.awayGoals - stats.awayHalfGoals,
    homeSaves: Math.max(0, stats.awayShotsOnTarget - stats.awayGoals),
    awaySaves: Math.max(0, stats.homeShotsOnTarget - stats.homeGoals)
  };
}

export function hasStat(match, field) {
  return Number.isFinite(match.stats[field]);
}
