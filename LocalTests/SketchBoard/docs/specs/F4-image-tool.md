# F4 - Image tool

Client intent (session 2 brief): popup to load a file, place at 100%, resize like the
rect tool, ASPECT RATIO LOCKED BY DEFAULT, Shift RELEASES the lock.

## 0. POLARITY FLAG (client asked us to state it ONCE)
Shapes (F1/D2, client-signed-off): resize is ALWAYS free deform, Shift does nothing.
Images (this ticket): resize is aspect-LOCKED by default, Shift FREES it.
This asymmetry is DELIBERATE and industry-standard (photos should not distort; shapes
are vector art). It must not be filed as a bug later.

## 1. Model
New element type 'image': { type:'image', id, x, y, w, h, src } where src is a
DATA URL (data:image/...;base64,...) captured from the picked file. Added to
ELEMENT_TYPES. w/h are WORLD UNITS; "100%" means w/h = the file's natural pixel
dimensions (naturalWidth/naturalHeight) at scale 1.
Zero dependencies: FileReader/File System Access API only, behind an injected seam.

## 2. Flow
1. User clicks the image tool button (toolbar 'image', shortcut 'i').
2. Picker pops IMMEDIATELY via deps.loadImageFile() -> Promise<{name,dataUrl}|null>:
   default chain showOpenFilePicker(accept image/*) -> hidden <input type=file
   accept=image/*> + FileReader.readAsDataURL. Cancel (null) => tool stays selected,
   nothing created, no history entry (same cancel semantics as F6-6).
3. Only data:image/* prefixes accepted (reject other mimes with toast).
4. On success the tool enters PLACE mode: the NEXT primary press on canvas creates the
   element at (world - natural/2) i.e. CENTRED under the cursor at 100%, selected,
   autosave schedules as usual. A second press places another copy. Switching tools
   exits place mode.
5. Resize: 'image' joins RESIZABLE_BOX_TYPES (F1 corner handles unchanged). In
   _applyResize the aspect ratio = orig.w/orig.h FOR IMAGES UNLESS shiftKey. Shapes:
   aspect stays null always (D2 removed - do not resurrect).

## 3. Render / export / persistence
render.js case 'image': <image href="ESCAPED src" x y width height
preserveAspectRatio="none"/> - 'none' so free-deform (Shift) actually stretches.
href (SVG2) is enough for modern browsers; browser leg verified by client.
bboxOfElement / hitTestElement: default branches already fit (normalizeRect box;
outlineOfShape null => whole-box hit) - MUST stay working (regression tests).
Persistence: src rides in toJSON envelope automatically (deepClone). NOTE (flagged,
out of scope): large images can blow the localStorage quota; autosave already swallows
quota errors silently (T7 contract) - acceptable for v1, revisit if users hit it.
PNG/SVG export inherit from render.js (single source of truth). Data URLs do not taint
the canvas, so PNG stays working.

## 4. Out of scope
Crop, filters, opacity-specific UI beyond the shared bar, external URLs (SSRF/vector
effect), rotate, per-image replace, undo of PLACE-mode arming, drag-and-drop from OS.

## 5. Acceptance criteria (TESTER writes FIRST - RED)
F4-1  model: createElement('image',...) valid; ELEMENT_TYPES includes 'image'.
F4-2  tool registered: TOOLS/toolbar/shortcut 'i' consistent (app.test.js contracts).
F4-3  picking loads file -> PLACE mode; press creates element centred under cursor at
      natural size (100%), selected; ONE history entry.
F4-4  cancel (null) => nothing created, no history entry, no crash.
F4-5  non-image dataUrl rejected with toast; nothing created.
F4-6  render: <image ... href= escaped, width/height == w/h, preserveAspectRatio none.
F4-7  resize WITHOUT shift preserves aspect ratio (w/h constant) even though pointer
      moves diagonally off-ratio.
F4-8  resize WITH shift is free deform (both axes follow pointer independently).
F4-9  roundtrip: toJSON/fromJSON keeps src byte-identical; hostile src characters cannot
      break out of the attribute (escapeXml).
F4-10 hit-test hits anywhere inside the box; bbox == {x,y,w,h}.

## 6. Mutants (M53+)
M53 image missing from RESIZABLE_BOX_TYPES       -> kills F4-7/F4-8 (no handles at all)
M54 aspect polarity inverted (shift locks)        -> kills F4-7+F4-8 jointly
M55 renderer drops preserveAspectRatio/size attrs -> kills F4-6
M56 src written without escapeXml                 -> kills F4-9 hostile-src
