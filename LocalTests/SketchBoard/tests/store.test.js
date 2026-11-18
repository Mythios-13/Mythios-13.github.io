// TESTER: store — CRUD, history, selection integrity, serialization
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store, ELEMENT_TYPES } from '../src/store.js';

test('createElement covers every required type', () => {
  const s = new Store();
  for (const t of ELEMENT_TYPES) {
    const el = s.createElement(t, {}, {});
    assert.equal(el.type, t);
    assert.ok(el.id && el.style, `${t} needs id+style`);
  }
});

test('createElement rejects unknown type', () => {
  assert.throws(() => new Store().createElement('hexagon'), /Unknown element type/);
});

test('undo/redo roundtrip restores state exactly', () => {
  const s = new Store();
  const a = s.createElement('rect', { x: 1, y: 2, w: 3, h: 4 });
  s.pushState(s.snapshot()); s.addElement(a);
  const b = s.createElement('text', { x: 0, y: 0, text: 'hi' });
  s.pushState(s.snapshot()); s.addElement(b);
  assert.equal(s.elements.length, 2);
  s.undo(); assert.equal(s.elements.length, 1);
  s.undo(); assert.equal(s.elements.length, 0);
  s.redo(); s.redo();
  assert.equal(s.elements.length, 2);
  assert.equal(s.elements[1].text, 'hi');
});

test('history capped at 100 snapshots', () => {
  const s = new Store();
  for (let i = 0; i < 150; i++) { s.pushState(s.snapshot()); }
  let n = 0; while (s.undo()) n++;
  assert.equal(n, 100);
});

test('selection never references deleted ids', () => {
  const s = new Store();
  const a = s.createElement('rect', {}); s.addElement(a);
  s.select([a.id]);
  s.deleteElements([a.id]);
  assert.equal(s.selected.size, 0);
  // also via undo path
  s.undo();
  s.select([a.id]);
  s.deleteElements([a.id]);
  assert.equal(s.selected.has(a.id), false);
});

test('select() ignores unknown ids even additive', () => {
  const s = new Store();
  s.select(['ghost', 'phantom'], { additive: true });
  assert.equal(s.selected.size, 0);
});

test('toggleSelect toggles and ignores ghosts', () => {
  const s = new Store();
  const a = s.createElement('rect', {}); s.addElement(a);
  s.toggleSelect(a.id); assert.equal(s.selected.size, 1);
  s.toggleSelect(a.id); assert.equal(s.selected.size, 0);
  s.toggleSelect('nope'); assert.equal(s.selected.size, 0);
});

test('translateElements moves shapes, lines AND freehand points', () => {
  const s = new Store();
  const r = s.createElement('rect', { x: 0, y: 0, w: 5, h: 5 });
  const l = s.createElement('line', { from: { x: 0, y: 0 }, to: { x: 1, y: 1 } });
  const p = s.createElement('path', { points: [{ x: 0, y: 0 }, { x: 2, y: 2 }] });
  [r, l, p].forEach((e) => s.addElement(e));
  s.translateElements([r.id, l.id, p.id], 10, -5);
  assert.equal(r.x, 10); assert.equal(r.y, -5);
  assert.equal(l.to.x, 11); assert.equal(l.to.y, -4);
  assert.equal(p.points[1].x, 12); assert.equal(p.points[1].y, -3);
});

test('z-order ops reorder correctly', () => {
  const s = new Store();
  const a = s.createElement('rect', {}), b = s.createElement('rect', {}), c = s.createElement('rect', {});
  [a, b, c].forEach((e) => s.addElement(e));
  s.sendToBack(c.id); assert.equal(s.elements[0].id, c.id);
  s.bringToFront(c.id); assert.equal(s.elements[2].id, c.id);
  s.lower(c.id); assert.equal(s.elements[1].id, c.id);
});

test('duplicate clones with offset, new ids, selected', () => {
  const s = new Store();
  const a = s.createElement('rect', { x: 0, y: 0, w: 10, h: 10 });
  s.addElement(a);
  const clones = s.duplicateElements([a.id]);
  assert.equal(clones.length, 1);
  assert.notEqual(clones[0].id, a.id);
  assert.equal(clones[0].x, 16);
  assert.deepEqual([...s.selected], [clones[0].id]);
  // deep clone check: moving clone must not touch original
  s.translateElements([clones[0].id], 100, 0);
  assert.equal(a.x, 0);
});

test('fromJSON validates and resumes id sequence', () => {
  const s = new Store();
  s.fromJSON({ elements: [{ id: 'el_42', type: 'rect', x: 0, y: 0, w: 1, h: 1, style: {} }] });
  const next = s.createElement('rect', {});
  assert.notEqual(next.id, 'el_42');
  assert.throws(() => s.fromJSON({ elements: [{ type: 'blob' }] }), /bad element type/);
  assert.throws(() => s.fromJSON({}), /missing elements/);
});

test('onChange listeners fire and unsubscribe works', () => {
  const s = new Store();
  let n = 0;
  const off = s.onChange(() => n++);
  s.addElement(s.createElement('rect', {}));
  assert.equal(n, 1);
  off();
  s.addElement(s.createElement('rect', {}));
  assert.equal(n, 1);
});
