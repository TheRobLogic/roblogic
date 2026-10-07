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
// 502 (uncached) only when every game failed.

const UPSTREAM = 'https://www.calottery.com/api/DrawGameApi/DrawGamePastDrawResults';
// Numeric DrawGameApi ids — verified live 2026-08-01 (daily-picker update_draws.py) and 2026-10-07.
const GAMES = { 'fantasy-5': 10, 'superlotto-plus': 8, 'powerball': 12, 'mega-millions': 15 };
const TTL = 300; // seconds, edge cache and browser cache alike
const HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': `public, max-age=${TTL}`,
  'Access-Control-Allow-Origin': '*', // public numbers; lets the intranet preview read them too
};

async function fetchGame(id) {
  const r = await fetch(`${UPSTREAM}/${id}/1/1`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (draw-db updater)', // the daily picker's verified string; a 'compatible; ...' UA gets a fake 503 maintenance page (HTTP 200, text/plain) from the CA CDN
      'Accept': 'application/json',
    },
    signal: (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) ? AbortSignal.timeout(8000) : undefined,
  });
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

export async function onRequestGet(context) {
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

  const body = JSON.stringify({ as_of: new Date().toISOString(), games });
  if (Object.keys(games).length === 0) {
    return new Response(body, { status: 502, headers: { ...HEADERS, 'Cache-Control': 'no-store' } });
  }
  const resp = new Response(body, { status: 200, headers: HEADERS });
  if (cache) {
    const put = cache.put(cacheKey, resp.clone());
    if (typeof context.waitUntil === 'function') context.waitUntil(put); else await put;
  }
  return resp;
}
