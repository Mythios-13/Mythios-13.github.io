// TESTER: interaction state machine — pan/select/move/create/freehand/text/wheel
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.js';
import { Viewport } from '../src/viewport.js';
import { ToolManager, MIN_SHAPE_SIZE_W } from '../src/tools.js';

function mk() {
  const s = new Store(), v = new Viewport(0, 0, 1);
  const t = new ToolManager(s, v, { getSize: () => ({ width: 800, height: 600 }) });
  return { s, v, t };
}
const down = (x, y, o = {}) => ({ button: 0, x, y, shiftKey: false, ...o });

test('middle-click drag pans viewport by screen delta', () => {
  const { t, v } = mk();
  t.pointerDown({ button: 1, x: 100, y: 100 });
  t.pointerMove({ x: 140, y: 80 });
  t.pointerUp({ x: 140, y: 80 });
  assert.deepEqual([v.x, v.y], [40, -20]);
});

test('space+drag pans even with select tool active', () => {
  const { t, v } = mk();
  t.keydown({ key: ' ', repeat: false });
  t.pointerDown(down(10, 10));
  t.pointerMove({ x: 30, y: 30 });
  t.pointerUp({ x: 30, y: 30 });
  t.keyup({ key: ' ' });
  assert.deepEqual([v.x, v.y], [20, 20]);
});

test('wheel zooms anchored at cursor', () => {
  const { t, v } = mk();
  const before = v.screenToWorld({ x: 400, y: 300 });
  t.wheel({ x: 400, y: 300, factor: 2 });
  const after = v.screenToWorld({ x: 400, y: 300 });
  assert.ok(Math.abs(before.x - after.x) < 1e-9 && Math.abs(before.y - after.y) < 1e-9);
});

test('click selects topmost element; click empty clears', () => {
  const { s, t } = mk();
  const a = s.createElement('rect', { x: 0, y: 0, w: 100, h: 100 }); s.addElement(a);
  const b = s.createElement('rect', { x: 50, y: 50, w: 100, h: 100 }); s.addElement(b); // on top
  t.setTool('select');
  t.pointerDown(down(60, 60)); t.pointerUp({ x: 60, y: 60 });
  assert.deepEqual([...s.selected], [b.id], 'topmost wins');
  t.pointerDown(down(500, 500)); t.pointerUp({ x: 500, y: 500 });
  assert.equal(s.selected.size, 0);
});

test('shift-click toggles membership without clearing others', () => {
  const { s, t } = mk();
  const a = s.createElement('rect', { x: 0, y: 0, w: 50, h: 50 }); s.addElement(a);
  const b = s.createElement('rect', { x: 200, y: 0, w: 50, h: 50 }); s.addElement(b);
  t.setTool('select');
  t.pointerDown(down(10, 10)); t.pointerUp({ x: 10, y: 10 });
  t.pointerDown(down(210, 10, { shiftKey: true })); t.pointerUp({ x: 210, y: 10 });
  assert.equal(s.selected.size, 2);
  t.pointerDown(down(10, 10, { shiftKey: true })); t.pointerUp({ x: 10, y: 10 });
  assert.deepEqual([...s.selected], [b.id]);
});

test('drag-move multiple elements: no drift when moving back to origin', () => {
  const { s, t } = mk();
  const a = s.createElement('rect', { x: 0, y: 0, w: 50, h: 50 }); s.addElement(a);
  const b = s.createElement('line', { from: { x: 100, y: 0 }, to: { x: 150, y: 0 } }); s.addElement(b);
  t.setTool('select');
  s.select([a.id, b.id]);
  t.pointerDown(down(10, 10));
  for (let i = 1; i <= 20; i++) t.pointerMove({ x: 10 + i * 5, y: 10 });
  for (let i = 20; i >= 0; i--) t.pointerMove({ x: 10 + i * 5, y: 10 });
  t.pointerUp({ x: 10, y: 10 });
  assert.equal(a.x, 0); assert.equal(a.y, 0);
  assert.equal(b.from.x, 100); assert.equal(b.to.x, 150);
});

test('drag-move pushes exactly ONE undo entry per gesture', () => {
  const { s, t } = mk();
  const a = s.createElement('rect', { x: 0, y: 0, w: 50, h: 50 }); s.addElement(a);
  t.setTool('select');
  t.pointerDown(down(10, 10));
  for (let i = 1; i <= 30; i++) t.pointerMove({ x: 10 + i * 3, y: 10 });
  t.pointerUp({ x: 100, y: 10 });
  assert.equal(a.x, 90);
  s.undo();
  // LEAD ruling: undo() rebuilds elements from JSON -> MUST re-fetch by id,
  // the old `a` handle points at a detached object.
  assert.equal(s.get(a.id).x, 0, 'single undo restores pre-drag position');
});

test('micro-drag under threshold does NOT move elements nor pollute history', () => {
  const { s, t } = mk();
  const a = s.createElement('rect', { x: 0, y: 0, w: 50, h: 50 }); s.addElement(a);
  t.setTool('select');
  t.pointerDown(down(10, 10));
  t.pointerMove({ x: 11, y: 11 });
  t.pointerUp({ x: 11, y: 11 });
  assert.equal(a.x, 0);
  assert.equal(s.canUndo(), false, 'no history entry for accidental jitter');
});

test('shape creation drag: rect from up-left AND down-right drags normalizes', () => {
  for (const [x0, y0, x1, y1] of [[100, 100, 200, 160], [200, 160, 100, 100]]) {
    const { s, t } = mk();
    t.setTool('rect');
    t.pointerDown(down(x0, y0)); t.pointerMove({ x: x1, y: y1 }); t.pointerUp({ x: x1, y: y1 });
    const r = s.elements[0];
    assert.equal(r.type, 'rect');
    assert.deepEqual([r.x, r.y, r.w, r.h], [100, 100, 100, 60]);
  }
});

test('accidental micro-shape (<3px) is discarded, not committed', () => {
  const { s, t } = mk();
  t.setTool('ellipse');
  t.pointerDown(down(50, 50)); t.pointerMove({ x: 51, y: 51 });
  const res = t.pointerUp({ x: 51, y: 51 });
  assert.equal(res.type, 'discarded');
  assert.equal(s.elements.length, 0);
});

test('every create tool produces its type', () => {
  for (const shape of ['rect', 'ellipse', 'triangle', 'diamond', 'star', 'line', 'arrow']) {
    const { s, t } = mk();
    t.setTool(shape);
    t.pointerDown(down(10, 10)); t.pointerMove({ x: 90, y: 70 }); t.pointerUp({ x: 90, y: 70 });
    assert.equal(s.elements.length, 1, `${shape} created`);
    assert.equal(s.elements[0].type, shape);
  }
});

test('freehand samples points with min-distance throttle', () => {
  const { s, t } = mk();
  t.setTool('path');
  t.pointerDown(down(0, 0));
  for (let x = 1; x <= 100; x++) t.pointerMove({ x, y: Math.sin(x / 10) * 20 }); // 1px steps
  t.pointerUp({ x: 100, y: 0 });
  const p = s.elements[0];
  assert.equal(p.type, 'path');
  assert.ok(p.points.length >= 25 && p.points.length <= 45, `throttled sampling got ${p.points.length}`);
});

test('text tool: click places node & requests inline edit; drag does not', () => {
  const { s, t } = mk();
  t.setTool('text');
  t.pointerDown(down(300, 200));
  const r = t.pointerUp({ x: 300, y: 200 });
  assert.equal(r.type, 'edit-text');
  assert.equal(s.elements.length, 1);
  assert.equal(s.elements[0].type, 'text');
  t.pointerDown(down(10, 10)); t.pointerMove({ x: 200, y: 200 });
  const r2 = t.pointerUp({ x: 200, y: 200 });
  assert.equal(r2.type, 'none', 'drag must not place text');
  assert.equal(s.elements.length, 1);
});

test('marquee selects intersecting elements only; shift adds', () => {
  const { s, t } = mk();
  const inside = s.createElement('rect', { x: 60, y: 60, w: 20, h: 20 }); s.addElement(inside);
  const outside = s.createElement('rect', { x: 400, y: 400, w: 20, h: 20 }); s.addElement(outside);
  t.setTool('select');
  t.pointerDown(down(50, 50)); t.pointerMove({ x: 150, y: 150 }); t.pointerUp({ x: 150, y: 150 });
  assert.deepEqual([...s.selected], [inside.id]);
  t.pointerDown(down(350, 350, { shiftKey: true })); t.pointerMove({ x: 500, y: 500 }); t.pointerUp({ x: 500, y: 500 });
  assert.equal(s.selected.size, 2, 'shift-marquee adds');
});

test('setTool rejects unknown tools', () => {
  const { t } = mk();
  assert.throws(() => t.setTool('lasercannon'), /Unknown tool/);
});

test('hit tolerance scales inversely with zoom (small things stay clickable)', () => {
  const { s, t, v } = mk();
  const tiny = s.createElement('rect', { x: 0, y: 0, w: 4, h: 4 }); s.addElement(tiny);
  v.scale = 0.1; // zoomed way out: 4 world px = 0.4 screen px
  t.setTool('select');
  t.pointerDown(down(0, 0)); t.pointerUp({ x: 0, y: 0 });
  assert.ok(s.selected.has(tiny.id), 'tolerance in world units keeps tiny shapes hittable');
});

test('right-button press is ignored entirely', () => {
  const { s, t } = mk();
  const a = s.createElement('rect', { x: 0, y: 0, w: 50, h: 50 }); s.addElement(a);
  t.setTool('select');
  t.pointerDown({ button: 2, x: 10, y: 10 });
  t.pointerUp({ x: 10, y: 10 });
  assert.equal(s.selected.size, 0);
});

test('deleting selected then undo restores selection-free model cleanly', () => {
  const { s, t } = mk();
  const a = s.createElement('rect', { x: 0, y: 0, w: 50, h: 50 }); s.addElement(a);
  t.setTool('select');
  t.pointerDown(down(10, 10)); t.pointerUp({ x: 10, y: 10 });
  s.pushState(s.snapshot());
  s.deleteElements([a.id]);
  s.undo();
  assert.equal(s.elements.length, 1);
  assert.ok(s.get(a.id), 'restored element retrievable by id');
});
