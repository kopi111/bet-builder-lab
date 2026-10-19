import { h, replaceContent } from '../util/dom.js';
import { decimalOdds, money, percent, signedPercent } from '../util/format.js';
import { legKey } from '../model/legs.js';
import { priceCombination } from '../model/combination.js';
import { bettingReturn, impliedProbability } from '../model/value.js';
import { draftSlip, fixtureSummary, savedSlips, storeDraftSlip, storeSlips } from '../store/appState.js';
import { button, definition, emptyState, methodBadge, toast } from './components.js';

let slip = draftSlip();
const listeners = new Set();

export function bindSlipToMatch(matchId) {
  if (slip.matchId === matchId) return false;
  const hadLegs = slip.specs.length > 0;
  slip = { matchId, specs: [], odds: '', stake: slip.stake || '10' };
  storeDraftSlip(slip);
  return hadLegs;
}

export function addToSlip(spec) {
  if (slip.specs.some((existing) => legKey(existing) === legKey(spec))) {
    toast('That selection is already on the slip.', 'warn');
    return;
  }
  updateSlip({ specs: [...slip.specs, spec], odds: '' });
  toast('Added to slip. Re-enter the combined price: it changes with every leg.');
}

export function replaceSlip(specs) {
  updateSlip({ specs: [...specs], odds: '' });
  toast('Profile loaded into the slip.');
}

function updateSlip(changes) {
  slip = { ...slip, ...changes };
  storeDraftSlip(slip);
  listeners.forEach((listener) => listener());
}

export function slipPanel(analysis) {
  const container = h('aside', { class: 'slip panel', 'aria-label': 'Bet Builder slip' });
  const draw = () => drawSlip(container, analysis);
  listeners.clear();
  listeners.add(draw);
  draw();
  return container;
}

function drawSlip(container, analysis) {
  const header = h('header', { class: 'panel-header' }, h('h2', {}, 'Bet Builder slip'), h('p', { class: 'muted small' }, 'Simulator only: nothing is sent to Bet365.'));
  if (slip.specs.length === 0) {
    replaceContent(container, header, emptyState('Slip is empty', 'Add selections from the markets, or load one of the profiles.'));
    return;
  }
  const pricing = priceCombination(analysis.model, slip.specs, Number(slip.odds));
  replaceContent(container, header, legList(pricing), jointSummary(pricing), stakeForm(pricing, analysis), slipActions(pricing, analysis));
}

function legList(pricing) {
  return h('ol', { class: 'slip-legs' }, pricing.legs.map((single, index) => h('li', {},
    h('div', {}, h('strong', {}, single.label), h('small', { class: 'muted' }, ` ${single.leg.category}`)),
    h('div', { class: 'slip-leg-meta' }, h('span', { class: 'mono' }, percent(single.estimate.value)), methodBadge(single.estimate),
      h('button', { type: 'button', class: 'icon-button remove', 'aria-label': `Remove ${single.label}`, onclick: () => updateSlip({ specs: slip.specs.filter((_, i) => i !== index), odds: '' }) }, '×')))));
}

function jointSummary(pricing) {
  const joint = pricing.joint;
  if (!joint.available) return h('div', { class: 'callout callout-bad' }, h('strong', {}, 'Combined probability unavailable. '), joint.reason, '. It is not estimated rather than guessed.');
  const impossible = joint.value === 0;
  return h('div', { class: 'joint' },
    definition([
      ['Model probability, all legs', h('span', {}, h('strong', { class: 'mono' }, percent(joint.value, 2)), ' ', methodBadge(joint))],
      ['If legs were independent', h('span', { class: 'mono' }, percent(pricing.independentProduct, 2))],
      ['Dependence effect', Number.isFinite(pricing.dependenceRatio) ? `${pricing.dependenceRatio >= 1 ? 'legs help each other' : 'legs work against each other'} (×${pricing.dependenceRatio.toFixed(2)})` : 'n/a'],
      ['Model fair odds', h('span', { class: 'mono' }, decimalOdds(1 / joint.value))]
    ]),
    impossible ? h('p', { class: 'callout callout-bad' }, 'These selections cannot all happen in the same match.') : '',
    pricing.conflicts.map((c) => h('p', { class: 'callout callout-warn' }, `"${c.first}" and "${c.second}" pull against each other.`)));
}

function stakeForm(pricing, analysis) {
  const oddsInput = h('input', { id: 'slip-odds', type: 'number', min: '1.01', step: '0.01', inputmode: 'decimal', value: slip.odds, placeholder: 'e.g. 3.40' });
  const stakeInput = h('input', { id: 'slip-stake', type: 'number', min: '0', step: '1', inputmode: 'decimal', value: slip.stake });
  const results = h('div', { class: 'slip-results', 'aria-live': 'polite' });
  const recalculate = () => drawResults(results, pricing, Number(oddsInput.value), Number(stakeInput.value));
  oddsInput.addEventListener('input', () => {
    slip = { ...slip, odds: oddsInput.value };
    storeDraftSlip(slip);
    recalculate();
  });
  stakeInput.addEventListener('input', () => {
    slip = { ...slip, stake: stakeInput.value };
    storeDraftSlip(slip);
    recalculate();
  });
  recalculate();
  return h('div', { class: 'stake-form' },
    h('label', { for: 'slip-odds' }, 'Combined odds shown by Bet365 (decimal)'),
    oddsInput,
    h('small', { class: 'muted' }, 'Bet Builder prices are not the product of single prices: copy the exact combined price from the app.'),
    h('label', { for: 'slip-stake' }, 'Hypothetical stake'),
    stakeInput,
    results,
    analysis.fixture.played ? h('p', { class: 'muted small' }, 'This is a replay of a finished match; saved slips settle immediately.') : '');
}

function drawResults(container, pricing, odds, stake) {
  if (!(odds > 1)) {
    replaceContent(container, h('p', { class: 'muted small' }, 'Enter the combined odds to see returns, implied probability and estimated value.'));
    return;
  }
  const payout = bettingReturn(Number.isFinite(stake) ? stake : 0, odds);
  const implied = impliedProbability(odds);
  const model = pricing.joint.value;
  const ev = pricing.joint.available ? model * odds - 1 : NaN;
  replaceContent(container, definition([
    ['Potential return', h('span', { class: 'mono' }, money(payout.returns))],
    ['Net profit if it lands', h('span', { class: 'mono' }, money(payout.profit))],
    ['Bookmaker implied probability', h('span', { class: 'mono' }, percent(implied, 2))],
    ['Model minus implied', h('span', { class: 'mono' }, pricing.joint.available ? signedPercent(model - implied, 2) : 'n/a')],
    ['Estimated EV per unit', h('span', { class: `mono ${ev > 0 ? 'positive' : 'negative'}` }, signedPercent(ev))]
  ]), h('p', { class: 'muted small' }, 'Implied probability includes the bookmaker margin, which on Bet Builders is usually large. A positive estimate is a model opinion, not a guaranteed profit.'));
}

function slipActions(pricing, analysis) {
  return h('div', { class: 'slip-actions' },
    button('Save combination', () => saveCombination(pricing, analysis), 'primary'),
    button('Clear slip', () => updateSlip({ specs: [], odds: '' }), 'ghost'));
}

function saveCombination(pricing, analysis) {
  const record = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    match: fixtureSummary(analysis.fixture),
    specs: slip.specs,
    labels: pricing.legs.map((single) => single.label),
    modelProbability: pricing.joint.value,
    method: pricing.joint.method,
    independentProduct: pricing.independentProduct,
    odds: Number(slip.odds) > 1 ? Number(slip.odds) : NaN,
    stake: Number(slip.stake) || 0,
    savedAt: new Date().toISOString(),
    status: 'pending',
    legResults: []
  };
  storeSlips([record, ...savedSlips()]);
  toast('Combination saved. It settles automatically on the Saved page once the result is in the data.');
}
