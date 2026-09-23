// ============================================================================
// HUD: hotbar, hearts, hunger, armour, oxygen, XP, boss bar, tooltips, toasts,
// the debug overlay and the screen-space damage/underwater/portal effects.
// Pure DOM so it stays crisp and responsive at any window size.
// ============================================================================

import { buildHudSprites, iconFor } from '../engine/itemicons.js';
import { getItem, maxDurability, RARITY_COLOR } from '../crafting/items.js';
import { BIOME_NAMES } from '../world/worldgen.js';
import { DIM_NAMES, GAMEMODE } from '../constants.js';

const $ = (id) => document.getElementById(id);

const escapeHtml = (s) => String(s).replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export class HUD {
  constructor(game) {
    this.game = game;
    this.sprites = buildHudSprites();
    this.root = $('hud');
    this.sleepFade = $('sleep-fade');
    this.sleepUI = $('sleep-ui');
    $('btn-leave-bed').addEventListener('mousedown', (e) => {
      e.stopPropagation();
      this.game.endSleep(false);
    });
    this.hotbarEl = $('hotbar');
    this.healthEl = $('bar-health');
    this.hungerEl = $('bar-hunger');
    this.armorEl = $('bar-armor');
    this.airEl = $('bar-air');
    this.xpFill = $('xp-fill');
    this.xpLevel = $('xp-level');
    this.bossBar = $('boss-bar');
    this.bossFill = $('boss-fill');
    this.bossName = $('boss-name');
    this.toasts = $('toasts');
    this.subtitlesEl = $('subtitles');
    this._subs = [];
    this.debug = $('debug-overlay');
    this.flash = $('damage-flash');
    this.waterOverlay = $('water-overlay');
    this.portalOverlay = $('portal-overlay');
    this.itemFlash = $('item-name-flash');
    this.chatLog = $('chat-log');
    this.chatWrap = $('chat-input-wrap');
    this.chatInput = $('chat-input');
    this.suggestEl = $('chat-suggest');
    this.suggestions = [];
    this.suggestIndex = 0;
    this.suggestPrefixLen = 0;
    this.chatInput.addEventListener('input', () => this.updateSuggestions());
    this.chatInput.addEventListener('click', () => this.updateSuggestions());

    this.flashAmount = 0;
    this._lastSelected = -1;
    this._lastCounts = '';
    this._prevSlots = [];
    this.fps = 0;
    this._frames = 0;
    this._fpsTime = 0;

    this._buildHotbar();
    this._buildRow(this.healthEl, 10);
    this._buildRow(this.hungerEl, 10);
    this._buildRow(this.armorEl, 10);
    this._buildRow(this.airEl, 10);

    this.hotbarEl.addEventListener('mousedown', (e) => {
      const slot = e.target.closest('.slot');
      if (!slot) return;
      this.game.player.inventory.selected = Number(slot.dataset.i);
    });
  }

  show(v) { this.root.classList.toggle('hidden', !v); }

  /** Opacity of the black sleeping veil, 0..1. */
  setFade(v) {
    this.sleepFade.style.opacity = String(Math.max(0, Math.min(1, v)));
  }

  /** Show or hide the "Sleeping…" caption and its Leave Bed button. */
  setSleeping(on) {
    this.sleepUI.classList.toggle('hidden', !on);
  }

  _buildHotbar() {
    this.hotbarEl.innerHTML = '';
    this.slotEls = [];
    for (let i = 0; i < 9; i++) {
      const d = document.createElement('div');
      d.className = 'slot';
      d.dataset.i = i;
      d.innerHTML = '<div class="icon"></div><div class="dur hidden"><i></i></div><div class="count"></div>';
      this.hotbarEl.appendChild(d);
      this.slotEls.push(d);
    }
  }

  _buildRow(el, n) {
    el.innerHTML = '';
    for (let i = 0; i < n; i++) {
      const d = document.createElement('div');
      d.className = 'ic';
      el.appendChild(d);
    }
  }

  _setRow(el, n, value, full, half, empty) {
    const kids = el.children;
    for (let i = 0; i < n; i++) {
      const v = value - i * 2;
      const src = v >= 2 ? full : v >= 1 ? half : empty;
      const url = src ? `url(${src})` : 'none';
      if (kids[i]._u !== url) { kids[i].style.backgroundImage = url; kids[i]._u = url; }
    }
  }

  // -------------------------------------------------------------------------
  update(dt) {
    const g = this.game;
    const p = g.player;
    const inv = p.inventory;

    if (this._subs.length) {
      for (const sub of this._subs) sub.ttl -= dt;
      const expired = this._subs.filter((x) => x.ttl <= 0);
      if (expired.length) {
        for (const x of expired) x.el.remove();
        this._subs = this._subs.filter((x) => x.ttl > 0);
      }
    }

    this._frames++;
    this._fpsTime += dt;
    if (this._fpsTime >= 0.5) {
      this.fps = Math.round(this._frames / this._fpsTime);
      this._frames = 0; this._fpsTime = 0;
    }

    // --- hotbar ---
    for (let i = 0; i < 9; i++) {
      const el = this.slotEls[i];
      const s = inv.slots[i];
      const icon = el.firstChild;
      const durEl = el.children[1];
      const count = el.children[2];
      const key = s ? s.key : '';
      if (el._k !== key) {
        el._k = key;
        icon.style.backgroundImage = s ? `url(${iconFor(s.key)})` : 'none';
      }
      const c = s && s.count > 1 ? String(s.count) : '';
      if (count.textContent !== c) count.textContent = c;
      if (s && s.dur !== undefined) {
        const max = maxDurability(s.key) || 1;
        const f = Math.max(0, s.dur / max);
        durEl.classList.toggle('hidden', f >= 1);
        durEl.firstChild.style.width = (f * 100) + '%';
        durEl.firstChild.style.background = f > 0.5
          ? `rgb(${Math.round(255 * (1 - f) * 2)},255,0)`
          : `rgb(255,${Math.round(255 * f * 2)},0)`;
      } else durEl.classList.add('hidden');
      el.classList.toggle('sel', i === inv.selected);
    }

    if (inv.selected !== this._lastSelected) {
      this._lastSelected = inv.selected;
      const s = inv.held();
      if (s) {
        const it = getItem(s.key);
        this.itemFlash.textContent = it ? it.name : s.key;
        this.itemFlash.style.color = RARITY_COLOR[it?.rarity || 0];
        this.itemFlash.classList.add('show');
        clearTimeout(this._flashT);
        this._flashT = setTimeout(() => this.itemFlash.classList.remove('show'), 1400);
      } else this.itemFlash.classList.remove('show');
    }

    // --- stats ---
    const survival = p.gamemode === GAMEMODE.SURVIVAL;
    this.healthEl.parentElement.style.visibility = survival ? 'visible' : 'hidden';
    if (survival) {
      this._setRow(this.healthEl, 10, p.health, this.sprites.heart, this.sprites.heart_half, this.sprites.heart_bg);
      this._setRow(this.hungerEl, 10, p.hunger, this.sprites.food, this.sprites.food_half, this.sprites.food_bg);
      this.healthEl.classList.toggle('shake', p.health <= 4);
      this.hungerEl.classList.toggle('shake', p.hunger <= 2);

      const ap = inv.armorPoints().points;
      this.armorEl.classList.toggle('hidden', ap <= 0);
      if (ap > 0) this._setRow(this.armorEl, 10, ap, this.sprites.armor, this.sprites.armor_half, this.sprites.armor_bg);

      const airFrac = p.air / p.maxAir;
      this.airEl.classList.toggle('hidden', airFrac >= 1);
      if (airFrac < 1) {
        this._setRow(this.airEl, 10, airFrac * 20, this.sprites.bubble, this.sprites.bubble_pop, '');
      }
    } else {
      this.armorEl.classList.add('hidden');
      this.airEl.classList.add('hidden');
    }

    this.xpFill.style.width = (Math.min(1, p.xpProgress) * 100) + '%';
    this.xpLevel.textContent = p.level > 0 ? String(p.level) : '';

    // --- screen effects ---
    if (p.hurtTime > 0) this.flashAmount = Math.max(this.flashAmount, p.hurtTime / 0.45);
    this.flashAmount = Math.max(0, this.flashAmount - dt * 3.0);
    this.flash.style.opacity = (this.flashAmount * 0.5).toFixed(3);
    // The post-processing pass already tints the whole frame underwater, so the
    // DOM overlay only needs to carry the effect when bloom is switched off.
    this.waterOverlay.style.opacity = p.headInWater
      ? (g.renderer.postfx.enabled ? '0.3' : '1') : '0';
    this.portalOverlay.style.opacity = p.inPortal > 0 ? String(Math.min(0.9, p.inPortal * 1.4)) : '0';

    // --- boss bar ---
    const dragon = g.dragon;
    if (dragon && !dragon.dead && g.world.dim === 2) {
      this.bossBar.classList.remove('hidden');
      this.bossFill.style.width = Math.max(0, (dragon.health / dragon.maxHealth) * 100) + '%';
      const alive = dragon.crystalsAlive;
      this.bossName.textContent = alive > 0
        ? `Ender Dragon  —  ${alive} crystal${alive === 1 ? '' : 's'} healing it`
        : 'Ender Dragon';
      this.bossName.style.color = alive > 0 ? '#ff9c6b' : '#ffffff';
    } else this.bossBar.classList.add('hidden');

    if (this.debugOn) this._updateDebug();
  }

  // -------------------------------------------------------------------------
  toggleDebug() {
    this.debugOn = !this.debugOn;
    this.debug.classList.toggle('hidden', !this.debugOn);
  }

  _updateDebug() {
    const g = this.game, p = g.player;
    const x = Math.floor(p.pos.x), y = Math.floor(p.pos.y), z = Math.floor(p.pos.z);
    // The player looks along (-sin yaw, -cos yaw), so yaw 0 faces -Z = north.
    const deg = ((p.yaw * 180 / Math.PI) % 360 + 360) % 360;
    const dirs = [
      ['north', '-Z'], ['north-west', ''], ['west', '-X'], ['south-west', ''],
      ['south', '+Z'], ['south-east', ''], ['east', '+X'], ['north-east', ''],
    ];
    const [name, axis] = dirs[Math.round(deg / 45) % 8];
    const facing = axis ? `${name} (${axis})` : name;
    // Reported in Minecraft's convention: yaw 0 = south, pitch negative = up.
    const mcYaw = ((180 - deg + 540) % 360) - 180;
    const mcPitch = -p.pitch * 180 / Math.PI;
    const biome = BIOME_NAMES[g.world.biomeAt(x, z)] || '?';
    const t = g.timeOfDay;
    const hours = Math.floor(((t + 0.25) % 1) * 24);
    const mins = Math.floor(((((t + 0.25) % 1) * 24) % 1) * 60);
    const look = g.lookHit;
    const sky = g.world.skyLight(x, y + 1, z), blk = g.world.blockLight(x, y + 1, z);
    this.debug.textContent =
      `ChugCraft 3.2  ${this.fps} fps\n` +
      `XYZ ${p.pos.x.toFixed(2)} / ${p.pos.y.toFixed(2)} / ${p.pos.z.toFixed(2)}\n` +
      `Block ${x} ${y} ${z}   Chunk ${x >> 4} ${z >> 4}\n` +
      `Facing ${facing}   yaw ${mcYaw.toFixed(1)} pitch ${mcPitch.toFixed(1)}\n` +
      `Dimension ${DIM_NAMES[g.world.dim]}   Biome ${biome}\n` +
      `Light sky ${sky} block ${blk}   Sun ${g.sky.sunLight.toFixed(2)}\n` +
      `Time ${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}   Day ${g.dayNumber}   Weather ${['clear', 'rain', 'thunder'][g.weather.state]}\n` +
      `Chunks ${g.world.chunks.size} loaded (${g.world.pending.size} pending)\n` +
      `Entities ${g.entities.list.length}\n` +
      `Looking at ${look ? `${look.x} ${look.y} ${look.z} (${g.blockName(look.id)})` : 'nothing'}`;
  }

  // -------------------------------------------------------------------------
  /**
   * Accessibility subtitle for a sound: "Cow moos  <" with a rough direction
   * arrow. Repeats of the same caption just refresh its timer.
   */
  caption(text, dir) {
    if (!this.subtitlesEl) return;
    const arrow = dir === 'left' ? '\u25c0 ' : dir === 'right' ? '\u25b6 ' : '';
    const existing = this._subs.find((x) => x.text === text);
    if (existing) { existing.ttl = 2.2; existing.el.textContent = arrow + text; return; }
    const el = document.createElement('div');
    el.className = 'subtitle';
    el.textContent = arrow + text;
    this.subtitlesEl.appendChild(el);
    this._subs.push({ text, el, ttl: 2.2 });
    while (this._subs.length > 4) this._subs.shift().el.remove();
  }

  toast(title, sub, iconKey) {
    const d = document.createElement('div');
    d.className = 'toast';
    d.innerHTML = `${iconKey ? `<div class="t-icon" style="background-image:url(${iconFor(iconKey)})"></div>` : ''}
      <div><div class="t-title">${title}</div>${sub ? `<div class="t-sub">${sub}</div>` : ''}</div>`;
    this.toasts.appendChild(d);
    setTimeout(() => d.classList.add('fade'), 4200);
    setTimeout(() => d.remove(), 4800);
  }

  chat(text) {
    const d = document.createElement('div');
    d.textContent = text;
    this.chatLog.appendChild(d);
    while (this.chatLog.children.length > 8) this.chatLog.firstChild.remove();
    setTimeout(() => d.remove(), 12000);
  }

  openChat(initial = '') {
    this.chatWrap.classList.remove('hidden');
    this.chatInput.value = initial;
    // Focus on the next tick so the keypress that opened chat can't also be
    // typed into the box.
    setTimeout(() => {
      this.chatInput.focus();
      const n = this.chatInput.value.length;
      this.chatInput.setSelectionRange(n, n);
      this.updateSuggestions();
    }, 0);
  }
  closeChat() {
    this.chatWrap.classList.add('hidden');
    this.chatInput.blur();
    this.hideSuggestions();
  }
  get chatOpen() { return !this.chatWrap.classList.contains('hidden'); }

  // -------------------------------------------------------------------------
  // Command autocomplete
  // -------------------------------------------------------------------------
  hideSuggestions() {
    this.suggestEl.classList.add('hidden');
    this.suggestions = [];
    this.suggestIndex = 0;
  }

  /** Recompute the suggestion list from what's currently typed. */
  updateSuggestions() {
    const text = this.chatInput.value;
    const caret = this.chatInput.selectionStart ?? text.length;
    const list = this.game.completionsFor(text.slice(0, caret));
    this.suggestions = list.items;
    this.suggestPrefixLen = list.tokenStart;
    this.suggestIndex = Math.min(this.suggestIndex, Math.max(0, list.items.length - 1));
    if (!list.items.length) { this.suggestEl.classList.add('hidden'); return; }

    this.suggestEl.innerHTML = '';
    const typed = text.slice(list.tokenStart, caret);
    list.items.slice(0, 40).forEach((s, i) => {
      const d = document.createElement('div');
      d.className = 'sug' + (i === this.suggestIndex ? ' sel' : '');
      const matchLen = typed.length;
      d.innerHTML = `<span class="hit">${escapeHtml(s.value.slice(0, matchLen))}</span>` +
        `${escapeHtml(s.value.slice(matchLen))}` +
        (s.desc ? `<span class="desc">${escapeHtml(s.desc)}</span>` : '');
      d.addEventListener('mousedown', (e) => {
        e.preventDefault();
        this.suggestIndex = i;
        this.applySuggestion();
      });
      this.suggestEl.appendChild(d);
    });
    this.suggestEl.classList.remove('hidden');
  }

  moveSuggestion(delta) {
    if (!this.suggestions.length) return false;
    const n = this.suggestions.length;
    this.suggestIndex = ((this.suggestIndex + delta) % n + n) % n;
    this.updateSuggestions();
    const sel = this.suggestEl.querySelector('.sug.sel');
    if (sel) sel.scrollIntoView({ block: 'nearest' });
    return true;
  }

  /** Replace the token under the caret with the highlighted suggestion. */
  applySuggestion() {
    if (!this.suggestions.length) return false;
    const pick = this.suggestions[this.suggestIndex];
    if (!pick) return false;
    const text = this.chatInput.value;
    const caret = this.chatInput.selectionStart ?? text.length;
    const before = text.slice(0, this.suggestPrefixLen);
    const after = text.slice(caret);
    const insert = pick.value + (pick.trailingSpace === false ? '' : ' ');
    this.chatInput.value = before + insert + after;
    const pos = (before + insert).length;
    this.chatInput.setSelectionRange(pos, pos);
    this.suggestIndex = 0;
    this.updateSuggestions();
    return true;
  }
}
