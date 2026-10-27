export const LEAGUES = [
  { code: 'E0', name: 'Premier League', country: 'England', apiFootballId: 39, espnId: 700 },
  { code: 'E1', name: 'Championship', country: 'England', apiFootballId: 40, espnId: 3914 },
  { code: 'E2', name: 'League One', country: 'England', apiFootballId: 41, espnId: 3915 },
  { code: 'E3', name: 'League Two', country: 'England', apiFootballId: 42, espnId: 3916 },
  { code: 'SP1', name: 'La Liga', country: 'Spain', apiFootballId: 140, espnId: 740 },
  { code: 'SP2', name: 'La Liga 2', country: 'Spain', apiFootballId: 141, espnId: 3921 },
  { code: 'I1', name: 'Serie A', country: 'Italy', apiFootballId: 135, espnId: 730 },
  { code: 'I2', name: 'Serie B', country: 'Italy', apiFootballId: 136, espnId: 3931 },
  { code: 'D1', name: 'Bundesliga', country: 'Germany', apiFootballId: 78, espnId: 720 },
  { code: 'D2', name: '2. Bundesliga', country: 'Germany', apiFootballId: 79, espnId: 3927 },
  { code: 'F1', name: 'Ligue 1', country: 'France', apiFootballId: 61, espnId: 710 },
  { code: 'F2', name: 'Ligue 2', country: 'France', apiFootballId: 62, espnId: 3926 },
  { code: 'N1', name: 'Eredivisie', country: 'Netherlands', apiFootballId: 88, espnId: 725 },
  { code: 'P1', name: 'Primeira Liga', country: 'Portugal', apiFootballId: 94, espnId: 715 },
  { code: 'B1', name: 'Pro League', country: 'Belgium', apiFootballId: 144, espnId: 3901 },
  { code: 'T1', name: 'Süper Lig', country: 'Turkey', apiFootballId: 203, espnId: 3946 },
  { code: 'G1', name: 'Super League', country: 'Greece', apiFootballId: 197, espnId: 3955 },
  { code: 'SC0', name: 'Premiership', country: 'Scotland', apiFootballId: 179, espnId: 735 },
  { code: 'SC1', name: 'Championship', country: 'Scotland', apiFootballId: 180, espnId: 3940 },
  { code: 'SC2', name: 'League One', country: 'Scotland', apiFootballId: 183, espnId: 3941 },
  { code: 'SC3', name: 'League Two', country: 'Scotland', apiFootballId: 184, espnId: 3942 },
  { code: 'CL', name: 'Champions League', country: 'Europe', apiFootballId: 2, pooled: true }
];

export const CHAMPIONS_LEAGUE = Object.freeze({
  code: 'CL',
  pastSeasonFiles: ['2024-25'],
  footballDataOrgSeasons: [2025, null],
  countryLeagues: {
    ENG: 'E0', ESP: 'SP1', ITA: 'I1', GER: 'D1', DEU: 'D1', FRA: 'F1', MCO: 'F1', MON: 'F1', NED: 'N1', NLD: 'N1',
    POR: 'P1', PRT: 'P1', BEL: 'B1', TUR: 'T1', GRE: 'G1', GRC: 'G1', SCO: 'SC0'
  }
});

export const CUP_COMPETITIONS = [
  { code: 'UEL', name: 'Europa League', apiFootballId: 3 },
  { code: 'UECL', name: 'Conference League', apiFootballId: 848 }
];

export const FEATURED_LEAGUES = ['E0', 'E1', 'SP1', 'I1', 'D1', 'F1', 'CL'];

export const SEASONS_TO_LOAD = 3;

export const DEFAULT_SETTINGS = Object.freeze({
  halfLifeDays: 180,
  shrinkageMatches: 4,
  shotsOnTargetBlend: 0.35,
  dixonColesRho: -0.06,
  simulations: 40000,
  valueThreshold: 0.03,
  minimumTeamMatches: 6
});

export function leagueByCode(code) {
  const league = LEAGUES.find((candidate) => candidate.code === code);
  if (!league) throw new Error(`Unknown league code ${code}`);
  return league;
}

export function seasonCodes(today = new Date(), count = SEASONS_TO_LOAD) {
  const startYear = today.getMonth() >= 6 ? today.getFullYear() : today.getFullYear() - 1;
  return Array.from({ length: count }, (_, index) => seasonCode(startYear - index));
}

function seasonCode(startYear) {
  const twoDigits = (year) => String(year % 100).padStart(2, '0');
  return twoDigits(startYear) + twoDigits(startYear + 1);
}
