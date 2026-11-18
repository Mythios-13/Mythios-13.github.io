// TESTER T5 (RED) - camera must apply to the OVERLAY layer too.
// Invariant: selection boxes and drag previews are authored in WORLD coords, so
// their containing <g> MUST carry the same camera transform as the scene group.
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
  return { api, root, svg, gGrid: svg.children[0], gScene: svg.children[1], gOverlay: svg.children[2], doc, win };
}
const pt = (x, y, o = {}) => ({ button: 0, shiftKey: false, clientX: x, clientY: y, ...o });

/** Parse "translate(a b) scale(s)" -> {x,y,scale}; absent means identity. */
function parseTransform(t) {
  if (!t) return { x: 0, y: 0, scale: 1 };
  const tr = /translate\(\s*(-?[\d.eE+-]+)[\s,]+(-?[\d.eE+-]+)/.exec(t);
  const sc = /scale\(\s*(-?[\d.eE+-]+)/.exec(t);
  return { x: tr ? Number(tr[1]) : 0, y: tr ? Number(tr[2]) : 0, scale: sc ? Number(sc[1]) : 1 };
}
/** Read a numeric attribute at the START of a tag, never inside another name.
 *  LEAD RULING (test bug): a bare /y="..."/ matched inside opacit"y"="0.85". */
const num = (html, attr) => { const m = new RegExp(`(?:^|[\\s<])${attr}="(-?[\\d.]+)"`).exec(html); return m ? Number(m[1]) : NaN; };

function selectFirst(api) {
  api.setTool('select');
  const el = api.store.elements.find((e) => e.type === 'rect');
  api.store.select([el.id]);
  api.render();
  return el;
}

test('R1 [RED] middle-click pan keeps overlay transform identical to scene transform', async () => {
  const { api, svg, gScene, gOverlay, win } = await bootApp();
  selectFirst(api);
  svg.dispatch('mousedown', pt(100, 100, { button: 1 }));
  win.dispatch('mousemove', { clientX: 150, clientY: 120 });
  win.dispatch('mouseup', { clientX: 150, clientY: 120 });
  assert.match(gScene.attrs.transform, /translate\(50 20\)/, 'scene panned (control)');
  assert.equal(gOverlay.attrs.transform, gScene.attrs.transform,
    'overlay must carry the SAME camera transform as the scene group');
});

test('R2 [RED] transform parity holds after wheel-zoom and pan+zoom combined', async () => {
  const { api, svg, gScene, gOverlay, win } = await bootApp();
  selectFirst(api);
  svg.dispatch('wheel', { deltaY: -240, deltaMode: 0, ctrlKey: false, clientX: 640, clientY: 360 });
  assert.ok(api.viewport.scale > 1.2, 'zoomed in (control)');
  assert.equal(gOverlay.attrs.transform, gScene.attrs.transform, 'parity after zoom');
  svg.dispatch('mousedown', pt(300, 300, { button: 1 }));
  win.dispatch('mousemove', { clientX: 90, clientY: -40 });
  win.dispatch('mouseup', { clientX: 90, clientY: -40 });
  assert.equal(gOverlay.attrs.transform, gScene.attrs.transform, 'parity after pan+zoom');
});

test('R3 [guard] overlay counter-scales so chrome stays constant ON SCREEN', async () => {
  const { api, gOverlay } = await bootApp();
  selectFirst(api);
  api.viewport.scale = 4; api.render();
  const html = gOverlay.innerHTML;
  const sw = num(html, 'stroke-width');
  assert.ok(sw > 0.3 && sw < 0.5, `stroke-width should be ~${1.5 / 4}=0.375, got ${sw}`);
  const dash = /stroke-dasharray="([\d.]+)/.exec(html);
  assert.ok(dash && Math.abs(Number(dash[1]) - 1) < 1e-6, `dash first term should be 4/scale=1, got ${dash && dash[1]}`);
});

test('R4 [RED] live preview lands at correct SCREEN position when camera is moved', async () => {
  const { api, svg, gOverlay, win } = await bootApp();
  // Camera: pan (300,-200) @ 2x  =>  screen(700,400) == world(200,300)
  api.viewport.x = 300; api.viewport.y = -200; api.viewport.scale = 2;
  api.setTool('rect');
  svg.dispatch('mousedown', pt(700, 400));
  win.dispatch('mousemove', { clientX: 820, clientY: 480 });
  const html = gOverlay.innerHTML;
  assert.match(html, /class="preview"/, 'a preview renders while dragging');
  const x = num(html, 'x'), y = num(html, 'y');
  assert.ok(Math.abs(x - 200) < 1e-6 && Math.abs(y - 300) < 1e-6,
    `preview authored in WORLD coords: expected (200,300), got (${x},${y})`);
  const t = parseTransform(gOverlay.attrs.transform);
  assert.ok(Math.abs(x * t.scale + t.x - 700) < 1e-6 && Math.abs(y * t.scale + t.y - 400) < 1e-6,
    `effective screen position must be (700,400); group transform is "${gOverlay.attrs.transform}"`);
  win.dispatch('mouseup', { clientX: 820, clientY: 480 });
});

test('R5 [guard] panning never mutates the model - only the group carries the delta', async () => {
  const { api, svg, gOverlay, win } = await bootApp();
  const el = selectFirst(api);
  const before = JSON.stringify(api.store.get(el.id));
  const boxBefore = num(gOverlay.innerHTML, 'x');
  svg.dispatch('mousedown', pt(10, 10, { button: 1 }));
  win.dispatch('mousemove', { clientX: 410, clientY: 210 });
  win.dispatch('mouseup', { clientX: 410, clientY: 210 });
  assert.equal(JSON.stringify(api.store.get(el.id)), before, 'model untouched by pan');
  assert.equal(num(gOverlay.innerHTML, 'x'), boxBefore, 'overlay content stays in world space');
  assert.match(gOverlay.attrs.transform || '', /translate\(400 200\)/,
    'the GROUP carries the pan (delta-based: 410-10, 210-10)');
});

test('R6 [RED] inline text editor follows the camera when panned mid-edit', async () => {
  const { api, root, win } = await bootApp();
  const txt = api.store.elements.find((e) => e.type === 'text');
  api.startTextEditor(txt.id);
  const editor = root.children.find((c) => c.tagName === 'TEXTAREA');
  assert.ok(editor, 'editor mounted');
  const left0 = editor.style.left;
  api.viewport.x += 250; api.render();
  assert.notEqual(editor.style.left, left0,
    'editor must re-position with the camera instead of detaching from its text node');
  const expect = txt.x * api.viewport.scale + api.viewport.x;
  assert.equal(editor.style.left, `${expect}px`, 'editor left == worldToScreen(text).x');
});
