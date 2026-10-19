export function poissonTable(mean, maximum) {
  const table = new Float64Array(maximum + 1);
  table[0] = Math.exp(-mean);
  for (let k = 1; k <= maximum; k++) table[k] = table[k - 1] * mean / k;
  return table;
}

export function negativeBinomialTable(mean, dispersion, maximum) {
  if (!Number.isFinite(dispersion) || dispersion > 500) return poissonTable(mean, maximum);
  const table = new Float64Array(maximum + 1);
  const ratio = mean / (dispersion + mean);
  table[0] = Math.pow(dispersion / (dispersion + mean), dispersion);
  for (let k = 0; k < maximum; k++) table[k + 1] = table[k] * ((k + dispersion) / (k + 1)) * ratio;
  return table;
}

export function cumulative(table) {
  const totals = new Float64Array(table.length);
  let running = 0;
  for (let k = 0; k < table.length; k++) {
    running += table[k];
    totals[k] = running;
  }
  totals[totals.length - 1] = Math.max(totals[totals.length - 1], 1);
  return totals;
}

export function inverseCumulative(cumulativeTable, uniform) {
  let low = 0;
  let high = cumulativeTable.length - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (cumulativeTable[middle] < uniform) low = middle + 1;
    else high = middle;
  }
  return low;
}

export function probabilityAbove(table, line) {
  let total = 0;
  for (let k = Math.floor(line) + 1; k < table.length; k++) total += table[k];
  return total;
}

export function normalCdf(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const density = Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI);
  const tail = density * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z >= 0 ? 1 - tail : tail;
}

export function seededRandom(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

export function standardNormalPair(random) {
  const radius = Math.sqrt(-2 * Math.log(1 - random()));
  const angle = 2 * Math.PI * random();
  return [radius * Math.cos(angle), radius * Math.sin(angle)];
}

export function choleskyLower(matrix) {
  const size = matrix.length;
  const lower = matrix.map(() => new Array(size).fill(0));
  for (let row = 0; row < size; row++) {
    for (let column = 0; column <= row; column++) {
      let sum = matrix[row][column];
      for (let k = 0; k < column; k++) sum -= lower[row][k] * lower[column][k];
      if (row === column) {
        if (sum <= 1e-9) throw new Error('Correlation matrix is not positive definite');
        lower[row][column] = Math.sqrt(sum);
      } else lower[row][column] = sum / lower[column][column];
    }
  }
  return lower;
}

export function hashString(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return hash >>> 0;
}
