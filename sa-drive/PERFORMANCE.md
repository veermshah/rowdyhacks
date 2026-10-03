# Performance regression investigation

Compared the pre-polish revision 75247fc with 46d7235 and the fix using Chrome,
1440 x 900, the same initial road position, actual OSM data, CPU sampling,
WebGL disjoint timer queries, frame intervals, and isolated rendering tests.

## Confirmed costs

- Route branding scanned every facade of 898 buildings against every route
  segment synchronously during a React update. The 469-point River Walk route
  took 155-190 ms to select six signs; the 344-point Tower route took 112-129 ms.
  This caused main-thread stalls on destination changes and reroutes.
- Submitted geometry rose from 664,948 triangles before polish to 1,359,680.
  Dense windows included an invisible copy inside every opaque building, and
  the global building meshes submitted off-screen blocks as well.
- Each route calculation ran as many as four largely overlapping A* searches.
  Higher police replanning frequency made this repeated work more relevant.

Draw calls rose only from 45 to 53. Lighting/shadow counts were not the main
regression. The only added image is the 292 KB logo; no model pack was imported.
Steady-state React updates did not rebuild city geometry every frame.

## Limited fixes

- Cache static facade data and index the route's 45 m sign corridor. Preserve
  sign ordering, spacing, appearance and exact placements.
- Remove interior window copies using footprint winding. Keep all exterior
  windows, colors, roof shapes, materials and landmark meshes.
- Use the installed Three.js BatchedMesh to cull blocks while retaining two
  building material submissions. Browsers without multi-draw use larger blocks
  to limit fallback draw calls. Dispose/recreate batches safely during React
  StrictMode effect replay.
- Combine legal start/end road nodes into one A* search with a virtual source
  and target; keep direction restrictions, blocked edges and road distances.

The initial grass-shader ablation looked promising, but repeated comparisons
were inconsistent. The grass change was reverted. A regular mesh-per-block
prototype also added too many draw calls and was replaced before shipping.
No gameplay tuning, control changes, visual redesign or new assets are included.

## Final local measurements

| Metric | Regressed build | Fixed build |
| --- | --- | --- |
| Draw calls, initial view | 53 | 52 |
| Submitted triangles, initial view | 1,359,680 | 758,842 |
| River Walk sign selection | 155-190 ms | 2.5-7.5 ms |
| Tower sign selection | 112-129 ms | 0.9-1.7 ms |
| 40 actual-map route calculations | 213 ms total | 69 ms total |

The final instrumented frame sample had a 16.6 ms median and 17 ms p95. GPU timer
results varied with host load (one fixed sample: 11.6 ms median versus 14.2 ms
regressed); these are not hardware-independent guarantees. An earlier loaded
run showed slower frames, so the old HUD-only 60 FPS check was insufficient.

Validation includes exterior windows with both footprint windings, route-sign
cache/corridor behavior, 60 directed/blocked graph comparisons with an exhaustive
reference, 40 real-map route comparisons, and ten exact old/new sign-selection
comparisons. Run all scripts under scripts/validate-*.mjs plus lint and build.
Browser smoke checks cover reverse steering during rear view, return camera,
police catch and restart; landmark/minimap visuals are checked separately.
Live webcam inference and gesture recognition still require a physical camera
check; synthetic landmark tests verify control logic without claiming that.

A Chrome run with WEBGL_multi_draw deliberately disabled exercised the renderer
fallback: 60 FPS sample, 78 calls, 870,028 triangles, no runtime errors.
