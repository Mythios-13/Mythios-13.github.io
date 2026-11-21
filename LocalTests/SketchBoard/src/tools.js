// tools.js — PURE interaction state machine.
// app.js feeds pointer/key events in; tools mutate injected store+viewport and
// return action descriptors for rendering. No DOM here => fully unit-testable.

import { hitTestElement, bboxOfElement, normalizeRect, resizeRect, cornerPoints, TEXT_ASCENT_RATIO } from './geometry.js';

/** REVIEWER BLOCKING-1: Node 18.4 lacks structuredClone; elements are plain JSON data. */
export function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }

export const TOOLS = ['select', 'hand', 'rect', 'ellipse', 'triangle', 'diamond', 'star', 'line', 'arrow', 'path', 'text'];

// Tunables (named constants — no magic numbers per review standards)
export const CLICK_THRESHOLD_PX = 3;      // drags smaller than this count as clicks
export const MIN_SHAPE_SIZE_W = 3;        // discard accidental micro-shapes (world units at drag time)
export const FREEHAND_MIN_STEP_PX = 3;    // sample freehand points >= this screen distance apart
export const ZOOM_FACTOR = 1.0015;        // per wheel notch (deltaMode-dependent multipliers applied by caller)
export const HIT_TOL_SCREEN_PX = 6;
// F1 — resize handles.
export const HANDLE_HIT_SCREEN_PX = 7;    // grab radius around a handle centre (screen px) — CLIENT-SIGNED-OFF S4
export const MIN_FONT_SIZE = 4;           // text resize floor (world units)
export const MAX_FONT_SIZE = 1000;         // text resize ceiling — guards runaway drags
const RESIZABLE_BOX_TYPES = ['rect', 'ellipse', 'triangle', 'diamond', 'star'];
const CORNER_CURSOR = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize' };
const EPS_TOL = 1e-9;

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

  /**
   * F1 — the four handles of the CURRENTLY SELECTED element, in world coords.
   * Derived from the model (never from gOverlay.innerHTML) so the whole interaction stays
   * unit-testable and DOM-free. Single selection only: group resize is F1b (decision D3).
   */
  activeHandles() {
    if (this.tool !== 'select' || this.store.selected.size !== 1) return [];
    const el = this.store.selectedElements()[0];
    if (!el) return [];
    const cs = cornerPoints(bboxOfElement(el));
    return Object.keys(cs).map((corner) => ({ id: el.id, corner, x: cs[corner].x, y: cs[corner].y }));
  }

  /** Topmost handle under a world point, or null. Reverse paint order, like pick(). */
  hitHandle(worldPoint) {
    const r = HANDLE_HIT_SCREEN_PX / this.viewport.scale;
    const hs = this.activeHandles();
    for (let i = hs.length - 1; i >= 0; i--) {
      const h = hs[i];
      if (Math.abs(worldPoint.x - h.x) <= r && Math.abs(worldPoint.y - h.y) <= r) return h;
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
    // F1 AC10: handle hit-test runs BEFORE element pick — a handle sits on its own shape's
    // edge, so picking the shape first would make resizing impossible at any zoom.
    const handle = this.hitHandle(world);
    if (handle) {
      const el = this.store.get(handle.id);
      if (el) {
        if (!this.store.selected.has(handle.id)) this.store.select([handle.id]);
        this.drag = {
          kind: 'resize',
          id: handle.id,
          corner: handle.corner,
          start: world,
          pointerWorld: world,
          shift: !!ev.shiftKey,
          startScreen: { x: ev.x, y: ev.y },
          moved: false,
          snapshot: this.store.snapshot(),
          orig: [deepClone(el)],
        };
        return { type: 'selection' };
      }
    }
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
        const h = this.hitHandle(w);                       // F1: direct resize affordance
        if (h) return { type: 'cursor', cursor: CORNER_CURSOR[h.corner] };
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
      case 'resize': {
        const w = this.viewport.screenToWorld({ x: ev.x, y: ev.y });
        const sd = Math.hypot(ev.x - d.startScreen.x, ev.y - d.startScreen.y);
        if (!d.moved && sd < CLICK_THRESHOLD_PX) return { type: 'none' };   // AC5: click, not resize
        if (!d.moved) { d.moved = true; this.store.pushState(d.snapshot); } // AC4: exactly one entry
        const el = this.store.get(d.id);
        if (!el) return { type: 'none' };                 // deleted mid-gesture (AC12b)
        d.pointerWorld = w;
        d.shift = !!ev.shiftKey;                           // live modifier (D2)
        this._applyOriginalPositions();                    // pristine geometry, no drift (AC11)
        this._applyResize(el, d);
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
      case 'resize': {
        if (!d.moved) return { type: 'selection' };       // no history was pushed
        return { type: 'elements', resized: true };
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
      // F1: text resize mutates style.fontSize, so a resize gesture must also restore style
      // to be drift-free. Move drags never touch style, so this is a no-op for them.
      if (this.drag.kind === 'resize' && orig.style) el.style = deepClone(orig.style);
    }
  }

  /**
   * F1 — apply the current pointer position to the element being resized.
   * Called immediately after _applyOriginalPositions(), so it always works from pristine
   * geometry (AC11: frame-count independence) and can never accumulate rounding drift.
   * Unsupported types degrade to NO mutation (never a corrupted element).
   */
  _applyResize(el, d) {
    const orig = d.orig[0];
    if (!orig) return;
    const point = d.pointerWorld || d.start;
    // Spec §3.4 (amended S4): the floor is CONSTANT ON SCREEN — world units are scaled.
    // A bare world-unit floor lets low zoom collapse a shape below one handle grab
    // radius (unrecoverable). Reviewer lead #3; pinned by RZ1 across scales.
    const minSize = MIN_SHAPE_SIZE_W / Math.max(this.viewport.scale, EPS_TOL);
    // D2 REMOVED (client sign-off S4): box resize is always free deform; Shift has no
    // effect here. The aspectRatio primitive stays in geometry.js for F4 (images).
    const aspect = null;

    if (RESIZABLE_BOX_TYPES.includes(el.type)) {
      const r = resizeRect({ x: orig.x, y: orig.y, w: orig.w ?? 0, h: orig.h ?? 0 }, d.corner, point, { minSize, aspectRatio: aspect });
      el.x = r.x; el.y = r.y; el.w = r.w; el.h = r.h;
      return;
    }

    if (el.type === 'text') { this._resizeText(el, orig, d, minSize); return; }
    if (el.type === 'line' || el.type === 'arrow') { this._resizeSegment(el, orig, d, minSize); return; }
    if (el.type === 'path') { this._resizePath(el, orig, d, minSize); return; }
    // anything else: leave the pristine copy in place
  }

  /**
   * Text has no w/h — size lives ONLY in style.fontSize (and the model keeps vestigial
   * w:0,h:0 from createElement, which we must NOT repurpose). Scale the font by the dominant
   * axis ratio, then translate x/y so the OPPOSITE bbox corner stays anchored.
   */
  _resizeText(el, orig, d, minSize) {
    const b0 = bboxOfElement(orig);
    const box = resizeRect(b0, d.corner, d.pointerWorld, { minSize });
    const rw = b0.w > 0 ? box.w / b0.w : 1;
    const rh = b0.h > 0 ? box.h / b0.h : 1;
    const factor = Math.max(rw, rh, minSize / Math.max(b0.h, EPS_TOL));
    const fs0 = (orig.style && orig.style.fontSize) || 24;
    const fs = Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, fs0 * factor));
    el.style = { ...orig.style, fontSize: fs };
    const k = fs / fs0;                                     // resulting bbox extents
    const nw = b0.w * k, nh = b0.h * k;
    const ax = d.corner.includes('w') ? b0.x + b0.w : b0.x;
    const ay = d.corner.includes('n') ? b0.y + b0.h : b0.y;
    const bx = d.corner.includes('w') ? ax - nw : ax;        // bbox left
    const by = d.corner.includes('n') ? ay - nh : ay;        // bbox top
    el.x = orig.x + (bx - b0.x);                             // bbox.x == el.x
    // bbox.y == el.y - TEXT_ASCENT_RATIO*fs (geometry contract, T10-B) -> invert it with
    // the NEW fs. The old 0.85*totalHeight inversion floated multi-line anchors off glyphs.
    el.y = by + TEXT_ASCENT_RATIO * fs;
  }

  /** Line/arrow: naive x/y resize is a no-op, so move the NEAR endpoint; far one is the anchor. */
  _resizeSegment(el, orig, d, minSize) {
    const cs = cornerPoints(bboxOfElement(orig));
    const c = cs[d.corner];
    const ends = [['from', orig.from], ['to', orig.to]];
    let nearKey = 'to', best = Infinity;
    for (const [key, p] of ends) {
      const dist = Math.hypot(p.x - c.x, p.y - c.y);
      if (dist < best) { best = dist; nearKey = key; }       // first wins on exact ties
    }
    const anchorKey = nearKey === 'from' ? 'to' : 'from';
    const a = orig[anchorKey];
    let p = { ...d.pointerWorld };
    if (d.shift) {                                            // keep the original angle
      const dx = orig[nearKey].x - a.x, dy = orig[nearKey].y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / (len * len);
      p = { x: a.x + dx * t, y: a.y + dy * t };
    }
    let vx = p.x - a.x, vy = p.y - a.y;
    const len = Math.hypot(vx, vy);
    if (len < minSize) {                                      // never collapse to a dot
      if (len < EPS_TOL) { vx = d.corner.includes('w') ? -1 : 1; vy = d.corner.includes('n') ? -1 : 1; }
      else { vx = (vx / len) * minSize; vy = (vy / len) * minSize; }
      p = { x: a.x + vx, y: a.y + vy };
    }
    el[anchorKey] = { ...a };
    el[nearKey] = p;
  }

  /** Freehand paths hold absolute world points — scale them uniformly about the fixed anchor. */
  _resizePath(el, orig, d, minSize) {
    const b0 = bboxOfElement(orig);
    const box = resizeRect(b0, d.corner, d.pointerWorld, { minSize });
    const sx = b0.w > 0 ? box.w / b0.w : 1;
    const sy = b0.h > 0 ? box.h / b0.h : 1;
    const f = Math.max(sx, sy, minSize / Math.max(b0.h, EPS_TOL)); // uniform (spec §3.3)
    const ax = d.corner.includes('w') ? b0.x + b0.w : b0.x;
    const ay = d.corner.includes('n') ? b0.y + b0.h : b0.y;
    el.points = orig.points.map((p) => ({ x: ax + (p.x - ax) * f, y: ay + (p.y - ay) * f }));
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
