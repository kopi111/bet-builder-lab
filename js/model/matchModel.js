import { ScoreMatrix } from './scoreMatrix.js';
import { Simulation } from './simulation.js';
import { COUNT_STATS } from './leagueModel.js';
import { hashString } from '../util/distributions.js';

const EXACT_VARIABLES = new Set(['homeGoals', 'awayGoals']);

export class MatchModel {
  constructor(league, fixture, playerContext) {
    this.league = league;
    this.fixture = fixture;
    this.playerContext = playerContext;
    this.expectedGoals = league.goals.table.expected(fixture.home, fixture.away);
    this.matrix = new ScoreMatrix(this.expectedGoals.home, this.expectedGoals.away, league.settings.dixonColesRho);
    this.referee = league.refereeFactor(fixture.referee);
    this.countMeans = this.expectedCounts();
  }

  expectedCounts() {
    const means = {};
    Object.keys(COUNT_STATS).forEach((name) => {
      const fitted = this.league.counts[name];
      if (!fitted) return;
      const expected = fitted.table.expected(this.fixture.home, this.fixture.away);
      const factor = name === 'cards' ? this.referee.factor : 1;
      means[name] = { home: expected.home * factor, away: expected.away * factor, dispersion: fitted.dispersion, sample: fitted.sample };
    });
    return means;
  }

  hasCountModel(name) {
    return Boolean(this.countMeans[name]);
  }

  simulation() {
    if (!this.cachedSimulation) {
      const seed = hashString(`${this.fixture.id}|${this.league.asOf.toISOString()}`);
      this.cachedSimulation = new Simulation(this, this.league.settings.simulations, seed);
    }
    return this.cachedSimulation;
  }

  probability(legs) {
    if (legs.length === 0) throw new Error('No selections to price');
    const missing = legs.find((leg) => !this.supports(leg));
    if (missing) return unavailable(`${missing.label(this.fixture)} cannot be modelled with the loaded data`);
    if (legs.every((leg) => leg.variables.every((v) => EXACT_VARIABLES.has(v)))) return this.exactProbability(legs);
    return this.simulation().probability(legs);
  }

  exactProbability(legs) {
    const value = this.matrix.sumWhere((homeGoals, awayGoals) => legs.every((leg) => leg.test({ homeGoals, awayGoals })));
    return { value, method: 'exact', standardError: 0, available: true, reason: '' };
  }

  supports(leg) {
    return leg.variables.every((variable) => this.simulation().canProduce(variable));
  }
}

export function unavailable(reason) {
  return { value: NaN, method: 'unavailable', standardError: NaN, available: false, reason };
}
