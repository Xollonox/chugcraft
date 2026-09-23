import { isWater, isLava } from '../world/blocks.js';
// ============================================================================
// Mobs: models, behaviour, drops, and the light/biome/dimension driven spawner.
//
// Behaviours are small and readable rather than a full pathfinder — steering
// plus "jump when blocked" reads convincingly in a voxel world and stays cheap
// enough to run dozens of mobs at 60 FPS.
// ============================================================================

import * as THREE from 'three';
import { Entity } from './entity.js';
import { buildModel, animateModel, tintModel, disposeModel } from './models.js';
import { B, BLOCKS, IS_SOLID } from '../world/blocks.js';
import { DIM, DIFFICULTY, CHUNK_Y } from '../constants.js';
import { BIOME } from '../world/worldgen.js';
import { Arrow, Fireball, explode } from './projectiles.js';
import {
  foodFor, canBreed, TAMING, BABY_GROW_SECONDS, LOVE_SECONDS, BREED_COOLDOWN_SECONDS,
  WOOL_REGROW_SECONDS, mobRecord, validMobRecord, applyMobRecord, randomProfession, tradesFor,
} from './husbandry.js';

/** Blocks a mob can stand inside when the spawner looks for a free spot. */
export const SPAWN_PASSABLE = new Set([
  B.AIR, B.SNOW_LAYER, B.TALL_GRASS, B.FLOWER_RED, B.FLOWER_YELLOW,
]);

/** Surfaces a daylight-spawning animal will accept underfoot. */
export const DAY_SPAWN_GROUND = new Set([B.GRASS, B.SNOW_BLOCK, B.SAND]);

export const MOBS = {
  // --- passive -------------------------------------------------------------
  cow: {
    model: 'cow', hp: 10, category: 'passive', ai: 'wander', speed: 1.6, xp: [1, 3],
    drops: [{ key: 'leather', min: 0, max: 2 }, { key: 'raw_beef', min: 1, max: 3 }],
    sound: 'cow', spawn: { dims: [DIM.OVERWORLD], biomes: [BIOME.PLAINS, BIOME.FOREST, BIOME.SAVANNA], light: 'day', weight: 10 },
  },
  pig: {
    model: 'pig', hp: 10, category: 'passive', ai: 'wander', speed: 1.6, xp: [1, 3],
    drops: [{ key: 'raw_porkchop', min: 1, max: 3 }],
    sound: 'pig', spawn: { dims: [DIM.OVERWORLD], biomes: [BIOME.PLAINS, BIOME.FOREST, BIOME.SAVANNA], light: 'day', weight: 10 },
  },
  chicken: {
    model: 'chicken', hp: 4, category: 'passive', ai: 'wander', speed: 1.5, xp: [1, 3],
    drops: [{ key: 'feather', min: 0, max: 2 }, { key: 'raw_chicken', min: 1, max: 1 }],
    sound: 'chicken', slowFall: true,
    spawn: { dims: [DIM.OVERWORLD], biomes: [BIOME.PLAINS, BIOME.FOREST], light: 'day', weight: 8 },
  },
  sheep: {
    model: 'sheep', hp: 8, category: 'passive', ai: 'wander', speed: 1.6, xp: [1, 3],
    drops: [{ key: 'wool', min: 1, max: 1 }, { key: 'raw_mutton', min: 1, max: 2 }],
    sound: 'sheep', shearable: true,
    spawn: { dims: [DIM.OVERWORLD], biomes: [BIOME.PLAINS, BIOME.FOREST, BIOME.MOUNTAINS, BIOME.SNOWY], light: 'day', weight: 10 },
  },
  villager: {
    model: 'villager', hp: 20, category: 'passive', ai: 'wander', speed: 1.4, xp: [0, 0],
    drops: [], sound: 'villager', tradeable: true, persistent: true,
  },
  iron_golem: {
    // The village's bodyguard: slow, enormously tough, and it hits like a
    // truck. Neutral, so it only turns on you if you start something.
    model: 'iron_golem', hp: 100, category: 'passive', ai: 'wander', speed: 1.5, xp: [0, 0],
    neutral: true, damage: 11, aggro: 20, solo: true, persistent: true, knockbackResist: true,
    drops: [{ key: 'iron_ingot', min: 3, max: 5 }, { key: 'poppy', min: 0, max: 2 }],
    sound: 'stone',
  },

  wolf: {
    model: 'wolf', hp: 8, category: 'passive', ai: 'wander', speed: 2.4, xp: [1, 3],
    drops: [], sound: 'zombie', neutral: true, damage: 3,
    spawn: { dims: [DIM.OVERWORLD], biomes: [BIOME.FOREST, BIOME.SNOWY], light: 'day', weight: 5 },
  },
  polar_bear: {
    // Leave it alone and it leaves you alone; hit it and it hits back hard.
    model: 'polar_bear', hp: 30, category: 'passive', ai: 'wander', speed: 2.1, xp: [1, 3],
    neutral: true, damage: 6, aggro: 16, solo: true,
    drops: [{ key: 'raw_cod', min: 0, max: 2 }, { key: 'raw_salmon', min: 0, max: 1, chance: 0.5 }],
    sound: 'cow',
    spawn: { dims: [DIM.OVERWORLD], biomes: [BIOME.SNOWY], light: 'day', weight: 7 },
  },

  // --- aquatic -------------------------------------------------------------
  squid: {
    model: 'squid', hp: 10, category: 'passive', ai: 'swim', speed: 1.6, xp: [1, 3],
    drops: [{ key: 'ink_sac', min: 1, max: 3 }], sound: 'splash', aquatic: true,
    spawn: { dims: [DIM.OVERWORLD], water: true, weight: 10 },
  },
  cod: {
    model: 'cod', hp: 3, category: 'passive', ai: 'swim', speed: 2.0, xp: [1, 3],
    drops: [{ key: 'raw_cod', min: 1, max: 1 }], sound: 'splash', aquatic: true,
    spawn: { dims: [DIM.OVERWORLD], water: true, weight: 14 },
  },
  salmon: {
    model: 'salmon', hp: 3, category: 'passive', ai: 'swim', speed: 2.2, xp: [1, 3],
    drops: [{ key: 'raw_salmon', min: 1, max: 1 }], sound: 'splash', aquatic: true,
    spawn: { dims: [DIM.OVERWORLD], water: true, weight: 10 },
  },

  // --- flying --------------------------------------------------------------
  bee: {
    model: 'bee', hp: 10, category: 'passive', ai: 'hover', speed: 2.2, xp: [1, 3],
    damage: 2, neutral: true, fly: true, sound: 'chicken', solo: true,
    drops: [{ key: 'honeycomb', min: 0, max: 1, chance: 0.4 }],
    spawn: { dims: [DIM.OVERWORLD], biomes: [BIOME.PLAINS, BIOME.FOREST], light: 'day', weight: 8 },
  },
  bat: {
    model: 'bat', hp: 6, category: 'passive', ai: 'hover', speed: 2.8, xp: [0, 0],
    fly: true, sound: 'chicken', solo: true, drops: [],
    spawn: { dims: [DIM.OVERWORLD], light: 'dark', weight: 8, maxY: 50 },
  },

  // --- hostile -------------------------------------------------------------
  zombie: {
    model: 'zombie', hp: 20, category: 'hostile', ai: 'melee', speed: 2.3, damage: 3,
    aggro: 24, xp: [5, 5], burnsInDay: true, sound: 'zombie',
    drops: [{ key: 'rotten_flesh', min: 0, max: 2 }, { key: 'iron_ingot', min: 1, max: 1, chance: 0.025 }],
    spawn: { dims: [DIM.OVERWORLD], light: 'dark', weight: 18 },
  },
  skeleton: {
    model: 'skeleton', hp: 20, category: 'hostile', ai: 'ranged', speed: 2.3, damage: 2,
    aggro: 26, range: 14, xp: [5, 5], burnsInDay: true, sound: 'skeleton',
    drops: [{ key: 'bone', min: 0, max: 2 }, { key: 'arrow', min: 0, max: 2 }],
    spawn: { dims: [DIM.OVERWORLD], light: 'dark', weight: 16 },
  },
  creeper: {
    model: 'creeper', hp: 20, category: 'hostile', ai: 'creeper', speed: 2.1, damage: 0,
    aggro: 22, xp: [5, 5], sound: 'creeper_hiss',
    drops: [{ key: 'gunpowder', min: 0, max: 2 }],
    spawn: { dims: [DIM.OVERWORLD], light: 'dark', weight: 12 },
  },
  spider: {
    model: 'spider', hp: 16, category: 'hostile', ai: 'spider', speed: 2.9, damage: 2,
    aggro: 20, xp: [5, 5], sound: 'spider', climbs: true,
    drops: [{ key: 'string', min: 0, max: 2 }, { key: 'spider_eye', min: 0, max: 1, chance: 0.33 }],
    spawn: { dims: [DIM.OVERWORLD], light: 'dark', weight: 12 },
  },
  enderman: {
    model: 'enderman', hp: 40, category: 'hostile', ai: 'enderman', speed: 3.4, damage: 7,
    aggro: 34, xp: [5, 5], sound: 'enderman', neutral: true, solo: true,
    drops: [{ key: 'ender_pearl', min: 1, max: 1, chance: 0.85 }],
    // Deliberately rare in the Overworld (~3% of hostile spawns). In the End
    // they're the only candidate, so the weight there is irrelevant.
    spawn: { dims: [DIM.OVERWORLD, DIM.END], light: 'dark', weight: 2 },
  },

  // --- nether --------------------------------------------------------------
  blaze: {
    model: 'blaze', hp: 20, category: 'hostile', ai: 'blaze', speed: 3.0, damage: 5,
    aggro: 26, xp: [10, 10], sound: 'blaze', fly: true, fireproof: true, glows: true,
    drops: [{ key: 'blaze_rod', min: 1, max: 1, chance: 0.95 }],
    spawn: { dims: [DIM.NETHER], light: 'any', weight: 12, minY: 34 },
  },
  ghast: {
    model: 'ghast', hp: 10, category: 'hostile', ai: 'ghast', speed: 2.0, damage: 0,
    aggro: 52, xp: [5, 5], sound: 'ghast', fly: true, fireproof: true,
    drops: [{ key: 'gunpowder', min: 1, max: 2 }, { key: 'ghast_tear', min: 0, max: 1, chance: 0.5 }],
    spawn: { dims: [DIM.NETHER], light: 'any', weight: 5, minY: 40 },
  },
  pigman: {
    model: 'pigman', hp: 20, category: 'hostile', ai: 'melee', speed: 2.2, damage: 4,
    aggro: 20, xp: [5, 5], sound: 'pig', neutral: true, fireproof: true,
    drops: [{ key: 'gold_nugget', min: 0, max: 2 }, { key: 'gold_ingot', min: 1, max: 1, chance: 0.06 }],
    spawn: { dims: [DIM.NETHER], light: 'any', weight: 16 },
  },
  slime: {
    model: 'slime', hp: 16, category: 'hostile', ai: 'magma', speed: 2.2, damage: 2,
    aggro: 18, xp: [4, 4], sound: 'fireball',
    drops: [{ key: 'slimeball', min: 1, max: 2 }],
    spawn: { dims: [DIM.OVERWORLD], light: 'dark', weight: 6, maxY: 40 },
  },
  magma_cube: {
    model: 'magma_cube', hp: 16, category: 'hostile', ai: 'magma', speed: 2.4, damage: 4,
    aggro: 20, xp: [4, 4], sound: 'fireball', fireproof: true,
    drops: [{ key: 'magma_cream', min: 0, max: 1 }],
    spawn: { dims: [DIM.NETHER], light: 'any', weight: 8 },
  },
};

const rnd = (a, b) => a + Math.random() * (b - a);
const irnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

// Scratch vectors for the per-frame stare test — allocating three THREE.Vector3
// per enderman per frame is pure garbage-collector churn.
const _lookV = new THREE.Vector3();
const _toV = new THREE.Vector3();
const _eyeV = new THREE.Vector3();

export class Mob extends Entity {
  constructor(game, type, x, y, z, opts = {}) {
    super(game, x, y, z);
    const def = MOBS[type];
    this.kind = type;
    this.def = def;
    this.category = 'mob';
    this.hostile = def.category === 'hostile';
    this.maxHealth = def.hp;
    this.health = def.hp;
    this.speed = def.speed;
    this.persistent = opts.persistent || def.persistent || false;
    this.fromSpawner = opts.fromSpawner || false;
    this.size = opts.size ?? 1;

    this.model = buildModel(def.model);
    this.width = this.model.def.width * this.size;
    this.height = this.model.def.height * this.size;
    this.eyeHeight = (this.model.def.eye ?? this.model.def.height * 0.85) * this.size;
    if (this.size !== 1) this.model.group.scale.setScalar(this.size);
    this.object3d = this.model.group;
    game.renderer.scene.add(this.object3d);

    // Fliers and swimmers steer their own vertical motion.
    this.gravity = (def.fly || def.aquatic) ? 0 : 24;
    this.walkPhase = 0;
    this.walkAmount = 0;
    this.target = null;
    this.aggroTimer = 0;
    this.attackCooldown = 0;
    this.wanderTimer = 0;
    this.wanderDir = new THREE.Vector3();
    this.fleeTimer = 0;
    this.hurtFlash = 0;
    this.fireTicks = 0;
    this.idleSound = rnd(3, 12);
    this.fuse = 0;
    this.shootTimer = rnd(1, 3);
    this.jumpTimer = 0;
    this.teleportTimer = rnd(6, 16);
    this.teleportCooldown = 0;
    this.angry = !def.neutral;
    this.headYaw = 0;
    this.headPitch = 0;
    this.yaw = Math.random() * Math.PI * 2;
    this.despawnTimer = 0;

    // --- 3.1 husbandry state (see husbandry.js) ---
    this.baby = false;
    this.growTimer = 0;
    this.loveTimer = 0;
    this.breedCooldown = 0;
    this.tamed = false;
    this.sitting = false;
    this.sheared = false;
    this.woolTimer = 0;
    this.profession = def.tradeable ? (opts.profession || randomProfession()) : null;
    this._adultSize = this.size;
    if (opts.baby) this.setBaby(BABY_GROW_SECONDS);
  }

  onRemove() { disposeModel(this.model); }

  // -------------------------------------------------------------------------
  // Save / load
  // -------------------------------------------------------------------------
  serialize() { return mobRecord(this); }

  /** Rebuild a mob from a save record; returns null for anything malformed. */
  static fromRecord(game, r) {
    if (!validMobRecord(r)) return null;
    const m = new Mob(game, r.type, r.x, r.y, r.z, { size: r.size ?? 1, profession: r.prof });
    applyMobRecord(m, r);
    return m;
  }

  // -------------------------------------------------------------------------
  // Babies, breeding, taming, shearing
  // -------------------------------------------------------------------------
  applySize(size) {
    this.size = size;
    this.width = this.model.def.width * size;
    this.height = this.model.def.height * size;
    this.eyeHeight = (this.model.def.eye ?? this.model.def.height * 0.85) * size;
    this.model.group.scale.setScalar(size);
  }

  setBaby(seconds) {
    this.baby = true;
    this.growTimer = seconds;
    this.persistent = true;
    this.applySize(this._adultSize * 0.5);
  }

  growUp() {
    this.baby = false;
    this.growTimer = 0;
    this.applySize(this._adultSize);
  }

  get trades() { return this.def.tradeable ? tradesFor(this.profession) : []; }

  /**
   * Right-click with `held`. Returns a string naming what happened
   * ('fed' | 'tamed' | 'tame_failed' | 'sheared' | 'sit' | 'stand' | 'trade')
   * or null when the item does nothing here. Consuming the item is left to
   * the caller so creative mode can keep its stack.
   */
  interact(held) {
    const g = this.game;
    const key = held?.key || null;
    const pos = [this.pos.x, this.pos.y, this.pos.z];

    if (this.def.shearable && key === 'shears' && !this.baby && !this.sheared) {
      this.sheared = true;
      this.woolTimer = WOOL_REGROW_SECONDS;
      const n = irnd(1, 3);
      g.dropItem(this.pos.x, this.pos.y + 0.6, this.pos.z, { key: 'wool', count: n }, { vy: 0.15 });
      g.audio.play('shear', { pos, volume: 0.8 });
      return 'sheared';
    }

    const tame = TAMING[this.kind];
    if (tame && !this.tamed && key === tame.item) {
      if (Math.random() < tame.chance) {
        this.tamed = true;
        this.angry = false;
        this.aggroTimer = 0;
        this.fleeTimer = 0;
        this.persistent = true;
        this.maxHealth = Math.max(this.maxHealth, 20);
        this.health = this.maxHealth;
        g.particles.hearts?.(this.pos.x, this.pos.y + this.height, this.pos.z, 7);
        g.audio.play('pop', { pos, volume: 0.8 });
        return 'tamed';
      }
      g.particles.smoke(this.pos.x, this.pos.y + this.height, this.pos.z, 4, 0.5);
      return 'tame_failed';
    }

    const food = foodFor(this.kind, held);
    if (food && canBreed(this.kind) && (this.kind !== 'wolf' || this.tamed)) {
      if (this.baby) {
        // Food knocks 10% off a baby's remaining growth.
        this.growTimer = Math.max(0, this.growTimer - BABY_GROW_SECONDS * 0.1);
        g.particles.hearts?.(this.pos.x, this.pos.y + this.height, this.pos.z, 3);
        g.audio.play('eat', { pos, volume: 0.6 });
        return 'fed';
      }
      if (this.tamed && this.health < this.maxHealth) {
        this.health = Math.min(this.maxHealth, this.health + 4);
        g.particles.hearts?.(this.pos.x, this.pos.y + this.height, this.pos.z, 3);
        g.audio.play('eat', { pos, volume: 0.6 });
        return 'fed';
      }
      if (this.loveTimer <= 0 && this.breedCooldown <= 0) {
        this.loveTimer = LOVE_SECONDS;
        this.fleeTimer = 0;
        g.particles.hearts?.(this.pos.x, this.pos.y + this.height, this.pos.z, 6);
        g.audio.play('eat', { pos, volume: 0.6 });
        return 'fed';
      }
      return null;
    }

    if (this.tamed && !food && key !== tame?.item) {
      this.sitting = !this.sitting;
      this.vel.x = 0; this.vel.z = 0;
      return this.sitting ? 'sit' : 'stand';
    }

    if (this.def.tradeable) return 'trade';
    return null;
  }

  /** Called each frame: love mode, growth, wool, breeding with a partner. */
  tickHusbandry(dt) {
    const g = this.game;
    if (this.breedCooldown > 0) this.breedCooldown -= dt;
    if (this.baby) {
      this.growTimer -= dt;
      if (this.growTimer <= 0) this.growUp();
    }
    if (this.sheared) {
      this.woolTimer -= dt;
      if (this.woolTimer <= 0) { this.sheared = false; this.woolTimer = 0; }
    }
    if (this.loveTimer > 0) {
      this.loveTimer -= dt;
      this._heartTick = (this._heartTick || 0) + dt;
      if (this._heartTick > 0.6) {
        this._heartTick = 0;
        g.particles.hearts?.(this.pos.x, this.pos.y + this.height + 0.2, this.pos.z, 1);
      }
      // Find a partner of the same kind that is also in love.
      let partner = null, best = 8;
      g.entities.each((e) => {
        if (e === this || e.kind !== this.kind || !(e.loveTimer > 0) || e.baby) return;
        const d = e.pos.distanceTo(this.pos);
        if (d < best) { best = d; partner = e; }
      });
      if (partner) {
        if (best > 1.6) this.moveToward(partner.pos.x, partner.pos.z, dt, 0.8);
        else if (this.id < partner.id) this.breedWith(partner);
      }
    }
  }

  breedWith(partner) {
    const g = this.game;
    this.loveTimer = 0; partner.loveTimer = 0;
    this.breedCooldown = BREED_COOLDOWN_SECONDS; partner.breedCooldown = BREED_COOLDOWN_SECONDS;
    const x = (this.pos.x + partner.pos.x) / 2, z = (this.pos.z + partner.pos.z) / 2;
    const baby = new Mob(g, this.kind, x, Math.max(this.pos.y, partner.pos.y) + 0.1, z, { baby: true, persistent: true });
    if (this.tamed) { baby.tamed = true; baby.angry = false; }
    g.entities.add(baby);
    g.particles.hearts?.(x, this.pos.y + this.height + 0.3, z, 8);
    g.spawnXp(x, this.pos.y + 0.5, z, irnd(1, 7));
    g.onMobBred?.(this, partner, baby);
    return baby;
  }

  /** Tamed wolves keep to heel and guard; returns true when it drove the AI. */
  aiTamed(dt) {
    const g = this.game, p = g.player;
    if (this.sitting) {
      this.vel.x *= Math.max(0, 1 - dt * 10); this.vel.z *= Math.max(0, 1 - dt * 10);
      this.walkAmount = 0;
      return true;
    }
    // Guard: attack hostile mobs near the owner.
    let target = null, best = 10;
    g.entities.each((e) => {
      if (e === this || e.category !== 'mob' || !e.hostile || e.dead) return;
      const d = e.pos.distanceTo(p.pos);
      if (d < best) { best = d; target = e; }
    });
    if (target) {
      const d = target.pos.distanceTo(this.pos);
      if (d > 1.6) this.moveToward(target.pos.x, target.pos.z, dt, 1.2);
      else if (this.attackCooldown <= 0) {
        this.attackCooldown = 0.9;
        target.damage(this.def.damage || 3, this);
        target.knockback?.(this.pos.x, this.pos.z, 0.6);
      }
      return true;
    }
    const dist = this.pos.distanceTo(p.pos);
    if (dist > 20) {
      // Teleport to the owner like a Minecraft pet that fell behind.
      this.pos.set(p.pos.x + rnd(-1.5, 1.5), p.pos.y + 0.2, p.pos.z + rnd(-1.5, 1.5));
      this.vel.set(0, 0, 0);
    } else if (dist > 3) this.moveToward(p.pos.x, p.pos.z, dt, dist > 8 ? 1.3 : 0.9);
    else {
      this.vel.x *= Math.max(0, 1 - dt * 6); this.vel.z *= Math.max(0, 1 - dt * 6);
      this.walkAmount = 0;
      this.faceTowards(p.pos.x, p.pos.z, dt);
    }
    return true;
  }

  // -------------------------------------------------------------------------
  hurtByProjectile(damage, source) { this.damage(damage, source); }

  damage(amount, source) {
    if (this.dead || amount <= 0) return;
    this.health -= amount;
    this.hurtFlash = 0.35;
    this.game.audio.play(this.def.sound, {
      pos: [this.pos.x, this.pos.y, this.pos.z], rate: 1.25, volume: 0.6, throttle: 0.08,
    });
    // The red model flash is the damage feedback; a puff of particles on every
    // single hit just buries the screen.
    if (this.def.neutral && source !== 'water' && !this.tamed) { this.angry = true; this.aggroTimer = 25; }
    if (this.tamed && source === 'player') this.sitting = false;
    // Neutrals square up instead of bolting.
    if (this.def.category === 'passive' && !this.def.neutral) this.fleeTimer = 5;
    if (this.def.ai === 'enderman' && source !== 'water' && Math.random() < 0.5) this.teleportRandom();
    if (this.health <= 0) this.die(source);
  }

  knockback(fromX, fromZ, power = 1) {
    if (this.def.knockbackResist) power *= 0.15;    // you don't shove a golem
    const dx = this.pos.x - fromX, dz = this.pos.z - fromZ;
    const l = Math.hypot(dx, dz) || 1;
    this.vel.x += (dx / l) * 6 * power;
    this.vel.z += (dz / l) * 6 * power;
    if (!this.def.fly) this.vel.y = Math.max(this.vel.y, 4.4 * power);
  }

  die(source) {
    if (this.dead) return;
    const g = this.game;
    g.audio.play(this.def.sound, { pos: [this.pos.x, this.pos.y, this.pos.z], rate: 0.8, volume: 0.7 });
    g.particles.smoke(this.pos.x, this.pos.y + this.height / 2, this.pos.z, 10, 0.45);

    for (const d of (this.baby ? [] : this.def.drops) || []) {
      if (d.chance !== undefined && Math.random() > d.chance) continue;
      const n = d.min === d.max ? d.min : irnd(d.min, d.max);
      if (n > 0) g.dropItem(this.pos.x, this.pos.y + 0.4, this.pos.z, { key: d.key, count: n });
    }
    const xp = this.def.xp ? irnd(this.def.xp[0], this.def.xp[1]) : 0;
    if (xp > 0) g.spawnXp(this.pos.x, this.pos.y + 0.4, this.pos.z, xp);

    if (this.def.ai === 'magma' && this.size > 0.55) {
      for (let i = 0; i < 2; i++) {
        const m = new Mob(g, 'magma_cube', this.pos.x + rnd(-0.6, 0.6), this.pos.y, this.pos.z + rnd(-0.6, 0.6),
          { size: this.size * 0.55 });
        m.maxHealth = Math.max(4, this.maxHealth / 2);
        m.health = m.maxHealth;
        g.entities.add(m);
      }
    }
    g.onMobKilled?.(this, source);
    this.remove();
  }

  canSeePlayer() {
    const p = this.game.player;
    const from = new THREE.Vector3(this.pos.x, this.pos.y + this.height * 0.85, this.pos.z);
    const to = new THREE.Vector3(p.pos.x, p.pos.y + 1.5, p.pos.z);
    const dir = to.clone().sub(from);
    const dist = dir.length();
    if (dist < 0.001) return true;
    dir.divideScalar(dist);
    const hit = this.game.world.raycast(from.x, from.y, from.z, dir.x, dir.y, dir.z, dist,
      (b) => IS_SOLID[b] === 1 && BLOCKS[b].opaque);
    return !hit;
  }

  faceTowards(x, z, dt, rate = 8) {
    const want = Math.atan2(-(x - this.pos.x), -(z - this.pos.z));
    let d = want - this.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.yaw += d * Math.min(1, dt * rate);
  }

  moveToward(x, z, dt, speedMul = 1) {
    const dx = x - this.pos.x, dz = z - this.pos.z;
    const l = Math.hypot(dx, dz);
    if (l < 0.05) return;
    const s = this.speed * speedMul;
    const tx = (dx / l) * s, tz = (dz / l) * s;
    const a = this.onGround ? 12 : 4;
    this.vel.x += (tx - this.vel.x) * Math.min(1, dt * a);
    this.vel.z += (tz - this.vel.z) * Math.min(1, dt * a);
    this.faceTowards(x, z, dt);
    this.walkAmount = Math.min(1, Math.hypot(this.vel.x, this.vel.z) / Math.max(0.1, this.speed));
  }

  tryJump(res, dt) {
    if (this.def.fly) return;
    this.jumpTimer -= dt;
    if ((res.wallX || res.wallZ) && this.onGround && this.jumpTimer <= 0) {
      if (this.def.climbs) this.vel.y = 4.5;
      else this.vel.y = 8.0;
      this.jumpTimer = 0.35;
    }
  }

  // -------------------------------------------------------------------------
  update(dt) {
    const g = this.game;
    const p = g.player;
    this.age += dt;
    if (this.hurtFlash > 0) this.hurtFlash = Math.max(0, this.hurtFlash - dt);
    if (this.attackCooldown > 0) this.attackCooldown -= dt;
    if (this.aggroTimer > 0) this.aggroTimer -= dt;
    if (this.teleportCooldown > 0) this.teleportCooldown -= dt;

    const dist = this.pos.distanceTo(p.pos);

    // despawn far away
    if (!this.persistent) {
      if (dist > 88) { this.remove(); return; }
      if (dist > 46) {
        this.despawnTimer += dt;
        if (this.despawnTimer > 18 && Math.random() < dt) { this.remove(); return; }
      } else this.despawnTimer = 0;
    }
    if (!g.world.isLoaded(Math.floor(this.pos.x), Math.floor(this.pos.z))) return;

    // idle sounds
    this.idleSound -= dt;
    if (this.idleSound <= 0) {
      this.idleSound = rnd(6, 18);
      if (dist < 34) g.audio.play(this.def.sound, { pos: [this.pos.x, this.pos.y, this.pos.z], volume: 0.42 });
    }

    // burning in daylight
    if (this.def.burnsInDay && g.world.dim === DIM.OVERWORLD) {
      const sky = g.world.skyLight(Math.floor(this.pos.x), Math.floor(this.pos.y + this.height), Math.floor(this.pos.z));
      if (sky >= 14 && g.sky.sunLight > 0.72 && !this.inLiquid(B.WATER) && g.weather.intensity < 0.4) {
        this.fireTicks = Math.max(this.fireTicks, 1.2);
      }
    }
    if (this.fireTicks > 0 && !this.def.fireproof) {
      this.fireTicks -= dt;
      this._burnTick = (this._burnTick || 0) + dt;
      g.particles.flame(this.pos.x, this.pos.y + this.height * 0.4, this.pos.z, 1);
      if (this._burnTick > 0.6) { this._burnTick = 0; this.damage(1); if (this.dead) return; }
    }
    // lava / drowning safety
    if (this.inLiquid(B.LAVA) && !this.def.fireproof) { this.damage(4 * dt * 2); if (this.dead) return; }
    if (this.def.ai === 'enderman') {
      const wet = this.inLiquid(B.WATER) || (g.weather.intensity > 0.5 && g.world.skyLight(
        Math.floor(this.pos.x), Math.floor(this.pos.y + 2), Math.floor(this.pos.z)) > 12);
      if (wet) {
        // Hurt slowly and blink away at most once every few seconds. Damaging
        // and teleporting twice a second made rain turn them into strobe lights.
        this._wet = (this._wet || 0) + dt;
        if (this._wet > 1.2) {
          this._wet = 0;
          this.teleportRandom();
          this.damage(1, 'water');
          if (this.dead) return;
        }
      } else this._wet = 0;
    }

    // --- behaviour ---
    // `combatAllowed` is everything except "is this mob currently angry", which
    // neutral mobs (endermen, piglins) decide for themselves.
    const combatAllowed = !p.dead && p.gamemode !== 1 &&
      g.player.difficulty !== DIFFICULTY.PEACEFUL;
    const canAggro = this.hostile && this.angry && combatAllowed;
    this.tickHusbandry(dt);
    if (this.dead) return;
    if (this.tamed && this.aiTamed(dt)) { /* pet behaviour replaces wandering */ }
    else switch (this.def.ai) {
      case 'wander': this.aiWander(dt, dist, combatAllowed); break;
      case 'melee': this.aiMelee(dt, dist, canAggro); break;
      case 'ranged': this.aiRanged(dt, dist, canAggro); break;
      case 'creeper': this.aiCreeper(dt, dist, canAggro); break;
      case 'spider': this.aiMelee(dt, dist, canAggro && (g.sky.sunLight < 0.6 || this.aggroTimer > 0)); break;
      case 'enderman': this.aiEnderman(dt, dist, combatAllowed); break;
      case 'blaze': this.aiFlyingShooter(dt, dist, canAggro, 'blaze'); break;
      case 'ghast': this.aiFlyingShooter(dt, dist, canAggro, 'ghast'); break;
      case 'magma': this.aiMagma(dt, dist, canAggro); break;
      case 'swim': this.aiSwim(dt, dist); break;
      case 'hover': this.aiHover(dt, dist, combatAllowed); break;
      default: this.aiWander(dt, dist);
    }
    // A creeper that just detonated (or any AI that killed itself) has already
    // released its model — stop before touching object3d.
    if (this.dead) return;

    // --- physics ---
    let res;
    if (this.def.fly) {
      this.pos.addScaledVector(this.vel, dt);
      res = { wallX: false, wallZ: false, ground: false };
      // gentle collision so they don't sink into terrain
      if (IS_SOLID[g.world.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y), Math.floor(this.pos.z))]) {
        this.pos.y += 2 * dt * 6;
        this.vel.y = Math.max(this.vel.y, 1);
      }
    } else {
      if (this.def.slowFall && this.vel.y < -2.4) this.vel.y = -2.4;
      res = this.physics(dt, { step: 0.65 });
      this.tryJump(res, dt);
    }

    // --- visuals ---
    this.walkPhase += Math.hypot(this.vel.x, this.vel.z) * dt * 3.4;
    this.walkAmount += ((Math.hypot(this.vel.x, this.vel.z) > 0.4 ? 0.85 : 0) - this.walkAmount) * Math.min(1, dt * 8);
    const o = this.object3d;
    o.position.set(this.pos.x, this.pos.y, this.pos.z);
    o.rotation.y = this.yaw + Math.PI;
    if (this.def.fly) o.position.y += Math.sin(this.age * 1.6) * 0.12;

    const targetPos = this.targetPos();
    if (targetPos) {
      const dx = targetPos.x - this.pos.x, dz = targetPos.z - this.pos.z;
      const want = Math.atan2(-dx, -dz);
      let d = want - this.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.headYaw = Math.max(-1.1, Math.min(1.1, d));
      this.headPitch = Math.max(-0.7, Math.min(0.7, -Math.atan2(targetPos.y - (this.pos.y + this.height * 0.85),
        Math.hypot(dx, dz))));
    } else {
      this.headYaw *= 0.9; this.headPitch *= 0.9;
    }
    animateModel(this.model, this.age, this.walkAmount, this.walkPhase, this.headYaw, this.headPitch);

    let l = this.def.glows ? 1 : this.lightAt();
    if (this.fuse > 0) l = 1 + Math.sin(this.fuse * 40) * 0.9;
    if (this.hurtFlash > 0) tintModel(this.model, Math.min(1.8, l + 1.1), l * 0.35, l * 0.35);
    else if (this.fuse > 0) tintModel(this.model, l, l * 1.1, l);
    else if (this.sheared) tintModel(this.model, l * 0.92, l * 0.78, l * 0.7);
    else if (this.loveTimer > 0) tintModel(this.model, l * 1.05, l * 0.9, l * 0.95);
    else tintModel(this.model, l, l, l);
  }

  targetPos() {
    const p = this.game.player;
    if (this.hostile && this.angry && this.pos.distanceTo(p.pos) < (this.def.aggro || 20)) {
      return new THREE.Vector3(p.pos.x, p.pos.y + 1.5, p.pos.z);
    }
    return null;
  }

  // --- behaviours ---------------------------------------------------------
  aiWander(dt, dist, combatAllowed = false) {
    const p = this.game.player;
    // A provoked neutral animal — a wolf, a polar bear — stops grazing and
    // fights back. Without this its `neutral`/`damage` config did nothing and
    // it simply fled like any other passive mob.
    if (this.def.neutral && this.angry) {
      if (this.aggroTimer <= 0) this.angry = false;
      else if (this.chasePlayer(dt, dist, combatAllowed)) { this.fleeTimer = 0; return; }
    }
    if (this.fleeTimer > 0) {
      this.fleeTimer -= dt;
      this.moveToward(this.pos.x * 2 - p.pos.x, this.pos.z * 2 - p.pos.z, dt, 1.5);
      return;
    }
    this.wanderTimer -= dt;
    if (this.wanderTimer <= 0) {
      this.wanderTimer = rnd(2.5, 7);
      if (Math.random() < 0.4) { this.wanderDir.set(0, 0, 0); }
      else {
        const a = Math.random() * Math.PI * 2;
        this.wanderDir.set(Math.cos(a) * 8, 0, Math.sin(a) * 8);
      }
    }
    if (this.wanderDir.lengthSq() > 0.01) {
      this.moveToward(this.pos.x + this.wanderDir.x, this.pos.z + this.wanderDir.z, dt, 0.55);
    } else {
      this.vel.x *= Math.max(0, 1 - dt * 6);
      this.vel.z *= Math.max(0, 1 - dt * 6);
      this.walkAmount = 0;
    }
    void dist;
  }

  /**
   * Close on the player and swing when in range. Returns false when there's
   * nothing to chase, leaving the caller to decide what to do instead — this
   * has to stay fallback-free, because both aiMelee and aiWander call it and
   * having either delegate to the other sent them into infinite recursion.
   */
  chasePlayer(dt, dist, canAggro) {
    const p = this.game.player;
    if (!canAggro || dist >= (this.def.aggro || 20)) return false;
    if (dist >= 4 && !this.canSeePlayer()) return false;
    this.moveToward(p.pos.x, p.pos.z, dt, dist > 3 ? 1 : 0.7);
    if (dist < 1.9 && this.attackCooldown <= 0) {
      this.attackCooldown = 1.0;
      const dmg = (this.def.damage || 2) * p.damageMultiplier;
      if (p.hurt(dmg, `was slain by a ${this.kind.replace('_', ' ')}`, this.game, false, this.pos)) {
        const dx = p.pos.x - this.pos.x, dz = p.pos.z - this.pos.z;
        const l = Math.hypot(dx, dz) || 1;
        p.vel.x += (dx / l) * 5; p.vel.z += (dz / l) * 5; p.vel.y = Math.max(p.vel.y, 3.5);
      }
    }
    return true;
  }

  aiMelee(dt, dist, canAggro) {
    if (!this.chasePlayer(dt, dist, canAggro)) this.aiWander(dt, dist);
  }

  aiRanged(dt, dist, canAggro) {
    const p = this.game.player;
    if (canAggro && dist < (this.def.aggro || 24) && this.canSeePlayer()) {
      if (dist > 9) this.moveToward(p.pos.x, p.pos.z, dt, 1);
      else if (dist < 5) this.moveToward(this.pos.x * 2 - p.pos.x, this.pos.z * 2 - p.pos.z, dt, 0.8);
      else {
        // strafe
        const a = Math.atan2(p.pos.z - this.pos.z, p.pos.x - this.pos.x) + Math.PI / 2;
        this.moveToward(this.pos.x + Math.cos(a) * 4, this.pos.z + Math.sin(a) * 4, dt, 0.6);
        this.faceTowards(p.pos.x, p.pos.z, dt, 10);
      }
      this.shootTimer -= dt;
      if (this.shootTimer <= 0 && dist < 18) {
        this.shootTimer = rnd(1.5, 2.6);
        const from = new THREE.Vector3(this.pos.x, this.pos.y + this.height * 0.8, this.pos.z);
        const to = new THREE.Vector3(p.pos.x, p.pos.y + 1.1 + dist * 0.05, p.pos.z);
        const dir = to.sub(from).normalize();
        this.game.entities.add(new Arrow(this.game, from.x, from.y, from.z, dir, 0.25, this));
        this.game.audio.play('bow', { pos: [from.x, from.y, from.z], volume: 0.6 });
      }
    } else this.aiWander(dt, dist);
  }

  aiCreeper(dt, dist, canAggro) {
    const p = this.game.player;
    if (this.fuse > 0) {
      this.fuse -= dt;
      this.vel.x *= 0.85; this.vel.z *= 0.85;
      this.object3d.scale.setScalar(this.size * (1 + Math.sin(this.fuse * 30) * 0.08 + (1.5 - this.fuse) * 0.12));
      if (dist > 7) { this.fuse = 0; this.object3d.scale.setScalar(this.size); return; }
      if (this.fuse <= 0) {
        explode(this.game, this.pos.x, this.pos.y + 0.6, this.pos.z, 3.2, true);
        this.remove();
      }
      return;
    }
    if (canAggro && dist < (this.def.aggro || 20) && (dist < 4 || this.canSeePlayer())) {
      this.moveToward(p.pos.x, p.pos.z, dt, 1);
      if (dist < 3.2) {
        this.fuse = 1.5;
        this.game.audio.play('creeper_hiss', { pos: [this.pos.x, this.pos.y, this.pos.z], volume: 1 });
      }
    } else this.aiWander(dt, dist);
  }

  aiEnderman(dt, dist, combatAllowed) {
    const p = this.game.player;

    // Aggro only on a deliberate stare. Minecraft scales the required precision
    // with distance so the enderman's head stays a constant angular target —
    // a fixed cone made them notice you from across the map.
    if (!this.angry && combatAllowed && dist < 48 && dist > 0.5) {
      // Measured eye-to-eye, exactly as Minecraft does it: an enderman stands
      // ~2.9 blocks tall, so you genuinely have to look UP at its face.
      const look = p.lookDir(_lookV);
      const to = _toV.set(this.pos.x, this.pos.y + this.eyeHeight, this.pos.z)
        .sub(_eyeV.set(p.pos.x, p.pos.y + p.eyeY, p.pos.z)).normalize();
      if (look.dot(to) > 1 - 0.025 / dist && this.canSeePlayer()) {
        this.angry = true;
        this.aggroTimer = 20;
        this.game.audio.play('enderman', { pos: [this.pos.x, this.pos.y, this.pos.z], rate: 0.8 });
      }
    }
    if (this.angry && this.aggroTimer <= 0 && this.def.neutral) this.angry = false;

    if (this.angry && combatAllowed && !p.dead) {
      if (dist > 16) {
        this.teleportTimer -= dt;
        if (this.teleportTimer <= 0) {
          this.teleportTimer = rnd(2.5, 4.5);
          this.teleportNear(p.pos);
        }
      }
      this.moveToward(p.pos.x, p.pos.z, dt, 1);
      if (dist < 2.4 && this.attackCooldown <= 0) {
        this.attackCooldown = 1.0;
        p.hurt((this.def.damage || 7) * p.damageMultiplier, 'was slain by an enderman', this.game, false, this.pos);
      }
    } else {
      this.aiWander(dt, dist);
      this.teleportTimer -= dt;
      if (this.teleportTimer <= 0) { this.teleportTimer = rnd(12, 28); this.teleportRandom(); }
    }
  }

  teleportRandom() {
    const r = 12;
    return this.teleportTo(this.pos.x + rnd(-r, r), this.pos.z + rnd(-r, r));
  }

  teleportNear(target) {
    return this.teleportTo(target.x + rnd(-6, 6), target.z + rnd(-6, 6));
  }

  /** All teleports share one cooldown so nothing can chain-blink. */
  teleportTo(x, z) {
    if (this.teleportCooldown > 0) return false;
    const w = this.game.world;
    for (let y = Math.floor(this.pos.y) + 8; y > Math.floor(this.pos.y) - 12; y--) {
      if (y < 1 || y > CHUNK_Y - 3) continue;
      if (!IS_SOLID[w.getBlock(Math.floor(x), y - 1, Math.floor(z))]) continue;
      if (IS_SOLID[w.getBlock(Math.floor(x), y, Math.floor(z))]) continue;
      if (IS_SOLID[w.getBlock(Math.floor(x), y + 1, Math.floor(z))]) continue;
      this.game.particles.enderPop(this.pos.x, this.pos.y + 1, this.pos.z, 10);
      this.pos.set(x, y, z);
      this.vel.set(0, 0, 0);
      this.game.particles.enderPop(x, y + 1, z, 10);
      this.game.audio.play('teleport', { pos: [x, y, z], volume: 0.6 });
      this.teleportCooldown = 1.5;
      return true;
    }
    return false;
  }

  aiFlyingShooter(dt, dist, canAggro, style) {
    const p = this.game.player;
    const hoverH = style === 'ghast' ? 9 : 3.2;
    if (canAggro && dist < (this.def.aggro || 30)) {
      const want = new THREE.Vector3(p.pos.x, p.pos.y + hoverH, p.pos.z);
      const keep = style === 'ghast' ? 16 : 7;
      const dir = want.clone().sub(this.pos);
      const d = dir.length();
      dir.normalize();
      const mul = d > keep ? 1 : -0.5;
      this.vel.addScaledVector(dir, this.speed * mul * dt * 4);
      this.vel.multiplyScalar(Math.max(0, 1 - dt * 1.4));
      this.vel.clampLength(0, this.speed);
      this.faceTowards(p.pos.x, p.pos.z, dt, 4);

      this.shootTimer -= dt;
      if (this.shootTimer <= 0 && this.canSeePlayer()) {
        if (style === 'ghast') {
          this.shootTimer = rnd(3.5, 6);
          const from = new THREE.Vector3(this.pos.x, this.pos.y + 1.4, this.pos.z);
          const dirF = new THREE.Vector3(p.pos.x, p.pos.y + 1, p.pos.z).sub(from).normalize();
          this.game.entities.add(new Fireball(this.game, from.x, from.y, from.z, dirF,
            { explosive: true, speed: 11, damage: 6, owner: this }));
          this.game.audio.play('ghast', { pos: [from.x, from.y, from.z], volume: 0.9 });
        } else {
          this.shootTimer = rnd(3, 5);
          this._burst = 3;
          this._burstTimer = 0;
        }
      }
      if (this._burst > 0) {
        this._burstTimer -= dt;
        if (this._burstTimer <= 0) {
          this._burstTimer = 0.22;
          this._burst--;
          const from = new THREE.Vector3(this.pos.x, this.pos.y + 1.1, this.pos.z);
          const dirF = new THREE.Vector3(p.pos.x, p.pos.y + 1, p.pos.z).sub(from).normalize();
          this.game.entities.add(new Fireball(this.game, from.x, from.y, from.z, dirF,
            { speed: 16, damage: 5, owner: this }));
          this.game.audio.play('fireball', { pos: [from.x, from.y, from.z], volume: 0.6 });
        }
      }
      this.game.particles.flame(this.pos.x, this.pos.y + this.height * 0.5, this.pos.z, style === 'blaze' ? 2 : 0);
    } else {
      // idle drift
      this.wanderTimer -= dt;
      if (this.wanderTimer <= 0) {
        this.wanderTimer = rnd(3, 7);
        const a = Math.random() * Math.PI * 2;
        this.wanderDir.set(Math.cos(a), rnd(-0.3, 0.4), Math.sin(a));
      }
      this.vel.addScaledVector(this.wanderDir, this.speed * dt * 1.2);
      this.vel.multiplyScalar(Math.max(0, 1 - dt * 1.2));
      this.vel.clampLength(0, this.speed * 0.6);
    }
    // don't sink into the lava sea
    if (this.pos.y < 34) this.vel.y = Math.max(this.vel.y, 1.5);
  }

  /** Fish and squid: drift through water, turn back at the surface or seabed. */
  aiSwim(dt, dist) {
    const w = this.game.world;
    const bx = Math.floor(this.pos.x), by = Math.floor(this.pos.y), bz = Math.floor(this.pos.z);
    const inWater = isWater(w.getBlock(bx, by, bz));
    if (!inWater) {
      // Beached: flop about and suffocate, as fish out of water do.
      this.vel.y -= 18 * dt;
      this.vel.x *= 0.8; this.vel.z *= 0.8;
      if (this.onGround && Math.random() < dt * 4) this.vel.y = 3.5;
      this._drown = (this._drown || 0) + dt;
      if (this._drown > 1.2) { this._drown = 0; this.damage(1); }
      return;
    }
    this._drown = 0;

    this.wanderTimer -= dt;
    if (this.wanderTimer <= 0) {
      this.wanderTimer = rnd(2, 5);
      const a = Math.random() * Math.PI * 2;
      this.wanderDir.set(Math.cos(a), rnd(-0.35, 0.35), Math.sin(a)).normalize();
    }
    // steer away from air above and solid below
    if (!isWater(w.getBlock(bx, by + 1, bz))) this.wanderDir.y = Math.min(this.wanderDir.y, -0.15);
    if (!isWater(w.getBlock(bx, by - 1, bz))) this.wanderDir.y = Math.max(this.wanderDir.y, 0.15);
    // ...and turn back at the water's edge. Without this a fish would swim
    // straight through the side of a pond and beach itself.
    const sx = this.wanderDir.x > 0.1 ? 1 : this.wanderDir.x < -0.1 ? -1 : 0;
    const sz = this.wanderDir.z > 0.1 ? 1 : this.wanderDir.z < -0.1 ? -1 : 0;
    if (sx && !isWater(w.getBlock(bx + sx, by, bz))) this.wanderDir.x = -this.wanderDir.x;
    if (sz && !isWater(w.getBlock(bx, by, bz + sz))) this.wanderDir.z = -this.wanderDir.z;

    this.vel.lerp(this.wanderDir.clone().multiplyScalar(this.speed), Math.min(1, dt * 2.5));
    this.faceTowards(this.pos.x + this.vel.x, this.pos.z + this.vel.z, dt, 3);
    this.walkAmount = 1;
    void dist;
  }

  /** Bees and bats: bob around a wander point, never touching the ground. */
  aiHover(dt, dist, combatAllowed) {
    const p = this.game.player;
    if (this.angry && this.def.neutral && combatAllowed && dist < 16) {
      this.vel.lerp(
        _toV.set(p.pos.x - this.pos.x, p.pos.y + 1 - this.pos.y, p.pos.z - this.pos.z)
          .normalize().multiplyScalar(this.speed * 1.4), Math.min(1, dt * 3));
      this.faceTowards(p.pos.x, p.pos.z, dt, 6);
      if (dist < 1.5 && this.attackCooldown <= 0) {
        this.attackCooldown = 1.4;
        p.hurt((this.def.damage || 2) * p.damageMultiplier, 'was stung', this.game, false, this.pos);
      }
    } else {
      this.wanderTimer -= dt;
      if (this.wanderTimer <= 0) {
        this.wanderTimer = rnd(1.5, 4);
        const a = Math.random() * Math.PI * 2;
        this.wanderDir.set(Math.cos(a), rnd(-0.2, 0.5), Math.sin(a));
      }
      this.vel.addScaledVector(this.wanderDir, this.speed * dt * 2);
      this.vel.multiplyScalar(Math.max(0, 1 - dt * 1.8));
      this.vel.clampLength(0, this.speed);
      this.faceTowards(this.pos.x + this.vel.x, this.pos.z + this.vel.z, dt, 4);
    }
    // keep a little air under them
    const w = this.game.world;
    const below = w.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y - 1), Math.floor(this.pos.z));
    if (IS_SOLID[below]) this.vel.y = Math.max(this.vel.y, 1.2);
    this.walkAmount = 1;
  }

  aiMagma(dt, dist, canAggro) {
    const p = this.game.player;
    this.jumpTimer -= dt;
    if (canAggro && dist < (this.def.aggro || 20)) {
      this.faceTowards(p.pos.x, p.pos.z, dt, 5);
      if (this.onGround && this.jumpTimer <= 0) {
        this.jumpTimer = rnd(0.7, 1.3);
        const dx = p.pos.x - this.pos.x, dz = p.pos.z - this.pos.z;
        const l = Math.hypot(dx, dz) || 1;
        this.vel.x = (dx / l) * this.speed * 1.6;
        this.vel.z = (dz / l) * this.speed * 1.6;
        this.vel.y = 8;
      }
      if (dist < 1.6 && this.attackCooldown <= 0) {
        this.attackCooldown = 0.9;
        p.hurt((this.def.damage || 4) * this.size * p.damageMultiplier, 'was slain by a magma cube', this.game, false, this.pos);
      }
    } else if (this.onGround && this.jumpTimer <= 0) {
      this.jumpTimer = rnd(1.6, 3.4);
      const a = Math.random() * Math.PI * 2;
      this.vel.x = Math.cos(a) * this.speed;
      this.vel.z = Math.sin(a) * this.speed;
      this.vel.y = 6;
    }
  }
}

// ===========================================================================
// Spawning
// ===========================================================================

const HOSTILE_CAP = 26;
const PASSIVE_CAP = 14;

export class MobSpawner {
  constructor(game) {
    this.game = game;
    this.timer = 0;
    this.passiveTimer = 0;
  }

  update(dt) {
    const g = this.game;
    if (g.player.dead) return;
    this.timer -= dt;
    this.passiveTimer -= dt;
    if (this.timer <= 0) { this.timer = 1.4; this.trySpawn('hostile'); }
    if (this.passiveTimer <= 0) { this.passiveTimer = 9; this.trySpawn('passive'); }
    this.tickSpawners(dt);
  }

  candidates(category) {
    const dim = this.game.world.dim;
    const out = [];
    for (const [key, def] of Object.entries(MOBS)) {
      if (def.category !== category || !def.spawn) continue;
      if (!def.spawn.dims.includes(dim)) continue;
      out.push([key, def]);
    }
    return out;
  }

  /**
   * Which of `list` may spawn in the situation described by `ctx`, as a
   * weighted bag of keys. Split out from trySpawn so the rules can be checked
   * against a synthetic location instead of having to find one in a real world.
   */
  spawnPool(list, ctx) {
    const pool = [];
    for (const [key, def] of list) {
      const sp = def.spawn;
      if (sp.water) {
        if (!ctx.hasWater) continue;                  // no submerged spot here
      } else {
        if (!ctx.hasLand) continue;
        if (sp.light === 'dark' && ctx.lightLevel > 6.5) continue;
        if (sp.light === 'day' && (ctx.sky < 8 || !DAY_SPAWN_GROUND.has(ctx.ground))) continue;
      }
      if (sp.biomes && !sp.biomes.includes(ctx.biome)) continue;
      if (sp.minY && ctx.y < sp.minY) continue;
      if (sp.maxY && ctx.y > sp.maxY) continue;
      for (let w = 0; w < (sp.weight || 5); w++) pool.push(key);
    }
    return pool;
  }

  trySpawn(category) {
    const g = this.game;
    if (category === 'hostile' && g.player.difficulty === DIFFICULTY.PEACEFUL) return;
    const cap = category === 'hostile' ? HOSTILE_CAP : PASSIVE_CAP;
    let n = 0;
    g.entities.each((e) => { if (e.category === 'mob' && e.def.category === category) n++; });
    if (n >= cap) return;

    const list = this.candidates(category);
    if (!list.length) return;

    for (let attempt = 0; attempt < 12; attempt++) {
      const ang = Math.random() * Math.PI * 2;
      const r = 24 + Math.random() * 30;
      const x = Math.floor(g.player.pos.x + Math.cos(ang) * r);
      const z = Math.floor(g.player.pos.z + Math.sin(ang) * r);
      if (!g.world.isLoaded(x, z)) continue;

      const yBase = Math.floor(g.player.pos.y);
      // Land spots need solid footing and headroom; water spots need to be
      // properly submerged so fish don't appear in a puddle.
      const spots = [], waterSpots = [];
      for (let y = Math.max(2, yBase - 22); y < Math.min(CHUNK_Y - 3, yBase + 18); y++) {
        const here = g.world.getBlock(x, y, z);
        if (isWater(here) && isWater(g.world.getBlock(x, y + 1, z)) &&
            isWater(g.world.getBlock(x, y - 1, z))) {
          waterSpots.push(y);
          continue;
        }
        if (!IS_SOLID[g.world.getBlock(x, y - 1, z)]) continue;
        // A snow blanket sits in the block an animal would stand in, so
        // treating it as occupied made every snowy biome unspawnable.
        if (!SPAWN_PASSABLE.has(here)) continue;
        if (!SPAWN_PASSABLE.has(g.world.getBlock(x, y + 1, z))) continue;
        spots.push(y);
      }
      if (!spots.length && !waterSpots.length) continue;
      const y = (spots.length ? spots : waterSpots)[
        (Math.random() * (spots.length || waterSpots.length)) | 0];
      const wy = waterSpots.length
        ? waterSpots[(Math.random() * waterSpots.length) | 0] : -1;
      if (Math.hypot(x - g.player.pos.x, y - g.player.pos.y, z - g.player.pos.z) < 20) continue;

      const sky = g.world.skyLight(x, y, z) * g.sky.sunLight;
      const blk = g.world.blockLight(x, y, z);
      const lightLevel = Math.max(sky, blk);
      const biome = g.world.biomeAt(x, z);
      const ground = g.world.getBlock(x, y - 1, z);

      const pool = this.spawnPool(list, {
        biome, y, sky, lightLevel, ground, hasLand: spots.length > 0, hasWater: wy >= 0,
      });
      if (!pool.length) continue;
      const key = pool[(Math.random() * pool.length) | 0];
      const spawnY = MOBS[key].spawn.water ? wy : y;
      const packSize = MOBS[key].solo ? 1
        : category === 'passive' ? 2 + ((Math.random() * 2) | 0)
          : (Math.random() < 0.35 ? 2 : 1);
      for (let i = 0; i < packSize; i++) {
        const mob = new Mob(g, key,
          x + 0.5 + (Math.random() - 0.5) * 2, spawnY, z + 0.5 + (Math.random() - 0.5) * 2);
        g.entities.add(mob);
      }
      return;
    }
  }

  /** Monster spawner blocks fire when the player is nearby. */
  tickSpawners(dt) {
    const g = this.game;
    const store = g.world.spawners[g.world.dim];
    if (!store) return;
    for (const s of store.values()) {
      const d = Math.hypot(s.x - g.player.pos.x, s.y - g.player.pos.y, s.z - g.player.pos.z);
      if (d > 17) continue;
      if (g.world.getBlock(s.x, s.y, s.z) !== B.SPAWNER) continue;
      if (g.player.difficulty === DIFFICULTY.PEACEFUL) continue;
      s.cooldown -= dt;
      g.particles.flame(s.x + 0.5, s.y + 0.5, s.z + 0.5, 1);
      if (s.cooldown > 0) continue;
      s.cooldown = 8 + Math.random() * 8;
      let nearby = 0;
      g.entities.each((e) => {
        if (e.category === 'mob' && e.kind === s.mob &&
            Math.hypot(e.pos.x - s.x, e.pos.y - s.y, e.pos.z - s.z) < 12) nearby++;
      });
      if (nearby >= 5) continue;
      for (let i = 0; i < 3; i++) {
        const x = s.x + (Math.random() - 0.5) * 7;
        const z = s.z + (Math.random() - 0.5) * 7;
        const y = s.y + Math.floor((Math.random() - 0.5) * 3);
        if (y < 1 || y > CHUNK_Y - 3) continue;
        if (!MOBS[s.mob]) continue;
        const flying = MOBS[s.mob].fly;
        if (!flying) {
          if (!IS_SOLID[g.world.getBlock(Math.floor(x), y - 1, Math.floor(z))]) continue;
        }
        if (g.world.getBlock(Math.floor(x), y, Math.floor(z)) !== B.AIR) continue;
        if (g.world.getBlock(Math.floor(x), y + 1, Math.floor(z)) !== B.AIR) continue;
        g.entities.add(new Mob(g, s.mob, x, y, z, { fromSpawner: true }));
        g.particles.enderPop(x, y + 0.5, z, 8);
      }
    }
  }

  /** Seed the world with animals when a fresh world is created. */
  initialPopulate() {
    const g = this.game;
    if (g.world.dim !== DIM.OVERWORLD) return;
    for (let i = 0; i < 14; i++) this.trySpawn('passive');
  }
}
