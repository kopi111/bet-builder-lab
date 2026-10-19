import { h, replaceContent, table, badge } from '../util/dom.js';
import { decimalOdds, kickoffText, number, percent, signedPercent, stampText } from '../util/format.js';
import { leagueByCode } from '../config.js';
import { analyse, forgetAnalyses } from './matchService.js';
import { isMatchSaved, toggleSavedMatch } from '../store/appState.js';
import { button, buttonLink, confidenceBadge, definition, emptyState, list, loadingPanel, methodBadge, probabilityBar, section } from './components.js';
import { chartBlock, chartColors, histogram } from './charts.js';
import { mlSection } from './mlSection.js';

export async function renderMatch(view, id, isCurrent) {
  if (!id) {
    replaceContent(view, emptyState('No match selected', 'Pick a fixture first.', buttonLink('#/fixtures', 'Go to fixtures', 'primary')));
    return;
  }
  replaceContent(view, loadingPanel('Loading three seasons of league data and fitting the model…'));
  const analysis = await analyse(id);
  if (!isCurrent()) return;
  replaceContent(view, h('div', { class: 'report' }, reportHeader(analysis), reportSections(analysis)));
}

function reportHeader(analysis) {
  const { fixture, assessment } = analysis;
  const league = leagueByCode(fixture.league);
  const saved = isMatchSaved(fixture.id);
  const saveControl = button(saved ? '★ Saved' : '☆ Save match', () => {
    saveControl.textContent = toggleSavedMatch(fixture) ? '★ Saved' : '☆ Save match';
  }, 'ghost');
  return h('section', { class: 'report-hero panel' },
    h('div', { class: 'hero-meta' }, h('span', { class: 'league-tag' }, `${league.country} · ${league.name}`), h('time', { datetime: fixture.kickoff.toISOString() }, kickoffText(fixture.kickoff)),
      fixture.played ? badge(`Replay: final score ${fixture.stats.homeGoals}–${fixture.stats.awayGoals}`, 'neutral') : '',
      fixture.custom ? badge('Custom match-up: no odds', 'neutral') : ''),
    h('h2', { class: 'hero-teams' }, fixture.home, h('span', { class: 'versus' }, ' v '), fixture.away),
    h('div', { class: 'verdict' }, badge(assessment.verdict, assessment.tone), h('p', {}, assessment.reason)),
    h('div', { class: 'hero-actions' },
      buttonLink(`#/builder/${encodeURIComponent(fixture.id)}`, 'Open Bet Builder', 'primary'),
      saveControl,
      button('Re-run analysis', () => {
        forgetAnalyses();
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      }, 'ghost')),
    h('p', { class: 'muted small' }, `Data fetched ${stampText(analysis.dataFetchedAt)} · latest result in data ${stampText(analysis.lastResultDate)} · model fitted on ${analysis.league.history.length} ${matchScope(fixture).matches} before kick-off.`));
}

const LEAGUE_SCOPE = { matches: 'league matches', caveat: 'Cup and European matches are not in the data, so congestion may be understated.' };
const POOLED_SCOPE = { matches: 'league and Champions League matches', caveat: 'Domestic cup matches are not in the data, so congestion may be understated.' };

function matchScope(fixture) {
  return leagueByCode(fixture.league).pooled ? POOLED_SCOPE : LEAGUE_SCOPE;
}

function reportSections(analysis) {
  return [
    formSection(analysis), venueSection(analysis), headToHeadSection(analysis), strengthSection(analysis),
    expectedGoalsSection(analysis), goalMarketsSection(analysis), cornersSection(analysis), cardsSection(analysis),
    playersSection(analysis), availabilitySection(analysis), suggestionsSection(analysis), weaknessesSection(analysis),
    assessmentSection(analysis), mlSection(analysis.fixture), methodSection(analysis)
  ];
}

function formSection({ teams, fixture }) {
  const rows = [5, 10, 15].flatMap((count) => ['home', 'away'].map((side) => {
    const form = teams[side].windows[count];
    return [`${teams[side].name} · last ${count}`, form.count ? h('span', { class: 'form-string mono' }, form.sequence) : 'no matches',
      number(form.points / Math.max(1, form.count)), `${number(form.scored)} / ${number(form.conceded)}`,
      `${number(form.halfScored)} / ${number(form.secondHalfScored)}`, percent(form.bothScored, 0), percent(form.over25, 0), percent(form.cleanSheets, 0), percent(form.failedToScore, 0)];
  }));
  return section('1 · Recent form comparison', `${capitalise(matchScope(fixture).matches)} only, most recent first. Small windows are noisy: 5 matches is a very small sample.`,
    table(['Team · window', 'Results', 'Points/game', 'Goals for / against', '1st / 2nd half goals', 'BTTS', 'Over 2.5', 'Clean sheet', 'Failed to score'], rows),
    chartBlock('Goals for and against per game by window', {
      type: 'bar',
      data: {
        labels: ['Last 5', 'Last 10', 'Last 15'],
        datasets: ['home', 'away'].flatMap((side) => [
          { label: `${teams[side].name} scored`, data: [5, 10, 15].map((n) => teams[side].windows[n].scored), backgroundColor: side === 'home' ? chartColors.home : chartColors.away },
          { label: `${teams[side].name} conceded`, data: [5, 10, 15].map((n) => teams[side].windows[n].conceded), backgroundColor: side === 'home' ? 'rgba(15,138,90,0.35)' : 'rgba(31,111,209,0.35)' }
        ])
      }
    }, 'See the table above.'));
}

function venueSection({ teams, fixture }) {
  const venueRow = (side, label) => {
    const form = teams[side].venueForm;
    return [`${teams[side].name} ${label}`, form.count, h('span', { class: 'form-string mono' }, form.sequence), `${form.wins}-${form.draws}-${form.losses}`,
      `${number(form.scored)} / ${number(form.conceded)}`, number(form.shots, 1), number(form.cornersFor, 1), number(form.cards, 1)];
  };
  return section('2 · Home versus away performance', 'The home side at home and the away side away, last 10 of each.',
    table(['Team', 'Matches', 'Results', 'W-D-L', 'Goals for / against', 'Shots', 'Corners for', 'Cards'], [venueRow('home', 'at home'), venueRow('away', 'away')]),
    definition([
      ['Rest days', `${teams.home.name} ${number(teams.home.restDays, 0)} · ${teams.away.name} ${number(teams.away.restDays, 0)}`],
      [`${capitalise(matchScope(fixture).matches)} in last 21 days`, `${teams.home.name} ${teams.home.matchesLast21Days} · ${teams.away.name} ${teams.away.matchesLast21Days}`],
      ['Caveat', matchScope(fixture).caveat]
    ]));
}

function headToHeadSection({ headToHead: h2h, fixture }) {
  if (h2h.count === 0) return section('Head-to-head (supporting evidence only)', '', emptyState('No meetings in the loaded seasons', 'Head-to-head is not used by the model in any case.'));
  return section('Head-to-head (supporting evidence only)', `${h2h.count} meetings in the loaded seasons. Not used by the model; small samples mislead.`,
    definition([
      ['Results', `${fixture.home} ${h2h.homeTeamWins} · draws ${h2h.draws} · ${fixture.away} ${h2h.awayTeamWins}`],
      ['Average goals', number(h2h.goals)], ['Both teams scored', percent(h2h.bothScored, 0)],
      ['Average corners', number(h2h.corners, 1)], ['Average cards', number(h2h.cards, 1)]
    ]),
    table(['Date', 'Match', 'Score'], h2h.meetings.slice(0, 6).map((m) => [kickoffText(m.kickoff), `${m.home} v ${m.away}`, `${m.stats.homeGoals}–${m.stats.awayGoals}`])));
}

function strengthSection({ teams, league }) {
  const row = (side) => {
    const team = teams[side];
    return [team.name, number(team.rating.for), number(team.rating.against), number(team.rating.for / team.rating.against),
      number(team.windows[10].shotsOnTarget, 1), number(team.windows[10].shotsAgainst, 1), number(team.opponentStrength), `${team.rating.matches} (${number(team.rating.weightedMatches, 1)} weighted)`];
  };
  return section('3 · Attacking and defensive strength', `Ratings relative to the league average (1.00). Attack above 1 scores more than average; defence below 1 concedes less. Goals are blended ${Math.round(league.goals.blend * 100)}% with shots on target × league conversion (${number(league.goals.conversion, 3)} goals per shot on target).`,
    table(['Team', 'Attack', 'Defence', 'Overall', 'Shots on target (last 10)', 'Shots faced (last 10)', 'Opponent strength (last 10)', 'Sample'], [row('home'), row('away')]));
}

function expectedGoalsSection({ model, fixture }) {
  const { home, away } = model.expectedGoals;
  const matrix = model.matrix;
  const totalBands = [['0–1 goals', (h, a) => h + a <= 1], ['2–3 goals', (h, a) => h + a >= 2 && h + a <= 3], ['4+ goals', (h, a) => h + a >= 4]];
  const homeDistribution = Array.from(matrix.homeMarginal()).slice(0, 7);
  const awayDistribution = Array.from(matrix.awayMarginal()).slice(0, 7);
  return section('4 · Expected goals and likely score ranges', 'Model expected goals (not provider xG: true xG is not in the free data).',
    definition([
      [`${fixture.home} expected goals`, number(home)], [`${fixture.away} expected goals`, number(away)], ['Expected total', number(home + away)],
      ...totalBands.map(([label, test]) => [label, percent(matrix.sumWhere(test))])
    ]),
    chartBlock('Goals distribution per team (model)', {
      type: 'bar',
      data: { labels: ['0', '1', '2', '3', '4', '5', '6'], datasets: [
        { label: fixture.home, data: homeDistribution, backgroundColor: chartColors.home },
        { label: fixture.away, data: awayDistribution, backgroundColor: chartColors.away }
      ] },
      options: { scales: { y: { ticks: { callback: (v) => `${Math.round(v * 100)}%` } } } }
    }, 'See the correct-score grid.'),
    scoreGrid(matrix, fixture));
}

function scoreGrid(matrix, fixture) {
  const goals = [0, 1, 2, 3, 4, 5];
  const peak = matrix.mostLikelyScores(1)[0].probability;
  return h('div', { class: 'table-wrap' }, h('table', { class: 'score-grid' },
    h('caption', {}, `Correct-score grid: rows ${fixture.home} goals, columns ${fixture.away} goals`),
    h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, ''), goals.map((g) => h('th', { scope: 'col' }, g)))),
    h('tbody', {}, goals.map((home) => h('tr', {}, h('th', { scope: 'row' }, home), goals.map((away) => {
      const probability = matrix.probabilityOf(home, away);
      return h('td', { style: `--heat:${(probability / peak).toFixed(2)}` }, percent(probability, 1));
    }))))));
}

function goalMarketsSection({ tables }) {
  const goalTables = tables.filter((t) => ['result', 'goals', 'team-goals', 'halves', 'scores'].includes(t.id));
  const result = tables[0];
  return section('5 · Goal-market probabilities', 'Bet365 prices are shown only where football-data.co.uk publishes them (1X2, over/under 2.5, Asian handicap main line). "Fair" removes the bookmaker margin proportionally.',
    goalTables.map((t) => marketTable(t)),
    result.extras.map(extraTable));
}

export function marketTable(marketTableData) {
  const hasOdds = marketTableData.rows.some((row) => Number.isFinite(row.comparison.odds));
  const headers = ['Market', 'Model', 'Method', ...(hasOdds ? ['Bet365', 'Fair implied', 'Gap', 'Est. EV'] : []), 'Fair odds', 'Confidence'];
  const rows = marketTableData.rows.map((row) => {
    const c = row.comparison;
    const priced = Number.isFinite(c.odds);
    return [row.label, probabilityBar(row.probability), methodBadge(row.estimate),
      ...(hasOdds ? [priced ? decimalOdds(c.odds) : '—', priced ? percent(Number.isFinite(c.fairImplied) ? c.fairImplied : c.implied) : '—', priced ? signedPercent(c.difference) : '—',
        priced ? h('span', { class: c.expectedValue > 0 ? 'positive' : 'negative' }, signedPercent(c.expectedValue)) : '—'] : []),
      decimalOdds(c.fairOdds), confidenceBadge(row.confidence)];
  });
  const caption = Number.isFinite(marketTableData.margin) ? `${marketTableData.title} · Bet365 margin ${percent(marketTableData.margin)}` : marketTableData.title;
  return table(headers, rows, { caption });
}

function extraTable(extra) {
  const hasOdds = extra.rows.some((row) => Number.isFinite(row.odds));
  return table(['Line', 'Win', 'Push (refund)', ...(extra.rows[0].lose !== undefined ? ['Lose'] : []), 'Fair odds', ...(hasOdds ? ['Bet365', 'Est. EV'] : [])],
    extra.rows.map((row) => [row.label, percent(row.win), percent(row.push), ...(row.lose !== undefined ? [percent(row.lose)] : []), decimalOdds(row.fairOdds),
      ...(hasOdds ? [decimalOdds(row.odds), Number.isFinite(row.expectedValue) ? signedPercent(row.expectedValue) : '—'] : [])]),
    { caption: extra.title });
}

function countData(analysis, tableId, columnNames) {
  const data = analysis.tables.find((t) => t.id === tableId);
  if (!data) return undefined;
  const simulation = analysis.model.simulation();
  const [homeColumn, awayColumn] = columnNames.map((name) => simulation.column(name));
  return { data, shares: histogram(homeColumn.map((value, i) => value + awayColumn[i]), 20) };
}

function cornersSection(analysis) {
  const title = '6 · Corner-market analysis';
  const result = countData(analysis, 'corners', ['homeCorners', 'awayCorners']);
  if (!result) return section(title, '', emptyState('Not available', 'This league\'s data has no corner counts.'));
  const { data, shares } = result;
  const { fixture } = analysis;
  return section(title, `Expected corners: ${fixture.home} ${number(data.expected.home, 1)}, ${fixture.away} ${number(data.expected.away, 1)}, total ${number(data.expected.home + data.expected.away, 1)}. Negative binomial with league dispersion ${Number.isFinite(data.expected.dispersion) ? number(data.expected.dispersion, 1) : '∞ (Poisson)'}; ${data.expected.sample} matches with corner data.`,
    marketTable(data),
    chartBlock('Total corners distribution (simulated)', { type: 'bar', data: { labels: shares.map((_, i) => (i === 20 ? '20+' : String(i))), datasets: [{ label: 'Share of simulations', data: shares, backgroundColor: chartColors.warn }] } }, 'See the table.'));
}

function cardsSection(analysis) {
  const title = '7 · Card-market analysis';
  const result = countData(analysis, 'cards', ['homeCards', 'awayCards']);
  if (!result) return section(title, '', emptyState('Not available', 'This league\'s data has no booking counts.'));
  const { data } = result;
  const { fixture, model } = analysis;
  const referee = fixture.referee ? `${fixture.referee}: card factor ${number(model.referee.factor)} from ${model.referee.matches} matches (shrunk toward 1.00)` : 'not published, no referee adjustment';
  return section(title, `Expected cards: ${fixture.home} ${number(data.expected.home, 1)}, ${fixture.away} ${number(data.expected.away, 1)}. Referee ${referee}. Counts are yellow + red as recorded by the source; Bet365 Bet Builder card rules can differ (for example, how a second yellow is counted).`,
    marketTable(data));
}

function playersSection({ model }) {
  const players = model.playerContext.players.filter((p) => p.status !== 'out');
  if (players.length === 0) return section('8 · Player-market analysis', '', emptyState('Player markets unavailable', `${model.playerContext.message}. No player market is suggested without participation status and supporting statistics.`));
  const top = (side) => players.filter((p) => p.side === side).sort((a, b) => b.per90.shots - a.per90.shots).slice(0, 6);
  const rows = ['home', 'away'].flatMap((side) => top(side).map((p) => [p.name, p.position, statusBadge(p), `${p.appearances} (${p.starts} starts)`, p.minutes,
    number(p.per90.goals), number(p.per90.assists), number(p.per90.shots, 1), number(p.per90.shotsOnTarget, 1), number(p.per90.foulsCommitted, 1), number(p.per90.cards)]));
  return section('8 · Player-market analysis', `${model.playerContext.message}. Rates are per 90 minutes this season; small minute totals are unreliable.`,
    table(['Player', 'Position', 'Status', 'Apps', 'Minutes', 'Goals/90', 'Assists/90', 'Shots/90', 'On target/90', 'Fouls/90', 'Cards/90'], rows));
}

function statusBadge(player) {
  const tone = { starting: 'good', bench: 'warn', out: 'bad', unconfirmed: 'neutral' }[player.status] || 'neutral';
  return badge(player.status === 'unconfirmed' ? `unconfirmed · ${percent(player.startProbability, 0)} start` : player.status, tone);
}

function availabilitySection({ model }) {
  const out = model.playerContext.players.filter((p) => p.status === 'out');
  if (model.playerContext.players.length === 0) return section('9 · Injuries and line-up uncertainty', '', emptyState('Not checked', `${model.playerContext.message}. Check official team news before relying on any selection.`));
  return section('9 · Injuries and line-up uncertainty', model.playerContext.lineupsConfirmed ? 'Line-ups confirmed by the provider.' : 'Line-ups not confirmed: player start chances are estimates.',
    out.length ? list(out.map((p) => `${p.name} (${p.side === 'home' ? model.fixture.home : model.fixture.away}): ${p.statusNote}`)) : h('p', {}, 'No absences reported by the provider.'));
}

function suggestionsSection({ suggestions, valueSignals }) {
  return section('10 · Suggested markets with supporting evidence', 'Ranked by evidence (probability × data confidence), never by payout. These are the best-supported outcomes, which is not the same as value.',
    suggestions.length ? list(suggestions.map((s) => h('span', {}, h('strong', {}, s.label), ` · model ${percent(s.probability)} · `, confidenceBadge(s.confidence), h('br'), h('small', { class: 'muted' }, s.confidence.reasons.join(' ')))))
      : emptyState('Nothing qualifies', 'No market reached 55% with usable confidence.'),
    h('h3', {}, 'Price comparison against Bet365'),
    valueSignals.length ? list(valueSignals.map((s) => h('span', {}, h('strong', {}, `${s.label} @ ${decimalOdds(s.comparison.odds)}`), ` · model ${percent(s.probability)} vs fair ${percent(s.comparison.fairImplied)} · `,
      badge({ potential: 'potential value', disagreement: 'large disagreement', weak: 'low confidence', none: 'no value' }[s.verdict.kind], { potential: 'warn', disagreement: 'bad', weak: 'neutral', none: 'neutral' }[s.verdict.kind]), h('br'), h('small', { class: 'muted' }, s.verdict.text))))
      : emptyState('No bookmaker prices', 'This match has no Bet365 prices in the data. Enter real prices in the Bet Builder slip.'));
}

function weaknessesSection({ weaknesses }) {
  return section('11 · Potential weaknesses in this prediction', '', list(weaknesses));
}

function assessmentSection({ assessment }) {
  return section('12 · Final assessment', '', h('div', { class: 'verdict verdict-large' }, badge(assessment.verdict, assessment.tone), h('p', {}, assessment.reason)));
}

function methodSection({ league, model }) {
  const s = league.settings;
  return section('Model notes', '', definition([
    ['Goals', `Poisson attack/defence ratings with home and away baselines (${number(league.goals.table.baseHome)} / ${number(league.goals.table.baseAway)} goals), Dixon-Coles low-score correction ρ = ${s.dixonColesRho}, time decay half-life ${s.halfLifeDays} days, shrinkage ${s.shrinkageMatches} pseudo-matches toward average.`],
    ['Corners, cards, shots', 'Same rating method on each count, negative binomial spread estimated from the league\'s own variance.'],
    ['Combinations', `Goal-only selections are summed exactly over the score grid. Anything else uses ${s.simulations.toLocaleString()} simulated matches where goals, corners, cards, shots and fouls are linked by correlations measured in ${league.dependence().sample} past matches.`],
    ['First-half goals', `Each goal falls in the first half with the league share (${percent(league.halfShare.home, 0)} home, ${percent(league.halfShare.away, 0)} away).`],
    ['Data timestamp', `${stampText(league.asOf)} cut-off; nothing from on or after kick-off is used.`],
    ['Player data', model.playerContext.message]
  ]));
}

function capitalise(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
