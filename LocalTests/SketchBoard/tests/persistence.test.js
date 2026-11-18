// TESTER T7 (RED): src/persistence.js - autosave + restore + #reset hook.
// Contract: NEVER throws at the call site. Storage may be missing, full, or hostile.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const M = '../src/persistence.js';
const mod = () => import(M);
const { Store } = await import('../src/store.js');

function fakeStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    map,
    calls: { get: 0, set: 0, remove: 0 },
    getItem(k) { this.calls.get++; return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { this.calls.set++; map.set(k, String(v)); },
    removeItem(k) { this.calls.remove++; map.delete(k); },
  };
}
function throwingStorage() {
  return {
    getItem() { throw new Error('SecurityError: private mode'); },
    setItem() { throw new Error('QuotaExceededError'); },
    removeItem() { throw new Error('SecurityError'); },
  };
}
/** Injected clock: lets us prove debouncing without sleeping. */
function fakeClock(start = 0) {
  let t = start;
  const timers = [];
  return {
    now: () => t,
    advance(ms) { t += ms; timers.sort((a, b) => a.at - b.at); while (timers.length && timers[0].at <= t) { const tm = timers.shift(); tm.fn(); } },
    setTimeout(fn, ms) { const tm = { fn, at: t + ms }; timers.push(tm); return tm; },
    clearTimeout(tm) { const i = timers.indexOf(tm); if (i >= 0) timers.splice(i, 1); },
    pending: () => timers.length,
  };
}
const docOf = (n) => ({ app: 'sketchboard', version: 1, elements: Array.from({ length: n }, (_, i) => ({ id: 'el_' + (i + 1), type: 'rect', x: i * 10, y: 0, w: 10, h: 10, style: {} })) });

// ------------------------------------------------------------------------- P1
test('P1 STORAGE_KEY is versioned so a schema change cannot poison old saves', async () => {
  const { STORAGE_KEY } = await mod();
  assert.equal(typeof STORAGE_KEY, 'string');
  assert.match(STORAGE_KEY, /sketchboard/i, 'namespaced to the app');
  assert.match(STORAGE_KEY, /(v\d+|version[_:=-]?\d+)/i, 'carries an explicit version marker: ' + STORAGE_KEY);
});

// ------------------------------------------------------------------------- P2
test('P2 isResetRequested: exact token only, case-insensitive, no substring matches', async () => {
  const { isResetRequested } = await mod();
  assert.equal(isResetRequested('#reset'), true);
  assert.equal(isResetRequested('reset'), true, 'hash prefix optional');
  assert.equal(isResetRequested('#Reset'), true, 'case-insensitive');
  assert.equal(isResetRequested('#RESET'), true);
  assert.equal(isResetRequested(''), false);
  assert.equal(isResetRequested(undefined), false);
  assert.equal(isResetRequested(null), false);
  assert.equal(isResetRequested('#other'), false);
  assert.equal(isResetRequested('#resetfoo'), false, 'no sloppy substring match');
  assert.equal(isResetRequested('#theme=dark&reset=1'), false, 'unrelated hash');
  assert.equal(isResetRequested('#reset#other'), true, 'token among others still counts');
});

// ------------------------------------------------------------------------- P3
test('P3 loadSavedDoc returns parsed doc for a good save', async () => {
  const { loadSavedDoc, STORAGE_KEY } = await mod();
  const st = fakeStorage({ [STORAGE_KEY]: JSON.stringify(docOf(3)) });
  const doc = loadSavedDoc(st);
  assert.ok(doc && Array.isArray(doc.elements) && doc.elements.length === 3);
});

test('P3b loadSavedDoc returns null WITHOUT throwing on every hostile input', async () => {
  const { loadSavedDoc, STORAGE_KEY } = await mod();
  const bad = { [STORAGE_KEY]: '{not json' };
  const wrongShape = { [STORAGE_KEY]: JSON.stringify({ hello: 'world' }) };
  const notArray = { [STORAGE_KEY]: JSON.stringify({ app: 'sketchboard', version: 1, elements: 'nope' }) };
  const badElement = { [STORAGE_KEY]: JSON.stringify({ app: 'sketchboard', version: 1, elements: [{ type: 'banana' }] }) };
  const cases = [
    ['null storage', null],
    ['undefined storage', undefined],
    ['empty storage', fakeStorage()],
    ['malformed JSON', fakeStorage(bad)],
    ['valid JSON wrong shape', fakeStorage(wrongShape)],
    ['elements not an array', fakeStorage(notArray)],
    ['element with unknown type', fakeStorage(badElement)],
    ['storage.getItem throws', throwingStorage()],
  ];
  for (const [label, st] of cases) {
    let out, threw = null;
    try { out = loadSavedDoc(st); } catch (e) { threw = e; }
    assert.equal(threw, null, label + ': must not throw, got ' + (threw && threw.message));
    assert.equal(out, null, label + ': must return null, got ' + JSON.stringify(out));
  }
});

test('P3c loadSavedDoc does not mutate or share references with storage', async () => {
  const { loadSavedDoc, STORAGE_KEY } = await mod();
  const payload = docOf(1);
  const st = fakeStorage({ [STORAGE_KEY]: JSON.stringify(payload) });
  const doc = loadSavedDoc(st);
  doc.elements[0].x = 999;
  assert.equal(JSON.parse(st.getItem(STORAGE_KEY)).elements[0].x, 0, 'returned doc is a private copy');
});

// ------------------------------------------------------------------------- P4
test('P4 autosave coalesces N rapid changes into ONE write on flush', async () => {
  const { createAutosave, STORAGE_KEY } = await mod();
  const store = new Store();
  const st = fakeStorage();
  const clock = fakeClock();
  const auto = createAutosave({ store, storage: st, debounceMs: 400, now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout });

  for (let i = 0; i < 25; i++) store.addElement(store.createElement('rect', { x: i, y: 0, w: 5, h: 5 }));
  assert.equal(st.calls.set, 0, 'nothing written inside the debounce window');

  // MUTATION KILLER (M9): a collapsed delay (setTimeout(fn, 0)) survives an
  // advance() that overshoots the window, so probe the boundary tightly.
  assert.equal(auto.stats.delay, 400, 'honours the injected debounceMs');
  clock.advance(399);
  assert.equal(st.calls.set, 0, 'must NOT write before the debounce elapses (got ' + st.calls.set + ')');
  assert.equal(clock.pending(), 1, 'one coalesced timer still pending at t=399');

  clock.advance(1);
  assert.equal(st.calls.set, 1, 'exactly one write once the debounce elapses, got ' + st.calls.set);
  assert.equal(clock.pending(), 0, 'timer drained after firing');

  const saved = JSON.parse(st.getItem(STORAGE_KEY));
  assert.equal(saved.app, 'sketchboard');
  assert.equal(saved.elements.length, 25, 'latest state persisted, not a stale snapshot');
  assert.ok(auto && typeof auto.flush === 'function', 'flush() exposed for unload hooks');
});

test('P4b flush() writes immediately and stores exactly store.toJSON()', async () => {
  const { createAutosave, STORAGE_KEY } = await mod();
  const store = new Store();
  const st = fakeStorage();
  const clock = fakeClock();
  const auto = createAutosave({ store, storage: st, debounceMs: 400, now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout });
  store.addElement(store.createElement('text', { x: 0, y: 0, text: 'hello' }));
  auto.flush();
  assert.equal(st.calls.set, 1, 'immediate write');
  assert.deepEqual(JSON.parse(st.getItem(STORAGE_KEY)), store.toJSON(), 'payload IS store.toJSON()');
  assert.equal(clock.pending(), 0, 'pending timer cleared by flush');
});

// ------------------------------------------------------------------------- P5
test('P5 autosave survives storage.setItem throwing (quota / private mode)', async () => {
  const { createAutosave } = await mod();
  const store = new Store();
  const clock = fakeClock();
  const st = throwingStorage();
  let auto, threw = null;
  try {
    auto = createAutosave({ store, storage: st, debounceMs: 10, now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout });
    store.addElement(store.createElement('rect', { x: 0, y: 0, w: 5, h: 5 }));
    clock.advance(50);
    auto.flush();
  } catch (e) { threw = e; }
  assert.equal(threw, null, 'autosave failure must never break drawing: ' + (threw && threw.message));
  // And the store keeps working afterwards.
  store.addElement(store.createElement('rect', { x: 1, y: 0, w: 5, h: 5 }));
  assert.equal(store.elements.length, 2);
});

test('P5b createAutosave tolerates missing/broken storage entirely', async () => {
  const { createAutosave } = await mod();
  const store = new Store();
  const clock = fakeClock();
  for (const st of [null, undefined, {}, { setItem: 42 }]) {
    let threw = null;
    try {
      const a = createAutosave({ store, storage: st, debounceMs: 10, now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout });
      store.addElement(store.createElement('rect', { x: 0, y: 0, w: 5, h: 5 }));
      clock.advance(50);
      if (a && a.flush) a.flush();
      if (a && a.cancel) a.cancel();
      if (a && a.stop) a.stop();
    } catch (e) { threw = e; }
    assert.equal(threw, null, 'must not throw for storage=' + JSON.stringify(st) + ': ' + (threw && threw.message));
  }
});

// ------------------------------------------------------------------------- P6
test('P6 flush() is idempotent; cancel() prevents a pending write', async () => {
  const { createAutosave, STORAGE_KEY } = await mod();
  const store = new Store();
  const st = fakeStorage();
  const clock = fakeClock();
  const auto = createAutosave({ store, storage: st, debounceMs: 400, now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout });
  store.addElement(store.createElement('rect', { x: 0, y: 0, w: 5, h: 5 }));
  auto.flush();
  auto.flush();
  auto.flush();
  assert.equal(st.calls.set, 1, 'repeated flush with no new changes writes once, got ' + st.calls.set);

  store.addElement(store.createElement('rect', { x: 9, y: 0, w: 5, h: 5 }));
  auto.cancel();
  clock.advance(5000);
  assert.equal(st.calls.set, 1, 'cancelled write never lands, got ' + st.calls.set);
  assert.equal(JSON.parse(st.getItem(STORAGE_KEY)).elements.length, 1, 'storage still holds pre-cancel state');
});

test('P6b stop()/unsubscribe detaches from the store', async () => {
  const { createAutosave, STORAGE_KEY } = await mod();
  const store = new Store();
  const st = fakeStorage();
  const clock = fakeClock();
  const auto = createAutosave({ store, storage: st, debounceMs: 10, now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout });
  if (typeof auto.stop !== 'function') { assert.ok(true, 'stop() optional'); return; }
  store.addElement(store.createElement('rect', { x: 0, y: 0, w: 5, h: 5 }));
  clock.advance(100);
  const before = st.calls.set;
  auto.stop();
  store.addElement(store.createElement('rect', { x: 5, y: 0, w: 5, h: 5 }));
  clock.advance(1000);
  assert.equal(st.calls.set, before, 'no writes after stop()');
});
