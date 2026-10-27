import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || `${process.env.HOME}/projects/IdVerifyReset/tests/e2e/node_modules/playwright`);

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5350';
const SHOTS = process.env.SHOT_DIR || '/tmp';
const problems = [];
const step = (name) => console.log(`- ${name}`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));

step('fixtures dashboard');
await page.goto(BASE);
await page.waitForSelector('.fixture-card', { timeout: 30000 });
await page.screenshot({ path: `${SHOTS}/01-fixtures.png`, fullPage: false });

step('filter Premier League + analyse all');
await page.getByRole('combobox', { name: 'Day' }).selectOption('all');
await page.getByRole('button', { name: 'Premier League' }).click();
const analyseAll = page.getByRole('button', { name: /Analyse all/ });
await analyseAll.click();
await page.getByRole('button', { name: 'Analysis complete' }).waitFor({ timeout: 120000 });
await page.screenshot({ path: `${SHOTS}/02-analysed.png` });

step('match report');
await page.locator('.fixture-card a', { hasText: 'Report' }).first().click();
await page.getByRole('heading', { name: '12 · Final assessment' }).waitFor({ timeout: 60000 });
await page.waitForTimeout(500);
await page.screenshot({ path: `${SHOTS}/03-report.png`, fullPage: true });

step('bet builder');
await page.getByRole('link', { name: 'Open Bet Builder' }).click();
await page.getByRole('heading', { name: 'Automated profiles' }).waitFor({ timeout: 60000 });
await page.getByRole('button', { name: 'Load into slip' }).first().click();
await page.fill('#slip-odds', '3.40');
await page.fill('#slip-stake', '5');
await page.locator('.slip-results').getByText('Potential return').waitFor();
const firstAdd = page.locator('.market-row button:not([disabled])', { hasText: 'Add' }).nth(3);
await firstAdd.click();
await page.locator('.market-row select[name="direction"]').first().selectOption('under');
await page.getByRole('button', { name: 'Save combination' }).click();
await page.screenshot({ path: `${SHOTS}/04-builder.png`, fullPage: true });

step('saved page');
await page.goto(`${BASE}/#/saved`);
await page.getByRole('heading', { name: 'Saved combinations' }).waitFor();
if (await page.locator('table .badge').count() === 0) problems.push('saved slip not listed');

step('replay a past match');
await page.goto(`${BASE}/#/fixtures`);
await page.waitForSelector('#league-filter');
await page.selectOption('#league-filter', 'E0');
await page.locator('select[aria-label="Show"]').selectOption('results');
const replayLinks = await page.locator('a', { hasText: 'Replay builder' }).evaluateAll((links) => links.map((a) => a.getAttribute('href')));
let replayLoaded = false;
for (const href of replayLinks.slice(0, 8)) {
  await page.goto(`${BASE}/${href}`);
  await page.getByRole('heading', { name: 'Automated profiles' }).waitFor({ timeout: 60000 });
  if (await page.getByRole('button', { name: 'Load into slip' }).count() > 0) {
    replayLoaded = true;
    break;
  }
}
if (!replayLoaded) problems.push('no replayed match produced a profile');
await page.getByRole('button', { name: 'Load into slip' }).first().click();
await page.getByRole('button', { name: 'Save combination' }).click();
await page.goto(`${BASE}/#/saved`);
await page.getByRole('heading', { name: 'Saved combinations' }).waitFor();
await page.waitForTimeout(300);
const settledCount = await page.locator('td .badge', { hasText: /^(won|lost)$/ }).count();
if (settledCount === 0) problems.push('replayed slip did not auto-settle');
await page.screenshot({ path: `${SHOTS}/05-saved.png`, fullPage: true });

step('custom match-up');
await page.goto(`${BASE}/#/fixtures`);
await page.getByRole('button', { name: 'Load teams' }).click();
await page.getByText(/teams with league matches/).waitFor({ timeout: 30000 });
await page.getByRole('button', { name: 'Analyse match-up' }).click();
await page.getByRole('heading', { name: '12 · Final assessment' }).waitFor({ timeout: 60000 });

step('1X2 · BTTS · O2.5 picks and evidence');
await page.goto(`${BASE}/#/three`);
await page.waitForSelector('.three-list', { timeout: 120000 });
await page.click('.research-toggle > summary');
await page.waitForFunction(() => document.querySelectorAll('.data-table').length >= 3, null, { timeout: 30000 });

step('backtest');
await page.goto(`${BASE}/#/backtest`);
await page.getByRole('button', { name: 'Run walk-forward backtest' }).click();
await page.getByRole('heading', { name: 'Calibration' }).waitFor({ timeout: 120000 });
await page.waitForTimeout(500);
await page.screenshot({ path: `${SHOTS}/06-backtest.png`, fullPage: true });

step('settings validation');
await page.goto(`${BASE}/#/settings`);
await page.fill('#setting-halfLifeDays', '5');
await page.getByRole('button', { name: 'Save settings' }).click();
const message = await page.locator('.form-message').textContent();
if (!message.includes('half-life')) problems.push(`settings error did not name the field: "${message}"`);
await page.getByRole('button', { name: 'Restore defaults' }).click();

step('sources');
await page.goto(`${BASE}/#/sources`);
await page.getByRole('heading', { name: 'Data-source status' }).waitFor();

step('mobile 400px, every page');
await page.setViewportSize({ width: 400, height: 860 });
for (const route of ['fixtures', 'three', 'match', 'builder', 'saved', 'backtest', 'settings', 'sources']) {
  await page.goto(`${BASE}/#/${route}`);
  await page.waitForTimeout(route === 'match' || route === 'builder' ? 3000 : 1200);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 1) problems.push(`${route}: page scrolls sideways by ${overflow}px at 400px`);
  await page.screenshot({ path: `${SHOTS}/m-${route}.png`, fullPage: false });
}
await page.getByRole('button', { name: 'Open navigation' }).click();
await page.getByRole('link', { name: 'Backtest' }).click();
await page.getByRole('button', { name: 'Run walk-forward backtest' }).waitFor();

await browser.close();
if (problems.length) {
  console.log('\nPROBLEMS:\n' + problems.join('\n'));
  process.exit(1);
}
console.log('\nAll paths passed with no console errors.');
