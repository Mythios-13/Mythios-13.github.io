// TESTER (F1 RED) — resize-by-handle interaction in the pure state machine.
// Spec: docs/specs/F1-resize-handles.md. AC references inline.
// Namespace import so the suite LOADS while the feature is missing: every test then
// fails on a real behavioural gap (RED) instead of one link error masking everything.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.js';
import { Viewport } from '../src/viewport.js';
import * as tools from '../src/tools.js';
import { ToolManager, CLICK_THRESHOLD_PX } from '../src/tools.js';
import { bboxOfElement } from '../src/geometry.js';

const SCALE = 1, OX = 0, OY = 0; // screen == world, keeps expectations readable
function mk() {
  const s = new Store(), v = new Viewport(OX, OY, SCALE);
  const t = new ToolManager(s, v, { getSize: () => ({ width: 800, height: 600 }) });
  return { s, v, t };
}
const down = (x, y, o = {}) => ({ button: 0, x, y, shiftKey: false, ...o });
const near = (a, b, msg, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${msg}: ${a} != ${b}`);

/** World-space corner of an element's bbox, as the overlay draws it. */
function corner(el, c) {
  const b = bboxOfElement(el);
  return { x: c.includes('w') ? b.x : b.x + b.w, y: c.includes('n') ? b.y : b.y + b.h };
}
function addRect(s, props) { const e = s.createElement('rect', props); s.addElement(e); return e; }
function select(s, ids) { s.select(ids); }

// ---------------------------------------------------------------- AC2 / AC3
test('AC2 se-drag grows w/h by exactly the pointer delta; x/y untouched', () => {
  const { s, t } = mk();
  const r = addRect(s, { x: 10, y: 20, w: 100, h: 50 });
  select(s, [r.id]); t.setTool('select');
  const p0 = corner(r, 'se');
  t.pointerDown(down(p0.x, p0.y));
  assert.equal(t.drag && t.drag.kind, 'resize', 'pressing a handle starts a RESIZE drag, not a move');
  t.pointerMove({ x: p0.x + 40, y: p0.y + 20 });
  t.pointerUp({ x: p0.x + 40, y: p0.y + 20 });
  assert.deepEqual([r.x, r.y, r.w, r.h], [10, 20, 140, 70]);
});

test('AC3 nw-drag moves x/y and w/h; the se corner stays pixel-fixed', () => {
  const { s, t } = mk();
  const r = addRect(s, { x: 10, y: 20, w: 100, h: 50 });
  select(s, [r.id]); t.setTool('select');
  const p0 = corner(r, 'nw');
  t.pointerDown(down(p0.x, p0.y));
  t.pointerMove({ x: p0.x + 20, y: p0.y + 5 });
  t.pointerUp({ x: p0.x + 20, y: p0.y + 5 });
  assert.deepEqual([r.x, r.y, r.w, r.h], [30, 25, 80, 45]);
  near(r.x + r.w, 110, 'anchor se.x');
  near(r.y + r.h, 70, 'anchor se.y');
});

test('AC3b ne/sw drags keep the correct opposite edge fixed', () => {
  const { s, t } = mk();
  const r = addRect(s, { x: 0, y: 0, w: 100, h: 100 });
  select(s, [r.id]); t.setTool('select');
  let p0 = corner(r, 'ne');
  t.pointerDown(down(p0.x, p0.y)); t.pointerMove({ x: p0.x, y: p0.y + 40 }); t.pointerUp({ x: p0.x, y: p0.y + 40 });
  assert.deepEqual([r.x, r.y, r.w, r.h], [0, 40, 100, 60], 'ne drag: top moves, bottom fixed');
  p0 = corner(r, 'sw');
  t.pointerDown(down(p0.x, p0.y)); t.pointerMove({ x: p0.x + 30, y: p0.y }); t.pointerUp({ x: p0.x + 30, y: p0.y });
  assert.deepEqual([r.x, r.y, r.w, r.h], [30, 40, 70, 60], 'sw drag: left moves, right fixed');
});

// ------------------------------------------------------------------ AC4 / AC5
test('AC4 one gesture pushes exactly ONE history entry and one Ctrl+Z restores it all', () => {
  const { s, t } = mk();
  const r = addRect(s, { x: 0, y: 0, w: 100, h: 100 });
  select(s, [r.id]); t.setTool('select');
  const before = JSON.stringify([r]);
  const p0 = corner(r, 'se');
  t.pointerDown(down(p0.x, p0.y));
  for (let i = 1; i <= 25; i++) t.pointerMove({ x: p0.x + i, y: p0.y + i }); // 25 frames
  t.pointerUp({ x: p0.x + 25, y: p0.y + 25 });
  assert.deepEqual([r.w, r.h], [125, 125]);
  assert.equal(s.undo(), true, 'undo available');
  assert.equal(s.canUndo(), false, 'exactly ONE history entry for the whole gesture (MINOR-7 hygiene)');
  assert.equal(JSON.stringify(s.elements), before, 'one undo restores the pre-gesture element bit-exact');
});

test('AC5 sub-threshold press+release on a handle mutates nothing and stores no history', () => {
  const { s, t } = mk();
  const r = addRect(s, { x: 0, y: 0, w: 100, h: 100 });
  select(s, [r.id]); t.setTool('select');
  const p0 = corner(r, 'se');
  t.pointerDown(down(p0.x, p0.y));
  t.pointerMove({ x: p0.x + 1, y: p0.y });            // below CLICK_THRESHOLD_PX
  const res = t.pointerUp({ x: p0.x + 1, y: p0.y });
  assert.ok(CLICK_THRESHOLD_PX > 1);
  assert.deepEqual([r.x, r.y, r.w, r.h], [0, 0, 100, 100], 'jitter must not resize');
  assert.equal(s.canUndo(), false, 'no history entry for a click on a handle');
  assert.notEqual(res.type, 'created');
});

// ---------------------------------------------------------------------- AC6
test('AC6 text resize scales style.fontSize and leaves w/h alone', () => {
  const { s, t } = mk();
  const el = s.createElement('text', { x: 0, y: 0, text: 'Text' });
  s.addElement(el); select(s, [el.id]); t.setTool('select');
  const fs0 = el.style.fontSize, w0 = el.w, h0 = el.h;
  const p0 = corner(el, 'se');
  const b0 = bboxOfElement(el);
  t.pointerDown(down(p0.x, p0.y));
  t.pointerMove({ x: b0.x + b0.w * 2, y: b0.y + b0.h * 2 });
  t.pointerUp({ x: b0.x + b0.w * 2, y: b0.y + b0.h * 2 });
  near(el.style.fontSize, fs0 * 2, 'fontSize doubles with a uniform 2x corner drag', 1e-6);
  assert.equal(el.w, w0, 'size is NEVER encoded in w/h for text (createElement leaves them at 0)');
  assert.equal(el.h, h0, 'size is NEVER encoded in w/h for text');
});

test('AC6b text fontSize is clamped both ways, never zero or negative', () => {
  const { s, t } = mk();
  const el = s.createElement('text', { x: 0, y: 0, text: 'Text' });
  s.addElement(el); select(s, [el.id]); t.setTool('select');
  const p0 = corner(el, 'se');
  t.pointerDown(down(p0.x, p0.y));
  t.pointerMove({ x: -9999, y: -9999 });              // try to collapse through the anchor
  t.pointerUp({ x: -9999, y: -9999 });
  assert.ok(Number.isFinite(el.style.fontSize), 'finite font size');
  assert.ok(el.style.fontSize >= (tools.MIN_FONT_SIZE ?? 1), `>= MIN_FONT_SIZE (${tools.MIN_FONT_SIZE})`);
  t.pointerDown(down(...Object.values(corner(el, 'se'))));
  t.pointerMove({ x: 1e6, y: 1e6 });
  t.pointerUp({ x: 1e6, y: 1e6 });
  assert.ok(el.style.fontSize <= (tools.MAX_FONT_SIZE ?? Infinity), '<= MAX_FONT_SIZE');
});

// ---------------------------------------------------------------------- AC7
test('AC7 line: dragging the se handle moves the `to` endpoint, `from` fixed', () => {
  const { s, t } = mk();
  const ln = s.createElement('line', { from: { x: 0, y: 0 }, to: { x: 100, y: 0 } });
  s.addElement(ln); select(s, [ln.id]); t.setTool('select');
  const p0 = { x: 100, y: 0 };                        // se == `to` for a horizontal line
  t.pointerDown(down(p0.x, p0.y));
  t.pointerMove({ x: 150, y: 30 });
  t.pointerUp({ x: 150, y: 30 });
  assert.deepEqual(ln.from, { x: 0, y: 0 }, 'opposite endpoint is the anchor');
  assert.deepEqual(ln.to, { x: 150, y: 30 }, 'near endpoint follows the pointer');
});

test('AC7b arrow: dragging the nw handle moves the `from` endpoint, `to` fixed', () => {
  const { s, t } = mk();
  const ar = s.createElement('arrow', { from: { x: 100, y: 0 }, to: { x: 0, y: 0 } });
  s.addElement(ar); select(s, [ar.id]); t.setTool('select');
  const p0 = { x: 0, y: 0 };                          // nw == `to`... which is the left end
  t.pointerDown(down(p0.x, p0.y));
  t.pointerMove({ x: -20, y: 15 });
  t.pointerUp({ x: -20, y: 15 });
  assert.deepEqual(ar.from, { x: 100, y: 0 }, 'far endpoint untouched');
  assert.deepEqual(ar.to, { x: -20, y: 15 }, 'near endpoint follows');
});

// ---------------------------------------------------------------------- AC8
test('AC8 freehand path scales every point about the fixed anchor, shape preserved', () => {
  const { s, t } = mk();
  const p = s.createElement('path', { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] });
  s.addElement(p); select(s, [p.id]); t.setTool('select');
  const p0 = corner(p, 'se');
  t.pointerDown(down(p0.x, p0.y));
  t.pointerMove({ x: 20, y: 20 });
  t.pointerUp({ x: 20, y: 20 });
  assert.deepEqual(p.points.map((q) => [q.x, q.y]), [[0, 0], [20, 0], [20, 20]], 'uniform 2x about nw anchor');
});

// ---------------------------------------------------------------------- AC9
test('AC9 dragging far past the anchor clamps to a valid minimum box, never flips', () => {
  const { s, t } = mk();
  const r = addRect(s, { x: 0, y: 0, w: 100, h: 100 });
  select(s, [r.id]); t.setTool('select');
  const p0 = corner(r, 'se');
  t.pointerDown(down(p0.x, p0.y));
  t.pointerMove({ x: -5000, y: -5000 });
  t.pointerUp({ x: -5000, y: -5000 });
  assert.ok(r.w > 0 && r.h > 0, `w/h stay positive (got ${r.w}x${r.h})`);
  assert.ok(r.w >= tools.MIN_SHAPE_SIZE_W && r.h >= tools.MIN_SHAPE_SIZE_W, 'never below MIN_SHAPE_SIZE_W');
  // Dragging `se`, the immovable anchor is the NW corner => x,y are the fixed pair.
  near(r.x, 0, 'anchor did not move when we dragged through it');
  near(r.y, 0, 'anchor did not move when we dragged through it');
});

// --------------------------------------------------------------------- AC10
test('AC10 handle hit wins over shape pick where they overlap', () => {
  const { s, t } = mk();
  const r = addRect(s, { x: 0, y: 0, w: 100, h: 100 });   // the handle sits ON the shape edge
  select(s, [r.id]); t.setTool('select');
  const p0 = corner(r, 'se');                              // also inside/onto the rect
  t.pointerDown(down(p0.x, p0.y));
  assert.equal(t.drag.kind, 'resize', 'must resize, not move');
  t.pointerMove({ x: p0.x + 50, y: p0.y + 50 });
  t.pointerUp({ x: p0.x + 50, y: p0.y + 50 });
  assert.deepEqual([r.x, r.y], [0, 0], 'shape did not translate');
  assert.deepEqual([r.w, r.h], [150, 150], 'shape resized');
});

test('AC10b press within the handle tolerance but off-centre still grabs the handle', () => {
  const { s, t } = mk();
  const r = addRect(s, { x: 0, y: 0, w: 100, h: 100 });
  select(s, [r.id]); t.setTool('select');
  const p0 = corner(r, 'se');
  const pad = (tools.HANDLE_HIT_SCREEN_PX ?? 4) / 2;       // half-way into the tolerance band
  t.pointerDown(down(p0.x + pad, p0.y - pad));
  assert.equal(t.drag && t.drag.kind, 'resize', 'tolerance band must be grabbable');
  t.pointerUp({ x: p0.x + pad, y: p0.y - pad });
});

test('AC10c space+drag still pans when the press lands on a handle', () => {
  const { s, t, v } = mk();
  const r = addRect(s, { x: 0, y: 0, w: 100, h: 100 });
  select(s, [r.id]); t.setTool('select');
  t.keydown({ key: ' ', repeat: false });
  const p0 = corner(r, 'se');
  t.pointerDown(down(p0.x, p0.y));
  assert.equal(t.drag.kind, 'pan', 'pan intent beats resize intent');
  t.pointerMove({ x: p0.x + 15, y: p0.y });
  t.pointerUp({ x: p0.x + 15, y: p0.y });
  t.keyup({ key: ' ' });
  // panBy() ADDS the screen delta (pinned by tools.test.js middle-click case).
  near(v.x, 15, 'viewport panned');
  assert.deepEqual([r.w, r.h], [100, 100], 'shape untouched by the pan');
});

// --------------------------------------------------------------------- AC11
test('AC11 no drift: 25 small steps land exactly where one big jump lands', () => {
  const run = (steps) => {
    const { s, t } = mk();
    const r = addRect(s, { x: 3, y: 7, w: 100, h: 50 });
    select(s, [r.id]); t.setTool('select');
    const p0 = corner(r, 'se');
    t.pointerDown(down(p0.x, p0.y));
    for (let i = 1; i <= steps; i++) t.pointerMove({ x: p0.x + (120 * i) / steps, y: p0.y + (35 * i) / steps });
    t.pointerUp({ x: p0.x + 120, y: p0.y + 35 });
    return [r.x, r.y, r.w, r.h];
  };
  assert.deepEqual(run(25), run(1), 'frame-count independence proves pristine-orig restore, not delta accumulation');
  assert.deepEqual(run(1), [3, 7, 220, 85]);
});

test('AC11b pan mid-gesture then un-pan yields the same result as no pan at all', () => {
  const { s, t, v } = mk();
  const r = addRect(s, { x: 0, y: 0, w: 100, h: 100 });
  select(s, [r.id]); t.setTool('select');
  const p0 = corner(r, 'se');
  t.pointerDown(down(p0.x, p0.y));
  t.pointerMove({ x: p0.x + 10, y: p0.y + 10 });
  v.panBy(40, -25);                       // camera moved under the cursor mid-drag
  v.panBy(-40, 25);                       // ...and back
  t.pointerMove({ x: p0.x + 60, y: p0.y + 60 });
  t.pointerUp({ x: p0.x + 60, y: p0.y + 60 });
  assert.deepEqual([r.x, r.y, r.w, r.h], [0, 0, 160, 160], 'camera excursions must not leak into geometry');
});

// --------------------------------------------------------------------- AC12
test('AC12 resize only ever touches the selected element', () => {
  const { s, t } = mk();
  const a = addRect(s, { x: 0, y: 0, w: 100, h: 100 });
  const b = addRect(s, { x: 0, y: 0, w: 100, h: 100 });   // stacked exactly on top of a
  select(s, [a.id]); t.setTool('select');                  // bottom one selected, top one not
  const p0 = corner(a, 'se');
  t.pointerDown(down(p0.x, p0.y));
  t.pointerMove({ x: p0.x + 30, y: p0.y + 30 });
  t.pointerUp({ x: p0.x + 30, y: p0.y + 30 });
  assert.deepEqual([a.w, a.h], [130, 130]);
  assert.deepEqual([b.w, b.h], [100, 100], 'unselected twin must be untouched');
});

test('AC12b handle of a deleted element is ignored, not a crash', () => {
  const { s, t } = mk();
  const r = addRect(s, { x: 0, y: 0, w: 100, h: 100 });
  select(s, [r.id]); t.setTool('select');
  const p0 = corner(r, 'se');
  t.pointerDown(down(p0.x, p0.y));                         // gesture in flight...
  s.deleteElements([r.id]);                                // ...element vanishes underneath it
  let err = null;
  try { t.pointerMove({ x: p0.x + 50, y: p0.y + 50 }); t.pointerUp({ x: p0.x + 50, y: p0.y + 50 }); }
  catch (e) { err = e; }
  assert.equal(err, null, 'mid-gesture delete must degrade gracefully');
});

// --- M23 killer: pristine restore must cover STYLE, not just geometry ------------
// Without _applyOriginalPositions() restoring el.style, a competing edit made during the
// gesture (properties panel, another tab's autosave reload) leaks into the final element.
// IMPORTANT: this must target a property _applyResize NEVER writes (fill on a rect).
// An earlier version used text/fontSize and did NOT kill the mutant, because _resizeText
// rebuilds el.style from orig regardless - so the restore line was redundant there.
test('AC11c competing style edit mid-gesture is discarded by the pristine restore', () => {
  const { s, t } = mk();
  const r = addRect(s, { x: 0, y: 0, w: 100, h: 100 });
  select(s, [r.id]); t.setTool('select');
  const p0 = corner(r, 'se');
  t.pointerDown(down(p0.x, p0.y));
  assert.equal(t.drag.kind, 'resize');
  r.style.fill = 'lime';                                     // competing edit mid-drag
  r.style.opacity = 0.01;
  t.pointerMove({ x: p0.x + 50, y: p0.y + 50 });
  t.pointerUp({ x: p0.x + 50, y: p0.y + 50 });
  assert.notEqual(r.style.fill, 'lime', 'the competing fill must NOT survive the gesture');
  assert.equal(r.style.fill, '#4f8ef7', 'style restored from the pristine snapshot');
  assert.notEqual(r.style.opacity, 0.01, 'opacity likewise');
  assert.deepEqual([r.w, r.h], [150, 150], 'and the resize itself still applied');
});

// --- M27 killer: exercise the branch where the NEAR endpoint is `from` -----------
// A line drawn right-to-left has `from` on the east side. Dragging that handle must move
// `from`, not `to`. (Both earlier line tests happened to have `to` as the near end, so a
// mutant that always picked `to` survived.)
test('AC7c right-to-left line: se handle moves `from`, `to` stays anchored', () => {
  const { s, t } = mk();
  const ln = s.createElement('line', { from: { x: 100, y: 0 }, to: { x: 0, y: 0 } });
  s.addElement(ln); select(s, [ln.id]); t.setTool('select');
  t.pointerDown(down(100, 0));                               // east end == `from`
  assert.equal(t.drag && t.drag.kind, 'resize');
  t.pointerMove({ x: 140, y: 30 });
  t.pointerUp({ x: 140, y: 30 });
  assert.deepEqual(ln.from, { x: 140, y: 30 }, 'near endpoint (`from`) follows the pointer');
  assert.deepEqual(ln.to, { x: 0, y: 0 }, 'far endpoint (`to`) is the anchor');
});

test('AC7d vertical line: dragging the top handle moves whichever endpoint is up there', () => {
  const { s, t } = mk();
  const ln = s.createElement('line', { from: { x: 0, y: 50 }, to: { x: 0, y: 200 } });
  s.addElement(ln); select(s, [ln.id]); t.setTool('select');
  t.pointerDown(down(0, 50));                                // north end == `from`
  assert.equal(t.drag && t.drag.kind, 'resize');
  t.pointerMove({ x: 0, y: 20 });
  t.pointerUp({ x: 0, y: 20 });
  assert.deepEqual(ln.from, { x: 0, y: 20 }, '`from` is the top endpoint here');
  assert.deepEqual(ln.to, { x: 0, y: 200 }, '`to` anchored');
});

// ------------------------------- D2 REMOVED (session 4, client sign-off):
// Shape resize is ALWAYS free deform; Shift must have NO effect on box-type resize.
// (The aspect-ratio primitive itself stays in geometry.js — F4 images lock by default
// and Shift RELEASES there. Line/arrow keep Shift = preserve-angle, tested above.)
test('D2-REMOVED Shift has no effect on box resize: identical result with and without', () => {
  const ratioRun = (shift) => {
    const { s, t } = mk();
    const r = addRect(s, { x: 0, y: 0, w: 100, h: 50 });
    select(s, [r.id]); t.setTool('select');
    const p0 = corner(r, 'se');
    t.pointerDown(down(p0.x, p0.y, { shiftKey: shift }));
    t.pointerMove({ x: p0.x + 50, y: p0.y + 10, shiftKey: shift });
    t.pointerUp({ x: p0.x + 50, y: p0.y + 10, shiftKey: shift });
    return [r.w, r.h];
  };
  assert.deepEqual(ratioRun(false), [150, 60], 'free deform follows the pointer exactly');
  assert.deepEqual(ratioRun(true), [150, 60], 'Shift must NOT lock — same box as no-Shift');
});

// ------------------------- ZOOM-INDEPENDENT SIZE FLOOR (reviewer lead #3 fix)
// Spec §3.4 (amended): the anti-degenerate clamp is CONSTANT ON SCREEN:
// minSize = MIN_SHAPE_SIZE_W / scale world units. At scale 0.05 a bare world-unit
// floor lets a shape shrink to 0.15 px — smaller than ONE handle grab radius
// (HANDLE_HIT_SCREEN_PX/scale = 140 world units) — both handles collapse onto one
// point and the shape is unrecoverable. This test pins the on-screen floor.
test('RZ1 size floor is zoom-independent: dragged far past anchor, box stays >= 3 CSS px on screen', () => {
  for (const scale of [0.05, 0.1, 0.5, 1, 8]) {
    const s = new Store(), v = new Viewport(0, 0, scale);
    const t = new ToolManager(s, v, { getSize: () => ({ width: 800, height: 600 }) });
    const r = addRect(s, { x: 0, y: 0, w: 100, h: 100 });
    select(s, [r.id]); t.setTool('select');
    const c = t.activeHandles().find((h) => h.corner === 'se');
    t.pointerDown({ button: 0, x: c.x * scale, y: c.y * scale });
    t.pointerMove({ x: -5000, y: -5000 });          // screen px; far past the nw anchor
    t.pointerUp({ x: -5000, y: -5000 });
    const onScreenW = r.w * scale, onScreenH = r.h * scale;
    assert.ok(onScreenW >= tools.MIN_SHAPE_SIZE_W - 1e-9,
      `scale ${scale}: width ${onScreenW.toFixed(3)} css px < ${tools.MIN_SHAPE_SIZE_W}`);
    assert.ok(onScreenH >= tools.MIN_SHAPE_SIZE_W - 1e-9,
      `scale ${scale}: height ${onScreenH.toFixed(3)} css px < ${tools.MIN_SHAPE_SIZE_W}`);
    // RECOVERY (behavioural, stronger than a geometric proxy): pressing at the
    // collapsed corner must still START a resize (hitHandle reverse-paint order
    // deterministically grabs 'se'; its 'nw' anchor stayed put), and dragging out
    // must restore a usable size. A tiny-but-recoverable box is a UX squeeze, not
    // data loss — pin the actual user-visible property instead of a proxy.
    const c2 = t.activeHandles().find((h) => h.corner === 'se');
    t.pointerDown({ button: 0, x: c2.x * scale, y: c2.y * scale });
    assert.equal(t.drag && t.drag.kind, 'resize', `scale ${scale}: collapsed box not grabbable`);
    // Grow by 200 WORLD units => screen delta = 200 * scale (screen->world divides by scale).
    const d = 200 * scale;
    t.pointerMove({ x: c2.x * scale + d, y: c2.y * scale + d });
    t.pointerUp({ x: c2.x * scale + d, y: c2.y * scale + d });
    assert.ok(r.w >= 100 && r.h >= 100, `scale ${scale}: could not grow back (got ${r.w}x${r.h})`);
  }
});

// ------------- LEAD #7 REGRESSION (reviewer adversarial pass, session 4)
// The reviewer's first probe reported "text anchor drift up to 1245 world units".
// Root cause was NOT a code bug: on a COLLAPSED box (font clamped to MIN/MAX) the
// four corners stack on one point, so hitHandle deterministically grabs a DIFFERENT
// corner than the one we asked for (reverse paint order). Measuring the result
// against the REQUESTED corner then looks like drift; measuring against the ACTUAL
// grabbed corner it is exactly zero. This test pins the real invariant: whatever
// corner hitHandle chose, its OPPOSITE bbox corner must stay pixel-fixed -- across
// font sizes, zoom levels and drags that blow through the font clamp.
test('LEAD#7 text anchor is fixed at the OPPOSITE corner of the ACTUAL grabbed handle', () => {
  let worstDrift = 0;
  for (const fs0 of [4, 6, 10, 24, 100]) {
    for (const scale of [1, 0.1, 8]) {
      for (const wantCorner of ['se', 'nw', 'ne', 'sw']) {
        for (const dx of [-5000, -100, -30, -10, -3, -1, 0, 5, 40, 5000]) {
          const s = new Store(), v = new Viewport(0, 0, scale);
          const t = new ToolManager(s, v, { getSize: () => ({ width: 800, height: 600 }) });
          const el = s.createElement('text', { x: 100, y: 100, text: 'hi' });
          el.style = { ...(el.style || {}), fontSize: fs0 };   // force true fs0
          s.addElement(el); select(s, [el.id]); t.setTool('select');
          const b0 = bboxOfElement(el);
          // capture the corner the implementation ACTUALLY grabbed (may differ when collapsed)
          let actual = null;
          const origApply = t._applyResize.bind(t);
          t._applyResize = function (e, d) { actual = d.corner; return origApply(e, d); };
          const c = t.activeHandles().find((h) => h.corner === wantCorner);
          const sx = (wantCorner.includes('e') ? 1 : -1) * dx * scale;
          const sy = (wantCorner.includes('s') ? 1 : -1) * dx * scale;
          t.pointerDown({ button: 0, x: c.x * scale, y: c.y * scale });
          t.pointerMove({ x: c.x * scale + sx, y: c.y * scale + sy });
          t.pointerUp({ x: c.x * scale + sx, y: c.y * scale + sy });
          const b1 = bboxOfElement(el);
          const ac = actual || wantCorner;
          const ax = ac.includes('w') ? b0.x + b0.w : b0.x;   // opposite corner of b0
          const ay = ac.includes('n') ? b0.y + b0.h : b0.y;
          const bx1 = ac.includes('w') ? b1.x + b1.w : b1.x;  // same corner of b1
          const by1 = ac.includes('n') ? b1.y + b1.h : b1.y;
          worstDrift = Math.max(worstDrift, Math.abs(bx1 - ax), Math.abs(by1 - ay));
        }
      }
    }
  }
  assert.ok(worstDrift < 1e-9,
    `opposite-corner anchor drifted ${worstDrift} world units over 600 drags (should be 0)`);
});

// --------------------------------------------------------- D3 (multi-select deferred)
test('D3 with several elements selected, a handle press does NOT silently resize one of them', () => {
  const { s, t } = mk();
  const a = addRect(s, { x: 0, y: 0, w: 100, h: 100 });
  const b = addRect(s, { x: 200, y: 0, w: 100, h: 100 });
  select(s, [a.id, b.id]); t.setTool('select');
  const p0 = corner(a, 'se');
  t.pointerDown(down(p0.x, p0.y));
  t.pointerMove({ x: p0.x + 40, y: p0.y + 40 });
  t.pointerUp({ x: p0.x + 40, y: p0.y + 40 });
  assert.deepEqual([a.w, a.h], [100, 100], 'single-selection only in F1 (group resize = F1b)');
  assert.deepEqual([b.w, b.h], [100, 100]);
});
