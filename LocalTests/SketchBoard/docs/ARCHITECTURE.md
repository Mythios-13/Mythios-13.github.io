# SketchBoard — Architecture Charter (LEAD)

Client spec: infinite-canvas vector sketch app. Mouse navigation, middle-click pan,
click select/edit, right-click properties. All shapes, all colors, arrows, lines,
freehand, text nodes, appliable styles. All VECTOR.

## Stack decision
Vanilla JS ES-modules + SVG rendering. Why: SVG = native vector DOM, no build step,
core logic is pure JS => testable under `node --test` with zero dependencies.

## Module boundaries (pure/testable vs thin DOM glue)
- src/geometry.js  PURE  bboxes, hit-testing, segment distance, freehand->smooth path, polygons
- src/viewport.js  PURE  pan/zoom math, zoom-at-cursor invariant, scale clamps
- src/store.js     PURE  element CRUD, z-order, selection, undo/redo snapshots, serialization
- src/styles.js    PURE  default style, style presets, style validation
- src/tools.js     PURE  tool state machine (pointer events in -> actions out), injectable store+viewport
- src/render.js    PURE  element -> SVG markup strings, XML escaping
- src/app.js       GLUE  DOM wiring, toolbar, properties panel, text editing, keyboard
- index.html / styles.css

## Acceptance criteria (client-facing)
AC1 infinite canvas: unlimited pan/zoom (0.05x..40x), zoom anchored at cursor
AC2 navigation: middle-click drag pans, wheel zooms at cursor, space+drag pans
AC3 tools: select, hand, rect, ellipse, triangle, diamond, star, line, arrow, freehand, text
AC4 selection: click select, shift multi-select, marquee, drag-move, delete, undo/redo
AC5 right-click -> properties panel (all style props + presets + z-order + duplicate/delete)
AC6 styles: any color (native pickers), stroke width, opacity, dash, radius, font size/family,
    arrowhead, plus one-click presets applicable to ANY element type
AC7 everything vector: SVG output, exportable JSON, no rasters anywhere

## Process rules
Tester owns project/tests/, developer owns project/src/. No direct sub-agent comms.
Task DONE = node --test green AND reviewer has zero BLOCKING issues.
