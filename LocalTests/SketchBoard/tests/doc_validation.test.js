// TESTER T9 (RED): reviewer MAJOR-4 -- loadSavedDoc never validated `app` or
// `version`. Two distinct harms:
//   (a) a foreign JSON blob living under our key is loaded as if it were ours;
//   (b) THE DATA-LOSS CASE: a save written by a FUTURE build (version > ours) is
//       rejected -> boot falls through to seed() -> addElement -> autosave fires ->
//       the user's real, newer document is OVERWRITTEN by demo shapes. Silent.
// Tests are written against the product contract, not the implementation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDom } from './dom_stub.js';
import { STORAGE_KEY, loadSavedDoc, inspectSavedDoc } from '../src/persistence.js';

const docWith = (over = {}) => Object.assign(
  { app: 'sketchboard', version: 1, elements: [{ id: 'el_1', type: 'rect', x: 0, y: 0, w: 10, h: 10, style: {} }] },
  over);

function fakeStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return { map, writes: [], getItem(k) { return map.has(k) ? map.get(k) : null; },
           setItem(k, v) { this.writes.push([k, String(v)]); map.set(k, String(v)); },
           removeItem(k) { map.delete(k); } };
}

// ---------------------------------------------------------------- (a) validation
test('V1 a save from a DIFFERENT app is refused', () => {
  const st = fakeStorage({ [STORAGE_KEY]: JSON.stringify(docWith({ app: 'notepad' })) });
  assert.equal(loadSavedDoc(st, STORAGE_KEY), null, 'foreign app must not load');
});

test('V2 a missing or non-integer version is refused', () => {
  for (const bad of [undefined, null, '1', 1.5, NaN, -1, {}, []]) {
    const st = fakeStorage({ [STORAGE_KEY]: JSON.stringify(docWith({ version: bad })) });
    assert.equal(loadSavedDoc(st, STORAGE_KEY), null, 'version=' + JSON.stringify(bad) + ' must not load');
  }
});

test('V3 a NEWER schema version is refused rather than half-loaded', () => {
  const st = fakeStorage({ [STORAGE_KEY]: JSON.stringify(docWith({ version: 99 })) });
  assert.equal(loadSavedDoc(st, STORAGE_KEY), null, 'future version must not be coerced into v1');
});

test('V4 the current supported version still loads (guard against over-blocking)', () => {
  const st = fakeStorage({ [STORAGE_KEY]: JSON.stringify(docWith()) });
  const doc = loadSavedDoc(st, STORAGE_KEY);
  assert.ok(doc, 'a valid v1 save MUST load');
  assert.equal(doc.elements.length, 1);
});

test('V5 inspectSavedDoc distinguishes why a save was refused', () => {
  const cases = [
    [docWith(), 'ok'],
    [docWith({ app: 'other' }), 'foreign'],
    [docWith({ version: 99 }), 'newer-version'],
    [{ hello: 'world' }, 'malformed'],
  ];
  for (const [payload, want] of cases) {
    const st = fakeStorage({ [STORAGE_KEY]: JSON.stringify(payload) });
    const r = inspectSavedDoc(st, STORAGE_KEY);
    assert.equal(r.status, want, JSON.stringify(payload) + ' -> expected ' + want + ', got ' + r.status);
  }
});

// ------------------------------------------------------- (b) THE DATA-LOSS CASE
// This is the one that destroys user work. If it regresses, a future build's users
// lose their boards the moment they roll back to this build.
async function bootWith(payload, extra = {}) {
  const { doc, win } = makeDom();
  globalThis.document = doc; globalThis.window = win;
  const mod = await import('../src/app.js');
  const root = doc.createElement('div');
  const storage = fakeStorage(payload === undefined ? {} : { [STORAGE_KEY]: JSON.stringify(payload) });
  const api = mod.boot(root, Object.assign({ storage, hash: '', download() {} }, extra));
  return { api, storage, root, hud: () => (root.querySelectorAll('.hud') || [])[0] };
}

test('V6 booting on a NEWER-version save must NOT overwrite it with demo content', async () => {
  const future = docWith({ version: 99, elements: [{ id: 'el_7', type: 'star', x: 5, y: 5, w: 9, h: 9, style: {} }] });
  const raw = JSON.stringify(future);
  const { storage, hud } = await bootWith(future, { debounceMs: 0 });
  await new Promise((r) => setTimeout(r, 40));

  const stored = storage.map.get(STORAGE_KEY);
  assert.equal(stored, raw,
    'the user\u2019s newer save was DESTROYED by autosave. stored=' + String(stored).slice(0, 120));
  for (const [, v] of storage.map) assert.ok(!/"version":1/.test(v), 'no v1 document may be written over a v99 save');
  const msg = (hud() && hud().textContent) || '';
  assert.match(msg, /newer|version|unsupported/i, 'user must be told WHY the board looks empty: ' + msg);
});

test('V7 while a refused save is on disk the board stays read-only (no silent clobber)', async () => {
  const future = docWith({ version: 99 });
  const { api, storage } = await bootWith(future, { debounceMs: 0 });
  // A deliberate user edit must also be refused, not silently rewritten.
  api.store.addElement(api.store.createElement('rect', { x: 0, y: 0, w: 5, h: 5 }));
  await new Promise((r) => setTimeout(r, 40));
  if (typeof api.autosave && api.autosave) api.autosave.flush();
  assert.equal(String(storage.map.get(STORAGE_KEY)), JSON.stringify(future),
    'an edit must never rewrite a save this build cannot understand');
});
