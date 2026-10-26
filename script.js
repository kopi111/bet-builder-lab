import { renderFixtures } from './js/ui/fixturesView.js';
import { renderMatch } from './js/ui/matchView.js';
import { renderBuilder } from './js/ui/builderView.js';
import { renderSaved } from './js/ui/savedView.js';
import { renderThreeMarkets } from './js/ui/threeMarketsView.js';
import { renderBacktest } from './js/ui/backtestView.js';
import { renderSettings } from './js/ui/settingsView.js';
import { renderSources } from './js/ui/sourcesView.js';
import { renderError } from './js/ui/components.js';
import { onSourceChange, sourceEntries } from './js/data/sourceStatus.js';
import { draftSlip } from './js/store/appState.js';

const ROUTES = {
  fixtures: { title: 'Fixtures', render: renderFixtures },
  match: { title: 'Match report', render: renderMatch },
  three: { title: '1X2 · BTTS · Over 2.5', render: renderThreeMarkets },
  builder: { title: 'Bet Builder', render: renderBuilder },
  saved: { title: 'Saved & tracking', render: renderSaved },
  backtest: { title: 'Backtest', render: renderBacktest },
  settings: { title: 'Model settings', render: renderSettings },
  sources: { title: 'Data sources', render: renderSources }
};

const view = document.getElementById('view');
let renderToken = 0;

window.addEventListener('hashchange', showCurrentRoute);
document.getElementById('menu-toggle').addEventListener('click', toggleMenu);
onSourceChange(updateDataStatus);
showCurrentRoute();

async function showCurrentRoute() {
  const { name, parameter } = parseHash();
  const route = ROUTES[name] || ROUTES.fixtures;
  const token = ++renderToken;
  document.getElementById('page-title').textContent = route.title;
  highlightNavigation(name);
  closeMenu();
  view.replaceChildren();
  try {
    await route.render(view, parameterOrRemembered(name, parameter), () => token === renderToken);
  } catch (error) {
    if (token === renderToken) renderError(view, error);
    console.error(error);
  }
}

function parseHash() {
  const [, name = 'fixtures', ...rest] = window.location.hash.split('/');
  return { name, parameter: rest.length ? decodeURIComponent(rest.join('/')) : '' };
}

function parameterOrRemembered(name, parameter) {
  if (parameter || (name !== 'match' && name !== 'builder')) return parameter;
  return draftSlip().matchId;
}

function highlightNavigation(name) {
  document.querySelectorAll('[data-route]').forEach((link) => {
    if (link.dataset.route === name) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}

function toggleMenu() {
  const open = document.body.classList.toggle('menu-open');
  document.getElementById('menu-toggle').setAttribute('aria-expanded', String(open));
}

function closeMenu() {
  document.body.classList.remove('menu-open');
  document.getElementById('menu-toggle').setAttribute('aria-expanded', 'false');
}

function updateDataStatus() {
  const entries = sourceEntries();
  const failed = entries.filter((entry) => !entry.ok).length;
  const stale = entries.filter((entry) => entry.ok && entry.stale).length;
  const status = document.getElementById('data-status');
  status.className = `topbar-status ${failed ? 'is-bad' : stale ? 'is-warn' : 'is-good'}`;
  status.textContent = failed ? `${failed} data source${failed > 1 ? 's' : ''} failed` : stale ? `${stale} cached (offline) file${stale > 1 ? 's' : ''}` : `Live data · ${entries.length} file${entries.length === 1 ? '' : 's'} loaded`;
}
