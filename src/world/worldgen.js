// ============================================================================
// World generation for all three dimensions. Everything here is a pure function
// of (seed, coordinate): the same seed always rebuilds the same world, which is
// what lets the save format store only the blocks the player actually changed.
// ============================================================================

import { Noise, mulberry32, hashString, clamp, smoothstep, hash3 } from '../engine/noise.js';
import { B } from './blocks.js';
import { CHUNK_X, CHUNK_Z, CHUNK_Y, CHUNK_VOL, SEA_LEVEL, idx, DIM } from '../constants.js';
import {
  strongholdSites, strongholdLayout, fortressSites, fortressLayout,
  villageSites, villageLayout, dungeonAt, applyOps,
} from './structures.js';

export const BIOME = {
  OCEAN: 0, BEACH: 1, PLAINS: 2, FOREST: 3, DESERT: 4,
  MOUNTAINS: 5, SNOWY: 6, SAVANNA: 7, NETHER: 8, END: 9,
};
export const BIOME_NAMES = [
  'Ocean', 'Beach', 'Plains', 'Forest', 'Desert',
  'Mountains', 'Snowy Tundra', 'Savanna', 'Nether Wastes', 'The End',
];

// Subtle multipliers layered over the already-green textures.
// IMPORTANT: every component must stay within [0, 1]. The mesher packs
// tint * faceShade * AO into an unsigned byte, so anything above 1.0 overflows
// that channel and wraps to near-zero (which turned forest grass dark red).
export const BIOME_GRASS = [
  [0.85, 1.00, 0.85], [1.00, 0.98, 0.80], [1.00, 0.98, 0.72], [0.81, 1.00, 0.67],
  [1.00, 0.86, 0.48], [0.86, 0.98, 0.86], [0.74, 0.94, 1.00], [1.00, 0.86, 0.48],
  [1, 1, 1], [1, 1, 1],
];
export const BIOME_FOLIAGE = [
  [0.80, 0.95, 0.80], [0.95, 0.95, 0.78], [0.96, 0.98, 0.70], [0.78, 1.00, 0.66],
  [1.00, 0.86, 0.48], [0.80, 0.94, 0.82], [0.70, 0.90, 0.98], [1.00, 0.87, 0.49],
  [1, 1, 1], [1, 1, 1],
];
/** Fog / sky tint per biome, blended by the renderer as the player travels. */
export const BIOME_SKY = [
  [0.42, 0.60, 0.92], [0.48, 0.66, 0.95], [0.48, 0.68, 0.98], [0.45, 0.66, 0.95],
  [0.62, 0.76, 0.95], [0.50, 0.70, 1.00], [0.62, 0.76, 0.92], [0.60, 0.74, 0.95],
  [0.28, 0.06, 0.05], [0.05, 0.02, 0.08],
];

const ORE_CONFIG = [
  // block,        veins/chunk, size,   minY, maxY, biomeOnly
  [B.COAL_ORE, 20, [4, 15], 6, 118, null],
  [B.IRON_ORE, 13, [3, 9], 5, 70, null],
  [B.GOLD_ORE, 3, [2, 7], 5, 34, null],
  [B.REDSTONE_ORE, 5, [3, 8], 5, 18, null],
  [B.LAPIS_ORE, 2, [2, 6], 5, 32, null],
  [B.DIAMOND_ORE, 2.2, [2, 6], 5, 15, null],
  [B.EMERALD_ORE, 0.8, [1, 2], 6, 40, BIOME.MOUNTAINS],
  [B.GRANITE, 6, [10, 26], 5, 80, null],
  [B.ANDESITE, 6, [10, 26], 5, 80, null],
  [B.DIORITE, 6, [10, 26], 5, 80, null],
  [B.GRAVEL, 5, [8, 22], 6, 90, null],
  [B.CLAY, 1.5, [4, 10], 45, 66, null],
];

export class WorldGen {
  constructor(seed, dim = DIM.OVERWORLD, opts = {}) {
    this.seed = seed >>> 0;
    this.dim = dim;
    this.structures = opts.structures !== false;
    const s = this.seed;
    this.nCont = new Noise(s ^ 0x1111);
    this.nHills = new Noise(s ^ 0x2222);
    this.nMount = new Noise(s ^ 0x3333);
    this.nErode = new Noise(s ^ 0x4444);
    this.nTemp = new Noise(s ^ 0x5555);
    this.nHumid = new Noise(s ^ 0x6666);
    this.nCave = new Noise(s ^ 0x7777);
    this.nCave2 = new Noise(s ^ 0x8888);
    this.nRavine = new Noise(s ^ 0x9999);
    this.nNether = new Noise(s ^ 0xaaaa);
    this.nEnd = new Noise(s ^ 0xbbbb);
    this.nSurf = new Noise(s ^ 0xcccc);
    this._hCache = new Map();
  }

  // -------------------------------------------------------------------------
  // Overworld shape
  // -------------------------------------------------------------------------

  /** Terrain surface height at a world column (overworld only). */
  groundHeight(x, z) {
    const key = (x & 0xffff) * 65536 + (z & 0xffff);
    const c = this._hCache.get(key);
    if (c !== undefined) return c;
    const cont = this.nCont.fbm2(x * 0.0013, z * 0.0013, 4);
    const ero = 1 - Math.abs(this.nErode.fbm2(x * 0.0035, z * 0.0035, 3));
    const hills = this.nHills.fbm2(x * 0.0085, z * 0.0085, 4);
    const mount = this.nMount.ridged2(x * 0.0026, z * 0.0026, 4);

    let h = SEA_LEVEL + cont * 30;
    h += hills * 10 * (0.35 + 0.65 * ero);
    const mMask = smoothstep(0.10, 0.55, cont);
    h += mount * 48 * mMask * mMask;
    // Two extra relief bands. Without these the low-frequency noise rounds into
    // wide flat plateaus and the world reads as terraced steps.
    h += this.nHills.fbm2(x * 0.021, z * 0.021, 3) * 3.4;
    h += this.nSurf.noise2(x * 0.055, z * 0.055) * 1.6;
    h = clamp(Math.round(h), 6, CHUNK_Y - 8);
    if (this._hCache.size > 200000) this._hCache.clear();
    this._hCache.set(key, h);
    return h;
  }

  biomeAt(x, z) {
    if (this.dim === DIM.NETHER) return BIOME.NETHER;
    if (this.dim === DIM.END) return BIOME.END;
    const h = this.groundHeight(x, z);
    return this.biomeFrom(x, z, h);
  }

  biomeFrom(x, z, h) {
    if (h < SEA_LEVEL - 3) return BIOME.OCEAN;
    const t = this.nTemp.fbm2(x * 0.0011 + 31.1, z * 0.0011 - 17.3, 3);
    if (h <= SEA_LEVEL + 1) return t < -0.3 ? BIOME.SNOWY : BIOME.BEACH;
    if (h > 95) return BIOME.MOUNTAINS;
    const w = this.nHumid.fbm2(x * 0.0014 - 71.7, z * 0.0014 + 43.9, 3);
    if (t < -0.3) return BIOME.SNOWY;
    if (t > 0.32 && w < -0.05) return BIOME.DESERT;
    if (t > 0.15 && w < 0.15) return BIOME.SAVANNA;
    if (w > 0.10) return BIOME.FOREST;
    return BIOME.PLAINS;
  }

  /**
   * @param surfaceY terrain height of this column; caves pinch shut as they
   *        approach it so they can't scoop away the landscape. Without this
   *        taper, tunnels that happen to run near the surface strip the soil
   *        off whole hillsides and leave giant open scars.
   */
  isCave(x, y, z, surfaceY) {
    const depth = surfaceY - y;
    if (depth < 2) return false;
    // Fully open by ~14 blocks down; below that the tunnel narrows to a
    // chimney, which is what turns a scar into a proper cave mouth.
    const taper = smoothstep(2, 14, depth);
    if (taper <= 0.001) return false;

    // Winding tunnels: the thin shell around a 3D noise zero-crossing.
    const n1 = this.nCave.fbm3(x * 0.022, y * 0.045, z * 0.022, 3);
    if (Math.abs(n1) < 0.052 * taper) return true;
    const n2 = this.nCave2.fbm3(x * 0.016, y * 0.034, z * 0.016, 2);
    if (Math.abs(n2) < 0.040 * taper) return true;
    // Big low caverns where the good ore lives.
    if (y < 52) {
      const cav = this.nCave2.noise3(x * 0.013, y * 0.026, z * 0.013);
      if (cav > 0.52 + (y / 52) * 0.18 + (1 - taper) * 0.35) return true;
    }
    // Ravines: long narrow vertical canyons. They deliberately stop well short
    // of the surface — a ravine that breached daylight would pour skylight all
    // the way to bedrock and there would be no dark caves left to explore.
    if (y > 11 && y < 47) {
      const rv = this.nRavine.fbm2(x * 0.0042, z * 0.0042, 2);
      const halfWidth = 0.009 * (1 - Math.abs(y - 29) / 18);
      if (Math.abs(rv) < halfWidth) return true;
    }
    return false;
  }

  // -------------------------------------------------------------------------
  // Chunk entry point
  // -------------------------------------------------------------------------

  generate(cx, cz) {
    const blocks = new Uint8Array(CHUNK_VOL);
    const biomes = new Uint8Array(CHUNK_X * CHUNK_Z);
    const heights = new Uint8Array(CHUNK_X * CHUNK_Z);
    const out = { blocks, biomes, heights, entities: [], spawners: [], villagers: [], crystals: [] };
    if (this.dim === DIM.NETHER) this.genNether(cx, cz, out);
    else if (this.dim === DIM.END) this.genEnd(cx, cz, out);
    else this.genOverworld(cx, cz, out);
    return out;
  }

  // -------------------------------------------------------------------------
  // Overworld
  // -------------------------------------------------------------------------

  genOverworld(cx, cz, out) {
    const { blocks, biomes, heights } = out;
    const bx = cx * CHUNK_X, bz = cz * CHUNK_Z;

    for (let lz = 0; lz < CHUNK_Z; lz++) {
      for (let lx = 0; lx < CHUNK_X; lx++) {
        const wx = bx + lx, wz = bz + lz;
        const h = this.groundHeight(wx, wz);
        const biome = this.biomeFrom(wx, wz, h);
        biomes[lx + lz * CHUNK_X] = biome;
        heights[lx + lz * CHUNK_X] = h;

        // Gravel patches along the shoreline. It's the only source of flint,
        // which gates flint and steel and therefore the Nether, so it has to be
        // findable without mining to y=20 — beaches are where players look.
        const shorePatch = this.nTemp.fbm2(wx * 0.055 + 91.7, wz * 0.055 - 44.3, 2) > 0.24;

        let top = B.GRASS, filler = B.DIRT, fillDepth = 3;
        switch (biome) {
          case BIOME.OCEAN:
            top = h < SEA_LEVEL - 8 || shorePatch ? B.GRAVEL : B.SAND;
            filler = B.SAND;
            break;
          case BIOME.BEACH:
            top = shorePatch ? B.GRAVEL : B.SAND;
            filler = shorePatch ? B.GRAVEL : B.SAND;
            fillDepth = shorePatch ? 2 : 4;
            break;
          case BIOME.DESERT: top = B.SAND; filler = B.SANDSTONE; fillDepth = 5; break;
          case BIOME.SNOWY: top = B.GRASS; filler = B.DIRT; break;
          case BIOME.MOUNTAINS:
            if (h > 104) { top = B.SNOW_BLOCK; filler = B.STONE; }
            else if (h > 88) { top = B.STONE; filler = B.STONE; }
            break;
          case BIOME.SAVANNA: top = B.GRASS; filler = B.DIRT; break;
          default: break;
        }

        for (let y = 0; y < CHUNK_Y; y++) {
          const i = idx(lx, y, lz);
          let b;
          if (y === 0) b = B.BEDROCK;
          else if (y < 4 && hash3(wx, y, wz, this.seed) < (4 - y) / 4) b = B.BEDROCK;
          else if (y > h) b = y <= SEA_LEVEL ? B.WATER : B.AIR;
          else if (y === h) b = top;
          else if (y > h - fillDepth) b = filler;
          else b = B.STONE;
          blocks[i] = b;
        }

        // Snow blanket on cold ground
        if (biome === BIOME.SNOWY && h > SEA_LEVEL && h + 1 < CHUNK_Y) {
          blocks[idx(lx, h + 1, lz)] = B.SNOW_LAYER;
        }
        if (biome === BIOME.OCEAN && h <= SEA_LEVEL - 1 && this.nTemp.fbm2(wx * 0.0011 + 31.1, wz * 0.0011 - 17.3, 3) < -0.34) {
          blocks[idx(lx, SEA_LEVEL, lz)] = B.ICE;
        }
      }
    }

    // --- caves -------------------------------------------------------------
    for (let lz = 0; lz < CHUNK_Z; lz++) {
      for (let lx = 0; lx < CHUNK_X; lx++) {
        const wx = bx + lx, wz = bz + lz;
        const h = heights[lx + lz * CHUNK_X];
        for (let y = 4; y <= h; y++) {
          const i = idx(lx, y, lz);
          const b = blocks[i];
          if (b !== B.STONE && b !== B.DIRT && b !== B.GRASS && b !== B.SAND &&
              b !== B.SANDSTONE && b !== B.GRAVEL && b !== B.SNOW_BLOCK) continue;
          if (this.isCave(wx, y, wz, h)) blocks[i] = B.AIR;
        }
        // Lava sea in the deepest layers fills whatever the caves opened up.
        for (let y = 1; y < 11; y++) {
          const i = idx(lx, y, lz);
          if (blocks[i] === B.AIR) blocks[i] = B.LAVA;
        }
      }
    }

    // --- ores --------------------------------------------------------------
    this.placeOres(cx, cz, blocks, biomes);

    // --- structures --------------------------------------------------------
    if (this.structures) this.applyStructures(cx, cz, out);

    // --- surface decoration ------------------------------------------------
    this.decorate(cx, cz, out);
  }

  placeOres(cx, cz, blocks, biomes) {
    const rnd = mulberry32(hashString(`ore:${this.seed}:${cx}:${cz}`));
    const bx = cx * CHUNK_X, bz = cz * CHUNK_Z;
    for (const [block, perChunk, size, minY, maxY, biomeOnly] of ORE_CONFIG) {
      let n = Math.floor(perChunk);
      if (rnd() < perChunk - n) n++;
      for (let v = 0; v < n; v++) {
        const ox = rnd() * CHUNK_X, oz = rnd() * CHUNK_Z;
        const oy = minY + rnd() * (maxY - minY);
        if (biomeOnly !== null) {
          const bi = biomes[(Math.min(15, ox | 0)) + (Math.min(15, oz | 0)) * CHUNK_X];
          if (bi !== biomeOnly) continue;
        }
        const count = size[0] + Math.floor(rnd() * (size[1] - size[0] + 1));
        // random-walk blob so veins look organic rather than spherical
        let px = ox, py = oy, pz = oz;
        for (let k = 0; k < count; k++) {
          const ix = Math.round(px), iy = Math.round(py), iz = Math.round(pz);
          if (ix >= 0 && ix < CHUNK_X && iz >= 0 && iz < CHUNK_Z && iy > 0 && iy < CHUNK_Y) {
            const i = idx(ix, iy, iz);
            if (blocks[i] === B.STONE) blocks[i] = block;
          }
          px += (rnd() - 0.5) * 2.2;
          py += (rnd() - 0.5) * 1.8;
          pz += (rnd() - 0.5) * 2.2;
        }
      }
    }
    void bx; void bz;
  }

  applyStructures(cx, cz, out) {
    const { blocks } = out;
    const cwx0 = cx * CHUNK_X, cwx1 = cwx0 + CHUNK_X - 1;
    const cwz0 = cz * CHUNK_Z, cwz1 = cwz0 + CHUNK_Z - 1;
    const overlaps = (b) => !(b.x1 < cwx0 || b.x0 > cwx1 || b.z1 < cwz0 || b.z0 > cwz1);
    const take = (st) => {
      if (!st || !overlaps(st.bounds)) return;
      applyOps(st.ops, cx, cz, blocks, CHUNK_Y);
      for (const e of st.entities) {
        if (e.x >= cwx0 && e.x <= cwx1 && e.z >= cwz0 && e.z <= cwz1) out.entities.push(e);
      }
      for (const s of st.spawners) {
        if (s.x >= cwx0 && s.x <= cwx1 && s.z >= cwz0 && s.z <= cwz1) out.spawners.push(s);
      }
      if (st.villagers) {
        for (const v of st.villagers) {
          if (v.x >= cwx0 && v.x <= cwx1 && v.z >= cwz0 && v.z <= cwz1) out.villagers.push(v);
        }
      }
    };

    for (const site of strongholdSites(this.seed)) {
      if (Math.abs(site.x - cwx0) > 90 || Math.abs(site.z - cwz0) > 90) continue;
      take(strongholdLayout(site));
    }
    for (const site of villageSites(this.seed, cx, cz)) {
      if (Math.abs(site.x - cwx0) > 80 || Math.abs(site.z - cwz0) > 80) continue;
      take(villageLayout(site, (x, z) => this.groundHeight(x, z), (x, z) => this.biomeAt(x, z)));
    }
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        take(dungeonAt(this.seed, cx + dx, cz + dz));
      }
    }
  }

  // -------------------------------------------------------------------------
  // Decoration (trees, plants) — features from neighbouring chunks are replayed
  // so canopies cross chunk borders seamlessly.
  // -------------------------------------------------------------------------

  decorate(cx, cz, out) {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (const f of this.featuresFor(cx + dx, cz + dz)) {
          this.placeFeature(f, cx, cz, out);
        }
      }
    }
  }

  featuresFor(cx, cz) {
    const rnd = mulberry32(hashString(`deco:${this.seed}:${cx}:${cz}`));
    const feats = [];
    const bx = cx * CHUNK_X, bz = cz * CHUNK_Z;
    const sample = () => [bx + Math.floor(rnd() * CHUNK_X), bz + Math.floor(rnd() * CHUNK_Z)];

    // trees
    const [px, pz] = [bx + 8, bz + 8];
    const biome = this.biomeAt(px, pz);
    let treeCount = 0, kind = 'oak';
    switch (biome) {
      case BIOME.FOREST: treeCount = 7 + Math.floor(rnd() * 7); kind = rnd() < 0.35 ? 'birch' : 'oak'; break;
      case BIOME.PLAINS: treeCount = rnd() < 0.35 ? 1 + Math.floor(rnd() * 2) : 0; break;
      case BIOME.SAVANNA: treeCount = rnd() < 0.4 ? 1 : 0; break;
      case BIOME.SNOWY: treeCount = 2 + Math.floor(rnd() * 4); kind = 'spruce'; break;
      case BIOME.MOUNTAINS: treeCount = rnd() < 0.5 ? 1 + Math.floor(rnd() * 2) : 0; kind = 'spruce'; break;
      default: treeCount = 0;
    }
    for (let i = 0; i < treeCount; i++) {
      const [x, z] = sample();
      feats.push({ kind: 'tree', type: kind, x, z, r: rnd() });
    }

    // ground clutter
    if (biome === BIOME.DESERT) {
      for (let i = 0; i < 2; i++) if (rnd() < 0.5) { const [x, z] = sample(); feats.push({ kind: 'cactus', x, z, r: rnd() }); }
      for (let i = 0; i < 3; i++) if (rnd() < 0.4) { const [x, z] = sample(); feats.push({ kind: 'deadbush', x, z, r: rnd() }); }
    } else if (biome !== BIOME.OCEAN) {
      const n = biome === BIOME.PLAINS || biome === BIOME.SAVANNA ? 26 : 14;
      for (let i = 0; i < n; i++) { const [x, z] = sample(); feats.push({ kind: 'grass', x, z, r: rnd() }); }
      for (let i = 0; i < 3; i++) if (rnd() < 0.5) { const [x, z] = sample(); feats.push({ kind: 'flower', x, z, r: rnd() }); }
      if (rnd() < 0.10) { const [x, z] = sample(); feats.push({ kind: 'pumpkin', x, z, r: rnd() }); }
      if (rnd() < 0.14) { const [x, z] = sample(); feats.push({ kind: 'melon', x, z, r: rnd() }); }
    }
    if (rnd() < 0.4) { const [x, z] = sample(); feats.push({ kind: 'cane', x, z, r: rnd() }); }
    return feats;
  }

  placeFeature(f, cx, cz, out) {
    const { blocks } = out;
    const bx = cx * CHUNK_X, bz = cz * CHUNK_Z;
    const set = (x, y, z, b, soft = false) => {
      const lx = x - bx, lz = z - bz;
      if (lx < 0 || lx >= CHUNK_X || lz < 0 || lz >= CHUNK_Z || y < 0 || y >= CHUNK_Y) return;
      const i = idx(lx, y, lz);
      if (soft && blocks[i] !== B.AIR) return;
      blocks[i] = b;
    };
    const at = (x, y, z) => {
      const lx = x - bx, lz = z - bz;
      if (lx < 0 || lx >= CHUNK_X || lz < 0 || lz >= CHUNK_Z || y < 0 || y >= CHUNK_Y) return -1;
      return blocks[idx(lx, y, lz)];
    };

    const h = this.groundHeight(f.x, f.z);
    if (h <= SEA_LEVEL) {
      if (f.kind !== 'cane') return;
    }
    const ground = at(f.x, h, f.z);
    // The ground column may live in a neighbouring chunk; if we can see it and
    // it's clearly wrong (water/cave), bail out.
    if (ground !== -1 && ground !== B.GRASS && ground !== B.SAND && ground !== B.DIRT &&
        ground !== B.SNOW_BLOCK && ground !== B.STONE) return;

    switch (f.kind) {
      case 'tree': {
        const type = f.type;
        if (ground === B.SAND && type !== 'palm') return;
        const log = type === 'birch' ? B.BIRCH_LOG : type === 'spruce' ? B.SPRUCE_LOG : B.OAK_LOG;
        const leaf = type === 'birch' ? B.BIRCH_LEAVES : type === 'spruce' ? B.SPRUCE_LEAVES : B.OAK_LEAVES;
        if (type === 'spruce') {
          const th = 7 + Math.floor(f.r * 5);
          for (let y = 1; y <= th; y++) set(f.x, h + y, f.z, log);
          for (let y = 2; y <= th + 1; y++) {
            const t = (th + 1 - y) / th;
            const r = Math.min(3, Math.round(t * 3.4));
            if (r <= 0) { set(f.x, h + y, f.z, leaf, true); continue; }
            for (let dz = -r; dz <= r; dz++) {
              for (let dx = -r; dx <= r; dx++) {
                if (Math.abs(dx) + Math.abs(dz) > r + 1) continue;
                if (dx === 0 && dz === 0 && y <= th) continue;
                set(f.x + dx, h + y, f.z + dz, leaf, true);
              }
            }
          }
          set(f.x, h + th + 2, f.z, leaf, true);
        } else {
          const th = 4 + Math.floor(f.r * (type === 'birch' ? 4 : 3));
          for (let y = 1; y <= th; y++) set(f.x, h + y, f.z, log);
          for (let dy = 0; dy < 2; dy++) {
            for (let dz = -2; dz <= 2; dz++) {
              for (let dx = -2; dx <= 2; dx++) {
                if (Math.abs(dx) === 2 && Math.abs(dz) === 2 && (dx + dz + dy) % 2 === 0) continue;
                if (dx === 0 && dz === 0) continue;
                set(f.x + dx, h + th - 1 + dy, f.z + dz, leaf, true);
              }
            }
          }
          for (let dz = -1; dz <= 1; dz++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (Math.abs(dx) === 1 && Math.abs(dz) === 1) continue;
              set(f.x + dx, h + th + 1, f.z + dz, leaf, true);
            }
          }
          set(f.x, h + th + 1, f.z, leaf, true);
        }
        break;
      }
      case 'cactus': {
        if (ground !== -1 && ground !== B.SAND) return;
        const th = 1 + Math.floor(f.r * 3);
        for (let y = 1; y <= th; y++) set(f.x, h + y, f.z, B.CACTUS, true);
        break;
      }
      case 'deadbush': set(f.x, h + 1, f.z, B.DEAD_BUSH, true); break;
      case 'grass':
        if (ground !== -1 && ground !== B.GRASS) return;
        set(f.x, h + 1, f.z, B.TALL_GRASS, true);
        break;
      case 'flower':
        if (ground !== -1 && ground !== B.GRASS) return;
        set(f.x, h + 1, f.z, f.r < 0.5 ? B.FLOWER_RED : B.FLOWER_YELLOW, true);
        break;
      case 'pumpkin':
        if (ground !== -1 && ground !== B.GRASS) return;
        set(f.x, h + 1, f.z, B.PUMPKIN, true);
        break;
      case 'melon':
        if (ground !== -1 && ground !== B.GRASS) return;
        set(f.x, h + 1, f.z, B.MELON, true);
        break;
      case 'cane': {
        // sugar cane only right next to water
        const near = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => {
          const gh = this.groundHeight(f.x + dx, f.z + dz);
          return gh < h && gh <= SEA_LEVEL;
        });
        if (!near || h > SEA_LEVEL + 2 || h < SEA_LEVEL) return;
        const th = 2 + Math.floor(f.r * 2);
        for (let y = 1; y <= th; y++) set(f.x, h + y, f.z, B.SUGAR_CANE, true);
        break;
      }
      default: break;
    }
  }

  // -------------------------------------------------------------------------
  // Nether
  // -------------------------------------------------------------------------

  genNether(cx, cz, out) {
    const { blocks, biomes, heights } = out;
    const bx = cx * CHUNK_X, bz = cz * CHUNK_Z;
    const LAVA_LEVEL = 31;
    biomes.fill(BIOME.NETHER);

    for (let lz = 0; lz < CHUNK_Z; lz++) {
      for (let lx = 0; lx < CHUNK_X; lx++) {
        const wx = bx + lx, wz = bz + lz;
        let topSolid = 0;
        for (let y = 0; y < CHUNK_Y; y++) {
          const i = idx(lx, y, lz);
          if (y <= 1 || y >= CHUNK_Y - 2) { blocks[i] = B.BEDROCK; continue; }
          // Density biased towards solid, with a hard push near the floor and
          // ceiling. The Nether must read as a solid mass hollowed out by huge
          // caverns — bias it the other way and it becomes a floating void.
          const edge = Math.max(0, (10 - y) / 10, (y - 100) / 22);
          const d = this.nNether.fbm3(wx * 0.016, y * 0.024, wz * 0.016, 3) * 3.0 + 0.15 + edge * 2.5;
          if (d > 0) {
            blocks[i] = B.NETHERRACK;
            topSolid = y;
          } else {
            blocks[i] = y <= LAVA_LEVEL ? B.LAVA : B.AIR;
          }
        }
        heights[lx + lz * CHUNK_X] = Math.min(255, topSolid);

        // soul sand shores and quartz/glowstone dressing
        const rnd = mulberry32(hashString(`neth:${this.seed}:${wx}:${wz}`));
        for (let y = LAVA_LEVEL; y < LAVA_LEVEL + 4; y++) {
          const i = idx(lx, y, lz);
          if (blocks[i] === B.NETHERRACK && blocks[idx(lx, y + 1, lz)] === B.AIR && rnd() < 0.22) {
            blocks[i] = B.SOUL_SAND;
          }
        }
        for (let y = 36; y < 108; y++) {
          const i = idx(lx, y, lz);
          if (blocks[i] !== B.NETHERRACK) continue;
          const above = blocks[idx(lx, y + 1, lz)];
          const below = blocks[idx(lx, Math.max(0, y - 1), lz)];
          if (below === B.AIR && rnd() < 0.012) {
            // glowstone hangs from cave ceilings
            for (let k = 0; k < 4 && y - k > 0; k++) {
              if (blocks[idx(lx, y - k, lz)] === B.AIR || k === 0) blocks[idx(lx, y - k, lz)] = B.GLOWSTONE;
              else break;
            }
          } else if (rnd() < 0.010) blocks[i] = B.QUARTZ_ORE;
          else if (above === B.AIR && rnd() < 0.006) blocks[i] = B.MAGMA;
        }
      }
    }

    if (this.structures) {
      const cwx0 = bx, cwx1 = bx + 15, cwz0 = bz, cwz1 = bz + 15;
      for (const site of fortressSites(this.seed, cx, cz)) {
        const st = fortressLayout(site);
        const b = st.bounds;
        if (b.x1 < cwx0 || b.x0 > cwx1 || b.z1 < cwz0 || b.z0 > cwz1) continue;
        applyOps(st.ops, cx, cz, blocks, CHUNK_Y);
        for (const e of st.entities) if (e.x >= cwx0 && e.x <= cwx1 && e.z >= cwz0 && e.z <= cwz1) out.entities.push(e);
        for (const s of st.spawners) if (s.x >= cwx0 && s.x <= cwx1 && s.z >= cwz0 && s.z <= cwz1) out.spawners.push(s);
      }
    }
  }

  // -------------------------------------------------------------------------
  // The End
  // -------------------------------------------------------------------------

  genEnd(cx, cz, out) {
    const { blocks, biomes, heights } = out;
    const bx = cx * CHUNK_X, bz = cz * CHUNK_Z;
    biomes.fill(BIOME.END);
    const TOP = 64;
    const R = 44;

    for (let lz = 0; lz < CHUNK_Z; lz++) {
      for (let lx = 0; lx < CHUNK_X; lx++) {
        const wx = bx + lx, wz = bz + lz;
        const d = Math.hypot(wx, wz);
        const wobble = this.nEnd.fbm2(wx * 0.03, wz * 0.03, 3) * 7;
        const edge = R + wobble;
        let surfaceY = 0;
        if (d < edge) {
          const t = 1 - d / edge;
          const thick = 3 + Math.round(14 * Math.pow(t, 0.55) + this.nEnd.noise2(wx * 0.06, wz * 0.06) * 2);
          for (let y = TOP - thick; y <= TOP; y++) blocks[idx(lx, y, lz)] = B.END_STONE;
          surfaceY = TOP;
        } else if (d > 110) {
          // sparse outer islands for scale
          const n = this.nEnd.fbm2(wx * 0.008, wz * 0.008, 3);
          if (n > 0.42) {
            const iy = 78 + Math.round(this.nEnd.noise2(wx * 0.004, wz * 0.004) * 16);
            const thick = Math.round((n - 0.42) * 34);
            for (let y = iy - thick; y <= iy; y++) if (y > 0 && y < CHUNK_Y) blocks[idx(lx, y, lz)] = B.END_STONE;
            surfaceY = iy;
          }
        }
        heights[lx + lz * CHUNK_X] = Math.min(255, surfaceY);
      }
    }

    // --- obsidian pillars with End Crystals on top -------------------------
    const PILLARS = 10;
    for (let i = 0; i < PILLARS; i++) {
      const ang = (i / PILLARS) * Math.PI * 2;
      const pr = 36;
      const px = Math.round(Math.cos(ang) * pr), pz = Math.round(Math.sin(ang) * pr);
      const rad = 2 + (i % 3);
      const ph = TOP + 20 + (i % 4) * 7;
      if (px + rad + 2 < bx || px - rad - 2 > bx + 15 || pz + rad + 2 < bz || pz - rad - 2 > bz + 15) {
        // still report the crystal so the dimension can spawn it
        if (cx === 0 && cz === 0) out.crystals.push({ x: px + 0.5, y: ph + 2, z: pz + 0.5, i });
        continue;
      }
      for (let y = TOP - 6; y <= ph; y++) {
        for (let dz = -rad; dz <= rad; dz++) {
          for (let dx = -rad; dx <= rad; dx++) {
            if (dx * dx + dz * dz > rad * rad + 0.5) continue;
            const lx = px + dx - bx, lz = pz + dz - bz;
            if (lx < 0 || lx > 15 || lz < 0 || lz > 15) continue;
            blocks[idx(lx, y, lz)] = B.OBSIDIAN;
          }
        }
      }
      // bedrock cap the crystal sits on
      const lx = px - bx, lz = pz - bz;
      if (lx >= 0 && lx <= 15 && lz >= 0 && lz <= 15) {
        blocks[idx(lx, ph + 1, lz)] = B.BEDROCK;
        for (let y = TOP - 6; y <= ph; y++) heights[lx + lz * CHUNK_X] = ph + 1;
      }
      if (cx === 0 && cz === 0) out.crystals.push({ x: px + 0.5, y: ph + 2, z: pz + 0.5, i });
    }

    // --- arrival platform at the island centre -----------------------------
    if (Math.abs(bx) <= 16 && Math.abs(bz) <= 16) {
      for (let dz = -3; dz <= 3; dz++) {
        for (let dx = -3; dx <= 3; dx++) {
          const lx = dx - bx, lz = dz - bz;
          if (lx < 0 || lx > 15 || lz < 0 || lz > 15) continue;
          blocks[idx(lx, TOP, lz)] = B.OBSIDIAN;
          for (let y = TOP + 1; y < TOP + 4; y++) blocks[idx(lx, y, lz)] = B.AIR;
        }
      }
    }
  }
}
