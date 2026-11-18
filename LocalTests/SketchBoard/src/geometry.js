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

/** Approximate text metrics (no DOM here — deterministic estimate). */
export function textSize(el) {
  const fs = (el.style && el.style.fontSize) || 24;
  const lines = String(el.text ?? '').split('\n');
  const longest = lines.reduce((m, l) => Math.max(m, l.length), 1);
  return { w: longest * fs * 0.6, h: Math.max(1, lines.length) * fs * 1.25 };
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
      return { x: el.x, y: el.y - s.h * 0.85, w: s.w, h: s.h };
    }
    default:
      return normalizeRect({ x: el.x, y: el.y, w: el.w ?? 0, h: el.h ?? 0 });
  }
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
    case 'text':
      return rectContainsPoint(bbox, p);
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
