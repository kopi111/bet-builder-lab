import { LeagueModel } from './leagueModel.js';
import { ScoreMatrix } from './scoreMatrix.js';
import { removeMargin } from './value.js';
import { negativeBinomialTable, probabilityAbove, seededRandom } from '../util/distributions.js';
import { DAY_MS } from '../util/time.js';

const REFIT_DAYS = 7;
const WARM_UP_MATCHES = 150;
const CALIBRATION_BINS = 10;
const BOOTSTRAP_SAMPLES = 1000;

export async function runBacktest(matches, settings, onProgress = () => {}) {
  const predictions = await walkForwardPredictions(matches, settings, onProgress);
  return summarise(predictions, settings);
}

export async function walkForwardPredictions(matches, settings, onProgress = () => {}) {
  const ordered = matches.filter((m) => m.played).sort((a, b) => a.kickoff - b.kickoff);
  if (ordered.length < WARM_UP_MATCHES + 50) throw new Error(`Backtest needs at least ${WARM_UP_MATCHES + 50} matches; only ${ordered.length} loaded`);
  return walkForward(ordered, settings, onProgress);
}

async function walkForward(ordered, settings, onProgress) {
  const predictions = [];
  let model;
  let fittedAt = 0;
  for (let index = WARM_UP_MATCHES; index < ordered.length; index++) {
    const match = ordered[index];
    if (!model || match.kickoff - fittedAt >= REFIT_DAYS * DAY_MS) {
      fittedAt = match.kickoff.getTime();
      model = LeagueModel.fit(ordered.slice(0, index), new Date(fittedAt), settings);
      onProgress(index / ordered.length);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    predictions.push(predictMatch(model, match, settings));
  }
  return predictions;
}

function predictMatch(model, match, settings) {
  const expected = model.goals.table.expected(match.home, match.away);
  const matrix = new ScoreMatrix(expected.home, expected.away, settings.dixonColesRho);
  const s = match.stats;
  return {
    match,
    expectedGoals: expected,
    probabilities: {
      home: matrix.sumWhere((h, a) => h > a),
      draw: matrix.sumWhere((h, a) => h === a),
      away: matrix.sumWhere((h, a) => h < a),
      over25: matrix.sumWhere((h, a) => h + a > 2.5),
      bothScore: matrix.sumWhere((h, a) => h > 0 && a > 0),
      ...countProbabilities(model, match)
    },
    outcome: {
      result: s.homeGoals > s.awayGoals ? 'home' : s.homeGoals === s.awayGoals ? 'draw' : 'away',
      over25: s.homeGoals + s.awayGoals > 2.5,
      bothScore: s.homeGoals > 0 && s.awayGoals > 0,
      corners: s.homeCorners + s.awayCorners,
      cards: s.homeYellow + s.awayYellow + s.homeRed + s.awayRed
    }
  };
}

function countProbabilities(model, match) {
  const result = {};
  [['corners', 9.5], ['cards', 3.5]].forEach(([name, line]) => {
    const fitted = model.counts[name];
    if (!fitted) return;
    const expected = fitted.table.expected(match.home, match.away);
    const total = expected.home + expected.away;
    const dispersion = fitted.dispersion * total * total / (expected.home ** 2 + expected.away ** 2);
    result[`${name}Over`] = probabilityAbove(negativeBinomialTable(total, dispersion, 60), line);
    result[`${name}Line`] = line;
  });
  return result;
}

function summarise(predictions, settings) {
  const withOdds = predictions.filter((p) => Number.isFinite(p.match.odds.closing.home) || Number.isFinite(p.match.odds.opening.home));
  return {
    sample: predictions.length,
    from: predictions[0].match.kickoff,
    to: predictions[predictions.length - 1].match.kickoff,
    result: resultMetrics(predictions),
    binary: {
      over25: binaryMetrics(predictions, (p) => p.probabilities.over25, (p) => p.outcome.over25),
      bothScore: binaryMetrics(predictions, (p) => p.probabilities.bothScore, (p) => p.outcome.bothScore),
      corners: binaryMetrics(predictions.filter((p) => Number.isFinite(p.probabilities.cornersOver) && Number.isFinite(p.outcome.corners)), (p) => p.probabilities.cornersOver, (p) => p.outcome.corners > 9.5),
      cards: binaryMetrics(predictions.filter((p) => Number.isFinite(p.probabilities.cardsOver) && Number.isFinite(p.outcome.cards)), (p) => p.probabilities.cardsOver, (p) => p.outcome.cards > 3.5)
    },
    calibration: {
      home: calibrationBins(predictions, (p) => p.probabilities.home, (p) => p.outcome.result === 'home'),
      over25: calibrationBins(predictions, (p) => p.probabilities.over25, (p) => p.outcome.over25)
    },
    market: marketComparison(withOdds),
    betting: simulateBets(withOdds, settings.valueThreshold),
    oddsSample: withOdds.length
  };
}

export function skillSummary(report) {
  const skillOf = (metric) => (metric.sample ? 1 - metric.brier / metric.baselineBrier : NaN);
  return {
    sample: report.sample,
    roi: report.betting.roi,
    bets: report.betting.bets,
    closingLineValue: report.betting.closingLineValue,
    skill: {
      result: 1 - report.result.logLoss / report.result.baseline,
      over25: skillOf(report.binary.over25),
      corners: skillOf(report.binary.corners),
      cards: skillOf(report.binary.cards)
    },
    ranAt: new Date().toISOString()
  };
}

function resultMetrics(predictions) {
  const outcomes = ['home', 'draw', 'away'];
  let logLoss = 0;
  let brier = 0;
  let correct = 0;
  predictions.forEach((p) => {
    const probabilities = outcomes.map((o) => p.probabilities[o]);
    const actual = outcomes.indexOf(p.outcome.result);
    logLoss -= Math.log(Math.max(1e-12, probabilities[actual]));
    brier += probabilities.reduce((sum, value, i) => sum + (value - (i === actual ? 1 : 0)) ** 2, 0);
    if (probabilities.indexOf(Math.max(...probabilities)) === actual) correct++;
  });
  const n = predictions.length;
  return { logLoss: logLoss / n, brier: brier / n, accuracy: correct / n, baseline: baseRateLogLoss(predictions) };
}

function baseRateLogLoss(predictions) {
  const counts = { home: 0, draw: 0, away: 0 };
  predictions.forEach((p) => counts[p.outcome.result]++);
  const n = predictions.length;
  return -Object.values(counts).reduce((sum, count) => sum + (count ? count * Math.log(count / n) : 0), 0) / n;
}

function binaryMetrics(predictions, probabilityOf, happened) {
  if (predictions.length === 0) return { sample: 0 };
  const hits = predictions.filter(happened).length;
  const baseRate = hits / predictions.length;
  let brier = 0;
  let baselineBrier = 0;
  predictions.forEach((p) => {
    const actual = happened(p) ? 1 : 0;
    brier += (probabilityOf(p) - actual) ** 2;
    baselineBrier += (baseRate - actual) ** 2;
  });
  const averagePredicted = predictions.reduce((sum, p) => sum + probabilityOf(p), 0) / predictions.length;
  return { sample: predictions.length, brier: brier / predictions.length, baselineBrier: baselineBrier / predictions.length, averagePredicted, observedRate: baseRate };
}

function calibrationBins(predictions, probabilityOf, happened) {
  const bins = Array.from({ length: CALIBRATION_BINS }, (_, i) => ({ from: i / CALIBRATION_BINS, to: (i + 1) / CALIBRATION_BINS, count: 0, predicted: 0, observed: 0 }));
  predictions.forEach((p) => {
    const probability = probabilityOf(p);
    const bin = bins[Math.min(CALIBRATION_BINS - 1, Math.floor(probability * CALIBRATION_BINS))];
    bin.count++;
    bin.predicted += probability;
    bin.observed += happened(p) ? 1 : 0;
  });
  return bins.filter((bin) => bin.count > 0).map((bin) => ({ ...bin, predicted: bin.predicted / bin.count, observed: bin.observed / bin.count }));
}

function marketComparison(predictions) {
  const priced = predictions.filter((p) => Number.isFinite(p.match.odds.closing.home));
  if (priced.length === 0) return { sample: 0 };
  let modelLoss = 0;
  let marketLoss = 0;
  priced.forEach((p) => {
    const closing = p.match.odds.closing;
    const fair = removeMargin([closing.home, closing.draw, closing.away]).fair;
    const index = ['home', 'draw', 'away'].indexOf(p.outcome.result);
    modelLoss -= Math.log(Math.max(1e-12, p.probabilities[p.outcome.result]));
    marketLoss -= Math.log(Math.max(1e-12, fair[index]));
  });
  return { sample: priced.length, modelLogLoss: modelLoss / priced.length, marketLogLoss: marketLoss / priced.length };
}

function simulateBets(predictions, threshold) {
  const bets = predictions.flatMap((p) => betsFor(p, threshold));
  let bankroll = 0;
  let peak = 0;
  let maxDrawdown = 0;
  const curve = bets.map((bet) => {
    bankroll += bet.profit;
    peak = Math.max(peak, bankroll);
    maxDrawdown = Math.max(maxDrawdown, peak - bankroll);
    return { date: bet.date, bankroll };
  });
  const withClosing = bets.filter((bet) => Number.isFinite(bet.closingValue));
  return {
    bets: bets.length,
    staked: bets.length,
    profit: bankroll,
    roi: bets.length ? bankroll / bets.length : NaN,
    hitRate: bets.length ? bets.filter((bet) => bet.profit > 0).length / bets.length : NaN,
    averageOdds: bets.length ? bets.reduce((sum, bet) => sum + bet.odds, 0) / bets.length : NaN,
    maxDrawdown,
    closingLineValue: withClosing.length ? withClosing.reduce((sum, bet) => sum + bet.closingValue, 0) / withClosing.length : NaN,
    closingSample: withClosing.length,
    roiInterval: bootstrapInterval(bets.map((bet) => bet.profit)),
    curve
  };
}

function betsFor(prediction, threshold) {
  const { opening, closing } = prediction.match.odds;
  const markets = [
    ['home', opening.home, closing.home, prediction.outcome.result === 'home', [closing.home, closing.draw, closing.away], 0],
    ['draw', opening.draw, closing.draw, prediction.outcome.result === 'draw', [closing.home, closing.draw, closing.away], 1],
    ['away', opening.away, closing.away, prediction.outcome.result === 'away', [closing.home, closing.draw, closing.away], 2],
    ['over25', opening.over25, closing.over25, prediction.outcome.over25, [closing.over25, closing.under25], 0]
  ];
  return markets
    .filter(([key, odds]) => Number.isFinite(odds) && prediction.probabilities[key] * odds - 1 >= threshold)
    .map(([key, odds, , won, closingSet, index]) => ({
      market: key,
      date: prediction.match.kickoff,
      odds,
      profit: won ? odds - 1 : -1,
      closingValue: odds * removeMargin(closingSet).fair[index] - 1
    }));
}

function bootstrapInterval(profits) {
  if (profits.length < 20) return { low: NaN, high: NaN };
  const random = seededRandom(20261019);
  const rois = Array.from({ length: BOOTSTRAP_SAMPLES }, () => {
    let total = 0;
    for (let i = 0; i < profits.length; i++) total += profits[Math.floor(random() * profits.length)];
    return total / profits.length;
  }).sort((a, b) => a - b);
  return { low: rois[Math.floor(BOOTSTRAP_SAMPLES * 0.025)], high: rois[Math.floor(BOOTSTRAP_SAMPLES * 0.975)] };
}
