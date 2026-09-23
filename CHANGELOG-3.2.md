# ChugCraft 3.2 — Flow, Build & Moonlight

## Brighter nights (requested during this upgrade)
- Night visibility now defaults to 75%, including when loading older settings that have no such option.
- Options → Video → Night visibility: 0–100%. The new moonlight lift and nighttime-only shadow gamma make unlit terrain readable; daytime lighting is unchanged.
- Works alongside global Brightness and all three shader packs; settings persist. Gameplay sunlight remains unchanged, so this is not a cheat that disables hostile spawning.

## Actual water and lava flow
- Added saved block-level states, downhill priority, bounded horizontal spreading, walls/containers, source removal and flow recession, reactivation after wall/floor edits, chunk reload resumption, and per-frame processing limits.
- Water reaches seven horizontal cells; lava three, at a slower tick rate. Waterfalls fall down and fan out on a floor.
- Sources touching water make obsidian; flowing lava makes cobblestone. Contact works regardless of placement order, with a fizz sound and steam particles.
- Empty buckets now raycast sources through flowing liquid rather than looking straight through all liquids or getting blocked by the current in front.
- Flowing liquid affects player wetness/lava, dropped items, farming hydration and aquatic mob water checks. Shallow water does not falsely submerge the player's head.

## Cottage building pack — 15 new inventory entries
- Birch/spruce doors, retaining their material and orientation after toggling, breaking and reload.
- Connected glass panes, plus ocean-blue, amber and rose panes and solid glass.
- Oak fences, gates and trapdoors with USE interaction; warm lanterns.
- Two original decorative blocks: Sunburst Mosaic and Midnight Basalt Tiles.
- Survival recipes, Creative Building entries and authored textures for every addition.
- Shared thin collision shapes for windows, doors, fences and furniture; the renderer connects panes and rails to adjacent blocks.

## Example world
`examples/Moonlit-Cottage.chugcraft.json` is a synthetic Creative showcase, not a copy of a user's save. Import it through Singleplayer → Import World to explore the stained-window cottage, lantern-lined mosaic path, waterfall fountain and contained lava pool.

## Compatibility and limitations
World save schema stays version 1; older saves load. New block IDs are not compatible with old releases: export backups before upgrading and never downgrade a 3.2 world. No third-party Minecraft assets are added. This is a simplified voxel simulation, not full Minecraft parity. See ROADMAP.md and TEST-REPORT.md for scope and remaining gaps.
