import { loadFixtures, loadLeagueHistory } from '../data/feeds.js';
import { loadPlayerContext } from '../data/apiFootball.js';
import { NoPlayerContext } from '../model/playerContext.js';
import { analyseMatch } from '../model/analysis.js';
import { matchId } from '../data/matchRecord.js';
import { backtestSummaries, loadSettings, recordAnalysis } from '../store/appState.js';

const analyses = new Map();
const CUSTOM_PREFIX = 'custom';

export function customMatchId(league, home, away) {
  return [CUSTOM_PREFIX, league, home, away].join('|');
}

export async function findFixture(id) {
  const [prefix, ...rest] = id.split('|');
  if (prefix === CUSTOM_PREFIX) return customFixture(...rest);
  const upcoming = await upcomingFixture(id);
  if (upcoming) return upcoming;
  const history = await loadLeagueHistory(prefix);
  const past = history.matches.find((match) => match.id === id);
  if (!past) throw new Error('This match is no longer in the data feed. Pick it again from the fixture list.');
  return past;
}

async function upcomingFixture(id) {
  try {
    const feed = await loadFixtures();
    return feed.fixtures.find((fixture) => fixture.id === id);
  } catch {
    return undefined;
  }
}

function customFixture(league, home, away) {
  const kickoff = new Date();
  const noOdds = { home: NaN, draw: NaN, away: NaN, over25: NaN, under25: NaN, handicapLine: NaN, handicapHome: NaN, handicapAway: NaN };
  return {
    id: customMatchId(league, home, away), league, kickoff, home, away, referee: '', played: false, custom: true,
    stats: {}, odds: { opening: noOdds, closing: noOdds }
  };
}

export function analyse(id) {
  if (!analyses.has(id)) {
    const pending = runAnalysis(id);
    pending.catch(() => analyses.delete(id));
    analyses.set(id, pending);
  }
  return analyses.get(id);
}

export function forgetAnalyses() {
  analyses.clear();
}

async function runAnalysis(id) {
  const fixture = await findFixture(id);
  const [history, players] = await Promise.all([loadLeagueHistory(fixture.league), playerContextFor(fixture)]);
  const analysis = analyseMatch(history, fixture, players, loadSettings(), backtestSummaries()[fixture.league]);
  recordAnalysis(analysis);
  return analysis;
}

function playerContextFor(fixture) {
  if (fixture.played) return Promise.resolve(new NoPlayerContext('historical replay: player data is only fetched for upcoming matches'));
  if (fixture.custom) return Promise.resolve(new NoPlayerContext('custom pairing: no real fixture to fetch line-ups for'));
  return loadPlayerContext(fixture);
}

export function analysisIfReady(id) {
  return analyses.get(id);
}

export { matchId };
