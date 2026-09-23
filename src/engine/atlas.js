// ============================================================================
// Texture atlas. The *layout* is a pure function of the block registry so the
// worker can compute identical tile indices without ever touching a canvas;
// only the main thread actually paints pixels.
//
// Filtering is nearest-neighbour with mipmaps disabled: pixels stay razor sharp
// and no neighbouring tile can ever bleed across a chunk seam.
// ============================================================================

import { allTileNames } from '../world/blocks.js';
import { BLOCKS, BLOCK_COUNT } from '../world/blocks.js';
import { TILE, paintTile, ANIMATED } from './tiles.js';

export const ATLAS_TILES = 32;                    // 32 x 32 grid of tiles
export const ATLAS_SIZE = ATLAS_TILES * TILE;     // 512 x 512 px
export const TILE_UV = 1 / ATLAS_TILES;

let _layout = null;

/**
 * Deterministic slot assignment. Animated tiles claim `frames` consecutive
 * columns in one row (never wrapping) so the shader can step frames by adding
 * a multiple of TILE_UV to u.
 */
export function layoutTiles() {
  if (_layout) return _layout;
  const names = allTileNames().sort();
  const map = new Map();
  let col = 0, row = 0;
  const place = (w) => {
    if (col + w > ATLAS_TILES) { col = 0; row++; }
    const c = col, r = row;
    col += w;
    return [c, r];
  };
  for (const name of names) {
    const frames = ANIMATED[name] ? ANIMATED[name].frames : 1;
    const [c, r] = place(frames);
    map.set(name, { col: c, row: r, index: r * ATLAS_TILES + c, frames });
  }
  if (row >= ATLAS_TILES) console.error('[atlas] out of tile slots', row);
  _layout = map;
  return map;
}

/**
 * Per-block-face lookup tables consumed by the mesher hot loop.
 *  tileIndex = TILE_OF[id * 6 + face]
 *  frameCount = FRAMES_OF[id * 6 + face]
 */
export function buildFaceTables() {
  const layout = layoutTiles();
  const tileOf = new Uint16Array(BLOCK_COUNT * 6);
  const framesOf = new Uint8Array(BLOCK_COUNT * 6);
  for (let id = 0; id < BLOCK_COUNT; id++) {
    const b = BLOCKS[id];
    if (!b) continue;
    for (let f = 0; f < 6; f++) {
      const t = layout.get(b.tex[f]) || layout.get('stone');
      tileOf[id * 6 + f] = t ? t.index : 0;
      framesOf[id * 6 + f] = t ? t.frames : 1;
    }
  }
  return { tileOf, framesOf };
}

/** Paint the atlas to a canvas. Main thread only. */
export function paintAtlas() {
  const layout = layoutTiles();
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_SIZE; canvas.height = ATLAS_SIZE;
  const ctx = canvas.getContext('2d', { willReadFrequently: false });
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, ATLAS_SIZE, ATLAS_SIZE);

  for (const [name, slot] of layout) {
    const { frames } = paintTile(name);
    for (let f = 0; f < slot.frames; f++) {
      const p = frames[Math.min(f, frames.length - 1)];
      const img = new ImageData(new Uint8ClampedArray(p.d), TILE, TILE);
      ctx.putImageData(img, (slot.col + f) * TILE, slot.row * TILE);
    }
  }
  return canvas;
}

/** 10-stage block breaking overlay, packed as one 160x16 strip. */
export function paintCrackStrip() {
  const stages = 10;
  const canvas = document.createElement('canvas');
  canvas.width = TILE * stages; canvas.height = TILE;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Build one growing crack network and reveal it progressively.
  const rnd = (() => { let s = 0x1a2b3c4d; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); })();
  const strokes = [];
  for (let i = 0; i < 26; i++) {
    let x = 8 + (rnd() - 0.5) * 5, y = 8 + (rnd() - 0.5) * 5;
    const ang = rnd() * Math.PI * 2;
    const len = 3 + rnd() * 7;
    const pts = [];
    for (let s = 0; s < len; s++) {
      pts.push([Math.round(x), Math.round(y)]);
      x += Math.cos(ang + (rnd() - 0.5) * 1.1);
      y += Math.sin(ang + (rnd() - 0.5) * 1.1);
      if (x < 0 || x > 15 || y < 0 || y > 15) break;
    }
    strokes.push({ pts, born: i / 26 });
  }

  for (let s = 0; s < stages; s++) {
    const t = (s + 1) / stages;
    const img = ctx.createImageData(TILE, TILE);
    for (const st of strokes) {
      if (st.born > t) continue;
      const reveal = Math.min(1, (t - st.born) * 4);
      const n = Math.max(1, Math.floor(st.pts.length * reveal));
      for (let i = 0; i < n; i++) {
        const [px, py] = st.pts[i];
        if (px < 0 || px > 15 || py < 0 || py > 15) continue;
        const o = (py * TILE + px) * 4;
        img.data[o] = 0; img.data[o + 1] = 0; img.data[o + 2] = 0; img.data[o + 3] = 190;
        // soft halo makes the crack read at a distance
        const o2 = (py * TILE + Math.min(15, px + 1)) * 4;
        if (img.data[o2 + 3] < 90) { img.data[o2 + 3] = 90; }
      }
    }
    ctx.putImageData(img, s * TILE, 0);
  }
  return canvas;
}

/**
 * Average colour of every block's side texture — used to tint break particles
 * and dropped-item sparkles so they match the block they came from.
 */
export function computeBlockColors(atlasCanvas) {
  const layout = layoutTiles();
  const ctx = atlasCanvas.getContext('2d', { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, ATLAS_SIZE, ATLAS_SIZE).data;
  const out = new Float32Array(BLOCK_COUNT * 3);
  for (let id = 0; id < BLOCK_COUNT; id++) {
    const b = BLOCKS[id];
    if (!b) continue;
    const slot = layout.get(b.tex[4]) || layout.get(b.tex[2]);
    if (!slot) continue;
    let r = 0, g = 0, bl = 0, n = 0;
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const px = slot.col * TILE + x, py = slot.row * TILE + y;
        const o = (py * ATLAS_SIZE + px) * 4;
        if (img[o + 3] < 32) continue;
        r += img[o]; g += img[o + 1]; bl += img[o + 2]; n++;
      }
    }
    if (!n) n = 1;
    out[id * 3] = r / n / 255;
    out[id * 3 + 1] = g / n / 255;
    out[id * 3 + 2] = bl / n / 255;
  }
  return out;
}

/** UV rect for a tile index (top-left origin, matching canvas coordinates). */
export function tileUV(index) {
  const col = index % ATLAS_TILES;
  const row = (index / ATLAS_TILES) | 0;
  return { u0: col * TILE_UV, v0: 1 - (row + 1) * TILE_UV };
}
