// TESTER (F1 RED) — geometry.resizeRect: the single pure primitive behind every resize.
// Pinned semantics (docs/specs/F1-resize-handles.md §3.3):
//   resizeRect(rect, corner, point, {minSize=0, aspectRatio=null}) -> {x,y,w,h}
//   * the OPPOSITE corner is the fixed anchor and must stay bit-exact
//   * w,h never below minSize (clamp, never flip)
//   * aspectRatio (w/h) => smallest box CONTAINING the requested box with that exact ratio
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as geo from '../src/geometry.js';

const R = () => ({ x: 10, y: 20, w: 100, h: 50 }); // anchor targets below reference this
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} != ${b}`);
const box = (o) => [o.x, o.y, o.w, o.h];

test('G0 resizeRect is exported as a pure function', () => {
  assert.equal(typeof geo.resizeRect, 'function', 'geometry.resizeRect must exist');
});

test('G1 se drag grows w/h; x/y and the nw anchor are untouched', () => {
  const before = R();
  const out = geo.resizeRect(before, 'se', { x: 150, y: 90 });
  assert.deepEqual(box(out), [10, 20, 140, 70]);
  assert.deepEqual(box(before), [10, 20, 100, 50], 'input object is never mutated');
});

test('G2 nw drag moves x/y AND w/h; the se anchor stays exactly put', () => {
  const out = geo.resizeRect(R(), 'nw', { x: 30, y: 25 });
  assert.deepEqual(box(out), [30, 25, 80, 45]);
  near(out.x + out.w, 110, 'se.x fixed');
  near(out.y + out.h, 70, 'se.y fixed');
});

test('G3 ne drag: y moves, height compensates, bottom edge fixed', () => {
  const out = geo.resizeRect(R(), 'ne', { x: 60, y: 40 });
  assert.deepEqual(box(out), [10, 40, 50, 30]);
  near(out.y + out.h, 70, 'bottom edge fixed');
});

test('G4 sw drag: x moves, width compensates, right edge fixed', () => {
  const out = geo.resizeRect(R(), 'sw', { x: 40, y: 100 });
  assert.deepEqual(box(out), [40, 20, 70, 80]);
  near(out.x + out.w, 110, 'right edge fixed');
});

test('G5 past-anchor drag CLAMPS at minSize instead of flipping (D1)', () => {
  // Drag se far to the LEFT of the nw anchor.
  const out = geo.resizeRect(R(), 'se', { x: -500, y: -500 }, { minSize: 4 });
  assert.deepEqual(box(out), [10, 20, 4, 4], 'clamped to minSize, anchor unmoved, no negative w/h');
  assert.ok(out.w > 0 && out.h > 0, 'no degenerate/negative box may reach the model');
});

test('G6 unknown corner throws rather than silently doing nothing', () => {
  assert.throws(() => geo.resizeRect(R(), 'middle', { x: 1, y: 1 }), /corner/i);
});

test('G7 garbage input degrades to a valid box, never NaN', () => {
  const out = geo.resizeRect({ x: NaN, y: 1, w: 10, h: 10 }, 'se', { x: undefined, y: 5 });
  for (const k of ['x', 'y', 'w', 'h']) assert.ok(Number.isFinite(out[k]), `${k} is finite (${out[k]})`);
  assert.ok(out.w >= 0 && out.h >= 0, 'never negative');
});

test('G8 aspectRatio produces the exact ratio and still contains the request', () => {
  const out = geo.resizeRect(R(), 'se', { x: 60, y: 90 }, { aspectRatio: 2 });
  near(out.w / out.h, 2, 'ratio honoured');
  assert.ok(out.w >= 50 - 1e-9, 'contains requested width');
  assert.ok(out.h >= 70 - 1e-9, 'contains requested height');
  near(out.x, 10, 'anchor kept');
  near(out.y, 20, 'anchor kept');
});

test('G9 aspectRatio + minSize compose without producing NaN', () => {
  const out = geo.resizeRect(R(), 'se', { x: -99, y: -99 }, { aspectRatio: 3, minSize: 6 });
  assert.ok(Number.isFinite(out.w) && Number.isFinite(out.h));
  assert.ok(out.w >= 6 && out.h >= 6, 'minSize still enforced under aspect lock');
  near(out.w / out.h, 3, 'ratio survives the clamp');
});

test('G10 non-uniform request under aspect lock grows the SHORT axis, never shrinks the long one', () => {
  // Request 300x10 with ratio 1 => must become 300x300 (contain), not 10x10.
  const out = geo.resizeRect(R(), 'se', { x: 310, y: 30 }, { aspectRatio: 1 });
  near(out.w, 300, 'width respected');
  near(out.h, 300, 'height grown to match');
});
