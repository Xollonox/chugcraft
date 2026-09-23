// ============================================================================
// Light engine. Two channels packed into one byte per voxel:
//   high nibble = sky light (multiplied by the sun in the shader)
//   low  nibble = block light (torches, lava, glowstone — always on)
//
// Propagation is the classic voxel flood fill with a proper *removal* pass, so
// breaking a torch or sealing a roof re-darkens exactly the cells it should and
// only those chunks get flagged for a remesh.
// ============================================================================

import { CHUNK_X, CHUNK_Z, CHUNK_Y, MAX_LIGHT } from '../constants.js';
import { IS_OPAQUE, LIGHT_EMIT, LIGHT_FILTER } from './blocks.js';

/** Growable quad-int queue; avoids per-node object allocation. */
class Queue {
  constructor(cap = 1 << 14) {
    this.a = new Int32Array(cap * 4);
    this.head = 0; this.tail = 0; this.cap = cap;
  }
  clear() { this.head = 0; this.tail = 0; }
  get size() { return this.tail - this.head; }
  push(x, y, z, v = 0) {
    if (this.tail === this.cap) {
      if (this.head > this.cap >> 1) {
        this.a.copyWithin(0, this.head * 4, this.tail * 4);
        this.tail -= this.head; this.head = 0;
      } else {
        const cap = this.cap * 2;
        const na = new Int32Array(cap * 4);
        na.set(this.a);
        this.a = na; this.cap = cap;
      }
    }
    const i = this.tail * 4;
    this.a[i] = x; this.a[i + 1] = y; this.a[i + 2] = z; this.a[i + 3] = v;
    this.tail++;
  }
}

const NEIGHBORS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

export class LightEngine {
  /**
   * @param store must implement:
   *   get(x,y,z) -> blockId (0 when unloaded)
   *   isLoaded(x,z) / isLoadedChunk(cx,cz) -> bool
   *   getLight(x,y,z) -> packed byte
   *   setLight(x,y,z, packed)
   *   touch(x,z) — flag the owning chunk for a remesh
   */
  constructor(store) {
    this.s = store;
    this.add = new Queue();
    this.rem = new Queue();
  }

  _set(x, y, z, packed) {
    const s = this.s;
    if (s.getLight(x, y, z) === packed) return;
    s.setLight(x, y, z, packed);
    s.touch(x, z);
  }

  // -------------------------------------------------------------------------
  // Bulk initialisation for a freshly generated chunk
  // -------------------------------------------------------------------------
  initChunk(chunk, cx, cz) {
    const { blocks, light } = chunk;
    const bx = cx * CHUNK_X, bz = cz * CHUNK_Z;
    light.fill(0);
    const q = this.add; q.clear();

    // Pass 1: straight top-down sky column fill.
    const AREA = CHUNK_X * CHUNK_Z;
    for (let lz = 0; lz < CHUNK_Z; lz++) {
      for (let lx = 0; lx < CHUNK_X; lx++) {
        let l = MAX_LIGHT;
        for (let y = CHUNK_Y - 1; y >= 0; y--) {
          const i = lx + lz * CHUNK_X + y * AREA;
          const b = blocks[i];
          if (IS_OPAQUE[b]) l = 0;
          else if (LIGHT_FILTER[b]) l = Math.max(0, l - LIGHT_FILTER[b]);
          light[i] = (l << 4) | LIGHT_EMIT[b];
        }
      }
    }

    // Pass 2: seed the flood fill from the *frontier* only — a lit cell whose
    // horizontal neighbours are already just as bright has nothing to give, and
    // seeding all 32k voxels was by far the biggest cost in chunk loading.
    for (let y = 0; y < CHUNK_Y; y++) {
      const yOff = y * AREA;
      for (let lz = 0; lz < CHUNK_Z; lz++) {
        for (let lx = 0; lx < CHUNK_X; lx++) {
          const i = lx + lz * CHUNK_X + yOff;
          const p = light[i];
          if (p === 0) continue;
          if ((p & 0x0f) > 0) { q.push(bx + lx, y, bz + lz); continue; }   // emitter
          const sl = (p >> 4) & 15;
          const edge = lx === 0 || lx === CHUNK_X - 1 || lz === 0 || lz === CHUNK_Z - 1;
          if (edge) { q.push(bx + lx, y, bz + lz); continue; }
          const need = sl - 1;
          if (((light[i - 1] >> 4) & 15) < need || ((light[i + 1] >> 4) & 15) < need ||
              ((light[i - CHUNK_X] >> 4) & 15) < need || ((light[i + CHUNK_X] >> 4) & 15) < need) {
            q.push(bx + lx, y, bz + lz);
          }
        }
      }
    }

    // Pull light in from loaded neighbours so seams stay consistent.
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ncx = cx + dx, ncz = cz + dz;
      if (!this.s.isLoadedChunk(ncx, ncz)) continue;
      for (let k = 0; k < CHUNK_X; k++) {
        const wx = dx === 1 ? ncx * CHUNK_X : dx === -1 ? ncx * CHUNK_X + CHUNK_X - 1 : ncx * CHUNK_X + k;
        const wz = dz === 1 ? ncz * CHUNK_Z : dz === -1 ? ncz * CHUNK_Z + CHUNK_Z - 1 : ncz * CHUNK_Z + k;
        for (let y = 0; y < CHUNK_Y; y++) {
          if (this.s.getLight(wx, y, wz)) q.push(wx, y, wz);
        }
      }
    }
    this.propagate();
  }

  // -------------------------------------------------------------------------
  // Additive flood fill (both channels at once)
  // -------------------------------------------------------------------------
  propagate() {
    const s = this.s, q = this.add;
    let guard = 0;
    while (q.head < q.tail && guard++ < 8_000_000) {
      const i = q.head++ * 4;
      const x = q.a[i], y = q.a[i + 1], z = q.a[i + 2];
      const p = s.getLight(x, y, z);
      const sl = (p >> 4) & 15, bl = p & 15;
      if (sl === 0 && bl === 0) continue;
      for (let n = 0; n < 6; n++) {
        const d = NEIGHBORS[n];
        const nx = x + d[0], ny = y + d[1], nz = z + d[2];
        if (ny < 0 || ny >= CHUNK_Y) continue;
        if (!s.isLoaded(nx, nz)) continue;
        const nb = s.get(nx, ny, nz);
        if (IS_OPAQUE[nb]) continue;
        const cost = 1 + LIGHT_FILTER[nb];
        const np = s.getLight(nx, ny, nz);
        let nsl = (np >> 4) & 15, nbl = np & 15;
        let changed = false;
        // Sky light falls straight down at full strength.
        const skyOut = (d[1] === -1 && sl === MAX_LIGHT && LIGHT_FILTER[nb] === 0)
          ? MAX_LIGHT : sl - cost;
        if (skyOut > nsl) { nsl = skyOut; changed = true; }
        if (bl - cost > nbl) { nbl = bl - cost; changed = true; }
        if (changed) {
          this._set(nx, ny, nz, (nsl << 4) | nbl);
          q.push(nx, ny, nz);
        }
      }
    }
    q.clear();
  }

  // -------------------------------------------------------------------------
  // Removal pass — `channel` is 'sky' or 'block'
  // -------------------------------------------------------------------------
  removeFlood(sky) {
    const s = this.s, rq = this.rem, aq = this.add;
    let guard = 0;
    while (rq.head < rq.tail && guard++ < 8_000_000) {
      const i = rq.head++ * 4;
      const x = rq.a[i], y = rq.a[i + 1], z = rq.a[i + 2], lvl = rq.a[i + 3];
      for (let n = 0; n < 6; n++) {
        const d = NEIGHBORS[n];
        const nx = x + d[0], ny = y + d[1], nz = z + d[2];
        if (ny < 0 || ny >= CHUNK_Y) continue;
        if (!s.isLoaded(nx, nz)) continue;
        const np = s.getLight(nx, ny, nz);
        const nl = sky ? (np >> 4) & 15 : np & 15;
        if (nl === 0) continue;
        const straightDown = sky && d[1] === -1 && lvl === MAX_LIGHT;
        if (nl < lvl || straightDown) {
          this._set(nx, ny, nz, sky ? (np & 0x0f) : (np & 0xf0));
          rq.push(nx, ny, nz, nl);
        } else {
          // brighter than us — it becomes a re-light source
          aq.push(nx, ny, nz);
        }
      }
    }
    rq.clear();
  }

  // -------------------------------------------------------------------------
  // Incremental update after a single block change
  // -------------------------------------------------------------------------
  updateBlock(x, y, z, oldId, newId) {
    const s = this.s;
    if (!s.isLoaded(x, z)) return;
    const p = s.getLight(x, y, z);
    const oldSky = (p >> 4) & 15, oldBlk = p & 15;

    // ---- block light ----
    this.rem.clear(); this.add.clear();
    if (oldBlk > 0) {
      this._set(x, y, z, p & 0xf0);
      this.rem.push(x, y, z, oldBlk);
      this.removeFlood(false);
    }
    const emit = LIGHT_EMIT[newId];
    if (emit > 0) {
      const cur = s.getLight(x, y, z);
      this._set(x, y, z, (cur & 0xf0) | emit);
      this.add.push(x, y, z);
    }
    // neighbours may need to shine back into the newly-opened cell
    if (!IS_OPAQUE[newId]) {
      for (const d of NEIGHBORS) {
        const nx = x + d[0], ny = y + d[1], nz = z + d[2];
        if (ny < 0 || ny >= CHUNK_Y || !s.isLoaded(nx, nz)) continue;
        if (s.getLight(nx, ny, nz) & 0x0f) this.add.push(nx, ny, nz);
      }
    }
    this.propagate();

    // ---- sky light ----
    this.rem.clear(); this.add.clear();
    const nowOpaque = IS_OPAQUE[newId];
    const wasOpaque = IS_OPAQUE[oldId];
    if (nowOpaque || LIGHT_FILTER[newId] > LIGHT_FILTER[oldId]) {
      if (oldSky > 0) {
        const cur = s.getLight(x, y, z);
        this._set(x, y, z, cur & 0x0f);
        this.rem.push(x, y, z, oldSky);
        this.removeFlood(true);
      }
    }
    if (!nowOpaque) {
      // Re-derive this cell's sky from the block above, then let the flood fill
      // carry it down and sideways.
      let above = MAX_LIGHT;
      if (y + 1 < CHUNK_Y) above = (s.getLight(x, y + 1, z) >> 4) & 15;
      const filt = LIGHT_FILTER[newId];
      const v = above === MAX_LIGHT && filt === 0 ? MAX_LIGHT : Math.max(0, above - 1 - filt);
      const cur = s.getLight(x, y, z);
      if (v > ((cur >> 4) & 15)) this._set(x, y, z, (v << 4) | (cur & 0x0f));
      this.add.push(x, y, z);
      for (const d of NEIGHBORS) {
        const nx = x + d[0], ny = y + d[1], nz = z + d[2];
        if (ny < 0 || ny >= CHUNK_Y || !s.isLoaded(nx, nz)) continue;
        if (s.getLight(nx, ny, nz) & 0xf0) this.add.push(nx, ny, nz);
      }
    }
    void wasOpaque;
    this.propagate();
  }
}
