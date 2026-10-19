// Searches league × market × odds band × edge rules on older seasons, then checks them on unseen seasons.
// Usage: node tools/analyse-backtest.mjs <dirOfLeagueJson> [splitDate]
import fs from 'node:fs/promises';
import path from 'node:path';

const [dir, splitDate = '2025-07-01'] = process.argv.slice(2);
const ODDS_BANDS = [[1, 1.6], [1.6, 2.2], [2.2, 3.5], [3.5, 100]];
const EDGE_STEPS = [0.03, 0.06, 0.1, 0.15];
const MINIMUM_TRAIN_BETS = 60;

const candidates = await loadCandidates(dir);
const train = candidates.filter((c) => c.date < splitDate);
const test = candidates.filter((c) => c.date >= splitDate);

section(`Data: ${candidates.length} priced candidates; train before ${splitDate}: ${train.length}, test after: ${test.length}`);

section('1. Every market, model edge ≥ 3% (train | test)');
table(groupBy(candidates.filter((c) => c.edge >= 0.03), (c) => c.market), ['market']);

section('2. Hit rate vs profit by odds band, edge ≥ 3%');
table(groupBy(candidates.filter((c) => c.edge >= 0.03), (c) => bandLabel(c.odds)), ['odds band']);

section('3. Every league, edge ≥ 3%, all markets');
table(groupBy(candidates.filter((c) => c.edge >= 0.03), (c) => c.league), ['league']);

section('4. Blind favourite (no model): shortest of home/away price');
table(groupBy(favourites(candidates), (c) => bandLabel(c.odds)), ['odds band']);

ruleSearch();

function ruleSearch() {
  const rules = [];
  const leagues = [...new Set(candidates.map((c) => c.league))];
  const markets = [...new Set(candidates.map((c) => c.market))];
  leagues.forEach((league) => markets.forEach((market) => ODDS_BANDS.forEach((band) => EDGE_STEPS.forEach((edge) => {
    const matches = (c) => c.league === league && c.market === market && c.odds >= band[0] && c.odds < band[1] && c.edge >= edge;
    const trainStats = stats(train.filter(matches));
    if (trainStats.bets < MINIMUM_TRAIN_BETS) return;
    rules.push({ name: `${league} ${market} odds ${band[0]}-${band[1]} edge≥${edge * 100}%`, matches, train: trainStats });
  }))));
  const winners = rules.filter((rule) => rule.train.roi > 0.05).sort((a, b) => b.train.roi - a.train.roi);
  winners.forEach((rule) => { rule.test = stats(test.filter(rule.matches)); });
  const tested = winners.filter((rule) => rule.test.bets > 0);
  const stillPositive = tested.filter((rule) => rule.test.roi > 0).length;

  section(`5. Rule search: ${rules.length} rules with ≥${MINIMUM_TRAIN_BETS} train bets; ${winners.length} made >5% ROI on train`);
  console.log(`Of those, ${stillPositive} of ${tested.length} were still profitable on the unseen seasons (${pct(stillPositive / tested.length)}).`);
  console.log('Top 25 by train ROI:');
  console.log(pad('rule', 46) + pad('train bets', 11) + pad('train hit', 10) + pad('train ROI', 10) + pad('test bets', 10) + pad('test hit', 9) + 'test ROI');
  winners.slice(0, 25).forEach((rule) => console.log(pad(rule.name, 46) + pad(rule.train.bets, 11) + pad(pct(rule.train.hit), 10) + pad(pct(rule.train.roi), 10) + pad(rule.test.bets, 10) + pad(pct(rule.test.hit), 9) + pct(rule.test.roi)));

  const portfolio = new Set();
  const pick = test.filter((c) => winners.some((rule) => rule.matches(c)) && !portfolio.has(key(c)) && portfolio.add(key(c)));
  const portfolioStats = stats(pick);
  console.log(`\nBetting every train-winning rule on the unseen seasons: ${portfolioStats.bets} bets, hit ${pct(portfolioStats.hit)}, ROI ${pct(portfolioStats.roi)}, 95% range ${pct(portfolioStats.low)} to ${pct(portfolioStats.high)}`);
}

async function loadCandidates(folder) {
  const files = (await fs.readdir(folder)).filter((file) => file.endsWith('.json'));
  const lists = await Promise.all(files.map(async (file) => JSON.parse(await fs.readFile(path.join(folder, file), 'utf8'))));
  return lists.flat();
}

function favourites(all) {
  const byMatch = new Map();
  all.filter((c) => c.market === 'home' || c.market === 'away').forEach((c) => {
    const current = byMatch.get(key(c));
    if (!current || c.odds < current.odds) byMatch.set(key(c), c);
  });
  return [...byMatch.values()];
}

function key(c) {
  return `${c.league}|${c.date}|${c.home}|${c.away}|${c.market}`;
}

function groupBy(list, keyOf) {
  const groups = new Map();
  list.forEach((c) => {
    const group = groups.get(keyOf(c)) || [];
    group.push(c);
    groups.set(keyOf(c), group);
  });
  return [...groups.entries()].sort(([a], [b]) => String(a).localeCompare(String(b)));
}

function table(groups, [label]) {
  console.log(pad(label, 14) + pad('train bets', 11) + pad('hit', 8) + pad('ROI', 9) + pad('CLV', 8) + '| ' + pad('test bets', 10) + pad('hit', 8) + pad('ROI', 9) + 'CLV');
  groups.forEach(([name, list]) => {
    const a = stats(list.filter((c) => c.date < splitDate));
    const b = stats(list.filter((c) => c.date >= splitDate));
    console.log(pad(name, 14) + pad(a.bets, 11) + pad(pct(a.hit), 8) + pad(pct(a.roi), 9) + pad(pct(a.clv), 8) + '| ' + pad(b.bets, 10) + pad(pct(b.hit), 8) + pad(pct(b.roi), 9) + pct(b.clv));
  });
}

function stats(list) {
  const bets = list.length;
  if (!bets) return { bets: 0, hit: NaN, roi: NaN, clv: NaN, low: NaN, high: NaN };
  const profits = list.map((c) => c.profit);
  const withClv = list.filter((c) => c.clv !== null);
  const [low, high] = bootstrap(profits);
  return {
    bets,
    hit: list.filter((c) => c.won).length / bets,
    roi: profits.reduce((s, p) => s + p, 0) / bets,
    clv: withClv.length ? withClv.reduce((s, c) => s + c.clv, 0) / withClv.length : NaN,
    low,
    high
  };
}

function bootstrap(profits, samples = 400) {
  if (profits.length < 20) return [NaN, NaN];
  let seed = 20261019;
  const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const rois = Array.from({ length: samples }, () => {
    let total = 0;
    for (let i = 0; i < profits.length; i++) total += profits[Math.floor(random() * profits.length)];
    return total / profits.length;
  }).sort((a, b) => a - b);
  return [rois[Math.floor(samples * 0.025)], rois[Math.floor(samples * 0.975)]];
}

function bandLabel(odds) {
  const band = ODDS_BANDS.find(([low, high]) => odds >= low && odds < high);
  return `${band[0]}-${band[1] === 100 ? '+' : band[1]}`;
}

function section(title) {
  console.log(`\n=== ${title}`);
}

function pad(value, width) {
  return String(value).padEnd(width);
}

function pct(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '—';
}
