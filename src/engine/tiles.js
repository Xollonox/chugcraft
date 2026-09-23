// ============================================================================
// The texture bible — every block tile is hand-authored pixel art, generated at
// runtime from seeded painters so the result is byte-identical on every load
// and no copyrighted asset is ever shipped.
//
// Tiles are 16x16 RGBA. Animated tiles return an array of frames which the
// atlas packs into consecutive horizontal slots; the shader then steps through
// them using a per-vertex frame-count attribute.
// ============================================================================

import { mulberry32, hashString } from './noise.js';

export const TILE = 16;

const rgb = (c) => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
const mix = (a, b, t) => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/** Tiny painting surface with a seeded RNG and tileable-noise helper. */
export class P {
  constructor(seed, size = TILE) {
    this.n = size;
    this.d = new Uint8ClampedArray(size * size * 4);
    this.rng = mulberry32(seed >>> 0);
    this.seed = seed >>> 0;
  }
  i(x, y) {
    const n = this.n;
    return (((y % n) + n) % n) * n * 4 + ((((x % n) + n) % n) * 4);
  }
  set(x, y, c, a = 255) {
    const i = this.i(x, y);
    const v = Array.isArray(c) ? c : rgb(c);
    this.d[i] = v[0]; this.d[i + 1] = v[1]; this.d[i + 2] = v[2]; this.d[i + 3] = a;
  }
  get(x, y) {
    const i = this.i(x, y);
    return [this.d[i], this.d[i + 1], this.d[i + 2], this.d[i + 3]];
  }
  blend(x, y, c, t) {
    const cur = this.get(x, y);
    const v = Array.isArray(c) ? c : rgb(c);
    this.set(x, y, mix(cur, v, t), Math.max(cur[3], 255 * Math.min(1, t * 2)));
  }
  /** Multiply brightness — used for shading, edges and AO-ish darkening. */
  mul(x, y, f) {
    const i = this.i(x, y);
    this.d[i] *= f; this.d[i + 1] *= f; this.d[i + 2] *= f;
  }
  fill(c, a = 255) {
    for (let y = 0; y < this.n; y++) for (let x = 0; x < this.n; x++) this.set(x, y, c, a);
  }
  clear() { this.d.fill(0); }
  rect(x0, y0, w, h, c, a = 255) {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) this.set(x, y, c, a);
  }
  frame(x0, y0, w, h, c, a = 255) {
    for (let x = x0; x < x0 + w; x++) { this.set(x, y0, c, a); this.set(x, y0 + h - 1, c, a); }
    for (let y = y0; y < y0 + h; y++) { this.set(x0, y, c, a); this.set(x0 + w - 1, y, c, a); }
  }
  rand() { return this.rng(); }
  ri(n) { return (this.rng() * n) | 0; }
  pick(arr) { return arr[(this.rng() * arr.length) | 0]; }
  /** Seamless value noise in [0,1); `freq` cells wrap across the tile. */
  noise(freq, salt = 0) {
    const g = new Float32Array(freq * freq);
    const rnd = mulberry32((this.seed ^ (salt * 0x9e3779b9)) >>> 0);
    for (let i = 0; i < g.length; i++) g[i] = rnd();
    const n = this.n;
    const at = (xx, yy) => g[(((yy % freq) + freq) % freq) * freq + (((xx % freq) + freq) % freq)];
    return (x, y) => {
      const fx = (x / n) * freq, fy = (y / n) * freq;
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const tx = fx - x0, ty = fy - y0;
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
      const t = a + (b - a) * sx;
      return t + (c + (d - c) * sx - t) * sy;
    };
  }
  /** Per-pixel scatter from a shade list, optionally clumped by noise. */
  scatter(shades, clump = 0, freq = 6, salt = 1) {
    const nf = clump > 0 ? this.noise(freq, salt) : null;
    for (let y = 0; y < this.n; y++) {
      for (let x = 0; x < this.n; x++) {
        let t = this.rand();
        if (nf) t = t * (1 - clump) + nf(x, y) * clump;
        this.set(x, y, shades[Math.min(shades.length - 1, (t * shades.length) | 0)]);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Shared painters
// ---------------------------------------------------------------------------

const STONE_SHADES = [0x6d6d6d, 0x757575, 0x7e7e7e, 0x888888, 0x939393, 0x656565];

function paintStone(p, shades = STONE_SHADES) {
  // Blotchy mineral banding at two scales, then fissures on top. Pure per-pixel
  // scatter looks like TV static once you stand a few blocks back.
  const nf = p.noise(4, 3), nf2 = p.noise(9, 4);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const v = nf(x, y) * 0.55 + nf2(x, y) * 0.30 + p.rand() * 0.15;
      p.set(x, y, shades[Math.min(shades.length - 1, (v * shades.length) | 0)]);
    }
  }
  for (let k = 0; k < 4; k++) {
    let x = p.ri(16), y = p.ri(16);
    const len = 4 + p.ri(5);
    for (let i = 0; i < len; i++) {
      p.mul(x, y, 0.74);
      if (p.rand() < 0.4) p.mul(x + 1, y, 0.88);
      x += p.ri(3) - 1; y += p.ri(3) - 1;
    }
  }
  // a couple of bright flecks to catch the eye
  for (let k = 0; k < 3; k++) p.mul(p.ri(16), p.ri(16), 1.18);
}

/** Voronoi pebbles with dark mortar — the cobblestone/glowstone workhorse. */
function paintCells(p, count, colorFn, mortar, mortarWidth = 0.9) {
  const pts = [];
  for (let i = 0; i < count; i++) pts.push([p.rand() * 16, p.rand() * 16, colorFn(p, i)]);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      let d0 = 1e9, d1 = 1e9, best = 0;
      for (let i = 0; i < pts.length; i++) {
        // wrap distance so the tile stays seamless
        let dx = Math.abs(pts[i][0] - (x + 0.5)); if (dx > 8) dx = 16 - dx;
        let dy = Math.abs(pts[i][1] - (y + 0.5)); if (dy > 8) dy = 16 - dy;
        const d = dx * dx + dy * dy;
        if (d < d0) { d1 = d0; d0 = d; best = i; }
        else if (d < d1) d1 = d;
      }
      const edge = Math.sqrt(d1) - Math.sqrt(d0);
      if (edge < mortarWidth) p.set(x, y, mortar);
      else {
        p.set(x, y, pts[best][2]);
        if (p.rand() < 0.22) p.mul(x, y, 0.9 + p.rand() * 0.2);
      }
    }
  }
}

function paintPlanks(p, base, dark, light, seam) {
  const nf = p.noise(8, 7), nf2 = p.noise(16, 8);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      // long grain along the plank, plus a finer fibre pass across it
      const g = nf(x * 2, y * 0.35) * 0.72 + nf2(x * 3, y * 0.5) * 0.28;
      let c = mix(rgb(dark), rgb(light), g);
      const plank = (y / 4) | 0;
      const drift = [1.0, 0.93, 1.07, 0.96][plank];
      c = [c[0] * drift, c[1] * drift, c[2] * drift];
      p.set(x, y, c);
    }
  }
  // horizontal plank seams
  for (let y = 3; y < 16; y += 4) for (let x = 0; x < 16; x++) p.set(x, y, seam);
  // staggered vertical end-joints
  const joints = [[0, 5], [1, 11], [2, 2], [3, 9]];
  for (const [plank, jx] of joints) {
    for (let y = plank * 4; y < plank * 4 + 3; y++) p.set(jx, y, seam);
  }
  // knots
  for (let k = 0; k < 2; k++) {
    const kx = 2 + p.ri(12), ky = p.ri(4) * 4 + 1;
    p.set(kx, ky, dark); p.set(kx + 1, ky, seam);
  }
  void base;
}

function paintLeaves(p, dark, mid, light, holeChance = 0.16) {
  // Leaves need depth, not just a green blob: clustered clumps, deep shadow in
  // the gaps between them, and a highlight on the top-left of each cluster.
  const nf = p.noise(4, 11), nf2 = p.noise(8, 12), nf3 = p.noise(16, 13);
  const deep = [
    Math.max(0, ((dark >> 16) & 255) - 26) << 16 |
    Math.max(0, ((dark >> 8) & 255) - 30) << 8 |
    Math.max(0, (dark & 255) - 20),
  ][0];
  const field = [];
  for (let y = 0; y < 16; y++) {
    field[y] = [];
    for (let x = 0; x < 16; x++) {
      field[y][x] = nf(x, y) * 0.5 + nf2(x, y) * 0.34 + nf3(x, y) * 0.16;
    }
  }
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const v = field[y][x];
      if (v < holeChance) { p.set(x, y, 0, 0); continue; }
      let c = v < 0.30 ? deep : v < 0.45 ? dark : v < 0.66 ? mid : light;
      // brighten where the clump rises away from its neighbour above-left
      const above = y > 0 ? field[y - 1][x] : v;
      const leftv = x > 0 ? field[y][x - 1] : v;
      if (v - Math.min(above, leftv) > 0.10) c = light;
      else if (Math.max(above, leftv) - v > 0.12) c = deep;
      p.set(x, y, c);
      if (p.rand() < 0.14) p.mul(x, y, 0.88 + p.rand() * 0.26);
    }
  }
}

function paintOre(p, main, dark, hi, clusters = 3) {
  paintStone(p);
  for (let c = 0; c < clusters; c++) {
    const cx = 2 + p.rand() * 12, cy = 2 + p.rand() * 12;
    const r = 1.5 + p.rand() * 1.3;
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        const d = Math.hypot(dx, dy) + (p.rand() - 0.5) * 0.7;
        if (d > r) continue;
        const x = Math.round(cx + dx), y = Math.round(cy + dy);
        // rim shading reads as a rounded nugget sitting in the rock
        p.set(x, y, d > r - 0.85 ? dark : main);
      }
    }
    // specular glint on the upper-left, and a cast shadow on the lower-right
    p.set(Math.round(cx), Math.round(cy - 1), hi);
    p.set(Math.round(cx - 1), Math.round(cy - 1), hi);
    const sx = Math.round(cx + r * 0.7), sy = Math.round(cy + r * 0.7);
    p.mul(sx, sy, 0.66);
    p.mul(sx - 1, sy, 0.78);
  }
}

function paintLog(p, barkDark, barkMid, barkLight) {
  const nf = p.noise(6, 21), nf2 = p.noise(14, 22);
  for (let x = 0; x < 16; x++) {
    const col = nf(x * 3, 0);
    for (let y = 0; y < 16; y++) {
      // strong vertical striation with a fine bark-fleck pass on top
      const v = col * 0.52 + nf(x * 3, y) * 0.28 + nf2(x * 2, y * 3) * 0.20;
      const c = v < 0.32 ? barkDark : v < 0.62 ? barkMid : barkLight;
      p.set(x, y, c);
      if (p.rand() < 0.12) p.mul(x, y, 0.88 + p.rand() * 0.24);
    }
  }
  // deep vertical grooves, each with a lit edge so the bark reads as ridged
  for (let k = 0; k < 4; k++) {
    const x = p.ri(16);
    for (let y = 0; y < 16; y++) {
      if (p.rand() < 0.85) p.mul(x, y, 0.70);
      if (p.rand() < 0.55) p.mul(x + 1, y, 1.14);
    }
  }
}

function paintLogTop(p, ringA, ringB, bark) {
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const dx = x - 7.5, dy = y - 7.5;
      const d = Math.sqrt(dx * dx + dy * dy) + Math.sin(Math.atan2(dy, dx) * 3) * 0.4;
      if (d > 7.2) { p.set(x, y, bark); continue; }
      p.set(x, y, (Math.floor(d * 0.9) % 2 === 0) ? ringA : ringB);
      if (p.rand() < 0.15) p.mul(x, y, 0.92);
    }
  }
  p.set(7, 7, 0x4a3418); p.set(8, 8, 0x4a3418);
}

/** Felted wool: clumped fibres rather than a flat colour field. */
function paintWool(p, mid, light, dark) {
  p.scatter([dark, mid, light], 0.4, 8, 151);
  for (let k = 0; k < 22; k++) {
    const x = p.ri(16), y = p.ri(16);
    p.set(x, y, light); p.set(x + 1, y, mid); p.set(x, y + 1, mid);
  }
  for (let k = 0; k < 18; k++) p.mul(p.ri(16), p.ri(16), 0.9);
}

/** Cross-shaped plant sprite on a transparent background. */
function paintPlant(p, draw) {
  p.clear();
  draw(p);
}

// ---------------------------------------------------------------------------
// Painter table — keyed by tile name used in the block registry.
// ---------------------------------------------------------------------------

export const PAINTERS = {
  // ---- stone family ----
  stone: (p) => paintStone(p),
  granite: (p) => paintStone(p, [0x9b6a5c, 0xa8776a, 0x8d5e51, 0xb08074, 0x946255]),
  andesite: (p) => paintStone(p, [0x88888a, 0x929294, 0x7c7c7e, 0x9c9c9e, 0x848486]),
  diorite: (p) => paintStone(p, [0xcfcfcf, 0xdcdcdc, 0xbfbfbf, 0xe8e8e8, 0xc7c7c7]),
  cobblestone: (p) => paintCells(p, 9, (q) => q.pick([0x7d7d7d, 0x8b8b8b, 0x707070, 0x969696, 0x676767]), 0x4d4d4d),
  mossy_cobblestone: (p) => {
    paintCells(p, 9, (q) => q.pick([0x6f7a63, 0x7d8a6e, 0x64705a, 0x8a9878]), 0x424a3c);
    for (let k = 0; k < 22; k++) p.blend(p.ri(16), p.ri(16), 0x5c7a3a, 0.55);
  },
  stone_bricks: (p) => {
    p.fill(0x7a7a7a);
    const nf = p.noise(6, 31);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      p.set(x, y, mix(rgb(0x6d6d6d), rgb(0x8b8b8b), nf(x, y)));
    }
    for (let x = 0; x < 16; x++) { p.set(x, 7, 0x4f4f4f); p.set(x, 15, 0x4f4f4f); }
    for (let y = 0; y < 8; y++) p.set(7, y, 0x4f4f4f);
    for (let y = 8; y < 16; y++) { p.set(3, y, 0x4f4f4f); p.set(11, y, 0x4f4f4f); }
  },
  cracked_stone_bricks: (p) => {
    PAINTERS.stone_bricks(p);
    for (let k = 0; k < 4; k++) {
      let x = p.ri(16), y = p.ri(16);
      for (let i = 0; i < 5; i++) { p.set(x, y, 0x3a3a3a); x += p.ri(3) - 1; y += p.ri(2); }
    }
  },
  mossy_stone_bricks: (p) => {
    PAINTERS.stone_bricks(p);
    for (let k = 0; k < 34; k++) p.blend(p.ri(16), p.ri(16), 0x51733a, 0.6);
  },
  bricks: (p) => {
    p.fill(0x9a5b48);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      p.set(x, y, p.pick([0x9a5b48, 0xa66551, 0x8e5040, 0xb07060]));
    }
    for (let x = 0; x < 16; x++) { p.set(x, 3, 0xc3c3c3); p.set(x, 7, 0xc3c3c3); p.set(x, 11, 0xc3c3c3); p.set(x, 15, 0xc3c3c3); }
    for (let y = 0; y < 3; y++) { p.set(7, y, 0xc3c3c3); }
    for (let y = 4; y < 7; y++) { p.set(3, y, 0xc3c3c3); p.set(11, y, 0xc3c3c3); }
    for (let y = 8; y < 11; y++) { p.set(7, y, 0xc3c3c3); }
    for (let y = 12; y < 15; y++) { p.set(3, y, 0xc3c3c3); p.set(11, y, 0xc3c3c3); }
  },
  bedrock: (p) => {
    const nf = p.noise(4, 41), nf2 = p.noise(8, 42);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const v = nf(x, y) * 0.65 + nf2(x, y) * 0.35;
      const c = v < 0.3 ? 0x141414 : v < 0.5 ? 0x242424 : v < 0.72 ? 0x353535 : 0x484848;
      p.set(x, y, c);
      if (p.rand() < 0.2) p.mul(x, y, 0.8 + p.rand() * 0.4);
    }
  },

  // ---- soil ----
  grass_top: (p) => {
    // Three noise octaves give the blades clumping at different scales; a flat
    // per-pixel scatter reads as uniform static from any distance.
    const nf = p.noise(4, 51), nf2 = p.noise(8, 52), nf3 = p.noise(16, 53);
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const v = nf(x, y) * 0.46 + nf2(x, y) * 0.32 + nf3(x, y) * 0.22;
        const c = v < 0.26 ? 0x3f6f27
          : v < 0.42 ? 0x4c8130
            : v < 0.58 ? 0x5a9438
              : v < 0.74 ? 0x67a442
                : v < 0.88 ? 0x76b551 : 0x88c765;
        p.set(x, y, c);
        if (p.rand() < 0.10) p.mul(x, y, 0.90 + p.rand() * 0.2);
      }
    }
  },
  grass_side: (p) => {
    PAINTERS.dirt(p);
    // Ragged green overhang: individual blades of varying length rather than a
    // straight band, so the silhouette breaks up against the dirt.
    const nf = p.noise(8, 55);
    for (let x = 0; x < 16; x++) {
      const h = 2 + Math.round(nf(x * 2, 0) * 3.6) + p.ri(2);
      for (let y = 0; y < h; y++) {
        const t = y / Math.max(1, h);
        const v = p.rand() * 0.5 + (1 - t) * 0.5;
        p.set(x, y, v < 0.32 ? 0x4c8130 : v < 0.6 ? 0x5a9438 : v < 0.84 ? 0x67a442 : 0x76b551);
      }
      // damp shadow where the turf meets the soil
      p.mul(x, h, 0.72);
      if (h + 1 < 16) p.mul(x, h + 1, 0.88);
      if (p.rand() < 0.5 && h + 1 < 16) p.set(x, h + 1, 0x46752b);
    }
  },
  dirt: (p) => {
    const nf = p.noise(4, 61), nf2 = p.noise(9, 62);
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const v = nf(x, y) * 0.5 + nf2(x, y) * 0.28 + p.rand() * 0.22;
        const c = v < 0.22 ? 0x5b3e29
          : v < 0.4 ? 0x6b4a32
            : v < 0.58 ? 0x7a563a
              : v < 0.76 ? 0x896244 : 0x9a7150;
        p.set(x, y, c);
      }
    }
    // scattered pebbles and dark organic flecks
    for (let k = 0; k < 8; k++) p.set(p.ri(16), p.ri(16), 0x412d1d);
    for (let k = 0; k < 5; k++) {
      const x = p.ri(16), y = p.ri(16);
      p.set(x, y, 0xa88663); p.set(x + 1, y, 0x8d6c4c);
    }
  },
  path_top: (p) => {
    PAINTERS.dirt(p);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) p.mul(x, y, 1.12);
    p.frame(0, 0, 16, 16, 0x5d4230);
  },
  farmland: (p) => {
    PAINTERS.dirt(p);
    for (let y = 3; y < 16; y += 5) for (let x = 0; x < 16; x++) { p.mul(x, y, 0.72); p.mul(x, y + 1, 0.85); }
  },
  sand: (p) => {
    // Fine grain over a slow dune drift, plus a few darker heavier grains.
    const nf = p.noise(5, 71), nf2 = p.noise(11, 72);
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const v = nf(x, y) * 0.34 + nf2(x, y) * 0.26 + p.rand() * 0.40;
        p.set(x, y, v < 0.16 ? 0xc5bc84
          : v < 0.36 ? 0xd4cb95
            : v < 0.58 ? 0xdfd6a5
              : v < 0.80 ? 0xe9e1b6 : 0xf3ecc9);
      }
    }
    for (let k = 0; k < 7; k++) p.set(p.ri(16), p.ri(16), 0xb3a874);
    for (let k = 0; k < 4; k++) p.set(p.ri(16), p.ri(16), 0xfaf5db);
  },
  red_sand: (p) => {
    PAINTERS.sand(p);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const c = p.get(x, y);
      p.set(x, y, [c[0] * 1.02, c[1] * 0.62, c[2] * 0.36]);
    }
  },
  sandstone: (p) => {
    for (let y = 0; y < 16; y++) {
      const band = 0.9 + ((y % 5) / 5) * 0.18;
      for (let x = 0; x < 16; x++) {
        const base = rgb(p.pick([0xdcd3a2, 0xd4cb99, 0xe4dcae]));
        p.set(x, y, [base[0] * band, base[1] * band, base[2] * band]);
      }
    }
    for (let x = 0; x < 16; x++) { p.mul(x, 0, 0.8); p.mul(x, 10, 0.85); }
  },
  sandstone_top: (p) => { PAINTERS.sand(p); p.frame(0, 0, 16, 16, 0xc2b98a); },
  red_sandstone: (p) => {
    PAINTERS.sandstone(p);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const c = p.get(x, y); p.set(x, y, [c[0] * 1.0, c[1] * 0.6, c[2] * 0.34]);
    }
  },
  red_sandstone_top: (p) => { PAINTERS.red_sand(p); p.frame(0, 0, 16, 16, 0xa05a2c); },
  gravel: (p) => {
    paintCells(p, 14, (q) => q.pick([0x7e7a76, 0x8d8884, 0x6d6966, 0x9a9490, 0x605c59]), 0x4f4b48, 0.6);
  },
  clay: (p) => {
    const nf = p.noise(5, 81);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      p.set(x, y, mix(rgb(0x9aa0ab), rgb(0xb3b9c4), nf(x, y) * 0.7 + p.rand() * 0.3));
    }
  },

  // ---- ores & mineral blocks ----
  coal_ore: (p) => paintOre(p, 0x1b1b1b, 0x0d0d0d, 0x3a3a3a),
  iron_ore: (p) => paintOre(p, 0xd8a878, 0xa87a4e, 0xf0cfa8),
  gold_ore: (p) => paintOre(p, 0xfcdb4a, 0xc79e17, 0xfff2a0),
  diamond_ore: (p) => paintOre(p, 0x5decdb, 0x2aa79a, 0xd7fffa),
  emerald_ore: (p) => paintOre(p, 0x3fd94f, 0x1d8a2b, 0xc4ffcb),
  redstone_ore: (p) => paintOre(p, 0xd21f1f, 0x8c1010, 0xff6a6a, 4),
  lapis_ore: (p) => paintOre(p, 0x2c53c6, 0x17307e, 0x6f92f0),
  quartz_ore: (p) => {
    PAINTERS.netherrack(p);
    for (let c = 0; c < 3; c++) {
      const cx = 2 + p.rand() * 12, cy = 2 + p.rand() * 12, r = 1.5 + p.rand();
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
        const d = Math.hypot(dx, dy) + (p.rand() - 0.5) * 0.6;
        if (d > r) continue;
        p.set(Math.round(cx + dx), Math.round(cy + dy), d > r - 0.8 ? 0xbdb3a8 : 0xece5dc);
      }
    }
  },
  coal_block: (p) => p.scatter([0x0e0e0e, 0x161616, 0x1e1e1e, 0x282828], 0.6, 5, 91),
  iron_block: (p) => {
    p.scatter([0xd8d8d8, 0xe4e4e4, 0xcccccc, 0xf0f0f0], 0.5, 6, 92);
    p.frame(0, 0, 16, 16, 0xb0b0b0); p.frame(2, 2, 12, 12, 0xc4c4c4);
  },
  gold_block: (p) => {
    p.scatter([0xf7d84a, 0xffe66b, 0xe0bd28, 0xfff0a0], 0.5, 6, 93);
    p.frame(0, 0, 16, 16, 0xd0ab1a); p.frame(2, 2, 12, 12, 0xe8c93a);
  },
  diamond_block: (p) => {
    p.scatter([0x4ee0d0, 0x66eee0, 0x33bfb0, 0xa8fff5], 0.5, 6, 94);
    for (const [x, y] of [[3, 3], [11, 3], [3, 11], [11, 11], [7, 7]]) {
      p.set(x, y, 0xffffff); p.set(x + 1, y, 0xd7fffa); p.set(x, y + 1, 0xd7fffa);
    }
  },
  lapis_block: (p) => p.scatter([0x1f3f9e, 0x2c53c6, 0x18327e, 0x4a70dc], 0.6, 5, 95),

  // ---- wood ----
  oak_log: (p) => paintLog(p, 0x4f3b1f, 0x6b5230, 0x7d6038),
  oak_log_top: (p) => paintLogTop(p, 0xb08b52, 0x9a7845, 0x6b5230),
  birch_log: (p) => {
    // Pale bark with the characteristic dark horizontal dashes and lenticels.
    const nf = p.noise(6, 101);
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const v = nf(x * 2, y) * 0.5 + p.rand() * 0.5;
        p.set(x, y, v < 0.28 ? 0xc9c3b2 : v < 0.62 ? 0xdcd6c7 : v < 0.88 ? 0xeae5d8 : 0xf5f1e6);
      }
    }
    for (let k = 0; k < 6; k++) {
      const y = p.ri(16), x = p.ri(13);
      const w = 2 + p.ri(4);
      for (let i = 0; i < w; i++) {
        p.set(x + i, y, 0x2e2a1c);
        if (p.rand() < 0.6) p.set(x + i, y + 1, 0x4c4636);
      }
    }
    for (let k = 0; k < 4; k++) { const x = p.ri(16), y = p.ri(16); p.set(x, y, 0x8f8a78); }
  },
  birch_log_top: (p) => paintLogTop(p, 0xd3c9a8, 0xbfb493, 0xd8d2c4),
  spruce_log: (p) => paintLog(p, 0x2e2013, 0x3f2d1c, 0x503a25),
  spruce_log_top: (p) => paintLogTop(p, 0x6b4f2e, 0x5a4126, 0x3f2d1c),
  oak_planks: (p) => paintPlanks(p, 0, 0x8a6a3c, 0xb08b52, 0x5c4526),
  birch_planks: (p) => paintPlanks(p, 0, 0xc4b184, 0xdccfa8, 0x8f7f5c),
  spruce_planks: (p) => paintPlanks(p, 0, 0x604227, 0x7d5936, 0x3d2a17),
  oak_leaves: (p) => paintLeaves(p, 0x27541c, 0x336d25, 0x448a30),
  birch_leaves: (p) => paintLeaves(p, 0x3d6b28, 0x4d8034, 0x639b45, 0.19),
  spruce_leaves: (p) => paintLeaves(p, 0x1c3d1e, 0x255028, 0x2f6633, 0.14),
  bookshelf: (p) => {
    paintPlanks(p, 0, 0x8a6a3c, 0xb08b52, 0x5c4526);
    for (const row of [1, 9]) {
      let x = 0;
      while (x < 16) {
        const w = 1 + p.ri(2);
        const c = p.pick([0xa03030, 0x3050a0, 0xd0c060, 0x30a050, 0xa060c0, 0xd8d8d8]);
        for (let i = 0; i < w && x + i < 16; i++) for (let y = row; y < row + 6; y++) p.set(x + i, y, c);
        for (let y = row; y < row + 6; y++) p.set(Math.min(15, x + w), y, 0x4a3520);
        x += w + 1;
      }
    }
  },

  // ---- glass / ice / snow / obsidian ----
  glass: (p) => {
    p.clear();
    p.frame(0, 0, 16, 16, 0xd4ecf5, 210);
    p.frame(1, 1, 14, 14, 0xa9cdd9, 90);
    for (let i = 0; i < 7; i++) p.set(3 + i, 4 + i, 0xffffff, 150);
    for (let i = 0; i < 4; i++) p.set(9 + i, 3 + i, 0xffffff, 110);
  },
  ice: (p) => {
    const nf = p.noise(5, 111);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      p.set(x, y, mix(rgb(0x7fb4e8), rgb(0xb9dcf7), nf(x, y)), 190);
    }
    for (let k = 0; k < 4; k++) {
      let x = p.ri(16), y = p.ri(16);
      for (let i = 0; i < 6; i++) { p.set(x, y, 0xdcf0ff, 220); x += p.ri(3) - 1; y += p.ri(3) - 1; }
    }
  },
  snow_block: (p) => p.scatter([0xf2f6fb, 0xffffff, 0xe4ecf5, 0xfafcff], 0.35, 7, 121),
  obsidian: (p) => {
    p.scatter([0x100c1a, 0x181228, 0x0a0812, 0x201838], 0.6, 5, 131);
    for (let k = 0; k < 10; k++) p.set(p.ri(16), p.ri(16), 0x4b3a7a);
    for (let k = 0; k < 4; k++) p.set(p.ri(16), p.ri(16), 0x6b52a8);
  },
  glowing_obsidian: (p) => {
    PAINTERS.obsidian(p);
    for (let k = 0; k < 18; k++) p.set(p.ri(16), p.ri(16), p.pick([0x8a5cff, 0xb08aff, 0x5c2ecc]));
  },
  sponge: (p) => {
    p.scatter([0xc4bc4a, 0xd4cc5a, 0xb0a83a], 0.4, 6, 141);
    for (let k = 0; k < 20; k++) p.set(p.ri(16), p.ri(16), 0x8a8228);
  },
  wool: (p) => paintWool(p, 0xe9ecec, 0xf4f6f6, 0xdadede),

  // ---- functional blocks ----
  crafting_top: (p) => {
    paintPlanks(p, 0, 0x8a6a3c, 0xa8834c, 0x5c4526);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) p.mul(x, y, 0.92);
    p.frame(1, 1, 14, 14, 0x4a3520);
    for (let i = 2; i < 14; i++) { p.set(i, 5, 0x4a3520); p.set(i, 10, 0x4a3520); p.set(5, i, 0x4a3520); p.set(10, i, 0x4a3520); }
    for (const [gx, gy] of [[3, 3], [8, 3], [3, 8], [8, 8], [13, 3], [3, 13], [13, 8], [8, 13], [13, 13]]) {
      if (gx < 15 && gy < 15) p.set(gx, gy, 0x6d5230);
    }
  },
  crafting_side: (p) => {
    paintPlanks(p, 0, 0x8a6a3c, 0xa8834c, 0x5c4526);
    // saw silhouette
    for (let x = 3; x < 13; x++) p.set(x, 6, 0xb0b0b0);
    for (let x = 3; x < 13; x += 2) p.set(x, 7, 0xd0d0d0);
    for (let x = 9; x < 13; x++) { p.set(x, 4, 0x4a3520); p.set(x, 5, 0x4a3520); }
    for (let x = 3; x < 13; x++) p.set(x, 11, 0x6d5230);
  },
  furnace_top: (p) => { paintStone(p); p.frame(0, 0, 16, 16, 0x555555); p.frame(3, 3, 10, 10, 0x646464); },
  furnace_side: (p) => { paintStone(p); p.frame(0, 0, 16, 16, 0x555555); },
  furnace_front: (p) => {
    paintStone(p); p.frame(0, 0, 16, 16, 0x555555);
    p.rect(3, 7, 10, 7, 0x2a2a2a); p.frame(3, 7, 10, 7, 0x4a4a4a);
    p.rect(4, 8, 8, 5, 0x1a1a1a);
    for (let x = 3; x < 13; x++) p.set(x, 5, 0x6e6e6e);
    for (let x = 4; x < 12; x++) p.set(x, 4, 0x5a5a5a);
  },
  furnace_front_lit: (p) => {
    PAINTERS.furnace_front(p);
    for (let y = 8; y < 13; y++) {
      for (let x = 4; x < 12; x++) {
        const t = (13 - y) / 5;
        if (p.rand() < 0.25 + t * 0.6) p.set(x, y, t > 0.7 ? 0xffe066 : t > 0.4 ? 0xff9b25 : 0xd8480f);
      }
    }
  },
  chest_top: (p) => {
    paintPlanks(p, 0, 0x77542c, 0x9a6f3c, 0x4f381d);
    p.frame(0, 0, 16, 16, 0x3f2c15);
    p.rect(6, 0, 4, 3, 0x584018);
  },
  chest_side: (p) => {
    paintPlanks(p, 0, 0x77542c, 0x9a6f3c, 0x4f381d);
    p.frame(0, 0, 16, 16, 0x3f2c15);
    for (let x = 0; x < 16; x++) { p.set(x, 5, 0x3f2c15); p.set(x, 6, 0x2f2010); }
  },
  chest_front: (p) => {
    PAINTERS.chest_side(p);
    p.rect(6, 4, 4, 5, 0x2c1f0e);
    p.rect(7, 5, 2, 3, 0xd8b23c);
    p.set(7, 6, 0x8a6a10); p.set(8, 6, 0x8a6a10);
  },
  torch: (p) => paintPlant(p, (q) => {
    for (let y = 7; y < 16; y++) { q.set(7, y, 0x6b5230); q.set(8, y, 0x8a6a3c); }
    q.set(7, 15, 0x4f3b1f); q.set(8, 15, 0x5c4526);
    q.rect(6, 4, 4, 3, 0xffd35c);
    q.set(7, 3, 0xfff0a8); q.set(8, 3, 0xfff0a8);
    q.set(6, 4, 0xff9b25); q.set(9, 4, 0xff9b25);
    q.set(7, 6, 0xff7a10); q.set(8, 6, 0xff7a10);
  }),
  ladder: (p) => paintPlant(p, (q) => {
    for (let y = 0; y < 16; y++) { q.set(2, y, 0x8a6a3c); q.set(3, y, 0x6b5230); q.set(12, y, 0x8a6a3c); q.set(13, y, 0x6b5230); }
    for (const y of [2, 6, 10, 14]) for (let x = 3; x < 13; x++) { q.set(x, y, 0x9a7845); q.set(x, y + 1, 0x6b5230); }
  }),
  iron_bars: (p) => paintPlant(p, (q) => {
    for (let y = 0; y < 16; y++) { q.set(6, y, 0xb8b8b8); q.set(7, y, 0xe0e0e0); q.set(8, y, 0xb8b8b8); }
    for (let x = 0; x < 16; x++) { q.set(x, 0, 0xc8c8c8); q.set(x, 15, 0xc8c8c8); }
  }),
  tnt_top: (p) => { p.fill(0xc84a3a); p.frame(0, 0, 16, 16, 0x8a2a1a); p.rect(4, 4, 8, 8, 0xe0e0e0); p.rect(6, 6, 4, 4, 0x333333); },
  tnt_bottom: (p) => { paintPlanks(p, 0, 0x8a6a3c, 0xa8834c, 0x5c4526); },
  tnt_side: (p) => {
    p.fill(0xa8382a);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) p.set(x, y, p.pick([0xa8382a, 0xb8422f, 0x963224]));
    p.rect(0, 5, 16, 6, 0xf0f0f0);
    for (let x = 0; x < 16; x++) { p.set(x, 5, 0xc0c0c0); p.set(x, 10, 0xc0c0c0); }
    const txt = [[3, 7], [4, 7], [4, 8], [3, 9], [4, 9], [7, 7], [7, 8], [7, 9], [6, 7], [8, 7], [11, 7], [11, 8], [11, 9], [10, 7], [12, 7]];
    for (const [x, y] of txt) p.set(x, y, 0x222222);
  },
  // The bed is two blocks: a plain blanket at the foot and a pillow at the
  // head. Each axis needs its own pair so the pillow always lies across the
  // bed rather than along it.
  bed_top: (p) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) p.set(x, y, p.pick([0xa8302a, 0xb83a34, 0x982a24]));
    p.rect(1, 13, 14, 2, 0x8f2621);      // turned-down blanket edge
    p.frame(0, 0, 16, 16, 0x7a1f1a);
  },
  bed_head_top: (p) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) p.set(x, y, p.pick([0xa8302a, 0xb83a34, 0x982a24]));
    p.rect(2, 2, 12, 7, 0xf0f0f0);       // pillow
    p.rect(2, 2, 12, 1, 0xffffff);
    p.rect(2, 8, 12, 1, 0xd4d4d4);
    p.frame(0, 0, 16, 16, 0x7a1f1a);
  },
  bed_top_x: (p) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) p.set(x, y, p.pick([0xa8302a, 0xb83a34, 0x982a24]));
    p.rect(13, 1, 2, 14, 0x8f2621);
    p.frame(0, 0, 16, 16, 0x7a1f1a);
  },
  bed_head_top_x: (p) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) p.set(x, y, p.pick([0xa8302a, 0xb83a34, 0x982a24]));
    p.rect(2, 2, 7, 12, 0xf0f0f0);
    p.rect(2, 2, 1, 12, 0xffffff);
    p.rect(8, 2, 1, 12, 0xd4d4d4);
    p.frame(0, 0, 16, 16, 0x7a1f1a);
  },
  bed_side: (p) => {
    // top half: mattress + folded sheet, bottom half: the wooden frame
    for (let y = 0; y < 10; y++) for (let x = 0; x < 16; x++) {
      p.set(x, y, y < 4 ? p.pick([0xf0f0f0, 0xe4e4e4]) : p.pick([0xa8302a, 0xb83a34, 0x982a24]));
    }
    for (let y = 10; y < 16; y++) for (let x = 0; x < 16; x++) {
      p.set(x, y, p.pick([0x8a6a3c, 0x9a7845, 0x6b5230]));
    }
    for (let x = 0; x < 16; x++) { p.mul(x, 10, 0.7); p.mul(x, 9, 0.85); }
  },
  spawner: (p) => paintPlant(p, (q) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      if (x % 4 < 2 && y % 4 < 2) q.set(x, y, q.pick([0x24282c, 0x2e3438, 0x1a1e22]));
      else q.set(x, y, 0, 0);
    }
    q.frame(0, 0, 16, 16, 0x2e3438);
  }),
  oak_door: (p) => {
    paintPlanks(p, 0, 0x8a6a3c, 0xa8834c, 0x5c4526);
    p.frame(0, 0, 16, 16, 0x4a3520);
    p.rect(11, 7, 2, 2, 0xd8b23c);
  },
  // A door is one object split across two tiles. Only the UPPER half carries
  // the window and the handle; the lower half is plain boards. Putting a
  // handle on both made the door look like the top texture tiled twice.
  oak_door_bottom: (p) => {
    paintPlanks(p, 0, 0x8a6a3c, 0xa8834c, 0x5c4526);
    p.frame(0, 0, 16, 16, 0x4a3520);
    // recessed panel, so the blank half still has some relief
    p.frame(3, 2, 10, 12, 0x6f5530);
    p.rect(4, 3, 8, 1, 0x9c7a48);
    p.rect(4, 12, 8, 1, 0x6a5030);
  },
  oak_door_top: (p) => {
    paintPlanks(p, 0, 0x8a6a3c, 0xa8834c, 0x5c4526);
    p.frame(0, 0, 16, 16, 0x4a3520);
    p.rect(3, 3, 10, 6, 0x30240f);
    p.rect(4, 4, 8, 4, 0x9fc9e8);
    p.rect(4, 4, 8, 1, 0xc4e2f5);
    p.rect(7, 4, 2, 4, 0x30240f);
    // The single handle, low on the upper half where the two halves meet.
    // Big enough to actually read at 16px — a 2x2 knob vanished in-world.
    p.rect(11, 9, 4, 6, 0x3a2a12);
    p.rect(12, 10, 2, 4, 0xd8b23c);
    p.rect(12, 10, 2, 1, 0xf0d27a);
    p.rect(12, 13, 2, 1, 0xa5811f);
  },

  // ---- plants ----
  tall_grass: (p) => paintPlant(p, (q) => {
    for (let k = 0; k < 9; k++) {
      const x = 1 + q.ri(14), h = 5 + q.ri(8);
      const c = q.pick([0x4c8130, 0x5a9438, 0x69a544, 0x3f6d28]);
      for (let i = 0; i < h; i++) q.set(x + ((i / 4) | 0) * (q.rand() < 0.5 ? 1 : -1), 15 - i, c);
    }
  }),
  dead_bush: (p) => paintPlant(p, (q) => {
    for (let k = 0; k < 7; k++) {
      const x = 2 + q.ri(12), h = 4 + q.ri(7);
      for (let i = 0; i < h; i++) q.set(x + ((i / 3) | 0) * (k % 2 ? 1 : -1), 15 - i, q.pick([0x6b5230, 0x7d6038, 0x5a4526]));
    }
  }),
  flower_red: (p) => paintPlant(p, (q) => {
    for (let y = 8; y < 16; y++) q.set(8, y, 0x3f6d28);
    q.set(6, 11, 0x4c8130); q.set(10, 12, 0x4c8130); q.set(5, 11, 0x4c8130);
    for (const [x, y] of [[7, 5], [8, 5], [9, 5], [6, 6], [7, 6], [8, 6], [9, 6], [10, 6], [7, 7], [8, 7], [9, 7], [8, 4]])
      q.set(x, y, 0xd83a2a);
    q.set(8, 6, 0x2e2e2e); q.set(7, 4, 0xf05a48);
  }),
  flower_yellow: (p) => paintPlant(p, (q) => {
    for (let y = 8; y < 16; y++) q.set(8, y, 0x3f6d28);
    q.set(6, 12, 0x4c8130); q.set(10, 11, 0x4c8130);
    for (const [x, y] of [[7, 5], [8, 5], [9, 5], [6, 6], [7, 6], [8, 6], [9, 6], [10, 6], [7, 7], [8, 7], [9, 7], [8, 4]])
      q.set(x, y, 0xf5d63c);
    q.set(8, 6, 0xc09a10);
  }),
  wheat: (p) => paintPlant(p, (q) => {
    for (let k = 0; k < 5; k++) {
      const x = 2 + k * 3;
      for (let y = 5; y < 16; y++) q.set(x, y, 0x8a9a3a);
      for (let y = 3; y < 8; y++) { q.set(x - 1, y, 0xd8c060); q.set(x + 1, y, 0xd8c060); q.set(x, y, 0xc0a840); }
    }
  }),
  sugar_cane: (p) => paintPlant(p, (q) => {
    // Two stalks with rounded shading and segment joints, not a flat green bar.
    for (const [cx, tint] of [[5, 0.92], [10, 1.0]]) {
      for (let y = 0; y < 16; y++) {
        q.set(cx - 1, y, [0x5c8a3c, 0x6ea24c, 0x8ec46a][0]);
        q.set(cx, y, 0x8ec46a);
        q.set(cx + 1, y, 0xa8de86);
        for (let d = -1; d <= 1; d++) q.mul(cx + d, y, tint);
      }
      for (const y of [2, 7, 12]) {
        for (let d = -1; d <= 1; d++) { q.set(cx + d, y, 0x4a7530); q.mul(cx + d, y, tint); }
      }
    }
  }),
  cactus_top: (p) => {
    p.scatter([0x5a8a3a, 0x649a42, 0x4e7a32], 0.5, 6, 161);
    p.frame(0, 0, 16, 16, 0x3f6528); p.frame(1, 1, 14, 14, 0x76ad4e);
  },
  cactus_side: (p) => {
    p.scatter([0x4e7a32, 0x5a8a3a, 0x446e2c], 0.5, 6, 162);
    for (let y = 0; y < 16; y++) { p.set(0, y, 0x2f5220); p.set(15, y, 0x2f5220); p.set(1, y, 0x76ad4e); }
    for (let k = 0; k < 8; k++) { const x = 3 + p.ri(11), y = p.ri(16); p.set(x, y, 0xd8dcc0); p.set(x, y + 1, 0xb0b49a); }
  },
  pumpkin_top: (p) => {
    p.scatter([0xc47a18, 0xd88a20, 0xb06c12], 0.5, 6, 171);
    p.rect(6, 6, 4, 4, 0x6b5230); p.frame(6, 6, 4, 4, 0x4f3b1f);
  },
  pumpkin_side: (p) => {
    for (let x = 0; x < 16; x++) {
      const rib = Math.abs(((x + 2) % 5) - 2) / 2;
      for (let y = 0; y < 16; y++) {
        const base = mix(rgb(0xb06c12), rgb(0xe09826), 1 - rib);
        p.set(x, y, base);
        if (p.rand() < 0.2) p.mul(x, y, 0.92 + p.rand() * 0.16);
      }
    }
    for (let x = 0; x < 16; x++) { p.mul(x, 0, 0.8); p.mul(x, 15, 0.85); }
  },
  pumpkin_face: (p) => {
    PAINTERS.pumpkin_side(p);
    for (const [x, y] of [[3, 4], [4, 4], [4, 5], [5, 5], [3, 5], [10, 4], [11, 4], [12, 4], [11, 5], [12, 5], [10, 5]]) p.set(x, y, 0x3a2408);
    for (let x = 4; x < 12; x++) p.set(x, 9, 0x3a2408);
    for (const [x, y] of [[4, 10], [6, 10], [8, 10], [10, 10], [5, 11], [7, 11], [9, 11], [5, 8], [7, 8], [9, 8], [11, 8]]) p.set(x, y, 0x3a2408);
  },
  melon_top: (p) => p.scatter([0x2f7a2a, 0x3a8a34, 0x266b22], 0.5, 6, 181),
  melon_side: (p) => {
    for (let x = 0; x < 16; x++) {
      const stripe = ((x / 3) | 0) % 2;
      for (let y = 0; y < 16; y++) {
        p.set(x, y, stripe ? p.pick([0x266b22, 0x2f7a2a]) : p.pick([0x6aa83a, 0x7ab84a]));
      }
    }
  },

  // ---- nether ----
  netherrack: (p) => {
    const nf = p.noise(5, 191), nf2 = p.noise(9, 192);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const v = nf(x, y) * 0.6 + nf2(x, y) * 0.4;
      const c = v < 0.3 ? 0x561414 : v < 0.55 ? 0x6d1c1c : v < 0.78 ? 0x832525 : 0x9c3232;
      p.set(x, y, c);
      if (p.rand() < 0.2) p.mul(x, y, 0.88 + p.rand() * 0.26);
    }
  },
  soul_sand: (p) => {
    p.scatter([0x4a3527, 0x554034, 0x3e2c20, 0x604a3c], 0.6, 5, 201);
    for (const [cx, cy] of [[4, 5], [11, 6], [7, 12]]) {
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const d = Math.hypot(dx, dy);
        if (d < 2.4) p.mul(cx + dx, cy + dy, d < 1.3 ? 0.5 : 0.72);
      }
      p.set(cx - 1, cy - 1, 0x241a12); p.set(cx + 1, cy - 1, 0x241a12); p.set(cx, cy + 1, 0x241a12);
    }
  },
  glowstone: (p) => {
    paintCells(p, 11, (q) => q.pick([0xf7d878, 0xffe89a, 0xe0b850, 0xfff3c0]), 0xa8792a, 0.7);
    for (let k = 0; k < 12; k++) p.set(p.ri(16), p.ri(16), 0xfffbe0);
  },
  nether_bricks: (p) => {
    p.fill(0x2c1418);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) p.set(x, y, p.pick([0x2c1418, 0x36191e, 0x241014, 0x3f1f24]));
    for (let x = 0; x < 16; x++) { p.set(x, 3, 0x1a0c0e); p.set(x, 7, 0x1a0c0e); p.set(x, 11, 0x1a0c0e); p.set(x, 15, 0x1a0c0e); }
    for (let y = 0; y < 3; y++) p.set(7, y, 0x1a0c0e);
    for (let y = 4; y < 7; y++) { p.set(3, y, 0x1a0c0e); p.set(11, y, 0x1a0c0e); }
    for (let y = 8; y < 11; y++) p.set(7, y, 0x1a0c0e);
    for (let y = 12; y < 15; y++) { p.set(3, y, 0x1a0c0e); p.set(11, y, 0x1a0c0e); }
  },
  magma_block: (p) => {
    paintCells(p, 8, (q) => q.pick([0x8c3410, 0x6d2408, 0xa8481a]), 0xff8c1a, 1.1);
    for (let k = 0; k < 10; k++) p.set(p.ri(16), p.ri(16), 0xffb84a);
  },

  // ---- the end ----
  end_stone: (p) => {
    const nf = p.noise(6, 211);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const v = nf(x, y) * 0.5 + p.rand() * 0.5;
      p.set(x, y, v < 0.25 ? 0xc4c493 : v < 0.6 ? 0xdadaa8 : v < 0.88 ? 0xe6e6bb : 0xf2f2d0);
    }
    for (let k = 0; k < 6; k++) p.set(p.ri(16), p.ri(16), 0xa8a878);
  },
  end_frame_side: (p) => {
    p.scatter([0x4e6a58, 0x587662, 0x445e4e], 0.5, 6, 221);
    p.rect(0, 0, 16, 4, 0xd6d6a8);
    for (let x = 0; x < 16; x++) p.mul(x, 4, 0.7);
  },
  end_frame_top: (p) => {
    p.scatter([0x586a70, 0x62767c, 0x4e5e64], 0.5, 6, 222);
    p.frame(2, 2, 12, 12, 0x3e4a50);
    p.rect(3, 3, 10, 10, 0x2e3840);
  },
  end_frame_eye: (p) => {
    PAINTERS.end_frame_top(p);
    for (let y = 3; y < 13; y++) for (let x = 3; x < 13; x++) {
      const d = Math.hypot(x - 7.5, y - 7.5);
      if (d < 4.6) p.set(x, y, d < 2.0 ? 0x0c1a12 : d < 3.4 ? 0x2fbf6a : 0x1f8a4a);
    }
    p.set(6, 6, 0xa8ffd0); p.set(9, 9, 0x145c34);
  },
  dragon_egg: (p) => {
    p.clear();
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const dx = (x - 7.5) / 6.2, dy = (y - 8.5) / 7.4;
      if (dx * dx + dy * dy > 1) continue;
      const v = p.rand();
      p.set(x, y, v < 0.08 ? 0x6a3fa8 : v < 0.2 ? 0x2a1840 : v < 0.7 ? 0x0e0818 : 0x1a1030);
    }
    p.set(5, 4, 0x9a6ad8); p.set(6, 3, 0xb08aff);
  },

  // ---- coloured wool ----
  wool_red: (p) => paintWool(p, 0xa02b2b, 0xbe3a3a, 0x7f2020),
  wool_orange: (p) => paintWool(p, 0xd2761f, 0xe98d31, 0xa85a13),
  wool_yellow: (p) => paintWool(p, 0xd9c22c, 0xefdb46, 0xae9a1c),
  wool_green: (p) => paintWool(p, 0x4a8b2a, 0x5da838, 0x36681c),
  wool_blue: (p) => paintWool(p, 0x2f45a8, 0x3f58c6, 0x21327e),
  wool_purple: (p) => paintWool(p, 0x7b2fa8, 0x9440c6, 0x5c1f80),
  wool_black: (p) => paintWool(p, 0x1c1c20, 0x2a2a30, 0x101014),

  // ---- decorative stone ----
  smooth_stone: (p) => {
    const nf = p.noise(5, 301);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      p.set(x, y, mix(rgb(0x9a9a9a), rgb(0xaeaeae), nf(x, y) * 0.7 + p.rand() * 0.3));
    }
    for (let x = 0; x < 16; x++) { p.mul(x, 0, 1.08); p.mul(x, 15, 0.9); }
  },
  polished_granite: (p) => {
    const nf = p.noise(4, 302);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      p.set(x, y, mix(rgb(0x9a6a5c), rgb(0xc09484), nf(x, y) * 0.65 + p.rand() * 0.35));
    }
    for (let k = 0; k < 10; k++) p.set(p.ri(16), p.ri(16), 0x7d5346);
  },
  polished_andesite: (p) => {
    const nf = p.noise(4, 303);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      p.set(x, y, mix(rgb(0x8e8e90), rgb(0xb4b4b6), nf(x, y) * 0.65 + p.rand() * 0.35));
    }
  },
  polished_diorite: (p) => {
    const nf = p.noise(4, 304);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      p.set(x, y, mix(rgb(0xcfcfcf), rgb(0xf0f0f0), nf(x, y) * 0.65 + p.rand() * 0.35));
    }
    for (let k = 0; k < 8; k++) p.set(p.ri(16), p.ri(16), 0xb4b4b4);
  },
  chiseled_stone_bricks: (p) => {
    PAINTERS.smooth_stone(p);
    p.frame(0, 0, 16, 16, 0x5a5a5a);
    p.frame(2, 2, 12, 12, 0x6e6e6e);
    // a carved motif in the middle panel
    for (let x = 5; x < 11; x++) { p.set(x, 5, 0x4f4f4f); p.set(x, 10, 0x4f4f4f); }
    for (let y = 5; y < 11; y++) { p.set(5, y, 0x4f4f4f); p.set(10, y, 0x4f4f4f); }
    p.rect(7, 7, 2, 2, 0x565656);
  },
  chiseled_sandstone: (p) => {
    PAINTERS.sandstone(p);
    p.frame(1, 1, 14, 14, 0xbdb280);
    for (let x = 4; x < 12; x++) { p.set(x, 4, 0xa9a074); p.set(x, 11, 0xa9a074); }
    for (let y = 5; y < 11; y++) { p.set(6, y, 0xa9a074); p.set(9, y, 0xa9a074); }
    p.set(7, 6, 0xd8cf9e); p.set(8, 6, 0xd8cf9e);
  },
  smooth_sandstone: (p) => {
    const nf = p.noise(4, 305);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      p.set(x, y, mix(rgb(0xd2c896), rgb(0xe6ddb0), nf(x, y) * 0.6 + p.rand() * 0.4));
    }
  },
  end_stone_bricks: (p) => {
    PAINTERS.end_stone(p);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) p.mul(x, y, 0.97);
    const seam = 0xb4b489;
    for (const y of [3, 7, 11, 15]) for (let x = 0; x < 16; x++) p.set(x, y, seam);
    for (let y = 0; y < 3; y++) p.set(7, y, seam);
    for (let y = 4; y < 7; y++) { p.set(3, y, seam); p.set(11, y, seam); }
    for (let y = 8; y < 11; y++) p.set(7, y, seam);
    for (let y = 12; y < 15; y++) { p.set(3, y, seam); p.set(11, y, seam); }
  },
  terracotta: (p) => {
    const nf = p.noise(5, 306);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      p.set(x, y, mix(rgb(0x945b43), rgb(0xb07a5e), nf(x, y) * 0.6 + p.rand() * 0.4));
    }
    for (let k = 0; k < 10; k++) p.set(p.ri(16), p.ri(16), 0x7a4735);
  },
  packed_ice: (p) => {
    const nf = p.noise(4, 307);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      p.set(x, y, mix(rgb(0x8fb8e4), rgb(0xc4dcf4), nf(x, y) * 0.7 + p.rand() * 0.3));
    }
    for (let k = 0; k < 5; k++) {
      let x = p.ri(16), y = p.ri(16);
      for (let i = 0; i < 5; i++) { p.set(x, y, 0xe4f2ff); x += p.ri(3) - 1; y += p.ri(3) - 1; }
    }
  },
  quartz_block: (p) => p.scatter([0xe8e3da, 0xf2eee7, 0xdcd6cb, 0xfbf9f4], 0.45, 6, 308),
  quartz_block_top: (p) => p.scatter([0xeeeae2, 0xf7f4ee, 0xe2ddd4], 0.4, 7, 309),
  chiseled_quartz: (p) => {
    PAINTERS.quartz_block(p);
    p.frame(1, 1, 14, 14, 0xc9c2b6);
    p.rect(4, 4, 8, 8, 0xdedad1);
    p.frame(4, 4, 8, 8, 0xc0b9ac);
    p.set(7, 7, 0xf6f3ee); p.set(8, 8, 0xb8b1a4);
  },

  // ---- storage / utility ----
  emerald_block: (p) => {
    p.scatter([0x2fbf4a, 0x45d461, 0x229a38, 0x6fe886], 0.5, 6, 310);
    for (const [x, y] of [[3, 3], [11, 4], [5, 11], [12, 12], [7, 7]]) {
      p.set(x, y, 0xc4ffd0); p.set(x + 1, y, 0x9df0ae);
    }
  },
  redstone_block: (p) => {
    p.scatter([0xb01a1a, 0xcc2626, 0x8e1212, 0xe04040], 0.55, 5, 311);
    for (let k = 0; k < 10; k++) p.set(p.ri(16), p.ri(16), 0xff6a6a);
  },
  hay_block: (p) => {
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const v = p.rand();
        p.set(x, y, v < 0.3 ? 0xa8862a : v < 0.65 ? 0xc0a03a : 0xd4b653);
      }
    }
    for (const y of [0, 5, 10, 15]) for (let x = 0; x < 16; x++) p.set(x, y, 0x7d6420);
  },
  hay_block_top: (p) => {
    p.scatter([0xc0a03a, 0xd4b653, 0xa8862a], 0.4, 8, 312);
    p.frame(0, 0, 16, 16, 0x7d6420);
    for (let k = 0; k < 14; k++) p.set(p.ri(16), p.ri(16), 0xe6cf78);
  },
  honeycomb_block: (p) => {
    p.fill(0xd8901c);
    // hexagon-ish cells in a staggered grid
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        const ox = c * 4 + (r % 2 ? 2 : 0), oy = r * 4;
        for (let y = 0; y < 3; y++) {
          for (let x = 0; x < 3; x++) {
            if ((x === 0 || x === 2) && y === 1) continue;
            p.set(ox + x, oy + y, 0xf0b840);
          }
        }
      }
    }
    for (let k = 0; k < 12; k++) p.set(p.ri(16), p.ri(16), 0xffd97a);
  },
  bee_nest: (p) => {
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const v = p.rand();
        p.set(x, y, y < 5 ? (v < 0.5 ? 0x9a6a2a : 0xb07c34) : (v < 0.5 ? 0xc99a3a : 0xdcae4a));
      }
    }
    for (let x = 0; x < 16; x++) p.mul(x, 5, 0.7);
  },
  bee_nest_top: (p) => p.scatter([0x9a6a2a, 0xb07c34, 0x86592220 & 0xffffff], 0.45, 6, 313),
  bee_nest_front: (p) => {
    PAINTERS.bee_nest(p);
    p.rect(5, 9, 6, 4, 0x4a2f10);
    p.frame(5, 9, 6, 4, 0x6a4520);
    for (const [x, y] of [[6, 10], [9, 11]]) p.set(x, y, 0xffd97a);
  },
  jack_o_lantern: (p) => {
    PAINTERS.pumpkin_side(p);
    for (const [x, y] of [[3, 4], [4, 4], [4, 5], [5, 5], [3, 5],
      [10, 4], [11, 4], [12, 4], [11, 5], [12, 5], [10, 5]]) p.set(x, y, 0xffd24a);
    for (let x = 4; x < 12; x++) p.set(x, 9, 0xffd24a);
    for (const [x, y] of [[4, 10], [6, 10], [8, 10], [10, 10], [5, 11], [7, 11], [9, 11],
      [5, 8], [7, 8], [9, 8], [11, 8]]) p.set(x, y, 0xffc020);
  },

  // ---- underwater flora ----
  seagrass: (p) => paintPlant(p, (q) => {
    for (let k = 0; k < 7; k++) {
      const x = 2 + q.ri(12), h = 6 + q.ri(7);
      const c = q.pick([0x2f7a4a, 0x3d9a5c, 0x4fb06c]);
      for (let i = 0; i < h; i++) q.set(x + ((i / 4) | 0) * (k % 2 ? 1 : -1), 15 - i, c);
    }
  }),
  kelp: (p) => paintPlant(p, (q) => {
    for (let y = 0; y < 16; y++) { q.set(7, y, 0x3d8a4a); q.set(8, y, 0x4fa05c); }
    for (let k = 0; k < 5; k++) {
      const y = q.ri(14);
      const side = k % 2 ? 1 : -1;
      for (let i = 1; i <= 3; i++) q.set(8 + side * i, y + (i > 1 ? 1 : 0), 0x2f7a3a);
    }
  }),

  // ---- misc referenced by keys ----
  end_portal: (p) => { /* replaced by animated frames */ p.fill(0x05050c); },
  nether_portal: (p) => { p.fill(0x8a2ec4, 190); },
  water: (p) => { p.fill(0x3a6fd8, 190); },
  lava: (p) => { p.fill(0xd45a12); },
  fire: (p) => { p.clear(); },
};

// ---------------------------------------------------------------------------
// Animated tiles — each returns an array of P surfaces (looping frames).
// ---------------------------------------------------------------------------

export const ANIMATED = {
  water: { frames: 16, paint: waterFrames },
  lava: { frames: 16, paint: lavaFrames },
  nether_portal: { frames: 12, paint: portalFrames },
  end_portal: { frames: 12, paint: endPortalFrames },
  fire: { frames: 8, paint: fireFrames },
  furnace_front_lit: { frames: 4, paint: furnaceLitFrames },
};

function waterFrames(seedBase, count) {
  const out = [];
  for (let f = 0; f < count; f++) {
    const p = new P(seedBase);
    const ph = (f / count) * Math.PI * 2;
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        // sum of wrapping sines keeps every frame seamless AND loops perfectly
        const w =
          Math.sin((x / 16) * Math.PI * 2 * 2 + ph) * 0.5 +
          Math.sin((y / 16) * Math.PI * 2 * 3 - ph * 1.3) * 0.3 +
          Math.sin(((x + y) / 16) * Math.PI * 2 - ph * 0.7) * 0.35;
        const t = (w + 1.15) / 2.3;
        const c = mix(rgb(0x2a58b8), rgb(0x5b90ee), Math.max(0, Math.min(1, t)));
        p.set(x, y, c, 195);
        if (t > 0.86) p.set(x, y, mix(c, rgb(0xcfe4ff), 0.55), 205);
      }
    }
    out.push(p);
  }
  return out;
}

function lavaFrames(seedBase, count) {
  const out = [];
  const crust = new P(seedBase ^ 0x5a5a);
  const cn = crust.noise(4, 1);
  for (let f = 0; f < count; f++) {
    const p = new P(seedBase);
    const ph = (f / count) * Math.PI * 2;
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const w =
          Math.sin((x / 16) * Math.PI * 2 - ph) * 0.5 +
          Math.sin((y / 16) * Math.PI * 2 * 2 + ph * 0.8) * 0.4 +
          cn(x, y) * 1.2 - 0.6;
        const t = Math.max(0, Math.min(1, (w + 1.1) / 2.2));
        let c;
        if (t < 0.3) c = mix(rgb(0x5c1a04), rgb(0x8c2a06), t / 0.3);
        else if (t < 0.65) c = mix(rgb(0x8c2a06), rgb(0xe06a12), (t - 0.3) / 0.35);
        else c = mix(rgb(0xe06a12), rgb(0xffc44a), (t - 0.65) / 0.35);
        p.set(x, y, c);
      }
    }
    out.push(p);
  }
  return out;
}

function portalFrames(seedBase, count) {
  const out = [];
  for (let f = 0; f < count; f++) {
    const p = new P(seedBase + f);
    const ph = (f / count) * Math.PI * 2;
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const dx = x - 7.5, dy = y - 7.5;
        const r = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
        const swirl = Math.sin(a * 3 + r * 1.1 - ph * 2) * 0.5 + 0.5;
        const t = Math.max(0, Math.min(1, swirl * (1 - r / 12) + 0.15));
        const col = mix(rgb(0x300a55), rgb(0xc47aff), t);
        p.set(x, y, col, 205);
        if (p.rand() < 0.05) p.set(x, y, 0xf0d8ff, 235);
      }
    }
    out.push(p);
  }
  return out;
}

function endPortalFrames(seedBase, count) {
  const stars = [];
  const rnd = mulberry32(seedBase ^ 0x51ee);
  for (let i = 0; i < 26; i++) stars.push([rnd() * 16, rnd() * 16, rnd(), 0.3 + rnd() * 0.7]);
  const out = [];
  for (let f = 0; f < count; f++) {
    const p = new P(seedBase + f);
    const t = f / count;
    p.fill(0x05030c);
    for (const [sx, sy, sp, br] of stars) {
      const tw = 0.5 + 0.5 * Math.sin((t + sp) * Math.PI * 2);
      const x = Math.round((sx + t * 4 * (sp + 0.2)) % 16);
      const y = Math.round((sy + t * 2) % 16);
      const v = br * tw;
      const c = mix(rgb(0x1a0f3a), rgb(0xd0c0ff), v);
      p.set(x, y, c);
      if (v > 0.75) { p.blend(x + 1, y, c, 0.4); p.blend(x, y + 1, c, 0.4); }
    }
    out.push(p);
  }
  return out;
}

function fireFrames(seedBase, count) {
  const out = [];
  for (let f = 0; f < count; f++) {
    const p = new P(seedBase + f * 31);
    p.clear();
    const ph = (f / count) * Math.PI * 2;
    for (let x = 0; x < 16; x++) {
      const h = 7 + Math.sin(x * 0.8 + ph) * 3 + Math.sin(x * 2.1 - ph * 1.6) * 2.5;
      for (let y = 15; y > 15 - h; y--) {
        const t = (15 - y) / Math.max(1, h);
        const c = t < 0.25 ? 0xffe066 : t < 0.55 ? 0xff9b25 : t < 0.8 ? 0xe0480f : 0x8c2a06;
        p.set(x, y, c, t > 0.9 ? 140 : 255);
      }
    }
    out.push(p);
  }
  return out;
}

function furnaceLitFrames(seedBase, count) {
  const out = [];
  for (let f = 0; f < count; f++) {
    const p = new P(seedBase + f * 17);
    PAINTERS.furnace_front(p);
    for (let y = 8; y < 13; y++) {
      for (let x = 4; x < 12; x++) {
        const t = (13 - y) / 5;
        if (p.rand() < 0.25 + t * 0.6) p.set(x, y, t > 0.7 ? 0xffe066 : t > 0.4 ? 0xff9b25 : 0xd8480f);
      }
    }
    out.push(p);
  }
  return out;
}

/** Paint one tile by name. Returns { frames: P[] } (single-frame for statics). */
export function paintTile(name) {
  const seed = hashString('craftverse:' + name);
  const anim = ANIMATED[name];
  if (anim) return { frames: anim.paint(seed, anim.frames), animated: true };
  const p = new P(seed);
  const fn = PAINTERS[name];
  if (fn) fn(p);
  else {
    // Loud magenta checker so a missing painter is impossible to miss.
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      p.set(x, y, ((x >> 3) ^ (y >> 3)) ? 0x000000 : 0xff00ff);
    }
    console.warn('[tiles] missing painter for', name);
  }
  return { frames: [p], animated: false };
}

// Original workshop tile art: rune inlays, hammered iron and glass vials.
Object.assign(PAINTERS, {
 enchant_side(p){ p.fill(0x29203c); for(let y=0;y<16;y++)for(let x=0;x<16;x++)if((x+y*3)%7===0)p.set(x,y,0x443359); for(let x=0;x<16;x++){p.set(x,2,0x7b54bc);p.set(x,13,0x5bcdd0);} for(let x=2;x<16;x+=5){p.set(x,7,0xb29aed);p.set(x,8,0xb29aed);p.set(x+1,8,0xb29aed);} },
 enchant_top(p){ p.fill(0x352340); for(let x=1;x<15;x++){p.set(x,1,0x80dad7);p.set(x,14,0x80dad7);p.set(1,x,0x80dad7);p.set(14,x,0x80dad7);} for(let y=4;y<12;y++)for(let x=4;x<12;x++)p.set(x,y,x===8?0x725327:0xece3bf);for(let y=5;y<11;y+=2){p.set(5,y,0xa69776);p.set(10,y,0xa69776);} },
 anvil_side(p){p.fill(0x343946);for(let y=0;y<16;y++)for(let x=0;x<16;x++)if((x+y)%5===0)p.set(x,y,0x444a56);for(let x=0;x<16;x++){p.set(x,1,0x9299a6);p.set(x,4,0x1e2431);p.set(x,13,0x717a88);} },
 anvil_top(p){p.fill(0x7a8492);for(let y=0;y<16;y++)for(let x=0;x<16;x++)if((x*3+y)%11===0)p.set(x,y,0x555f70);for(let x=1;x<15;x++){p.set(x,1,0xb0b8c1);p.set(x,14,0x454d5d);} },
 brew_side(p){p.fill(0x343039);for(let y=2;y<14;y++)p.set(8,y,0xd8a658);for(let x=1;x<15;x++)p.set(x,13,0x777780);for(let x of [3,11]){for(let y=7;y<12;y++){p.set(x,y,0xa2dce3);p.set(x+1,y,0x739edd);}p.set(x,6,0xc1b38c);p.set(x+1,11,0xed68a7);} },
 brew_top(p){p.fill(0x5b5963);for(let x of [3,11])for(let y=4;y<12;y++)p.set(x,y,0x9bd0dc);for(let y=1;y<15;y++)p.set(8,y,0xc39b5b);},
 nether_wart(p){p.clear();for(let x of [3,7,12]){for(let y=8;y<16;y++)p.set(x,y,0x682235);for(let y=6;y<12;y++)for(let dx=-1;dx<=1;dx++)p.set(x+dx,y,(y+dx)%3?0xb73e59:0xe2737b);}},
 // --- 3.1 growth stages ---
 wheat_0(p){p.clear();for(const x of [3,6,9,12]){for(let y=12;y<16;y++)p.set(x,y,0x5fa53a);p.set(x,11,0x7fc456);}},
 wheat_1(p){p.clear();for(const x of [2,5,8,11,14]){for(let y=8;y<16;y++)p.set(x,y,(y%3)?0x6db044:0x8ad05e);p.set(x-1,9,0x8ad05e);}},
 wheat_2(p){p.clear();for(let k=0;k<5;k++){const x=2+k*3;for(let y=5;y<16;y++)p.set(x,y,0x86a94a);for(let y=4;y<8;y++){p.set(x-1,y,0xb8c862);p.set(x+1,y,0xb8c862);}}},
 nether_wart_0(p){p.clear();for(const x of [4,11]){p.set(x,15,0x682235);p.set(x,14,0x9a3547);p.set(x-1,14,0x9a3547);p.set(x+1,14,0x9a3547);}},
 nether_wart_1(p){p.clear();for(const x of [3,7,12]){for(let y=11;y<16;y++)p.set(x,y,0x682235);for(let y=9;y<13;y++)for(let dx=-1;dx<=1;dx++)p.set(x+dx,y,(y+dx)%3?0xa2394f:0xd06070);}},
 oak_sapling(p){p.clear();for(let y=9;y<16;y++)p.set(8,y,0x6b5230);for(const [x,y] of [[6,5],[7,4],[8,4],[9,4],[10,5],[5,6],[6,6],[7,6],[8,6],[9,6],[10,6],[11,6],[6,7],[7,7],[8,7],[9,7],[10,7],[7,8],[8,8],[9,8],[6,9],[10,9]])p.set(x,y,(x+y)%3?0x336d25:0x448a30);},
});
// ChugCraft 3.2: original stained glass and cottage building textures.
function cottageDoor(p,wood,top,arch=false){
 p.fill(wood);for(let x=0;x<16;x+=4){p.rect(x,0,1,16,0x513d32,160);p.rect(x+1,0,1,16,0xe8d1a0,100);}
 p.frame(0,0,16,16,0x48372d);p.frame(2,2,12,12,0x87664a);
 if(top){p.rect(4,3,8,9,0x9ac5db,65);p.frame(3,2,10,11,0x493a30);p.rect(7,3,2,9,wood);p.rect(4,7,8,1,wood);}
 else {p.rect(11,3,2,2,0xe9b651);p.frame(3,7,10,6,0x665344);}
 if(arch){p.rect(1,3,3,1,0x292d33);p.rect(1,12,3,1,0x292d33);}
}
for(const [key,col] of [['birch',0xd4c19a],['spruce',0x77543c]]){
 PAINTERS[key+'_door_top']=p=>cottageDoor(p,col,true,key==='spruce');
 PAINTERS[key+'_door_bottom']=p=>cottageDoor(p,col,false,key==='spruce');
}
for(const [key,col,edge] of [['blue_glass',0x398ab5,0x97dceb],['amber_glass',0xe5aa47,0xffda8b],['rose_glass',0xbc657d,0xffb4c3]]){
 PAINTERS[key]=p=>{p.fill(col,65);p.frame(0,0,16,16,edge,210);p.frame(1,1,14,14,edge,90);
 for(let i=0;i<7;i++){p.set(3+i,3+i,0xffffff,130);p.set(8+i,2+i,edge,90);}};
}
PAINTERS.oak_trapdoor=p=>{p.fill(0x9d783e);p.frame(0,0,16,16,0x5d442b);
 for(const x of [3,9])for(const y of [3,9]){p.rect(x,y,4,4,0x3c3024);p.frame(x,y,4,4,0xd3aa63);}
 p.rect(0,3,3,2,0x343c40);p.rect(0,11,3,2,0x343c40);};
PAINTERS.lantern=p=>{p.fill(0xffce71);p.frame(0,0,16,16,0x303943);p.rect(0,0,16,3,0x343d47);p.rect(0,13,16,3,0x343d47);
 for(const x of [3,11])p.rect(x,2,2,12,0x4d5052);p.rect(6,5,4,6,0xfff5bb);};
PAINTERS.mosaic=p=>{p.fill(0xcfa766);for(let y=0;y<16;y++)for(let x=0;x<16;x++){
 const d=Math.abs(x-7.5)+Math.abs(y-7.5);p.set(x,y,d<3?0xffdc78:d<6?0x388783:d<8?0x214a54:d<11?0xdbb77b:0xe3ce9c);
 }p.frame(0,0,16,16,0x776044);};
PAINTERS.basalt_tiles=p=>{p.scatter([0x303b48,0x394553,0x424f5c],.5);for(let y=0;y<16;y+=8){p.rect(0,y,16,1,0x1e2933);
 for(let x=(y?4:0);x<16;x+=8){p.rect(x,y,1,8,0x1d2934);p.rect(x+1,y+1,6,1,0x62757f);}}};

// --- 3.3: rails -------------------------------------------------------------
// One painter draws every track piece: two steel rails over wooden sleepers,
// optionally curving through a quarter turn, optionally powered (gold, and
// glowing while a redstone block keeps it switched on).
function railTrack(p, o = {}) {
  const { axis = 'z', corner = null, powered = false, on = false } = o;
  p.clear();
  const wood = 0x7a5a38, woodDark = 0x5b4229;
  const steel = powered ? (on ? 0xffd34d : 0xd8a92e) : 0xc9c9c9;
  const steelDark = powered ? (on ? 0xc79a20 : 0xa87e1c) : 0x949494;
  // In the 'z' orientation the track runs top-to-bottom in the tile; the 'x'
  // variant swaps the axes, so one code path covers both straights.
  const put = (x, y, c) => axis === 'z' ? p.set(x, y, c) : p.set(y, x, c);
  const bar = (x, y, w, h, c) => axis === 'z' ? p.rect(x, y, w, h, c) : p.rect(y, x, h, w, c);

  if (!corner) {
    for (const y of [1, 7, 13]) { bar(0, y, 16, 2, wood); bar(0, y + 2, 16, 1, woodDark); }
    for (const x of [4, 10]) {
      bar(x, 0, 1, 16, steelDark);
      bar(x + 1, 0, 1, 16, steel);
    }
  } else {
    // A quarter turn between two neighbouring sides. `corner` names them:
    // 'ne' joins the north (top) and east (right) edges, and so on.
    const cx = corner[1] === 'e' ? 15 : 0;
    const cy = corner[0] === 's' ? 15 : 0;
    const sx = cx === 15 ? -1 : 1;
    const sy = cy === 15 ? -1 : 1;
    const dot = (x, y, c) => {
      const X = Math.round(x), Y = Math.round(y);
      if (X >= 0 && X < 16 && Y >= 0 && Y < 16) p.set(X, Y, c);
    };
    // sleepers first, radiating across the arc, then the rails on top
    for (const t of [0.16, 0.5, 0.84]) {
      const a = t * (Math.PI / 2);
      for (let r = 2.5; r <= 13; r += 0.5) {
        dot(cx + sx * r * Math.cos(a), cy + sy * r * Math.sin(a), wood);
        dot(cx + sx * r * Math.cos(a + 0.09), cy + sy * r * Math.sin(a + 0.09), woodDark);
      }
    }
    const arc = (r, c) => {
      for (let i = 0; i <= 40; i++) {
        const a = (i / 40) * (Math.PI / 2);
        dot(cx + sx * r * Math.cos(a), cy + sy * r * Math.sin(a), c);
      }
    };
    arc(4.5, steelDark); arc(10.5, steelDark);
    arc(5.0, steel);     arc(11.0, steel);
  }
  if (powered && on) for (const [x, y] of [[2, 3], [13, 5], [7, 12], [3, 13]]) put(x, y, 0xff4646);
}
PAINTERS.rail_ns = (p) => railTrack(p, { axis: 'z' });
PAINTERS.rail_ew = (p) => railTrack(p, { axis: 'x' });
PAINTERS.rail_curve_ne = (p) => railTrack(p, { corner: 'ne' });
PAINTERS.rail_curve_nw = (p) => railTrack(p, { corner: 'nw' });
PAINTERS.rail_curve_se = (p) => railTrack(p, { corner: 'se' });
PAINTERS.rail_curve_sw = (p) => railTrack(p, { corner: 'sw' });
PAINTERS.powered_rail_ns = (p) => railTrack(p, { axis: 'z', powered: true });
PAINTERS.powered_rail_ew = (p) => railTrack(p, { axis: 'x', powered: true });
PAINTERS.powered_rail_ns_on = (p) => railTrack(p, { axis: 'z', powered: true, on: true });
PAINTERS.powered_rail_ew_on = (p) => railTrack(p, { axis: 'x', powered: true, on: true });
