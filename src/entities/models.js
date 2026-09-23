// ============================================================================
// Blocky entity models. Each model is a declarative list of boxes in classic
// 16-pixels-per-block model space, skinned with runtime-generated pixel art and
// animated by swinging named parts.
//
// Directional face shading is baked into a vertex-colour attribute (the same
// constants the chunk mesher uses), so a mob's boxes catch light exactly like
// the world does instead of reading as flat silhouettes. The per-instance
// material colour then carries the world light level and the red hurt flash.
// ============================================================================

import * as THREE from 'three';
import { bakeFaceShade } from '../engine/shading.js';

const S = 1 / 16;   // model pixel -> world block

// ---------------------------------------------------------------------------
// Skin generation
// ---------------------------------------------------------------------------
const texCache = new Map();

function makeTex(key, size, draw) {
  if (texCache.has(key)) return texCache.get(key);
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  draw(ctx, size);
  const t = new THREE.CanvasTexture(cv);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  texCache.set(key, t);
  return t;
}

/**
 * Skin patterns drawn over a part's base colour. Flat noise alone makes every
 * animal a differently-coloured brick; markings are what make them readable.
 * Keyed by `${model}:${part}`.
 */
const PATTERNS = {
  'cow:body': (ctx) => {
    ctx.fillStyle = '#efeae0';
    for (const [x, y, w, h] of [[1, 2, 5, 5], [9, 1, 5, 4], [3, 10, 4, 4], [10, 9, 5, 6]]) {
      ctx.fillRect(x, y, w, h);
    }
    ctx.fillStyle = '#d8d2c6';
    for (const [x, y] of [[2, 6], [12, 4], [5, 12], [11, 13]]) ctx.fillRect(x, y, 2, 1);
  },
  'cow:head': (ctx) => { ctx.fillStyle = '#efeae0'; ctx.fillRect(3, 2, 10, 4); },
  'sheep:body': (ctx) => {
    // clumped fleece rather than a smooth block of white
    let s = 99;
    const r = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < 46; i++) {
      const x = (r() * 16) | 0, y = (r() * 16) | 0;
      ctx.fillStyle = r() < 0.5 ? '#dcd8cc' : '#ffffff';
      ctx.fillRect(x, y, 2, 2);
    }
  },
  'creeper:body': (ctx) => {
    let s = 7;
    const r = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < 40; i++) {
      const x = (r() * 16) | 0, y = (r() * 16) | 0;
      ctx.fillStyle = r() < 0.5 ? '#3f7a28' : '#7cc450';
      ctx.fillRect(x, y, 2, 3);
    }
  },
  'zombie:body': (ctx) => {
    ctx.fillStyle = '#24406f';
    ctx.fillRect(0, 11, 16, 5);
    ctx.fillStyle = '#4f7d3f';
    ctx.fillRect(4, 12, 3, 4); ctx.fillRect(11, 13, 3, 3);
  },
  'skeleton:body': (ctx) => {
    ctx.fillStyle = '#9c9c90';
    for (const y of [3, 6, 9, 12]) ctx.fillRect(2, y, 12, 1);
    ctx.fillStyle = '#8a8a7e';
    ctx.fillRect(7, 1, 2, 14);
  },
  'spider:abdomen': (ctx) => {
    ctx.fillStyle = '#1a120e';
    for (const [x, y] of [[3, 3], [10, 4], [6, 9], [12, 11]]) ctx.fillRect(x, y, 3, 3);
  },
  'pig:body': (ctx) => {
    ctx.fillStyle = '#d07f92';
    for (const [x, y] of [[2, 4], [9, 3], [5, 11], [12, 10]]) ctx.fillRect(x, y, 3, 2);
  },
};

/** Base colour with per-pixel noise, plus any pattern registered for the part. */
function noisy(key, color, variance = 12, extra) {
  return makeTex(key, 16, (ctx, n) => {
    const [r, g, b] = [(color >> 16) & 255, (color >> 8) & 255, color & 255];
    const img = ctx.createImageData(n, n);
    let seed = 12345;
    const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < n * n; i++) {
      const d = (rnd() - 0.5) * variance * 2;
      img.data[i * 4] = r + d; img.data[i * 4 + 1] = g + d; img.data[i * 4 + 2] = b + d;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    const pat = PATTERNS[key];
    if (pat) pat(ctx, n);
    if (extra) extra(ctx, n);
  });
}

const px = (ctx, color, x, y, w = 1, h = 1) => { ctx.fillStyle = color; ctx.fillRect(x, y, w, h); };

const FACES = {
  zombie: (ctx) => {
    px(ctx, '#1a2a1a', 3, 6, 3, 2); px(ctx, '#1a2a1a', 10, 6, 3, 2);
    px(ctx, '#0a1a0a', 4, 6, 1, 2); px(ctx, '#0a1a0a', 11, 6, 1, 2);
    px(ctx, '#2c4a2c', 5, 11, 6, 1);
  },
  skeleton: (ctx) => {
    px(ctx, '#141414', 3, 6, 3, 3); px(ctx, '#141414', 10, 6, 3, 3);
    px(ctx, '#6a6a6a', 5, 11, 6, 1);
    for (let i = 0; i < 3; i++) px(ctx, '#6a6a6a', 6 + i * 2, 10, 1, 3);
  },
  creeper: (ctx) => {
    px(ctx, '#0a0a0a', 3, 5, 3, 3); px(ctx, '#0a0a0a', 10, 5, 3, 3);
    px(ctx, '#0a0a0a', 6, 8, 4, 3); px(ctx, '#0a0a0a', 5, 10, 2, 3); px(ctx, '#0a0a0a', 9, 10, 2, 3);
  },
  spider: (ctx) => {
    for (const [x, y] of [[3, 5], [6, 5], [9, 5], [12, 5], [4, 8], [10, 8]]) px(ctx, '#c02020', x, y, 2, 2);
  },
  enderman: (ctx) => {
    px(ctx, '#f0a0ff', 2, 7, 5, 2); px(ctx, '#f0a0ff', 9, 7, 5, 2);
    px(ctx, '#ffffff', 3, 7, 2, 2); px(ctx, '#ffffff', 11, 7, 2, 2);
  },
  pigman: (ctx) => {
    px(ctx, '#1a1a1a', 3, 6, 3, 2); px(ctx, '#1a1a1a', 10, 6, 3, 2);
    px(ctx, '#d88a8a', 5, 10, 6, 3);
    px(ctx, '#7a4a4a', 6, 11, 1, 1); px(ctx, '#7a4a4a', 9, 11, 1, 1);
  },
  villager: (ctx) => {
    px(ctx, '#2a2a3a', 3, 6, 2, 2); px(ctx, '#2a2a3a', 11, 6, 2, 2);
    px(ctx, '#8a6a4a', 6, 6, 4, 6);
    px(ctx, '#5a3a24', 5, 13, 6, 1);
  },
  cow: (ctx) => {
    px(ctx, '#1a1a1a', 3, 5, 3, 3); px(ctx, '#1a1a1a', 10, 5, 3, 3);
    px(ctx, '#e0e0e0', 4, 6, 1, 1); px(ctx, '#e0e0e0', 11, 6, 1, 1);
    px(ctx, '#e0a0a0', 5, 10, 6, 4);
  },
  pig: (ctx) => {
    px(ctx, '#1a1a1a', 3, 5, 2, 2); px(ctx, '#1a1a1a', 11, 5, 2, 2);
    px(ctx, '#d87a7a', 5, 9, 6, 5);
    px(ctx, '#8a3a3a', 6, 11, 1, 2); px(ctx, '#8a3a3a', 9, 11, 1, 2);
  },
  sheep: (ctx) => {
    px(ctx, '#1a1a1a', 3, 6, 2, 2); px(ctx, '#1a1a1a', 11, 6, 2, 2);
    px(ctx, '#2a2a2a', 6, 12, 4, 2);
  },
  chicken: (ctx) => {
    px(ctx, '#1a1a1a', 3, 5, 3, 3); px(ctx, '#1a1a1a', 10, 5, 3, 3);
    px(ctx, '#e0a020', 5, 9, 6, 4);
  },
  blaze: (ctx) => {
    px(ctx, '#3a1a00', 3, 5, 3, 3); px(ctx, '#3a1a00', 10, 5, 3, 3);
    px(ctx, '#ffe066', 5, 10, 6, 2);
  },
  ghast: (ctx) => {
    px(ctx, '#3a3a3a', 2, 5, 4, 3); px(ctx, '#3a3a3a', 10, 5, 4, 3);
    px(ctx, '#3a3a3a', 4, 10, 8, 3);
  },
  dragon: (ctx) => {
    px(ctx, '#c02aff', 2, 5, 4, 3); px(ctx, '#c02aff', 10, 5, 4, 3);
    px(ctx, '#ffffff', 3, 6, 2, 1); px(ctx, '#ffffff', 11, 6, 2, 1);
  },
  player: (ctx) => {
    px(ctx, '#2a4a8a', 3, 6, 3, 2); px(ctx, '#2a4a8a', 10, 6, 3, 2);
    px(ctx, '#ffffff', 4, 6, 1, 2); px(ctx, '#ffffff', 11, 6, 2, 2);
    px(ctx, '#7a4a30', 5, 11, 6, 1);
  },
  squid: (ctx) => {
    px(ctx, '#101820', 4, 6, 3, 3); px(ctx, '#101820', 9, 6, 3, 3);
    px(ctx, '#ffffff', 5, 7, 1, 1); px(ctx, '#ffffff', 10, 7, 1, 1);
  },
  fish: (ctx) => {
    px(ctx, '#101010', 3, 6, 2, 2);
    px(ctx, '#ffffff', 3, 6, 1, 1);
    for (let i = 0; i < 4; i++) px(ctx, '#00000022', 6 + i * 2, 4, 1, 8);
  },
  bee: (ctx) => {
    // banded abdomen plus a pair of dark eyes
    for (let i = 0; i < 3; i++) px(ctx, '#3a3020', 2 + i * 5, 0, 3, 16);
    px(ctx, '#101010', 4, 5, 2, 3); px(ctx, '#101010', 10, 5, 2, 3);
    px(ctx, '#ffffff', 4, 5, 1, 1); px(ctx, '#ffffff', 10, 5, 1, 1);
  },
  bat: (ctx) => {
    px(ctx, '#c02020', 4, 5, 2, 2); px(ctx, '#c02020', 10, 5, 2, 2);
    px(ctx, '#e8e8e8', 6, 9, 4, 2);
  },
  slime: (ctx) => {
    px(ctx, '#2c5a22', 4, 5, 2, 2); px(ctx, '#2c5a22', 10, 5, 2, 2);
    px(ctx, '#2c5a22', 6, 10, 4, 1);
  },
  wolf: (ctx) => {
    px(ctx, '#c02020', 4, 5, 2, 2); px(ctx, '#c02020', 10, 5, 2, 2);
    px(ctx, '#2a2a2a', 6, 9, 4, 3);
  },
  iron_golem: (ctx) => {
    // heavy brow, dark deep-set eyes and a long vine-draped nose
    px(ctx, '#8f8b80', 2, 3, 12, 2);
    px(ctx, '#2b2b2b', 3, 5, 3, 2); px(ctx, '#2b2b2b', 10, 5, 3, 2);
    px(ctx, '#b8544a', 4, 6, 1, 1); px(ctx, '#b8544a', 11, 6, 1, 1);
    px(ctx, '#a8a49a', 7, 6, 2, 6);
    px(ctx, '#8f8b80', 5, 12, 6, 1);
  },
  polar_bear: (ctx) => {
    // small dark eyes set wide, with a broad black muzzle underneath
    px(ctx, '#1a1a1a', 3, 5, 2, 2); px(ctx, '#1a1a1a', 11, 5, 2, 2);
    px(ctx, '#d8d2c6', 5, 9, 6, 5);
    px(ctx, '#1a1a1a', 6, 10, 4, 3);
  },
};

// ---------------------------------------------------------------------------
// Model definitions — sizes in model pixels, y measured up from the feet.
// Front of every model faces +Z; the group is rotated by (yaw + PI).
// ---------------------------------------------------------------------------

const humanoid = (skin, colors, opts = {}) => ({
  height: opts.height ?? 1.95,
  width: opts.width ?? 0.6,
  eye: opts.eye ?? 1.62,
  parts: [
    { n: 'head', size: [8, 8, 8], pos: [0, 28, 0], pivot: [0, 24, 0], color: colors.head, face: skin, anim: 'head' },
    { n: 'body', size: [8, 12, 4], pos: [0, 18, 0], color: colors.body },
    { n: 'armR', size: [4, 12, 4], pos: [-6, 18, 0], pivot: [-6, 23, 0], color: colors.arm, anim: opts.armsOut ? 'armOutR' : 'armR' },
    { n: 'armL', size: [4, 12, 4], pos: [6, 18, 0], pivot: [6, 23, 0], color: colors.arm, anim: opts.armsOut ? 'armOutL' : 'armL' },
    { n: 'legR', size: [4, 12, 4], pos: [-2, 6, 0], pivot: [-2, 12, 0], color: colors.leg, anim: 'legR' },
    { n: 'legL', size: [4, 12, 4], pos: [2, 6, 0], pivot: [2, 12, 0], color: colors.leg, anim: 'legL' },
  ],
});

const quadruped = (skin, colors, o) => ({
  height: o.height, width: o.width, eye: o.height * 0.85,
  parts: [
    { n: 'head', size: o.headSize, pos: [0, o.headY, o.bodyLen / 2 + o.headSize[2] / 2 - 1], pivot: [0, o.headY, o.bodyLen / 2], color: colors.head, face: skin, anim: 'head' },
    { n: 'body', size: [o.bodyW, o.bodyH, o.bodyLen], pos: [0, o.bodyY, 0], color: colors.body },
    { n: 'legR', size: [4, o.legH, 4], pos: [-o.bodyW / 2 + 2, o.legH / 2, o.bodyLen / 2 - 3], pivot: [-o.bodyW / 2 + 2, o.legH, o.bodyLen / 2 - 3], color: colors.leg, anim: 'legR' },
    { n: 'legL', size: [4, o.legH, 4], pos: [o.bodyW / 2 - 2, o.legH / 2, o.bodyLen / 2 - 3], pivot: [o.bodyW / 2 - 2, o.legH, o.bodyLen / 2 - 3], color: colors.leg, anim: 'legL' },
    { n: 'legBR', size: [4, o.legH, 4], pos: [-o.bodyW / 2 + 2, o.legH / 2, -o.bodyLen / 2 + 3], pivot: [-o.bodyW / 2 + 2, o.legH, -o.bodyLen / 2 + 3], color: colors.leg, anim: 'legL' },
    { n: 'legBL', size: [4, o.legH, 4], pos: [o.bodyW / 2 - 2, o.legH / 2, -o.bodyLen / 2 + 3], pivot: [o.bodyW / 2 - 2, o.legH, -o.bodyLen / 2 + 3], color: colors.leg, anim: 'legR' },
  ],
});

export const MODELS = {
  // Base colours are deliberately mid-to-light: every face is multiplied by the
  // directional shade (down to 0.5 underneath), so anything already dark reads
  // as flat black in the world.
  player: humanoid('player', { head: 0xd0a684, body: 0x3d82cc, arm: 0xd0a684, leg: 0x4a4a80 }),
  zombie: humanoid('zombie', { head: 0x63975a, body: 0x3a5fae, arm: 0x63975a, leg: 0x3c3c72 }, { armsOut: true }),
  pigman: humanoid('pigman', { head: 0xf0aaaa, body: 0x36936e, arm: 0xf0aaaa, leg: 0x4a6ea6 }, { armsOut: true }),
  villager: humanoid('villager', { head: 0xc0947c, body: 0x8a6448, arm: 0xc0947c, leg: 0x6a564c }, { height: 1.9 }),
  skeleton: {
    height: 1.95, width: 0.6, eye: 1.6,
    parts: [
      { n: 'head', size: [8, 8, 8], pos: [0, 28, 0], pivot: [0, 24, 0], color: 0xdedcd0, face: 'skeleton', anim: 'head' },
      { n: 'body', size: [8, 12, 4], pos: [0, 18, 0], color: 0xcdcbc0 },
      { n: 'armR', size: [2, 12, 2], pos: [-5, 18, 0], pivot: [-5, 23, 0], color: 0xcdcbc0, anim: 'armOutR' },
      { n: 'armL', size: [2, 12, 2], pos: [5, 18, 0], pivot: [5, 23, 0], color: 0xcdcbc0, anim: 'armOutL' },
      { n: 'legR', size: [2, 12, 2], pos: [-2, 6, 0], pivot: [-2, 12, 0], color: 0xcdcbc0, anim: 'legR' },
      { n: 'legL', size: [2, 12, 2], pos: [2, 6, 0], pivot: [2, 12, 0], color: 0xcdcbc0, anim: 'legL' },
    ],
  },
  creeper: {
    height: 1.7, width: 0.6, eye: 1.5,
    parts: [
      { n: 'head', size: [8, 8, 8], pos: [0, 22, 0], pivot: [0, 18, 0], color: 0x69b545, face: 'creeper', anim: 'head' },
      { n: 'body', size: [8, 12, 4], pos: [0, 12, 0], color: 0x5cab3c },
      { n: 'legR', size: [4, 6, 4], pos: [-2, 3, 4], pivot: [-2, 6, 4], color: 0x5cab3c, anim: 'legR' },
      { n: 'legL', size: [4, 6, 4], pos: [2, 3, 4], pivot: [2, 6, 4], color: 0x5cab3c, anim: 'legL' },
      { n: 'legBR', size: [4, 6, 4], pos: [-2, 3, -4], pivot: [-2, 6, -4], color: 0x5cab3c, anim: 'legL' },
      { n: 'legBL', size: [4, 6, 4], pos: [2, 3, -4], pivot: [2, 6, -4], color: 0x5cab3c, anim: 'legR' },
    ],
  },
  spider: {
    height: 0.9, width: 1.4, eye: 0.75,
    parts: [
      { n: 'head', size: [8, 8, 8], pos: [0, 9, 11], pivot: [0, 9, 8], color: 0x51392f, face: 'spider', anim: 'head' },
      { n: 'body', size: [10, 8, 8], pos: [0, 9, 0], color: 0x3f2c24 },
      { n: 'abdomen', size: [12, 10, 12], pos: [0, 9, -10], color: 0x452f26 },
      { n: 'legR', size: [16, 2, 2], pos: [-10, 9, 4], pivot: [-5, 9, 4], color: 0x33231c, anim: 'spiderA' },
      { n: 'legL', size: [16, 2, 2], pos: [10, 9, 4], pivot: [5, 9, 4], color: 0x33231c, anim: 'spiderB' },
      { n: 'legR2', size: [16, 2, 2], pos: [-10, 9, 1], pivot: [-5, 9, 1], color: 0x33231c, anim: 'spiderB' },
      { n: 'legL2', size: [16, 2, 2], pos: [10, 9, 1], pivot: [5, 9, 1], color: 0x33231c, anim: 'spiderA' },
      { n: 'legR3', size: [16, 2, 2], pos: [-10, 9, -2], pivot: [-5, 9, -2], color: 0x33231c, anim: 'spiderA' },
      { n: 'legL3', size: [16, 2, 2], pos: [10, 9, -2], pivot: [5, 9, -2], color: 0x33231c, anim: 'spiderB' },
      { n: 'legR4', size: [16, 2, 2], pos: [-10, 9, -5], pivot: [-5, 9, -5], color: 0x33231c, anim: 'spiderB' },
      { n: 'legL4', size: [16, 2, 2], pos: [10, 9, -5], pivot: [5, 9, -5], color: 0x33231c, anim: 'spiderA' },
    ],
  },
  enderman: {
    height: 2.9, width: 0.6, eye: 2.55,
    parts: [
      { n: 'head', size: [8, 8, 8], pos: [0, 43, 0], pivot: [0, 39, 0], color: 0x1e1e22, face: 'enderman', anim: 'head' },
      { n: 'body', size: [8, 12, 4], pos: [0, 33, 0], color: 0x191919 },
      { n: 'armR', size: [2, 30, 2], pos: [-5, 24, 0], pivot: [-5, 38, 0], color: 0x191919, anim: 'armR' },
      { n: 'armL', size: [2, 30, 2], pos: [5, 24, 0], pivot: [5, 38, 0], color: 0x191919, anim: 'armL' },
      { n: 'legR', size: [2, 30, 2], pos: [-2, 15, 0], pivot: [-2, 27, 0], color: 0x191919, anim: 'legR' },
      { n: 'legL', size: [2, 30, 2], pos: [2, 15, 0], pivot: [2, 27, 0], color: 0x191919, anim: 'legL' },
    ],
  },
  cow: quadruped('cow', { head: 0x7a563d, body: 0x6d4c35, leg: 0x5c402d },
    { height: 1.4, width: 0.9, headSize: [8, 8, 6], headY: 20, bodyW: 12, bodyH: 10, bodyLen: 18, bodyY: 18, legH: 12 }),
  pig: quadruped('pig', { head: 0xf0a8ac, body: 0xe89aa6, leg: 0xd88c98 },
    { height: 0.9, width: 0.9, headSize: [8, 8, 8], headY: 12, bodyW: 10, bodyH: 8, bodyLen: 16, bodyY: 11, legH: 6 }),
  sheep: quadruped('sheep', { head: 0xd8d0c0, body: 0xf6f4ee, leg: 0xcfc7b6 },
    { height: 1.3, width: 0.9, headSize: [6, 6, 8], headY: 18, bodyW: 12, bodyH: 12, bodyLen: 16, bodyY: 17, legH: 12 }),
  chicken: {
    height: 0.7, width: 0.4, eye: 0.6,
    parts: [
      { n: 'head', size: [4, 6, 3], pos: [0, 11, 4], pivot: [0, 9, 4], color: 0xf2f2f2, face: 'chicken', anim: 'head' },
      { n: 'beak', size: [4, 2, 2], pos: [0, 10, 6], color: 0xe0a020 },
      { n: 'body', size: [6, 8, 6], pos: [0, 7, 0], color: 0xf0f0f0, rotX: -Math.PI / 2 },
      { n: 'legR', size: [3, 5, 3], pos: [-2, 2, 0], pivot: [-2, 5, 0], color: 0xe0a020, anim: 'legR' },
      { n: 'legL', size: [3, 5, 3], pos: [2, 2, 0], pivot: [2, 5, 0], color: 0xe0a020, anim: 'legL' },
      { n: 'wingR', size: [1, 4, 6], pos: [-4, 8, 0], pivot: [-4, 10, 0], color: 0xe8e8e8, anim: 'wingR' },
      { n: 'wingL', size: [1, 4, 6], pos: [4, 8, 0], pivot: [4, 10, 0], color: 0xe8e8e8, anim: 'wingL' },
    ],
  },
  blaze: {
    height: 1.8, width: 0.6, eye: 1.5, float: true,
    parts: [
      { n: 'head', size: [8, 8, 8], pos: [0, 22, 0], color: 0xf8c840, face: 'blaze', anim: 'head' },
      { n: 'rodA', size: [2, 8, 2], pos: [-5, 16, 0], pivot: [0, 20, 0], color: 0xffb020, anim: 'spinA' },
      { n: 'rodB', size: [2, 8, 2], pos: [5, 16, 0], pivot: [0, 20, 0], color: 0xffb020, anim: 'spinA' },
      { n: 'rodC', size: [2, 8, 2], pos: [0, 16, -5], pivot: [0, 20, 0], color: 0xff9010, anim: 'spinB' },
      { n: 'rodD', size: [2, 8, 2], pos: [0, 16, 5], pivot: [0, 20, 0], color: 0xff9010, anim: 'spinB' },
      { n: 'rodE', size: [2, 8, 2], pos: [-4, 10, -4], pivot: [0, 14, 0], color: 0xffc040, anim: 'spinB' },
      { n: 'rodF', size: [2, 8, 2], pos: [4, 10, 4], pivot: [0, 14, 0], color: 0xffc040, anim: 'spinA' },
    ],
  },
  ghast: {
    height: 4.0, width: 4.0, eye: 3.0, float: true,
    parts: [
      { n: 'body', size: [32, 32, 32], pos: [0, 48, 0], color: 0xe8e4dc, face: 'ghast' },
      { n: 'tenA', size: [4, 18, 4], pos: [-10, 22, -10], pivot: [-10, 32, -10], color: 0xd8d4cc, anim: 'tentacle' },
      { n: 'tenB', size: [4, 22, 4], pos: [0, 20, -10], pivot: [0, 32, -10], color: 0xd8d4cc, anim: 'tentacle2' },
      { n: 'tenC', size: [4, 16, 4], pos: [10, 24, -10], pivot: [10, 32, -10], color: 0xd8d4cc, anim: 'tentacle' },
      { n: 'tenD', size: [4, 20, 4], pos: [-10, 21, 0], pivot: [-10, 32, 0], color: 0xd8d4cc, anim: 'tentacle2' },
      { n: 'tenE', size: [4, 24, 4], pos: [0, 19, 0], pivot: [0, 32, 0], color: 0xd8d4cc, anim: 'tentacle' },
      { n: 'tenF', size: [4, 17, 4], pos: [10, 23, 0], pivot: [10, 32, 0], color: 0xd8d4cc, anim: 'tentacle2' },
      { n: 'tenG', size: [4, 19, 4], pos: [-10, 22, 10], pivot: [-10, 32, 10], color: 0xd8d4cc, anim: 'tentacle' },
      { n: 'tenH', size: [4, 21, 4], pos: [0, 21, 10], pivot: [0, 32, 10], color: 0xd8d4cc, anim: 'tentacle2' },
      { n: 'tenI', size: [4, 15, 4], pos: [10, 24, 10], pivot: [10, 32, 10], color: 0xd8d4cc, anim: 'tentacle' },
    ],
  },
  magma_cube: {
    height: 1.2, width: 1.2, eye: 0.8,
    parts: [
      { n: 'body', size: [16, 12, 16], pos: [0, 7, 0], color: 0x8c3410 },
      { n: 'core', size: [12, 6, 12], pos: [0, 8, 0], color: 0xff8c1a },
      { n: 'top', size: [14, 4, 14], pos: [0, 15, 0], color: 0x6d2408, anim: 'bounce' },
    ],
  },
  minecart: {
    // A rideable iron cart: shallow hull on four little wheels.
    height: 0.72, width: 0.9, eye: 0.5,
    parts: [
      { n: 'hull', size: [14, 4, 14], pos: [0, 4, 0], color: 0x8f979f },
      { n: 'wallF', size: [14, 6, 1], pos: [0, 9, 6.5], color: 0x9aa2ac },
      { n: 'wallB', size: [14, 6, 1], pos: [0, 9, -6.5], color: 0x7d858d },
      { n: 'wallL', size: [1, 6, 12], pos: [-6.5, 9, 0], color: 0x848c94 },
      { n: 'wallR', size: [1, 6, 12], pos: [6.5, 9, 0], color: 0x9aa2ac },
      { n: 'wheelFL', size: [2, 3, 2], pos: [-4.5, 2.5, 4.5], color: 0x4c525a },
      { n: 'wheelFR', size: [2, 3, 2], pos: [4.5, 2.5, 4.5], color: 0x4c525a },
      { n: 'wheelBL', size: [2, 3, 2], pos: [-4.5, 2.5, -4.5], color: 0x3f444b },
      { n: 'wheelBR', size: [2, 3, 2], pos: [4.5, 2.5, -4.5], color: 0x3f444b },
    ],
  },
  squid: {
    height: 0.9, width: 0.9, eye: 0.7, float: true,
    parts: [
      { n: 'body', size: [12, 12, 12], pos: [0, 12, 0], color: 0x2a4a6e, face: 'squid' },
      { n: 'tenA', size: [2, 12, 2], pos: [-4, 2, -4], pivot: [-4, 7, -4], color: 0x24415f, anim: 'tentacle' },
      { n: 'tenB', size: [2, 12, 2], pos: [4, 2, -4], pivot: [4, 7, -4], color: 0x24415f, anim: 'tentacle2' },
      { n: 'tenC', size: [2, 12, 2], pos: [-4, 2, 4], pivot: [-4, 7, 4], color: 0x24415f, anim: 'tentacle2' },
      { n: 'tenD', size: [2, 12, 2], pos: [4, 2, 4], pivot: [4, 7, 4], color: 0x24415f, anim: 'tentacle' },
    ],
  },
  cod: {
    height: 0.4, width: 0.5, eye: 0.3, float: true,
    parts: [
      { n: 'body', size: [8, 5, 3], pos: [0, 4, 0], color: 0xb0a58c, face: 'fish' },
      { n: 'tail', size: [5, 5, 1], pos: [0, 4, -5], pivot: [0, 4, -3], color: 0x8a8068, anim: 'fin' },
      { n: 'finT', size: [1, 3, 3], pos: [0, 8, 0], color: 0x8a8068 },
    ],
  },
  salmon: {
    height: 0.5, width: 0.6, eye: 0.4, float: true,
    parts: [
      { n: 'body', size: [10, 6, 3], pos: [0, 5, 0], color: 0xc4604a, face: 'fish' },
      { n: 'tail', size: [6, 6, 1], pos: [0, 5, -6], pivot: [0, 5, -4], color: 0x9a4432, anim: 'fin' },
      { n: 'finT', size: [1, 3, 4], pos: [0, 10, 0], color: 0x9a4432 },
    ],
  },
  bee: {
    height: 0.6, width: 0.7, eye: 0.45, float: true,
    parts: [
      { n: 'body', size: [7, 7, 10], pos: [0, 6, 0], color: 0xe8b53a, face: 'bee' },
      { n: 'wingR', size: [7, 1, 6], pos: [-4, 10, -1], pivot: [-1, 10, -1], color: 0xd8e8f0, anim: 'wingFastR', opacity: 0.7 },
      { n: 'wingL', size: [7, 1, 6], pos: [4, 10, -1], pivot: [1, 10, -1], color: 0xd8e8f0, anim: 'wingFastL', opacity: 0.7 },
      { n: 'stinger', size: [1, 1, 3], pos: [0, 6, -6], color: 0x3a3a3a },
    ],
  },
  bat: {
    height: 0.6, width: 0.5, eye: 0.45, float: true,
    parts: [
      { n: 'body', size: [5, 7, 4], pos: [0, 6, 0], color: 0x4a3c30, face: 'bat' },
      { n: 'wingR', size: [8, 6, 1], pos: [-6, 7, 0], pivot: [-2, 7, 0], color: 0x3d3128, anim: 'wingFastR' },
      { n: 'wingL', size: [8, 6, 1], pos: [6, 7, 0], pivot: [2, 7, 0], color: 0x3d3128, anim: 'wingFastL' },
    ],
  },
  slime: {
    height: 1.0, width: 1.0, eye: 0.7,
    parts: [
      { n: 'body', size: [14, 14, 14], pos: [0, 7, 0], color: 0x6fc35a, face: 'slime', opacity: 0.72 },
      { n: 'core', size: [8, 8, 8], pos: [0, 7, 0], color: 0x54a340 },
    ],
  },
  wolf: quadruped('wolf', { head: 0xd8d4cc, body: 0xcac6bd, leg: 0xb8b4ab },
    { height: 0.85, width: 0.6, headSize: [6, 6, 6], headY: 12, bodyW: 6, bodyH: 7, bodyLen: 12, bodyY: 11, legH: 6 }),
  polar_bear: quadruped('polar_bear', { head: 0xfaf7f0, body: 0xf2eee4, leg: 0xe6e1d5 },
    { height: 1.4, width: 1.3, headSize: [7, 7, 7], headY: 20, bodyW: 12, bodyH: 12, bodyLen: 18, bodyY: 17, legH: 11 }),
  iron_golem: {
    // Deliberately oversized: broad shoulders, stubby legs and long arms that
    // hang past the knees, so it reads as a golem and not a tall villager.
    height: 2.7, width: 1.4, eye: 2.4,
    parts: [
      { n: 'head', size: [8, 10, 8], pos: [0, 38, 1], pivot: [0, 33, 0], color: 0xd8d5cc, face: 'iron_golem', anim: 'head' },
      { n: 'body', size: [18, 12, 9], pos: [0, 27, 0], color: 0xcfccc2 },
      { n: 'waist', size: [12, 5, 9], pos: [0, 19, 0], color: 0xbdb9ae },
      { n: 'armR', size: [4, 22, 5], pos: [-11, 25, 0], pivot: [-11, 33, 0], color: 0xcfccc2, anim: 'armR' },
      { n: 'armL', size: [4, 22, 5], pos: [11, 25, 0], pivot: [11, 33, 0], color: 0xcfccc2, anim: 'armL' },
      { n: 'legR', size: [6, 16, 6], pos: [-4, 8, 0], pivot: [-4, 16, 0], color: 0xb3afa4, anim: 'legR' },
      { n: 'legL', size: [6, 16, 6], pos: [4, 8, 0], pivot: [4, 16, 0], color: 0xb3afa4, anim: 'legL' },
    ],
  },

  end_crystal: {
    height: 2.0, width: 1.2, eye: 1.0, float: true,
    parts: [
      { n: 'core', size: [12, 12, 12], pos: [0, 18, 0], color: 0xd8b0ff, anim: 'spinY' },
      { n: 'shell', size: [16, 16, 16], pos: [0, 18, 0], color: 0xa050d8, anim: 'spinY2', opacity: 0.4 },
      { n: 'base', size: [16, 4, 16], pos: [0, 2, 0], color: 0x1a1030 },
    ],
  },
};

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

const boxCache = new Map();
function boxGeo(sx, sy, sz) {
  const k = `${sx},${sy},${sz}`;
  if (!boxCache.has(k)) {
    boxCache.set(k, bakeFaceShade(new THREE.BoxGeometry(sx * S, sy * S, sz * S)));
  }
  return boxCache.get(k);
}

/**
 * A floating name label, as seen above other players. Rendered as a camera
 * facing sprite so it stays readable from any angle, with the dark backing
 * plate Minecraft uses to keep text legible against bright terrain.
 */
export function buildNameTag(text) {
  const pad = 6, fontPx = 26;
  const measure = document.createElement('canvas').getContext('2d');
  measure.font = `${fontPx}px "Lucida Console", monospace`;
  const w = Math.ceil(measure.measureText(text).width) + pad * 2;
  const h = fontPx + pad * 2;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = 'rgba(0,0,0,0.30)';
  ctx.fillRect(0, 0, w, h);
  ctx.font = `${fontPx}px "Lucida Console", monospace`;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#101010';
  ctx.fillText(text, pad + 2, h / 2 + 2);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, pad, h / 2);

  const tex = new THREE.CanvasTexture(cv);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({
    map: tex, transparent: true, depthTest: false, depthWrite: false, fog: false,
  });
  const sprite = new THREE.Sprite(mat);
  const scale = 0.42;
  sprite.scale.set((w / h) * scale, scale, 1);
  sprite.renderOrder = 20;
  return sprite;
}

/** A bare first-person arm, shown when the selected hotbar slot is empty. */
export function buildArm(skinColor = 0xd0a684, sleeveColor = 0x3d82cc) {
  const group = new THREE.Group();
  const materials = [];
  const mk = (w, h, d, color, key, y) => {
    const mat = new THREE.MeshBasicMaterial({
      map: noisy(key, color, 8), fog: false, vertexColors: true,
    });
    materials.push(mat);
    const m = new THREE.Mesh(bakeFaceShade(new THREE.BoxGeometry(w * S, h * S, d * S)), mat);
    m.position.y = y * S;
    group.add(m);
    return m;
  };
  // The hand sits at the group origin and the limb runs away below it, so
  // positioning the group positions the *hand* — the part that has to be on
  // screen. Bare forearm first, shirt sleeve behind it at the shoulder end:
  // the other way round reads as a blue arm with a tan cuff. The sleeve is
  // deliberately long so it always runs off the bottom of the screen rather
  // than stopping short and leaving the arm floating in mid-air.
  mk(4, 9, 4, skinColor, 'arm:hand', -4.5);
  mk(4.3, 13, 4.3, sleeveColor, 'arm:sleeve', -15.5);
  return { group, materials };
}

/**
 * Instantiate a model. Returns { group, parts, materials, def }.
 * Materials are per-instance so light and hurt-flash can be set individually.
 */
export function buildModel(name) {
  const def = MODELS[name] || MODELS.zombie;
  const group = new THREE.Group();
  const parts = {};
  const materials = [];

  for (const p of def.parts) {
    const geo = boxGeo(p.size[0], p.size[1], p.size[2]);
    const baseTex = noisy(`${name}:${p.n}`, p.color, 10);
    let mat;
    if (p.face && FACES[p.face]) {
      const faceTex = makeTex(`${name}:${p.n}:face`, 16, (ctx, n) => {
        const [r, g, b] = [(p.color >> 16) & 255, (p.color >> 8) & 255, p.color & 255];
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(0, 0, n, n);
        FACES[p.face](ctx, n);
      });
      const side = new THREE.MeshBasicMaterial({ map: baseTex, fog: true, vertexColors: true });
      const front = new THREE.MeshBasicMaterial({ map: faceTex, fog: true, vertexColors: true });
      mat = [side, side.clone(), side.clone(), side.clone(), front, side.clone()];
      materials.push(...mat);
    } else {
      mat = new THREE.MeshBasicMaterial({
        map: baseTex, fog: true, vertexColors: true,
        transparent: p.opacity !== undefined,
        opacity: p.opacity ?? 1,
        depthWrite: p.opacity === undefined,
      });
      materials.push(mat);
    }

    // A pivot group lets us rotate limbs around the shoulder/hip.
    const pivot = new THREE.Group();
    const pv = p.pivot || p.pos;
    pivot.position.set(pv[0] * S, pv[1] * S, pv[2] * S);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set((p.pos[0] - pv[0]) * S, (p.pos[1] - pv[1]) * S, (p.pos[2] - pv[2]) * S);
    if (p.rotX) mesh.rotation.x = p.rotX;
    pivot.add(mesh);
    pivot.userData.anim = p.anim || null;
    pivot.userData.rest = { x: pivot.rotation.x, y: pivot.rotation.y, z: pivot.rotation.z };
    group.add(pivot);
    parts[p.n] = pivot;
  }
  return { group, parts, materials, def };
}

// ---------------------------------------------------------------------------
// Worn armour
// ---------------------------------------------------------------------------

/** Plate colours per material. Bright enough to survive the 0.5 bottom shade. */
const ARMOR_COLOR = {
  leather: 0x9a6337, chain: 0x9fa3a8, iron: 0xd5d8dc,
  gold: 0xf2c93c, diamond: 0x6fe3d6, netherite: 0x5b5158,
};

/**
 * Each piece is a list of slightly inflated boxes bolted onto the body parts
 * they cover, in the same 16-px model space as the parts themselves:
 * [partName, [w, h, d], [x, y, z]].
 */
const ARMOR_PIECES = {
  helmet: [['head', [9, 9, 9], [0, 28, 0]]],
  chestplate: [
    ['body', [9.2, 13, 5.2], [0, 18, 0]],
    ['armR', [5.2, 7, 5.2], [-6, 21, 0]],
    ['armL', [5.2, 7, 5.2], [6, 21, 0]],
  ],
  leggings: [
    ['body', [8.8, 5, 4.8], [0, 13.5, 0]],
    ['legR', [4.8, 7, 4.8], [-2, 8.5, 0]],
    ['legL', [4.8, 7, 4.8], [2, 8.5, 0]],
  ],
  boots: [
    ['legR', [5, 4, 5.4], [-2, 2, 0]],
    ['legL', [5, 4, 5.4], [2, 2, 0]],
  ],
};

const ARMOR_SLOT_ORDER = ['helmet', 'chestplate', 'leggings', 'boots'];

/**
 * Show worn armour on a built model. `armor` is the four-slot array from the
 * inventory; passing a different set swaps the plates over. Returns true when
 * something actually changed, so callers can run this every frame for free.
 */
export function applyArmor(model, armor) {
  const list = armor || [];
  const sig = ARMOR_SLOT_ORDER.map((_, i) => (list[i] ? list[i].key : '-')).join(',');
  if (model.armorSig === sig) return false;
  model.armorSig = sig;

  for (const mesh of model.armorMeshes || []) {
    mesh.parent?.remove(mesh);
    mesh.geometry.dispose();
    const i = model.materials.indexOf(mesh.material);
    if (i >= 0) model.materials.splice(i, 1);
    mesh.material.dispose();
  }
  model.armorMeshes = [];

  ARMOR_SLOT_ORDER.forEach((slot, i) => {
    const stack = list[i];
    if (!stack) return;
    const material = String(stack.key).split('_')[0];
    const color = ARMOR_COLOR[material] ?? ARMOR_COLOR.iron;
    for (const [partName, size, centre] of ARMOR_PIECES[slot] || []) {
      const pivot = model.parts[partName];
      const def = model.def.parts.find((p) => p.n === partName);
      if (!pivot || !def) continue;
      const pv = def.pivot || def.pos;
      const mat = new THREE.MeshBasicMaterial({
        map: noisy(`armor:${material}`, color, 7), fog: true, vertexColors: true,
      });
      const mesh = new THREE.Mesh(
        bakeFaceShade(new THREE.BoxGeometry(size[0] * S, size[1] * S, size[2] * S)), mat);
      mesh.position.set((centre[0] - pv[0]) * S, (centre[1] - pv[1]) * S, (centre[2] - pv[2]) * S);
      pivot.add(mesh);
      model.materials.push(mat);
      model.armorMeshes.push(mesh);
    }
  });
  return true;
}

/** Drive limb animation from walk phase, head look and a swing timer. */
export function animateModel(model, t, walk, phase, headYaw, headPitch, extra = 0) {
  const sw = Math.sin(phase) * walk;
  const sw2 = Math.cos(phase) * walk;
  for (const key in model.parts) {
    const p = model.parts[key];
    const a = p.userData.anim;
    if (!a) continue;
    switch (a) {
      case 'head': p.rotation.x = headPitch; p.rotation.y = headYaw; break;
      case 'legR': p.rotation.x = sw; break;
      case 'legL': p.rotation.x = -sw; break;
      case 'armR': p.rotation.x = -sw + extra; p.rotation.z = 0.06; break;
      case 'armL': p.rotation.x = sw; p.rotation.z = -0.06; break;
      case 'armOutR': p.rotation.x = -Math.PI / 2 + sw * 0.25; p.rotation.z = 0.08 + Math.sin(t * 2) * 0.04; break;
      case 'armOutL': p.rotation.x = -Math.PI / 2 - sw * 0.25; p.rotation.z = -0.08 - Math.sin(t * 2) * 0.04; break;
      case 'wingR': p.rotation.z = -Math.abs(Math.sin(t * 12)) * 1.1; break;
      case 'wingL': p.rotation.z = Math.abs(Math.sin(t * 12)) * 1.1; break;
      // insect/bat wings beat far too fast to read individually — that's the point
      case 'wingFastR': p.rotation.z = -0.25 - Math.abs(Math.sin(t * 42)) * 0.9; break;
      case 'wingFastL': p.rotation.z = 0.25 + Math.abs(Math.sin(t * 42)) * 0.9; break;
      case 'fin': p.rotation.y = Math.sin(t * 7) * 0.5; break;
      case 'spiderA': p.rotation.z = 0.5 + sw * 0.5; p.rotation.y = sw2 * 0.4; break;
      case 'spiderB': p.rotation.z = 0.5 - sw * 0.5; p.rotation.y = -sw2 * 0.4; break;
      case 'spinA': p.rotation.y = t * 2.4; break;
      case 'spinB': p.rotation.y = -t * 1.8; break;
      case 'spinY': p.rotation.y = t * 1.2; p.rotation.x = t * 0.6; break;
      case 'spinY2': p.rotation.y = -t * 0.8; p.rotation.x = -t * 0.4; break;
      case 'tentacle': p.rotation.x = Math.sin(t * 1.6) * 0.25; p.rotation.z = Math.cos(t * 1.3) * 0.2; break;
      case 'tentacle2': p.rotation.x = Math.sin(t * 1.6 + 1) * 0.25; p.rotation.z = Math.cos(t * 1.3 + 1) * 0.2; break;
      case 'bounce': p.position.y = Math.abs(Math.sin(t * 3)) * 0.1; break;
      default: break;
    }
  }
}

/** Tint every material of a model (light level and hurt flash). */
export function tintModel(model, r, g, b) {
  for (const m of model.materials) m.color.setRGB(r, g, b);
}

export function disposeModel(model) {
  for (const m of model.materials) m.dispose();
}

// ---------------------------------------------------------------------------
// The Ender Dragon gets a bespoke, much larger model.
// ---------------------------------------------------------------------------
export function buildDragon() {
  const group = new THREE.Group();
  const parts = {};
  const materials = [];
  const skin = noisy('dragon:body', 0x1a1420, 8);
  const headTex = makeTex('dragon:head', 16, (ctx, n) => {
    ctx.fillStyle = '#1a1420'; ctx.fillRect(0, 0, n, n);
    FACES.dragon(ctx, n);
  });

  const mk = (name, sx, sy, sz, x, y, z, tex) => {
    const mat = new THREE.MeshBasicMaterial({ map: tex || skin, fog: true, vertexColors: true });
    materials.push(mat);
    const mesh = new THREE.Mesh(bakeFaceShade(new THREE.BoxGeometry(sx, sy, sz)), mat);
    const pivot = new THREE.Group();
    pivot.position.set(x, y, z);
    pivot.add(mesh);
    group.add(pivot);
    parts[name] = pivot;
    return pivot;
  };

  mk('body', 3.6, 2.4, 6.0, 0, 0, 0);
  mk('neck1', 2.0, 1.6, 2.4, 0, 0.5, 3.6);
  mk('neck2', 1.6, 1.3, 2.4, 0, 1.0, 5.6);
  const head = mk('head', 2.2, 1.8, 3.0, 0, 1.4, 7.8, headTex);
  mk('jaw', 1.8, 0.5, 2.0, 0, 0, 0);
  head.add(parts.jaw);                 // reparent: the jaw hinges off the head
  parts.jaw.position.set(0, -0.9, 0.8);
  mk('tail1', 2.4, 1.6, 3.0, 0, -0.2, -4.2);
  mk('tail2', 1.6, 1.1, 3.0, 0, -0.4, -7.0);
  mk('tail3', 1.0, 0.7, 3.0, 0, -0.6, -9.6);
  mk('wingR', 9.0, 0.4, 3.4, -6.2, 0.8, 0.4);
  mk('wingL', 9.0, 0.4, 3.4, 6.2, 0.8, 0.4);
  mk('wingTipR', 7.0, 0.3, 2.4, -10.0, 0.8, -1.4);
  mk('wingTipL', 7.0, 0.3, 2.4, 10.0, 0.8, -1.4);
  parts.wingR.add(parts.wingTipR);
  parts.wingTipR.position.set(-7.6, 0, -1.6);
  parts.wingL.add(parts.wingTipL);
  parts.wingTipL.position.set(7.6, 0, -1.6);

  return { group, parts, materials, def: { height: 3, width: 6, eye: 2 } };
}
