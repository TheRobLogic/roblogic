// Cloudflare Pages Function — GET /lotto/api/jackpots   (Vikunja #1421)
//
// Live jackpots for the four CA draw games (Fantasy 5, SuperLotto Plus,
// Powerball, Mega Millions). The lotto pages are baked once a day at 08:00;
// STARSHOT's cards call this on load so each card's jackpot and next-draw date
// stay current between bakes. Public, read-only, GET only.
//
// Chain:  page → this function (5-min edge cache, CORS) → n8n webhook on the
//         home server (/webhook/lotto-jackpots) → calottery.com DrawGameApi.
// Why the hop through the home server (both probed 2026-10-07):
//   • browsers can't call calottery.com directly — it sends a doubled
//     Access-Control-Allow-Origin header, which every browser rejects;
//   • Cloudflare Workers can't either — calottery.com's WAF answers 403 to
//     Worker egress regardless of headers. The home IP is fine.
//
// Response (same shape the webhook returns, re-validated here):
// { "as_of": "2026-10-07T21:45:00.000Z",
//   "games": { "fantasy-5": { "name": "Fantasy 5", "next_draw": "2026-10-07", "jackpot": 163000, "cash": null, "close": "2026-10-07T18:30:05" }, ... } }
// A game the upstream failed on is simply absent; the page keeps its baked value.
// On any failure this answers HTTP 200 {as_of, games:{}, error} uncached — a
// Worker 5xx gets replaced by Cloudflare's own "error code" page, which the page
// couldn't parse anyway. Probes (never cached): ?stage=alive | upstream

const TTL = 300;          // seconds, edge cache and browser cache alike
const UPSTREAM_MS = 8000;
const HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': `public, max-age=${TTL}`,
  'Access-Control-Allow-Origin': '*', // public numbers; lets the intranet preview read them too
};
const NO_STORE = { ...HEADERS, 'Cache-Control': 'no-store' };

const upstreamUrl = (env) => `${(env && env.N8N_LOTTO_URL) || 'https://n8n.roblogic.org/webhook'}/lotto-jackpots`;

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), { status: status || 200, headers: headers || NO_STORE });
}

// AbortController + setTimeout: the timeout pattern beacon.js proved on this runtime.
async function fetchWithTimeout(url, init, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function readUpstream(env) {
  const r = await fetchWithTimeout(upstreamUrl(env), { headers: { 'Accept': 'application/json' } }, UPSTREAM_MS);
  if (!r.ok) throw new Error(`upstream ${r.status}`);
  const d = await r.json();
  const games = {};
  for (const [slug, g] of Object.entries((d && d.games) || {})) {
    const jackpot = Number(g && g.jackpot);
    if (!(jackpot > 0) || typeof (g && g.next_draw) !== 'string') continue;
    const cash = Number(g.cash);
    games[slug] = { name: g.name, next_draw: g.next_draw, jackpot, cash: cash > 0 ? cash : null, close: g.close || null };
  }
  const out = { as_of: (d && d.as_of) || new Date().toISOString(), games };
  if (d && Array.isArray(d.errors) && d.errors.length) out.errors = d.errors;
  return out;
}

export async function onRequestGet(context) {
  const { request, env } = context;
  let stage = null;
  try {
    const url = new URL(request.url);
    stage = url.searchParams.get('stage');
    if (stage === 'alive') return new Response('alive ' + Date.now(), { status: 200 });
    if (stage === 'upstream') {
      const r = await fetchWithTimeout(upstreamUrl(env), {}, UPSTREAM_MS);
      const t = await r.text();
      return json({ status: r.status, ct: r.headers.get('content-type'), head: t.slice(0, 200) });
    }
    if (stage) return json({ error: 'unknown stage' }, 400);

    const cacheKey = new Request(url.origin + '/lotto/api/jackpots', { method: 'GET' });
    const cache = typeof caches !== 'undefined' && caches.default ? caches.default : null;
    if (cache) {
      const hit = await cache.match(cacheKey);
      if (hit) return hit;
    }

    const payload = await readUpstream(env);
    if (Object.keys(payload.games).length === 0) return json({ ...payload, error: 'no games from upstream' }, 200);
    const resp = json(payload, 200, HEADERS);
    if (cache) {
      const put = cache.put(cacheKey, resp.clone());
      if (typeof context.waitUntil === 'function') context.waitUntil(put); else await put;
    }
    return resp;
  } catch (e) {
    return json({ as_of: new Date().toISOString(), games: {}, error: String((e && e.message) || e), stage }, 200);
  }
}
