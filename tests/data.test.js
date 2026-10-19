import test from 'node:test';
import assert from 'node:assert/strict';
import { splitCountry, TeamNameMatcher } from '../js/data/teamNameMatcher.js';
import { openFootballRecords } from '../js/data/championsLeague.js';
import { CHAMPIONS_LEAGUE } from '../js/config.js';

const TEAMS = new Map([
  ['E0', ['Arsenal', 'Man City', 'Man United', 'Newcastle', 'Aston Villa']],
  ['F1', ['Paris SG', 'Paris FC', 'Brest', 'Monaco']],
  ['I1', ['Inter', 'Milan', 'Napoli']],
  ['P1', ['Benfica', 'Sp Lisbon', 'Sp Braga', 'Porto']],
  ['D1', ['Bayern Munich', 'Leverkusen', 'Dortmund']],
  ['B1', ['Club Brugge', 'Cercle Brugge', 'St. Gilloise']]
]);
const matcher = new TeamNameMatcher(CHAMPIONS_LEAGUE.countryLeagues, TEAMS);

test('European club names map onto football-data.co.uk names', () => {
  const cases = [
    ['Manchester City FC', 'ENG', 'Man City'], ['Newcastle United FC', 'ENG', 'Newcastle'],
    ['Paris Saint-Germain FC', 'FRA', 'Paris SG'], ['Stade Brestois 29', 'FRA', 'Brest'], ['AS Monaco FC', 'MCO', 'Monaco'],
    ['FC Internazionale Milano', 'ITA', 'Inter'], ['AC Milan', 'ITA', 'Milan'],
    ['Sport Lisboa e Benfica', 'POR', 'Benfica'], ['Sporting Clube de Portugal', 'POR', 'Sp Lisbon'],
    ['FC Bayern München', 'GER', 'Bayern Munich'], ['FC Bayern München', 'DEU', 'Bayern Munich'],
    ['Club Brugge KV', 'BEL', 'Club Brugge'], ['Royale Union Saint-Gilloise', 'BEL', 'St. Gilloise']
  ];
  cases.forEach(([name, country, expected]) => assert.equal(matcher.match(name, country).name, expected, name));
});

test('Clubs from uncovered countries keep their own name and no league', () => {
  assert.deepEqual(matcher.match('FK Bodø/Glimt', 'NOR'), { name: 'FK Bodø/Glimt', league: null });
  assert.deepEqual(splitCountry('FK Crvena Zvezda (SRB)'), { name: 'FK Crvena Zvezda', country: 'SRB' });
});

test('openfootball rows become match records with 90-minute scores and no odds', () => {
  const [played, upcoming] = openFootballRecords({ matches: [
    { date: '2024-09-17', time: '21:00', team1: 'Arsenal FC (ENG)', team2: 'FC Bayern München (GER)', score: { ht: [1, 0], ft: [2, 2], et: [3, 2] } },
    { date: '2025-05-31', time: '21:00', team1: 'Paris Saint-Germain FC (FRA)', team2: 'FC Internazionale Milano (ITA)', score: {} }
  ] }, matcher);
  assert.equal(played.id, 'CL|2024-09-17|Arsenal|Bayern Munich');
  assert.equal(played.kickoff.toISOString(), '2024-09-17T20:00:00.000Z');
  assert.deepEqual([played.played, played.stats.homeGoals, played.stats.awayGoals, played.stats.homeHalfGoals], [true, 2, 2, 1]);
  assert.deepEqual([played.homeLeague, played.awayLeague], ['E0', 'D1']);
  assert.ok(Number.isNaN(played.odds.opening.home) && Number.isNaN(played.stats.homeCorners));
  assert.equal(upcoming.played, false);
});
