import { h, table } from '../util/dom.js';
import { section, probabilityBar } from './components.js';

const PREDICTIONS_URL = 'ml/output/predictions.json';
const REPORT_URL = 'ml/output/report.json';
let files = null;

function loadFiles() {
  if (!files) {
    files = Promise.all([PREDICTIONS_URL, REPORT_URL].map(async (url) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${url} missing. Run: ml/.venv/bin/python ml/train_football.py`);
      return response.json();
    }));
    files.catch(() => { files = null; });
  }
  return files;
}

function sameDay(left, right) {
  return left.toISOString().slice(0, 10) === right;
}

function findPrediction(predictions, fixture) {
  return predictions.fixtures.find((entry) => entry.league === fixture.league && entry.home === fixture.home &&
    entry.away === fixture.away && sameDay(fixture.kickoff, entry.date));
}

function probabilityRow(label, values) {
  return [label, ...values.map((value) => (Number.isFinite(value) ? probabilityBar(value) : '—'))];
}

function predictionTable(prediction) {
  const rows = [probabilityRow('Trained model: stats only', [...prediction.stats.result, prediction.stats.over25])];
  if (prediction.stats_market) rows.push(probabilityRow('Trained model: stats + opening odds', [...prediction.stats_market.result, prediction.stats_market.over25]));
  if (prediction.bookmaker) rows.push(probabilityRow('Bet365 opening odds (margin removed)', [...prediction.bookmaker.result, prediction.bookmaker.over25]));
  return table(['Source', 'Home win', 'Draw', 'Away win', 'Over 2.5'], rows);
}

function testTable(report) {
  const row = (market, label) => {
    const summary = report.summary[market];
    const betting = summary.stats_betting;
    return [label, summary.stats_log_loss.toFixed(4), summary.bookmaker_close_log_loss.toFixed(4),
      `${betting.bets}`, `${(betting.roi_at_open * 100).toFixed(1)}%`, `${(betting.closing_line_value * 100).toFixed(1)}%`];
  };
  return table(['Market', 'Model log loss', 'Bet365 closing log loss', 'Value bets', 'ROI', 'Closing line value'],
    [row('result', 'Match result'), row('over25', 'Over/under 2.5')]);
}

function body(prediction, report) {
  const notes = [h('p', { class: 'muted small' }, `Lower log loss is better. Tested on ${report.seasons.length} seasons the model never saw, ` +
    `${report.summary.result.matches} matches. Trained ${report.trained_at.slice(0, 10)}.`), h('p', {}, report.verdict)];
  if (!prediction) return [h('p', {}, 'No trained-model prediction for this match (it is not in this week\'s fixtures file).'), testTable(report), ...notes];
  const warning = prediction.established ? '' : h('p', { class: 'muted' }, 'One of these teams has played fewer than 3 league matches: treat the numbers as rough.');
  return [predictionTable(prediction), warning, testTable(report), ...notes];
}

/** Section showing the model trained by ml/train_football.py next to the bookmaker's view. */
export function mlSection(fixture) {
  const holder = h('div', {}, h('p', { class: 'muted' }, 'Loading the trained model…'));
  loadFiles()
    .then(([predictions, report]) => holder.replaceChildren(...body(findPrediction(predictions, fixture), report)))
    .catch((error) => holder.replaceChildren(h('p', { class: 'muted' }, error.message)));
  return section('Trained model (machine learning)',
    'Gradient-boosted trees trained on 10 seasons of 21 leagues: form, shots, corners, Elo ratings and rest days before each match.', holder);
}
