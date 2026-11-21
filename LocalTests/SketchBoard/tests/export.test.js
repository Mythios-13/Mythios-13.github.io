// TESTER T7 (RED): src/export.js - pure export geometry + SVG document build.
// ORACLE PRINCIPLE: exported SVG must be produced by render.js, never re-implemented.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const M = '../src/export.js';
const mod = () => import(M);   // must exist; RED until dev delivers it

const rect = (x, y, w, h) => ({ id: 'r1', type: 'rect', x, y, w, h, style: {} });
const ellipse = (x, y, w, h) => ({ id: 'e1', type: 'ellipse', x, y, w, h, style: {} });
const arrow = (a, b) => ({ id: 'a1', type: 'arrow', from: a, to: b, style: { stroke: '#000' } });
const pathEl = (pts) => ({ id: 'p1', type: 'path', points: pts, style: { stroke: '#000' } });
const text = (x, y, t, fs = 24) => ({ id: 't1', type: 'text', x, y, text: t, style: { fontSize: fs } });

// ---------------------------------------------------------------- X1 unionBBox
test('X1 unionBBox is the geometric union over mixed types', async () => {
  const { unionBBox } = await mod();
  const els = [
    rect(0, 0, 100, 50),
    ellipse(-20, 10, 40, 40),
    arrow({ x: 300, y: -60 }, { x: 120, y: 30 }),
    pathEl([{ x: 5, y: 200 }, { x: 40, y: 260 }]),
    text(500, 300, 'hello'),
  ];
  const { textSize } = await import('../src/geometry.js');
  const b = unionBBox(els);
  assert.equal(b.x, -20);
  assert.equal(b.y, -60);
  // ORACLE derived from the geometry TEXT METRICS CONTRACT (T10-B rewrote it): text()
  // stores the FIRST BASELINE y; lines stack DOWNWARD (render.js tspans), so the box
  // runs y - TEXT_ASCENT_RATIO*fs .. y + TEXT_DESCENT_RATIO*fs for ONE line.
  // (Old pin said baseline + 0.15h / 304.5 - that encoded the pre-T10-B fiction that
  // all lines sat above y. Re-derived from the contract constants, not from output.)
  const ts = textSize(text(500, 300, 'hello'));
  const { TEXT_ASCENT_RATIO, TEXT_DESCENT_RATIO, bboxOfElement } = await import('../src/geometry.js');
  // The UNION top is the arrow's -60 (asserted above); the text-specific top belongs to
  // the element's OWN bbox - checked there, not against the union (first draft of this
  // pin wrongly compared b.y to the text top).
  const tb = bboxOfElement(text(500, 300, 'hello'));
  assert.equal(tb.y, 300 - TEXT_ASCENT_RATIO * 24, 'text top = first baseline minus cap height');
  assert.equal(b.x + b.w, 500 + ts.w, 'right edge = text right edge');
  assert.equal(b.y + b.h, 300 + TEXT_DESCENT_RATIO * 24, 'bottom edge = last baseline + descender room');
  assert.equal(b.y + b.h, 310.8);   // pinned literal: catches a silent baseline change
});

test('X1b unionBBox returns null for empty / non-array input (never NaN box)', async () => {
  const { unionBBox } = await mod();
  assert.equal(unionBBox([]), null);
  assert.equal(unionBBox(null), null);
  assert.equal(unionBBox(undefined), null);
  assert.equal(unionBBox('nope'), null);
  assert.equal(unionBBox([null, undefined, { type: 'bogus' }]), null, 'garbage-only list is empty');
});

// ------------------------------------------------------------------- X2 margin
test('X2 exportBounds pads ALL FOUR sides (the point of the ticket)', async () => {
  const { exportBounds } = await mod();
  const m = 40;
  const b = exportBounds([rect(100, 100, 200, 50)], m);
  assert.equal(b.x, 100 - m, 'left padded');
  assert.equal(b.y, 100 - m, 'top padded');
  assert.equal(b.w, 200 + 2 * m, 'width grew by TWO margins');
  assert.equal(b.h, 50 + 2 * m, 'height grew by TWO margins');
  assert.ok(b.x + b.w > 300, 'right edge beyond content');
  assert.ok(b.y + b.h > 150, 'bottom edge beyond content');
});

test('X2b default margin is positive and applied when omitted', async () => {
  const { exportBounds, EXPORT_MARGIN_WORLD } = await mod();
  assert.ok(Number.isFinite(EXPORT_MARGIN_WORLD) && EXPORT_MARGIN_WORLD > 0, 'named default margin exported');
  const b = exportBounds([rect(0, 0, 10, 10)]);
  assert.equal(b.x, -EXPORT_MARGIN_WORLD);
  assert.equal(b.w, 10 + 2 * EXPORT_MARGIN_WORLD);
});

test('X3 negative coordinates get correct padded bounds', async () => {
  const { exportBounds } = await mod();
  const b = exportBounds([rect(-500, -400, 100, 100)], 40);
  assert.equal(b.x, -540);
  assert.equal(b.y, -440);
  assert.equal(b.w, 180);
  assert.equal(b.h, 180);
});

// ---------------------------------------------------------- X4 buildSvgDocument
test('X4 buildSvgDocument: valid standalone svg, viewBox == exportBounds, deterministic', async () => {
  const { buildSvgDocument, exportBounds } = await mod();
  const els = [rect(0, 0, 100, 50), text(10, 30, 'hi'), arrow({ x: 0, y: 0 }, { x: 50, y: 50 })];
  const svg = buildSvgDocument(els, { margin: 40 });
  assert.equal(typeof svg, 'string');
  assert.ok(svg.startsWith('<svg'), 'starts with <svg');
  assert.match(svg, /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/, 'svg namespace declared');
  assert.ok(svg.trimEnd().endsWith('</svg>'), 'closed root');
  const b = exportBounds(els, 40);
  const vb = /viewBox="([^"]+)"/.exec(svg);
  assert.ok(vb, 'has viewBox');
  assert.deepEqual(vb[1].split(/\s+/).map(Number), [b.x, b.y, b.w, b.h], 'viewBox matches exportBounds exactly');
  for (const el of els) assert.ok(svg.includes('data-id="' + el.id + '"'), 'element ' + el.id + ' present');
  assert.equal(buildSvgDocument(els, { margin: 40 }), svg, 'byte-stable across calls');
});

test('X4b exported markup comes from render.js (single source of truth)', async () => {
  const { buildSvgDocument } = await mod();
  const { elementToSvg } = await import('../src/render.js');
  const els = [rect(1, 2, 30, 40), ellipse(5, 5, 20, 20), pathEl([{ x: 0, y: 0 }, { x: 9, y: 9 }])];
  const svg = buildSvgDocument(els, { margin: 0 });
  for (const el of els) {
    const frag = elementToSvg(el);
    assert.ok(frag && svg.includes(frag), el.type + ' markup identical to render.js output');
  }
});

// ----------------------------------------------------------------------- X5 XSS
test('X5 hostile text/fill is escaped; no live script survives in the export', async () => {
  const { buildSvgDocument } = await mod();
  const hostile = '</svg><scr' + 'ipt>alert("pwned")</scr' + 'ipt>';
  const els = [
    text(0, 0, hostile),
    Object.assign({}, rect(0, 0, 10, 10), { style: { fill: '" on' + 'load="alert(1)', stroke: '<img src=x on' + 'error=alert(1)>' } }),
  ];
  const svg = buildSvgDocument(els, { margin: 10 });
  assert.ok(!/<scr\s*ipt/i.test(svg), 'no raw script tag');
  assert.ok(!/on[a-z]+="/i.test(svg), 'no raw event handler attribute');
  assert.ok(/&lt;|&quot;|&#39;/.test(svg), 'payload appears escaped');
  const opens = (svg.match(/<svg/g) || []).length;
  const closes = (svg.match(/<\/svg>/g) || []).length;
  assert.equal(opens, closes, 'tag balance preserved (no premature breakout)');
  assert.equal(opens, 1, 'exactly one root svg');
});

// --------------------------------------------------------------------- X6 empty
test('X6 buildSvgDocument([]) is a valid empty svg, never crash / empty string', async () => {
  const { buildSvgDocument } = await mod();
  const svg = buildSvgDocument([], { margin: 40 });
  assert.ok(svg.length > 10, 'non-trivial output');
  assert.ok(svg.startsWith('<svg') && svg.trimEnd().endsWith('</svg>'));
  const vb = /viewBox="([^"]+)"/.exec(svg);
  assert.ok(vb, 'still has a viewBox (fallback box, not 0 0 0 0)');
  const parts = vb[1].split(/\s+/).map(Number);
  assert.ok(parts[2] > 0 && parts[3] > 0, 'empty canvas does not produce a zero-area export');
  assert.equal(buildSvgDocument(null, { margin: 40 }), svg, 'null tolerated like []');
});

// ---------------------------------------------------------------- X7 pngPixelSize
test('X7 pngPixelSize: proportional, integral, clamped, degenerate-safe', async () => {
  const { pngPixelSize, MAX_EXPORT_SIDE } = await mod();
  assert.ok(Number.isFinite(MAX_EXPORT_SIDE) && MAX_EXPORT_SIDE <= 8192, 'side cap <= 8192');
  const s = pngPixelSize({ x: 0, y: 0, w: 100, h: 50 }, 2);
  assert.equal(s.width, 200);
  assert.equal(s.height, 100);
  assert.ok(Number.isInteger(s.width) && Number.isInteger(s.height), 'integers for canvas sizing');

  const big = pngPixelSize({ x: 0, y: 0, w: 100000, h: 25000 }, 4);
  assert.ok(big.width <= MAX_EXPORT_SIDE, 'huge width clamped, got ' + big.width);
  assert.ok(big.height <= MAX_EXPORT_SIDE, 'huge height clamped, got ' + big.height);
  assert.ok(big.width >= 1 && big.height >= 1, 'never zero');
  assert.ok(Math.abs(big.width / big.height - 4) < 0.05, 'aspect ratio preserved under clamp');

  for (const bad of [{ x: 0, y: 0, w: 0, h: 0 }, { x: 0, y: 0, w: NaN, h: NaN }, null, undefined]) {
    const d = pngPixelSize(bad, 1);
    assert.ok(Number.isFinite(d.width) && Number.isFinite(d.height) && d.width >= 1 && d.height >= 1,
      'degenerate bbox yields a usable size, got ' + JSON.stringify(d));
  }
});

// ---------------------------------------------------------------------- X8 filename
test('X8 sanitizeFilename strips traversal/separators/control chars, never empty', async () => {
  const { sanitizeFilename } = await mod();
  const cases = ['../../etc/passwd', 'a/b\\c', 'dr:w^aw', 'x\ny', 'x\ty', '..', '  ', undefined, null, 42];
  for (const c of cases) {
    const out = sanitizeFilename(c);
    assert.equal(typeof out, 'string', 'returns string for ' + String(c));
    assert.ok(out.length > 0, 'not empty for ' + String(c));
    assert.ok(!out.includes('/'), 'no slash for ' + String(c));
    assert.ok(!out.includes('\\'), 'no backslash for ' + String(c));
    assert.ok(!out.includes('..'), 'no traversal for ' + String(c));
    assert.ok(!out.includes(':'), 'no colon for ' + String(c));
    assert.ok(!/[\x00-\x1f]/.test(out), 'no control chars for ' + String(c));
  }
});

test('X8b buildDownloadName produces a safe .svg/.png name and rejects other formats', async () => {
  const { buildDownloadName } = await mod();
  const svgName = buildDownloadName({ base: 'my/board:../x', format: 'svg' });
  assert.ok(svgName.endsWith('.svg'), svgName);
  const pngName = buildDownloadName({ base: 'doc', format: 'png' });
  assert.ok(pngName.endsWith('.png'), pngName);
  assert.throws(() => buildDownloadName({ base: 'doc', format: 'exe' }), /format/i, 'unknown format rejected');
});
