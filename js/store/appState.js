import { DEFAULT_SETTINGS } from '../config.js';
import { readStored, writeStored } from './storage.js';

const RECENT_LIMIT = 30;

export function loadSettings() {
  return { ...DEFAULT_SETTINGS, ...readStored('settings', {}) };
}

export function saveSettings(settings) {
  return writeStored('settings', settings);
}

export function savedMatches() {
  return readStored('savedMatches', []);
}

export function toggleSavedMatch(fixture) {
  const saved = savedMatches();
  const exists = saved.some((item) => item.id === fixture.id);
  const next = exists ? saved.filter((item) => item.id !== fixture.id) : [...saved, fixtureSummary(fixture)];
  writeStored('savedMatches', next);
  return !exists;
}

export function isMatchSaved(id) {
  return savedMatches().some((item) => item.id === id);
}

export function recentAnalyses() {
  return readStored('recentAnalyses', []);
}

export function recordAnalysis(analysis) {
  const entry = {
    ...fixtureSummary(analysis.fixture),
    analysedAt: new Date().toISOString(),
    verdict: analysis.assessment.verdict,
    tone: analysis.assessment.tone,
    topMarkets: analysis.suggestions.slice(0, 3).map((s) => ({ label: s.label, probability: s.probability, confidence: s.confidence.level })),
    potentialValue: analysis.valueSignals.filter((s) => s.verdict.kind === 'potential').map((s) => ({ label: s.label, expectedValue: s.comparison.expectedValue, odds: s.comparison.odds }))
  };
  const rest = recentAnalyses().filter((item) => item.id !== entry.id);
  writeStored('recentAnalyses', [entry, ...rest].slice(0, RECENT_LIMIT));
}

export function savedSlips() {
  return readStored('slips', []);
}

export function storeSlips(slips) {
  return writeStored('slips', slips);
}

export function backtestSummaries() {
  return readStored('backtests', {});
}

export function storeBacktestSummary(leagueCode, summary) {
  writeStored('backtests', { ...backtestSummaries(), [leagueCode]: summary });
}

export function draftSlip() {
  return readStored('draftSlip', { matchId: '', specs: [], odds: '', stake: '10' });
}

export function storeDraftSlip(draft) {
  writeStored('draftSlip', draft);
}

export function fixtureSummary(fixture) {
  return { id: fixture.id, league: fixture.league, home: fixture.home, away: fixture.away, kickoff: fixture.kickoff.toISOString() };
}
