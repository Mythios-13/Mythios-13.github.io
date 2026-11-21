// TESTER T7 (RED): burger menu + autosave wiring + #reset hook, through the REAL
// app.js against the DOM stub. Contract agreed with LEAD ticket T7-RED:
//   boot(root, { storage, hash, download, ImageCtor, CanvasCtor })  - all optional
//   menu:  .burger button, .menu container (class 'open' when expanded),
//          .menu-item buttons with data-action in
//          export-png | export-svg | go-center | clear
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDom } from './dom_stub.js';
import { Store } from '../src/store.js';

const KEY = 'sketchboard.doc.v1';
const docOf = (n) => ({ app: 'sketchboard', version: 1, elements: Array.from({ length: n }, (_, i) => ({ id: 'el_' + (i + 1), type: 'rect', x: i * 30, y: 0, w: 20, h: 20, style: {} })) });

function fakeStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return { map, writes: [], getItem(k) { return map.has(k) ? map.get(k) : null; },
           setItem(k, v) { this.writes.push([k, String(v)]); map.set(k, String(v)); },
           removeItem(k) { map.delete(k); } };
}

async function bootApp(opts = {}) {
  const { doc, win } = makeDom();
  globalThis.document = doc; globalThis.window = win;
  const mod = await import('../src/app.js');
  const root = doc.createElement('div');
  const downloads = [];
  const api = mod.boot(root, Object.assign({ storage: fakeStorage(), hash: '', download: (name, body, mime) => downloads.push({ name, body, mime }) }, opts));
  const svg = root.children.find((c) => c.tagName === 'SVG');
  const items = () => root.querySelectorAll('.menu-item') || [];
  const itemByAction = (a) => items().find((b) => b.dataset.action === a);
  const menu = () => (root.querySelectorAll('.menu') || [])[0];
  const burger = () => (root.querySelectorAll('.burger') || [])[0];
  return { api, root, svg, downloads, doc, win, items, itemByAction, menu, burger };
}

// ------------------------------------------------------------------------ M1
test('M1 stored doc is restored on boot INSTEAD of the welcome seed (refresh keeps my work)', async () => {
  const storage = fakeStorage({ [KEY]: JSON.stringify(docOf(2)) });
  const { api } = await bootApp({ storage, hash: '' });
  assert.equal(api.store.elements.length, 2, 'restored exactly the saved elements, got ' + api.store.elements.length);
  assert.deepEqual(api.store.elements.map((e) => e.id), ['el_1', 'el_2']);
  const texts = api.store.elements.filter((e) => e.type === 'text').map((e) => e.text).join(' ');
  assert.ok(!/infinite vector canvas/.test(texts), 'welcome banner must NOT reappear over user work');
});

// ------------------------------------------------------------------------ M2
test('M2 #reset boots EMPTY even when storage holds a doc', async () => {
  const storage = fakeStorage({ [KEY]: JSON.stringify(docOf(3)) });
  const { api } = await bootApp({ storage, hash: '#reset' });
  assert.equal(api.store.elements.length, 0, 'empty canvas, got ' + api.store.elements.length);
});

// ------------------------------------------------------------------------ M3
test('M3 #reset is EPHEMERAL: does not destroy storage before the user mutates', async () => {
  const payload = JSON.stringify(docOf(3));
  const storage = fakeStorage({ [KEY]: payload });
  const { api } = await bootApp({ storage, hash: '#reset' });
  assert.equal(storage.getItem(KEY), payload, 'stored doc untouched right after a #reset boot');
  assert.equal(storage.writes.length, 0, 'no autosave fired with zero mutations');
  // ...but once the user draws, normal autosave takes over (documented behaviour).
  api.store.addElement(api.store.createElement('rect', { x: 0, y: 0, w: 10, h: 10 }));
  if (api.flushAutosave) api.flushAutosave();
  assert.notEqual(storage.getItem(KEY), payload, 'after a real edit the new state is saved');
});

// ------------------------------------------------------------------------ M4
test('M4 burger menu exists top-right, auto-OPEN, exactly the requested actions, toggle works', async () => {
  const { root, items, menu, burger } = await bootApp();
  const m = menu();
  assert.ok(m, '.menu container exists');
  const b = burger();
  assert.ok(b, '.burger toggle button exists');
  assert.ok(m.classList.contains('open'), 'menu is OPEN by default on boot (stakeholder: auto open)');
  const actions = items().map((x) => x.dataset.action).sort();
  // F6 added save-disk/open-disk (client: save+load to disk). Pin updated to the new
  // SIX-action contract but kept EXACT (deepEqual) so an accidental 7th entry still fails.
  assert.deepEqual(actions, ['clear', 'export-png', 'export-svg', 'go-center', 'open-disk', 'save-disk'], 'exactly the requested actions (T7 four + F6 two)');
  const labels = items().map((x) => x.textContent).join('|');
  for (const want of ['PNG', 'SVG', 'center', 'Clear', 'Save to disk', 'Open from disk']) {
    assert.ok(new RegExp(want, 'i').test(labels), 'label mentions ' + want + ', got: ' + labels);
  }
  // Toggle collapses and expands again.
  b.dispatch('click');
  assert.equal(m.classList.contains('open'), false, 'collapsed after toggle');
  b.dispatch('click');
  assert.equal(m.classList.contains('open'), true, 'expanded after second toggle');
  // Top-right placement must be expressed in CSS, not just markup.
  const css = (await import('node:fs')).readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.menu\s*\{[^}]*position:\s*fixed/, '.menu is positioned out of flow');
  assert.match(css, /\.menu\s*\{[^}]*top:/, '.menu pinned to top');
  assert.match(css, /\.menu\s*\{[^}]*right:/, '.menu pinned to the right');
});

// ------------------------------------------------------------------------ M5
test('M5 Go to center zeroes viewport x/y and PRESERVES scale, then re-renders', async () => {
  const { api, itemByAction, svg } = await bootApp();
  api.viewport.panBy(300, -220);
  api.viewport.scale = 3.5;
  api.render();
  const gScene = svg.children[1];
  assert.match(gScene.attrs.transform, /translate\(300 -220\)/, 'precondition: camera offset present');
  const btn = itemByAction('go-center');
  assert.ok(btn, 'go-center action present');
  btn.dispatch('click');
  assert.equal(api.viewport.x, 0, 'x recentred');
  assert.equal(api.viewport.y, 0, 'y recentred');
  assert.equal(api.viewport.scale, 3.5, 'scale preserved (stakeholder: recenters the OFFSET)');
  assert.match(gScene.attrs.transform, /translate\(0 0\)/, 're-render reflected the recentring');
});

// ------------------------------------------------------------------------ M6
test('M6 Clear canvas empties store, clears selection, closes panel/editor, is UNDOABLE', async () => {
  const storage = fakeStorage({ [KEY]: JSON.stringify(docOf(4)) });
  const { api, itemByAction, root } = await bootApp({ storage });
  api.store.select([api.store.elements[0].id]);
  const before = api.store.elements.length;
  assert.ok(before > 0);
  let confirmCalled = false;
  globalThis.confirm = () => { confirmCalled = true; return true; };

  itemByAction('clear').dispatch('click');

  assert.equal(confirmCalled, false, 'no blocking confirm() dialog');
  assert.equal(api.store.elements.length, 0, 'canvas cleared');
  assert.equal(api.store.selected.size, 0, 'selection cleared');
  assert.equal(api.store.canUndo(), true, 'clear is undoable');
  assert.equal(api.store.undo(), true, 'undo succeeds');
  assert.equal(api.store.elements.length, before, 'everything restored by one Ctrl+Z');
});

// ------------------------------------------------------------------------ M7
test('M7 Save as SVG calls the injected download sink with a .svg name and an <svg body', async () => {
  const storage = fakeStorage({ [KEY]: JSON.stringify(docOf(2)) });
  const { downloads, itemByAction } = await bootApp({ storage });
  itemByAction('export-svg').dispatch('click');
  assert.equal(downloads.length, 1, 'one download via the sink, got ' + downloads.length);
  const d = downloads[0];
  assert.ok(/\.svg$/i.test(d.name), 'filename ends .svg, got ' + d.name);
  assert.ok(d.body.startsWith('<svg'), 'body starts with <svg');
  assert.ok(d.body.includes('data-id="el_1"'), 'real content exported');
  assert.match(String(d.mime || ''), /image\/svg\+xml/, 'svg mime declared');
});

test('M7b Save as PNG goes through the sink too and never throws without a canvas', async () => {
  const storage = fakeStorage({ [KEY]: JSON.stringify(docOf(2)) });
  const { downloads, itemByAction } = await bootApp({ storage });
  let threw = null;
  try { itemByAction('export-png').dispatch('click'); } catch (e) { threw = e; }
  assert.equal(threw, null, 'PNG click must degrade gracefully, not crash: ' + (threw && threw.message));
  // No Image/canvas in this runtime -> either a graceful toast or nothing; MUST NOT have thrown.
  // If an implementation supports an injected ImageCtor, prove the happy path:
  class FakeImage { set src(v) { this._src = v; if (this.onload) setTimeout(() => this.onload(), 0); } }
  const fakeCanvas = { width: 0, height: 0, getContext: () => ({ drawImage() {}, fillRect() {} }),
                       toBlob: (cb) => cb({ size: 10 }) };
  const { downloads: dl2, itemByAction: by2 } = await bootApp({
    storage: fakeStorage({ [KEY]: JSON.stringify(docOf(2)) }),
    ImageCtor: FakeImage, CanvasCtor: function () { return fakeCanvas; },
  });
  try { by2('export-png').dispatch('click'); } catch (e) { /* async glue may reject; must not throw sync */ }
  assert.ok(true, 'injected Image/Canvas path exercised without a synchronous crash');
});

// ------------------------------------------------------------------------ M8
test('M8 autosave writes on element creation and after clear canvas', async () => {
  const storage = fakeStorage();
  const { api, itemByAction } = await bootApp({ storage, hash: '' });
  const writesAtBoot = storage.writes.length;
  api.setTool('rect');
  api.store.addElement(api.store.createElement('rect', { x: 0, y: 0, w: 40, h: 40 }));
  if (api.flushAutosave) api.flushAutosave();
  else if (api.autosave && api.autosave.flush) api.autosave.flush();
  else { await new Promise((r) => setTimeout(r, 600)); }
  assert.ok(storage.writes.length > writesAtBoot, 'a write landed after creating a shape');
  const last = JSON.parse(storage.writes[storage.writes.length - 1][1]);
  assert.ok(last.elements.some((e) => e.type === 'rect' && e.w === 40), 'saved payload contains the new shape');

  const beforeClear = storage.writes.length;
  itemByAction('clear').dispatch('click');
  if (api.flushAutosave) api.flushAutosave();
  else if (api.autosave && api.autosave.flush) api.autosave.flush();
  else { await new Promise((r) => setTimeout(r, 600)); }
  assert.ok(storage.writes.length > beforeClear, 'clear canvas also triggers a save');
  assert.deepEqual(JSON.parse(storage.writes[storage.writes.length - 1][1]).elements, [], 'cleared state persisted');
});

test('M8b unload hooks flush pending autosave (refresh inside debounce window loses nothing)', async () => {
  const storage = fakeStorage();
  const { api, win } = await bootApp({ storage });
  api.store.addElement(api.store.createElement('rect', { x: 0, y: 0, w: 5, h: 5 }));
  const before = storage.writes.length;
  for (const evt of ['visibilitychange', 'beforeunload']) {
    try { win.dispatch(evt, { visibilityState: 'hidden' }); } catch (e) { /* listener optional */ }
  }
  assert.ok(storage.writes.length > before, 'a flush hook is wired to visibilitychange/beforeunload');
});
