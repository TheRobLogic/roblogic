// Cloudflare Pages Function - /whatsup/api/hits
// Old-school page counter for roblogic.org/whatsup (#1609). Each real-browser GET adds one hit;
// the count lives on the mini in the n8n workflow "whatsup hit counter" (public webhook bypass).
// ?peek=1 reads without counting. Bots are not counted and get the current number.

const BOT_RE = /bot|crawler|spider|preview|facebookexternal|slackbot|twitterbot|linkedinbot|whatsapp|discordbot|headless|curl|wget/i;
const HOOK = 'https://n8n.roblogic.org/webhook/whatsup-hits';

export async function onRequestGet({ request }) {
  const headers = { 'content-type': 'application/json', 'cache-control': 'no-store' };
  try {
    const url = new URL(request.url);
    const ua = request.headers.get('user-agent') || '';
    const peek = url.searchParams.has('peek') || BOT_RE.test(ua);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const r = await fetch(HOOK + (peek ? '?peek=1' : ''), { signal: ctrl.signal });
    clearTimeout(timer);
    if (!r.ok) return new Response('{"hits":null}', { status: 502, headers });
    const d = await r.json();
    const hits = Number.isFinite(+d.hits) ? +d.hits : null;
    return new Response(JSON.stringify({ hits }), { status: 200, headers });
  } catch (_) {
    return new Response('{"hits":null}', { status: 502, headers });
  }
}
