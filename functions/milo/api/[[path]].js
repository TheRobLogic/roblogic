// Cloudflare Pages Function — Milo paw counter proxy
// Routes:
//   GET  /milo/api/paw → current paw count
//   POST /milo/api/paw → leave a paw (rate-limited per IP upstream)

const HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const action = url.pathname.replace('/milo/api/', '').split('/').filter(Boolean)[0] || '';
  const base = env.N8N_MILO_URL || 'https://n8n.roblogic.org/webhook';

  if (action !== 'paw') {
    return new Response(JSON.stringify({ error: 'Unknown action' }), { status: 404, headers: HEADERS });
  }

  try {
    if (request.method === 'GET') {
      const resp = await fetch(`${base}/milo-paw`);
      return new Response(await resp.text(), { headers: HEADERS });
    }

    if (request.method === 'POST') {
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      const resp = await fetch(`${base}/milo-paw`, {
        method: 'POST',
        headers: { 'x-paw-ip': ip },
      });
      return new Response(await resp.text(), { headers: HEADERS });
    }

    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: HEADERS });
  } catch (err) {
    return new Response(JSON.stringify({ count: null, error: 'Upstream error' }), { status: 502, headers: HEADERS });
  }
}
