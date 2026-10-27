// "1X2 · BTTS · O2.5" page: this week's best bets (strong picks, good leagues first, best price), then every match's three picks,
// each tagged with how the same kind of pick did in the walk-forward study. The full evidence sits behind a toggle.
import { h, replaceContent, table, badge } from '../util/dom.js';
import { decimalOdds, kickoffText, percent, signedPercent, stampText } from '../util/format.js';
import { leagueByCode } from '../config.js';
import { loadFixtures, loadLeagueHistory } from '../data/feeds.js';
import { LeagueModel } from '../model/leagueModel.js';
import { STRONG_HIT_RATE, THREE_MARKETS, isStrong, leagueRating, similarPicks, threeMarketPicks } from '../model/threeMarkets.js';
import { loadSettings } from '../store/appState.js';
import { localDateKey } from '../util/time.js';
import { emptyState, errorPanel, kpi, loadingPanel, probabilityBar, section } from './components.js';

const STUDY_URL = 'data/three-markets-study.json';
const STAKING_URL = 'data/staking-study.json';
const STAKE = 20;
const TICKET_SIZE = 3;
const LEAGUE_ORDER = { good: 0, neutral: 1, unknown: 1, avoid: 2 };
const MARKET_NAMES = { result: 'Match result (1X2)', btts: 'Both teams to score', goals: 'Over/Under 2.5 goals' };
const LARGE_DISAGREEMENT = 0.1;
const filters = { league: 'all', strongOnly: false };
const studyFiles = new Map();

export async function renderThreeMarkets(view, parameter, isCurrent) {
  const picksColumn = h('div', {}, loadingPanel('Fitting the model for this week\'s fixtures…'));
  const evidenceColumn = h('details', { class: 'research-toggle' }, h('summary', {}, 'Show the research behind these picks'));
  replaceContent(view, picksColumn, evidenceColumn);
  const [study, staking] = await Promise.all([loadStudyFile(STUDY_URL, 'node tools/three-markets-study.mjs'),
    loadStudyFile(STAKING_URL, 'node tools/strategy-backtest.mjs <file> then python3 tools/staking_study.py <file> data/staking-study.json')]
    .map((pending) => pending.catch((error) => ({ error }))));
  if (!isCurrent()) return;
  evidenceColumn.append(...[study.error ? errorPanel(study.error, 'Historical study missing') : evidencePanels(study, staking.error ? undefined : staking)].flat());
  try {
    const rows = await weekPicks();
    if (isCurrent()) drawPicks(picksColumn, rows, study.error ? undefined : study, staking.error ? undefined : staking);
  } catch (error) {
    if (isCurrent()) replaceContent(picksColumn, errorPanel(error, 'Fixture feed unavailable'));
  }
}

// Study files are fetched once per session; a failed fetch is forgotten so a reload can retry.
function loadStudyFile(url, howToBuild) {
  if (!studyFiles.has(url)) {
    const pending = fetch(url).then((response) => {
      if (!response.ok) throw new Error(`${url} not found. Run: ${howToBuild} (with npm start running).`);
      return response.json();
    });
    pending.catch(() => studyFiles.delete(url));
    studyFiles.set(url, pending);
  }
  return studyFiles.get(url);
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

function drawPicks(container, week, study, staking) {
  const list = h('div', { class: 'three-list' });
  const redraw = () => replaceContent(list, visibleRows(week.rows, study).map((row) => fixtureRow(row, study, staking)), emptyIfNone(week.rows, study));
  replaceContent(container,
    study ? todaysPicksPanel(week.rows, study, staking) : '',
    study ? bestBetsPanel(week.rows, study, staking) : '',
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

function fixtureRow(row, study, staking) {
  const { fixture } = row;
  const league = leagueByCode(fixture.league);
  return h('article', { class: 'three-card' },
    h('header', {},
      h('div', {}, h('strong', {}, `${fixture.home} v ${fixture.away}`), h('small', { class: 'muted' }, ` ${league.country} · ${league.name} `), leagueBadge(staking, fixture.league)),
      h('time', { class: 'muted small', datetime: fixture.kickoff.toISOString() }, kickoffText(fixture.kickoff))),
    row.failed ? h('p', { class: 'negative small' }, `No model for this league: ${row.failed}`)
      : !row.covered ? h('p', { class: 'muted small' }, 'Insufficient evidence: one of these teams has too few league matches in the data (often a promoted side).')
        : h('div', { class: 'three-picks' }, THREE_MARKETS.map((market) => pickCell(row.picks[market], study && similarPicks(study, market, row.picks[market].probability)))),
    h('footer', {}, h('a', { href: `#/match/${encodeURIComponent(fixture.id)}` }, 'Full match report →'),
      row.expectedGoals ? h('span', { class: 'muted small mono' }, `xG ${row.expectedGoals.home.toFixed(2)} – ${row.expectedGoals.away.toFixed(2)}`) : ''));
}

function pickCell(pick, history) {
  const strong = history && history.hitRate >= STRONG_HIT_RATE;
  return h('div', { class: `pick-cell${strong ? ' is-strong' : ''}` },
    h('small', { class: 'muted' }, pick.market, strong ? ' · ★ strong pick' : ''),
    h('strong', {}, pick.label),
    probabilityBar(pick.probability),
    h('span', { class: 'small mono' }, `Fair ${decimalOdds(pick.fairOdds)} · Bet365 ${decimalOdds(pick.odds)} · Best ${decimalOdds(pick.bestOdds)}`),
    valueBadge(pick),
    history ? historyBadge(history) : '');
}

// League tag from the five-season staking study: how strong picks have paid in this league.
function leagueBadge(staking, leagueCode) {
  const { rating, entry } = leagueRating(staking, leagueCode);
  if (!entry) return '';
  const record = `strong picks ${signedPercent(entry.bet365.roi)} at Bet365, ${signedPercent(entry.best.roi)} at best price over ${entry.best.bets} bets`;
  if (rating === 'good') return h('span', { class: 'badge badge-good', title: record }, 'Good league');
  if (rating === 'avoid') return h('span', { class: 'badge badge-bad', title: record }, 'Weak league');
  return h('span', { class: 'badge badge-neutral', title: record }, 'Average league');
}

// ---------- Best bets ----------

// Strong picks with a price, one per match (its most confident), good leagues first, weak leagues left out.
function bestBetLegs(rows, study, staking) {
  return rows.filter((row) => row.picks && row.covered).flatMap((row) => {
    const rating = leagueRating(staking, row.fixture.league).rating;
    const options = THREE_MARKETS.map((market) => ({ market, pick: row.picks[market] }))
      .filter(({ market, pick }) => bestPrice(pick) && isStrong(study, market, pick.probability));
    if (!options.length || rating === 'avoid') return [];
    const chosen = options.reduce((a, b) => (b.pick.probability > a.pick.probability ? b : a));
    return [{ row, rating, ...chosen, history: similarPicks(study, chosen.market, chosen.pick.probability) }];
  }).sort((a, b) => LEAGUE_ORDER[a.rating] - LEAGUE_ORDER[b.rating] || b.pick.probability - a.pick.probability);
}

function bestPrice(pick) {
  return Math.max(...[pick.odds, pick.bestOdds].filter(Number.isFinite), 0) || 0;
}

function bestBetsPanel(rows, study, staking) {
  const legs = bestBetLegs(rows, study, staking);
  if (!legs.length) return '';
  const tickets = [];
  for (let i = 0; i + TICKET_SIZE <= legs.length; i += TICKET_SIZE) tickets.push(legs.slice(i, i + TICKET_SIZE));
  return section('Best bets this week', `Strong picks only (the kind that historically won ${percent(STRONG_HIT_RATE, 0)}+), one per match, good leagues first, weak leagues left out. $${STAKE} per bet; "pays" is the total back at the best price.`,
    table(['Kick-off', 'Match', 'League', 'Pick', 'Similar picks won', 'Bet365', 'Best price', `$${STAKE} pays`], legs.map((leg) => [
      kickoffText(leg.row.fixture.kickoff),
      h('a', { href: `#/match/${encodeURIComponent(leg.row.fixture.id)}` }, `${leg.row.fixture.home} v ${leg.row.fixture.away}`),
      leagueBadge(staking, leg.row.fixture.league),
      leg.pick.label,
      percent(leg.history.hitRate, 0),
      decimalOdds(leg.pick.odds),
      h('strong', {}, decimalOdds(leg.pick.bestOdds)),
      `$${(STAKE * bestPrice(leg.pick)).toFixed(2)}`
    ])),
    tickets.length ? h('div', {}, h('h3', {}, `Suggested ${TICKET_SIZE}-match tickets`), table(['Ticket', 'Legs', 'Combined best odds', `$${STAKE} pays`, 'Chance all win'], tickets.map((ticket, index) => [
      `Ticket ${index + 1}`,
      ticket.map((leg) => `${leg.pick.label} (${leg.row.fixture.home} v ${leg.row.fixture.away})`).join(' · '),
      decimalOdds(ticket.reduce((odds, leg) => odds * bestPrice(leg.pick), 1)),
      `$${(STAKE * ticket.reduce((odds, leg) => odds * bestPrice(leg.pick), 1)).toFixed(2)}`,
      percent(ticket.reduce((chance, leg) => chance * leg.history.hitRate, 1), 0)
    ]))) : '',
    staking ? expectationNote(staking) : '');
}

// ---------- Today's picks ----------

// Tickets written from the study's rules for the next match day: strong priced picks only, weak leagues out,
// trebles first (the best-performing ticket size), a double or single for whatever is left over.
function todaysPicksPanel(rows, study, staking) {
  const day = nextMatchDay(rows);
  const legs = day ? bestBetLegs(rows.filter((row) => localDateKey(row.fixture.kickoff) === day), study, staking) : [];
  const heading = day === localDateKey(new Date()) ? 'Today\'s picks' : `Next match day's picks (${day ? new Date(`${day}T12:00:00`).toDateString() : 'none'})`;
  if (!legs.length) return '';
  const tickets = writeTickets(legs);
  return section(heading, `Written from the model and the five-season study: strong picks only (historically won ${percent(STRONG_HIT_RATE, 0)}+), one per match, weak leagues left out, best price. $${STAKE} per ticket.`,
    tickets.map((ticket, index) => writtenTicket(ticket, index + 1, staking)),
    h('p', { class: 'muted small' }, 'Every selection shows what it pays as a $20 single, so you can play the singles instead of the ticket. Over five seasons, strong singles and trebles at the best price came out about even; at Bet365 they lost 3–7%. Check team news before kick-off.'));
}

function nextMatchDay(rows) {
  const days = rows.filter((row) => row.fixture.kickoff > new Date()).map((row) => localDateKey(row.fixture.kickoff)).sort();
  return days[0];
}

function writeTickets(legs) {
  const tickets = [];
  let rest = legs;
  while (rest.length >= TICKET_SIZE) {
    tickets.push(rest.slice(0, TICKET_SIZE));
    rest = rest.slice(TICKET_SIZE);
  }
  if (rest.length) tickets.push(rest);
  return tickets;
}

function writtenTicket(ticket, number, staking) {
  const odds = ticket.reduce((total, leg) => total * bestPrice(leg.pick), 1);
  const chance = ticket.reduce((total, leg) => total * leg.history.hitRate, 1);
  const kind = { 1: 'Single', 2: 'Double', 3: 'Treble' }[ticket.length] || `${ticket.length}-match ticket`;
  return h('article', { class: 'written-ticket' },
    h('header', {},
      h('h3', {}, `Ticket ${number} · ${kind}`),
      h('div', { class: 'ticket-summary mono' },
        h('span', {}, `Odds ${decimalOdds(odds)}`),
        h('strong', {}, `$${STAKE} pays $${(STAKE * odds).toFixed(2)}`),
        h('span', {}, `Chance ${percent(chance, 0)}${chance < 0.5 ? ` (about 1 in ${Math.round(1 / chance)})` : ''}`))),
    table(['Kick-off', 'Selection', 'Why', 'Bet365', 'Best price', `$${STAKE} single pays`], ticket.map((leg) => [
      kickoffText(leg.row.fixture.kickoff),
      h('div', {}, h('strong', {}, leg.pick.label), h('br'), h('small', { class: 'muted' }, `${leg.row.fixture.home} v ${leg.row.fixture.away}`)),
      h('div', { class: 'small' }, `Model ${percent(leg.pick.probability, 0)}; similar picks won ${percent(leg.history.hitRate, 0)} of ${leg.history.bets.toLocaleString()} `, leagueBadge(staking, leg.row.fixture.league)),
      decimalOdds(leg.pick.odds),
      h('strong', {}, decimalOdds(bestPrice(leg.pick))),
      h('strong', { class: 'positive' }, `$${(STAKE * bestPrice(leg.pick)).toFixed(2)}`)
    ])));
}

function expectationNote(staking) {
  const find = (source, size) => staking.strategies.find((s) => s.source === source && s.size === size && !s.every);
  return h('p', { class: 'muted small' },
    `What to expect, from every weekend of the last five seasons: strong singles returned ${signedPercent(find('best', 1).roi)} at the best price (${signedPercent(find('bet365', 1).roi)} at Bet365) and ${signedPercent(find('best', 3).roi)} as trebles (${signedPercent(find('bet365', 3).roi)} at Bet365). `,
    `Only ${percent(find('best', 1).profitableWeekends, 0)} of weekends finished in profit. Take the highest price you can get, keep the stake the same, and avoid 5+ match tickets (${signedPercent(find('best', 5).roi)}).`);
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

function evidencePanels(study, staking) {
  return [
    bottomLine(study),
    ...(staking ? [stakingPanel(staking), leagueStakingPanel(staking)] : []),
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

function stakingPanel(staking) {
  const label = (s) => (s.every ? 'Every pick, singles' : s.size === 1 ? 'Strong singles' : `Strong, ${s.size}-match tickets`);
  const money = (value) => h('span', { class: `mono ${value >= 0 ? 'positive' : 'negative'}` }, `${value >= 0 ? '+' : '-'}$${Math.abs(value).toFixed(2)}`);
  const leg = staking.legValue;
  return section(`Singles or tickets? Every weekend replayed ($${staking.stake} each)`,
    `${staking.matches.toLocaleString()} matches. A strong pick wins ${percent(leg.bet365.hitRate, 1)}. At Bet365's average odds of ${leg.bet365.averageOdds.toFixed(2)} each bet returns ${signedPercent(leg.bet365.evPerLeg)}; at the best price (${leg.best.averageOdds.toFixed(2)}) it returns ${signedPercent(leg.best.evPerLeg)}. A ticket multiplies its legs, so a small loss per leg grows with every leg added.`,
    table(['Strategy', 'Price', 'Tickets', 'Won', 'ROI', 'Weekends in profit', 'Average weekend', 'Worst', 'Best'], staking.strategies.map((s) => [
      label(s), s.source === 'bet365' ? 'Bet365' : 'Best price', s.tickets.toLocaleString(), s.ticketWins.toLocaleString(), roiCell(s.roi),
      percent(s.profitableWeekends, 0), money(s.averageWeekend), money(s.worstWeekend), money(s.bestWeekend)
    ])));
}

function leagueStakingPanel(staking) {
  return section('Which leagues pay', `Strong picks as singles, by league. "Before" is up to ${staking.unseenFrom}; "Since" is the newest data. Trust a league more when both are positive.`,
    table(['League', 'Bets', 'Won', 'Bet365', 'Best price', '95% range (best)', 'Before', 'Since', 'Tag'], staking.leagues.map((entry) => [
      `${leagueByCode(entry.league).country} · ${leagueByCode(entry.league).name}`, entry.best.bets.toLocaleString(), percent(entry.best.hitRate, 0),
      roiCell(entry.bet365.roi), roiCell(entry.best.roi),
      entry.best.interval ? h('span', { class: 'mono small' }, `${signedPercent(entry.best.interval[0])} to ${signedPercent(entry.best.interval[1])}`) : '—',
      roiCell(entry.best.before), roiCell(entry.best.after), leagueBadge(staking, entry.league)
    ])));
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
