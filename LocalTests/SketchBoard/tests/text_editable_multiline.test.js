// TESTER T10-B (RED): client S4 second report - "T10: still cannot edit text".
// ROOT CAUSE (PROVABLE FROM OUR OWN SOURCE, no font-metric guesswork this time):
// render.js case 'text' draws tspan i at baseline y = el.y + i*fontSize*1.25 -> lines
// stack DOWNWARD from el.y. But geometry.bboxOfElement placed the WHOLE estimated
// height ABOVE el.y (y = el.y - 0.85*h). For multi-line text the hit box therefore
// floats clear of the painted glyphs: every line below the first is un-hittable, so
// dblclick -> pick() -> null -> SILENT NOTHING. Single-line survived by luck (first
// baseline falls inside the wrong band) - which is why the T10 round 1 looked fine on
// the single-line seed scene. Contract source of truth: render.js tspans.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../src/geometry.js';
import { makeDom } from './dom_stub.js';

const ml = (fs = 30, n = 3) => ({
  type: 'text', x: 100, y: 200,
  text: Array.from({ length: n }, (_, i) => `line ${i + 1}`).join('\n'),
  style: { fontSize: fs },
});
const baseline = (el, i) => el.y + i * (el.style.fontSize * 1.25);   // render.js contract

test('T10-B1 double-click lands on EVERY line of multi-line text (hit-test)', () => {
  const el = ml();
  for (let i = 0; i < 3; i++) {
    const p = { x: el.x + 4 * el.style.fontSize * 0.6, y: baseline(el, i) };
    assert.equal(G.hitTestElement(el, p, 6), true, `press on the glyphs of line ${i + 1} must hit`);
  }
});

test('T10-B2 bbox top hugs the FIRST baseline (cap height), not 0.85*totalHeight above it', () => {
  const el = ml();
  const b = G.bboxOfElement(el);
  const fs = el.style.fontSize;
  assert.ok(Math.abs(b.y - (el.y - G.TEXT_ASCENT_RATIO * fs)) < 1e-9,
    `bbox.y ${b.y} must equal el.y - TEXT_ASCENT_RATIO*fs (${el.y - 0.8 * fs})`);
  // sanity: the first-line glyph band is inside the box
  assert.ok(b.y <= baseline(el, 0) - 0.5 * fs && b.y + b.h >= baseline(el, 0), 'line 1 inside');
});

test('T10-B3 bbox bottom covers the LAST baseline plus descenders', () => {
  const el = ml(30, 4);
  const b = G.bboxOfElement(el);
  const last = baseline(el, 3);
  assert.ok(b.y <= last && b.y + b.h >= last + 0.2 * el.style.fontSize,
    `bottom ${b.y + b.h} must reach past last baseline ${last} + descender`);
});

test('T10-B4 e2e: double-click on the LAST painted line opens the editor', async () => {
  const { doc, win } = makeDom();
  globalThis.document = doc; globalThis.window = win;
  const mod = await import('../src/app.js');
  const root = doc.createElement('div');
  const map = new Map();
  const storage = { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k) };
  const api = mod.boot(root, { storage, hash: '', download() {}, debounceMs: 0 });
  const txt = api.store.createElement('text', { x: 150, y: 220, text: 'first line\nsecond line\nthird line' }, { fontSize: 28 });
  api.store.addElement(txt);
  const svg = root.children.find((c) => c.tagName === 'SVG');
  const pt = (x, y) => ({ button: 0, shiftKey: false, clientX: x, clientY: y });
  const world = { x: 150 + 5 * 28 * 0.6, y: 220 + 2 * 28 * 1.25 };      // mid of THIRD line
  const sp = api.viewport.worldToScreen(world);
  for (let i = 0; i < 2; i++) {
    svg.dispatch('mousedown', pt(sp.x, sp.y));
    win.dispatch('mouseup', pt(sp.x, sp.y));
  }
  svg.dispatch('dblclick', pt(sp.x, sp.y));
  const ta = root.children.find((c) => c.tagName === 'TEXTAREA');
  assert.ok(ta, 'editor must open when the third painted line is double-clicked');
  assert.equal(ta.value, 'first line\nsecond line\nthird line');
  api.autosave.stop();
});

test('T10-B6 the RENDERER consumes the contract (no private line-height literal)', async () => {
  // The whole point of the contract constants is that paint and hit-testing cannot
  // drift apart. Pin it: parsed tspan dy MUST equal fs*TEXT_LINE_HEIGHT_RATIO.
  const { elementToSvg } = await import('../src/render.js');
  const markup = elementToSvg(ml(30, 3));
  const dys = [...markup.matchAll(/dy="([\d.]+)"/g)].map((m) => Number(m[1]));
  assert.deepEqual(dys, [0, 37.5, 37.5], 'line spacing comes from TEXT_LINE_HEIGHT_RATIO (30*1.25)');
});

test('T10-B5 single-line regression guard (round-1 behaviour preserved)', () => {
  const el = { type: 'text', x: 10, y: 50, text: 'solo', style: { fontSize: 20 } };
  assert.equal(G.hitTestElement(el, { x: 10 + 2 * 20 * 0.6, y: 50 - 0.4 * 20 }, 6), true, 'above baseline (cap band) hits');
  assert.equal(G.hitTestElement(el, { x: 10 + 2 * 20 * 0.6, y: 50 + 0.15 * 20 }, 6), true, 'just below baseline (descender) hits');
  assert.equal(G.hitTestElement(el, { x: 10 + 2 * 20 * 0.6, y: 50 + 3 * 20 }, 6), false, 'far below misses');
});
