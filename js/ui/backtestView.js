import { h, replaceContent, table } from '../util/dom.js';
import { decimalOdds, kickoffText, number, percent, signedPercent, stampText } from '../util/format.js';
import { LEAGUES, leagueByCode } from '../config.js';
import { loadLeagueHistory } from '../data/feeds.js';
import { runBacktest, skillSummary } from '../model/backtest.js';
import { backtestSummaries, loadSettings, storeBacktestSummary } from '../store/appState.js';
import { forgetAnalyses } from './matchService.js';
import { button, definition, errorPanel, kpi, list, section } from './components.js';
import { chartBlock, chartColors } from './charts.js';

let selectedLeague = 'E0';

export function renderBacktest(view) {
  const output = h('div', { class: 'backtest-output', 'aria-live': 'polite' });
  const leagueSelect = h('select', { 'aria-label': 'League to backtest' }, LEAGUES.filter((l) => !l.pooled).map((l) => h('option', { value: l.code, selected: l.code === selectedLeague }, `${l.country} · ${l.name}`)));
  leagueSelect.addEventListener('change', () => {
    selectedLeague = leagueSelect.value;
  });
  const runButton = button('Run walk-forward backtest', () => run(output, runButton), 'primary');
  replaceContent(view,
    section('Historical evaluation', 'Walk-forward: the model is refitted every 7 days using only matches played before that date, then predicts the next matches. No future data leaks into any prediction.',
      h('div', { class: 'filter-controls' }, leagueSelect, runButton),
      previousRuns(),
      list([
        'The first 150 matches are used only for training.',
        'Model results (log loss, Brier, calibration) are reported separately from simulated betting.',
        'Simulated bets use Bet365 prices recorded by football-data.co.uk before the match (usually a day or two out); closing-line value compares them with Bet365 closing prices.',
        'Bet Builder combinations cannot be backtested: no historical Bet Builder prices exist in the data.'
      ])),
    output);
}

function previousRuns() {
  const runs = Object.entries(backtestSummaries());
  if (runs.length === 0) return h('p', { class: 'muted small' }, 'No backtests run in this browser yet.');
  return table(['League', 'Ran', 'Matches', 'Bets', 'ROI', 'CLV'], runs.map(([code, run]) => [leagueByCode(code).name, stampText(new Date(run.ranAt)), run.sample, run.bets, percent(run.roi), signedPercent(run.closingLineValue)]), { caption: 'Previous runs (used to adjust confidence in match reports)' });
}

async function run(output, runButton) {
  runButton.disabled = true;
  const progress = h('progress', { max: '1', value: '0', 'aria-label': 'Backtest progress' });
  replaceContent(output, section('Running…', 'Fitting the model week by week. This takes a few seconds.', progress));
  try {
    const history = await loadLeagueHistory(selectedLeague);
    const report = await runBacktest(history.matches, loadSettings(), (fraction) => {
      progress.value = fraction;
    });
    storeBacktestSummary(selectedLeague, skillSummary(report));
    forgetAnalyses();
    replaceContent(output, reportView(report, history));
  } catch (error) {
    replaceContent(output, errorPanel(error, 'Backtest failed'));
  } finally {
    runButton.disabled = false;
  }
}

function reportView(report, history) {
  const bet = report.betting;
  return h('div', { class: 'stack' },
    section(`${leagueByCode(history.leagueCode).name}: ${report.sample} predicted matches`, `${kickoffText(report.from)} to ${kickoffText(report.to)} · ${report.oddsSample} with Bet365 prices`,
      h('div', { class: 'kpi-row' },
        kpi('1X2 log loss', number(report.result.logLoss, 4), `base rate ${number(report.result.baseline, 4)} (lower is better)`),
        kpi('vs Bet365 closing', number(report.market.modelLogLoss, 4), `market ${number(report.market.marketLogLoss, 4)} on ${report.market.sample}`),
        kpi('Favourite picked correctly', percent(report.result.accuracy), `Brier ${number(report.result.brier, 4)}`),
        kpi('Simulated ROI', percent(bet.roi), `${bet.bets} bets, 95% CI ${percent(bet.roiInterval.low)} to ${percent(bet.roiInterval.high)}`)),
      verdict(report)),
    section('Binary markets', 'Brier score against simply predicting the league\'s base rate. Skill above 0 means the model adds information.',
      table(['Market', 'Matches', 'Model Brier', 'Base-rate Brier', 'Skill', 'Average predicted', 'Observed'], Object.entries({
        'Over 2.5 goals': report.binary.over25, 'Both teams score': report.binary.bothScore, 'Over 9.5 corners': report.binary.corners, 'Over 3.5 cards': report.binary.cards
      }).map(([name, m]) => (m.sample ? [name, m.sample, number(m.brier, 4), number(m.baselineBrier, 4), signedPercent(1 - m.brier / m.baselineBrier), percent(m.averagePredicted), percent(m.observedRate)] : [name, 0, 'no data', '', '', '', ''])))),
    section('Calibration', 'When the model says 40%, does it happen about 40% of the time? Points on the diagonal are well calibrated. Bins with few matches are noisy.',
      chartBlock('Calibration: home win and over 2.5', {
        type: 'scatter',
        data: { datasets: [
          { label: 'Home win', data: report.calibration.home.map((b) => ({ x: b.predicted, y: b.observed })), backgroundColor: chartColors.home },
          { label: 'Over 2.5', data: report.calibration.over25.map((b) => ({ x: b.predicted, y: b.observed })), backgroundColor: chartColors.away },
          { label: 'Perfect', type: 'line', data: [{ x: 0, y: 0 }, { x: 1, y: 1 }], borderColor: chartColors.neutral, pointRadius: 0 }
        ] },
        options: { scales: { x: { min: 0, max: 1, title: { display: true, text: 'Predicted', color: chartColors.text } }, y: { min: 0, max: 1, title: { display: true, text: 'Observed', color: chartColors.text } } } }
      }, 'See the table below.'),
      table(['Predicted range', 'Matches', 'Home win predicted', 'Home win observed'], report.calibration.home.map((b) => [`${percent(b.from, 0)}–${percent(b.to, 0)}`, b.count, percent(b.predicted), percent(b.observed)]))),
    section('Simulated betting (flat 1 unit)', `A bet is placed when model EV against the earlier Bet365 price is at least the value threshold. Markets: 1X2 and over 2.5.`,
      definition([
        ['Bets', String(bet.bets)], ['Profit', `${number(bet.profit)} units`], ['ROI', percent(bet.roi)],
        ['95% bootstrap interval', `${percent(bet.roiInterval.low)} to ${percent(bet.roiInterval.high)}`],
        ['Hit rate', percent(bet.hitRate)], ['Average odds', decimalOdds(bet.averageOdds)],
        ['Maximum drawdown', `${number(bet.maxDrawdown)} units`],
        ['Closing-line value', `${signedPercent(bet.closingLineValue)} on ${bet.closingSample} bets (positive means prices taken beat the margin-free closing price)`]
      ]),
      bet.curve.length > 1 ? chartBlock('Cumulative profit (units)', { type: 'line', data: { labels: bet.curve.map((p) => kickoffText(p.date)), datasets: [{ label: 'Profit', data: bet.curve.map((p) => p.bankroll), borderColor: chartColors.warn, pointRadius: 0 }] } }, '') : ''));
}

function verdict(report) {
  const bet = report.betting;
  const beatsMarket = report.market.modelLogLoss < report.market.marketLogLoss;
  const profitableInterval = bet.roiInterval.low > 0;
  const lines = [
    beatsMarket ? 'The model predicted results better than Bet365 closing prices in this sample. Treat this with suspicion and test more seasons.' : 'Bet365 closing prices predicted results better than the model. That is normal: the market knows about injuries, transfers and news the model cannot see.',
    profitableInterval ? 'The ROI interval is above zero, but one league and two seasons are not enough to call the model profitable.' : 'The ROI interval includes zero or is below it: there is no evidence of a profitable edge.',
    bet.closingLineValue > 0 ? 'Prices taken beat the closing line on average, which is the best sign of genuine value.' : 'Prices taken did not beat the closing line on average, the most reliable sign that the "value" signals are mostly model error.'
  ];
  return list(lines, 'bullet-list verdict-list');
}
