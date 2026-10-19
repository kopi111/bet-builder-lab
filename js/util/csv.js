export function parseCsv(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((line) => line.trim() !== '');
  if (lines.length === 0) return [];
  const headers = splitCsvLine(lines[0]).map((header) => header.trim());
  return lines.slice(1).map((line) => toRecord(headers, splitCsvLine(line)));
}

function toRecord(headers, cells) {
  const record = {};
  headers.forEach((header, index) => {
    if (header) record[header] = (cells[index] ?? '').trim();
  });
  return record;
}

function splitCsvLine(line) {
  const cells = [];
  let current = '';
  let quoted = false;
  for (const character of line) {
    if (character === '"') quoted = !quoted;
    else if (character === ',' && !quoted) {
      cells.push(current);
      current = '';
    } else current += character;
  }
  cells.push(current);
  return cells;
}
