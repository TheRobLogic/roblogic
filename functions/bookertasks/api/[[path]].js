// Cloudflare Pages Function — proxy for booker tasks API
// Routes /bookertasks/api/{action} -> n8n.roblogic.org/webhook/booker-tasks/{action}

// Email -> display name mapping (single source of truth for identity)
const EMAIL_MAP = {
  'roblogic@gmail.com': 'rob',
  'kaylaharrelson36@gmail.com': 'kayla',
};

function extractUserFromJWT(request) {
  const jwt = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!jwt) return null;

  try {
    const parts = jwt.split('.');
    if (parts.length !== 3) return null;
    // Base64url decode the payload (middle segment)
    const payload = JSON.parse(
      atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))
    );
    const email = payload.email;
    return EMAIL_MAP[email] || null;
  } catch (e) {
    return null;
  }
}

export async function onRequest(context) {
  const { request, env, params } = context;

  // Extract the action from the catch-all path segments
  const action = params.path ? params.path.join('/') : '';
  if (!action) {
    return new Response(
      JSON.stringify({ success: false, error: 'Missing action' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Extract user identity from CF Access JWT
  const user = extractUserFromJWT(request);
  if (!user) {
    return new Response(
      JSON.stringify({ success: false, error: 'Unauthorized' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Build the n8n webhook URL
  const n8nUrl = `${env.N8N_WEBHOOK_URL}/${action}`;

  // Forward the request to n8n
  const headers = new Headers();
  headers.set('X-Booker-Secret', env.BOOKER_SECRET);
  headers.set('X-Booker-User', user);
  headers.set('Content-Type', 'application/json');

  const fetchOpts = {
    method: request.method,
    headers,
  };

  // Forward body for POST requests
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
