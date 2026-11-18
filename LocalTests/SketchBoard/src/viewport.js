// viewport.js — PURE module: pan/zoom math for the infinite canvas.
// World <-> screen mapping: screen = world * scale + (x, y)

export const MIN_SCALE = 0.05;
export const MAX_SCALE = 40;

export class Viewport {
  constructor(x = 0, y = 0, scale = 1) {
    this.x = x;
    this.y = y;
    this.scale = scale;
  }

  screenToWorld(p) {
    return { x: (p.x - this.x) / this.scale, y: (p.y - this.y) / this.scale };
  }

  worldToScreen(w) {
    return { x: w.x * this.scale + this.x, y: w.y * this.scale + this.y };
  }

  /** Pan by a SCREEN-space delta (pixels). */
  panBy(dx, dy) {
    this.x += dx;
    this.y += dy;
  }

  /**
   * Zoom by `factor` keeping the world point under screen coord (sx, sy) FIXED.
   * Clamped to [MIN_SCALE, MAX_SCALE]; returns true if scale actually changed.
   */
  zoomAt(sx, sy, factor) {
    // REVIEWER BLOCKING-1: non-finite cursor/factor must be a true no-op,
    // never snap through clampScale(NaN) -> MIN_SCALE.
    if (!Number.isFinite(factor) || !Number.isFinite(sx) || !Number.isFinite(sy)) return false;
    const before = this.screenToWorld({ x: sx, y: sy });
    const next = clampScale(this.scale * factor);
    if (next === this.scale) return false;
    this.scale = next;
    // Enforce the anchor invariant exactly: screen_after(worldBefore) == (sx, sy)
    this.x = sx - before.x * this.scale;
    this.y = sy - before.y * this.scale;
    return true;
  }

  reset() {
    this.x = 0; this.y = 0; this.scale = 1;
  }

  /** Fit a world bbox into a viewport-sized window (screen px), centered. */
  fitTo(bbox, viewW, viewH, padding = 60) {
    if (!(bbox.w > 0) || !(bbox.h > 0) || !(viewW > 0) || !(viewH > 0)) return;
    const s = clampScale(Math.min((viewW - padding) / bbox.w, (viewH - padding) / bbox.h));
    this.scale = s;
    this.x = viewW / 2 - (bbox.x + bbox.w / 2) * s;
    this.y = viewH / 2 - (bbox.y + bbox.h / 2) * s;
  }

  toJSON() { return { x: this.x, y: this.y, scale: this.scale }; }
}

export function clampScale(s) {
  if (!Number.isFinite(s)) return MIN_SCALE;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
}
