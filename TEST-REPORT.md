# ChugCraft 3.2 — release verification

## Results

| Suite | Result |
|---|---:|
| Core inventory/crafting/backup rules | 21 / 21 |
| Farming and husbandry rules | 16 / 16 |
| New fluid/building/night rules | 22 / 22 |
| 3.2 mobile gameplay, liquid flow, building, night visibility, persistence | 34 / 34 |
| Existing 3.0 browser gameplay regression | 42 / 42 |
| Existing 3.1 browser gameplay regression | 40 / 40 |
| Desktop graphics + touch regression | 36 / 36 |
| Static server GET/HEAD/malformed URL/method checks | 4 / 4 |

All source JavaScript passed syntax checks. The final 3.2 browser run reported no page or console errors. Individual PASS lines are counted, not the trailing “ALL SMOKE TESTS PASSED” summary. The mobile-only subset overlaps the 36 graphics/touch checks and is not counted again. Older release reports remain historical.

## Night visibility — latest requested fix

Defaults to 75%, with a 0–100% control under Options → Video. Automated checks confirm a brighter moonlight value, a nighttime-only shadow lift, zero daytime difference, unchanged gameplay sunlight, persistence after reload and compatibility with all shader-pack selections. Settings from earlier versions inherit the 75% default if the key is absent.

Screenshots compare the same seeded Creative cottage at midnight with visibility 0% and 75%, using the same camera, crop and settings. Mean 8-bit grayscale luminance in crop (240, 175, 780, 365): **32.87 → 47.33**, about **44% brighter**. This is an image measurement for this scene, not a universal screen/device guarantee. The comparison is in `screenshots/night-before-after.png`.

## Gameplay checks

- Water spreads seven cells, lava three and more slowly. Both are contained by walls. Removing a wall resumes flow; blocking a waterfall redirects it.
- Sources drain their unsupported flow on removal; remaining sources keep their streams. No upward flow, furniture overwrite or mutation into unloaded columns. Work per frame is capped; stable pools stop scheduling.
- Water/lava reactions work in either order; source lava becomes obsidian and flowing lava becomes cobblestone, without diagonal reactions.
- Native mobile USE places a water bucket, sees its flowing neighbours, picks up the source through the current, and drains the basin. Actual lava placement and live contact reactions are tested.
- Thin connected panes, closed door panel collision, all three door woods, both halves toggling, gates/trapdoors via mobile USE, loaded mesh creation, saved level IDs and material-preserving reload.
- Shallow flowing water wets feet without submerging the head. Flowing lava is recognized by player environment checks.
- All 15 new building-item recipes match their actual grids without being shadowed by an earlier recipe. All block textures have authored painters.
- Synthetic example world passes the real backup validator. Source-fed fountain and building blocks survive reload. Repeated source edits and menu switching remain playable.

## Bugs caught and changes made during testing

1. Empty-bucket selection originally stopped at the flowing cell in front of a source. Changed to source-aware selection; placement, pickup and recession then passed in-browser.
2. An early nighttime shadow-lift patch was reset by the fog-range helper. Removed the accidental reset, added a direct regression assertion and compared actual screenshots before packaging.
3. The old 3.1 fishing fixture assumed there could be no other item entities anywhere in the world. It now checks the actual early-reel result: no catch stat increase and no rod wear. Its wolf reload assertion now selects the tamed wolf rather than the first possibly wild wolf. This avoids unrelated entities invalidating the tests; the taming and persistence assertions remain intact.

## Scope and limitations

Tests ran in headless Chromium with software WebGL and simulated mobile touch, plus Node rule tests. Desktop/mobile automation is not real iOS/Android hardware validation, long-duration thermal/storage testing or a complete Survival playthrough. Fluids are a bounded voxel model: no pressure, no infinite-source formation, no waterlogging, no directional currents and no full Minecraft parity. New blocks require 3.2 or newer; do not downgrade upgraded worlds. See ROADMAP.md.

Evidence is retained in `tests/results/release-3.2`. Reproduction commands are in `tests/README.md`.
