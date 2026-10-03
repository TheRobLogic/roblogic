// Cloudflare Pages Function - /va-house-sale/* (every sub-path)
// KILLED 2026-10-03, Rob: "kill it, but dont delete". Ticket #1330 (closed).
// The page files stay in va-house-sale/ untouched; this answers 404 so the
// page is offline. The same handler lives in index.js for the base route; keep
// the two files separate so neither imports the other.
//
// The GitHub Pages copy (theroblogic.github.io/roblogic) skips the folder via
// the exclude list in _config.yml.
//
// To bring the page back: delete functions/va-house-sale/, remove
// va-house-sale from the exclude list in _config.yml, and put this card back
// in other/index.html, first item under Projects:
// <li><a href="/va-house-sale/">Selling the Meadowview House <span class="desc">step by step for an heir in San Diego selling an inherited Washington County, Virginia house without flying out: what to do in order, with two checked local people to call for every step</span></a></li>

export function onRequest() {
  return new Response('Not found', {
    status: 404,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
