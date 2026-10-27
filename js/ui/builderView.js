import { h, replaceContent, badge } from '../util/dom.js';
import { decimalOdds, kickoffText, percent, signedPercent } from '../util/format.js';
import { MARKET_CATALOGUE, eligiblePlayers } from '../model/marketCatalogue.js';
import { createLeg } from '../model/legs.js';
import { assessConfidence } from '../model/confidence.js';
import { analyse } from './matchService.js';
import { loadFixtures } from '../data/feeds.js';
import { recentAnalyses } from '../store/appState.js';
import { addToSlip, bindSlipToMatch, replaceSlip, slipPanel } from './slipPanel.js';
import { button, buttonLink, confidenceBadge, definition, emptyState, list, loadingPanel, methodBadge, section, toast } from './components.js';

const CONTROL_BUILDERS = {
  resultSide: () => selectControl('side', 'Outcome', [['home', 'Home'], ['draw', 'Draw'], ['away', 'Away']]),
  side: () => selectControl('side', 'Team', [['home', 'Home'], ['away', 'Away']]),
  pair: () => selectControl('pair', 'Double chance', [['1X', 'Home or draw'], ['X2', 'Away or draw'], ['12', 'Home or away']]),
  direction: () => selectControl('direction', 'Over or under', [['over', 'Over'], ['under', 'Under']]),
  answer: () => selectControl('answer', 'Answer', [['yes', 'Yes'], ['no', 'No']]),
  line: () => numberControl('line', 'Line', 0.5, 1),
  handicap: () => numberControl('line', 'Handicap', -9.5, 1),
  margin: () => numberControl('margin', 'Winning margin', 1, 1),
  score: () => [numberControl('home', 'Home goals', 0, 1), numberControl('away', 'Away goals', 0, 1)]
};

export async function renderBuilder(view, id, isCurrent) {
  if (!id) return renderPicker(view);
  replaceContent(view, loadingPanel('Preparing the Bet Builder workspace…'));
  const analysis = await analyse(id);
  if (!isCurrent()) return;
  if (bindSlipToMatch(analysis.fixture.id)) toast('Slip cleared: a Bet Builder covers one match only.', 'warn');
  const { fixture } = analysis;
  replaceContent(view, h('div', { class: 'builder' },
    h('div', { class: 'builder-main' },
      section(`${fixture.home} v ${fixture.away}`, `${kickoffText(fixture.kickoff)} · Bet Builder workspace`,
        h('p', { class: 'muted' }, 'Market list follows what Bet365 Bet Builder typically offers. Whether a market is offered for this match is not verified by any feed: check the app. Prices for Bet Builder legs are never invented here.'),
        h('div', { class: 'hero-actions' }, buttonLink(`#/match/${encodeURIComponent(fixture.id)}`, 'Back to match report'), buttonLink('#/fixtures', 'Choose another match', 'ghost'))),
      profilesSection(analysis),
      catalogueSection(analysis)),
    h('div', { class: 'builder-side' }, slipPanel(analysis))));
}

async function renderPicker(view) {
  const recent = recentAnalyses();
  let upcoming = [];
  try {
    upcoming = (await loadFixtures()).fixtures.filter((f) => f.kickoff > new Date());
  } catch {
    upcoming = [];
  }
  const options = [...recent.map((r) => [r.id, `${r.home} v ${r.away} (analysed)`]), ...upcoming.filter((f) => !recent.some((r) => r.id === f.id)).map((f) => [f.id, `${f.home} v ${f.away} · ${kickoffText(f.kickoff)}`])];
  if (options.length === 0) {
    replaceContent(view, emptyState('No match selected', 'Pick a fixture first.', buttonLink('#/fixtures', 'Go to fixtures', 'primary')));
    return;
  }
  const picker = h('select', { 'aria-label': 'Match' }, options.map(([value, label]) => h('option', { value }, label)));
  replaceContent(view, section('Select a match', 'A Bet Builder combines selections from one match.',
    h('div', { class: 'filter-controls' }, picker, button('Open workspace', () => {
      window.location.hash = `#/builder/${encodeURIComponent(picker.value)}`;
    }, 'primary'))));
}

function profilesSection(analysis) {
  return section('Automated profiles', 'Analytical categories, not safety ratings. Each leg is chosen by evidence; legs are never added just to raise the price.',
    h('div', { class: 'profile-grid' }, analysis.profiles.map((profile) => profileCard(profile, analysis))));
}

function profileCard(profile, analysis) {
  if (profile.empty) return h('article', { class: 'profile-card' }, h('h3', {}, profile.title), h('p', { class: 'muted' }, profile.intent), h('p', { class: 'callout callout-warn' }, profile.reason));
  const { pricing } = profile;
  const oddsInput = h('input', { type: 'number', min: '1.01', step: '0.01', inputmode: 'decimal', placeholder: 'Bet365 price', 'aria-label': `${profile.title} combined Bet365 odds` });
  const valueLine = h('p', { class: 'small', 'aria-live': 'polite' }, 'Enter the Bet365 combined price to compare.');
  oddsInput.addEventListener('input', () => {
    const odds = Number(oddsInput.value);
    if (!(odds > 1)) return void (valueLine.textContent = 'Enter the Bet365 combined price to compare.');
    valueLine.textContent = `Implied ${percent(1 / odds)} vs model ${percent(pricing.joint.value)} · estimated EV ${signedPercent(pricing.joint.value * odds - 1)}`;
  });
  return h('article', { class: 'profile-card' },
    h('h3', {}, profile.title),
    h('p', { class: 'muted small' }, profile.intent),
    h('h4', {}, `${analysis.fixture.home} v ${analysis.fixture.away} · ${kickoffText(analysis.fixture.kickoff)}`),
    h('ol', { class: 'slip-legs' }, pricing.legs.map((single) => h('li', {}, h('strong', {}, single.label), h('span', { class: 'slip-leg-meta' }, h('span', { class: 'mono' }, percent(single.estimate.value)), confidenceBadge(single.confidence))))),
    definition([
      ['All legs (model)', h('span', {}, h('strong', { class: 'mono' }, percent(pricing.joint.value, 1)), ' ', methodBadge(pricing.joint))],
      ['If independent', percent(pricing.independentProduct, 1)],
      ['Model fair odds', decimalOdds(1 / pricing.joint.value)]
    ]),
    h('label', { class: 'small' }, 'Bet365 combined odds', oddsInput), valueLine,
    h('details', {}, h('summary', {}, 'Evidence for each selection'), list(profile.evidence)),
    h('details', {}, h('summary', {}, 'Main risks'), list(profile.risks)),
    h('details', {}, h('summary', {}, 'Missing information'), list(profile.missing)),
    button('Load into slip', () => replaceSlip(profile.specs), 'primary'));
}

function catalogueSection(analysis) {
  const categories = [...new Set(MARKET_CATALOGUE.map((item) => item.category))];
  return section('All markets', 'Adjust the team, line or player, check the model probability, then add the selection to the slip.',
    categories.map((category, index) => h('details', { class: 'market-category', open: index < 2 },
      h('summary', {}, category),
      h('div', { class: 'market-rows' }, MARKET_CATALOGUE.filter((item) => item.category === category).map((item) => marketRow(item, analysis))))));
}

function marketRow(item, analysis) {
  if (item.unavailableReason) return h('div', { class: 'market-row is-unavailable' }, h('span', { class: 'market-name' }, item.name), badge('not modelled', 'neutral'), h('small', { class: 'muted' }, item.unavailableReason));
  const spec = { type: item.type, ...item.defaults };
  const controls = item.controls.flatMap((control) => (control === 'player' ? [playerControl(item, analysis)] : [CONTROL_BUILDERS[control]()].flat()));
  if (controls.some((control) => control.dataset.unavailable)) {
    return h('div', { class: 'market-row is-unavailable' }, h('span', { class: 'market-name' }, item.name), badge('needs player data', 'neutral'), h('small', { class: 'muted' }, analysis.model.playerContext.message));
  }
  const output = h('span', { class: 'market-output', 'aria-live': 'polite' });
  const addButton = button('Add', () => addToSlip(readSpec(spec, controls)), 'secondary');
  const refresh = () => showEstimate(output, addButton, readSpec(spec, controls), analysis);
  controls.forEach((control) => {
    const field = control.querySelector('select, input');
    field.value = String(spec[field.name] ?? field.value);
    field.addEventListener('change', refresh);
  });
  refresh();
  return h('div', { class: 'market-row' }, h('span', { class: 'market-name' }, item.name), h('div', { class: 'market-controls' }, controls), output, addButton);
}

function readSpec(base, controls) {
  const spec = { ...base };
  controls.forEach((control) => {
    const field = control.querySelector('select, input');
    spec[field.name] = field.type === 'number' ? Number(field.value) : field.value;
    if (field.name === 'playerId') {
      const option = field.selectedOptions[0];
      spec.playerId = Number(field.value);
      spec.name = option.dataset.name;
      spec.side = option.dataset.side;
    }
  });
  return spec;
}

function showEstimate(output, addButton, spec, analysis) {
  try {
    const leg = createLeg(spec);
    const estimate = analysis.model.probability([leg]);
    addButton.disabled = !estimate.available;
    replaceContent(output, estimate.available
      ? [h('span', { class: 'mono' }, percent(estimate.value)), methodBadge(estimate), confidenceBadge(assessConfidence(analysis.model, leg.family))]
      : [badge('unavailable', 'bad'), h('small', { class: 'muted' }, estimate.reason)]);
  } catch (error) {
    addButton.disabled = true;
    replaceContent(output, badge(error.message, 'bad'));
  }
}

function selectControl(name, label, options) {
  return h('label', { class: 'control' }, h('span', { class: 'visually-hidden' }, label),
    h('select', { name, 'aria-label': label }, options.map(([value, text]) => h('option', { value }, text))));
}

function numberControl(name, label, minimum, step) {
  return h('label', { class: 'control' }, h('span', { class: 'visually-hidden' }, label),
    h('input', { type: 'number', name, 'aria-label': label, min: String(minimum), step: String(step), inputmode: 'decimal' }));
}

function playerControl(item, analysis) {
  const players = eligiblePlayers(analysis.model.playerContext.players, item);
  if (players.length === 0) return h('span', { dataset: { unavailable: 'true' } });
  const names = analysis.fixture;
  return h('label', { class: 'control' }, h('span', { class: 'visually-hidden' }, 'Player'),
    h('select', { name: 'playerId', 'aria-label': 'Player' }, players.map((p) =>
      h('option', { value: p.id, dataset: { name: p.name, side: p.side } }, `${p.name} (${p.side === 'home' ? names.home : names.away}, ${p.status})`))));
}
