// TESTER F7 (RED): client request session 4 - "double click on the status bar resets
// the zoom to 100%". The status bar IS the .hud element (objects | zoom % | tool).
// Design (LEAD): reset scale to EXACTLY 1 anchored at the WINDOW CENTER (the world
// point currently at the centre stays there) - mirrors viewport.zoomAt's anchor math
// but assigns scale=1 outright instead of scale*(1/scale), which is float-safe. Pan is
// PRESERVED apart from the anchor correction (unlike viewport.reset(), which also zeroes
// pan - wrong semantics here). Pure camera op: never touches elements or history.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDom } from './dom_stub.js';

async function bootApp(deps = {}) {
  const { doc, win } = makeDom();
  globalThis.document = doc; globalThis.window = win;
  const mod = await import('../src/app.js');
  const root = doc.createElement('div');
  const map = new Map();
  const storage = { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k) };
  const api = mod.boot(root, Object.assign({ storage, hash: '', download() {}, debounceMs: 0 }, deps));
  const hud = () => (root.querySelectorAll('.hud') || [])[0];
  return { api, root, hud, win };
}

test('F7-1 double-click on the status bar sets zoom to EXACTLY 100%', async () => {
  const { api, root, hud } = await bootApp();
  api.viewport.zoomAt(300, 200, 2.5);                       // any non-unit zoom
  api.render();                                              // PAINT the zoomed state first:
  const svg = root.children.find((c) => c.tagName === 'SVG');
  const gScene = svg && svg.children[1];                     // [gGrid, gScene, gOverlay]
  // Assert the precondition (lesson from F6-7): without this, the scene still holds the
  // boot-time scale(1) paint and a dropped-render() mutant survives by luck (M45 did).
  assert.match(String(gScene.getAttribute('transform')), /scale\(2\.5\)$/, 'precondition: painted zoomed');
  assert.notEqual(api.viewport.scale, 1, 'precondition: zoomed in');
  hud().dispatch('dblclick');
  assert.equal(api.viewport.scale, 1, 'scale must be exactly 1 (not 0.9999...)');
  // Teeth: the scene camera must actually REPAINT at scale 1 (kills a dropped-render()
  // mutant - model-correct-but-painted-stale is the classic canvas half-fix).
  assert.match(String(gScene.getAttribute('transform')), /scale\(1\)$/, 'camera repainted');
});

test('F7-2 the world point at the window CENTRE stays at the centre (anchor invariant)', async () => {
  const { api, hud } = await bootApp();
  const W = 1280, H = 800;                                   // dom_stub clientWidth/Height
  api.viewport.panBy(137, -91);                              // arbitrary pan
  api.viewport.zoomAt(400, 300, 3.7);                        // arbitrary zoom about off-centre
  const centreWorldBefore = api.viewport.screenToWorld({ x: W / 2, y: H / 2 });
  hud().dispatch('dblclick');
  const centreWorldAfter = api.viewport.screenToWorld({ x: W / 2, y: H / 2 });
  assert.ok(Math.abs(centreWorldAfter.x - centreWorldBefore.x) < 1e-9
         && Math.abs(centreWorldAfter.y - centreWorldBefore.y) < 1e-9,
    `centre drifted: ${JSON.stringify(centreWorldBefore)} -> ${JSON.stringify(centreWorldAfter)}`);
});

test('F7-3 pure camera op: elements and history untouched', async () => {
  const { api, hud } = await bootApp();
  const els = JSON.stringify(api.store.toJSON());
  const hist = api.store._history.length;
  api.viewport.zoomAt(100, 100, 5);
  hud().dispatch('dblclick');
  assert.equal(JSON.stringify(api.store.toJSON()), els, 'board bytes identical');
  assert.equal(api.store._history.length, hist, 'no history entry pushed');
});

test('F7-4 double-click at ALREADY 100% is an exact no-op (idempotent)', async () => {
  const { api, hud } = await bootApp();
  api.viewport.panBy(60, 60);
  const before = { x: api.viewport.x, y: api.viewport.y, s: api.viewport.scale };
  hud().dispatch('dblclick');
  assert.deepEqual({ x: api.viewport.x, y: api.viewport.y, s: api.viewport.scale }, before);
  // Teeth: the re-anchor maths is SELF-INVERSE at scale 1, so value equality alone cannot
  // tell "early return" from "ran the whole thing". Assert the DISTINCT feedback instead,
  // else a mutant deleting the guard survives (vacuous-test audit).
  assert.match(hud().textContent, /already/i, 'idempotent path says so explicitly');
});

test('F7-5 user gets feedback mentioning 100% (toast respects the MAJOR-4 pin)', async () => {
  const { api, hud } = await bootApp();
  api.viewport.zoomAt(300, 200, 2);
  api.render();                                    // refresh HUD so it really reads 200%
  assert.match(hud().textContent, /200\s?%/, 'precondition: hud shows the zoomed state');
  hud().dispatch('dblclick');
  // Teeth: matching /100%/ alone is VACUOUS - render()'s own status line says
  // "zoom 100%", so it would pass even if the toast were clobbered by render order.
  // Match the TOAST copy specifically; this is what kills the toast-before-render mutant.
  assert.match(hud().textContent, /zoom reset to 100%/i, 'toast must survive render(): ' + hud().textContent);
});

test('F7-6 affordances: hud advertises the gesture (title tooltip) and is clickable-looking', async () => {
  const { hud } = await bootApp();
  assert.match(String(hud().title || ''), /zoom/i, 'title hints the double-click action');
  const css = (await import('node:fs')).readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  const rule = /\.hud\s*{[^}]*}/.exec(css);
  assert.ok(rule, '.hud rule exists');
  assert.match(rule[0], /cursor:\s*pointer/, 'cursor invites the click');
});
