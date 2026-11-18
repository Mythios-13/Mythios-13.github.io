// TESTER T6 (RED) - live draw preview must BE the real form, not a bounding box.
// Core guarantee (oracle): mid-drag preview markup and post-commit scene markup
// describe the SAME geometry. Both must come from render.elementToSvg, so they
// cannot diverge. Grepping for class="preview" is NOT enough - it passed on the
// buggy generic-rect code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDom } from './dom_stub.js';

async function bootApp() {
  const { doc, win } = makeDom();
  globalThis.document = doc; globalThis.window = win;
  const mod = await import('../src/app.js');
  const root = doc.createElement('div');
  const api = mod.boot(root);
  const svg = root.children.find((c) => c.tagName === 'SVG');
  return { api, root, svg, gScene: svg.children[1], gOverlay: svg.children[2], doc, win };
}
const pt = (x, y, o = {}) => ({ button: 0, shiftKey: false, clientX: x, clientY: y, ...o });

/** Strip identity/provisional chrome so two markups can be compared geometrically. */
const norm = (m) => (m || '')
  .replace(/<g[^>]*>|<\/g>/g, '')
  .replace(/\s(data-id|data-head-of|class|opacity)="[^"]*"/g, '')
  .replace(/\s+/g, ' ').trim();

/** The provisional markup inside the overlay group (excludes selection boxes). */
function previewPart(html) {
  const g = /<g[^>]*class="preview"[^>]*>([\s\S]*?)<\/g>/.exec(html);
  if (g) return g[1];
  return (html || '').split('\n').filter((l) => /class="preview"/.test(l)).join('');
}
/** The committed markup for one element (arrow emits line+head on the same line). */
function scenePart(html, id) {
  return (html || '').split('\n').find((l) => l.includes(`data-id="${id}"`)) || '';
}

/** Drag-create helper: returns {midHtml, committedHtml, id} around one drag. */
async function dragCreate(tool, from, to, extraMoves = []) {
  const ctx = await bootApp();
  const { api, svg, win, gOverlay, gScene } = ctx;
  api.setTool(tool);
  svg.dispatch('mousedown', pt(from.x, from.y));
  for (const mv of extraMoves) win.dispatch('mousemove', { clientX: mv.clientX ?? mv.x, clientY: mv.clientY ?? mv.y });
  win.dispatch('mousemove', { clientX: to.x, clientY: to.y });
  const midHtml = gOverlay.innerHTML;
  win.dispatch('mouseup', { clientX: to.x, clientY: to.y });
  const created = api.store.elements[api.store.elements.length - 1];
  return { ...ctx, midHtml, committedHtml: gScene.innerHTML, id: created.id };
}

// ------------------------------------------------------------- T6-1 real forms
for (const [tool, re, forbidden] of [
  ['rect', /<rect/, null],
  ['ellipse', /<ellipse/, null],
  ['triangle', /<polygon/, null],
  ['diamond', /<polygon/, null],
  ['star', /<polygon/, null],
  ['line', /<line/, null],
  ['arrow', /<line/, null],
]) {
  test(`T6-1 ${tool}: preview renders its REAL tag mid-drag`, async () => {
    const { midHtml } = await dragCreate(tool, { x: 400, y: 300 }, { x: 520, y: 420 });
    const p = previewPart(midHtml);
    assert.ok(p, 'a provisional preview exists mid-drag');
    assert.match(p, re, `${tool} preview must contain ${re}`);
    if (tool !== 'rect' && tool !== 'line') {
      // The bug: everything was a generic <rect>. Only rect legitimately is one.
      assert.ok(!/^<rect[\s>]/.test(norm(p)), `${tool} preview must NOT be a bare <rect>, got: ${norm(p).slice(0, 120)}`);
    }
  });
}

// ------------------------------------------------------------ T6-2 THE ORACLE
for (const tool of ['rect', 'ellipse', 'triangle', 'diamond', 'star', 'line', 'arrow']) {
  test(`T6-2 oracle: ${tool} preview geometry == committed geometry`, async () => {
    const { midHtml, committedHtml, id } = await dragCreate(tool, { x: 400, y: 300 }, { x: 560, y: 460 });
    assert.equal(norm(previewPart(midHtml)), norm(scenePart(committedHtml, id)),
      `${tool}: what you see while dragging must be exactly what lands`);
  });
}
test('T6-2 oracle: freehand preview matches committed smoothed bezier path', async () => {
  const { midHtml, committedHtml, id } = await dragCreate(
    'path', { x: 300, y: 300 }, { x: 500, y: 420 },
    [{ clientX: 360, clientY: 330 }, { clientX: 420, clientY: 390 }, { clientX: 470, clientY: 410 }]);
  assert.equal(norm(previewPart(midHtml)), norm(scenePart(committedHtml, id)),
    'freehand preview must use the SAME bezier smoothing as the commit (no polyline drift)');
});

// ---------------------------------------------------------- T6-3 arrow heads
test('T6-3 arrow preview carries the arrowhead polygon mid-drag', async () => {
  const { midHtml } = await dragCreate('arrow', { x: 200, y: 200 }, { x: 400, y: 260 });
  assert.match(previewPart(midHtml), /<polygon/, 'arrowhead must be visible while dragging');
});

// ------------------------------------------------------- T6-4 negative drags
test('T6-4 bottom-right -> top-left drag previews positive extents', async () => {
  const { midHtml } = await dragCreate('rect', { x: 600, y: 500 }, { x: 380, y: 310 });
  const p = norm(previewPart(midHtml));
  const w = Number(/width="(-?[\d.]+)"/.exec(p)[1]);
  const h = Number(/height="(-?[\d.]+)"/.exec(p)[1]);
  assert.ok(w > 0 && h > 0, `extents must be positive, got w=${w} h=${h}`);
  assert.ok(!/width="-|height="-/.test(p), 'no negative dimension attributes');
});

// ----------------------------------------------------- T6-5 WYSIWYG styling
test('T6-5 preview honours the style bar (pending style), not a fixed ghost', async () => {
  const ctx = await bootApp();
  const { api, root, svg, win, gOverlay } = ctx;
  const bar = root.querySelector('.topbar')[0];
  const [fillOn, fillIn, strokeOn, strokeIn, widthIn] = bar.children;
  fillIn.value = '#ff0000'; fillIn.dispatch('change');
  widthIn.value = '7'; widthIn.dispatch('change');
  api.setTool('rect');
  svg.dispatch('mousedown', pt(400, 300));
  win.dispatch('mousemove', { clientX: 540, clientY: 430 });
  const p = previewPart(gOverlay.innerHTML);
  assert.match(p, /fill="#ff0000"/, `preview must show the user-chosen fill, got: ${norm(p).slice(0, 160)}`);
  assert.match(p, /stroke-width="7"/, 'preview must show the user-chosen stroke width');
  win.dispatch('mouseup', { clientX: 540, clientY: 430 });
  const created = api.store.elements[api.store.elements.length - 1];
  assert.equal(created.style.fill, '#ff0000', 'committed element keeps that fill (no preview/commit lie)');
  assert.equal(created.style.strokeWidth, 7);
});

// ------------------------------------------------- T6-6 non-shape affordances
test('T6-6 marquee stays a plain dashed rect and text caret still renders', async () => {
  const ctx = await bootApp();
  const { api, svg, win, gOverlay } = ctx;
  api.setTool('select');
  svg.dispatch('mousedown', pt(10, 10));
  win.dispatch('mousemove', { clientX: 300, clientY: 300 });
  const mq = (gOverlay.innerHTML || '').split('\n').filter((l) => /class="marquee"/.test(l)).join('');
  assert.match(mq, /<rect/, 'marquee is a rect');
  assert.ok(!/<polygon|<ellipse|<path/.test(mq), 'marquee must not be unified into shape rendering');
  win.dispatch('mouseup', { clientX: 300, clientY: 300 });

  api.setTool('text');
  svg.dispatch('mousedown', pt(500, 500));
  win.dispatch('mousemove', { clientX: 505, clientY: 505 });
  assert.match(gOverlay.innerHTML, /class="preview"/, 'text caret preview still present');
  win.dispatch('mouseup', { clientX: 505, clientY: 505 });
});

// ----------------------------------------------- T6-7 preview in world space
test('T6-7 preview coords stay WORLD-space under a moved camera', async () => {
  const ctx = await bootApp();
  const { api, svg, win, gOverlay } = ctx;
  api.viewport.x = 300; api.viewport.y = -200; api.viewport.scale = 2; // screen(700,400)==world(200,300)
  api.setTool('ellipse');
  svg.dispatch('mousedown', pt(700, 400));
  win.dispatch('mousemove', { clientX: 820, clientY: 480 });
  const p = norm(previewPart(gOverlay.innerHTML));
  // LEAD RULING (test bug): 120 screen px at scale 2 = 60 WORLD units, so the
  // ellipse centre is 200 + 60/2 = 230, not 260. Original expectation bad maths.
  const cx = Number(/cx="(-?[\d.]+)"/.exec(p)[1]);
  assert.ok(Math.abs(cx - (200 + 60 / 2)) < 1e-6, `ellipse cx must be world-space 230, got ${cx}`);
  assert.match(gOverlay.attrs.transform, /translate\(300 -200\) scale\(2\)/, 'camera on the group');
  win.dispatch('mouseup', { clientX: 820, clientY: 480 });
});
