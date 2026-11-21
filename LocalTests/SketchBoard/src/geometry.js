// geometry.js — PURE module: bboxes, hit-testing, polygon math, path smoothing.
// No DOM access. All coordinates are WORLD-space numbers.

export const EPS = 1e-9;

export function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

/** Normalize a possibly-negative-w/h rect to positive extents. */
export function normalizeRect(r) {
  return {
    x: r.w < 0 ? r.x + r.w : r.x,
    y: r.h < 0 ? r.y + r.h : r.y,
    w: Math.abs(r.w),
    h: Math.abs(r.h),
  };
}

export function rectUnion(a, b) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x, y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  };
}

export function rectIntersects(a, b) {
  return !(a.x + a.w < b.x || b.x + b.w < a.x || a.y + a.h < b.y || b.y + b.h < a.y);
}

export function rectContainsPoint(r, p) {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

/** Distance from point p to segment a-b. Handles degenerate (zero-length) segments. */
export function distanceToSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < EPS) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / len2, 0, 1);
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Ray-casting point-in-polygon. pts: [{x,y},...] */
export function pointInPolygon(pts, p) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x, yi = pts[i].y, xj = pts[j].x, yj = pts[j].y;
    const intersect = (yi > p.y) !== (yj > p.y) &&
      p.x < ((xj - xi) * (p.y - yi)) / (yj - yi + EPS) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * TEXT METRICS CONTRACT — single source of truth for how text is laid out.
 * render.js draws tspan i at baseline y = el.y + i*fs*TEXT_LINE_HEIGHT_RATIO
 * (lines stack DOWNWARD from el.y, the FIRST BASELINE). Anything that needs the
 * painted extent of text (hit-testing, selection overlay, resize anchoring) MUST
 * derive from these constants — T10 round 1 shipped a hit box floating above the
 * glyphs because this relationship lived in three heads (render, geometry, tools)
 * instead of one. See tests/text_editable_multiline.test.js.
 */
export const TEXT_LINE_HEIGHT_RATIO = 1.25;   // baseline-to-baseline / fontSize
export const TEXT_ASCENT_RATIO = 0.8;          // cap height above the FIRST baseline
export const TEXT_DESCENT_RATIO = 0.45;        // room below the LAST baseline (>= descender)

/** Approximate text metrics (no DOM here — deterministic estimate). */
export function textSize(el) {
  const fs = (el.style && el.style.fontSize) || 24;
  const lines = String(el.text ?? '').split('\n');
  const longest = lines.reduce((m, l) => Math.max(m, l.length), 1);
  // Height convention: n line boxes of lineHeight each. Combined with the corrected
  // bbox.y (first baseline - ascent) below, the band spans cap-of-line-1 .. last
  // baseline + TEXT_DESCENT_RATIO*fs, covering every painted glyph.
  return { w: longest * fs * 0.6, h: Math.max(1, lines.length) * fs * TEXT_LINE_HEIGHT_RATIO };
}

/** Axis-aligned bbox in world coords for any element type. */
export function bboxOfElement(el) {
  switch (el.type) {
    case 'line':
    case 'arrow': {
      const a = el.from || { x: 0, y: 0 }, b = el.to || { x: 0, y: 0 };
      return rectUnion(
        { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: 0, h: 0 },
        { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y), w: 0, h: 0 });
    }
    case 'path': {
      const pts = el.points || [];
      if (!pts.length) return { x: el.x || 0, y: el.y || 0, w: 0, h: 0 };
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of pts) {
        minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
      }
      return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }
    case 'text': {
      const s = textSize(el);
      const fs = (el.style && el.style.fontSize) || 24;
      // TOP = first baseline minus cap height. NOT el.y - 0.85*h: that floated the whole
      // box above the text for multi-line elements (T10-B: lines 2..N unhittable).
      return { x: el.x, y: el.y - TEXT_ASCENT_RATIO * fs, w: s.w, h: s.h };
    }
    default:
      return normalizeRect({ x: el.x, y: el.y, w: el.w ?? 0, h: el.h ?? 0 });
  }
}

/**
 * F1 — the single pure primitive behind every handle resize.
 * Drag `corner` to `point`; the OPPOSITE corner is the immovable anchor.
 *
 * Guarantees (docs/specs/F1-resize-handles.md §3.3):
 *   - never mutates its inputs
 *   - never returns negative or non-finite w/h (past-anchor drags CLAMP, they do not flip — D1)
 *   - with `aspectRatio` (w/h) the result is the SMALLEST box with that exact ratio that still
 *     CONTAINS the requested box, anchored on the fixed corner
 *
 * @param {{x:number,y:number,w:number,h:number}} rect   box at gesture start
 * @param {'nw'|'ne'|'sw'|'se'} corner                    handle being dragged
 * @param {{x:number,y:number}} point                     current pointer, world coords
 * @param {{minSize?:number, aspectRatio?:number|null}} [opts]
 * @returns {{x:number,y:number,w:number,h:number}}
 */
export const RESIZE_CORNERS = ['nw', 'ne', 'sw', 'se'];

export function resizeRect(rect, corner, point, opts = {}) {
  if (!RESIZE_CORNERS.includes(corner)) throw new Error(`resizeRect: unknown corner "${corner}"`);
  const minSize = Number.isFinite(opts.minSize) ? Math.max(0, opts.minSize) : 0;
  const ratio = Number.isFinite(opts.aspectRatio) && opts.aspectRatio > 0 ? opts.aspectRatio : null;

  // Sanitise inputs: garbage in must degrade to a valid box, never NaN into the model.
  const rx = Number.isFinite(rect && rect.x) ? rect.x : 0;
  const ry = Number.isFinite(rect && rect.y) ? rect.y : 0;
  const rw = Number.isFinite(rect && rect.w) ? Math.abs(rect.w) : 0;
  const rh = Number.isFinite(rect && rect.h) ? Math.abs(rect.h) : 0;
  const px = Number.isFinite(point && point.x) ? point.x : rx + rw;
  const py = Number.isFinite(point && point.y) ? point.y : ry + rh;

  // Anchor = the corner we are NOT dragging. Computed from the ORIGINAL box so it is
  // bit-exact regardless of how far or how often the pointer moves.
  const ax = corner.includes('w') ? rx + rw : rx;
  const ay = corner.includes('n') ? ry + rh : ry;

  // SIGNED extents: dragging a west/north corner grows the box towards negative coordinates.
  // Deliberately NOT Math.abs() — abs would let a past-anchor drag grow the box in the wrong
  // direction (a silent flip, rejected by D1). Negative here means "pointer crossed the anchor"
  // and is flattened to minSize by the clamp below.
  const wantW = corner.includes('w') ? ax - px : px - ax;
  const wantH = corner.includes('n') ? ay - py : py - ay;
  let w = clamp(wantW, minSize, Infinity);
  let h = clamp(wantH, minSize, Infinity);

  if (ratio) {
    // Contain-and-scale: honour the long axis, grow the short one to match the ratio.
    const s = Math.max(w / ratio, h);           // s == final height
    h = s;
    w = s * ratio;
    if (w < minSize || h < minSize) {            // compose with the floor without losing the ratio
      h = Math.max(h, minSize, minSize / ratio);
      w = h * ratio;
    }
  }

  // Rebuild from the anchor so the fixed corner cannot drift by a rounding step.
  // Dragging a WEST corner means the anchor is the EAST edge, so the box starts at ax - w.
  return {
    x: corner.includes('w') ? ax - w : ax,
    y: corner.includes('n') ? ay - h : ay,
    w,
    h,
  };
}

/** Corner coordinates of a box, keyed by handle name. Shared by render + hit-testing. */
export function cornerPoints(r) {
  return {
    nw: { x: r.x, y: r.y },
    ne: { x: r.x + r.w, y: r.y },
    sw: { x: r.x, y: r.y + r.h },
    se: { x: r.x + r.w, y: r.y + r.h },
  };
}

/** Opposite corner name — the anchor for a given dragged handle. */
export function oppositeCorner(corner) {
  return { nw: 'se', ne: 'sw', sw: 'ne', se: 'nw' }[corner];
}

/** Regular n-gon inscribed in the bbox ellipse (used for triangle/diamond). */
export function regularPolygonPoints(cx, cy, rx, ry, sides, startAngle = -Math.PI / 2) {
  const pts = [];
  for (let i = 0; i < sides; i++) {
    const a = startAngle + (i * 2 * Math.PI) / sides;
    pts.push({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) });
  }
  return pts;
}

/** 5-point (or n-point) star vertices alternating outer/inner radii. */
export function starPoints(cx, cy, rx, ry, points = 5, innerRatio = 0.45) {
  const pts = [];
  for (let i = 0; i < points * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    const k = i % 2 === 0 ? 1 : innerRatio;
    pts.push({ x: cx + rx * k * Math.cos(a), y: cy + ry * k * Math.sin(a) });
  }
  return pts;
}

/** Triangle vertices for a bbox (apex top-center). */
export function trianglePoints(r) {
  return [
    { x: r.x + r.w / 2, y: r.y },
    { x: r.x + r.w, y: r.y + r.h },
    { x: r.x, y: r.y + r.h },
  ];
}

/** Diamond vertices for a bbox. */
export function diamondPoints(r) {
  return [
    { x: r.x + r.w / 2, y: r.y },
    { x: r.x + r.w, y: r.y + r.h / 2 },
    { x: r.x + r.w / 2, y: r.y + r.h },
    { x: r.x, y: r.y + r.h / 2 },
  ];
}

/** Solid triangular arrowhead at `to`, pointing away from `from`. */
export function arrowHeadPolygon(from, to, size) {
  const ang = Math.atan2(to.y - from.y, to.x - from.x);
  const spread = Math.PI * 0.82; // half-angle of the head cone
  const p = (a, r) => ({ x: to.x + r * Math.cos(a), y: to.y + r * Math.sin(a) });
  return [to, p(ang + spread, size), p(ang - spread, size)];
}

/** Quadratic-bezier smoothing through sampled points (freehand ink). */
export function pointsToSmoothPath(points) {
  if (!points || points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y} l 0.01 0`;
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const mx = (points[i].x + points[i + 1].x) / 2;
    const my = (points[i].y + points[i + 1].y) / 2;
    d += ` Q ${points[i].x} ${points[i].y} ${mx} ${my}`;
  }
  const last = points[points.length - 1];
  d += ` L ${last.x} ${last.y}`;
  return d;
}

/** Polygon outline of the element (for polygonal shapes), else null. */
export function outlineOfShape(el) {
  const r = bboxOfElement(el);
  switch (el.type) {
    case 'triangle': return trianglePoints(r);
    case 'diamond': return diamondPoints(r);
    case 'star': return starPoints(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2);
    default: return null;
  }
}

/**
 * Precise hit-test against a single element.
 * tol: tolerance in WORLD units (caller converts from screen px / scale).
 */
export function hitTestElement(el, p, tol = 6) {
  const bbox = bboxOfElement(el);
  const pad = { x: bbox.x - tol, y: bbox.y - tol, w: bbox.w + 2 * tol, h: bbox.h + 2 * tol };
  if (!rectContainsPoint(pad, p)) return false;
  const st = el.style || {};
  const sw = Math.max(st.strokeWidth ?? 1, 1);
  const t = Math.max(tol, sw / 2 + 2);

  switch (el.type) {
    case 'line':
    case 'arrow':
      return distanceToSegment(p, el.from || { x: 0, y: 0 }, el.to || { x: 0, y: 0 }) <= t;
    case 'path': {
      const pts = el.points || [];
      if (pts.length === 1) return Math.hypot(p.x - pts[0].x, p.y - pts[0].y) <= t;
      for (let i = 0; i < pts.length - 1; i++) {
        if (distanceToSegment(p, pts[i], pts[i + 1]) <= t) return true;
      }
      return false;
    }
    case 'text': {
      // T10 (client S4: "can't edit text via double click"): every other type gets the
      // padded rect; text used the BARE estimate, so presses on/near glyph edges missed
      // pick() -> dblclick found nothing -> silent no-op. textSize() is an ESTIMATE
      // (len*fs*0.6); real advance widths deviate in BOTH directions by font family,
      // weight and case — hence a FONT-PROPORTIONAL margin (metric error scales with
      // fontSize), floored by the shared type tolerance t (already zoom-compensated).
      // Trade-off accepted: a wider hit band can out-compete a shape underneath for a
      // click; pick() resolves that by z-order (topmost wins), same as any overlap.
      const fs = (st.fontSize ?? 24);
      const tPad = Math.max(t, fs * 0.3, bbox.h * 0.15);
      return rectContainsPoint({ x: bbox.x - tPad, y: bbox.y - tPad, w: bbox.w + 2 * tPad, h: bbox.h + 2 * tPad }, p);
    }
    case 'ellipse': {
      // NB-2 (review): rim band uses min-radius normalization; uneven for eccentric ellipses (v1 ok).
      const cx = bbox.x + bbox.w / 2, cy = bbox.y + bbox.h / 2;
      const rx = Math.max(bbox.w / 2, EPS), ry = Math.max(bbox.h / 2, EPS);
      const v = ((p.x - cx) ** 2) / (rx * rx) + ((p.y - cy) ** 2) / (ry * ry);
      const normT = t / Math.min(rx, ry);
      if (st.fillEnabled !== false) return v <= 1 + normT;
      return Math.abs(v - 1) <= normT * 2;
    }
    case 'rect': {
      const inside = rectContainsPoint(bbox, p);
      if (st.fillEnabled !== false) return inside;
      // NB-1 (review): sub-tolerance rects treat their whole area as border — intentional.
      const inset = { x: bbox.x + t, y: bbox.y + t, w: bbox.w - 2 * t, h: bbox.h - 2 * t };
      return inside && !(inset.w > 0 && inset.h > 0 && rectContainsPoint(inset, p));
    }
    default: {
      const poly = outlineOfShape(el);
      if (!poly) return rectContainsPoint(bbox, p);
      if (st.fillEnabled !== false && pointInPolygon(poly, p)) return true;
      for (let i = 0; i < poly.length; i++) {
        if (distanceToSegment(p, poly[i], poly[(i + 1) % poly.length]) <= t) return true;
      }
      return false;
    }
  }
}
