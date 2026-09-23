import { isWater, isLava } from './blocks.js';
// ============================================================================
// Main-thread chunk manager: streaming, block access, raycasting and the
// authoritative record of everything the player has changed.
//
// The worker owns generation/lighting/meshing; this class owns the copy the
// game logic reads every frame (physics, raycasts, mob AI) and the delta map
// that gets written to the save file.
// ============================================================================

import * as THREE from 'three';
import {
  CHUNK_X, CHUNK_Z, CHUNK_Y, CHUNK_VOL, idx, DIM, PASS_COUNT, SEA_LEVEL,
} from '../constants.js';
import { B, BLOCKS, IS_SOLID, HEIGHT_OF, getBlock as blockDef } from './blocks.js';
import { geometryFromPass } from '../engine/renderer.js';
import { BIOME } from './worldgen.js';
import { FluidSimulator } from './fluids.js';
import { collisionBoxes } from './shapes.js';

const ckey = (cx, cz) => cx + ',' + cz;
const pkey = (x, y, z) => x + ',' + y + ',' + z;

export class World {
  constructor(opts) {
    this.seed = opts.seed >>> 0;
    this.structures = opts.structures !== false;
    this.scene = opts.scene;
    this.materials = opts.materials;
    this.settings = opts.settings;
    this.dim = DIM.OVERWORLD;
    this.renderDistance = opts.renderDistance ?? 8;

    this.chunks = new Map();          // key -> {cx,cz,blocks,light,biomes,heights,meshes,group}
    this.pending = new Set();         // chunk keys requested from the worker
    this.group = new THREE.Group();
    this.scene.add(this.group);

    // Per-dimension persistent state
    this.edits = [new Map(), new Map(), new Map()];        // dim -> Map(chunkKey -> Map(index -> id))
    this.blockEntities = [new Map(), new Map(), new Map()];// dim -> Map('x,y,z' -> data)
    this.spawners = [new Map(), new Map(), new Map()];
    this.portals = [new Map(), new Map(), new Map()];      // linked nether portals

    this._pendingSets = [];
    this.fluids = new FluidSimulator(this);
    this._listeners = { chunk: [], mesh: [], entities: [], crystals: [], villagers: [] };
    this.chunksLoadedTotal = 0;
    this.ready = false;

    this.worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e) => this._onWorker(e.data);
    this.worker.postMessage({
      type: 'init', seed: this.seed, dim: this.dim, structures: this.structures,
      smoothLighting: this.settings?.get('smoothLighting') !== false,
    });
  }

  on(evt, fn) { this._listeners[evt].push(fn); return this; }
  _emit(evt, ...a) { for (const f of this._listeners[evt]) f(...a); }

  // -------------------------------------------------------------------------
  // Worker plumbing
  // -------------------------------------------------------------------------
  _onWorker(m) {
    switch (m.type) {
      case 'ready': this.ready = true; break;
      case 'dimReady': this.ready = true; this._emit('chunk', null); break;
      case 'chunk': {
        const k = ckey(m.cx, m.cz);
        this.pending.delete(k);
        let c = this.chunks.get(k);
        if (!c) {
          c = { cx: m.cx, cz: m.cz, meshes: new Array(PASS_COUNT).fill(null) };
          this.chunks.set(k, c);
        }
        c.blocks = m.blocks; c.light = m.light; c.biomes = m.biomes; c.heights = m.heights;
        this.chunksLoadedTotal++;
        if (m.entities?.length) {
          const store = this.blockEntities[this.dim];
          for (const e of m.entities) {
            const key = pkey(e.x, e.y, e.z);
            if (!store.has(key)) store.set(key, { type: e.type, items: e.items || [] });
          }
        }
        if (m.spawners?.length) {
          const st = this.spawners[this.dim];
          for (const s of m.spawners) {
            const key = pkey(s.x, s.y, s.z);
            if (!st.has(key)) st.set(key, { ...s, cooldown: 0 });
          }
        }
        if (m.villagers?.length) this._emit('villagers', m.villagers);
        if (m.crystals?.length) this._emit('crystals', m.crystals);
        this.fluids.onChunk(c);
        this._emit('chunk', c);
        break;
      }
      case 'mesh': {
        const k = ckey(m.cx, m.cz);
        const c = this.chunks.get(k);
        if (!c) return;
        if (m.light) c.light = m.light;
        this._applyMeshes(c, m.meshes);
        this._emit('mesh', c);
        break;
      }
      default: break;
    }
  }

  _applyMeshes(c, meshes) {
    for (let p = 0; p < PASS_COUNT; p++) {
      const old = c.meshes[p];
      const data = meshes[p];
      if (!data) {
        if (old) { this.group.remove(old); old.geometry.dispose(); c.meshes[p] = null; }
        continue;
      }
      const geo = geometryFromPass(data);
      if (old) {
        this.group.remove(old);
        old.geometry.dispose();
      }
      const mesh = new THREE.Mesh(geo, this.materials[p]);
      mesh.frustumCulled = true;
      mesh.renderOrder = p === 2 ? 2 : 0;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      this.group.add(mesh);
      c.meshes[p] = mesh;
    }
  }

  setDimension(dim) {
    this.flushSets();
    this.fluids.reset();
    for (const c of this.chunks.values()) {
      for (const m of c.meshes) if (m) { this.group.remove(m); m.geometry.dispose(); }
    }
    this.chunks.clear();
    this.pending.clear();
    this.dim = dim;
    this.ready = false;
    this.worker.postMessage({ type: 'setDim', dim });
  }

  setSmoothLighting(v) {
    this.worker.postMessage({ type: 'options', smoothLighting: v });
  }

  // -------------------------------------------------------------------------
  // Streaming
  // -------------------------------------------------------------------------
  update(px, pz, budget = 3) {
    if (!this.ready) return;
    const pcx = Math.floor(px / CHUNK_X), pcz = Math.floor(pz / CHUNK_Z);
    const R = this.renderDistance;
    const want = [];
    for (let dz = -R; dz <= R; dz++) {
      for (let dx = -R; dx <= R; dx++) {
        const d2 = dx * dx + dz * dz;
        if (d2 > R * R + R) continue;
        const cx = pcx + dx, cz = pcz + dz;
        const k = ckey(cx, cz);
        if (this.chunks.has(k) || this.pending.has(k)) continue;
        want.push([d2, cx, cz, k]);
      }
    }
    want.sort((a, b) => a[0] - b[0]);
    const batch = [];
    for (let i = 0; i < Math.min(budget, want.length); i++) {
      const [, cx, cz, k] = want[i];
      this.pending.add(k);
      batch.push({ cx, cz, edits: this._editsFor(cx, cz) });
    }
    if (batch.length) this.worker.postMessage({ type: 'genBatch', list: batch });

    // unload
    const UR = R + 2;
    for (const [k, c] of this.chunks) {
      const dx = c.cx - pcx, dz = c.cz - pcz;
      if (dx * dx + dz * dz > UR * UR) {
        for (const m of c.meshes) if (m) { this.group.remove(m); m.geometry.dispose(); }
        this.chunks.delete(k);
        this.worker.postMessage({ type: 'unload', cx: c.cx, cz: c.cz });
      }
    }
  }

  _editsFor(cx, cz) {
    const m = this.edits[this.dim].get(ckey(cx, cz));
    if (!m || m.size === 0) return null;
    const arr = new Int32Array(m.size * 4);
    let i = 0;
    for (const [index, id] of m) {
      const y = (index / (CHUNK_X * CHUNK_Z)) | 0;
      const r = index % (CHUNK_X * CHUNK_Z);
      arr[i++] = r % CHUNK_X;
      arr[i++] = y;
      arr[i++] = (r / CHUNK_X) | 0;
      arr[i++] = id;
    }
    return arr;
  }

  // -------------------------------------------------------------------------
  // Block access
  // -------------------------------------------------------------------------
  chunkAt(x, z) { return this.chunks.get(ckey(x >> 4, z >> 4)); }
  isLoaded(x, z) { return this.chunks.has(ckey(x >> 4, z >> 4)); }

  getBlock(x, y, z) {
    if (y < 0 || y >= CHUNK_Y) return 0;
    const c = this.chunks.get(ckey(x >> 4, z >> 4));
    if (!c || !c.blocks) return 0;
    return c.blocks[idx(x & 15, y, z & 15)];
  }

  getLight(x, y, z) {
    if (y < 0) return 0;
    if (y >= CHUNK_Y) return 0xf0;
    const c = this.chunks.get(ckey(x >> 4, z >> 4));
    if (!c || !c.light) return 0;
    return c.light[idx(x & 15, y, z & 15)];
  }

  skyLight(x, y, z) { return (this.getLight(x, y, z) >> 4) & 15; }
  blockLight(x, y, z) { return this.getLight(x, y, z) & 15; }

  biomeAt(x, z) {
    const c = this.chunks.get(ckey(x >> 4, z >> 4));
    if (!c || !c.biomes) return BIOME.PLAINS;
    return c.biomes[(x & 15) + (z & 15) * CHUNK_X];
  }

  /** Highest non-air block in a column (main-thread scan). */
  heightAt(x, z) {
    const c = this.chunks.get(ckey(x >> 4, z >> 4));
    if (!c || !c.blocks) return -1;
    const lx = x & 15, lz = z & 15;
    for (let y = CHUNK_Y - 1; y >= 0; y--) {
      const b = c.blocks[idx(lx, y, lz)];
      if (b !== B.AIR) return y;
    }
    return 0;
  }

  /** Topmost safe standing surface (ignores foliage / snow / liquids). */
  surfaceAt(x, z) {
    const c = this.chunks.get(ckey(x >> 4, z >> 4));
    if (!c || !c.blocks) return -1;
    const lx = x & 15, lz = z & 15;
    for (let y = CHUNK_Y - 2; y >= 1; y--) {
      const b = c.blocks[idx(lx, y, lz)];
      if (b === B.AIR) continue;
      const d = BLOCKS[b];
      if (!d.solid || d.liquid || d.render === 'cross') continue;
      return y + 1;
    }
    return -1;
  }

  setBlock(x, y, z, id, opts = {}) {
    if (y < 0 || y >= CHUNK_Y) return false;
    const k = ckey(x >> 4, z >> 4);
    const c = this.chunks.get(k);
    const i = idx(x & 15, y, z & 15);

    if (!opts.noSave) {
      let m = this.edits[this.dim].get(k);
      if (!m) { m = new Map(); this.edits[this.dim].set(k, m); }
      m.set(i, id);
    }
    // The chunk may not be resident (an explosion at the render-distance edge,
    // or the End exit portal being built while the player is far from spawn).
    // The delta above is authoritative and gets replayed when it generates.
    if (!c || !c.blocks) return true;

    const old = c.blocks[i];
    if (old === id) return false;
    c.blocks[i] = id;
    // Clean up any block entity that no longer has a block.
    if (old !== id) {
      const be = this.blockEntities[this.dim];
      const bk = pkey(x, y, z);
      if (be.has(bk) && !BLOCKS[id].entity) be.delete(bk);
      const sp = this.spawners[this.dim];
      if (sp.has(bk) && id !== B.SPAWNER) sp.delete(bk);
    }
    this._pendingSets.push(x, y, z, id);
    this.fluids.changed(x,y,z,old,id);
    return true;
  }

  flushSets() {
    if (!this._pendingSets.length) return;
    this.worker.postMessage({ type: 'set', list: this._pendingSets });
    this._pendingSets = [];
  }

  // -------------------------------------------------------------------------
  // Block entities
  // -------------------------------------------------------------------------
  getEntityData(x, y, z, create) {
    const be = this.blockEntities[this.dim];
    const k = pkey(x, y, z);
    let d = be.get(k);
    if (!d && create) { d = create(); be.set(k, d); }
    return d;
  }
  deleteEntityData(x, y, z) { this.blockEntities[this.dim].delete(pkey(x, y, z)); }

  // -------------------------------------------------------------------------
  // Queries used by physics / AI
  // -------------------------------------------------------------------------

  /** Is this block solid enough to stand on / be blocked by? */
  isSolidAt(x, y, z) {
    const b = this.getBlock(x, y, z);
    return IS_SOLID[b] === 1;
  }

  blockHeight(x, y, z) {
    const b = this.getBlock(x, y, z);
    return IS_SOLID[b] ? HEIGHT_OF[b] : 0;
  }

  /** Collect solid AABBs overlapping the given world-space box. */
  collectBoxes(minX, minY, minZ, maxX, maxY, maxZ, out) {
    out.length = 0;
    const x0 = Math.floor(minX), x1 = Math.floor(maxX);
    const y0 = Math.floor(minY), y1 = Math.floor(maxY);
    const z0 = Math.floor(minZ), z1 = Math.floor(maxZ);
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) {
          const b = this.getBlock(x, y, z);
          if (!IS_SOLID[b]) continue;
          for(const box of collisionBoxes(this,x,y,z,b))out.push(...box);
        }
      }
    }
    return out;
  }

  /** Voxel DDA raycast. Returns null or {x,y,z,nx,ny,nz,dist,point}. */
  raycast(ox, oy, oz, dx, dy, dz, maxDist, filter) {
    let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
    const stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
    const tDeltaX = Math.abs(1 / (dx || 1e-9));
    const tDeltaY = Math.abs(1 / (dy || 1e-9));
    const tDeltaZ = Math.abs(1 / (dz || 1e-9));
    let tMaxX = ((dx > 0 ? x + 1 - ox : ox - x)) * tDeltaX;
    let tMaxY = ((dy > 0 ? y + 1 - oy : oy - y)) * tDeltaY;
    let tMaxZ = ((dz > 0 ? z + 1 - oz : oz - z)) * tDeltaZ;
    let nx = 0, ny = 0, nz = 0;
    let t = 0;
    const test = filter || ((b) => b !== 0 && !BLOCKS[b].liquid && BLOCKS[b].render !== 'none');

    for (let i = 0; i < 512 && t <= maxDist; i++) {
      const b = this.getBlock(x, y, z);
      if (test(b, x, y, z)) {
        return {
          x, y, z, nx, ny, nz, dist: t, id: b,
          point: [ox + dx * t, oy + dy * t, oz + dz * t],
        };
      }
      if (tMaxX < tMaxY) {
        if (tMaxX < tMaxZ) { x += stepX; t = tMaxX; tMaxX += tDeltaX; nx = -stepX; ny = 0; nz = 0; }
        else { z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; nx = 0; ny = 0; nz = -stepZ; }
      } else {
        if (tMaxY < tMaxZ) { y += stepY; t = tMaxY; tMaxY += tDeltaY; nx = 0; ny = -stepY; nz = 0; }
        else { z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; nx = 0; ny = 0; nz = -stepZ; }
      }
      if (y < -1 || y > CHUNK_Y + 1) break;
    }
    return null;
  }

  /** Find a safe spawn point near (x, z) once chunks are loaded. */
  findSpawn(x = 0, z = 0) {
    for (let r = 0; r < 48; r++) {
      for (let a = 0; a < Math.max(1, r * 6); a++) {
        const ang = (a / Math.max(1, r * 6)) * Math.PI * 2;
        const sx = Math.round(x + Math.cos(ang) * r);
        const sz = Math.round(z + Math.sin(ang) * r);
        if (!this.isLoaded(sx, sz)) continue;
        const y = this.surfaceAt(sx, sz);
        if (y < SEA_LEVEL + 1 || y > CHUNK_Y - 6) continue;
        const under = this.getBlock(sx, y - 1, sz);
        if (isWater(under) || isLava(under) || under === B.AIR) continue;
        if (this.getBlock(sx, y, sz) !== B.AIR || this.getBlock(sx, y + 1, sz) !== B.AIR) continue;
        return [sx + 0.5, y, sz + 0.5];
      }
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Serialization
  // -------------------------------------------------------------------------
  serialize() {
    const dims = [];
    for (let d = 0; d < 3; d++) {
      const chunkEdits = [];
      for (const [k, m] of this.edits[d]) {
        const arr = new Array(m.size * 2);
        let i = 0;
        for (const [index, id] of m) { arr[i++] = index; arr[i++] = id; }
        chunkEdits.push([k, arr]);
      }
      const be = [];
      for (const [k, v] of this.blockEntities[d]) be.push([k, v]);
      const sp = [];
      for (const [k, v] of this.spawners[d]) sp.push([k, { x: v.x, y: v.y, z: v.z, mob: v.mob }]);
      const po = [];
      for (const [k, v] of this.portals[d]) po.push([k, v]);
      dims.push({ chunkEdits, be, sp, po });
    }
    return dims;
  }

  deserialize(dims) {
    if (!dims) return;
    for (let d = 0; d < 3 && d < dims.length; d++) {
      const src = dims[d];
      this.edits[d] = new Map();
      for (const [k, arr] of src.chunkEdits || []) {
        const m = new Map();
        for (let i = 0; i < arr.length; i += 2) m.set(arr[i], arr[i + 1]);
        this.edits[d].set(k, m);
      }
      this.blockEntities[d] = new Map(src.be || []);
      this.spawners[d] = new Map((src.sp || []).map(([k, v]) => [k, { ...v, cooldown: 0 }]));
      this.portals[d] = new Map(src.po || []);
    }
  }

  dispose() {
    this.worker.terminate();
    for (const c of this.chunks.values()) {
      for (const m of c.meshes) if (m) { this.group.remove(m); m.geometry.dispose(); }
    }
    this.chunks.clear();
    this.scene.remove(this.group);
  }
}

export { blockDef, CHUNK_Y, CHUNK_X, CHUNK_Z, CHUNK_VOL };
