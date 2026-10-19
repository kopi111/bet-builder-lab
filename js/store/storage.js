const PREFIX = 'bbl.';

export function readStored(key, fallback) {
  try {
    const text = window.localStorage.getItem(PREFIX + key);
    return text ? JSON.parse(text) : fallback;
  } catch {
    return fallback;
  }
}

export function writeStored(key, value) {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function removeStored(key) {
  try {
    window.localStorage.removeItem(PREFIX + key);
  } catch {
    /* storage unavailable: nothing to remove */
  }
}
