import { createLeg } from './legs.js';
import { assessConfidence } from './confidence.js';
import { compareWithOdds } from './value.js';

const NEGATIVE_DEPENDENCE = 0.95;

export function priceCombination(model, specs, combinedOdds = NaN) {
  const legs = specs.map(createLeg);
  const singles = legs.map((leg) => ({ leg, label: leg.label(model.fixture), estimate: model.probability([leg]), confidence: assessConfidence(model, leg.family) }));
  const joint = legs.length ? model.probability(legs) : { value: NaN, method: 'unavailable', available: false, reason: 'No selections' };
  const independent = singles.reduce((product, single) => product * single.estimate.value, 1);
  return {
    legs: singles,
    joint,
    independentProduct: independent,
    dependenceRatio: joint.value / independent,
    comparison: compareWithOdds(joint.value, combinedOdds),
    conflicts: conflictingPairs(model, legs),
    weakestLeg: singles.reduce((weakest, single) => (single.estimate.value < weakest.estimate.value ? single : weakest), singles[0])
  };
}

function conflictingPairs(model, legs) {
  const conflicts = [];
  for (let i = 0; i < legs.length; i++) {
    for (let j = i + 1; j < legs.length; j++) {
      const together = model.probability([legs[i], legs[j]]).value;
      const apart = model.probability([legs[i]]).value * model.probability([legs[j]]).value;
      if (together / apart < NEGATIVE_DEPENDENCE) conflicts.push({ first: legs[i].label(model.fixture), second: legs[j].label(model.fixture), ratio: together / apart });
    }
  }
  return conflicts;
}
