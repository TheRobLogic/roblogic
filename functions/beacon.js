// Cloudflare Pages Function - /beacon
// Generic visitor beacon for any roblogic.org sub-page.
// Relays to ntfy.sh/roblogic-claude, enriched with IP + geo from CF edge.
//
// Client POSTs JSON: { page: "vote", ref: "...", tag: "ballot_box" }
//   - page goes in the ntfy Title: "<page> opened - IP: <ip>"
//   - ref is the referrer string for the body
//   - tag is the ntfy Tags short-code (e.g. "ballot_box", "cocktail")
//
// New pages: copy the client snippet, change page + tag. No server work needed.

const BOT_RE = /bot|crawler|spider|preview|facebookexternal|slackbot|twitterbot|linkedinbot|whatsapp|discordbot|headless|curl|wget/i;
const SAFE_TAG_RE = /^[a-z0-9_,]{1,60}$/i;
const DEFAULT_TAG = 'bell';
const MAX_BODY = 2048;

// Strip control chars + non-ASCII that would break outbound header construction.
const sanitize = (s) => s.replace(/[^\x20-\x7e]/g, '').trim();
const sanitizeHeader = (s, fallback = '') => {
  const clean = sanitize(String(s || '')).replace(/\s+/g, ' ').slice(0, 180);
  return clean || fallback;
};

export async function onRequestPost({ request }) {
  try {
    const url = new URL(request.url);
    const debug = url.searchParams.has('debug') || url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    // Alive-probe: return immediately without touching ntfy.
    if (url.searchParams.has('alive')) {
      return new Response('alive ' + Date.now(), { status: 200 });
    }
    const ua = request.headers.get('user-agent') || '';
    if (BOT_RE.test(ua)) {
      return new Response(null, { status: 204 });
    }

    const len = +(request.headers.get('content-length') || 0);
    if (len > MAX_BODY) {
      return new Response(null, { status: 413 });
    }

    let parsed = {};
    try {
      const txt = await request.text();
      if (txt && txt.length <= MAX_BODY) parsed = JSON.parse(txt);
    } catch (_) { /* bad JSON - fall through with empty obj */ }

    const page = sanitize(typeof parsed.page === 'string' ? parsed.page : 'page').slice(0, 60) || 'page';
    const ref  = sanitize(typeof parsed.ref  === 'string' ? parsed.ref  : 'direct').slice(0, 120);
    const rawTag = typeof parsed.tag === 'string' ? parsed.tag : '';
    const tag  = SAFE_TAG_RE.test(rawTag) ? rawTag : DEFAULT_TAG;

    const ip      = sanitizeHeader(request.headers.get('cf-connecting-ip'), 'unknown');
    const cf      = request.cf || {};
    const country = sanitize(typeof cf.country === 'string' ? cf.country : '');
    const region  = sanitize(typeof cf.region  === 'string' ? cf.region  : '');
    const city    = sanitize(typeof cf.city    === 'string' ? cf.city    : '');
    const geo     = [city, region, country].filter(Boolean).join(', ');

    const title = sanitizeHeader(`${page} opened - IP: ${ip}`, 'page opened');
    const tags = sanitizeHeader(tag, DEFAULT_TAG);
    const body  = [
      geo ? `Geo: ${geo}` : '',
      `Ref: ${ref}`,
      `UA: ${ua.slice(0, 100)}`
    ].filter(Boolean).join('\n');

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    let ntfyResp;
    let abortedByTimeout = false;
    try {
      ntfyResp = await fetch('https://ntfy.sh/roblogic-claude', {
        method: 'POST',
        headers: {
          'Title': title,
          'Tags': tags
        },
        body,
        signal: ctrl.signal
      });
    } catch (fetchErr) {
      clearTimeout(timer);
      abortedByTimeout = fetchErr && fetchErr.name === 'AbortError';
      console.log('beacon ntfy fetch failed', { name: fetchErr && fetchErr.name, message: fetchErr && fetchErr.message, abortedByTimeout });
      if (debug) {
        return new Response(JSON.stringify({
          ok: false,
          error: 'ntfy-fetch-threw',
          name: fetchErr && fetchErr.name,
          message: fetchErr && fetchErr.message,
          abortedByTimeout
        }), { status: 502, headers: { 'content-type': 'application/json' } });
      }
      return new Response('ntfy fetch failed', { status: 502 });
    }
    clearTimeout(timer);

    const ntfyText = ntfyResp.ok ? '' : await ntfyResp.text().catch(() => '');
    console.log('beacon ntfy response', {
      status: ntfyResp.status,
      ok: ntfyResp.ok,
      title,
      tags,
      bodyLength: body.length,
      responseBody: ntfyText.slice(0, 300)
    });

    if (!ntfyResp.ok) {
      if (debug) {
        return new Response(JSON.stringify({
          ok: false,
          ntfyStatus: ntfyResp.status,
          ntfyBody: ntfyText.slice(0, 300)
        }), { status: 502, headers: { 'content-type': 'application/json' } });
      }
      return new Response('ntfy failed', { status: 502 });
    }

    if (debug) {
      return new Response(JSON.stringify({ ok: true, ntfyStatus: ntfyResp.status }),
        { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('ok', { status: 200 });
  } catch (err) {
    console.log('beacon error', {
      name: err && err.name,
      message: err && err.message
    });
    // Fail silent on the public endpoint; don't leak internal error details.
    return new Response(null, { status: 204 });
  }
}

export async function onRequestGet() {
  return new Response('POST only', { status: 405, headers: { Allow: 'POST' } });
}
