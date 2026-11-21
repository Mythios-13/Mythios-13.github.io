// render.js — PURE module: element -> SVG markup strings. XML-safe output.

import { bboxOfElement, outlineOfShape, arrowHeadPolygon, pointsToSmoothPath, normalizeRect, cornerPoints, TEXT_LINE_HEIGHT_RATIO } from './geometry.js';
import { DASH_PATTERNS } from './styles.js';

/** Escape every char that can break out of an attribute/text context. */
export function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function num(v) {
  return Number.isFinite(v) ? Math.round(v * 1000) / 1000 : 0;
}

function styleAttrs(el) {
  const st = el.style || {};
  const parts = [];
  const fillOn = st.fillEnabled !== false;
  parts.push(`fill="${fillOn ? escapeXml(st.fill || '#000000') : 'none'}"`);
  const strokeOn = st.strokeEnabled !== false;
  parts.push(`stroke="${strokeOn ? escapeXml(st.stroke || '#000000') : 'none'}"`);
  parts.push(`stroke-width="${num(st.strokeWidth ?? 2)}"`);
  parts.push(`opacity="${num(st.opacity ?? 1)}"`);
  const dash = DASH_PATTERNS[st.dash || 'solid'];
  if (dash) parts.push(`stroke-dasharray="${dash}"`);
  parts.push('stroke-linecap="round"');
  parts.push('stroke-linejoin="round"');
  return parts.join(' ');
}

function polygonStr(pts) {
  return pts.map((p) => `${num(p.x)},${num(p.y)}`).join(' ');
}

/** element -> single SVG element markup string. */
export function elementToSvg(el) {
  if (!el || typeof el !== 'object' || !el.type) return '';
  const s = styleAttrs(el);
  const id = `data-id="${escapeXml(el.id)}"`;
  switch (el.type) {
    case 'rect': {
      const r = normalizeRect(el);
      const rx = Math.min(el.style?.radius ?? 0, r.w / 2, r.h / 2);
      return `<rect ${id} x="${num(r.x)}" y="${num(r.y)}" width="${num(r.w)}" height="${num(r.h)}"${rx ? ` rx="${num(rx)}"` : ''} ${s}/>`;
    }
    case 'ellipse': {
      const r = normalizeRect(el);
      return `<ellipse ${id} cx="${num(r.x + r.w / 2)}" cy="${num(r.y + r.h / 2)}" rx="${num(r.w / 2)}" ry="${num(r.h / 2)}" ${s}/>`;
    }
    case 'triangle':
    case 'diamond':
    case 'star': {
      const poly = outlineOfShape(el) || [];
      return `<polygon ${id} points="${polygonStr(poly)}" ${s}/>`;
    }
    case 'line':
    case 'arrow': {
      const a = el.from || { x: 0, y: 0 }, b = el.to || { x: 0, y: 0 };
      let out = `<line ${id} x1="${num(a.x)}" y1="${num(a.y)}" x2="${num(b.x)}" y2="${num(b.y)}" ${s}/>`;
      const st = el.style || {};
      if (el.type === 'arrow' && st.endArrowhead !== false) {
        const head = arrowHeadPolygon(a, b, st.arrowSize ?? 14);
        out += `<polygon data-head-of="${escapeXml(el.id)}" points="${polygonStr(head)}" fill="${escapeXml(st.stroke || '#000000')}" opacity="${num(st.opacity ?? 1)}"/>`;
      }
      if (st.startArrowhead) {
        const head = arrowHeadPolygon(b, a, st.arrowSize ?? 14);
        out += `<polygon data-head-of="${escapeXml(el.id)}" points="${polygonStr(head)}" fill="${escapeXml(st.stroke || '#000000')}" opacity="${num(st.opacity ?? 1)}"/>`;
      }
      return out;
    }
    case 'path': {
      const d = pointsToSmoothPath(el.points || []);
      if (!d) return '';
      return `<path ${id} d="${d}" fill="none" stroke="${escapeXml((el.style && el.style.stroke) || '#000000')}" stroke-width="${num(el.style?.strokeWidth ?? 2)}" opacity="${num(el.style?.opacity ?? 1)}"${DASH_PATTERNS[el.style?.dash || 'solid'] ? ` stroke-dasharray="${DASH_PATTERNS[el.style.dash]}"` : ''} stroke-linecap="round" stroke-linejoin="round"/>`;
    }
    case 'text': {
      const st = el.style || {};
      const fs = num(st.fontSize ?? 24);
      const anchor = st.textAlign === 'center' ? 'middle' : st.textAlign === 'right' ? 'end' : 'start';
      const lines = String(el.text ?? '').split('\n');
      // NB-2 (review): empty lines get one space — SVG collapses empty tspans to zero height.
      // Baselines stack DOWNWARD from el.y (the FIRST BASELINE). Line spacing comes from
      // the geometry TEXT METRICS CONTRACT so hit-testing can never drift from painting.
      const tspans = lines.map((ln, i) =>
        `<tspan x="${num(el.x)}" dy="${i === 0 ? 0 : fs * TEXT_LINE_HEIGHT_RATIO}">${escapeXml(ln) || ' '}</tspan>`).join('');
      return `<text ${id} x="${num(el.x)}" y="${num(el.y)}" font-size="${fs}" font-family="${escapeXml(st.fontFamily || 'sans-serif')}" font-style="${escapeXml(st.fontStyle || 'normal')}" font-weight="${escapeXml(String(st.fontWeight || '400'))}" text-anchor="${anchor}" fill="${escapeXml(st.fillEnabled !== false ? (st.fill || '#111') : 'none')}" opacity="${num(st.opacity ?? 1)}">${tspans}</text>`;
    }
    default:
      return '';
  }
}

/** All elements (bottom->top order) -> inner markup for the main <svg>. */
export function sceneToSvg(elements) {
  return elements.map(elementToSvg).join('\n');
}

/**
 * Selection overlay markup: dashed bbox outlines + corner handles.
 * F1 / reviewer MAJOR-5: each handle carries data-id + data-corner so the overlay is
 * addressable (hit-testing, CSS cursors, debugging). Corner order is fixed nw,ne,sw,se and
 * comes from geometry.cornerPoints so renderer and hit-tester can never disagree.
 */
export function selectionOverlaySvg(elements, scale) {
  const pad = 4 / (scale || 1);
  const hs = 6 / (scale || 1);
  const out = [];
  for (const el of elements) {
    const b = bboxOfElement(el);
    out.push(`<rect class="sel-box" data-sel="${escapeXml(el.id)}" x="${num(b.x - pad)}" y="${num(b.y - pad)}" width="${num(b.w + 2 * pad)}" height="${num(b.h + 2 * pad)}" fill="none" stroke="#2563eb" stroke-width="${num(1.5 / (scale || 1))}" stroke-dasharray="${num(4 / (scale || 1))} ${num(3 / (scale || 1))}"/>`);
    const cs = cornerPoints(b);
    for (const corner of ['nw', 'ne', 'sw', 'se']) {
      const { x: cx, y: cy } = cs[corner];
      out.push(`<rect class="sel-handle" data-id="${escapeXml(el.id)}" data-corner="${corner}" x="${num(cx - hs / 2)}" y="${num(cy - hs / 2)}" width="${num(hs)}" height="${num(hs)}" fill="#fff" stroke="#2563eb" stroke-width="${num(1 / (scale || 1))}"/>`);
    }
  }
  return out.join('\n');
}

/** Dot-grid pattern defs + rect, anchored so dots track the viewport. */
export function gridMarkup(viewport, viewW, viewH) {
  const base = 40;
  let step = base * viewport.scale;
  while (step < 14) step *= 4;
  while (step > 140) step /= 4;
  const ox = ((viewport.x % step) + step) % step;
  const oy = ((viewport.y % step) + step) % step;
  const r = Math.max(1, step / 22);
  const dots = [];
  const DOT_CAP = 4000; // NB-1 (review): hard cap so tiny steps can never melt the DOM
  outer: for (let x = ox; x < viewW; x += step) {
    for (let y = oy; y < viewH; y += step) {
      if (dots.length >= DOT_CAP) break outer;
      dots.push(`<circle cx="${num(x)}" cy="${num(y)}" r="${num(r)}"/>`);
    }
  }
  return `<g class="grid" fill="#c9d4e3">${dots.join('')}</g>`;
}
