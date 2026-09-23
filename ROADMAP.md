# What is still unfinished

The earlier broad Minecraft checklist incorrectly described some existing systems as completely absent. Source inspection confirms existing beds/sleep/spawn, village generation, Nether fortresses, a dragon route, recipe-book UI, advancements, commands, and basic survival stats. V3 extends the game; it does not recreate all of Minecraft.

## Larger missing systems

- Multiplayer/server-authoritative world simulation.
- Redstone networks, pistons, observers, hoppers and automated item transport.
- Boats, minecarts, rails and rideable mounts (horses). Wolves can be tamed as of 3.1; no other pets yet.
- Full enchantment choices, enchanted books, curses, anvil combining and custom names (anvil renaming needs per-item metadata the save format does not carry yet).
- Vanilla-style timed three-bottle brewing, splash/lingering potions and all effect types.
- Villager leveling, restocking, raids and village simulation. 3.1 adds five fixed professions with five trades each, not the full vanilla trade tree.
- Full mob/biome/structure catalogue, a Wither fight, End cities and elytra.
- Persistent projectiles. 3.1 saves and restores mobs (including babies, pets, wool and professions); arrows and thrown items in flight are still dropped on save.
- Modern world-height/terrain parity: the existing 128-block world model remains unchanged.
- Complete maps, note blocks/music discs, treasure fishing and enchanted fishing loot, and the full crop list (carrots, potatoes, beetroot and melons/pumpkins still have no growth stages). Having an item in the registry does not mean its entire Minecraft mechanic exists.
- Resource/data-pack formats and mod compatibility.
- Alternative aim modes and full keyboard navigation through every panel. 3.1 adds sound subtitles with direction arrows.

## Current simplified mechanics

- Enchantments are fixed I/II/III bundles, not individually chosen enchantments.
- Anvils only repair; they do not rename or merge items.
- Crops grow by random ticks near the player only; fields left far behind do not grow while you are away.
- Babies, love mode and breeding cooldowns use fixed timers; there is no genetics, no sheep colours and no chicken eggs.
- Brewing is instant and one bottle per transaction.
- Villagers offer a fixed, unlimited set of trades per profession, with no levelling or restocking.
- Save/import remains local to a browser. Export a file to transfer worlds between devices. Reverting a v3 save to an older release is unsupported.
- The web server is a local development/static server, not a production multiplayer service.

## Verification still needed

- Real iOS Safari and Android device testing, including multi-finger gestures, OS interruption and thermal throttling.
- A full unassisted Survival run from a new world through the dragon on the final build.
- Long-duration storage pressure, tab crash recovery, large-world and dimension-travel stress testing.
- Performance profiling on low-memory hardware. Graphics presets reduce workload; no universal frame-rate guarantee is made.

These entries are an honest remaining-work list, not features claimed complete in 3.1.


## 3.2 status update

Delivered: loaded-chunk water/lava flow and recession, source pickup through currents, liquid contact reactions, two extra door woods, thin connected/stained windows, fences/gates/trapdoors/lanterns, decorative tiles, and brighter nights with a separate visibility slider.

Still not implemented: pressure-driven fluids, infinite-water source formation, directional current forces, lava fire spread, waterlogging, sloped/interpolated fluid surfaces, upper-half trapdoor placement, double-door pairing, full stair geometry and building blueprints. Partial-block ray selection still uses the whole block's selectable space; movement collision for new shapes and doors is thin. Large fluid builds need performance testing on real phones. Previous multiplayer/redstone/anvil and content-catalogue gaps remain.
