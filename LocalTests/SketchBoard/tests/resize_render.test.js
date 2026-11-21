// TESTER (F1 RED) — MAJOR-5: selection handles must be addressable.
// These tests describe required behaviour that does NOT exist yet. They must FAIL
// for the right reason (missing product behaviour), never for a typo/link error:
// hence namespace imports + per-test assertions instead of named imports.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as render from '../src/render.js';

const RECT = { type: 'rect', id: 'a', x: 10, y: 20, w: 100, h: 50 };

/** Parse the emitted handle rects well enough to read their attributes. */
function handles(markup) {
  const out = [];
  const re = /<rect class="sel-handle"([^>]*)\/>/g;
  let m;
  while ((m = re.exec(markup))) {
    const attrs = {};
    const ar = /([\w-]+)="([^"]*)"/g;
    let a;
    while ((a = ar.exec(m[1]))) attrs[a[1]] = a[2];
    out.push(attrs);
  }
  return out;
}

test('R1 every sel-handle carries data-id of its element', () => {
  const hs = handles(render.selectionOverlaySvg([RECT], 1));
  assert.equal(hs.length, 4, 'four corner handles');
  for (const h of hs) {
    assert.equal(h['data-id'], 'a', 'handle must say which element it belongs to (MAJOR-5)');
  }
});

test('R2 the four handles are tagged nw/ne/sw/se exactly once each', () => {
  const hs = handles(render.selectionOverlaySvg([RECT], 1));
  const corners = hs.map((h) => h['data-corner']).sort();
  assert.deepEqual(corners, ['ne', 'nw', 'se', 'sw'], 'each corner addressable exactly once');
});

test('R3 handle data-id is XML-escaped like every other id we emit', () => {
  const evil = { type: 'rect', id: '"><script>x</script>', x: 0, y: 0, w: 10, h: 10 };
  const out = render.selectionOverlaySvg([evil], 1);
  assert.ok(!out.includes('<script'), 'no raw tag may leak into the overlay');
  const hs = handles(out);
  assert.equal(hs.length, 4);
  // The parser above reads RAW attribute text, so compare against the entity-encoded form
  // and prove it decodes back to the original id.
  assert.equal(hs[0]['data-id'], '&quot;&gt;&lt;script&gt;x&lt;/script&gt;', 'escaped on output');
  const decoded = hs[0]['data-id']
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  assert.equal(decoded, '"><script>x</script>', 'decoded value round-trips');
});

test('R4 handle width is screen-constant AND the legacy attribute regex still matches', () => {
  const out = render.selectionOverlaySvg([RECT], 1);
  // (a) Do not break how existing consumers pattern-match handles.
  assert.match(out, /class="sel-handle"[^>]*width=/, 'legacy pattern must still match');
  // (b) Pin the REAL handle width. NOTE for reviewer: the legacy regex in render.test.js:83
  //     uses a greedy [^>]* before width=, so it actually captures the trailing
  //     stroke-width="...", not the handle width. Read the parsed attribute instead.
  const hs = handles(out);
  for (const h of hs) {
    assert.equal(Number(h.width), 6, 'handle is 6 world units at scale 1');
    assert.equal(Number(h.height), 6);
  }
  const far = handles(render.selectionOverlaySvg([RECT], 0.1));
  assert.equal(Number(far[0].width), 60, 'x10 zoom-out => x10 world size => same on screen');
});

test('R5 corner identity matches geometric position (no off-by-one corner map)', () => {
  // x ascending: nw/sw left, ne/se right. y ascending: nw/ne top, sw/se bottom.
  const hs = handles(render.selectionOverlaySvg([RECT], 1));
  const num = (h, k) => parseFloat(h[k]);
  const byCorner = Object.fromEntries(hs.map((h) => [h['data-corner'], h]));
  const left = Math.min(...hs.map((h) => num(h, 'x')));
  const right = Math.max(...hs.map((h) => num(h, 'x')));
  const top = Math.min(...hs.map((h) => num(h, 'y')));
  const bot = Math.max(...hs.map((h) => num(h, 'y')));
  assert.equal(num(byCorner.nw, 'x'), left, 'nw is on the left');
  assert.equal(num(byCorner.nw, 'y'), top, 'nw is on top');
  assert.equal(num(byCorner.ne, 'x'), right, 'ne is on the right');
  assert.equal(num(byCorner.ne, 'y'), top, 'ne is on top');
  assert.equal(num(byCorner.sw, 'x'), left, 'sw is on the left');
  assert.equal(num(byCorner.sw, 'y'), bot, 'sw is on the bottom');
  assert.equal(num(byCorner.se, 'x'), right, 'se is on the right');
  assert.equal(num(byCorner.se, 'y'), bot, 'se is on the bottom');
});
