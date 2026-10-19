const entries = new Map();
const listeners = new Set();

export function recordSourceSuccess(key, details) {
  entries.set(key, { key, ok: true, error: '', ...details });
  notify();
}

export function recordSourceFailure(key, details) {
  entries.set(key, { key, ok: false, rows: 0, ...details });
  notify();
}

export function sourceEntries() {
  return [...entries.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export function onSourceChange(listener) {
  listeners.add(listener);
}

function notify() {
  listeners.forEach((listener) => listener());
}
