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
  const before = api.store.elements.length;
  const hist = api.store._history.length;
  const sp = api.viewport.worldToScreen({ x: 300, y: 300 });
  svg.dispatch('mousedown', pt(sp.x, sp.y));
  win.dispatch('mouseup', pt(sp.x, sp.y));
  const imgs = api.store.elements.filter((e) => e.type === 'image');
  assert.equal(imgs.length, before + 1, 'one image created by the press');
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
  assert.ok(!/<image[^>]*\sonload=/.test(markup.replace(/&quot;/g, '')), 'raw onload= must not appear unescaped in markup: ' + markup);
  assert.ok(markup.includes('&quot;'), 'quotes escaped');
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
