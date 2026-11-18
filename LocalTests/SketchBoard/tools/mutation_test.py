
import subprocess, os, sys, json

ROOT = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.join(ROOT, 'project')
NODE = os.path.abspath(os.path.join(ROOT, '.unsloth-packages', 'lib',
        'python3.13', 'site-packages', 'nodejs', 'bin', 'node'))

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
