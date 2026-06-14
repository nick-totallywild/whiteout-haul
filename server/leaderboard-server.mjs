// Tiny zero-dependency leaderboard backend for Whiteout Haul.
// Stores one best score per nickname in scores.json and serves a REST API.
//
//   GET  /api/scores        -> { scores: [{ name, score, ts }, ...] }  (top, desc)
//   POST /api/score {name, score} -> upserts the player's BEST score, returns top
//
// Run with:  npm run server   (defaults to port 3001)
// To go fully global: deploy this file to any free Node host (Render, Railway,
// Fly, a VPS) and set VITE-side LEADERBOARD.apiBase to its public URL.

import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolveMx } from 'node:dns/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const PORT = process.env.PORT || 3001;
const DIR = dirname(fileURLToPath(import.meta.url));
const FILE = join(DIR, 'scores.json');
const MAX_RETURNED = 20;
const NAME_MAX = 16;

// --- Minimal .env loader (zero-dep) ---------------------------------------
// Reads ../.env so FMP_API_KEY (and friends) are available without dotenv.
function loadEnv() {
  try {
    const raw = readFileSync(join(DIR, '..', '.env'), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m || m[1] in process.env) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      process.env[m[1]] = v;
    }
  } catch {
    // no .env — prices endpoint will just report it's unconfigured
  }
}
loadEnv();

// --- Live metal prices (Financial Modeling Prep), cached in memory --------
const FMP_BASE = 'https://financialmodelingprep.com/stable';
const PRICE_TTL = 15 * 60 * 1000; // 15 min cache (stays well under FMP free tier)
let priceCache = null;
let priceTs = 0;

async function fetchQuote(symbol) {
  const key = process.env.FMP_API_KEY;
  const url = `${FMP_BASE}/quote?symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(key)}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  const json = await res.json();
  const q = Array.isArray(json) ? json[0] : json;
  if (!q || typeof q.price !== 'number') return null;
  return {
    price: q.price,
    change: typeof q.change === 'number' ? q.change : 0,
    changePercent: typeof q.changePercentage === 'number' ? q.changePercentage : 0,
  };
}

async function getPrices() {
  const now = Date.now();
  if (priceCache && now - priceTs < PRICE_TTL) return priceCache;
  if (!process.env.FMP_API_KEY) return { error: 'FMP_API_KEY not set' };
  try {
    const [gold, silver] = await Promise.all([fetchQuote('GCUSD'), fetchQuote('SIUSD')]);
    if (!gold && !silver) throw new Error('no data');
    priceCache = { gold, silver, fetchedAt: now };
    priceTs = now;
    return priceCache;
  } catch (e) {
    if (priceCache) return priceCache; // serve stale on transient failure
    return { error: 'price fetch failed' };
  }
}

// Simple anti-fake email checks (no email is actually sent): format, a small
// disposable-domain blocklist, and a DNS MX lookup so the domain can receive mail.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DISPOSABLE = new Set([
  'mailinator.com', 'guerrillamail.com', '10minutemail.com', 'tempmail.com',
  'trashmail.com', 'yopmail.com', 'getnada.com', 'dispostable.com',
  'sharklasers.com', 'maildrop.cc', 'temp-mail.org', 'fakeinbox.com',
]);

async function validateEmail(email) {
  if (typeof email !== 'string' || !EMAIL_RE.test(email)) return 'enter a valid email address';
  const domain = email.split('@')[1].toLowerCase();
  if (DISPOSABLE.has(domain)) return 'disposable email addresses are not allowed';
  try {
    const mx = await resolveMx(domain);
    if (!mx || mx.length === 0) return 'that email domain can’t receive mail';
  } catch (e) {
    // Domain genuinely doesn't exist / has no records -> reject. Other errors
    // (transient network/DNS issues) fail open so real users aren't blocked.
    if (e && (e.code === 'ENOTFOUND' || e.code === 'ENODATA')) {
      return 'that email domain can’t receive mail';
    }
  }
  return null; // ok
}

async function load() {
  try {
    return JSON.parse(await readFile(FILE, 'utf8'));
  } catch {
    return [];
  }
}

async function save(scores) {
  await writeFile(FILE, JSON.stringify(scores, null, 2));
}

// Best score per player, sorted high -> low, capped. Email is kept private
// (used only as the unique key) and never returned to clients.
function topList(scores) {
  return [...scores]
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_RETURNED)
    .map((s) => ({ name: s.name, score: s.score, ts: s.ts }));
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 1e4) req.destroy(); // guard against huge bodies
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(data || '{}'));
      } catch {
        resolve(null);
      }
    });
  });
}

const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return sendJson(res, 204, {});

  if (req.method === 'GET' && req.url.startsWith('/api/scores')) {
    const scores = await load();
    return sendJson(res, 200, { scores: topList(scores) });
  }

  if (req.method === 'GET' && req.url.startsWith('/api/prices')) {
    return sendJson(res, 200, await getPrices());
  }

  if (req.method === 'POST' && req.url.startsWith('/api/score')) {
    const body = await readBody(req);
    if (!body || typeof body.name !== 'string' || typeof body.score !== 'number') {
      return sendJson(res, 400, { error: 'expected { name, email, score }' });
    }
    const emailErr = await validateEmail(body.email);
    if (emailErr) return sendJson(res, 400, { error: emailErr });

    const name = body.name.trim().slice(0, NAME_MAX) || 'anon';
    const email = body.email.trim().toLowerCase();
    const score = Math.max(0, Math.floor(body.score));
    const scores = await load();
    // one entry per email (the unique player key); name can change.
    const existing = scores.find((s) => s.email === email);
    if (existing) {
      existing.name = name;
      if (score > existing.score) {
        existing.score = score;
        existing.ts = Date.now();
      }
    } else {
      scores.push({ name, email, score, ts: Date.now() });
    }
    await save(scores);
    return sendJson(res, 200, { scores: topList(scores) });
  }

  sendJson(res, 404, { error: 'not found' });
});

server.listen(PORT, () => {
  console.log(`Whiteout Haul leaderboard API listening on http://localhost:${PORT}`);
});
