// export.js - PURE module: geometry + string assembly for Save-as-SVG / Save-as-PNG.
// HARD RULE (T7 R2/R9): this file NEVER touches document/window/Blob/canvas/localStorage.
// The exported SVG is produced by render.js (sceneToSvg), so the on-screen scene and the
// downloaded file can never disagree - there is exactly one serializer in the codebase.

import { bboxOfElement, rectUnion } from './geometry.js';
import { sceneToSvg } from './render.js';
import { ELEMENT_TYPES } from './store.js';

/** World-unit padding on ALL FOUR SIDES of the content bbox.
 *  Stakeholder: "capture the whole objects with a margin so no border-to-border capture". */
export const EXPORT_MARGIN_WORLD = 40;

/** Browser canvas limits mean a bigger raster silently produces a blank image. */
export const MAX_EXPORT_SIDE = 8192;

/** Fallback box for an empty scene, so 'Save as PNG' on a blank board is never 0x0. */
export const EMPTY_EXPORT_BOX = { x: 0, y: 0, w: 1280, h: 800 };

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const DEFAULT_FILENAME = 'sketchboard';
const MAX_FILENAME_LEN = 80;

function round3(v) {
  return Number.isFinite(v) ? Math.round(v * 1000) / 1000 : 0;
}

function isValidElement(el) {
  return !!el && typeof el === 'object' && ELEMENT_TYPES.includes(el.type);
}

/** Geometric union of every element bbox. Returns null when there is nothing to frame. */
export function unionBBox(elements) {
  if (!Array.isArray(elements)) return null;
  let acc = null;
  for (const el of elements) {
    if (!isValidElement(el)) continue;
    let b = null;
    try { b = bboxOfElement(el); } catch (e) { b = null; }
    if (!b || !Number.isFinite(b.x) || !Number.isFinite(b.y) ||
        !Number.isFinite(b.w) || !Number.isFinite(b.h)) continue;
    acc = acc ? rectUnion(acc, b) : { x: b.x, y: b.y, w: b.w, h: b.h };
  }
  return acc;
}

/** Padded export box: margin applied to left, top, width AND height (=> all four sides). */
export function exportBounds(elements, marginWorld = EXPORT_MARGIN_WORLD) {
  const m = Number.isFinite(marginWorld) && marginWorld >= 0 ? marginWorld : EXPORT_MARGIN_WORLD;
  const b = unionBBox(elements) || { ...EMPTY_EXPORT_BOX };
  return {
    x: round3(b.x - m),
    y: round3(b.y - m),
    w: round3(b.w + 2 * m),
    h: round3(b.h + 2 * m),
  };
}

/** Standalone, self-contained SVG document string. Deterministic: same input, same bytes. */
export function buildSvgDocument(elements, opts = {}) {
  const list = Array.isArray(elements) ? elements.filter(isValidElement) : [];
  const b = exportBounds(list, opts.margin);
  const body = sceneToSvg(list);                       // <- THE renderer, escaping included
  const attrs = [
    `xmlns="${SVG_NAMESPACE}"`,
    `viewBox="${b.x} ${b.y} ${b.w} ${b.h}"`,
    `width="${Math.max(1, Math.round(b.w))}"`,
    `height="${Math.max(1, Math.round(b.h))}"`,
    'version="1.1"',
  ];
  return `<svg ${attrs.join(' ')}>${body}</svg>`;
}

/** Integer raster size for the PNG canvas, aspect-preserving, clamped, never degenerate. */
export function pngPixelSize(bbox, scale = 1) {
  const ok = (v) => Number.isFinite(v) && v > 0;
  const s = ok(scale) ? scale : 1;
  const bw = bbox && ok(bbox.w) ? bbox.w : 1;
  const bh = bbox && ok(bbox.h) ? bbox.h : 1;
  let w = bw * s;
  let h = bh * s;
  const longest = Math.max(w, h);
  if (longest > MAX_EXPORT_SIDE) {          // uniform downscale keeps the aspect ratio
    const k = MAX_EXPORT_SIDE / longest;
    w *= k;
    h *= k;
  }
  return {
    width: Math.max(1, Math.round(w) || 1),
    height: Math.max(1, Math.round(h) || 1),
  };
}

/** Filename hardening: this string reaches the user's filesystem. Nothing structural survives. */
export function sanitizeFilename(name) {
  let s = name === undefined || name === null ? '' : String(name);
  s = s.replace(/[\x00-\x1f\x7f]/g, '');            // control chars incl. newline/tab
  s = s.replace(/[\/\\:*?"<>|]/g, '-');              // separators, drives, wildcards
  s = s.replace(/\.{2,}/g, '');                      // kill traversal outright
  s = s.replace(/^[.\s]+|[.\s]+$/g, '');             // no leading/trailing dots or space
  s = s.slice(0, MAX_FILENAME_LEN).replace(/^[.\s]+|[.\s]+$/g, '');
  return s.length ? s : DEFAULT_FILENAME;
}

/** Only two formats exist. Anything else is a programming error - say so loudly. */
export function buildDownloadName({ base = DEFAULT_FILENAME, format = 'svg' } = {}) {
  const fmt = String(format).toLowerCase();
  // F6 adds 'json': the save-to-disk file IS the localStorage envelope.
  if (fmt !== 'svg' && fmt !== 'png' && fmt !== 'json') {
    throw new Error(`buildDownloadName: unsupported export format "${format}" (expected svg, png or json)`);
  }
  return `${sanitizeFilename(base)}.${fmt}`;
}
