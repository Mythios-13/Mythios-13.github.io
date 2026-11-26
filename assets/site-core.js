/*
 * site-core.js — pure logic for the repo documentation site.
 * Shared by index.html and editor.html. Loaded as a classic script (window.SiteCore)
 * and also loadable headlessly (QuickJS/Node) for unit testing.
 *
 * Design rules:
 *  - No DOM access here. Rendering returns strings; the caller decides where to put them.
 *  - Never mutates its inputs. Everything returns fresh objects.
 *  - Backward compatible with the original content.json schema:
 *      { title, templates:[{id,name,structure,extraData}], pages:[{id,title,content,template,extraData}] }
 *    Unknown extra keys are preserved verbatim so round-tripping through the editor is lossless.
 */
(function (global) {
  'use strict';

  var DEFAULT_TEMPLATE_ID = 'default';
  var FALLBACK_STRUCTURE = '<h2>{{title}}</h2><div>{{content}}</div>';

  // ---------- primitives ----------

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function deepClone(value) {
    if (value === undefined || typeof value === 'function' || typeof value === 'symbol') return undefined;
    return JSON.parse(JSON.stringify(value));
  }

  function isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }

  function slugify(text) {
    var s = String(text == null ? '' : text)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return s || 'page';
  }

  // Generate an id that does not collide with anything in `taken` (array/Set of values).
  function uniqueId(base, taken) {
    var used = taken instanceof Set ? taken : new Set((taken || []).map(String));
    var root = String(base || 'page');
    var candidate = root;
    var n = 2;
    while (used.has(candidate)) {
      candidate = root + '-' + n;
      n += 1;
      if (n > 10000) break; // pathological guard
    }
    return candidate;
  }

  // ---------- normalization / migration ----------

  function normalizeTemplate(t, index) {
    if (!isPlainObject(t)) return null;
    var out = deepClone(t);
    out.id = t.id != null && String(t.id).trim() !== '' ? String(t.id) : 'template-' + (index + 1);
    out.name = typeof t.name === 'string' && t.name.trim() ? t.name : out.id;
    out.structure = typeof t.structure === 'string' && t.structure.trim() ? t.structure : FALLBACK_STRUCTURE;
    if (out.extraData !== undefined && !isPlainObject(out.extraData)) delete out.extraData;
    // ensure the template carries an extraData object so editor forms can bind to it safely
    if (!isPlainObject(out.extraData)) {
      var tokens = templateTokens(out.structure).filter(function (t) { return t !== 'title' && t !== 'content'; });
      if (tokens.length) {
        out.extraData = {};
        tokens.forEach(function (k) { out.extraData[k] = ''; });
      } else {
        delete out.extraData;
      }
    }
    return out;
  }

  function normalizePage(p, index, usedIds) {
    var out = isPlainObject(p) ? deepClone(p) : {};
    var rawId = p && p.id != null ? String(p.id).trim() : '';
    out.id = rawId ? rawId : uniqueId('page-' + (index + 1), usedIds);
    // de-duplicate ids (the original file used numeric ids; collisions would break selection)
    if (usedIds.has(String(out.id))) out.id = uniqueId(String(out.id), usedIds);
    usedIds.add(String(out.id));

    out.title = typeof p.title === 'string' ? p.title : (p.title == null ? '' : String(p.title));
    out.content = typeof p.content === 'string' ? p.content : (p.content == null ? '' : String(p.content));
    out.template = typeof p.template === 'string' && p.template.trim() ? p.template : DEFAULT_TEMPLATE_ID;
    if (out.extraData !== undefined && !isPlainObject(out.extraData)) delete out.extraData;
    return out;
  }

  /*
   * Accepts anything (null, partial, legacy) and returns a complete, safe working copy:
   *   { ...originalTopLevelKeys, title, templates, pages }
   * A `default` template is guaranteed to exist so pages never render blank.
   */
  function normalizeData(raw) {
    var src = isPlainObject(raw) ? raw : {};
    var out = deepClone(src);

    out.title = typeof src.title === 'string' && src.title.trim() ? src.title : 'Untitled site';

    var templates = Array.isArray(src.templates)
      ? src.templates.map(normalizeTemplate).filter(Boolean)
      : [];
    var tplIds = new Set();
    out.templates = templates.filter(function (t) {
      if (tplIds.has(t.id)) return false; // drop duplicate template ids
      tplIds.add(t.id);
      return true;
    });
    if (!out.templates.some(function (t) { return t.id === DEFAULT_TEMPLATE_ID; })) {
      out.templates.unshift({
        id: DEFAULT_TEMPLATE_ID,
        name: 'Default',
        structure: FALLBACK_STRUCTURE
      });
    }

    var usedIds = new Set();
    var pages = Array.isArray(src.pages) ? src.pages : [];
    out.pages = pages.map(function (p, i) { return normalizePage(p, i, usedIds); });

    return out;
  }

  // ---------- templating ----------

  function findTemplate(templates, id) {
    var list = Array.isArray(templates) ? templates : [];
    for (var i = 0; i < list.length; i++) {
      if (list[i] && String(list[i].id) === String(id)) return list[i];
    }
    return null;
  }

  // Tokens referenced by a template structure, e.g. ["title","content","sidebar"].
  function templateTokens(structure) {
    var seen = [];
    var re = /\{\{\{?\s*([A-Za-z0-9_]+)\s*\}?\}\}/g;
    var m;
    var s = String(structure || '');
    while ((m = re.exec(s)) !== null) {
      if (seen.indexOf(m[1]) === -1) seen.push(m[1]);
    }
    return seen;
  }

  /*
   * Which extraData keys a page should provide for a given template.
   * Derived from the structure itself (authoritative) intersected with the template's
   * declared extraData keys when present — this is what drives the editor form.
   */
  function requiredExtraFields(template) {
    if (!isPlainObject(template)) return [];
    var tokens = templateTokens(template.structure).filter(function (t) {
      return t !== 'title' && t !== 'content';
    });
    var declared = isPlainObject(template.extraData) ? Object.keys(template.extraData) : null;
    if (!declared || declared.length === 0) return tokens;
    // Prefer declared order, then append any token the author forgot to declare.
    var ordered = declared.filter(function (k) { return tokens.indexOf(k) !== -1; });
    tokens.forEach(function (k) { if (ordered.indexOf(k) === -1) ordered.push(k); });
    return ordered;
  }

  var RAW_RE = /\{\{\{\s*([A-Za-z0-9_]+)\s*\}\}\}/g;
  var TOKEN_RE = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

  /*
   * Render a page to an HTML string.
   *   opts.renderMarkdown(text) -> html string   (defaults to escapeHtml: fail-safe)
   *   opts.allowRawTokens       -> boolean, default true ({{{token}}} injects verbatim)
   * NOTE: output is NOT sanitized here. Callers must pass it through sanitizeHtml().
   */
  function renderTemplate(page, templates, opts) {
    opts = opts || {};
    var renderMd = typeof opts.renderMarkdown === 'function' ? opts.renderMarkdown : escapeHtml;
    var allowRaw = opts.allowRawTokens !== false;

    if (!isPlainObject(page)) return '';
    var template = findTemplate(templates, page.template);
    var structure = template ? template.structure : FALLBACK_STRUCTURE;
    var extra = isPlainObject(page.extraData) ? page.extraData : {};

    var html = String(structure);

    if (allowRaw) {
      html = html.replace(RAW_RE, function (_match, token) {
        var v = extra[token];
        return v == null ? '' : String(v);
      });
    } else {
      html = html.replace(RAW_RE, function (_match, token) {
        return escapeHtml(extra[token]);
      });
    }

    html = html.replace(TOKEN_RE, function (_match, token) {
      if (token === 'title') return escapeHtml(page.title);
      if (token === 'content') return renderMd(page.content);
      var v = extra[token];
      if (v == null || v === '') return '';
      return renderMd(String(v));
    });

    return html;
  }

  // ---------- markdown ----------

  /*
   * Wraps a markdown-it instance. If the library is missing (offline, script blocked)
   * we degrade to escaped plain text with newline preservation instead of crashing.
   */
  function makeMarkdownRenderer(mdLib) {
    if (mdLib && typeof mdLib.render === 'function') {
      return function (text) {
        try {
          return mdLib.render(text == null ? '' : String(text));
        } catch (e) {
          return escapeHtml(text);
        }
      };
    }
    return function (text) {
      return '<p>' + escapeHtml(text).replace(/\n/g, '<br>') + '</p>';
    };
  }

  // ---------- sanitization ----------

  var FORBIDDEN_URL_RE = /^\s*(?:javascript|data|vbscript|file):/i;

  function isUnsafeUrl(url) {
    return FORBIDDEN_URL_RE.test(String(url == null ? '' : url));
  }

  /*
   * Fail-open-by-design: DOMPurify is vendored locally so it is normally present.
   * When absent we return the HTML untouched but flip `available` to false so the UI
   * can warn loudly — content stays readable instead of turning into escaped mush.
   */
  function sanitizeHtml(html) {
    var purifier = global.DOMPurify;
    var out = { html: String(html == null ? '' : html), available: false, removed: false };
    if (purifier && typeof purifier.sanitize === 'function') {
      out.available = true;
      var cleaned = purifier.sanitize(String(html == null ? '' : html), {
        USE_PROFILES: { html: true },
        ADD_ATTR: ['target', 'rel'],
        ALLOW_DATA_ATTR: false,
        ALLOWED_URI_REGEXP: /^(?:(?:f|ht)tps?|mailto|tel|anchor|#|\.|#|\/)/i
      });
      out.removed = cleaned !== html;
      out.html = cleaned;
    }
    return out;
  }

  // ---------- validation ----------

  /*
   * Returns [{ level:'error'|'warn', path, message }] — consumed by the editor panel
   * and by the test suite. Errors mean "fix before committing"; warnings are advisory.
   */
  function validateData(data) {
    var issues = [];
    var push = function (level, path, message) { issues.push({ level: level, path: path, message: message }); };

    if (!isPlainObject(data)) {
      push('error', '$', 'content.json must be a JSON object');
      return issues;
    }
    if (!Array.isArray(data.pages)) {
      push('error', 'pages', '`pages` must be an array');
    } else {
      var ids = new Set();
      data.pages.forEach(function (p, i) {
        var path = 'pages[' + i + ']';
        if (!isPlainObject(p)) { push('error', path, 'page must be an object'); return; }
        var id = p.id == null ? '' : String(p.id).trim();
        if (!id) push('error', path + '.id', 'missing id');
        else if (ids.has(id)) push('error', path + '.id', 'duplicate id "' + id + '"');
        else ids.add(id);

        if (!String(p.title == null ? '' : p.title).trim()) push('warn', path + '.title', 'empty title shows as a blank nav entry');
        if (p.template && !findTemplate(data.templates, p.template)) {
          push('warn', path + '.template', 'unknown template "' + p.template + '" — falls back to default');
        }
        var tpl = findTemplate(data.templates, p.template);
        if (tpl) {
          requiredExtraFields(tpl).forEach(function (key) {
            var has = isPlainObject(p.extraData) && p.extraData[key] != null && String(p.extraData[key]).trim() !== '';
            if (!has) push('warn', path + '.extraData.' + key, 'template "' + tpl.id + '" expects "' + key + '" but it is empty');
          });
        }
        var body = String(p.content == null ? '' : p.content);
        if (/\bjavascript\s*:/i.test(body)) push('error', path + '.content', 'contains a javascript: URL');
        if (/<\s*script/i.test(body)) push('warn', path + '.content', 'raw <script> in content is stripped by the sanitizer');
      });
    }

    if (data.templates !== undefined && !Array.isArray(data.templates)) {
      push('error', 'templates', '`templates` must be an array');
    } else if (Array.isArray(data.templates)) {
      var tplIds = new Set();
      data.templates.forEach(function (t, i) {
        var path = 'templates[' + i + ']';
        if (!isPlainObject(t)) { push('error', path, 'template must be an object'); return; }
        var id = t.id == null ? '' : String(t.id).trim();
        if (!id) push('error', path + '.id', 'missing id');
        else if (tplIds.has(id)) push('error', path + '.id', 'duplicate template id "' + id + '"');
        else tplIds.add(id);
        if (!String(t.structure == null ? '' : t.structure).trim()) push('warn', path + '.structure', 'empty structure renders nothing');
      });
    }
    return issues;
  }

  // ---------- search ----------

  function filterPages(pages, query, fields) {
    var list = Array.isArray(pages) ? pages : [];
    var q = String(query == null ? '' : query).trim().toLowerCase();
    if (!q) return list.slice();
    var keys = fields || ['title', 'content'];
    return list.filter(function (p) {
      if (!isPlainObject(p)) return false;
      for (var i = 0; i < keys.length; i++) {
        var v = p[keys[i]];
        if (v != null && String(v).toLowerCase().indexOf(q) !== -1) return true;
      }
      if (isPlainObject(p.extraData)) {
        var vals = Object.keys(p.extraData);
        for (var j = 0; j < vals.length; j++) {
          var ev = p.extraData[vals[j]];
          if (ev != null && String(ev).toLowerCase().indexOf(q) !== -1) return true;
        }
      }
      return false;
    });
  }

  // ---------- editor helpers ----------

  function createPage(templates, takenIds) {
    var tpl = findTemplate(templates, DEFAULT_TEMPLATE_ID) || (Array.isArray(templates) ? templates[0] : null);
    var page = {
      id: uniqueId(slugify('new-page'), takenIds || []),
      title: 'New page',
      content: '',
      icon: '',
      template: tpl ? tpl.id : DEFAULT_TEMPLATE_ID
    };
    var fields = requiredExtraFields(tpl);
    if (fields.length) {
      page.extraData = {};
      fields.forEach(function (k) {
        page.extraData[k] = tpl.extraData && tpl.extraData[k] != null ? String(tpl.extraData[k]) : '';
      });
    }
    return page;
  }

  /*
   * Rebuild extraData when the template changes: keeps values for keys both templates
   * share, seeds new keys from the template defaults, drops orphaned keys.
   */
  function syncExtraData(page, newTemplate) {
    var out = isPlainObject(page) ? deepClone(page) : {};
    var fields = requiredExtraFields(newTemplate);
    if (!fields.length) {
      if ('extraData' in out) delete out.extraData;
      return out;
    }
    var prev = isPlainObject(page && page.extraData) ? page.extraData : {};
    var next = {};
    fields.forEach(function (k) {
      if (prev[k] != null && String(prev[k]) !== '') next[k] = String(prev[k]);
      else if (newTemplate.extraData && newTemplate.extraData[k] != null) next[k] = String(newTemplate.extraData[k]);
      else next[k] = '';
    });
    out.extraData = next;
    return out;
  }

  function moveItem(list, from, to) {
    var arr = Array.isArray(list) ? list.slice() : [];
    if (from < 0 || from >= arr.length) return arr;
    var clamped = Math.max(0, Math.min(arr.length - 1, to));
    var item = arr.splice(from, 1)[0];
    arr.splice(clamped, 0, item);
    return arr;
  }

  function countWords(text) {
    var t = String(text == null ? '' : text).trim();
    if (!t) return 0;
    return t.split(/\s+/).length;
  }

  var SiteCore = {
    version: '1.0.0',
    DEFAULT_TEMPLATE_ID: DEFAULT_TEMPLATE_ID,
    FALLBACK_STRUCTURE: FALLBACK_STRUCTURE,
    escapeHtml: escapeHtml,
    deepClone: deepClone,
    isPlainObject: isPlainObject,
    slugify: slugify,
    uniqueId: uniqueId,
    normalizeData: normalizeData,
    findTemplate: findTemplate,
    templateTokens: templateTokens,
    requiredExtraFields: requiredExtraFields,
    renderTemplate: renderTemplate,
    makeMarkdownRenderer: makeMarkdownRenderer,
    sanitizeHtml: sanitizeHtml,
    isUnsafeUrl: isUnsafeUrl,
    validateData: validateData,
    filterPages: filterPages,
    createPage: createPage,
    syncExtraData: syncExtraData,
    moveItem: moveItem,
    countWords: countWords
  };

  global.SiteCore = SiteCore;
  if (typeof module !== 'undefined' && module.exports) module.exports = SiteCore;
})(typeof globalThis !== 'undefined' ? globalThis : this);
