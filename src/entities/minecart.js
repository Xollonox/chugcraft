// ============================================================================
// Minecart — a rideable cart that rolls along rails.
//
// It is a normal Entity (so it saves, loads and collides like everything
// else), but while it sits on a rail its motion is driven by the shared
// helpers in world/rails.js: friction while rolling, a hard shove from
// powered rails, and quarter-turn curves it follows without leaving the line.
// ============================================================================

import { Entity, moveBody } from './entity.js';
import { isLava } from '../world/blocks.js';
import {
  isRailId, isPoweredRailId, poweredRailIdFor, railShape, railTravelDir,
  cartSpeedStep,
} from '../world/rails.js';
import { buildModel, tintModel } from './models.js';

const RAIL_TOP = 0.0625;    // rail plates sit 1/16 above the block floor
const CART_WIDTH = 0.9;
const CART_HEIGHT = 0.72;

export class Minecart extends Entity {
  constructor(game, x, y, z) {
    super(game, x, y, z);
    this.kind = 'cart';
    this.category = 'vehicle';
    this.width = CART_WIDTH;
    this.height = CART_HEIGHT;
    this.health = 6;
    this.rider = null;          // 'player' while someone is aboard
    this.onRail = false;
    this.push = 0;              // rider throttle, refreshed every frame
    this.lastDir = { x: 0, z: 1 };  // committed travel direction
    this.railCell = null;       // the rail piece lastDir was committed for
    this.hurtFlash = 0;
    this.model = buildModel('minecart');
    this.object3d = this.model.group;
    game.renderer.scene.add(this.object3d);
  }

  get hw() { return this.width / 2; }

  /** The rail carrying this cart right now, if any. */
  railUnder() {
    const world = this.game.world;
    const fx = Math.floor(this.pos.x), fz = Math.floor(this.pos.z);
    const base = Math.floor(this.pos.y + 0.01);
    for (const dy of [0, -1, -2]) {
      const y = base + dy;
      const id = world.getBlock(fx, y, fz);
      if (!isRailId(id)) continue;
      // The cart must actually be at rail height, not falling past it.
      if (this.pos.y < y - 0.3 || this.pos.y > y + 1.2) continue;
      return { x: fx, y, z: fz, id };
    }
    return null;
  }

  update(dt) {
    this.age += dt;
    if (this.hurtFlash > 0) this.hurtFlash -= dt;
    const world = this.game.world;
    const rail = this.railUnder();
    this.onRail = !!rail;

    if (rail) {
      // Self-heal a stale powered state: a rail whose redstone block arrived
      // while it was unloaded still lights up the moment a cart rolls over it.
      const get = (x, y, z) => world.getBlock(x, y, z);
      const want = poweredRailIdFor(rail.id, get, rail.x, rail.y, rail.z);
      if (want !== rail.id) { world.setBlock(rail.x, rail.y, rail.z, want); rail.id = want; }
      const powered = isPoweredRailId(rail.id);

      this.pos.y = rail.y + RAIL_TOP;
      this.vel.y = 0;
      this.onGround = true;

      const shape = railShape(get, rail.x, rail.y, rail.z, powered);
      // Direction is committed per rail piece: it is re-derived only when the
      // cart rolls into a new cell, so a curve can never flip it back mid-turn.
      const cell = `${rail.x},${rail.y},${rail.z}`;
      if (cell !== this.railCell) {
        this.railCell = cell;
        this.lastDir = railTravelDir(shape, this.vel.x, this.vel.z, this.lastDir);
      }
      const dir = this.lastDir;
      const speed = Math.hypot(this.vel.x, this.vel.z);

      let next = cartSpeedStep(speed, dt, { powered, push: this.push });
      // A cart standing on a powered rail gets nudged into motion.
      if (powered && next < 0.25) next = 0.25;
      this.vel.x = dir.x * next;
      this.vel.z = dir.z * next;

      const r = moveBody(world, this.pos, this.vel, this.hw, this.height, dt, { step: 0 });
      if (r.wallX || r.wallZ) { this.vel.x = 0; this.vel.z = 0; }

      // Ease the cart onto the centre line of the track — the axis
      // perpendicular to travel, which also sweeps it through curves.
      const cx = rail.x + 0.5, cz = rail.z + 0.5;
      const ease = Math.min(1, dt * 10);
      if (dir.x !== 0) this.pos.z += (cz - this.pos.z) * ease;
      else this.pos.x += (cx - this.pos.x) * ease;
    } else {
      this.physics(dt, { step: 0 });
    }

    // Lava destroys a cart (and its cargo) the moment it touches it.
    const lava = isLava(world.getBlock(
      Math.floor(this.pos.x), Math.floor(this.pos.y + 0.2), Math.floor(this.pos.z)));
    if (lava) {
      this.game.particles?.smoke(this.pos.x, this.pos.y + 0.3, this.pos.z, 6);
      this.breakCart(false);
      return;
    }

    // Carry the rider along (the player syncs itself; this keeps the camera
    // exactly on the cart instead of a frame behind it).
    if (this.rider === 'player') {
      const p = this.game.player;
      if (p.riding === this && !p.dead) p.pos.set(this.pos.x, this.pos.y + 0.12, this.pos.z);
    }

    const o = this.object3d;
    if (o) {
      o.position.set(this.pos.x, this.pos.y, this.pos.z);
      o.rotation.y = Math.atan2(this.lastDir.x, this.lastDir.z);
      const l = this.lightAt();
      if (this.hurtFlash > 0) tintModel(this.model, Math.min(1.8, l + 1.1), l * 0.35, l * 0.35);
      else tintModel(this.model, l, l, l);
    }
  }

  /** Right-clicked with an empty hand: board it. */
  interact() {
    return this.rider ? null : 'mount';
  }

  mount(player) {
    if (this.rider) return false;
    this.rider = 'player';
    player.riding = this;
    return true;
  }

  dismount() {
    this.rider = null;
    this.push = 0;
  }

  damage(amount) {
    this.health -= amount;
    this.hurtFlash = 0.35;
    if (this.health <= 0) this.breakCart(true);
  }

  /** A hit shoves the cart along; on rails it simply gains speed. */
  knockback(fromX, fromZ, power = 1) {
    let dx = this.pos.x - fromX, dz = this.pos.z - fromZ;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l; dz /= l;
    if (this.onRail) {
      this.vel.x += dx * 2 * power;
      this.vel.z += dz * 2 * power;
    } else {
      this.vel.x += dx * 2.4 * power;
      this.vel.z += dz * 2.4 * power;
      this.vel.y = Math.max(this.vel.y, 1.2 * power);
    }
  }

  breakCart(dropStack) {
    this.dismount();
    if (dropStack) {
      this.game.dropItem(this.pos.x, this.pos.y + 0.25, this.pos.z, { key: 'minecart', count: 1 });
    }
    this.remove();
  }

  serialize() {
    return {
      t: 'cart',
      x: this.pos.x, y: this.pos.y, z: this.pos.z,
      vx: this.vel.x, vy: this.vel.y, vz: this.vel.z,
    };
  }
}
