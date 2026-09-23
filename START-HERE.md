# ChugCraft 3.2 — Flow, Build & Moonlight

An original single-player browser voxel game. This is a more complete playable release, not Minecraft or full Minecraft feature parity.

## New in 3.2 — and nights are no longer pitch black

**Night visibility defaults to 75%.** Options → Video → **Night visibility** raises moonlight and lifts nighttime shadows separately from daytime brightness. Use 100% for more visibility, or 0% for the original darkness. This display control does not change the gameplay sunlight value or suppress hostile spawns. The three shader packs still work.

- **Water/lava flow:** buckets create sources that flow down, then spread around obstacles (water seven horizontal cells, lava three; lava is slower). The surface height decreases as streams spread. Removing or covering the source makes unsupported streams recede. Water + lava source makes obsidian; water + flowing lava makes cobblestone. Works in either placement order.
- **Doors and windows:** oak doors improved with thin-panel collision; new birch and spruce doors, connected glass panes, ocean-blue/amber/rose panes and glass. Six matching planks craft three doors. Six glass blocks craft sixteen panes. Use doors with the mobile USE button or desktop right-click.
- **More building:** connected oak fences, opening gates, trapdoors, warm lanterns, original sunburst mosaic and midnight basalt tiles. Everything has survival recipes and Creative Building entries.
- **My creative touch:** `examples/Moonlit-Cottage.chugcraft.json` is a ready-to-import Creative cottage showcase with stained windows, a mosaic path, lantern fencing, a working fountain and a separate contained lava pool. Singleplayer → Import World creates a separate save; it does not replace your worlds.

### Important flow limits

Flow is a deliberately bounded voxel simulation, not full fluid physics. It follows loaded chunks, does not create infinite two-source water, does not waterlog stairs/panes/doors, and does not erode terrain. Open doors/gates still block fluid (no waterlogging). Source and level IDs save normally. Water and lava spread in all dimensions with the same ranges. Deep pools are not pressure-equalized. Back up worlds before upgrading: **3.2 saves contain new block IDs and must not be reopened in 3.1 or earlier.**

## Start playing

1. Extract the whole ZIP; keep the folders together.
2. Install Node.js if you do not already have it.
3. Double-click `PLAY-WINDOWS.bat` on Windows, or run `PLAY-MAC-LINUX.command` on macOS/Linux. Alternatively run `npm start` in this folder.
4. Open `http://localhost:8080`. Do not double-click index.html: browser modules need HTTP.

Three.js is bundled. No `npm install` and no internet connection are required to play on the computer hosting it. A current WebGL2 browser is required.

### Play on a phone

Run the server on a computer on the same trusted Wi-Fi, then open `http://YOUR-COMPUTER-LAN-IP:8080` on the phone. Allow the local server through your firewall if needed. Alternatively put the complete game folder on a static website. Do not expose this development server directly to the public internet.

Landscape is recommended. Portrait controls also fit. Start with **Options → Graphics: Potato or Low** if the phone struggles. The three existing shader packs remain selectable. Audio begins after you tap the page; check the browser's mute setting if silent.

## Mobile controls

- **Left thumb:** floating movement joystick. Push forward fully to sprint.
- **Drag elsewhere:** aim the centre crosshair.
- **Tap the world:** attack an aimed mob; otherwise place/use. A villager trade uses the explicit USE button instead.
- **HIT:** hold to mine or repeatedly attack.
- **USE:** interact/place; HOLD to eat, drink, block with a shield, or draw a bow. Release to fire.
- **Up / down:** jump / toggle sneak. Double-tap jump to fly in Creative.
- **SWAP:** swap main and offhand items.
- **Inventory / Q / II:** inventory, drop one held item, pause.
- **Hotbar:** tap any of the nine slots.

On desktop: WASD move, Space jump, Shift sneak, Ctrl sprint, left mouse mine/attack, right mouse use, 1–9 or wheel hotbar, E inventory, F swap hands, Q drop, Esc pause. Bindings remain configurable.

## New survival progression

### Enchanting

Craft an **Enchanting Table** from 4 obsidian, 2 diamonds and 1 book. Place it, then Use it. Select a tool/armor item from your bag; unequip armor first.

| Next tier | Minimum level | Levels spent | Lapis spent | Bookshelves |
|---|---:|---:|---:|---:|
| I | 3 | 1 | 1 | 0 |
| II | 6 | 2 | 2 | 5 |
| III | 9 | 3 | 3 | 10 |

Bookshelves are two blocks from the table, at table height or one block above it, with an air gap. The UI counts valid shelves.

These are ChugCraft's deterministic upgrade bundles, not vanilla's complete enchantment system. Swords gain damage, mining tools gain speed, axes gain both, armor gains protection. Each tier adds 50% of base durability. Upgrading preserves the percentage of wear; it does not repair for free. Upgrades survive saves, chests and item drops.

### Repairs

Craft an **Anvil** from 3 iron blocks and 4 iron ingots. Use it to repair a selected damaged item by up to 25% of its maximum durability, for 1 level plus 1 matching material. Enchant tier is retained. The UI shows the required material. This release does not include item renaming or combining enchantments.

### Potions

Craft a **Brewing Stand** with 1 blaze rod above 3 cobblestone. Smelt sand into glass, then craft 3 Glass Bottles from a V of 3 glass blocks. Aim at water and Use a bottle to fill it.

Find nether wart in newly generated fortress chests/gardens. Wart can be replanted on soul sand; this release uses simple immediate plants rather than timed growth stages.

At the stand, first mix **water bottle + nether wart + blaze powder → awkward potion**. Then choose:

| Potion | Ingredient added to awkward potion | Extra fuel | Effect |
|---|---|---|---|
| Speed | Sugar | 1 blaze powder | +20% movement, 180 s |
| Strength | Blaze powder | 1 additional blaze powder | +3 melee damage, 180 s |
| Fire Resistance | Magma cream | 1 blaze powder | Blocks fire/lava damage, 180 s |
| Regeneration | Ghast tear | 1 blaze powder | 1 health every 2 s, 30 s |
| Healing | Glistering melon | 1 blaze powder | Instantly restores 4 health |

Magma cream: slimeball + blaze powder. Glistering melon: melon slice surrounded by 8 gold nuggets. Hold USE/right mouse for 1.5 seconds to drink; you get the glass bottle back. Timed effects appear on the HUD and persist across saves, but clear on respawn. Re-drinking refreshes a duration rather than stacking it.

Brewing is instant and one bottle at a time in this release. Splash/lingering potions and expanded effect types are not included.

### Villagers

Aim at a villager and press USE/right mouse to trade. The existing trading screen is now connected to gameplay. Trades are a small fixed set: wheat/coal for emeralds, emeralds for bread/lapis/an iron pickaxe. No professions, leveling or restocking yet.

## Save safety

Worlds remain in browser IndexedDB under the original storage name for compatibility. **Use the same browser and website address/port as before** to see older saves. Clearing site data deletes local worlds; another device/browser does not automatically have them.

- Pause → **Download World Backup** saves first and downloads `.chugcraft.json`.
- World list → **Export Backup** exports the selected saved world.
- World list → **Import Backup** validates a backup and adds a separate copy; it never overwrites an existing world.
- Keep a backup before changing browsers/hosts or trying an older game version. V3 saves contain new item/block IDs and should not be opened in v2.
- If saving fails, a warning appears and Save & Quit keeps the world open. Free storage/check browser permissions before closing the tab.

## Tests and limitations

`npm test` runs the included dependency-free core test suite. Browser test sources and release results are under `tests/` and `TEST-REPORT.md`. Browser automation uses Playwright and requires that separately installed for reruns; it is not a gameplay dependency.

Automation is not a guarantee of all-device performance or a substitute for testing real Android/iOS hardware. See `ROADMAP.md` for remaining gaps, including multiplayer and redstone.
