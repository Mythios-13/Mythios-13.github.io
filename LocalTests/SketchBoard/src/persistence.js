// persistence.js - PURE module: autosave, restore, and the #reset URL hook.
// CONTRACT (T7 R4): NOTHING here may ever throw at the call site. Autosave is a
// convenience, not a dependency - a full/quota-blocked/private-mode storage must
// never be able to break drawing. Every storage access is therefore guarded.

import { ELEMENT_TYPES } from './store.js';

/** Versioned key: bumping the schema cannot poison saves from an older build. */
export const STORAGE_KEY = 'sketchboard.doc.v1';

/** MAJOR-4: the ONE schema version this build understands + writes. */
export const APP_ID = 'sketchboard';
export const DOC_VERSION = 1;

/**
 * MAJOR-4 — classify what is under our storage key WITHOUT ever throwing.
 * Returns { status, reason? } with status in:
 *   'none'           - nothing stored (first run -> seeding a demo is legitimate)
 *   'malformed'      - unparseable / not shaped like a doc
 *   'foreign'        - right key, different app -> must never be loaded OR overwritten
 *   'newer-version'  - written by a future build -> this build cannot represent it
 *   'bad-version'    - version present but not a positive integer
 *   'bad-element'    - structurally invalid element record
 *   'ok'             - loadable by this build
 * The distinction matters: 'none' may be seeded over; EVERY other non-ok status must
 * lock the board read-only, because autosave would destroy what the user cannot see.
 */
export function inspectSavedDoc(storage, key = STORAGE_KEY) {
  if (!storage || typeof storage.getItem !== 'function') return { status: 'none' };
  let raw = null;
  try {
    raw = storage.getItem(key);
  } catch (e) {
    // Safari private mode THROWS on read. Treat as none ONLY for reads; writes will
    // fail independently and are swallowed by createAutosave.
    return { status: 'none' };
  }
  if (typeof raw !== 'string' || !raw) return { status: 'none' };
  return inspectDocString(raw);
}

/**
 * F6 — THE single validation brain for any sketchboard envelope STRING, whichever door
 * it arrives through (localStorage value OR a .json file opened from disk). Same bytes,
 * same contract, same refusals — one brain cannot drift from the other. Empty string is
 * 'malformed' here (a real file with no content is damaged; only storage can be 'none').
 */
export function inspectDocString(raw) {
  if (typeof raw !== 'string' || !raw) return { status: 'malformed', reason: 'empty' };
  let data = null;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    return { status: 'malformed', reason: 'not valid JSON' };
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { status: 'malformed', reason: 'not an object' };
  if (!Array.isArray(data.elements)) return { status: 'malformed', reason: 'missing elements[]' };
  if ('app' in data && data.app !== APP_ID) return { status: 'foreign', reason: String(data.app) };
  if ('app' in data && typeof data.version === 'number' && Number.isInteger(data.version) && data.version > DOC_VERSION) {
    return { status: 'newer-version', reason: `v${data.version} > v${DOC_VERSION}` };
  }
  if (!Number.isInteger(data.version) || data.version <= 0) {
    return { status: 'bad-version', reason: String(data.version) };
  }
  if (data.version < DOC_VERSION) return { status: 'older-version', reason: `v${data.version} < v${DOC_VERSION}` };
  for (const el of data.elements) {
    if (!el || typeof el !== 'object' || !ELEMENT_TYPES.includes(el.type)) {
      return { status: 'bad-element', reason: el && el.type != null ? String(el.type) : String(el) };
    }
  }
  return { status: 'ok' };
}

/** Statuses whose payload must NOT be clobbered by this build's autosave. */
export function isProtectedStatus(status) {
  return status !== 'none' && status !== 'ok';
}

/** Parse + validate a saved doc. Returns a PRIVATE COPY, or null. Never throws.
 *  MAJOR-4: enforces app identity and exact version match — a foreign or future
 *  document is REFUSED outright (callers must consult inspectSavedDoc to know why). */
export function loadSavedDoc(storage, key = STORAGE_KEY) {
  const verdict = inspectSavedDoc(storage, key);
  if (verdict.status !== 'ok') return null;
  let data = null;
  try {
    data = JSON.parse(storage.getItem(key));
  } catch (e) {
    return null;
  }
  try {
    return JSON.parse(JSON.stringify(data));       // callers may mutate freely
  } catch (e) {
    return null;
  }
}

export const DEFAULT_DEBOUNCE_MS = 400;

/** '#reset' asks for an empty canvas THIS load only. Exact token, case-insensitive. */
export function isResetRequested(hash) {
  if (typeof hash !== 'string') return false;
  const tokens = hash.replace(/^#/, '').split(/[&#/?]+/);
  return tokens.some((t) => t.trim().toLowerCase() === 'reset');
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
    // MAJOR-4: a caller-side veto on WRITING (never on scheduling). Used to lock the
    // board read-only while an unreadable/newer payload sits under our key.
    canWrite = () => true,
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
    if (typeof canWrite === 'function' && !canWrite()) {  // MAJOR-4 read-only lock
      dirty = false;                               // drop it: this build may NEVER hold
      return false;                                //   a buffer destined for a locked key
    }
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
