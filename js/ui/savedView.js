import { h, replaceContent, table, badge } from '../util/dom.js';
import { decimalOdds, kickoffText, money, percent, stampText } from '../util/format.js';
import { loadLeagueHistory } from '../data/feeds.js';
import { outcomeOf } from '../data/matchRecord.js';
import { createLeg, settleLeg } from '../model/legs.js';
import { recentAnalyses, savedMatches, savedSlips, storeSlips } from '../store/appState.js';
import { removeStored } from '../store/storage.js';
import { button, definition, emptyState, kpi, loadingPanel, section, toast } from './components.js';
import { chartBlock, chartColors } from './charts.js';

const STATUS_TONE = { pending: 'neutral', won: 'good', lost: 'bad', manual: 'warn', void: 'neutral' };

export async function renderSaved(view, parameter, isCurrent) {
  replaceContent(view, loadingPanel('Checking saved combinations against the latest results…'));
  const slips = await settleSlips(savedSlips());
  storeSlips(slips);
  if (!isCurrent()) return;
  replaceContent(view, trackingSection(slips), slipsSection(slips, view), savedMatchesSection(), analysesSection(view));
}

async function settleSlips(slips) {
  const settled = [];
  for (const slip of slips) settled.push(slip.status === 'pending' ? await settleSlip(slip) : slip);
  return settled;
}

async function settleSlip(slip) {
  if (new Date(slip.match.kickoff) > new Date() || slip.match.id.startsWith('custom')) return slip;
  try {
    const history = await loadLeagueHistory(slip.match.league);
    const match = history.matches.find((m) => m.id === slip.match.id);
    if (!match) return slip;
    const outcome = outcomeOf(match);
    const legResults = slip.specs.map((spec) => settleLeg(createLeg(spec), outcome));
    return { ...slip, legResults, status: overallStatus(legResults), finalScore: `${match.stats.homeGoals}–${match.stats.awayGoals}`, settledAt: new Date().toISOString() };
  } catch {
    return slip;
  }
}

function overallStatus(legResults) {
  if (legResults.includes('lost')) return 'lost';
  if (legResults.includes('manual')) return 'manual';
  return 'won';
}

function trackingSection(slips) {
  const settled = slips.filter((s) => s.status === 'won' || s.status === 'lost');
  const priced = settled.filter((s) => s.odds > 1 && s.stake > 0);
  const staked = priced.reduce((sum, s) => sum + s.stake, 0);
  const profit = priced.reduce((sum, s) => sum + (s.status === 'won' ? s.stake * (s.odds - 1) : -s.stake), 0);
  const expectedWins = settled.reduce((sum, s) => sum + (Number.isFinite(s.modelProbability) ? s.modelProbability : 0), 0);
  const wins = settled.filter((s) => s.status === 'won').length;
  let running = 0;
  const curve = [...priced].sort((a, b) => new Date(a.match.kickoff) - new Date(b.match.kickoff)).map((s) => {
    running += s.status === 'won' ? s.stake * (s.odds - 1) : -s.stake;
    return running;
  });
  return section('Hypothetical performance', 'Simulated stakes only, kept in this browser. Separate from the model backtest, which uses historical prices.',
    h('div', { class: 'kpi-row' },
      kpi('Settled combinations', String(settled.length), `${slips.length - settled.length} pending or manual`),
      kpi('Won', `${wins} of ${settled.length}`, `model expected ${expectedWins.toFixed(1)}`),
      kpi('Staked (with odds entered)', money(staked), `${priced.length} combinations`),
      kpi('Profit / ROI', money(profit), staked ? percent(profit / staked) : 'n/a')),
    settled.length < 30 ? h('p', { class: 'muted small' }, `With ${settled.length} settled combinations, results are dominated by luck. Hundreds are needed before any conclusion.`) : '',
    curve.length > 1 ? chartBlock('Cumulative hypothetical profit', { type: 'line', data: { labels: curve.map((_, i) => i + 1), datasets: [{ label: 'Profit', data: curve, borderColor: chartColors.home, pointRadius: 0 }] } }, '') : '');
}

function slipsSection(slips, view) {
  if (slips.length === 0) return section('Saved combinations', '', emptyState('Nothing saved yet', 'Save a slip from the Bet Builder workspace.'));
  return section('Saved combinations', 'Settled automatically from the results feed. Player legs need manual settlement.',
    table(['Match', 'Selections', 'Model', 'Odds', 'Stake', 'Status', ''], slips.map((slip) => [
      h('span', {}, `${slip.match.home} v ${slip.match.away}`, h('br'), h('small', { class: 'muted' }, kickoffText(new Date(slip.match.kickoff)))),
      h('ol', { class: 'tight-list' }, slip.labels.map((label, i) => h('li', {}, label, slip.legResults[i] ? h('span', {}, ' ', badge(slip.legResults[i], STATUS_TONE[slip.legResults[i]])) : ''))),
      percent(slip.modelProbability), decimalOdds(slip.odds), money(slip.stake),
      h('span', {}, badge(slip.status, STATUS_TONE[slip.status]), slip.finalScore ? h('small', { class: 'muted' }, ` ${slip.finalScore}`) : ''),
      slipControls(slip, view)
    ])),
    confirmButton('Delete all saved combinations', () => {
      storeSlips([]);
      toast('All saved combinations deleted.');
      renderSaved(view, '', () => true);
    }));
}

function slipControls(slip, view) {
  const update = (changes) => {
    storeSlips(savedSlips().map((s) => (s.id === slip.id ? { ...s, ...changes } : s)));
    renderSaved(view, '', () => true);
  };
  return h('div', { class: 'row-actions' },
    slip.status === 'manual' || slip.status === 'pending' ? [button('Won', () => update({ status: 'won' }), 'ghost'), button('Lost', () => update({ status: 'lost' }), 'ghost'), button('Void', () => update({ status: 'void' }), 'ghost')] : '',
    button('Delete', () => {
      storeSlips(savedSlips().filter((s) => s.id !== slip.id));
      toast('Combination deleted.');
      renderSaved(view, '', () => true);
    }, 'ghost'));
}

function savedMatchesSection() {
  const saved = savedMatches();
  return section('Saved matches', '', saved.length
    ? h('ul', { class: 'compact-list' }, saved.map((s) => h('li', {}, h('a', { href: `#/match/${encodeURIComponent(s.id)}` }, `${s.home} v ${s.away}`), h('span', {}, kickoffText(new Date(s.kickoff))))))
    : emptyState('No saved matches', 'Save a fixture from its card or report.'));
}

function analysesSection(view) {
  const recent = recentAnalyses();
  if (recent.length === 0) return section('Recent analyses', '', emptyState('No analyses yet', 'Open a match report to create one.'));
  return section('Recent analyses', 'The last 30 match reports opened in this browser.',
    table(['Match', 'Analysed', 'Verdict', 'Top markets'], recent.map((r) => [
      h('a', { href: `#/match/${encodeURIComponent(r.id)}` }, `${r.home} v ${r.away}`), stampText(new Date(r.analysedAt)), badge(r.verdict, r.tone),
      r.topMarkets.map((m) => `${m.label} ${percent(m.probability, 0)}`).join(' · ')
    ])),
    definition([['Storage', 'Saved in this browser only (localStorage). Clearing site data removes it.']]),
    confirmButton('Clear analysis history', () => {
      removeStored('recentAnalyses');
      toast('Analysis history cleared.');
      renderSaved(view, '', () => true);
    }));
}

function confirmButton(text, action) {
  let armed = false;
  const control = button(text, () => {
    if (!armed) {
      armed = true;
      control.textContent = 'Click again to confirm';
      setTimeout(() => {
        armed = false;
        control.textContent = text;
      }, 4000);
      return;
    }
    action();
  }, 'danger');
  return control;
}
