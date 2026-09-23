// ============================================================================
// Game shell: saving, pausing and the pointer-lock-sensitive screens.
//
// Split out of main.js so the entry module stays manageable; these methods
// are mixed onto Game.prototype at boot (see main.js) and read `this` exactly
// like the methods that stayed behind.
// ============================================================================

import * as DB from './save/db.js';
import { Inventory } from './player/inventory.js';

export const GameShell = {
  async save() {
    if (!this.saveMeta || !this.world) return;
    this.world.flushSets();
    const items = [];
    this.entities.each((e) => { const s = e.serialize?.(); if (s) items.push(s); });
    // Include transient container stacks in the saved snapshot without closing
    // the player's UI or mutating their live bag during an autosave.
    const playerSnapshot=this.player.serialize();
    if(this.containers.open){
      const temp=new Inventory();temp.deserialize(playerSnapshot.inventory);
      const extras=[this.containers.cursor];
      if(this.containers.type==='crafting') extras.push(...(this.containers._grid||[]));
      for(const stack of extras){if(!stack)continue;const left=temp.addStack(stack);
        if(left)items.push({t:'item',x:this.player.pos.x,y:this.player.pos.y+0.6,z:this.player.pos.z,s:{...stack,count:left},life:300});
      }
      playerSnapshot.inventory=temp.serialize();
    }
    const rec = {
      ...this.saveMeta,
      lastPlayed: Date.now(),
      won: this.won,
      playtime: this.playtime,
      data: {
        dim: this.world.dim,
        time: this.time,
        world: this.world.serialize(),
        player: playerSnapshot,
        stats: this.stats,
        advancements: this.advancements,
        gamerules: this.gamerules,
        weather: this.weather.serialize(),
        dragonDead: this.dragonDead,
        dragonHealth: this.dragon ? this.dragon.health : this.dragonHealth,
        crystalsDestroyed: this.crystalsDestroyed,
        portals: this.portalCache,
        lastDeath:this.lastDeath||null,
        items,
      },
    };
    try { await DB.saveWorld(rec); return true; }
    catch (e) {
      console.warn('[save] failed', e);
      this.toast('Save failed','Storage may be full or blocked. Keep this tab open.');
      return false;
    }
  },

  async quitToTitle() {
    if (this.state !== 'menu' && !(await this.save())) return;
    this.audio.stopAllLoops();
    this.input.exitLock();
    this.hud.show(false);
    this.containers.close();
    this.advancementScreen.hide();
    if (this.sleep) this.endSleep(false);
    this.hud.setFade(0);
    this.state = 'menu';
    this.player = null;
    this.saveMeta = null;
    this.startPanorama();
    this.menus.show('title');
  },

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.input.enabled = false;
    this.input.exitLock();
    this._optionsFrom = 'pause';
    this.menus.show('pause');
    this.save();
  },

  resume() {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.input.enabled = true;
    this.menus.hideAll();
    this.input.requestLock();
  },

  /**
   * Chat releases the pointer but must not pause the game. Held keys are
   * dropped so the player doesn't keep walking while typing.
   */
  openChat(initial = '') {
    if (this.hud.chatOpen || this.state !== 'playing') return;
    // Like the inventory, chat keeps the pointer lock — typing works fine
    // under it, and dropping the lock is what summoned the browser's banner.
    // Disabling input is enough to stop the mouse turning the camera.
    this.input.enabled = false;
    this.input.down.clear();
    this.hud.openChat(initial);
  },

  closeChat(submit) {
    if (!this.hud.chatOpen) return;
    const text = this.hud.chatInput.value;
    this.hud.closeChat();
    this.input.enabled = true;
    this.input.down.clear();
    this.input.takeRawDelta();               // discard drift from while typing
    if (submit && text.trim()) this.runCommand(text);
    if (this.state === 'playing' && !this.input.locked) this.input.requestLock();
  },

  /**
   * The advancements tree. It keeps the pointer lock like the other screens,
   * and the real cursor is only needed for the Done button — Escape and the
   * advancements key both close it.
   */
  toggleAdvancements() {
    if (this.advancementScreen.open) { this.advancementScreen.hide(); return; }
    this.advancementScreen.show();
    this.input.enabled = false;
    this.input.down.clear();
    this.input.exitLock();
  },

  onAdvancementsClosed() {
    this.input.enabled = true;
    this.input.down.clear();
    if (this.state === 'playing') this.input.requestLock();
  },

  openContainer(type, data) {
    // The pointer lock is deliberately kept: releasing it made Chrome show its
    // "press Esc to show your cursor" banner every single time the inventory
    // opened. The screen draws its own cursor instead.
    this.containers.show(type, data);
    this.input.enabled = false;
    // Drop every held key. Otherwise a Shift or Ctrl still logically "down"
    // when the screen opens leaks straight back into sneak/sprint on close.
    this.input.down.clear();
    this.input.sprintToggle = false;
    this.player.sneaking = false;
    this.player.sprinting = false;
  },

  onContainerClosed() {
    this.input.enabled = true;
    this.input.down.clear();
    this.input.sprintToggle = false;
    // Only ask for the lock back if it was actually lost (Escape forces the
    // browser to release it). Re-requesting a lock we still hold would show
    // the banner again for nothing.
    if (this.state === 'playing' && !this.input.locked) this.input.requestLock();
  },
};
