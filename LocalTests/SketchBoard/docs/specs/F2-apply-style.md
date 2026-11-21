# F2 - "Apply style" button on the top toolbar

Client intent (session 2 brief): when the selected object(s) do NOT match the toolbar
controls, show a button that applies ALL toolbar definitions to the selection. Works
for multi-selection too.

## 1. Problem
The style bar edits live (T6): changing a control patches the selection immediately.
But the controls hold PENDING values that may differ from the selected object - e.g.
you pick red in the fill input while a blue rect is selected, and nothing tells you
the rect is still blue nor offers a one-click way to say "make it what the bar shows".

## 2. Behaviour
### 2.1 The toolbar DEFINITION set (normative)
Exactly these nine control-backed keys form the definition applied by the button:
  fill, fillEnabled, stroke, strokeEnabled, strokeWidth, opacity, dash, radius,
  fontFamily, fontSize   <- ten keys total from nine controls (fill/stroke each pair
  a checkbox + colour input; counted as one control each).
EXCLUDED: the preset <select> - it is a CHOOSER with no standing value ('' = none),
not a definition. Decision D-F2-1 (LEAD, flagged for veto).

### 2.2 Visibility rule
The button (.apply-style, in the topbar) is VISIBLE iff:
  (a) store.selected.size >= 1, AND
  (b) AT LEAST ONE control's current value differs from the corresponding style key of
      the selection ("differs" = not ALL selected elements match that control; a key
      missing on an element compares against DEFAULT_STYLE; numbers compared numerically,
      colours case-insensitively).
Hidden otherwise (empty selection => nothing to apply onto; full match => no-op button).
Sync happens inside render() (next to syncToolbar) so visibility can never go stale.

### 2.3 Action
One click builds the FULL patch from all nine controls and applies it to EVERY selected
element via the T6 path (pushState once + updateStyle per id). After a successful apply
the selection matches the bar => button hides itself (invariant pinned by test).
Single history entry per click (undo restores all). Multi-select: all ids patched.

### 2.4 Non-goals
No per-field diff display, no revert-individual-field, no styling of pending style
(empty selection keeps today's behaviour), presets untouched.

## 3. Acceptance criteria (TESTER writes FIRST - RED)
F2-1  button exists in topbar, hidden when selection matches the bar.
F2-2  mismatch on ANY single control (e.g. fill colour) makes it visible.
F2-3  click applies ALL nine keys to the selection in ONE undo step; exact values == controls.
F2-4  multi-selection: every selected element receives the patch.
F2-5  after apply, button hides (selection now matches).
F2-6  empty selection: button hidden AND click impossible/no-op (pending style untouched).
F2-7  numeric/string coercion: range-string '2' vs style number 2 counts as MATCH
      (no phantom mismatch), colour '#ABCDEF' vs '#abcdef' matches.

## 4. Mutants (M49+)
M49 visibility predicate always-false            -> kills F2-2
M50 apply patch reduced to fill-only              -> kills F2-3
M51 apply touches only first selected id          -> kills F2-4
M52 button visible with empty selection           -> kills F2-6
