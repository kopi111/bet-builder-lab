// Maps European-competition club names ("FC Bayern München", country GER) onto football-data.co.uk names ("Bayern Munich").
const IGNORED_TOKENS = new Set(['fc', 'cf', 'sc', 'ac', 'afc', 'ssc', 'ss', 'as', 'bc', 'kv', 'sk', 'sfp', 'fk', 'jk', 'club', 'clube', 'de', 'e', 'the']);
const MINIMUM_PREFIX = 3;

// Names fuzzy matching cannot resolve: every listed token must appear in the full club name.
const KNOWN_CLUBS = [
  [['psv'], 'PSV Eindhoven'], [['az'], 'AZ Alkmaar'], [['bayern'], 'Bayern Munich'], [['internazionale'], 'Inter'],
  [['atletico', 'madrid'], 'Ath Madrid'], [['athletic'], 'Ath Bilbao'], [['saint', 'germain'], 'Paris SG'],
  [['sporting', 'portugal'], 'Sp Lisbon'], [['braga'], 'Sp Braga'], [['benfica'], 'Benfica'],
  [['monchengladbach'], "M'gladbach"], [['gilloise'], 'St. Gilloise'], [['olympiakos'], 'Olympiakos'],
  [['olympiacos'], 'Olympiakos'], [['sociedad'], 'Sociedad'], [['betis'], 'Betis'], [['espanyol'], 'Espanol'],
  [['nottingham'], "Nott'm Forest"], [['rayo'], 'Vallecano'], [['celta'], 'Celta'], [['saint', 'etienne'], 'St Etienne'],
  [['koln'], 'FC Koln'], [['pauli'], 'St Pauli']
];

export class TeamNameMatcher {
  constructor(countryLeagues, teamsByLeague) {
    this.countryLeagues = countryLeagues;
    this.teamsByLeague = teamsByLeague;
  }

  match(fullName, countryCode) {
    const league = this.countryLeagues[countryCode];
    const teams = this.teamsByLeague.get(league) || [];
    const name = knownClub(fullName, teams) || fuzzyMatch(fullName, teams);
    return name ? { name, league } : { name: fullName, league: null };
  }
}

export function splitCountry(labelledName) {
  const found = labelledName.match(/^(.*?)\s*\(([A-Z]{3})\)$/);
  return found ? { name: found[1], country: found[2] } : { name: labelledName, country: '' };
}

function knownClub(fullName, teams) {
  const tokens = new Set(rawTokens(fullName));
  const known = KNOWN_CLUBS.find(([required, name]) => teams.includes(name) && required.every((token) => tokens.has(token)));
  return known?.[1];
}

function fuzzyMatch(fullName, teams) {
  const tokens = meaningfulTokens(fullName);
  const fullMatches = teams.filter((team) => {
    const teamTokens = meaningfulTokens(team);
    return teamTokens.length > 0 && teamTokens.every((teamToken) => tokens.some((token) => sameWord(token, teamToken)));
  });
  return fullMatches.length === 1 ? fullMatches[0] : undefined;
}

function sameWord(a, b) {
  if (a === b) return true;
  return Math.min(a.length, b.length) >= MINIMUM_PREFIX && (a.startsWith(b) || b.startsWith(a));
}

function meaningfulTokens(name) {
  return rawTokens(name).filter((token) => !IGNORED_TOKENS.has(token) && !/^\d+$/.test(token));
}

function rawTokens(name) {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ø/g, 'o').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
}
