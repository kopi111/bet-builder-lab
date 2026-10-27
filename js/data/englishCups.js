// English cup history: the four English divisions pooled into one model, so clubs from different divisions
// (Arsenal v Fleetwood) can be rated against each other. Fixtures come from ESPN via espnFixtures.js.
import { ENGLISH_CUPS } from '../config.js';
import { loadLeagueHistory as loadDomesticHistory } from './footballData.js';

let historyPromise;

export function loadEnglishCupsHistory() {
  if (!historyPromise) {
    historyPromise = buildHistory();
    historyPromise.catch(() => { historyPromise = undefined; });
  }
  return historyPromise;
}

export function forgetEnglishCupsData() {
  historyPromise = undefined;
}

async function buildHistory() {
  const results = await Promise.allSettled(ENGLISH_CUPS.members.map(loadDomesticHistory));
  const divisions = results.filter((result) => result.status === 'fulfilled').map((result) => result.value);
  if (divisions.length === 0) throw new Error('None of the English divisions behind the cup ratings could be loaded');
  return {
    leagueCode: ENGLISH_CUPS.code,
    matches: divisions.flatMap((history) => history.matches).sort((a, b) => a.kickoff - b.kickoff),
    fetchedAt: new Date(Math.min(...divisions.map((history) => history.fetchedAt.getTime()))),
    seasons: divisions.flatMap((history) => history.seasons)
  };
}
