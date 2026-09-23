// ============================================================================
// Inventory model. Slot layout mirrors the classic survival screen:
//   0..8    hotbar
//   9..35   main storage
//   armor[] helmet, chestplate, leggings, boots
//   craft[] the 2x2 grid carried in the inventory screen
// ============================================================================

import { getItem, makeStack, maxDurability } from '../crafting/items.js';

export const HOTBAR_SIZE = 9;
export const MAIN_SIZE = 36;

export function stackLimit(key) {
  const it = getItem(key);
  return it ? it.stack : 64;
}

export function canMerge(a, b) {
  if (!a || !b) return false;
  if (a.key !== b.key) return false;
  if (a.dur !== undefined || b.dur !== undefined) return false;   // tools never stack
  return true;
}

export class Inventory {
  constructor() {
    this.slots = new Array(MAIN_SIZE).fill(null);
    this.armor = new Array(4).fill(null);
    this.craft = new Array(4).fill(null);
    // The off hand. One slot, held alongside whatever is in the hotbar.
    this.offhand = null;
    this.selected = 0;
    this.onChange = null;
  }

  changed() { if (this.onChange) this.onChange(); }

  held() { return this.slots[this.selected]; }
  setHeld(s) { this.slots[this.selected] = s; this.changed(); }

  /** @returns the number of items that did NOT fit. */
  add(key, count = 1, dur) {
    if (!getItem(key)) return count;
    const limit = stackLimit(key);
    let left = count;
    if (limit > 1) {
      // top up existing partial stacks first (hotbar, then main)
      for (let i = 0; i < MAIN_SIZE && left > 0; i++) {
        const s = this.slots[i];
        if (!s || s.key !== key || s.dur !== undefined) continue;
        const room = limit - s.count;
        if (room <= 0) continue;
        const take = Math.min(room, left);
        s.count += take; left -= take;
      }
    }
    while (left > 0) {
      const i = this.firstEmpty();
      if (i < 0) break;
      const take = Math.min(limit, left);
      const s = makeStack(key, take);
      if (dur !== undefined) s.dur = dur;
      this.slots[i] = s;
      left -= take;
    }
    if (left !== count) this.changed();
    return left;
  }

  capacityFor(key) {
    const limit=stackLimit(key);
    return this.slots.reduce((n,s)=>n+(!s?limit:s.key===key&&s.dur===undefined?Math.max(0,limit-s.count):0),0);
  }

  /** All-or-nothing exchange, including full-bag and freed-input-slot cases. */
  transact(cost, outputs=[]) {
    const temp=new Inventory(); temp.deserialize(this.serialize());
    for(const [key,count] of Object.entries(cost)) {
      if(!Number.isInteger(count)||count<1||!temp.has(key,count))return false;
      temp.remove(key,count);
    }
    for(const s of outputs) if(!s||!getItem(s.key)||!Number.isInteger(s.count)||s.count<1||temp.addStack(s)>0)return false;
    this.slots=temp.slots; this.changed(); return true;
  }

  addStack(stack) {
    if (!stack) return 0;
    return this.add(stack.key, stack.count, stack.dur);
  }

  firstEmpty() {
    for (let i = 0; i < MAIN_SIZE; i++) if (!this.slots[i]) return i;
    return -1;
  }

  count(key) {
    let n = 0;
    for (const s of this.slots) if (s && s.key === key) n += s.count;
    return n;
  }

  has(key, n = 1) { return this.count(key) >= n; }

  remove(key, n = 1) {
    let left = n;
    for (let i = 0; i < MAIN_SIZE && left > 0; i++) {
      const s = this.slots[i];
      if (!s || s.key !== key) continue;
      const take = Math.min(s.count, left);
      s.count -= take; left -= take;
      if (s.count <= 0) this.slots[i] = null;
    }
    this.changed();
    return n - left;
  }

  /** Consume one of the selected stack (eating, placing, throwing). */
  consumeHeld(n = 1) {
    const s = this.held();
    if (!s) return false;
    s.count -= n;
    if (s.count <= 0) this.slots[this.selected] = null;
    this.changed();
    return true;
  }

  /** Apply tool wear; returns true if the tool broke. */
  damageHeld(amount = 1) {
    const s = this.held();
    if (!s || s.dur === undefined) return false;
    s.dur -= amount;
    if (s.dur <= 0) {
      this.slots[this.selected] = null;
      this.onBreak?.();
      this.changed();
      return true;
    }
    this.changed();
    return false;
  }

  damageArmor(amount = 1) {
    let broke = false;
    for (let i = 0; i < 4; i++) {
      const a = this.armor[i];
      if (!a || a.dur === undefined) continue;
      a.dur -= amount;
      if (a.dur <= 0) { this.armor[i] = null; broke = true; }
    }
    if (broke) this.changed();
    return broke;
  }

  armorPoints() {
    let p = 0, t = 0;
    for (const a of this.armor) {
      if (!a) continue;
      const d = getItem(a.key)?.armor;
      if (d) { p += d.points; t += d.toughness; }
    }
    return { points: p, toughness: t };
  }

  /** Move a stack between slots (used by shift-click quick move). */
  quickMove(index) {
    const s = this.slots[index];
    if (!s) return false;
    const inHotbar = index < HOTBAR_SIZE;
    const from = inHotbar ? HOTBAR_SIZE : 0;
    const to = inHotbar ? MAIN_SIZE : HOTBAR_SIZE;
    const limit = stackLimit(s.key);
    for (let i = from; i < to && s.count > 0; i++) {
      const t = this.slots[i];
      if (!t || !canMerge(s, t)) continue;
      const room = limit - t.count;
      if (room <= 0) continue;
      const take = Math.min(room, s.count);
      t.count += take; s.count -= take;
    }
    if (s.count > 0) {
      for (let i = from; i < to; i++) {
        if (!this.slots[i]) { this.slots[i] = s; this.slots[index] = null; this.changed(); return true; }
      }
    }
    if (s.count <= 0) this.slots[index] = null;
    this.changed();
    return true;
  }

  /** Select the hotbar slot holding `key`, or move it there from storage. */
  pickBlock(key) {
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      if (this.slots[i]?.key === key) { this.selected = i; this.changed(); return true; }
    }
    for (let i = HOTBAR_SIZE; i < MAIN_SIZE; i++) {
      if (this.slots[i]?.key === key) {
        const target = this.selected;
        const tmp = this.slots[target];
        this.slots[target] = this.slots[i];
        this.slots[i] = tmp;
        this.changed();
        return true;
      }
    }
    return false;
  }

  clear() {
    this.slots.fill(null);
    this.armor.fill(null);
    this.craft.fill(null);
    this.offhand = null;
    this.changed();
  }

  /** Everything the player is carrying, for the death drop. */
  drainAll() {
    const out = [];
    for (let i = 0; i < MAIN_SIZE; i++) if (this.slots[i]) { out.push(this.slots[i]); this.slots[i] = null; }
    for (let i = 0; i < 4; i++) if (this.armor[i]) { out.push(this.armor[i]); this.armor[i] = null; }
    for (let i = 0; i < 4; i++) if (this.craft[i]) { out.push(this.craft[i]); this.craft[i] = null; }
    if (this.offhand) { out.push(this.offhand); this.offhand = null; }
    this.changed();
    return out;
  }

  serialize() {
    const enc = (s) => (s ? (s.dur !== undefined ? [s.key, s.count, s.dur] : [s.key, s.count]) : null);
    return {
      slots: this.slots.map(enc),
      armor: this.armor.map(enc),
      craft: this.craft.map(enc),
      offhand: enc(this.offhand),
      selected: this.selected,
    };
  }

  deserialize(o) {
    if (!o) return;
    const dec = (a) => {
      if (!a) return null;
      if (!getItem(a[0])) return null;
      const s = { key: a[0], count: a[1] };
      if (a.length > 2) s.dur = a[2];
      else if (maxDurability(a[0])) s.dur = maxDurability(a[0]);
      return s;
    };
    this.slots = (o.slots || []).slice(0,MAIN_SIZE).map(dec);
    while (this.slots.length < MAIN_SIZE) this.slots.push(null);
    this.armor = (o.armor || [null, null, null, null]).map(dec);
    this.craft = (o.craft || [null, null, null, null]).map(dec);
    this.offhand = dec(o.offhand);
    this.selected = Number.isInteger(o.selected) ? Math.max(0,Math.min(8,o.selected)) : 0;
    this.changed();
  }
}

