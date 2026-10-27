// Loads several seasons of one league's results through the server.js CSV proxy (server.js must be running).
import { parseCsv } from '../js/util/csv.js';
import { toMatchRecord } from '../js/data/matchRecord.js';
import { seasonCodes } from '../js/config.js';

const PROXY = process.env.PROXY || 'http://127.0.0.1:5350/api/fd';

// All played and scheduled rows for the last `seasonCount` seasons, oldest first.
export async function loadLeagueSeasons(leagueCode, seasonCount) {
  const seasons = await Promise.all(seasonCodes(new Date(), seasonCount).map((season) => loadSeason(leagueCode, season)));
  return seasons.flat().sort((a, b) => a.kickoff - b.kickoff);
}

// One season's CSV turned into match records; rows the parser rejects are skipped.
async function loadSeason(leagueCode, season) {
  const response = await fetch(`${PROXY}/mmz4281/${season}/${leagueCode}.csv`);
  if (!response.ok) return [];
  return parseCsv(await response.text())
    .filter((row) => row.Div && row.HomeTeam && row.AwayTeam && row.Date)
    .flatMap((row) => {
      try { return [{ ...toMatchRecord(row), season, otherOdds: otherOdds(row) }]; } catch { return []; }
    });
}

// Best price across bookmakers (Max*) and Betfair exchange (BFE*) opening odds, for price-shopping comparisons.
function otherOdds(row) {
  const number = (column) => Number.parseFloat(row[column]) || null;
  return {
    best: { home: number('MaxH'), draw: number('MaxD'), away: number('MaxA'), over25: number('Max>2.5'), under25: number('Max<2.5') },
    exchange: { home: number('BFEH'), draw: number('BFED'), away: number('BFEA'), over25: number('BFE>2.5'), under25: number('BFE<2.5') }
  };
}
