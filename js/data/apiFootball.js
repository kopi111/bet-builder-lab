import { fetchJson } from './httpClient.js';
import { serverStatus } from './serverStatus.js';
import { recordSourceFailure, recordSourceSuccess } from './sourceStatus.js';
import { leagueByCode } from '../config.js';
import { NoPlayerContext, PlayerContext } from '../model/playerContext.js';

const SOURCE = 'API-Football';
const MAX_PLAYER_PAGES = 3;
const TEAM_ALIASES = {
  'man united': 'manchester united', 'man city': 'manchester city', "nott'm forest": 'nottingham forest',
  wolves: 'wolverhampton wanderers', spurs: 'tottenham', 'sheffield weds': 'sheffield wednesday',
  'ath madrid': 'atletico madrid', 'ath bilbao': 'athletic club', 'sociedad': 'real sociedad',
  'betis': 'real betis', 'celta': 'celta vigo', 'espanol': 'espanyol', 'paris sg': 'paris saint germain',
  "m'gladbach": 'borussia monchengladbach', 'ein frankfurt': 'eintracht frankfurt', 'fc koln': '1. fc koln',
  'leverkusen': 'bayer leverkusen', 'dortmund': 'borussia dortmund', 'inter': 'inter', 'milan': 'ac milan'
};

export function playerProviderStatus() {
  return serverStatus();
}

export async function loadPlayerContext(fixture) {
  const status = await playerProviderStatus();
  if (!status.apiFootball.configured) return new NoPlayerContext('no player data provider configured (set APIFOOTBALL_KEY)');
  try {
    return await fetchPlayerContext(fixture);
  } catch (error) {
    recordSourceFailure(`${SOURCE} ${fixture.home} v ${fixture.away}`, { fetchedAt: new Date(), error: error.message });
    return new NoPlayerContext(`player data failed: ${error.message}`);
  }
}

async function fetchPlayerContext(fixture) {
  const league = leagueByCode(fixture.league);
  const season = seasonStartYear(fixture.kickoff);
  const apiFixture = await findApiFixture(fixture, league.apiFootballId, season);
  const [lineups, injuries, homeSquad, awaySquad] = await Promise.all([
    apiGet(`fixtures/lineups?fixture=${apiFixture.fixture.id}`),
    apiGet(`injuries?fixture=${apiFixture.fixture.id}`),
    loadSquad(apiFixture.teams.home.id, season),
    loadSquad(apiFixture.teams.away.id, season)
  ]);
  const lineupsConfirmed = lineups.length === 2;
  const players = [
    ...homeSquad.map((entry) => toPlayer(entry, 'home', lineups, injuries)),
    ...awaySquad.map((entry) => toPlayer(entry, 'away', lineups, injuries))
  ].filter((player) => player.minutes > 0);
  recordSourceSuccess(`${SOURCE} ${fixture.home} v ${fixture.away}`, { rows: players.length, fetchedAt: new Date(), stale: '' });
  return new PlayerContext(players, {
    lineupsConfirmed,
    fetchedAt: new Date(),
    message: lineupsConfirmed ? 'Confirmed line-ups loaded' : 'Line-ups not published yet: start chances estimated from season starts'
  });
}

async function findApiFixture(fixture, leagueId, season) {
  const day = fixture.kickoff.toISOString().slice(0, 10);
  const candidates = await apiGet(`fixtures?league=${leagueId}&season=${season}&date=${day}`);
  const found = candidates.find((c) => sameTeam(c.teams.home.name, fixture.home) && sameTeam(c.teams.away.name, fixture.away));
  if (!found) throw new Error(`fixture ${fixture.home} v ${fixture.away} on ${day} not found`);
  return found;
}

async function loadSquad(teamId, season) {
  const first = await apiGetPage(`players?team=${teamId}&season=${season}&page=1`);
  const pages = Math.min(MAX_PLAYER_PAGES, first.paging?.total || 1);
  const rest = await Promise.all(Array.from({ length: pages - 1 }, (_, i) => apiGetPage(`players?team=${teamId}&season=${season}&page=${i + 2}`)));
  return [first, ...rest].flatMap((page) => page.response || []);
}

function toPlayer(entry, side, lineups, injuries) {
  const stats = entry.statistics?.[0] || {};
  const games = stats.games || {};
  const minutes = games.minutes || 0;
  const per90 = (value) => (minutes > 0 && Number.isFinite(value) ? value * 90 / minutes : NaN);
  const injury = injuries.find((item) => item.player?.id === entry.player.id);
  const lineupStatus = statusFromLineups(entry.player.id, lineups);
  return {
    id: entry.player.id,
    name: entry.player.name,
    side,
    position: games.position || 'Unknown',
    appearances: games.appearences || 0,
    starts: games.lineups || 0,
    minutes,
    status: injury ? 'out' : lineupStatus,
    statusNote: injury ? `${injury.player.type || 'Unavailable'}: ${injury.player.reason || 'no reason given'}` : lineupStatus,
    startProbability: startProbability(lineupStatus, games),
    minutesWhenStarting: Math.min(90, minutes / Math.max(1, games.lineups || games.appearences || 1)),
    per90: {
      goals: per90(stats.goals?.total ?? 0), assists: per90(stats.goals?.assists ?? 0),
      shots: per90(stats.shots?.total ?? 0), shotsOnTarget: per90(stats.shots?.on ?? 0),
      tackles: per90(stats.tackles?.total ?? NaN), passes: per90(stats.passes?.total ?? NaN),
      foulsCommitted: per90(stats.fouls?.committed ?? 0), foulsDrawn: per90(stats.fouls?.drawn ?? 0),
      cards: per90((stats.cards?.yellow ?? 0) + (stats.cards?.red ?? 0)),
      saves: games.position === 'Goalkeeper' ? per90(stats.goals?.saves ?? 0) : NaN
    }
  };
}

function statusFromLineups(playerId, lineups) {
  if (lineups.length === 0) return 'unconfirmed';
  const starting = lineups.some((team) => (team.startXI || []).some((item) => item.player.id === playerId));
  if (starting) return 'starting';
  const bench = lineups.some((team) => (team.substitutes || []).some((item) => item.player.id === playerId));
  return bench ? 'bench' : 'out';
}

function startProbability(lineupStatus, games) {
  if (lineupStatus === 'starting') return 1;
  if (lineupStatus === 'bench' || lineupStatus === 'out') return 0;
  return Math.min(0.95, (games.lineups || 0) / Math.max(1, games.appearences || 1)) * 0.9;
}

async function apiGet(path) {
  const page = await apiGetPage(path);
  if (page.errors && Object.keys(page.errors).length > 0) throw new Error(Object.values(page.errors).join('; '));
  return page.response || [];
}

function apiGetPage(path) {
  return fetchJson(`api/af/${path}`, SOURCE);
}

function sameTeam(apiName, sourceName) {
  const api = normaliseTeam(apiName);
  const source = normaliseTeam(TEAM_ALIASES[sourceName.toLowerCase()] || sourceName);
  return api === source || api.includes(source) || source.includes(api);
}

function normaliseTeam(name) {
  return name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\b(fc|afc|cf|sc|ac|ssc|as)\b/g, '').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

function seasonStartYear(kickoff) {
  return kickoff.getUTCMonth() >= 6 ? kickoff.getUTCFullYear() : kickoff.getUTCFullYear() - 1;
}
