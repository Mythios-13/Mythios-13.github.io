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
import { STORAGE_KEY, loadSavedDoc, inspectSavedDoc, inspectDocString, isProtectedStatus, isResetRequested, createAutosave, DEFAULT_DEBOUNCE_MS } from './persistence.js';

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
// Upper bound on waiting for the raster Image to settle (T8/H-B). Generous enough for
// slow machines, short enough that the user is never left staring at nothing.
const PNG_RASTER_TIMEOUT_MS = 10000;

/**
 * @param {Element} root
 * @param {object} [deps] injectable environment, so the shell is testable headless:
 *   { storage, hash, download, ImageCtor, createCanvas, CanvasCtor, debounceMs }
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
  // F7: double-click the status bar -> zoom to exactly 100%, anchored at the window
  // centre (the world point you are looking at stays put). Assigning scale = 1 outright
  // instead of zoomAt(c, c, 1/scale) avoids float dust when scale is already ~1.
  hud.title = 'Double-click to reset zoom to 100%';
  hud.addEventListener('dblclick', () => {
    if (viewport.scale === 1) { toast('Already at 100% zoom'); return; }   // idempotent, no churn
    const W = root.clientWidth || 1280, H = root.clientHeight || 800;
    const centreWorldBefore = viewport.screenToWorld({ x: W / 2, y: H / 2 });
    viewport.scale = 1;
    viewport.x = W / 2 - centreWorldBefore.x;      // re-anchor: centre point stays centred
    viewport.y = H / 2 - centreWorldBefore.y;
    render();                                      // refresh overlay + status line first...
    toast('Zoom reset to 100%');                   // ...THEN toast: render() rewrites hud text
  });
  const panel = el('div', 'props-panel'); panel.hidden = true;
  root.append(svg, toolbar, topbar, hud, panel);

  // ---------- burger menu (T7) ----------
  // Built with DOM APIs + textContent ONLY. No innerHTML here: the app.test.js
  // whitelist permits innerHTML solely for render.js output on <svg> nodes.
  const burger = el('button', 'burger', '\u2630');
  burger.title = 'Menu';
  const menu = el('div', 'menu open');            // stakeholder: "auto open"
  const MENU_ACTIONS = [
    ['save-disk', 'Save to disk'],      // F6: writes the localStorage envelope to a .json
    ['open-disk', 'Open from disk'],    // F6: reads one back, validated before applying
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

  // MAJOR-4: while a payload we cannot represent sits under our key, the board is
  // READ-ONLY and the HUD carries a PINNED explanation. Pinning matters: render()
  // rewrites the HUD every frame, an unpinned toast would be clobbered instantly.
  let readOnly = false;
  let pinnedMsg = null;
  function toast(msg) { if (!pinnedMsg) hud.textContent = msg; }
  function pinMessage(msg) { pinnedMsg = msg; hud.textContent = msg; }

  function runMenuAction(action) {
    switch (action) {
      case 'export-svg': return doExportSvg();
      case 'export-png': return doExportPng();
      case 'go-center': return doGoCenter();
      case 'clear': return doClearCanvas();
      case 'save-disk': return doSaveDisk();
      case 'open-disk': return doOpenDisk();
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
      if (typeof env.ImageCtor !== 'function' || typeof env.createCanvas !== 'function') {
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
      // T8/H-B: if the Image never fires onload OR onerror (malformed SVG data URLs do
      // this in Firefox/Safari), a bare promise hangs forever and the user sees NO
      // feedback at all -- indistinguishable from a dead button. So we race a watchdog.
      let settled = false;
      let watchdog = null;
      const done = (fn) => (arg) => {
        if (settled) return;
        settled = true;
        if (watchdog !== null) clearTimeout(watchdog);
        fn(arg);
      };
      const resolveOnce = done(resolve);
      const rejectOnce = done(reject);
      const timeoutMs = Number.isFinite(env.pngRasterTimeoutMs) && env.pngRasterTimeoutMs > 0
        ? env.pngRasterTimeoutMs : PNG_RASTER_TIMEOUT_MS;
      watchdog = setTimeout(() => rejectOnce(new Error('timed out rasterizing the image')), timeoutMs);

      const img = new env.ImageCtor();
      img.onload = () => {
        try {
          // T8/BLOCKING-1: never `new window.HTMLCanvasElement()` — that is an illegal
          // constructor in every real browser. The factory owns the resolution order.
          const canvas = env.createCanvas();
          if (!canvas || typeof canvas.getContext !== 'function') {
            throw new Error('canvas unavailable');
          }
          canvas.width = width; canvas.height = height;   // set dims BEFORE touching ctx
          const ctx = canvas.getContext('2d');
          if (!ctx || typeof ctx.drawImage !== 'function') {
            throw new Error('2d context unavailable');
          }
          // T8/BLOCKING-2: PNG has no alpha page behind it — an unfilled canvas reads as
          // black in most viewers. Opaque white first, artwork second.
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(img, 0, 0, width, height);
          if (typeof canvas.toBlob === 'function') {
            canvas.toBlob((blob) => {
              // T8/H-A: browsers call this callback with NULL when encoding fails.
              // Downloading null while toasting "PNG exported" is a silent-success lie.
              if (!blob) { rejectOnce(new Error('canvas produced no image data')); return; }
              try {
                env.download(buildDownloadName({ base: docTitle(), format: 'png' }), blob, 'image/png');
                resolveOnce(blob);
              } catch (e) { rejectOnce(e); }
            }, 'image/png');
          } else {
            const url = canvas.toDataURL();                       // may throw (tainted canvas)
            if (typeof url !== 'string' || !url) {
              rejectOnce(new Error('canvas produced no image data'));
              return;
            }
            env.download(buildDownloadName({ base: docTitle(), format: 'png' }), url, 'image/png');
            resolveOnce(null);
          }
        } catch (e) { rejectOnce(e); }
      };
      img.onerror = () => rejectOnce(new Error('could not rasterize the SVG'));
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

  // ---------- F6: save / load the DOCUMENT to/from disk ----------
  // The file format IS the localStorage envelope (client decision): store.toJSON()
  // bytes, validated on the way in by inspectDocString - the SAME brain that guards
  // the storage door (MAJOR-4). One contract, two doors.
  function doSaveDisk() {
    try {
      const text = JSON.stringify(store.toJSON());                       // single source of truth
      const name = buildDownloadName({ base: docTitle(), format: 'json' });
      Promise.resolve(env.saveFile(name, text, 'application/json;charset=utf-8'))
        .then(() => toast(`Saved ${name} (${store.elements.length} objects)`))
        .catch((e) => toast(`Save failed: ${e && e.message ? e.message : e}`));   // never reject at click site (F6-8)
    } catch (e) {
      toast(`Save failed: ${e && e.message ? e.message : e}`);
    }
  }

  async function doOpenDisk() {
    let picked = null;
    try {
      picked = await env.openFile();                                     // null = user cancelled (F6-6)
    } catch (e) {
      toast(`Could not open file: ${e && e.message ? e.message : e}`);
      return;
    }
    if (!picked || typeof picked.text !== 'string') return;              // cancel: silent no-op
    const verdict = inspectDocString(picked.text);                       // validate BEFORE touching anything
    if (verdict.status !== 'ok') {
      toast(`Cannot open ${picked.name || 'file'}: ${diskRefusalReason(verdict)}`);
      return;                                                            // board/storage untouched (F6-4)
    }
    const prevSnapshot = store.snapshot();                               // capture BEFORE mutating...
    try {
      store.fromJSON(JSON.parse(picked.text));                           // ...fromJSON clears history itself,
      store.pushState(prevSnapshot);                                     // so the undo point is pushed AFTER (D-F6-2)
    } catch (e) {
      toast(`Cannot open ${picked.name || 'file'}: damaged despite validation (${e && e.message ? e.message : e})`);
      return;
    }
    if (readOnly) {                                                      // D-F6-1: a good file heals the lock
      readOnly = false;
      pinnedMsg = null;
    }
    closeTextEditor();
    closePanel();
    render();
    toast(`Opened ${picked.name || 'file'} (${store.elements.length} objects)`);
  }

  /** Why a FILE was refused, in user words. Same family as readOnlyReason (MAJOR-4). */
  function diskRefusalReason(verdict) {
    switch (verdict.status) {
      case 'malformed': return 'not valid SketchBoard JSON';
      case 'foreign': return `belongs to another app (${verdict.reason})`;
      case 'newer-version': return `saved by a newer version (${verdict.reason})`;
      case 'bad-version': return `invalid version (${verdict.reason})`;
      case 'older-version': return `uses an old schema (${verdict.reason}) this build cannot migrate yet`;
      case 'bad-element': return `contains unknown element type "${verdict.reason}"`;
      default: return 'cannot be understood';
    }
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
    hud.textContent = pinnedMsg || `${store.elements.length} objects · zoom ${(viewport.scale * 100).toFixed(0)}% · ${tools.tool}`;
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
    canWrite: () => !readOnly,   // MAJOR-4: never rewrite a save this build cannot read back
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
    get readOnly() { return readOnly; },
    exportSvgString: () => buildSvgDocument(store.elements) };

  // ---------- boot state: #reset > saved doc > welcome seed (R5) ----------
  // MAJOR-4: ONE verdict drives everything. Only 'none' (nothing stored) may ever be
  // seeded over. Every other non-ok status LOCKS the board read-only instead of
  // falling through to seed(): the old fall-through let autosave bury the user's
  // real document (e.g. written by a newer build) under demo shapes. Silent data loss.
  // NOTE: the verdict is computed EVEN UNDER #reset — an ephemeral empty canvas is
  // fine, but letting the user draw on top of a payload we cannot read back would
  // reintroduce the exact clobber this ticket exists to prevent.
  const verdict = inspectSavedDoc(env.storage, STORAGE_KEY);
  if (isProtectedStatus(verdict.status)) {
    readOnly = true;
    pinMessage(readOnlyReason(verdict));
  }
  if (isResetRequested(env.hash)) {
    // EPHEMERAL by design: empty canvas for THIS load only. Storage is deliberately
    // NOT wiped, so a user who previews #reset and reloads gets their work back.
    toast('Empty canvas (#reset) \u2014 your saved board is untouched');
  } else if (verdict.status === 'none') {
    seed(api);                                    // first run only
  } else if (verdict.status === 'ok') {
    const saved = loadSavedDoc(env.storage, STORAGE_KEY);
    if (saved) {
      try { store.fromJSON(saved); }
      catch (e) {
        // inspect said loadable yet load failed -> trust neither; protect the bytes.
        readOnly = true;
        pinMessage('Saved board could not be opened \u2014 left untouched (read-only) to protect your work');
      }
    }
  }
  render();
  return api;
}

/** Human sentence per refusal class (MAJOR-4). Names the WHY; users deserve it. */
function readOnlyReason(verdict) {
  switch (verdict.status) {
    case 'newer-version':
      return 'This board was saved by a NEWER version of SketchBoard \u2014 it stays read-only so your work is safe.';
    case 'foreign':
      return 'Saved data belongs to another app \u2014 left untouched (read-only).';
    case 'malformed':
      return 'Saved data is damaged and cannot be understood \u2014 left untouched (read-only).';
    case 'bad-version':
      return 'Saved data has an invalid version \u2014 left untouched (read-only).';
    case 'bad-element':
      return `Saved data contains an unknown element (${verdict.reason}) \u2014 left untouched (read-only).`;
    case 'older-version':
      return 'Saved data uses an old schema this build cannot migrate yet \u2014 left untouched (read-only).';
    default:
      return 'Saved data cannot be opened \u2014 left untouched (read-only).';
  }
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
    // Legacy escape hatch kept alive for existing callers/tests (T8 P3).
    CanvasCtor: 'CanvasCtor' in deps ? deps.CanvasCtor : undefined,
    createCanvas: resolveCanvasFactory(deps),
    debounceMs: 'debounceMs' in deps ? deps.debounceMs : DEFAULT_DEBOUNCE_MS,
    pngRasterTimeoutMs: 'pngRasterTimeoutMs' in deps ? deps.pngRasterTimeoutMs : PNG_RASTER_TIMEOUT_MS,
    download: typeof deps.download === 'function' ? deps.download : browserDownload,
    // F6 seams: same injectability rule as download/createCanvas — tests inject fakes,
    // production resolves lazily against browser APIs.
    saveFile: typeof deps.saveFile === 'function' ? deps.saveFile : browserSaveFile,
    openFile: typeof deps.openFile === 'function' ? deps.openFile : browserOpenFile,
  };
}

/** F6 default sink: Blob + <a download>. Mirrors browserDownload but kept separate —
 *  download() takes a mime/body contract for exports; saveFile is the document door. */
function browserSaveFile(name, text, mime) {
  if (typeof document === 'undefined') throw new Error('no DOM available to save');
  const blob = typeof Blob !== 'undefined' ? new Blob([text], { type: mime }) : null;
  const a = document.createElement('a');
  a.href = blob ? URL.createObjectURL(blob)
                : 'data:' + mime + ';charset=utf-8,' + encodeURIComponent(text);
  a.download = name;
  document.body && document.body.appendChild(a);
  a.click();
  a.remove();
  if (blob && typeof URL.revokeObjectURL === 'function') setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/** F6 default picker: File System Access API when present, else hidden <input type=file>.
 *  Resolves {name, text} or null on cancel. Never throws synchronously. */
function browserOpenFile() {
  if (typeof window !== 'undefined' && typeof window.showOpenFilePicker === 'function') {
    return window.showOpenFilePicker({
      types: [{ description: 'SketchBoard document', accept: { 'application/json': ['.json'] } }],
    }).then(async (handles) => {
      const [handle] = handles;
      const file = await handle.getFile();
      return { name: file.name, text: await file.text() };
    }, () => null);                                                     // AbortError -> cancel -> null
  }
  return new Promise((resolve, reject) => {
    if (typeof document === 'undefined') { reject(new Error('no DOM available to pick a file')); return; }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.style.display = 'none';
    let settled = false;
    input.addEventListener('cancel', () => { if (!settled) { settled = true; input.remove(); resolve(null); } });
    input.addEventListener('change', () => {
      if (settled) return;
      settled = true;
      const file = input.files && input.files[0];
      input.remove();
      if (!file) { resolve(null); return; }
      const done = (text) => resolve({ name: file.name, text });
      if (typeof file.text === 'function') { file.text().then(done, (e) => reject(e)); }
      else if (typeof FileReader !== 'undefined') {
        const fr = new FileReader();
        fr.onload = () => done(String(fr.result));
        fr.onerror = () => reject(fr.error || new Error('read failed'));
        fr.readAsText(file);
      } else reject(new Error('no file reader available'));
    });
    document.body && document.body.appendChild(input);
    input.click();
  });
}

/**
 * How we obtain a canvas element. Resolution order (T8/BLOCKING-1):
 *   1. deps.createCanvas  — explicit factory, the contract tests use
 *   2. deps.CanvasCtor    — legacy constructor, back-compat for injected fakes
 *   3. document.createElement('canvas') — THE ONLY legal way in a real browser
 * `window.HTMLCanvasElement` is deliberately NOT a candidate: constructing it throws.
 */
function resolveCanvasFactory(deps) {
  if (typeof deps.createCanvas === 'function') return deps.createCanvas;
  if (typeof deps.CanvasCtor === 'function') {
    const Ctor = deps.CanvasCtor;
    return () => new Ctor();
  }
  if (typeof document !== 'undefined' && document && typeof document.createElement === 'function') {
    return () => document.createElement('canvas');
  }
  return null;
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
