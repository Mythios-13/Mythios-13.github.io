# S6 - Style swatch galleries (Recent + Presets)

Client brief (session 5), verbatim intent:
> "replace the apply style by a recent Style menu. it shows all the current styles in use in
> the forms of the drawing, and when clicking on a style, it applies the style to the current
> selected forms. At launch, a quick run on the drawing, and create a miniature of the style
> for each style applied to the forms in the draw. While you are on it, make the presets the
> exactly the same, with a miniature preview of the preset style."

Follow-up adaptations (session 5b):
> "keep the stroke weight a fixed value for the preview, otherwise if the stroke weight is too
> big, we can't see the solid color anymore. so keep it at 2 or 3 px max just for preview."
> "If the window size is too small, we loose the visibility of the toolbar. In that case, the
> swatch preview should live inside a dropdown that opens. I like the way it's instantly
> available, but we need to accommodate for every screen size just in case."

## 0. Why F2 died (context, not a bug report)
The S5 mirror fix made selecting an object restore ITS style into the bar. "Apply the bar onto
the selection" therefore became a no-op - the client named it ("the apply style button has no
meaning now") and asked for a replacement. F2 acceptance criteria are superseded, not failed;
its tests are parked at `tests_parked/apply_style_s5_superseded.test.js` and mutants M49-M52
were retired (their needles no longer exist; keeping them would have meant four permanent
SKIPPED entries - the same failure mode as the two-session M55 skip).

## 1. Model / identity (PURE: styles.js)
A swatch is defined by EIGHT keys: fill, fillEnabled, stroke, strokeEnabled, strokeWidth,
opacity, dash, radius. Excluded ON PURPOSE: fontFamily, fontSize, fontStyle, textAlign,
arrowheads, arrowSize.

**D-S6-5 HONESTY RULE.** The keys a chip uses for IDENTITY == the keys its miniature PAINTS ==
the keys a click WRITES. A 24x16 rectangle cannot depict a typeface, so fonts are excluded from
all three sets; otherwise two pixel-identical chips would behave differently and clicking a
colour chip would silently restyle text. Consequence: **a swatch click never touches text
properties.** Pinned by S6-9, S6-14, S6-15, S6-18 and mutant M67/M68.

Identity canonicalisation (styleKeyOf): colours case-folded, numbers numeric ('3' == 3), missing
key == DEFAULT_STYLE. So '#ABCDEF' and '#abcdef' are one chip, strokeWidth '3' and 3 are one chip.

`collectUsedStyles(elements, limit)` -> [{ style, raw, count, key }] in DOCUMENT ORDER OF FIRST
USE, de-duplicated, capped at MAX_RECENT_SWATCHES = 24. Deterministic: survives undo/redo and a
save/reload round trip (unlike any "most recently touched" memory). Cap exists so a 10k-object
drawing cannot build 10k DOM nodes.

`raw` vs `style`: `style` is canonicalised for PAINTING/identity; `raw` is the element's own
style and is what the click handler receives, so `swatchPatchOf()` is the SINGLE authority on
what a click writes. Feeding the click pre-normalised data made that filter untestable - mutant
M67 survived until S6-18 existed.

## 2. Miniatures (PURE: render.js)
`swatchMarkup(style)` paints a synthetic 24x16 rect through `elementToSvg` - the SAME renderer
as real artwork. Two guarantees: escaping lives in exactly one module, and a chip can never show
a colour the renderer would not paint. app.js must never hand-build swatch markup.

**D-S6b STROKE DEPICTION CLAMP.** `SWATCH_STROKE_MAX = 3`: outlines above the cap are drawn AT
the cap so the fill (the chip's whole purpose) stays readable. HARD BOUNDARY: the clamp touches
the PICTURE ONLY. Identity and the written patch keep the true value - a 20px and a 40px outline
look identical in the thumbnail but remain distinct styles, still differ on click, and the
tooltip states the truth (`stroke #xxx @24`). Non-finite widths cannot emit NaN. Pinned by
S6b-1..S6b-6, mutants M71/M72. Known cosmetic: SVG strokes straddle the path, so half of a 3px
outline sits outside the viewBox and clips - accepted for a thumbnail.

## 3. Behaviour (app.js)
- Galleries rebuild inside render() behind a signature cache (ordered swatch keys + counts).
  Unchanged content MUST reuse nodes (hover/focus survive a pan); genuinely new content MUST
  rebuild. Both directions pinned (S6-12) because either direction alone is trivially faked.
- Click applies to the CURRENT SELECTION only.
  **D-S6-3**: no selection => TOTAL no-op (no history entry, pending style untouched) + HUD hint.
  **D-S6-4**: if every selected object already carries that style => ZERO history entries, so the
  undo stack cannot fill with invisible no-ops.
- Launch sweep: galleries derive from model state, so a freshly seeded board is populated before
  any edit (S6-17 boots with storage:null to exercise the MAJOR-4 'none' seeding path for real).
- Empty drawing => `.swatch-empty` hint, no throw. Null/garbage elements are skipped, never fatal.

## 4. Responsive (client adaptation b)
`COMPACT_MAX_WIDTH = 1000` (exported; boundary belongs to the INLINE side: >= threshold stays
inline, preserving the instant availability the client asked to keep).
- WIDE: `.style-gallery` is static inline content, `.gallery-toggle` hidden. Zero extra clicks.
- NARROW (`.topbar-compact`): toggle appears; panel starts CLOSED and opens over the canvas.
- Collapsing is VISUAL only: swatches stay in the DOM and clickable while collapsed (S6c-4), so
  automation and keyboard users are unaffected.
- `aria-expanded` tracks open state; going wide again clears a stale `open` + aria flag (S6c-5).
- Re-evaluated on `window resize` AND every render, and correct AT BOOT (S6c-7) so there is no
  flash of an overflowing bar before the first resize event.
Threshold is a judgement call from the bar's own width budget, deliberately NOT measured from
layout (offsetWidth reads 0 under the DOM stub and depends on fonts/CSS, so it could not be
tested here; an exported constant can).

## 5. Security
Swatch art reaches innerHTML ONLY via `render.swatchMarkup`, added to the app.test.js innerHTML
whitelist as `/^swatchMarkup\(.*\)$/` - same trust class as sceneToSvg. Hostile style values are
escaped (S6-11 asserts no attribute breakout, quotes escaped not deleted, balanced quote count).
Tooltips/names go through textContent/.title only.
DISCLOSED PROCESS DEBT: this whitelist widening was authored by the same context that wrote the
feature (LEAD-as-reviewer; isolated-context mode still never exercised).

## 6. Out of scope
Style editor UI, saving custom presets, per-key partial apply, drag-to-canvas, hover-preview of a
chip onto the selection, swatch ordering by recency-of-use, keyboard activation of tools (NB list).

## 7. Acceptance criteria (TESTER wrote FIRST - RED confirmed)
tests/style_swatches.test.js         S6-1..S6-18
tests/style_swatches_responsive.test.js  S6b-1..S6b-6, S6c-1..S6c-7
Mutants M57-M77 (S5 image additions, S6 galleries, S6b clamp, S6c responsive). Harness result:
73 total | 73 CAUGHT | 0 SURVIVED | 0 SKIPPED. Suites: 25/25.
**NOT DONE until the client confirms in a browser** (visual alignment, dropdown feel, chip legibility).
