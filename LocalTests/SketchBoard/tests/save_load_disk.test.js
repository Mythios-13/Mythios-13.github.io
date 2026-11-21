// TESTER F6 (RED): save current sketch to disk / load a sketch from disk.
// Format decision (client): the file IS the localStorage envelope
// {app:'sketchboard', version:1, elements:[...]} - so inspectDocString (same brain as
// inspectSavedDoc, MAJOR-4) validates BOTH doors. Spec: docs/specs/F6-save-load-disk.md.
// Decisions baked in per spec D-F6-1/D-F6-2: Open works WHILE LOCKED and CLEARS the
// lock; Open is UNDOABLE (pushState before fromJSON).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDom } from './dom_stub.js';
import { STORAGE_KEY } from '../src/persistence.js';
import { buildDownloadName } from '../src/export.js';

async function bootApp(deps = {}, seedStorage = {}) {
  const { doc, win } = makeDom();
  globalThis.document = doc; globalThis.window = win;
  const mod = await import('../src/app.js');
  const root = doc.createElement('div');
  const map = new Map(Object.entries(seedStorage));   // F6-7: boot on PRE-EXISTING bytes
  const storage = { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k) };
  const api = mod.boot(root, Object.assign({ storage, hash: '', download() {}, debounceMs: 0 }, deps));
  const hud = () => (root.querySelectorAll('.hud') || [])[0];
  return { api, root, storage, map, hud };
}
const goodDoc = (n = 2) => ({
  app: 'sketchboard', version: 1,
  elements: Array.from({ length: n }, (_, i) => ({ id: `el_${i + 1}`, type: 'rect', x: i * 10, y: 0, w: 10, h: 10, style: {} })),
});

// ------------------------------------------------------------------ F6-1 / F6-8 SAVE
test('F6-1 save-to-disk emits EXACTLY store.toJSON() under a .json name', async () => {
  const calls = [];
  const { api } = await bootApp({ saveFile: (name, text, mime) => { calls.push({ name, text, mime }); } });
  await api.runMenuAction('save-disk');
  assert.equal(calls.length, 1, 'sink called once');
  assert.match(calls[0].name, /\.json$/, 'name ends .json: ' + calls[0].name);
  assert.deepEqual(JSON.parse(calls[0].text), api.store.toJSON(), 'payload == localStorage envelope');
  assert.match(String(calls[0].mime), /json/, 'mime says json');
});

test('F6-2 hostile base names are sanitized: no separators, no dot-dot', () => {
  for (const evil of ['../../etc/x', 'a\\b/c', 'ok\x00name', '   ', '.', '///']) {
    const out = buildDownloadName({ base: evil, format: 'json' });
    assert.ok(!out.includes('/'), `no slash in ${JSON.stringify(evil)} -> ${out}`);
    assert.ok(!out.includes('\\'), `no backslash in ${JSON.stringify(evil)} -> ${out}`);
    assert.ok(!out.includes('..'), `no dot-dot in ${JSON.stringify(evil)} -> ${out}`);
    assert.match(out, /\.json$/, 'still a .json name');
  }
});

test('F6-8 save sink throwing => error toast, board intact, no unhandled rejection', async () => {
  const { api, hud } = await bootApp({ saveFile: () => { throw new Error('disk on fire'); } });
  const before = JSON.stringify(api.store.toJSON());
  await api.runMenuAction('save-disk');            // must NOT reject
  assert.equal(JSON.stringify(api.store.toJSON()), before, 'board untouched');
  assert.match((hud() && hud().textContent) || '', /fail|error|could not/i, 'user told: ' + (hud() && hud().textContent));
});

// ------------------------------------------------------------------------ LOAD
test('F6-3 roundtrip: loading what we saved yields BYTE-IDENTICAL toJSON()', async () => {
  const saved = [];
  const a = await bootApp({ saveFile: (n, tx) => saved.push(tx) });
  // Make the saved doc DIFFER from a fresh welcome scene, else "replaced" would compare
  // two identical seeds and prove nothing (test-side trap found while debugging).
  a.api.store.addElement(a.api.store.createElement('ellipse', { x: 500, y: 500, w: 40, h: 30 }));
  await a.api.runMenuAction('save-disk');
  const b = await bootApp({ openFile: async () => ({ name: 'x.json', text: saved[0] }) });
  const before = JSON.stringify(b.api.store.toJSON());     // untouched welcome scene
  await b.api.runMenuAction('open-disk');
  assert.equal(JSON.stringify(b.api.store.toJSON()), saved[0], 'exact roundtrip');
  assert.notEqual(JSON.stringify(b.api.store.toJSON()), before, 'it really replaced the board');
});

test('F6-4 refuse-whole-file: bad payloads leave board, selection AND storage byte-identical', async () => {
  const badPayloads = [
    ['malformed', '{not json'],
    ['foreign', JSON.stringify({ app: 'notepad', version: 1, elements: [] })],
    ['newer-version', JSON.stringify({ app: 'sketchboard', version: 99, elements: [] })],
    ['bad-version', JSON.stringify({ app: 'sketchboard', version: '1', elements: [] })],
    ['bad-element', JSON.stringify({ app: 'sketchboard', version: 1, elements: [{ id: 'z', type: 'banana', style: {} }] })],
  ];
  for (const [label, text] of badPayloads) {
    const { api, map, hud } = await bootApp({ openFile: async () => ({ name: 'x.json', text }) });
    await new Promise((r) => setTimeout(r, 5));   // let the seed-time autosave (delay 0) settle,
                                                  // else its timer could fire BETWEEN our reads
    const snapBefore = JSON.stringify(api.store.toJSON());
    const storedBefore = map.get(STORAGE_KEY);
    const histBefore = api.store._history.length;
    await api.runMenuAction('open-disk');
    assert.equal(JSON.stringify(api.store.toJSON()), snapBefore, `${label}: board must be untouched`);
    assert.equal(api.store.selected.size, 0, `${label}: selection untouched`);
    assert.equal(api.store._history.length, histBefore, `${label}: no history spam`);
    assert.equal(map.get(STORAGE_KEY), storedBefore, `${label}: storage untouched`);
    const msg = (hud() && hud().textContent) || '';
    assert.match(msg, /cannot open|refus|invalid|unreadable|damaged|foreign|newer|unknown/i, `${label}: toast must explain (${msg})`);
  }
});

test('F6-5 happy load replaces board, clears selection, ONE undo restores (D-F6-2)', async () => {
  const incoming = goodDoc(2);
  const { api } = await bootApp({ openFile: async () => ({ name: 'in.json', text: JSON.stringify(incoming) }) });
  const prevEls = JSON.parse(JSON.stringify(api.store.elements));
  api.store.select([api.store.elements[0].id]);
  assert.equal(api.store.selected.size, 1);
  await api.runMenuAction('open-disk');
  assert.equal(api.store.elements.length, 2, 'loaded doc in place');
  assert.deepEqual(api.store.elements.map((e) => e.id), ['el_1', 'el_2']);
  assert.equal(api.store.selected.size, 0, 'selection cleared by document switch');
  assert.equal(api.store.undo(), true, 'one undo restores (pushState-before-load)');
  assert.equal(JSON.stringify(api.store.elements), JSON.stringify(prevEls), 'exactly the pre-open board');
});

test('F6-6 picker CANCEL mutates nothing: no board change, no history entry', async () => {
  const { api } = await bootApp({ openFile: async () => null });
  const snap = JSON.stringify(api.store.toJSON());
  const hist = api.store._history.length;
  await api.runMenuAction('open-disk');
  assert.equal(JSON.stringify(api.store.toJSON()), snap, 'cancel is a no-op');
  assert.equal(api.store._history.length, hist, 'cancel pushes no state');
});

test('F6-9 SAVE IS ALLOWED WHILE LOCKED (spec 3.3): reading your own board cannot clobber', async () => {
  const future = { app: 'sketchboard', version: 99, elements: [] };
  const calls = [];
  const { api } = await bootApp(
    { saveFile: (n, tx, m) => calls.push({ n, tx, m }) },
    { [STORAGE_KEY]: JSON.stringify(future) });            // boot LOCKED
  assert.equal(api.readOnly, true, 'precondition: locked');
  await api.runMenuAction('save-disk');
  assert.equal(calls.length, 1, 'save must NOT be refused just because the board is locked');
  assert.deepEqual(JSON.parse(calls[0].tx), api.store.toJSON(), 'payload == current board');
});

test('F6-7 OPEN WORKS WHILE LOCKED and CLEARS the lock (D-F6-1)', async () => {
  const future = { app: 'sketchboard', version: 99, elements: [{ id: 'el_9', type: 'star', x: 1, y: 1, w: 5, h: 5, style: {} }] };
  const raw = JSON.stringify(future);
  const { api, map } = await bootApp(
    { openFile: async () => ({ name: 'backup.json', text: JSON.stringify(goodDoc(1)) }) },
    { [STORAGE_KEY]: raw });                             // boot ON the protected payload
  // precondition: booted LOCKED on the v99 payload, storage preserved (MAJOR-4 contract)
  assert.equal(api.readOnly, true, 'precondition: locked');
  assert.equal(map.get(STORAGE_KEY), raw, 'precondition: v99 bytes intact');
  await api.runMenuAction('open-disk');
  assert.equal(api.store.elements.length, 1, 'good file loaded DESPITE the lock');
  assert.equal(api.readOnly, false, 'successful load clears the lock');
  api.store.addElement(api.store.createElement('rect', { x: 0, y: 0, w: 5, h: 5 }));
  api.autosave.flush();
  const written = JSON.parse(map.get(STORAGE_KEY));
  assert.equal(written.app, 'sketchboard'); assert.equal(written.version, 1);
  assert.equal(written.elements.length, 2, 'autosave healed the key: edit persisted');
});
