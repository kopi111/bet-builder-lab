import { h, replaceContent, table, badge } from '../util/dom.js';
import { stampText } from '../util/format.js';
import { sourceEntries } from '../data/sourceStatus.js';
import { serverStatus } from '../data/serverStatus.js';
import { forgetCachedData } from '../data/feeds.js';
import { forgetAnalyses } from './matchService.js';
import { button, definition, list, section, toast } from './components.js';

const FIELD_COVERAGE = [
  ['Fixtures (this week)', 'yes', 'yes'],
  ['Results, half-time scores', 'yes', 'yes'],
  ['Shots, shots on target, fouls, corners, cards', 'yes (most leagues)', 'yes, per fixture'],
  ['Referee', 'results only, rarely for fixtures', 'yes'],
  ['Bet365 1X2, over/under 2.5, Asian handicap', 'yes, plus closing prices', 'paid plans'],
  ['Bet365 Bet Builder prices', 'no', 'no (no public feed exists)'],
  ['Expected goals (xG)', 'no', 'some leagues'],
  ['Line-ups, injuries, suspensions', 'no', 'yes'],
  ['Player season statistics', 'no', 'yes'],
  ['Champions League', 'no (results via openfootball / football-data.org, no odds)', 'yes'],
  ['Europa League', 'no', 'yes']
];

export async function renderSources(view) {
  const status = await serverStatus();
  const entries = sourceEntries();
  replaceContent(view,
    section('Data-source status', 'Every file the app has requested in this session.',
      entries.length ? table(['Source / file', 'Status', 'Rows', 'Fetched', 'Note'], entries.map((e) => [e.key, badge(e.ok ? (e.stale ? 'cached copy' : 'ok') : 'failed', e.ok ? (e.stale ? 'warn' : 'good') : 'bad'), String(e.rows), stampText(e.fetchedAt), e.error || e.stale || '']))
        : h('p', { class: 'muted' }, 'Nothing loaded yet. Open the fixtures page or a match report.'),
      button('Clear cached data in this tab and reload', () => {
        forgetCachedData();
        forgetAnalyses();
        toast('Cleared. Data will be fetched again.');
      }, 'ghost')),
    section('Providers', '',
      definition([
        ['football-data.co.uk', 'Free CSV files with results, match statistics and Bet365 prices, proxied and cached by server.js (3 hours for the current season, 7 days for older seasons).'],
        ['API-Football (optional)', status.apiFootball.configured ? h('span', {}, badge('key configured', 'good'), ' Player statistics, line-ups and injuries are fetched for upcoming matches.') : h('span', {}, badge('not configured', 'neutral'), ' Player markets are off. Start the server with APIFOOTBALL_KEY set to enable them.')],
        ['openfootball (GitHub)', 'Free Champions League results for 2024-25, used with the domestic top flights to rate clubs from different leagues against each other.'],
        ['football-data.org (optional)', status.footballDataOrg?.configured ? h('span', {}, badge('key configured', 'good'), ' Champions League fixtures and results for 2025-26 and the current season.') : h('span', {}, badge('not configured', 'neutral'), ' No current Champions League fixtures. Start the server with FOOTBALL_DATA_ORG_KEY set (free key from football-data.org).')],
        ['Odds', 'Only Bet365 prices that football-data.co.uk publishes are shown. Everything else, including every Bet Builder price, must be typed in from the app.']
      ])),
    section('What each provider supplies', '', table(['Field', 'football-data.co.uk', 'API-Football'], FIELD_COVERAGE)),
    section('Adding a provider', '', list([
      'Keep keys on the server: add an allow-listed route in server.js that reads the key from an environment variable, never from browser code.',
      'Map the provider\'s match into the same match record shape as js/data/matchRecord.js (kickoff, teams, stats, odds) so the model needs no changes.',
      'Record success or failure with recordSourceSuccess / recordSourceFailure so it shows on this page.',
      'If a provider is down, show the failure; never fill in made-up numbers.'
    ])));
}
