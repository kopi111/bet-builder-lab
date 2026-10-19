import { COUNT_STATS } from './leagueModel.js';
import {
  cumulative, inverseCumulative, negativeBinomialTable, normalCdf, seededRandom, standardNormalPair
} from '../util/distributions.js';

const COUNT_CEILING = { corners: 30, cards: 16, shots: 45, shotsOnTarget: 25, fouls: 40 };

export class Simulation {
  constructor(model, size, seed) {
    this.model = model;
    this.size = size;
    this.random = seededRandom(seed);
    this.columns = new Map();
    this.run();
  }

  canProduce(variable) {
    if (this.columns.has(variable)) return true;
    return this.model.playerContext.canProduce(variable);
  }

  column(variable) {
    if (!this.columns.has(variable)) this.columns.set(variable, this.model.playerContext.simulateColumn(variable, this));
    return this.columns.get(variable);
  }

  probability(legs) {
    const variables = [...new Set(legs.flatMap((leg) => leg.variables))];
    const columns = variables.map((variable) => this.column(variable));
    const outcome = {};
    let hits = 0;
    for (let i = 0; i < this.size; i++) {
      variables.forEach((variable, index) => {
        outcome[variable] = columns[index][i];
      });
      if (legs.every((leg) => leg.test(outcome))) hits++;
    }
    const value = hits / this.size;
    return { value, method: 'simulation', standardError: Math.sqrt(value * (1 - value) / this.size), available: true, reason: '' };
  }

  run() {
    const { variables, lower } = this.model.league.dependence();
    const samplers = variables.map((name) => this.samplerFor(name));
    const outputs = variables.map(() => new Int16Array(this.size));
    const uniforms = new Float64Array(variables.length);
    for (let i = 0; i < this.size; i++) {
      this.correlatedUniforms(lower, uniforms);
      let homeGoals = 0;
      samplers.forEach((sampler, k) => {
        outputs[k][i] = sampler(uniforms[k], homeGoals);
        if (k === 0) homeGoals = outputs[k][i];
      });
    }
    variables.forEach((name, k) => this.columns.set(name, outputs[k]));
    this.deriveHalves();
    this.enforceShotConsistency();
    this.deriveSaves();
  }

  correlatedUniforms(lower, uniforms) {
    const size = uniforms.length;
    const normals = new Float64Array(size + 1);
    for (let k = 0; k < size; k += 2) {
      const [first, second] = standardNormalPair(this.random);
      normals[k] = first;
      normals[k + 1] = second;
    }
    for (let row = 0; row < size; row++) {
      let z = 0;
      for (let column = 0; column <= row; column++) z += lower[row][column] * normals[column];
      uniforms[row] = Math.min(1 - 1e-12, Math.max(1e-12, normalCdf(z)));
    }
  }

  samplerFor(name) {
    if (name === 'homeGoals') {
      const homeCumulative = cumulative(this.model.matrix.homeMarginal());
      return (uniform) => inverseCumulative(homeCumulative, uniform);
    }
    if (name === 'awayGoals') {
      const conditional = this.model.matrix.conditionalAwayCumulative();
      return (uniform, homeGoals) => inverseCumulative(conditional[homeGoals], uniform);
    }
    return this.countSampler(name);
  }

  countSampler(name) {
    const [statName, stat] = Object.entries(COUNT_STATS).find(([, s]) => s.home === name || s.away === name);
    const means = this.model.countMeans[statName];
    const mean = stat.home === name ? means.home : means.away;
    const table = cumulative(negativeBinomialTable(mean, means.dispersion, COUNT_CEILING[statName]));
    return (uniform) => inverseCumulative(table, uniform);
  }

  deriveHalves() {
    const share = this.model.league.halfShare;
    [['home', share.home], ['away', share.away]].forEach(([side, probability]) => {
      const full = this.columns.get(`${side}Goals`);
      const firstHalf = new Int16Array(this.size);
      const secondHalf = new Int16Array(this.size);
      for (let i = 0; i < this.size; i++) {
        firstHalf[i] = binomial(full[i], probability, this.random);
        secondHalf[i] = full[i] - firstHalf[i];
      }
      this.columns.set(`${side}HalfGoals`, firstHalf);
      this.columns.set(`${side}SecondHalfGoals`, secondHalf);
    });
  }

  enforceShotConsistency() {
    ['home', 'away'].forEach((side) => {
      const goals = this.columns.get(`${side}Goals`);
      const onTarget = this.columns.get(`${side}ShotsOnTarget`);
      const shots = this.columns.get(`${side}Shots`);
      for (let i = 0; i < this.size; i++) {
        if (onTarget && onTarget[i] < goals[i]) onTarget[i] = goals[i];
        if (shots && onTarget && shots[i] < onTarget[i]) shots[i] = onTarget[i];
      }
    });
  }

  deriveSaves() {
    if (!this.columns.has('homeShotsOnTarget') || !this.columns.has('awayShotsOnTarget')) return;
    [['home', 'away'], ['away', 'home']].forEach(([side, opponent]) => {
      const opponentOnTarget = this.columns.get(`${opponent}ShotsOnTarget`);
      const conceded = this.columns.get(`${opponent}Goals`);
      this.columns.set(`${side}Saves`, opponentOnTarget.map((shots, i) => Math.max(0, shots - conceded[i])));
    });
  }
}

export function binomial(trials, probability, random) {
  let successes = 0;
  for (let t = 0; t < trials; t++) if (random() < probability) successes++;
  return successes;
}
