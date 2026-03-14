// Cloudflare Pages Function — proxy for booker tasks API
// Routes /bookertasks/api/{action} -> n8n.roblogic.org/webhook/booker-tasks/{action}
// Auth: n8n secret hidden server-side; user identity from X-Booker-User header (set by frontend)

const VALID_USERS = ['rob', 'kayla', 'briefing'];

export async function onRequest(context) {
  const { request, env, params } = context;

  const action = params.path ? params.path.join('/') : '';
  if (!action) {
    return new Response(
      JSON.stringify({ success: false, error: 'Missing action' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Get user identity from frontend (stored in localStorage, sent as header)
  const user = request.headers.get('X-Booker-User') || '';
  if (!VALID_USERS.includes(user)) {
    return new Response(
      JSON.stringify({ success: false, error: 'Set your identity first' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Build the n8n webhook URL
  const n8nUrl = `${env.N8N_WEBHOOK_URL}/${action}`;

  // Forward the request to n8n with the secret (hidden from browser)
  const headers = new Headers();
  headers.set('X-Booker-Secret', env.BOOKER_SECRET);
  headers.set('X-Booker-User', user);
  headers.set('Content-Type', 'application/json');

  const fetchOpts = { method: request.method, headers };

  if (request.method === 'POST') {
    fetchOpts.body = await request.text();
  }

  try {
    const response = await fetch(n8nUrl, fetchOpts);
    const data = await response.text();
    return new Response(data, {
      status: response.status,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ success: false, error: 'Backend unreachable' }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
