// Cloudflare Pages Function — /vote/beacon
// Relays pageview pings from vote/index.html and vote/candidates/index.html
// to ntfy.sh/roblogic-claude, enriched with visitor IP and geo from CF headers.
// Client-side is localStorage-throttled to 1/hr/browser; server adds no extra
// throttle (keeps stateless).

const BOT_RE = /bot|crawler|spider|preview|facebookexternal|slackbot|twitterbot|linkedinbot|whatsapp|discordbot|headless|curl|wget/i;

export async function onRequestPost(context) {
  const { request } = context;

  // Server-side bot filter — belt-and-suspenders alongside client-side filter
  const ua = request.headers.get('user-agent') || '';
  if (BOT_RE.test(ua)) {
    return new Response('skip', { status: 204 });
  }

  let body = {};
  try { body = await request.json(); } catch (e) {}

  const page = typeof body.page === 'string' ? body.page.slice(0, 60) : 'vote';
  const ref  = typeof body.ref  === 'string' ? body.ref.slice(0, 120) : 'direct';

  const ip      = request.headers.get('cf-connecting-ip') || 'unknown';
  const country = request.cf?.country || '??';
  const region  = request.cf?.region  || '';
  const city    = request.cf?.city    || '';
  const geo     = [city, region, country].filter(Boolean).join(', ');

  // Title displays at a glance on lock screen — lead with page + IP.
  const title = `${page} opened · IP: ${ip}`;

  const bodyLines = [
    geo ? `Geo: ${geo}` : null,
    `Ref: ${ref}`,
    `UA: ${ua.slice(0, 100)}`
  ].filter(Boolean);

  try {
    await fetch('https://ntfy.sh/roblogic-claude', {
      method: 'POST',
      headers: {
        'Title': title,
        'Tags': 'ballot_box'
      },
      body: bodyLines.join('\n')
    });
  } catch (e) {
    // ntfy unreachable — swallow, don't leak upstream
  }

  return new Response('ok', { status: 200 });
}

// Reject other methods cleanly
export async function onRequest(context) {
  return new Response('POST only', { status: 405, headers: { 'Allow': 'POST' } });
}
