// TESTER S6 (client, session 5): STYLE SWATCH GALLERIES replace the F2 "Apply style"
// button. Client brief, verbatim intent:
//   "replace the apply style by a recent Style menu. it shows all the current styles in use
//    in the forms of the drawing, and when clicking on a style, it applies the style to the
//    current selected forms. At launch, a quick run on the drawing, and create a miniature of
//    the style for each style applied to the forms in the draw. While you are on it, make the
//    presets the exactly the same, with a miniature preview of the preset style."
// Spec: docs/specs/S6-style-swatches.md
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDom } from './dom_stub.js';
import { DEFAULT_STYLE, STYLE_PRESETS, collectUsedStyles, styleKeyOf, normalizeStyleForSwatch, swatchPatchOf, SWATCH_KEYS, MAX_RECENT_SWATCHES } from '../src/styles.js';
import { swatchMarkup } from '../src/render.js';

/** A VALID, EMPTY stored document. Why this matters: boot() SEEDS a welcome demo whenever
 *  storage reads 'none' (MAJOR-4 rule - only 'none' may be seeded over). Tests that assume
 *  "the canvas is mine" must therefore start from a real empty doc, or the seed's own styles
 *  occupy the first swatch slots (this bit the first draft: slot [0] was #eef4ff, the seed
 *  banner's fill, and three assertions failed on it). */
const EMPTY_DOC = JSON.stringify({ app: 'sketchboard', version: 1, elements: [] });

async function bootApp(deps = {}) {
  const { doc, win } = makeDom();
  globalThis.document = doc; globalThis.window = win;
  const mod = await import('../src/app.js');
  const root = doc.createElement('div');
  const map = new Map([['sketchboard.doc.v1', EMPTY_DOC]]);
  const storage = { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k) };
  const api = mod.boot(root, Object.assign({ storage, hash: '', download() {}, debounceMs: 0 }, deps));
  const hud = () => (root.querySelectorAll('.hud') || [])[0];
  const box = (cls) => (root.querySelectorAll('.' + cls) || [])[0];
  // Each gallery: <div class="preset-box recent-styles"><span/><div class="swatch-strip">...
  const stripOf = (cls) => { const b = box(cls); return b ? (b.children || []).find((c) => c.classList && c.classList.contains('swatch-strip')) : null; };
  const swatchesOf = (cls) => { const s = stripOf(cls); return s ? (s.children || []).filter((c) => c.classList && c.classList.contains('swatch')) : []; };
  return { api, root, hud, box, stripOf, swatchesOf };
}
const mk = (api, style, x = 0) => {
  const el = api.store.createElement('rect', { x, y: 0, w: 40, h: 40 }, { ...DEFAULT_STYLE, ...style });
  api.store.addElement(el); return el;
};

// ------------------------------------------------------------------ structure
test('S6-1 two labelled galleries exist; the Apply-style button is GONE', async () => {
  const { root, box, stripOf } = await bootApp();
  const recent = box('recent-styles'), presets = box('preset-styles');
  assert.ok(recent, '.recent-styles box exists');
  assert.ok(presets, '.preset-styles box exists');
  for (const [b, want] of [[recent, 'Recent'], [presets, 'Presets']]) {
    const label = (b.children || []).find((c) => c.classList && c.classList.contains('preset-label'));
    assert.ok(label && label.textContent === want, `label reads ${want}`);
    assert.ok(stripOf(b === recent ? 'recent-styles' : 'preset-styles'), 'has a .swatch-strip');
  }
  assert.equal((root.querySelectorAll('.apply-style') || []).length, 0, 'the meaningless button is removed');
});

// ------------------------------------------------------- "quick run on the drawing"
test('S6-2 at launch: one miniature per DISTINCT style in use, document order of first use', async () => {
  const { api, swatchesOf } = await bootApp();
  const a = mk(api, { fill: '#ff0000' }, 0);
  const b = mk(api, { fill: '#00ff00' }, 60);
  const c = mk(api, { fill: '#ff0000' }, 120);          // duplicate of a
  api.render();
  const sw = swatchesOf('recent-styles');
  assert.equal(sw.length, 2, 'distinct styles only, got ' + sw.length);
  const arts = sw.map((s) => ((s.children || []).find((x) => x.attrs && x.attrs.class === 'swatch-svg') || {}).innerHTML || '');
  assert.match(arts[0], /fill="#ff0000"/, 'first slot == bottom-most element style');
  assert.match(arts[1], /fill="#00ff00"/, 'second slot == next new style');
  // Tight pin: the counter must be the MULTIPLICATION marker my implementation emits
  // (`· 2×`). A looser /2/ would pass on any colour or width containing the digit 2.
  assert.ok(sw.some((s) => /·\s*2×/.test(s.title || '')), 'duplicate style is counted, titles: ' + sw.map((s) => s.title).join(' | '));
  void a; void b; void c;
});

test('S6-3 preset gallery mirrors STYLE_PRESETS exactly, same miniature mechanism', async () => {
  const { swatchesOf } = await bootApp();
  const names = Object.keys(STYLE_PRESETS);
  const sw = swatchesOf('preset-styles');
  assert.equal(sw.length, names.length, 'one swatch per preset');
  for (const n of names) assert.ok(sw.some((s) => (s.title || '').includes(n)), `preset ${n} present`);
  // Same renderer as the recent gallery -> miniature shows the preset's own colours.
  const bold = sw.find((s) => (s.title || '').includes('bold'));
  const art = ((bold.children || []).find((x) => x.attrs && x.attrs.class === 'swatch-svg') || {}).innerHTML || '';
  assert.match(art, new RegExp('fill="' + STYLE_PRESETS.bold.fill + '"'), 'preset miniature paints the preset fill');
  // S6b REVISION: this used to pin stroke-width == the preset's own 5. The client asked for
  // the miniature to CLAMP fat outlines so the fill stays visible, so the depicted width is
  // now min(5, SWATCH_STROKE_MAX). Deliberate contract change, not a loosened assertion -
  // style_swatches_responsive S6b-6 proves the click still WRITES the true 5.
  assert.match(art, /stroke-width="3"/, 'bold preset outline drawn at the depiction cap');
});

// ---------------------------------------------------------------------- applying
test('S6-4 clicking a recent swatch applies that style to the selection in ONE undo step', async () => {
  const { api, swatchesOf } = await bootApp();
  mk(api, { fill: '#ff0000', stroke: '#0000ff', strokeWidth: 9, dash: 'dotted' }, 0);
  const target = mk(api, { fill: '#ffffff', stroke: '#000000', strokeWidth: 1 }, 80);
  api.render();
  api.store.select([target.id]); api.render();
  const red = swatchesOf('recent-styles')[0];
  const hist = api.store._history.length;
  red.dispatch('click');
  const s = api.store.get(target.id).style;
  assert.equal(s.fill, '#ff0000'); assert.equal(s.stroke, '#0000ff');
  assert.equal(s.strokeWidth, 9); assert.equal(s.dash, 'dotted');
  assert.equal(api.store._history.length, hist + 1, 'exactly ONE undo step');
  api.store.undo();
  assert.equal(api.store.get(target.id).style.fill, '#ffffff', 'one undo restores everything');
});

test('S6-5 clicking a preset swatch applies the preset to the selection', async () => {
  const { api, swatchesOf } = await bootApp();
  const target = mk(api, { ...DEFAULT_STYLE }, 0);
  api.render();
  api.store.select([target.id]); api.render();
  const ghost = swatchesOf('preset-styles').find((s) => (s.title || '').includes('ghost'));
  ghost.dispatch('click');
  const s = api.store.get(target.id).style;
  assert.equal(s.fill, STYLE_PRESETS.ghost.fill);
  assert.equal(s.opacity, STYLE_PRESETS.ghost.opacity);
  assert.equal(s.dash, STYLE_PRESETS.ghost.dash);
});

test('S6-6 no selection: click is a TOTAL no-op (no history, no style drift) + hint', async () => {
  const { api, swatchesOf, hud } = await bootApp();
  mk(api, { fill: '#ff0000' }, 0);
  api.render();
  const hist = api.store._history.length;
  const pend = JSON.stringify(api.store.pendingStyle);
  swatchesOf('recent-styles')[0].dispatch('click');
  assert.equal(api.store._history.length, hist, 'no history entry without a selection');
  assert.equal(JSON.stringify(api.store.pendingStyle), pend, 'pending style untouched');
  // SELF-AUDIT: first draft asserted /select/i - TOOTHLESS, because the status bar always
  // ends with the active tool name ("... · select"), so it matched even when no hint was
  // shown. Pin the actual sentence instead.
  assert.match((hud() && hud().textContent) || '', /select object\(s\) first/i,
    'user is told WHY nothing happened, got: ' + (hud() && hud().textContent));
});

test('S6-7 re-applying the SAME style pushes NO history entry (D-S6-4)', async () => {
  const { api, swatchesOf } = await bootApp();
  const a = mk(api, { fill: '#ff0000' }, 0);
  api.render();
  api.store.select([a.id]); api.render();
  const sw = swatchesOf('recent-styles')[0];
  const hist = api.store._history.length;
  sw.dispatch('click');
  assert.equal(api.store._history.length, hist, 'invisible no-op must not pollute undo');
  sw.dispatch('click');
  assert.equal(api.store._history.length, hist, 'still zero after a second click');
});

test('S6-8 multi-selection: every selected object receives the style', async () => {
  const { api, swatchesOf } = await bootApp();
  mk(api, { fill: '#ff0000', strokeWidth: 6 }, 0);
  const t1 = mk(api, { fill: '#ffffff' }, 80);
  const t2 = mk(api, { fill: '#eeeeee' }, 160);
  api.render();
  api.store.select([t1.id, t2.id]); api.render();
  swatchesOf('recent-styles')[0].dispatch('click');
  assert.equal(api.store.get(t1.id).style.fill, '#ff0000');
  assert.equal(api.store.get(t2.id).style.fill, '#ff0000');
});

// ------------------------------------------------- HONESTY RULE (D-S6-5) - the trap
test('S6-9 text keys are OUTSIDE swatch identity and are NEVER written by a swatch', async () => {
  const { api, swatchesOf } = await bootApp();
  // Two shapes identical except FONT -> must collapse to ONE swatch (a rect miniature
  // cannot show a typeface, so two look-alike chips would be a lie).
  const a = mk(api, { fill: '#ff0000', fontFamily: 'cursive', fontSize: 11 }, 0);
  const b = mk(api, { fill: '#ff0000', fontFamily: 'Georgia, serif', fontSize: 99 }, 60);
  api.render();
  assert.equal(swatchesOf('recent-styles').length, 1, 'font-only difference must NOT split the swatch');
  api.store.select([a.id, b.id]); api.render();
  const chip = swatchesOf('recent-styles')[0];
  chip.dispatch('click');
  assert.equal(api.store.get(a.id).style.fontSize, 11, 'swatch click must not restyle text');
  assert.equal(api.store.get(a.id).style.fontFamily, 'cursive');
  assert.equal(api.store.get(b.id).style.fontSize, 99);
  assert.equal(api.store.get(b.id).style.fontFamily, 'Georgia, serif');
});

test('S6-18 a chip written from a REAL drawing cannot smuggle non-depicted keys onto the target', async () => {
  // Why this test exists: the galleries hand the click handler the element's RAW style, so
  // swatchPatchOf() is the only thing standing between "click a colour chip" and "silently
  // restyle text / flip arrowheads". Mutant M67 (spread the whole style instead of the
  // filtered patch) SURVIVED until this test existed - earlier chips were fed pre-normalised
  // data, so filtering vs not filtering was literally indistinguishable.
  const { api, swatchesOf } = await bootApp();
  const srcShape = mk(api, {
    fill: '#ff0000', strokeWidth: 6,
    fontFamily: 'cursive', fontSize: 77, fontStyle: 'italic',
    startArrowhead: true, endArrowhead: false, arrowSize: 99,
  }, 0);
  // Target differs in a DEPICTED key, so the apply is a real change (not an idempotent no-op).
  const target = mk(api, { ...DEFAULT_STYLE }, 80);
  api.render();
  const before = { ...api.store.get(target.id).style };
  api.store.select([target.id]); api.render();
  const chip = swatchesOf('recent-styles').find((s) => /#ff0000/.test(s.title || ''));
  assert.ok(chip, 'the red chip exists, titles: ' + swatchesOf('recent-styles').map((s) => s.title).join(' | '));
  chip.dispatch('click');
  const e = api.store.get(target.id);
  // Depicted keys DID transfer...
  assert.equal(e.style.fill, '#ff0000', 'fill transferred');
  assert.equal(e.style.strokeWidth, 6, 'stroke width transferred');
  // ...and nothing else moved.
  assert.equal(e.style.fontFamily, before.fontFamily, 'font family must survive a colour-chip click');
  assert.equal(e.style.fontSize, before.fontSize, 'font size must survive');
  assert.equal(e.style.fontStyle, before.fontStyle, 'font style must survive');
  assert.equal(e.style.startArrowhead, before.startArrowhead, 'arrowheads must survive');
  assert.equal(e.style.endArrowhead, before.endArrowhead, 'arrowheads must survive');
  assert.equal(e.style.arrowSize, before.arrowSize, 'arrow size must survive');
});
test('S6-10 miniature is painted by render.swatchMarkup with the style\'s own attributes', () => {
  const m = swatchMarkup({ ...DEFAULT_STYLE, fill: '#123456', stroke: '#654321', strokeWidth: 3, opacity: 0.5, dash: 'dashed' });
  assert.match(m, /class="swatch-art"/, 'wrapped for CSS/tests');
  assert.match(m, /^<g[^>]*><rect /, 'a real rect through the real renderer');
  assert.match(m, /fill="#123456"/); assert.match(m, /stroke="#654321"/);
  assert.match(m, /stroke-width="3"/); assert.match(m, /opacity="0.5"/);
  assert.match(m, /stroke-dasharray="8 4"/, 'dash pattern honoured');
});

test('S6-11 hostile style value cannot break out of the miniature attribute', () => {
  const evil = '#fff" onload="alert(1)';
  const m = swatchMarkup({ ...DEFAULT_STYLE, fill: evil });
  assert.ok(!m.includes('" onload='), 'no attribute breakout: ' + m);
  assert.ok(m.includes('&quot;'), 'quotes escaped, not deleted');
  assert.equal((m.match(/"/g) || []).length % 2, 0, 'attribute quotes stay balanced');
});

test('S6-12 gallery follows the drawing: new style appears, and cached renders reuse nodes', async () => {
  const { api, swatchesOf } = await bootApp();
  mk(api, { fill: '#ff0000' }, 0);
  api.render();
  const first = swatchesOf('recent-styles')[0];
  api.render(); api.render();
  assert.equal(swatchesOf('recent-styles')[0], first, 'unchanged content must NOT rebuild nodes (hover/focus survive)');
  mk(api, { fill: '#00ff00' }, 60);
  api.render();
  const sw = swatchesOf('recent-styles');
  assert.equal(sw.length, 2, 'a genuinely new style adds a swatch');
  assert.notEqual(sw[0], first, 'content change DOES rebuild');
});

test('S6-13 gallery is capped (a 10k-object drawing cannot build 10k nodes)', async () => {
  const { api, swatchesOf } = await bootApp();
  for (let i = 0; i < MAX_RECENT_SWATCHES + 12; i++) mk(api, { fill: '#0f0f0f', strokeWidth: i + 1 }, i * 10);
  api.render();
  assert.equal(swatchesOf('recent-styles').length, MAX_RECENT_SWATCHES, 'hard cap honoured');
});

// ---------------------------------------------------------------- pure-unit pins
test('S6-14 identity is canonical: colour case, numeric strings, missing keys', () => {
  const k1 = styleKeyOf({ fill: '#ABCDEF', strokeWidth: '3', opacity: 1 });
  const k2 = styleKeyOf({ fill: '#abcdef', strokeWidth: 3 });
  assert.equal(k1, k2, 'same style spelled differently => same key');
  assert.notEqual(styleKeyOf({ fill: '#abcdee' }), k1, 'different colour => different key');
  assert.deepEqual(Object.keys(normalizeStyleForSwatch({ fill: '#FFF' })).sort(), [...SWATCH_KEYS].sort());
  // SELF-AUDIT: the first draft wrote !('fontFamily' in SWATCH_KEYS) - meaningless, because
  // `in` on an ARRAY tests INDICES, so it passed no matter what. Use includes().
  assert.equal(SWATCH_KEYS.includes('fontFamily'), false, 'fonts excluded from identity');
  assert.equal(SWATCH_KEYS.includes('fontSize'), false, 'sizes excluded from identity');
  assert.equal(SWATCH_KEYS.length, 8, 'exactly the eight depicted keys');
});

test('S6-15 what a swatch WRITES equals what a swatch IS (identity keys == patch keys)', () => {
  const patch = swatchPatchOf({ ...DEFAULT_STYLE, fill: '#ff0000', fontFamily: 'cursive', fontSize: 77, startArrowhead: true });
  assert.deepEqual(Object.keys(patch).sort(), [...SWATCH_KEYS].sort(), 'patch covers exactly the depicted keys');
  assert.equal(patch.fontFamily, undefined, 'no font leakage into a swatch click');
  assert.equal(patch.startArrowhead, undefined, 'no arrowhead leakage either');
});

// The client asked for a "quick run on the drawing" AT LAUNCH. Booting with NO storage is
// the only way to exercise that path for real: it lands on the MAJOR-4 'none' branch and the
// welcome demo gets seeded, so the galleries must already be populated before any edit.
test('S6-17 launch sweep: a freshly seeded board already shows its styles', async () => {
  const { doc, win } = makeDom();
  globalThis.document = doc; globalThis.window = win;
  const mod = await import('../src/app.js');
  const root = doc.createElement('div');
  const api = mod.boot(root, { storage: null, hash: '', download() {}, debounceMs: 0 });
  const strip = (root.querySelectorAll('.recent-styles') || [])[0];
  const s = ((strip && strip.children) || []).find((c) => c.classList && c.classList.contains('swatch-strip'));
  const sw = ((s && s.children) || []).filter((c) => c.classList && c.classList.contains('swatch'));
  assert.ok(api.store.elements.length > 0, 'precondition: welcome demo actually seeded');
  assert.ok(sw.length >= 2, `seeded styles collected, got ${sw.length}`);
  assert.ok(sw.length <= MAX_RECENT_SWATCHES, 'cap holds at launch too');
  for (const b of sw) {
    const art = (b.children || []).find((x) => x.attrs && x.attrs.class === 'swatch-svg');
    assert.ok(art && /<rect /.test(art.innerHTML || ''), 'every launch swatch carries painted art');
  }
});

test('S6-16 collectUsedStyles counts duplicates and keeps first-use order', () => {
  const els = [
    { type: 'rect', style: { fill: '#ff0000' } },
    { type: 'rect', style: { fill: '#00ff00' } },
    { type: 'rect', style: { fill: '#ff0000' } },
    { type: 'rect', style: { fill: '#ff0000' } },
  ];
  const used = collectUsedStyles(els);
  assert.equal(used.length, 2);
  assert.equal(used[0].style.fill, '#ff0000'); assert.equal(used[0].count, 3);
  assert.equal(used[1].style.fill, '#00ff00'); assert.equal(used[1].count, 1);
  assert.deepEqual(collectUsedStyles([]), [], 'empty drawing => empty gallery, no throw');
  assert.deepEqual(collectUsedStyles(null), [], 'null-safe');
});
