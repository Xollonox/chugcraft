// ============================================================================
// Game actions: held-item use timers, doors, block placement, minecarts and
// entity picking/attacking.
//
// Split out of main.js (see game-shell.js); mixed onto Game.prototype at boot.
// ============================================================================

import * as THREE from 'three';
import { CHUNK_Y, GAMEMODE, PLAYER } from '../constants.js';
import {
  B, BLOCKS, IS_SOLID, IS_DOOR, DOORS, DOOR_FAMILY, BEDS, IS_BED, HINGES,
} from './blocks.js';
import { isRailId, isPoweredRailId, poweredRailIdFor } from './rails.js';
import { getItem } from '../crafting/items.js';
import { materialSound } from '../engine/audio.js';
import { canPlantOn, soilFor } from './ticking.js';
import { Minecart } from '../entities/minecart.js';
import { Arrow, PrimedTnt } from '../entities/projectiles.js';
import { newFurnace } from '../crafting/smelting.js';

export const GameActions = {
  fillBottle() {
    const p=this.player,e=p.eyePosition(),d=p.lookDir();
    for(let t=0;t<=PLAYER.REACH;t+=0.1){
      const id=this.world.getBlock(Math.floor(e.x+d.x*t),Math.floor(e.y+d.y*t),Math.floor(e.z+d.z*t));
      if(id===B.WATER){
        if(p.inventory.transact({glass_bottle:1},[{key:'water_bottle',count:1}]))this.audio.play('bucket');
        else this.toast('Inventory full','Make room for a water bottle.');
        return;
      }
      if(IS_SOLID[id])return;
    }
    this.toast('Water needed','Aim the bottle at nearby water.');
  },

  holdUse(dt, held, item) {
    const p = this.player;
    if(item?.useAction==='block') {if(p.shieldDown<=0){p.blocking=true;p.blockTime=0.2;}return;}
    if(item?.useAction==='drink'){
      if(this._drinkingKey!==held.key){this._drinkingKey=held.key;this.drinkHold=0;}
      this.drinkHold=(this.drinkHold||0)+dt;p.eatTime=0.2;
      if(this.drinkHold>=1.5){
        this.drinkHold=0;
        if(p.inventory.transact({[held.key]:1},[{key:'glass_bottle',count:1}])){
          p.applyPotion(item.potion);this.audio.play('drink',{volume:0.8});
          this.toast(item.name,item.potion?.effect?item.desc:'Bottle returned');
        }
      }return;
    }
    if(this._eatingOffhand){
      const s=p.inventory.offhand,it=getItem(s?.key);
      if(!it?.food){this._eatingOffhand=false;return;}
      this.eatHold+=dt;p.eatTime=0.2;
      if(this.eatHold>=1.5){this.eatHold=0;if(p.eat(s.key)){
        if(--s.count<=0)p.inventory.offhand=null;p.inventory.changed();this.audio.play('eat');
      }}return;
    }
    // Keep the shield up for as long as the button is down. Only startUse used
    // to raise it, so it dropped again the moment its short timer expired.
    const mainHasUse = !!item && (item.useAction || item.food ||
      (item.block !== null && item.block !== undefined));
    if (!mainHasUse) {
      const off = p.inventory.offhand;
      const offItem = off ? getItem(off.key) : null;
      if (offItem?.useAction === 'block') {
        // Held down, the shield stays up — and comes back up by itself once
        // the recoil from a blocked hit has passed.
        if (p.shieldDown <= 0) { p.blocking = true; p.blockTime = 0.2; }
        return;
      }
    }
    if (item?.food && (p.hunger < 20 || item.food.effect === 'regen')) {
      this.eatHold += dt;
      p.eatTime = 0.2;
      if (this.eatHold % 0.28 < dt) {
        this.audio.play('eat', { volume: 0.5 });
        this.particles.blockBreak(p.pos.x - 0.2, p.pos.y + 1.2, p.pos.z - 0.2, B.DIRT, 2);
      }
      if (this.eatHold >= 1.5) {
        this.eatHold = 0;
        if (p.eat(held.key)) {
          p.inventory.consumeHeld(1);
          if (held.key === 'water_bucket' || held.key === 'lava_bucket') p.inventory.add('bucket', 1);
          this.audio.play('eat', { rate: 0.8, volume: 0.8 });
        }
      }
      return;
    }
    if (item?.useAction === 'bow') {
      this.bowHold = Math.min(1, this.bowHold + dt / 1.1);
      p.bowCharge = this.bowHold;
      return;
    }
    // continuous placement while the button is held
    if (item?.block !== null && item?.block !== undefined) {
      this._placeTimer = (this._placeTimer || 0) + dt;
      if (this._placeTimer > 0.22) { this._placeTimer = 0; this.placeBlock(item); }
    }
  },

  endUse(held, item) {
    this.drinkHold=0;this._drinkingKey=null;this.player.blocking=false;this._eatingOffhand=false;
    this.eatHold = 0;
    this.player.eatTime = 0;
    this._placeTimer = 0;
    if (item?.useAction === 'bow' && this.bowHold > 0.12) {
      const p = this.player;
      const hasArrow = p.gamemode === GAMEMODE.CREATIVE || p.inventory.count('arrow') > 0;
      if (hasArrow) {
        if (p.gamemode !== GAMEMODE.CREATIVE) p.inventory.remove('arrow', 1);
        const eye = p.eyePosition();
        const dir = p.lookDir();
        this.entities.add(new Arrow(this, eye.x, eye.y, eye.z, dir, this.bowHold, 'player'));
        this.audio.play('bow', { volume: 0.8 });
        p.inventory.damageHeld(1);
      }
    }
    this.bowHold = 0;
    this.player.bowCharge = 0;
  },

  /**
   * Swing a door. Both halves move together, so grabbing either the top or the
   * bottom opens the whole thing — which is what you expect and what stops a
   * door from ending up half open and half shut.
   */
  toggleDoor(x, y, z) {
    const w = this.world;
    let baseY = y;
    while (IS_DOOR[w.getBlock(x, baseY - 1, z)]) baseY--;
    let swung = 0;
    for (let dy = 0; dy < 2; dy++) {
      const id = w.getBlock(x, baseY + dy, z);
      const d = DOORS[id];
      if (!d) break;
      w.setBlock(x, baseY + dy, z, d.toggle);
      swung++;
    }
    if (!swung) return false;
    const nowOpen = DOORS[w.getBlock(x, baseY, z)].open;
    this.audio.play(nowOpen ? 'door_open' : 'door_close', { pos: [x, y, z], volume: 0.75 });
    return true;
  },

  interactBlock(hit, def, held, item) {
    const { x, y, z } = hit;
    switch (def.interact) {
      case 'enchant': case 'anvil': case 'brew': this.openContainer(def.interact,{pos:[x,y,z]});return true;
      case 'crafting': this.openContainer('crafting'); return true;
      case 'furnace': {
        const data = this.world.getEntityData(x, y, z, () => ({ type: 'furnace', furnace: newFurnace() }));
        if (!data.furnace) data.furnace = newFurnace();
        data.pos = [x, y, z];
        this.openContainer('furnace', data);
        return true;
      }
      case 'chest': {
        const data = this.world.getEntityData(x, y, z, () => ({ type: 'chest', items: [] }));
        if (!data.items) data.items = [];
        while (data.items.length < 27) data.items.push(null);
        this.openContainer('chest', data);
        return true;
      }
      case 'door': return this.toggleDoor(x, y, z);
      case 'hinge': { const h=HINGES[this.world.getBlock(x,y,z)];if(!h)return false;
        this.world.setBlock(x,y,z,h.toggle);this.audio.play(h.open?'door_close':'door_open',{pos:[x,y,z]});return true; }
      case 'bed': return this.useBed(x, y, z);
      case 'tnt': {
        if (held && held.key === 'flint_and_steel') {
          this.world.setBlock(x, y, z, B.AIR);
          this.entities.add(new PrimedTnt(this, x + 0.5, y, z + 0.5));
          this.player.inventory.damageHeld(1);
          this.audio.play('ignite', { pos: [x, y, z] });
          return true;
        }
        return false;
      }
      case 'end_frame': {
        if (held && held.key === 'ender_eye') {
          this.world.setBlock(x, y, z, B.END_PORTAL_FRAME_EYE);
          this.player.inventory.consumeHeld(1);
          this.audio.play('teleport', { pos: [x, y, z], rate: 0.7 });
          this.particles.portalSparkle(x + 0.5, y + 1, z + 0.5, 12);
          this.checkEndPortal(x, y, z);
          return true;
        }
        return false;
      }
      default: return false;
    }
    void item;
  },

  /** Take one block off whichever hand placed it. */
  _consumePlaced(opts) {
    const inv = this.player.inventory;
    if (!opts.fromOffhand) { inv.consumeHeld(1); return; }
    const s = inv.offhand;
    if (!s) return;
    s.count--;
    if (s.count <= 0) inv.offhand = null;
    inv.changed();
  },

  placeBlock(item, opts = {}) {
    const hit = this.lookHit;
    if (!hit) return;
    const p = this.player;
    const targetDef = BLOCKS[hit.id];
    let bx = hit.x, by = hit.y, bz = hit.z;
    if (!targetDef.replaceable) { bx += hit.nx; by += hit.ny; bz += hit.nz; }
    if (by < 0 || by >= CHUNK_Y) return;

    const existing = this.world.getBlock(bx, by, bz);
    if (existing !== B.AIR && !BLOCKS[existing].replaceable) return;

    let id = item.block;
    // Crops and saplings only take on their soil (farmland, soul sand, grass).
    if (soilFor(id) !== undefined && !canPlantOn(id, this.world.getBlock(bx, by - 1, bz))) return;
    // torches on walls, snow-style layering, etc.
    if (id === B.TORCH && !IS_SOLID[this.world.getBlock(bx, by - 1, bz)]) {
      const supported = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) =>
        IS_SOLID[this.world.getBlock(bx + dx, by, bz + dz)]);
      if (!supported) return;
    }
    if (BLOCKS[id].render === 'cross' && !IS_SOLID[this.world.getBlock(bx, by - 1, bz)]) return;
    // Rails need solid ground to sit on.
    if (isRailId(id) && !IS_SOLID[this.world.getBlock(bx, by - 1, bz)]) return;

    // A bed is two blocks long, laid away from the player. Both halves need
    // solid footing and clear space before either is placed.
    if (IS_BED[id]) {
      const facingZ = Math.abs(Math.cos(p.yaw)) >= Math.abs(Math.sin(p.yaw));
      const dir = facingZ
        ? [0, 0, Math.cos(p.yaw) > 0 ? -1 : 1]
        : [Math.sin(p.yaw) > 0 ? -1 : 1, 0, 0];
      const hx = bx + dir[0], hz = bz + dir[2];
      const clear = (X, Z) => {
        const at = this.world.getBlock(X, by, Z);
        return (at === B.AIR || BLOCKS[at].replaceable) && IS_SOLID[this.world.getBlock(X, by - 1, Z)];
      };
      if (!clear(bx, bz) || !clear(hx, hz)) return;
      // You lie with your feet where you stood and your head further away.
      const foot = facingZ ? B.BED : B.BED_X;
      const head = facingZ ? B.BED_HEAD : B.BED_HEAD_X;
      this.world.setBlock(bx, by, bz, foot);
      this.world.setBlock(hx, by, hz, head);
      if (p.gamemode !== GAMEMODE.CREATIVE) p.inventory.consumeHeld(1);
      this.stats.blocksPlaced++;
      p.swing();
      this.audio.play(materialSound(BLOCKS[foot]), { volume: 0.6, rate: 0.9, pos: [bx, by, bz] });
      this.afterBlockChange(bx, by, bz);
      this.afterBlockChange(hx, by, hz);
      return;
    }

    // A door is two blocks tall and faces the way you're standing: it needs
    // headroom, solid footing, and an orientation before anything is placed.
    if (IS_DOOR[id]) {
      if (by + 1 >= CHUNK_Y) return;
      if (!IS_SOLID[this.world.getBlock(bx, by - 1, bz)]) return;
      const above = this.world.getBlock(bx, by + 1, bz);
      if (above !== B.AIR && !BLOCKS[above].replaceable) return;
      const facingZ = Math.abs(Math.cos(p.yaw)) >= Math.abs(Math.sin(p.yaw));
      id = DOOR_FAMILY[id][facingZ?0:1];
      this.world.setBlock(bx, by, bz, id);
      this.world.setBlock(bx, by + 1, bz, id);
      if (p.gamemode !== GAMEMODE.CREATIVE) this._consumePlaced(opts);
      this.stats.blocksPlaced++;
      p.swing();
      this.audio.play(materialSound(BLOCKS[id]), { volume: 0.6, rate: 0.9, pos: [bx, by, bz] });
      this.afterBlockChange(bx, by, bz);
      this.afterBlockChange(bx, by + 1, bz);
      return;
    }

    if (HINGES[id]) { const h=HINGES[id]; id=h.base+(Math.abs(Math.cos(p.yaw))>=Math.abs(Math.sin(p.yaw))?0:2); }

    // don't place inside the player
    if (IS_SOLID[id]) {
      const box = p.aabb();
      const h = BLOCKS[id].height;
      if (!(box.x1 <= bx || box.x0 >= bx + 1 || box.y1 <= by || box.y0 >= by + h ||
            box.z1 <= bz || box.z0 >= bz + 1)) return;
    }

    // Powered rails wake up immediately next to a redstone block.
    if (isPoweredRailId(id)) id = poweredRailIdFor(id, (X, Y, Z) => this.world.getBlock(X, Y, Z), bx, by, bz);
    this.world.setBlock(bx, by, bz, id);
    if (BLOCKS[id].entity === 'chest') {
      this.world.getEntityData(bx, by, bz, () => ({ type: 'chest', items: new Array(27).fill(null) }));
    }
    if (BLOCKS[id].entity === 'furnace') {
      this.world.getEntityData(bx, by, bz, () => ({ type: 'furnace', furnace: newFurnace() }));
    }
    if (p.gamemode !== GAMEMODE.CREATIVE) this._consumePlaced(opts);
    this.stats.blocksPlaced++;
    p.swing();
    this.audio.play(materialSound(BLOCKS[id]), { volume: 0.6, rate: 0.9, pos: [bx, by, bz] });
    this.particles.blockHit(bx, by, bz, id, 0, 1, 0);
    this.afterBlockChange(bx, by, bz);
  },

  /** Place a minecart on the aimed block, or straight onto a rail. */
  placeCart(hit) {
    const p = this.player;
    const onRail = isRailId(hit.id);
    const x = hit.x + 0.5, z = hit.z + 0.5;
    const y = onRail ? hit.y + 0.0625 : hit.y + 1;
    const hw = 0.45;
    const box = p.aabb();
    if (!(box.x1 <= x - hw || box.x0 >= x + hw || box.y1 <= y || box.y0 >= y + 0.72 ||
          box.z1 <= z - hw || box.z0 >= z + hw)) return;
    this.entities.add(new Minecart(this, x, y, z));
    if (p.gamemode !== GAMEMODE.CREATIVE) p.inventory.consumeHeld(1);
    p.swing();
    this.audio.play('click', { volume: 0.5, rate: 0.75 });
  },

  /**
   * Powered rails read a redstone block placed beside them, so every block
   * change re-checks the six neighbours for rails that need switching.
   */
  refreshRailPowerAround(x, y, z) {
    const world = this.world;
    const get = (X, Y, Z) => world.getBlock(X, Y, Z);
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const nx = x + dx, ny = y + dy, nz = z + dz;
      const id = world.getBlock(nx, ny, nz);
      if (!isPoweredRailId(id)) continue;
      const want = poweredRailIdFor(id, get, nx, ny, nz);
      if (want !== id) world.setBlock(nx, ny, nz, want);
    }
  },

  dropHeld(all) {
    const p = this.player;
    const s = p.inventory.held();
    if (!s) return;
    const n = all ? s.count : 1;
    const eye = p.eyePosition();
    const dir = p.lookDir();
    this.dropItem(eye.x + dir.x * 0.6, eye.y - 0.2, eye.z + dir.z * 0.6,
      { key: s.key, count: n, ...(s.dur !== undefined ? { dur: s.dur } : {}) },
      { vx: dir.x * 6, vy: dir.y * 6 + 1.6, vz: dir.z * 6, delay: 1.2 });
    p.inventory.consumeHeld(n);
  },

  // -------------------------------------------------------------------------
  pickEntity(maxDist) {
    const p = this.player;
    const eye = p.eyePosition();
    const dir = p.lookDir();
    const obstruction=this.world.raycast(eye.x,eye.y,eye.z,dir.x,dir.y,dir.z,maxDist,id=>IS_SOLID[id]===1);
    let best = null, bd = obstruction?Math.min(maxDist,obstruction.dist):maxDist;
    this.entities.each((e) => {
      if (e.dead || (e.category !== 'mob' && e.category !== 'crystal' && e.category !== 'boss' && e.category !== 'vehicle')) return;
      const c = new THREE.Vector3(e.pos.x, e.pos.y + e.height * 0.5, e.pos.z);
      const to = c.clone().sub(eye);
      const along = to.dot(dir);
      if (along < 0 || along > bd) return;
      const perp = to.clone().addScaledVector(dir, -along).length();
      const r = Math.max(e.width, e.height) * 0.5 + 0.35;
      if (perp > r) return;
      bd = along;
      best = e;
    });
    return best;
  },

  attackEntity(e) {
    const p = this.player;
    if (e === p.riding) return;   // don't club the cart you are sitting in
    const held = p.inventory.held();
    const tool = held ? getItem(held.key)?.tool : null;
    let dmg = (tool ? tool.damage : 1) + (p.effects.strength>0?3:0);
    if (p.gamemode === GAMEMODE.CREATIVE) dmg = 1000;
    const crit = !p.onGround && p.vel.y < -0.2;
    if (crit) { dmg *= 1.5; this.particles.crit(e.pos.x, e.pos.y + e.height * 0.6, e.pos.z, 5); }
    e.damage?.(dmg, 'player');
    e.knockback?.(p.pos.x, p.pos.z, 1);
    if (held && tool) p.inventory.damageHeld(1);
    p.addExhaustion(0.1);
    this.audio.play('dig_wood', { rate: 1.6, volume: 0.4 });
  },
};
