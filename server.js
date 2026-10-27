import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(ROOT, 'cache');
const PORT = Number(process.env.PORT || 5350);
const HOST = process.env.HOST || '127.0.0.1';
const API_FOOTBALL_KEY = process.env.APIFOOTBALL_KEY || '';
const FOOTBALL_DATA_ORG_KEY = process.env.FOOTBALL_DATA_ORG_KEY || '';

const HOUR = 3600 * 1000;
const FOOTBALL_DATA_ORIGIN = 'https://www.football-data.co.uk';
const API_FOOTBALL_ORIGIN = 'https://v3.football.api-sports.io';
const FOOTBALL_DATA_ORG_ORIGIN = 'https://api.football-data.org/v4';
const OPENFOOTBALL_ORIGIN = 'https://raw.githubusercontent.com/openfootball/football.json/master';
const ESPN_SCOREBOARD = 'https://site.api.espn.com/apis/site/v2/sports/soccer/all/scoreboard';
const ESPN_PATH = /^\/api\/espn\/scoreboard\/(\d{8})\.json$/;
const OPENFOOTBALL_PATH = /^\/\d{4}-\d{2}\/uefa\.cl\.json$/;
const FOOTBALL_DATA_ORG_ENDPOINTS = new Set(['competitions/CL/matches', 'competitions/CL/teams']);
const FOOTBALL_DATA_ORG_QUERY = /^(\?season=\d{4})?$/;
const FOOTBALL_DATA_PATH = /^\/(mmz4281\/\d{4}\/[A-Z]{1,3}\d?\.csv|fixtures\.csv)$/;
const API_FOOTBALL_ENDPOINTS = new Set([
  'fixtures', 'fixtures/lineups', 'fixtures/players', 'injuries', 'players', 'teams'
]);

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png'
};

class UpstreamError extends Error {
  constructor(source, status) {
    super(`${source} answered HTTP ${status}`);
    this.status = status;
  }
}

http.createServer(routeRequest).listen(PORT, HOST, () => {
  console.log(`Bet Builder Lab on http://${HOST}:${PORT}`);
  console.log(`API-Football key: ${API_FOOTBALL_KEY ? 'configured' : 'not set (player data off)'}`);
  console.log(`football-data.org key: ${FOOTBALL_DATA_ORG_KEY ? 'configured' : 'not set (Champions League fixtures off; past results still load)'}`);
});

async function routeRequest(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  try {
    if (url.pathname === '/api/status') return sendStatus(response);
    if (url.pathname.startsWith('/api/fd/')) return await proxyFootballData(url, response);
    if (url.pathname.startsWith('/api/af/')) return await proxyApiFootball(url, response);
    if (url.pathname.startsWith('/api/fdorg/')) return await proxyFootballDataOrg(url, response);
    if (url.pathname.startsWith('/api/of/')) return await proxyOpenFootball(url, response);
    if (ESPN_PATH.test(url.pathname)) return await proxyEspn(url, response);
    return await serveStatic(url.pathname, response);
  } catch (error) {
    console.error(`${request.method} ${url.pathname}: ${error.message}`);
    sendJson(response, error.status === 404 ? 404 : 502, { error: error.message });
  }
}

function sendStatus(response) {
  sendJson(response, 200, {
    footballData: { configured: true, origin: FOOTBALL_DATA_ORIGIN },
    apiFootball: { configured: Boolean(API_FOOTBALL_KEY) },
    footballDataOrg: { configured: Boolean(FOOTBALL_DATA_ORG_KEY) },
    serverTime: new Date().toISOString()
  });
}

async function proxyFootballData(url, response) {
  const upstreamPath = url.pathname.slice('/api/fd'.length);
  if (!FOOTBALL_DATA_PATH.test(upstreamPath)) return sendJson(response, 400, { error: 'Path not allowed' });
  const maxAge = isOldSeason(upstreamPath) ? 7 * 24 * HOUR : 3 * HOUR;
  const cached = await fetchWithCache(FOOTBALL_DATA_ORIGIN + upstreamPath, {}, maxAge);
  sendCached(response, cached, 'text/csv; charset=utf-8');
}

async function proxyApiFootball(url, response) {
  if (!API_FOOTBALL_KEY) return sendJson(response, 503, { error: 'APIFOOTBALL_KEY is not set on the server' });
  const endpoint = url.pathname.slice('/api/af/'.length);
  if (!API_FOOTBALL_ENDPOINTS.has(endpoint)) return sendJson(response, 400, { error: 'Endpoint not allowed' });
  const upstreamUrl = `${API_FOOTBALL_ORIGIN}/${endpoint}${url.search}`;
  const cached = await fetchWithCache(upstreamUrl, { 'x-apisports-key': API_FOOTBALL_KEY }, HOUR / 2);
  sendCached(response, cached, 'application/json; charset=utf-8');
}

async function proxyFootballDataOrg(url, response) {
  if (!FOOTBALL_DATA_ORG_KEY) return sendJson(response, 503, { error: 'FOOTBALL_DATA_ORG_KEY is not set on the server' });
  const endpoint = url.pathname.slice('/api/fdorg/'.length);
  if (!FOOTBALL_DATA_ORG_ENDPOINTS.has(endpoint) || !FOOTBALL_DATA_ORG_QUERY.test(url.search)) return sendJson(response, 400, { error: 'Endpoint not allowed' });
  const maxAge = url.search ? 7 * 24 * HOUR : HOUR;
  const cached = await fetchWithCache(`${FOOTBALL_DATA_ORG_ORIGIN}/${endpoint}${url.search}`, { 'X-Auth-Token': FOOTBALL_DATA_ORG_KEY }, maxAge);
  sendCached(response, cached, 'application/json; charset=utf-8');
}

async function proxyOpenFootball(url, response) {
  const upstreamPath = url.pathname.slice('/api/of'.length);
  if (!OPENFOOTBALL_PATH.test(upstreamPath)) return sendJson(response, 400, { error: 'Path not allowed' });
  const cached = await fetchWithCache(OPENFOOTBALL_ORIGIN + upstreamPath, {}, 7 * 24 * HOUR);
  sendCached(response, cached, 'application/json; charset=utf-8');
}

async function proxyEspn(url, response) {
  const day = url.pathname.match(ESPN_PATH)[1];
  const cached = await fetchWithCache(`${ESPN_SCOREBOARD}?dates=${day}&limit=500`, {}, HOUR);
  sendCached(response, cached, 'application/json; charset=utf-8');
}

function isOldSeason(upstreamPath) {
  const season = upstreamPath.match(/mmz4281\/(\d{4})\//);
  return Boolean(season) && season[1] !== currentSeasonCode();
}

function currentSeasonCode() {
  const now = new Date();
  const startYear = now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  const twoDigits = (year) => String(year % 100).padStart(2, '0');
  return twoDigits(startYear) + twoDigits(startYear + 1);
}

async function fetchWithCache(upstreamUrl, headers, maxAge) {
  const cacheFile = path.join(CACHE_DIR, encodeURIComponent(upstreamUrl.replace(/x-apisports-key=[^&]*/, '')));
  const cached = await readCache(cacheFile);
  if (cached.fresh(maxAge)) return cached;
  try {
    return await downloadToCache(upstreamUrl, headers, cacheFile);
  } catch (error) {
    if (cached.exists) return cached.markStale(error.message);
    throw error;
  }
}

async function downloadToCache(upstreamUrl, headers, cacheFile) {
  const upstream = await fetch(upstreamUrl, { headers, redirect: 'follow', signal: AbortSignal.timeout(25000) });
  if (!upstream.ok) throw new UpstreamError(new URL(upstreamUrl).host, upstream.status);
  const body = Buffer.from(await upstream.arrayBuffer());
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(cacheFile, body);
  return new CachedBody(body, new Date(), true);
}

async function readCache(cacheFile) {
  try {
    const [body, stats] = await Promise.all([fs.readFile(cacheFile), fs.stat(cacheFile)]);
    return new CachedBody(body, stats.mtime, true);
  } catch {
    return new CachedBody(Buffer.alloc(0), new Date(0), false);
  }
}

class CachedBody {
  constructor(body, fetchedAt, exists) {
    this.body = body;
    this.fetchedAt = fetchedAt;
    this.exists = exists;
    this.staleReason = '';
  }

  fresh(maxAge) {
    return this.exists && Date.now() - this.fetchedAt.getTime() < maxAge;
  }

  markStale(reason) {
    this.staleReason = reason;
    return this;
  }
}

function sendCached(response, cached, contentType) {
  const headers = { 'content-type': contentType, 'x-fetched-at': cached.fetchedAt.toISOString() };
  if (cached.staleReason) headers['x-data-stale'] = cached.staleReason;
  response.writeHead(200, headers);
  response.end(cached.body);
}

async function serveStatic(pathname, response) {
  const relative = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const filePath = path.normalize(path.join(ROOT, relative));
  const blocked = !filePath.startsWith(ROOT + path.sep) || /(^|\/)(cache|node_modules|tests|\.)/.test(relative);
  if (blocked) return sendJson(response, 404, { error: 'Not found' });
  try {
    const body = await fs.readFile(filePath);
    response.writeHead(200, { 'content-type': CONTENT_TYPES[path.extname(filePath)] || 'application/octet-stream' });
    response.end(body);
  } catch {
    sendJson(response, 404, { error: 'Not found' });
  }
}

function sendJson(response, status, payload) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}
