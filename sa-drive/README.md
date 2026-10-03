# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and Oxlint's TypeScript related rules in your project.


### Night drive / pursuit

- WASD / arrows: forward throttle, brake and steering. Hold X for reverse.
- Hands: rotate both palms like a wheel to steer. Open at least three fingers on
  each hand for 160 ms to select reverse; curl fingers for 160 ms to return to
  forward. Steering remains independent. Missing hands remove throttle and brake.
- 1 / 2 / 3: Alamo, River Walk, Tower of the Americas.
- R: restart the player, police, distance counter and route without reloading.
- F3: render FPS, draw calls, triangle count and tracking diagnostics.

Gear changes brake through zero; reverse is capped at 30% of the current speed
limit. Hand-mode forward throttle reaches normal cruising speed for pursuit.
The police cruiser starts approximately 185 road meters behind the player after a four-second grace period, follows A* waypoints,
replans every 0.45-0.75 seconds, and stops the game on physical vehicle contact.
Building collision stays active in both gears and for the police. A clear final
approach within the road boundary lets police catch cars stopped on the shoulder.

Navigation uses the exported OSM road network, built once on map load with
shared intersection vertices and building-clearance checks. The supplied export
has no one-way metadata, so its roads are bidirectional; the graph also supports
oneway metadata when present. Roads retain their existing widths and centerlines.

The beveled arrow follows the road route with 20-55 m speed-sensitive lookahead.
Distance is remaining driving distance. The mint-green world ribbon (16% of road width) and minimap read
one shared route; wrong turns trigger throttled recalculation. Amber minimap pins
show the actual landmarks, mint endpoint rings show drivable access, and red/blue
markers show the police. Landmarks in pedestrian areas use the nearest reachable
road access, explicitly labeled at arrival; guidance never points through buildings.

Validation:

```sh
node scripts/validate-driving.mjs
node scripts/validate-gameplay.mjs
node scripts/validate-rear-pursuit.mjs
node scripts/validate-polish.mjs
npm run lint
npm run build
```

Tests cover hand openness under rotation, debounce and tracking loss, reverse
speed/gear changes/steering, reversing out of a crash, road-only route direction
(including a destination in the opposite direction), lookahead turns, route
distance, one-way A*, OSM building clearance, police road spawn, stopped/crashed
player capture, moving pursuit through intersections, rerouting and restart.

Chrome smoke test at 1440x900 verified the route UI, keyboard reverse, caught
controls freeze and restart. The short local driving sample reported 60 FPS and
45 draw calls with no runtime errors. Hardware performance varies. Live webcam
finger detection/calibration still needs a hands-on check. The build retains a
large-chunk advisory (about 350 kB gzip).

Initial spawns align to the chosen route with police behind; changing destinations
before moving during the grace period also aligns the start. The River Walk uses
the OSM river centerline, a stencil-cut channel, water at -2.95 m, pedestrian
walkways at -2.15 m, retaining walls, and merged stone bridges and props.
Procedural landmark meshes replace their generic OSM buildings and collision
footprints. The Alamo faces west; the Tower has a fluted shaft and tiered crown.


### Rear glance and pursuit difficulty
Hold a clear thumbs-up with either hand for 200 ms to look behind. Curl the
other four fingers and point the extended thumb upward. Release for 160 ms to
return. Camera position and rotation ease between views in roughly 200 ms.
Both hands can remain tracked for wheel steering. A glance holds the current
forward/reverse gear; it does not change steering or throttle. Tracking loss
releases the camera, and restart clears the gesture.

Police tuning is centralized in src/config/policeConfig.js: 94% cruising speed,
107% temporary boost against a slow/stopped player, 5.5 m/s2 acceleration,
88% moderate-turn speed and 74% sharp-turn speed. Sharp turns also introduce a
short hesitation with bounded yaw speed. Boosts last four seconds with eight seconds of recovery; a distant cruiser may also boost, capped at 107%. Close-range catch-up ends when the player resumes speed.
Valid initial pursuit distance is 170-220 m, normally 185 m, with four seconds
of grace. The 0.8 difficulty label is a tuning target, not a measured catch rate.

The latest browser check verified smooth rear/forward transitions, a police
car behind the camera's rear-facing direction, steering in reverse during a
rear glance, caught state and restart; sampled 60 FPS and 45-50 draw calls.
Automated gesture tests use synthetic landmarks; live webcam testing remains
a manual check across lighting conditions and hand shapes.

### Environment and branding polish
Muted green ground uses a lightweight procedural color variation shader. Trees
remain instanced; shrubs, planters, lamps and benches use merged meshes. Road
rectangles maintain constant widths with small rounded outside joins instead of
sample-spacing-dependent strip normals. Pedestrian paths have warm paving.
Buildings have seeded facade styles, denser lit/dark windows, roof setbacks and
cornices. Landmarks have selective merged detail, an Alamo plaza/fence with a
walk-in gate, and river bridges trimmed to the channel with shallow arches.

The supplied, unchanged WebP logo is in public/branding/rowdy-logo.webp. It is
shared by roof/door badges and up to six spaced route-side facade signs. Sign
selection runs only on route changes; both sign faces and frames are merged.
No external model packs or large texture sets were introduced.

The polish browser sample settled at 60 FPS / 53 draw calls after initialization;
initial shader/geometry warm-up was below target. These are local desktop results,
not a guarantee for mobile or webcam inference. Rear camera, reverse steering,
catch and restart passed again. Synthetic gesture tests do not replace a live
webcam check. Difficulty is a tuning target, not a measured player catch rate.

### Performance correction
See [PERFORMANCE.md](PERFORMANCE.md) for profiling, confirmed bottlenecks, measured
results and verification limits. Run `node scripts/validate-performance.mjs`
alongside the existing validation scripts. Gameplay and artwork are preserved.
