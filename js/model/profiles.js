import { buildMarketTables, priceLeg } from './markets.js';
import { priceCombination } from './combination.js';

const BUILDER_TABLES = new Set(['result', 'goals', 'team-goals', 'halves', 'corners', 'cards', 'shots']);

const PROFILE_RULES = {
  conservative: {
    title: 'A · Conservative', legs: 2, minimum: 0.7, maximum: 0.93,
    intent: 'Two lower-variance selections with the strongest support, from different market families.'
  },
  balanced: {
    title: 'B · Balanced', legs: 3, minimum: 0.55, maximum: 0.9,
    intent: 'One match scenario plus selections that the model says move with it rather than against it.'
  },
  higherVariance: {
    title: 'C · Higher variance', legs: 4, minimum: 0.35, maximum: 0.85,
    intent: 'A specific outcome plus supporting legs. Much less likely to land; shown to explore, not to recommend.'
  }
};

export function buildProfiles(model) {
  const candidates = candidatePool(model);
  return [
    finishProfile(model, 'conservative', pickConservative(candidates)),
    finishProfile(model, 'balanced', pickBalanced(model, candidates)),
    finishProfile(model, 'higherVariance', pickHigherVariance(model, candidates))
  ];
}

function candidatePool(model) {
  return buildMarketTables(model)
    .filter((table) => BUILDER_TABLES.has(table.id))
    .flatMap((table) => table.rows)
    .filter((row) => row.estimate.available && row.confidence.level !== 'Insufficient')
    .map((row) => ({ ...row, evidence: row.probability * row.confidence.score }))
    .sort((a, b) => b.evidence - a.evidence);
}

function within(candidates, rule) {
  return candidates.filter((c) => c.probability >= rule.minimum && c.probability <= rule.maximum);
}

function pickConservative(candidates) {
  return distinctFamilies(within(candidates, PROFILE_RULES.conservative), PROFILE_RULES.conservative.legs);
}

function pickBalanced(model, candidates) {
  const pool = within(candidates, PROFILE_RULES.balanced);
  const scenario = pool.find((c) => c.leg.family === 'result' || c.spec.type === 'totalGoals');
  if (!scenario) return [];
  const coherent = pool
    .filter((c) => c.leg.family !== scenario.leg.family && c.spec.type !== scenario.spec.type)
    .map((c) => ({ ...c, lift: lift(model, scenario, c) }))
    .filter((c) => c.lift >= 1)
    .sort((a, b) => b.evidence * b.lift - a.evidence * a.lift);
  return [scenario, ...distinctFamilies(coherent, PROFILE_RULES.balanced.legs - 1)];
}

function pickHigherVariance(model, candidates) {
  const specific = candidates
    .filter((c) => ['resultAndBtts', 'winningMargin', 'teamGoals', 'winToNil'].includes(c.spec.type))
    .filter((c) => c.probability >= 0.2 && c.probability <= 0.5)
    .sort((a, b) => b.evidence - a.evidence)[0];
  if (!specific) return [];
  const supporting = within(candidates, PROFILE_RULES.higherVariance)
    .filter((c) => c.leg.family !== 'result' && c.leg.family !== 'goals')
    .map((c) => ({ ...c, lift: lift(model, specific, c) }))
    .sort((a, b) => b.evidence * b.lift - a.evidence * a.lift);
  const legs = [specific, ...distinctFamilies(supporting, PROFILE_RULES.higherVariance.legs - 2)];
  const scorer = topScorerLeg(model, specific);
  return scorer ? [...legs, scorer] : distinctFamilies([...legs, ...supporting], PROFILE_RULES.higherVariance.legs);
}

function topScorerLeg(model, scenario) {
  const side = scenario.spec.side === 'away' ? 'away' : 'home';
  const shooter = model.playerContext.players
    .filter((p) => p.side === side && p.status !== 'out' && Number.isFinite(p.per90.goals))
    .sort((a, b) => b.per90.goals * b.startProbability - a.per90.goals * a.startProbability)[0];
  if (!shooter) return undefined;
  return priceLeg(model, { type: 'playerAnytimeGoal', playerId: shooter.id, name: shooter.name, side });
}

function lift(model, scenario, candidate) {
  const together = model.probability([scenario.leg, candidate.leg]).value;
  return together / (scenario.probability * candidate.probability);
}

function distinctFamilies(pool, count) {
  const chosen = [];
  pool.forEach((candidate) => {
    if (chosen.length >= count) return;
    if (chosen.some((c) => c.leg.family === candidate.leg.family || c.spec.type === candidate.spec.type)) return;
    chosen.push(candidate);
  });
  return chosen;
}

function finishProfile(model, key, picks) {
  const rule = PROFILE_RULES[key];
  if (picks.length < 2) return { key, title: rule.title, intent: rule.intent, empty: true, reason: emptyReason(rule) };
  const pricing = priceCombination(model, picks.map((pick) => pick.spec));
  return {
    key, title: rule.title, intent: rule.intent, empty: false,
    specs: picks.map((pick) => pick.spec),
    evidence: picks.map(evidenceText),
    pricing,
    risks: risksOf(model, pricing),
    missing: missingInformation(model, picks)
  };
}

function emptyReason(rule) {
  return `Not enough selections met this profile's evidence rules (probability ${Math.round(rule.minimum * 100)}–${Math.round(rule.maximum * 100)}%, confidence above "Insufficient", different market families). No combination is forced.`;
}

function evidenceText(pick) {
  return `${pick.label}: model ${(pick.probability * 100).toFixed(1)}%, confidence ${pick.confidence.level}. ${pick.confidence.reasons[0]}`;
}

function risksOf(model, pricing) {
  const risks = [];
  const weakest = pricing.weakestLeg;
  risks.push(`Weakest leg: ${weakest.label}, which fails in about ${((1 - weakest.estimate.value) * 100).toFixed(0)}% of modelled matches.`);
  pricing.conflicts.forEach((conflict) => risks.push(`"${conflict.first}" and "${conflict.second}" pull against each other (together ${(conflict.ratio * 100).toFixed(0)}% as often as if independent).`));
  if (pricing.legs.some((single) => single.leg.family === 'result')) risks.push('An early goal or red card changes game state: favourites protect leads and corner/shot counts shift.');
  if (pricing.legs.some((single) => single.leg.family === 'cards')) risks.push('Card counts swing with the referee and match importance; Bet365 settlement may count cards differently from the source.');
  if (pricing.legs.some((single) => single.leg.family === 'corners')) risks.push('Corners have high match-to-match variance even when the average is right.');
  risks.push('The model only knows league matches in the loaded seasons: transfers, injuries and manager changes since then are invisible to it.');
  return risks;
}

function missingInformation(model, picks) {
  const missing = [];
  if (model.playerContext.players.length === 0) missing.push(`Line-ups and injuries not checked: ${model.playerContext.message}.`);
  else if (!model.playerContext.lineupsConfirmed) missing.push('Line-ups are not confirmed yet.');
  if (!model.fixture.referee) missing.push('Referee not known.');
  missing.push('True xG is not in the free data source; shots on target are used as a partial proxy.');
  missing.push('Cup and European matches are not in the data, so rest days and fatigue may be understated.');
  if (picks.length) missing.push('Bet365 Bet Builder prices are not available from any feed: enter the combined price shown in the app to assess value.');
  return missing;
}
