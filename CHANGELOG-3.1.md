# ChugCraft 3.1 — Farming, Husbandry & Fishing

This release takes on the items ROADMAP.md listed as missing after 3.0 that could be finished and tested in full. Everything below is exercised by automated tests (see TEST-REPORT.md); the roadmap keeps the honest list of what is still not here.

## Farming that actually grows

- Wheat now has four visible growth stages and nether wart three. Seeds plant only on farmland, wart only on soul sand; a crop whose soil disappears pops off as seeds.
- A hoe on grass, dirt or a path makes farmland (wears the hoe). Farmland with water within four blocks grows crops about three times faster and stays wet; dry farmland reverts to dirt when nothing is planted on it.
- Oak saplings are a real block. Planted on grass or dirt they grow a 4–6 tall oak with a canopy when there is room; under a low roof they simply wait.
- Sugar cane and cactus grow to three tall. Bare dirt beside grass grows back into grass in daylight.
- Bone meal is now an item you can use: one guaranteed growth step on a crop or sapling, or a sprinkle of tall grass and flowers on a lawn. Aiming at the soil under a crop feeds the crop.
- Growth is driven by a random-tick scheduler that samples ~4000 blocks a second within ±40 columns of the player, only in loaded chunks. New `/gamerule randomTickSpeed true|false`.
- New advancement: *A Seedy Place*.

## Animals you can keep

- **Breeding**: cows and sheep eat wheat, pigs eat carrots/potatoes/beetroot/wheat, chickens eat seeds. Two animals in love within eight blocks walk together and make a baby (small model, no drops, grows up in ~200 seconds, faster when fed). Parents get a breeding cooldown; you get 1–7 XP. Stat `animalsBred` and advancement *The Parrots and the Bats*.
- **Taming**: a bone tames a wolf one time in three (the bone is used either way). Tamed wolves get 20 hp, never turn hostile on you, follow you, sit/stand when used with a non-food item, attack hostile mobs that come within ten blocks of you, teleport back if left more than twenty blocks behind, and are healed by meat. Advancement *Best Friends Forever*.
- **Shearing**: shears on an adult sheep drop 1–3 wool and wear the shears; the wool regrows after ~90 seconds (a shorn sheep is drawn darker).
- Hearts particles, a shear sound and a hoe sound were added.

## Villager professions

- Every villager is now a Farmer, Librarian, Toolsmith, Cleric or Butcher, chosen at spawn and saved. Each has five trades built around emeralds (buying crops, paper, books or meat; selling bread, bone meal, lapis, iron tools, nether wart, blaze powder, cooked food and more). Only trades whose items exist are offered.
- The trade screen shows the profession in its title.

## Fishing

- Using a fishing rod at water casts a visible bobber that flies, lands and floats. After 5–22 seconds (about half that in rain) it dips with a splash and a `bobber_splash` sound; using the rod again inside the 1.6-second bite window reels in loot flung toward you — raw cod 55 %, raw salmon 25 %, then string, bone, stick, leather, book, emerald. Reeling early or missing the window catches nothing. Each catch wears the rod, gives 1–6 XP, counts toward `fishCaught` and unlocks *Fishy Business*.

## Mobs are finally persistent

- Animals, pets, villagers and their state (hp, baby growth timer, tamed/sitting, wool regrow timer, profession, breeding cooldown, custom size) are saved with the world and rebuilt on load. Hostile mobs still despawn as before.
- Backup import validates mob records; a record with an unknown mob type or a broken position is skipped rather than aborting the load. Backup `gameVersion` is 3.1.0; 3.0 saves load unchanged.

## Accessibility

- New **Subtitles** toggle under Options → Audio: captions such as "Cow moos", "Creeper hisses" or "Bow fires" appear above the hotbar for ~2 seconds, with a ◀/▶ arrow when the source is clearly off to one side. Footsteps are intentionally not captioned. Captions never appear while the setting is off.

## Fixes and small changes

- Bone meal used on the block under a crop now grows the crop instead of doing nothing.
- Villager trades in the 3.0 test fixture pinned to a Farmer because trades are now profession-dependent.
- New sounds: `shear`, `hoe_till`, `bobber_splash`. New particles: `hearts`.

## Not in this release (still on ROADMAP.md)

- Anvil renaming and item combining — stacks carry no per-item metadata yet.
- Growth stages for carrots, potatoes, beetroot, melons and pumpkins; sheep colours; chicken eggs; horses and other mounts.
- Villager levelling, restocking, raids; treasure and enchanted fishing loot; persistent arrows/projectiles.
- Multiplayer, redstone, boats/minecarts, and everything else listed there.

## Testing

- New `tests/husbandry.test.mjs` (16 deterministic rule tests with an injected world and RNG) and `tests/browser-v31.mjs` (40 browser checks driven through the mobile touch buttons). Run with `npm test` and `npm run test:browser`; `tests/node-three.mjs` maps the `three` import for Node.
- All 3.0 suites rerun on this build: 21/21 core, 42/42 browser, 14/14 mobile, 37/37 desktop graphics + touch, 4/4 server.
