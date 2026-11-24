// TESTER S6b/S6c (client, session 5 follow-up). Two adaptations, verbatim intent:
//   (a) "keep the stroke weight a fixed value for the preview, otherwise if the stroke
//        weight is too big, we can't see the solid color anymore. so keep it at 2 or 3 px
//        max just for preview."
//   (b) "If the window size is too small, we loose the visibility of the toolbar. In that
//        case, the swatch preview should live inside a dropdown that opens. I like the way
//        it's instantly available, but we need to accommodate for every screen size."
// Spec: docs/specs/S6-style-swatches.md sections 6 and 7.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDom } from './dom_stub.js';
import { DEFAULT_STYLE, STYLE_PRESETS, styleKeyOf, swatchPatchOf } from '../src/styles.js';
import { swatchMarkup, SWATCH_STROKE_MAX } from '../src/render.js';

const EMPTY_DOC = JSON.stringify({ app: 'sketchboard', version: 1, elements: [] });

async function bootApp(deps = {}) {
  const { doc, win } = makeDom();
  globalThis.document = doc; globalThis.window = win;
  const mod = await import('../src/app.js');
  const root = doc.createElement('div');
  const map = new Map([['sketchboard.doc.v1', EMPTY_DOC]]);
  const storage = { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k) };
  const api = mod.boot(root, Object.assign({ storage, hash: '', download() {}, debounceMs: 0 }, deps));
  const topbar = root.children.find((c) => c.classList && c.classList.contains('topbar'));
  const q = (cls) => (root.querySelectorAll('.' + cls) || [])[0];
  const stripOf = (cls) => { const b = q(cls); return b ? (b.children || []).find((c) => c.classList && c.classList.contains('swatch-strip')) : null; };
  const swatchesOf = (cls) => { const s = stripOf(cls); return s ? (s.children || []).filter((c) => c.classList && c.classList.contains('swatch')) : []; };
  const artOf = (btn) => ((btn.children || []).find((x) => x.attrs && x.attrs.class === 'swatch-svg') || {}).innerHTML || '';
  return { api, root, win, topbar, q, swatchesOf, artOf };
}
const mk = (api, style, x = 0) => {
  const el = api.store.createElement('rect', { x, y: 0, w: 40, h: 40 }, { ...DEFAULT_STYLE, ...style });
  api.store.addElement(el); return el;
};
const sw = (o) => Number(/stroke-width="([^"]*)"/.exec(o)[1]);

// ============================================================ (a) STROKE CLAMP
test('S6b-1 miniature clamps a fat outline to the cap so the FILL stays visible', () => {
  assert.equal(SWATCH_STROKE_MAX <= 3, true, 'cap is 2-3px per the client brief, got ' + SWATCH_STROKE_MAX);
  assert.equal(sw(swatchMarkup({ ...DEFAULT_STYLE, strokeWidth: 20 })), SWATCH_STROKE_MAX, '20 -> cap');
  assert.equal(sw(swatchMarkup({ ...DEFAULT_STYLE, strokeWidth: 99 })), SWATCH_STROKE_MAX, '99 -> cap');
});

test('S6b-2 at/below the cap the real width is depicted untouched (no flattening)', () => {
  for (const w of [0, 1, 2, SWATCH_STROKE_MAX]) {
    assert.equal(sw(swatchMarkup({ ...DEFAULT_STYLE, strokeWidth: w })), w, `${w}px must depict as ${w}`);
  }
});

test('S6b-3 HONESTY BOUNDARY: the clamp changes the PICTURE only - identity and what a click writes keep the real width', () => {
  const fat = { ...DEFAULT_STYLE, fill: '#ff0000', strokeWidth: 20 };
  const fatter = { ...DEFAULT_STYLE, fill: '#ff0000', strokeWidth: 40 };
  const thin = { ...DEFAULT_STYLE, fill: '#ff0000', strokeWidth: 2 };
  // Two DIFFERENT over-cap widths collapse to identical pixels - that is the whole point
  // of the clamp. (First draft compared 20 against 2 here, which was nonsense: 2 is under
  // the cap and must keep depicting 2 - S6b-2 pins that.)
  const depictedOf = (s) => sw(swatchMarkup(s));
  assert.equal(depictedOf(fat), SWATCH_STROKE_MAX);
  assert.equal(depictedOf(fatter), SWATCH_STROKE_MAX, '20px and 40px are indistinguishable in the thumbnail');
  // ...but they are NOT the same style, and a click still writes the true value.
  assert.notEqual(styleKeyOf(fat), styleKeyOf(fatter), 'clamping must NOT merge distinct styles');
  assert.notEqual(styleKeyOf(fat), styleKeyOf(thin), 'and not across the cap either');
  assert.equal(swatchPatchOf(fat).strokeWidth, 20, 'click still WRITES 20');
  assert.equal(swatchPatchOf(thin).strokeWidth, 2, 'click still WRITES 2');
});

test('S6b-4 junk strokeWidth cannot produce NaN markup through the clamp', () => {
  for (const bad of [undefined, null, 'abc', NaN]) {
    const m = swatchMarkup({ ...DEFAULT_STYLE, strokeWidth: bad });
    assert.ok(!/NaN/.test(m), `no NaN leaks for ${String(bad)}: ${m}`);
    assert.match(m, /stroke-width="[^"]*"/, 'attribute always present');
  }
});

test('S6b-5 integration: a thick-outline shape gets a readable chip AND keeps its real width after applying', async () => {
  const { api, swatchesOf, artOf } = await bootApp();
  const src = mk(api, { fill: '#ff0000', strokeWidth: 24 }, 0);
  const target = mk(api, { fill: '#ffffff', strokeWidth: 1 }, 80);
  api.render();
  const chip = swatchesOf('recent-styles')[0];
  assert.equal(sw(artOf(chip)), SWATCH_STROKE_MAX, 'chip shows the fill, not a black blob');
  assert.match(artOf(chip), /fill="#ff0000"/, 'fill still legible next to the clamped outline');
  assert.match(chip.title, /@24/, 'tooltip still tells the TRUTH about the width: ' + chip.title);
  api.store.select([target.id]); api.render();
  swatchesOf('recent-styles')[0].dispatch('click');
  assert.equal(api.store.get(target.id).style.strokeWidth, 24, 'applying restores the REAL 24px');
  void src;
});

test('S6b-6 presets obey the same rule (bold preset draws capped but still writes 5)', async () => {
  const { api, swatchesOf, artOf } = await bootApp();
  const target = mk(api, { ...DEFAULT_STYLE }, 0);
  api.render();
  const bold = swatchesOf('preset-styles').find((s) => (s.title || '').includes('bold'));
  assert.equal(STYLE_PRESETS.bold.strokeWidth > SWATCH_STROKE_MAX, true, 'precondition: bold really is thicker than the cap');
  assert.equal(sw(artOf(bold)), SWATCH_STROKE_MAX, 'preset miniature capped too - same mechanism');
  assert.match(artOf(bold), new RegExp('fill="' + STYLE_PRESETS.bold.fill + '"'), 'and its fill is still visible');
  api.store.select([target.id]); api.render();
  swatchesOf('preset-styles').find((s) => (s.title || '').includes('bold')).dispatch('click');
  assert.equal(api.store.get(target.id).style.strokeWidth, STYLE_PRESETS.bold.strokeWidth, 'click writes the TRUE preset width');
});

// ==================================================== (b) RESPONSIVE DROPDOWN
test('S6c-1 wide window: galleries inline, dropdown toggle hidden (instant availability kept)', async () => {
  const { api, root, topbar, q, win } = await bootApp();
  win.innerWidth = 1440; win.dispatch('resize');
  assert.equal(topbar.classList.contains('topbar-compact'), false, 'not compact at 1440');
  const t = q('gallery-toggle');
  assert.ok(t, '.gallery-toggle exists');
  assert.equal(t.hidden, true, 'toggle hidden on a wide screen - nothing extra to click');
  assert.ok(q('recent-styles') && q('preset-styles'), 'both galleries present');
  assert.equal(q('style-gallery').classList.contains('open'), false, 'dropdown starts closed');
});

test('S6c-2 narrow window: galleries collapse behind a VISIBLE dropdown toggle', async () => {
  const { api, q, win, topbar } = await bootApp();
  win.innerWidth = 520; win.dispatch('resize');
  assert.equal(topbar.classList.contains('topbar-compact'), true, 'compact class applied');
  const t = q('gallery-toggle');
  assert.equal(t.hidden, false, 'toggle becomes available exactly when space runs out');
  assert.equal(q('style-gallery').classList.contains('open'), false, 'starts CLOSED, not sprawled over a small screen');
});

test('S6c-3 the toggle opens and closes the dropdown, and reports state via aria-expanded', async () => {
  const { api, q, win } = await bootApp();
  win.innerWidth = 520; win.dispatch('resize');
  const t = q('gallery-toggle'), g = q('style-gallery');
  t.dispatch('click');
  assert.equal(g.classList.contains('open'), true, 'opens');
  assert.equal(t.getAttribute('aria-expanded'), 'true', 'assistive tech told it is open');
  t.dispatch('click');
  assert.equal(g.classList.contains('open'), false, 'closes again');
  assert.equal(t.getAttribute('aria-expanded'), 'false');
});

test('S6c-4 swatches stay FUNCTIONAL inside the collapsed dropdown (availability is visual, not behavioural)', async () => {
  const { api, q, win, swatchesOf } = await bootApp();
  mk(api, { fill: '#ff0000', strokeWidth: 4 }, 0);
  const target = mk(api, { fill: '#ffffff' }, 80);
  api.render();
  win.innerWidth = 520; win.dispatch('resize');            // collapsed, never opened
  assert.equal(q('style-gallery').classList.contains('open'), false, 'precondition: still collapsed');
  api.store.select([target.id]); api.render();
  swatchesOf('recent-styles')[0].dispatch('click');
  assert.equal(api.store.get(target.id).style.fill, '#ff0000', 'clicking through the collapsed panel works');
});

test('S6c-5 going back to a wide window un-compacts AND clears a stale open state', async () => {
  const { api, q, win, topbar } = await bootApp();
  win.innerWidth = 520; win.dispatch('resize');
  q('gallery-toggle').dispatch('click');
  assert.equal(q('style-gallery').classList.contains('open'), true, 'precondition: opened while narrow');
  win.innerWidth = 1600; win.dispatch('resize');
  assert.equal(topbar.classList.contains('topbar-compact'), false, 'un-compacted');
  assert.equal(q('gallery-toggle').hidden, true, 'toggle hidden again');
  assert.equal(q('style-gallery').classList.contains('open'), false, 'no orphan "open" left behind');
});

test('S6c-6 threshold is deterministic and exported (boundary belongs to the INLINE side)', async () => {
  const m = await import('../src/app.js');
  assert.ok(Number.isFinite(m.COMPACT_MAX_WIDTH) && m.COMPACT_MAX_WIDTH > 0, 'threshold exported');
  const { topbar, win } = await bootApp();
  win.innerWidth = m.COMPACT_MAX_WIDTH; win.dispatch('resize');
  assert.equal(topbar.classList.contains('topbar-compact'), false, `exactly ${m.COMPACT_MAX_WIDTH} is inline`);
  win.innerWidth = m.COMPACT_MAX_WIDTH - 1; win.dispatch('resize');
  assert.equal(topbar.classList.contains('topbar-compact'), true, 'one pixel narrower compacts');
});

test('S6c-7 compact state is correct AT BOOT (no flash of an overflowing bar before the first resize)', async () => {
  const { doc, win } = makeDom();
  globalThis.document = doc; globalThis.window = win;
  win.innerWidth = 480;                                        // narrow BEFORE boot()
  const mod = await import('../src/app.js');
  const root = doc.createElement('div');
  const map = new Map([['sketchboard.doc.v1', EMPTY_DOC]]);
  const storage = { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)) };
  mod.boot(root, { storage, hash: '', download() {}, debounceMs: 0 });
  const topbar = root.children.find((c) => c.classList && c.classList.contains('topbar'));
  assert.equal(topbar.classList.contains('topbar-compact'), true, 'boot already knows the window is small');
});
