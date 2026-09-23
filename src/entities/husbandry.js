// ============================================================================
// Animal husbandry, taming, villager professions and mob save records.
// Pure data and rules only — the Mob class calls into these so the same
// tables drive the game and the Node test-suite.
// ============================================================================

import { MOBS } from './mobs.js';
import { getItem } from '../crafting/items.js';

/** What each animal eats; feeding two nearby adults makes a baby. */
export const BREEDING_FOOD = {
  cow: ['wheat'],
  sheep: ['wheat'],
  pig: ['carrot', 'potato', 'beetroot', 'wheat'],   // the first three don't exist yet; wheat does
  chicken: ['wheat_seeds', 'melon_seeds', 'pumpkin_seeds'],
  wolf: ['raw_beef', 'raw_porkchop', 'raw_chicken', 'raw_mutton', 'cooked_beef', 'cooked_porkchop', 'cooked_chicken', 'cooked_mutton', 'rotten_flesh'],
};

/** Items that tame a wild animal, with the chance per attempt. */
export const TAMING = {
  wolf: { item: 'bone', chance: 1 / 3 },
};

export const BABY_GROW_SECONDS = 20 * 60 / 6;   // 200 s — a real day is 20 min; babies grow in a third of one
export const LOVE_SECONDS = 30;
export const BREED_COOLDOWN_SECONDS = 5 * 60 / 2;  // 150 s
export const WOOL_REGROW_SECONDS = 90;

/** Which food key in `stack` feeds this mob type, or null. */
export function foodFor(type, stack) {
  if (!stack) return null;
  const list = BREEDING_FOOD[type];
  if (!list) return null;
  const key = stack.key.replace(/_ench\d$/, '');
  return list.includes(key) && getItem(key) ? key : null;
}

export function canBreed(type) { return !!BREEDING_FOOD[type] && MOBS[type]?.category === 'passive'; }

// ---------------------------------------------------------------------------
// Villager professions — each gets its own trade list, chosen once and saved.
// ---------------------------------------------------------------------------
export const PROFESSIONS = {
  farmer: {
    name: 'Farmer',
    trades: [
      { give: { key: 'wheat', count: 20 }, get: { key: 'emerald', count: 1 } },
      { give: { key: 'wheat_seeds', count: 24 }, get: { key: 'emerald', count: 1 } },
      { give: { key: 'emerald', count: 1 }, get: { key: 'bread', count: 4 } },
      { give: { key: 'emerald', count: 1 }, get: { key: 'apple', count: 4 } },
      { give: { key: 'emerald', count: 2 }, get: { key: 'bone_meal', count: 6 } },
    ],
  },
  librarian: {
    name: 'Librarian',
    trades: [
      { give: { key: 'paper', count: 24 }, get: { key: 'emerald', count: 1 } },
      { give: { key: 'book', count: 4 }, get: { key: 'emerald', count: 1 } },
      { give: { key: 'emerald', count: 3 }, get: { key: 'lapis_lazuli', count: 8 } },
      { give: { key: 'emerald', count: 1 }, get: { key: 'glass', count: 6 } },
      { give: { key: 'emerald', count: 5 }, get: { key: 'bookshelf', count: 1 } },
    ],
  },
  toolsmith: {
    name: 'Toolsmith',
    trades: [
      { give: { key: 'coal', count: 16 }, get: { key: 'emerald', count: 1 } },
      { give: { key: 'iron_ingot', count: 4 }, get: { key: 'emerald', count: 1 } },
      { give: { key: 'emerald', count: 6 }, get: { key: 'iron_pickaxe', count: 1 } },
      { give: { key: 'emerald', count: 5 }, get: { key: 'iron_axe', count: 1 } },
      { give: { key: 'emerald', count: 4 }, get: { key: 'iron_hoe', count: 1 } },
    ],
  },
  cleric: {
    name: 'Cleric',
    trades: [
      { give: { key: 'rotten_flesh', count: 32 }, get: { key: 'emerald', count: 1 } },
      { give: { key: 'gold_ingot', count: 3 }, get: { key: 'emerald', count: 1 } },
      { give: { key: 'emerald', count: 1 }, get: { key: 'redstone', count: 4 } },
      { give: { key: 'emerald', count: 2 }, get: { key: 'glowstone_dust', count: 4 } },
      { give: { key: 'emerald', count: 4 }, get: { key: 'ender_pearl', count: 1 } },
    ],
  },
  butcher: {
    name: 'Butcher',
    trades: [
      { give: { key: 'raw_chicken', count: 14 }, get: { key: 'emerald', count: 1 } },
      { give: { key: 'raw_porkchop', count: 7 }, get: { key: 'emerald', count: 1 } },
      { give: { key: 'raw_beef', count: 10 }, get: { key: 'emerald', count: 1 } },
      { give: { key: 'emerald', count: 1 }, get: { key: 'cooked_porkchop', count: 5 } },
      { give: { key: 'emerald', count: 1 }, get: { key: 'cooked_beef', count: 4 } },
    ],
  },
};

export const PROFESSION_KEYS = Object.keys(PROFESSIONS);

/** Only trades whose items really exist are offered — a typo can't sell air. */
export function tradesFor(profession) {
  const p = PROFESSIONS[profession] || PROFESSIONS.farmer;
  return p.trades.filter((t) => getItem(t.give.key) && getItem(t.get.key));
}

export function randomProfession(rng = Math.random) {
  return PROFESSION_KEYS[Math.floor(rng() * PROFESSION_KEYS.length)];
}

// ---------------------------------------------------------------------------
// Save records
// ---------------------------------------------------------------------------

/** Plain-object snapshot of a mob for the world save. */
export function mobRecord(m) {
  const r = { t: 'mob', type: m.kind, x: m.pos.x, y: m.pos.y, z: m.pos.z, hp: m.health };
  if (m.persistent) r.p = 1;
  if (m.baby) r.baby = Math.max(0, Math.round(m.growTimer));
  if (m.tamed) r.tamed = 1;
  if (m.sitting) r.sit = 1;
  if (m.sheared) r.sheared = Math.max(0, Math.round(m.woolTimer));
  if (m.profession) r.prof = m.profession;
  if (m.breedCooldown > 0) r.cd = Math.round(m.breedCooldown);
  if (m.size !== 1 && !m.baby) r.size = m.size;
  return r;
}

/** Is this a well-formed mob record we can safely rebuild? */
export function validMobRecord(r) {
  if (!r || typeof r !== 'object' || r.t !== 'mob') return false;
  if (!MOBS[r.type]) return false;
  for (const k of ['x', 'y', 'z']) if (!Number.isFinite(r[k])) return false;
  if (r.hp !== undefined && !Number.isFinite(r.hp)) return false;
  if (r.prof !== undefined && !PROFESSIONS[r.prof]) return false;
  return true;
}

/** Build the constructor options + post-construction state from a record. */
export function applyMobRecord(m, r) {
  const def = MOBS[m.kind];
  m.health = Math.min(m.maxHealth, Math.max(1, Number.isFinite(r.hp) ? r.hp : def.hp));
  m.persistent = !!r.p || !!def.persistent || !!r.tamed || r.baby !== undefined;
  if (r.tamed) { m.tamed = true; m.angry = false; }
  if (r.sit) m.sitting = true;
  if (r.sheared !== undefined) { m.sheared = true; m.woolTimer = Math.max(1, r.sheared); }
  if (r.prof) m.profession = r.prof;
  if (r.cd) m.breedCooldown = r.cd;
  if (r.baby !== undefined) m.setBaby(Math.max(1, r.baby));
  return m;
}
