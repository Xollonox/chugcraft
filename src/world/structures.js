// ============================================================================
// Structure generation. Every structure is emitted as a list of axis-aligned
// "ops" plus block-entity / spawner records, so a chunk can render the slice of
// a structure that overlaps it without ever needing its neighbours.
//
// The stronghold is load-bearing for the win path: `strongholdSites()` is the
// single source of truth that both the world generator and the thrown Eye of
// Ender consult, which guarantees the eye always points at a real portal room.
// ============================================================================

import { B } from './blocks.js';
import { mulberry32, hashString } from '../engine/noise.js';
import { CHUNK_X, CHUNK_Z, idx } from '../constants.js';

// ---------------------------------------------------------------------------
// Op helpers
// ---------------------------------------------------------------------------

export const fill = (x0, y0, z0, x1, y1, z1, block) =>
  ({ k: 0, x0, y0, z0, x1, y1, z1, block });
/** Solid shell with a hollow (air) interior. */
export const shell = (x0, y0, z0, x1, y1, z1, block, inner = B.AIR) =>
  ({ k: 1, x0, y0, z0, x1, y1, z1, block, inner });
/** Fill only where the existing block is one of `only` (or any solid). */
export const fillIf = (x0, y0, z0, x1, y1, z1, block, only) =>
  ({ k: 2, x0, y0, z0, x1, y1, z1, block, only });

export function opsBounds(ops) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const o of ops) {
    x0 = Math.min(x0, o.x0); x1 = Math.max(x1, o.x1);
    z0 = Math.min(z0, o.z0); z1 = Math.max(z1, o.z1);
  }
  return { x0, z0, x1, z1 };
}

/** Apply a structure's ops to one chunk, clipping to the chunk's footprint. */
export function applyOps(ops, cx, cz, blocks, maxY) {
  const bx = cx * CHUNK_X, bz = cz * CHUNK_Z;
  for (const o of ops) {
    const lx0 = Math.max(o.x0, bx), lx1 = Math.min(o.x1, bx + CHUNK_X - 1);
    const lz0 = Math.max(o.z0, bz), lz1 = Math.min(o.z1, bz + CHUNK_Z - 1);
    if (lx0 > lx1 || lz0 > lz1) continue;
    const ly0 = Math.max(0, o.y0), ly1 = Math.min(maxY - 1, o.y1);
    for (let y = ly0; y <= ly1; y++) {
      for (let z = lz0; z <= lz1; z++) {
        for (let x = lx0; x <= lx1; x++) {
          const i = idx(x - bx, y, z - bz);
          if (o.k === 1) {
            const onShell =
              x === o.x0 || x === o.x1 || y === o.y0 || y === o.y1 || z === o.z0 || z === o.z1;
            blocks[i] = onShell ? o.block : o.inner;
          } else if (o.k === 2) {
            if (!o.only || o.only.includes(blocks[i])) blocks[i] = o.block;
          } else {
            blocks[i] = o.block;
          }
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Loot tables
// ---------------------------------------------------------------------------

function roll(rnd, table, rolls) {
  const out = [];
  for (let r = 0; r < rolls; r++) {
    let total = 0;
    for (const e of table) total += e[2];
    let pick = rnd() * total;
    for (const e of table) {
      pick -= e[2];
      if (pick <= 0) {
        const [key, range] = e;
        const n = range[0] + Math.floor(rnd() * (range[1] - range[0] + 1));
        if (n > 0) out.push({ key, count: n });
        break;
      }
    }
  }
  return out;
}

const STRONGHOLD_LOOT = [
  ['iron_ingot', [1, 5], 10], ['gold_ingot', [1, 3], 5], ['bread', [1, 3], 15],
  ['apple', [1, 3], 15], ['redstone', [4, 9], 5], ['coal', [3, 8], 10],
  ['iron_pickaxe', [1, 1], 5], ['iron_sword', [1, 1], 5], ['iron_chestplate', [1, 1], 4],
  ['iron_helmet', [1, 1], 4], ['ender_pearl', [1, 1], 6], ['book', [1, 3], 8],
  ['diamond', [1, 2], 3], ['golden_apple', [1, 1], 2],
];
const DUNGEON_LOOT = [
  ['iron_ingot', [1, 4], 10], ['bread', [1, 2], 10], ['bucket', [1, 1], 4],
  ['gold_ingot', [1, 3], 5], ['redstone', [1, 4], 5], ['coal', [2, 6], 10],
  ['bone', [1, 4], 10], ['gunpowder', [1, 4], 10], ['string', [1, 4], 10],
  ['golden_apple', [1, 1], 2], ['diamond', [1, 1], 2], ['saddle_placeholder', [0, 0], 3],
];
const VILLAGE_LOOT = [
  ['bread', [2, 4], 15], ['apple', [1, 3], 10], ['wheat', [1, 5], 15],
  ['iron_ingot', [1, 3], 8], ['coal', [1, 4], 10], ['oak_sapling', [1, 3], 8],
  ['iron_pickaxe', [1, 1], 3], ['emerald', [1, 2], 5], ['leather_chestplate', [1, 1], 4],
];
const FORTRESS_LOOT = [
  ['gold_ingot', [1, 4], 12], ['iron_ingot', [1, 4], 10], ['golden_apple', [1, 1], 4],
  ['diamond', [1, 2], 4], ['gold_nugget', [2, 8], 10], ['obsidian', [2, 4], 6],
  ['flint_and_steel', [1, 1], 5], ['bread', [1, 3], 8],
];

// ---------------------------------------------------------------------------
// Strongholds — 3 per world, on a ring around the origin.
// ---------------------------------------------------------------------------

const strongholdCache = new Map();

export function strongholdSites(seed) {
  const key = seed >>> 0;
  if (strongholdCache.has(key)) return strongholdCache.get(key);
  const rnd = mulberry32((seed ^ 0x5748d0) >>> 0);
  const sites = [];
  const count = 3;
  const baseAngle = rnd() * Math.PI * 2;
  for (let i = 0; i < count; i++) {
    const ang = baseAngle + (i / count) * Math.PI * 2 + (rnd() - 0.5) * 0.6;
    const dist = 230 + rnd() * 190;              // 230..420 blocks from spawn
    sites.push({
      x: Math.round(Math.cos(ang) * dist),
      z: Math.round(Math.sin(ang) * dist),
      y: 20 + Math.floor(rnd() * 6),
      seed: (seed ^ (0x9e37 * (i + 1))) >>> 0,
    });
  }
  strongholdCache.set(key, sites);
  return sites;
}

/** Nearest stronghold to a world position — used by thrown Eyes of Ender. */
export function nearestStronghold(seed, x, z) {
  let best = null, bd = Infinity;
  for (const s of strongholdSites(seed)) {
    const d = (s.x - x) ** 2 + (s.z - z) ** 2;
    if (d < bd) { bd = d; best = s; }
  }
  return best;
}

const layoutCache = new Map();

/**
 * The stronghold: a portal room (12 frames + activation hole) plus four
 * corridors leading to a library, a storeroom and two dead-ends.
 */
export function strongholdLayout(site) {
  const ck = `${site.x},${site.z}`;
  if (layoutCache.has(ck)) return layoutCache.get(ck);
  const rnd = mulberry32(site.seed);
  const ops = [];
  const entities = [];
  const spawners = [];
  const SB = B.STONE_BRICKS, CSB = B.CRACKED_STONE_BRICKS, MSB = B.MOSSY_STONE_BRICKS;
  const cx = site.x, cz = site.z, y = site.y;

  // --- portal room ---------------------------------------------------------
  ops.push(fill(cx - 7, y - 2, cz - 7, cx + 7, y - 1, cz + 7, SB));
  ops.push(shell(cx - 7, y - 1, cz - 7, cx + 7, y + 7, cz + 7, SB));
  // weathered floor speckle
  for (let i = 0; i < 90; i++) {
    const px = cx - 6 + Math.floor(rnd() * 13), pz = cz - 6 + Math.floor(rnd() * 13);
    ops.push(fill(px, y, pz, px, y, pz, rnd() < 0.5 ? CSB : MSB));
  }
  // decorative lava channel one level under the portal
  ops.push(fill(cx - 2, y - 1, cz - 2, cx + 2, y - 1, cz + 2, B.LAVA));
  ops.push(fill(cx - 1, y, cz - 1, cx + 1, y, cz + 1, SB));

  // --- the 12 end portal frames -------------------------------------------
  const frames = [];
  for (let i = -1; i <= 1; i++) {
    frames.push([cx + i, cz - 2], [cx + i, cz + 2], [cx - 2, cz + i], [cx + 2, cz + i]);
  }
  for (const [fx, fz] of frames) {
    ops.push(fill(fx, y + 1, fz, fx, y + 1, fz, B.END_PORTAL_FRAME));
  }
  // Corners of the ring are plain floor so the shape reads correctly.
  for (const [fx, fz] of [[cx - 2, cz - 2], [cx + 2, cz - 2], [cx - 2, cz + 2], [cx + 2, cz + 2]]) {
    ops.push(fill(fx, y + 1, fz, fx, y + 1, fz, SB));
  }
  // A couple of frames start pre-filled on lower difficulties? No: always empty,
  // the player must supply all twelve eyes. Keep the room lit instead.
  for (const [tx, tz] of [[cx - 5, cz - 5], [cx + 5, cz - 5], [cx - 5, cz + 5], [cx + 5, cz + 5]]) {
    ops.push(fill(tx, y + 2, tz, tx, y + 2, tz, B.TORCH));
  }

  // guard spawner + silverfish flavour
  spawners.push({ x: cx, y: y + 1, z: cz + 5, mob: 'zombie' });
  ops.push(fill(cx, y + 1, cz + 5, cx, y + 1, cz + 5, B.SPAWNER));

  // --- corridors -----------------------------------------------------------
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  dirs.forEach(([dx, dz], di) => {
    const len = 14 + Math.floor(rnd() * 10);
    const ax = cx + dx * 7, az = cz + dz * 7;
    const ex = cx + dx * (7 + len), ez = cz + dz * (7 + len);
    const x0 = Math.min(ax, ex) - (dz ? 2 : 0), x1 = Math.max(ax, ex) + (dz ? 2 : 0);
    const z0 = Math.min(az, ez) - (dx ? 2 : 0), z1 = Math.max(az, ez) + (dx ? 2 : 0);
    ops.push(shell(x0 - (dx ? 0 : 0), y - 1, z0, x1, y + 4, z1, SB));
    // doorway back into the portal room
    ops.push(fill(cx + dx * 7, y, cz + dz * 7, cx + dx * 7 + (dz ? 1 : 0), y + 2, cz + dz * 7 + (dx ? 1 : 0), B.AIR));
    // corridor torches
    for (let t = 4; t < len; t += 6) {
      ops.push(fill(cx + dx * (7 + t), y + 2, cz + dz * (7 + t), cx + dx * (7 + t), y + 2, cz + dz * (7 + t), B.TORCH));
    }
    // terminal room
    const rx = cx + dx * (7 + len + 5), rz = cz + dz * (7 + len + 5);
    ops.push(shell(rx - 5, y - 1, rz - 5, rx + 5, y + 5, rz + 5, SB));
    ops.push(fill(rx - dx * 5, y, rz - dz * 5, rx - dx * 5 + (dz ? 1 : 0), y + 2, rz - dz * 5 + (dx ? 1 : 0), B.AIR));
    if (di === 0) {
      // library
      for (let s = -4; s <= 4; s++) {
        ops.push(fill(rx + s, y, rz - 4, rx + s, y + 2, rz - 4, B.BOOKSHELF));
        ops.push(fill(rx + s, y, rz + 4, rx + s, y + 2, rz + 4, B.BOOKSHELF));
      }
      ops.push(fill(rx, y, rz, rx, y, rz, B.CHEST));
      entities.push({ x: rx, y, z: rz, type: 'chest', items: roll(rnd, STRONGHOLD_LOOT, 5) });
      ops.push(fill(rx - 2, y + 3, rz, rx + 2, y + 3, rz, B.TORCH));
    } else if (di === 1) {
      // storeroom with two chests
      ops.push(fill(rx - 2, y, rz, rx - 2, y, rz, B.CHEST));
      ops.push(fill(rx + 2, y, rz, rx + 2, y, rz, B.CHEST));
      entities.push({ x: rx - 2, y, z: rz, type: 'chest', items: roll(rnd, STRONGHOLD_LOOT, 4) });
      entities.push({ x: rx + 2, y, z: rz, type: 'chest', items: roll(rnd, STRONGHOLD_LOOT, 4) });
      ops.push(fill(rx, y + 4, rz, rx, y + 4, rz, B.TORCH));
    } else {
      ops.push(fill(rx, y + 4, rz, rx, y + 4, rz, B.TORCH));
      if (rnd() < 0.6) {
        ops.push(fill(rx, y, rz, rx, y, rz, B.CHEST));
        entities.push({ x: rx, y, z: rz, type: 'chest', items: roll(rnd, STRONGHOLD_LOOT, 3) });
      }
    }
  });

  // --- a marker shaft so the site is discoverable from the surface ---------
  // A narrow, unlit cobweb-free chimney of cracked bricks that a digging player
  // will punch into. It stops well below the surface so it isn't an eyesore.
  ops.push(shell(cx - 1, y + 7, cz - 1, cx + 1, y + 22, cz + 1, CSB));
  ops.push(fill(cx, y + 7, cz, cx, y + 22, cz, B.AIR));
  for (let ly = y + 8; ly < y + 22; ly += 4) {
    ops.push(fill(cx + 1, ly, cz, cx + 1, ly, cz, B.TORCH));
  }

  const res = { ops, entities, spawners, bounds: opsBounds(ops) };
  layoutCache.set(ck, res);
  return res;
}

// ---------------------------------------------------------------------------
// Nether fortress — the reliable source of Blaze Rods.
// ---------------------------------------------------------------------------

const REGION_FORTRESS = 176;

export function fortressSites(seed, cx, cz) {
  // Regions overlapping this chunk (± the fortress radius).
  const out = [];
  const wx = cx * CHUNK_X, wz = cz * CHUNK_Z;
  const r0x = Math.floor((wx - 48) / REGION_FORTRESS), r1x = Math.floor((wx + 48) / REGION_FORTRESS);
  const r0z = Math.floor((wz - 48) / REGION_FORTRESS), r1z = Math.floor((wz + 48) / REGION_FORTRESS);
  for (let rz = r0z; rz <= r1z; rz++) {
    for (let rx = r0x; rx <= r1x; rx++) {
      const rnd = mulberry32(hashString(`fortress:${seed}:${rx}:${rz}`));
      const fx = rx * REGION_FORTRESS + 40 + Math.floor(rnd() * 96);
      const fz = rz * REGION_FORTRESS + 40 + Math.floor(rnd() * 96);
      out.push({ x: fx, z: fz, y: 48 + Math.floor(rnd() * 14), seed: hashString(`f:${rx}:${rz}:${seed}`) });
    }
  }
  return out;
}

const fortressCache = new Map();

export function fortressLayout(site) {
  const ck = `${site.x},${site.z}`;
  if (fortressCache.has(ck)) return fortressCache.get(ck);
  const rnd = mulberry32(site.seed);
  const ops = [], entities = [], spawners = [];
  const NB = B.NETHER_BRICKS;
  const { x: fx, z: fz, y } = site;

  // Clear the air pocket so the fortress is never buried in netherrack.
  ops.push(fill(fx - 30, y - 2, fz - 30, fx + 30, y + 14, fz + 30, B.AIR));

  // Central keep
  ops.push(fill(fx - 10, y - 1, fz - 10, fx + 10, y - 1, fz + 10, NB));
  ops.push(shell(fx - 10, y - 1, fz - 10, fx + 10, y + 6, fz + 10, NB));
  ops.push(fill(fx - 9, y, fz - 9, fx + 9, y + 5, fz + 9, B.AIR));
  // window slits
  for (let i = -8; i <= 8; i += 4) {
    ops.push(fill(fx + i, y + 2, fz - 10, fx + i, y + 3, fz - 10, B.AIR));
    ops.push(fill(fx + i, y + 2, fz + 10, fx + i, y + 3, fz + 10, B.AIR));
    ops.push(fill(fx - 10, y + 2, fz + i, fx - 10, y + 3, fz + i, B.AIR));
    ops.push(fill(fx + 10, y + 2, fz + i, fx + 10, y + 3, fz + i, B.AIR));
  }
  // Doorways
  ops.push(fill(fx - 1, y, fz - 10, fx + 1, y + 2, fz - 10, B.AIR));
  ops.push(fill(fx - 1, y, fz + 10, fx + 1, y + 2, fz + 10, B.AIR));
  ops.push(fill(fx - 10, y, fz - 1, fx - 10, y + 2, fz + 1, B.AIR));
  ops.push(fill(fx + 10, y, fz - 1, fx + 10, y + 2, fz + 1, B.AIR));

  // Blaze spawner platforms (two, so a fight going badly isn't a dead end)
  for (const [sx, sz] of [[fx - 5, fz - 5], [fx + 5, fz + 5]]) {
    ops.push(fill(sx - 3, y, sz - 3, sx + 3, y, sz + 3, NB));
    ops.push(fill(sx - 3, y + 1, sz - 3, sx + 3, y + 1, sz + 3, B.AIR));
    ops.push(fill(sx, y + 1, sz, sx, y + 1, sz, B.SPAWNER));
    spawners.push({ x: sx, y: y + 1, z: sz, mob: 'blaze' });
    for (const [ox, oz] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) {
      ops.push(fill(sx + ox, y + 1, sz + oz, sx + ox, y + 3, sz + oz, NB));
    }
  }

  // Loot chests
  for (let i = 0; i < 2; i++) {
    const bx = fx + (rnd() < 0.5 ? -7 : 7), bz = fz + (rnd() < 0.5 ? -7 : 7);
    ops.push(fill(bx, y, bz, bx, y, bz, B.CHEST));
    entities.push({ x: bx, y, z: bz, type: 'chest', items: [...roll(rnd, FORTRESS_LOOT, 4), {key:'nether_wart',count:6}] });
  }

  // Bridges radiating out over the lava
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const L = 26;
    const x0 = fx + dx * 11, z0 = fz + dz * 11;
    const x1 = fx + dx * (11 + L), z1 = fz + dz * (11 + L);
    ops.push(fill(Math.min(x0, x1) - (dz ? 2 : 0), y - 1, Math.min(z0, z1) - (dx ? 2 : 0),
      Math.max(x0, x1) + (dz ? 2 : 0), y - 1, Math.max(z0, z1) + (dx ? 2 : 0), NB));
    // parapets
    for (let t = 0; t <= L; t += 2) {
      const px = fx + dx * (11 + t), pz = fz + dz * (11 + t);
      ops.push(fill(px + (dz ? 2 : 0), y, pz + (dx ? 2 : 0), px + (dz ? 2 : 0), y, pz + (dx ? 2 : 0), NB));
      ops.push(fill(px - (dz ? 2 : 0), y, pz - (dx ? 2 : 0), px - (dz ? 2 : 0), y, pz - (dx ? 2 : 0), NB));
    }
  }

  // A renewable wart garden; no extra RNG calls, so old seeded layouts stay stable.
  ops.push(fill(fx-2,y-1,fz+4,fx+2,y-1,fz+5,B.SOUL_SAND));
  ops.push(fill(fx-2,y,fz+4,fx+2,y,fz+5,B.NETHER_WART));
  // Glowstone lanterns so the fortress is visible from a distance
  for (let i = 0; i < 8; i++) {
    const gx = fx - 9 + Math.floor(rnd() * 19), gz = fz - 9 + Math.floor(rnd() * 19);
    ops.push(fill(gx, y + 6, gz, gx, y + 6, gz, B.GLOWSTONE));
  }

  const res = { ops, entities, spawners, bounds: opsBounds(ops) };
  fortressCache.set(ck, res);
  return res;
}

// ---------------------------------------------------------------------------
// Villages
// ---------------------------------------------------------------------------

const REGION_VILLAGE = 384;

export function villageSites(seed, cx, cz) {
  const out = [];
  const wx = cx * CHUNK_X, wz = cz * CHUNK_Z;
  const r0x = Math.floor((wx - 40) / REGION_VILLAGE), r1x = Math.floor((wx + 40) / REGION_VILLAGE);
  const r0z = Math.floor((wz - 40) / REGION_VILLAGE), r1z = Math.floor((wz + 40) / REGION_VILLAGE);
  for (let rz = r0z; rz <= r1z; rz++) {
    for (let rx = r0x; rx <= r1x; rx++) {
      const rnd = mulberry32(hashString(`village:${seed}:${rx}:${rz}`));
      if (rnd() < 0.35) continue;
      out.push({
        x: rx * REGION_VILLAGE + 80 + Math.floor(rnd() * 220),
        z: rz * REGION_VILLAGE + 80 + Math.floor(rnd() * 220),
        seed: hashString(`v:${rx}:${rz}:${seed}`),
      });
    }
  }
  return out;
}

/**
 * Village styles by biome. Sand-brick huts with flat roofs in the desert,
 * spruce lodges under the snow, acacia-toned savanna huts and so on — a village
 * should read as belonging to the land it sits in.
 * Biome ids: 0 plains, 1 ocean, 2 beach, 3 forest, 4 desert, 5 mountains,
 * 6 snowy, 7 savanna.
 */
const VILLAGE_STYLES = {
  desert: {
    wall: B.SANDSTONE, corner: B.CHISELED_SANDSTONE, roof: B.SMOOTH_SANDSTONE,
    floor: B.SANDSTONE, path: B.SANDSTONE, flatRoof: true, well: B.SANDSTONE,
    post: B.SANDSTONE, light: B.TORCH,
  },
  savanna: {
    wall: B.TERRACOTTA, corner: B.OAK_LOG, roof: B.OAK_PLANKS,
    floor: B.COBBLESTONE, path: B.PATH, flatRoof: true, well: B.COBBLESTONE,
    post: B.OAK_LOG, light: B.TORCH,
  },
  snowy: {
    wall: B.SPRUCE_PLANKS, corner: B.SPRUCE_LOG, roof: B.SNOW_BLOCK,
    floor: B.COBBLESTONE, path: B.SNOW_BLOCK, flatRoof: false, well: B.COBBLESTONE,
    post: B.SPRUCE_LOG, light: B.TORCH,
  },
  taiga: {
    wall: B.SPRUCE_PLANKS, corner: B.SPRUCE_LOG, roof: B.SPRUCE_PLANKS,
    floor: B.COBBLESTONE, path: B.PATH, flatRoof: false, well: B.COBBLESTONE,
    post: B.SPRUCE_LOG, light: B.TORCH,
  },
  plains: {
    wall: B.OAK_PLANKS, corner: B.OAK_LOG, roof: B.SPRUCE_PLANKS,
    floor: B.COBBLESTONE, path: B.PATH, flatRoof: false, well: B.COBBLESTONE,
    post: B.OAK_LOG, light: B.TORCH,
  },
};

export function villageStyleFor(biome) {
  if (biome === 4) return VILLAGE_STYLES.desert;
  if (biome === 7) return VILLAGE_STYLES.savanna;
  if (biome === 6) return VILLAGE_STYLES.snowy;
  if (biome === 5 || biome === 3) return VILLAGE_STYLES.taiga;
  return VILLAGE_STYLES.plains;
}

/** Villages need the terrain height, so they are laid out lazily per site. */
export function villageLayout(site, groundAt, biomeAt) {
  const rnd = mulberry32(site.seed);
  const ops = [], entities = [], spawners = [], villagers = [];
  const baseY = groundAt(site.x, site.z);
  const biome = biomeAt(site.x, site.z);
  if (baseY < 60 || baseY > 96) return null;      // no villages in water or on peaks
  const style = villageStyleFor(biome);
  const WALL = style.wall;
  const CORNER = style.corner;
  const ROOF = style.roof;

  const houses = 5 + Math.floor(rnd() * 4);
  const placed = [];
  for (let h = 0; h < houses; h++) {
    let hx = 0, hz = 0, tries = 0;
    do {
      hx = site.x + Math.floor((rnd() - 0.5) * 46);
      hz = site.z + Math.floor((rnd() - 0.5) * 46);
      tries++;
    } while (tries < 12 && placed.some((p) => Math.abs(p[0] - hx) < 9 && Math.abs(p[1] - hz) < 9));
    placed.push([hx, hz]);
    const gy = groundAt(hx, hz);
    if (gy < 60 || Math.abs(gy - baseY) > 6) continue;
    const w = 3 + Math.floor(rnd() * 2), d = 3 + Math.floor(rnd() * 2);
    const y = gy + 1;
    // foundation + walls + roof
    ops.push(fill(hx - w, gy, hz - d, hx + w, gy, hz + d, style.floor));
    ops.push(shell(hx - w, y, hz - d, hx + w, y + 3, hz + d, WALL));
    ops.push(fill(hx - w + 1, y, hz - d + 1, hx + w - 1, y + 2, hz + d - 1, B.AIR));
    for (const [ox, oz] of [[-w, -d], [w, -d], [-w, d], [w, d]]) {
      ops.push(fill(hx + ox, y, hz + oz, hx + ox, y + 3, hz + oz, CORNER));
    }
    ops.push(fill(hx - w, y + 4, hz - d, hx + w, y + 4, hz + d, ROOF));
    if (!style.flatRoof) {
      // a single ridge course, enough to break up the flat lid
      ops.push(fill(hx - w + 1, y + 5, hz - 0, hx + w - 1, y + 5, hz + 0, ROOF));
    }
    // A real two-block door in the north wall. The doorway runs along Z, so
    // the closed panel is the Z-facing one.
    ops.push(fill(hx, y, hz - d, hx, y + 1, hz - d, B.AIR));
    ops.push(fill(hx, y, hz - d, hx, y + 1, hz - d, B.OAK_DOOR));
    ops.push(fill(hx - w, y + 1, hz, hx - w, y + 1, hz, B.GLASS));
    ops.push(fill(hx + w, y + 1, hz, hx + w, y + 1, hz, B.GLASS));
    ops.push(fill(hx, y + 1, hz + d, hx, y + 1, hz + d, B.GLASS));
    // interior
    ops.push(fill(hx - w + 1, y + 2, hz - d + 1, hx - w + 1, y + 2, hz - d + 1, B.TORCH));
    if (rnd() < 0.75) {
      const bx = hx + w - 1, bz = hz + d - 1;
      ops.push(fill(bx, y, bz, bx, y, bz, B.CHEST));
      entities.push({ x: bx, y, z: bz, type: 'chest', items: roll(rnd, VILLAGE_LOOT, 3) });
    }
    if (rnd() < 0.4) ops.push(fill(hx - w + 1, y, hz + d - 1, hx - w + 1, y, hz + d - 1, B.CRAFTING_TABLE));
    if (rnd() < 0.3) ops.push(fill(hx + w - 1, y, hz - d + 1, hx + w - 1, y, hz - d + 1, B.FURNACE));
    // One resident per house, standing just outside their own front door.
    villagers.push({ x: hx + 0.5, y: y + 0.5, z: hz - d - 1.5, kind: 'villager' });
    if (rnd() < 0.5) villagers.push({ x: hx - 1.5, y: y + 0.5, z: hz - d - 1.5, kind: 'villager' });
  }

  // Well at the centre
  const wy = baseY;
  ops.push(shell(site.x - 2, wy - 4, site.z - 2, site.x + 2, wy + 1, site.z + 2, style.well));
  ops.push(fill(site.x - 1, wy - 3, site.z - 1, site.x + 1, wy, site.z + 1, B.WATER));
  for (const [ox, oz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) {
    ops.push(fill(site.x + ox, wy + 1, site.z + oz, site.x + ox, wy + 3, site.z + oz, style.post));
  }
  ops.push(fill(site.x - 2, wy + 4, site.z - 2, site.x + 2, wy + 4, site.z + 2, style.roof));
  // Lamp posts along the two main paths, so the place is lived-in after dark.
  for (const [ox, oz] of [[-7, -7], [7, -7], [-7, 7], [7, 7]]) {
    const py = groundAt(site.x + ox, site.z + oz);
    if (py < 60 || Math.abs(py - baseY) > 5) continue;
    ops.push(fill(site.x + ox, py + 1, site.z + oz, site.x + ox, py + 3, site.z + oz, style.post));
    ops.push(fill(site.x + ox, py + 4, site.z + oz, site.x + ox, py + 4, site.z + oz, B.GLOWSTONE));
  }

  // The village's iron golem, standing watch by the well. It rides the same
  // channel as the villagers — one spawn list keeps the worker plumbing simple.
  villagers.push({ x: site.x + 3.5, y: baseY + 2, z: site.z + 3.5, kind: 'iron_golem' });

  // Farm plot
  const fxp = site.x + 8, fzp = site.z + 8;
  const fy = groundAt(fxp, fzp);
  if (Math.abs(fy - baseY) < 4) {
    ops.push(fill(fxp - 3, fy, fzp - 3, fxp + 3, fy, fzp + 3, B.FARMLAND));
    ops.push(fill(fxp, fy, fzp - 3, fxp, fy, fzp + 3, B.WATER));
    for (let x = -3; x <= 3; x++) {
      for (let z = -3; z <= 3; z++) {
        if (x === 0) continue;
        ops.push(fill(fxp + x, fy + 1, fzp + z, fxp + x, fy + 1, fzp + z, B.WHEAT));
      }
    }
  }

  return { ops, entities, spawners, villagers, bounds: opsBounds(ops) };
}

// ---------------------------------------------------------------------------
// Dungeons — small mob-spawner rooms scattered underground.
// ---------------------------------------------------------------------------

export function dungeonAt(seed, cx, cz) {
  const rnd = mulberry32(hashString(`dungeon:${seed}:${cx}:${cz}`));
  if (rnd() > 0.055) return null;
  const x = cx * CHUNK_X + 4 + Math.floor(rnd() * 8);
  const z = cz * CHUNK_Z + 4 + Math.floor(rnd() * 8);
  const y = 12 + Math.floor(rnd() * 40);
  const w = 3 + Math.floor(rnd() * 2), d = 3 + Math.floor(rnd() * 2);
  const ops = [], entities = [], spawners = [];
  ops.push(shell(x - w, y - 1, z - d, x + w, y + 4, z + d, B.COBBLESTONE));
  ops.push(fill(x - w + 1, y, z - d + 1, x + w - 1, y + 3, z + d - 1, B.AIR));
  for (let i = 0; i < 26; i++) {
    const mx = x - w + Math.floor(rnd() * (w * 2 + 1));
    const mz = z - d + Math.floor(rnd() * (d * 2 + 1));
    ops.push(fill(mx, y - 1, mz, mx, y - 1, mz, B.COBBLE_MOSSY));
  }
  ops.push(fill(x, y, z, x, y, z, B.SPAWNER));
  const mob = ['zombie', 'skeleton', 'spider'][Math.floor(rnd() * 3)];
  spawners.push({ x, y, z, mob });
  for (let i = 0; i < 2; i++) {
    const bx = x + (i ? w - 1 : -(w - 1)), bz = z + (rnd() < 0.5 ? d - 1 : -(d - 1));
    ops.push(fill(bx, y, bz, bx, y, bz, B.CHEST));
    entities.push({ x: bx, y, z: bz, type: 'chest', items: roll(rnd, DUNGEON_LOOT, 3).filter((i2) => i2.key !== 'saddle_placeholder') });
  }
  return { ops, entities, spawners, bounds: opsBounds(ops) };
}
