// tools.js — PURE interaction state machine.
// app.js feeds pointer/key events in; tools mutate injected store+viewport and
// return action descriptors for rendering. No DOM here => fully unit-testable.

import { hitTestElement, bboxOfElement, normalizeRect } from './geometry.js';

/** REVIEWER BLOCKING-1: Node 18.4 lacks structuredClone; elements are plain JSON data. */
export function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }

export const TOOLS = ['select', 'hand', 'rect', 'ellipse', 'triangle', 'diamond', 'star', 'line', 'arrow', 'path', 'text'];

// Tunables (named constants — no magic numbers per review standards)
export const CLICK_THRESHOLD_PX = 3;      // drags smaller than this count as clicks
export const MIN_SHAPE_SIZE_W = 3;        // discard accidental micro-shapes (world units at drag time)
export const FREEHAND_MIN_STEP_PX = 3;    // sample freehand points >= this screen distance apart
export const ZOOM_FACTOR = 1.0015;        // per wheel notch (deltaMode-dependent multipliers applied by caller)
export const HIT_TOL_SCREEN_PX = 6;

export class ToolManager {
  /**
   * @param {Store} store       injected model
   * @param {Viewport} viewport injected camera
   * @param {{getSize?: () => {width:number,height:number}}} env screen metrics provider
   */
  constructor(store, viewport, env = {}) {
    this.store = store;
    this.viewport = viewport;
    this.env = env;
    this.tool = 'select';
    this.spaceHeld = false;
    this.drag = null;           // active drag descriptor
    this.pendingText = null;    // world point where text tool wants a node
  }

  setTool(t) {
    if (!TOOLS.includes(t)) throw new Error(`Unknown tool: ${t}`);
    this.tool = t;
    this.drag = null;
    return { type: 'tool', tool: t };
  }

  _size() { return this.env.getSize ? this.env.getSize() : { width: 1280, height: 800 }; }
  _hitTolWorld() { return HIT_TOL_SCREEN_PX / this.viewport.scale; }

  /** Topmost element under a world point (paint order = array order). */
  pick(worldPoint) {
    const tol = this._hitTolWorld();
    for (let i = this.store.elements.length - 1; i >= 0; i--) {
      if (hitTestElement(this.store.elements[i], worldPoint, tol)) return this.store.elements[i];
    }
    return null;
  }

  // ------------------------------------------------------------------ input
  pointerDown(ev) {
    // ev: {button, shiftKey, x, y(screen)}
    const world = this.viewport.screenToWorld({ x: ev.x, y: ev.y });
    const panning = ev.button === 1 || this.tool === 'hand' || this.spaceHeld;
    if (panning) {
      this.drag = { kind: 'pan', lastX: ev.x, lastY: ev.y, middle: ev.button === 1 };
      return { type: 'cursor', cursor: 'grabbing' };
    }
    if (ev.button !== 0) return { type: 'ignored' };

    if (this.tool === 'select') return this._downSelect(world, ev);
    if (this.tool === 'text') {
      this.drag = { kind: 'place-text', start: world, origin: { x: ev.x, y: ev.y } };
      return { type: 'pending-text', world };
    }
    if (this.tool === 'path') {
      this.drag = { kind: 'freehand', points: [world], lastScreen: { x: ev.x, y: ev.y } };
      return { type: 'preview-path', points: [world] };
    }
    // shape drag-create
    this.drag = { kind: 'create', shapeType: this.tool, start: world, current: world, origin: { x: ev.x, y: ev.y } };
    return { type: 'preview-create', shapeType: this.tool };
  }

  _downSelect(world, ev) {
    const hit = this.pick(world);
    if (hit) {
      if (ev.shiftKey) {
        this.store.toggleSelect(hit.id);
        this.drag = null;
        return { type: 'selection' };
      }
      if (!this.store.selected.has(hit.id)) this.store.select([hit.id]);
      const snapshot = this.store.snapshot();
      const orig = this.store.selectedElements().map((e) => deepClone(e));
      this.drag = { kind: 'move', start: world, moved: false, snapshot, orig };
      return { type: 'selection' };
    }
    if (!ev.shiftKey) this.store.clearSelection();
    this.drag = { kind: 'marquee', start: world, current: world, origin: { x: ev.x, y: ev.y }, additive: !!ev.shiftKey };
    return { type: 'preview-marquee' };
  }

  pointerMove(ev) {
    if (!this.drag) {
      if (this.tool === 'select') {
        const w = this.viewport.screenToWorld({ x: ev.x, y: ev.y });
        return { type: 'cursor', cursor: this.pick(w) ? 'move' : 'default' };
      }
      return { type: 'none' };
    }
    const d = this.drag;
    switch (d.kind) {
      case 'pan': {
        this.viewport.panBy(ev.x - d.lastX, ev.y - d.lastY);
        d.lastX = ev.x; d.lastY = ev.y;
        return { type: 'viewport' };
      }
      case 'move': {
        const w = this.viewport.screenToWorld({ x: ev.x, y: ev.y });
        const dx = w.x - d.start.x, dy = w.y - d.start.y;
        if (!d.moved && Math.hypot(dx, dy) * this.viewport.scale < CLICK_THRESHOLD_PX) return { type: 'none' };
        if (!d.moved) { d.moved = true; this.store.pushState(d.snapshot); }
        this._applyOriginalPositions();          // restore pristine geometry...
        this.store.translateElements([...this.store.selected], dx, dy); // ...then offset once (no drift)
        return { type: 'elements' };
      }
      case 'create': {
        d.current = this.viewport.screenToWorld({ x: ev.x, y: ev.y });
        return { type: 'preview-create', shapeType: d.shapeType, rect: this._createRect(d) };
      }
      case 'freehand': {
        const step = Math.hypot(ev.x - d.lastScreen.x, ev.y - d.lastScreen.y);
        if (step < FREEHAND_MIN_STEP_PX) return { type: 'none' };
        d.lastScreen = { x: ev.x, y: ev.y };
        d.points.push(this.viewport.screenToWorld({ x: ev.x, y: ev.y }));
        return { type: 'preview-path', points: d.points };
      }
      case 'place-text': {
        // T5-A5: live caret under the cursor between mousedown and editor mount,
        // so the click-to-place target is visible (and follows pan/zoom).
        d.current = this.viewport.screenToWorld({ x: ev.x, y: ev.y });
        return { type: 'preview-text', world: d.current };
      }
      case 'marquee': {
        d.current = this.viewport.screenToWorld({ x: ev.x, y: ev.y });
        return { type: 'preview-marquee', rect: normalizeRect({ x: d.start.x, y: d.start.y, w: d.current.x - d.start.x, h: d.current.y - d.start.y }) };
      }
      default:
        return { type: 'none' };
    }
  }

  pointerUp(ev) {
    if (!this.drag) return { type: 'none' };
    const d = this.drag;
    this.drag = null;
    switch (d.kind) {
      case 'pan':
        return { type: 'cursor', cursor: 'default' };
      case 'place-text': {
        const tiny = Math.hypot(ev.x - d.origin.x, ev.y - d.origin.y) < CLICK_THRESHOLD_PX;
        if (!tiny) return { type: 'none' };                 // text is click-to-place only
        const el = this.store.createElement('text', { x: d.start.x, y: d.start.y, text: 'Text' });
        this.store.pushState(this.store.snapshot());
        this.store.addElement(el);
        this.store.select([el.id]);
        return { type: 'edit-text', id: el.id };
      }
      case 'move': {
        if (!d.moved) return { type: 'selection' };
        return { type: 'elements', moved: true };
      }
      case 'create': {
        const r = this._createRect(d);
        if (!r || r.w < MIN_SHAPE_SIZE_W || r.h < MIN_SHAPE_SIZE_W) return { type: 'discarded' };
        return this._commitCreate(d.shapeType, r);
      }
      case 'freehand': {
        if (d.points.length < 2) return { type: 'discarded' };
        this.store.pushState(this.store.snapshot());
        const el = this.store.createElement('path', { points: d.points, x: 0, y: 0 });
        this.store.addElement(el);
        this.store.select([el.id]);
        return { type: 'created', id: el.id };
      }
      case 'marquee': {
        const r = normalizeRect({ x: d.start.x, y: d.start.y, w: d.current.x - d.start.x, h: d.current.y - d.start.y });
        const tiny = Math.hypot(ev.x - d.origin.x, ev.y - d.origin.y) < CLICK_THRESHOLD_PX;
        if (tiny) return { type: 'none' };                   // background click already handled
        const ids = [];
        for (const el of this.store.elements) {
          const b = bboxOfElement(el);
          if (r.w <= 0 && r.h <= 0) continue;
          if (rectsIntersect(b, r)) ids.push(el.id);
        }
        this.store.select(ids, { additive: d.additive });
        return { type: 'selection', marquee: true };
      }
      default:
        return { type: 'none' };
    }
  }

  wheel(ev) {
    // ev: {x, y(screen), factor}
    const changed = this.viewport.zoomAt(ev.x, ev.y, ev.factor);
    return { type: 'viewport', changed };
  }

  keydown(ev) {
    if (ev.key === ' ' && !ev.repeat) { this.spaceHeld = true; return { type: 'cursor', cursor: 'grab' }; }
    return { type: 'none' };
  }
  keyup(ev) {
    if (ev.key === ' ') { this.spaceHeld = false; if (!this.drag) return { type: 'cursor', cursor: 'default' }; }
    return { type: 'none' };
  }

  // ----------------------------------------------------------------- helpers
  _createRect(d) {
    const w = d.current.x - d.start.x, h = d.current.y - d.start.y;
    if (d.shapeType === 'line' || d.shapeType === 'arrow') return { from: d.start, to: d.current };
    return normalizeRect({ x: d.start.x, y: d.start.y, w, h });
  }

  _applyOriginalPositions() {
    for (const orig of this.drag.orig) {
      const el = this.store.get(orig.id);
      if (!el) continue;
      if (orig.from && orig.to) { el.from = { ...orig.from }; el.to = { ...orig.to }; }
      else if (orig.points) { el.points = orig.points.map((p) => ({ ...p })); }
      else { el.x = orig.x; el.y = orig.y; }
    }
  }

  _commitCreate(shapeType, r) {
    this.store.pushState(this.store.snapshot());
    let el;
    if (shapeType === 'line' || shapeType === 'arrow') {
      const len = Math.hypot(r.to.x - r.from.x, r.to.y - r.from.y);
      if (len < MIN_SHAPE_SIZE_W) return { type: 'discarded' };
      el = this.store.createElement(shapeType, { from: { ...r.from }, to: { ...r.to } });
    } else {
      el = this.store.createElement(shapeType, { x: r.x, y: r.y, w: r.w, h: r.h });
    }
    this.store.addElement(el);
    this.store.select([el.id]);
    return { type: 'created', id: el.id };
  }
}

function rectsIntersect(a, b) {
  return !(a.x + a.w < b.x || b.x + b.w < a.x || a.y + a.h < b.y || b.y + b.h < a.y);
}
