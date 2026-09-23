// 3.1 systems: crop growth, tilling, bone meal, tree growth, fishing loot,
// breeding/taming tables, villager professions and mob save records.
// Run: node --import ./tests/node-three.mjs --test tests/husbandry.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { B, BLOCKS } from '../src/world/blocks.js';
import { getItem } from '../src/crafting/items.js';
import {
  tickBlock, boneMeal, growTree, canTill, canPlantOn, nextStage, hydrated, GROWTH_CHAINS, BlockTicker,
} from '../src/world/ticking.js';
import { rollFishingLoot, FISHING_LOOT } from '../src/entities/bobber.js';
import {
  foodFor, canBreed, tradesFor, PROFESSIONS, PROFESSION_KEYS, randomProfession,
  mobRecord, validMobRecord, applyMobRecord, TAMING,
} from '../src/entities/husbandry.js';
import { MOBS } from '../src/entities/mobs.js';
import { encodeBackup, parseBackup } from '../src/save/backup.js';
import { Inventory } from '../src/player/inventory.js';

/** Tiny sparse world: everything below y=64 is stone, y=64 grass, air above. */
function world(sky = 15) {
  const m = new Map();
  const k = (x, y, z) => `${x},${y},${z}`;
  return {
    getBlock(x, y, z) { if (m.has(k(x, y, z))) return m.get(k(x, y, z)); return y < 64 ? B.STONE : y === 64 ? B.GRASS : B.AIR; },
    setBlock(x, y, z, id) { m.set(k(x, y, z), id); },
    skyLight() { return sky; },
    isLoaded() { return true; },
    edits: m,
  };
}
const always = () => 0;   // rng that always passes a chance roll
const never = () => 0.999;

test('wheat grows through every stage on watered farmland and stops when mature', () => {
  const w = world();
  w.setBlock(0, 64, 0, B.FARMLAND); w.setBlock(3, 64, 0, B.WATER); w.setBlock(0, 65, 0, B.WHEAT_0);
  assert.equal(hydrated(w, 0, 64, 0), true);
  const seen = [B.WHEAT_0];
  for (let i = 0; i < 5; i++) { tickBlock(w, 0, 65, 0, always); seen.push(w.getBlock(0, 65, 0)); }
  assert.deepEqual(seen.slice(0, 4), GROWTH_CHAINS[0]);
  assert.equal(w.getBlock(0, 65, 0), B.WHEAT);
  assert.equal(nextStage(B.WHEAT), null);
});
test('dry wheat grows slower and dark wheat not at all', () => {
  const w = world();
  w.setBlock(0, 64, 0, B.FARMLAND); w.setBlock(0, 65, 0, B.WHEAT_0);
  assert.equal(tickBlock(w, 0, 65, 0, () => 0.5), false);   // 34% chance fails at 0.5
  assert.equal(tickBlock(w, 0, 65, 0, () => 0.1), true);    // and passes at 0.1
  const dark = world(3); dark.setBlock(0, 64, 0, B.FARMLAND); dark.setBlock(0, 65, 0, B.WHEAT_0);
  assert.equal(tickBlock(dark, 0, 65, 0, always), false);
  assert.equal(dark.getBlock(0, 65, 0), B.WHEAT_0);
});
test('crops without soil pop off, farmland dries without water and grass spreads', () => {
  const w = world();
  w.setBlock(0, 65, 0, B.WHEAT_1);       // on grass, not farmland
  assert.equal(tickBlock(w, 0, 65, 0, always), true);
  assert.equal(w.getBlock(0, 65, 0), B.AIR);
  w.setBlock(5, 64, 5, B.FARMLAND);
  assert.equal(tickBlock(w, 5, 64, 5, always), true);
  assert.equal(w.getBlock(5, 64, 5), B.DIRT);
  assert.equal(tickBlock(w, 5, 64, 5, always), true);   // dirt beside grass regrows
  assert.equal(w.getBlock(5, 64, 5), B.GRASS);
  w.setBlock(9, 64, 9, B.FARMLAND); w.setBlock(9, 65, 9, B.WHEAT_2);
  assert.equal(tickBlock(w, 9, 64, 9, always), false, 'farmland under a crop never dries');
});
test('nether wart only grows on soul sand', () => {
  const w = world();
  w.setBlock(0, 64, 0, B.SOUL_SAND); w.setBlock(0, 65, 0, B.WART_0);
  tickBlock(w, 0, 65, 0, always); tickBlock(w, 0, 65, 0, always);
  assert.equal(w.getBlock(0, 65, 0), B.NETHER_WART);
  w.setBlock(2, 65, 0, B.WART_1);
  tickBlock(w, 2, 65, 0, always);
  assert.equal(w.getBlock(2, 65, 0), B.AIR);
  assert.equal(getItem('nether_wart').block, B.WART_0);
  assert.equal(getItem('wheat_seeds').block, B.WHEAT_0);
  assert.equal(getItem('oak_sapling').block, B.OAK_SAPLING);
});
test('planting rules: seeds need farmland, wart needs soul sand, saplings need earth', () => {
  assert.equal(canPlantOn(B.WHEAT_0, B.FARMLAND), true);
  assert.equal(canPlantOn(B.WHEAT_0, B.GRASS), false);
  assert.equal(canPlantOn(B.WART_0, B.SOUL_SAND), true);
  assert.equal(canPlantOn(B.WART_0, B.FARMLAND), false);
  assert.equal(canPlantOn(B.OAK_SAPLING, B.GRASS), true);
  assert.equal(canPlantOn(B.OAK_SAPLING, B.STONE), false);
  assert.equal(canPlantOn(B.TALL_GRASS, B.STONE), true, 'plain plants keep the old any-solid rule');
});
test('hoe tills grass, dirt and paths only when the top is clear', () => {
  const w = world();
  assert.equal(canTill(w, 0, 64, 0), true);
  w.setBlock(1, 65, 0, B.TALL_GRASS);
  assert.equal(canTill(w, 1, 64, 0), false);
  assert.equal(canTill(w, 0, 63, 0), false, 'stone');
  w.setBlock(2, 64, 0, B.PATH); assert.equal(canTill(w, 2, 64, 0), true);
});
test('sapling grows into a whole tree and refuses under a low roof', () => {
  const w = world();
  w.setBlock(0, 65, 0, B.OAK_SAPLING);
  assert.equal(tickBlock(w, 0, 65, 0, always), true);
  let logs = 0, leaves = 0;
  for (const v of w.edits.values()) { if (v === B.OAK_LOG) logs++; if (v === B.OAK_LEAVES) leaves++; }
  assert.ok(logs >= 4 && logs <= 6, `trunk ${logs}`);
  assert.ok(leaves > 20, `canopy ${leaves}`);
  assert.equal(w.getBlock(0, 65, 0), B.OAK_LOG);
  const roof = world(); roof.setBlock(5, 65, 5, B.OAK_SAPLING); roof.setBlock(5, 67, 5, B.STONE);
  assert.equal(growTree(roof, 5, 65, 5, always), false);
  assert.equal(roof.getBlock(5, 65, 5), B.OAK_SAPLING);
});
test('sugar cane and cactus grow to three tall', () => {
  const w = world();
  w.setBlock(0, 65, 0, B.SUGAR_CANE);
  tickBlock(w, 0, 65, 0, always); assert.equal(w.getBlock(0, 66, 0), B.SUGAR_CANE);
  tickBlock(w, 0, 66, 0, always); assert.equal(w.getBlock(0, 67, 0), B.SUGAR_CANE);
  assert.equal(tickBlock(w, 0, 67, 0, always), false, 'capped at three');
  assert.equal(w.getBlock(0, 68, 0), B.AIR);
});
test('bone meal forces a growth step, decorates lawns, does nothing to stone', () => {
  const w = world(2);   // dark: only bone meal can grow it
  w.setBlock(0, 64, 0, B.FARMLAND); w.setBlock(0, 65, 0, B.WHEAT_0);
  assert.equal(boneMeal(w, 0, 65, 0, never), true);
  assert.equal(w.getBlock(0, 65, 0), B.WHEAT_1);
  assert.equal(boneMeal(w, 10, 64, 10, () => 0.4), true);
  const grown = [...w.edits.values()].filter((v) => v === B.TALL_GRASS || v === B.FLOWER_RED || v === B.FLOWER_YELLOW);
  assert.ok(grown.length > 0);
  assert.equal(boneMeal(w, 0, 10, 0), false);
});
test('random ticker only touches loaded columns and reports changes', () => {
  const w = world();
  w.isLoaded = (x) => x >= 0;
  for (let x = -5; x < 5; x++) for (let z = -5; z < 5; z++) { w.setBlock(x, 64, z, B.FARMLAND); w.setBlock(x, 65, z, B.WHEAT_0); w.setBlock(x, 63, z, B.WATER); }
  const game = { world: w, player: { pos: { x: 0, y: 65, z: 0 } }, afterBlockChange() {}, unlockAdvancement() {} };
  const t = new BlockTicker(game, 400000);
  // Random sampling makes a single update a coin flip; keep ticking until the
  // ticker has demonstrably changed something (it always will within a few).
  for (let i = 0; i < 10 && t.changed === 0; i++) t.update(0.1);
  assert.ok(t.changed > 0);
  for (let x = -5; x < 0; x++) for (let z = -5; z < 5; z++) assert.equal(w.getBlock(x, 65, z), B.WHEAT_0, 'unloaded side untouched');
});
test('fishing loot rolls fish most often and every entry is a real item', () => {
  const exists = (k) => !!getItem(k);
  for (const l of FISHING_LOOT) if (l.key !== 'name_tag') assert.ok(exists(l.key), l.key);
  let fish = 0;
  for (let i = 0; i < 2000; i++) { const r = rollFishingLoot(Math.random, exists); assert.ok(exists(r.key)); if (r.key === 'raw_cod' || r.key === 'raw_salmon') fish++; }
  assert.ok(fish > 1400, `fish ${fish}`);
  assert.equal(rollFishingLoot(() => 0, exists).key, 'raw_cod');
});
test('breeding food and taming tables reference real items and passive mobs', () => {
  for (const type of ['cow', 'sheep', 'pig', 'chicken', 'wolf']) assert.ok(MOBS[type] && canBreed(type), type);
  assert.equal(foodFor('cow', { key: 'wheat', count: 1 }), 'wheat');
  assert.equal(foodFor('cow', { key: 'wheat_seeds', count: 1 }), null);
  assert.equal(foodFor('chicken', { key: 'wheat_seeds', count: 1 }), 'wheat_seeds');
  assert.equal(foodFor('wolf', { key: 'raw_beef', count: 1 }), 'raw_beef');
  assert.equal(foodFor('zombie', { key: 'wheat', count: 1 }), null);
  assert.equal(canBreed('zombie'), false);
  assert.ok(getItem(TAMING.wolf.item));
});
test('every villager profession offers five valid trades', () => {
  assert.equal(PROFESSION_KEYS.length, 5);
  for (const k of PROFESSION_KEYS) {
    const t = tradesFor(k); assert.equal(t.length, 5, k);
    for (const tr of t) { assert.ok(getItem(tr.give.key)); assert.ok(getItem(tr.get.key)); assert.ok(tr.give.count > 0 && tr.get.count > 0); }
    assert.ok(PROFESSIONS[k].name);
  }
  assert.ok(PROFESSION_KEYS.includes(randomProfession(() => 0.99)));
});
test('mob save records round-trip babies, taming, wool and profession', () => {
  const fake = { kind: 'wolf', pos: { x: 1.5, y: 65, z: -2.25 }, health: 7, maxHealth: 8, persistent: false, baby: true, growTimer: 120.4,
    tamed: true, sitting: true, sheared: false, woolTimer: 0, profession: null, breedCooldown: 12.6, size: 0.5 };
  const r = mobRecord(fake);
  assert.deepEqual(r, { t: 'mob', type: 'wolf', x: 1.5, y: 65, z: -2.25, hp: 7, baby: 120, tamed: 1, sit: 1, cd: 13 });
  assert.equal(validMobRecord(r), true);
  assert.equal(validMobRecord({ t: 'mob', type: 'dragon_of_doom', x: 0, y: 0, z: 0 }), false);
  assert.equal(validMobRecord({ t: 'mob', type: 'cow', x: NaN, y: 0, z: 0 }), false);
  assert.equal(validMobRecord({ t: 'mob', type: 'villager', x: 0, y: 0, z: 0, prof: 'wizard' }), false);
  const target = { kind: 'wolf', maxHealth: 8, angry: true, setBaby(s) { this.baby = true; this.growTimer = s; } };
  applyMobRecord(target, r);
  assert.equal(target.health, 7); assert.equal(target.tamed, true); assert.equal(target.angry, false);
  assert.equal(target.sitting, true); assert.equal(target.persistent, true); assert.equal(target.growTimer, 120);
  const sheep = mobRecord({ kind: 'sheep', pos: { x: 0, y: 0, z: 0 }, health: 8, persistent: false, sheared: true, woolTimer: 40.2, size: 1 });
  assert.equal(sheep.sheared, 40);
  const v = mobRecord({ kind: 'villager', pos: { x: 0, y: 0, z: 0 }, health: 20, persistent: true, profession: 'cleric', size: 1 });
  assert.equal(v.prof, 'cleric'); assert.equal(v.p, 1);
});
test('backups accept mob records and still reject malformed ones', () => {
  const rec = { id: 't', name: 'T', seed: 1, gamemode: 0, difficulty: 2, data: { dim: 0, time: 0,
    player: { pos: [0.5, 65, 0.5], yaw: 0, pitch: 0, health: 20, hunger: 20, saturation: 5, air: 300, xp: 0, level: 0, gamemode: 0, difficulty: 2, inventory: new Inventory().serialize() },
    world: Array.from({ length: 3 }, () => ({ chunkEdits: [], be: [], sp: [], po: [] })),
    items: [{ t: 'mob', type: 'cow', x: 1, y: 65, z: 1, hp: 10, baby: 50 }, { t: 'item', x: 0, y: 65, z: 0, s: { key: 'stone', count: 3 }, life: 10 }] } };
  assert.deepEqual(parseBackup(encodeBackup(rec)), rec);
  rec.data.items[0].hp = 'lots';
  assert.throws(() => parseBackup(encodeBackup(rec)));
});
test('new stage blocks are registered with drops and painters', () => {
  for (const id of [B.WHEAT_0, B.WHEAT_1, B.WHEAT_2, B.WART_0, B.WART_1, B.OAK_SAPLING]) {
    const d = BLOCKS[id]; assert.equal(d.id, id); assert.equal(d.render, 'cross'); assert.ok(getItem(d.drop), d.key); assert.equal(d.noItem, true);
  }
  assert.equal(BLOCKS[B.WHEAT_0].drop, 'wheat_seeds');
  assert.equal(BLOCKS[B.WHEAT].drop, 'wheat');
});
