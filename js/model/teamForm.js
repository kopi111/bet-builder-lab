import { daysBetween } from '../util/time.js';

export const FORM_WINDOWS = [5, 10, 15];

export function teamMatchesBefore(matches, team, asOf) {
  return matches
    .filter((m) => m.played && m.kickoff < asOf && (m.home === team || m.away === team))
    .sort((a, b) => b.kickoff - a.kickoff);
}

export function formSummary(teamMatches, team, venue, count) {
  const selected = teamMatches.filter((m) => venue === 'all' || (venue === 'home' ? m.home === team : m.away === team)).slice(0, count);
  return summarise(selected.map((m) => fromTeamView(m, team)));
}

function fromTeamView(match, team) {
  const isHome = match.home === team;
  const s = match.stats;
  const pick = (homeField, awayField) => (isHome ? s[homeField] : s[awayField]);
  return {
    match, isHome,
    opponent: isHome ? match.away : match.home,
    scored: pick('homeGoals', 'awayGoals'), conceded: pick('awayGoals', 'homeGoals'),
    halfScored: pick('homeHalfGoals', 'awayHalfGoals'), halfConceded: pick('awayHalfGoals', 'homeHalfGoals'),
    shots: pick('homeShots', 'awayShots'), shotsOnTarget: pick('homeShotsOnTarget', 'awayShotsOnTarget'),
    shotsAgainst: pick('awayShots', 'homeShots'),
    cornersFor: pick('homeCorners', 'awayCorners'), cornersAgainst: pick('awayCorners', 'homeCorners'),
    fouls: pick('homeFouls', 'awayFouls'),
    cards: pick('homeYellow', 'awayYellow') + pick('homeRed', 'awayRed'),
    opponentCards: pick('awayYellow', 'homeYellow') + pick('awayRed', 'homeRed')
  };
}

function summarise(rows) {
  const count = rows.length;
  const rate = (predicate) => (count ? rows.filter(predicate).length / count : NaN);
  const average = (field) => averageOf(rows.map((row) => row[field]));
  return {
    count,
    rows,
    sequence: rows.map(resultLetter).join(''),
    points: rows.reduce((sum, row) => sum + pointsOf(row), 0),
    wins: rows.filter((r) => r.scored > r.conceded).length,
    draws: rows.filter((r) => r.scored === r.conceded).length,
    losses: rows.filter((r) => r.scored < r.conceded).length,
    scored: average('scored'), conceded: average('conceded'),
    halfScored: average('halfScored'), halfConceded: average('halfConceded'),
    secondHalfScored: averageOf(rows.map((r) => r.scored - r.halfScored)),
    secondHalfConceded: averageOf(rows.map((r) => r.conceded - r.halfConceded)),
    cleanSheets: rate((r) => r.conceded === 0), failedToScore: rate((r) => r.scored === 0),
    bothScored: rate((r) => r.scored > 0 && r.conceded > 0),
    over15: rate((r) => r.scored + r.conceded > 1.5), over25: rate((r) => r.scored + r.conceded > 2.5),
    over35: rate((r) => r.scored + r.conceded > 3.5),
    shots: average('shots'), shotsOnTarget: average('shotsOnTarget'), shotsAgainst: average('shotsAgainst'),
    cornersFor: average('cornersFor'), cornersAgainst: average('cornersAgainst'),
    fouls: average('fouls'), cards: average('cards')
  };
}

function averageOf(values) {
  const finite = values.filter(Number.isFinite);
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : NaN;
}

function resultLetter(row) {
  if (row.scored > row.conceded) return 'W';
  return row.scored === row.conceded ? 'D' : 'L';
}

function pointsOf(row) {
  if (row.scored > row.conceded) return 3;
  return row.scored === row.conceded ? 1 : 0;
}

export function restDays(teamMatches, asOf) {
  return teamMatches.length ? daysBetween(teamMatches[0].kickoff, asOf) : NaN;
}

export function matchesInLastDays(teamMatches, asOf, days) {
  return teamMatches.filter((m) => daysBetween(m.kickoff, asOf) <= days).length;
}

export function opponentStrength(rows, ratingTable) {
  return averageOf(rows.map((row) => {
    const rating = ratingTable.team(row.opponent);
    return rating.for / rating.against;
  }));
}

export function headToHead(matches, home, away, asOf) {
  const meetings = matches
    .filter((m) => m.played && m.kickoff < asOf && ((m.home === home && m.away === away) || (m.home === away && m.away === home)))
    .sort((a, b) => b.kickoff - a.kickoff);
  const totals = meetings.map((m) => m.stats);
  return {
    meetings,
    count: meetings.length,
    homeTeamWins: meetings.filter((m) => winnerOf(m) === home).length,
    awayTeamWins: meetings.filter((m) => winnerOf(m) === away).length,
    draws: meetings.filter((m) => winnerOf(m) === 'draw').length,
    goals: averageOf(totals.map((s) => s.homeGoals + s.awayGoals)),
    bothScored: meetings.length ? totals.filter((s) => s.homeGoals > 0 && s.awayGoals > 0).length / meetings.length : NaN,
    corners: averageOf(totals.map((s) => s.homeCorners + s.awayCorners)),
    cards: averageOf(totals.map((s) => s.homeYellow + s.awayYellow + s.homeRed + s.awayRed))
  };
}

function winnerOf(match) {
  if (match.stats.homeGoals > match.stats.awayGoals) return match.home;
  return match.stats.homeGoals < match.stats.awayGoals ? match.away : 'draw';
}
