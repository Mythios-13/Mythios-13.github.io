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
