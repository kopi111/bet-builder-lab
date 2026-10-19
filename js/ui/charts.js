import { h } from '../util/dom.js';

const PALETTE = { home: '#0f8a5a', away: '#1f6fd1', neutral: '#8b98a9', warn: '#a86200', bad: '#cf3030', grid: 'rgba(20,32,43,0.08)', text: '#5b6878' };

export const chartColors = PALETTE;

export function chartBlock(label, config, fallbackText) {
  const canvas = h('canvas', { role: 'img', 'aria-label': label });
  const wrapper = h('figure', { class: 'chart' }, h('div', { class: 'chart-canvas' }, canvas), h('figcaption', {}, label));
  requestAnimationFrame(() => drawChart(canvas, config, wrapper, fallbackText));
  return wrapper;
}

function drawChart(canvas, config, wrapper, fallbackText) {
  if (typeof window.Chart === 'undefined') {
    wrapper.querySelector('.chart-canvas').replaceChildren(h('p', { class: 'muted' }, `Chart library did not load (offline?). ${fallbackText}`));
    return;
  }
  new window.Chart(canvas, withTheme(config));
}

function withTheme(config) {
  const axis = { ticks: { color: PALETTE.text }, grid: { color: PALETTE.grid } };
  const options = config.options || {};
  return {
    ...config,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: { legend: { labels: { color: PALETTE.text } }, tooltip: { mode: 'index', intersect: false } },
      ...options,
      scales: { x: { ...axis, ...options.scales?.x }, y: { ...axis, ...options.scales?.y } }
    }
  };
}

export function histogram(column, maximum) {
  const counts = new Array(maximum + 1).fill(0);
  column.forEach((value) => {
    counts[Math.min(maximum, value)]++;
  });
  return counts.map((count) => count / column.length);
}
