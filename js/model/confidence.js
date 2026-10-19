const FAMILY_RELIABILITY = {
  result: 1, goals: 1, score: 0.8, halves: 0.85, corners: 0.75, shots: 0.7, cards: 0.6, fouls: 0.55, player: 0.5
};

const FAMILY_NOTES = {
  result: 'Result markets come straight from the goal model, the best-tested part of the system.',
  goals: 'Goal totals come straight from the Poisson score matrix.',
  score: 'Exact scores are low-probability; small rating errors move them a lot.',
  halves: 'Half splits assume each goal falls in the first half at the league rate (no team-specific timing).',
  corners: 'Corners use a negative binomial with league-level dispersion; game state is only partly captured.',
  shots: 'Shot counts depend on the source\'s shot definitions and game state.',
  cards: 'Cards depend heavily on the referee and match tension; settlement rules differ by bookmaker.',
  fouls: 'Foul counts vary by referee and are weakly predictable.',
  player: 'Player markets depend on line-ups, minutes and role; per-90 rates are noisy.'
};

export function assessConfidence(model, family) {
  const reasons = [FAMILY_NOTES[family]];
  let score = FAMILY_RELIABILITY[family] ?? 0.5;
  score *= sampleFactor(model, reasons);
  if (family === 'cards') score *= refereeFactor(model, reasons);
  if (family === 'player') score *= lineupFactor(model, reasons);
  score *= backtestFactor(model, family, reasons);
  return { level: levelOf(score, model), score, reasons };
}

function sampleFactor(model, reasons) {
  const { home, away } = teamSamples(model);
  const smallest = Math.min(home.weightedMatches, away.weightedMatches);
  reasons.push(`Effective sample (time-weighted matches): ${model.fixture.home} ${home.weightedMatches.toFixed(1)}, ${model.fixture.away} ${away.weightedMatches.toFixed(1)}.`);
  return Math.min(1, 0.4 + smallest / 30);
}

function refereeFactor(model, reasons) {
  if (!model.fixture.referee) {
    reasons.push('Referee not published by the source, so no referee adjustment was applied.');
    return 0.85;
  }
  reasons.push(`Referee ${model.fixture.referee}: ${model.referee.matches} matches in the data, card factor ${model.referee.factor.toFixed(2)}.`);
  return model.referee.matches >= 8 ? 1 : 0.9;
}

function lineupFactor(model, reasons) {
  reasons.push(model.playerContext.message);
  return model.playerContext.lineupsConfirmed ? 1 : 0.7;
}

const BACKTEST_FAMILY = { result: 'result', goals: 'over25', corners: 'corners', cards: 'cards' };

function backtestFactor(model, family, reasons) {
  const skill = model.backtestSkill?.[BACKTEST_FAMILY[family]];
  if (!Number.isFinite(skill)) return 1;
  if (skill > 0) {
    reasons.push(`Last backtest in this league: ${(skill * 100).toFixed(1)}% better than the base rate for this market type.`);
    return 1;
  }
  reasons.push('Last backtest in this league: this market type was no better than simply using the league base rate.');
  return 0.6;
}

function levelOf(score, model) {
  const { home, away } = teamSamples(model);
  if (Math.min(home.matches, away.matches) < model.league.settings.minimumTeamMatches) return 'Insufficient';
  if (score >= 0.85) return 'High';
  if (score >= 0.6) return 'Medium';
  return score >= 0.35 ? 'Low' : 'Insufficient';
}

function teamSamples(model) {
  return { home: model.league.teamSample(model.fixture.home), away: model.league.teamSample(model.fixture.away) };
}

export function confidenceTone(level) {
  return { High: 'good', Medium: 'warn', Low: 'bad', Insufficient: 'bad' }[level] || 'neutral';
}
