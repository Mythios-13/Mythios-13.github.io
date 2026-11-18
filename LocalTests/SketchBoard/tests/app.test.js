// TESTER: T4 app-shell — static safety scans + pure helper units.
// No browser here, so we police the GLUE CONTRACT: logic stays out of app.js,
// user data never reaches innerHTML, and every wiring surface is accounted for.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const appSrc = readFileSync(join(here, '..', 'src', 'app.js'), 'utf8');
const htmlSrc = readFileSync(join(here, '..', 'index.html'), 'utf8');
const cssSrc = readFileSync(join(here, '..', 'styles.css'), 'utf8');

test('app.js imports cleanly under Node (DOM-guarded boot)', async () => {
  const mod = await import('../src/app.js');
  assert.equal(typeof mod.boot, 'function');
});

// ---------------- security scans ----------------
test('NO eval / new Function anywhere in app code', () => {
  for (const f of ['app.js']) {
    const src = readFileSync(join(here, '..', 'src', f), 'utf8');
    assert.ok(!/\beval\s*\(/.test(src), `${f}: eval`);
    assert.ok(!/new\s+Function\s*\(/.test(src), `${f}: new Function`);
  }
});

test('every innerHTML assignment is either "" or a render.js call (whitelist)', () => {
  const hits = [...appSrc.matchAll(/\.innerHTML\s*=\s*([^;]+);/g)].map((m) => m[1].trim());
  const allowed = [
    /^gridMarkup\(.*\)$/,                 // generated coords only
    /^sceneToSvg\(.*\)$/,                  // render.js escapes everything
    /^selectionOverlaySvg\(.*\) \+ previewMarkup\(\)$/,
    /^''$/,                                // clear-before-rebuild
  ];
  for (const h of hits) {
    assert.ok(allowed.some((re) => re.test(h)), `un-whitelisted innerHTML source: ${h}`);
  }
  assert.ok(hits.length >= 3, 'sanity: scans should actually find the expected sites');
});

test('no innerHTML += append pattern (bypass vector)', () => {
  assert.ok(!/\.innerHTML\s*\+=/.test(appSrc));
});

test('user text enters DOM only via .value / textContent, never markup', () => {
  assert.match(appSrc, /editor\.value = elem\.text;/, 'text editor must assign .value');
  assert.ok(!/textarea[\s\S]{0,80}innerHTML/.test(appSrc), 'no innerHTML near textarea creation');
  assert.match(appSrc, /l\.textContent = label/);
  assert.match(appSrc, /b\.textContent = label/);
});

test('previewMarkup interpolates only numeric-derived fields or sanctioned renderers', () => {
  // preview rect/points come from viewport math (numbers), not strings.
  // T6 UPDATE (LEAD ruling): previews are now rendered by the SAME escaping
  // renderer as the committed scene, so elementToSvg(...) is an approved source.
  // The whitelist names it EXPLICITLY - arbitrary expressions are still banned.
  const ALLOWED_RENDERERS = /^elementToSvg\(/;
  const fn = /function previewMarkup\(\)[\s\S]*?\n  \}/.exec(appSrc)?.[0] ?? '';
  assert.ok(fn.length > 50, 'previewMarkup found');
  const interpolated = [...fn.matchAll(/\$\{([^}]+)\}/g)].map((m) => m[1]);
  assert.ok(interpolated.some((e) => ALLOWED_RENDERERS.test(e.trim())),
    'shape previews must go through the sanctioned renderer, not bespoke markup');
  for (const expr of interpolated) {
    const e = expr.trim();
    assert.ok(
      ALLOWED_RENDERERS.test(e)
      || /^(r|x|y|d|a|c|viewport\.scale|\d)/.test(e) || /Math\.(min|max|abs)|\.x|\.y|\.w|\.h|points\.map/.test(e),
      `unexpected interpolation source in preview markup: ${expr}`);
  }
});

test('index.html: module script, no inline handlers, CSP-friendly', () => {
  assert.match(htmlSrc, /<script type="module" src="src\/app\.js"><\/script>/);
  assert.ok(!/onclick|onload=|onerror=/i.test(htmlSrc), 'no inline event handlers');
  assert.ok(!/<script(?![^>]*src=)[^>]*>[\s\S]*?<\/script>/.test(htmlSrc.replace(/<script type="module" src="src\/app\.js"><\/script>/, '')), 'no inline scripts');
});

// ---------------- pure glue helpers ----------------
test('wheelFactor: scroll up zooms in (>1), down zooms out (<1)', async () => {
  const { wheelFactor } = await import('../src/app.js');
  assert.ok(wheelFactor(-100, 0, false) > 1);
  assert.ok(wheelFactor(100, 0, false) < 1);
});

test('wheelFactor: line-deltaMode amplified ~40x vs pixel', async () => {
  const { wheelFactor } = await import('../src/app.js');
  const px = Math.log(wheelFactor(3, 0, false));   // 3px
  const ln = Math.log(wheelFactor(3, 1, false));   // 3 lines
  assert.ok(Math.abs(ln / px - 40) < 1e-6);
});

test('wheelFactor: pinch (ctrlKey) is stronger than plain wheel', async () => {
  const { wheelFactor } = await import('../src/app.js');
  assert.ok(wheelFactor(-100, 0, true) > wheelFactor(-100, 0, false));
});

test('isTypingTarget shields shortcuts from inputs/textareas/contenteditable', async () => {
  const { isTypingTarget } = await import('../src/app.js');
  assert.equal(isTypingTarget({ tagName: 'INPUT' }), true);
  assert.equal(isTypingTarget({ tagName: 'TEXTAREA' }), true);
  assert.equal(isTypingTarget({ tagName: 'SELECT' }), true);
  assert.equal(isTypingTarget({ tagName: 'DIV', isContentEditable: true }), true);
  assert.equal(isTypingTarget({ tagName: 'DIV' }), false);
  assert.equal(isTypingTarget(null), false);
});

test('keyboard map covers AC4 tools without collision on modifiers', async () => {
  const m = await import('../src/app.js');
  for (const t of ['select', 'hand', 'rect', 'ellipse', 'line', 'arrow', 'path', 'text']) {
    assert.ok(Object.values(m.SHORTCUT_TOOLS).includes(t), `shortcut missing for ${t}`);
  }
  // TESTER UPDATE after T4 bugfix: DIAMOND_SHORTCUT export removed; diamond lives in
  // EXTRA_TOOL_SHORTCUTS. This test now guards the invariant that caused the bug:
  // no bare key may map to two tools, and 'd' must stay free for Ctrl+D.
  const all = { ...m.SHORTCUT_TOOLS, ...m.EXTRA_TOOL_SHORTCUTS, [m.TRIANGLE_SHORTCUT]: 'triangle' };
  const vals = Object.values(all);
  assert.equal(new Set(vals).size, vals.length, 'two tools must not share one key');
  assert.equal(all.d, undefined, 'd is reserved for Ctrl+D duplicate');
  assert.equal(m.DIAMOND_SHORTCUT, undefined, 'no stray diamond key export');
});

// ---------------- shell integrity ----------------
test('all toolbar tools declared in app exist in ToolManager.TOOLS', async () => {
  const { TOOLS } = await import('../src/tools.js');
  const declared = [...appSrc.matchAll(/dataset\.tool = tool/g)];
  assert.ok(declared.length >= 1);
  const labels = [...appSrc.matchAll(/\['[^']+','([a-z]+)'\]/g)].map((m) => m[1]);
  assert.ok(labels.length >= 9, `expected >=9 toolbar entries, got ${labels.length}`);
  for (const l of labels) assert.ok(TOOLS.includes(l), `toolbar references unknown tool ${l}`);
});

test('AC checklist wiring: each required interaction is bound in app.js', () => {
  const required = [
    /addEventListener\('contextmenu'/,        // right-click properties
    /button === 1/,                           // middle-click pan guard
    /addEventListener\('wheel'/,               // zoom at cursor
    /addEventListener\('dblclick'/,            // text edit entry
    /store\.undo\(\)/, /store\.redo\(\)/,      // history keys
    /duplicateElements/,                       // ctrl+D
    /deleteElements/,                          // Delete key
    /startTextEditor/,                         // inline editing
    /STYLE_PRESETS/,                           // presets reachable
  ];
  for (const re of required) assert.ok(re.test(appSrc), `missing wiring: ${re}`);
});

test('styles.css defines classes referenced by app skeleton', () => {
  for (const cls of ['board', 'toolbar', 'topbar', 'hud', 'props-panel', 'text-editor', 'prop-btn']) {
    assert.ok(cssSrc.includes(`.${cls}`), `.css missing .${cls}`);
  }
});
