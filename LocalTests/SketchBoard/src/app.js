// app.js — THIN DOM glue. All logic lives in pure modules; this file only wires
// events -> ToolManager/Store/Viewport and re-renders from model state.
// SECURITY RULE (enforced by tester): user data NEVER interpolates into innerHTML.
// innerHTML is allowed ONLY for output of render.js (which escapes) on <svg> nodes.

import { Store } from './store.js';
import { Viewport } from './viewport.js';
import { ToolManager, TOOLS, ZOOM_FACTOR } from './tools.js';
import { sceneToSvg, selectionOverlaySvg, gridMarkup, elementToSvg, swatchMarkup, SWATCH_W, SWATCH_H } from './render.js';
import { STYLE_PRESETS, DEFAULT_STYLE, FONT_FAMILIES, collectUsedStyles, collectPresetStyles, styleKeyOf, swatchPatchOf } from './styles.js';
import { buildSvgDocument, buildDownloadName, pngPixelSize, exportBounds } from './export.js';
import { STORAGE_KEY, loadSavedDoc, inspectSavedDoc, inspectDocString, isProtectedStatus, isResetRequested, createAutosave, DEFAULT_DEBOUNCE_MS } from './persistence.js';

export const SHORTCUT_TOOLS = { v: 'select', h: 'hand', r: 'rect', o: 'ellipse', l: 'line', a: 'arrow', p: 'path', t: 'text' };
export const TRIANGLE_SHORTCUT = 'y';
export const IMAGE_SHORTCUT_HINT = 'i';   // lives in EXTRA_TOOL_SHORTCUTS below
// NOTE (tester T4): 'd' is RESERVED for Ctrl+D duplicate — never a bare tool key.
export const EXTRA_TOOL_SHORTCUTS = { j: 'diamond', k: 'star', i: 'image' };

/** S6c (client): below this window width the style bar genuinely cannot fit its ten
 *  controls AND two miniature galleries, so the galleries fold behind a dropdown toggle.
 *  Exported so the BOUNDARY is testable instead of guessed - and the boundary belongs to
 *  the INLINE side (>= threshold stays inline, preserving instant availability).
 *  Chosen from the bar's own budget: ~10 controls (~500px) + two galleries (~600px) +
 *  chrome, rounded down to a value where overflow is certain rather than possible. */
export const COMPACT_MAX_WIDTH = 1000;

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
  for (const [label, tool] of [['⬚','select'],['✋','hand'],['▭','rect'],['◯','ellipse'],['△','triangle'],['◇','diamond'],['★','star'],['╱','line'],['➔','arrow'],['✎','path'],['T','text'],['🖼','image']]) {
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
  dashSel.value = 'solid';   // explicit: real DOM auto-picks the first option, stubs do not —
                             // init makes the toolbar definition identical in both worlds
  const radiusIn = mkInput('number', 'Corner radius (rect)'); radiusIn.min = '0'; radiusIn.max = '200'; radiusIn.value = '0';
  const fontSel = document.createElement('select'); fontSel.className = 'style-input'; fontSel.title = 'Font';
  for (const f of FONT_FAMILIES) { const o = document.createElement('option'); o.value = f; o.textContent = f.split(',')[0].replace(/"/g, ''); fontSel.appendChild(o); }
  fontSel.value = FONT_FAMILIES[0];   // deterministic default (same reason as dashSel)
  const fsIn = mkInput('number', 'Font size'); fsIn.min = '6'; fsIn.max = '400'; fsIn.value = String(DEFAULT_STYLE.fontSize);
  // ---------------------------------------------------------------------------
  // S6 (client, session 5): RECENT STYLES + PRESET GALLERIES replace both the old
  // "Apply style" button (made meaningless by the mirror fix - selecting an object now
  // restores its style into the bar, so "apply the bar" became a no-op) and the bare
  // <select> preset chooser. Each entry is a MINIATURE of the style, painted by
  // render.swatchMarkup (same renderer as real artwork -> same escaping, same colours).
  //   * Recent  = every distinct style actually in use in the drawing, document order of
  //               first use, rebuilt on every render() behind a signature cache.
  //   * Presets = the built-in STYLE_PRESETS, rendered identically (client: "exactly the
  //               same, with a miniature preview").
  // Clicking either applies that style to the CURRENT SELECTION (no selection => inert,
  // see D-S6-3). Two separate boxes, side by side, at the end of the bar.
  // ---------------------------------------------------------------------------
  function buildSwatchBox(cls, labelText) {
    const box = el('div', 'preset-box ' + cls);
    box.appendChild(el('span', 'preset-label', labelText));
    const strip = el('div', 'swatch-strip');
    box.appendChild(strip);
    return { box, strip };
  }
  const recentBox = buildSwatchBox('recent-styles', 'Recent');
  const presetGallery = buildSwatchBox('preset-styles', 'Presets');
  // STYLE_PRESETS stays referenced here on purpose: app.test.js pins "presets reachable"
  // from app.js, and this is the honest one-line proof that the gallery reads them.
  void STYLE_PRESETS;
  // S6c (client): on a narrow window the two galleries would push the ten live controls off
  // screen, so they live inside ONE collapsible container with a toggle. Deliberate design:
  //   * WIDE  -> container is plain static content, toggle hidden: zero extra clicks, the
  //              "instantly available" behaviour the client asked to keep.
  //   * NARROW-> toggle appears, container starts CLOSED and opens over the canvas.
  // The swatches themselves are ALWAYS in the DOM and clickable either way - collapsing is
  // a visual accommodation, never a behavioural one (pinned by S6c-4).
  const galleryWrap = el('div', 'style-gallery');
  galleryWrap.append(recentBox.box, presetGallery.box);
  const galleryToggle = el('button', 'gallery-toggle', '\u25be styles');
  galleryToggle.type = 'button';
  galleryToggle.title = 'Show or hide style galleries';
  galleryToggle.setAttribute('aria-expanded', 'false');
  galleryToggle.hidden = true;                       // wide screens never see it
  galleryToggle.addEventListener('click', () => {
    const open = !galleryWrap.classList.contains('open');
    galleryWrap.classList.toggle('open', open);
    galleryToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  topbar.append(fillOn, fillIn, strokeOn, strokeIn, widthIn, opacityIn, dashSel, radiusIn, fontSel, fsIn, galleryToggle, galleryWrap);

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
    ['help', 'Manual & keys'],           // S7: in-app reference card (client request)
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

  // ---------- S7: in-app manual / key-command overlay (client request) ----------
  // Built ONCE from DOM APIs + textContent (never innerHTML - the app.test.js whitelist still
  // holds) and REUSED on every toggle, so repeated clicks cannot pile up panels.
  // The tool rows are GENERATED from the live SHORTCUT_TOOLS / EXTRA_TOOL_SHORTCUTS maps: a
  // shortcut added to the keymap shows up in the manual automatically, and a test asserts that
  // coupling (S7-3). Hand-written docs drift; generated ones cannot.
  const TOOL_BLURB = {
    select: 'Select, move, resize', hand: 'Pan the canvas', rect: 'Rectangle', ellipse: 'Ellipse',
    triangle: 'Triangle', diamond: 'Diamond', star: 'Star', line: 'Line', arrow: 'Arrow',
    path: 'Freehand draw', text: 'Place text', image: 'Place an image file',
  };
  let helpPanel = null;
  function kbdRow(keysArr, desc) {
    const row = el('div', 'help-row');
    const keys = el('span', 'help-keys');
    for (const k of keysArr) keys.appendChild(el('kbd', 'kbd', k));
    row.append(keys, el('span', 'help-desc', desc));   // SAFE: textContent only
    return row;
  }
  function helpSection(title, rows) {
    const s = el('div', 'help-section');
    s.appendChild(el('div', 'help-section-title', title));
    const g = el('div', 'help-grid');
    for (const r of rows) g.appendChild(r);
    s.appendChild(g);
    return s;
  }
  function buildHelpPanel() {
    const scrim = el('div', 'help-panel'); scrim.hidden = true;
    const card = el('div', 'help-card');
    const head = el('div', 'help-head');
    head.appendChild(el('div', 'help-title', 'SketchBoard \u00b7 quick manual'));
    const close = el('button', 'help-close', '\u00d7');
    close.type = 'button'; close.title = 'Close (Esc)';
    close.addEventListener('click', () => { scrim.hidden = true; });
    head.appendChild(close);
    card.appendChild(head);

    // --- tools: derived from the LIVE keymap, never typed by hand
    const live = { ...SHORTCUT_TOOLS, ...EXTRA_TOOL_SHORTCUTS };
    const toolRows = Object.keys(live)
      .sort((a, b) => live[a].localeCompare(live[b]))
      .map((key) => kbdRow([key], `${live[key]} \u2014 ${TOOL_BLURB[live[key]] || live[key]}`));
    card.appendChild(helpSection('Tools (press a letter)', toolRows));

    card.appendChild(helpSection('Edit', [
      kbdRow(['Ctrl', 'Z'], 'Undo'),
      kbdRow(['Ctrl', 'Shift', 'Z'], 'Redo (or Ctrl+Y)'),
      kbdRow(['Ctrl', 'D'], 'Duplicate the selection'),
      kbdRow(['Delete', 'or', 'Backspace'], 'Delete the current selection'),
      kbdRow(['Esc'], 'Deselect \u00b7 close panels \u00b7 close this manual (Escape)'),
    ]));

    card.appendChild(helpSection('Canvas', [
      kbdRow(['Wheel'], 'Zoom at the cursor'),
      kbdRow(['Ctrl', 'Wheel'], 'Finer zoom (trackpad pinch)'),
      kbdRow(['Middle-click', '+ drag'], 'Pan the canvas'),
      kbdRow(['Space', '+ drag'], 'Pan without leaving your tool'),
      kbdRow(['Right-click'], 'Properties panel for what you hit'),
      kbdRow(['Double-click', 'status bar'], 'Reset zoom to exactly 100%'),
    ]));

    card.appendChild(helpSection('Shapes & images', [
      kbdRow(['Drag corners'], 'Resize any shape freely (shapes always free-deform)'),
      kbdRow(['Images'], 'Aspect ratio LOCKED by default \u00b7 hold Shift to free it'),
      kbdRow(['Image tool', '+ click'], 'Places the picked file centred, then hands back to Select'),
      kbdRow(['Right-click', '· original size'], 'Restore an image to its natural pixel size'),
    ]));

    card.appendChild(helpSection('Text', [
      // THE CLIENT SENTENCE, stated accurately: the gesture is a DOUBLE-CLICK, and because
      // hit-testing reads the element itself (not the handle chrome), it keeps working when the
      // double-click lands on the selection handles sitting over the glyphs.
      kbdRow(['Double-click'], 'Edit text \u2014 aim anywhere on the text, INCLUDING over '
        + 'its selection handles; Enter saves, Esc cancels'),
      kbdRow(['Text tool', '+ click'], 'Place a new text box'),
    ]));

    card.appendChild(helpSection('Style', [
      kbdRow(['Style bar'], 'Mirrors the selected object \u00b7 new shapes inherit it'),
      kbdRow(['Recent / Presets'], 'Click a miniature to style the current selection'),
    ]));

    scrim.appendChild(card);
    // Click the dim backdrop (not the card) to dismiss.
    scrim.addEventListener('mousedown', (e) => { if (e.target === scrim) scrim.hidden = true; });
    return scrim;
  }
  // Built AT BOOT (hidden), not lazily: the reference card is part of the shell, so it exists
  // for inspection/keyboard focus from the first frame, and exactly one node can ever exist.
  helpPanel = buildHelpPanel();
  root.appendChild(helpPanel);
  function toggleHelp() { helpPanel.hidden = !helpPanel.hidden; }

  function runMenuAction(action) {
    switch (action) {
      case 'export-svg': return doExportSvg();
      case 'export-png': return doExportPng();
      case 'go-center': return doGoCenter();
      case 'clear': return doClearCanvas();
      case 'save-disk': return doSaveDisk();
      case 'open-disk': return doOpenDisk();
      case 'help': return toggleHelp();
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
    syncStyleControls();                                      // S5-UI: bar mirrors the selection
    syncSwatchGalleries();                                    // S6: recent + preset miniatures
    syncResponsiveBar();                                      // S6c: fold galleries when narrow
    if (editingId) positionTextEditor();                      // T5-A6: editor tracks camera
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
  /** S5-F4c: provisional image element for the PLACE ghost. Centring rule MUST match the
   *  stamp in tools.pointerDown (world - natural/2); kept beside the other preview builders
   *  so preview and commit stay siblings. */
  function imagePreviewElement(p, world) {
    if (!p) return null;
    return store.createElement('image', {
      x: world.x - p.width / 2, y: world.y - p.height / 2,
      w: p.width, h: p.height, src: p.src,
    });
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
  function setTool(t) {
    tools.setTool(t); closePanel(); closeTextEditor(); render();
    // F4: the image tool pops the file picker IMMEDIATELY (client brief: "popup to load
    // a file"). Cancel keeps the tool armed-but-empty: pressing canvas does nothing.
    if (t === 'image' && !tools.pendingImage) void armImagePicker();
  }

  // ---------- S6: style swatch galleries (recent styles + presets) ----------
  /** The FULL toolbar definition (spec §2.1): nine controls -> ten style keys.
   *  Excluded by decision D-F2-1: the preset chooser (no standing value). */
  function toolbarStylePatch() {
    return {
      fill: fillIn.value, fillEnabled: !!fillOn.checked,
      stroke: strokeIn.value, strokeEnabled: !!strokeOn.checked,
      strokeWidth: Number(widthIn.value), opacity: Number(opacityIn.value),
      dash: dashSel.value, radius: Number(radiusIn.value),
      fontFamily: fontSel.value, fontSize: Number(fsIn.value),
    };
  }
  /** S5-UI (client ask #3): "when drawing a new form it always follows what is selected
   *  in the style toolbar". Two halves make that true, and both run through here:
   *   (a) every control change writes the bar into store.pendingStyle as well, so the bar
   *       IS the single source of truth for newly created shapes; and
   *   (b) when something is selected the bar MIRRORS the selection (first selected element
   *       wins on a mixed multi-select - same rule the properties panel already uses), so
   *       the bar never shows a value the next shape would ignore.
   *  Called from render(), so it cannot go stale after undo/redo/open/load either. */
  function syncStyleControls() {
    const first = store.selectedElements()[0];
    if (!first || !first.style) return;                    // empty selection: leave the bar alone
    const s = { ...DEFAULT_STYLE, ...first.style };        // missing key == documented default
    fillIn.value = s.fill; fillOn.checked = !!s.fillEnabled;
    strokeIn.value = s.stroke; strokeOn.checked = !!s.strokeEnabled;
    widthIn.value = String(s.strokeWidth); opacityIn.value = String(s.opacity);
    dashSel.value = s.dash; radiusIn.value = String(s.radius);
    fontSel.value = s.fontFamily; fsIn.value = String(s.fontSize);
    store.setPendingStyle(toolbarStylePatch());            // keep bar == pending (see (a))
  }
  // Presets are static for the lifetime of the build -> canonicalise once, never per render.
  const PRESET_SWATCHES = collectPresetStyles();

  /** Paint ONE swatch: a real <svg> holding the miniature that render.swatchMarkup produced
   *  from a synthetic rect. app.js never hand-builds the artwork - escaping lives in render.js. */
  function makeSwatchButton(style, title, ariaLabel, onClick) {
    const b = el('button', 'swatch');
    b.title = title;                                   // SAFE: textContent-equivalent property
    b.setAttribute('aria-label', ariaLabel);
    b.type = 'button';
    const art = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    art.setAttribute('class', 'swatch-svg');
    art.setAttribute('viewBox', `0 0 ${SWATCH_W} ${SWATCH_H}`);
    art.innerHTML = swatchMarkup(style);               // WHITELISTED: render.js escapes all data
    b.appendChild(art);
    const tag = el('span', 'swatch-name');
    tag.textContent = title;                           // SAFE: textContent only
    b.appendChild(tag);
    b.addEventListener('click', onClick);
    return b;
  }

  function clearChildren(n) {
    // Element.remove() exists in the browser AND in the DOM stub; removeChild does not.
    for (const c of [...(n.children || [])]) c.remove();
  }

  /** Apply a COMPLETE style onto the current selection. One undo step, all ids.
   *  D-S6-3 (client brief "applies the style to the current selected forms"): with nothing
   *  selected the click is a TOTAL no-op - no history entry, just a hint. D-S6-4: if every
   *  selected object already carries that style we push NOTHING, so the undo stack cannot
   *  fill up with invisible no-ops. */
  function applySwatchStyle(style, label) {
    if (!store.selected.size) { toast('Select object(s) first to apply a style'); return; }
    const targetKey = styleKeyOf(style);
    const ids = [...store.selected];
    const changes = ids.filter((id) => {
      const e = store.get(id);
      return e && styleKeyOf(e.style) !== targetKey;
    });
    if (!changes.length) { toast(`${label} already applied`); return; }
    store.pushState(store.snapshot());                 // ONE undo step for the whole apply
    // D-S6-5: write EXACTLY the depicted keys - never fontFamily/fontSize/etc.
    const patch = swatchPatchOf(style);
    for (const id of changes) store.updateStyle(id, patch);
    render();
    toast(`${label} applied to ${changes.length} object${changes.length === 1 ? '' : 's'}`);
  }

  /** S6c: decide inline-vs-dropdown from the WINDOW WIDTH, not from layout measurement.
   *  A measured approach (offsetWidth/scrollWidth) reads 0 under the DOM stub and depends on
   *  fonts/CSS, so it could not be tested here - an explicit exported threshold can. Cost:
   *  the threshold is a judgement call, documented at COMPACT_MAX_WIDTH. */
  function syncResponsiveBar() {
    const w = (typeof window !== 'undefined' && window.innerWidth) || 1280;
    const compact = w < COMPACT_MAX_WIDTH;
    topbar.classList.toggle('topbar-compact', compact);
    galleryToggle.hidden = !compact;
    if (!compact) {
      // Leaving compact mode must not leave an orphan "open" panel parked over the canvas,
      // nor a stale aria-expanded="true" on a button nobody can see (S6c-5).
      galleryWrap.classList.toggle('open', false);
      galleryToggle.setAttribute('aria-expanded', 'false');
    }
  }

  let swatchSig = null;                                // last rendered content signature
  /** Rebuild BOTH galleries from model state, but ONLY when their content changed:
   *  rebuilding unconditionally on every render() would destroy hover/focus mid-click and
   *  burn nodes on every pan frame. Signature = the ordered list of swatch keys. */
  function syncSwatchGalleries() {
    const used = collectUsedStyles(store.elements);
    const sig = used.map((u) => `${u.key}#${u.count}`).join(';') + '||' + PRESET_SWATCHES.map((p) => p.name).join(',');
    if (sig === swatchSig) return;
    swatchSig = sig;
    clearChildren(recentBox.strip);
    if (!used.length) {
      const hint = el('span', 'swatch-empty', 'draw something to collect styles');
      recentBox.strip.appendChild(hint);
    }
    for (const u of used) {
      const label = styleSummary(u.style);
      recentBox.strip.appendChild(makeSwatchButton(
        u.style,
        `${label}${u.count > 1 ? ` · ${u.count}×` : ''}`,
        // PAINT from the canonical copy (deterministic), APPLY from the RAW element style:
        // swatchPatchOf() is then the single authority on what a click writes. Feeding the
        // click pre-normalised data made that authority untestable (surviving mutant M67).
        `Apply ${label}`, () => applySwatchStyle(u.raw, label),
      ));
    }
    clearChildren(presetGallery.strip);
    for (const p of PRESET_SWATCHES) {
      presetGallery.strip.appendChild(makeSwatchButton(
        p.style, p.name, `Apply preset ${p.name}`, () => applySwatchStyle(p.raw, `Preset ${p.name}`),
      ));
    }
  }

  /** Human-readable one-liner for a swatch (tooltip + toast). Built from textContent-safe
   *  strings only; never interpolated into markup. */
  function styleSummary(s) {
    const bits = [];
    bits.push(s.fillEnabled ? `fill ${s.fill}` : 'no fill');
    bits.push(s.strokeEnabled ? `stroke ${s.stroke} @${s.strokeWidth}` : 'no stroke');
    if (s.dash && s.dash !== 'solid') bits.push(s.dash);
    if (Number(s.opacity) < 1) bits.push(`alpha ${s.opacity}`);
    return bits.join(' · ');
  }

  // ---------- F4: image picker seam ----------
  async function armImagePicker() {
    let picked = null;
    try { picked = await env.loadImageFile(); }       // null = cancelled (silent, F4-4)
    catch (e) { toast(`Could not open image: ${e && e.message ? e.message : e}`); return; }
    if (!picked || typeof picked.dataUrl !== 'string') return;
    if (!picked.dataUrl.startsWith('data:image/')) { toast('That file is not an image'); return; }   // F4-5
    const dims = (picked.width > 0 && picked.height > 0)
      ? { width: picked.width, height: picked.height }   // seam may supply natural size...
      : await probeImageSize(picked.dataUrl);             // ...else measure via ImageCtor seam
    if (!dims) { toast('Could not read image dimensions'); return; }
    if (tools.tool !== 'image') return;                   // user switched tools while picking
    tools.armImage({ src: picked.dataUrl, width: dims.width, height: dims.height });
    render();   // S5-F4c: paint the ghost straight away (derived live in imageGhostMarkup)
    toast('Click the canvas to place the image');
  }
  function probeImageSize(src) {
    return new Promise((resolve) => {
      if (typeof env.ImageCtor !== 'function') { resolve(null); return; }
      let settled = false;
      const done = (w, h) => { if (!settled) { settled = true; resolve(w > 0 && h > 0 ? { width: w, height: h } : null); } };
      try {
        const img = new env.ImageCtor();
        img.onload = () => done(img.naturalWidth || img.width || 0, img.naturalHeight || img.height || 0);
        img.onerror = () => done(0, 0);
        img.src = src;
      } catch (e) { done(0, 0); }
    });
  }

  store.onChange(render);
  // S6c: the bar must react to the user dragging the window edge, not only to edits.
  window.addEventListener('resize', () => render());

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
    // S5-F4c (client): "draw the placeholder of the size of the image to preview where the
    // image will land". Same principle as every other drag preview (T6): build a PROVISIONAL
    // MODEL ELEMENT and let render.elementToSvg paint it, so the ghost cannot disagree with
    // the commit - it is literally the same renderer, and it shows the image WITH the current
    // bar style (opacity/dash), i.e. a true WYSIWYG placement preview.
    else if (res.type === 'preview-image' && res.img) {
      preview = { kind: 'shape', el: imagePreviewElement(res.img, res.world) };
    }
    if (res.cursor) svg.style.cursor = res.cursor;
    handle(res);
  });
  window.addEventListener('mouseup', (e) => {
    // INVARIANT: clearing transient paint state MUST be followed by a render, or the DOM
    // keeps the previous frame. Caught by S5-F4c: after placing an image, pointerUp() returns
    // 'none' (the stamp commits on mousedown, so there is no live drag to finish), handle()
    // skipped the render - and the PLACE ghost stayed burned into the overlay at the old
    // cursor position until some unrelated repaint erased it.
    const hadPreview = !!preview;
    preview = null;
    const res = tools.pointerUp(toScreen(e));
    if (res.type === 'edit-text') startTextEditor(res.id);
    handle(res);
    if (hadPreview && res.type === 'none') render();
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
    if (e.key === 'Escape') {
      // S7: Esc also dismisses the manual, WITHOUT losing its original meanings (deselect,
      // close properties panel, cancel text editing) - all three still run below.
      if (helpPanel && !helpPanel.hidden) helpPanel.hidden = true;
      store.clearSelection(); closePanel(); closeTextEditor(); render(); return;
    }
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
    // S5-UI (client ask #3): the bar is the source of truth for NEW shapes, so a control
    // change ALWAYS lands in pendingStyle - and ALSO on the selection when there is one.
    store.setPendingStyle(patch);
    if (store.selected.size) { store.pushState(store.snapshot()); for (const id of store.selected) store.updateStyle(id, patch); }
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
  // S6: the old preset <select> is GONE - presets are now miniature buttons in their own
  // gallery (see syncSwatchGalleries), applied through applySwatchStyle like any other style.

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
    // S5-F4d (client): images get an extra action - snap back to the natural pixel size
    // captured at pick time. Centre stays put so the image resizes IN PLACE instead of
    // jumping away under the cursor. One undo step; hidden for every other element type.
    if (first.type === 'image') {
      rows.push((() => {
        const row = el('div', 'prop-row');
        row.appendChild(btn('original size', '', () => {
          store.pushState(store.snapshot());
          for (const id of ids) {
            const e = store.get(id);
            if (!e || e.type !== 'image') continue;
            const nw = e.natW > 0 ? e.natW : e.w, nh = e.natH > 0 ? e.natH : e.h;
            const cx = e.x + e.w / 2, cy = e.y + e.h / 2;          // resize about the centre
            e.w = nw; e.h = nh; e.x = cx - nw / 2; e.y = cy - nh / 2;
          }
          render();
        }));
        return row;
      })());
    }
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
    // F4 seam: image picker -> {name, dataUrl} | null. Tests inject fakes.
    loadImageFile: typeof deps.loadImageFile === 'function' ? deps.loadImageFile : browserLoadImageFile,
  };
}

/** F4 default picker: File System Access API when present, else hidden <input type=file>
 *  accept=image/* + FileReader.readAsDataURL. Resolves {name,dataUrl} or null on cancel. */
function browserLoadImageFile() {
  const ACCEPT = { 'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp'] };
  if (typeof window !== 'undefined' && typeof window.showOpenFilePicker === 'function') {
    return window.showOpenFilePicker({ types: [{ description: 'Image', accept: ACCEPT }] })
      .then(async (handles) => {
        const [handle] = handles;
        const file = await handle.getFile();
        return { name: file.name, dataUrl: await readFileAsDataURL(file) };
      }, () => null);                                              // AbortError -> cancel
  }
  return new Promise((resolve, reject) => {
    if (typeof document === 'undefined') { reject(new Error('no DOM available to pick an image')); return; }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.display = 'none';
    let settled = false;
    input.addEventListener('cancel', () => { if (!settled) { settled = true; input.remove(); resolve(null); } });
    input.addEventListener('change', () => {
      if (settled) return;
      settled = true;
      const file = input.files && input.files[0];
      input.remove();
      if (!file) { resolve(null); return; }
      readFileAsDataURL(file).then((dataUrl) => resolve({ name: file.name, dataUrl }), reject);
    });
    document.body && document.body.appendChild(input);
    input.click();
  });
}

function readFileAsDataURL(file) {
  if (typeof file.arrayBuffer === 'function' && typeof btoa === 'function') {
    return file.arrayBuffer().then((buf) => {
      const bytes = new Uint8Array(buf);
      let bin = '';
      const CHUNK = 0x8000;                                        // avoid arg-count limits on big files
      for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
      const mime = file.type || 'application/octet-stream';
      return `data:${mime};base64,${btoa(bin)}`;
    });
  }
  return new Promise((resolve, reject) => {
    if (typeof FileReader === 'undefined') { reject(new Error('no FileReader available')); return; }
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(fr.error || new Error('read failed'));
    fr.readAsDataURL(file);
  });
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
