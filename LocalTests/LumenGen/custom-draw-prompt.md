# Custom Draw Algorithm — Compact Prompt

> **How to use**
> Copy everything between `--- PROMPT ---` and `--- END PROMPT ---`, replace `{{USER_INSTRUCTIONS}}` with what you want the algorithm to do, paste into any LLM. It replies with raw JavaScript only — paste that directly into the generator's Custom code editor.

--- PROMPT ---

Write ONE generative-art algorithm for a procedural wallpaper generator's "Custom code" mode. Plain JavaScript only, no imports, no build step.

## Contract
Define exactly one function:
```js
function draw(ctx) { /* ... */ }
```
It runs once per render. Paint into `ctx.ink` (drawing layer, composited over the background). You may also paint on `ctx.base` (background) or return `{ base, ink }` / `{ ink }` / `{ base }` to replace buffers. Anything else is ignored. Do NOT add post-processing yourself — blur/glow/shine/grain/scanlines/vignette are applied by the engine after your code returns.

## ctx
- `ctx.w`, `ctx.h` — canvas size in px (8–8192)
- `ctx.alpha` — true when exporting an alpha overlay (transparent base). Respect it.
- `ctx.rng()` — seeded PRNG, returns [0,1). Use ONLY this for randomness, never Math.random().
- `ctx.palette` — array of [r,g,b] colors (0–255) from the active palette. `ctx.paletteHex` — same as hex strings.
- `ctx.params` — tuning params: flows (10–300), frequency (0.5–8), traceLength (20–400), strokeWidth (0.5–8), glow, shine, grain, scanlines, scanlineGap, blur, chroma, vignette, baseDarkness (all engine-applied), alpha.
- `ctx.base`, `ctx.ink` — buffers `{ w, h, data }`, where `data` is Uint8ClampedArray, row-major RGBA, length w*h*4. Pixel index: `(y * buf.w + x) * 4`.

## Helpers (on ctx)
- `ctx.stampCircle(buf, cx, cy, r, rgb, alpha)` — soft dot, additive
- `ctx.stampSegment(buf, x0, y0, x1, y1, r, rgb, alpha)` — line segment, additive
- `ctx.valueNoise(x, y, seed)` / `ctx.fbm(x, y, octaves, seed)` — noise, returns 0–1
- `ctx.makeBuffer(w, h)` — fresh transparent buffer
- `ctx.boxBlur(buf, radius)` — blur in place
- `ctx.compositeOver(dst, src, strength)` / `ctx.compositeGlow(dst, src, strength)` / `ctx.compositeScreen(dst, src, strength)`
- Color: `ctx.hexToRgb(hex)`, `ctx.rgbToHex(r,g,b)`, `ctx.hslToHex(h,s,l)`, `ctx.lerpRgb(a,b,t)`, `ctx.shade(rgb,f)`, `ctx.lerp(a,b,t)`

Prefer helpers over hand-rolled pixel loops. Direct writes work too: `var i = (y*ctx.ink.w+x)*4; ctx.ink.data[i]=r; ...`

## Rules
- ES5 style (`var`, `function`). No DOM, window, document, fetch, localStorage, Date, Math.random, eval, async, Promise, setTimeout. Everything comes from ctx.
- Deterministic: all randomness from ctx.rng(). Never mutate ctx.palette / ctx.params.
- Bounded, synchronous, fast. Guard divisions and loop bounds. Do not throw — any exception aborts the render.
- Start with `function draw(ctx) {` and end with `}`. Reply with only the code.

## Example (verified to run)


Simple scatter of dots:

```js
function draw(ctx) {
  for (var i = 0; i < 40; i++) {
    ctx.stampCircle(ctx.ink, ctx.rng() * ctx.w, ctx.rng() * ctx.h,
      4 + ctx.rng() * 20, ctx.palette[i % ctx.palette.length], 0.5);
  }
}
```

Replacing the background entirely (direct pixel write into `ctx.base`):

```js
function draw(ctx) {
  var w = ctx.w, h = ctx.h, rng = ctx.rng, palette = ctx.palette;
  var cell = 5;
  var gw = Math.ceil(w / cell) + 1, gh = Math.ceil(h / cell) + 1;
  var grid = new Float32Array(gw * gh);
  var freq = ctx.params.frequency * 0.42;
  var seedOff = Math.floor(rng() * 100000);
  for (var gy = 0; gy < gh; gy++) {
    for (var gx = 0; gx < gw; gx++) {
      grid[gy * gw + gx] = ctx.fbm(gx * cell / w * freq, gy * cell / h * freq, 4, seedOff);
    }
  }
  var bands = 5.0 + ctx.params.frequency * 1.15;
  for (var y = 0; y < h; y++) {
    var fy = y / cell, gy0 = Math.floor(fy), ty = fy - gy0;
    if (gy0 >= gh - 1) gy0 = gh - 2;
    for (var x = 0; x < w; x++) {
      var fx = x / cell, gx0 = Math.floor(fx), tx = fx - gx0;
      if (gx0 >= gw - 1) gx0 = gw - 2;
      var g00 = grid[gy0 * gw + gx0], g10 = grid[gy0 * gw + gx0 + 1];
      var g01 = grid[(gy0 + 1) * gw + gx0], g11 = grid[(gy0 + 1) * gw + gx0 + 1];
      var v = ctx.lerp(ctx.lerp(g00, g10, tx), ctx.lerp(g01, g11, tx), ty);
      var band = Math.pow(Math.abs(Math.sin(v * Math.PI * bands)), 5);
      var pos = Math.min(1, Math.max(0, band * 1.9)) * (palette.length - 1);
      var i0 = Math.floor(pos), i1 = Math.min(palette.length - 1, i0 + 1), tt = pos - i0;
      var c = ctx.lerpRgb(palette[i0], palette[i1], tt);
      var i = (y * w + x) * 4;
      ctx.base.data[i] = c[0]; ctx.base.data[i + 1] = c[1]; ctx.base.data[i + 2] = c[2]; ctx.base.data[i + 3] = 255;
    }
  }
}
```

Using a blurred offscreen buffer with glow:

```js
function draw(ctx) {
  var buf = ctx.makeBuffer(ctx.w, ctx.h);
  for (var i = 0; i < 30; i++) {
    ctx.stampCircle(buf, ctx.rng() * ctx.w, ctx.rng() * ctx.h,
      20 + ctx.rng() * 40, [255, 200, 120], 0.35);
  }
  ctx.boxBlur(buf, 12);
  ctx.compositeGlow(ctx.ink, buf, 1.0);
}
```

```js
function draw(ctx) {
  var w = ctx.w, h = ctx.h, rng = ctx.rng, palette = ctx.palette;
  var freq = ctx.params.frequency;
  var turns = 2.2 + rng() * 1.6;
  var seedOff = Math.floor(rng() * 100000);
  var stepLen = 2.5 + rng() * 1.5;
  for (var i = 0; i < ctx.params.flows; i++) {
    var x = rng() * w, y = rng() * h;
    var colA = palette[Math.floor(rng() * palette.length)];
    var colB = palette[Math.floor(rng() * palette.length)];
    var alpha = 0.30 + rng() * 0.30;
    var len = Math.floor(ctx.params.traceLength * (0.55 + rng() * 0.9));
    var px = x, py = y;
    for (var s = 0; s < len; s++) {
      var n = ctx.fbm(x / w * freq, y / h * freq, 4, seedOff);
      var ang = (n * 2 - 1) * Math.PI * turns;
      x += Math.cos(ang) * stepLen;
      y += Math.sin(ang) * stepLen;
      if (x < -30 || x > w + 30 || y < -30 || y > h + 30) break;
      var t = s / len;
      var c = ctx.lerpRgb(colA, colB, t);
      ctx.stampSegment(ctx.ink, px, py, x, y, ctx.params.strokeWidth * 0.5, c, alpha);
      px = x; py = y;
    }
  }
}
```

## Self-check
- Exactly one `draw(ctx)`; only documented ctx fields/helpers; no banned APIs; all randomness from ctx.rng(); bounded loops; respects ctx.alpha; starts with `function draw(ctx) {` and ends with `}`; reply contains only the code.

## User instructions
{{USER_INSTRUCTIONS}}

--- END PROMPT ---
