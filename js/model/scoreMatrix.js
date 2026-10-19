import { cumulative, poissonTable } from '../util/distributions.js';

const MAX_GOALS = 10;

export class ScoreMatrix {
  constructor(homeMean, awayMean, rho) {
    this.homeMean = homeMean;
    this.awayMean = awayMean;
    this.size = MAX_GOALS + 1;
    this.cells = buildCells(homeMean, awayMean, rho, this.size);
  }

  probabilityOf(home, away) {
    return this.cells[home * this.size + away];
  }

  sumWhere(predicate) {
    let total = 0;
    this.forEachScore((home, away, probability) => {
      if (predicate(home, away)) total += probability;
    });
    return total;
  }

  forEachScore(visit) {
    for (let home = 0; home < this.size; home++) {
      for (let away = 0; away < this.size; away++) visit(home, away, this.probabilityOf(home, away));
    }
  }

  homeMarginal() {
    return Float64Array.from({ length: this.size }, (_, home) => this.sumWhere((h) => h === home));
  }

  awayMarginal() {
    return Float64Array.from({ length: this.size }, (_, away) => this.sumWhere((h, a) => a === away));
  }

  conditionalAwayCumulative() {
    return Array.from({ length: this.size }, (_, home) => {
      const row = Float64Array.from({ length: this.size }, (_, away) => this.probabilityOf(home, away));
      const rowTotal = row.reduce((sum, value) => sum + value, 0) || 1;
      return cumulative(row.map((value) => value / rowTotal));
    });
  }

  mostLikelyScores(count) {
    const scores = [];
    this.forEachScore((home, away, probability) => scores.push({ home, away, probability }));
    return scores.sort((a, b) => b.probability - a.probability).slice(0, count);
  }
}

function buildCells(homeMean, awayMean, rho, size) {
  const homeTable = poissonTable(homeMean, size - 1);
  const awayTable = poissonTable(awayMean, size - 1);
  const cells = new Float64Array(size * size);
  let total = 0;
  for (let home = 0; home < size; home++) {
    for (let away = 0; away < size; away++) {
      const value = homeTable[home] * awayTable[away] * lowScoreAdjustment(home, away, homeMean, awayMean, rho);
      cells[home * size + away] = Math.max(0, value);
      total += cells[home * size + away];
    }
  }
  return cells.map((value) => value / total);
}

function lowScoreAdjustment(home, away, homeMean, awayMean, rho) {
  if (home === 0 && away === 0) return 1 - homeMean * awayMean * rho;
  if (home === 0 && away === 1) return 1 + homeMean * rho;
  if (home === 1 && away === 0) return 1 + awayMean * rho;
  if (home === 1 && away === 1) return 1 - rho;
  return 1;
}
