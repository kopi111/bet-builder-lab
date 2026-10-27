// One entry point for the UI: domestic leagues come from football-data.co.uk, the Champions League from championsLeague.js, English cups from englishCups.js.
import { CHAMPIONS_LEAGUE, ENGLISH_CUPS } from '../config.js';
import { forgetEnglishCupsData, loadEnglishCupsHistory } from './englishCups.js';
import { forgetCachedData as forgetDomesticData, loadFixtures as loadDomesticFixtures, loadLeagueHistory as loadDomesticHistory } from './footballData.js';
import { forgetChampionsLeagueData, loadChampionsLeagueFixtures, loadChampionsLeagueHistory } from './championsLeague.js';
import { loadEspnFixtures } from './espnFixtures.js';

let fixturesPromise;

export function loadLeagueHistory(leagueCode) {
  if (leagueCode === CHAMPIONS_LEAGUE.code) return loadChampionsLeagueHistory();
  if (leagueCode === ENGLISH_CUPS.code) return loadEnglishCupsHistory();
  return loadDomesticHistory(leagueCode);
}

export function loadFixtures() {
  if (!fixturesPromise) {
    fixturesPromise = combinedFixtures();
    fixturesPromise.catch(() => { fixturesPromise = undefined; });
  }
  return fixturesPromise;
}

export function forgetCachedData() {
  fixturesPromise = undefined;
  forgetDomesticData();
  forgetChampionsLeagueData();
  forgetEnglishCupsData();
}

async function combinedFixtures() {
  const [domestic, european, espn] = await Promise.all([loadDomesticFixtures(), europeanFixtures(), loadEspnFixtures(loadLeagueHistory)]);
  const listed = new Set(domestic.fixtures.map((fixture) => fixture.id));
  const extra = espn.filter((fixture) => !listed.has(fixture.id));
  const notes = european.note ? [european.note] : [];
  if (extra.length) notes.push(`${extra.length} upcoming fixtures come from ESPN (league games football-data.co.uk has not listed yet, plus Carabao Cup and FA Cup). They have no Bet365 prices, so they show model numbers only.`);
  return {
    ...domestic,
    fixtures: [...domestic.fixtures, ...european.fixtures, ...extra].sort((a, b) => a.kickoff - b.kickoff),
    notes
  };
}

async function europeanFixtures() {
  try {
    return await loadChampionsLeagueFixtures();
  } catch (error) {
    return { fixtures: [], note: `Champions League fixtures unavailable: ${error.message}` };
  }
}
