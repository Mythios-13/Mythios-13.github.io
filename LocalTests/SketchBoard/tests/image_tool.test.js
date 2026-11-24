// TESTER F4 (RED): Image tool. Spec docs/specs/F4-image-tool.md.
// Client intent: popup to load a file, place at 100%, resize like rect tool, ASPECT
// LOCKED BY DEFAULT, Shift RELEASES (deliberate polarity asymmetry vs shapes - see spec §0).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDom } from './dom_stub.js';
import { ELEMENT_TYPES } from '../src/store.js';
import { bboxOfElement, hitTestElement } from '../src/geometry.js';
import { elementToSvg } from '../src/render.js';

const DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';   // 1x1 stand-in bytes

async function bootApp(deps = {}) {
  const { doc, win } = makeDom();
  globalThis.document = doc; globalThis.window = win;
  const mod = await import('../src/app.js');
  const root = doc.createElement('div');
  const map = new Map();
  const storage = { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k) };
  const api = mod.boot(root, Object.assign({ storage, hash: '', download() {}, debounceMs: 0 }, deps));
  const svg = root.children.find((c) => c.tagName === 'SVG');
  const hud = () => (root.querySelectorAll('.hud') || [])[0];
  return { api, root, svg, hud, win };
}
const pt = (x, y, o = {}) => ({ button: 0, shiftKey: false, clientX: x, clientY: y, ...o });

test('F4-1 model: image is a first-class element type', async () => {
  assert.ok(ELEMENT_TYPES.includes('image'), "ELEMENT_TYPES must include 'image'");
  const { api } = await bootApp();
  const el = api.store.createElement('image', { x: 5, y: 6, w: 100, h: 50, src: DATA_URL });
  assert.equal(el.type, 'image'); assert.equal(el.src, DATA_URL);
  api.store.addElement(el);
  assert.equal(api.store.elements.length, (api.store.elements.filter((e) => e.type === 'image')).length + api.store.elements.filter((e) => e.type !== 'image').length);
});

test('F4-2 tool registered consistently (TOOLS list + toolbar button + shortcut i)', async () => {
  const { TOOLS } = await import('../src/tools.js');
  assert.ok(TOOLS.includes('image'), 'TOOLS includes image');
  const m = await import('../src/app.js');
  assert.equal(m.EXTRA_TOOL_SHORTCUTS.i || m.SHORTCUT_TOOLS.i, 'image', "shortcut 'i' -> image");
  const { root } = await bootApp();
  const toolbar = root.children.find((c) => c.className === 'toolbar');
  assert.ok((toolbar.children || []).some((b) => b.dataset.tool === 'image'), 'toolbar has image button');
});

test('F4-3 pick a file -> PLACE mode -> press creates centred at 100%, one history entry', async () => {
  const { api, svg, win } = await bootApp({ loadImageFile: async () => ({ name: 'a.png', dataUrl: DATA_URL, width: 80, height: 40 }) });
  api.setTool('image');
  await new Promise((r) => setTimeout(r, 5));                 // picker promise settles
  assert.ok(api.tools.pendingImage, 'precondition (painted state!): picker armed PLACE mode');
  const totalBefore = api.store.elements.length;
  const imgBefore = api.store.elements.filter((e) => e.type === 'image').length;
  const hist = api.store._history.length;
  const sp = api.viewport.worldToScreen({ x: 300, y: 300 });
  svg.dispatch('mousedown', pt(sp.x, sp.y));
  win.dispatch('mouseup', pt(sp.x, sp.y));
  const imgs = api.store.elements.filter((e) => e.type === 'image');
  // Count images against images (first draft compared to TOTAL length - apples vs oranges).
  assert.equal(imgs.length, imgBefore + 1, 'exactly one image created by the press');
  assert.equal(api.store.elements.length, totalBefore + 1, 'and nothing else changed');
  const im = imgs[imgs.length - 1];
  assert.equal(im.w, 80, 'natural width == 100%'); assert.equal(im.h, 40);
  assert.ok(Math.abs(im.x - (300 - 40)) < 1e-9 && Math.abs(im.y - (300 - 20)) < 1e-9,
    `centred under cursor: got ${im.x},${im.y}`);
  assert.equal(im.src, DATA_URL);
  assert.equal(api.store.selected.has(im.id), true, 'new image selected');
  assert.equal(api.store._history.length, hist + 1, 'exactly one undo step for the placement');
});

test('F4-4 picker CANCEL: nothing created, no history entry, no crash', async () => {
  const { api, svg, win } = await bootApp({ loadImageFile: async () => null });
  api.setTool('image');
  await new Promise((r) => setTimeout(r, 5));
  const n = api.store.elements.length, hist = api.store._history.length;
  svg.dispatch('mousedown', pt(100, 100)); win.dispatch('mouseup', pt(100, 100));
  assert.equal(api.store.elements.length, n, 'cancel created nothing');
  assert.equal(api.store._history.length, hist);
});

test('F4-5 non-image dataUrl rejected with toast; nothing created', async () => {
  const { api, svg, win, hud } = await bootApp({ loadImageFile: async () => ({ name: 'x.svg', dataUrl: 'data:text/html;base64,AAAA', width: 10, height: 10 }) });
  api.setTool('image');
  await new Promise((r) => setTimeout(r, 5));
  const n = api.store.elements.length;
  svg.dispatch('mousedown', pt(100, 100)); win.dispatch('mouseup', pt(100, 100));
  assert.equal(api.store.elements.filter((e) => e.type === 'image').length, 0, 'no image from non-image mime');
  assert.match((hud() && hud().textContent) || '', /image|not an image|unsupported/i, 'user told why: ' + (hud() && hud().textContent));
});

test('F4-6 render: <image href escaped, size attrs, preserveAspectRatio none', () => {
  const markup = elementToSvg({ id: 'i1', type: 'image', x: 10, y: 20, w: 100, h: 50, src: DATA_URL, style: {} });
  assert.match(markup, /^<image /, 'renders an <image> element');
  assert.match(markup, /href="data:image\/png;base64,iVBORw0KGgoAAAANSUhEUg=="/, 'href carries the data url');
  assert.match(markup, /width="100"/); assert.match(markup, /height="50"/);
  assert.match(markup, /preserveAspectRatio="none"/, 'free deform must stretch, not letterbox');
});

test('F4-9 hostile src cannot break out of the attribute', () => {
  const evil = 'data:image/png;base64,x" onload="alert(1)';
  const markup = elementToSvg({ id: 'i2', type: 'image', x: 0, y: 0, w: 10, h: 10, src: evil, style: {} });
  // Sound breakout check: in correctly ESCAPED output the raw delimiter sequence
  // '" onload="' can never occur (it would close href= and inject a new attribute).
  // (First draft of this test stripped &quot; before matching - which REBUILT the attack
  // string and failed on correct output; caught by reading the test, not by running it.)
  assert.ok(!markup.includes('" onload="'), 'attribute breakout must be impossible: ' + markup);
  assert.ok(markup.includes('&quot;'), 'the quotes were escaped, not deleted');
  assert.equal((markup.match(/"/g) || []).length % 2, 0, 'attribute quotes stay balanced');
});

test('F4-10 geometry: bbox and hit-test work for images', () => {
  const el = { id: 'i3', type: 'image', x: 10, y: 20, w: 100, h: 50, src: DATA_URL, style: {} };
  assert.deepEqual(bboxOfElement(el), { x: 10, y: 20, w: 100, h: 50 });
  assert.equal(hitTestElement(el, { x: 60, y: 45 }, 4), true, 'inside hits');
  assert.equal(hitTestElement(el, { x: 600, y: 45 }, 4), false, 'far misses');
});

// ---------------------------------------------------- RESIZE POLARITY (spec section 0)
async function mkImage() {
  const ctx = await bootApp({ loadImageFile: async () => ({ name: 'a.png', dataUrl: DATA_URL, width: 100, height: 50 }) });
  ctx.api.setTool('select');
  const el = ctx.api.store.createElement('image', { x: 0, y: 0, w: 100, h: 50, src: DATA_URL });
  ctx.api.store.addElement(el); ctx.api.store.select([el.id]); ctx.api.render();
  return { ...ctx, el };
}
const seCorner = (el) => ({ x: el.x + el.w, y: el.y + el.h });

test('F4-7 resize WITHOUT Shift PRESERVES aspect ratio even off-ratio pointer', async () => {
  const { api, el } = await mkImage();
  const c = seCorner(el);
  api.tools.pointerDown({ button: 0, x: c.x, y: c.y });
  api.tools.pointerMove({ x: c.x + 100, y: c.y + 100, shiftKey: false });   // wildly off-ratio
  api.tools.pointerUp({ x: c.x + 100, y: c.y + 100, shiftKey: false });
  assert.ok(Math.abs(el.w / el.h - 2) < 1e-6, `ratio must stay 2: got ${el.w}/${el.h} = ${el.w / el.h}`);
  assert.ok(el.w > 100, 'it did grow');
});

test('F4-8 resize WITH Shift is FREE deform (polarity released)', async () => {
  const { api, el } = await mkImage();
  const c = seCorner(el);
  api.tools.pointerDown({ button: 0, x: c.x, y: c.y, shiftKey: true });
  api.tools.pointerMove({ x: c.x + 100, y: c.y + 100, shiftKey: true });
  api.tools.pointerUp({ x: c.x + 100, y: c.y + 100, shiftKey: true });
  assert.equal(el.w, 200, 'both axes follow the pointer independently');
  assert.equal(el.h, 150);
});

// ================================================================ S5 additions (session 5)
// Three client asks landed on the image tool AFTER the original F4 gate. They are pinned
// here because implemented-but-untested is exactly how a feature silently rots.
async function armedCtx() {
  const ctx = await bootApp({ loadImageFile: async () => ({ name: 'a.png', dataUrl: DATA_URL, width: 80, height: 40 }) });
  ctx.api.setTool('image');
  await new Promise((r) => setTimeout(r, 5));
  return ctx;
}

test('S5-F4c PLACE ghost: an <image> placeholder of the true size follows the cursor before any click', async () => {
  const { api, root, svg, win } = await armedCtx();
  const gOverlay = svg.children[2];
  assert.ok(api.tools.pendingImage, 'precondition (PAINTED state!): picker armed PLACE mode');
  const sp = api.viewport.worldToScreen({ x: 400, y: 250 });
  win.dispatch('mousemove', { clientX: sp.x, clientY: sp.y });
  const html = gOverlay.innerHTML || '';
  assert.match(html, /<image /, 'ghost is rendered through the REAL renderer (WYSIWYG), got: ' + html.slice(0, 200));
  // Same geometry the stamp will use: centred under the cursor at natural size.
  assert.match(html, /width="80"/, 'ghost width == natural width');
  assert.match(html, /height="40"/, 'ghost height == natural height');
  assert.match(html, /x="360"/, 'centred horizontally (400 - 80/2)');
  assert.match(html, /y="230"/, 'centred vertically (250 - 40/2)');
  assert.equal(api.store.elements.filter((e) => e.type === 'image').length, 0, 'a hover paints a ghost, it does NOT commit');
});

test('S5-F4c ghost does not linger: gone after the stamp, and never committed as an element', async () => {
  const { api, root, svg, win } = await armedCtx();
  const gOverlay = svg.children[2];
  const sp = api.viewport.worldToScreen({ x: 400, y: 250 });
  win.dispatch('mousemove', { clientX: sp.x, clientY: sp.y });
  assert.match(gOverlay.innerHTML || '', /<image /, 'precondition: ghost visible');
  svg.dispatch('mousedown', pt(sp.x, sp.y));
  win.dispatch('mouseup', pt(sp.x, sp.y));
  const imgs = api.store.elements.filter((e) => e.type === 'image');
  assert.equal(imgs.length, 1, 'exactly one real image committed');
  // The overlay must be free of any leftover ghost (the old transient-preview design froze
  // one on screen after the stamp; deriving it from live PLACE state is what fixes that).
  const overlayImgs = (gOverlay.innerHTML || '').match(/<image /g) || [];
  assert.equal(overlayImgs.length, 0, 'no stale ghost left in the overlay: ' + (gOverlay.innerHTML || '').slice(0, 200));
});

test('S5-F4e after placing: tool auto-switches to select AND the new image is selected', async () => {
  const { api, svg, win } = await armedCtx();
  const sp = api.viewport.worldToScreen({ x: 300, y: 300 });
  svg.dispatch('mousedown', pt(sp.x, sp.y));
  win.dispatch('mouseup', pt(sp.x, sp.y));
  const im = api.store.elements.filter((e) => e.type === 'image').pop();
  assert.ok(im, 'precondition: image was stamped');
  assert.equal(api.tools.tool, 'select', 'tool returned to Select so handles are immediately usable');
  assert.equal(api.store.selected.has(im.id), true, 'and the placed image is the selection');
  // A second press must NOT stamp again (placement is one-shot per pick).
  const n = api.store.elements.filter((e) => e.type === 'image').length;
  svg.dispatch('mousedown', pt(sp.x + 90, sp.y + 90));
  win.dispatch('mouseup', pt(sp.x + 90, sp.y + 90));
  assert.equal(api.store.elements.filter((e) => e.type === 'image').length, n, 'one pick = one stamp');
});

test('S5-F4d right-click menu offers "original size" for images and restores natural size about the centre', async () => {
  const { api, root, svg } = await bootApp();
  const el = api.store.createElement('image', { x: 100, y: 100, w: 80, h: 40, src: DATA_URL, natW: 200, natH: 100 });
  api.store.addElement(el); api.store.select([el.id]); api.render();
  const sp = api.viewport.worldToScreen({ x: 140, y: 120 });        // inside the box
  svg.dispatch('contextmenu', { clientX: sp.x, clientY: sp.y });
  const panel = root.children.find((c) => c.className && c.className.includes('props-panel'));
  assert.equal(panel.hidden, false, 'precondition: panel opened on the image');
  const walk = (n, out = []) => { for (const c of n.children || []) { out.push(c); walk(c, out); } return out; };
  const btn = walk(panel).find((c) => c.classList && c.classList.contains('prop-btn') && c.textContent === 'original size');
  assert.ok(btn, 'image rows include an "original size" action');
  const hist = api.store._history.length;
  btn.dispatch('click');
  const e = api.store.get(el.id);
  assert.equal(e.w, 200, 'restored to natural width'); assert.equal(e.h, 100, 'natural height');
  assert.ok(Math.abs((e.x + e.w / 2) - 140) < 1e-9 && Math.abs((e.y + e.h / 2) - 120) < 1e-9,
    `resized about its centre, got centre ${e.x + e.w / 2},${e.y + e.h / 2}`);
  assert.equal(api.store._history.length, hist + 1, 'ONE undo step');
  api.store.undo();
  assert.equal(api.store.get(el.id).w, 80, 'undo puts the resized box back');
});

test('S5-F4d non-images do NOT get the "original size" row (no misleading affordance)', async () => {
  const { api, root, svg } = await bootApp();
  const el = api.store.createElement('rect', { x: 10, y: 10, w: 60, h: 60 });
  api.store.addElement(el); api.store.select([el.id]); api.render();
  const sp = api.viewport.worldToScreen({ x: 40, y: 40 });
  svg.dispatch('contextmenu', { clientX: sp.x, clientY: sp.y });
  const panel = root.children.find((c) => c.className && c.className.includes('props-panel'));
  const walk = (n, out = []) => { for (const c of n.children || []) { out.push(c); walk(c, out); } return out; };
  assert.equal(walk(panel).some((c) => c.textContent === 'original size'), false, 'rect must not show it');
});
