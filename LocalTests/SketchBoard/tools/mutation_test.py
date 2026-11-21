
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
    ("M32-corner-map-swapped", "src/geometry.js",
     "    ne: { x: r.x + r.w, y: r.y },\n    sw: { x: r.x, y: r.y + r.h },",
     "    ne: { x: r.x, y: r.y + r.h },      // MUTANT: label vs position disagree\n    sw: { x: r.x + r.w, y: r.y },",
     "data-corner must describe GEOMETRY, not just exist; R5 pins label==position. NOTE: merely reordering the render loop's corner array is an EQUIVALENT mutant (labels and coords both come from cornerPoints, and hit-testing reads activeHandles(), not paint order) - that variant was tried and correctly survives."),
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
