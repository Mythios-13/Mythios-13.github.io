// TESTER: adversarial coverage for geometry.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../src/geometry.js';

test('distanceToSegment: degenerate zero-length segment = point distance', () => {
  const a = { x: 5, y: 5 };
  assert.equal(G.distanceToSegment({ x: 8, y: 9 }, a, { ...a }), 5);
});

test('distanceToSegment: perpendicular foot inside segment', () => {
  const d = G.distanceToSegment({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 });
  assert.ok(Math.abs(d - 3) < 1e-9);
});

test('distanceToSegment: clamps beyond endpoints', () => {
  const d = G.distanceToSegment({ x: 100, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 });
  assert.ok(Math.abs(d - 90) < 1e-9);
});

test('normalizeRect handles negative w/h (drag up-left)', () => {
  const r = G.normalizeRect({ x: 10, y: 10, w: -6, h: -4 });
  assert.deepEqual(r, { x: 4, y: 6, w: 6, h: 4 });
});

test('rectUnion / rectIntersects basics', () => {
  const u = G.rectUnion({ x: 0, y: 0, w: 2, h: 2 }, { x: 4, y: 4, w: 2, h: 2 });
  assert.deepEqual(u, { x: 0, y: 0, w: 6, h: 6 });
  assert.equal(G.rectIntersects({ x: 0, y: 0, w: 2, h: 2 }, { x: 3, y: 3, w: 1, h: 1 }), false);
  assert.equal(G.rectIntersects({ x: 0, y: 0, w: 2, h: 2 }, { x: 1, y: 1, w: 1, h: 1 }), true);
});

test('pointInPolygon: concave star polygon edge cases', () => {
  const poly = G.starPoints(0, 0, 10, 10);
  assert.equal(G.pointInPolygon(poly, { x: 0, y: 0 }), true);          // center inside
  assert.equal(G.pointInPolygon(poly, { x: 9, y: 9 }), false);          // far corner outside
});

test('bboxOfElement: line with reversed endpoints normalizes', () => {
  const b = G.bboxOfElement({ type: 'line', from: { x: 10, y: 8 }, to: { x: 2, y: 3 } });
  assert.deepEqual(b, { x: 2, y: 3, w: 8, h: 5 });
});

test('bboxOfElement: empty path falls back to origin point', () => {
  const b = G.bboxOfElement({ type: 'path', points: [], x: 7, y: 9 });
  assert.deepEqual(b, { x: 7, y: 9, w: 0, h: 0 });
});

test('bboxOfElement: text bbox grows with fontSize and lines', () => {
  const el = { type: 'text', x: 0, y: 100, text: 'hello\nworld', style: { fontSize: 20 } };
  const b = G.bboxOfElement(el);
  assert.ok(b.h > 20 * 1.25 * 1.9 && b.h <= 20 * 1.25 * 2 + 1e-9);
  assert.ok(b.w > 0);
});

test('hitTestElement: rect outline-only misses interior, hits border', () => {
  const el = { type: 'rect', x: 0, y: 0, w: 100, h: 50, style: { fillEnabled: false, strokeWidth: 2 } };
  assert.equal(G.hitTestElement(el, { x: 50, y: 25 }, 4), false, 'hollow interior must miss');
  assert.equal(G.hitTestElement(el, { x: 50, y: 0 }, 4), true, 'top border must hit');
});

test('hitTestElement: filled rect hits interior', () => {
  const el = { type: 'rect', x: 0, y: 0, w: 100, h: 50, style: { fillEnabled: true } };
  assert.equal(G.hitTestElement(el, { x: 50, y: 25 }, 4), true);
});

test('hitTestElement: ellipse respects fill toggle', () => {
  const el = { type: 'ellipse', x: 0, y: 0, w: 100, h: 40, style: { fillEnabled: false, strokeWidth: 2 } };
  assert.equal(G.hitTestElement(el, { x: 50, y: 20 }, 3), false, 'center of hollow ellipse must miss');
  assert.equal(G.hitTestElement(el, { x: 0, y: 20 }, 3), true, 'left rim must hit');
});

test('hitTestElement: arrow head region and shaft both hittable, near-miss not', () => {
  const el = { type: 'arrow', from: { x: 0, y: 0 }, to: { x: 100, y: 0 }, style: { strokeWidth: 2 } };
  assert.equal(G.hitTestElement(el, { x: 50, y: 1 }, 4), true);
  assert.equal(G.hitTestElement(el, { x: 50, y: 30 }, 4), false);
});

test('hitTestElement: freehand path follows polyline', () => {
  const pts = [{ x: 0, y: 0 }, { x: 50, y: 50 }, { x: 100, y: 0 }];
  const el = { type: 'path', points: pts, style: {} };
  assert.equal(G.hitTestElement(el, { x: 50, y: 51 }, 4), true);
  assert.equal(G.hitTestElement(el, { x: 50, y: 20 }, 4), false, 'midair between legs must miss');
});

test('hitTestElement: zero-size element only hit via tolerance', () => {
  const el = { type: 'rect', x: 10, y: 10, w: 0, h: 0, style: { fillEnabled: true } };
  assert.equal(G.hitTestElement(el, { x: 10, y: 10 }, 4), true);
  assert.equal(G.hitTestElement(el, { x: 30, y: 30 }, 4), false);
});

test('starPoints: 10 vertices alternating radii', () => {
  const pts = G.starPoints(0, 0, 10, 10);
  assert.equal(pts.length, 10);
  const r0 = Math.hypot(pts[0].x, pts[0].y), r1 = Math.hypot(pts[1].x, pts[1].y);
  assert.ok(r0 > r1 * 1.5, 'outer vertex clearly farther than inner');
});

test('pointsToSmoothPath: single point does not crash, produces movable path', () => {
  const d = G.pointsToSmoothPath([{ x: 1, y: 2 }]);
  assert.match(d, /^M 1 2/);
});

test('pointsToSmoothPath: multi-point uses Q smoothing and ends at last point', () => {
  const pts = [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 0 }, { x: 30, y: 5 }];
  const d = G.pointsToSmoothPath(pts);
  assert.match(d, /^M 0 0/);
  assert.ok(d.includes('Q'));
  assert.ok(d.endsWith('L 30 5'));
});

test('arrowHeadPolygon: tip is exactly at `to`', () => {
  const poly = G.arrowHeadPolygon({ x: 0, y: 0 }, { x: 10, y: 0 }, 12);
  assert.deepEqual(poly[0], { x: 10, y: 0 });
  assert.equal(poly.length, 3);
});
