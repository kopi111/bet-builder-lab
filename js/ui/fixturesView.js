import { h, replaceContent, badge } from '../util/dom.js';
import { decimalOdds, dayHeading, kickoffText, percent, signedPercent, stampText, userTimezone } from '../util/format.js';
import { localDateKey } from '../util/time.js';
import { CUP_COMPETITIONS, FEATURED_LEAGUES, LEAGUES, leagueByCode } from '../config.js';
import { loadFixtures, loadLeagueHistory } from '../data/feeds.js';
import { isBeforeToday } from '../data/matchRecord.js';
import { analyse, analysisIfReady, customMatchId } from './matchService.js';
import { isMatchSaved, recentAnalyses, savedMatches, toggleSavedMatch } from '../store/appState.js';
import { button, buttonLink, emptyState, errorPanel, kpi, loadingPanel, section } from './components.js';

const filters = { league: 'all', search: '', mode: 'upcoming', day: 'today' };

export async function renderFixtures(view, parameter, isCurrent) {
  const layout = h('div', { class: 'dashboard' });
  const mainColumn = h('div', { class: 'dashboard-main' });
  const sideColumn = h('div', { class: 'dashboard-side' }, sidePanels());
  layout.append(mainColumn, sideColumn);
  replaceContent(view, layout);
  replaceContent(mainColumn, loadingPanel('Loading this week\'s fixtures from football-data.co.uk…'));
  try {
    const feed = await loadFixtures();
    if (isCurrent()) drawMain(mainColumn, feed);
  } catch (error) {
    if (isCurrent()) replaceContent(mainColumn, errorPanel(error, 'Fixture feed unavailable'), customMatchupPanel());
  }
}

function drawMain(container, feed) {
  const list = h('div', { class: 'fixture-list', id: 'fixture-list' });
  const redraw = () => drawFixtureList(list, feed);
  replaceContent(container, kpiRow(feed), filterBar(feed, redraw), list, customMatchupPanel());
  redraw();
}

function kpiRow(feed) {
  const recent = recentAnalyses().filter((item) => !isBeforeToday(item.id));
  const withValue = recent.filter((item) => item.potentialValue.length > 0).length;
  const upcoming = feed.fixtures.filter((f) => f.kickoff > new Date()).length;
  return h('div', { class: 'kpi-row' },
    kpi('Upcoming fixtures', String(upcoming), `${feed.fixtures.length} in this week's feed`),
    kpi('Analysed', String(recent.length), 'in this browser'),
    kpi('Potential value flags', String(withValue), 'to investigate, not to trust blindly'),
    kpi('Fixture feed updated', stampText(feed.fetchedAt), feed.staleReason ? 'cached copy: source offline' : 'football-data.co.uk'));
}

function filterBar(feed, redraw) {
  const present = new Set(feed.fixtures.map((f) => f.league));
  const leagueSelect = h('select', { id: 'league-filter', 'aria-label': 'Competition' },
    h('option', { value: 'all' }, 'All competitions'),
    LEAGUES.map((league) => h('option', { value: league.code, selected: filters.league === league.code }, `${league.country} · ${league.name}${present.has(league.code) ? '' : ' (no fixtures this week)'}`)),
    CUP_COMPETITIONS.map((cup) => h('option', { value: cup.code, disabled: true }, `${cup.name} (not in the free feeds)`)));
  leagueSelect.addEventListener('change', () => {
    filters.league = leagueSelect.value;
    redraw();
  });
  const search = h('input', { type: 'search', placeholder: 'Search team', 'aria-label': 'Search team', value: filters.search });
  search.addEventListener('input', () => {
    filters.search = search.value.trim().toLowerCase();
    redraw();
  });
  const daySelect = h('select', { 'aria-label': 'Day' },
    h('option', { value: 'today', selected: filters.day === 'today' }, 'Today'),
    [...new Set(feed.fixtures.filter(notStarted).map((f) => localDateKey(f.kickoff)))].sort().map((day) =>
      h('option', { value: day, selected: filters.day === day }, dayHeading(new Date(`${day}T12:00:00`)))),
    h('option', { value: 'all', selected: filters.day === 'all' }, 'All days this week'));
  daySelect.addEventListener('change', () => {
    filters.day = daySelect.value;
    redraw();
  });
  const modeSelect = h('select', { 'aria-label': 'Show' },
    h('option', { value: 'upcoming', selected: filters.mode === 'upcoming' }, 'This week\'s fixtures'),
    h('option', { value: 'results', selected: filters.mode === 'results' }, 'Recent results (replay as of kick-off)'));
  modeSelect.addEventListener('change', () => {
    filters.mode = modeSelect.value;
    redraw();
  });
  return h('div', { class: 'filter-bar' },
    h('div', { class: 'chip-row', role: 'group', 'aria-label': 'Featured leagues' },
      [['all', 'All'], ...FEATURED_LEAGUES.map((code) => [code, leagueByCode(code).name])].map(([code, name]) =>
        h('button', { type: 'button', class: `chip${filters.league === code ? ' is-active' : ''}`, 'aria-pressed': String(filters.league === code), onclick: () => {
          filters.league = code;
          leagueSelect.value = code;
          redraw();
          document.querySelectorAll('.chip').forEach((chip) => chip.classList.toggle('is-active', chip.textContent === name));
        } }, name))),
    h('div', { class: 'filter-controls' }, daySelect, leagueSelect, search, modeSelect),
    h('p', { class: 'muted small' }, `Kick-off times shown in your timezone (${userTimezone}). Odds are Bet365 prices published by football-data.co.uk when the file was built; they move, so check the current price.`),
    (feed.notes || []).map((note) => h('p', { class: 'muted small' }, note)));
}

async function drawFixtureList(container, feed) {
  if (filters.mode === 'results') return drawResults(container);
  const fixtures = feed.fixtures.filter(matchesFilters);
  if (fixtures.length === 0) {
    const message = feed.fixtures.some(notStarted)
      ? 'No upcoming fixtures for this day or competition. Pick another day above, or "All days this week".'
      : 'Every match in the free feed has already been played. New fixtures usually appear mid-week. Switch to recent results to see how the finished matches went.';
    replaceContent(container, emptyState('No fixtures match', message));
    return;
  }
  const leaguesShown = [...new Set(fixtures.map((f) => f.league))];
  const analyseButton = leaguesShown.length === 1
    ? button(`Analyse all ${fixtures.length} ${leagueByCode(leaguesShown[0]).name} fixtures`, () => analyseAll(fixtures, container, analyseButton), 'primary')
    : h('p', { class: 'muted small' }, 'Pick one competition to analyse all of its fixtures in one go.');
  replaceContent(container, analyseButton, groupByDay(fixtures).map(([, items]) =>
    h('section', { class: 'day-group' }, h('h2', { class: 'day-heading' }, dayHeading(items[0].kickoff)), h('div', { class: 'fixture-grid' }, items.map(fixtureCard)))));
}

function matchesFilters(fixture) {
  if (filters.league !== 'all' && fixture.league !== filters.league) return false;
  if (filters.mode === 'upcoming' && (!notStarted(fixture) || !onChosenDay(fixture))) return false;
  if (!filters.search) return true;
  return fixture.home.toLowerCase().includes(filters.search) || fixture.away.toLowerCase().includes(filters.search);
}

function notStarted(fixture) {
  return fixture.kickoff > new Date();
}

function onChosenDay(fixture) {
  if (filters.day === 'all') return true;
  const day = filters.day === 'today' ? localDateKey(new Date()) : filters.day;
  return localDateKey(fixture.kickoff) === day;
}

function groupByDay(fixtures) {
  const groups = new Map();
  fixtures.forEach((fixture) => {
    const key = localDateKey(fixture.kickoff);
    groups.set(key, [...(groups.get(key) || []), fixture]);
  });
  return [...groups.entries()];
}

function fixtureCard(fixture) {
  const league = leagueByCode(fixture.league);
  const started = fixture.kickoff <= new Date();
  const odds = fixture.odds.opening;
  const card = h('article', { class: 'fixture-card', dataset: { id: fixture.id } },
    h('header', {}, h('span', { class: 'league-tag' }, `${league.country} · ${league.name}`), h('time', { datetime: fixture.kickoff.toISOString() }, kickoffText(fixture.kickoff))),
    h('div', { class: 'teams' }, h('strong', {}, fixture.home), h('span', { class: 'versus' }, 'v'), h('strong', {}, fixture.away)),
    h('div', { class: 'odds-row', 'aria-label': 'Bet365 match odds' },
      oddsCell('1', odds.home), oddsCell('X', odds.draw), oddsCell('2', odds.away), oddsCell('O2.5', odds.over25), oddsCell('U2.5', odds.under25)),
    h('div', { class: 'card-analysis', 'aria-live': 'polite' }, started ? badge('Kicked off: replay only', 'neutral') : analysisStatus(fixture)),
    h('footer', {},
      buttonLink(`#/match/${encodeURIComponent(fixture.id)}`, 'Report', 'primary'),
      buttonLink(`#/builder/${encodeURIComponent(fixture.id)}`, 'Bet Builder'),
      saveButton(fixture)));
  fillFromCache(card, fixture);
  return card;
}

function oddsCell(label, value) {
  return h('span', { class: 'odds-cell' }, h('small', {}, label), h('span', { class: 'mono' }, decimalOdds(value)));
}

function analysisStatus(fixture) {
  const recent = recentAnalyses().find((item) => item.id === fixture.id);
  return recent ? badge(recent.verdict, recent.tone) : badge('Not analysed', 'neutral');
}

function saveButton(fixture) {
  const saved = isMatchSaved(fixture.id);
  const control = h('button', { type: 'button', class: 'button button-ghost', 'aria-pressed': String(saved) }, saved ? '★ Saved' : '☆ Save');
  control.addEventListener('click', () => {
    const nowSaved = toggleSavedMatch(fixture);
    control.textContent = nowSaved ? '★ Saved' : '☆ Save';
    control.setAttribute('aria-pressed', String(nowSaved));
  });
  return control;
}

async function fillFromCache(card, fixture) {
  const pending = analysisIfReady(fixture.id);
  if (pending) showCardAnalysis(card, await pending);
}

function showCardAnalysis(card, analysis) {
  const result = analysis.tables[0].rows;
  const potential = analysis.valueSignals.filter((s) => s.verdict.kind === 'potential');
  replaceContent(card.querySelector('.card-analysis'),
    h('span', { class: 'mini-probs mono' }, `Model ${percent(result[0].probability, 0)} / ${percent(result[1].probability, 0)} / ${percent(result[2].probability, 0)}`),
    badge(analysis.assessment.verdict, analysis.assessment.tone),
    potential.map((s) => badge(`${s.label} EV ${signedPercent(s.comparison.expectedValue)}`, 'warn')));
}

async function analyseAll(fixtures, container, trigger) {
  trigger.disabled = true;
  for (const [index, fixture] of fixtures.entries()) {
    trigger.textContent = `Analysing ${index + 1} of ${fixtures.length}…`;
    const card = container.querySelector(`[data-id="${CSS.escape(fixture.id)}"]`);
    try {
      const analysis = await analyse(fixture.id);
      if (card) showCardAnalysis(card, analysis);
    } catch (error) {
      if (card) replaceContent(card.querySelector('.card-analysis'), badge(`Analysis failed: ${error.message}`, 'bad'));
    }
  }
  trigger.textContent = 'Analysis complete';
}

async function drawResults(container) {
  if (filters.league === 'all') {
    replaceContent(container, emptyState('Pick a competition', 'Recent results are loaded one league at a time.'));
    return;
  }
  replaceContent(container, loadingPanel('Loading results…'));
  try {
    const history = await loadLeagueHistory(filters.league);
    const recent = history.matches.filter(matchesFilters).slice(-24).reverse();
    replaceContent(container,
      h('p', { class: 'muted small' }, 'Replays fit the model only on matches played before kick-off, so you can check what it would have said without hindsight.'),
      h('div', { class: 'fixture-grid' }, recent.map(resultCard)));
  } catch (error) {
    replaceContent(container, errorPanel(error, 'Results unavailable'));
  }
}

function resultCard(match) {
  return h('article', { class: 'fixture-card' },
    h('header', {}, h('span', { class: 'league-tag' }, leagueByCode(match.league).name), h('time', { datetime: match.kickoff.toISOString() }, kickoffText(match.kickoff))),
    h('div', { class: 'teams' }, h('strong', {}, match.home), h('span', { class: 'score mono' }, `${match.stats.homeGoals}–${match.stats.awayGoals}`), h('strong', {}, match.away)),
    h('footer', {}, buttonLink(`#/match/${encodeURIComponent(match.id)}`, 'Replay report', 'primary'), buttonLink(`#/builder/${encodeURIComponent(match.id)}`, 'Replay builder')));
}

function customMatchupPanel() {
  const leagueSelect = h('select', { 'aria-label': 'League for custom match-up' }, LEAGUES.map((league) => h('option', { value: league.code }, `${league.country} · ${league.name}`)));
  const homeSelect = h('select', { 'aria-label': 'Home team', disabled: true }, h('option', {}, 'Pick a league first'));
  const awaySelect = h('select', { 'aria-label': 'Away team', disabled: true }, h('option', {}, 'Pick a league first'));
  const message = h('p', { class: 'muted small', role: 'status' });
  const go = button('Analyse match-up', () => {
    if (homeSelect.value === awaySelect.value) {
      message.textContent = 'Home and away team must be different.';
      return;
    }
    window.location.hash = `#/match/${encodeURIComponent(customMatchId(leagueSelect.value, homeSelect.value, awaySelect.value))}`;
  }, 'primary', { disabled: true });
  const loadTeams = async () => {
    message.textContent = 'Loading teams…';
    try {
      const history = await loadLeagueHistory(leagueSelect.value);
      const recentCut = history.matches[history.matches.length - 1].kickoff.getTime() - 120 * 86400000;
      const teams = [...new Set(history.matches.filter((m) => m.kickoff.getTime() >= recentCut).flatMap((m) => [m.home, m.away]))].sort();
      [homeSelect, awaySelect].forEach((select, i) => {
        replaceContent(select, teams.map((team, index) => h('option', { value: team, selected: index === i }, team)));
        select.disabled = false;
      });
      go.disabled = false;
      message.textContent = `${teams.length} teams with league matches in the last four months of data.`;
    } catch (error) {
      message.textContent = `Could not load teams: ${error.message}`;
    }
  };
  leagueSelect.addEventListener('change', loadTeams);
  return section('Custom match-up', 'Analyse any two teams from the same league, with no bookmaker odds attached.',
    h('div', { class: 'filter-controls' }, leagueSelect, homeSelect, awaySelect, go, button('Load teams', loadTeams)), message);
}

function sidePanels() {
  const recent = recentAnalyses().filter((item) => !isBeforeToday(item.id));
  const best = recent.flatMap((item) => item.topMarkets.map((market) => ({ ...market, item })))
    .sort((a, b) => b.probability - a.probability).slice(0, 6);
  const saved = savedMatches().filter((item) => !isBeforeToday(item.id));
  return [
    section('Best-supported markets', 'Highest-evidence selections from your recent analyses (not the biggest payouts).',
      best.length ? h('ul', { class: 'compact-list' }, best.map((m) => h('li', {}, h('a', { href: `#/match/${encodeURIComponent(m.item.id)}` }, `${m.item.home} v ${m.item.away}`), h('span', {}, `${m.label} · ${percent(m.probability, 0)} · ${m.confidence}`))))
        : emptyState('Nothing analysed yet', 'Open a fixture report to start.')),
    section('Saved matches', '',
      saved.length ? h('ul', { class: 'compact-list' }, saved.map((s) => h('li', {}, h('a', { href: `#/match/${encodeURIComponent(s.id)}` }, `${s.home} v ${s.away}`), h('span', {}, kickoffText(new Date(s.kickoff))))))
        : emptyState('No saved matches', 'Use ☆ Save on a fixture card.')),
    section('Recent analyses', '',
      recent.length ? h('ul', { class: 'compact-list' }, recent.slice(0, 8).map((r) => h('li', {}, h('a', { href: `#/match/${encodeURIComponent(r.id)}` }, `${r.home} v ${r.away}`), badge(r.verdict, r.tone))))
        : emptyState('No analyses yet', 'Your last 30 analyses are kept in this browser.'))
  ];
}
