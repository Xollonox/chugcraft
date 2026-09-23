// ============================================================================
// Shared entity physics + the entity manager. Every moving thing in the world
// (mobs, dropped items, arrows, XP orbs, the dragon) is an Entity and shares
// the same AABB-vs-voxel sweep used by the player.
// ============================================================================

import * as THREE from 'three';
import { collisionBoxes } from '../world/shapes.js';
import { IS_SOLID, HEIGHT_OF, BLOCKS, B } from '../world/blocks.js';
import { GRAVITY_ENTITY, CHUNK_Y } from '../constants.js';

const EPS = 1e-4;

/** Minimum brightness for any entity model, however dark its surroundings. */
export const ENTITY_MIN_LIGHT = 0.34;

/**
 * Move an AABB through the voxel world, resolving one axis at a time.
 * Mutates `pos` and `vel`; returns collision flags.
 */
export function moveBody(world, pos, vel, hw, height, dt, opts = {}) {
  // Split long steps so a fast-moving entity can't skip over a thin floor.
  const far = Math.max(Math.abs(vel.x), Math.abs(vel.y), Math.abs(vel.z)) * dt;
  if (far > 0.4) {
    const n = Math.min(16, Math.ceil(far / 0.4));
    let out = { ground: false, wallX: false, wallZ: false, ceiling: false };
    for (let i = 0; i < n; i++) {
      const r = moveBodyStep(world, pos, vel, hw, height, dt / n, opts);
      out = {
        ground: out.ground || r.ground, wallX: out.wallX || r.wallX,
        wallZ: out.wallZ || r.wallZ, ceiling: out.ceiling || r.ceiling,
      };
      if (r.ground && vel.y === 0) break;
    }
    return out;
  }
  return moveBodyStep(world, pos, vel, hw, height, dt, opts);
}

function moveBodyStep(world, pos, vel, hw, height, dt, opts = {}) {
  const res = { ground: false, wallX: false, wallZ: false, ceiling: false };
  const stepHeight = opts.step ?? 0.6;

  const resolve = (axis, amount) => {
    if (amount === 0) return false;
    pos[axis] += amount;
    const x0 = Math.floor(pos.x - hw), x1 = Math.floor(pos.x + hw - EPS);
    const y0 = Math.floor(pos.y)-1, y1 = Math.floor(pos.y + height - EPS);
    const z0 = Math.floor(pos.z - hw), z1 = Math.floor(pos.z + hw - EPS);
    let hit = false;
    let limit = amount > 0 ? Infinity : -Infinity;
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) {
          const b = world.getBlock(x, y, z);
          if (!IS_SOLID[b]) continue;
          for(const [bx0,by0,bz0,bx1,by1,bz1] of collisionBoxes(world,x,y,z,b)){
          if(pos.x+hw<=bx0+EPS||pos.x-hw>=bx1-EPS||pos.y+height<=by0+EPS||pos.y>=by1-EPS||pos.z+hw<=bz0+EPS||pos.z-hw>=bz1-EPS)continue;
          hit=true;
          if(axis==='x')limit=amount>0?Math.min(limit,bx0-hw):Math.max(limit,bx1+hw);
          else if(axis==='z')limit=amount>0?Math.min(limit,bz0-hw):Math.max(limit,bz1+hw);
          else limit=amount>0?Math.min(limit,by0-height):Math.max(limit,by1);
          }
        }
      }
    }
    if (hit && Number.isFinite(limit)) pos[axis] = limit + (amount > 0 ? -EPS : EPS);
    return hit;
  };

  if (resolve('y', vel.y * dt)) {
    if (vel.y < 0) res.ground = true; else res.ceiling = true;
    vel.y = 0;
  }
  const preX = pos.x, preZ = pos.z, preY = pos.y;
  res.wallX = resolve('x', vel.x * dt);
  res.wallZ = resolve('z', vel.z * dt);

  if ((res.wallX || res.wallZ) && res.ground && stepHeight > 0) {
    pos.x = preX; pos.z = preZ;
    pos.y = preY + stepHeight;
    const clear = !collidesAt(world, pos, hw, height);
    if (clear) {
      const hx = resolve('x', vel.x * dt);
      const hz = resolve('z', vel.z * dt);
      if (hx && hz) { pos.x = preX; pos.z = preZ; pos.y = preY; }
      else { resolve('y', -stepHeight - 0.02); res.stepped = true; }
    } else {
      pos.y = preY;
      resolve('x', vel.x * dt);
      resolve('z', vel.z * dt);
    }
  }
  return res;
}

export function collidesAt(world, pos, hw, height) {
  const x0 = Math.floor(pos.x - hw), x1 = Math.floor(pos.x + hw - EPS);
  const y0 = Math.floor(pos.y)-1, y1 = Math.floor(pos.y + height - EPS);
  const z0 = Math.floor(pos.z - hw), z1 = Math.floor(pos.z + hw - EPS);
  for (let y = y0; y <= y1; y++) {
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        const b = world.getBlock(x, y, z);
        if (!IS_SOLID[b]) continue;
        if (pos.y >= y + HEIGHT_OF[b] - EPS) continue;
        return true;
      }
    }
  }
  return false;
}

let nextId = 1;

export class Entity {
  constructor(game, x, y, z) {
    this.game = game;
    this.id = nextId++;
    this.pos = new THREE.Vector3(x, y, z);
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.dead = false;
    this.width = 0.6;
    this.height = 1.8;
    this.gravity = GRAVITY_ENTITY;
    this.onGround = false;
    this.age = 0;
    this.object3d = null;
    this.kind = 'entity';
  }

  get hw() { return this.width / 2; }

  physics(dt, opts) {
    this.vel.y -= this.gravity * dt;
    if (this.vel.y < -60) this.vel.y = -60;
    const r = moveBody(this.game.world, this.pos, this.vel, this.hw, this.height, dt, opts);
    this.onGround = r.ground;
    if (r.ground) {
      const f = Math.max(0, 1 - dt * 8);
      this.vel.x *= f; this.vel.z *= f;
    } else {
      const f = Math.max(0, 1 - dt * 0.6);
      this.vel.x *= f; this.vel.z *= f;
    }
    if (this.pos.y < -20) this.remove();
    return r;
  }

  /**
   * Sky/block light at the entity, used to tint its model.
   *
   * Entities get a much higher floor than terrain does. A mob is small, moving
   * and matters: at the raw night light level a zombie multiplies down to a
   * featureless silhouette, so the shape and face read as a black cut-out.
   * Terrain can afford to go nearly black; creatures cannot.
   */
  lightAt() {
    const w = this.game.world;
    const x = Math.floor(this.pos.x), y = Math.floor(this.pos.y + this.height * 0.6), z = Math.floor(this.pos.z);
    const l = w.getLight(x, y, z);
    const sky = ((l >> 4) & 15) / 15, blk = (l & 15) / 15;
    const lit = Math.max(sky * this.game.sky.sunLight, blk);
    return Math.max(lit, ENTITY_MIN_LIGHT);
  }

  inLiquid(id) {
    const b = this.game.world.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y + 0.2), Math.floor(this.pos.z));
    return b === id;
  }

  distanceTo(v) { return this.pos.distanceTo(v); }

  remove() {
    if (this.dead) return;
    this.dead = true;
    if (this.object3d) {
      this.game.renderer.scene.remove(this.object3d);
      this.object3d = null;
    }
    this.onRemove?.();
  }

  update() { /* overridden */ }
  serialize() { return null; }
}

// ---------------------------------------------------------------------------

export class EntityManager {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.byKind = new Map();
  }

  add(e) {
    this.list.push(e);
    return e;
  }

  update(dt) {
    const list = this.list;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.dead) continue;
      try {
        e.update(dt);
      } catch (err) {
        // Stringify so the message survives console capture in tests/logs.
        console.error(`[entity] ${e.kind} update failed: ${(err && err.stack) || err}`);
        e.remove();
      }
    }
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].dead) list.splice(i, 1);
    }
  }

  count(kind) {
    let n = 0;
    for (const e of this.list) if (!e.dead && e.kind === kind) n++;
    return n;
  }

  countCategory(cat) {
    let n = 0;
    for (const e of this.list) if (!e.dead && e.category === cat) n++;
    return n;
  }

  nearest(pos, filter, maxDist = Infinity) {
    let best = null, bd = maxDist * maxDist;
    for (const e of this.list) {
      if (e.dead || (filter && !filter(e))) continue;
      const d = e.pos.distanceToSquared(pos);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  each(fn) { for (const e of this.list) if (!e.dead) fn(e); }

  clear() {
    for (const e of this.list) e.remove();
    this.list.length = 0;
  }
}

export { BLOCKS, B, CHUNK_Y };
