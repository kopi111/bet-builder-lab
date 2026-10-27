import { parseCsv } from '../util/csv.js';
import { LEAGUES, seasonCodes } from '../config.js';
import { fetchText } from './httpClient.js';
import { toMatchRecord } from './matchRecord.js';
import { recordSourceFailure, recordSourceSuccess } from './sourceStatus.js';

const SOURCE = 'football-data.co.uk';
const historyCache = new Map();
let fixturesPromise;
const KNOWN_LEAGUES = new Set(LEAGUES.map((league) => league.code));

export function loadLeagueHistory(leagueCode) {
  if (!historyCache.has(leagueCode)) historyCache.set(leagueCode, fetchLeagueHistory(leagueCode));
  return historyCache.get(leagueCode);
}

export function forgetCachedData() {
  historyCache.clear();
  fixturesPromise = undefined;
}

async function fetchLeagueHistory(leagueCode) {
  const seasons = await Promise.all(seasonCodes().map((season) => fetchSeason(leagueCode, season)));
  const loaded = seasons.filter((season) => season.loaded);
  if (loaded.length === 0) throw new Error(`No ${leagueCode} results could be loaded from ${SOURCE}`);
  const matches = loaded.flatMap((season) => season.matches).filter((match) => match.played);
  return {
    leagueCode,
    matches: matches.sort((a, b) => a.kickoff - b.kickoff),
    fetchedAt: new Date(Math.min(...loaded.map((season) => season.fetchedAt.getTime()))),
    seasons: seasons.map(({ season, loaded: ok, rows, error }) => ({ season, ok, rows, error }))
  };
}

async function fetchSeason(leagueCode, season) {
  const key = `${SOURCE} ${leagueCode} ${season}`;
  try {
    const download = await fetchText(`api/fd/mmz4281/${season}/${leagueCode}.csv`, SOURCE);
    const matches = parseRecords(download.text);
    recordSourceSuccess(key, { rows: matches.length, fetchedAt: download.fetchedAt, stale: download.staleReason });
    return { season, loaded: true, matches, rows: matches.length, fetchedAt: download.fetchedAt, error: '' };
  } catch (error) {
    recordSourceFailure(key, { fetchedAt: new Date(), error: error.message });
    return { season, loaded: false, matches: [], rows: 0, fetchedAt: new Date(), error: error.message };
  }
}

export function loadFixtures() {
  if (!fixturesPromise) fixturesPromise = fetchFixtures();
  return fixturesPromise;
}

async function fetchFixtures() {
  const key = `${SOURCE} fixtures`;
  try {
    const download = await fetchText('api/fd/fixtures.csv', SOURCE);
    // The feed sometimes lists competitions the model has no history for (e.g. EC, the National League); skip them.
    const fixtures = parseRecords(download.text).filter((fixture) => KNOWN_LEAGUES.has(fixture.league)).sort((a, b) => a.kickoff - b.kickoff);
    recordSourceSuccess(key, { rows: fixtures.length, fetchedAt: download.fetchedAt, stale: download.staleReason });
    return { fixtures, fetchedAt: download.fetchedAt, staleReason: download.staleReason };
  } catch (error) {
    recordSourceFailure(key, { fetchedAt: new Date(), error: error.message });
    fixturesPromise = undefined;
    throw error;
  }
}

function parseRecords(text) {
  return parseCsv(text)
    .filter((row) => row.Div && row.HomeTeam && row.AwayTeam && row.Date)
    .map(safeRecord)
    .filter(Boolean);
}

function safeRecord(row) {
  try {
    return toMatchRecord(row);
  } catch {
    return undefined;
  }
}
