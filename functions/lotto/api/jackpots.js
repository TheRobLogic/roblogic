// Cloudflare Pages Function — GET /lotto/api/jackpots   (Vikunja #1421)
//
// Live jackpots for the four CA draw games, read from the CA Lottery's own
// DrawGameApi and cached at the edge for five minutes. The lotto pages are
// baked once a day at 08:00; STARSHOT's cards call this on load so the jackpot
// and next-draw date stay current between bakes. Public, read-only, GET only.
// The browser cannot call calottery.com directly: it answers cross-origin
// requests with a doubled Access-Control-Allow-Origin header, which every
// browser rejects — hence this same-origin hop.
//
// Response:
// { "as_of": "2026-10-07T21:45:00.000Z",
//   "games": {
//     "fantasy-5":       { "name": "Fantasy 5",      "next_draw": "2026-10-07", "jackpot": 163000,    "cash": null,      "close": "2026-10-07T18:30:05" },
//     "superlotto-plus": { ... }, "powerball": { ... }, "mega-millions": { ... } } }
// A game the upstream failed on is simply absent; clients keep their baked value.
// 502 (uncached) only when every game failed. Any uncaught error comes back as
// JSON 500 {error,message} instead of the runtime's bare "error code" page.
//
// Probes (never cached): ?stage=alive | cache | fetch | fetch-signal | fetch-plain

const UPSTREAM = 'https://www.calottery.com/api/DrawGameApi/DrawGamePastDrawResults';
// Numeric DrawGameApi ids — verified live 2026-08-01 (daily-picker update_draws.py) and 2026-10-07.
const GAMES = { 'fantasy-5': 10, 'superlotto-plus': 8, 'powerball': 12, 'mega-millions': 15 };
const TTL = 300;        // seconds, edge cache and browser cache alike
const UPSTREAM_MS = 8000;
const HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': `public, max-age=${TTL}`,
  'Access-Control-Allow-Origin': '*', // public numbers; lets the intranet preview read them too
};
const NO_STORE = { ...HEADERS, 'Cache-Control': 'no-store' };
// The daily picker's verified string. A UA with a URL-ish or "compatible; ..." substring
// gets a fake 503 maintenance page (HTTP 200, text/plain) from the CA CDN.
const UA_HEADERS = { 'User-Agent': 'Mozilla/5.0 (draw-db updater)', 'Accept': 'application/json' };

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), { status: status || 200, headers: headers || NO_STORE });
}

// AbortController + setTimeout rather than AbortSignal.timeout(): the pattern the
// beacon function proved on this Pages runtime.
async function fetchWithTimeout(url, init, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchGame(id) {
  const r = await fetchWithTimeout(`${UPSTREAM}/${id}/1/1`, { headers: UA_HEADERS }, UPSTREAM_MS);
  if (!r.ok) throw new Error(`upstream ${r.status}`);
  const j = await r.json();
  const n = j.NextDraw || {};
  const jackpot = Number(n.JackpotAmount);
  if (!(jackpot > 0) || !n.DrawDate || String(n.DrawDate).startsWith('0001')) throw new Error('no next-draw jackpot');
  const cash = Number(n.EstimatedCashValue);
  return {
    name: j.Name,
    next_draw: String(n.DrawDate).slice(0, 10), // "2026-10-07T07:00:00" → the Pacific draw date
    jackpot,
    cash: cash > 0 ? cash : null,
    close: n.DrawCloseDateTime || null,
  };
}

async function probe(stage) {
  if (stage === 'alive') return new Response('alive ' + Date.now(), { status: 200 });
  if (stage === 'cache') {
    const cache = typeof caches !== 'undefined' && caches.default ? caches.default : null;
    const hit = cache ? await cache.match(new Request('https://roblogic.org/lotto/api/jackpots')) : null;
    return json({ cache: !!cache, hit: !!hit });
  }
  if (stage === 'fetch' || stage === 'fetch-signal' || stage === 'fetch-plain') {
    const url = `${UPSTREAM}/12/1/1`;
    const init = stage === 'fetch-plain' ? {} : { headers: UA_HEADERS };
    const r = stage === 'fetch-signal' ? await fetchWithTimeout(url, init, UPSTREAM_MS) : await fetch(url, init);
    const txt = await r.text();
    return json({ status: r.status, ct: r.headers.get('content-type'), bytes: txt.length, head: txt.slice(0, 120) });
  }
  return json({ error: 'unknown stage' }, 400);
}

async function handle(context) {
  const { request } = context;
  const cacheKey = new Request(new URL(request.url).origin + '/lotto/api/jackpots', { method: 'GET' });
  const cache = typeof caches !== 'undefined' && caches.default ? caches.default : null;
  if (cache) {
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
  }

  const games = {};
  const settled = await Promise.allSettled(
    Object.entries(GAMES).map(async ([slug, id]) => [slug, await fetchGame(id)])
  );
  for (const s of settled) if (s.status === 'fulfilled') games[s.value[0]] = s.value[1];

  const payload = { as_of: new Date().toISOString(), games };
  if (Object.keys(games).length === 0) {
    payload.errors = settled.map((s) => (s.status === 'rejected' ? String(s.reason && s.reason.message) : 'ok'));
    return json(payload, 502);
  }
  const resp = json(payload, 200, HEADERS);
  if (cache) {
    const put = cache.put(cacheKey, resp.clone());
    if (typeof context.waitUntil === 'function') context.waitUntil(put); else await put;
  }
  return resp;
}

export async function onRequestGet(context) {
  let stage = null;
  try {
    stage = new URL(context.request.url).searchParams.get('stage');
    return stage ? await probe(stage) : await handle(context);
  } catch (e) {
    return json({ error: (e && e.name) || 'Error', message: String(e && e.message), stage, stack: String(e && e.stack).slice(0, 600) }, 500);
  }
}
