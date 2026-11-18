# SketchBoard — infinite vector canvas (v0.1)

Vanilla JS + SVG. Zero dependencies. All logic in pure, unit-tested modules;
`src/app.js` is thin DOM glue only.

## Run
Open `index.html` in any modern browser (or `npx serve .` / any static server).

## Test
    node --test tests/          # Node >= 18; sandbox note: pip install nodejs-bin

## Controls
| Action | Input |
|---|---|
| Pan | middle-click drag · space+drag · hand tool (H) |
| Zoom | wheel / trackpad pinch (anchored at cursor, 5%–4000%) |
| Create | toolbar or V H R O Y J K L A P T, then drag on canvas |
| Select | click · shift-click multi · marquee drag |
| Move | drag selection (undo-safe, drift-free) |
| Edit text | text tool click, or double-click a text node |
| Properties | right-click (styles, presets, z-order, duplicate, delete) |
| Keys | Del · Ctrl+Z / Ctrl+Y / Shift+Ctrl+Z · Ctrl+D · Esc |

## Architecture
geometry · viewport · store · styles · tools · render = PURE (node-testable)
app.js = GLUE (headless-tested against tests/dom_stub.js)
See docs/ARCHITECTURE.md, docs/BACKLOG.md.
