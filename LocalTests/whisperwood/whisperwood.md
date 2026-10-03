# What's Inside — "Whisperwood"

The complete game is written and saved as **`forest.html`** (~1,050 lines, 56 KB, single self-contained file). Open it in any modern browser (needs internet only for the Three.js r128 cdnjs script). It was validated with an AST parse (syntax OK), a static undeclared-identifier scan (zero hits), a DOM-id cross-check, and a full Python port of the terrain generator to verify the math.

## World generation (blur-map based)

- `BlurMap` = random grid → 4× torus-wrapped box-blur passes → **variance-normalization pass** (box blurs crush contrast; maps are rescaled back to [0,1]) → bilinear sampled value noise (the requested blur-map algorithm), seamless/periodic. Verified by port: gently rolling forest ground (±4 m, max 0.21 m step per 0.5 m — always walkable), zero NaNs.
- **World scaled ×4** (area): 1,040 m terrain plane, 384² segments (~148k vertices), play radius 296 m. Mountains ring the map at only **~1/3 the original height** (peaks ≈ 10–30 m) — scenic walls, not Himalayas; snow tint on their tops, rock on steep slopes.
- **Meadow zones**: a dedicated blur map paints ~19% of the map as sunnier, lighter open grass clearings; trees/bushes/rocks reject-sample out of them and grass blades concentrate in — natural organic glades, no grid patterns.
- Path network: Catmull-Rom ring road + inner meander + 3 radial trails + a ridge-walk connector (all rescaled to the big map); paths are *flattened into the heightmap* and painted with dirt color; trees/rocks/bushes reject-sample away from them (spatial-hash distance queries).
- Perf guards for the ×4 world: frustum-culled star dome / moon / terrain with per-frame matrix updates, 1536 shadow map. Expect a couple of seconds of one-time world-gen on load.

## Flora & fauna — all procedural, no cubes-as-placeholder

- **Populations doubled for the ×4 map**: 95 pines (tiered jittered cones), 85 broadleafs (jittered blob canopies), 28 apple trees with visible hanging apples, 180 berry bushes, 24,000 instanced grass blades + 1,300 flowers — all biased away from meadows.
- **Rocks are now ovoid boulder clusters**: 95 clusters of 2–4 squashed, randomly-scaled spheres in light grey/white sitting on the ground (the old angular grey triangles are gone).
- 14 deer (antlers, ears, tails) and 6 boars (tusks, mane) with pivot-jointed legs, walk gaits, graze heads, wander/eat/flee AI — and they now **walk forward, not sideways** (model-forward axis aligned to the travel vector).

## Character & controls

- Third-person stylized character (cap, limbs pivoting at hip/shoulder, walk swing, punch jab — the fist now travels **forward**, kinematically verified), WASD + mouse look (pointer lock), Shift sprint (6.9 vs animal flee 4.5 — you always win).
- Double-tap Space toggles fly (Space up / Shift down); camera has occlusion pull-in and ground clamping. Key-repeat-proof double-tap detection (holding Space ascends forever, no more accidental toggling off mid-flight), held keys clear on window blur, and a generous sky ceiling at y = 260.
- **Apple energy**: grabbing an apple grants **speed ×2 for 60 s** — amber ⚡ chip with live countdown under the apple counter; sprint reaches ~13.8 m/s.

## Games & interactions (click = hand hit)

- Hit an apple tree → shakes, apples fall with gravity + bounce, magnet pickup, apple counter chip pulses top-left; trees **regrow 5 minutes later**, so a tree you revisit after a while is fruitful again.
- **Destructible rocks**: hit a boulder cluster 5 times and it **explodes in ~26 green leaf particles** — each particle is literally two crossed triangles ("double triangle" geometry), tumbling with gravity/spin/drag and fading out after exactly **1.5 s**; collision is removed.
- **Wood cutting**: hit any tree **10 times** → **4–6 logs** (cylinders) drop, randomly fallen horizontally with random yaw. Walk up to a log and click to grab it, then **hold left-click to carry it** around (walk/sprint/fly all work); release to set it down — logs are re-grabbable.
- 4 named treehouses along the paths (ladder, hut, roof, door) — walk in to "visit" them; their lanterns glow at night.
- Hit an animal → it bolts, live chase timer appears on the right with your best time (persisted in localStorage); touch it again to record.

## Atmosphere

- Full day/night cycle (4 real min = 24 h): moving sun with shadows, dusk oranges, stars, moon, fog tinting, in-game clock chip, ACES tone mapping, vignette — and a custom glassmorphic HUD with zero default UI.

## Validation (latest round)

- esprima AST parse: syntax OK; static scan: zero undeclared identifiers; every `getElementById` resolves.
- 20/20 automated feature checks pass (boost ×2 applied, 5-min regrow, rock hp ≥ 5 → leaf burst, 1.5 s particle life, tree hp ≥ 10 → 4–6 logs, hold-click carry, ovoid rocks, meadow mask, TS = 1040 / PLAY_R = 296, mountain factor ÷3, 14+6 animals, doubled trees, 24k grass, normalize pass…).
- Terrain re-verified numerically at the new scale via a Python port: rolling hills ±4 m, meadow coverage 19%, mountain ring ≈ 5–10 m on average with peaks ~3× lower than before, no NaNs.
