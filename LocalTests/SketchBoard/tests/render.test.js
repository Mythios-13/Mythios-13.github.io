// TESTER: SVG markup generation + injection safety
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { elementToSvg, sceneToSvg, escapeXml, selectionOverlaySvg } from '../src/render.js';
import { Store } from '../src/store.js';

test('escapeXml neutralizes every breakout vector', () => {
  const evil = `<img src=x onerror="alert(1)">"&'`;
  const esc = escapeXml(evil);
  for (const bad of ['<', '>', '"', "'"]) assert.ok(!esc.includes(bad), `${bad} survived escaping`);
  assert.ok(esc.includes('&amp;'));
});

test('text element with hostile content renders fully escaped', () => {
  const svg = elementToSvg({ type: 'text', id: 'a"b', x: 0, y: 0, text: '</text><script>alert(1)</script>', style: {} });
  assert.ok(!svg.includes('<script>'), 'raw script tag leaked into markup!');
  assert.ok(svg.includes('&lt;script&gt;'));
});

test('style colors are escaped too (attr breakout via color field)', () => {
  const svg = elementToSvg({ type: 'rect', id: 'r', x: 0, y: 0, w: 1, h: 1, style: { fill: 'red" onload="evil()' } });
  // Correct assertion: NO raw double-quote may survive inside the markup (LEAD ruling:
  // previous version un-escaped &quot; before testing, which rebuilt the payload itself).
  // Real security property: the payload's quotes are escaped, so 'onload' can only
  // exist as inert TEXT inside the quoted fill attribute — never as a new attribute.
  assert.ok(!svg.includes('" onload='), 'attribute breakout blocked');
  assert.ok(svg.includes('fill="red&quot; onload=&quot;evil()"'), 'payload inert inside quoted attr');
});

test('rect/ellipse/polygon/path/text each emit their tag', () => {
  const cases = [
    [{ type: 'rect', id: '1', x: 0, y: 0, w: 10, h: 5, style: {} }, /^<rect /],
    [{ type: 'ellipse', id: '1', x: 0, y: 0, w: 10, h: 5, style: {} }, /^<ellipse /],
    [{ type: 'star', id: '1', x: 0, y: 0, w: 10, h: 10, style: {} }, /^<polygon /],
    [{ type: 'path', id: '1', points: [{ x: 0, y: 0 }, { x: 5, y: 5 }], style: {} }, /^<path /],
    [{ type: 'text', id: '1', x: 0, y: 0, text: 'x', style: {} }, /^<text /],
  ];
  for (const [el, re] of cases) assert.match(elementToSvg(el), re);
});

test('arrow emits shaft + triangular head; head disabled removes polygon', () => {
  const el = { type: 'arrow', id: 'a', from: { x: 0, y: 0 }, to: { x: 50, y: 0 }, style: { stroke: '#000', endArrowhead: true } };
  const on = elementToSvg(el);
  assert.ok(on.includes('<line') && on.includes('<polygon'));
  const off = elementToSvg({ ...el, style: { ...el.style, endArrowhead: false } });
  assert.ok(!off.includes('<polygon'));
});

test('dash styles map to stroke-dasharray, solid does not', () => {
  const base = { type: 'rect', id: '1', x: 0, y: 0, w: 9, h: 9, style: { strokeWidth: 2 } };
  assert.ok(!elementToSvg(base).includes('stroke-dasharray'));
  assert.ok(elementToSvg({ ...base, style: { ...base.style, dash: 'dashed' } }).includes('stroke-dasharray="8 4"'));
});

test('fillEnabled=false renders fill="none"', () => {
  const svg = elementToSvg({ type: 'rect', id: '1', x: 0, y: 0, w: 9, h: 9, style: { fillEnabled: false } });
  assert.ok(svg.includes('fill="none"'));
});

test('multiline text becomes tspans with line advance', () => {
  const svg = elementToSvg({ type: 'text', id: '1', x: 5, y: 20, text: 'a\nb\nc', style: { fontSize: 20 } });
  assert.equal((svg.match(/<tspan/g) || []).length, 3);
  assert.ok(svg.includes('dy="25"'));
});

test('NaN geometry cannot produce NaN in markup (renders 0 instead)', () => {
  const svg = elementToSvg({ type: 'rect', id: '1', x: NaN, y: 0, w: Infinity, h: 5, style: {} });
  assert.ok(!svg.includes('NaN') && !svg.includes('Infinity'));
});

test('sceneToSvg paints bottom-to-top and skips garbage silently', () => {
  const s = new Store();
  const a = s.createElement('rect', { x: 0, y: 0, w: 5, h: 5 }); s.addElement(a);
  const b = s.createElement('text', { x: 0, y: 0, text: 'hi' }); s.addElement(b);
  const out = sceneToSvg([...s.elements, null, undefined, { nope: true }]);
  assert.ok(out.indexOf('<rect') < out.indexOf('<text'), 'paint order preserved');
});

test('selection overlay keeps constant SCREEN size across zoom levels', () => {
  const el = { type: 'rect', id: 'z', x: 0, y: 0, w: 100, h: 50 };
  const near = selectionOverlaySvg([el], 1);
  const far = selectionOverlaySvg([el], 0.1); // zoomed out 10x
  // REVIEWER FIX (S4): the old greedy [^>]* stepped PAST the real width= attribute and
  // captured stroke-width instead — the test asserted the wrong field and survived only
  // because stroke-width also scales as 1/scale. Lazy quantifier + \b pins REAL width.
  const attrW = (markup) => parseFloat(/class="sel-handle"[^>]*?\bwidth="([\d.]+)"/.exec(markup)[1]);
  const attrSW = (markup) => parseFloat(/class="sel-handle"[^>]*?\bstroke-width="([\d.]+)"/.exec(markup)[1]);
  const wNear = attrW(near), wFar = attrW(far);
  assert.ok(wNear !== attrSW(near), 'guard: width capture must not be stroke-width again');
  assert.equal(wNear, 6, 'handle is 6 css px at scale 1');
  assert.equal(wFar, 60, 'handle grows in world units as we zoom out');
  assert.ok(wFar > wNear * 5, 'handles grow in world units as we zoom out => constant on screen');
});
