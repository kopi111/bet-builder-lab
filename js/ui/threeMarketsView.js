// "1X2 · BTTS · O2.5" page: this week's picks in the three core markets, each tagged with how the same
// kind of pick did in the walk-forward study, followed by the full evidence so the numbers can be checked.
import { h, replaceContent, table, badge } from '../util/dom.js';
import { decimalOdds, kickoffText, percent, signedPercent, stampText } from '../util/format.js';
import { leagueByCode } from '../config.js';
import { loadFixtures, loadLeagueHistory } from '../data/feeds.js';
import { LeagueModel } from '../model/leagueModel.js';
import { THREE_MARKETS, similarPicks, threeMarketPicks } from '../model/threeMarkets.js';
import { loadSettings } from '../store/appState.js';
import { emptyState, errorPanel, kpi, loadingPanel, probabilityBar, section } from './components.js';

const STUDY_URL = 'data/three-markets-study.json';
const MARKET_NAMES = { result: 'Match result (1X2)', btts: 'Both teams to score', goals: 'Over/Under 2.5 goals' };
const STRONG_HIT_RATE = 0.6;
const LARGE_DISAGREEMENT = 0.1;
const filters = { league: 'all', strongOnly: false };
let studyPromise;

export async function renderThreeMarkets(view, parameter, isCurrent) {
  const picksColumn = h('div', {}, loadingPanel('Fitting the model for this week\'s fixtures…'));
  const evidenceColumn = h('details', { class: 'research-toggle' }, h('summary', {}, 'Show the research behind these picks'));
  replaceContent(view, picksColumn, evidenceColumn);
  const study = await loadStudy().catch((error) => ({ error }));
  if (!isCurrent()) return;
  evidenceColumn.append(...[study.error ? errorPanel(study.error, 'Historical study missing') : evidencePanels(study)].flat());
  try {
    const rows = await weekPicks();
    if (isCurrent()) drawPicks(picksColumn, rows, study.error ? undefined : study);
  } catch (error) {
    if (isCurrent()) replaceContent(picksColumn, errorPanel(error, 'Fixture feed unavailable'));
  }
}

function loadStudy() {
  if (!studyPromise) {
    studyPromise = fetch(STUDY_URL).then((response) => {
      if (!response.ok) throw new Error(`${STUDY_URL} not found. Run: node tools/three-markets-study.mjs (with npm start running).`);
      return response.json();
    });
    studyPromise.catch(() => { studyPromise = undefined; });
  }
  return studyPromise;
}

// One model fit per league (as of now), then the three picks for every upcoming fixture in it.
async function weekPicks() {
  const feed = await loadFixtures();
  const upcoming = feed.fixtures.filter((fixture) => fixture.kickoff > new Date());
  const leagues = [...new Set(upcoming.map((fixture) => fixture.league))];
  const settings = loadSettings();
  const perLeague = await Promise.all(leagues.map(async (code) => {
    try {
      const history = await loadLeagueHistory(code);
      const model = LeagueModel.fit(history.matches, new Date(), settings);
      return upcoming.filter((f) => f.league === code).map((fixture) => threeMarketPicks(model, fixture));
    } catch (error) {
      return upcoming.filter((f) => f.league === code).map((fixture) => ({ fixture, failed: error.message }));
    }
  }));
  return { fetchedAt: feed.fetchedAt, staleReason: feed.staleReason, rows: perLeague.flat().sort((a, b) => a.fixture.kickoff - b.fixture.kickoff) };
}

function drawPicks(container, week, study) {
  const list = h('div', { class: 'three-list' });
  const redraw = () => replaceContent(list, visibleRows(week.rows, study).map((row) => fixtureRow(row, study)), emptyIfNone(week.rows, study));
  replaceContent(container,
    section('This week: three picks per match', `Model picks for upcoming fixtures in the free feed (updated ${stampText(week.fetchedAt)}). The tag on each pick is how often the same kind of pick won in ${study ? study.matches.toLocaleString() : 'the'} past matches.`,
      week.staleReason ? h('p', { class: 'negative small' }, `Fixture file is a cached copy (${week.staleReason}); some matches may be missing. Reload later.`) : '',
      pickFilters(week.rows, redraw), list));
  redraw();
}

function pickFilters(rows, redraw) {
  const leagues = [...new Set(rows.map((row) => row.fixture.league))];
  const select = h('select', { 'aria-label': 'Competition' },
    h('option', { value: 'all' }, 'All competitions'),
    leagues.map((code) => h('option', { value: code, selected: filters.league === code }, `${leagueByCode(code).country} · ${leagueByCode(code).name}`)));
  select.addEventListener('change', () => { filters.league = select.value; redraw(); });
  const strong = h('input', { type: 'checkbox', id: 'strong-only', checked: filters.strongOnly });
  strong.addEventListener('change', () => { filters.strongOnly = strong.checked; redraw(); });
  return h('div', { class: 'filter-controls' }, select,
    h('label', { class: 'check-label', for: 'strong-only' }, strong, ` Only matches with a pick that historically won ${percent(STRONG_HIT_RATE, 0)}+`));
}

function visibleRows(rows, study) {
  return rows.filter((row) => (filters.league === 'all' || row.fixture.league === filters.league) &&
    (!filters.strongOnly || (study && strongestHistory(row, study) >= STRONG_HIT_RATE)));
}

function emptyIfNone(rows, study) {
  return visibleRows(rows, study).length ? '' : emptyState('No fixtures to show', 'The free feed lists the current week only; new fixtures usually appear mid-week. Try another competition or untick the filter.');
}

function strongestHistory(row, study) {
  if (!row.picks || !row.covered) return 0;
  return Math.max(...THREE_MARKETS.map((market) => similarPicks(study, market, row.picks[market].probability)?.hitRate || 0));
}

function fixtureRow(row, study) {
  const { fixture } = row;
  const league = leagueByCode(fixture.league);
  return h('article', { class: 'three-card' },
    h('header', {},
      h('div', {}, h('strong', {}, `${fixture.home} v ${fixture.away}`), h('small', { class: 'muted' }, ` ${league.country} · ${league.name}`)),
      h('time', { class: 'muted small', datetime: fixture.kickoff.toISOString() }, kickoffText(fixture.kickoff))),
    row.failed ? h('p', { class: 'negative small' }, `No model for this league: ${row.failed}`)
      : !row.covered ? h('p', { class: 'muted small' }, 'Insufficient evidence: one of these teams has too few league matches in the data (often a promoted side).')
        : h('div', { class: 'three-picks' }, THREE_MARKETS.map((market) => pickCell(row.picks[market], study && similarPicks(study, market, row.picks[market].probability)))),
    h('footer', {}, h('a', { href: `#/match/${encodeURIComponent(fixture.id)}` }, 'Full match report →'),
      row.expectedGoals ? h('span', { class: 'muted small mono' }, `xG ${row.expectedGoals.home.toFixed(2)} – ${row.expectedGoals.away.toFixed(2)}`) : ''));
}

function pickCell(pick, history) {
  return h('div', { class: 'pick-cell' },
    h('small', { class: 'muted' }, pick.market),
    h('strong', {}, pick.label),
    probabilityBar(pick.probability),
    h('span', { class: 'small mono' }, `Fair ${decimalOdds(pick.fairOdds)} · Bet365 ${decimalOdds(pick.odds)}`),
    valueBadge(pick),
    history ? historyBadge(history) : '');
}

function valueBadge(pick) {
  if (!Number.isFinite(pick.odds)) return h('span', { class: 'muted small' }, 'No bookmaker price in the free data');
  const gap = pick.probability - pick.bookmakerFair;
  if (Math.abs(gap) > LARGE_DISAGREEMENT) {
    return h('span', { class: 'badge badge-bad', title: 'Gaps this big usually mean the model is missing team news (injuries, transfers, rotation), not that the bookmaker is wrong.' },
      `Model ${Math.round(gap * 100)} pts from Bet365: treat with caution`);
  }
  if (pick.expectedValue >= 0.03) return badge(`Price above fair: EV ${signedPercent(pick.expectedValue)}`, 'warn');
  if (pick.expectedValue >= 0) return badge(`Price about fair: EV ${signedPercent(pick.expectedValue)}`, 'neutral');
  return badge(`Price below fair: EV ${signedPercent(pick.expectedValue)}`, 'neutral');
}

function historyBadge(band) {
  const tone = band.hitRate >= STRONG_HIT_RATE ? 'good' : band.hitRate >= 0.5 ? 'warn' : 'bad';
  const roi = band.roi === null ? '' : ` · ROI ${signedPercent(band.roi)}`;
  return h('span', { class: `badge badge-${tone}`, title: `${band.bets} past picks with model confidence ${percent(band.from, 0)}–${percent(band.to, 0)}` },
    `Won ${percent(band.hitRate, 0)} of ${band.bets.toLocaleString()}${roi}`);
}

// ---------- Evidence ----------

function evidencePanels(study) {
  return [
    bottomLine(study),
    baseRatePanel(study),
    ...THREE_MARKETS.map((market) => marketPanel(study, market)),
    blindPanel(study),
    combinationPanel(study),
    leaguePanel(study),
    researchPanel()
  ];
}

function bottomLine(study) {
  const markets = study.markets;
  const top = THREE_MARKETS.map((m) => ({ m, band: topBand(markets[m].bands) }));
  return section('What the evidence says', `${study.matches.toLocaleString()} matches, ${study.leagues.length} leagues, ${study.from} to ${study.to}. Every prediction used only matches played before it.`,
    h('ul', { class: 'bullet-list' },
      h('li', {}, 'Confidence works: the surer the model, the more often its pick wins. ', top.map(({ m, band }) => `${MARKET_NAMES[m]} picks at ${percent(band.from, 0)}+ won ${percent(band.hitRate, 0)}. `)),
      h('li', {}, `Winning more often is not the same as making money. Confident picks get short Bet365 prices. Every pick at Bet365's price returned ${signedPercent(markets.result.all.roi)} on 1X2 and ${signedPercent(markets.goals.all.roi)} on Over/Under 2.5. The strongest 1X2 favourites came closest to breaking even (see the table), which matches the favourite-longshot research below.`),
      h('li', {}, `On seasons the study never tuned on (from ${study.unseenFrom}), 1X2 picks returned ${signedPercent(markets.result.unseen.roi)} and goals picks ${signedPercent(markets.goals.unseen.roi)}.`),
      h('li', {}, `Putting all three picks in one bet builder came in only ${percent(study.combinations.trebleAll.hitRate, 0)} of the time. Each extra leg multiplies the chance of losing.`),
      h('li', {}, 'Use these picks to find the most likely outcomes, not as a system for making money. Never stake more than you can afford to lose.')));
}

// Highest-confidence band that still has enough picks to mean something.
function topBand(bands) {
  return [...bands].reverse().find((band) => band.bets >= 300) || bands[bands.length - 1];
}

function baseRatePanel(study) {
  const b = study.baseRates;
  return h('div', { class: 'kpi-row' },
    kpi('Home wins', percent(b.home, 0), 'of all matches'),
    kpi('Draws', percent(b.draw, 0), 'the hardest to call'),
    kpi('Away wins', percent(b.away, 0), ''),
    kpi('Both teams scored', percent(b.bttsYes, 0), 'BTTS Yes'),
    kpi('3+ goals', percent(b.over25, 0), 'Over 2.5'));
}

function marketPanel(study, market) {
  const evidence = study.markets[market];
  const hasPrices = evidence.all.pricedBets > 0;
  const headers = ['Model confidence', 'Picks', 'Model said', 'Actually won', ...(hasPrices ? ['Avg odds', 'ROI at Bet365', 'Unseen seasons'] : ['Break-even odds', 'Unseen seasons'])];
  const rows = evidence.bands.map((band) => [
    `${percent(band.from, 0)}–${percent(band.to, 0)}`,
    band.bets.toLocaleString(),
    percent(band.averageProbability, 0),
    h('strong', {}, percent(band.hitRate, 0)),
    ...(hasPrices ? [decimalOdds(band.averageOdds), roiCell(band.roi), unseenCell(band.unseen, true)] : [decimalOdds(1 / band.hitRate), unseenCell(band.unseen, false)])
  ]);
  const value = hasPrices ? h('p', { class: 'muted small' },
    `Only betting when Bet365's price beat the model's fair price by 3%+: ${evidence.valueOnly.pricedBets.toLocaleString()} bets, won ${percent(evidence.valueOnly.priceHitRate, 0)}, ROI ${signedPercent(evidence.valueOnly.roi)}; unseen seasons ROI ${signedPercent(evidence.valueOnlyUnseen.roi)}. Beat the closing price on average by ${signedPercent(evidence.all.closingLineValue)} (negative means the market moved against the pick).`)
    : h('p', { class: 'muted small' }, 'The free data has no BTTS odds, so only the hit rate can be checked. "Break-even odds" is the lowest price at which that hit rate stops losing money; if your bookmaker offers less, the pick loses over time. Note the model is over-confident on BTTS: when it says 70%, it has been right about 64% of the time.');
  return section(MARKET_NAMES[market], `All ${evidence.all.bets.toLocaleString()} picks won ${percent(evidence.all.hitRate, 1)}. "Model said" next to "Actually won" shows whether the percentages can be trusted.`,
    table(headers, rows), value);
}

function roiCell(roi) {
  return h('span', { class: `mono ${roi >= 0 ? 'positive' : 'negative'}` }, signedPercent(roi));
}

function unseenCell(unseen, withRoi) {
  if (!unseen.bets) return '—';
  return h('span', { class: 'mono small' }, `${percent(unseen.hitRate, 0)} of ${unseen.bets}${withRoi && unseen.roi !== null ? `, ${signedPercent(unseen.roi)}` : ''}`);
}

function blindPanel(study) {
  return section('Simple rules with no model', 'The yardstick: if a model pick does not beat these, the model adds nothing.',
    table(['Rule', 'Bets', 'Won', 'Avg odds', 'ROI', '95% range'], study.blind.map((rule) => [
      rule.name, rule.bets.toLocaleString(), percent(rule.hitRate, 0), decimalOdds(rule.averageOdds),
      rule.roi === null ? 'no odds' : roiCell(rule.roi),
      rule.roiInterval ? h('span', { class: 'mono small' }, `${signedPercent(rule.roiInterval.low)} to ${signedPercent(rule.roiInterval.high)}`) : '—'
    ])));
}

function combinationPanel(study) {
  const c = study.combinations;
  return section('Putting the three together', 'How often combinations actually happened.',
    table(['Combination', 'Came in'], [
      ['All three model picks right (every match)', percent(c.trebleAll.hitRate, 1)],
      [`All three right when every pick was 60%+ (${c.trebleStrong.matches} matches)`, percent(c.trebleStrong.hitRate, 1)],
      [c.bttsAndOver.label, percent(c.bttsAndOver.hitRate, 1)],
      [c.homeBttsOver.label, percent(c.homeBttsOver.hitRate, 1)],
      [c.awayBttsOver.label, percent(c.awayBttsOver.hitRate, 1)],
      [c.bttsYesGivenOver.label, percent(c.bttsYesGivenOver.hitRate, 1)]
    ]),
    h('p', { class: 'muted small' }, 'BTTS and Over 2.5 are strongly linked, so a bookmaker\'s bet builder price for them together is lower than the two prices multiplied. The model prices them on the same score grid, so it accounts for this.'));
}

function leaguePanel(study) {
  const rows = Object.entries(study.perLeague).sort((a, b) => b[1].over25 - a[1].over25).map(([code, r]) => [
    `${leagueByCode(code).country} · ${leagueByCode(code).name}`, r.matches.toLocaleString(), percent(r.home, 0), percent(r.draw, 0), percent(r.bttsYes, 0), percent(r.over25, 0)
  ]);
  return section('Leagues by goals', 'Higher-scoring leagues suit Over 2.5 and BTTS Yes; low-scoring ones suit Under and BTTS No.',
    table(['League', 'Matches', 'Home win', 'Draw', 'BTTS Yes', 'Over 2.5'], rows));
}

function researchPanel() {
  const source = (href, text, note) => h('li', {}, h('a', { href, target: '_blank', rel: 'noopener' }, text), ` — ${note}`);
  return section('Published research', 'What studies of these markets found.',
    h('ul', { class: 'bullet-list' },
      source('https://research.manchester.ac.uk/en/publications/biases-in-the-football-betting-market/', 'Buhagiar, Cortis & Newall (2018), Biases in the football betting market', '163,992 odds, ten European leagues: favourite-longshot bias confirmed. Long-shot bettors lose most.'),
      source('https://kops.uni-konstanz.de/handle/123456789/44938', 'Daunhawer, Schoch & Kosub (2017)', 'betting against the favourite-longshot bias is at best marginally profitable; betting with it loses heavily.'),
      source('https://www.unifr.ch/tim/en/assets/public/uploads/Publication list/2016/Journal of Sports Economics-2016-Flepp-3-11.pdf', 'Flepp, Nüesch & Franck (2016), Journal of Sports Economics', 'over 80% of money on Over/Under goes on the Over, yet prices show no exploitable bias.'),
      source('https://www.um.edu.mt/library/oar/handle/123456789/9630', 'Buhagiar (2014), University of Malta', '1X2 and Over/Under 2.5 efficiency across eleven European leagues, 2005–2013.')),
    h('p', { class: 'muted small' }, 'Our own study above agrees: picks with higher confidence win more often, but the bookmaker margin takes the profit.'));
}
