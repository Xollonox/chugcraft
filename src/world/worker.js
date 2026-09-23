// ============================================================================
// Chunk worker. Owns a mirror of the voxel data for the active dimension and
// does all the expensive work off the main thread: terrain generation, light
// propagation and meshing. The main thread keeps its own copy of blocks + light
// for physics and queries, kept in sync through explicit messages.
// ============================================================================

import { CHUNK_X, CHUNK_Z, CHUNK_Y, CHUNK_VOL, idx, DIM } from '../constants.js';
import { WorldGen } from './worldgen.js';
import { LightEngine } from './lighting.js';
import { meshChunk, pidx, PAD_SIZE } from './mesher.js';
import { buildFaceTables } from '../engine/atlas.js';
import { BLOCKS, BLOCK_COUNT, IS_OCCLUDER } from './blocks.js';

const key = (cx, cz) => cx + ',' + cz;

// "Fast" leaves occlude their neighbours, so faces buried inside a canopy are
// never built. Cheaper to mesh and to draw, at the cost of a little see-through.
const LEAF_IDS = [];
for (let i = 0; i < BLOCK_COUNT; i++) {
  if (BLOCKS[i] && BLOCKS[i].id === i && BLOCKS[i].key.endsWith('_leaves')) LEAF_IDS.push(i);
}
function setFastLeaves(fast) {
  for (const id of LEAF_IDS) IS_OCCLUDER[id] = fast ? 1 : 0;
}

let gen = null;
let dim = DIM.OVERWORLD;
let seed = 1;
let structures = true;
let smoothLighting = true;
const chunks = new Map();
const dirty = new Set();
let faceTables = null;

// --- store interface consumed by the light engine ---------------------------
const store = {
  chunkAt(cx, cz) { return chunks.get(key(cx, cz)); },
  isLoadedChunk(cx, cz) { return chunks.has(key(cx, cz)); },
  isLoaded(x, z) { return chunks.has(key(x >> 4, z >> 4)); },
  get(x, y, z) {
    if (y < 0 || y >= CHUNK_Y) return 0;
    const c = chunks.get(key(x >> 4, z >> 4));
    if (!c) return 0;
    return c.blocks[idx(x & 15, y, z & 15)];
  },
  getLight(x, y, z) {
    if (y < 0 || y >= CHUNK_Y) return y >= CHUNK_Y ? 0xf0 : 0;
    const c = chunks.get(key(x >> 4, z >> 4));
    if (!c) return 0;
    return c.light[idx(x & 15, y, z & 15)];
  },
  setLight(x, y, z, v) {
    if (y < 0 || y >= CHUNK_Y) return;
    const c = chunks.get(key(x >> 4, z >> 4));
    if (!c) return;
    c.light[idx(x & 15, y, z & 15)] = v;
  },
  touch(x, z) { dirty.add(key(x >> 4, z >> 4)); },
};

const light = new LightEngine(store);

// Scratch padded views reused across meshing calls.
const padBlocks = new Uint8Array(PAD_SIZE);
const padLight = new Uint8Array(PAD_SIZE);

function neighborsReady(cx, cz) {
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!chunks.has(key(cx + dx, cz + dz))) return false;
    }
  }
  return true;
}

function buildPad(cx, cz) {
  padBlocks.fill(0);
  padLight.fill(0);
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const c = chunks.get(key(cx + dx, cz + dz));
      if (!c) continue;
      const x0 = dx === -1 ? CHUNK_X - 1 : 0;
      const x1 = dx === 1 ? 0 : CHUNK_X - 1;
      const z0 = dz === -1 ? CHUNK_Z - 1 : 0;
      const z1 = dz === 1 ? 0 : CHUNK_Z - 1;
      for (let y = 0; y < CHUNK_Y; y++) {
        for (let z = z0; z <= z1; z++) {
          for (let x = x0; x <= x1; x++) {
            const px = dx * CHUNK_X + x, pz = dz * CHUNK_Z + z;
            if (px < -1 || px > CHUNK_X || pz < -1 || pz > CHUNK_Z) continue;
            const si = idx(x, y, z);
            const di = pidx(px, y, pz);
            padBlocks[di] = c.blocks[si];
            padLight[di] = c.light[si];
          }
        }
      }
    }
  }
}

function meshOne(cx, cz) {
  const c = chunks.get(key(cx, cz));
  if (!c) return null;
  buildPad(cx, cz);
  const meshes = meshChunk(padBlocks, padLight, c.biomes, cx, cz,
    faceTables.tileOf, faceTables.framesOf, { smoothLighting });
  return meshes;
}

function postMesh(cx, cz, extra = {}) {
  const meshes = meshOne(cx, cz);
  if (!meshes) return;
  const transfers = [];
  for (const m of meshes) {
    if (!m) continue;
    transfers.push(m.position.buffer, m.uv.buffer, m.color.buffer,
      m.light.buffer, m.anim.buffer, m.index.buffer);
  }
  const c = chunks.get(key(cx, cz));
  const lightCopy = new Uint8Array(c.light);
  transfers.push(lightCopy.buffer);
  self.postMessage({ type: 'mesh', cx, cz, meshes, light: lightCopy, ...extra }, transfers);
}

/** Flush queued remeshes, skipping chunks whose neighbours aren't loaded yet. */
function flushDirty(limit = 6) {
  let n = 0;
  for (const k of [...dirty]) {
    if (n >= limit) break;
    const [cx, cz] = k.split(',').map(Number);
    if (!chunks.has(k)) { dirty.delete(k); continue; }
    if (!neighborsReady(cx, cz)) continue;
    dirty.delete(k);
    postMesh(cx, cz);
    n++;
  }
  return n;
}

// The dirty queue used to drain only when a message happened to arrive, so a
// bulk edit (an explosion, a roof coming off) could leave chunks stale
// indefinitely if the player then stood still. Keep pumping on our own clock.
let pumpTimer = null;
function schedulePump(delay = 8) {
  if (pumpTimer !== null || dirty.size === 0) return;
  pumpTimer = setTimeout(() => {
    pumpTimer = null;
    const done = flushDirty(4);
    // Nothing meshed means everything left is waiting on neighbouring chunks —
    // back off so we don't spin the worker.
    if (dirty.size > 0) schedulePump(done === 0 ? 150 : 8);
  }, delay);
}

function generate(cx, cz, edits) {
  const k = key(cx, cz);
  if (chunks.has(k)) { dirty.add(k); flushDirty(); return; }
  const out = gen.generate(cx, cz);
  const chunk = {
    blocks: out.blocks,
    light: new Uint8Array(CHUNK_VOL),
    biomes: out.biomes,
    heights: out.heights,
  };
  // Replay the player's saved edits before lighting so shadows are correct.
  if (edits && edits.length) {
    for (let i = 0; i < edits.length; i += 4) {
      const lx = edits[i], y = edits[i + 1], lz = edits[i + 2], id = edits[i + 3];
      if (y >= 0 && y < CHUNK_Y) chunk.blocks[idx(lx, y, lz)] = id;
    }
  }
  chunks.set(k, chunk);
  light.initChunk(chunk, cx, cz);

  // Only transfer buffers we own exclusively. `biomes`/`heights` stay live in
  // this worker (the mesher reads them every remesh), so they are cloned by
  // structured clone instead — transferring them would detach our copy.
  const blocksCopy = new Uint8Array(chunk.blocks);
  const lightCopy = new Uint8Array(chunk.light);
  self.postMessage({
    type: 'chunk', cx, cz,
    blocks: blocksCopy, light: lightCopy,
    biomes: chunk.biomes, heights: chunk.heights,
    entities: out.entities, spawners: out.spawners,
    villagers: out.villagers, crystals: out.crystals,
  }, [blocksCopy.buffer, lightCopy.buffer]);

  dirty.add(k);
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    if (chunks.has(key(cx + dx, cz + dz))) dirty.add(key(cx + dx, cz + dz));
  }
  flushDirty();
}

function setBlock(x, y, z, id) {
  const c = chunks.get(key(x >> 4, z >> 4));
  if (!c || y < 0 || y >= CHUNK_Y) return;
  const i = idx(x & 15, y, z & 15);
  const old = c.blocks[i];
  if (old === id) return;
  c.blocks[i] = id;
  light.updateBlock(x, y, z, old, id);
  dirty.add(key(x >> 4, z >> 4));
  // border blocks change the neighbour's culling too
  const lx = x & 15, lz = z & 15;
  if (lx === 0) dirty.add(key((x >> 4) - 1, z >> 4));
  if (lx === 15) dirty.add(key((x >> 4) + 1, z >> 4));
  if (lz === 0) dirty.add(key(x >> 4, (z >> 4) - 1));
  if (lz === 15) dirty.add(key(x >> 4, (z >> 4) + 1));
}

self.onmessage = (ev) => {
  const m = ev.data;
  switch (m.type) {
    case 'init': {
      seed = m.seed >>> 0;
      dim = m.dim ?? DIM.OVERWORLD;
      structures = m.structures !== false;
      smoothLighting = m.smoothLighting !== false;
      faceTables = buildFaceTables();
      gen = new WorldGen(seed, dim, { structures });
      chunks.clear(); dirty.clear();
      self.postMessage({ type: 'ready' });
      break;
    }
    case 'setDim': {
      dim = m.dim;
      gen = new WorldGen(seed, dim, { structures });
      chunks.clear(); dirty.clear();
      self.postMessage({ type: 'dimReady', dim });
      break;
    }
    case 'options':
      if (m.smoothLighting !== undefined) smoothLighting = m.smoothLighting !== false;
      if (m.fastLeaves !== undefined) setFastLeaves(m.fastLeaves);
      for (const k of chunks.keys()) dirty.add(k);
      flushDirty(64);
      break;
    case 'gen':
      generate(m.cx, m.cz, m.edits);
      break;
    case 'genBatch':
      for (const g of m.list) generate(g.cx, g.cz, g.edits);
      flushDirty(32);
      break;
    case 'set': {
      const list = m.list;
      for (let i = 0; i < list.length; i += 4) setBlock(list[i], list[i + 1], list[i + 2], list[i + 3]);
      flushDirty(24);
      break;
    }
    case 'remesh':
      dirty.add(key(m.cx, m.cz));
      flushDirty(8);
      break;
    case 'unload':
      chunks.delete(key(m.cx, m.cz));
      dirty.delete(key(m.cx, m.cz));
      break;
    case 'flush':
      flushDirty(m.limit ?? 6);
      break;
    default:
      break;
  }
  schedulePump();
};
