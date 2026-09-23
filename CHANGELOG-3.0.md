# ChugCraft 3.0

## Added

- Enchanting Table: deterministic three-tier tool/armor upgrades, level/lapis costs, bookshelf checks, visible purple item highlights, wear-preserving upgrades.
- Anvil: paid durability repair, preserving enchant tier.
- Brewing Stand: water and awkward bottles, five working potion effects, original bottle art, timed effect HUD and effect persistence.
- Crafting recipes and original station textures; nether wart supply in fortress chests and gardens.
- Mobile HIT, held USE and SWAP controls; functional eating, potion drinking, bow charging/release and shield holding.
- World export/import and pause-menu backup download. Imports validate file contents and create a new world ID.
- Last-death coordinates; dead-save reload shows the death screen instead of a zero-health walking player.

## Fixed

- Gold recipe duplicated material: 9 nuggets now yield 1 ingot, not 9; reverse conversion added.
- Full inventory could lose cursor/crafting-grid contents on close: overflow now drops into the world.
- Shift-crafting could insert part of the result without consuming ingredients: capacity is checked before crafting.
- Paid trades now use atomic transactions, including full-bag cases.
- Transient crafting-table/cursor contents are included in autosave snapshots without closing the UI.
- Saved item drops are now actually restored on reload, with remaining lifetime.
- Save completion waits for the IndexedDB transaction to commit. Failures warn and prevent Save & Quit from discarding the session.
- Touch cancellation no longer triggers a world action; pause/hide/focus loss releases touch inputs.
- Floating joystick position now uses the correct coordinate origin.
- Held actions reset when changing equipment; opening a container cannot continue placing the previously held block.
- Main-hand shield use and offhand food holding now have working paths.
- Real title artwork now reads CHUG CRAFT instead of the old CRAFT VERSE canvas logo.
- Touch sliders support dragging.
- Workshop panels scroll within the viewport, and the HUD no longer covers their slots.
- Villager trade UI is reachable through Use; entity picking respects solid walls.
- Tool-break and nearby furnace sounds are connected to gameplay.
- Ambience samples are throttled to roughly 10 updates per second instead of scanning every frame.
- Static server handles malformed URL encoding without crashing.

## Retained

Original terrain, three dimensions, existing dragon progression, crafting/recipe book, furnaces, inventory/armor, beds, villages, original generated textures/audio, graphics presets from Potato to Ultra, three shader packs, desktop controls and v2 mobile hotbar fixes.

This is a ChugCraft-specific survival release, not full Minecraft parity. Read START-HERE.md for the exact rules and ROADMAP.md for incomplete systems.
