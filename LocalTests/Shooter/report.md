# NEON / PURGE — *anti-ai patrol, volume II*

A single-file, fully procedural outrun shooter. One static gun emplacement, one infinite neon plain,
two target doctrines and a synthwave track the game writes for itself at load.

| | |
|---|---|
| **File** | `outrun-shooter.html` — 2,040 lines, ~112 KB, one HTML document |
| **Genre** | stationary first-person arcade shooter / survival score-chaser |
| **Engine** | three.js **r128** (cdnjs CDN) — the only external request in the project |
| **Assets** | **none.** Every texture, mesh, sprite, sound and note of music is generated at runtime |
| **Audio** | WebAudio API: synthesised SFX + a generative 16-step synthwave sequencer that speeds up as you bleed |
| **Input** | mouse (pointer lock) + 3 keys. No gamepad, no touch |
| **Persistence** | `localStorage` — per-mode top-8 score tables and audio preferences |
| **Run it** | open the file in a browser, or `python3 -m http.server` in the folder and load it (pointer-lock is happier over `http://`) |

---

## 1. Premise

You are the last gun on the outrun. The world is a wireframe plain under a bordeaux grid floor and a deep-blue
skyline, with a sun that sets on a 168-second cycle. Things come at you from the horizon — they always come from
in front, they always hunt the exact position of your gun, and only physical contact hurts.

You cannot move. You can only turn, aim, and choose what to shoot: the hostiles that are trying to touch you, or
the supply crates that keep you firing and patch your hull. Everything else is pacing.

---

## 2. Modes

Chosen on the title screen; each mode has its own high-score table and its own trash talk.

| Mode | The hostile | Art direction | Scoring |
|---|---|---|---|
| **anti-AI** | a prohibition sigil stamped over a fat white **AI** wordmark — the thing you are supposed to purge | red `#ff2d55` ring + slash, elite variant in magenta `#ff3bd4` with a second inner ring | 100 / 300 (elite) base |
| **AI SLOP** | nothing but the words **AI SLOP** in white Impact, rendered larger (×1.35) — content that arrived and needs to not | pure white text, faint chromatic bleed, magenta-tinted elite | identical values |

Both modes share every system: same spawn rules, same crates, same missiles, same hull economy. Only the target
art, the score key (`neonpurge.hs.v2.anti` / `.slop`) and the game-over quotes change.

---

## 3. Controls & flow

| Input | Action |
|---|---|
| **mouse** | aim the cross — free 360° yaw (you can turn around and look behind), pitch clamped to ±41° |
| **left click / hold** | fire the blaster (hold for continuous fire) |
| **right click** | launch a smart missile |
| **Esc** | release pointer → auto-pause |
| **M** | mute / unmute all audio |
| **R** | restart the run (any screen except the title) |
| **T** | abandon patrol / change mode → back to the title |

**Flow.** Title → click anywhere to launch (this also unlocks WebAudio, which browsers demand a gesture for) →
patrol until hull integrity reaches zero → `SYSTEM/BREACH` panel with stats, quote and score table → click to
redeploy, or **T** / *change mode* to return to the picker. Losing pointer lock during play pauses instead of
killing the run; UI clicks on mode cards, sliders and nav rows are excluded from the fire-the-gun handler.
A 1.2 s click lockout on the game-over panel stops a held trigger from instantly restarting you mid-burst.

---

## 4. Core loop

1. Hostiles spawn 190–330 units out, inside a ±26° cone around wherever your gun is **currently facing**, and steer straight at the camera with a sine wobble.
2. You shoot them for points. Chain kills to multiply them.
3. They only damage you by touching you: each contact costs **25 %** hull and clears your chain.
4. Supply crates drift toward you on the same approach vector. Shoot one to grab it — weapons stack, hull patches heal.
5. Missiles clear a crowd (and vacuum in nearby crates) when the swarm gets too dense to read.
6. Spawn rate, hostile speed, elite share and crate cadence all ramp with elapsed time until they plateau.
7. The soundtrack tightens and quickens as your hull drops, so the last 25 % sounds like an alarm.
8. At 0 % hull: game over, score recorded per mode, quote served based on how badly it went.

---

## 5. Hostiles

```
pool: 64 sprites (recycled, never allocated mid-run)
spawn: z ∈ [190, 330] ahead of the aim direction, ±0.45 rad cone, y inside the view frustum
movement: steers at the camera position with a weave of ±0.38 rad; opacity fades in from spawn distance
damage: contact only — triggers when distance < radius·0.62 + 2.2
retire: touched (leak), or drifted past 470 units without being seen
```

| Variant | Share | Radius | Speed | HP | Score |
|---|---|---|---|---|---|
| standard | rest | 4.8 – 6.2 | 11 – 16 × ramp | 1 | 100 |
| **elite** | 10 % → 34 % (only after t > 30 s) | 7.0 – 8.6 | 9 – 12 × ramp | **2** | 300 |

Elites are slower but eat two hits and shrug off a missile blast to one damage — they need a follow-up.
Splash kills (anything caught in a missile detonation) score at **60 %** of base, which keeps missile spam from
out-earning marksmanship.

---

## 6. Hull integrity

The player has no lives and no health regen timer: hull is a resource you buy with aim.

* **Start:** 100 % · **Nominal ceiling:** 100 % · **Absolute max:** 120 %
* **Contact damage:** −25 % → four clean hits from full end the run
* **Hull Patch (crate):** +10 %, instant, mint green cross icon
* **Hull Repair (crate):** +20 %, pale cyan double-cross icon
* Overhealing above 100 % is allowed and shown: the bar turns cyan→gold past the nominal tick mark.
* Repair drones are *weighted into* the crate pool when hull ≤ 75 % and weighted **much** harder below 55 %;
  they are almost entirely removed from the pool while you are healthy — so healing arrives when it matters
  instead of diluting early-game weapon uptime.

*(This replaced the original speed boosters, which read as a nothing-burger: with a static gun and stationary
world, a speed multiplier had no observable effect. Healing gave the same pickup slot a real decision.)*

---

## 7. Supply crates & boosters

Crates spawn on their own gentler cadence, drift toward the gun so they always stay reachable, and are worth
shooting even when you are at full hull — weapon time is what buys accuracy later.

| Booster | Effect | Duration | Colour |
|---|---|---|---|
| **Machine Gun** | 13.3 shots/s (0.075 s), tighter spread, cyan tracers | 180 s | `#23e9ff` |
| **Double Blaster** | 2 pellets per trigger pull | 60 s | `#9dff4d` |
| **Triple Blaster** | 3 pellets per trigger pull (overrides Double) | 45 s | `#ffd23d` |
| **Hull Patch** | +10 % hull, instant | — | `#3dffb0` |
| **Hull Repair** | +20 % hull, instant | — | `#a8fff4` |
| **Missiles** | +5 smart missiles (cap 15) | — | `#ffffff` |

**Stacking is cumulative with a hard ceiling:** picking up a weapon you already have adds its full duration,
capped at twice that booster's base duration (`left = min(max + dur, left + dur)`). HUD chips appear on grab,
show remaining seconds (plus a `+N` marker when stacked past one base duration), blink under 6 s, and fade out
on expiry — which drops the barrel count back with them.

Base blaster is one pellet every 0.26 s (~3.8 shots/s) with a slightly wider spread than machine-gun mode, so the
weapon boosters are felt immediately rather than as numbers on a chip.

**Anti-dilution weights:** Machine Gun is filtered out of the pool at >50 % chance once it has >60 s left;
missiles are filtered out at 60 % once you hold ≥9. The pool never empties (it falls back to everything).

---

## 8. Smart missiles

Right-click. Four in the tube at the start, +5 per crate, cap 15, ten concurrent in the sim.

```
launch: straight out of the crosshair, alternating shoulder, no lob
speed: 54 → 250 u/s (accel 138 u/s²)
seeker: locks the nearest live hostile inside a 0.45 rad cone at launch,
        then re-acquires anything inside 0.55 rad of the nozzle if the lock dies
unguided fallback: flies the exact line you aimed down (waypoint 320 u) — aim is never wasted
impact test: any hostile within radius·0.9 + 2.5 → detonate
detonation: kills everything within 27 u (elites take 1 dmg), vacuums supply crates within 33.75 u
also dies on: 5 s life · ground (< 1.2 y) · flying past the spawn shell + 170
```

A good missile is a crowd clear **and** a crate pull — popups call out `N TARGETS DOWN`, `N SUPPLY PULLED`, or
`N DOWN · +M SUPPLY` when it does both. Out of ammo, right-click gives a dry-click and the hint
*"no missiles — shoot supply crates"*.

---

## 9. Scoring

```
base:      100 standard · 300 elite
splash:    ×0.6 (missile kills)
chain:     mult = 1 + min(7, floor(chain/4)) × 0.5   →  1.0 … 4.5×
window:    3.2 s between kills; a fresh crate grab extends it to at least 1.2 s
resets:    any shot that hits nothing, and any hostile that touches you
accuracy:  pellets hit / pellets fired (per pellet — multibarrel counts each one)
```

The chain multiplier caps at 4.5× on a 28-kill chain, and the HUD only shows `CHAIN n ×m` from 4 kills up,
so early play stays quiet.

**Recorded per mode:** `{ score, kills, time }`, top 8 kept, sorted by score. A new #1 flags **new record** on
the panel and highlights your row in the table.

---

## 10. Difficulty ramp

Every curve is a closed-form function of elapsed seconds, so difficulty is deterministic and readable:

| | formula | floor / ceiling | plateau reached |
|---|---|---|---|
| hostile spawn interval | `clamp(1.35 · 0.986^t, 0.24, 1.35)` × jitter 0.72–1.34 | 0.24 s | t ≈ 123 s |
| extra simultaneous hostile | `clamp(t/200, 0, 0.45)`, only after 45 s | 45 % | t = 90 s |
| hostile speed multiplier | `clamp(1 + 0.012t, 1, 2.2)` | ×2.2 | t = 100 s |
| elite share | `clamp(0.10 + 0.0022t, 0.10, 0.34)`, only after 30 s | 34 % | t ≈ 109 s |
| crate interval | `clamp(8.5 − 0.055t, 2.4, 8.5)` × jitter 0.78–1.26 | 2.4 s | t ≈ 111 s |

**Run-shape timeline**

| t | what the player feels |
|---|---|
| 0 – 30 s | one hostile at a time, wide crate gaps — learn the cross and the fire rate |
| 30 – 60 s | first elites (two hits), pairs starting to arrive, music still calm |
| 60 – 120 s | ~4 hostiles on screen, everything 2× faster, crates frequent enough that aim = life |
| 120 s + | hard plateau: a hostile every 0.24 s at peak speed — the run is now about missile timing and chain discipline |

Because hull only comes from crates, the effective skill wall is *accuracy under pressure*, not reflexes: a clean
player can hold 120 % indefinitely, while a sloppy one dies in the first minute regardless of level.

---

## 11. World & art direction

The gun is fixed, so **the world is generated once and never translated** — nothing scrolls, nothing recycles,
which is what makes turning around feel like standing somewhere real.

* **Floor:** custom shader plane, bordeaux `#a8173f` → near-black gradient with a glowing cream grid, distance fade,
  horizon bloom sampled from the sky colour, and a slow shimmer (time uniform only — no UV scroll).
* **Sky:** custom gradient shader (horizon / mid / zenith / band) + additive star field with its own twinkle shader.
* **Sun & moon:** banded sun sprite with halo, rising and setting on a 168 s cycle; the moon and its glow take over
  on the far side of the arc.
* **City:** 98 wireframe blocks laid in a **full ring** around the gun (dented out of the highway corridor), each with
  crowns, occasional antennas, blinking aviation beacons and an additive window plane — so there is a skyline behind you too.
* **Peaks:** 32 wireframe mountain rings at 255–470 u; **pylons:** 13 down both sides of the highway plus a far ring of 11;
  **highway:** magenta/cyan edge lines with cream dashes running from behind the gun to the horizon.
* **Horizon:** one additive cylinder of light ringing the entire sky (not two flat bands), opacity breathing at night.
* **Palette:** bordeaux/rose ground, deep blue `#2b4bff` city, indigo `#1733c9` peaks, violet `#6a2bff` pylons,
  magenta `#ff2d95` + cyan `#23e9ff` accents.
* **Post/CSS layer:** scanlines, vignette, chromatic tint, screen flash (red on damage, mint on heal), animated hitmark,
  world-space score popups projected to DOM.

**Day/night cycle (168 s):** `DAY → DUSK → TWILIGHT → NIGHT → DAWN`, with the HUD reading out the current phase.
Palette is lerped per-frame across eight colours plus a dusk orange; fog and clear colour follow the sky, floor
colours shift warmer by day, city glow multiplies up to ×1.2 at night. A full cycle runs in under three minutes,
so a typical two-minute run crosses at least two phases.

---

## 12. Audio

All WebAudio, all synthesised, no files — and the music is generated once and played live by a look-ahead scheduler.

**Soundtrack.** A single generative synthwave piece: Am – F – Cmaj7 – G7 (i – VI – III⁺ – VII), four-on-the-floor,
16-step sequencer with pad, sawtooth bass, gated arp, kick/snare/hats, a 4th-bar fill with a dropped last kick,
and an urgency siren. Voices run through a lowpass-delay feedback bus and a procedurally generated convolution
reverb (noise impulse response).

**It rides your hull.** `intensity = clamp((100 − hull) / 100, 0, 1)`:

| hull | urgency | BPM | arrangement |
|---|---|---|---|
| 100 % | 0.00 | **96** | pad, bass, four-on-the-floor, hats on the even 16ths; arp enters after bar 1, every 3rd 16th |
| 78 – 55 % | 0.22 – 0.45 | ~103 – 112 | arp doubles to every other 16th |
| < 55 % | > 0.45 | > 112 | open hats join on 8 and 16, the bar-4 fill opens up |
| < 50 % | > 0.50 | > 119 | arp on every 16th, delay wet climbing toward max |
| < 38 % | > 0.62 | > 134 | urgency siren stabbed on beat 3 |
| 0 % | 1.00 | **150** | full density, longest delay tail |

Tempo changes are smoothed (`bpm += (target − bpm) · 0.3`) and the delay time tracks the beat, so acceleration
sounds like a record being pushed rather than a jump-cut. Healing audibly calms the band back down.
The whole drum-and-bass bed runs through a sidechain-style pump: each kick drops the shared voice bus to 50 %
and lets it recover over ~0.32 s, which is where the "horizon pulse" in the mix comes from.

**SFX.** laser (single + machine-gun variants), hit, boom, booster arpeggio, missile launch, seeker lock beep,
hull-patch chime, leak/damage thud, game-over descending stack, run-start riser — built from oscillators plus a
filtered noise buffer, with a shared convolver reverb send.

**Mix & prefs.** Master → SFX bus / music bus, each with independent gains, feeding a shared convolution reverb send. Music on/off toggle plus
music and SFX sliders live on **both** the title and pause screens; `M` mutes anywhere. Everything persists in
`localStorage['neonpurge.audio.v1']`. The scheduler is defensive: notes are wrapped so one bad voice can never stall
the clock, exponential ramps refuse zero, and after six consecutive failures it pulls its own plug with a single
console error rather than spamming.

---

## 13. HUD & screens

**In-run HUD** (all DOM over the canvas, no rendered text):
top-left score, hostiles down and an integrity bar drawn to 120 % with a nominal-hull tick; top-right patrol time,
live accuracy and cycle phase; centre chain readout; bottom-left missile pips (8 shown + `+N`) and the current weapon
name (`machine gun · triple blaster`); bottom-centre booster chips with countdown bars; an SVG crosshair that pulses
on every shot.

**Title.** Wordmark, control legend, two mode cards wearing the *actual* in-game sign art (the canvas textures are
exported to `<img>` via `toDataURL`), three rule lines that rewrite themselves per mode, audio controls, the
per-mode top-8 table and a *click to launch* call. The title screen runs a slow attract-mode spawn so the plain is
never empty behind the panel.

**Pause.** Auto-triggered by releasing pointer lock; carries the full audio control block plus
*abandon patrol / change mode **[T]**.*

**Game over — `SYSTEM/BREACH`.** Subtitle rewritten per mode, four stats (score / kills / time / accuracy), a
`new record` flag, the score table with your row highlighted, *click to redeploy* and *change mode **[T]***. Above
that sits a **trash-talk quote**, chosen from three tiers × two modes (18 total) and templated with your own numbers:

> tier: `high` if score ≥ 9000 or kills ≥ 55 · `low` if you survived under 40 s · `mid` otherwise

*"{hits} sigils down, {acc}% honest accuracy. the swarm calls that a warm-up run."*
*"you were out-produced. by a machine. that was, admittedly, the entire point."*

---

## 14. Technical notes

| System | Implementation |
|---|---|
| Entities | fixed pools — 64 hostiles, 26 crates, 10 missiles, 48 beams, 24 shockwave rings, 32 flashes; recycled by flag, zero allocation per frame |
| Particles | one `ShaderMaterial` point cloud, **1500** particles with per-point colour/size/alpha, gravity and drag per burst |
| Hit detection | ray-vs-sphere (`pickAlong`) from the camera down each pellet direction — crates are checked after hostiles so you can't shoot through a crate to a hostile |
| Missiles | separate integrator with seeker-head cone acquisition, exponential steering lerp, and a contact test each step |
| Shaders | sky gradient, star twinkle, grid floor with horizon bloom, particle points — all inline GLSL |
| Textures | every sprite is drawn into an offscreen `<canvas>` at load: ban sigil, AI SLOP wordmark, elite variants, six crate designs (with a 3D-ish bevel + icon), glow and ring radials, window grids, horizon band gradient |
| Camera | FOV 72 with recoil/kick-driven kick-in, exponential smoothing on yaw/pitch, roll from yaw velocity, shake as decaying noise on position + rotation |
| Gun view-model | wireframe neon tube rig whose barrel count changes with the active blaster; muzzle flash sprite tinted per fire mode |
| Perf guards | pixel ratio capped at 2, `autoClear = false`, additive materials with `depthWrite: false`, dt-based frame-rate independence |

---

## 15. Design rationale (the short version)

* **A stationary shooter needs pressure that can't be dodged.** Hence: hostiles home on the gun and only hurt on contact.
  The threat is *time-to-contact*, and the only answer is shooting faster and more accurately — which is the verb we want.
* **Free yaw, forward-only spawns.** Being able to spin all the way around makes the world feel physical and rewards
  turning to check; keeping spawns in a forward cone keeps it fair. Turning around costs you seconds of threat awareness.
* **Crates are the whole economy.** Weapons, ammo and healing all arrive through the same "shoot the thing that helps you"
  verb, so there is never a dead pickup, and the anti-dilution weights make crates feel context-aware.
* **Score = kills + survival**, but with an accuracy-based chain multiplier so a short clean run can beat a long sloppy one.
* **The music is the health bar.** Reading a number is slower than feeling the tempo climb.

---

## 16. Changelog & current state

**Shipped features (most recent arc)**
* Hull economy replacing speed boosters: `+10 %` / `+20 %` patches, 120 % ceiling, −25 % per contact, hull-weighted crate pool.
* Missile rework: fly the aim line, seeker acquisition, detonate on contact, kill clusters **and** pull in nearby supply crates.
* *Change mode / back to title* navigation on both pause and game-over (`T`), with a click lockout so dying mid-burst doesn't bounce you out.
* Generative outrun soundtrack with hull-driven tempo/arrangement intensity; music + SFX toggles and sliders on title **and** pause, persisted.
* Game-over trash talk (18 quotes across two modes and three performance tiers) and per-mode persistent score tables.
* 360° world generation (city ring, pylon ring and peaks behind the gun), reduced hostile bloom, mode cards wearing real sign art.

**Bug fixes worth recording**
* `TypeError: Cannot set property Q of #<BiquadFilterNode>` — `bp.Q = q` in the SFX noise voice; `Q` is an AudioParam exposed by getter only. Now `bp.Q.value`. This had been silently killing every noise-based SFX call.
* Game-over panel not appearing — the screen is now raised **first**, before any stat/board/quote work, which is itself wrapped in `try/catch`; a watchdog in `update()` re-fires `gameOver()` if hull is ≤ 0 while still playing.
* `exponentialRampToValueAtTime` throwing on a target of 0 in the music scheduler — every voice refuses zero velocity and clamps ramp targets to `1.2e-4`, plus per-note error isolation with a hard stop after repeated failures.

**Possible next steps** (not implemented)
* Difficulty/arcade presets, or an endless "cycle" modifier that doubles cycle speed for score.
* A kill-streak missile bonus drop to make the 120 s+ plateau more interactive.
* Optional assist: aim magnetism / hitbox generosity toggle for controllers and trackpads.
* WebHID gamepad aim, since mouse-look is currently the only fine motor option.
