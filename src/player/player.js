import { isWater, isLava } from '../world/blocks.js';
// ============================================================================
// The player: movement, AABB collision against the voxel grid, swimming,
// sneaking, sprinting, and the full survival loop (health, hunger, armour,
// oxygen, XP, fall damage, fire and drowning).
// ============================================================================

import * as THREE from 'three';
import { PLAYER, GAMEMODE, DIFFICULTY_MULT, CHUNK_Y } from '../constants.js';
import { collisionBoxes, overlaps } from '../world/shapes.js';
import { B, BLOCKS, IS_SOLID, HEIGHT_OF } from '../world/blocks.js';
import { Inventory } from './inventory.js';
import { getItem, POTION_EFFECTS } from '../crafting/items.js';
import { CART_RIDER_PUSH, CART_RIDER_BRAKE } from '../world/rails.js';

const HW = PLAYER.WIDTH / 2;
const EPS = 1e-4;

/** XP required to advance from `level` to `level + 1` (vanilla curve). */
export function xpToNext(level) {
  if (level < 16) return 2 * level + 7;
  if (level < 31) return 5 * level - 38;
  return 9 * level - 158;
}

export class Player {
  constructor(world, settings) {
    this.world = world;
    this.settings = settings;
    this.pos = new THREE.Vector3(0, 80, 0);
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.riding = null;      // the Minecart this player is sitting in, if any

    this.onGround = false;
    this.inWater = false;
    this.headInWater = false;
    this.inLava = false;
    this.inPortal = 0;
    this.onLadder = false;
    this.sneaking = false;
    this.sprinting = false;
    this.blocking = false;      // shield raised in the off hand
    this.blockTime = 0;
    // Taking a blocked hit knocks the shield down for a moment; it comes back
    // up by itself while the button is still held.
    this.shieldDown = 0;
    this.flying = false;
    this.gamemode = GAMEMODE.SURVIVAL;
    this.difficulty = 2;

    this.health = 20;
    this.maxHealth = 20;
    this.hunger = 20;
    this.saturation = 5;
    this.exhaustion = 0;
    this.air = 300;
    this.maxAir = 300;
    this.xp = 0;
    this.level = 0;
    this.xpProgress = 0;
    this.fireTicks = 0;
    this.hurtTime = 0;
    this.invuln = 0;
    this.regenTimer = 0;
    this.starveTimer = 0;
    this.fallDistance = 0;
    this.dead = false;
    this.deathCause = '';

    this.inventory = new Inventory();
    this.spawnPoint = null;
    this.perspective = 0;    // 0 first person, 1 back, 2 front

    this.bobTime = 0;
    this.bobAmount = 0;
    this.swingTime = 0;
    this.stepDistance = 0;
    this.lastStepDistance = 0;
    this.eatTime = 0;
    this.bowCharge = 0;

    this.effects = {};
    this._tmp = new THREE.Vector3();
  }

  get eyeY() { return this.riding ? 1.15 : (this.sneaking ? PLAYER.EYE_SNEAK : PLAYER.EYE); }
  eyePosition(out = new THREE.Vector3()) {
    return out.set(this.pos.x, this.pos.y + this.eyeY, this.pos.z);
  }
  lookDir(out = new THREE.Vector3()) {
    const cp = Math.cos(this.pitch);
    return out.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
  }

  aabb(x = this.pos.x, y = this.pos.y, z = this.pos.z) {
    return { x0: x - HW, y0: y, z0: z - HW, x1: x + HW, y1: y + PLAYER.HEIGHT, z1: z + HW };
  }

  // -------------------------------------------------------------------------
  // Collision
  // -------------------------------------------------------------------------
  _blockedBy(box) {
    const w = this.world;
    const x0 = Math.floor(box.x0), x1 = Math.floor(box.x1 - EPS);
    const y0 = Math.floor(box.y0)-1, y1 = Math.floor(box.y1 - EPS);
    const z0 = Math.floor(box.z0), z1 = Math.floor(box.z1 - EPS);
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) {
          const b = w.getBlock(x, y, z);
          if (!IS_SOLID[b]) continue;
          if(collisionBoxes(w,x,y,z,b).some(b=>overlaps(box,b)))return true;
        }
      }
    }
    return false;
  }

  /** Move one axis and snap out of anything solid. Returns true if blocked. */
  _moveAxis(axis, amount) {
    if (amount === 0) return false;
    const w = this.world;
    const p = this.pos;
    p[axis] += amount;
    const box = this.aabb();
    const x0 = Math.floor(box.x0), x1 = Math.floor(box.x1 - EPS);
    const y0 = Math.floor(box.y0)-1, y1 = Math.floor(box.y1 - EPS);
    const z0 = Math.floor(box.z0), z1 = Math.floor(box.z1 - EPS);
    let hit = false;
    let limit = amount > 0 ? Infinity : -Infinity;

    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) {
          const b = w.getBlock(x, y, z);
          if (!IS_SOLID[b]) continue;
          for(const [bx0,by0,bz0,bx1,by1,bz1] of collisionBoxes(w,x,y,z,b)){
          if (box.x1 <= bx0 + EPS || box.x0 >= bx1 - EPS) continue;
          if (box.y1 <= by0 + EPS || box.y0 >= by1 - EPS) continue;
          if (box.z1 <= bz0 + EPS || box.z0 >= bz1 - EPS) continue;
          hit = true;
          if (axis === 'x') limit = amount > 0 ? Math.min(limit, bx0 - HW) : Math.max(limit, bx1 + HW);
          else if (axis === 'z') limit = amount > 0 ? Math.min(limit, bz0 - HW) : Math.max(limit, bz1 + HW);
          else limit = amount > 0 ? Math.min(limit, by0 - PLAYER.HEIGHT) : Math.max(limit, by1);
          }
        }
      }
    }
    if (hit && Number.isFinite(limit)) {
      p[axis] = limit + (amount > 0 ? -EPS : EPS);
    }
    return hit;
  }

  /**
   * Collision is resolved per axis against whatever the new AABB overlaps, so a
   * single large step can jump clean over a one-block floor. Terminal velocity
   * is 60 m/s, which at a hitched 100 ms frame is six blocks in one go — split
   * anything long into sub-block steps.
   */
  move(dx, dy, dz) {
    const far = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz));
    const steps = far > 0.4 ? Math.min(24, Math.ceil(far / 0.4)) : 1;
    if (steps === 1) { this._moveStep(dx, dy, dz); return; }
    const sx = dx / steps, sy = dy / steps, sz = dz / steps;
    // Every sub-step runs, including after landing — bailing out early would
    // silently throw away the rest of this frame's horizontal movement.
    for (let i = 0; i < steps; i++) this._moveStep(sx, sy, sz);
  }

  _moveStep(dx, dy, dz) {
    const startY = this.pos.y;
    const hitY = this._moveAxis('y', dy);
    if (hitY) {
      if (dy < 0) {
        this.onGround = true;
        if (this.fallDistance > 0) this._onLand();
      } else this.vel.y = Math.min(0, this.vel.y);
      this.vel.y = 0;
    } else if (dy < 0) {
      this.onGround = false;
    }

    const preX = this.pos.x, preZ = this.pos.z;
    const hitX = this._moveAxis('x', dx);
    const hitZ = this._moveAxis('z', dz);

    // Auto step-up over single blocks.
    if ((hitX || hitZ) && this.onGround && !this.inWater) {
      const saveX = this.pos.x, saveZ = this.pos.z, saveY = this.pos.y;
      this.pos.x = preX; this.pos.z = preZ;
      const upBox = this.aabb(this.pos.x, this.pos.y + PLAYER.STEP_HEIGHT, this.pos.z);
      if (!this._blockedBy(upBox)) {
        this.pos.y += PLAYER.STEP_HEIGHT;
        const h2 = this._moveAxis('x', dx);
        const h3 = this._moveAxis('z', dz);
        if ((h2 && hitX) && (h3 && hitZ)) {
          this.pos.x = saveX; this.pos.z = saveZ; this.pos.y = saveY;
        } else {
          // settle back down onto the ledge
          this._moveAxis('y', -PLAYER.STEP_HEIGHT + 0.001);
        }
      } else {
        this.pos.x = saveX; this.pos.z = saveZ;
      }
    }

    // Sneak edge guard: refuse a step that would leave nothing underfoot.
    if (this.sneaking && this.onGround && !this.flying) {
      if (!this._groundUnder(this.pos.x, this.pos.y, this.pos.z)) {
        if (this._groundUnder(preX, this.pos.y, this.pos.z)) this.pos.x = preX;
        else if (this._groundUnder(this.pos.x, this.pos.y, preZ)) this.pos.z = preZ;
        else { this.pos.x = preX; this.pos.z = preZ; }
      }
    }
    void startY;
  }

  /** Hop out of a minecart, stepping to whichever side has room. */
  exitCart() {
    const cart = this.riding;
    this.riding = null;
    if (!cart) return;
    cart.dismount?.();
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    for (const [ox, oz] of [[rx, rz], [-rx, -rz], [0, 0]]) {
      const nx = cart.pos.x + ox * 1.1, nz = cart.pos.z + oz * 1.1;
      if (!this._blockedBy(this.aabb(nx, cart.pos.y, nz))) { this.pos.set(nx, cart.pos.y, nz); return; }
    }
  }

  _groundUnder(x, y, z) {
    const yb = Math.floor(y - 0.08);
    for (const [ox, oz] of [[-HW + 0.02, -HW + 0.02], [HW - 0.02, -HW + 0.02], [-HW + 0.02, HW - 0.02], [HW - 0.02, HW - 0.02]]) {
      const b = this.world.getBlock(Math.floor(x + ox), yb, Math.floor(z + oz));
      if (IS_SOLID[b]) return true;
    }
    return false;
  }

  // -------------------------------------------------------------------------
  // Per-frame update
  // -------------------------------------------------------------------------
  update(dt, input, game) {
    if (this.dead) return;
    const creative = this.gamemode === GAMEMODE.CREATIVE;

    // --- look ---
    if ((input.locked || input.touchMode) && input.enabled) {
      const [dx, dy] = input.takeLook();
      this.yaw -= dx;
      this.pitch -= dy;
      const lim = Math.PI / 2 - 0.001;
      this.pitch = Math.max(-lim, Math.min(lim, this.pitch));
      this.yaw = ((this.yaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    }

    this._sampleEnvironment();

    // Riding a minecart: the cart drives the position, the player just looks
    // and throttles. Forward rolls, back brakes, sneak hops out.
    if (this.riding) {
      const cart = this.riding;
      if (cart.dead) { this.riding = null; }
      else {
        let push = 0;
        if (input.enabled) {
          if (input.isDown('forward')) push += CART_RIDER_PUSH;
          if (input.isDown('back')) push -= CART_RIDER_BRAKE;
        }
        cart.push = push;
        if (input.enabled && input.justPressed('sneak')) { this.exitCart(); return; }
        this.pos.set(cart.pos.x, cart.pos.y + 0.12, cart.pos.z);
        this.vel.set(0, 0, 0);
        this.fallDistance = 0;
        this._sampleEnvironment();
        return;
      }
    }

    // --- intent ---
    let ix = 0, iz = 0;
    if (input.enabled) {
      if (input.isDown('forward')) iz -= 1;
      if (input.isDown('back')) iz += 1;
      if (input.isDown('left')) ix -= 1;
      if (input.isDown('right')) ix += 1;
      // Touch joystick: an analog vector, so gentle pushes walk slowly.
      if (input.touchMove) { ix += input.touchMove.x; iz += input.touchMove.z; }
    }
    const moving = Math.hypot(ix, iz) > 0.001;
    // A raised shield stays up only while the button is being held; the timer
    // is topped up each frame by useOffhand.
    if (this.blockTime > 0) { this.blockTime -= dt; if (this.blockTime <= 0) this.blocking = false; }
    if (this.shieldDown > 0) this.shieldDown -= dt;
    this.sneaking = input.enabled && input.isDown('sneak') && !this.flying;
    const wantSprint = input.enabled &&
      (input.isDown('sprint') || input.sprintToggle) && iz < 0 && !this.sneaking && this.hunger > 6;
    this.sprinting = wantSprint && moving;

    if (creative && input.enabled && input.justPressed('jump')) {
      const now = performance.now();
      if (now - (this._lastJump || 0) < 300) { this.flying = !this.flying; this.vel.y = 0; }
      this._lastJump = now;
    }
    if (!creative) this.flying = false;

    // --- horizontal speed ---
    let speed = PLAYER.WALK;
    if (this.sprinting) speed = PLAYER.SPRINT;
    if (this.sneaking) speed = PLAYER.SNEAK;
    if (this.inWater) speed = PLAYER.SWIM;
    if (this.inLava) speed = 1.2;
    if (this.flying) speed = this.sprinting ? 16 : 9;
    const slow = this._slowFactor();
    speed *= slow;
    if(this.effects.speed>0) speed*=1.2;
    if (this.eatTime > 0 || this.bowCharge > 0) speed *= 0.35;

    let mx = 0, mz = 0;
    if (moving) {
      // Build the movement basis from the same vectors the camera uses, rather
      // than hand-rolled sin/cos algebra. `forward` is exactly lookDir() with
      // the pitch flattened out; `right` is cross(forward, up). Diagonals are
      // normalised first so strafing isn't faster than walking straight.
      // Diagonals normalise to 1; analog joystick input keeps its magnitude
      // below 1 so a soft push really does mean a slow walk.
      const len = Math.hypot(ix, iz);
      const mag = Math.min(1, len);
      const nx = (ix / len) * mag, nz = (iz / len) * mag;
      const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
      const fwdX = -sin, fwdZ = -cos;
      const rightX = cos, rightZ = -sin;
      // iz is -1 for "forward" (W) and +1 for "back" (S), hence the negation.
      mx = rightX * nx - fwdX * nz;
      mz = rightZ * nx - fwdZ * nz;
    }

    const slippery = this._slippery();
    const accel = this.onGround ? (slippery ? 6 : 34) : 9;
    const friction = this.onGround ? (slippery ? 1.2 : 14) : 1.6;
    const targetX = mx * speed, targetZ = mz * speed;
    if (this.inWater || this.inLava || this.flying) {
      this.vel.x += (targetX - this.vel.x) * Math.min(1, dt * 8);
      this.vel.z += (targetZ - this.vel.z) * Math.min(1, dt * 8);
    } else {
      this.vel.x += (targetX - this.vel.x) * Math.min(1, dt * (moving ? accel : friction));
      this.vel.z += (targetZ - this.vel.z) * Math.min(1, dt * (moving ? accel : friction));
    }

    // --- vertical ---
    const jumpHeld = input.enabled && input.isDown('jump');
    if (this.flying) {
      let vy = 0;
      if (jumpHeld) vy += speed;
      if (this.sneaking || (input.enabled && input.isDown('sneak'))) vy -= speed;
      this.vel.y += (vy - this.vel.y) * Math.min(1, dt * 10);
    } else if (this.onLadder) {
      this.vel.y = jumpHeld ? 3.2 : (moving || this.sneaking ? (this.sneaking ? -1.2 : -1.6) : -0.6);
      this.fallDistance = 0;
    } else if (this.inWater || this.inLava) {
      const buoy = this.inLava ? -6 : -3.2;
      this.vel.y += buoy * dt * 4;
      if (jumpHeld) this.vel.y = Math.min(this.vel.y + 16 * dt, this.inLava ? 1.4 : 3.0);
      this.vel.y = Math.max(this.vel.y, -3.2);
      this.fallDistance = 0;
    } else {
      this.vel.y -= PLAYER.GRAVITY * dt;
      if (this.vel.y < -PLAYER.TERMINAL) this.vel.y = -PLAYER.TERMINAL;
      if (jumpHeld && this.onGround) {
        this.vel.y = PLAYER.JUMP_VELOCITY;
        this.onGround = false;
        if (this.sprinting) { this.vel.x += mx * 1.6; this.vel.z += mz * 1.6; }
        this.addExhaustion(this.sprinting ? 0.2 : 0.05);
      }
    }

    const before = this.pos.y;
    this.move(this.vel.x * dt, this.vel.y * dt, this.vel.z * dt);
    if (!this.onGround && this.vel.y < 0 && !this.inWater && !this.flying && !this.onLadder) {
      this.fallDistance += Math.max(0, before - this.pos.y);
    }
    if (this.pos.y < -12) this.hurt(4, 'fell out of the world', game);

    // --- head bob & step sounds ---
    const hspeed = Math.hypot(this.vel.x, this.vel.z);
    this.stepDistance += hspeed * dt;
    this.bobTime += hspeed * dt * 1.9;
    this.bobAmount += ((this.onGround ? Math.min(hspeed / PLAYER.WALK, 1.4) : 0) - this.bobAmount) * Math.min(1, dt * 8);
    if (this.onGround && this.stepDistance - this.lastStepDistance > 1.9) {
      this.lastStepDistance = this.stepDistance;
      game?.onFootstep?.(this);
      this.addExhaustion(this.sprinting ? 0.1 : 0.01);
    }
    if (this.swingTime > 0) this.swingTime = Math.max(0, this.swingTime - dt * 3.4);

    this._survival(dt, game);
  }

  _slippery() {
    const b = this.world.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y - 0.1), Math.floor(this.pos.z));
    return BLOCKS[b]?.slip > 0;
  }

  _slowFactor() {
    const b = this.world.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y - 0.05), Math.floor(this.pos.z));
    const s = BLOCKS[b]?.slow || 0;
    return 1 - s;
  }

  _sampleEnvironment() {
    const w = this.world;
    const fx = Math.floor(this.pos.x), fz = Math.floor(this.pos.z);
    const feet = w.getBlock(fx, Math.floor(this.pos.y + 0.1), fz);
    const head = w.getBlock(fx, Math.floor(this.pos.y + this.eyeY), fz);
    const mid = w.getBlock(fx, Math.floor(this.pos.y + 0.9), fz);
    const wet=(offset,fn)=>{const Y=this.pos.y+offset,id=w.getBlock(fx,Math.floor(Y),fz);
      return fn(id)&&Y-Math.floor(Y)<(fn(w.getBlock(fx,Math.floor(Y)+1,fz))?1:HEIGHT_OF[id]);};
    this.inWater = wet(.1,isWater)||wet(.9,isWater);
    this.headInWater = wet(this.eyeY,isWater);
    this.inLava = wet(.1,isLava)||wet(.9,isLava);
    this.onLadder = feet === B.LADDER || mid === B.LADDER;
    const inPortalBlock = feet === B.NETHER_PORTAL || mid === B.NETHER_PORTAL || head === B.NETHER_PORTAL;
    this.inPortal = inPortalBlock ? Math.min(1, this.inPortal + 0.02) : 0;
    this.inEndPortal = feet === B.END_PORTAL || mid === B.END_PORTAL;
  }

  _onLand() {
    const d = this.fallDistance;
    this.fallDistance = 0;
    if (d > 3.2 && this.gamemode !== GAMEMODE.CREATIVE) {
      const under = this.world.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y - 0.2), Math.floor(this.pos.z));
      const mult = BLOCKS[under]?.fallDamageMult ?? 1;
      const dmg = Math.floor((d - 3) * mult);
      if (dmg > 0) this._pendingFall = dmg;
    }
  }

  // -------------------------------------------------------------------------
  // Survival
  // -------------------------------------------------------------------------
  addExhaustion(v) {
    if (this.gamemode === GAMEMODE.CREATIVE || this.difficulty === 0) return;
    this.exhaustion += v;
    while (this.exhaustion >= 4) {
      this.exhaustion -= 4;
      if (this.saturation > 0) this.saturation = Math.max(0, this.saturation - 1);
      else this.hunger = Math.max(0, this.hunger - 1);
    }
  }

  _survival(dt, game) {
    if (this.hurtTime > 0) this.hurtTime = Math.max(0, this.hurtTime - dt);
    if (this.invuln > 0) this.invuln = Math.max(0, this.invuln - dt);
    if (this.eatTime > 0) this.eatTime = Math.max(0, this.eatTime - dt);

    if (this._pendingFall) {
      const d = this._pendingFall; this._pendingFall = 0;
      this.hurt(d, 'hit the ground too hard', game, true);
      game?.audio?.play('hurt', { rate: 0.8 });
    }

    if (this.gamemode === GAMEMODE.CREATIVE) { this.health = this.maxHealth; return; }

    this.addExhaustion(dt * (this.sprinting ? 0.1 : 0.005));

    // oxygen
    if (this.headInWater) {
      this.air -= dt * 60;
      if (this.air <= 0) {
        this.air = 0;
        this.starveTimer += dt;
        if (this.starveTimer > 1) { this.starveTimer = 0; this.hurt(2, 'drowned', game, true); }
      }
    } else {
      this.air = Math.min(this.maxAir, this.air + dt * 180);
    }

    // fire / lava
    if (this.inLava) { this.fireTicks = Math.max(this.fireTicks, 8); }
    if (this.fireTicks > 0) {
      this.fireTicks -= dt;
      this._fireTick = (this._fireTick || 0) + dt;
      if (this._fireTick > 0.5) {
        this._fireTick = 0;
        this.hurt(this.inLava ? 4 : 1, 'burned to death', game, true);
      }
      if (this.inWater) this.fireTicks = 0;
    }

    // contact damage (cactus, magma)
    const bx = Math.floor(this.pos.x), bz = Math.floor(this.pos.z);
    const under = this.world.getBlock(bx, Math.floor(this.pos.y - 0.1), bz);
    const inside = this.world.getBlock(bx, Math.floor(this.pos.y + 0.5), bz);
    const hurtRate = Math.max(BLOCKS[under]?.hurt || 0, BLOCKS[inside]?.hurt || 0);
    if (hurtRate > 0 && !this.inLava) {
      this._contactTimer = (this._contactTimer || 0) + dt;
      if (this._contactTimer > 0.5) {
        this._contactTimer = 0;
        this.hurt(hurtRate, inside === B.CACTUS || under === B.CACTUS ? 'was pricked to death' : 'burned to death', game, true);
      }
    }

    // hunger regen / starvation
    if (this.hunger >= 18 && this.health < this.maxHealth) {
      this.regenTimer += dt;
      if (this.regenTimer > 3.5) {
        this.regenTimer = 0;
        this.health = Math.min(this.maxHealth, this.health + 1);
        this.addExhaustion(6);
      }
    } else this.regenTimer = 0;

    if (this.hunger <= 0) {
      this._starve = (this._starve || 0) + dt;
      if (this._starve > 4) {
        this._starve = 0;
        const floor = this.difficulty === 1 ? 10 : this.difficulty === 2 ? 1 : 0;
        if (this.health > floor) this.hurt(1, 'starved to death', game, true);
      }
    }
  }

  /**
   * @param bypassArmor true for fall/drown/starve style damage
   * @param from optional {x, z} of whatever dealt the hit, so a shield can
   *   tell an attack to the face from one in the back
   */
  hurt(amount, cause, game, bypassArmor = false, from = null) {
    if (this.dead || this.gamemode === GAMEMODE.CREATIVE) return false;
    if(this.effects.fire_resistance>0 && cause==='burned to death')return false;
    if (this.invuln > 0 && !bypassArmor) return false;
    let dmg = amount;
    // A raised shield stops the hit outright, the way Minecraft's does, as long
    // as the attack comes from in front. Environmental damage ignores it.
    if (this.blocking && !bypassArmor && this.shieldFacing(from)) {
      const main=this.inventory.held();
      const sh = getItem(main?.key)?.useAction==='block' ? main : this.inventory.offhand;
      if (sh && sh.dur !== undefined) {
        sh.dur -= 1;
        if (sh.dur <= 0) { if(sh===main)this.inventory.setHeld(null);else this.inventory.offhand=null; this.inventory.onBreak?.();this.inventory.changed(); }
      }
      // The impact knocks it down; holding the button raises it again shortly.
      this.blocking = false;
      this.blockTime = 0;
      this.shieldDown = 0.45;
      this.invuln = 0.5;
      game?.onShieldBlock?.(amount, from);
      return false;
    }
    if (!bypassArmor) {
      const { points, toughness } = this.inventory.armorPoints();
      const reduce = Math.min(20, Math.max(points / 5, points - dmg / (2 + toughness / 4))) / 25;
      dmg *= 1 - reduce;
      this.inventory.damageArmor(1);
    }
    this.health -= dmg;
    this.hurtTime = 0.45;
    this.invuln = bypassArmor ? 0.15 : 0.5;
    this.addExhaustion(0.1);
    game?.onPlayerHurt?.(dmg, cause);
    if (this.health <= 0) {
      this.health = 0;
      this.dead = true;
      this.deathCause = cause || 'died';
      game?.onPlayerDeath?.(cause);
    }
    return true;
  }

  /**
   * Is the shield between us and the hit? Minecraft blocks within the forward
   * half-circle. An attacker we can't locate counts as in front, so a call site
   * that forgets to say where the blow came from still gets defended.
   */
  shieldFacing(from) {
    if (!from) return true;
    const dx = from.x - this.pos.x, dz = from.z - this.pos.z;
    const l = Math.hypot(dx, dz);
    if (l < 1e-4) return true;
    // lookDir's horizontal part: yaw 0 faces -Z
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    return (dx / l) * fx + (dz / l) * fz > 0;
  }

  heal(n) { this.health = Math.min(this.maxHealth, this.health + n); }

  eat(itemKey) {
    const food = getItem(itemKey)?.food;
    if (!food) return false;
    if (this.hunger >= 20 && food.effect !== 'regen') return false;
    this.hunger = Math.min(20, this.hunger + food.hunger);
    this.saturation = Math.min(this.hunger, this.saturation + food.sat);
    if (food.effect === 'regen') this.heal(4);
    if (food.effect === 'poison') this.hurt(1, 'ate something questionable', null, true);
    if (food.effect === 'hunger') this.exhaustion += 3;
    return true;
  }

  applyPotion(potion) {
    if(!potion)return;
    if(potion.effect==='healing') this.heal(4);
    else if(POTION_EFFECTS[potion.effect]) this.effects[potion.effect]=potion.seconds;
  }
  tickEffects(dt) {
    for(const key of Object.keys(this.effects)){
      const old=this.effects[key], next=Math.max(0,old-dt);
      if(key==='regeneration' && !this.dead)this.heal(Math.max(0,Math.floor(old/2)-Math.floor(next/2)));
      if(next>0)this.effects[key]=next;else delete this.effects[key];
    }
  }
  spendLevels(n) {
    if(this.level<n)return false;
    const fraction=this.xp/xpToNext(this.level);
    this.level-=n;this.xp=Math.floor(fraction*xpToNext(this.level));
    this.xpProgress=this.xp/xpToNext(this.level);return true;
  }

  addXp(points) {
    if (points <= 0) return;
    this.xp += points;
    while (this.xp >= xpToNext(this.level)) {
      this.xp -= xpToNext(this.level);
      this.level++;
      this._leveled = true;
    }
    this.xpProgress = this.xp / xpToNext(this.level);
  }

  takeLevelUpFlag() { const f = this._leveled; this._leveled = false; return f; }

  respawn(pos) {
    this.dead = false;
    this.effects = {};
    this.health = this.maxHealth;
    this.hunger = 20;
    this.saturation = 5;
    this.exhaustion = 0;
    this.air = this.maxAir;
    this.fireTicks = 0;
    this.fallDistance = 0;
    this.vel.set(0, 0, 0);
    this.inPortal = 0;
    if (pos) this.pos.set(pos[0], pos[1], pos[2]);
  }

  swing() { this.swingTime = 1; }

  serialize() {
    return {
      pos: [this.pos.x, this.pos.y, this.pos.z],
      yaw: this.yaw, pitch: this.pitch,
      health: this.health, hunger: this.hunger, saturation: this.saturation,
      dead:this.dead,deathCause:this.deathCause,
      air: this.air, xp: this.xp, level: this.level,
      gamemode: this.gamemode, difficulty: this.difficulty,
      spawnPoint: this.spawnPoint,
      inventory: this.inventory.serialize(),
      perspective: this.perspective,
      effects: {...this.effects},
    };
  }

  deserialize(o) {
    if (!o) return;
    this.pos.set(o.pos[0], Math.min(CHUNK_Y - 2, o.pos[1]), o.pos[2]);
    this.yaw = o.yaw ?? 0; this.pitch = o.pitch ?? 0;
    this.health = o.health ?? 20;
    this.dead=!!o.dead||this.health<=0;this.deathCause=o.deathCause||'';
    this.hunger = o.hunger ?? 20;
    this.saturation = o.saturation ?? 5;
    this.air = o.air ?? this.maxAir;
    this.xp = o.xp ?? 0; this.level = o.level ?? 0;
    this.gamemode = o.gamemode ?? GAMEMODE.SURVIVAL;
    this.difficulty = o.difficulty ?? 2;
    this.spawnPoint = o.spawnPoint ?? null;
    this.perspective = o.perspective ?? 0;
    this.effects={};
    for(const [key,value] of Object.entries(o.effects||{}))if(POTION_EFFECTS[key]&&Number.isFinite(value)&&value>0)
      this.effects[key]=Math.min(POTION_EFFECTS[key].seconds,value);
    this.inventory.deserialize(o.inventory);
    this.xpProgress = this.xp / xpToNext(this.level);
  }

  get damageMultiplier() { return DIFFICULTY_MULT[this.difficulty] ?? 1; }
}
