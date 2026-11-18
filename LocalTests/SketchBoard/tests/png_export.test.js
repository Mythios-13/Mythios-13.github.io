// TESTER T8 (RED): Save-as-PNG pipeline. Reviewer BLOCKING-1..3 said the old M7b
// test was VACUOUS (a tautological always-true assertion) while real browsers threw
// "Illegal constructor"
// on `new window.HTMLCanvasElement()`. These tests emulate a REAL browser contract:
//   - window.HTMLCanvasElement exists but new-ing it throws (as in every browser)
//   - document.createElement('canvas') is the only legitimate way to get a canvas
// Everything is recorded so assertions can actually fail.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDom } from './dom_stub.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url));
import { exportBounds, pngPixelSize } from '../src/export.js';

const KEY = 'sketchboard.doc.v1';
const docOf = (n) => ({ app: 'sketchboard', version: 1, elements: Array.from({ length: n }, (_, i) => ({ id: 'el_' + (i + 1), type: 'rect', x: i * 30, y: 0, w: 20, h: 20, style: {} })) });

function fakeStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return { map, writes: [], getItem(k) { return map.has(k) ? map.get(k) : null; },
           setItem(k, v) { this.writes.push([k, String(v)]); map.set(k, String(v)); },
           removeItem(k) { map.delete(k); } };
}

/** Recording canvas that behaves like a real <canvas>: getContext + toBlob. */
function makeRecordingCanvas(registry) {
  const canvas = {
    tagName: 'CANVAS', width: 300, height: 150, ops: [], blobCalls: 0,
    getContext(kind) {
      assert.equal(kind, '2d', 'PNG raster must ask for a 2d context');
      const ctx = {
        fillStyle: null,
        fillRect(x, y, w, h) { canvas.ops.push({ op: 'fillRect', fillStyle: this.fillStyle, x, y, w, h }); },
        drawImage(img, x, y, w, h) { canvas.ops.push({ op: 'drawImage', src: img, x, y, w, h }); },
      };
      canvas.ctx = ctx;
      return ctx;
    },
    toBlob(cb, mime) { canvas.blobCalls++; canvas.toBlobMime = mime; setTimeout(() => cb({ __blob: true, size: 1234 }), 0); },
  };
  registry.canvases.push(canvas);
  return canvas;
}

class FakeImage {
  constructor() { FakeImage.instances.push(this); }
  set src(v) {
    this._src = v;
    if (FakeImage.mode === 'error') { if (this.onerror) setTimeout(() => this.onerror(new Error('decode')), 0); return; }
    if (this.onload) setTimeout(() => this.onload(), 0);
  }
}
FakeImage.instances = [];
FakeImage.mode = 'ok';

async function bootApp(opts = {}) {
  const { doc, win } = makeDom();
  const registry = { canvases: [] };
  // ---- REAL BROWSER CONTRACT (the whole point of T8) --------------------
  // HTMLCanvasElement is an illegal constructor in browsers; createElement is legal.
  win.HTMLCanvasElement = function HTMLCanvasElement() { throw new TypeError('Illegal constructor'); };
  win.Image = FakeImage;
  const origCreate = doc.createElement.bind(doc);
  doc.createElement = (tag) => (String(tag).toLowerCase() === 'canvas' ? makeRecordingCanvas(registry) : origCreate(tag));
  globalThis.document = doc; globalThis.window = win;
  globalThis.Blob = undefined;                       // force data-URL branch only if no blob
  const mod = await import('../src/app.js');
  const root = doc.createElement('div');
  const downloads = [];
  const api = mod.boot(root, Object.assign({
    storage: fakeStorage({ [KEY]: JSON.stringify(docOf(2)) }), hash: '',
    download: (name, body, mime) => downloads.push({ name, body, mime }),
  }, opts));
  const itemByAction = (a) => (root.querySelectorAll('.menu-item') || []).find((b) => b.dataset.action === a);
  const hud = () => (root.querySelectorAll('.hud') || [])[0];
  const settle = () => new Promise((r) => setTimeout(r, 30));
  return { api, root, downloads, registry, itemByAction, hud, settle, win, doc };
}

// ---------------------------------------------------------------- P1 (B1+B2)
test('P1 Save-as-PNG works through the DEFAULT browser path and downloads a real PNG', async () => {
  FakeImage.mode = 'ok'; FakeImage.instances.length = 0;
  const { api, downloads, registry, hud, itemByAction, settle } = await bootApp();
  itemByAction('export-png').dispatch('click');
  await settle(); await settle();

  assert.equal(downloads.length, 1, 'exactly one download must reach the sink (got ' + downloads.length + '; hud=' + (hud() && hud().textContent) + ')');
  const d = downloads[0];
  assert.match(d.name, /\.png$/, 'download name must end in .png');
  assert.match(String(d.mime || ''), /^image\/png/, 'mime must be image/png');
  assert.ok(d.body && (d.body.__blob === true || typeof d.body === 'string'), 'body must be a Blob or data URL, got ' + typeof d.body);

  // The canvas MUST have come from document.createElement('canvas'), never
  // `new window.HTMLCanvasElement()` (illegal constructor in every browser).
  assert.equal(registry.canvases.length, 1, 'one canvas created via document.createElement');
  const canvas = registry.canvases[0];
  assert.equal(canvas.tagName, 'CANVAS', 'canvas came from createElement("canvas")');

  // Dimensions follow pngPixelSize(exportBounds(...)) at current zoom.
  const expect = pngPixelSize(exportBounds(api.store.elements), Math.max(1, api.viewport.scale));
  assert.equal(canvas.width, expect.width, 'canvas width tracks export bounds');
  assert.equal(canvas.height, expect.height, 'canvas height tracks export bounds');

  // Raster order: opaque white background BEFORE the image is drawn.
  const ops = canvas.ops.map((o) => o.op);
  assert.deepEqual(ops, ['fillRect', 'drawImage'], 'must paint background then draw image, got ' + ops.join(','));
  assert.equal(canvas.ops[0].fillStyle, '#ffffff', 'background must be opaque white (transparent PNGs read as black)');
  assert.deepEqual([canvas.ops[0].x, canvas.ops[0].y], [0, 0]);
  assert.equal(canvas.ops[0].w, expect.width); assert.equal(canvas.ops[0].h, expect.height);
  assert.equal(canvas.ops[1].op, 'drawImage');
  assert.equal(canvas.ops[1].w, expect.width, 'drawImage must scale to canvas width');
  assert.equal(canvas.ops[1].h, expect.height, 'drawImage must scale to canvas height');
});

// ------------------------------------------------------------------- P2 (B1)
test('P2 rasterisation failure surfaces a toast and downloads NOTHING (no silent success)', async () => {
  FakeImage.mode = 'error'; FakeImage.instances.length = 0;
  const { downloads, hud, itemByAction, settle } = await bootApp();
  itemByAction('export-png').dispatch('click');
  await settle(); await settle();
  assert.equal(downloads.length, 0, 'a failed raster must never claim a download');
  const msg = (hud() && hud().textContent) || '';
  assert.match(msg, /png/i, 'toast must mention PNG: ' + msg);
  assert.match(msg, /fail|could not|unable|error/i, 'toast must report failure: ' + msg);
  FakeImage.mode = 'ok';
});

// ------------------------------------------------------- P3 back-compat glue
test('P3 an injected legacy CanvasCtor constructor still works (deps contract preserved)', async () => {
  FakeImage.mode = 'ok'; FakeImage.instances.length = 0;
  const made = [];
  function LegacyCanvas() {                                  // plain ctor, as menu.test M7b used
    const c = { width: 0, height: 0, ops: [], getContext: () => ({ fillStyle: null, fillRect() {}, drawImage() {} }), toBlob: (cb) => setTimeout(() => cb({ __blob: true }), 0) };
    made.push(c); return c;
  }
  const { downloads, itemByAction, settle } = await bootApp({ CanvasCtor: LegacyCanvas });
  itemByAction('export-png').dispatch('click');
  await settle(); await settle();
  assert.equal(made.length, 1, 'legacy ctor still honoured (no regression for existing callers)');
  assert.equal(downloads.length, 1, 'and it still downloads');
});

// -------------------------------------------------------------------- P4 (B1)
test('P4 the rasterised source is the SVG document itself (single serializer invariant)', async () => {
  FakeImage.mode = 'ok'; FakeImage.instances.length = 0;
  const { api, itemByAction, settle } = await bootApp();
  itemByAction('export-png').dispatch('click');
  await settle(); await settle();
  assert.ok(FakeImage.instances.length >= 1, 'an Image must be used for rasterisation');
  const src = String(FakeImage.instances[0]._src || '');
  assert.match(src, /^data:image\/svg\+xml/, 'source must be an svg data URL');
  assert.ok(decodeURIComponent(src).includes('<svg'), 'decoded source carries the serialized scene');
  assert.match(decodeURIComponent(src), /viewBox="/, 'exported SVG keeps padded viewBox');
});

// --------------------------------------------------------------------- P5 (B2)
test('P5 empty board still exports a non-degenerate PNG (fallback box, never 0x0)', async () => {
  FakeImage.mode = 'ok'; FakeImage.instances.length = 0;
  const { downloads, registry, itemByAction, settle } = await bootApp({ hash: '#reset', storage: fakeStorage() });
  itemByAction('export-png').dispatch('click');
  await settle(); await settle();
  assert.equal(downloads.length, 1, 'blank board export must still work');
  const c = registry.canvases[0];
  assert.ok(c.width >= 1 && c.height >= 1, 'canvas must never be degenerate: ' + c.width + 'x' + c.height);
});

// --------------------------------------------------------------------- P6 (B3)
// Meta-guard against the OLD failure mode: M7b "passed" via a tautological
// always-true assertion (the banned literal is built by concatenation below).
// If someone weakens this suite back into a rubber stamp, CI fails loudly.
test('P6 no vacuous assertions in the PNG suite (anti-M7b meta-guard)', () => {
  const src = readFileSync(join(here, 'png_export.test.js'), 'utf8');
  // Whole-line comments are stripped first so prose about the old bug does not
  // trip the guard; only executable lines are scanned.
  const code = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  // Built by concatenation so this guard does not match its own source text.
  const vacuous = 'assert' + '.ok(' + 'true';
  assert.ok(!code.includes(vacuous), vacuous + ') is banned: it cannot fail');
  const n = (src.match(/assert\.(equal|deepEqual|match|ok\()/g) || []).length;
  assert.ok(n >= 20, 'the PNG suite must make substantial assertions, found ' + n);
});
