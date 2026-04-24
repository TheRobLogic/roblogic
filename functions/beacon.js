// Cloudflare Pages Function — /beacon
// Generic visitor beacon for any roblogic.org sub-page.
// Relays to ntfy.sh/roblogic-claude, enriched with IP + geo from CF edge.
//
// Client POSTs JSON: { page: "vote", ref: "...", tag: "ballot_box" }
//   - page → goes in the ntfy Title: "<page> opened · IP: <ip>"
//   - ref  → referrer string for the body
//   - tag  → ntfy Tags emoji short-code (e.g. "ballot_box", "cocktail")
//
// New pages: copy the client snippet, change page + tag. No server work needed.

const BOT_RE = /bot|crawler|spider|preview|facebookexternal|slackbot|twitterbot|linkedinbot|whatsapp|discordbot|headless|curl|wget/i;
const SAFE_TAG_RE = /^[a-z0-9_,]{1,60}$/i;
const DEFAULT_TAG = 'bell';
const MAX_BODY = 2048;

// Strip control chars + non-ASCII that would break outbound header construction.
const sanitize = (s) => s.replace(/[^\x20-\x7e]/g, '').trim();

export async function onRequestPost({ request }) {
  try {
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
    } catch (_) { /* bad JSON — fall through with empty obj */ }

    const page = sanitize(typeof parsed.page === 'string' ? parsed.page : 'page').slice(0, 60) || 'page';
    const ref  = sanitize(typeof parsed.ref  === 'string' ? parsed.ref  : 'direct').slice(0, 120);
    const rawTag = typeof parsed.tag === 'string' ? parsed.tag : '';
    const tag  = SAFE_TAG_RE.test(rawTag) ? rawTag : DEFAULT_TAG;

    const ip      = request.headers.get('cf-connecting-ip') || 'unknown';
    const cf      = request.cf || {};
    const country = cf.country || '';
    const region  = cf.region  || '';
    const city    = cf.city    || '';
    const geo     = [city, region, country].filter(Boolean).join(', ');

    const title = `${page} opened · IP: ${ip}`;
    const body  = [
      geo ? `Geo: ${geo}` : '',
      `Ref: ${ref}`,
      `UA: ${ua.slice(0, 100)}`
    ].filter(Boolean).join('\n');

    await fetch('https://ntfy.sh/roblogic-claude', {
      method: 'POST',
      headers: {
        'Title': title,
        'Tags': tag
      },
      body
    });

    return new Response('ok', { status: 200 });
  } catch (_err) {
    // Fail silent on the public endpoint — don't leak internal error details.
    return new Response(null, { status: 204 });
  }
}

export async function onRequestGet() {
  return new Response('POST only', { status: 405, headers: { Allow: 'POST' } });
}
