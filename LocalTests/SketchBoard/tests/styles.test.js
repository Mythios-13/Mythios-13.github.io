// TESTER: styles — presets, validation
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_STYLE, STYLE_PRESETS, applyPreset, validateStyle, DASH_PATTERNS } from '../src/styles.js';

test('at least 5 presets exist and each is valid against validator', () => {
  const names = Object.keys(STYLE_PRESETS);
  assert.ok(names.length >= 5);
  for (const n of names) {
    const merged = { ...DEFAULT_STYLE, ...STYLE_PRESETS[n] };
    assert.deepEqual(validateStyle(merged), [], `preset ${n} invalid`);
  }
});

test('applyPreset throws on unknown preset (prototype pollution safe)', () => {
  assert.throws(() => applyPreset({}, 'constructor'), /Unknown style preset/);
  assert.throws(() => applyPreset({}, '__proto__'), /Unknown style preset/);
  assert.throws(() => applyPreset({}, 'nope'), /Unknown style preset/);
});

test('applyPreset merges over existing style and returns new object', () => {
  const base = { ...DEFAULT_STYLE, opacity: 0.5 };
  const out = applyPreset(base, 'neon');
  assert.equal(out.stroke, STYLE_PRESETS.neon.stroke);
  assert.equal(base.stroke, DEFAULT_STYLE.stroke, 'input not mutated');
});

test('validateStyle catches bad values', () => {
  const bad = { ...DEFAULT_STYLE, fill: 'not-a-color', strokeWidth: -3, opacity: 2, dash: 'zigzag', fontSize: 900 };
  const issues = validateStyle(bad);
  assert.ok(issues.length >= 5, `expected many issues, got ${issues}`);
});

test('validateStyle accepts 3/6/8-digit hex and all dash modes', () => {
  for (const c of ['#fff', '#ffffff', '#ffffff80']) {
    assert.deepEqual(validateStyle({ ...DEFAULT_STYLE, fill: c }), []);
  }
  for (const d of Object.keys(DASH_PATTERNS)) {
    assert.deepEqual(validateStyle({ ...DEFAULT_STYLE, dash: d }), []);
  }
});
