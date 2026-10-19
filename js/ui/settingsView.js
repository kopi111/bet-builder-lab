import { h, replaceContent } from '../util/dom.js';
import { DEFAULT_SETTINGS } from '../config.js';
import { loadSettings, saveSettings } from '../store/appState.js';
import { forgetAnalyses } from './matchService.js';
import { button, section, toast } from './components.js';

const FIELDS = [
  { key: 'halfLifeDays', label: 'Time-decay half-life (days)', min: 30, max: 1000, step: 10, help: 'How quickly older matches lose weight. Shorter reacts faster but is noisier.' },
  { key: 'shrinkageMatches', label: 'Shrinkage (pseudo-matches at league average)', min: 0, max: 20, step: 1, help: 'Pulls teams with few matches toward the league average.' },
  { key: 'shotsOnTargetBlend', label: 'Shots-on-target blend (0–1)', min: 0, max: 1, step: 0.05, help: 'Share of each team\'s goal record replaced by shots on target × league conversion. A partial stand-in for xG.' },
  { key: 'dixonColesRho', label: 'Dixon-Coles low-score correction ρ', min: -0.2, max: 0.1, step: 0.01, help: 'Negative values make 0-0 and 1-1 more likely than plain Poisson.' },
  { key: 'simulations', label: 'Simulated matches per analysis', min: 5000, max: 200000, step: 5000, help: 'More simulations reduce Monte Carlo noise but take longer.' },
  { key: 'valueThreshold', label: 'Value threshold (EV per unit)', min: 0, max: 0.3, step: 0.01, help: 'Minimum estimated EV before a price is flagged for investigation.' },
  { key: 'minimumTeamMatches', label: 'Minimum league matches per team', min: 1, max: 30, step: 1, help: 'Below this, the report says "Insufficient evidence".' }
];

export function renderSettings(view) {
  const settings = loadSettings();
  const inputs = FIELDS.map((field) => h('input', { id: `setting-${field.key}`, type: 'number', min: String(field.min), max: String(field.max), step: String(field.step), value: String(settings[field.key]), required: true }));
  const message = h('p', { class: 'form-message', role: 'alert' });
  const form = h('form', { class: 'settings-form', novalidate: true },
    FIELDS.map((field, i) => h('div', { class: 'field' }, h('label', { for: inputs[i].id }, field.label), inputs[i], h('small', { class: 'muted' }, field.help))),
    message,
    h('div', { class: 'hero-actions' }, h('button', { type: 'submit', class: 'button button-primary' }, 'Save settings'),
      button('Restore defaults', () => {
        saveSettings({ ...DEFAULT_SETTINGS });
        forgetAnalyses();
        toast('Defaults restored.');
        renderSettings(view);
      }, 'ghost')));
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const invalid = FIELDS.findIndex((field, i) => !isWithin(inputs[i].value, field));
    if (invalid >= 0) {
      const field = FIELDS[invalid];
      message.textContent = `${field.label} must be a number from ${field.min} to ${field.max}.`;
      inputs[invalid].focus();
      return;
    }
    message.textContent = '';
    saveSettings(Object.fromEntries(FIELDS.map((field, i) => [field.key, Number(inputs[i].value)])));
    forgetAnalyses();
    toast('Settings saved. Analyses will be recalculated with them.');
  });
  replaceContent(view, section('Model settings', 'Saved in this browser. Changing them re-runs every analysis; run the Backtest again to see whether a change actually helps.', form));
}

function isWithin(text, field) {
  const value = Number(text);
  return text !== '' && Number.isFinite(value) && value >= field.min && value <= field.max;
}
