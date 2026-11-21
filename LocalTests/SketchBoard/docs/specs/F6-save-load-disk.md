# F6 - Save / Load the sketch to/from DISK (file system)

Client request (session 4): "Ability to save current to disk, and also to load a sketch
from disk. The save file can be the actual local storage representation of the picture."

## 1. Problem
Today the document lives only in localStorage (plus SVG/PNG exports, which are
renderings, NOT re-loadable documents). Users cannot back up a board, move it between
machines/browsers, or survive a cleared storage. The client chose the format: **the
exact localStorage envelope** - {app:'sketchboard', version:1, elements:[...]} - i.e.
store.toJSON(). Consequence we exploit deliberately: a file and a localStorage save
are THE SAME CONTRACT, so one validator (inspectDocString) guards both doors.

## 2. Format (normative)
UTF-8 .json text file (suggested extension .sketchboard.json). Byte-for-byte what
autosave writes under STORAGE_KEY: { "app": "sketchboard", "version": 1, "elements": [...] }.
No zip, no custom binary, no wrapper fields. Future schema changes extend the envelope,
not the container.

## 3. Behaviour

### 3.1 Save to disk (menu: "Save to disk")
- Serialize via store.toJSON() (single source of truth - same brain as autosave).
- Filename via buildDownloadName({format:'json'}) -> sanitized "sketchboard.json"
  (reuse sanitizeFilename; traversal/separators/control chars stripped; never empty).
- Delivery through the INJECTED sink (testability, zero-dep):
  deps.saveFile(name, text, mime) -> Promise|void; default = browserDownload-style
  Blob + <a download> click. Errors toast-fied, never thrown at the click site.

### 3.2 Load from disk (menu: "Open from disk")
- Picker: deps.openFile() -> Promise<{name, text} | null> (null = user cancelled).
  Default chain: File System Access API showOpenFilePicker when present, else hidden
  <input type=file> + FileReader. Both behind the seam so tests inject fakes.
- VALIDATE FIRST with inspectDocString(text) - the EXACT statuses of inspectSavedDoc
  (the none-vs-malformed distinction collapses: an empty string from a real file is
  'malformed'). Any non-ok status => REFUSE WHOLE FILE, board UNTOUCHED, toast says WHY
  (same per-status copy family as MAJOR-4).
- Only on ok: store.pushState(snapshot()) THEN store.fromJSON(parsed).
  (pushState-before-load => one Ctrl+Z restores the pre-open board. Decision D-F6-2.)

### 3.3 Interaction with the MAJOR-4 read-only lock - DECISIONS FOR SIGN-OFF
- **D-F6-1 (recommended): Open works WHILE LOCKED.** A locked board (unreadable/newer
  payload under our key) is exactly when the user needs to load a good .json backup -
  blocking it strands them. A SUCCESSFUL load additionally CLEARS the lock (the key now
  demonstrably holds content this build understands; autosave resumes and heals it).
- **D-F6-2 (recommended): Open is UNDOABLE (one step).** pushState before fromJSON.
  Note fromJSON itself clears redo/history stacks - that stays true for the LOADED doc
  (a document switch starts fresh); the pushed snapshot covers the mistake case.
- Save while locked: ALLOWED (reading your own in-memory board to a file destroys
  nothing) - but while locked the board is seeded-empty or restored-from-file, so this
  is rare and harmless.

### 3.4 Autosave interplay
Successful load triggers store change -> autosave schedules normally -> the loaded doc
becomes the new localStorage state. That is CORRECT (user explicitly opened this file).
If the board was locked, the lock was already cleared (D-F6-1), so the write is legal.

## 4. Out of scope
Drag-and-drop onto canvas; recent-files; multi-tab sync; importing foreign formats
(SVG-in); FS Access permission persistence.

## 5. Acceptance criteria (TESTER writes these FIRST - RED)
F6-1  save produces exactly store.toJSON() text (deep-equal parse), name ends .json.
F6-2  hostile base name ("../../e"/t c/secret" style) -> sanitized, no slash or dot-dot
      in result (pattern-checked against the sanitizer contract).
F6-3  roundtrip: load(save(store)) yields byte-identical toJSON() output.
F6-4  refuse-whole-file: malformed / foreign / v99 / bad-version / bad-element strings
      leave elements, selection AND storage byte-identical; toast names the reason.
F6-5  happy load replaces board; selection cleared; ONE undo restores previous board
      exactly (D-F6-2).
F6-6  picker cancel (null) mutates NOTHING (no history entry).
F6-7  locked board + valid file -> loads, lock CLEARS, subsequent edit persists (D-F6-1).
F6-8  injected saveFile throwing -> toast error, board unaffected, no unhandled reject.

## 6. Mutants (harness M38+)
M38 apply-without-validate (skip inspectDocString)   -> kills F6-4
M39 no-pushState-before-load                          -> kills F6-5
M40 load-stays-locked (drop lock clear)               -> kills F6-7
M41 save-under-lock-refused (gate save on readOnly)   -> kills save-while-locked pin
(needles chosen so each mutant is killed by its named AC, not collateral damage.)

## 7. Browser leg (client gate - headless CANNOT cover it)
Real input-type-file/FilePicker behaviour, FileReader encoding (BOM!), large files,
download attribute honouring .json extension. Same rule as T10: green headless != DONE.
