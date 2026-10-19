const ITERATIONS = 40;

export class RatingTable {
  constructor(baseHome, baseAway, teams) {
    this.baseHome = baseHome;
    this.baseAway = baseAway;
    this.teams = teams;
  }

  team(name) {
    return this.teams.get(name) || { for: 1, against: 1, weightedMatches: 0, matches: 0 };
  }

  expected(home, away) {
    const homeTeam = this.team(home);
    const awayTeam = this.team(away);
    return {
      home: this.baseHome * homeTeam.for * awayTeam.against,
      away: this.baseAway * awayTeam.for * homeTeam.against
    };
  }

  teamNames() {
    return [...this.teams.keys()].sort();
  }
}

export function fitRatingTable(observations, shrinkageMatches) {
  const baseHome = weightedMean(observations, (o) => o.homeValue);
  const baseAway = weightedMean(observations, (o) => o.awayValue);
  const teams = initialTeams(observations);
  const prior = shrinkageMatches * (baseHome + baseAway) / 2;
  for (let step = 0; step < ITERATIONS; step++) {
    updateFor(teams, observations, baseHome, baseAway, prior);
    updateAgainst(teams, observations, baseHome, baseAway, prior);
    normalise(teams);
  }
  return new RatingTable(baseHome, baseAway, teams);
}

function initialTeams(observations) {
  const teams = new Map();
  observations.forEach((o) => {
    [o.home, o.away].forEach((name) => {
      if (!teams.has(name)) teams.set(name, { for: 1, against: 1, weightedMatches: 0, matches: 0 });
      const team = teams.get(name);
      team.weightedMatches += o.weight;
      team.matches += 1;
    });
  });
  return teams;
}

function updateFor(teams, observations, baseHome, baseAway, prior) {
  const totals = accumulate(observations, (o) => [
    [o.home, o.homeValue, baseHome * teams.get(o.away).against],
    [o.away, o.awayValue, baseAway * teams.get(o.home).against]
  ]);
  totals.forEach((sum, name) => {
    teams.get(name).for = (sum.actual + prior) / (sum.expected + prior);
  });
}

function updateAgainst(teams, observations, baseHome, baseAway, prior) {
  const totals = accumulate(observations, (o) => [
    [o.home, o.awayValue, baseAway * teams.get(o.away).for],
    [o.away, o.homeValue, baseHome * teams.get(o.home).for]
  ]);
  totals.forEach((sum, name) => {
    teams.get(name).against = (sum.actual + prior) / (sum.expected + prior);
  });
}

function accumulate(observations, contributionsOf) {
  const totals = new Map();
  observations.forEach((o) => {
    contributionsOf(o).forEach(([name, actual, expected]) => {
      const sum = totals.get(name) || { actual: 0, expected: 0 };
      sum.actual += o.weight * actual;
      sum.expected += o.weight * expected;
      totals.set(name, sum);
    });
  });
  return totals;
}

function normalise(teams) {
  const count = teams.size || 1;
  let logFor = 0;
  let logAgainst = 0;
  teams.forEach((team) => {
    logFor += Math.log(team.for);
    logAgainst += Math.log(team.against);
  });
  const forScale = Math.exp(logFor / count);
  const againstScale = Math.exp(logAgainst / count);
  teams.forEach((team) => {
    team.for /= forScale;
    team.against /= againstScale;
  });
}

export function weightedMean(observations, valueOf) {
  let total = 0;
  let weight = 0;
  observations.forEach((o) => {
    total += o.weight * valueOf(o);
    weight += o.weight;
  });
  if (weight === 0) throw new Error('No observations to average');
  return total / weight;
}

export function estimateDispersion(observations, table) {
  let meanSquares = 0;
  let excessVariance = 0;
  observations.forEach((o) => {
    const expected = table.expected(o.home, o.away);
    [[o.homeValue, expected.home], [o.awayValue, expected.away]].forEach(([actual, mean]) => {
      meanSquares += o.weight * mean * mean;
      excessVariance += o.weight * ((actual - mean) ** 2 - mean);
    });
  });
  if (excessVariance <= 0) return Infinity;
  return Math.min(500, Math.max(1.5, meanSquares / excessVariance));
}
