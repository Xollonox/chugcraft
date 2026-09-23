// ============================================================================
// Game interaction: aiming, mining, breaking, placing and using items.
//
// Split out of main.js (see game-shell.js); mixed onto Game.prototype at boot.
// ============================================================================

import { CHUNK_Y, PLAYER } from '../constants.js';
import {
  B, BLOCKS, IS_SOLID, IS_DOOR, IS_BED, BEDS, DOORS, DOOR_FAMILY, HINGES, isWater, isLava,
} from './blocks.js';
import { getItem } from '../crafting/items.js';
import { materialSound } from '../engine/audio.js';
import { canTill } from './ticking.js';
import {
  ItemEntity, Arrow, PrimedTnt,
} from '../entities/projectiles.js';
import { newFurnace } from '../crafting/smelting.js';

const CRACK_STAGES = 10;
/** Seconds between swings while the attack button is held down. */
const ATTACK_REPEAT = 0.45;

export const GameInteract = {
  // =========================================================================
  // Interaction
  // =========================================================================
  updateInteraction(dt) {
    const p = this.player;
    const inp = this.input;
    const eye = p.eyePosition();
    const dir = p.lookDir();

    // hotbar selection
    const w = inp.takeWheel();
    if (w) p.inventory.selected = ((p.inventory.selected + w) % 9 + 9) % 9;
    for (let i = 1; i <= 9; i++) {
      if (inp.justPressed('hotbar' + i)) p.inventory.selected = i - 1;
    }

    if(this._useHeld!==p.inventory.held()){
      this.bowHold=0;this.eatHold=0;this.drinkHold=0;p.bowCharge=0;p.blocking=false;
      this._useHeld=p.inventory.held();
    }
    this.lookHit = this.world.raycast(eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, PLAYER.REACH);
    const hl = this.renderer.highlight;
    if (this.lookHit) {
      hl.visible = true;
      const bh = BLOCKS[this.lookHit.id];
      const h = bh.render === 'layer' || bh.render === 'liquid' ? bh.height : 1;
      hl.position.set(this.lookHit.x + 0.5, this.lookHit.y + h / 2, this.lookHit.z + 0.5);
      hl.scale.set(1, h, 1);
    } else hl.visible = false;

    // --- attack ---
    if (inp.justPressed('attack')) {
      const ent = this.pickEntity(PLAYER.REACH);
      p.swing();
      if (ent) { this.attackEntity(ent); this._attackCd = ATTACK_REPEAT; }
      else if (!this.lookHit) this.audio.play('click', { volume: 0.2, rate: 0.6 });
    } else if (inp.isDown('attack')) {
      // Holding the attack button keeps swinging at whatever is in reach, on a
      // fixed cooldown. Touch hold-to-attack depends on this (a held finger
      // only ever produces one "just pressed"), and it saves desktop players
      // from having to click frantically at a chasing mob.
      this._attackCd = (this._attackCd || 0) - dt;
      if (this._attackCd <= 0) {
        const ent = this.pickEntity(PLAYER.REACH);
        if (ent) { p.swing(); this.attackEntity(ent); this._attackCd = ATTACK_REPEAT; }
      }
    } else this._attackCd = 0;
    if (inp.isDown('attack') && this.lookHit && !this.pickEntity(PLAYER.REACH)) {
      this.tickMining(dt);
    } else {
      this.mineProgress = 0;
      this.mineTarget = null;
      this.renderer.crack.visible = false;
    }
    if (inp.isDown('attack') && p.swingTime <= 0) p.swing();

    // --- use / place ---
    const held = p.inventory.held();
    const item = held ? getItem(held.key) : null;

    if (inp.justPressed('use')) this.startUse(held, item);
    if (!this.containers.open && inp.isDown('use') && held===p.inventory.held()) this.holdUse(dt, held, item);
    if (inp.justReleased('use')) this.endUse(held, item);

    // pick block
    if (inp.justPressed('pick') && this.lookHit) {
      const def = BLOCKS[this.lookHit.id];
      if (def.itemKey && getItem(def.itemKey)) {
        if (p.gamemode === GAMEMODE.CREATIVE) {
          const slot = p.inventory.selected;
          p.inventory.slots[slot] = makeStack(def.itemKey, 1);
          p.inventory.changed();
        } else p.inventory.pickBlock(def.itemKey);
      }
    }
  },

  tickMining(dt) {
    const hit = this.lookHit;
    const p = this.player;
    const def = BLOCKS[hit.id];
    if (def.hardness < 0) { this.renderer.crack.visible = false; return; }

    const key = `${hit.x},${hit.y},${hit.z}`;
    if (this.mineTarget !== key) { this.mineTarget = key; this.mineProgress = 0; }

    if (p.gamemode === GAMEMODE.CREATIVE) { this.breakBlock(hit.x, hit.y, hit.z, true); return; }

    const held = p.inventory.held();
    const tool = held ? getItem(held.key)?.tool : null;
    let speed = 1;
    if (tool && (tool.type === def.tool || (tool.type === 'shears' && (def.tool === 'shears' || def.key === 'wool')))) {
      speed = tool.speed;
    }
    if (p.inWater && !p.onGround) speed *= 0.2;
    else if (p.inWater) speed *= 0.5;
    if (!p.onGround) speed *= 0.35;

    const canHarvest = def.tier === 0 ||
      (tool && tool.type === def.tool && tool.tier >= def.tier);
    const time = (def.hardness * (canHarvest ? 1.5 : 5)) / speed;
    this.mineProgress += dt / Math.max(0.05, time);

    const stage = Math.min(CRACK_STAGES - 1, Math.floor(this.mineProgress * CRACK_STAGES));
    this.renderer.crack.visible = true;
    this.renderer.crack.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
    this.renderer.setCrackStage(stage);

    this._digSoundT = (this._digSoundT || 0) + dt;
    if (this._digSoundT > 0.28) {
      this._digSoundT = 0;
      this.audio.play(materialSound(def), { volume: 0.34, rate: 1.4, pos: [hit.x, hit.y, hit.z] });
      this.particles.blockHit(hit.x, hit.y, hit.z, hit.id, hit.nx, hit.ny, hit.nz, 1);
    }

    if (this.mineProgress >= 1) {
      this.breakBlock(hit.x, hit.y, hit.z, canHarvest);
      this.mineProgress = 0;
      if (held && getItem(held.key)?.tool) {
        if (p.inventory.damageHeld(1)) this.audio.play('dig_wood', { rate: 0.5, volume: 0.8 });
      }
      p.addExhaustion(0.005);
    }
  },

  breakBlock(x, y, z, harvest) {
    const id = this.world.getBlock(x, y, z);
    if (id === B.AIR) return;
    const def = BLOCKS[id];
    if (def.hardness < 0) return;

    this.particles.blockBreak(x, y, z, id);
    this.audio.play(materialSound(def), { volume: 0.75, pos: [x, y, z] });

    if (harvest && this.player.gamemode !== GAMEMODE.CREATIVE) {
      const drops = this.rollDrops(def);
      for (const d of drops) this.dropItem(x + 0.5, y + 0.5, z + 0.5, d);
      if (def.xp) this.spawnXp(x + 0.5, y + 0.5, z + 0.5, def.xp);
    }

    // block entity contents spill out
    const data = this.world.getEntityData(x, y, z);
    if (data && data.items) {
      for (const s of data.items) if (s) this.dropItem(x + 0.5, y + 0.6, z + 0.5, s);
      this.world.deleteEntityData(x, y, z);
    }
    if (data && data.furnace) {
      for (const s of [data.furnace.input, data.furnace.fuel, data.furnace.output]) {
        if (s) this.dropItem(x + 0.5, y + 0.6, z + 0.5, s);
      }
      this.world.deleteEntityData(x, y, z);
    }

    this.world.setBlock(x, y, z, B.AIR);
    this.stats.blocksBroken++;
    this.afterBlockChange(x, y, z);
    // A door is one object in two blocks: break either half and the other goes
    // too, or you're left with a plank hovering in a doorway.
    if (IS_DOOR[id]) {
      for (const dy of [-1, 1]) {
        if (!IS_DOOR[this.world.getBlock(x, y + dy, z)]) continue;
        this.world.setBlock(x, y + dy, z, B.AIR);
        this.afterBlockChange(x, y + dy, z);
      }
    }
    // Same for a bed's other half.
    if (IS_BED[id]) {
      const partner = this.bedPartner(x, y, z, id);
      if (partner) {
        this.world.setBlock(partner[0], partner[1], partner[2], B.AIR);
        this.afterBlockChange(partner[0], partner[1], partner[2]);
      }
    }
    this.checkAdvancementsForBlock(id);
    this.refreshRailPowerAround(x, y, z);

    // deactivate a nether portal whose frame was broken
    if (id === B.OBSIDIAN) this.breakPortalAround(x, y, z);
  },

  rollDrops(def) {
    const out = [];
    if (def.dropAlt && Math.random() < def.dropAlt[1]) {
      out.push({ key: def.dropAlt[0], count: 1 });
      return out;
    }
    if (!def.drop) return out;
    const n = def.dropMin === def.dropMax
      ? def.dropMin
      : def.dropMin + Math.floor(Math.random() * (def.dropMax - def.dropMin + 1));
    if (n > 0) out.push({ key: def.drop, count: n });
    return out;
  },

  /** Support checks + falling sand/gravel, run after any block change. */
  afterBlockChange(x, y, z) {
    // plants and torches need something under them
    for (const [dx, dy, dz] of [[0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]) {
      const nx = x + dx, ny = y + dy, nz = z + dz;
      const b = this.world.getBlock(nx, ny, nz);
      const d = BLOCKS[b];
      if (!d) continue;
      if ((d.render === 'cross' || b === B.TORCH || b === B.SNOW_LAYER) && b !== B.AIR) {
        if (!IS_SOLID[this.world.getBlock(nx, ny - 1, nz)]) {
          const drops = this.rollDrops(d);
          for (const dr of drops) this.dropItem(nx + 0.5, ny + 0.5, nz + 0.5, dr);
          this.world.setBlock(nx, ny, nz, B.AIR);
        }
      }
    }
    // falling blocks
    for (let yy = y; yy < Math.min(CHUNK_Y - 1, y + 24); yy++) {
      const b = this.world.getBlock(x, yy, z);
      if (b === B.AIR) continue;
      if (!BLOCKS[b].gravity) break;
      let ty = yy;
      while (ty > 1 && this.world.getBlock(x, ty - 1, z) === B.AIR) ty--;
      if (ty !== yy) {
        this.world.setBlock(x, yy, z, B.AIR);
        this.world.setBlock(x, ty, z, b);
      }
    }
  },

  /** Trade the selected hotbar slot with the off hand. */
  swapOffhand() {
    const inv = this.player.inventory;
    const held = inv.held();
    if (!held && !inv.offhand) return false;
    inv.slots[inv.selected] = inv.offhand || null;
    inv.offhand = held || null;
    inv.changed();
    this.audio.play('click', { volume: 0.45 });
    return true;
  },

  // -------------------------------------------------------------------------
  startUse(held, item) {
    const p = this.player;
    const hit = this.lookHit;

    // Use (not Attack) opens the existing trading screen on a villager.
    // The old game had the UI and NPC flag, but no path connecting the two.
    const npc=this.pickEntity(PLAYER.REACH);
    if(npc && (npc.category==='mob'||npc.category==='vehicle') && !this.input.isDown('sneak') && this.interactEntity(npc, held, item)) return;

    // Hoe on grass or dirt makes farmland; needs open sky above the block.
    if (item?.tool?.type === 'hoe' && hit && canTill(this.world, hit.x, hit.y, hit.z)) {
      this.world.setBlock(hit.x, hit.y, hit.z, B.FARMLAND);
      this.afterBlockChange(hit.x, hit.y, hit.z);
      this.audio.play('hoe_till', { pos: [hit.x + 0.5, hit.y + 1, hit.z + 0.5], volume: 0.7 });
      if (p.gamemode !== GAMEMODE.CREATIVE) p.inventory.damageHeld(1);
      p.swing();
      return;
    }
    // 1. interact with the targeted block
    if (hit) {
      const def = BLOCKS[hit.id];
      if (def.interact && !this.input.isDown('sneak')) {
        if (this.interactBlock(hit, def, held, item)) return;
      }
    }

    // Minecraft's hand priority: the main hand goes first, and the off hand
    // only gets a turn when the main hand has nothing to do with a right
    // click — i.e. it isn't a placeable block and has no use action of its own.
    // A minecart goes down on the aimed block: straight onto a rail when there
    // is one, otherwise it lands on top and can be pushed onto a track.
    if (item?.key === 'minecart' && hit) { this.placeCart(hit); return; }

    const mainHasUse = !!item && (item.useAction || item.food ||
      (item.block !== null && item.block !== undefined));
    if (!mainHasUse) {
      const off = this.player.inventory.offhand;
      const offItem = off ? getItem(off.key) : null;
      if (offItem && this.useOffhand(off, offItem)) return;
    }

    // 2. item actions
    if (item?.useAction) {
      switch (item.useAction) {
        case 'fill_bottle': return void this.fillBottle();
        case 'drink': this.drinkHold=0;this._drinkingKey=held.key;return;
        case 'block': if(p.shieldDown<=0){p.blocking=true;p.blockTime=0.3;} return;
        case 'ignite': return void this.useFlintAndSteel(hit);
        case 'throw_pearl': {
          this.throwItem('ender_pearl');
          return;
        }
        case 'throw_snowball': { this.throwItem('snowball'); return; }
        case 'throw_eye': { this.throwEye(); return; }
        case 'bucket_fill': {
          const e=p.eyePosition(), d=p.lookDir();
          return void this.useBucket(this.world.raycast(e.x,e.y,e.z,d.x,d.y,d.z,PLAYER.REACH,b=>b!==B.AIR&&(!(isWater(b)||isLava(b))||b===B.WATER||b===B.LAVA)),false);
        }
        case 'bucket_place': return void this.useBucket(hit, true);
        case 'bow': { this.bowHold = 0; return; }
        case 'bone_meal': return void this.useBoneMeal(hit);
        case 'fish': return void this.useFishingRod();
        default: break;
      }
    }
    if (item?.food) {
      if (p.hunger < 20 || item.food.effect === 'regen') { this.eatHold = 0; return; }
    }

    // 3. place a block
    if (item?.block !== null && item?.block !== undefined) this.placeBlock(item);
  },

  /**
   * Right-click with whatever is in the off hand. Returns false when it has
   * nothing to offer, so the main hand can carry on.
   */
  useOffhand(stack, item) {
    const p = this.player;
    if (item.useAction === 'block') {
      // A shield: raise it, unless a blocked hit has just knocked it down.
      // hurt() stops the damage outright while it is up.
      if (p.shieldDown <= 0) { p.blocking = true; p.blockTime = 0.35; }
      return true;
    }
    if (item.block !== null && item.block !== undefined) {
      const before = p.inventory.offhand?.count ?? 0;
      this.placeBlock(item, { fromOffhand: true });
      return (p.inventory.offhand?.count ?? 0) !== before || p.gamemode === GAMEMODE.CREATIVE;
    }
    if (item.food && (p.hunger < 20 || item.food.effect === 'regen')) {
      this.eatHold = 0;
      this._eatingOffhand = true;
      return true;
    }
    if (item.useAction === 'ignite') { this.useFlintAndSteel(this.lookHit); return true; }
    void stack;
    return false;
  },
};
