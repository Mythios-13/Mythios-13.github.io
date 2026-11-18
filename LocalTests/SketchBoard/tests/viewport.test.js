// TESTER: viewport math — the zoom-anchor invariant is the heart of AC1/AC2
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Viewport, MIN_SCALE, MAX_SCALE } from '../src/viewport.js';

test('screenToWorld/worldToScreen are exact inverses', () => {
  const v = new Viewport(-123.5, 77.25, 2.5);
  const p = { x: 400, y: 300 };
  const rt = v.worldToScreen(v.screenToWorld(p));
  assert.ok(Math.abs(rt.x - p.x) < 1e-9 && Math.abs(rt.y - p.y) < 1e-9);
});

test('zoomAt keeps world point under cursor FIXED (the AC1 invariant)', () => {
  const v = new Viewport(50, -20, 1);
  const cursor = { x: 640, y: 360 };
  const before = v.screenToWorld(cursor);
  v.zoomAt(cursor.x, cursor.y, 1.25);
  const after = v.screenToWorld(cursor);
  assert.ok(Math.abs(before.x - after.x) < 1e-9, 'anchor x drifted');
  assert.ok(Math.abs(before.y - after.y) < 1e-9, 'anchor y drifted');
});

test('repeated zoomAt at same cursor composes without drift', () => {
  const v = new Viewport(0, 0, 1);
  const c = { x: 100, y: 100 };
  const start = v.screenToWorld(c);
  for (let i = 0; i < 50; i++) v.zoomAt(c.x, c.y, i % 2 ? 0.9 : 1.1);
  const end = v.screenToWorld(c);
  assert.ok(Math.abs(start.x - end.x) < 1e-6 && Math.abs(start.y - end.y) < 1e-6);
});

test('scale clamped to [MIN_SCALE, MAX_SCALE] and reports change', () => {
  const v = new Viewport();
  for (let i = 0; i < 200; i++) v.zoomAt(0, 0, 1.5);
  assert.equal(v.scale, MAX_SCALE);
  assert.equal(v.zoomAt(0, 0, 1.5), false, 'must report no-op at clamp');
  for (let i = 0; i < 400; i++) v.zoomAt(0, 0, 0.5);
  assert.equal(v.scale, MIN_SCALE);
});

test('panBy moves in screen space independent of scale', () => {
  const v = new Viewport(0, 0, 4);
  const before = v.screenToWorld({ x: 10, y: 10 });
  v.panBy(40, -20);
  const after = v.screenToWorld({ x: 50, y: -10 });
  assert.ok(Math.abs(before.x - after.x) < 1e-12 && Math.abs(before.y - after.y) < 1e-12);
});

test('fitTo centers bbox and respects padding', () => {
  const v = new Viewport();
  v.fitTo({ x: 0, y: 0, w: 800, h: 600 }, 1000, 800, 100);
  const c = v.worldToScreen({ x: 400, y: 300 });
  assert.ok(Math.abs(c.x - 500) < 1e-9 && Math.abs(c.y - 400) < 1e-9);
});

test('NaN scale input cannot poison viewport', () => {
  const v = new Viewport();
  v.zoomAt(0, 0, NaN);
  assert.ok(Number.isFinite(v.scale) && v.scale >= MIN_SCALE);
});

test('REGRESSION (REVIEWER BLOCKING-1): zoomAt with NaN factor/cursor is a TRUE no-op', () => {
  const v = new Viewport(11, 22, 3);
  assert.equal(v.zoomAt(0, 0, NaN), false);
  assert.equal(v.zoomAt(NaN, 0, 1.2), false);
  assert.equal(v.zoomAt(0, NaN, 1.2), false);
  assert.deepEqual([v.x, v.y, v.scale], [11, 22, 3], 'state must be byte-identical');
});
