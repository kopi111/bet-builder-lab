// One entry point for the UI: domestic leagues come from football-data.co.uk, the Champions League from championsLeague.js.
import { CHAMPIONS_LEAGUE } from '../config.js';
import { forgetCachedData as forgetDomesticData, loadFixtures as loadDomesticFixtures, loadLeagueHistory as loadDomesticHistory } from './footballData.js';
import { forgetChampionsLeagueData, loadChampionsLeagueFixtures, loadChampionsLeagueHistory } from './championsLeague.js';

let fixturesPromise;

export function loadLeagueHistory(leagueCode) {
  return leagueCode === CHAMPIONS_LEAGUE.code ? loadChampionsLeagueHistory() : loadDomesticHistory(leagueCode);
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
}

async function combinedFixtures() {
  const [domestic, european] = await Promise.all([loadDomesticFixtures(), europeanFixtures()]);
  return {
    ...domestic,
    fixtures: [...domestic.fixtures, ...european.fixtures].sort((a, b) => a.kickoff - b.kickoff),
    notes: european.note ? [european.note] : []
  };
}

async function europeanFixtures() {
  try {
    return await loadChampionsLeagueFixtures();
  } catch (error) {
    return { fixtures: [], note: `Champions League fixtures unavailable: ${error.message}` };
  }
}
