// persistence.js - PURE module: autosave, restore, and the #reset URL hook.
// CONTRACT (T7 R4): NOTHING here may ever throw at the call site. Autosave is a
// convenience, not a dependency - a full/quota-blocked/private-mode storage must
// never be able to break drawing. Every storage access is therefore guarded.

import { ELEMENT_TYPES } from './store.js';

/** Versioned key: bumping the schema cannot poison saves from an older build. */
export const STORAGE_KEY = 'sketchboard.doc.v1';

export const DEFAULT_DEBOUNCE_MS = 400;

/** '#reset' asks for an empty canvas THIS load only. Exact token, case-insensitive. */
export function isResetRequested(hash) {
  if (typeof hash !== 'string') return false;
  const tokens = hash.replace(/^#/, '').split(/[&#/?]+/);
  return tokens.some((t) => t.trim().toLowerCase() === 'reset');
}

/** Parse + validate a saved doc. Returns a PRIVATE COPY, or null. Never throws. */
export function loadSavedDoc(storage, key = STORAGE_KEY) {
  if (!storage || typeof storage.getItem !== 'function') return null;
  let raw = null;
  try {
    raw = storage.getItem(key);
  } catch (e) {
    return null;                                  // Safari private mode throws on read
  }
  if (typeof raw !== 'string' || !raw) return null;
  let data = null;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    return null;                                  // corrupt save -> start clean
  }
  if (!data || typeof data !== 'object' || !Array.isArray(data.elements)) return null;
  for (const el of data.elements) {
    if (!el || typeof el !== 'object' || !ELEMENT_TYPES.includes(el.type)) return null;
  }
  try {
    return JSON.parse(JSON.stringify(data));       // callers may mutate freely
  } catch (e) {
    return null;
  }
}

/**
 * Debounced autosave wired to store.onChange().
 * All timing + storage are injected so the debounce is provable without sleeping.
 *   flush()  - write now (bound to visibilitychange/beforeunload by the shell)
 *   cancel() - drop any pending write
 *   stop()   - detach from the store entirely
 */
export function createAutosave(options = {}) {
  const {
    store,
    storage,
    key = STORAGE_KEY,
    debounceMs = DEFAULT_DEBOUNCE_MS,
    now = () => Date.now(),
    setTimeout: setTimer = setTimeout,
    clearTimeout: clearTimer = clearTimeout,
  } = options;

  const delay = Number.isFinite(debounceMs) && debounceMs >= 0 ? debounceMs : DEFAULT_DEBOUNCE_MS;
  let dirty = false;
  let timer = null;
  let stopped = false;
  let writes = 0;
  let failures = 0;

  function unschedule() {
    if (timer !== null && typeof clearTimer === 'function') clearTimer(timer);
    timer = null;
  }

  /** Returns true if a write actually reached storage. Swallows every storage error. */
  function write() {
    if (!dirty) return false;                      // idempotent: clean buffer writes nothing
    dirty = false;
    if (!store || typeof store.toJSON !== 'function') return false;
    if (!storage || typeof storage.setItem !== 'function') return false;
    try {
      storage.setItem(key, JSON.stringify(store.toJSON()));
      writes++;
      return true;
    } catch (e) {
      failures++;                                  // quota / private mode: stay silent
      return false;
    }
  }

  function schedule() {
    if (stopped) return;
    dirty = true;
    unschedule();
    if (typeof setTimer !== 'function') { write(); return; }
    timer = setTimer(() => { timer = null; write(); }, delay);
  }

  const unsubscribe = store && typeof store.onChange === 'function' ? store.onChange(schedule) : null;

  return {
    flush() { unschedule(); return write(); },
    cancel() { unschedule(); dirty = false; },
    stop() {
      stopped = true;
      unschedule();
      dirty = false;
      if (typeof unsubscribe === 'function') unsubscribe();
    },
    get stats() { return { writes, failures, pending: timer !== null, dirty, now: now(), delay }; },
  };
}
