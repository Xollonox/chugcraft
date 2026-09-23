// ============================================================================
// Item registry. Items are keyed by string ("diamond_pickaxe"), which keeps
// recipes readable and makes save files self-describing.
//
// Every placeable block automatically gets an item unless it declares noItem.
// ============================================================================

import { BLOCKS, BLOCK_COUNT, B } from '../world/blocks.js';
import { TIER } from '../constants.js';

export const ITEMS = new Map();

function item(key, name, o = {}) {
  const it = {
    key, name,
    stack: o.stack ?? 64,
    block: o.block ?? null,     // block id placed on right-click
    icon: o.icon ?? key,        // icon painter name (block items use 'block:<id>')
    tool: o.tool ?? null,       // { type, tier, speed, damage, durability }
    armor: o.armor ?? null,     // { slot, points, toughness, durability }
    food: o.food ?? null,       // { hunger, sat, effect }
    fuel: o.fuel ?? 0,          // furnace burn time in ticks
    useAction: o.useAction ?? null,
    rarity: o.rarity ?? 0,      // 0 common, 1 uncommon, 2 rare, 3 epic
    desc: o.desc ?? null,
    group: o.group ?? 'misc',   // creative-inventory tab
    creativeOnly: o.creativeOnly ?? false,
    upgrade: o.upgrade ?? null,
    potion: o.potion ?? null,
    offhand: o.offhand ?? false,   // belongs in the off hand (shields)
  };
  ITEMS.set(key, it);
  return it;
}

export const getItem = (key) => ITEMS.get(key) || null;

// ---------------------------------------------------------------------------
// Block items â€” generated straight from the block registry.
// ---------------------------------------------------------------------------
for (let id = 1; id < BLOCK_COUNT; id++) {
  const b = BLOCKS[id];
  if (!b || b.id !== id || b.noItem) continue;
  item(b.key, b.name, {
    block: id,
    icon: `block:${id}`,
    fuel: b.fuel,
    rarity: id === B.DIAMOND_BLOCK || id === B.DRAGON_EGG ? 2 : 0,
    group: b.render === 'cross' ? 'nature' : 'building',
    creativeOnly: b.creativeOnly,
  });
}
// Nether wart is harvested mature but planted as a sprout.
ITEMS.get('nether_wart').block = B.WART_0;

// ---------------------------------------------------------------------------
// Raw materials
// ---------------------------------------------------------------------------
item('stick', 'Stick', { fuel: 100 });
item('coal', 'Coal', { fuel: 1600 });
item('charcoal', 'Charcoal', { fuel: 1600 });
item('raw_iron', 'Raw Iron');
item('iron_ingot', 'Iron Ingot');
item('raw_gold', 'Raw Gold');
item('gold_ingot', 'Gold Ingot');
item('gold_nugget', 'Gold Nugget');
item('diamond', 'Diamond', { rarity: 1 });
item('emerald', 'Emerald', { rarity: 1 });
item('redstone', 'Redstone Dust');
item('lapis_lazuli', 'Lapis Lazuli');
item('quartz', 'Nether Quartz');
item('glowstone_dust', 'Glowstone Dust');
item('gunpowder', 'Gunpowder');
item('string', 'String');
item('feather', 'Feather');
item('leather', 'Leather');
item('bone', 'Bone');
item('flint', 'Flint');
item('clay_ball', 'Clay Ball');
item('brick', 'Brick');
item('paper', 'Paper');
item('book', 'Book');
item('wheat', 'Wheat');
item('wheat_seeds', 'Wheat Seeds', { block: B.WHEAT_0, icon: 'wheat_seeds' });
item('snowball', 'Snowball', { stack: 16, useAction: 'throw_snowball' });
item('oak_sapling', 'Oak Sapling', { fuel: 100, block: B.OAK_SAPLING });
item('melon_slice', 'Melon Slice', { food: { hunger: 2, sat: 1.2 } });
item('rotten_flesh', 'Rotten Flesh', { food: { hunger: 4, sat: 0.8, effect: 'hunger' } });
item('spider_eye', 'Spider Eye', { food: { hunger: 2, sat: 3.2, effect: 'poison' } });
item('slimeball', 'Slimeball');
item('egg', 'Egg', { stack: 16 });
item('ghast_tear', 'Ghast Tear', { rarity: 1 });
item('magma_cream', 'Magma Cream');
item('arrow', 'Arrow');

// --- the win path ----------------------------------------------------------
item('blaze_rod', 'Blaze Rod', { rarity: 1, fuel: 2400, desc: 'Grind it into blaze powder.' });
item('blaze_powder', 'Blaze Powder', { rarity: 1 });
item('ender_pearl', 'Ender Pearl', { stack: 16, rarity: 1, useAction: 'throw_pearl', desc: 'Throw to teleport.' });
item('ender_eye', 'Eye of Ender', {
  stack: 64, rarity: 2, useAction: 'throw_eye',
  desc: 'Throw it to seek the nearest stronghold.',
});

// ---------------------------------------------------------------------------
// Food
// ---------------------------------------------------------------------------
item('apple', 'Apple', { food: { hunger: 4, sat: 2.4 } });
item('bread', 'Bread', { food: { hunger: 5, sat: 6 } });
item('raw_beef', 'Raw Beef', { food: { hunger: 3, sat: 1.8 } });
item('cooked_beef', 'Steak', { food: { hunger: 8, sat: 12.8 } });
item('raw_porkchop', 'Raw Porkchop', { food: { hunger: 3, sat: 1.8 } });
item('cooked_porkchop', 'Cooked Porkchop', { food: { hunger: 8, sat: 12.8 } });
item('raw_chicken', 'Raw Chicken', { food: { hunger: 2, sat: 1.2 } });
item('cooked_chicken', 'Cooked Chicken', { food: { hunger: 6, sat: 7.2 } });
item('raw_mutton', 'Raw Mutton', { food: { hunger: 2, sat: 1.2 } });
item('cooked_mutton', 'Cooked Mutton', { food: { hunger: 6, sat: 9.6 } });
item('golden_apple', 'Golden Apple', {
  rarity: 2, food: { hunger: 4, sat: 9.6, effect: 'regen' },
});

// --- dyes and dye sources --------------------------------------------------
item('bone_meal', 'Bone Meal', { group: 'materials', useAction: 'bone_meal' });
item('ink_sac', 'Ink Sac', { group: 'materials' });
item('honeycomb', 'Honeycomb', { group: 'materials' });
item('sugar', 'Sugar', { group: 'materials' });
const DYES = [
  ['red_dye', 'Red Dye'], ['orange_dye', 'Orange Dye'], ['yellow_dye', 'Yellow Dye'],
  ['green_dye', 'Green Dye'], ['blue_dye', 'Blue Dye'], ['purple_dye', 'Purple Dye'],
  ['black_dye', 'Black Dye'], ['white_dye', 'White Dye'],
];
for (const [key, name] of DYES) item(key, name, { group: 'materials' });

// --- fish ------------------------------------------------------------------
item('raw_cod', 'Raw Cod', { food: { hunger: 2, sat: 0.4 }, group: 'food' });
item('cooked_cod', 'Cooked Cod', { food: { hunger: 5, sat: 6 }, group: 'food' });
item('raw_salmon', 'Raw Salmon', { food: { hunger: 2, sat: 0.4 }, group: 'food' });
item('cooked_salmon', 'Cooked Salmon', { food: { hunger: 6, sat: 9.6 }, group: 'food' });

// --- extra food ------------------------------------------------------------
item('cookie', 'Cookie', { food: { hunger: 2, sat: 0.4 }, group: 'food' });
item('pumpkin_pie', 'Pumpkin Pie', { food: { hunger: 8, sat: 4.8 }, group: 'food' });

item('fishing_rod', 'Fishing Rod', {
  stack: 1, group: 'tools', useAction: 'fish',
  tool: { type: 'rod', tier: 0, speed: 1, damage: 1, durability: 64 },
});

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------
export const TOOL_MATERIALS = {
  wooden: { tier: TIER.WOOD, speed: 2, dur: 59, dmg: 0, name: 'Wooden' },
  stone: { tier: TIER.STONE, speed: 4, dur: 131, dmg: 1, name: 'Stone' },
  iron: { tier: TIER.IRON, speed: 6, dur: 250, dmg: 2, name: 'Iron' },
  diamond: { tier: TIER.DIAMOND, speed: 8, dur: 1561, dmg: 3, name: 'Diamond' },
};

const TOOL_KINDS = {
  pickaxe: { name: 'Pickaxe', baseDmg: 2 },
  axe: { name: 'Axe', baseDmg: 6 },
  shovel: { name: 'Shovel', baseDmg: 2.5 },
  sword: { name: 'Sword', baseDmg: 4, speedIsDamage: true },
  hoe: { name: 'Hoe', baseDmg: 1 },
};

for (const [mat, m] of Object.entries(TOOL_MATERIALS)) {
  for (const [kind, k] of Object.entries(TOOL_KINDS)) {
    const key = `${mat}_${kind}`;
    item(key, `${m.name} ${k.name}`, {
      stack: 1, group: kind === 'sword' ? 'combat' : 'tools',
      icon: key,
      fuel: mat === 'wooden' ? 200 : 0,
      rarity: mat === 'diamond' ? 1 : 0,
      tool: {
        type: kind,
        tier: m.tier,
        speed: kind === 'sword' ? 1.5 : m.speed,
        damage: k.baseDmg + (kind === 'sword' ? m.dmg : Math.max(0, m.dmg - 1)),
        durability: kind === 'sword' ? Math.round(m.dur * 1.0) : m.dur,
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Armor
// ---------------------------------------------------------------------------
export const ARMOR_SLOTS = ['helmet', 'chestplate', 'leggings', 'boots'];
const ARMOR_MATERIALS = {
  leather: { name: 'Leather', points: [1, 3, 2, 1], dur: [55, 80, 75, 65], tough: 0 },
  iron: { name: 'Iron', points: [2, 6, 5, 2], dur: [165, 240, 225, 195], tough: 0 },
  diamond: { name: 'Diamond', points: [3, 8, 6, 3], dur: [363, 528, 495, 429], tough: 2 },
};
const ARMOR_PIECE_NAMES = { helmet: 'Helmet', chestplate: 'Chestplate', leggings: 'Leggings', boots: 'Boots' };

for (const [mat, m] of Object.entries(ARMOR_MATERIALS)) {
  ARMOR_SLOTS.forEach((slot, i) => {
    const key = `${mat}_${slot}`;
    item(key, `${m.name} ${ARMOR_PIECE_NAMES[slot]}`, {
      stack: 1, icon: key, rarity: mat === 'diamond' ? 1 : 0,
      armor: { slot, index: i, points: m.points[i], toughness: m.tough, durability: m.dur[i], material: mat },
    });
  });
}

// ---------------------------------------------------------------------------
// Special-use items
// ---------------------------------------------------------------------------
item('flint_and_steel', 'Flint and Steel', {
  stack: 1, useAction: 'ignite',
  tool: { type: 'igniter', tier: 0, speed: 1, damage: 1, durability: 64 },
  desc: 'Lights fires and nether portals.',
});
item('bucket', 'Bucket', { stack: 1, useAction: 'bucket_fill' });
item('water_bucket', 'Water Bucket', { stack: 1, useAction: 'bucket_place' });
item('lava_bucket', 'Lava Bucket', { stack: 1, useAction: 'bucket_place', fuel: 20000 });
item('shears', 'Shears', {
  stack: 1,
  tool: { type: 'shears', tier: 0, speed: 5, damage: 1, durability: 238 },
});
item('bow', 'Bow', {
  stack: 1, useAction: 'bow',
  tool: { type: 'bow', tier: 0, speed: 1, damage: 1, durability: 384 },
});
item('shield', 'Shield', {
  stack: 1, useAction: 'block', offhand: true,
  tool: { type: 'shield', tier: 0, speed: 1, damage: 1, durability: 336 },
  desc: 'Hold in your off hand and use it to block.',
});

// Deterministic enchant tiers: keys carry the upgrade through every existing
// container, drop and save path without silently discarding stack metadata.
for (const [key, base] of [...ITEMS]) {
  if ((!base.tool || !['pickaxe','axe','shovel','sword','hoe'].includes(base.tool.type)) && !base.armor) continue;
  for (let rank=1;rank<=3;rank++) {
    const tool=base.tool ? {...base.tool,
      speed:base.tool.speed+(base.tool.type==='sword'?0:rank*2),
      damage:base.tool.damage+(['sword','axe'].includes(base.tool.type)?rank:0),
      durability:Math.round(base.tool.durability*(1+rank*0.5))} : null;
    const armor=base.armor ? {...base.armor,points:base.armor.points+rank,
      durability:Math.round(base.armor.durability*(1+rank*0.5))} : null;
    item(`${key}_ench${rank}`, `${base.name} · ${['','I','II','III'][rank]}`, {
      ...base,tool,armor,rarity:3,upgrade:{base:key,rank},
      desc: `${armor?'Protection':base.tool.type==='sword'?'Sharpness':base.tool.type==='axe'?'Sharpness / Efficiency':'Efficiency'} ${rank} | Durability +${rank*50}%`,
    });
  }
}
item('glass_bottle','Glass Bottle',{stack:16,useAction:'fill_bottle',group:'tools'});
item('water_bottle','Water Bottle',{stack:1,useAction:'drink',potion:{effect:null,seconds:0,color:0x438cdd},group:'food'});
item('awkward_potion','Awkward Potion',{stack:1,useAction:'drink',potion:{effect:null,seconds:0,color:0x9563bc},group:'food',desc:'Brewing base. Mix at a Brewing Stand.'});
export const POTION_EFFECTS = {
  speed:{name:'Speed',seconds:180,color:0x72d7e9,desc:'20% faster movement'},
  strength:{name:'Strength',seconds:180,color:0xd85c72,desc:'+3 melee damage'},
  fire_resistance:{name:'Fire Resistance',seconds:180,color:0xf2a346,desc:'Prevents fire and lava damage'},
  regeneration:{name:'Regeneration',seconds:30,color:0xf387ca,desc:'Heals one health every 2 seconds'},
  healing:{name:'Healing',seconds:0,color:0xeb425a,desc:'Instantly restores 4 health'},
};
for (const [effect,p] of Object.entries(POTION_EFFECTS)) item(`potion_${effect}`,`Potion of ${p.name}`,{
  stack:1,useAction:'drink',potion:{...p,effect},rarity:1,group:'food',desc:p.desc+(p.seconds?` (${p.seconds}s)`:'')});

/** Tools/armor start with full durability; everything else stacks plainly. */
export function makeStack(key, count = 1) {
  const it = getItem(key);
  if (!it) return null;
  const s = { key, count };
  const dur = it.tool?.durability ?? it.armor?.durability;
  if (dur) s.dur = dur;
  return s;
}

export function maxDurability(key) {
  const it = getItem(key);
  return it?.tool?.durability ?? it?.armor?.durability ?? 0;
}

export const RARITY_COLOR = ['#ffffff', '#ffff55', '#55ffff', '#ff55ff'];

// ---------------------------------------------------------------------------
// Creative inventory tabs
// ---------------------------------------------------------------------------

/** Anything not explicitly tagged gets a sensible tab from its properties. */
for (const it of ITEMS.values()) {
  if (it.group !== 'misc') continue;
  if (it.food) it.group = 'food';
  else if (it.armor) it.group = 'combat';
  else if (it.tool) it.group = (it.tool.type === 'sword' || it.tool.type === 'bow') ? 'combat' : 'tools';
  else if (it.block !== null && it.block !== undefined) it.group = 'building';
  else it.group = 'materials';
}

export const CREATIVE_GROUPS = [
  ['building', 'Building Blocks'],
  ['nature', 'Nature'],
  ['tools', 'Tools'],
  ['combat', 'Combat'],
  ['food', 'Food'],
  ['materials', 'Materials'],
];

/** Every item a Creative player can pull from the palette, grouped by tab. */
export function creativeCatalogue() {
  const out = new Map(CREATIVE_GROUPS.map(([g]) => [g, []]));
  for (const it of ITEMS.values()) {
    const list = out.get(it.group) || out.get('materials');
    list.push(it.key);
  }
  return out;
}

item('glistering_melon','Glistering Melon',{icon:'melon_slice',group:'materials',rarity:1});
