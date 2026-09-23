import { isWater, isLava } from '../world/blocks.js';
// ============================================================================
// Non-mob entities: dropped items, XP orbs, arrows, fireballs, thrown items,
// the Eye of Ender that seeks the stronghold, primed TNT and explosions.
// ============================================================================

import * as THREE from 'three';
import { Entity, moveBody } from './entity.js';
import { B, BLOCKS, IS_SOLID } from '../world/blocks.js';
import { getItem } from '../crafting/items.js';
import { buildItemMesh, blockCubeGeometry, itemTexture } from '../engine/itemmesh.js';
import { nearestStronghold } from '../world/structures.js';
import { DIM } from '../constants.js';


let atlasMat = null;

function getAtlasMaterial(game) {
  if (!atlasMat) {
    atlasMat = new THREE.MeshBasicMaterial({
      map: game.renderer.atlas, alphaTest: 0.35, fog: true, side: THREE.DoubleSide,
    });
  }
  return atlasMat;
}

// ---------------------------------------------------------------------------
// Dropped item
// ---------------------------------------------------------------------------
export class ItemEntity extends Entity {
  constructor(game, x, y, z, stack, opts = {}) {
    super(game, x, y, z);
    this.kind = 'item';
    this.category = 'item';
    this.stack = stack;
    this.width = 0.28; this.height = 0.28;
    this.pickupDelay = opts.delay ?? 0.6;
    this.lifetime = 300;
    this.vel.set(
      opts.vx ?? (Math.random() - 0.5) * 2.2,
      opts.vy ?? 2.4,
      opts.vz ?? (Math.random() - 0.5) * 2.2
    );

    const it = getItem(stack.key);
    // Real 3D pickups: extruded sprites for items, textured cubes for blocks.
    const mesh = buildItemMesh(it, game.renderer.atlas, { scale: 0.42 })
      || new THREE.Mesh(blockCubeGeometry(B.STONE, 0.32), getAtlasMaterial(game).clone());
    if (mesh.userData.isBlock) mesh.scale.setScalar(0.34);
    this.object3d = mesh;
    game.renderer.scene.add(mesh);
  }

  update(dt) {
    this.age += dt;
    this.lifetime -= dt;
    if (this.lifetime <= 0) { this.remove(); return; }
    if (this.pickupDelay > 0) this.pickupDelay -= dt;

    // float in water rather than sinking forever
    const inWater = isWater(this.game.world.getBlock(
      Math.floor(this.pos.x), Math.floor(this.pos.y + 0.1), Math.floor(this.pos.z)));
    if (inWater) { this.vel.y += 30 * dt; this.vel.y = Math.min(this.vel.y, 1.2); }
    const inLava = isLava(this.game.world.getBlock(
      Math.floor(this.pos.x), Math.floor(this.pos.y + 0.1), Math.floor(this.pos.z)));
    if (inLava) { this.game.particles.smoke(this.pos.x, this.pos.y, this.pos.z, 3); this.remove(); return; }

    this.physics(dt, { step: 0 });

    const p = this.game.player;
    if (this.pickupDelay <= 0 && !p.dead) {
      const d = this.pos.distanceTo(p.pos);
      if (d < 1.4) {
        // magnet toward the player before actually collecting
        const dir = p.pos.clone().sub(this.pos).normalize();
        this.vel.addScaledVector(dir, 26 * dt);
      }
      if (d < 0.75) {
        const left = p.inventory.add(this.stack.key, this.stack.count, this.stack.dur);
        if (left < this.stack.count) {
          this.game.onItemPickup(this.stack.key, this.stack.count - left);
          this.stack.count = left;
        }
        if (this.stack.count <= 0) { this.remove(); return; }
      }
    }

    const o = this.object3d;
    o.position.set(this.pos.x, this.pos.y + 0.24 + Math.sin(this.age * 2.4) * 0.07, this.pos.z);
    o.rotation.y = this.age * 1.5;
    const l = this.lightAt();
    if (o.material.color) o.material.color.setRGB(l, l, l);
  }

  serialize() {
    return { t: 'item', x: this.pos.x, y: this.pos.y, z: this.pos.z, s: {...this.stack}, life:this.lifetime };
  }
}

// ---------------------------------------------------------------------------
// XP orb
// ---------------------------------------------------------------------------
let orbGeo = null;
export class XpOrb extends Entity {
  constructor(game, x, y, z, amount) {
    super(game, x, y, z);
    this.kind = 'xp';
    this.category = 'xp';
    this.amount = amount;
    this.width = 0.25; this.height = 0.25;
    this.lifetime = 240;
    this.vel.set((Math.random() - 0.5) * 2, 1.6 + Math.random(), (Math.random() - 0.5) * 2);
    if (!orbGeo) orbGeo = new THREE.SphereGeometry(0.14, 6, 5);
    const mat = new THREE.MeshBasicMaterial({ color: 0x9cff30, fog: true });
    this.object3d = new THREE.Mesh(orbGeo, mat);
    game.renderer.scene.add(this.object3d);
  }

  update(dt) {
    this.age += dt;
    this.lifetime -= dt;
    if (this.lifetime <= 0) { this.remove(); return; }
    const p = this.game.player;
    const d = this.pos.distanceTo(p.pos);
    if (d < 6 && !p.dead) {
      const dir = p.pos.clone().add(new THREE.Vector3(0, 0.8, 0)).sub(this.pos).normalize();
      this.vel.addScaledVector(dir, 34 * dt);
      this.gravity = 2;
    } else this.gravity = 12;
    this.physics(dt, { step: 0 });
    if (d < 0.9 && !p.dead) {
      p.addXp(this.amount);
      this.game.audio.play('xp', { volume: 0.5, throttle: 0.04 });
      this.remove();
      return;
    }
    this.object3d.position.set(this.pos.x, this.pos.y + 0.14 + Math.sin(this.age * 6) * 0.05, this.pos.z);
    const s = 0.9 + Math.sin(this.age * 8) * 0.12;
    this.object3d.scale.setScalar(s);
  }
}

// ---------------------------------------------------------------------------
// Arrow
// ---------------------------------------------------------------------------
let arrowGeo = null;
export class Arrow extends Entity {
  constructor(game, x, y, z, dir, power, owner) {
    super(game, x, y, z);
    this.kind = 'arrow';
    this.category = 'projectile';
    this.width = 0.2; this.height = 0.2;
    this.gravity = 12;
    this.owner = owner;         // 'player' | mob entity
    this.damage = 2 + power * 5;
    this.vel.copy(dir).multiplyScalar(18 + power * 26);
    this.lifetime = 40;
    this.stuck = false;
    if (!arrowGeo) arrowGeo = new THREE.BoxGeometry(0.08, 0.08, 0.8);
    const mat = new THREE.MeshBasicMaterial({ color: 0xcfcfcf, fog: true });
    this.object3d = new THREE.Mesh(arrowGeo, mat);
    game.renderer.scene.add(this.object3d);
  }

  update(dt) {
    this.age += dt;
    this.lifetime -= dt;
    if (this.lifetime <= 0) { this.remove(); return; }
    if (this.stuck) {
      this._stuckTime = (this._stuckTime || 0) + dt;
      if (this._stuckTime > 12) this.remove();
      return;
    }

    const prev = this.pos.clone();
    this.vel.y -= this.gravity * dt;
    this.pos.addScaledVector(this.vel, dt);

    // block hit
    const hit = this.game.world.raycast(prev.x, prev.y, prev.z,
      this.vel.x, this.vel.y, this.vel.z, this.vel.length() * dt + 0.2,
      (b) => IS_SOLID[b] === 1);
    if (hit) {
      this.pos.set(prev.x + this.vel.x * dt * 0.5, prev.y + this.vel.y * dt * 0.5, prev.z + this.vel.z * dt * 0.5);
      this.stuck = true;
      this.game.audio.play('arrow_hit', { pos: [this.pos.x, this.pos.y, this.pos.z], volume: 0.5 });
      if (this.owner === 'player') {
        // arrows can be picked back up
        this.game.dropItem(this.pos.x, this.pos.y, this.pos.z, { key: 'arrow', count: 1 }, { vy: 0.1 });
      }
      this.remove();
      return;
    }

    // entity hit
    const hitEntity = this.game.entities.list.find((e) => {
      if (e.dead || e === this.owner) return false;
      if (this.owner === 'player' && e.category === 'item') return false;
      if (!e.hurtByProjectile) return false;
      if (this.owner !== 'player' && e.category === 'mob') return false;
      const dx = e.pos.x - this.pos.x, dz = e.pos.z - this.pos.z;
      const dy = this.pos.y - e.pos.y;
      return Math.abs(dx) < e.width / 2 + 0.3 && Math.abs(dz) < e.width / 2 + 0.3 && dy > -0.4 && dy < e.height + 0.3;
    });
    if (hitEntity) {
      hitEntity.hurtByProjectile(this.damage, this);
      this.remove();
      return;
    }

    // player hit
    const p = this.game.player;
    if (this.owner !== 'player' && !p.dead) {
      const dx = p.pos.x - this.pos.x, dz = p.pos.z - this.pos.z, dy = this.pos.y - p.pos.y;
      if (Math.abs(dx) < 0.5 && Math.abs(dz) < 0.5 && dy > -0.3 && dy < 1.9) {
        p.hurt(this.damage * p.damageMultiplier, 'was shot by a skeleton', this.game, false, this.pos);
        this.remove();
        return;
      }
    }

    this.object3d.position.copy(this.pos);
    this.object3d.lookAt(this.pos.clone().add(this.vel));
  }
}

// ---------------------------------------------------------------------------
// Fireball (blaze / ghast)
// ---------------------------------------------------------------------------
export class Fireball extends Entity {
  constructor(game, x, y, z, dir, opts = {}) {
    super(game, x, y, z);
    this.kind = 'fireball';
    this.category = 'projectile';
    this.width = 0.4; this.height = 0.4;
    this.gravity = 0;
    this.damage = opts.damage ?? 5;
    this.explosive = opts.explosive ?? false;
    this.owner = opts.owner || null;
    this.vel.copy(dir).normalize().multiplyScalar(opts.speed ?? 14);
    this.lifetime = 8;
    const mat = new THREE.MeshBasicMaterial({ color: this.explosive ? 0xff7020 : 0xffc040, fog: true });
    this.object3d = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), mat);
    game.renderer.scene.add(this.object3d);
  }

  update(dt) {
    this.age += dt;
    this.lifetime -= dt;
    if (this.lifetime <= 0) { this.remove(); return; }
    const prev = this.pos.clone();
    this.pos.addScaledVector(this.vel, dt);
    this.game.particles.flame(this.pos.x, this.pos.y, this.pos.z, 2);

    const hit = this.game.world.raycast(prev.x, prev.y, prev.z,
      this.vel.x, this.vel.y, this.vel.z, this.vel.length() * dt + 0.2, (b) => IS_SOLID[b] === 1);
    const p = this.game.player;
    const dx = p.pos.x - this.pos.x, dz = p.pos.z - this.pos.z, dy = this.pos.y - p.pos.y;
    const hitPlayer = !p.dead && Math.abs(dx) < 0.6 && Math.abs(dz) < 0.6 && dy > -0.4 && dy < 2.0;

    if (hit || hitPlayer) {
      if (this.explosive) {
        explode(this.game, this.pos.x, this.pos.y, this.pos.z, 2.6, true);
      } else {
        this.game.particles.explosion(this.pos.x, this.pos.y, this.pos.z, 1.2);
        this.game.audio.play('fireball', { pos: [this.pos.x, this.pos.y, this.pos.z] });
      }
      if (hitPlayer) {
        p.hurt(this.damage * p.damageMultiplier, 'went up in flames', this.game, false, this.pos);
        p.fireTicks = Math.max(p.fireTicks, 4);
      }
      this.remove();
      return;
    }
    this.object3d.position.copy(this.pos);
    this.object3d.rotation.x += dt * 8;
    this.object3d.rotation.y += dt * 6;
  }
}

// ---------------------------------------------------------------------------
// Thrown items (snowball, ender pearl)
// ---------------------------------------------------------------------------
export class ThrownItem extends Entity {
  constructor(game, x, y, z, dir, itemKey) {
    super(game, x, y, z);
    this.kind = 'thrown';
    this.category = 'projectile';
    this.itemKey = itemKey;
    this.width = 0.25; this.height = 0.25;
    this.gravity = 14;
    this.vel.copy(dir).multiplyScalar(19);
    this.lifetime = 20;
    const mat = new THREE.MeshBasicMaterial({
      map: itemTexture(itemKey), transparent: true, alphaTest: 0.4, side: THREE.DoubleSide, fog: true,
    });
    this.object3d = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3), mat);
    game.renderer.scene.add(this.object3d);
  }

  update(dt) {
    this.age += dt;
    this.lifetime -= dt;
    if (this.lifetime <= 0) { this.remove(); return; }
    const prev = this.pos.clone();
    this.vel.y -= this.gravity * dt;
    this.pos.addScaledVector(this.vel, dt);

    const hit = this.game.world.raycast(prev.x, prev.y, prev.z,
      this.vel.x, this.vel.y, this.vel.z, this.vel.length() * dt + 0.2, (b) => IS_SOLID[b] === 1);
    const mobHit = this.game.entities.list.find((e) => !e.dead && e.category === 'mob' &&
      e.pos.distanceTo(this.pos) < e.width / 2 + 0.5);

    if (hit || mobHit) {
      if (this.itemKey === 'ender_pearl') {
        const p = this.game.player;
        const dest = hit ? [prev.x, prev.y, prev.z] : [this.pos.x, this.pos.y, this.pos.z];
        p.pos.set(dest[0], dest[1], dest[2]);
        p.vel.set(0, 0, 0);
        p.fallDistance = 0;
        p.hurt(2.5, 'took teleportation damage', this.game, true);
        this.game.particles.enderPop(dest[0], dest[1], dest[2]);
        this.game.audio.play('teleport');
      } else {
        this.game.particles.splash(this.pos.x, this.pos.y, this.pos.z, 6);
        if (mobHit) mobHit.hurtByProjectile?.(1, this);
      }
      this.remove();
      return;
    }
    this.object3d.position.copy(this.pos);
    this.object3d.quaternion.copy(this.game.renderer.camera.quaternion);
  }
}

// ---------------------------------------------------------------------------
// Eye of Ender â€” flies toward the nearest stronghold, then hovers and drops.
// ---------------------------------------------------------------------------
export class EnderEye extends Entity {
  constructor(game, x, y, z) {
    super(game, x, y, z);
    this.kind = 'ender_eye';
    this.category = 'projectile';
    this.width = 0.25; this.height = 0.25;
    this.gravity = 0;
    this.lifetime = 5.5;
    const site = nearestStronghold(game.world.seed, x, z);
    this.target = site;
    this.shatter = Math.random() < 0.2;
    const mat = new THREE.MeshBasicMaterial({
      map: itemTexture('ender_eye'), transparent: true, alphaTest: 0.4, side: THREE.DoubleSide, fog: true,
    });
    this.object3d = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.36), mat);
    game.renderer.scene.add(this.object3d);
    game.audio.play('teleport', { rate: 0.7, volume: 0.5 });
    this.startY = y;
  }

  update(dt) {
    this.age += dt;
    this.lifetime -= dt;
    if (!this.target) { this.remove(); return; }

    const dx = this.target.x - this.pos.x;
    const dz = this.target.z - this.pos.z;
    const horiz = Math.hypot(dx, dz);
    // Rise, glide toward the stronghold, then descend as it gets close.
    const speed = 12;
    const climb = this.age < 0.6 ? 6 : (horiz < 8 ? -3 : Math.sin(this.age * 1.6) * 1.2);
    this.vel.set((dx / (horiz || 1)) * speed, climb, (dz / (horiz || 1)) * speed);
    this.pos.addScaledVector(this.vel, dt);

    this.game.particles.portalSparkle(this.pos.x, this.pos.y, this.pos.z, 2);

    if (this.lifetime <= 0) {
      this.game.particles.enderPop(this.pos.x, this.pos.y, this.pos.z, 12);
      if (!this.shatter) {
        this.game.dropItem(this.pos.x, this.pos.y, this.pos.z, { key: 'ender_eye', count: 1 });
      } else {
        this.game.toast('Eye of Ender', 'The eye shattered');
      }
      this.remove();
      return;
    }
    this.object3d.position.copy(this.pos);
    this.object3d.quaternion.copy(this.game.renderer.camera.quaternion);
  }
}

// ---------------------------------------------------------------------------
// Primed TNT
// ---------------------------------------------------------------------------
export class PrimedTnt extends Entity {
  constructor(game, x, y, z) {
    super(game, x, y, z);
    this.kind = 'tnt';
    this.category = 'projectile';
    this.width = 0.9; this.height = 0.9;
    this.fuse = 3.2;
    this.vel.set((Math.random() - 0.5) * 0.6, 4, (Math.random() - 0.5) * 0.6);
    const mat = new THREE.MeshBasicMaterial({
      map: game.renderer.atlas, fog: true, vertexColors: true,
    });
    this.object3d = new THREE.Mesh(blockCubeGeometry(B.TNT, 0.98), mat);
    game.renderer.scene.add(this.object3d);
  }

  update(dt) {
    this.fuse -= dt;
    this.physics(dt, { step: 0 });
    this.game.particles.smoke(this.pos.x, this.pos.y + 0.6, this.pos.z, 1, 0.85);
    const f = Math.sin(this.fuse * 26) > 0 ? 2.2 : 1;
    this.object3d.material.color.setRGB(f, f, f);
    this.object3d.position.set(this.pos.x, this.pos.y + 0.45, this.pos.z);
    if (this.fuse <= 0) {
      explode(this.game, this.pos.x, this.pos.y + 0.5, this.pos.z, 4, 'player');
      this.remove();
    }
  }
}

// ---------------------------------------------------------------------------
// Explosions
// ---------------------------------------------------------------------------
export function explode(game, x, y, z, power, destroyBlocks) {
  game.particles.explosion(x, y, z, power);
  game.audio.play('explode', { pos: [x, y, z], volume: 1 });
  game.shake(0.7 * Math.min(1.6, power / 3));

  // The mobGriefing rule only covers mob-caused blasts; TNT the player lit is
  // the player's own doing and always breaks blocks.
  if (destroyBlocks && (destroyBlocks === 'player' || game.gamerules?.mobGriefing !== false)) {
    const r = Math.ceil(power);
    const drops = [];
    for (let dy = -r; dy <= r; dy++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          const d = Math.hypot(dx, dy, dz);
          if (d > power * (0.75 + Math.random() * 0.35)) continue;
          const bx = Math.floor(x) + dx, by = Math.floor(y) + dy, bz = Math.floor(z) + dz;
          const b = game.world.getBlock(bx, by, bz);
          if (b === B.AIR || b === B.BEDROCK || b === B.OBSIDIAN) continue;
          const def = BLOCKS[b];
          if (def.hardness < 0) continue;
          if (def.hardness > 12) continue;
          if (Math.random() < 0.28 && def.drop) {
            drops.push([bx, by, bz, def.drop]);
          }
          game.world.setBlock(bx, by, bz, B.AIR);
        }
      }
    }
    for (const [bx, by, bz, key] of drops) {
      game.dropItem(bx + 0.5, by + 0.5, bz + 0.5, { key, count: 1 });
    }
  }

  // damage + knockback
  const p = game.player;
  const dp = p.pos.distanceTo(new THREE.Vector3(x, y, z));
  if (dp < power * 2.2 && !p.dead) {
    const f = 1 - dp / (power * 2.2);
    p.hurt(power * 3.4 * f * f, 'was blown up', game);
    const dir = p.pos.clone().sub(new THREE.Vector3(x, y, z)).normalize();
    p.vel.addScaledVector(dir, 12 * f);
    p.vel.y = Math.max(p.vel.y, 6 * f);
  }
  game.entities.each((e) => {
    if (e.category !== 'mob' || !e.hurtByProjectile) return;
    const d = e.pos.distanceTo(new THREE.Vector3(x, y, z));
    if (d > power * 2.2) return;
    const f = 1 - d / (power * 2.2);
    e.hurtByProjectile(power * 3.2 * f * f, null);
    const dir = e.pos.clone().sub(new THREE.Vector3(x, y, z)).normalize();
    e.vel.addScaledVector(dir, 10 * f);
    e.vel.y = Math.max(e.vel.y, 5 * f);
  });
}

export { moveBody, DIM };
