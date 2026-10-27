// Champions League history: the domestic top flights of every covered country pooled with European results,
// so that cross-league games are what set each league's strength.
import { CHAMPIONS_LEAGUE } from '../config.js';
import { loadLeagueHistory as loadDomesticHistory } from './footballData.js';
import { fetchJson } from './httpClient.js';
import { matchId, ODDS_FIELDS, STAT_FIELDS } from './matchRecord.js';
import { serverStatus } from './serverStatus.js';
import { recordSourceFailure, recordSourceSuccess } from './sourceStatus.js';
import { splitCountry, TeamNameMatcher } from './teamNameMatcher.js';

const OPENFOOTBALL = 'openfootball';
const FOOTBALL_DATA_ORG = 'football-data.org';
const OPENFOOTBALL_UTC_OFFSET_HOURS = 1;
const DEFAULT_KICKOFF = '20:00';
const UPCOMING_STATUSES = new Set(['SCHEDULED', 'TIMED']);
export const MISSING_KEY_NOTE = 'Champions League fixtures need a free football-data.org key (FOOTBALL_DATA_ORG_KEY on the server). Past results still load.';

let historyPromise;

export function loadChampionsLeagueHistory() {
  if (!historyPromise) {
    historyPromise = buildHistory();
    historyPromise.catch(() => { historyPromise = undefined; });
  }
  return historyPromise;
}

export function forgetChampionsLeagueData() {
  historyPromise = undefined;
}

export async function loadChampionsLeagueFixtures() {
  if (!(await footballDataOrgConfigured())) return { fixtures: [], note: MISSING_KEY_NOTE };
  const history = await loadChampionsLeagueHistory();
  return { fixtures: history.upcoming, note: '' };
}

async function buildHistory() {
  const domestic = await loadDomesticLeagues();
  const matcher = new TeamNameMatcher(CHAMPIONS_LEAGUE.countryLeagues, teamsByLeague(domestic));
  const european = uniqueById((await Promise.all([loadOpenFootball(matcher), loadFootballDataOrg(matcher)])).flat());
  const played = european.filter((match) => match.played);
  if (played.length === 0) throw new Error('No Champions League results could be loaded from openfootball or football-data.org');
  return {
    leagueCode: CHAMPIONS_LEAGUE.code,
    matches: [...domestic.flatMap((history) => history.matches), ...played].sort((a, b) => a.kickoff - b.kickoff),
    upcoming: european.filter((match) => !match.played).sort((a, b) => a.kickoff - b.kickoff),
    fetchedAt: new Date(Math.min(...domestic.map((history) => history.fetchedAt.getTime()))),
    seasons: domestic.flatMap((history) => history.seasons)
  };
}

async function loadDomesticLeagues() {
  const codes = [...new Set(Object.values(CHAMPIONS_LEAGUE.countryLeagues))];
  const results = await Promise.allSettled(codes.map(loadDomesticHistory));
  const loaded = results.filter((result) => result.status === 'fulfilled').map((result) => result.value);
  if (loaded.length === 0) throw new Error('None of the domestic leagues behind the Champions League ratings could be loaded');
  return loaded;
}

function teamsByLeague(domestic) {
  return new Map(domestic.map((history) => [history.leagueCode, [...new Set(history.matches.flatMap((m) => [m.home, m.away]))]]));
}

async function loadOpenFootball(matcher) {
  const seasons = await Promise.all(CHAMPIONS_LEAGUE.pastSeasonFiles.map((season) => fetchOpenFootballSeason(season, matcher)));
  return seasons.flat();
}

async function fetchOpenFootballSeason(season, matcher) {
  const key = `${OPENFOOTBALL} Champions League ${season}`;
  try {
    const matches = openFootballRecords(await fetchJson(`api/of/${season}/uefa.cl.json`, OPENFOOTBALL), matcher);
    recordSourceSuccess(key, { rows: matches.length, fetchedAt: new Date() });
    return matches;
  } catch (error) {
    recordSourceFailure(key, { fetchedAt: new Date(), error: error.message });
    return [];
  }
}

export function openFootballRecords(data, matcher) {
  return data.matches.map((row) => openFootballRecord(row, matcher));
}

function openFootballRecord(row, matcher) {
  const kickoff = new Date(`${row.date}T${row.time || DEFAULT_KICKOFF}:00Z`);
  kickoff.setUTCHours(kickoff.getUTCHours() - OPENFOOTBALL_UTC_OFFSET_HOURS);
  const club = (label) => {
    const { name, country } = splitCountry(label);
    return matcher.match(name, country);
  };
  const [fullTime, halfTime] = [row.score?.ft, row.score?.ht];
  return europeanRecord(kickoff, club(row.team1), club(row.team2), goalsOf(fullTime), goalsOf(halfTime));
}

function goalsOf(pair) {
  return Array.isArray(pair) ? { home: pair[0], away: pair[1] } : undefined;
}

async function loadFootballDataOrg(matcher) {
  if (!(await footballDataOrgConfigured())) return [];
  const seasons = await Promise.all(CHAMPIONS_LEAGUE.footballDataOrgSeasons.map((season) => fetchFootballDataOrgSeason(season, matcher)));
  return seasons.flat();
}

async function fetchFootballDataOrgSeason(season, matcher) {
  const query = season ? `?season=${season}` : '';
  const key = `${FOOTBALL_DATA_ORG} Champions League ${season || 'current'}`;
  try {
    const [teams, data] = await Promise.all([
      fetchJson(`api/fdorg/competitions/CL/teams${query}`, FOOTBALL_DATA_ORG),
      fetchJson(`api/fdorg/competitions/CL/matches${query}`, FOOTBALL_DATA_ORG)
    ]);
    const countries = new Map(teams.teams.map((team) => [team.id, team.area?.code || '']));
    const club = (team) => matcher.match(team.name, countries.get(team.id));
    const matches = data.matches
      .filter((m) => m.homeTeam?.name && m.awayTeam?.name && (m.status === 'FINISHED' || UPCOMING_STATUSES.has(m.status)))
      .map((m) => europeanRecord(new Date(m.utcDate), club(m.homeTeam), club(m.awayTeam), ninetyMinuteScore(m), m.score?.halfTime));
    recordSourceSuccess(key, { rows: matches.length, fetchedAt: new Date() });
    return matches;
  } catch (error) {
    recordSourceFailure(key, { fetchedAt: new Date(), error: error.message });
    return [];
  }
}

function ninetyMinuteScore(match) {
  const score = match.score || {};
  const regular = score.duration && score.duration !== 'REGULAR' ? score.regularTime : undefined;
  return match.status === 'FINISHED' ? regular || score.fullTime : undefined;
}

function europeanRecord(kickoff, home, away, fullTime, halfTime) {
  const stats = Object.fromEntries(STAT_FIELDS.map((field) => [field, NaN]));
  const played = Number.isFinite(fullTime?.home) && Number.isFinite(fullTime?.away);
  if (played) Object.assign(stats, { homeGoals: fullTime.home, awayGoals: fullTime.away });
  if (Number.isFinite(halfTime?.home) && Number.isFinite(halfTime?.away)) Object.assign(stats, { homeHalfGoals: halfTime.home, awayHalfGoals: halfTime.away });
  const noOdds = () => Object.fromEntries(ODDS_FIELDS.map((field) => [field, NaN]));
  return {
    id: matchId(CHAMPIONS_LEAGUE.code, kickoff, home.name, away.name),
    league: CHAMPIONS_LEAGUE.code,
    kickoff,
    home: home.name,
    away: away.name,
    homeLeague: home.league,
    awayLeague: away.league,
    referee: '',
    played,
    stats,
    odds: { opening: noOdds(), closing: noOdds() }
  };
}

function uniqueById(matches) {
  return [...new Map(matches.map((match) => [match.id, match])).values()];
}

async function footballDataOrgConfigured() {
  const status = await serverStatus();
  return Boolean(status.footballDataOrg?.configured);
}
