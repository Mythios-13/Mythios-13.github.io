
import subprocess, os, sys, json

# This file lives at project/tools/mutation_test.py. Resolve everything from
# its real location instead of hardcoding layout assumptions -- the original
# version assumed ROOT == project/ and ROOT/.unsloth-packages, which broke as
# soon as the script was moved into tools/ (it looked for project/tools/project).
TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(TOOLS_DIR)                 # -> project/
SANDBOX = os.path.dirname(PROJECT)                   # -> sandbox/
NODE = os.environ.get('SKETCH_NODE') or os.path.abspath(os.path.join(
        SANDBOX, '.unsloth-packages', 'lib', 'python3.13', 'site-packages',
        'nodejs', 'bin', 'node'))

if not os.path.exists(NODE):
    print(f"!! node binary not found at: {NODE}")
    print("   set SKETCH_NODE=/path/to/node and retry")
    sys.exit(2)

MUTATIONS = [
    # id, file, needle, replacement, why-it-must-be-caught
    ("M1-margin-one-sided", "src/export.js",
     "w: round3(b.w + 2 * m)", "w: round3(b.w + m)",
     "margin must pad BOTH sides; X-series pins viewBox -40 -40 89 89"),
    ("M2-height-one-sided", "src/export.js",
     "h: round3(b.h + 2 * m)", "h: round3(b.h + m)",
     "height padding asymmetry => border-to-border capture on bottom edge"),
    ("M3-reset-case-sensitive", "src/persistence.js",
     "t.trim().toLowerCase() === 'reset'", "t.trim() === 'reset'",
     "#RESET / #Reset must still work (case-insensitive contract)"),
    ("M4-reset-broken", "src/persistence.js",
     "return tokens.some((t) => t.trim().toLowerCase() === 'reset');",
     "return false;",
     "#reset must yield empty canvas"),
    ("M5-autosave-throws", "src/persistence.js",
     "      failures++;                                  // quota / private mode: stay silent",
     "      failures++;\n      throw e;                   // MUTANT: must never escape",
     "autosave must NEVER throw at call site (private-mode storage)"),
    ("M6-menu-not-autoopen", "src/app.js",
     "el('div', 'menu open')", "el('div', 'menu')",
     "stakeholder: burger menu AUTO OPENS"),
    ("M7-clear-not-undoable", "src/app.js",
     "store.pushState(store.snapshot());\n    store.elements = [];",
     "store.elements = [];",
     "clear canvas must be undoable (that is why no confirm())"),
    ("M8-gocenter-kills-zoom", "src/app.js",
     "viewport.x = 0; viewport.y = 0;",
     "viewport.x = 0; viewport.y = 0; viewport.scale = 1;",
     "Go to Center recentres OFFSET only; zoom is preserved"),
    ("M9-debounce-ignored", "src/persistence.js",
     "const delay = Number.isFinite(debounceMs) && debounceMs >= 0 ? debounceMs : DEFAULT_DEBOUNCE_MS;",
     "const delay = 0;",
     "autosave must be debounced, not fire-on-every-edit"),
    ("M10-no-trailing-reschedule", "src/persistence.js",
     "    dirty = true;\n    unschedule();",
     "    dirty = true;",
     "each edit must push the timer back (trailing debounce), else it fires mid-burst"),

    # ---- T8 (PNG export) mutants, added with the fix, not after it -----------
    ("M11-png-no-white-bg", "src/app.js",
     "          ctx.fillStyle = '#ffffff';\n          ctx.fillRect(0, 0, width, height);",
     "          // MUTANT: background fill removed",
     "unfilled canvas => PNG reads as black; P1 pins fillRect-before-drawImage"),
    ("M12-png-illegal-ctor", "src/app.js",
     "  if (typeof document !== 'undefined' && document && typeof document.createElement === 'function') {\n    return () => document.createElement('canvas');\n  }",
     "  if (typeof window !== 'undefined' && window.HTMLCanvasElement) {\n    return () => new window.HTMLCanvasElement();\n  }",
     "the original bug: constructing HTMLCanvasElement throws in a real browser"),
    ("M13-png-bg-after-image", "src/app.js",
     "          ctx.fillStyle = '#ffffff';\n          ctx.fillRect(0, 0, width, height);\n          ctx.drawImage(img, 0, 0, width, height);",
     "          ctx.drawImage(img, 0, 0, width, height);\n          ctx.fillStyle = '#ffffff';\n          ctx.fillRect(0, 0, width, height);",
     "order matters: white painted last would erase the artwork"),
    ("M14-png-swallows-failure", "src/app.js",
     "        (e) => toast('PNG export failed: ' + (e && e.message))",
     "        () => toast('PNG exported')",
     "a failed raster must never claim success (P2: no silent success)"),
    ("M15-png-null-blob-accepted", "src/app.js",
     "              if (!blob) { rejectOnce(new Error('canvas produced no image data')); return; }",
     "              // MUTANT: null-blob guard removed (the original H-A bug)",
     "toBlob(cb) fires with null on encoding failure; downloading it lies about success (P7)"),
    ("M16-png-no-watchdog", "src/app.js",
     "      watchdog = setTimeout(() => rejectOnce(new Error('timed out rasterizing the image')), timeoutMs);",
     "      // MUTANT: watchdog never armed (the original H-B bug)",
     "if onload/onerror never fire the promise hangs and the user gets zero feedback (P8)"),
    ("M17-png-empty-dataurl-ok", "src/app.js",
     "            if (typeof url !== 'string' || !url) {\n              rejectOnce(new Error('canvas produced no image data'));\n              return;\n            }",
     "            // MUTANT: empty data URL accepted",
     "an empty toDataURL() result must not be handed to the download sink"),

    # ---- F1 (resize via corner handles) mutants -----------------------------
    ("M18-anchor-axis-flip", "src/geometry.js",
     "  const ax = corner.includes('w') ? rx + rw : rx;",
     "  const ax = corner.includes('w') ? rx : rx + rw;   // MUTANT: wrong anchor side",
     "anchor must be the OPPOSITE corner; breaks every nw/sw drag invariant (G2/G4)"),
    ("M19-anchor-rebuild-inverted", "src/geometry.js",
     "    x: corner.includes('w') ? ax - w : ax,",
     "    x: corner.includes('w') ? ax : ax - w,           // MUTANT: west/east swapped",
     "the bug I made while writing it: west drags must place x = ax - w (G1-G4)"),
    ("M20-signed-extent-to-abs", "src/geometry.js",
     "  const wantW = corner.includes('w') ? ax - px : px - ax;",
     "  const wantW = Math.abs(px - ax);                   // MUTANT: silent flip",
     "abs() lets a past-anchor drag grow the box the wrong way -> violates D1 clamp (G5/AC9)"),
    ("M21-clamp-removed", "src/geometry.js",
     "  let w = clamp(wantW, minSize, Infinity);\n  let h = clamp(wantH, minSize, Infinity);",
     "  let w = wantW;                                     // MUTANT: floor removed\n  let h = wantH;",
     "negative/zero w/h would reach the model and corrupt rendering (G5/G9/AC9)"),
    ("M22-no-history-push", "src/tools.js",
     "        if (!d.moved) { d.moved = true; this.store.pushState(d.snapshot); } // AC4: exactly one entry",
     "        d.moved = true;                              // MUTANT: no undo entry",
     "a resize you cannot undo loses work (AC4)"),
    ("M23-no-pristine-restore", "src/tools.js",
     "        this._applyOriginalPositions();                    // pristine geometry, no drift (AC11)",
     "        // MUTANT: accumulate deltas instead of restoring pristine geometry",
     "frame-count-dependent drift is the T5-class bug; AC11 pins 25 steps == 1 step"),
    ("M24-pick-beats-handle", "src/tools.js",
     "    const handle = this.hitHandle(world);",
     "    const handle = this.pick(world) ? null : this.hitHandle(world);  // MUTANT: precedence flipped",
     "handles sit ON the shape edge; if pick wins, resizing is impossible at any zoom (AC10)"),
    ("M25-text-writes-wh", "src/tools.js",
     "    el.style = { ...orig.style, fontSize: fs };",
     "    el.style = { ...orig.style, fontSize: fs };\n    el.w = box.w; el.h = box.h;  // MUTANT: phantom size",
     "text size lives ONLY in style.fontSize; encoding it in w/h forks two sources of truth (AC6)"),
    ("M26-font-clamp-removed", "src/tools.js",
     "    const fs = Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, fs0 * factor));",
     "    const fs = fs0 * factor;                         // MUTANT: unclamped",
     "runaway drag => fontSize 0 or 1e6, element unrecoverable (AC6b)"),
    ("M27-segment-far-endpoint", "src/tools.js",
     "      if (dist < best) { best = dist; nearKey = key; }       // first wins on exact ties",
     "      if (dist > best) { best = dist; nearKey = key; }       // MUTANT: picks the FAR end",
     "dragging a corner must move the NEAR endpoint, far one is the anchor (AC7/AC7b)"),
    ("M28-multiselect-resize", "src/tools.js",
     "    if (this.tool !== 'select' || this.store.selected.size !== 1) return [];",
     "    if (this.tool !== 'select') return [];           // MUTANT: group resize enabled",
     "decision D3 defers group resize to F1b; silently resizing one of N is worse than none (D3)"),
    ("M29-zoom-floor-removed", "src/tools.js",
     "    const minSize = MIN_SHAPE_SIZE_W / Math.max(this.viewport.scale, EPS_TOL);",
     "    const minSize = MIN_SHAPE_SIZE_W;                // MUTANT: bare world-unit floor",
     "reviewer lead #3: at scale 0.05 the floor is 0.15 css px - smaller than one grab radius, both handles collapse and the shape is unrecoverable (RZ1). Replaces dead M29-aspect-lock-ignored after client removed D2."),
    ("M30-deleted-mid-gesture", "src/tools.js",
     "        if (!el) return { type: 'none' };                 // deleted mid-gesture (AC12b)",
     "        // MUTANT: no existence guard",
     "undo/delete under an in-flight gesture must degrade, not throw (AC12b)"),
    ("M31-handle-identity-stripped", "src/render.js",
     " data-id=\"${escapeXml(el.id)}\" data-corner=\"${corner}\"",
     "",
     "reviewer MAJOR-5: without identity the overlay is decoration, not a control (R1/R2/R5)"),
    # ---- MAJOR-4 (doc validation / read-only lock) + T10 (text editability) -------
    ("M33-seed-on-rejected-save", "src/app.js",
     "  if (isProtectedStatus(verdict.status)) {\n    readOnly = true;\n    pinMessage(readOnlyReason(verdict));\n  }",
     "  // MUTANT: protection removed -> falls through and lets seed()/autosave clobber",
     "THE data-loss bug itself: a newer-build save gets buried under demo shapes (V6/V7)"),
    ("M34-autosave-write-gate-removed", "src/persistence.js",
     "    if (typeof canWrite === 'function' && !canWrite()) {  // MAJOR-4 read-only lock\n      dirty = false;                               // drop it: this build may NEVER hold\n      return false;                                //   a buffer destined for a locked key\n    }",
     "    // MUTANT: write gate gone - scheduled writes reach storage even when locked",
     "read-only UI without a write gate is theatre: autosave still destroys the save (V7)"),
    ("M35-newer-version-check-weakened", "src/persistence.js",
     "  if ('app' in data && typeof data.version === 'number' && Number.isInteger(data.version) && data.version > DOC_VERSION) {",
     "  if ('app' in data && typeof data.version === 'number' && Number.isInteger(data.version) && data.version >= DOC_VERSION) {  // MUTANT: off-by-one",
     "v>= instead of v> rejects our OWN current saves: users could never reopen their board (V4)"),
    ("M36-hud-pin-overwritten", "src/app.js",
     "    hud.textContent = pinnedMsg || `${store.elements.length} objects \u00b7 zoom ${(viewport.scale * 100).toFixed(0)}% \u00b7 ${tools.tool}`;",
     "    hud.textContent = `${store.elements.length} objects \u00b7 zoom ${(viewport.scale * 100).toFixed(0)}% \u00b7 ${tools.tool}`;  // MUTANT: pin ignored",
     "user sees a normal HUD on a locked board -> edits silently vanish with no explanation (V6)"),
    ("M37-text-hit-tolerance-zero", "src/geometry.js",
     "      const tPad = Math.max(t, fs * 0.3, bbox.h * 0.15);",
     "      const tPad = 0;                                // MUTANT: bare estimate again",
     "T10 regression: text becomes un-double-clickable at glyph edges again (T10-G1/E1)"),
    # ---- F6 (save/load document to disk) ------------------------------------------
    ("M38-open-without-validate", "src/app.js",
     "    if (verdict.status !== 'ok') {",
     "    if (false) {                                       // MUTANT: door unguarded",
     "an opened file bypasses inspectDocString: a foreign/newer payload half-loads and autosave then mirrors garbage into storage (F6-4)"),
    ("M39-open-not-undoable", "src/app.js",
     "      store.pushState(prevSnapshot);                                     // so the undo point is pushed AFTER (D-F6-2)",
     "      // MUTANT: undo point dropped - opening a file becomes irreversible",
     "one Ctrl+Z after a mistaken Open must restore the pre-open board (D-F6-2 / F6-5)"),
    ("M40-load-stays-locked", "src/app.js",
     "      readOnly = false;",
     "      // MUTANT: lock never clears - good files cannot heal the board",
     "a successful load proves the key holds readable content; keeping the lock strands the user (D-F6-1 / F6-7)"),
    ("M41-save-refused-while-locked", "src/app.js",
     "  function doSaveDisk() {\n    try {",
     "  function doSaveDisk() {\n    if (readOnly) { toast('Board is read-only'); return; }   // MUTANT: over-strict gate\n    try {",
     "saving YOUR OWN board to a file destroys nothing; refusing it while locked blocks the backup escape hatch (spec 3.3 / F6-9)"),
    # ---- F7 (double-click status bar -> zoom 100%) ----------------------------------
    ("M42-zoom-reset-no-reanchor", "src/app.js",
     "    viewport.x = W / 2 - centreWorldBefore.x;      // re-anchor: centre point stays centred\n    viewport.y = H / 2 - centreWorldBefore.y;",
     "    // MUTANT: no re-anchor - view jumps away from what the user was looking at",
     "resetting zoom must keep the centre world point centred; without this the canvas teleports (F7-2)"),
    ("M43-toast-before-render-clobbered", "src/app.js",
     "    render();                                      // refresh overlay + status line first...\n    toast('Zoom reset to 100%');                   // ...THEN toast: render() rewrites hud text",
     "    toast('Zoom reset to 100%');                   // MUTANT: toast before render -> instantly clobbered\n    render();",
     "render() rewrites hud.textContent every frame; toast-first means the user never sees feedback (F7-5)"),
    ("M44-idempotent-guard-removed", "src/app.js",
     "    if (viewport.scale === 1) { toast('Already at 100% zoom'); return; }   // idempotent, no churn",
     "    // MUTANT: guard gone - resets run the whole path even at 100%",
     "self-inverse maths hides this from value checks; F7-4 pins the distinct feedback instead (vacuity-tested)"),
    ("M45-zoom-reset-no-render", "src/app.js",
     "    render();                                      // refresh overlay + status line first...",
     "    // MUTANT: model updated but scene never repainted",
     "model-correct-but-painted-stale is the classic canvas half-fix; F7-1 asserts the camera transform"),
    # ---- T10-B (text metrics contract: baselines stack DOWNWARD from el.y) ----------
    ("M46-text-bbox-old-fiction", "src/geometry.js",
     "      return { x: el.x, y: el.y - TEXT_ASCENT_RATIO * fs, w: s.w, h: s.h };",
     "      return { x: el.x, y: el.y - s.h * 0.85, w: s.w, h: s.h };  // MUTANT: pre-T10-B fiction",
     "the exact client-reported bug returns: multi-line hit box floats above the glyphs, lines 2..N un-double-clickable (T10-B1/B2/B4, X1 pin)"),
    ("M47-text-resize-old-inversion", "src/tools.js",
     "    el.y = by + TEXT_ASCENT_RATIO * fs;",
     "    el.y = orig.y + (by + nh * 0.85 - (b0.y + b0.h * 0.85));  // MUTANT: old inversion",
     "resize anchoring must invert the CURRENT bbox contract; the 0.85*h form drifts the opposite corner (LEAD#7 sweep)"),
    ("M48-line-height-drift", "src/geometry.js",
     "export const TEXT_LINE_HEIGHT_RATIO = 1.25;   // baseline-to-baseline / fontSize",
     "export const TEXT_LINE_HEIGHT_RATIO = 1.0;    // MUTANT: tighter leading",
     "painting and hit-testing move together (contract!) but export bounds and tspan markup MUST notice - pins the coupling (T10-B6, X1 literal)"),
    # ---- F2 (Apply style button) - RETIRED S6 ---------------------------------------
    # M49-M52 targeted the "Apply style" button, which the client asked us to DELETE once
    # the mirror fix made it a no-op. Their needles no longer exist, and leaving them here
    # would mean four permanent SKIPPED entries - the same failure mode as the M55 skip that
    # hid a broken mutant for two sessions. Coverage of "apply a style to the selection"
    # migrated to M62-M70 (swatch galleries): same guarantees, new carrier.
    #   M49 btn-never-shows / M50 fill-only / M51 first-selected-only / M52 guard-removed
    # ---- F4 (image tool) --------------------------------------------------------------
    ("M53-image-not-box-resizable", "src/tools.js",
     "const RESIZABLE_BOX_TYPES = ['rect', 'ellipse', 'triangle', 'diamond', 'star', 'image'];",
     "const RESIZABLE_BOX_TYPES = ['rect', 'ellipse', 'triangle', 'diamond', 'star'];  // MUTANT: image dropped",
     "images must resize like the rect tool (client brief) - corner drag does nothing now (F4-7/F4-8)"),
    ("M54-aspect-polarity-inverted", "src/tools.js",
     "    if (el.type === 'image' && !d.shift && orig.w > 0 && orig.h > 0) aspect = orig.w / orig.h;",
     "    if (el.type === 'image' && d.shift && orig.w > 0 && orig.h > 0) aspect = orig.w / orig.h;  // MUTANT: Shift LOCKS",
     "spec section 0 polarity: locked by DEFAULT, Shift RELEASES - inverting distorts photos by default (F4-7+F4-8)"),
    ("M55-render-drops-par", "src/render.js",
     'height="${h}" preserveAspectRatio="none" opacity=',
     'height="${h}" opacity=',
     "without none, free-deform LETTERBOXES instead of stretching - Shift resize looks broken (F4-6). NOTE: the original needle ' preserveAspectRatio=\"none\"' matched TWICE (a comment + the code) so this mutant silently SKIPPED for two sessions; the needle now anchors on the attribute run that only the code line has."),
    ("M56-src-unescaped", "src/render.js",
     "href=\"${escapeXml(String(el.src ?? ''))}\"",
     "href=\"${String(el.src ?? '')}\"",
     "hostile src bytes could close the attribute and inject handlers (F4-9)"),
    ("M32-corner-map-swapped", "src/geometry.js",
     "    ne: { x: r.x + r.w, y: r.y },\n    sw: { x: r.x, y: r.y + r.h },",
     "    ne: { x: r.x, y: r.y + r.h },      // MUTANT: label vs position disagree\n    sw: { x: r.x + r.w, y: r.y },",
     "data-corner must describe GEOMETRY, not just exist; R5 pins label==position. NOTE: merely reordering the render loop's corner array is an EQUIVALENT mutant (labels and coords both come from cornerPoints, and hit-testing reads activeHandles(), not paint order) - that variant was tried and correctly survives."),

    # ---- S5 image additions (ghost / place-then-select / original size) --------------
    ("M57-image-ghost-branch-dead", "src/app.js",
     "else if (res.type === 'preview-image' && res.img) {",
     "else if (false && res.type === 'preview-image' && res.img) {   // MUTANT: no ghost ever",
     "client asked for a placeholder preview while placing; without this branch nothing follows the cursor (S5-F4c)"),
    ("M58-ghost-not-centred", "src/app.js",
     "      x: world.x - p.width / 2, y: world.y - p.height / 2,\n      w: p.width, h: p.height, src: p.src,",
     "      x: world.x, y: world.y,\n      w: p.width, h: p.height, src: p.src,   // MUTANT: top-left anchor",
     "ghost must be centred where the stamp lands; uncentring makes the preview lie about placement (S5-F4c geometry pins)"),
    ("M59-no-auto-select-tool-after-place", "src/tools.js",
     "      this.setTool('select');",
     "      // MUTANT: stays in image tool\n",
     "client asked that placing an image hand control back to Select with the new object selected, so corner handles are immediately usable (S5-F4e)"),
    ("M60-original-size-ignores-natural", "src/app.js",
     "    const nw = e.natW > 0 ? e.natW : e.w, nh = e.natH > 0 ? e.natH : e.h;",
     "    const nw = e.w, nh = e.h;   // MUTANT: 'original size' becomes a no-op",
     "the menu action exists to restore natural size; ignoring natW/natH makes it invisible-but-broken (S5-F4d)"),
    ("M61-ghost-burn-in-regression", "src/app.js",
     "if (hadPreview && res.type === 'none') render();",
     "// MUTANT: transient state cleared without repainting",
     "regression guard for the bug S5-F4c caught: the PLACE ghost stayed burned into the overlay after the stamp"),

    # ---- S6 swatch galleries ---------------------------------------------------------
    ("M62-swatch-gallery-never-collects", "src/app.js",
     "const used = collectUsedStyles(store.elements);",
     "const used = [];   // MUTANT: recent gallery always empty",
     "the whole feature: styles in use must appear as miniatures (S6-2, S6-12, S6-13, S6-17)"),
    ("M63-swatch-cache-always-stale", "src/app.js",
     "    if (sig === swatchSig) return;",
     "    if (true) return;   // MUTANT: gallery never rebuilds after first paint",
     "a new style must appear when drawn; an always-hit cache freezes the gallery at boot (S6-12)"),
    ("M64-swatch-cache-disabled", "src/app.js",
     "    if (sig === swatchSig) return;",
     "    if (false) return;   // MUTANT: rebuild every frame",
     "unconditional rebuild destroys hover/focus mid-click and burns nodes per pan frame (S6-12 reuse clause)"),
    ("M65-swatch-no-selection-guard-gone", "src/app.js",
     "    if (!store.selected.size) { toast('Select object(s) first to apply a style'); return; }",
     "    // MUTANT: guard removed",
     "clicking a chip with nothing selected must be a TOTAL no-op - no history, no pending drift (S6-6)"),
    ("M66-swatch-idempotence-guard-gone", "src/app.js",
     "    if (!changes.length) { toast(`${label} already applied`); return; }",
     "    // MUTANT: guard removed, always pushes history",
     "re-applying the same style must NOT pollute the undo stack (S6-7)"),
    ("M67-swatch-writes-full-style", "src/app.js",
     "    const patch = swatchPatchOf(style);",
     "    const patch = { ...style };   // MUTANT: writes non-depicted keys too",
     "D-S6-5 honesty rule: a chip may only write what it depicts - otherwise clicking a colour silently restyles text (S6-9, S6-15)"),
    ("M68-swatch-keys-include-fonts", "src/styles.js",
     "export const SWATCH_KEYS = [\n  'fill', 'fillEnabled', 'stroke', 'strokeEnabled', 'strokeWidth', 'opacity',\n  'dash', 'radius',\n];",
     "export const SWATCH_KEYS = [\n  'fill', 'fillEnabled', 'stroke', 'strokeEnabled', 'strokeWidth', 'opacity',\n  'dash', 'radius', 'fontFamily', 'fontSize',\n];   // MUTANT: fonts back in",
     "two pixel-identical chips would behave differently and a colour chip would restyle text (S6-9, S6-14, S6-15)"),
    ("M69-swatch-dedupe-broken", "src/styles.js",
     "    if (hit !== undefined) { out[hit].count++; continue; }",
     "    // MUTANT: duplicates become separate chips",
     "'one miniature per style applied' is the client sentence; duplicates multiply chips and break counts (S6-2, S6-16)"),
    ("M70-swatch-cap-removed", "src/styles.js",
     "    if (out.length >= limit) continue;",
     "    // MUTANT: no cap",
     "a 10k-object drawing must not build 10k DOM nodes (S6-13)"),

    # ---- S6b stroke depiction clamp -------------------------------------------------
    ("M71-stroke-clamp-removed", "src/render.js",
     "    ? Math.max(0, Math.min(raw, SWATCH_STROKE_MAX))",
     "    ? raw                                       // MUTANT: depict the real width",
     "client ask: a fat outline devours the fill in a 24x16 chip; unclamping makes fills unreadable (S6b-1, S6b-5, S6b-6)"),
    ("M72-stroke-clamp-too-tight", "src/render.js",
     "Math.min(raw, SWATCH_STROKE_MAX)",
     "Math.min(raw, 0)                                 // MUTANT: outlines vanish entirely",
     "clamping to 0 erases strokes rather than shrinking them - the chip would misrepresent outlined shapes (S6b-2)"),

    # ---- S6c responsive dropdown ----------------------------------------------------
    ("M73-compact-never-triggers", "src/app.js",
     "    const compact = w < COMPACT_MAX_WIDTH;",
     "    const compact = false;                        // MUTANT: bar never adapts",
     "on a narrow window the galleries push the controls off screen - the exact complaint (S6c-2, S6c-5, S6c-6, S6c-7)"),
    ("M74-toggle-always-visible", "src/app.js",
     "    galleryToggle.hidden = !compact;",
     "    galleryToggle.hidden = false;                 // MUTANT: toggle always shown",
     "client wants instant availability kept on wide screens; a permanent toggle costs a click (S6c-1)"),
    ("M75-dropdown-toggle-dead", "src/app.js",
     "    galleryWrap.classList.toggle('open', open);",
     "    // MUTANT: dropdown never opens",
     "galleries would be permanently unreachable on small screens (S6c-3)"),
    ("M76-stale-open-state", "src/app.js",
     "      galleryWrap.classList.toggle('open', false);",
     "      // MUTANT: stale open panel left parked when going wide",
     "an orphan open dropdown over the canvas after resizing wide, plus aria-expanded lying (S6c-5)"),
    ("M77-no-resize-listener", "src/app.js",
     "  window.addEventListener('resize', () => render());",
     "  // MUTANT: bar ignores window resizing",
     "dragging the window edge must re-evaluate compact mode; without this the bar only fixes itself on the next edit (S6c-1/2/5/6)"),

    # ---- S7 in-app manual / key-command overlay (client request, session 5) ----
    ("M78-help-menu-entry-removed", "src/app.js",
     "    ['help', 'Manual & keys'],           // S7: in-app reference card (client request)",
     "    // MUTANT: no manual entry in the menu",
     "the menu must offer the manual; without the entry the user cannot reach the documented shortcuts at all (S7-1)"),
    ("M79-help-action-dead", "src/app.js",
     "      case 'help': return toggleHelp();",
     "      case 'help': return undefined;",
     "a menu item that does nothing is worse than no menu item - clicking Manual must open the overlay (S7-1)"),
    ("M80-help-visible-at-boot", "src/app.js",
     "    const scrim = el('div', 'help-panel'); scrim.hidden = true;",
     "    const scrim = el('div', 'help-panel');",
     "the manual must start hidden; a full-screen scrim over the canvas on every load hides the app (S7-1)"),
    ("M81-help-close-button-dead", "src/app.js",
     "    close.addEventListener('click', () => { scrim.hidden = true; });",
     "    // MUTANT: close button has no handler",
     "users must be able to dismiss the card by its own affordance, not only via Esc/backdrop (S7-6)"),
    ("M82-help-escape-ignored", "src/app.js",
     "      if (helpPanel && !helpPanel.hidden) helpPanel.hidden = true;",
     "      // MUTANT: Escape no longer dismisses the manual",
     "Esc is the universal dismiss key; a reference card that traps it breaks muscle memory (S7-7)"),
    ("M83-help-tool-rows-hardcoded", "src/app.js",
     "    const toolRows = Object.keys(live)",
     "    const toolRows = [] ? Object.keys(live) : ['v']",
     "tool rows are GENERATED from the live keymap so docs cannot rot; hardcoding them lets a new shortcut ship undocumented (S7-3)"),
    ("M84-help-text-edit-rule-gone", "src/app.js",
     "      kbdRow(['Double-click'], 'Edit text \\u2014 aim anywhere on the text, INCLUDING over '",
     "      kbdRow(['Enter'], 'Edit text \\u2014 aim anywhere on the text, INCLUDING over '",
     "the client asked specifically that text editing needs a DOUBLE-CLICK (works over the handles); naming the wrong gesture teaches a broken workflow (S7-5)"),
    ("M85-kbd-chip-class-renamed", "src/app.js",
     "    for (const k of keysArr) keys.appendChild(el('kbd', 'kbd', k));",
     "    for (const k of keysArr) keys.appendChild(el('kbd', 'keychip', k));",
     "the kbd class is both the styling hook and the machine-readable handle tests use to prove every live shortcut is advertised (S7-3/4/12)"),
    # ---- S7-BROWSER-FIX: [hidden] must beat author display rules (client-reported) ----------
    ("M87-hidden-guard-removed", "styles.css",
     "[hidden] { display: none !important; }",
     "/* MUTANT: global hidden guard deleted */",
     "THE CLIENT-REPORTED BUG RETURNS: .help-panel{display:flex} is an author rule and beats the UA [hidden] rule, so the manual shows at boot and cannot be closed by x/backdrop/Esc (S7-13)"),
    ("M88-hidden-guard-loses-to-author-rules", "styles.css",
     "[hidden] { display: none !important; }",
     "[hidden] { display: none; }",
     "without !important the guard still loses to .help-panel{display:flex} - same user-visible bug, subtler diff; pins why !important is load-bearing (S7-14)"),

    ("M86-help-toggle-cannot-reopen", "src/app.js",
     "  function toggleHelp() { helpPanel.hidden = !helpPanel.hidden; }",
     "  function toggleHelp() { helpPanel.hidden = true; }",
     "after closing once, the manual could never be opened again until reload (S7-8)"),
]

def run_suite():
    p = subprocess.run([NODE, "--test", "tests/"], cwd=PROJECT,
                       capture_output=True, text=True, timeout=300)
    out = p.stdout
    fail = None
    for line in out.splitlines():
        if line.startswith("# fail "):
            fail = int(line.split()[2])
    return fail, p.returncode

base_fail, base_rc = run_suite()
print("BASELINE fail =", base_fail, "rc =", base_rc)
if base_fail != 0:
    print("!! baseline not green - aborting"); sys.exit(1)

results = []
ORIGINALS = {}
for mid, rel, needle, repl, why in MUTATIONS:
    ORIGINALS[rel] = open(os.path.join(PROJECT, rel), encoding="utf-8").read()
    path = os.path.join(PROJECT, rel)
    orig = open(path, encoding="utf-8").read()
    n = orig.count(needle)
    if n != 1:
        results.append((mid, "SKIPPED", f"needle found {n}x"))
        continue
    open(path, "w", encoding="utf-8").write(orig.replace(needle, repl))
    try:
        f, rc = run_suite()
    except Exception as e:
        results.append((mid, "ERROR", str(e)))
        f = None
    finally:
        open(path, "w", encoding="utf-8").write(orig)
    verdict = "CAUGHT" if (f and f > 0) else "SURVIVED"
    results.append((mid, verdict, f"fail={f}"))
    print(f"{mid:26s} {verdict:9s} fail={f}")

# integrity: every touched source must be byte-identical to what we read at start
bad = sorted({rel for _, rel, _, _, _ in MUTATIONS
              if open(os.path.join(PROJECT, rel), encoding="utf-8").read() != ORIGINALS[rel]})
print("\nrestored byte-identical:", "YES" if not bad else "NO -> " + ", ".join(bad))
survived = [r for r in results if r[1] == "SURVIVED"]
skipped  = [r for r in results if r[1] == "SKIPPED"]
print(f"\nTOTAL {len(results)} | CAUGHT {len(results)-len(survived)-len(skipped)} | SURVIVED {len(survived)} | SKIPPED {len(skipped)}")
for r in survived: print("  SURVIVOR:", r[0])
for r in skipped: print("  SKIPPED :", r[0], r[2])
