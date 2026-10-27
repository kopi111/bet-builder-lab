// Upcoming league fixtures from ESPN's free scoreboard, used when football-data.co.uk has not yet published the week.
// ESPN carries no bookmaker prices, so these fixtures have model numbers only.
import { LEAGUES } from '../config.js';
import { fetchJson } from './httpClient.js';
import { matchId, ODDS_FIELDS, STAT_FIELDS } from './matchRecord.js';
import { recordSourceFailure, recordSourceSuccess } from './sourceStatus.js';
import { TeamNameMatcher } from './teamNameMatcher.js';

const SOURCE = 'ESPN';
const DAYS_AHEAD = 7;
const DAY_MS = 86400000;
const LEAGUE_BY_ESPN_ID = new Map(LEAGUES.flatMap((league) => [league.espnId, ...(league.espnIds || [])].filter(Boolean).map((id) => [String(id), league.code])));

export async function loadEspnFixtures(loadLeagueHistory) {
  const key = `${SOURCE} fixtures (next ${DAYS_AHEAD} days)`;
  try {
    const events = (await Promise.all(upcomingDays().map(fetchDay))).flat();
    const upcoming = events.filter((event) => event.league && event.state === 'pre');
    const matcher = await matcherFor(new Set(upcoming.map((event) => event.league)), loadLeagueHistory);
    const fixtures = upcoming.map((event) => toFixture(event, matcher)).filter(Boolean);
    recordSourceSuccess(key, { rows: fixtures.length, fetchedAt: new Date() });
    return fixtures;
  } catch (error) {
    recordSourceFailure(key, { fetchedAt: new Date(), error: error.message });
    return [];
  }
}

function upcomingDays() {
  const today = Date.now();
  return Array.from({ length: DAYS_AHEAD }, (_, index) => new Date(today + index * DAY_MS).toISOString().slice(0, 10).replaceAll('-', ''));
}

async function fetchDay(day) {
  const data = await fetchJson(`api/espn/scoreboard/${day}.json`, SOURCE);
  return (data.events || []).map(readEvent);
}

function readEvent(event) {
  const competition = event.competitions?.[0] || {};
  const side = (homeAway) => competition.competitors?.find((team) => team.homeAway === homeAway)?.team?.displayName || '';
  return {
    league: LEAGUE_BY_ESPN_ID.get(event.uid?.match(/~l:(\d+)/)?.[1]),
    kickoff: new Date(event.date),
    state: competition.status?.type?.state || event.status?.type?.state,
    home: side('home'),
    away: side('away')
  };
}

async function matcherFor(leagueCodes, loadLeagueHistory) {
  const teamsByLeague = new Map();
  await Promise.all([...leagueCodes].map(async (code) => {
    const history = await loadLeagueHistory(code);
    teamsByLeague.set(code, [...new Set(history.matches.flatMap((match) => [match.home, match.away]))]);
  }));
  return new TeamNameMatcher(Object.fromEntries([...leagueCodes].map((code) => [code, code])), teamsByLeague);
}

function toFixture(event, matcher) {
  const home = matcher.match(event.home, event.league);
  const away = matcher.match(event.away, event.league);
  if (!home.league || !away.league) return undefined;
  const noOdds = () => Object.fromEntries(ODDS_FIELDS.map((field) => [field, NaN]));
  return {
    id: matchId(event.league, event.kickoff, home.name, away.name),
    league: event.league,
    kickoff: event.kickoff,
    home: home.name,
    away: away.name,
    referee: '',
    played: false,
    source: SOURCE,
    stats: Object.fromEntries(STAT_FIELDS.map((field) => [field, NaN])),
    odds: { opening: noOdds(), best: noOdds(), closing: noOdds() }
  };
}
