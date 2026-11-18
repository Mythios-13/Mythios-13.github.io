// store.js — PURE module: element CRUD, selection, z-order, undo/redo, serialization.

import { cloneStyle } from './styles.js';

export const ELEMENT_TYPES = [
  'rect', 'ellipse', 'triangle', 'diamond', 'star',
  'line', 'arrow', 'path', 'text',
];

const HISTORY_CAP = 100;

/** REVIEWER BLOCKING-1: Node 18.4 lacks structuredClone; all model data is plain JSON. */
function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }
const FILE_VERSION = 1;

export class Store {
  constructor() {
    this.elements = [];      // ordered bottom -> top (paint order)
    this.selected = new Set();
    // T6: style used for NEW shapes when nothing is selected. Single source of
    // truth shared by the live draw preview and the committed element, so what
    // you see while dragging is by construction what lands on mouseup.
    this.pendingStyle = cloneStyle();
    this._seq = 0;
    this._history = [];      // stack of serialized states (previous states)
    this._future = [];       // redo stack
    this._listeners = [];
  }

  // ---------- events ----------
  onChange(cb) { this._listeners.push(cb); return () => {
    const i = this._listeners.indexOf(cb);
    if (i >= 0) this._listeners.splice(i, 1);
  }; }
  emit(reason = 'change') { for (const cb of this._listeners) cb(reason); }

  // ---------- identity ----------
  nextId() { return `el_${++this._seq}`; }

  // ---------- history ----------
  /** Push a previously-captured snapshot (call BEFORE mutating). */
  pushState(serialized) {
    this._history.push(serialized);
    while (this._history.length > HISTORY_CAP) this._history.shift();
    this._future.length = 0;
  }
  snapshot() { return JSON.stringify(this.elements); }
  canUndo() { return this._history.length > 0; }
  canRedo() { return this._future.length > 0; }
  undo() {
    if (!this.canUndo()) return false;
    this._future.push(this.snapshot());
    this._restore(this._history.pop());
    return true;
  }
  redo() {
    if (!this.canRedo()) return false;
    this._history.push(this.snapshot());
    this._restore(this._future.pop());
    return true;
  }
  _restore(serialized) {
    // NB-3 (review): _seq intentionally NOT rewound — ids are never reused.
    this.elements = JSON.parse(serialized);
    this._pruneSelection();
    this.emit('history');
  }

  // ---------- CRUD ----------
  createElement(type, props = {}, style = {}) {
    if (!ELEMENT_TYPES.includes(type)) throw new Error(`Unknown element type: ${type}`);
    const base = { id: this.nextId(), type, x: 0, y: 0, w: 0, h: 0 };
    if (type === 'line' || type === 'arrow') { base.from = { x: 0, y: 0 }; base.to = { x: 0, y: 0 }; delete base.w; delete base.h; }
    if (type === 'path') { base.points = []; delete base.w; delete base.h; }
    if (type === 'text') { base.text = 'Text'; }
    // pendingStyle sits UNDER any explicit style passed by the caller.
    const el = { ...base, ...props, style: { ...cloneStyle(this.pendingStyle), ...(style || {}) } };
    return el;
  }

  /** T6: set the style future shapes will be born with (empty-selection style bar). */
  setPendingStyle(patch) {
    this.pendingStyle = { ...this.pendingStyle, ...patch };
    return this.pendingStyle;
  }

  addElement(el) {
    this.elements.push(el);
    this.emit('add');
    return el;
  }

  get(id) { return this.elements.find((e) => e.id === id) || null; }
  indexOf(id) { return this.elements.findIndex((e) => e.id === id); }

  updateElement(id, patch) {
    const el = this.get(id);
    if (!el) return null;
    Object.assign(el, patch);
    this.emit('update');
    return el;
  }

  updateStyle(id, stylePatch) {
    const el = this.get(id);
    if (!el) return null;
    Object.assign(el.style, stylePatch);
    this.emit('style');
    return el;
  }

  deleteElements(ids) {
    const set = new Set(ids);
    this.elements = this.elements.filter((e) => !set.has(e.id));
    for (const id of set) this.selected.delete(id);
    this.emit('delete');
  }

  // ---------- selection ----------
  select(ids, { additive = false } = {}) {
    if (!additive) this.selected.clear();
    for (const id of ids) if (this.get(id)) this.selected.add(id);
    this.emit('selection');
  }
  toggleSelect(id) {
    if (!this.get(id)) return;
    this.selected.has(id) ? this.selected.delete(id) : this.selected.add(id);
    this.emit('selection');
  }
  clearSelection() { this.selected.clear(); this.emit('selection'); }
  selectedElements() { return this.elements.filter((e) => this.selected.has(e.id)); }
  _pruneSelection() {
    for (const id of [...this.selected]) if (!this.get(id)) this.selected.delete(id);
  }

  // ---------- transforms ----------
  translateElements(ids, dx, dy) {
    const set = new Set(ids);
    for (const el of this.elements) {
      if (!set.has(el.id)) continue;
      if (el.from && el.to) { el.from.x += dx; el.from.y += dy; el.to.x += dx; el.to.y += dy; }
      else if (el.points) { for (const p of el.points) { p.x += dx; p.y += dy; } }
      else { el.x += dx; el.y += dy; }
    }
    this.emit('move');
  }

  // ---------- z-order ----------
  _reorder(id, targetIndex) {
    const i = this.indexOf(id);
    if (i < 0) return;
    const [el] = this.elements.splice(i, 1);
    this.elements.splice(clampInt(targetIndex, 0, this.elements.length), 0, el);
    this.emit('zorder');
  }
  bringToFront(id) { this._reorder(id, this.elements.length); }
  sendToBack(id) { this._reorder(id, 0); }
  raise(id) { const i = this.indexOf(id); if (i >= 0) this._reorder(id, i + 1); }
  lower(id) { const i = this.indexOf(id); if (i >= 0) this._reorder(id, Math.max(0, i - 1)); }

  // ---------- clipboard-ish ----------
  duplicateElements(ids, offset = 16) {
    const clones = [];
    for (const id of ids) {
      const src = this.get(id);
      if (!src) continue;
      const c = deepClone(src);
      c.id = this.nextId();
      if (c.from && c.to) { c.from.x += offset; c.from.y += offset; c.to.x += offset; c.to.y += offset; }
      else if (c.points) { for (const p of c.points) { p.x += offset; p.y += offset; } }
      else { c.x += offset; c.y += offset; }
      clones.push(c);
    }
    this.elements.push(...clones);
    this.select(clones.map((c) => c.id));
    this.emit('duplicate');
    return clones;
  }

  // ---------- serialization ----------
  toJSON() {
    return { app: 'sketchboard', version: FILE_VERSION, elements: deepClone(this.elements) };
  }
  fromJSON(data) {
    if (!data || !Array.isArray(data.elements)) throw new Error('Invalid document: missing elements[]');
    for (const el of data.elements) {
      if (!el || typeof el !== 'object' || !ELEMENT_TYPES.includes(el.type)) {
        throw new Error(`Invalid document: bad element type ${el && el.type}`);
      }
    }
    this.elements = deepClone(data.elements);
    this._seq = this.elements.reduce((m, e) => {
      const n = Number(String(e.id || '').replace(/^el_/, ''));
      return Number.isFinite(n) ? Math.max(m, n) : m;
    }, 0);
    this.selected.clear();
    this._history.length = 0;
    this._future.length = 0;
    this.emit('load');
    return this;
  }
}

function clampInt(v, lo, hi) { return Math.min(hi, Math.max(lo, Math.trunc(v))); }
