// ============================================================================
// Game portals & progression: nether/end portals and dimension travel, the
// End fight, victory, advancements, misc item actions, and sleeping.
//
// Split out of main.js (see game-shell.js); mixed onto Game.prototype at boot.
// ============================================================================

import { ADVANCEMENTS, CHUNK_Y, DIM, GAMEMODE, NETHER_SCALE } from '../constants.js';
import { B, BLOCKS, IS_SOLID, BEDS } from './blocks.js';
import { getItem, makeStack } from '../crafting/items.js';
import { nearestStronghold } from './structures.js';
import { ThrownItem, EnderEye } from '../entities/projectiles.js';
import { EndCrystal, EnderDragon } from '../entities/dragon.js';
import { WEATHER } from '../engine/weather.js';

export const GamePortals = {
  // =========================================================================
  // Portals & dimensions
  // =========================================================================
  useFlintAndSteel(hit) {
    if (!hit) return;
    const p = this.player;
    const { x, y, z, nx, ny, nz } = hit;
    if (hit.id === B.OBSIDIAN) {
      if (this.tryLightNetherPortal(x + nx, y + ny, z + nz)) {
        p.inventory.damageHeld(1);
        this.audio.play('ignite', { pos: [x, y, z] });
        this.unlockAdvancement('nether_ready');
        return;
      }
    }
    const fx = x + nx, fy = y + ny, fz = z + nz;
    if (this.world.getBlock(fx, fy, fz) === B.AIR && IS_SOLID[this.world.getBlock(fx, fy - 1, fz)]) {
      this.world.setBlock(fx, fy, fz, B.FIRE);
      this.audio.play('ignite', { pos: [fx, fy, fz] });
      p.inventory.damageHeld(1);
      setTimeout(() => {
        if (this.world && this.world.getBlock(fx, fy, fz) === B.FIRE) {
          this.world.setBlock(fx, fy, fz, B.AIR);
        }
      }, 6000 + Math.random() * 6000);
    }
  },

  /**
   * Flood-fill the air pocket enclosed by obsidian in either vertical plane.
   * Anything fully enclosed and at least 2x3 becomes a portal.
   */
  tryLightNetherPortal(sx, sy, sz) {
    for (const axis of ['x', 'z']) {
      const cells = this.floodPortal(sx, sy, sz, axis);
      if (cells) {
        for (const [x, y, z] of cells) this.world.setBlock(x, y, z, B.NETHER_PORTAL);
        this.audio.play('portal_travel', { volume: 0.6, rate: 1.4 });
        this.toast('Nether Portal', 'Step through to travel', 'obsidian');
        return true;
      }
    }
    return false;
  },

  floodPortal(sx, sy, sz, axis) {
    const w = this.world;
    if (w.getBlock(sx, sy, sz) !== B.AIR) return null;
    const seen = new Set();
    const stack = [[sx, sy, sz]];
    const cells = [];
    const dirs = axis === 'x'
      ? [[0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]
      : [[0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0]];
    let minY = Infinity, maxY = -Infinity, minO = Infinity, maxO = -Infinity;
    while (stack.length) {
      const [x, y, z] = stack.pop();
      const k = `${x},${y},${z}`;
      if (seen.has(k)) continue;
      seen.add(k);
      if (cells.length > 120) return null;
      const b = w.getBlock(x, y, z);
      if (b === B.OBSIDIAN) continue;
      if (b !== B.AIR && b !== B.FIRE) return null;
      cells.push([x, y, z]);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      const o = axis === 'x' ? z : x;
      minO = Math.min(minO, o); maxO = Math.max(maxO, o);
      for (const [dx, dy, dz] of dirs) stack.push([x + dx, y + dy, z + dz]);
    }
    if (!cells.length) return null;
    const h = maxY - minY + 1, wdt = maxO - minO + 1;
    if (h < 3 || wdt < 2 || h > 21 || wdt > 21) return null;
    // Verify the whole rectangle is air and fully framed.
    for (const [x, y, z] of cells) {
      for (const [dx, dy, dz] of dirs) {
        const b = w.getBlock(x + dx, y + dy, z + dz);
        if (b !== B.AIR && b !== B.OBSIDIAN && b !== B.FIRE) return null;
      }
    }
    return cells;
  },

  breakPortalAround(x, y, z) {
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      if (this.world.getBlock(x + dx, y + dy, z + dz) === B.NETHER_PORTAL) {
        this.clearPortalBlocks(x + dx, y + dy, z + dz);
      }
    }
  },

  clearPortalBlocks(sx, sy, sz) {
    const stack = [[sx, sy, sz]];
    const seen = new Set();
    let guard = 0;
    while (stack.length && guard++ < 200) {
      const [x, y, z] = stack.pop();
      const k = `${x},${y},${z}`;
      if (seen.has(k)) continue;
      seen.add(k);
      if (this.world.getBlock(x, y, z) !== B.NETHER_PORTAL) continue;
      this.world.setBlock(x, y, z, B.AIR);
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
        stack.push([x + dx, y + dy, z + dz]);
      }
    }
  },

  updatePortals(dt) {
    const p = this.player;
    if (p.inPortal >= 1 && !this.arrival) {
      const to = this.world.dim === DIM.NETHER ? DIM.OVERWORLD : DIM.NETHER;
      const scale = to === DIM.NETHER ? 1 / NETHER_SCALE : NETHER_SCALE;
      this.travelTo(to, [p.pos.x * scale, p.pos.y, p.pos.z * scale], { portal: true });
      return;
    }
    if (p.inEndPortal && !this.arrival) {
      if (this.world.dim === DIM.END) {
        this.travelTo(DIM.OVERWORLD, p.spawnPoint || [0.5, 80, 0.5]);
        if (this.won) this.showVictory();
      } else {
        this.travelTo(DIM.END, [0.5, 68, 0.5]);
      }
    }
    void dt;
  },

  /**
   * @param opts.portal  build/reuse a linked nether portal at the destination
   * @param opts.silent  skip the travel sound (respawns, debug jumps)
   */
  travelTo(dim, pos, opts = {}) {
    if (this.arrival) return;
    const p = this.player;
    if (!opts.silent) this.audio.play('portal_travel', { volume: 0.9 });
    this.save();
    this.entities.clear();
    this.dragon = null;
    this.particles.clear();
    p.inPortal = 0;
    p.inEndPortal = false;
    p.vel.set(0, 0, 0);
    p.fallDistance = 0;

    this.world.setDimension(dim);
    this.sky.setDimension(dim);
    this.weather.setDimension(dim);
    p.pos.set(pos[0], Math.max(4, Math.min(CHUNK_Y - 4, pos[1])), pos[2]);

    this.state = 'loading';
    this.input.enabled = false;
    this.menus.show('loading');
    this.menus.setLoading(0.05, dim === DIM.NETHER ? 'Entering the Nether…'
      : dim === DIM.END ? 'Entering the End…' : 'Returning to the Overworld…');
    this.arrival = { dim, pos: [...pos], t: 0, portal: !!opts.portal };
  },

  updateArrival(dt) {
    if (!this.arrival) return;
    const a = this.arrival;
    a.t += dt;
    const p = this.player;
    this.world.update(p.pos.x, p.pos.z, 8);
    this.world.flushSets();
    const cx = Math.floor(p.pos.x / 16), cz = Math.floor(p.pos.z / 16);
    let ready = 0;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) if (this.world.chunks.has(`${cx + dx},${cz + dz}`)) ready++;
    }
    this.menus.setLoading(0.05 + (ready / 9) * 0.9, 'Building the world…');
    if (ready < 9 && a.t < 14) return;

    this.arrival = null;
    if (a.portal && a.dim !== DIM.END) this.ensureArrivalPortal(a.dim, p);
    if (a.dim === DIM.END) this.setupEndFight();

    // land safely
    let y = Math.floor(p.pos.y);
    let found = -1;
    for (let d = 0; d < 40; d++) {
      for (const yy of [y - d, y + d]) {
        if (yy < 2 || yy > CHUNK_Y - 4) continue;
        if (this.world.getBlock(Math.floor(p.pos.x), yy, Math.floor(p.pos.z)) === B.AIR &&
            this.world.getBlock(Math.floor(p.pos.x), yy + 1, Math.floor(p.pos.z)) === B.AIR &&
            IS_SOLID[this.world.getBlock(Math.floor(p.pos.x), yy - 1, Math.floor(p.pos.z))]) {
          found = yy; break;
        }
      }
      if (found >= 0) break;
    }
    if (found >= 0) p.pos.y = found;

    this.menus.hideAll();
    this.state = 'playing';
    this.input.enabled = true;
    this.input.requestLock();
    this.particles.enderPop(p.pos.x, p.pos.y + 1, p.pos.z, 30);
    if (a.dim === DIM.NETHER) this.unlockAdvancement('nether');
    if (a.dim === DIM.END) this.unlockAdvancement('end');
  },

  /** Find an existing portal near the arrival point, or carve a fresh one. */
  ensureArrivalPortal(dim, p) {
    const w = this.world;
    const px = Math.floor(p.pos.x), pz = Math.floor(p.pos.z);
    for (let r = 0; r <= 12; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          for (let y = 6; y < CHUNK_Y - 6; y++) {
            if (w.getBlock(px + dx, y, pz + dz) === B.NETHER_PORTAL) {
              p.pos.set(px + dx + 0.5, y, pz + dz + 0.5);
              return;
            }
          }
        }
      }
    }
    // build one
    let baseY = -1;
    const lo = dim === DIM.NETHER ? 34 : 8;
    const hi = dim === DIM.NETHER ? 96 : CHUNK_Y - 12;
    const start = Math.max(lo, Math.min(hi, Math.floor(p.pos.y)));
    for (let d = 0; d < 60; d++) {
      for (const y of [start - d, start + d]) {
        if (y < lo || y > hi) continue;
        if (!IS_SOLID[w.getBlock(px, y - 1, pz)]) continue;
        let clear = true;
        for (let k = 0; k < 5 && clear; k++) if (w.getBlock(px, y + k, pz) === B.LAVA) clear = false;
        if (clear) { baseY = y; break; }
      }
      if (baseY > 0) break;
    }
    if (baseY < 0) baseY = Math.max(lo, Math.min(hi, Math.floor(p.pos.y)));

    // clear a pocket and build a 4x5 obsidian frame on the X axis
    for (let dx = -3; dx <= 3; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        for (let dy = -1; dy <= 6; dy++) {
          const b = w.getBlock(px + dx, baseY + dy, pz + dz);
          if (dy === -1) { if (!IS_SOLID[b]) w.setBlock(px + dx, baseY - 1, pz + dz, B.OBSIDIAN); }
          else if (b !== B.AIR) w.setBlock(px + dx, baseY + dy, pz + dz, B.AIR);
        }
      }
    }
    for (let dx = -1; dx <= 2; dx++) {
      w.setBlock(px + dx, baseY - 1, pz, B.OBSIDIAN);
      w.setBlock(px + dx, baseY + 4, pz, B.OBSIDIAN);
    }
    for (let dy = 0; dy <= 3; dy++) {
      w.setBlock(px - 1, baseY + dy, pz, B.OBSIDIAN);
      w.setBlock(px + 2, baseY + dy, pz, B.OBSIDIAN);
    }
    for (let dx = 0; dx <= 1; dx++) {
      for (let dy = 0; dy <= 3; dy++) w.setBlock(px + dx, baseY + dy, pz, B.NETHER_PORTAL);
    }
    p.pos.set(px + 0.5, baseY, pz + 2.5);
    if (!IS_SOLID[w.getBlock(px, baseY - 1, pz + 2)]) w.setBlock(px, baseY - 1, pz + 2, B.OBSIDIAN);
  },

  // -------------------------------------------------------------------------
  checkEndPortal(x, y, z) {
    // Find the 12-frame ring this frame belongs to and activate it when full.
    for (let cx = x - 2; cx <= x + 2; cx++) {
      for (let cz = z - 2; cz <= z + 2; cz++) {
        const ring = [];
        for (let i = -1; i <= 1; i++) {
          ring.push([cx + i, cz - 2], [cx + i, cz + 2], [cx - 2, cz + i], [cx + 2, cz + i]);
        }
        let filled = 0;
        for (const [fx, fz] of ring) {
          const b = this.world.getBlock(fx, y, fz);
          if (b === B.END_PORTAL_FRAME_EYE) filled++;
          else if (b !== B.END_PORTAL_FRAME) { filled = -99; break; }
        }
        if (filled === 12) {
          for (let i = -1; i <= 1; i++) {
            for (let j = -1; j <= 1; j++) this.world.setBlock(cx + i, y, cz + j, B.END_PORTAL);
          }
          this.audio.play('portal_travel', { volume: 1 });
          this.toast('End Portal', 'The portal is open. Jump in.', 'ender_eye');
          this.unlockAdvancement('stronghold');
          return;
        }
      }
    }
  },

  setupEndFight() {
    if (this.dragonDead) {
      // place the exit portal + trophy for a returning player
n      this.buildExitPortal();
      return;
    }
    // Pillar positions must match worldgen exactly.
    const PILLARS = 10;
    for (let i = 0; i < PILLARS; i++) {
      if (this.crystalsDestroyed.includes(i)) continue;
      const ang = (i / PILLARS) * Math.PI * 2;
      const px = Math.round(Math.cos(ang) * 36), pz = Math.round(Math.sin(ang) * 36);
      const ph = 64 + 20 + (i % 4) * 7;
      const c = new EndCrystal(this, px + 0.5, ph + 2, pz + 0.5);
      c.index = i;
      this.entities.add(c);
    }
    this.dragon = new EnderDragon(this, this.dragonHealth);
    this.entities.add(this.dragon);
    this.toast('The Ender Dragon', 'Destroy the End Crystals first!', 'ender_eye');
  },

  onCrystalDestroyed(c) {
    if (c.index !== undefined && !this.crystalsDestroyed.includes(c.index)) {
      this.crystalsDestroyed.push(c.index);
    }
    const left = Math.max(0, this.entities.countCategory('crystal') - 1);
    if (left === 0) this.toast('End Crystals', 'All crystals destroyed — the dragon is vulnerable!');
    else this.toast('End Crystal destroyed', `${left} remaining`);
  },

  onDragonDying() {
    this.state = 'playing';
    this.audio.stopMusic();
  },

  onDragonDead() {
    this.dragonDead = true;
    this.dragon = null;
    this.won = true;
    if (this.saveMeta) this.saveMeta.won = true;
    this.spawnXp(0.5, 68, 0.5, 120);
    this.buildExitPortal();
    this.unlockAdvancement('dragon');
    this.victoryPending = 3.2;
    this.save();
  },

  buildExitPortal() {
    const w = this.world;
    const TOP = 64;
    for (let dx = -3; dx <= 3; dx++) {
      for (let dz = -3; dz <= 3; dz++) {
        const d = Math.max(Math.abs(dx), Math.abs(dz));
        for (let dy = 1; dy <= 4; dy++) w.setBlock(dx, TOP + dy, dz, B.AIR);
        if (d === 3) w.setBlock(dx, TOP + 1, dz, B.BEDROCK);
        else if (d === 0) w.setBlock(dx, TOP + 1, dz, B.END_PORTAL);
        else w.setBlock(dx, TOP + 1, dz, d === 1 ? B.END_PORTAL : B.BEDROCK);
      }
    }
    w.setBlock(0, TOP + 4, 0, B.DRAGON_EGG);
    w.setBlock(0, TOP + 3, 0, B.BEDROCK);
    w.setBlock(0, TOP + 2, 0, B.BEDROCK);

    // The portal opens directly under the player's feet, so step them clear —
    // otherwise the victory is cut short by an instant trip home.
    const p = this.player;
    if (p && Math.max(Math.abs(p.pos.x), Math.abs(p.pos.z)) < 5) {
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          for (let dy = 1; dy <= 3; dy++) w.setBlock(6 + dx, TOP + dy, dz, B.AIR);
        }
      }
      w.setBlock(6, TOP, 0, B.END_STONE);
      p.pos.set(6.5, TOP + 1, 0.5);
      p.vel.set(0, 0, 0);
      p.fallDistance = 0;
      p.inEndPortal = false;
    }
  },

  showVictory() {
    if (this._victoryShown) return;
    this._victoryShown = true;
    this.state = 'victory';
    this.input.enabled = false;
    this.input.exitLock();
    this.hud.show(false);
    this.menus.showVictory({ ...this.stats, playtime: this.playtime });
    this.audio.startMusic();
    this.save();
  },

  endVictory() {
    this._victoryShown = false;
    this.menus.hideAll();
    this.hud.show(true);
    this.state = 'playing';
    this.input.enabled = true;
    this.input.requestLock();
  },

  // =========================================================================
  // Advancements
  // =========================================================================
  /**
   * Advancements are always earnable here, in creative and with commands on
   * alike — Minecraft locks them out, we deliberately don't.
   */
  unlockAdvancement(key) {
    if (this.advancements[key]) return;
    const a = ADVANCEMENTS.find((x) => x[0] === key);
    this.advancements[key] = true;
    if (a) {
      this.toast('Advancement Made!', a[1]);
      this.audio.play('levelup', { volume: 0.5 });
    }
    if (this.advancementScreen?.open) this.advancementScreen.render();
  },

  checkAdvancementsForBlock(id) {
    if (id === B.OAK_LOG || id === B.BIRCH_LOG || id === B.SPRUCE_LOG) this.unlockAdvancement('wood');
    if (id === B.DIAMOND_ORE) this.unlockAdvancement('diamonds');
    if (id === B.OBSIDIAN) this.unlockAdvancement('obsidian');
  },

  checkAdvancementsForItem(key) {
    if (key === 'crafting_table') this.unlockAdvancement('bench');
    if (key.startsWith('stone_')) this.unlockAdvancement('stone_age');
    if (key === 'iron_ingot') this.unlockAdvancement('iron');
    if (key === 'diamond') this.unlockAdvancement('diamonds');
    if (key === 'obsidian') this.unlockAdvancement('obsidian');
    if (key === 'blaze_rod') this.unlockAdvancement('blaze');
    if (key === 'ender_pearl') this.unlockAdvancement('pearl');
    if (key === 'ender_eye') this.unlockAdvancement('eye');
  },

  // =========================================================================
  // Misc actions
  // =========================================================================
  throwItem(key) {
    const p = this.player;
    if (p.gamemode !== GAMEMODE.CREATIVE && !p.inventory.consumeHeld(1)) return;
    const eye = p.eyePosition();
    const dir = p.lookDir();
    this.entities.add(new ThrownItem(this, eye.x + dir.x * 0.4, eye.y, eye.z + dir.z * 0.4, dir, key));
    this.audio.play('bow', { rate: 1.4, volume: 0.5 });
  },

  throwEye() {
    const p = this.player;
    if (this.world.dim !== DIM.OVERWORLD) {
      this.toast('Eye of Ender', 'It only works in the Overworld');
      return;
    }
    const site = nearestStronghold(this.world.seed, p.pos.x, p.pos.z);
    const dist = site ? Math.hypot(site.x - p.pos.x, site.z - p.pos.z) : 0;
    if (p.gamemode !== GAMEMODE.CREATIVE && !p.inventory.consumeHeld(1)) return;
    const eye = p.eyePosition();
    this.entities.add(new EnderEye(this, eye.x, eye.y, eye.z));
    if (dist < 14) {
      this.toast('Eye of Ender', 'The stronghold is right below you — dig down!');
      this.unlockAdvancement('stronghold');
    }
  },

  useBucket(hit, placing) {
    const p = this.player;
    const held = p.inventory.held();
    if (!hit) return;
    if (placing) {
      const bx = hit.x + hit.nx, by = hit.y + hit.ny, bz = hit.z + hit.nz;
      const at=this.world.getBlock(bx,by,bz);
      if(by<0||by>=CHUNK_Y||!this.world.isLoaded(bx,bz)||at===B.WATER||at===B.LAVA||!BLOCKS[at].replaceable&&at!==B.AIR) return;
      const fluid = held.key === 'water_bucket' ? B.WATER : B.LAVA;
      this.world.setBlock(bx, by, bz, fluid);
      if(p.gamemode!==GAMEMODE.CREATIVE) p.inventory.slots[p.inventory.selected] = makeStack('bucket', 1);
      p.inventory.changed();
      this.audio.play('splash', { pos: [bx, by, bz] });
      // Reactions are handled by the same simulation in either placement order.
    } else {
      const b = this.world.getBlock(hit.x, hit.y, hit.z);
      if (b === B.WATER || b === B.LAVA) {
        this.world.setBlock(hit.x, hit.y, hit.z, B.AIR);
        p.inventory.slots[p.inventory.selected] = makeStack(b === B.WATER ? 'water_bucket' : 'lava_bucket', 1);
        p.inventory.changed();
        this.audio.play('splash', { pos: [hit.x, hit.y, hit.z], rate: 0.7 });
      }
    }
  },

  /** Water touching lava makes obsidian — the intended route to a portal. */
  coolLava(x, y, z) {
    let made = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) !== 1) continue;
          if (this.world.getBlock(x + dx, y + dy, z + dz) === B.LAVA) {
            this.world.setBlock(x + dx, y + dy, z + dz, B.OBSIDIAN);
            this.particles.smoke(x + dx + 0.5, y + dy + 1, z + dz + 0.5, 6);
            made++;
          }
        }
      }
    }
    if (made) {
      this.audio.play('fizz', { pos: [x, y, z] });
      this.toast('Obsidian', 'Mine it with a diamond pickaxe', 'obsidian');
    }
  },

  /** The coordinates of a bed's other half, looking both ways along its axis. */
  bedPartner(x, y, z, id = this.world.getBlock(x, y, z)) {
    const def = BEDS[id];
    if (!def) return null;
    const d = def.axis === 'x' ? [1, 0, 0] : [0, 0, 1];
    for (const s of [1, -1]) {
      const px = x + d[0] * s, pz = z + d[2] * s;
      if (this.world.getBlock(px, y, pz) === def.other) return [px, y, pz];
    }
    return null;
  },

  useBed(x, y, z) {
    const p = this.player;
    p.spawnPoint = [x + 0.5, y + 1, z + 1.5];
    const night = this.timeOfDay > 0.52 || this.timeOfDay < 0.02;
    if (!night) {
      this.toast('Bed', 'You can only sleep at night. Spawn point set.');
      return true;
    }
    if (this.sleep) return true;
    this.beginSleep(x, y, z);
    return true;
  },

  /**
   * Lie down: the screen fades to black over a couple of seconds, the player
   * is pinned in place on the bed, and morning arrives at the far end. A
   * "Leave Bed" button cancels it at any point during the fade.
   */
  beginSleep(x, y, z) {
    const p = this.player;
    this.sleep = { x, y, z, t: 0, phase: 'in', bed: [x + 0.5, y + 0.6, z + 0.5] };
    p.vel.set(0, 0, 0);
    p.sneaking = false;
    p.sprinting = false;
    this.input.enabled = false;
    this.input.down.clear();
    this.hud.setSleeping(true);
    this.audio.play('click', { rate: 0.5, volume: 0.6 });
  },

  /** Stop sleeping — either cancelled, or finished and waking up. */
  endSleep(woke) {
    if (!this.sleep) return;
    this.sleep = null;
    this.hud.setSleeping(false);
    this.hud.setFade(0);
    this.input.enabled = true;
    this.input.down.clear();
    this.input.takeRawDelta();
    if (this.state === 'playing' && !this.input.locked) this.input.requestLock();
    if (!woke) this.toast('Bed', 'You got up. Spawn point set.');
  },

  updateSleep(dt) {
    const s = this.sleep;
    if (!s) return;
    const p = this.player;
    // Pinned to the bed while the animation runs.
    p.vel.set(0, 0, 0);
    if (s.restY === undefined) s.restY = p.pos.y;
    p.pos.set(s.bed[0], s.restY, s.bed[2]);
    s.t += dt;

    const FADE = 1.6, HOLD = 0.7;
    if (s.phase === 'in') {
      this.hud.setFade(Math.min(1, s.t / FADE));
      if (s.t >= FADE + HOLD) {
        // Morning: skip to dawn, clear the weather and top the player up.
        const dayLen = Math.max(60, this.settings.get('dayLength') * 60);
        this.time = (Math.floor(this.time / dayLen) + 1) * dayLen + 2;
        p.heal(2);
        this.weather.force(WEATHER.CLEAR);
        this.weather.intensity = 0;
        this.sky.rainDarken = 0;
        s.phase = 'out';
        s.t = 0;
        this.hud.setSleeping(false);
        this.toast('Good morning', 'You slept through the night', 'bed');
      }
      return;
    }
    this.hud.setFade(Math.max(0, 1 - s.t / FADE));
    if (s.t >= FADE) this.endSleep(true);
  },
};
