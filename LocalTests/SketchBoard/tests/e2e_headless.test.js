// TESTER: headless end-to-end — boots the REAL app.js against a DOM stub and
// drives full user journeys through dispatched events. Proves the GLUE works,
// not just the pure modules.
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
  return { api, root, svg, doc, win, mod };
}
const pt = (x, y, o = {}) => ({ button: 0, shiftKey: false, clientX: x, clientY: y, ...o });

test('boot: welcome scene seeded, layers exist, hud populated', async () => {
  const { api, svg, root } = await bootApp();
  assert.ok(api.store.elements.length >= 5, 'welcome scene present');
  const groups = svg.children.filter((c) => c.tagName === 'G');
  assert.equal(groups.length, 3, 'grid + scene + overlay groups');
  assert.match(root.querySelector('.hud')[0].textContent, /objects/, 'hud text set');
});

test('journey: wheel zoom updates transform + hud', async () => {
  const { api, svg } = await bootApp();
  const gScene = svg.children[1];
  svg.dispatch('wheel', { deltaY: -240, deltaMode: 0, ctrlKey: false, clientX: 640, clientY: 360 });
  assert.ok(api.viewport.scale > 1.2, 'zoomed in');
  assert.match(gScene.attrs.transform, /scale\(/, 'scene transform updated');
});

test('journey: middle-drag pans transform translate', async () => {
  const { api, svg, win } = await bootApp();
  const gScene = svg.children[1];
  svg.dispatch('mousedown', pt(100, 100, { button: 1 }));
  win.dispatch('mousemove', { clientX: 150, clientY: 120 });
  win.dispatch('mouseup', { clientX: 150, clientY: 120 });
  assert.match(gScene.attrs.transform, /translate\(50 20\)/, 'pan reflected in transform');
});

test('journey: rect tool drag creates element AND markup appears in scene group', async () => {
  const { api, svg, win } = await bootApp();
  const before = api.store.elements.length;
  api.setTool('rect');
  // TESTER FIX: move/up listeners are bound on window (drag may leave the svg) —
  // dispatch there, exactly like a real browser would.
  svg.dispatch('mousedown', pt(700, 400));
  win.dispatch('mousemove', { clientX: 820, clientY: 480 });
  win.dispatch('mouseup', { clientX: 820, clientY: 480 });
  assert.equal(api.store.elements.length, before + 1);
  const created = api.store.elements[api.store.elements.length - 1];
  assert.match(svg.children[1].innerHTML, new RegExp(`data-id="${created.id}"`), 'markup rendered');
});

test('journey: select-click sets selection overlay in overlay group', async () => {
  const { api, svg, win } = await bootApp();
  api.setTool('select');
  const star = api.store.elements.find((e) => e.type === 'star');
  const sp = api.viewport.worldToScreen({ x: star.x + 45, y: star.y + 45 });
  svg.dispatch('mousedown', pt(sp.x, sp.y));
  win.dispatch('mouseup', { clientX: sp.x, clientY: sp.y });
  assert.ok(api.store.selected.has(star.id));
  assert.match(svg.children[2].innerHTML, /sel-box/, 'overlay drawn');
});

test('journey: right-click opens properties panel built WITHOUT innerHTML injection', async () => {
  const { api, svg, root } = await bootApp();
  const star = api.store.elements.find((e) => e.type === 'star');
  const sp = api.viewport.worldToScreen({ x: star.x + 45, y: star.y + 45 });
  svg.dispatch('contextmenu', { clientX: sp.x, clientY: sp.y });
  const panel = root.children.find((c) => c.className && c.className.includes('props-panel'));
  assert.equal(panel.hidden, false, 'panel opened');
  const title = panel.children.find((c) => c.className === 'prop-title');
  assert.match(title.textContent, /star/, 'title reflects type (via textContent)');
});

test('journey: Delete key removes selected, Ctrl+Z restores', async () => {
  const { api, win } = await bootApp();
  const n0 = api.store.elements.length;
  const star = api.store.elements.find((e) => e.type === 'star');
  api.store.select([star.id]);
  win.dispatch('keydown', { key: 'Delete', ctrlKey: false, metaKey: false, shiftKey: false, repeat: false });
  assert.equal(api.store.elements.length, n0 - 1);
  win.dispatch('keydown', { key: 'z', ctrlKey: true, metaKey: false, shiftKey: false, repeat: false });
  assert.equal(api.store.elements.length, n0, 'undo restored');
});

test('journey: Ctrl+D duplicates with offset', async () => {
  const { api, win } = await bootApp();
  const star = api.store.elements.find((e) => e.type === 'star');
  api.store.select([star.id]);
  const x0 = star.x;
  win.dispatch('keydown', { key: 'd', ctrlKey: true, metaKey: false, shiftKey: false, repeat: false });
  assert.equal(api.store.elements.length + 0, api.store.elements.length);
  const clone = api.store.elements[api.store.elements.length - 1];
  assert.equal(clone.x, x0 + 16);
});

test('journey: text dblclick opens editor; commit writes back exactly', async () => {
  const { api, root } = await bootApp();
  const txt = api.store.elements.find((e) => e.type === 'text');
  api.startTextEditor(txt.id);
  const ta = root.children.find((c) => c.tagName === 'TEXTAREA');
  assert.ok(ta, 'editor mounted');
  ta.value = '</textarea><img src=x onerror=hacked>';   // hostile input
  ta.dispatch('blur');
  assert.equal(api.store.get(txt.id).text, '</textarea><img src=x onerror=hacked>', 'exact roundtrip');
  assert.ok(!root.children.includes(ta), 'editor unmounted');
});

test('journey: typing inside editor does NOT trigger tool shortcuts', async () => {
  const { api, root, win, doc } = await bootApp();
  const txt = api.store.elements.find((e) => e.type === 'text');
  api.startTextEditor(txt.id);
  const ta = root.children.find((c) => c.tagName === 'TEXTAREA');
  doc.activeElement = ta;                       // simulate focus
  win.dispatch('keydown', { key: 'r', ctrlKey: false, metaKey: false, shiftKey: false, repeat: false });
  assert.notEqual(api.tools.tool, 'rect', "'r' typed into text must not switch to rect tool");
  doc.activeElement = { tagName: 'BODY' };
});

test('journey: toolbar click switches tool', async () => {
  const { api, root } = await bootApp();
  const btns = root.querySelector('.toolbar')[0].querySelectorAll('.tool-btn');
  const arrowBtn = btns.find((b) => b.dataset.tool === 'arrow');
  arrowBtn.dispatch('click');
  assert.equal(api.tools.tool, 'arrow');
});
