# SPEC — F1: Resize placed objects by dragging corner handles

**Ticket:** F1 (client feature 1 of 5) · **Prereq:** MAJOR-5 · **Status:** SPEC — awaiting client sign-off on D1-D3
**Author:** LEAD · **Date:** session 2

## 1. Problem
Selecting an object draws a dashed bbox plus four white corner squares (`render.selectionOverlaySvg`),
but they are decoration: they carry no `data-id`, nothing hit-tests them, and `ToolManager` has no
resize drag kind. Today the only editable property of a placed object is its position.

## 2. Prerequisite — MAJOR-5 (must land first)
`selectionOverlaySvg` emits `<rect class="sel-handle" ...>` with **no identity**. Add:
- `data-id="<element id>"` (escaped, same as every other emitted id)
- `data-corner="nw|ne|sw|se"`

Constraint: `tests/render.test.js:83-84` match `class="sel-handle"[^>]*width=` — new attributes must
not break that regex. Corner order in the existing loop is already nw, ne, sw, se.

## 3. Behaviour

### 3.1 Hit-testing precedence
Handle hit-test runs **before** element pick, in `ToolManager._downSelect`, and only when
`this.tool === 'select'`. A handle sits on top of its own shape's edge; picking the shape instead
would make resizing impossible at any zoom. Handles are tested in **reverse paint order** (last drawn
= topmost wins), matching `pick()`.

Hit region = the handle rect inflated by `HANDLE_HIT_SCREEN_PX / scale` (reuse the screen-space
tolerance idea from `HIT_TOL_SCREEN_PX`; new named constant).

**AMENDED (session 4, client formal sign-off):** shipped value is `HANDLE_HIT_SCREEN_PX = 7`.
The original "default 4px extra" text described the pre-implementation draft; the client reviewed
real-world grab behaviour in the browser and signed off 7 explicitly. Spec follows code here.

**REVISED during test design:** the handle set is computed **inside `ToolManager`** from the model
(`store.selectedElements()` + `geometry.bboxOfElement`), not passed in by app.js. Reason: tools.js
already owns the store, so deriving handles internally keeps app.js forwarding pointer events
exactly as it does today (zero glue change for hit-testing), keeps the state machine hermetically
testable, and removes any temptation to read `gOverlay.innerHTML` back — which would be untestable
and re-introduce a DOM dependency into the state machine. render.js still gains the data attributes
(MAJOR-5) because they are what makes the overlay addressable for users, CSS and debugging.

API pinned by the tests:
- `geometry.resizeRect(rect, corner, point, {minSize, aspectRatio}) -> {x,y,w,h}` (PURE, new)
- `tools.HANDLE_HIT_SCREEN_PX` (exported constant)
- text/font clamps: `tools.MIN_FONT_SIZE`, `tools.MAX_FONT_SIZE`

### 3.2 Drag kind `resize`
`pointerDown` on a handle creates:
```js
{ kind:'resize', id, corner, start:world, snapshot, orig:deepClone(el), moved:false }
```
`pointerMove`:
1. compute world point;
2. below `CLICK_THRESHOLD_PX` screen movement => `{type:'none'}` (a click on a handle must not mutate);
3. first crossing => `store.pushState(d.snapshot)` **exactly once** per gesture (history hygiene,
   cf. MINOR-7);
4. restore pristine geometry from `d.orig` (the `_applyOriginalPositions` pattern — never accumulate
   deltas, or the shape drifts sub-pixel per frame);
5. apply the new box;
6. return `{type:'elements'}`.

`pointerUp`: no move => `{type:'selection'}`; else `{type:'elements', resized:true}`. No history entry
is pushed on a non-move.

### 3.3 Per-type semantics (the trap list)
| type | resize behaviour |
|---|---|
| rect, ellipse, triangle, diamond, star | set x/y/w/h from the dragged box. These are bbox-driven shapes; all derive geometry from the rect. |
| text | **size lives only in `style.fontSize`.** Scale it by the dominant-axis ratio; translate x/y so the opposite bbox corner stays fixed. TRAP: `store.createElement('text')` does **not** delete `w`/`h` (only line/arrow/path do), so text elements already carry `w:0,h:0` — the requirement is that resize leaves them at their original values and never encodes size there. |
| line, arrow | naive x/y resize is a **no-op** (geometry lives in `from`/`to`). Dragging a corner moves the nearer endpoint; dragging any corner scales the segment about the opposite endpoint. |
| path (freehand) | points are absolute world coords. Uniform scale about the fixed anchor corner, applied to every point. |

Anything unsupported degrades to **no mutation**, never to a corrupted element.

### 3.4 Anti-degenerate
Width/height are clamped to a floor that is CONSTANT ON SCREEN: `minSize = MIN_SHAPE_SIZE_W /
viewport.scale` world units, i.e. 3 CSS px however far out we are zoomed. (Session 4 fix:
the first implementation used a bare world-unit floor with no `/scale` compensation, so at
scale 0.05 a shape could shrink to 0.15 px on screen — smaller than one handle grab radius —
and become unrecoverable. Reviewer lead #3; caught by unit probe, invisible in casual browser
use, which is precisely why green browser sessions do not excuse skipping the math.)

## 4. Decisions needing client sign-off (LEAD recommendations in bold)

**D1 — Dragging past the anchored edge.**
(a) clamp at minimum size **(recommended)** — predictable, matches Figma/Sketch for shapes, keeps
`normalizeRect` out of the commit path, and cannot produce negative w/h in the model.
(b) flip the anchor and continue — feels natural but interacts badly with the clamp rule and the
per-type branches above.

**D2 — Shift during resize. REMOVED (session 4, client sign-off).**
Original decision: Shift LOCKS aspect ratio, free deform default. In the client's real-browser
session the lock was imperceptible in practice, and the client directed: "we can remove it from
the spec." Shape resize is therefore ALWAYS free deform; Shift has no effect on box-type resize.
(The pure primitive `geometry.resizeRect(...,{aspectRatio})` STAYS — it is unit-tested and is
reused by F4, where the image tool locks by default and Shift releases the lock.)
Line/arrow keep their Shift = preserve-angle behaviour (distinct affordance, not an aspect lock).

**D3 — Multi-select resize in F1?**
**Defer (recommended)** — single selection only in F1; marquee-selected groups keep move-only.
Scaling N elements coherently (uniform factor, shared anchor, per-type branch × N, one history entry)
is roughly half again the work of F1 and would put the whole ticket at risk. Filed as **F1b**.

## 5. Acceptance criteria
- AC1 Four handles carry `data-id` + `data-corner` in the rendered overlay; existing render tests stay green.
- AC2 Dragging `se` on a rect grows w/h by exactly the pointer delta (world units); x,y unchanged.
- AC3 Dragging `nw` moves x,y AND changes w/h; the `se` corner stays pixel-fixed (anchor invariant).
- AC4 One Ctrl+Z restores the exact pre-gesture element (single history entry per gesture).
- AC5 Sub-threshold press+release on a handle mutates nothing and pushes no history state.
- AC6 Text resize changes `style.fontSize` (clamped to [MIN_FONT_SIZE, MAX_FONT_SIZE]) and x/y only;
  `el.w`/`el.h` keep the values they had before the gesture (they exist as 0 — see §3.3 trap).
- AC7 line/arrow resize moves the correct endpoint / scales about the opposite endpoint.
- AC8 path resize scales every point about the fixed anchor; relative shape preserved.
- AC9 Clamp holds: w,h >= MIN_SHAPE_SIZE_W·(screen threshold/scale) however far the pointer is dragged past the anchor.
- AC10 Handle drag takes precedence over shape pick when they overlap.
- AC11 Pan/zoom mid-gesture does not corrupt the result (orig-restore pattern proven).
- AC12 No mutation of an element that is not currently selected (handle for a deselected id is ignored).

## 6. Out of scope
Rotation, edge (non-corner) handles, multi-select resize (F1b), snapping/guides, cursor glyphs per
corner (CSS polish — backlog), F2-F4.

## 7. Test plan (tester writes these FIRST — RED)
R1-R4 attribute surface (incl. the regex-compat trap); T1-T12 mapping AC1-AC12; plus adversarial:
negative-direction drags, zero-scale viewport guard, drag then Delete the element mid-gesture, drag
then undo mid-gesture, two gestures back-to-back without mouseup leak, handle id that no longer
exists in the store. Mutants M18+ : off-by-one corner map, missing pushState, missing orig-restore,
clamp removed, text branch writing w/h, handle-hit after pick.
