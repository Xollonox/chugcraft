// ============================================================================
// Deterministic noise + RNG. Everything the world generator does must be a pure
// function of (seed, coordinate) so a seed always rebuilds the identical world.
// ============================================================================

/** Fast, well-distributed 32-bit PRNG. Returns floats in [0,1). */
export function mulberry32(a) {
  a = a >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Turn an arbitrary string into a stable 32-bit seed. */
export function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Parse a user-typed seed: numeric strings stay numeric, text is hashed. */
export function parseSeed(text) {
  const s = String(text ?? '').trim();
  if (s === '') return (Math.random() * 0xffffffff) >>> 0;
  if (/^-?\d+$/.test(s)) {
    const n = Number(s);
    if (Number.isSafeInteger(n)) return (n >>> 0) || 1;
  }
  return hashString(s);
}

/** Integer hash — deterministic pseudo-random value in [0,1) for a 3D cell. */
export function hash3(x, y, z, seed) {
  let h = seed ^ 0x27d4eb2d;
  h = Math.imul(h ^ (x | 0), 0x85ebca6b);
  h = Math.imul(h ^ (y | 0), 0xc2b2ae35);
  h = Math.imul(h ^ (z | 0), 0x27d4eb2f);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

export function hash2(x, z, seed) {
  return hash3(x, 0, z, seed);
}

// ---------------------------------------------------------------------------
// Gradient (Perlin) noise, 2D and 3D, backed by a seeded permutation table.
// ---------------------------------------------------------------------------

const GRAD3 = new Int8Array([
  1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0,
  1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1,
  0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1,
]);

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a, b, t) => a + (b - a) * t;

export class Noise {
  constructor(seed) {
    const rand = mulberry32(seed >>> 0);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = (rand() * (i + 1)) | 0;
      const t = p[i]; p[i] = p[j]; p[j] = t;
    }
    this.perm = new Uint8Array(512);
    this.permMod12 = new Uint8Array(512);
    for (let i = 0; i < 512; i++) {
      this.perm[i] = p[i & 255];
      this.permMod12[i] = this.perm[i] % 12;
    }
  }

  /** 2D Perlin noise in roughly [-1, 1]. */
  noise2(x, y) {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
    const xf = x - Math.floor(x), yf = y - Math.floor(y);
    const u = fade(xf), v = fade(yf);
    const p = this.perm;
    const aa = p[p[X] + Y], ab = p[p[X] + Y + 1];
    const ba = p[p[X + 1] + Y], bb = p[p[X + 1] + Y + 1];
    const g = (h, dx, dy) => {
      switch (h & 3) {
        case 0: return dx + dy;
        case 1: return -dx + dy;
        case 2: return dx - dy;
        default: return -dx - dy;
      }
    };
    const x1 = lerp(g(aa, xf, yf), g(ba, xf - 1, yf), u);
    const x2 = lerp(g(ab, xf, yf - 1), g(bb, xf - 1, yf - 1), u);
    return lerp(x1, x2, v);
  }

  /** 3D Perlin noise in roughly [-1, 1]. */
  noise3(x, y, z) {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
    const xf = x - Math.floor(x), yf = y - Math.floor(y), zf = z - Math.floor(z);
    const u = fade(xf), v = fade(yf), w = fade(zf);
    const p = this.perm, pm = this.permMod12;
    const A = p[X] + Y, AA = p[A] + Z, AB = p[A + 1] + Z;
    const B = p[X + 1] + Y, BA = p[B] + Z, BB = p[B + 1] + Z;
    const g = (hi, dx, dy, dz) => {
      const i = hi * 3;
      return GRAD3[i] * dx + GRAD3[i + 1] * dy + GRAD3[i + 2] * dz;
    };
    const x1 = lerp(g(pm[AA], xf, yf, zf), g(pm[BA], xf - 1, yf, zf), u);
    const x2 = lerp(g(pm[AB], xf, yf - 1, zf), g(pm[BB], xf - 1, yf - 1, zf), u);
    const y1 = lerp(x1, x2, v);
    const x3 = lerp(g(pm[AA + 1], xf, yf, zf - 1), g(pm[BA + 1], xf - 1, yf, zf - 1), u);
    const x4 = lerp(g(pm[AB + 1], xf, yf - 1, zf - 1), g(pm[BB + 1], xf - 1, yf - 1, zf - 1), u);
    return lerp(y1, lerp(x3, x4, v), w);
  }

  /** Fractal Brownian motion — layered octaves for organic terrain. */
  fbm2(x, y, octaves = 4, lacunarity = 2, gain = 0.5) {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += this.noise2(x * freq, y * freq) * amp;
      norm += amp;
      amp *= gain; freq *= lacunarity;
    }
    return sum / norm;
  }

  fbm3(x, y, z, octaves = 4, lacunarity = 2, gain = 0.5) {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += this.noise3(x * freq, y * freq, z * freq) * amp;
      norm += amp;
      amp *= gain; freq *= lacunarity;
    }
    return sum / norm;
  }

  /** Ridged noise — sharp mountain crests instead of rolling hills. */
  ridged2(x, y, octaves = 4) {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let i = 0; i < octaves; i++) {
      const n = 1 - Math.abs(this.noise2(x * freq, y * freq));
      sum += n * n * amp;
      norm += amp;
      amp *= 0.5; freq *= 2;
    }
    return sum / norm;
  }
}

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const smoothstep = (a, b, t) => {
  const x = clamp((t - a) / (b - a), 0, 1);
  return x * x * (3 - 2 * x);
};
export { lerp };
