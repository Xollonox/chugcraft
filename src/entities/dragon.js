// ============================================================================
// The End Crystals and the Ender Dragon — the final fight.
//
// Core puzzle: while a single End Crystal survives it heals the dragon faster
// than any weapon can hurt it, so the player must destroy all ten crystals on
// the obsidian pillars before the boss can be killed.
// ============================================================================

import * as THREE from 'three';
import { Entity } from './entity.js';
import { buildModel, buildDragon, tintModel, disposeModel } from './models.js';
import { B, IS_SOLID } from '../world/blocks.js';
import { explode, Fireball } from './projectiles.js';
import { CHUNK_Y } from '../constants.js';

const CENTER = new THREE.Vector3(0.5, 0, 0.5);
const ISLAND_TOP = 64;

// ---------------------------------------------------------------------------
// End Crystal
// ---------------------------------------------------------------------------
export class EndCrystal extends Entity {
  constructor(game, x, y, z) {
    super(game, x, y, z);
    this.kind = 'end_crystal';
    this.category = 'crystal';
    this.width = 1.2; this.height = 2.0;
    this.gravity = 0;
    this.health = 5;
    this.model = buildModel('end_crystal');
    this.object3d = this.model.group;
    this.object3d.position.copy(this.pos);
    game.renderer.scene.add(this.object3d);

    // healing beam
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    this.beamMat = new THREE.LineBasicMaterial({ color: 0xd070ff, transparent: true, opacity: 0.85 });
    this.beam = new THREE.Line(g, this.beamMat);
    this.beam.frustumCulled = false;
    this.beam.visible = false;
    game.renderer.scene.add(this.beam);
  }

  onRemove() {
    disposeModel(this.model);
    this.game.renderer.scene.remove(this.beam);
    this.beam.geometry.dispose();
    this.beamMat.dispose();
  }

  hurtByProjectile() { this.destroy(); }
  damage() { this.destroy(); }

  destroy() {
    if (this.dead) return;
    this.game.audio.play('crystal_break', { pos: [this.pos.x, this.pos.y, this.pos.z], volume: 1 });
    explode(this.game, this.pos.x, this.pos.y + 1, this.pos.z, 3.0, false);
    this.game.particles.enderPop(this.pos.x, this.pos.y + 1, this.pos.z, 40);
    this.game.onCrystalDestroyed?.(this);
    this.remove();
  }

  update(dt) {
    this.age += dt;
    this.object3d.position.set(this.pos.x, this.pos.y + Math.sin(this.age * 1.4) * 0.22, this.pos.z);
    this.object3d.rotation.y = this.age * 0.6;
    tintModel(this.model, 1, 1, 1);

    const dragon = this.game.dragon;
    if (dragon && !dragon.dead && !dragon.dying) {
      const a = this.beam.geometry.attributes.position.array;
      a[0] = this.pos.x; a[1] = this.pos.y + 1.1; a[2] = this.pos.z;
      a[3] = dragon.pos.x; a[4] = dragon.pos.y + 1; a[5] = dragon.pos.z;
      this.beam.geometry.attributes.position.needsUpdate = true;
      this.beam.visible = true;
      this.beamMat.opacity = 0.5 + Math.sin(this.age * 8) * 0.25;
    } else this.beam.visible = false;

    if (this.age % 0.4 < dt) {
      this.game.particles.portalSparkle(this.pos.x, this.pos.y + 1, this.pos.z, 1);
    }
  }
}

// ---------------------------------------------------------------------------
// Ender Dragon
// ---------------------------------------------------------------------------
export class EnderDragon extends Entity {
  constructor(game, health = 200) {
    super(game, 0.5, ISLAND_TOP + 34, 0.5);
    this.kind = 'ender_dragon';
    this.category = 'boss';
    this.width = 6; this.height = 3;
    this.gravity = 0;
    this.maxHealth = 200;
    this.health = health;
    this.dying = false;
    this.deathTime = 0;
    this.phase = 'circle';
    this.phaseTimer = 8;
    this.orbitAngle = 0;
    this.orbitRadius = 42;
    this.orbitHeight = ISLAND_TOP + 26;
    this.attackCooldown = 0;
    this.hurtFlash = 0;
    this.breathTimer = 4;
    this.roarTimer = 6;
    this.perchProgress = 0;

    this.model = buildDragon();
    this.object3d = this.model.group;
    game.renderer.scene.add(this.object3d);
    this.target = new THREE.Vector3(0.5, this.orbitHeight, 42);
    game.audio.play('dragon_growl', { volume: 1 });
  }

  onRemove() { disposeModel(this.model); }

  get crystalsAlive() {
    let n = 0;
    this.game.entities.each((e) => { if (e.category === 'crystal') n++; });
    return n;
  }

  hurtByProjectile(damage, source) { this.damage(damage, source); }

  damage(amount, source) {
    if (this.dead || this.dying) return;
    if (this.crystalsAlive > 0) {
      // Healed faster than it can be hurt — this is the puzzle, so tell them.
      this.hurtFlash = 0.2;
      this.game.hintCrystals?.();
      return;
    }
    this.health -= amount;
    this.hurtFlash = 0.35;
    this.game.audio.play('dragon_hurt', { volume: 0.9, throttle: 0.25 });
    this.game.particles.damage(this.pos.x, this.pos.y + 1, this.pos.z, 10);
    if (this.health <= 0) this.beginDeath();
    void source;
  }

  beginDeath() {
    this.dying = true;
    this.deathTime = 0;
    this.health = 0;
    this.game.audio.play('dragon_death', { volume: 1 });
    this.game.onDragonDying?.();
  }

  update(dt) {
    this.age += dt;
    if (this.hurtFlash > 0) this.hurtFlash = Math.max(0, this.hurtFlash - dt);
    if (this.attackCooldown > 0) this.attackCooldown -= dt;

    if (this.dying) { this.updateDeath(dt); return; }

    const p = this.game.player;
    const healing = this.crystalsAlive > 0;
    if (healing && this.health < this.maxHealth) {
      this.health = Math.min(this.maxHealth, this.health + 12 * dt);
    }

    this.phaseTimer -= dt;
    if (this.phaseTimer <= 0) this.pickPhase();

    switch (this.phase) {
      case 'circle': this.doCircle(dt); break;
      case 'strafe': this.doStrafe(dt, p); break;
      case 'perch': this.doPerch(dt, p); break;
      default: this.doCircle(dt);
    }

    // wing-gust knockback when very close
    const d = this.pos.distanceTo(p.pos);
    if (d < 6 && this.attackCooldown <= 0 && !p.dead) {
      this.attackCooldown = 1.2;
      p.hurt(6 * p.damageMultiplier, 'was slain by the Ender Dragon', this.game, false, this.pos);
      // Enough to be scary, not enough to routinely punt the player into the void.
      const dir = p.pos.clone().sub(this.pos).normalize();
      dir.y = Math.abs(dir.y) * 0.4;
      p.vel.addScaledVector(dir.normalize(), 9);
      p.vel.y = Math.max(p.vel.y, 6);
    }

    this.roarTimer -= dt;
    if (this.roarTimer <= 0) {
      this.roarTimer = 9 + Math.random() * 9;
      this.game.audio.play('dragon_growl', { volume: 0.75 });
    }

    this.updateVisual(dt);
  }

  pickPhase() {
    const r = Math.random();
    if (this.phase === 'perch') { this.phase = 'circle'; this.phaseTimer = 8 + Math.random() * 6; return; }
    if (r < 0.42) { this.phase = 'perch'; this.phaseTimer = 9; this.perchProgress = 0; }
    else if (r < 0.75) { this.phase = 'strafe'; this.phaseTimer = 6; }
    else { this.phase = 'circle'; this.phaseTimer = 9; }
  }

  doCircle(dt) {
    this.orbitAngle += dt * 0.42;
    const wob = Math.sin(this.age * 0.7) * 5;
    this.target.set(
      Math.cos(this.orbitAngle) * this.orbitRadius,
      this.orbitHeight + wob,
      Math.sin(this.orbitAngle) * this.orbitRadius
    );
    this.flyTo(this.target, dt, 15);
  }

  doStrafe(dt, p) {
    const t = new THREE.Vector3(p.pos.x, p.pos.y + 3.5, p.pos.z);
    this.flyTo(t, dt, 20);
    this.breathTimer -= dt;
    if (this.breathTimer <= 0 && this.pos.distanceTo(p.pos) < 42) {
      this.breathTimer = 1.6;
      this.breathe(p);
    }
  }

  doPerch(dt, p) {
    const t = new THREE.Vector3(0.5, ISLAND_TOP + 5.5, 0.5);
    this.flyTo(t, dt, 11);
    this.perchProgress = Math.min(1, this.perchProgress + dt * 0.5);
    if (this.pos.distanceTo(t) < 8) {
      this.breathTimer -= dt;
      if (this.breathTimer <= 0) {
        this.breathTimer = 1.1;
        this.breathe(p);
      }
    }
  }

  breathe(p) {
    const from = this.headWorldPosition();
    const dir = new THREE.Vector3(p.pos.x, p.pos.y + 1, p.pos.z).sub(from).normalize();
    for (let i = 0; i < 3; i++) {
      const spread = dir.clone().add(new THREE.Vector3(
        (Math.random() - 0.5) * 0.14, (Math.random() - 0.5) * 0.14, (Math.random() - 0.5) * 0.14)).normalize();
      // Purple dragon breath — damaging, non-explosive.
      const fb = new Fireball(this.game, from.x, from.y, from.z, spread,
        { speed: 20, damage: 7, owner: this });
      fb.object3d.material.color.setHex(0xc040ff);
      this.game.entities.add(fb);
    }
    this.game.audio.play('fireball', { volume: 0.8 });
    this.game.particles.portalSparkle(from.x, from.y, from.z, 8);
    if (this.model.parts.jaw) this._jawOpen = 0.5;
  }

  headWorldPosition(out = new THREE.Vector3()) {
    if (this.model.parts.head) {
      this.model.parts.head.getWorldPosition(out);
      return out;
    }
    return out.copy(this.pos);
  }

  flyTo(target, dt, speed) {
    const dir = target.clone().sub(this.pos);
    const dist = dir.length();
    if (dist > 0.01) dir.divideScalar(dist);
    const desired = dir.multiplyScalar(Math.min(speed, dist * 2.2 + 3));
    this.vel.lerp(desired, Math.min(1, dt * 1.4));
    this.pos.addScaledVector(this.vel, dt);
    if (this.pos.y < ISLAND_TOP + 3) this.pos.y = ISLAND_TOP + 3;
    if (this.pos.y > CHUNK_Y - 6) this.pos.y = CHUNK_Y - 6;

    const want = Math.atan2(-this.vel.x, -this.vel.z);
    let d = want - this.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.yaw += d * Math.min(1, dt * 2.2);
    this.pitch += ((-this.vel.y * 0.045) - this.pitch) * Math.min(1, dt * 3);
  }

  updateVisual(dt) {
    const o = this.object3d;
    o.position.copy(this.pos);
    o.rotation.y = this.yaw + Math.PI;
    o.rotation.x = this.pitch;

    const flap = Math.sin(this.age * 2.6);
    const p = this.model.parts;
    if (p.wingR) { p.wingR.rotation.z = flap * 0.55 - 0.1; p.wingR.rotation.y = 0.18; }
    if (p.wingL) { p.wingL.rotation.z = -flap * 0.55 + 0.1; p.wingL.rotation.y = -0.18; }
    if (p.wingTipR) p.wingTipR.rotation.z = flap * 0.4;
    if (p.wingTipL) p.wingTipL.rotation.z = -flap * 0.4;
    const sway = Math.sin(this.age * 1.4);
    if (p.neck1) p.neck1.rotation.y = sway * 0.10;
    if (p.neck2) p.neck2.rotation.y = sway * 0.16;
    if (p.head) p.head.rotation.y = sway * 0.12;
    if (p.tail1) p.tail1.rotation.y = -sway * 0.16;
    if (p.tail2) p.tail2.rotation.y = -sway * 0.24;
    if (p.tail3) p.tail3.rotation.y = -sway * 0.32;
    if (this._jawOpen > 0) { this._jawOpen -= dt; }
    if (p.jaw) p.jaw.rotation.x = (this._jawOpen > 0 ? 0.5 : 0) + Math.max(0, sway) * 0.06;

    const glow = this.hurtFlash > 0 ? 1.9 : 1;
    if (this.hurtFlash > 0) tintModel(this.model, glow, 0.35, 0.35);
    else tintModel(this.model, 0.85, 0.85, 0.95);

    if (Math.random() < dt * 12) {
      const h = this.headWorldPosition();
      this.game.particles.portalSparkle(h.x, h.y, h.z, 1);
    }
  }

  updateDeath(dt) {
    this.deathTime += dt;
    this.pos.y += dt * 2.2;
    this.yaw += dt * 0.9;
    this.updateVisual(dt);
    const o = this.object3d;
    o.rotation.z = Math.sin(this.deathTime * 3) * 0.2;

    // beams of light + escalating particles
    for (let i = 0; i < 4; i++) {
      this.game.particles.portalSparkle(
        this.pos.x + (Math.random() - 0.5) * 8,
        this.pos.y + (Math.random() - 0.5) * 5,
        this.pos.z + (Math.random() - 0.5) * 8, 2);
    }
    if (Math.random() < dt * 6) {
      this.game.particles.explosion(
        this.pos.x + (Math.random() - 0.5) * 9, this.pos.y + (Math.random() - 0.5) * 4,
        this.pos.z + (Math.random() - 0.5) * 9, 1.4);
      this.game.audio.play('explode', { volume: 0.45 });
    }

    if (this.deathTime > 6.5) {
      this.game.particles.explosion(this.pos.x, this.pos.y, this.pos.z, 6);
      this.game.audio.play('explode', { volume: 1 });
      this.game.onDragonDead?.(this);
      this.remove();
    }
  }
}

export { B, IS_SOLID, CENTER, ISLAND_TOP };
