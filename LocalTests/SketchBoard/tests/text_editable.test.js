// TESTER T10 (RED): client report session 4 — "I can't edit a text field. Would be
// nice if on double click, the text become editable again."
//
// Headless probe fact: the dblclick HANDLER works (full gesture opened the editor when
// the press landed inside the ESTIMATED bbox). The suspect is therefore reachability:
// geometry.hitTestElement('text') tests the BARE estimated bbox with ZERO tolerance,
// while every other type gets the padded rect. Real glyph advance widths exceed the
// len*fontSize*0.6 estimate, so presses toward the END of a word miss pick() -> the
// dblclick handler picks null -> SILENT NOTHING. (Mock-vs-reality trap: the DOM stub
// agrees with the estimate, so no existing suite can see this — same class as the PNG
// CanvasCtor bug. We pin what IS provable headlessly; final confirmation is the client.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../src/geometry.js';
import { makeDom } from './dom_stub.js';

// ---------------------------------------------------- T10-G1 tolerance parity
test('T10-G1 text hit-testing honours the tolerance pad like every other type', () => {
  const el = { type: 'text', x: 0, y: 100, text: 'hi', style: { fontSize: 20 } };
  const b = G.bboxOfElement(el);                       // estimate: w=24 h=25
  assert.equal(b.w, 24, 'estimate sanity');
  const tol = 6;
  // 3 world units OUTSIDE the estimate, INSIDE tolerance -> must hit (user sees glyphs here)
  assert.equal(G.hitTestElement(el, { x: b.x + b.w + 3, y: b.y + b.h / 2 }, tol), true,
    'press just past the estimated right edge is still on-screen glyph territory');
  // well outside -> must miss (no giant invisible hit zone)
  assert.equal(G.hitTestElement(el, { x: b.x + b.w + 20, y: b.y + b.h / 2 }, tol), false);
});

// --------------------------------------------- T10-E1 dblclick reaches the editor
async function bootApp() {
  const { doc, win } = makeDom();
  globalThis.document = doc; globalThis.window = win;
  const mod = await import('../src/app.js');
  const root = doc.createElement('div');
  const map = new Map();
  const storage = { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k) };
  // debounceMs: 0 — never leave a long pending timer behind: node --test waits for the
  // event loop to drain, and a 99999ms debounce would stall the runner (learned the
  // hard way: it hung the mutation harness past its budget).
  const api = mod.boot(root, { storage, hash: '', download() {}, debounceMs: 0 });
  const svg = root.children.find((c) => c.tagName === 'SVG');
  return { api, root, svg, win, doc };
}
const pt = (x, y, o = {}) => ({ button: 0, shiftKey: false, clientX: x, clientY: y, ...o });

test('T10-E1 double-click PAST the estimated text edge still opens the editor', async () => {
  const { api, root, svg, win } = await bootApp();
  const txt = api.store.createElement('text', { x: 200, y: 200, text: 'hello world' }, { fontSize: 30 });
  api.store.addElement(txt);
  const b = G.bboxOfElement(txt);                      // estimate ends BEFORE real glyph end
  const sp = api.viewport.worldToScreen({ x: b.x + b.w + 3, y: b.y + b.h / 2 });
  for (let i = 0; i < 2; i++) {
    svg.dispatch('mousedown', pt(sp.x, sp.y));
    win.dispatch('mouseup', pt(sp.x, sp.y));
  }
  svg.dispatch('dblclick', pt(sp.x, sp.y));
  const ta = root.children.find((c) => c.tagName === 'TEXTAREA');
  assert.ok(ta, 'editor must open even where the estimate says "no element"');
  assert.equal(ta.value, 'hello world');
  api.autosave.stop();                             // detach store listener, no stray timers
});

// ------------------------------------------- T10-C1 editor beats user-select:none
// #app sets user-select:none (correct for a canvas). It INHERITS into the editor
// <textarea>, breaking double/triple-click word selection and drag-select editing in
// real browsers. The editor must opt back in explicitly. (Source-pattern assertion —
// same convention as app.test.js whitelist checks; CSS is not executable headlessly.)
import { readFileSync } from 'node:fs';
test('T10-C1 .text-editor overrides inherited user-select:none', () => {
  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  const rule = /\.text-editor\s*{[^}]*}/.exec(css);
  assert.ok(rule, '.text-editor rule exists');
  assert.match(rule[0], /user-select:\s*text/, 'editor must allow selecting its text');
  assert.match(rule[0], /-webkit-user-select:\s*text/, 'Safari needs the prefixed form');
});
