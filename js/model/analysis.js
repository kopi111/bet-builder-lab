import { leagueByCode } from '../config.js';
import { LeagueModel } from './leagueModel.js';
import { MatchModel } from './matchModel.js';
import { buildMarketTables } from './markets.js';
import { buildProfiles } from './profiles.js';
import { FORM_WINDOWS, formSummary, headToHead, matchesInLastDays, opponentStrength, restDays, teamMatchesBefore } from './teamForm.js';

const LARGE_DISAGREEMENT = 0.1;
const MINIMUM_SIGNAL_CONFIDENCE = new Set(['High', 'Medium']);

export function analyseMatch(history, fixture, playerContext, settings, backtestSummary) {
  const league = LeagueModel.fit(history.matches, fixture.kickoff, settings);
  const model = new MatchModel(league, fixture, playerContext);
  model.backtestSkill = backtestSummary?.skill || {};
  const tables = buildMarketTables(model);
  const valueSignals = findValueSignals(tables, settings.valueThreshold);
  const analysis = {
    fixture, model, league, tables, valueSignals,
    dataFetchedAt: history.fetchedAt,
    lastResultDate: league.lastMatchDate(),
    teams: { home: teamProfile(history.matches, fixture.home, fixture.kickoff, 'home', league), away: teamProfile(history.matches, fixture.away, fixture.kickoff, 'away', league) },
    headToHead: headToHead(history.matches, fixture.home, fixture.away, fixture.kickoff),
    profiles: buildProfiles(model),
    suggestions: strongestSupported(tables),
    backtestSummary
  };
  analysis.weaknesses = weaknessesOf(analysis);
  analysis.assessment = finalAssessment(analysis);
  return analysis;
}

function teamProfile(matches, team, asOf, venue, league) {
  const teamMatches = teamMatchesBefore(matches, team, asOf);
  const windows = Object.fromEntries(FORM_WINDOWS.map((count) => [count, formSummary(teamMatches, team, 'all', count)]));
  return {
    name: team,
    windows,
    venueForm: formSummary(teamMatches, team, venue, 10),
    rating: league.goals.table.team(team),
    opponentStrength: opponentStrength(windows[10].rows, league.goals.table),
    restDays: restDays(teamMatches, asOf),
    matchesLast21Days: matchesInLastDays(teamMatches, asOf, 21),
    totalMatches: teamMatches.length
  };
}

function findValueSignals(tables, threshold) {
  return tables.flatMap((table) => table.rows)
    .filter((row) => Number.isFinite(row.comparison.odds))
    .map((row) => ({ ...row, verdict: signalVerdict(row, threshold) }));
}

function signalVerdict(row, threshold) {
  const c = row.comparison;
  const gap = Number.isFinite(c.fairImplied) ? c.probability - c.fairImplied : c.probability - c.implied;
  if (c.expectedValue < threshold) return { kind: 'none', text: 'No value at this price by the model.' };
  if (Math.abs(gap) > LARGE_DISAGREEMENT) {
    return { kind: 'disagreement', text: `Model is ${(gap * 100).toFixed(0)} points away from the bookmaker's margin-free price. Gaps this big usually mean the model is missing information (injuries, transfers, form) rather than the market being wrong.` };
  }
  if (!MINIMUM_SIGNAL_CONFIDENCE.has(row.confidence.level)) return { kind: 'weak', text: 'Positive estimate, but data confidence is too low to act on.' };
  return { kind: 'potential', text: `Estimated EV ${(c.expectedValue * 100).toFixed(1)}% per unit at ${c.odds}. Worth investigating, not a guarantee.` };
}

function strongestSupported(tables) {
  return tables.filter((table) => table.id !== 'scores')
    .flatMap((table) => table.rows)
    .filter((row) => row.estimate.available && row.probability >= 0.55 && row.probability <= 0.93)
    .map((row) => ({ ...row, evidence: row.probability * row.confidence.score }))
    .sort((a, b) => b.evidence - a.evidence)
    .slice(0, 8);
}

function weaknessesOf(analysis) {
  const { model, teams, headToHead: h2h } = analysis;
  const pooled = leagueByCode(analysis.fixture.league).pooled;
  const weaknesses = pooled ? pooledWeaknesses(analysis) : [];
  ['home', 'away'].forEach((side) => {
    const team = teams[side];
    if (team.totalMatches < 10) weaknesses.push(pooled
      ? `${team.name} has only ${team.totalMatches} matches in the data (its domestic league is not covered), so its rating leans on the average of the pooled leagues.`
      : `${team.name} has only ${team.totalMatches} league matches in the loaded data (promoted or new to this division?), so its ratings lean on the league average.`);
  });
  if (h2h.count < 3) weaknesses.push(`Only ${h2h.count} head-to-head meetings in the data: head-to-head trends are not used by the model and are shown for context only.`);
  if (model.league.goals.blend === 0) weaknesses.push('Shots on target are missing for this league, so goals alone drive the ratings.');
  if (!model.league.halfShare.measured) weaknesses.push('No half-time scores in the data: first-half markets use a default 45% share.');
  if (model.playerContext.players.length === 0) weaknesses.push('No player data: line-ups, injuries and suspensions are unchecked, and player markets are unavailable.');
  if (pooled) weaknesses.push('There are no historical Champions League odds in the free data, so this competition cannot be back-tested.');
  else if (!analysis.backtestSummary) weaknesses.push('This league has not been back-tested in this browser yet: run the Backtest page to see how well-calibrated the model has been.');
  else if (!(analysis.backtestSummary.roi > 0)) weaknesses.push(`The last walk-forward backtest for this league showed ROI ${(analysis.backtestSummary.roi * 100).toFixed(1)}% over ${analysis.backtestSummary.bets} simulated bets: no proven edge.`);
  weaknesses.push('Team strength comes from results in the loaded league seasons only; it does not know about squad changes or why results happened.');
  return weaknesses;
}

function pooledWeaknesses(analysis) {
  const { homeLeague, awayLeague } = analysis.fixture;
  const notes = ['Champions League ratings pool the covered top divisions with European results. How strong each league is comes only from the European matches in the data, so cross-league estimates are rough.'];
  if (homeLeague && awayLeague && homeLeague !== awayLeague) notes.push('Corners, cards, shots and fouls are rated within each domestic league and are not adjusted for league strength, so treat those markets as rough for clubs from different leagues.');
  return notes;
}

function finalAssessment(analysis) {
  const goalsConfidence = analysis.tables[0].rows[0].confidence;
  if (goalsConfidence.level === 'Insufficient') {
    return { verdict: 'Insufficient evidence', tone: 'bad', reason: `At least one team has fewer than ${analysis.league.settings.minimumTeamMatches} league matches in the data, so no market is assessed.` };
  }
  const potential = analysis.valueSignals.filter((signal) => signal.verdict.kind === 'potential');
  if (potential.length > 0) {
    return { verdict: 'Potential value to investigate further', tone: 'warn', reason: `${potential.map((s) => s.label).join(', ')}: the model's estimate beats the Bet365 price by more than the ${(analysis.league.settings.valueThreshold * 100).toFixed(0)}% threshold with at least medium confidence. Check team news before acting; a positive estimate is not a guaranteed profit.${backtestCaveat(analysis.backtestSummary)}` };
  }
  if (analysis.valueSignals.length === 0) {
    return { verdict: 'No clear value', tone: 'neutral', reason: 'No bookmaker prices were supplied for this match, so value cannot be assessed. Enter real prices in the Bet Builder slip to compare.' };
  }
  return { verdict: 'No clear value', tone: 'neutral', reason: 'None of the Bet365 prices in the data clears the value threshold with acceptable confidence and a believable gap to the market.' };
}

function backtestCaveat(summary) {
  if (!summary) return ' This league has not been back-tested yet.';
  return summary.roi > 0 && summary.closingLineValue > 0 ? '' : ` Caution: the last backtest here found no edge (ROI ${(summary.roi * 100).toFixed(1)}%, closing-line value ${(summary.closingLineValue * 100).toFixed(1)}%).`;
}
