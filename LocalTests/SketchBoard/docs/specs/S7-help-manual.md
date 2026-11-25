# S7 - In-app quick manual / key-command overlay

**Status:** `[~]` implemented + green + mutation-proven; **pending browser sign-off**.
**Requested by client (session 5):** "write a quick manual, and add it in the menu as a button,
when clicked it shows an over panel with the key commands, make it sleek and easy readable,
explain that for edit text you need to double click on the handles".

## 1 What was built
* Menu gains a 7th action `help` labelled **"Manual & keys"** (the six existing actions are
  unchanged; `menu.test.js` M4 pin widened six -> seven, kept `deepEqual`-exact).
* Clicking it toggles `.help-panel`: a dim scrim with a centred white card, sections
  (Tools / Edit / Canvas / Shapes & images / Text / Style), each row = `<kbd>` chips + one-line
  description. Sticky header + `x` close, backdrop-click dismiss, `Esc` dismiss.
* Built ONCE at boot (hidden) from DOM APIs + `textContent`. **No new `innerHTML`**, so the
  `app.test.js` security whitelist is untouched (S7-10 re-asserts it).

## 2 The load-bearing design decision: generated, not hand-written
Tool rows are produced from the LIVE `SHORTCUT_TOOLS` / `EXTRA_TOOL_SHORTCUTS` maps. Consequences:
* A future shortcut added to the keymap appears in the manual automatically.
* S7-3 asserts BOTH directions (every live shortcut is advertised; `'n'` is not invented).
* S7-12 presses every documented letter and asserts it really activates that tool.
This exists because of a real defect found while writing this (see §4).

## 3 Accuracy corrections to the brief (disclosed, not silent)
The brief said text editing needs a "double click on the handles". Verified behaviour
(`_dbl_probe.mjs`, faithful `down,up,down,up,dblclick` sequence on a selected text element):
* Double-click opens the editor when it lands on the **text itself**, on the **SE handle**, and
  on the **NW handle** - all three. Hit-testing reads elements, not handle chrome, and a
  zero-movement press never becomes a resize.
So the manual states the accurate superset: *double-click anywhere on the text, including over
its selection handles*. Documenting "on the handles" only would teach a gesture that fails when
aimed at the middle of a word. Client asked for the handles case to be explained; it is.

## 4 Defect found while auditing the keymap (NOT fixed - awaiting your call)
`TRIANGLE_SHORTCUT = 'y'` is exported but **never wired**: the keydown handler consults only
`SHORTCUT_TOOLS` + `EXTRA_TOOL_SHORTCUTS`, so pressing `y` does nothing (probe: `y->select`).
`app.test.js:118` merges the constant into its own map, so it validates the exported *data* and
passes while the feature is dead - a tested-but-not-wired gap. Deliberate choice: the manual
does **not** advertise `y`, because documenting an unwired key ships a lie. Fix is one line
(merge `{[TRIANGLE_SHORTCUT]:'triangle'}` into the lookup) + S7-12 then covers it. Not done
here because it changes behaviour beyond this request. Logged as NB-9.

## 5 Tests / mutants
`tests/help_panel.test.js` - 12 tests (S7-1..12). Suite: **26/26 pass, rc=0**.
Mutants M78-M86 (menu entry, dead action, visible-at-boot, dead close button, Esc ignored,
hardcoded tool rows, wrong text-edit gesture, `kbd` class renamed, toggle cannot reopen):
**82 total | 82 CAUGHT | 0 SURVIVED | 0 SKIPPED**. Baseline hashes refreshed (drift = app.js only).

## 6 Browser checklist (cannot be verified headlessly)
1. Menu -> "Manual & keys" opens the card over a dimmed canvas; looks sleek, readable, scrolls if tall.
2. `x`, backdrop click, and Esc each close it; reopening works repeatedly.
3. Pressing a tool letter while the card is open switches tools (it is a reference card, not a modal).
4. Two-column layout collapses to one column under ~560px.
5. Every chip you try actually does what it says (spot-check Ctrl+Shift+Z, Space+drag, wheel, Ctrl+wheel).

## 7 Browser round 1 - CRITICAL bug found by client, fixed
**Client:** "the manual is cool, but it's displayed by default, and I can't close it".

**One root cause for both symptoms.** `.help-panel { display: flex }` is an **author** rule; author
rules beat the UA stylesheet's `[hidden] { display: none }`. So `el.hidden = true` had **no visual
effect**: the card showed at boot, and all three dismiss paths (`x`, backdrop, `Esc`) correctly set
`hidden = true` and were all overridden. Because the scrim is `position:fixed; inset:0; z-index:40`,
this **blocked the whole app** until reload — a severity upgrade from cosmetic to blocker.

**Why 14 green tests missed it:** the DOM stub has **no CSS engine**. Every test asserted the JS
property `hidden === true`, which was genuinely correct. Visibility is decided by CSS, and no test
consulted CSS. *A property assertion is not a rendering assertion.*

**Fix:** global guard in `styles.css` — `[hidden] { display: none !important; }`. Chosen over
patching `.help-panel` alone because it is systemic: it also protects `.props-panel`,
`.gallery-toggle` and any future hidden-toggled node. `!important` is load-bearing — without it the
guard still loses (mutant M88 proves the tests notice). Rejected alternative: class-based
`.help-panel:not(.open){display:none}` (the `.menu` pattern) — works, but each widget re-invents
hiding and we lose the a11y/tab-order semantics of `[hidden]`.

**Guards added (S7-13/S7-14):** they scan `app.js` for classes toggled via `.hidden`, then reject any
unguarded author `display:` rule on those classes unless the global `[hidden]` guard exists, and
assert that the guard carries `!important`. A newly added hidden-toggled widget cannot slip through.

**Second toothless test, caught by its own sibling:** S7-14 initially matched `[hidden]{display:none}`
**inside my own explanatory comment**, which meant S7-13 was satisfiable by *prose* — delete the real
rule, keep the comment, stay green. Fixed with `stripCssComments()` before every CSS assertion.
Standing rule: comments are documentation, never evidence.

**Evidence after fix:** 26/26 suites rc=0; harness **84/84 CAUGHT · 0 SURVIVED · 0 SKIPPED**
(M87 guard-deleted, M88 `!important`-dropped, both mutating `styles.css`). No baseline drift —
`src/app.js` untouched this round.
