# MERIDIAN — Game Report

*Procedural GTA-style city · single self-contained HTML file · Three.js, zero assets*

## The City

A 9×9 procedurally generated grid drawn entirely in code: roads with dashed center lines and crosswalks, sidewalks with curbs, varied buildings with lit windows at night, parks with trees, benches, streetlights, drifting clouds, and a full day–night cycle with live clock, sun/moon, stars, and time-lapse (T). A minimap (M) shows streets, cars, pedestrians, and your heading. The HUD hides with H.

## You

A third-person character with mouse look (pointer lock), walk/sprint, jump, and a sidearm. Camera distance adjusts with the wheel. Foot speeds: 4.15 m/s walk, 8.7 sprint.

## Vehicles — three classes

| Class | Top speed | Notes |
|---|---|---|
| **Ram bus** | 5× your speed | Slow traffic, chrome ram bar, spins convincingly when hit |
| **Normal cars** (sedan, hatch, SUV, van, taxi) | 10× | The city's bread and butter |
| **Sport** 🆕 | 15× | Red Ferrari-style wedge: bevelled nose, raked windshield, rear wing |

- **E jacks any car — parked or moving.** Moving cars eject their driver (who flees) and you inherit their momentum ("CARJACK"). E again to step out.
- Body-shaped hitboxes per model; substepped movement so 300 km/h can't tunnel through walls.
- **Collisions:** bounce off buildings *and* other cars — your car loses speed on impact, the struck car gets launched, spins out, and becomes permanent roadkill.
- Traffic drives lanes, turns at intersections, yields to you; parked cars line curbs and lots.

## Pedestrians

Crowds walk the sidewalks, idle, flee when shot or threatened, and despawn/recycle seamlessly around you. They can be **shot** (2 hits down) or **run over**: car hits throw them 3–4 m in the impact direction with a burst of **green neon splash** (stylized "not-blood," fully tweakable). Fallen peds get up straight — nobody walks horizontal.

## Combat

- **Aim:** big gold reticle floats above your head along your true sight-line — what it covers is what you hit, pixel-accurate at any range.
- **Bullets** fly from the cross; tracers are light-bolts fired aesthetically from the gun in hand, fading over 300 ms.
- Impacts stamp **grey decals that linger 5 seconds** — aim accuracy is verifiable.
- A **practice target** (red/white bullseye on a stick) plants itself ~13 m down the nearest street wherever you spawn.

## Progression & Achievements

**🟡 10 Golden Rings.** Ten gold rings hide across the city; the counter tops the screen. At **9/10**, a pulsing compass arrow appears pointing to the last one with live distance. Collect all ten → character turns **golden** + toast.

**🕊️ Flight (at 10/10).** Double-tap Space to toggle flight: Space climbs, Shift descends, WASD steers at **5× foot speed**. Touching the ground ends flight; double-tap toggles it off. You can fly over buildings and land on rooftops.

**🌶️ GOURANGA (at 100 peds hit).** The ped-hit counter lives on the right of the HUD. At 100 hits: orange badge, chime, and a **machine gun firing 6 rounds/sec** while you hold the mouse.

## Controls

| Key | Action |
|---|---|
| WASD / arrows | walk · drive |
| Shift | sprint · descend in flight |
| Space | hop · ×2 = toggle flight (golden) · climb in flight |
| Mouse | look · click/hold = fire |
| Wheel | camera distance |
| E | jack any car / step out |
| T | time-lapse ×26 |
| M / H | minimap / hide UI |

## Under the hood (for tweaking)

Everything tunable lives in named constants: `CAR_TOP={bus:5, sport:15, car:10}`, `PED_HIT` (throw distance/launch), `SPLASH` (colors/life), `IMPACT` (decal color/life), `TRACER_LIFE`, `AIM_RET_DIST`, `GUN_UNLOCK=100`, plus `carGeometry()` and `initGeo()` — both live-editable in the companion **GB Studio** editor (`car-editor.html`) with live 3D preview, synced to the game.

## Known spirit

No loading screens, no internet after first load, no assets on disk — just one file, one click, and a city that wakes up around you. Walk it, jack it, ring-collect it, or fly over it golden at 40 m/s with Gouranga purring.
