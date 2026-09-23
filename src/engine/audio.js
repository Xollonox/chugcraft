// ============================================================================
// Audio. Every sound is synthesised at runtime into an AudioBuffer — nothing is
// sampled or shipped. Positional sounds route through a PannerNode so a creeper
// hissing behind you actually sounds behind you.
// ============================================================================

const SR = 22050;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Deterministic per-sound noise so a given sound is identical every time. */
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

// ---------------------------------------------------------------------------
// Synthesis primitives — all write straight into a Float32Array
// ---------------------------------------------------------------------------

function envelope(i, n, attack, decay, curve = 2) {
  const t = i / n;
  if (t < attack) return t / attack;
  const d = (t - attack) / Math.max(1e-4, decay);
  return Math.pow(Math.max(0, 1 - d), curve);
}

const RECIPES = {
  // --- digging / footsteps -------------------------------------------------
  dig_soft: { dur: 0.20, seed: 11, f: (t, i, n, r) => (r() * 2 - 1) * envelope(i, n, 0.02, 1, 2.4) * 0.55 * (1 - t * 0.4) },
  dig_stone: {
    dur: 0.20, seed: 12,
    f: (t, i, n, r) => ((r() * 2 - 1) * 0.7 + Math.sin(t * 900 * Math.PI * 2) * 0.3) * envelope(i, n, 0.005, 1, 4) * 0.5,
  },
  dig_wood: {
    dur: 0.22, seed: 13,
    f: (t, i, n, r) => ((r() * 2 - 1) * 0.4 + Math.sin(t * 320 * Math.PI * 2 * (1 - t * 0.4)) * 0.6) * envelope(i, n, 0.004, 1, 3.4) * 0.5,
  },
  dig_sand: { dur: 0.24, seed: 14, f: (t, i, n, r) => (r() * 2 - 1) * envelope(i, n, 0.05, 1, 1.6) * 0.42 },
  dig_glass: {
    dur: 0.3, seed: 15,
    f: (t, i, n, r) => ((r() * 2 - 1) * 0.5 + Math.sin(t * 2600 * Math.PI * 2) * 0.5) * envelope(i, n, 0.002, 1, 5) * 0.4,
  },
  dig_snow: { dur: 0.2, seed: 16, f: (t, i, n, r) => (r() * 2 - 1) * envelope(i, n, 0.02, 1, 3) * 0.3 },
  // A footstep on grass is a soft, dull rustle — almost all low-mid energy.
  // Reusing the dig noise sped up 1.3x gave a bright, thin tick that sat at an
  // irritating pitch and read as static rather than as ground underfoot. The
  // running average is a cheap one-pole lowpass: it rolls the hiss off the top
  // and leaves the body of the sound behind.
  step_soft: {
    dur: 0.16, seed: 18,
    f: (() => {
      let lp = 0, lp2 = 0;
      return (t, i, n, r) => {
        if (i === 0) { lp = 0; lp2 = 0; }
        // two poles, and the cutoff closes as the step settles, so the rustle
        // dies away dull instead of ending on a bright edge
        const k = 0.16 * (1 - (i / n) * 0.5);
        lp += ((r() * 2 - 1) - lp) * k;
        lp2 += (lp - lp2) * k;
        void t;
        return lp2 * envelope(i, n, 0.01, 1, 2.6) * 3.1;
      };
    })(),
  },
  dig_wool: { dur: 0.2, seed: 17, f: (t, i, n, r) => (r() * 2 - 1) * envelope(i, n, 0.06, 1, 2) * 0.28 },

  // --- player --------------------------------------------------------------
  hurt: {
    dur: 0.35, seed: 21,
    f: (t, i, n) => Math.sin(t * (260 - t * 200) * Math.PI * 2) * envelope(i, n, 0.01, 1, 2.5) * 0.5
      + Math.sin(t * 520 * Math.PI * 2) * envelope(i, n, 0.01, 0.4, 3) * 0.2,
  },
  death: {
    dur: 1.1, seed: 22,
    f: (t, i, n) => Math.sin(t * (300 - t * 240) * Math.PI * 2) * envelope(i, n, 0.02, 1, 1.4) * 0.45,
  },
  eat: {
    dur: 0.22, seed: 23,
    f: (t, i, n, r) => (r() * 2 - 1) * envelope(i, n, 0.03, 1, 2) * 0.32 * (0.6 + 0.4 * Math.sin(t * 40 * Math.PI * 2)),
  },
  splash: { dur: 0.5, seed: 24, f: (t, i, n, r) => (r() * 2 - 1) * envelope(i, n, 0.01, 1, 2) * 0.4 * (1 - t) },
  burn: { dur: 0.6, seed: 25, f: (t, i, n, r) => (r() * 2 - 1) * envelope(i, n, 0.05, 1, 1.2) * 0.3 },

  // --- UI ------------------------------------------------------------------
  click: { dur: 0.10, seed: 31, f: (t, i, n) => Math.sin(t * 1000 * Math.PI * 2) * envelope(i, n, 0.002, 1, 6) * 0.28 },
  pop: { dur: 0.14, seed: 32, f: (t, i, n) => Math.sin(t * (500 + t * 900) * Math.PI * 2) * envelope(i, n, 0.004, 1, 5) * 0.3 },
  xp: { dur: 0.22, seed: 33, f: (t, i, n) => Math.sin(t * (900 + t * 1400) * Math.PI * 2) * envelope(i, n, 0.004, 1, 4) * 0.22 },
  levelup: {
    dur: 0.9, seed: 34,
    f: (t, i, n) => {
      const steps = [523.25, 659.25, 783.99, 1046.5];
      const s = Math.min(3, Math.floor(t * 4));
      return Math.sin(t * steps[s] * Math.PI * 2) * envelope(i, n, 0.01, 1, 1.2) * 0.24;
    },
  },
  chest: { dur: 0.4, seed: 35, f: (t, i, n, r) => ((r() * 2 - 1) * 0.35 + Math.sin(t * (180 + t * 120) * Math.PI * 2) * 0.65) * envelope(i, n, 0.02, 1, 2.4) * 0.3 },
  shear: { dur: 0.28, seed: 37, f: (t, i, n, r) => ((r() * 2 - 1) * 0.5 + Math.sin(t * (2400 - t * 3000) * Math.PI * 2) * 0.5) * envelope(i, n, 0.004, 1, 3) * 0.3 },
  hoe_till: { dur: 0.22, seed: 38, f: (t, i, n, r) => (r() * 2 - 1) * envelope(i, n, 0.005, 1, 2.2) * 0.34 * (1 - t * 0.5) },
  bobber_splash: { dur: 0.45, seed: 39, f: (t, i, n, r) => ((r() * 2 - 1) * 0.6 + Math.sin(t * (700 - t * 900) * Math.PI * 2) * 0.4) * envelope(i, n, 0.002, 1, 2.6) * 0.42 },
  craft: { dur: 0.3, seed: 36, f: (t, i, n, r) => ((r() * 2 - 1) * 0.5) * envelope(i, n, 0.01, 1, 2.4) * 0.3 },

  // --- mobs ----------------------------------------------------------------
  zombie: {
    dur: 0.8, seed: 41,
    f: (t, i, n, r) => (Math.sin(t * (110 + Math.sin(t * 9) * 26) * Math.PI * 2) * 0.7 + (r() * 2 - 1) * 0.3)
      * envelope(i, n, 0.08, 1, 1.3) * 0.42,
  },
  skeleton: {
    dur: 0.5, seed: 42,
    f: (t, i, n, r) => {
      const clack = Math.floor(t * 22) % 2 ? 1 : 0.2;
      return (r() * 2 - 1) * clack * envelope(i, n, 0.01, 1, 1.4) * 0.36;
    },
  },
  creeper_hiss: {
    dur: 1.3, seed: 43,
    f: (t, i, n, r) => (r() * 2 - 1) * clamp01(t * 3) * envelope(i, n, 0.2, 1, 0.7) * 0.55,
  },
  explode: {
    dur: 1.4, seed: 44,
    f: (t, i, n, r) => ((r() * 2 - 1) * 0.8 + Math.sin(t * (70 - t * 50) * Math.PI * 2) * 0.5)
      * envelope(i, n, 0.005, 1, 1.6) * 0.85,
  },
  spider: {
    dur: 0.5, seed: 45,
    f: (t, i, n, r) => (r() * 2 - 1) * (Math.floor(t * 30) % 2 ? 1 : 0.3) * envelope(i, n, 0.02, 1, 1.8) * 0.3,
  },
  enderman: {
    dur: 0.9, seed: 46,
    f: (t, i, n, r) => (Math.sin(t * (70 + Math.sin(t * 3) * 40) * Math.PI * 2) * 0.8 + (r() * 2 - 1) * 0.2)
      * envelope(i, n, 0.1, 1, 1.1) * 0.4,
  },
  teleport: {
    dur: 0.5, seed: 47,
    f: (t, i, n) => Math.sin(t * (1800 - t * 1500) * Math.PI * 2) * envelope(i, n, 0.005, 1, 2.2) * 0.3,
  },
  blaze: {
    dur: 0.9, seed: 48,
    f: (t, i, n, r) => ((r() * 2 - 1) * 0.6 + Math.sin(t * 190 * Math.PI * 2) * 0.4) * envelope(i, n, 0.15, 1, 1.0) * 0.4,
  },
  ghast: {
    dur: 1.6, seed: 49,
    f: (t, i, n) => Math.sin(t * (420 - t * 260) * Math.PI * 2) * envelope(i, n, 0.15, 1, 0.9) * 0.42,
  },
  fireball: { dur: 0.7, seed: 50, f: (t, i, n, r) => (r() * 2 - 1) * envelope(i, n, 0.02, 1, 1.4) * 0.42 },
  cow: { dur: 1.0, seed: 51, f: (t, i, n) => Math.sin(t * (160 - t * 60) * Math.PI * 2) * envelope(i, n, 0.12, 1, 1.1) * 0.34 },
  pig: { dur: 0.5, seed: 52, f: (t, i, n, r) => (Math.sin(t * (300 + Math.sin(t * 30) * 120) * Math.PI * 2) * 0.6 + (r() * 2 - 1) * 0.4) * envelope(i, n, 0.03, 1, 1.6) * 0.3 },
  chicken: { dur: 0.4, seed: 53, f: (t, i, n) => Math.sin(t * (760 + Math.sin(t * 44) * 260) * Math.PI * 2) * envelope(i, n, 0.02, 1, 2) * 0.24 },
  sheep: { dur: 0.8, seed: 54, f: (t, i, n) => Math.sin(t * (420 + Math.sin(t * 26) * 120) * Math.PI * 2) * envelope(i, n, 0.05, 1, 1.3) * 0.28 },
  villager: { dur: 0.5, seed: 55, f: (t, i, n) => Math.sin(t * (240 + Math.sin(t * 12) * 80) * Math.PI * 2) * envelope(i, n, 0.05, 1, 1.6) * 0.3 },

  // --- projectiles & world -------------------------------------------------
  bow: { dur: 0.35, seed: 61, f: (t, i, n, r) => ((r() * 2 - 1) * 0.35 + Math.sin(t * (900 - t * 700) * Math.PI * 2) * 0.65) * envelope(i, n, 0.005, 1, 3) * 0.3 },
  arrow_hit: { dur: 0.2, seed: 62, f: (t, i, n, r) => (r() * 2 - 1) * envelope(i, n, 0.002, 1, 5) * 0.3 },
  portal_travel: { dur: 1.6, seed: 63, f: (t, i, n) => Math.sin(t * (140 + t * 420) * Math.PI * 2) * envelope(i, n, 0.1, 1, 1.0) * 0.36 },
  portal_hum: { dur: 1.6, seed: 64, loop: true, f: (t) => (Math.sin(t * 84 * Math.PI * 2) * 0.6 + Math.sin(t * 126 * Math.PI * 2) * 0.4) * 0.10 },
  water_amb: { dur: 2.0, seed: 65, loop: true, f: (t, i, n, r) => (r() * 2 - 1) * 0.05 * (0.6 + 0.4 * Math.sin(t * 1.3)) },
  lava_amb: { dur: 2.0, seed: 66, loop: true, f: (t, i, n, r) => (r() * 2 - 1) * 0.07 * (0.5 + 0.5 * Math.sin(t * 0.7)) },
  rain: { dur: 2.0, seed: 67, loop: true, f: (t, i, n, r) => (r() * 2 - 1) * 0.16 },
  thunder: {
    dur: 2.6, seed: 68,
    f: (t, i, n, r) => ((r() * 2 - 1) * (0.6 + 0.4 * Math.sin(t * 2))) * envelope(i, n, 0.01, 1, 1.1) * 0.9,
  },
  fizz: { dur: 0.6, seed: 69, f: (t, i, n, r) => (r() * 2 - 1) * envelope(i, n, 0.01, 1, 1.4) * 0.35 },
  ignite: { dur: 0.4, seed: 70, f: (t, i, n, r) => (r() * 2 - 1) * envelope(i, n, 0.005, 1, 2.6) * 0.4 },

  // --- boss ----------------------------------------------------------------
  dragon_growl: {
    dur: 2.2, seed: 81,
    f: (t, i, n, r) => (Math.sin(t * (58 + Math.sin(t * 2.2) * 22) * Math.PI * 2) * 0.75 + (r() * 2 - 1) * 0.25)
      * envelope(i, n, 0.15, 1, 0.8) * 0.6,
  },
  dragon_hurt: {
    dur: 1.0, seed: 82,
    f: (t, i, n, r) => (Math.sin(t * (170 - t * 110) * Math.PI * 2) * 0.7 + (r() * 2 - 1) * 0.3) * envelope(i, n, 0.02, 1, 1.4) * 0.55,
  },
  dragon_death: {
    dur: 3.0, seed: 83,
    f: (t, i, n, r) => (Math.sin(t * (120 - t * 100) * Math.PI * 2) * 0.6 + (r() * 2 - 1) * 0.4) * envelope(i, n, 0.05, 1, 0.7) * 0.7,
  },
  // Wood and iron taking a hit: a low thud with a short metallic ring over it.
  shield_block: {
    dur: 0.30, seed: 85,
    f: (t, i, n, r) => (
      (r() * 2 - 1) * 0.45 * envelope(i, n, 0.003, 1, 6)
      + Math.sin(t * 180 * Math.PI * 2) * 0.5 * envelope(i, n, 0.004, 1, 5)
      + Math.sin(t * 1150 * Math.PI * 2) * 0.22 * envelope(i, n, 0.002, 1, 9)
    ) * 0.5,
  },
  crystal_break: {
    dur: 1.0, seed: 84,
    f: (t, i, n, r) => ((r() * 2 - 1) * 0.5 + Math.sin(t * (2200 - t * 1800) * Math.PI * 2) * 0.5) * envelope(i, n, 0.004, 1, 2.2) * 0.55,
  },

  // --- v2 additions --------------------------------------------------------
  // A step on stone or wood is a dull thud with a small click on top. These
  // used to borrow the mining sounds pitched up 1.5x, which read as a bright
  // tick rather than a boot hitting the floor.
  step_hard: {
    dur: 0.15, seed: 19,
    f: (() => {
      let lp = 0;
      return (t, i, n, r) => {
        if (i === 0) lp = 0;
        lp += ((r() * 2 - 1) - lp) * 0.45;
        const thud = Math.sin(t * 132 * Math.PI * 2) * envelope(i, n, 0.002, 1, 6.5);
        return (lp * 0.45 * envelope(i, n, 0.001, 1, 9) + thud * 0.55) * 0.5;
      };
    })(),
  },
  // Door creak: a slow upward pitch slide with a grainy edge riding on it.
  door: {
    dur: 0.55, seed: 71,
    f: (t, i, n, r) => {
      const wob = 0.5 + 0.5 * Math.sin(t * 26 * Math.PI * 2);
      const f0 = 205 + t * 135 + wob * 45;
      return (Math.sin(t * f0 * Math.PI * 2) * 0.55 + (r() * 2 - 1) * 0.28 * wob)
        * envelope(i, n, 0.05, 1, 1.6) * 0.30;
    },
  },
  // A tool giving out: a dry snap with a falling body under it.
  break_item: {
    dur: 0.34, seed: 72,
    f: (t, i, n, r) => ((r() * 2 - 1) * 0.6 + Math.sin(t * (640 - t * 400) * Math.PI * 2) * 0.4)
      * envelope(i, n, 0.002, 1, 3.6) * 0.45,
  },
  // Three blobby gulps.
  drink: {
    dur: 0.72, seed: 73,
    f: (t, i, n, r) => {
      const g = Math.floor(t * 3.2);
      const lt = (t * 3.2) % 1;
      return (Math.sin(lt * (120 + g * 26) * Math.PI * 2) * 0.7 + (r() * 2 - 1) * 0.18)
        * Math.pow(Math.max(0, 1 - lt), 2.4) * envelope(i, n, 0.02, 1, 0.9) * 0.40;
    },
  },
  // Struck metal: two inharmonic partials over a low body.
  clank: {
    dur: 0.5, seed: 74,
    f: (t, i, n, r) => (
      Math.sin(t * 1720 * Math.PI * 2) * 0.32 * envelope(i, n, 0.001, 1, 5)
      + Math.sin(t * 2310 * Math.PI * 2) * 0.22 * envelope(i, n, 0.001, 1, 7)
      + Math.sin(t * 380 * Math.PI * 2) * 0.40 * envelope(i, n, 0.002, 1, 4)
      + (r() * 2 - 1) * 0.22 * envelope(i, n, 0.001, 1, 12)
    ) * 0.45,
  },
  // Lit furnace: a low roar with random crackles popping out of it.
  furnace_amb: {
    dur: 2.0, seed: 75, loop: true,
    f: (() => {
      let env = 0, lp = 0;
      return (t, i, n, r) => {
        if (i === 0) { env = 0; lp = 0; }
        if (r() < 0.0025) env = 1;
        env *= 0.994;
        lp += ((r() * 2 - 1) - lp) * 0.08;
        return lp * 0.15 + (r() * 2 - 1) * env * 0.20;
      };
    })(),
  },
  // Deep-underground ambience: a hollow drifting drone. Nothing says "you are
  // a long way from the sun" quite like this.
  cave_amb: {
    dur: 4.0, seed: 76, loop: true,
    f: (t, i, n, r) => {
      const drift = Math.sin(t * 0.21 * Math.PI * 2);
      const a = Math.sin(t * (62 + drift * 3) * Math.PI * 2);
      const b = Math.sin(t * (93 + drift * 5) * Math.PI * 2);
      const swell = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(t * 0.13 * Math.PI * 2));
      return ((a * 0.5 + b * 0.3) * 0.09 + (r() * 2 - 1) * 0.028) * swell;
    },
  },
};

// Sound aliases used by the game, mapped to a recipe + pitch.
const ALIASES = {
  dig_grass: ['dig_soft', 1.0], dig_dirt: ['dig_soft', 0.9], dig_gravel: ['dig_sand', 1.25],
  step_grass: ['step_soft', 1.0], step_dirt: ['step_soft', 0.9],
  step_stone: ['step_hard', 1.0], step_wood: ['step_hard', 1.22],
  step_sand: ['dig_sand', 1.4], step_snow: ['dig_snow', 1.4], step_water: ['splash', 1.6],
  place: ['dig_stone', 1.15],
  door_open: ['door', 1.0], door_close: ['door', 0.82],
  chest_open: ['chest', 1.0], chest_close: ['chest', 0.85],
  bucket: ['splash', 0.9], anvil: ['clank', 1.0], tool_break: ['break_item', 1.0],
};

/** Human-readable captions for the subtitles option. Footsteps are left out on purpose. */
export const CAPTIONS = {
  dig_soft: 'Block broken', dig_stone: 'Block broken', dig_wood: 'Block broken', dig_sand: 'Block broken',
  dig_glass: 'Glass shatters', dig_snow: 'Block broken', dig_wool: 'Block broken', dig_grass: 'Block broken',
  dig_dirt: 'Block broken', dig_gravel: 'Block broken', place: 'Block placed',
  hurt: 'Player hurts', death: 'Player dies', eat: 'Eating', drink: 'Drinking', splash: 'Splash', burn: 'Burning',
  click: 'Click', pop: 'Item pops', xp: 'Experience gained', levelup: 'Level up!', chest: 'Chest opens',
  chest_open: 'Chest opens', chest_close: 'Chest closes', craft: 'Item crafted', shear: 'Shears snip',
  hoe_till: 'Hoe tills', bobber_splash: 'Fishing bobber splashes', bow: 'Bow fires', arrow_hit: 'Arrow hits',
  zombie: 'Zombie groans', skeleton: 'Skeleton rattles', creeper_hiss: 'Creeper hisses', explode: 'Explosion',
  spider: 'Spider hisses', enderman: 'Enderman vwoops', teleport: 'Enderman teleports', blaze: 'Blaze breathes',
  ghast: 'Ghast cries', fireball: 'Fireball whooshes', cow: 'Cow moos', pig: 'Pig oinks', chicken: 'Chicken clucks',
  sheep: 'Sheep baahs', villager: 'Villager mumbles', portal_travel: 'Portal whooshes', thunder: 'Thunder',
  fizz: 'Fizz', ignite: 'Fire ignites', dragon_growl: 'Dragon growls', dragon_hurt: 'Dragon hurts',
  dragon_death: 'Dragon dies', shield_block: 'Shield blocks', crystal_break: 'Crystal shatters',
  door: 'Door creaks', door_open: 'Door opens', door_close: 'Door closes', break_item: 'Item breaks',
  tool_break: 'Item breaks', clank: 'Anvil clangs', anvil: 'Anvil clangs', bucket: 'Bucket fills',
};

export class GameAudio {
  constructor(settings) {
    this.settings = settings;
    this.ctx = null;
    this.buffers = new Map();
    this.loops = new Map();
    this.enabled = true;
    this.musicOn = false;
    this._musicTimer = null;
    this._lastPlay = new Map();
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.enabled = false; return; }
    this.ctx = new AC({ sampleRate: 44100 });
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.sfxBus = this.ctx.createGain();
    this.musicBus = this.ctx.createGain();
    this.sfxBus.connect(this.master);
    this.musicBus.connect(this.master);
    this.applyVolumes();
  }

  resume() {
    this.init();
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  applyVolumes() {
    if (!this.ctx) return;
    const s = this.settings;
    this.master.gain.value = s.get('masterVolume');
    this.sfxBus.gain.value = s.get('soundVolume');
    this.musicBus.gain.value = s.get('musicVolume');
  }

  _buffer(name) {
    if (this.buffers.has(name)) return this.buffers.get(name);
    const r = RECIPES[name];
    if (!r) return null;
    const n = Math.max(1, Math.floor(r.dur * SR));
    const buf = this.ctx.createBuffer(1, n, SR);
    const data = buf.getChannelData(0);
    const rand = rng(r.seed * 2654435761);
    for (let i = 0; i < n; i++) {
      data[i] = Math.max(-1, Math.min(1, r.f(i / SR, i, n, rand)));
    }
    // click-free edges
    const fade = Math.min(64, (n / 8) | 0);
    for (let i = 0; i < fade; i++) {
      data[i] *= i / fade;
      data[n - 1 - i] *= i / fade;
    }
    this.buffers.set(name, buf);
    return buf;
  }

  /**
   * @param name recipe or alias
   * @param opts { pos:[x,y,z], volume, rate, throttle }
   */
  play(name, opts = {}) {
    if (!this.enabled) return null;
    this.init();
    if (!this.ctx || this.ctx.state !== 'running') return null;
    let rate = opts.rate ?? 1;
    let key = name;
    if (ALIASES[name]) { key = ALIASES[name][0]; rate *= ALIASES[name][1]; }
    const buf = this._buffer(key);
    if (!buf) return null;

    if (opts.throttle) {
      const last = this._lastPlay.get(name) || 0;
      const now = this.ctx.currentTime;
      if (now - last < opts.throttle) return null;
      this._lastPlay.set(name, now);
    }
    // Accessibility subtitles hook: the HUD prints "Cow moos" etc.
    this.onPlay?.(name, opts);

    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate * (0.94 + Math.random() * 0.12);
    const gain = this.ctx.createGain();
    gain.gain.value = opts.volume ?? 1;
    src.connect(gain);
    if (opts.pos) {
      const p = this.ctx.createPanner();
      p.panningModel = 'HRTF';
      p.distanceModel = 'inverse';
      p.refDistance = 4;
      p.maxDistance = 48;
      p.rolloffFactor = 1.3;
      if (p.positionX) {
        p.positionX.value = opts.pos[0]; p.positionY.value = opts.pos[1]; p.positionZ.value = opts.pos[2];
      } else p.setPosition(opts.pos[0], opts.pos[1], opts.pos[2]);
      gain.connect(p);
      p.connect(this.sfxBus);
    } else {
      gain.connect(this.sfxBus);
    }
    src.start();
    return src;
  }

  /** Persistent ambience (water, lava, portal, rain) with a fading gain. */
  setLoop(name, volume) {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx || this.ctx.state !== 'running') return;
    let entry = this.loops.get(name);
    if (volume <= 0.001) {
      if (entry) {
        entry.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.3);
        setTimeout(() => { try { entry.src.stop(); } catch { /* already stopped */ } }, 900);
        this.loops.delete(name);
      }
      return;
    }
    if (!entry) {
      const buf = this._buffer(name);
      if (!buf) return;
      const src = this.ctx.createBufferSource();
      src.buffer = buf; src.loop = true;
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      src.connect(gain); gain.connect(this.sfxBus);
      src.start();
      entry = { src, gain };
      this.loops.set(name, entry);
    }
    entry.gain.gain.setTargetAtTime(volume, this.ctx.currentTime, 0.4);
  }

  stopAllLoops() {
    for (const name of [...this.loops.keys()]) this.setLoop(name, 0);
  }

  setListener(pos, forward, up) {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    if (l.positionX) {
      l.positionX.value = pos[0]; l.positionY.value = pos[1]; l.positionZ.value = pos[2];
      l.forwardX.value = forward[0]; l.forwardY.value = forward[1]; l.forwardZ.value = forward[2];
      l.upX.value = up[0]; l.upY.value = up[1]; l.upZ.value = up[2];
    } else {
      l.setPosition(pos[0], pos[1], pos[2]);
      l.setOrientation(forward[0], forward[1], forward[2], up[0], up[1], up[2]);
    }
  }

  // -------------------------------------------------------------------------
  // Generative ambient music — soft pentatonic pads, never repeats exactly.
  // -------------------------------------------------------------------------
  /**
   * A slow, generative piece for the background. Nothing here is sampled or
   * hand-sequenced: a chord progression drifts through a few voicings while a
   * pentatonic melody wanders over the top, so it never audibly loops. It all
   * runs through a feedback delay with the highs damped, which is what gives
   * the soft-piano plucks their big, empty-room tail.
   */
  startMusic() {
    this.init();
    if (!this.ctx || this.musicOn) return;
    this.musicOn = true;
    const ctx = this.ctx;

    // The wet tail. Delay -> damping filter -> back into the delay, so each
    // repeat loses its highs and the whole thing dissolves rather than echoes.
    const fx = this._musicFx = {};
    fx.in = ctx.createGain();
    fx.delay = ctx.createDelay(1.5);
    fx.delay.delayTime.value = 0.42;
    fx.fb = ctx.createGain();
    fx.fb.gain.value = 0.38;
    fx.damp = ctx.createBiquadFilter();
    fx.damp.type = 'lowpass';
    fx.damp.frequency.value = 1600;
    fx.wet = ctx.createGain();
    fx.wet.gain.value = 0.5;
    fx.in.connect(fx.delay);
    fx.delay.connect(fx.damp);
    fx.damp.connect(fx.fb);
    fx.fb.connect(fx.delay);
    fx.damp.connect(fx.wet);
    fx.wet.connect(this.musicBus);
    fx.in.connect(this.musicBus);

    const A2 = 110;
    // Am - F - C - Em - Dm, written as semitone offsets from A.
    const PROG = [
      { root: 0, minor: true }, { root: -4, minor: false }, { root: 3, minor: false },
      { root: 7, minor: true }, { root: 5, minor: true },
    ];
    const SEQS = [[0, 1, 2, 3], [0, 2, 4, 1], [2, 1, 0, 3], [0, 4, 1, 2]];
    const MEL = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22];
    const BAR = 6.5;

    const note = (semi, at, dur, gain, type = 'sine') => {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = A2 * Math.pow(2, semi / 12);
      osc.detune.value = (Math.random() * 2 - 1) * 7;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, at);
      g.gain.linearRampToValueAtTime(gain, at + 0.014);
      g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      osc.connect(g);
      g.connect(fx.in);
      osc.start(at);
      osc.stop(at + dur + 0.05);
    };

    let seq = SEQS[(Math.random() * SEQS.length) | 0];
    let bar = 0;
    const schedule = () => {
      if (!this.musicOn || !this.ctx || !this._musicFx) return;
      const t0 = ctx.currentTime + 0.06;
      const chord = PROG[seq[bar % seq.length]];
      const voicing = [0, 7, 12, chord.minor ? 15 : 16, 19];
      // Roll the chord out across the bar instead of hitting it all at once.
      voicing.forEach((v, i) => {
        note(chord.root + v, t0 + i * 0.42 + Math.random() * 0.07,
          1.7 + Math.random() * 1.3, 0.05 - i * 0.005);
      });
      // Every fourth bar is left bare so the tail has room to breathe.
      if (bar % 4 !== 3) {
        const count = 2 + ((Math.random() * 3) | 0);
        for (let i = 0; i < count; i++) {
          note(chord.root + 12 + MEL[(Math.random() * MEL.length) | 0],
            t0 + 1.1 + Math.random() * (BAR - 2.2), 1.3 + Math.random(), 0.042, 'triangle');
        }
      }
      if (bar % 2 === 0) note(chord.root - 12, t0, 3.6, 0.05);
      bar++;
      if (bar % 4 === 0 && Math.random() < 0.6) seq = SEQS[(Math.random() * SEQS.length) | 0];
      this._musicTimer = setTimeout(schedule, BAR * 1000);
    };
    schedule();
  }

  stopMusic() {
    this.musicOn = false;
    if (this._musicTimer) clearTimeout(this._musicTimer);
    this._musicTimer = null;
    const fx = this._musicFx;
    this._musicFx = null;
    if (!fx) return;
    // Fade the tail out rather than cutting it dead mid-ring.
    try {
      const t = this.ctx.currentTime;
      fx.in.gain.setValueAtTime(fx.in.gain.value, t);
      fx.in.gain.linearRampToValueAtTime(0, t + 1.0);
      fx.wet.gain.setValueAtTime(fx.wet.gain.value, t);
      fx.wet.gain.linearRampToValueAtTime(0, t + 1.8);
    } catch (e) { /* context already gone */ }
    setTimeout(() => {
      for (const n of [fx.in, fx.delay, fx.fb, fx.damp, fx.wet]) {
        try { n.disconnect(); } catch (e) { /* already detached */ }
      }
    }, 2200);
  }
}

/** Pick the right dig/step sound family for a block. */
export function materialSound(blockDef) {
  if (!blockDef) return 'dig_stone';
  const k = blockDef.key;
  if (k.includes('grass') || k.includes('leaves') || k === 'dirt' || k.includes('flower') || k === 'farmland') return 'dig_soft';
  if (k.includes('sand') || k === 'gravel' || k === 'clay') return 'dig_sand';
  if (k.includes('log') || k.includes('planks') || k.includes('wood') || k === 'crafting_table' || k === 'chest' || k === 'bookshelf' || k === 'oak_door' || k === 'ladder') return 'dig_wood';
  if (k === 'glass' || k === 'ice') return 'dig_glass';
  if (k === 'wool' || k === 'bed') return 'dig_wool';
  if (k.includes('snow')) return 'dig_snow';
  return 'dig_stone';
}
