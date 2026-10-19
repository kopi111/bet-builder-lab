export function impliedProbability(decimalOdds) {
  return isValidOdds(decimalOdds) ? 1 / decimalOdds : NaN;
}

export function isValidOdds(decimalOdds) {
  return Number.isFinite(decimalOdds) && decimalOdds > 1;
}

export function expectedValue(probability, decimalOdds) {
  return isValidOdds(decimalOdds) && Number.isFinite(probability) ? probability * decimalOdds - 1 : NaN;
}

export function removeMargin(oddsList) {
  if (!oddsList.every(isValidOdds)) return { fair: oddsList.map(() => NaN), margin: NaN };
  const implied = oddsList.map((odds) => 1 / odds);
  const booksum = implied.reduce((sum, value) => sum + value, 0);
  return { fair: implied.map((value) => value / booksum), margin: booksum - 1 };
}

export function compareWithOdds(probability, decimalOdds, fairProbability = NaN) {
  const implied = impliedProbability(decimalOdds);
  return {
    probability,
    odds: decimalOdds,
    implied,
    fairImplied: fairProbability,
    difference: probability - (Number.isFinite(fairProbability) ? fairProbability : implied),
    expectedValue: expectedValue(probability, decimalOdds),
    fairOdds: probability > 0 ? 1 / probability : NaN
  };
}

export function asianHandicapSettlement(matrix, homeLine) {
  const quarterLines = splitQuarterLine(homeLine);
  const result = { win: 0, push: 0, lose: 0 };
  matrix.forEachScore((home, away, probability) => {
    quarterLines.forEach((line) => {
      const margin = home - away + line;
      const share = probability / quarterLines.length;
      if (Math.abs(margin) < 1e-9) result.push += share;
      else if (margin > 0) result.win += share;
      else result.lose += share;
    });
  });
  return result;
}

export function asianHandicapExpectedValue(settlement, decimalOdds) {
  if (!isValidOdds(decimalOdds)) return NaN;
  return settlement.win * (decimalOdds - 1) - settlement.lose;
}

function splitQuarterLine(line) {
  const quarter = Math.round(line * 4) % 2 !== 0;
  return quarter ? [line - 0.25, line + 0.25] : [line];
}

export function bettingReturn(stake, decimalOdds) {
  const returns = stake * decimalOdds;
  return { returns, profit: returns - stake };
}
