// ============================================================================
// Extruded item meshes.
//
// A flat quad wearing an item icon reads as a paper cut-out â€” and edge-on it
// disappears into a sliver. Minecraft instead extrudes the sprite: the front
// and back faces carry the texture, and every pixel on the silhouette gets a
// wall joining them. That is what makes a held sword look like an object.
//
// Front and back are single quads (alpha-tested), so only the outline costs
// geometry. Side walls sample the texel they belong to, so one texture and one
// material cover the whole mesh.
// ============================================================================

import * as THREE from 'three';
import { iconPixels } from './itemicons.js';
import { BLOCKS } from '../world/blocks.js';
import { layoutTiles, ATLAS_TILES } from './atlas.js';
import { bakeFaceShade } from './shading.js';

const N = 16;                       // icon resolution
const DEPTH = 1.4;                  // extrusion thickness, in icon pixels
const TILE_UV = 1 / ATLAS_TILES;

const geoCache = new Map();
const texCache = new Map();

/** Nearest-filtered texture straight from the icon's pixel buffer. */
export function itemTexture(key) {
  if (texCache.has(key)) return texCache.get(key);
  const px = iconPixels(key);
  if (!px) return null;
  const t = new THREE.DataTexture(px, N, N, THREE.RGBAFormat);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.flipY = true;
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  texCache.set(key, t);
  return t;
}

/**
 * Geometry for an extruded item, one block wide and centred on the origin.
 * Returns null for items with no hand-drawn icon (block items use a cube).
 */
export function itemGeometry(key) {
  if (geoCache.has(key)) return geoCache.get(key);
  const px = iconPixels(key);
  if (!px) return null;

  const pos = [], uv = [], idx = [];
  const d = DEPTH / 2;
  const solid = (x, y) => (x < 0 || y < 0 || x >= N || y >= N ? 0 : px[(y * N + x) * 4 + 3] > 127);

  const quad = (a, b, c, e, uvs) => {
    const base = pos.length / 3;
    for (const v of [a, b, c, e]) pos.push(v[0], v[1], v[2]);
    for (const t of uvs) uv.push(t[0], t[1]);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };

  // --- front (+Z) and back (-Z): one alpha-tested quad each ---
  quad([0, 0, d], [N, 0, d], [N, N, d], [0, N, d],
    [[0, 0], [1, 0], [1, 1], [0, 1]]);
  quad([N, 0, -d], [0, 0, -d], [0, N, -d], [N, N, -d],
    [[1, 0], [0, 0], [0, 1], [1, 1]]);

  // --- silhouette walls, one per exposed pixel edge ---
  for (let iy = 0; iy < N; iy++) {
    for (let ix = 0; ix < N; ix++) {
      if (!solid(ix, iy)) continue;
      // image row 0 is the top of the sprite, so flip into a y-up mesh
      const y0 = N - 1 - iy, y1 = y0 + 1;
      const x0 = ix, x1 = ix + 1;
      // sample the middle of this pixel for every wall it owns
      const u = (ix + 0.5) / N, v = (N - 1 - iy + 0.5) / N;
      const T = [[u, v], [u, v], [u, v], [u, v]];
      if (!solid(ix + 1, iy)) {
        quad([x1, y0, d], [x1, y0, -d], [x1, y1, -d], [x1, y1, d], T);
      }
      if (!solid(ix - 1, iy)) {
        quad([x0, y0, -d], [x0, y0, d], [x0, y1, d], [x0, y1, -d], T);
      }
      if (!solid(ix, iy - 1)) {          // row above in image space = +Y here
        quad([x0, y1, d], [x1, y1, d], [x1, y1, -d], [x0, y1, -d], T);
      }
      if (!solid(ix, iy + 1)) {
        quad([x0, y0, -d], [x1, y0, -d], [x1, y0, d], [x0, y0, d], T);
      }
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  // centre on the origin and normalise to one block across
  g.translate(-N / 2, -N / 2, 0);
  g.scale(1 / N, 1 / N, 1 / N);
  g.computeVertexNormals();
  bakeFaceShade(g);
  g.computeBoundingSphere();
  geoCache.set(key, g);
  return g;
}

/** Cube geometry with the block's own atlas tiles on each face. */
const cubeCache = new Map();
export function blockCubeGeometry(blockId, size = 1) {
  const ck = blockId + ':' + size;
  if (cubeCache.has(ck)) return cubeCache.get(ck);
  const g = new THREE.BoxGeometry(size, size, size);
  const layout = layoutTiles();
  const def = BLOCKS[blockId];
  const uv = g.attributes.uv;
  // BoxGeometry face order matches our FACE order: +X, -X, +Y, -Y, +Z, -Z
  for (let f = 0; f < 6; f++) {
    const slot = layout.get(def.tex[f]) || layout.get('stone');
    const u0 = slot.col * TILE_UV, v0 = 1 - (slot.row + 1) * TILE_UV;
    const corners = [[0, 1], [1, 1], [0, 0], [1, 0]];
    for (let i = 0; i < 4; i++) {
      const o = (f * 4 + i) * 2;
      uv.array[o] = u0 + corners[i][0] * TILE_UV;
      uv.array[o + 1] = v0 + corners[i][1] * TILE_UV;
    }
  }
  uv.needsUpdate = true;
  bakeFaceShade(g);
  cubeCache.set(ck, g);
  return g;
}

/**
 * A ready-to-place mesh for any item: an extruded sprite, or a textured cube
 * for placeable blocks. `atlas` is the world texture used by block items.
 */
export function buildItemMesh(itemDef, atlas, opts = {}) {
  const scale = opts.scale ?? 1;
  if (itemDef.block !== null && itemDef.block !== undefined &&
      BLOCKS[itemDef.block].render === 'cube') {
    const mat = new THREE.MeshBasicMaterial({ map: atlas, fog: opts.fog !== false, vertexColors: true });
    const m = new THREE.Mesh(blockCubeGeometry(itemDef.block, 1), mat);
    m.scale.setScalar(scale * 0.86);
    m.userData.isBlock = true;
    return m;
  }
  const geo = itemGeometry(itemDef.key);
  const tex = itemTexture(itemDef.key);
  if (!geo || !tex) return null;
  const mat = new THREE.MeshBasicMaterial({
    map: tex, alphaTest: 0.5, side: THREE.FrontSide, fog: opts.fog !== false,
    vertexColors: true,
  });
  const m = new THREE.Mesh(geo, mat);
  m.scale.setScalar(scale);
  return m;
}
