// ============================================================================
// Furnace: smelting recipes, fuel burn times and the per-tick simulation that
// runs for every placed furnace whether or not its UI is open.
// ============================================================================

import { getItem } from './items.js';

export const SMELTING = new Map([
  ['raw_iron', { out: 'iron_ingot', count: 1, xp: 0.7 }],
  ['raw_gold', { out: 'gold_ingot', count: 1, xp: 1.0 }],
  ['iron_ore', { out: 'iron_ingot', count: 1, xp: 0.7 }],
  ['gold_ore', { out: 'gold_ingot', count: 1, xp: 1.0 }],
  ['sand', { out: 'glass', count: 1, xp: 0.1 }],
  ['red_sand', { out: 'glass', count: 1, xp: 0.1 }],
  ['cobblestone', { out: 'stone', count: 1, xp: 0.1 }],
  ['clay_ball', { out: 'brick', count: 1, xp: 0.3 }],
  ['oak_log', { out: 'charcoal', count: 1, xp: 0.15 }],
  ['birch_log', { out: 'charcoal', count: 1, xp: 0.15 }],
  ['spruce_log', { out: 'charcoal', count: 1, xp: 0.15 }],
  ['raw_beef', { out: 'cooked_beef', count: 1, xp: 0.35 }],
  ['raw_porkchop', { out: 'cooked_porkchop', count: 1, xp: 0.35 }],
  ['raw_chicken', { out: 'cooked_chicken', count: 1, xp: 0.35 }],
  ['raw_mutton', { out: 'cooked_mutton', count: 1, xp: 0.35 }],
  ['netherrack', { out: 'nether_bricks', count: 1, xp: 0.1 }],
  ['wheat_seeds', { out: 'wheat', count: 1, xp: 0.05 }],
  ['stone', { out: 'smooth_stone', count: 1, xp: 0.1 }],
  ['sandstone', { out: 'smooth_sandstone', count: 1, xp: 0.1 }],
  ['clay', { out: 'terracotta', count: 1, xp: 0.35 }],
  ['raw_cod', { out: 'cooked_cod', count: 1, xp: 0.35 }],
  ['raw_salmon', { out: 'cooked_salmon', count: 1, xp: 0.35 }],
]);

export function smeltResult(key) { return key ? SMELTING.get(key) || null : null; }

export function fuelTicks(key) {
  const it = getItem(key);
  return it ? it.fuel : 0;
}

export const SMELT_TIME = 200;   // ticks (10 s at 20 tps), matching vanilla

/** Blank furnace state. */
export function newFurnace() {
  return { input: null, fuel: null, output: null, burn: 0, burnMax: 0, cook: 0, xp: 0 };
}

/**
 * Advance a furnace by `ticks`. Returns true if anything changed (so the UI can
 * refresh and the lit/unlit block state can be swapped).
 */
export function tickFurnace(f, ticks) {
  let changed = false;
  for (let t = 0; t < ticks; t++) {
    const recipe = smeltResult(f.input?.key);
    const canOutput = recipe && (!f.output ||
      (f.output.key === recipe.out && f.output.count + recipe.count <= 64));

    if (f.burn > 0) { f.burn--; changed = true; }

    if (f.burn <= 0 && canOutput && f.fuel) {
      const ft = fuelTicks(f.fuel.key);
      if (ft > 0) {
        f.burnMax = ft;
        f.burn = ft;
        const wasBucket = f.fuel.key === 'lava_bucket';
        f.fuel.count--;
        if (f.fuel.count <= 0) f.fuel = wasBucket ? { key: 'bucket', count: 1 } : null;
        changed = true;
      }
    }

    if (f.burn > 0 && canOutput) {
      f.cook++;
      changed = true;
      if (f.cook >= SMELT_TIME) {
        f.cook = 0;
        f.input.count--;
        if (f.input.count <= 0) f.input = null;
        if (f.output) f.output.count += recipe.count;
        else f.output = { key: recipe.out, count: recipe.count };
        f.xp += recipe.xp;
      }
    } else if (f.cook > 0) {
      f.cook = Math.max(0, f.cook - 2);
      changed = true;
    }
  }
  return changed;
}

export const isLit = (f) => f.burn > 0;
