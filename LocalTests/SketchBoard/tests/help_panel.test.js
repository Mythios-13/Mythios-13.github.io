// TESTER S7 (client, session 5): in-app manual / key-command overlay.
// Client brief: "write a quick manual, and add it in the menu as a button, when clicked it
// shows an over panel with the key commands, make it sleek and easy readable, explain that
// for edit text you need to double click on the handles".
//
// DESIGN CHOICE THAT DRIVES THESE TESTS: the tool-shortcut rows are GENERATED from the live
// SHORTCUT_TOOLS / EXTRA_TOOL_SHORTCUTS maps, so documentation cannot rot away from the
// keymap. Several tests below assert exactly that coupling - they are the reason a future
// "add shortcut, forget the manual" change fails here instead of shipping a lying manual.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDom } from './dom_stub.js';

const EMPTY_DOC = JSON.stringify({ app: 'sketchboard', version: 1, elements: [] });

async function bootApp(deps = {}) {
  const { doc, win } = makeDom();
  globalThis.document = doc; globalThis.window = win;
  const mod = await import('../src/app.js');
  const root = doc.createElement('div');
  const map = new Map([['sketchboard.doc.v1', EMPTY_DOC]]);
  const storage = { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k) };
  const api = mod.boot(root, Object.assign({ storage, hash: '', download() {}, debounceMs: 0 }, deps));
  const items = () => (root.querySelectorAll('.menu-item') || []);
  const itemByAction = (a) => items().find((b) => b.dataset.action === a);
  const help = () => (root.querySelectorAll('.help-panel') || [])[0];
  const walk = (n, out = []) => { for (const c of n.children || []) { out.push(c); walk(c, out); } return out; };
  const helpText = () => walk(help() || { children: [] }).map((c) => c.textContent || '').join('\n');
  const keys = () => walk(help() || { children: [] })
    .filter((c) => c.classList && c.classList.contains('kbd')).map((c) => c.textContent);
  return { api, root, win, doc, items, itemByAction, help, helpText, keys, walk };
}

test('S7-1 menu gains a Help entry (seventh action) that opens the overlay', async () => {
  const { api, itemByAction, help } = await bootApp();
  const btn = itemByAction('help');
  assert.ok(btn, 'menu has data-action="help"');
  assert.match(btn.textContent, /manual|help/i, 'label reads as help/manual: ' + btn.textContent);
  assert.equal(help().hidden, true, 'overlay starts hidden');
  btn.dispatch('click');
  assert.equal(help().hidden, false, 'clicking it opens the overlay');
});

test('S7-2 the six existing menu actions are untouched (no silent removal)', async () => {
  const { items } = await bootApp();
  const actions = items().map((x) => x.dataset.action);
  for (const a of ['save-disk', 'open-disk', 'export-png', 'export-svg', 'go-center', 'clear']) {
    assert.ok(actions.includes(a), `${a} still present`);
  }
  assert.equal(actions.length, 7, 'exactly six + help, got ' + actions.join(','));
});

test('S7-3 EVERY live tool shortcut is documented, and nothing undocumented is claimed', async () => {
  const m = await import('../src/app.js');
  const { helpText, keys } = await bootApp();
  const live = { ...m.SHORTCUT_TOOLS, ...m.EXTRA_TOOL_SHORTCUTS };
  const shown = keys();
  for (const [key, tool] of Object.entries(live)) {
    assert.ok(shown.includes(key), `shortcut '${key}' (${tool}) must appear as a <kbd>`);
    // The row must pair the key with the tool name it actually activates.
    assert.match(helpText(), new RegExp(`${key}[\\s\\S]{0,40}${tool}`), `'${key}' row must name ${tool}`);
  }
  // A fabricated shortcut would be caught by the reverse direction too.
  assert.equal(shown.includes('n'), false, "'n' is not a shortcut and must not be advertised");
});

test('S7-4 core modifier chords are listed (undo/redo/duplicate/delete/escape)', async () => {
  const { helpText, keys } = await bootApp();
  const t = helpText();
  for (const want of ['Undo', 'Redo', 'Duplicate', 'Delete', 'Escape']) {
    assert.match(t, new RegExp(want, 'i'), `${want} documented`);
  }
  const k = keys().map((s) => s.toLowerCase());
  assert.ok(k.some((s) => /\bz\b/.test(s)), 'Z appears (undo/redo)');
  assert.ok(k.some((s) => /\bd\b/.test(s)), 'D appears (duplicate)');
  assert.ok(k.some((s) => /backspace/.test(s)), 'Backspace appears as a delete alternative');
});

test('S7-5 pointer gestures are documented, including the TEXT EDIT double-click rule', async () => {
  const { helpText } = await bootApp();
  const t = helpText();
  assert.match(t, /right[- ]click/i, 'right-click properties');
  assert.match(t, /middle[- ]click/i, 'middle-click pan');
  assert.match(t, /wheel/i, 'wheel zoom');
  assert.match(t, /space/i, 'space-drag pan');
  assert.match(t, /double[- ]?click/i, 'double-click is explained somewhere');
  // THE CLIENT SENTENCE: editing text needs a double click, and it works on the selection
  // handles too. Asserted loosely enough to survive rewording, tightly enough to fail if the
  // text-edit gesture disappears.
  assert.match(t, /double[- ]?click[\s\S]{0,120}text/i, 'double-click is tied to TEXT editing');
  assert.match(t, /handle/i, 'the handles case is mentioned (client ask)');
});

test('S7-6 the overlay closes via its own close button', async () => {
  const { itemByAction, help, walk } = await bootApp();
  itemByAction('help').dispatch('click');
  assert.equal(help().hidden, false, 'precondition: open');
  const close = walk(help()).find((c) => c.classList && c.classList.contains('help-close'));
  assert.ok(close, '.help-close exists inside the panel');
  close.dispatch('click');
  assert.equal(help().hidden, true, 'closed by the button');
});

test('S7-7 Escape closes the overlay (and still clears the selection)', async () => {
  const { api, win, itemByAction, help } = await bootApp();
  const el = api.store.createElement('rect', { x: 0, y: 0, w: 30, h: 30 });
  api.store.addElement(el); api.store.select([el.id]); api.render();
  itemByAction('help').dispatch('click');
  assert.equal(help().hidden, false, 'precondition: open');
  win.dispatch('keydown', { key: 'Escape', ctrlKey: false, metaKey: false, preventDefault() {}, stopPropagation() {} });
  assert.equal(help().hidden, true, 'Escape dismissed the manual');
  assert.equal(api.store.selected.size, 0, 'Escape kept its original meaning too');
});

test('S7-8 opening/closing is idempotent and leaves no duplicate panels', async () => {
  const { itemByAction, help, root, walk } = await bootApp();
  const b = itemByAction('help');
  for (let i = 0; i < 4; i++) b.dispatch('click');
  assert.equal(walk(root).filter((c) => c.classList && c.classList.contains('help-panel')).length, 1,
    'exactly ONE .help-panel node exists however many times it is toggled');
  assert.equal(help().hidden, true, 'four toggles end closed (even number)');
  b.dispatch('click');
  assert.equal(help().hidden, false, 'fifth opens again');
});

test('S7-9 shortcuts stay LIVE while the manual is open (it is a reference card, not a modal)', async () => {
  const { api, win, itemByAction, help } = await bootApp();
  itemByAction('help').dispatch('click');
  assert.equal(help().hidden, false, 'precondition: manual visible');
  win.dispatch('keydown', { key: 'r', ctrlKey: false, metaKey: false, preventDefault() {}, stopPropagation() {} });
  assert.equal(api.tools.tool, 'rect', 'you can press a key to try it while reading the manual');
});

test('S7-10 the manual is built from DOM APIs, never innerHTML (security contract holds)', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'app.js'), 'utf8');
  const hits = [...src.matchAll(/\.innerHTML\s*=\s*([^;]+);/g)].map((m) => m[1].trim());
  const allowed = [/^gridMarkup\(.*\)$/, /^sceneToSvg\(.*\)$/,
    /^selectionOverlaySvg\(.*\) \+ previewMarkup\(\)$/, /^swatchMarkup\(.*\)$/, /^''$/];
  for (const h of hits) assert.ok(allowed.some((re) => re.test(h)), `un-whitelisted innerHTML: ${h}`);
});

test('S7-11 styles.css defines the overlay classes (sleekness has a floor: it must be styled)', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'styles.css'), 'utf8');
  for (const cls of ['help-panel', 'help-card', 'help-close', 'help-grid', 'kbd', 'help-section']) {
    assert.ok(css.includes('.' + cls), `.css missing .${cls}`);
  }
});

// ---- S7-13/14: THE BUG THE CLIENT FOUND IN THE BROWSER -------------------------------
// "the manual is displayed by default, and I can't close it".
// Root cause: .help-panel { display: flex } is an AUTHOR rule, and author rules beat the UA
// stylesheet's [hidden] { display: none }. So el.hidden = true had no visual effect - which
// explains BOTH symptoms with one defect (it showed at boot, and x/backdrop/Esc all set
// hidden=true yet could not hide it).
// WHY THIS WAS NOT CAUGHT: the DOM stub has no CSS engine. Our tests asserted the JS PROPERTY
// hidden === true, which was genuinely correct; visibility is decided by CSS, which no test
// consulted. A property assertion is not a rendering assertion.
// Comments are documentation, not declarations: never let them satisfy a CSS assertion.
function stripCssComments(css) { return css.replace(/\/\*[\s\S]*?\*\//g, ''); }

test('S7-13 any class toggled via .hidden must not carry an unguarded author display rule', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const here = dirname(fileURLToPath(import.meta.url));
  // MUST strip /* comments */: the explanatory comment above the guard literally contains
  // '[hidden] { display: none }', so an unstripped scan is satisfied by PROSE - you could delete
  // the real rule, keep the comment, and this test would stay green. Caught by S7-14 matching the
  // comment instead of the rule.
  const css = stripCssComments(readFileSync(join(here, '..', 'styles.css'), 'utf8'));
  const js = readFileSync(join(here, '..', 'src', 'app.js'), 'utf8');

  // Classes the JS actually hides/shows through the hidden property.
  const toggled = new Set();
  for (const m of js.matchAll(/(?:const|let)?\s*(\w+)\s*=\s*el\(([^)]*)\)[\s\S]{0,80}?\1\.hidden\s*=/g)) {
    for (const cls of m[2].matchAll(/'([a-z][\w-]*)'/g)) toggled.add(cls[1]);
  }
  assert.ok(toggled.size >= 2, 'probe found the hidden-toggled classes: ' + [...toggled].join(','));

  // Global escape hatch: without it, ANY display: on a toggled class silently defeats .hidden.
  const guard = /\[hidden\]\s*\{[^}]*display:\s*none\s*(!important)?\s*;?[^}]*\}/.test(css);

  const offenders = [];
  for (const block of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const decls = block[2];
    const d = /(^|;)\s*display:\s*([^;]+)/.exec(decls);
    if (!d) continue;
    const value = d[2].trim();
    if (value === 'none') continue;
    for (const sel of block[1].split(',')) {
      const cls = (sel.match(/\.([a-z][\w-]*)/g) || []).map((c) => c.slice(1));
      if (cls.some((c) => toggled.has(c))) offenders.push(`${sel.trim()} { display: ${value} }`);
    }
  }
  assert.ok(guard,
    'styles.css needs a global [hidden]{display:none!important} guard because these '
    + 'hidden-toggled classes set their own display: ' + offenders.join(' | '));
});

test('S7-14 the guard uses !important (author rules MUST lose to an explicit hide)', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const css = stripCssComments(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'styles.css'), 'utf8'));
  const m = /\[hidden\]\s*\{([^}]*)\}/.exec(css);
  assert.ok(m, '[hidden] rule exists as an actual RULE (not just prose in a comment)');
  assert.match(m[1], /display:\s*none\s*!important/, 'must win over .help-panel{display:flex} etc.');
});

test('S7-12 documented keys are ACTUALLY wired (guards the y-triangle class of bug)', async () => {
  // Every bare letter shown as a tool shortcut must really switch tools. This is the test whose
  // absence let TRIANGLE_SHORTCUT='y' sit exported-but-unwired unnoticed.
  const m = await import('../src/app.js');
  const { api, win } = await bootApp();
  for (const [key, tool] of Object.entries({ ...m.SHORTCUT_TOOLS, ...m.EXTRA_TOOL_SHORTCUTS })) {
    api.setTool('select');
    win.dispatch('keydown', { key, ctrlKey: false, metaKey: false, shiftKey: false, preventDefault() {}, stopPropagation() {} });
    assert.equal(api.tools.tool, tool, `pressing '${key}' must activate ${tool}`);
  }
});
