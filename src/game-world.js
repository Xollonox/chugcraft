// ============================================================================
// Game world systems: item drops, XP, mob interaction (feeding/taming/shearing
// /trading), bone meal, fishing, feedback hooks, furnaces and ambience.
//
// Split out of main.js (see game-shell.js); mixed onto Game.prototype at boot.
// ============================================================================

import { DIM, GAMEMODE } from '../constants.js';
import { B, BLOCKS, isWater, isLava } from './blocks.js';
import { getItem } from '../crafting/items.js';
import { materialSound } from '../engine/audio.js';
import { boneMeal } from './ticking.js';
import { PROFESSIONS } from '../entities/husbandry.js';
import { Bobber, rollFishingLoot } from '../entities/bobber.js';
import { tickFurnace, isLit } from '../crafting/smelting.js';

export const GameWorld = {
  // =========================================================================
  // Items, XP, drops
  // =========================================================================
  dropItem(x, y, z, stack, opts) {
    if (!stack || !stack.key || stack.count <= 0) return null;
    const e = new ItemEntity(this, x, y, z, { ...stack }, opts);
    return this.entities.add(e);
  },

  spawnXp(x, y, z, amount) {
    let left = amount;
    let guard = 0;
    while (left > 0 && guard++ < 40) {
      const n = Math.min(left, 1 + Math.floor(Math.random() * 4));
      left -= n;
      this.entities.add(new XpOrb(this, x, y, z, n));
    }
  },

  onItemPickup(key, count) {
    this.audio.play('pop', { volume: 0.5, throttle: 0.05 });
    const inv = this.player.inventory;
    for (let i = 0; i < 9; i++) {
      if (inv.slots[i]?.key === key) {
        this.hud.slotEls[i].classList.add('pop');
        setTimeout(() => this.hud.slotEls[i]?.classList.remove('pop'), 240);
        break;
      }
    }
    this.checkAdvancementsForItem(key);
    void count;
  },

  onMobKilled(mob) {
    this.stats.mobsKilled++;
    void mob;
  },

  onMobBred(a, b, baby) {
    this.stats.animalsBred = (this.stats.animalsBred || 0) + 1;
    this.unlockAdvancement?.('husbandry');
    void a; void b; void baby;
  },

  // =========================================================================
  // 3.1: feeding, taming, shearing, trading, farming, fishing
  // =========================================================================

  /** Right-click on a mob. Returns true when the click was consumed. */
  interactEntity(mob, held, item) {
    const p = this.player;
    const result = mob.interact?.(held);
    if (!result) return false;
    const creative = p.gamemode === GAMEMODE.CREATIVE;
    const name = MOBS[mob.kind] ? mob.kind.replace('_', ' ') : 'animal';
    switch (result) {
      case 'fed':
        if (!creative) p.inventory.consumeHeld(1);
        p.swing();
        return true;
      case 'tamed':
        if (!creative) p.inventory.consumeHeld(1);
        this.toast('Tamed!', `The ${name} is yours now`, held?.key);
        this.unlockAdvancement?.('best_friends');
        p.swing();
        return true;
      case 'tame_failed':
        if (!creative) p.inventory.consumeHeld(1);
        p.swing();
        return true;
      case 'sheared':
        if (!creative) p.inventory.damageHeld(1);
        p.swing();
        return true;
      case 'mount': {
        if (mob.mount?.(p)) {
          this.audio.play('click', { rate: 0.8, volume: 0.5 });
          this.toast('Minecart', 'W / S to roll, sneak to hop out', 'minecart');
          this.unlockAdvancement('on_a_rail');
        }
        return true;
      }
      case 'sit': this.toast('Wolf', 'Sitting — click again to follow'); return true;
      case 'stand': this.toast('Wolf', 'Following you'); return true;
      case 'trade': {
        const prof = PROFESSIONS[mob.profession];
        this.openContainer('trade', { trades: mob.trades, title: prof ? `${prof.name} Villager` : 'Villager', mob });
        return true;
      }
      default: return false;
    }
    void item;
  },

  useBoneMeal(hit) {
    if (!hit) return;
    const p = this.player;
    // Bone meal on the side of a lawn targets the grass block, on a crop the crop.
    // Aiming at the soil under a crop should still feed the crop.
    let grew = boneMeal(this.world, hit.x, hit.y, hit.z);
    if (!grew && hit.ny === 1) grew = boneMeal(this.world, hit.x, hit.y + 1, hit.z);
    if (!grew) return;
    this.afterBlockChange(hit.x, hit.y, hit.z);
    for (let dy = 0; dy <= 8; dy++) this.afterBlockChange(hit.x, hit.y + dy, hit.z);
    this.particles.hearts(hit.x + 0.5, hit.y + 0.9, hit.z + 0.5, 4);
    this.audio.play('dig_grass', { pos: [hit.x + 0.5, hit.y + 0.5, hit.z + 0.5], rate: 1.3, volume: 0.6 });
    if (p.gamemode !== GAMEMODE.CREATIVE) p.inventory.consumeHeld(1);
    p.swing();
  },

  useFishingRod() {
    const p = this.player;
    p.swing();
    if (this.bobber && !this.bobber.dead) {
      // Reel in.
      const b = this.bobber;
      if (b.biting) {
        const loot = rollFishingLoot(Math.random, (k) => !!getItem(k));
        const dx = p.pos.x - b.pos.x, dz = p.pos.z - b.pos.z;
        const l = Math.hypot(dx, dz) || 1;
        this.dropItem(b.pos.x, b.pos.y + 0.3, b.pos.z, { key: loot.key, count: loot.count },
          { vx: (dx / l) * Math.min(9, l * 2.2), vy: 6 + l * 0.35, vz: (dz / l) * Math.min(9, l * 2.2), delay: 0.6 });
        this.spawnXp(p.pos.x, p.pos.y + 0.5, p.pos.z, 1 + Math.floor(Math.random() * 6));
        this.stats.fishCaught = (this.stats.fishCaught || 0) + 1;
        this.unlockAdvancement?.('fishy_business');
        this.audio.play('splash', { pos: [b.pos.x, b.pos.y, b.pos.z], volume: 0.7 });
        if (p.gamemode !== GAMEMODE.CREATIVE) p.inventory.damageHeld(1);
      } else {
        this.audio.play('bow', { rate: 1.8, volume: 0.35 });
      }
      b.remove();
      this.bobber = null;
      return;
    }
    // Cast.
    const eye = p.eyePosition();
    const dir = p.lookDir();
    const rainy = this.weather.intensity > 0.4;
    this.bobber = this.entities.add(new Bobber(this, eye.x + dir.x * 0.5, eye.y - 0.1, eye.z + dir.z * 0.5, dir, rainy));
    this.audio.play('bow', { rate: 1.6, volume: 0.45 });
  },

  onCrafted(recipe) {
    this.stats.itemsCrafted += recipe.out.count;
    this.checkAdvancementsForItem(recipe.out.key);
  },

  onFootstep(p) {
    const b = this.world.getBlock(Math.floor(p.pos.x), Math.floor(p.pos.y - 0.2), Math.floor(p.pos.z));
    if (b === B.AIR) return;
    const def = BLOCKS[b];
    const s = materialSound(def).replace('dig_', 'step_');
    this.audio.play(s in { step_grass: 1, step_stone: 1, step_wood: 1, step_sand: 1, step_snow: 1 } ? s : 'step_stone',
      { volume: 0.28, pos: [p.pos.x, p.pos.y, p.pos.z] });
    if (this.settings.get('particles') !== false && Math.random() < 0.4) {
      this.particles.footstep(p.pos.x, p.pos.y, p.pos.z, b);
    }
  },

  onPlayerHurt(dmg, cause) {
    this.audio.play('hurt', { volume: 0.8 });
    this.shake(0.35);
    void dmg; void cause;
  },

  /** A hit the shield stopped: a dull clonk and a shove, but no damage. */
  onShieldBlock(amount, from) {
    this.audio.play('shield_block', { volume: 0.7 });
    this.shake(0.18);
    const p = this.player;
    if (from) {
      const dx = p.pos.x - from.x, dz = p.pos.z - from.z;
      const l = Math.hypot(dx, dz) || 1;
      const push = Math.min(3.4, 1.2 + amount * 0.2);
      p.vel.x += (dx / l) * push;
      p.vel.z += (dz / l) * push;
    }
  },

  onPlayerDeath(cause) {
    this.stats.deaths++;
    this.lastDeath={pos:[Math.floor(this.player.pos.x),Math.floor(this.player.pos.y),Math.floor(this.player.pos.z)],dim:this.world.dim};
    document.getElementById('death-location').textContent=`Last location: ${this.lastDeath.pos.join(', ')} · ${['Overworld','Nether','End'][this.world.dim]}`;
    this.state = 'dead';
    this.input.enabled = false;
    this.input.exitLock();
    this.containers.close();
    this.audio.play('death', { volume: 0.9 });
    if (!this.gamerules.keepInventory) {
      const drop = this.player.inventory.drainAll();
      for (const s of drop) {
        this.dropItem(this.player.pos.x, this.player.pos.y + 0.6, this.player.pos.z, s, { delay: 2 });
      }
    }
    const score = Math.round(this.player.xp + this.player.level * 7 + this.stats.blocksBroken);
    this.menus.showDeath(cause, score);
    this.save();
  },

  respawn() {
    const p = this.player;
    let pos = p.spawnPoint;
    this.menus.hideAll();
    this.hud.show(true);
    if (this.world.dim !== DIM.OVERWORLD) {
      // travelTo drives the loading screen and hands control back on arrival
      p.respawn(pos || [0.5, 80, 0.5]);
      this.travelTo(DIM.OVERWORLD, pos || [0.5, 80, 0.5], { silent: true });
      return;
    }
    if (!pos) pos = this.world.findSpawn(0, 0) || [0.5, 90, 0.5];
    const safe = this.world.surfaceAt(Math.floor(pos[0]), Math.floor(pos[2]));
    p.respawn([pos[0], safe > 0 ? safe : pos[1], pos[2]]);
    this.state = 'playing';
    this.input.enabled = true;
    this.input.requestLock();
  },

  shake(a) { this.shakeAmount = Math.min(1.2, this.shakeAmount + a); },
  toast(t, s, i) { this.hud.toast(t, s, i); },
  blockName(id) { return BLOCKS[id]?.name || 'Air'; },

  hintCrystals() {
    if (this._crystalHintTimer > 0) return;
    this._crystalHintTimer = 6;
    this.toast('The End Crystals', 'Destroy the crystals on the pillars — they heal the dragon', 'ender_eye');
  },

  // =========================================================================
  // Furnaces & ambience
  // =========================================================================
  tickFurnaces(dt) {
    this._furnaceAcc = (this._furnaceAcc || 0) + dt;
    const ticks = Math.floor(this._furnaceAcc * 20);
    if (ticks <= 0) return;
    this._furnaceAcc -= ticks / 20;
    const store = this.world.blockEntities[this.world.dim];
    for (const [key, data] of store) {
      if (!data.furnace) continue;
      const changed = tickFurnace(data.furnace, Math.min(ticks, 40));
      if (!changed) continue;
      const [x, y, z] = key.split(',').map(Number);
      const cur = this.world.getBlock(x, y, z);
      const lit = isLit(data.furnace);
      if (lit && cur === B.FURNACE) this.world.setBlock(x, y, z, B.FURNACE_LIT, { noSave: false });
      else if (!lit && cur === B.FURNACE_LIT) this.world.setBlock(x, y, z, B.FURNACE, { noSave: false });
      if (lit && Math.random() < 0.25) {
        this.particles.smoke(x + 0.5, y + 1.05, z + 0.5, 1, 0.35);
      }
    }
    if (this.containers.open && this.containers.type === 'furnace') this.containers.refresh();
  },

  updateAmbience(dt) {
    this._ambSample=(this._ambSample||0)+dt;
    if(this._ambSample<0.1)return;
    dt=this._ambSample;this._ambSample=0;
    const p = this.player;
    const w = this.world;
    let water = 0, lava = 0, portal = 0, furnace=0;
    const px = Math.floor(p.pos.x), py = Math.floor(p.pos.y), pz = Math.floor(p.pos.z);
    for (let dy = -3; dy <= 3; dy += 2) {
      for (let dz = -5; dz <= 5; dz += 2) {
        for (let dx = -5; dx <= 5; dx += 2) {
          const b = w.getBlock(px + dx, py + dy, pz + dz);
          if(b===B.FURNACE_LIT)furnace++;
          if (isWater(b)) water++;
          else if (isLava(b)) lava++;
          else if (b === B.NETHER_PORTAL || b === B.END_PORTAL) portal++;
        }
      }
    }
    this.audio.setLoop('water_amb', Math.min(0.6, water / 40) * (p.headInWater ? 2 : 1));
    this.audio.setLoop('lava_amb', Math.min(0.7, lava / 30));
    this.audio.setLoop('portal_hum', Math.min(0.6, portal / 6));
    this.audio.setLoop('furnace_amb',Math.min(0.4,furnace*0.2));

    // Cave ambience. It only creeps in when you are both deep and properly
    // roofed over, so a shaded valley at ground level stays silent.
    let roof = 0;
    for (let dy = 2; dy <= 24; dy += 2) {
      if (w.getBlock(px, py + dy, pz)) roof++;
    }
    const depth = Math.max(0, Math.min(1, (56 - py) / 40));
    this.audio.setLoop('cave_amb', roof >= 4 ? depth * 0.55 : 0);

    if (this.settings.get('particles') !== false) {
      // torch flames and portal sparkles near the player
      this._ambT = (this._ambT || 0) + dt;
      if (this._ambT > 0.08) {
        this._ambT = 0;
        for (let i = 0; i < 6; i++) {
          const x = px + Math.floor((Math.random() - 0.5) * 18);
          const y = py + Math.floor((Math.random() - 0.5) * 10);
          const z = pz + Math.floor((Math.random() - 0.5) * 18);
          const b = w.getBlock(x, y, z);
          if (b === B.TORCH) this.particles.flame(x + 0.5, y + 0.62, z + 0.5, 1);
          else if (b === B.NETHER_PORTAL || b === B.END_PORTAL) this.particles.portalSparkle(x + 0.5, y + 0.5, z + 0.5, 1);
          else if (isLava(b) && w.getBlock(x, y + 1, z) === B.AIR && Math.random() < 0.25) {
            this.particles.flame(x + 0.5, y + 1, z + 0.5, 1);
          }
        }
      }
    }
  },

  onLightning(x, y, z) {
    const d = Math.hypot(x - this.player.pos.x, z - this.player.pos.z);
    if (d < 4) this.player.hurt(5, 'was struck by lightning', this);
    const b = this.world.getBlock(x, y - 1, z);
    if (BLOCKS[b]?.flammable && this.world.getBlock(x, y, z) === B.AIR && Math.random() < 0.4) {
      this.world.setBlock(x, y, z, B.FIRE);
      setTimeout(() => {
        if (this.world && this.world.getBlock(x, y, z) === B.FIRE) this.world.setBlock(x, y, z, B.AIR);
      }, 8000);
    }
  },
};
