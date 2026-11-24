// styles.js — PURE module: default style, presets, validation.

export const DEFAULT_STYLE = {
  fill: '#4f8ef7',
  fillEnabled: true,
  stroke: '#16324f',
  strokeEnabled: true,
  strokeWidth: 2,
  opacity: 1,
  dash: 'solid',            // solid | dashed | dotted
  radius: 0,                // corner radius for rects
  fontSize: 24,
  fontFamily: 'Inter, system-ui, sans-serif',
  fontStyle: 'normal',      // normal | italic
  fontWeight: '400',
  textAlign: 'left',        // left | center | right
  startArrowhead: false,
  endArrowhead: true,
  arrowSize: 14,
};

export const DASH_PATTERNS = {
  solid: undefined,
  dashed: '8 4',
  dotted: '2 4',
};

export const FONT_FAMILIES = [
  'Inter, system-ui, sans-serif',
  'Georgia, serif',
  '"Courier New", monospace',
  'cursive',
];

export const STYLE_PRESETS = {
  blueprint: { fill: '#1d4ed8', fillEnabled: true, stroke: '#93c5fd', strokeEnabled: true, strokeWidth: 2, opacity: 1, dash: 'solid' },
  sketch:    { fillEnabled: false, stroke: '#1f2937', strokeEnabled: true, strokeWidth: 2, opacity: 1, dash: 'solid' },
  bold:      { fill: '#f59e0b', fillEnabled: true, stroke: '#7c2d12', strokeEnabled: true, strokeWidth: 5, opacity: 1, dash: 'solid' },
  ghost:     { fill: '#e5e7eb', fillEnabled: true, stroke: '#9ca3af', strokeEnabled: true, strokeWidth: 1, opacity: 0.45, dash: 'dashed' },
  neon:      { fill: '#0f172a', fillEnabled: true, stroke: '#22d3ee', strokeEnabled: true, strokeWidth: 3, opacity: 1, dash: 'solid' },
  danger:    { fill: '#fee2e2', fillEnabled: true, stroke: '#dc2626', strokeEnabled: true, strokeWidth: 2, opacity: 1, dash: 'dotted' },
};

export function cloneStyle(style) {
  return { ...DEFAULT_STYLE, ...(style || {}) };
}

/** Apply a named preset on top of an existing style. Throws on unknown preset. */
export function applyPreset(style, presetName) {
  const preset = Object.prototype.hasOwnProperty.call(STYLE_PRESETS, presetName)
    ? STYLE_PRESETS[presetName]
    : null;
  if (!preset) throw new Error(`Unknown style preset: ${String(presetName)}`);
  return { ...cloneStyle(style), ...preset };
}

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/** Validate a style object; returns an array of human-readable issues ([] = valid). */
export function validateStyle(style) {
  const issues = [];
  if (!style || typeof style !== 'object') return ['style must be an object'];
  if (typeof style.fill === 'string' && style.fill && !HEX.test(style.fill)) issues.push(`bad fill color: ${style.fill}`);
  if (typeof style.stroke === 'string' && style.stroke && !HEX.test(style.stroke)) issues.push(`bad stroke color: ${style.stroke}`);
  if (!Number.isFinite(style.strokeWidth) || style.strokeWidth < 0 || style.strokeWidth > 100) issues.push('strokeWidth must be 0..100');
  if (!Number.isFinite(style.opacity) || style.opacity < 0 || style.opacity > 1) issues.push('opacity must be 0..1');
  if (style.dash !== undefined && !(style.dash in DASH_PATTERNS)) issues.push(`unknown dash: ${style.dash}`);
  if (!Number.isFinite(style.radius) || style.radius < 0) issues.push('radius must be >= 0');
  if (!Number.isFinite(style.fontSize) || style.fontSize < 4 || style.fontSize > 400) issues.push('fontSize must be 4..400');
  return issues;
}

// ---------------------------------------------------------------------------
// S6 (client, session 5): STYLE SWATCHES - "recent styles" + preset galleries.
// HONESTY RULE (decision D-S6-5): the keys a swatch uses for IDENTITY are exactly the
// keys a swatch click WRITES, and they are exactly the keys its miniature PAINTS. Eight
// keys qualify. fontFamily / fontSize / fontStyle / arrowheads are EXCLUDED on purpose:
// a 24x16 rect miniature cannot depict a typeface, so including them would produce two
// pixel-identical swatches that behave differently, and clicking a colour chip would
// silently restyle text. Consequence: a swatch click NEVER touches text properties.
// Identity is computed HERE, in the pure module, so gallery, dedupe, application and
// tests can never disagree about what "same style" means.
// ---------------------------------------------------------------------------

/** The eight visually-depicted keys that define (and are written by) a swatch. */
export const SWATCH_KEYS = [
  'fill', 'fillEnabled', 'stroke', 'strokeEnabled', 'strokeWidth', 'opacity',
  'dash', 'radius',
];

const COLOR_KEYS = new Set(['fill', 'stroke']);

/** One canonical value per type: colours case-folded, numbers numeric, bools strict. */
function normValue(key, v) {
  const dflt = DEFAULT_STYLE[key];
  const cur = v === undefined || v === null ? dflt : v;
  if (typeof dflt === 'boolean') return Boolean(cur);
  if (typeof dflt === 'number') {
    const n = Number(cur);
    return Number.isFinite(n) ? Math.round(n * 1e6) / 1e6 : Number(dflt);
  }
  const str = String(cur);
  return COLOR_KEYS.has(key) ? str.trim().toLowerCase() : str;
}

/** Canonical copy of a style restricted to the swatch-defining keys. */
export function normalizeStyleForSwatch(style) {
  const src = style || {};
  const out = {};
  for (const k of SWATCH_KEYS) out[k] = normValue(k, src[k]);
  return out;
}

/** Stable identity string for a style (dedupe key). Same style -> same string. */
export function styleKeyOf(style) {
  const n = normalizeStyleForSwatch(style);
  return SWATCH_KEYS.map((k) => `${k}=${String(n[k])}`).join('|');
}

/** How many swatches to offer at most (a 10k-object drawing must not build 10k nodes). */
export const MAX_RECENT_SWATCHES = 24;

/**
 * Styles actually IN USE in the drawing, de-duplicated, in DOCUMENT ORDER OF FIRST USE
 * (bottom-most element wins the earliest slot). Deterministic: survives undo/redo and a
 * save/reload round trip, unlike any "most recently touched" memory would.
 * Returns [{ style, count }] with `style` already canonicalised for painting.
 */
export function collectUsedStyles(elements, limit = MAX_RECENT_SWATCHES) {
  const seen = new Map();                       // key -> index into result
  const out = [];
  for (const el of (elements || [])) {
    if (!el || typeof el !== 'object') continue;
    const key = styleKeyOf(el.style);
    const hit = seen.get(key);
    if (hit !== undefined) { out[hit].count++; continue; }
    if (out.length >= limit) continue;           // still counts nothing more; order stable
    seen.set(key, out.length);
    // 'style' is canonicalised for PAINTING/identity; 'raw' keeps the element's own style so
    // the CLICK can decide what to write through swatchPatchOf() alone. Passing the already-
    // normalised copy to the click handler made that filter untestable (mutant M67 survived:
    // spreading an already-filtered object is indistinguishable from filtering it).
    out.push({ style: normalizeStyleForSwatch(el.style), raw: el.style, count: 1, key });
  }
  return out;
}

/** Presets as swatch records: { name, style, raw }. Same shape as collectUsedStyles output:
 *  `style` is canonicalised for painting, `raw` is the unfiltered merge so the click path
 *  is genuinely filtered by swatchPatchOf() rather than handed pre-filtered data. */
export function collectPresetStyles() {
  return Object.keys(STYLE_PRESETS).map((name) => {
    const raw = applyPreset(DEFAULT_STYLE, name);
    return { name, raw, style: normalizeStyleForSwatch(raw) };
  });
}

/** The swatch-defining SUBSET of a style - this is precisely what a swatch click writes
 *  (D-S6-5). Anything outside SWATCH_KEYS survives untouched on the target element. */
export function swatchPatchOf(style) {
  const n = normalizeStyleForSwatch(style);
  const out = {};
  for (const k of SWATCH_KEYS) out[k] = n[k];
  return out;
}
