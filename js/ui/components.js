import { h, replaceContent, badge } from '../util/dom.js';
import { percent } from '../util/format.js';
import { confidenceTone } from '../model/confidence.js';

export function renderError(container, error) {
  replaceContent(container, errorPanel(error));
}

export function errorPanel(error, title = 'Something went wrong') {
  return h('div', { class: 'panel panel-error', role: 'alert' },
    h('h2', {}, title),
    h('p', {}, error.message || String(error)),
    h('p', { class: 'muted' }, 'Nothing was invented to fill the gap. Check the Data sources page, then reload.'));
}

export function loadingPanel(text) {
  return h('div', { class: 'panel loading', role: 'status', 'aria-live': 'polite' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), text);
}

export function emptyState(title, text, action) {
  return h('div', { class: 'empty-state' }, h('h3', {}, title), h('p', {}, text), action || '');
}

export function section(title, subtitle, ...children) {
  return h('section', { class: 'panel' },
    h('header', { class: 'panel-header' }, h('h2', {}, title), subtitle ? h('p', { class: 'muted' }, subtitle) : ''),
    ...children);
}

export function kpi(label, value, note) {
  return h('div', { class: 'kpi' }, h('span', { class: 'kpi-label' }, label), h('strong', { class: 'kpi-value' }, value), note ? h('small', {}, note) : '');
}

export function probabilityBar(probability) {
  const width = Number.isFinite(probability) ? Math.max(0, Math.min(100, probability * 100)) : 0;
  return h('span', { class: 'probability' },
    h('span', { class: 'probability-track', 'aria-hidden': 'true' }, h('span', { class: 'probability-fill', style: `width:${width}%` })),
    h('span', { class: 'mono' }, percent(probability)));
}

export function confidenceBadge(confidence) {
  return h('span', { class: `badge badge-${confidenceTone(confidence.level)}`, title: confidence.reasons.join(' ') }, confidence.level);
}

export function methodBadge(estimate) {
  if (!estimate.available) return badge('unavailable', 'bad');
  if (estimate.method === 'exact') return badge('exact', 'neutral');
  return h('span', { class: 'badge badge-neutral', title: `Monte Carlo standard error ±${(estimate.standardError * 100).toFixed(2)} points` }, 'simulated');
}

export function verdictBadge(verdict, tone) {
  return badge(verdict, tone);
}

export function buttonLink(href, text, variant = 'secondary') {
  return h('a', { class: `button button-${variant}`, href }, text);
}

export function button(text, onclick, variant = 'secondary', attributes = {}) {
  return h('button', { type: 'button', class: `button button-${variant}`, onclick, ...attributes }, text);
}

export function list(items, className = 'bullet-list') {
  return h('ul', { class: className }, items.map((item) => h('li', {}, item)));
}

export function definition(pairs) {
  return h('dl', { class: 'definition-grid' }, pairs.flatMap(([term, value]) => [h('dt', {}, term), h('dd', {}, value)]));
}

export function toast(message, tone = 'good') {
  const element = h('div', { class: `toast toast-${tone}`, role: 'status' }, message);
  document.body.append(element);
  setTimeout(() => element.remove(), 3200);
}
