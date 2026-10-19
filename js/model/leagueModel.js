import { DAY_MS } from '../util/time.js';
import { choleskyLower } from '../util/distributions.js';
import { estimateDispersion, fitRatingTable, weightedMean } from './ratingTable.js';

export const COUNT_STATS = {
  corners: { home: 'homeCorners', away: 'awayCorners', label: 'Corners' },
  cards: { home: 'homeCards', away: 'awayCards', label: 'Cards (yellow + red)' },
  shots: { home: 'homeShots', away: 'awayShots', label: 'Shots' },
  shotsOnTarget: { home: 'homeShotsOnTarget', away: 'awayShotsOnTarget', label: 'Shots on target' },
  fouls: { home: 'homeFouls', away: 'awayFouls', label: 'Fouls' }
};

const MINIMUM_COVERAGE = 0.6;
const REFEREE_SHRINKAGE = 8;

export class LeagueModel {
  static fit(matches, asOf, settings) {
    const history = matches.filter((match) => match.played && match.kickoff < asOf);
    if (history.length < 30) throw new Error(`Only ${history.length} completed matches before this date; at least 30 are needed`);
    return new LeagueModel(history, asOf, settings);
  }

  constructor(history, asOf, settings) {
    this.history = history;
    this.asOf = asOf;
    this.settings = settings;
    this.weights = history.map((match) => decayWeight(match, asOf, settings.halfLifeDays));
    this.goals = this.fitGoals();
    this.counts = this.fitCounts();
    this.halfShare = this.firstHalfShare();
    this.refereeCardFactors = this.fitRefereeFactors();
  }

  fitGoals() {
    const conversion = this.goalsPerShotOnTarget();
    const blend = Number.isFinite(conversion) ? this.settings.shotsOnTargetBlend : 0;
    const observations = this.observations((match) => match.stats.homeGoals, (match) => match.stats.awayGoals)
      .map((o) => blendWithShots(o, conversion, blend));
    return { table: fitRatingTable(observations, this.settings.shrinkageMatches), blend, conversion };
  }

  goalsPerShotOnTarget() {
    const withShots = this.history.filter((m) => Number.isFinite(m.stats.homeShotsOnTarget) && Number.isFinite(m.stats.awayShotsOnTarget));
    if (withShots.length < this.history.length * MINIMUM_COVERAGE) return NaN;
    const goals = withShots.reduce((sum, m) => sum + m.stats.homeGoals + m.stats.awayGoals, 0);
    const onTarget = withShots.reduce((sum, m) => sum + m.stats.homeShotsOnTarget + m.stats.awayShotsOnTarget, 0);
    return goals / onTarget;
  }

  fitCounts() {
    const counts = {};
    Object.entries(COUNT_STATS).forEach(([name, stat]) => {
      const observations = this.observations((m) => statValue(m, stat.home), (m) => statValue(m, stat.away));
      if (observations.length < this.history.length * MINIMUM_COVERAGE) return;
      const table = fitRatingTable(observations, this.settings.shrinkageMatches);
      counts[name] = { table, dispersion: estimateDispersion(observations, table), sample: observations.length };
    });
    return counts;
  }

  observations(homeValueOf, awayValueOf) {
    return this.history
      .map((match, index) => ({
        match, home: match.home, away: match.away, weight: this.weights[index],
        homeValue: homeValueOf(match), awayValue: awayValueOf(match)
      }))
      .filter((o) => Number.isFinite(o.homeValue) && Number.isFinite(o.awayValue));
  }

  firstHalfShare() {
    const withHalf = this.observations((m) => m.stats.homeHalfGoals, (m) => m.stats.awayHalfGoals);
    if (withHalf.length === 0) return { home: 0.45, away: 0.45, measured: false };
    const share = (half, full) => withHalf.reduce((s, o) => s + o.weight * half(o), 0) / withHalf.reduce((s, o) => s + o.weight * full(o), 0);
    return {
      home: share((o) => o.homeValue, (o) => o.match.stats.homeGoals),
      away: share((o) => o.awayValue, (o) => o.match.stats.awayGoals),
      measured: true
    };
  }

  fitRefereeFactors() {
    const cards = this.counts.cards;
    const factors = new Map();
    if (!cards) return factors;
    const totals = new Map();
    this.history.forEach((match, index) => {
      if (!match.referee || !Number.isFinite(statValue(match, 'homeCards'))) return;
      const expected = cards.table.expected(match.home, match.away);
      const sum = totals.get(match.referee) || { actual: 0, expected: 0, matches: 0 };
      sum.actual += this.weights[index] * (statValue(match, 'homeCards') + statValue(match, 'awayCards'));
      sum.expected += this.weights[index] * (expected.home + expected.away);
      sum.matches += 1;
      totals.set(match.referee, sum);
    });
    totals.forEach((sum, referee) => {
      const prior = REFEREE_SHRINKAGE * (sum.expected / Math.max(1, sum.matches));
      factors.set(referee, { factor: (sum.actual + prior) / (sum.expected + prior), matches: sum.matches });
    });
    return factors;
  }

  refereeFactor(referee) {
    return this.refereeCardFactors.get(referee) || { factor: 1, matches: 0 };
  }

  teamNames() {
    return this.goals.table.teamNames();
  }

  teamSample(team) {
    return this.goals.table.team(team);
  }

  lastMatchDate() {
    return this.history[this.history.length - 1].kickoff;
  }

  averageGoalsPerTeam() {
    return (this.goals.table.baseHome + this.goals.table.baseAway) / 2;
  }

  dependence() {
    if (!this.cachedDependence) this.cachedDependence = estimateDependence(this);
    return this.cachedDependence;
  }
}

function decayWeight(match, asOf, halfLifeDays) {
  const ageDays = (asOf - match.kickoff) / DAY_MS;
  return Math.pow(0.5, ageDays / halfLifeDays);
}

function blendWithShots(observation, conversion, blend) {
  if (blend === 0) return observation;
  const stats = observation.match.stats;
  if (!Number.isFinite(stats.homeShotsOnTarget) || !Number.isFinite(stats.awayShotsOnTarget)) return observation;
  return {
    ...observation,
    homeValue: (1 - blend) * observation.homeValue + blend * stats.homeShotsOnTarget * conversion,
    awayValue: (1 - blend) * observation.awayValue + blend * stats.awayShotsOnTarget * conversion
  };
}

export function statValue(match, field) {
  if (field === 'homeCards') return match.stats.homeYellow + match.stats.homeRed;
  if (field === 'awayCards') return match.stats.awayYellow + match.stats.awayRed;
  return match.stats[field];
}

function estimateDependence(model) {
  const variables = dependenceVariables(model);
  const rows = model.history
    .map((match) => variables.map((variable) => variable.residual(match)))
    .filter((row) => row.every(Number.isFinite));
  const correlation = shrunkCorrelation(rows, variables.length);
  correlation[0][1] = 0;
  correlation[1][0] = 0;
  return { variables: variables.map((v) => v.name), correlation, lower: positiveDefiniteLower(correlation), sample: rows.length };
}

function dependenceVariables(model) {
  const goalVariable = (name, side) => ({
    name,
    residual: (match) => standardise(match.stats[name], model.goals.table.expected(match.home, match.away)[side], Infinity)
  });
  const variables = [goalVariable('homeGoals', 'home'), goalVariable('awayGoals', 'away')];
  Object.entries(COUNT_STATS).forEach(([name, stat]) => {
    const fitted = model.counts[name];
    if (!fitted) return;
    ['home', 'away'].forEach((side) => variables.push({
      name: stat[side],
      residual: (match) => standardise(statValue(match, stat[side]), fitted.table.expected(match.home, match.away)[side], fitted.dispersion)
    }));
  });
  return variables;
}

function standardise(actual, mean, dispersion) {
  const variance = mean + (Number.isFinite(dispersion) ? mean * mean / dispersion : 0);
  return (actual - mean) / Math.sqrt(variance);
}

function shrunkCorrelation(rows, size) {
  const means = Array.from({ length: size }, (_, i) => rows.reduce((s, r) => s + r[i], 0) / rows.length);
  const matrix = Array.from({ length: size }, () => new Array(size).fill(0));
  for (let i = 0; i < size; i++) {
    for (let j = 0; j <= i; j++) {
      const value = pearson(rows, means, i, j);
      matrix[i][j] = i === j ? 1 : 0.85 * value;
      matrix[j][i] = matrix[i][j];
    }
  }
  return matrix;
}

function pearson(rows, means, i, j) {
  let covariance = 0;
  let varianceI = 0;
  let varianceJ = 0;
  rows.forEach((row) => {
    covariance += (row[i] - means[i]) * (row[j] - means[j]);
    varianceI += (row[i] - means[i]) ** 2;
    varianceJ += (row[j] - means[j]) ** 2;
  });
  return covariance / Math.sqrt(varianceI * varianceJ || 1);
}

function positiveDefiniteLower(correlation) {
  let scale = 1;
  while (scale > 0) {
    const scaled = correlation.map((row, i) => row.map((value, j) => (i === j ? 1 : value * scale)));
    try {
      return choleskyLower(scaled);
    } catch {
      scale -= 0.1;
    }
  }
  return choleskyLower(correlation.map((row, i) => row.map((_, j) => (i === j ? 1 : 0))));
}
