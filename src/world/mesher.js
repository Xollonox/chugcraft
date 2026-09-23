// ============================================================================
// Chunk mesher. Emits ONE geometry per render pass per chunk (never one mesh
// per block), with:
//   * face culling against occluding neighbours
//   * per-vertex ambient occlusion baked into the vertex colour
//   * smooth (averaged) sky + block light per vertex
//   * biome tinting for grass and foliage
//   * an animation-frame count per vertex so the shader can cycle atlas frames
//
// Runs inside the chunk worker against a padded 18 x (H+2) x 18 voxel view so
// neighbour lookups never need a hash-map probe.
// ============================================================================

import { CHUNK_X, CHUNK_Z, CHUNK_Y, PASS, PASS_COUNT, WAVE } from '../constants.js';
import {
  BLOCKS, BLOCK_COUNT, IS_OCCLUDER, IS_OPAQUE, RENDER_KIND, PASS_OF, HEIGHT_OF, IS_LIQUID,
  IS_DOOR, DOOR_PANEL, FLUID, IS_POWERED_RAIL, IS_RAIL_ON,
} from './blocks.js';
import { shapeBoxes } from './shapes.js';
import { BIOME_GRASS, BIOME_FOLIAGE } from './worldgen.js';
import { railShape } from './rails.js';
import { ATLAS_TILES, layoutTiles } from '../engine/atlas.js';

const PX = CHUNK_X + 2;              // padded width / depth
const PY = CHUNK_Y + 2;
export const PAD_SIZE = PX * PX * PY;
export const pidx = (x, y, z) => (y + 1) * PX * PX + (z + 1) * PX + (x + 1);

const TILE_UV = 1 / ATLAS_TILES;
const INSET = 0.02 / (ATLAS_TILES * 16);   // hairline inset kills edge sampling

// Rail pieces pick their tile from the track shape rather than the per-block
// face table, so they are looked up by name (deterministically, once per
// worker) instead of by id.
const RAIL_TILE_CACHE = new Map();
function railTileIndex(name) {
  let idx = RAIL_TILE_CACHE.get(name);
  if (idx === undefined) {
    idx = layoutTiles().get(name)?.index ?? 0;
    RAIL_TILE_CACHE.set(name, idx);
  }
  return idx;
}

// --- face tables -----------------------------------------------------------
// order: +X, -X, +Y, -Y, +Z, -Z
const FACE_CORNERS = [
  [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]],
  [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]],
  [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]],
  [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],
  [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]],
  [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]],
];
const FACE_NORMAL = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
// uv is derived from block-local coordinates so partial boxes cut the texture
// exactly where the geometry cuts the block.
const FACE_UV_AXES = [
  { u: 2, uf: 1, v: 1, vf: 0 },
  { u: 2, uf: 0, v: 1, vf: 0 },
  { u: 0, uf: 0, v: 2, vf: 1 },
  { u: 0, uf: 0, v: 2, vf: 0 },
  { u: 0, uf: 0, v: 1, vf: 0 },
  { u: 0, uf: 1, v: 1, vf: 0 },
];
const FACE_SHADE = [0.62, 0.62, 1.0, 0.5, 0.82, 0.82];

// AO sample offsets: [face][vertex] -> [side1, side2, corner] offsets
const AO_OFFSETS = (() => {
  const t = [];
  for (let f = 0; f < 6; f++) {
    const a = f >> 1;
    const n = FACE_NORMAL[f];
    const t1 = (a + 1) % 3, t2 = (a + 2) % 3;
    const per = [];
    for (let v = 0; v < 4; v++) {
      const c = FACE_CORNERS[f][v];
      const d1 = c[t1] ? 1 : -1, d2 = c[t2] ? 1 : -1;
      const s1 = [n[0], n[1], n[2]]; s1[t1] += d1;
      const s2 = [n[0], n[1], n[2]]; s2[t2] += d2;
      const co = [n[0], n[1], n[2]]; co[t1] += d1; co[t2] += d2;
      per.push([s1, s2, co]);
    }
    t.push(per);
  }
  return t;
})();

// Corner darkening per number of occluding neighbours. Measured against the
// real game these were far too shallow — a block sitting on a floor barely
// tinted the ground beside it, which is most of why the world read as flat.
const AO_SHADE = [0.32, 0.55, 0.78, 1.0];

// Per-block tint kind: 0 none, 1 grass, 2 foliage
const TINT_KIND = new Uint8Array(BLOCK_COUNT);
for (let i = 0; i < BLOCK_COUNT; i++) {
  const t = BLOCKS[i]?.tint;
  TINT_KIND[i] = t === 'grass' ? 1 : t && t.startsWith('foliage') ? 2 : 0;
}
const SELF_CULL = new Uint8Array(BLOCK_COUNT);
for (let i = 0; i < BLOCK_COUNT; i++) SELF_CULL[i] = BLOCKS[i]?.selfCull ? 1 : 0;

const NO_TINT = [1, 1, 1];

// Which blocks animate in the vertex shader, and how.
const WAVE_OF = new Uint8Array(BLOCK_COUNT);
for (let i = 0; i < BLOCK_COUNT; i++) {
  const b = BLOCKS[i];
  if (!b || b.id !== i) continue;
  if (b.key.endsWith('_leaves')) WAVE_OF[i] = WAVE.LEAF;
  else if (b.render === 'cross' && b.key !== 'ladder' && b.key !== 'iron_bars' &&
           b.key !== 'oak_door' && b.key !== 'fire') WAVE_OF[i] = WAVE.PLANT;
  else if (FLUID[i]===1) WAVE_OF[i] = WAVE.WATER;
}

/** Any opaque occluding id works as the "outside the world floor" sentinel. */
const OUTSIDE_FLOOR = (() => {
  for (let i = 1; i < BLOCK_COUNT; i++) if (IS_OCCLUDER[i] && IS_OPAQUE[i]) return i;
  return 1;
})();

// ---------------------------------------------------------------------------
// Growable interleaved buffers, one set per render pass
// ---------------------------------------------------------------------------

class PassBuf {
  constructor() {
    this.cap = 4096;                     // vertices
    this.pos = new Float32Array(this.cap * 3);
    this.uv = new Float32Array(this.cap * 2);
    // Clamped, not plain Uint8: a tint that lands slightly above 1.0 must
    // saturate to white rather than wrap around to black.
    this.col = new Uint8ClampedArray(this.cap * 3);
    this.lit = new Uint8Array(this.cap * 2);
    this.anim = new Uint8Array(this.cap);
    this.n = 0;
    this.idx = new Uint32Array(this.cap * 2);
    this.ni = 0;
  }
  ensure(extra) {
    if (this.n + extra <= this.cap) return;
    let cap = this.cap;
    while (this.n + extra > cap) cap *= 2;
    const g = (Arr, src, comps) => { const a = new Arr(cap * comps); a.set(src); return a; };
    this.pos = g(Float32Array, this.pos, 3);
    this.uv = g(Float32Array, this.uv, 2);
    this.col = g(Uint8ClampedArray, this.col, 3);
    this.lit = g(Uint8Array, this.lit, 2);
    this.anim = g(Uint8Array, this.anim, 1);
    this.cap = cap;
  }
  ensureIdx(extra) {
    if (this.ni + extra <= this.idx.length) return;
    let len = this.idx.length;
    while (this.ni + extra > len) len *= 2;
    const a = new Uint32Array(len); a.set(this.idx); this.idx = a;
  }
}

// ---------------------------------------------------------------------------

export function meshChunk(pad, padLight, biomes, cx, cz, tileOf, framesOf, opts = {}) {
  const smooth = opts.smoothLighting !== false;
  const passes = [];
  for (let i = 0; i < PASS_COUNT; i++) passes.push(new PassBuf());

  const gx = cx * CHUNK_X, gz = cz * CHUNK_Z;
  const grassTint = new Float32Array(3), foliageTint = new Float32Array(3);

  // scratch
  const vlight = new Float32Array(8);   // sky/blk pairs for 4 verts
  const vao = new Float32Array(4);

  // Below the world counts as solid so the bedrock floor never emits a face;
  // above it counts as open sky.
  const blockAt = (x, y, z) => (y < 0 ? OUTSIDE_FLOOR : y >= CHUNK_Y ? 0 : pad[pidx(x, y, z)]);
  const lightAt = (x, y, z) => {
    if (y < 0) return 0;
    if (y >= CHUNK_Y) return 0xf0;
    return padLight[pidx(x, y, z)];
  };

  /**
   * Push one quad. `corners` are block-local [0..1] coordinates in the face's
   * winding order; `tile` is the atlas slot; `shade` is the baked face shade.
   */
  function quad(passIdx, x, y, z, face, corners, tile, frames, tintR, tintG, tintB, aoArr, litArr, wave = 0) {
    const buf = passes[passIdx];
    buf.ensure(4);
    buf.ensureIdx(6);
    const base = buf.n;
    const col = ((tile % ATLAS_TILES) * TILE_UV) + INSET;
    const row = ((tile / ATLAS_TILES) | 0);
    const v0 = 1 - (row + 1) * TILE_UV + INSET;
    const span = TILE_UV - INSET * 2;
    const ax = FACE_UV_AXES[face];
    const shade = FACE_SHADE[face];

    for (let i = 0; i < 4; i++) {
      const c = corners[i];
      const o3 = (base + i) * 3, o2 = (base + i) * 2;
      buf.pos[o3] = x + c[0]; buf.pos[o3 + 1] = y + c[1]; buf.pos[o3 + 2] = z + c[2];
      let uu = c[ax.u]; if (ax.uf) uu = 1 - uu;
      let vv = c[ax.v]; if (ax.vf) vv = 1 - vv;
      buf.uv[o2] = col + uu * span;
      buf.uv[o2 + 1] = v0 + vv * span;
      const ao = aoArr ? aoArr[i] : 1;
      const s = shade * ao * 255;
      buf.col[o3] = tintR * s; buf.col[o3 + 1] = tintG * s; buf.col[o3 + 2] = tintB * s;
      buf.lit[o2] = litArr ? litArr[i * 2] : 255;
      buf.lit[o2 + 1] = litArr ? litArr[i * 2 + 1] : 0;
      // Leaves sway as a whole block; plants and water only move at the top,
      // so their bases stay welded to the ground.
      const w = wave === WAVE.LEAF ? WAVE.LEAF : (c[1] > 0.5 ? wave : WAVE.NONE);
      buf.anim[base + i] = frames + w * 32;
    }
    buf.n += 4;
    // flip the split diagonal so AO gradients don't produce the classic
    // "anisotropy" artefact across the quad
    const flip = aoArr && (aoArr[0] + aoArr[2] < aoArr[1] + aoArr[3]);
    const I = buf.idx;
    if (flip) {
      I[buf.ni++] = base + 1; I[buf.ni++] = base + 2; I[buf.ni++] = base + 3;
      I[buf.ni++] = base + 1; I[buf.ni++] = base + 3; I[buf.ni++] = base + 0;
    } else {
      I[buf.ni++] = base + 0; I[buf.ni++] = base + 1; I[buf.ni++] = base + 2;
      I[buf.ni++] = base + 0; I[buf.ni++] = base + 2; I[buf.ni++] = base + 3;
    }
  }

  /** Compute AO + smooth light for a full-cube face. */
  function shadeFace(x, y, z, face) {
    const n = FACE_NORMAL[face];
    const bx = x + n[0], by = y + n[1], bz = z + n[2];
    const baseLight = lightAt(bx, by, bz);
    for (let v = 0; v < 4; v++) {
      const [s1, s2, co] = AO_OFFSETS[face][v];
      const b1 = blockAt(x + s1[0], y + s1[1], z + s1[2]);
      const b2 = blockAt(x + s2[0], y + s2[1], z + s2[2]);
      const bc = blockAt(x + co[0], y + co[1], z + co[2]);
      const o1 = IS_OPAQUE[b1] ? 1 : 0, o2 = IS_OPAQUE[b2] ? 1 : 0, oc = IS_OPAQUE[bc] ? 1 : 0;
      vao[v] = smooth ? AO_SHADE[(o1 && o2) ? 0 : 3 - (o1 + o2 + oc)] : 1;

      if (smooth) {
        let sky = (baseLight >> 4) & 15, blk = baseLight & 15, cnt = 1;
        const acc = (bb, ll) => {
          if (IS_OPAQUE[bb]) return;
          sky += (ll >> 4) & 15; blk += ll & 15; cnt++;
        };
        acc(b1, lightAt(x + s1[0], y + s1[1], z + s1[2]));
        acc(b2, lightAt(x + s2[0], y + s2[1], z + s2[2]));
        if (!(o1 && o2)) acc(bc, lightAt(x + co[0], y + co[1], z + co[2]));
        vlight[v * 2] = (sky / cnt) * 17;
        vlight[v * 2 + 1] = (blk / cnt) * 17;
      } else {
        vlight[v * 2] = ((baseLight >> 4) & 15) * 17;
        vlight[v * 2 + 1] = (baseLight & 15) * 17;
      }
    }
  }

  function flatLight(x, y, z) {
    const l = lightAt(x, y, z);
    const s = ((l >> 4) & 15) * 17, b = (l & 15) * 17;
    for (let v = 0; v < 4; v++) { vlight[v * 2] = s; vlight[v * 2 + 1] = b; vao[v] = 1; }
  }

  function boxCorners(face, x0, y0, z0, x1, y1, z1) {
    const src = FACE_CORNERS[face];
    const out = [];
    for (let i = 0; i < 4; i++) {
      const c = src[i];
      out.push([c[0] ? x1 : x0, c[1] ? y1 : y0, c[2] ? z1 : z0]);
    }
    return out;
  }

  // -------------------------------------------------------------------------
  for (let ly = 0; ly < CHUNK_Y; ly++) {
    for (let lz = 0; lz < CHUNK_Z; lz++) {
      for (let lx = 0; lx < CHUNK_X; lx++) {
        const id = pad[pidx(lx, ly, lz)];
        if (id === 0) continue;
        const kind = RENDER_KIND[id];
        if (kind === 0) continue;
        const passIdx = PASS_OF[id];
        const tintKind = TINT_KIND[id];
        let tr = 1, tg = 1, tb = 1;
        if (tintKind) {
          const bi = biomes ? biomes[lx + lz * CHUNK_X] : 0;
          const t = (tintKind === 1 ? BIOME_GRASS[bi] : BIOME_FOLIAGE[bi]) || NO_TINT;
          tr = t[0]; tg = t[1]; tb = t[2];
        }
        const wx = gx + lx, wz = gz + lz;

        const waveKind = WAVE_OF[id];

        if (kind === 1) {
          // ---- full cube ----
          for (let f = 0; f < 6; f++) {
            const n = FACE_NORMAL[f];
            const nb = blockAt(lx + n[0], ly + n[1], lz + n[2]);
            if (IS_OCCLUDER[nb]) continue;
            if (nb === id && SELF_CULL[id]) continue;
            if (IS_LIQUID[nb] && PASS_OF[id] === PASS.OPAQUE) { /* still draw */ }
            shadeFace(lx, ly, lz, f);
            quad(passIdx, wx, ly, wz, f, FACE_CORNERS[f],
              tileOf[id * 6 + f], framesOf[id * 6 + f], tr, tg, tb, vao, vlight, waveKind);
          }
        } else if (kind === 5) {
          // ---- layer / slab-like ----
          const h = HEIGHT_OF[id];
          for (let f = 0; f < 6; f++) {
            const n = FACE_NORMAL[f];
            const nb = blockAt(lx + n[0], ly + n[1], lz + n[2]);
            if (f === 3 && IS_OCCLUDER[nb]) continue;
            if (f === 2 && h >= 1 && IS_OCCLUDER[nb]) continue;
            if (nb === id && SELF_CULL[id] && (f === 2 || f === 3)) continue;
            flatLight(lx + (f === 2 ? 0 : n[0]), ly + (f === 2 ? 1 : f === 3 ? -1 : 0), lz + (f === 2 ? 0 : n[2]));
            quad(passIdx, wx, ly, wz, f, boxCorners(f, 0, 0, 0, 1, h, 1),
              tileOf[id * 6 + f], framesOf[id * 6 + f], tr, tg, tb, vao, vlight);
          }
        } else if (kind === 3) {
          // ---- liquid ----
          const above = blockAt(lx, ly + 1, lz);
          const surface = FLUID[above]===FLUID[id] ? 1 : HEIGHT_OF[id];
          for (let f = 0; f < 6; f++) {
            const n = FACE_NORMAL[f];
            const nb = blockAt(lx + n[0], ly + n[1], lz + n[2]);
            if (FLUID[nb]===FLUID[id]) {
              if(f===2||f===3||HEIGHT_OF[nb]>=surface)continue;
            }
            if (IS_OCCLUDER[nb]) continue;
            flatLight(lx + n[0], ly + n[1], lz + n[2]);
            quad(passIdx, wx, ly, wz, f, boxCorners(f, 0, (f!==2&&f!==3&&FLUID[nb]===FLUID[id])?HEIGHT_OF[nb]:0, 0, 1, surface, 1),
              tileOf[id * 6 + f], framesOf[id * 6 + f], tr, tg, tb, null, vlight, waveKind);
          }
        } else if (kind === 4) {
          // ---- torch: thin box that samples the matching slice of its tile ----
          const a = 0.375, b2 = 0.625, top = 0.8125;
          for (let f = 0; f < 6; f++) {
            if (f === 3) continue;
            flatLight(lx, ly, lz);
            quad(passIdx, wx, ly, wz, f, boxCorners(f, a, 0, a, b2, top, b2),
              tileOf[id * 6 + f], framesOf[id * 6 + f], tr, tg, tb, null, vlight);
          }
        } else if (kind === 6) {
          // ---- door: a thin panel against one edge of the block ----
          // The upper half takes the top face's tile so it can show a window;
          // which half this is comes from whether the block below is a door.
          const T = 3 / 16;
          const thinX = DOOR_PANEL[id] === 1;
          const upper = IS_DOOR[blockAt(lx, ly - 1, lz)] === 1;
          const tile = tileOf[id * 6 + (upper ? 2 : 4)];
          const fr = framesOf[id * 6 + (upper ? 2 : 4)];
          const [x0, x1, z0, z1] = thinX ? [0, T, 0, 1] : [0, 1, 0, T];
          for (let f = 0; f < 6; f++) {
            // Skip the cap the panel shares with the block it hangs against.
            if (f === 2 && IS_DOOR[blockAt(lx, ly + 1, lz)]) continue;
            if (f === 3 && IS_DOOR[blockAt(lx, ly - 1, lz)]) continue;
            flatLight(lx, ly, lz);
            quad(passIdx, wx, ly, wz, f, boxCorners(f, x0, 0, z0, x1, 1, z1),
              tile, fr, tr, tg, tb, null, vlight);
          }
        } else if (kind === 7) {
          const boxes=shapeBoxes(id,(dx,dy,dz)=>blockAt(lx+dx,ly+dy,lz+dz));
          for(const box of boxes)for(let f=0;f<6;f++){
            flatLight(lx,ly+1,lz);
            quad(passIdx,wx,ly,wz,f,boxCorners(f,...box),tileOf[id*6+f],framesOf[id*6+f],tr,tg,tb,null,vlight);
          }
        } else if (kind === 8) {
          // ---- rail: a 1/16 plate; the tile carries the track shape ----
          const powered = IS_POWERED_RAIL[id] === 1;
          const shape = railShape(blockAt, lx, ly, lz, powered);
          let name;
          if (shape.kind === 'straight') {
            const axis = shape.axis === 'z' ? 'ns' : 'ew';
            name = powered ? `powered_rail_${axis}${IS_RAIL_ON[id] ? '_on' : ''}` : `rail_${axis}`;
          } else {
            name = `rail_curve_${shape.corner}`;
          }
          const tile = railTileIndex(name);
          const H = 0.0625;
          flatLight(lx, ly, lz);
          const corners = [[0, H, 1], [1, H, 1], [1, H, 0], [0, H, 0]];
          crossQuad(passIdx, wx, ly, wz, corners, tile, 1, tr, tg, tb, vlight, false);
          crossQuad(passIdx, wx, ly, wz, corners, tile, 1, tr, tg, tb, vlight, true);
        } else if (kind === 2) {
          // ---- cross plant: two diagonal quads, drawn from both sides ----
          flatLight(lx, ly, lz);
          const lo = 0.07, hi = 0.93;
          const tile = tileOf[id * 6 + 4], fr = framesOf[id * 6 + 4];
          const planes = [
            [[lo, 0, lo], [hi, 0, hi], [hi, 1, hi], [lo, 1, lo]],
            [[hi, 0, lo], [lo, 0, hi], [lo, 1, hi], [hi, 1, lo]],
          ];
          for (const pl of planes) {
            crossQuad(passIdx, wx, ly, wz, pl, tile, fr, tr, tg, tb, vlight, false, waveKind);
            crossQuad(passIdx, wx, ly, wz, pl, tile, fr, tr, tg, tb, vlight, true, waveKind);
          }
        }
      }
    }
  }

  /** Cross-plant quads need explicit UVs (their corners aren't axis aligned). */
  function crossQuad(passIdx, x, y, z, corners, tile, frames, tr, tg, tb, litArr, reverse, wave = 0) {
    const buf = passes[passIdx];
    buf.ensure(4); buf.ensureIdx(6);
    const base = buf.n;
    const col = ((tile % ATLAS_TILES) * TILE_UV) + INSET;
    const row = ((tile / ATLAS_TILES) | 0);
    const v0 = 1 - (row + 1) * TILE_UV + INSET;
    const span = TILE_UV - INSET * 2;
    const uvs = [[0, 0], [1, 0], [1, 1], [0, 1]];
    for (let i = 0; i < 4; i++) {
      const c = corners[i];
      const o3 = (base + i) * 3, o2 = (base + i) * 2;
      buf.pos[o3] = x + c[0]; buf.pos[o3 + 1] = y + c[1]; buf.pos[o3 + 2] = z + c[2];
      buf.uv[o2] = col + uvs[i][0] * span;
      buf.uv[o2 + 1] = v0 + uvs[i][1] * span;
      const s = 255;
      buf.col[o3] = tr * s; buf.col[o3 + 1] = tg * s; buf.col[o3 + 2] = tb * s;
      buf.lit[o2] = litArr[i * 2]; buf.lit[o2 + 1] = litArr[i * 2 + 1];
      buf.anim[base + i] = frames + (c[1] > 0.5 ? wave : WAVE.NONE) * 32;
    }
    buf.n += 4;
    const I = buf.idx;
    if (reverse) {
      I[buf.ni++] = base + 2; I[buf.ni++] = base + 1; I[buf.ni++] = base + 0;
      I[buf.ni++] = base + 3; I[buf.ni++] = base + 2; I[buf.ni++] = base + 0;
    } else {
      I[buf.ni++] = base + 0; I[buf.ni++] = base + 1; I[buf.ni++] = base + 2;
      I[buf.ni++] = base + 0; I[buf.ni++] = base + 2; I[buf.ni++] = base + 3;
    }
  }

  void grassTint; void foliageTint;

  // -------------------------------------------------------------------------
  const result = [];
  for (let p = 0; p < PASS_COUNT; p++) {
    const b = passes[p];
    if (b.n === 0) { result.push(null); continue; }
    result.push({
      position: b.pos.slice(0, b.n * 3),
      uv: b.uv.slice(0, b.n * 2),
      color: b.col.slice(0, b.n * 3),
      light: b.lit.slice(0, b.n * 2),
      anim: b.anim.slice(0, b.n),
      index: b.idx.slice(0, b.ni),
      count: b.ni,
    });
  }
  return result;
}
