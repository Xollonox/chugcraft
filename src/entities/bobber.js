import { isWater, isLava } from '../world/blocks.js';
// ============================================================================
// Fishing bobber. Cast with a rod, it flies, lands in water, bobs, and after a
// random wait tugs under ("bite"). Reeling in during the bite window rolls the
// loot table; reeling in at any other time just retrieves the line.
// ============================================================================

import * as THREE from 'three';
import { Entity } from './entity.js';
import { B, IS_SOLID } from '../world/blocks.js';

export const BITE_WINDOW = 1.6;
export const WAIT_MIN = 5, WAIT_MAX = 22;

/** Weighted fishing loot: fish most of the time, junk sometimes, a treasure now and then. */
export const FISHING_LOOT = [
  { key: 'raw_cod', count: 1, weight: 55 },
  { key: 'raw_salmon', count: 1, weight: 25 },
  { key: 'string', count: 1, weight: 4 },
  { key: 'bone', count: 1, weight: 3 },
  { key: 'stick', count: 1, weight: 3 },
  { key: 'leather', count: 1, weight: 3 },
  { key: 'book', count: 1, weight: 2 },
  { key: 'emerald', count: 1, weight: 1 },
  { key: 'name_tag', count: 1, weight: 1 },   // filtered out if the item doesn't exist
];

/** Roll the loot table with an injectable RNG (tests) and an item validator. */
export function rollFishingLoot(rng = Math.random, exists = () => true) {
  const pool = FISHING_LOOT.filter((l) => exists(l.key));
  const total = pool.reduce((a, l) => a + l.weight, 0);
  let r = rng() * total;
  for (const l of pool) { r -= l.weight; if (r <= 0) return { key: l.key, count: l.count }; }
  return { key: pool[0].key, count: pool[0].count };
}

let bobberGeo = null;

export class Bobber extends Entity {
  constructor(game, x, y, z, dir, rainy = false) {
    super(game, x, y, z);
    this.kind = 'bobber';
    this.category = 'projectile';
    this.width = 0.25; this.height = 0.25;
    this.gravity = 16;
    this.vel.copy(dir).multiplyScalar(14);
    this.vel.y += 3;
    this.floating = false;
    this.waitTimer = 0;
    this.biteTimer = 0;
    this.lifetime = 90;
    // Rain roughly halves the wait, as in Minecraft.
    this.waitScale = rainy ? 0.55 : 1;
    if (!bobberGeo) bobberGeo = new THREE.BoxGeometry(0.22, 0.22, 0.22);
    const mat = new THREE.MeshBasicMaterial({ color: 0xd83a2a, fog: true });
    this.object3d = new THREE.Mesh(bobberGeo, mat);
    game.renderer.scene.add(this.object3d);
  }

  get biting() { return this.floating && this.biteTimer > 0; }

  update(dt) {
    this.age += dt;
    this.lifetime -= dt;
    if (this.lifetime <= 0) { this.remove(); return; }
    const w = this.game.world;
    const at = () => w.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y), Math.floor(this.pos.z));

    if (!this.floating) {
      const prev = this.pos.clone();
      this.vel.y -= this.gravity * dt;
      this.pos.addScaledVector(this.vel, dt);
      const b = at();
      if (isWater(b)) {
        this.floating = true;
        this.vel.set(0, 0, 0);
        this.pos.y = Math.floor(this.pos.y) + 0.85;
        this.waitTimer = (WAIT_MIN + Math.random() * (WAIT_MAX - WAIT_MIN)) * this.waitScale;
        this.game.particles.splash(this.pos.x, this.pos.y, this.pos.z, 5);
        this.game.audio.play('splash', { pos: [this.pos.x, this.pos.y, this.pos.z], volume: 0.4 });
      } else if (IS_SOLID[b] === 1) {
        // Landed on ground: sit there uselessly until reeled in.
        this.pos.copy(prev);
        this.vel.set(0, 0, 0);
        this.gravity = 0;
      }
    } else {
      if (!isWater(at()) && !isWater(w.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y) - 1, Math.floor(this.pos.z)))) {
        // Water drained away under us.
        this.floating = false;
      }
      if (this.biteTimer > 0) {
        this.biteTimer -= dt;
      } else {
        this.waitTimer -= dt;
        if (this.waitTimer <= 0) {
          this.biteTimer = BITE_WINDOW;
          this.game.particles.splash(this.pos.x, this.pos.y, this.pos.z, 10);
          this.game.audio.play('bobber_splash', { pos: [this.pos.x, this.pos.y, this.pos.z], volume: 0.9 });
        } else if (this.waitTimer < 2.5 && Math.random() < dt * 3) {
          // Approaching fish: little ripples give the player a heads-up.
          this.game.particles.splash(this.pos.x + (Math.random() - 0.5), this.pos.y, this.pos.z + (Math.random() - 0.5), 1);
        }
      }
    }

    const o = this.object3d;
    const dip = this.biteTimer > 0 ? -0.3 : 0;
    o.position.set(this.pos.x, this.pos.y + (this.floating ? Math.sin(this.age * 3) * 0.05 + dip : 0), this.pos.z);
  }
}
