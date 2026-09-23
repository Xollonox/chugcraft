import { isWater, isLava } from './blocks.js';
// ============================================================================
// Random block ticks: crops grow, saplings become trees, cane and cactus
// stretch, grass spreads and farmland dries. Pure rules live in `tickBlock`
// so the scheduler and the tests share one implementation.
// ============================================================================

import { B, BLOCKS, IS_SOLID } from './blocks.js';
import { CHUNK_Y } from '../constants.js';

/** Crop stage chains: each entry grows into the next; the last is mature. */
export const GROWTH_CHAINS = [
  [B.WHEAT_0, B.WHEAT_1, B.WHEAT_2, B.WHEAT],
  [B.WART_0, B.WART_1, B.NETHER_WART],
];

const NEXT_STAGE = new Map();
export const CROP_STAGES = new Set();
for (const chain of GROWTH_CHAINS) {
  for (let i = 0; i < chain.length; i++) {
    CROP_STAGES.add(chain[i]);
    if (i < chain.length - 1) NEXT_STAGE.set(chain[i], chain[i + 1]);
  }
}

/** The block a crop turns into when it grows one step, or null when mature. */
export function nextStage(id) { return NEXT_STAGE.get(id) ?? null; }

/** True when at least one water block lies within `r` of (x, y, z) at y or y-1. */
export function hydrated(world, x, y, z, r = 4) {
  for (let dz = -r; dz <= r; dz++) {
    for (let dx = -r; dx <= r; dx++) {
      if (isWater(world.getBlock(x + dx, y, z + dz))) return true;
      if (isWater(world.getBlock(x + dx, y - 1, z + dz))) return true;
    }
  }
  return false;
}

/** Farmland can only be tilled on bare ground with nothing on top. */
export function canTill(world, x, y, z) {
  const b = world.getBlock(x, y, z);
  if (b !== B.GRASS && b !== B.DIRT && b !== B.PATH) return false;
  return world.getBlock(x, y + 1, z) === B.AIR;
}

/**
 * Soil rule for plantable items: a block id -> the one soil it needs,
 * `null` for "grass or dirt", `undefined` for "no special rule".
 */
export function soilFor(id) {
  if (id === B.WHEAT_0) return B.FARMLAND;
  if (id === B.WART_0) return B.SOUL_SAND;
  if (id === B.OAK_SAPLING) return null;
  return undefined;
}

export function canPlantOn(id, groundId) {
  const soil = soilFor(id);
  if (soil === undefined) return IS_SOLID[groundId] === 1;
  if (soil === null) return groundId === B.GRASS || groundId === B.DIRT || groundId === B.FARMLAND;
  return groundId === soil;
}

const softAt = (world, x, y, z) => {
  const b = world.getBlock(x, y, z);
  return b === B.AIR || BLOCKS[b].replaceable || BLOCKS[b].render === 'cross' || b === B.OAK_LEAVES;
};

/**
 * Grow an oak from a sapling at (x, y, z). Refuses (and returns false) when
 * the trunk column is blocked, so a sapling under a roof simply waits.
 */
export function growTree(world, x, y, z, rng = Math.random) {
  const th = 4 + Math.floor(rng() * 3);
  if (y + th + 2 >= CHUNK_Y) return false;
  for (let dy = 1; dy <= th + 1; dy++) if (!softAt(world, x, y + dy, z)) return false;
  const leafy = (X, Y, Z) => { if (softAt(world, X, Y, Z)) world.setBlock(X, Y, Z, B.OAK_LEAVES); };
  for (let dy = 0; dy < th; dy++) world.setBlock(x, y + dy, z, B.OAK_LOG);
  for (let dy = 0; dy < 2; dy++) {
    for (let dz = -2; dz <= 2; dz++) {
      for (let dx = -2; dx <= 2; dx++) {
        if (Math.abs(dx) === 2 && Math.abs(dz) === 2 && (dx + dz + dy) % 2 === 0) continue;
        if (dx === 0 && dz === 0) continue;
        leafy(x + dx, y + th - 2 + dy, z + dz);
      }
    }
  }
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (Math.abs(dx) === 1 && Math.abs(dz) === 1) continue;
      leafy(x + dx, y + th, z + dz);
    }
  }
  leafy(x, y + th + 1, z);
  return true;
}

/**
 * Apply one random tick to the block at (x, y, z). Returns true when the
 * world changed. `rng` is injectable so tests can make growth deterministic;
 * `force` skips the probability and light checks (bone meal, tests).
 */
export function tickBlock(world, x, y, z, rng = Math.random, force = false) {
  const id = world.getBlock(x, y, z);
  if (id === B.AIR) return false;
  const roll = (chance) => force || rng() < chance;
  const light = (Y) => (force || !world.skyLight ? 15 : world.skyLight(x, Y, z));

  const next = nextStage(id);
  if (next !== null) {
    const wheat = id === B.WHEAT_0 || id === B.WHEAT_1 || id === B.WHEAT_2;
    if (wheat) {
      if (world.getBlock(x, y - 1, z) !== B.FARMLAND) { world.setBlock(x, y, z, B.AIR); return true; }
      if (light(y) < 8) return false;
      if (!roll(hydrated(world, x, y - 1, z) ? 1 : 0.34)) return false;
    } else if (world.getBlock(x, y - 1, z) !== B.SOUL_SAND) {
      world.setBlock(x, y, z, B.AIR); return true;
    } else if (!roll(0.5)) return false;
    world.setBlock(x, y, z, next);
    return true;
  }

  if (id === B.OAK_SAPLING) {
    if (!canPlantOn(B.OAK_SAPLING, world.getBlock(x, y - 1, z))) { world.setBlock(x, y, z, B.AIR); return true; }
    if (light(y) < 8) return false;
    if (!roll(0.3)) return false;
    return growTree(world, x, y, z, rng);
  }

  if (id === B.SUGAR_CANE || id === B.CACTUS) {
    let h = 1;
    while (world.getBlock(x, y - h, z) === id) h++;
    if (h >= 3) return false;
    if (world.getBlock(x, y + 1, z) !== B.AIR) return false;
    if (!roll(0.35)) return false;
    world.setBlock(x, y + 1, z, id);
    return true;
  }

  if (id === B.FARMLAND) {
    const above = world.getBlock(x, y + 1, z);
    if (CROP_STAGES.has(above) || hydrated(world, x, y, z)) return false;
    if (!roll(0.15)) return false;
    world.setBlock(x, y, z, B.DIRT);
    return true;
  }

  if (id === B.DIRT) {
    if (world.getBlock(x, y + 1, z) !== B.AIR) return false;
    if (light(y + 1) < 9) return false;
    let neighbour = false;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      for (let dy = -1; dy <= 1; dy++) if (world.getBlock(x + dx, y + dy, z + dz) === B.GRASS) neighbour = true;
    }
    if (!neighbour || !roll(0.2)) return false;
    world.setBlock(x, y, z, B.GRASS);
    return true;
  }

  return false;
}

/** Bone meal: one guaranteed growth step, or flowers and grass on a lawn. */
export function boneMeal(world, x, y, z, rng = Math.random) {
  const id = world.getBlock(x, y, z);
  if (nextStage(id) !== null || id === B.OAK_SAPLING || id === B.SUGAR_CANE || id === B.CACTUS) {
    return tickBlock(world, x, y, z, rng, true);
  }
  if (id === B.GRASS) {
    let placed = 0;
    for (let i = 0; i < 12; i++) {
      const gx = x + Math.floor(rng() * 5) - 2, gz = z + Math.floor(rng() * 5) - 2;
      if (world.getBlock(gx, y, gz) !== B.GRASS || world.getBlock(gx, y + 1, gz) !== B.AIR) continue;
      const r = rng();
      world.setBlock(gx, y + 1, gz, r < 0.75 ? B.TALL_GRASS : r < 0.88 ? B.FLOWER_YELLOW : B.FLOWER_RED);
      placed++;
    }
    return placed > 0;
  }
  return false;
}

/**
 * Samples random blocks around the player every frame. Roughly 4000 samples
 * a second within +-40 columns gives a watered wheat field about ten minutes
 * from seed to harvest, and roughly half an hour on dry land.
 */
export class BlockTicker {
  constructor(game, samplesPerSecond = 4000) {
    this.game = game;
    this.rate = samplesPerSecond;
    this.carry = 0;
    this.changed = 0;
  }

  update(dt) {
    const g = this.game;
    const w = g.world;
    if (!w || !g.player) return;
    this.carry += Math.min(0.1, dt) * this.rate;
    const n = Math.floor(this.carry);
    this.carry -= n;
    const px = Math.floor(g.player.pos.x), pz = Math.floor(g.player.pos.z);
    for (let i = 0; i < n; i++) {
      const x = px + Math.floor(Math.random() * 81) - 40;
      const z = pz + Math.floor(Math.random() * 81) - 40;
      const y = Math.floor(Math.random() * CHUNK_Y);
      if (!w.isLoaded(x, z)) continue;
      if (tickBlock(w, x, y, z)) {
        this.changed++;
        g.afterBlockChange?.(x, y, z);
        const now = w.getBlock(x, y, z);
        if (now === B.WHEAT) g.unlockAdvancement?.('seedy_place');
        else if (now === B.OAK_LOG) for (let dy = 1; dy <= 8; dy++) g.afterBlockChange?.(x, y + dy, z);
      }
    }
  }
}
