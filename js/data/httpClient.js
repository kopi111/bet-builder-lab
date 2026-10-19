export class DataSourceError extends Error {
  constructor(source, reason) {
    super(`${source}: ${reason}`);
    this.source = source;
  }
}

export async function fetchText(url, sourceName) {
  const response = await fetchOrExplain(url, sourceName);
  return {
    text: await response.text(),
    fetchedAt: new Date(response.headers.get('x-fetched-at') || Date.now()),
    staleReason: response.headers.get('x-data-stale') || ''
  };
}

export async function fetchJson(url, sourceName) {
  const response = await fetchOrExplain(url, sourceName);
  return response.json();
}

async function fetchOrExplain(url, sourceName) {
  let response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw new DataSourceError(sourceName, `network error (${error.message}). Is server.js running?`);
  }
  if (!response.ok) throw new DataSourceError(sourceName, await failureReason(response));
  return response;
}

async function failureReason(response) {
  try {
    const body = await response.json();
    return body.error || `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}
