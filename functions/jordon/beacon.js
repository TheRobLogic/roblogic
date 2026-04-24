// Cloudflare Pages Function — /jordon/beacon
// Relays pageview pings from /jordon/ to ntfy.sh/roblogic-claude,
// enriched with visitor IP and geo from CF edge headers.

const BOT_RE = /bot|crawler|spider|preview|facebookexternal|slackbot|twitterbot|linkedinbot|whatsapp|discordbot|headless|curl|wget/i;

export async function onRequestPost({ request }) {
  try {
    const ua = request.headers.get('user-agent') || '';
    if (BOT_RE.test(ua)) {
      return new Response(null, { status: 204 });
    }

    let parsed = {};
    try {
      const txt = await request.text();
      if (txt) parsed = JSON.parse(txt);
    } catch (_) { /* bad JSON — fall through with empty obj */ }

    const page = (typeof parsed.page === 'string' ? parsed.page : 'jordon').slice(0, 60);
    const ref  = (typeof parsed.ref  === 'string' ? parsed.ref  : 'direct').slice(0, 120);

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
        'Tags': 'cocktail'
      },
      body
    });

    return new Response('ok', { status: 200 });
  } catch (err) {
    return new Response('beacon-err: ' + (err && err.message ? err.message : String(err)), { status: 500 });
  }
}

export async function onRequestGet() {
  return new Response('POST only', { status: 405, headers: { Allow: 'POST' } });
}
