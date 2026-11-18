// app.js — THIN DOM glue. All logic lives in pure modules; this file only wires
// events -> ToolManager/Store/Viewport and re-renders from model state.
// SECURITY RULE (enforced by tester): user data NEVER interpolates into innerHTML.
// innerHTML is allowed ONLY for output of render.js (which escapes) on <svg> nodes.

import { Store } from './store.js';
import { Viewport } from './viewport.js';
import { ToolManager, TOOLS, ZOOM_FACTOR } from './tools.js';
import { sceneToSvg, selectionOverlaySvg, gridMarkup, elementToSvg } from './render.js';
import { STYLE_PRESETS, DEFAULT_STYLE, FONT_FAMILIES } from './styles.js';
import { buildSvgDocument, buildDownloadName, pngPixelSize, exportBounds } from './export.js';
import { STORAGE_KEY, loadSavedDoc, isResetRequested, createAutosave, DEFAULT_DEBOUNCE_MS } from './persistence.js';

export const SHORTCUT_TOOLS = { v: 'select', h: 'hand', r: 'rect', o: 'ellipse', l: 'line', a: 'arrow', p: 'path', t: 'text' };
export const TRIANGLE_SHORTCUT = 'y';
// NOTE (tester T4): 'd' is RESERVED for Ctrl+D duplicate — never a bare tool key.
export const EXTRA_TOOL_SHORTCUTS = { j: 'diamond', k: 'star' };

/** Wheel -> zoom factor. ctrlKey = trackpad pinch. deltaMode 1 = lines. */
export function wheelFactor(deltaY, deltaMode, ctrlKey) {
  const unit = deltaMode === 1 ? 40 : 1;
  const intensity = ctrlKey ? 2.5 : 1;
  return Math.pow(ZOOM_FACTOR, -deltaY * unit * intensity);
}

/** True when focus is in a field — global shortcuts must not steal keys. */
export function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * @param {Element} root
 * @param {object} [deps] injectable environment, so the shell is testable headless:
 *   { storage, hash, download, ImageCtor, CanvasCtor, debounceMs }
 * Defaults resolve lazily against window/document, so boot(root) keeps working under
 * Node exactly as it did before T7 (all pre-existing suites depend on it).
 */
export function boot(root, deps = {}) {
  const env = resolveEnv(deps);
  const store = new Store();
  const viewport = new Viewport(0, 0, 1);
  const size = () => ({ width: root.clientWidth || 1280, height: root.clientHeight || 800 });
  const tools = new ToolManager(store, viewport, { getSize: size });

  // ---------- skeleton ----------
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'board');
  const gGrid = document.createElementNS(SVG_NS, 'g');
  const gScene = document.createElementNS(SVG_NS, 'g');
  gScene.setAttribute('transform-origin', '0 0');
  const gOverlay = document.createElementNS(SVG_NS, 'g');
  svg.append(gGrid, gScene, gOverlay);

  const toolbar = el('div', 'toolbar');
  for (const [label, tool] of [['⬚','select'],['✋','hand'],['▭','rect'],['◯','ellipse'],['△','triangle'],['◇','diamond'],['★','star'],['╱','line'],['➔','arrow'],['✎','path'],['T','text']]) {
    const b = el('button', 'tool-btn'); b.textContent = label; b.dataset.tool = tool;
    b.title = tool; b.addEventListener('click', () => setTool(tool));
    toolbar.appendChild(b);
  }

  const topbar = el('div', 'topbar');
  const mkInput = (type, title) => { const i = document.createElement('input'); i.type = type; i.title = title; i.className = 'style-input'; return i; };
  const fillIn = mkInput('color', 'Fill color'); fillIn.value = DEFAULT_STYLE.fill;
  const fillOn = mkInput('checkbox', 'Fill enabled'); fillOn.checked = true;
  const strokeIn = mkInput('color', 'Stroke color'); strokeIn.value = DEFAULT_STYLE.stroke;
  const strokeOn = mkInput('checkbox', 'Stroke enabled'); strokeOn.checked = true;
  const widthIn = mkInput('range', 'Stroke width'); widthIn.min = '0'; widthIn.max = '40'; widthIn.value = '2';
  const opacityIn = mkInput('range', 'Opacity'); opacityIn.min = '0'; opacityIn.max = '1'; opacityIn.step = '0.05'; opacityIn.value = '1';
  const dashSel = document.createElement('select'); dashSel.className = 'style-input'; dashSel.title = 'Dash';
  for (const d of ['solid', 'dashed', 'dotted']) { const o = document.createElement('option'); o.value = d; o.textContent = d; dashSel.appendChild(o); }
  const radiusIn = mkInput('number', 'Corner radius (rect)'); radiusIn.min = '0'; radiusIn.max = '200'; radiusIn.value = '0';
  const fontSel = document.createElement('select'); fontSel.className = 'style-input'; fontSel.title = 'Font';
  for (const f of FONT_FAMILIES) { const o = document.createElement('option'); o.value = f; o.textContent = f.split(',')[0].replace(/"/g, ''); fontSel.appendChild(o); }
  const fsIn = mkInput('number', 'Font size'); fsIn.min = '6'; fsIn.max = '400'; fsIn.value = String(DEFAULT_STYLE.fontSize);
  const presetSel = document.createElement('select'); presetSel.className = 'style-input'; presetSel.title = 'Style preset';
  const noneOpt = document.createElement('option'); noneOpt.value = ''; noneOpt.textContent = 'presets…'; presetSel.appendChild(noneOpt);
  for (const p of Object.keys(STYLE_PRESETS)) { const o = document.createElement('option'); o.value = p; o.textContent = p; presetSel.appendChild(o); }
  topbar.append(fillOn, fillIn, strokeOn, strokeIn, widthIn, opacityIn, dashSel, radiusIn, fontSel, fsIn, presetSel);

  const hud = el('div', 'hud');
  const panel = el('div', 'props-panel'); panel.hidden = true;
  root.append(svg, toolbar, topbar, hud, panel);

  // ---------- burger menu (T7) ----------
  // Built with DOM APIs + textContent ONLY. No innerHTML here: the app.test.js
  // whitelist permits innerHTML solely for render.js output on <svg> nodes.
  const burger = el('button', 'burger', '\u2630');
  burger.title = 'Menu';
  const menu = el('div', 'menu open');            // stakeholder: "auto open"
  const MENU_ACTIONS = [
    ['export-png', 'Save as PNG'],
    ['export-svg', 'Save as SVG'],
    ['go-center', 'Go to center'],
    ['clear', 'Clear canvas'],
  ];
  for (const [action, label] of MENU_ACTIONS) {
    const b = el('button', 'menu-item', label);
    b.dataset.action = action;
    b.addEventListener('click', () => runMenuAction(action));
    menu.appendChild(b);
  }
  burger.addEventListener('click', () => menu.classList.toggle('open', !menu.classList.contains('open')));
  root.append(burger, menu);

  function toast(msg) { hud.textContent = msg; }

  function runMenuAction(action) {
    switch (action) {
      case 'export-svg': return doExportSvg();
      case 'export-png': return doExportPng();
      case 'go-center': return doGoCenter();
      case 'clear': return doClearCanvas();
      default: return undefined;
    }
  }

  function docTitle() { return 'sketchboard'; }

  function doExportSvg() {
    try {
      const body = buildSvgDocument(store.elements);
      env.download(buildDownloadName({ base: docTitle(), format: 'svg' }), body, 'image/svg+xml;charset=utf-8');
      toast(`SVG exported (${store.elements.length} objects)`);
    } catch (e) { toast('SVG export failed: ' + e.message); }
  }

  function doExportPng() {
    // PNG derives FROM the SVG document, so the two formats can never disagree (R2).
    try {
      const svgBody = buildSvgDocument(store.elements);
      const bbox = exportBounds(store.elements);
      const scale = Math.max(1, viewport.scale);
      const { width, height } = pngPixelSize(bbox, scale);
      if (typeof env.ImageCtor !== 'function' || typeof env.CanvasCtor !== 'function') {
        toast('PNG export needs a browser canvas (no Image/canvas available)');
        return;
      }
      rasterizePng({ svgBody, width, height }).then(
        () => toast(`PNG exported (${width}\u00d7${height})`),
        (e) => toast('PNG export failed: ' + (e && e.message))
      );
    } catch (e) { toast('PNG export failed: ' + e.message); }
  }

  /** Glue only: SVG -> data URL -> Image -> canvas -> blob -> download. Never throws sync. */
  function rasterizePng({ svgBody, width, height }) {
    return new Promise((resolve, reject) => {
      const img = new env.ImageCtor();
      img.onload = () => {
        try {
          const canvas = new env.CanvasCtor();
          canvas.width = width; canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          if (typeof canvas.toBlob === 'function') {
            canvas.toBlob((blob) => {
              try {
                env.download(buildDownloadName({ base: docTitle(), format: 'png' }), blob, 'image/png');
                resolve(blob);
              } catch (e) { reject(e); }
            }, 'image/png');
          } else {
            env.download(buildDownloadName({ base: docTitle(), format: 'png' }), canvas.toDataURL(), 'image/png');
            resolve(null);
          }
        } catch (e) { reject(e); }
      };
      img.onerror = () => reject(new Error('could not rasterize the SVG'));
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgBody);
    });
  }

  function doGoCenter() {
    viewport.x = 0; viewport.y = 0;                 // scale PRESERVED (stakeholder wording)
    render();
    toast('Recentred');
  }

  function doClearCanvas() {
    // pushState BEFORE mutating -> one Ctrl+Z brings everything back, so no confirm()
    // dialog is needed (and a blocking modal would be untestable here anyway).
    store.pushState(store.snapshot());
    store.elements = [];
    store.clearSelection();
    panel.hidden = true;
    closeTextEditor();
    autosave.flush();
    render();
    toast('Canvas cleared (Ctrl+Z to undo)');
  }

  // ---------- rendering ----------
  let preview = null; // transient drag preview descriptor
  function render() {
    const { width, height } = size();
    svg.setAttribute('width', width); svg.setAttribute('height', height);
    gGrid.innerHTML = gridMarkup(viewport, width, height);          // SAFE: generated coords
    // CAMERA INVARIANT (T5): scene content, selection chrome and drag previews are
    // ALL authored in WORLD coordinates, so every world-space layer must carry the
    // identical camera transform. Derive it ONCE and assign to both groups — two
    // separate literals here is exactly how the overlay drifted out of place.
    const cameraTransform = `translate(${viewport.x} ${viewport.y}) scale(${viewport.scale})`;
    gScene.setAttribute('transform', cameraTransform);
    gOverlay.setAttribute('transform', cameraTransform);
    gScene.innerHTML = sceneToSvg(store.elements);                   // SAFE: render.js escapes all user data
    gOverlay.innerHTML = selectionOverlaySvg(store.selectedElements(), viewport.scale) + previewMarkup();
    hud.textContent = `${store.elements.length} objects · zoom ${(viewport.scale * 100).toFixed(0)}% · ${tools.tool}`;
    syncToolbar();
    if (editingId) positionTextEditor();                             // T5-A6: editor tracks camera
  }
  function previewMarkup() {
    if (!preview) return '';
    // T6: shapes are previewed by RENDERING A REAL MODEL ELEMENT through the same
    // renderer as the committed scene (render.elementToSvg). There is deliberately
    // no second copy of the geometry maths here - that duplication is what made
    // every drag tool paint a generic bounding box, and made the freehand ghost a
    // polyline while the commit was a smoothed bezier.
    if (preview.kind === 'shape' && preview.el) {
      return `<g class="preview" opacity="0.85">${elementToSvg(preview.el)}</g>`;
    }
    if (preview.kind === 'freehand' && preview.points && preview.points.length > 1) {
      const d = 'M ' + preview.points.map((p) => `${p.x} ${p.y}`).join(' L ');
      return `<path class="preview" d="${d}" fill="none" stroke="#2563eb" stroke-width="${2 / viewport.scale}"/>`;
    }
    if (preview.kind === 'text' && preview.at) {
      const a = preview.at, c = 1 / viewport.scale;                 // world-space caret, constant on screen
      return `<line class="preview" x1="${a.x}" y1="${a.y - 12 * c}" x2="${a.x}" y2="${a.y + 12 * c}" stroke="#2563eb" stroke-width="${2 * c}"/>`
        + `<circle class="preview" cx="${a.x}" cy="${a.y}" r="${3 * c}" fill="none" stroke="#2563eb" stroke-width="${1.5 * c}"/>`;
    }
    // Marquee is a selection AFFORDANCE, not a shape: it must stay a plain dashed
    // rect and must never be routed through the shape renderer (T6-6 guard).
    if (preview.kind === 'marquee' && preview.rect) {
      const r = preview.rect;
      return `<rect class="marquee" x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="rgba(37,99,235,.06)" stroke="#2563eb" stroke-dasharray="${4 / viewport.scale} ${3 / viewport.scale}"/>`;
    }
    return '';
  }
  /** Build the provisional model element for a drag-create preview (T6). */
  function shapePreviewElement(shapeType, rect) {
    if (!rect) return null;
    if (shapeType === 'line' || shapeType === 'arrow') {
      return store.createElement(shapeType, { from: { ...rect.from }, to: { ...rect.to } });
    }
    const n = normalizeForPreview(rect);
    if (!(n.w > 0) || !(n.h > 0)) return null;
    return store.createElement(shapeType, { x: n.x, y: n.y, w: n.w, h: n.h });
  }
  const normalizeForPreview = (r) => ({
    x: Math.min(r.x, r.x + r.w), y: Math.min(r.y, r.y + r.h), w: Math.abs(r.w), h: Math.abs(r.h),
  });

  function syncToolbar() {
    for (const b of toolbar.querySelectorAll('.tool-btn')) b.classList.toggle('active', b.dataset.tool === tools.tool);
  }
  function setTool(t) { tools.setTool(t); closePanel(); closeTextEditor(); render(); }

  store.onChange(render);

  // ---------- pointer plumbing ----------
  const toScreen = (e) => { const r = svg.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  svg.addEventListener('contextmenu', (e) => { e.preventDefault(); openPanel(e); });
  svg.addEventListener('mousedown', (e) => {
    if (e.button === 1) e.preventDefault(); // kill autoscroll
    if (e.button === 2) return;             // right click = properties only
    const res = tools.pointerDown({ button: e.button, shiftKey: e.shiftKey, ...toScreen(e) });
    handle(res);
  });
  window.addEventListener('mousemove', (e) => {
    const res = tools.pointerMove(toScreen(e));
    if (res.type === 'preview-create') {
      const el = shapePreviewElement(res.shapeType, res.rect);
      preview = el ? { kind: 'shape', el } : null;
    }
    else if (res.type === 'preview-path' && res.points && res.points.length > 1) {
      // Same renderer => same pointsToSmoothPath bezier as the commit (T6-2).
      const el = store.createElement('path', { points: res.points.map((p) => ({ ...p })), x: 0, y: 0 });
      preview = { kind: 'shape', el };
    }
    else if (res.type === 'preview-marquee' && res.rect) preview = { kind: 'marquee', rect: res.rect };
    else if (res.type === 'preview-text') preview = { kind: 'text', at: res.world };
    if (res.cursor) svg.style.cursor = res.cursor;
    handle(res);
  });
  window.addEventListener('mouseup', (e) => {
    preview = null;
    const res = tools.pointerUp(toScreen(e));
    if (res.type === 'edit-text') startTextEditor(res.id);
    handle(res);
  });
  svg.addEventListener('dblclick', (e) => {
    const hit = tools.pick(viewport.screenToWorld(toScreen(e)));
    if (hit && hit.type === 'text') startTextEditor(hit.id);
  });
  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    tools.wheel({ ...toScreen(e), factor: wheelFactor(e.deltaY, e.deltaMode, e.ctrlKey) });
    render();
  }, { passive: false });

  function handle(res) { if (res && res.type !== 'none' && res.type !== 'ignored') render(); }

  // ---------- keyboard ----------
  window.addEventListener('keydown', (e) => {
    if (isTypingTarget(document.activeElement)) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); if (store.undo()) render(); return; }
    if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); if (store.redo()) render(); return; }
    if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); if (store.selected.size) { store.pushState(store.snapshot()); store.duplicateElements([...store.selected]); } return; }
    if (mod) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (store.selected.size) { store.pushState(store.snapshot()); store.deleteElements([...store.selected]); }
      return;
    }
    if (e.key === 'Escape') { store.clearSelection(); closePanel(); closeTextEditor(); render(); return; }
    if (e.key === ' ') { const r = tools.keydown({ key: ' ', repeat: e.repeat }); handle(r); if (r.type === 'cursor') svg.style.cursor = r.cursor; return; }
    const k = e.key.toLowerCase();
    const tool = SHORTCUT_TOOLS[k] || EXTRA_TOOL_SHORTCUTS[k];
    if (tool) setTool(tool);
  });
  window.addEventListener('keyup', (e) => { const r = tools.keyup({ key: e.key }); handle(r); });

  // ---------- style bar bindings ----------
  // T6: style bar targets the SELECTION when there is one, and PENDING STYLE when
  // there is none - so choosing a colour then drawing a shape keeps that colour
  // (previously the empty-selection case silently discarded the user's choice).
  const applyStyle = (patch) => {
    if (store.selected.size) { store.pushState(store.snapshot()); for (const id of store.selected) store.updateStyle(id, patch); }
    else store.setPendingStyle(patch);
    render();
  };
  const eachSelected = (fn) => { if (!store.selected.size) return; store.pushState(store.snapshot()); for (const id of store.selected) fn(id); render(); };
  fillIn.addEventListener('change', () => applyStyle({ fill: fillIn.value, fillEnabled: true }));
  fillOn.addEventListener('change', () => applyStyle({ fillEnabled: fillOn.checked }));
  strokeIn.addEventListener('change', () => applyStyle({ stroke: strokeIn.value, strokeEnabled: true }));
  strokeOn.addEventListener('change', () => applyStyle({ strokeEnabled: strokeOn.checked }));
  widthIn.addEventListener('change', () => applyStyle({ strokeWidth: Number(widthIn.value) }));
  opacityIn.addEventListener('change', () => applyStyle({ opacity: Number(opacityIn.value) }));
  dashSel.addEventListener('change', () => applyStyle({ dash: dashSel.value }));
  radiusIn.addEventListener('change', () => applyStyle({ radius: Number(radiusIn.value) }));
  fontSel.addEventListener('change', () => applyStyle({ fontFamily: fontSel.value }));
  fsIn.addEventListener('change', () => applyStyle({ fontSize: Number(fsIn.value) }));
  presetSel.addEventListener('change', () => {
    if (!presetSel.value) return;
    // T6: presets follow the same rule - onto the selection, or into pending style.
    applyStyle({ ...STYLE_PRESETS[presetSel.value] });
    presetSel.value = '';
  });

  // ---------- right-click properties panel ----------
  function openPanel(e) {
    const world = viewport.screenToWorld(toScreen(e));
    const hit = tools.pick(world);
    if (hit && !store.selected.has(hit.id)) store.select([hit.id]);
    if (!store.selected.size) { closePanel(); return; }
    panel.innerHTML = ''; // SAFE: cleared, then built exclusively via DOM APIs + textContent
    const ids = [...store.selected];
    const first = store.get(ids[0]);
    const rows = [];
    const addRow = (label, control) => { const row = el('div', 'prop-row'); const l = el('label', 'prop-label'); l.textContent = label; row.append(l, control); rows.push(row); };
    const btn = (label, cls, fn) => { const b = el('button', 'prop-btn' + (cls ? ' ' + cls : '')); b.textContent = label; b.addEventListener('click', fn); return b; };
    const numField = (key, min, max, step) => {
      const i = document.createElement('input'); i.type = 'number'; i.className = 'prop-input';
      i.min = min; i.max = max; i.step = step ?? '1'; i.value = String(first.style[key] ?? '');
      i.addEventListener('change', () => eachSelected((id) => store.updateStyle(id, { [key]: Number(i.value) })));
      return i;
    };
    addRow('fill', colorCtl('fill', first));
    addRow('stroke', colorCtl('stroke', first));
    addRow('width', numField('strokeWidth', 0, 100));
    addRow('opacity', numField('opacity', 0, 1, 0.05));
    addRow('radius', numField('radius', 0, 500));
    addRow('font size', numField('fontSize', 4, 400));
    const grid = el('div', 'prop-grid');
    grid.append(
      btn('front', '', () => { store.bringToFront(ids[0]); render(); }),
      btn('back', '', () => { store.sendToBack(ids[0]); render(); }),
      btn('raise', '', () => { store.raise(ids[0]); render(); }),
      btn('lower', '', () => { store.lower(ids[0]); render(); }),
      btn('duplicate', '', () => { store.pushState(store.snapshot()); store.duplicateElements(ids); render(); }),
      btn('delete', 'danger', () => { store.pushState(store.snapshot()); store.deleteElements(ids); closePanel(); render(); }),
    );
    panel.append(el('div', 'prop-title', `${ids.length} selected · ${first.type}`), ...rows, grid);
    panel.style.left = `${Math.min(e.clientX, window.innerWidth - 260)}px`;
    panel.style.top = `${Math.min(e.clientY, window.innerHeight - 320)}px`;
    panel.hidden = false;
  }
  // FIX (tester T4 e2e): colorCtl lives outside openPanel's scope — take the model
  // element as a parameter instead of leaking the panel-local `first` binding.
  function colorCtl(key, model) {
    const wrap = el('span', 'prop-color');
    const c = document.createElement('input'); c.type = 'color'; c.value = /^#[0-9a-f]{6}$/i.test(model.style[key]) ? model.style[key] : '#000000';
    c.addEventListener('change', () => eachSelected((id) => store.updateStyle(id, { [key]: c.value })));
    wrap.appendChild(c); return wrap;
  }
  function closePanel() { panel.hidden = true; }
  window.addEventListener('mousedown', (e) => { if (!panel.hidden && !panel.contains(e.target)) closePanel(); });

  // ---------- inline text editor ----------
  let editor = null, editingId = null, editSnapshot = null;
  function startTextEditor(id) {
    closeTextEditor();
    const elem = store.get(id);
    if (!elem || elem.type !== 'text') return;
    editingId = id;
    editSnapshot = store.snapshot();
    editor = document.createElement('textarea');
    editor.className = 'text-editor';
    editor.value = elem.text; // SAFE: value assignment, no HTML interpolation
    positionTextEditor();
    const commit = () => {
      if (!editingId) return;
      const cur = store.get(editingId);
      if (cur && cur.text !== editor.value) { store.pushState(editSnapshot); cur.text = editor.value; }
      closeTextEditor(); render();
    };
    editor.addEventListener('blur', commit);
    editor.addEventListener('keydown', (ev) => {
      ev.stopPropagation(); // don't trigger global shortcuts while typing
      if (ev.key === 'Escape') { closeTextEditor(); render(); }
      if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); commit(); }
    });
    root.appendChild(editor);
    editor.focus(); editor.select();
  }
  // T5-A6: keep the editor glued to its text node across pan/zoom. Called from
  // render() whenever editingId is set, so the camera can never leave it behind.
  function positionTextEditor() {
    if (!editor || !editingId) return;
    const elem = store.get(editingId);
    if (!elem) return;
    const st = elem.style;
    const sp = viewport.worldToScreen({ x: elem.x, y: elem.y });
    Object.assign(editor.style, {
      left: `${sp.x}px`, top: `${sp.y - (st.fontSize ?? 24) * viewport.scale}px`,
      fontSize: `${(st.fontSize ?? 24) * viewport.scale}px`,
      fontFamily: st.fontFamily || 'sans-serif',
      minWidth: '120px',
    });
  }
  function closeTextEditor() { if (editor) { editor.remove(); editor = null; editingId = null; } }

  // ---------- autosave (T7) ----------
  const autosave = createAutosave({
    store,
    storage: env.storage,
    key: STORAGE_KEY,
    debounceMs: env.debounceMs,
    setTimeout: (fn, ms) => (typeof setTimeout === 'function' ? setTimeout(fn, ms) : fn()),
    clearTimeout: (t) => { if (typeof clearTimeout === 'function') clearTimeout(t); },
  });
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    // A refresh inside the debounce window must lose nothing: flush synchronously on exit.
    window.addEventListener('visibilitychange', () => { if (typeof document === 'undefined' || document.visibilityState !== 'visible') autosave.flush(); });
    window.addEventListener('beforeunload', () => autosave.flush());
  }

  // ---------- public surface (tests / console) ----------
  // Declared AFTER autosave: it closes over it, and a `const` here above would be a
  // temporal-dead-zone crash at boot.
  const api = { store, viewport, tools, render, setTool, startTextEditor, wheelFactor,
    autosave, flushAutosave: () => autosave.flush(), runMenuAction,
    exportSvgString: () => buildSvgDocument(store.elements) };

  // ---------- boot state: #reset > saved doc > welcome seed (R5) ----------
  if (isResetRequested(env.hash)) {
    // EPHEMERAL by design: empty canvas for THIS load only. Storage is deliberately
    // NOT wiped, so a user who previews #reset and reloads gets their work back.
    toast('Empty canvas (#reset) \u2014 your saved board is untouched');
  } else {
    const saved = loadSavedDoc(env.storage, STORAGE_KEY);
    if (saved && saved.elements.length >= 0 && Array.isArray(saved.elements)) {
      try { store.fromJSON(saved); }
      catch (e) { seed(api); toast('Saved board unreadable \u2014 started fresh'); }
    } else {
      seed(api);                                    // first run only
    }
  }
  render();
  return api;
}

function seed(api) {
  const { store } = api;
  const mk = (t, p, s) => { const e = store.createElement(t, p, s); store.addElement(e); return e; };
  mk('rect', { x: 60, y: 60, w: 420, h: 120 }, { fill: '#eef4ff', stroke: '#2563eb', strokeWidth: 2, radius: 14 });
  const t1 = store.createElement('text', { x: 90, y: 110, text: 'SketchBoard — infinite vector canvas' }, { fill: '#0f172a', fontSize: 30, fontWeight: '700', fillEnabled: true, strokeEnabled: false });
  store.addElement(t1);
  mk('text', { x: 90, y: 145, text: 'drag shapes from the left · middle-click pans · wheel zooms · right-click for properties' }, { fill: '#475569', fontSize: 16, strokeEnabled: false });
  mk('arrow', { from: { x: 500, y: 120 }, to: { x: 620, y: 120 } }, { stroke: '#2563eb', strokeWidth: 3, endArrowhead: true });
  mk('star', { x: 640, y: 60, w: 90, h: 90 }, { fill: '#f59e0b', stroke: '#92400e', strokeWidth: 2 });
}

/** Environment resolution: real browser globals by default, injectable in tests. */
function resolveEnv(deps) {
  const hasWindow = typeof window !== 'undefined';
  let defaultStorage = null;
  try { defaultStorage = hasWindow && window.localStorage ? window.localStorage : null; } catch (e) { defaultStorage = null; }
  return {
    storage: 'storage' in deps ? deps.storage : defaultStorage,
    hash: 'hash' in deps ? deps.hash : (hasWindow && window.location ? window.location.hash : ''),
    ImageCtor: 'ImageCtor' in deps ? deps.ImageCtor : (hasWindow ? window.Image : undefined),
    CanvasCtor: 'CanvasCtor' in deps ? deps.CanvasCtor : (hasWindow ? window.HTMLCanvasElement : undefined),
    debounceMs: 'debounceMs' in deps ? deps.debounceMs : DEFAULT_DEBOUNCE_MS,
    download: typeof deps.download === 'function' ? deps.download : browserDownload,
  };
}

/** Default download sink: anchor + object URL. Guarded so it can never break the app. */
function browserDownload(name, body, mime) {
  if (typeof document === 'undefined') throw new Error('no DOM available to download');
  const a = document.createElement('a');
  a.href = typeof Blob !== 'undefined' && body instanceof Blob
    ? URL.createObjectURL(body)
    : 'data:' + (mime || 'application/octet-stream') + ';charset=utf-8,' + encodeURIComponent(String(body));
  a.download = name;
  document.body && document.body.appendChild(a);
  a.click();
  a.remove();
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text; // SAFE: textContent only
  return n;
}

if (typeof window !== 'undefined' && typeof document !== 'undefined' && document.getElementById('app')) {
  window.sketchboard = boot(document.getElementById('app'));
}
