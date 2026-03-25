// Cloudflare Pages Function — proxy for inventory API
// Routes:
//   /inventory/api/latest       → n8n inventory-list (latest count)
//   /inventory/api/count?file=X → n8n inventory-list?file=X (specific count)
//   /inventory/api/archive      → n8n inventory-list for manifest.json (list all)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') {
    return new Response(null, { headers: CORS });
  }

  const url = new URL(context.request.url);
  const segments = url.pathname.replace('/inventory/api/', '').split('/').filter(Boolean);
  const action = segments[0] || '';

  const n8nBase = context.env.N8N_INVENTORY_URL || 'https://n8n.roblogic.org/webhook';

  try {
    if (action === 'latest') {
      const resp = await fetch(`${n8nBase}/inventory-list`);
      const data = await resp.text();
      return new Response(data, {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'count') {
      const file = url.searchParams.get('file');
      if (!file || !/^[\w-]+\.json$/.test(file)) {
        return new Response(JSON.stringify({ error: 'Invalid file param' }), {
          status: 400,
          headers: { ...CORS, 'Content-Type': 'application/json' },
        });
      }
      const resp = await fetch(`${n8nBase}/inventory-list?file=${encodeURIComponent(file)}`);
      const data = await resp.text();
      return new Response(data, {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'archive') {
      // Fetch manifest.json which lists all submissions
      const resp = await fetch(`${n8nBase}/inventory-list?file=manifest.json`);
      const data = await resp.text();
      return new Response(data, {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Unknown action' }), {
      status: 404,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Upstream error' }), {
      status: 502,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
}
