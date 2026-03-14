// Cloudflare Pages Function — proxy for booker tasks API
// Routes /bookertasks/api/{action} -> n8n for CRUD, handles draft-email locally via Anthropic API
// Auth: n8n secret hidden server-side; user identity from X-Booker-User header (set by frontend)

const VALID_USERS = ['rob', 'kayla', 'briefing'];

const DRAFT_PROMPT = `You are drafting a booking email for The Bancroft, a dive bar and live music venue in Spring Valley, San Diego.

ROB'S EMAIL STYLE (follow this exactly):
- Extremely terse and direct. Most replies are 1-3 sentences.
- No greeting, no closing, no signature (those get added manually).
- No preamble. No "I wanted to follow up" or "thanks for reaching out" or "hope you're doing well".
- Casual but not sloppy. Plain language, short sentences, active voice.
- Lead with the answer or the offer. Don't build up to it.
- If offering a date: just state the date. "Saturday March 28 is open."
- If discussing money: be straight. "$100 guarantee" not "we could potentially offer a guarantee of around $100".
- Never use em dashes. Use commas.
- Never say "don't hesitate to" or "please feel free to" or "I'm excited to". Just say "let me know".
- Light and human when appropriate ("hope to see you next time", "you won't walk away empty handed").
- If saying no, just say no. "No thanks." or "That date's booked."

Real examples of Rob's replies:
- "July 16 is open. It'd be probably better if you brought a local opener to help the draw."
- "Hey Ted, how about July 22 or 23? You can fill the rest of the bill with bands you want to play with."
- "8 is booked, 22 is tentatively booked. Saturday July 30 is open."
- "Sorry the door is the only option for this one. I wish I could cover the flat rate but we've been decimated since covid and I have zero float for extra cash. I can promise you won't walk away empty handed, but a lot depends on how we do that night."`;

async function handleDraftEmail(request, env) {
  const body = await request.json();
  const title = body.title || '';
  const context = body.context || '';
  const notes = body.notes || '';

  const prompt = `${DRAFT_PROMPT}

Now draft a reply for this task:

Task: ${title}

Context: ${context || 'No additional context.'}

Notes/instructions: ${notes || 'No specific instructions.'}

Write ONLY the email body text. No subject line, no greeting, no signature. Match Rob's voice exactly.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const data = await response.json();
    const draft = data.content && data.content[0] ? data.content[0].text : 'No response generated';

    return new Response(
      JSON.stringify({ success: true, draft }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ success: false, error: 'Failed to generate draft: ' + e.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

export async function onRequest(context) {
  const { request, env, params } = context;

  const action = params.path ? params.path.join('/') : '';
  if (!action) {
    return new Response(
      JSON.stringify({ success: false, error: 'Missing action' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Get user identity from frontend
  const user = request.headers.get('X-Booker-User') || '';
  if (!VALID_USERS.includes(user)) {
    return new Response(
      JSON.stringify({ success: false, error: 'Set your identity first' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Handle draft-email locally (calls Anthropic API directly, no n8n)
  if (action === 'draft-email') {
    return handleDraftEmail(request, env);
  }

  // Everything else forwards to n8n
  const n8nUrl = `${env.N8N_WEBHOOK_URL}/${action}`;

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
