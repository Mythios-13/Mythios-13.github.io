// TESTER F2 (RED): "Apply style" button on the top toolbar.
// Spec docs/specs/F2-apply-style.md. Client intent: when the selection does NOT match
// the toolbar controls, show a button that applies ALL toolbar definitions to the
// selection (multi-select included).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDom } from './dom_stub.js';
import { DEFAULT_STYLE } from '../src/styles.js';

async function bootApp(deps = {}) {
  const { doc, win } = makeDom();
  globalThis.document = doc; globalThis.window = win;
  const mod = await import('../src/app.js');
  const root = doc.createElement('div');
  const map = new Map();
  const storage = { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k) };
  const api = mod.boot(root, Object.assign({ storage, hash: '', download() {}, debounceMs: 0 }, deps));
  const topbar = root.children.find((c) => c.className === 'topbar');
  const byTitle = (title) => (topbar.children || []).find((c) => c.title === title);
  const applyBtn = () => (root.querySelectorAll('.apply-style') || [])[0];
  return { api, root, topbar, byTitle, applyBtn };
}
const CTRL_TITLES = ['Fill color', 'Fill enabled', 'Stroke color', 'Stroke enabled',
  'Stroke width', 'Opacity', 'Dash', 'Corner radius (rect)', 'Font', 'Font size'];

test('F2-1 button exists in topbar and hides when the selection MATCHES the bar', async () => {
  const { api, byTitle, applyBtn } = await bootApp();
  assert.ok(applyBtn(), '.apply-style button exists');
  for (const t of CTRL_TITLES) assert.ok(byTitle(t), `control ${t} reachable`);
  // An element styled EXACTLY like the bar must hide the button.
  const el = api.store.createElement('rect', { x: 0, y: 0, w: 50, h: 50 }, { ...DEFAULT_STYLE });
  api.store.addElement(el);
  api.store.select([el.id]); api.render();
  assert.equal(applyBtn().hidden, true, 'matching selection => hidden');
});

test('F2-2 a single mismatching control makes the button visible', async () => {
  const { api, byTitle, applyBtn } = await bootApp();
  const el = api.store.createElement('rect', { x: 0, y: 0, w: 50, h: 50 }, { ...DEFAULT_STYLE });
  api.store.addElement(el); api.store.select([el.id]); api.render();
  assert.equal(applyBtn().hidden, true, 'precondition: matched, hidden');
  byTitle('Fill color').value = '#123456';                       // one control diverges
  api.render();                                                  // sync happens in render()
  assert.equal(applyBtn().hidden, false, 'mismatch => visible');
});

test('F2-3 click applies ALL toolbar definitions in ONE undo step, exact control values', async () => {
  const { api, byTitle, applyBtn } = await bootApp();
  const el = api.store.createElement('rect', { x: 0, y: 0, w: 50, h: 50 }, { ...DEFAULT_STYLE });
  api.store.addElement(el); api.store.select([el.id]);
  const hist = api.store._history.length;
  byTitle('Fill color').value = '#ff0000';
  byTitle('Stroke color').value = '#00ff00';
  byTitle('Stroke width').value = '7';          // range gives STRINGS - must coerce
  byTitle('Opacity').value = '0.5';
  byTitle('Dash').value = 'dashed';
  byTitle('Corner radius (rect)').value = '9';
  byTitle('Font size').value = '33';
  api.render();
  assert.equal(applyBtn().hidden, false, 'precondition: visible');
  applyBtn().dispatch('click');
  const s = el.style;
  assert.equal(s.fill, '#ff0000'); assert.equal(s.fillEnabled, true);   // fill checkbox drives fillEnabled
  assert.equal(s.stroke, '#00ff00');
  assert.equal(s.strokeWidth, 7, 'string coerced to number');
  assert.equal(s.opacity, 0.5); assert.equal(s.dash, 'dashed');
  assert.equal(s.radius, 9); assert.equal(s.fontSize, 33);
  assert.equal(api.store._history.length, hist + 1, 'exactly ONE history entry');
  assert.equal(api.store.undo(), true);
  assert.equal(el.style.fill, DEFAULT_STYLE.fill, 'one undo restores EVERYTHING');
});

test('F2-4 multi-selection: EVERY selected element receives the patch', async () => {
  const { api, byTitle, applyBtn } = await bootApp();
  const a = api.store.createElement('rect', { x: 0, y: 0, w: 50, h: 50 }, { ...DEFAULT_STYLE });
  const b = api.store.createElement('ellipse', { x: 80, y: 0, w: 50, h: 50 }, { ...DEFAULT_STYLE });
  api.store.addElement(a); api.store.addElement(b);
  api.store.select([a.id, b.id]);
  byTitle('Fill color').value = '#010203';
  api.render(); applyBtn().dispatch('click');
  assert.equal(a.style.fill, '#010203'); assert.equal(b.style.fill, '#010203');
});

test('F2-5 after a successful apply the button hides itself (selection now matches)', async () => {
  const { api, byTitle, applyBtn } = await bootApp();
  const el = api.store.createElement('rect', { x: 0, y: 0, w: 50, h: 50 }, { ...DEFAULT_STYLE });
  api.store.addElement(el); api.store.select([el.id]);
  byTitle('Fill color').value = '#0a0b0c';
  api.render(); applyBtn().dispatch('click');
  assert.equal(applyBtn().hidden, true, 'apply implies match implies hidden');
});

test('F2-6 empty selection: hidden AND click is a total no-op (pending style untouched)', async () => {
  const { api, byTitle, applyBtn } = await bootApp();
  assert.equal(applyBtn().hidden, true, 'nothing selected => hidden');
  const pendBefore = JSON.stringify(api.store.pendingStyle);
  const hist = api.store._history.length;
  byTitle('Fill color').value = '#ff0000';
  api.render();
  assert.equal(applyBtn().hidden, true, 'still hidden with empty selection even if controls differ');
  applyBtn().dispatch('click');                                   // must be inert
  assert.equal(JSON.stringify(api.store.pendingStyle), pendBefore, 'pending style untouched');
  assert.equal(api.store._history.length, hist, 'no history spam');
});

test('F2-7 coercion traps: numeric-string vs number MATCHES; colour case-insensitive MATCHES', async () => {
  const { api, byTitle, applyBtn } = await bootApp();
  const el = api.store.createElement('rect', { x: 0, y: 0, w: 50, h: 50 },
    { ...DEFAULT_STYLE, fill: '#abcdef', strokeWidth: 2, opacity: 1, radius: 0, fontSize: 24 });
  api.store.addElement(el); api.store.select([el.id]);
  byTitle('Fill color').value = '#ABCDEF';      // different case
  byTitle('Stroke width').value = '2';          // string vs number
  api.render();
  assert.equal(applyBtn().hidden, true, 'coercion-equal values must NOT count as mismatch');
});
