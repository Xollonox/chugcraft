// ============================================================================
// Block registry. Worker-safe (no DOM). Every block is described declaratively
// so the mesher, lighting engine, mining code, and drops table all read from one
// source of truth.
//
//   pass     which geometry batch the block's faces land in
//   render   geometry shape: cube / cross (plants) / liquid / torch / layer
//   opaque   fully blocks skylight and culls neighbouring faces
//   filter   extra light attenuation for non-opaque blocks (water, leaves)
//   tier     minimum tool tier that yields a drop (see TIER in constants.js)
// ============================================================================

import { PASS, TIER } from '../constants.js';

export const B = {
  AIR: 0,
  STONE: 1, GRANITE: 2, ANDESITE: 3, DIORITE: 4,
  GRASS: 5, DIRT: 6, PATH: 7, COBBLESTONE: 8,
  SAND: 9, RED_SAND: 10, SANDSTONE: 11, GRAVEL: 12, CLAY: 13,
  BEDROCK: 14, WATER: 15, LAVA: 16,
  OAK_LOG: 17, OAK_PLANKS: 18, OAK_LEAVES: 19,
  BIRCH_LOG: 20, BIRCH_PLANKS: 21, BIRCH_LEAVES: 22,
  SPRUCE_LOG: 23, SPRUCE_PLANKS: 24, SPRUCE_LEAVES: 25,
  COAL_ORE: 26, IRON_ORE: 27, GOLD_ORE: 28, DIAMOND_ORE: 29,
  REDSTONE_ORE: 30, LAPIS_ORE: 31,
  GLASS: 32, OBSIDIAN: 33,
  SNOW_BLOCK: 34, SNOW_LAYER: 35, ICE: 36,
  CRAFTING_TABLE: 37, FURNACE: 38, FURNACE_LIT: 39, CHEST: 40, TORCH: 41,
  TALL_GRASS: 42, DEAD_BUSH: 43, FLOWER_RED: 44, FLOWER_YELLOW: 45,
  CACTUS: 46, PUMPKIN: 47, MELON: 48,
  NETHERRACK: 49, SOUL_SAND: 50, GLOWSTONE: 51, QUARTZ_ORE: 52,
  NETHER_BRICKS: 53, MAGMA: 54, NETHER_PORTAL: 55,
  END_STONE: 56, END_PORTAL_FRAME: 57, END_PORTAL_FRAME_EYE: 58, END_PORTAL: 59,
  STONE_BRICKS: 60, CRACKED_STONE_BRICKS: 61, MOSSY_STONE_BRICKS: 62,
  BOOKSHELF: 63, SPAWNER: 64, WOOL: 65, TNT: 66,
  COAL_BLOCK: 67, IRON_BLOCK: 68, GOLD_BLOCK: 69, DIAMOND_BLOCK: 70,
  DRAGON_EGG: 71, FIRE: 72, BED: 73, LADDER: 74, TORCH_WALL: 75,
  BRICKS: 76, COBBLE_MOSSY: 77, OAK_DOOR: 78, GLOWING_OBSIDIAN: 79,
  RED_SANDSTONE: 80, WHEAT: 81, FARMLAND: 82, SUGAR_CANE: 83,
  IRON_BARS: 84, SPONGE: 85, LAPIS_BLOCK: 86, EMERALD_ORE: 87,

  // --- slabs ---
  SLAB_STONE: 88, SLAB_COBBLE: 89, SLAB_OAK: 90, SLAB_BIRCH: 91, SLAB_SPRUCE: 92,
  SLAB_SANDSTONE: 93, SLAB_BRICKS: 94, SLAB_STONE_BRICKS: 95, SLAB_QUARTZ: 96,
  // --- decorative stone ---
  QUARTZ_BLOCK: 97, CHISELED_QUARTZ: 98, SMOOTH_STONE: 99,
  POLISHED_GRANITE: 100, POLISHED_ANDESITE: 101, POLISHED_DIORITE: 102,
  CHISELED_STONE_BRICKS: 103, CHISELED_SANDSTONE: 104, SMOOTH_SANDSTONE: 105,
  END_STONE_BRICKS: 106, TERRACOTTA: 107, PACKED_ICE: 108,
  // --- storage / misc ---
  EMERALD_BLOCK: 109, REDSTONE_BLOCK: 110, HAY_BLOCK: 111,
  HONEYCOMB_BLOCK: 112, BEE_NEST: 113, JACK_O_LANTERN: 114,
  // --- coloured wool ---
  WOOL_RED: 115, WOOL_ORANGE: 116, WOOL_YELLOW: 117, WOOL_GREEN: 118,
  WOOL_BLUE: 119, WOOL_PURPLE: 120, WOOL_BLACK: 121,
  // --- underwater flora ---
  SEAGRASS: 122, KELP: 123,
  // --- doors ---
  // A door's swing lives in its block id rather than in separate metadata:
  // OAK_DOOR is a doorway running north-south, and its open variant is the
  // same panel turned a quarter turn onto the side wall. OAK_DOOR itself is
  // the closed north-south door, so the `oak_door` item keeps its id.
  DOOR_Z_OPEN: 124, DOOR_X: 125, DOOR_X_OPEN: 126,
  // --- beds: foot + head, per axis ---
  BED_HEAD: 127, BED_X: 128, BED_HEAD_X: 129,
  ENCHANTING_TABLE: 130, ANVIL: 131, BREWING_STAND: 132, NETHER_WART: 133,
  // 3.2: saved liquid levels and building states (all fit in the old 192 ID table).
  WATER_FLOW_1:140, WATER_FALL:147, LAVA_FLOW_1:148, LAVA_FALL:151,
  BIRCH_DOOR:152, BIRCH_DOOR_Z_OPEN:153, BIRCH_DOOR_X:154, BIRCH_DOOR_X_OPEN:155,
  SPRUCE_DOOR:156, SPRUCE_DOOR_Z_OPEN:157, SPRUCE_DOOR_X:158, SPRUCE_DOOR_X_OPEN:159,
  GLASS_PANE:160, BLUE_GLASS_PANE:161, AMBER_GLASS_PANE:162, ROSE_GLASS_PANE:163,
  OAK_FENCE:164, OAK_GATE:165, OAK_GATE_OPEN:166, OAK_GATE_X:167, OAK_GATE_X_OPEN:168,
  OAK_TRAPDOOR:169, OAK_TRAPDOOR_OPEN:170, OAK_TRAPDOOR_X:171, OAK_TRAPDOOR_X_OPEN:172,
  LANTERN:173, MOSAIC:174, BASALT_TILES:175, BLUE_GLASS:176, AMBER_GLASS:177, ROSE_GLASS:178,
  // --- 3.1: growth stages and saplings (mature stages keep their old ids) ---
  WHEAT_0: 134, WHEAT_1: 135, WHEAT_2: 136, WART_0: 137, WART_1: 138, OAK_SAPLING: 139,
};

export const BLOCK_COUNT = 192;
export const BLOCKS = new Array(BLOCK_COUNT).fill(null);

/** Normalise a texture spec into the 6-face array [+X,-X,+Y,-Y,+Z,-Z]. */
function faces(tex) {
  if (typeof tex === 'string') return [tex, tex, tex, tex, tex, tex];
  const all = tex.all ?? tex.side ?? 'stone';
  const side = tex.side ?? all;
  return [
    tex.px ?? side, tex.nx ?? side,
    tex.py ?? tex.top ?? all, tex.ny ?? tex.bottom ?? tex.top ?? all,
    tex.pz ?? side, tex.nz ?? side,
  ];
}

function def(id, key, name, o = {}) {
  const solid = o.solid ?? true;
  const b = {
    id, key, name,
    tex: faces(o.tex ?? key),
    pass: o.pass ?? PASS.OPAQUE,
    render: o.render ?? 'cube',
    solid,
    // `opaque` drives both light occlusion and face culling for cubes.
    opaque: o.opaque ?? (solid && (o.render ?? 'cube') === 'cube'),
    occludes: o.occludes ?? (o.opaque ?? (solid && (o.render ?? 'cube') === 'cube')),
    selfCull: o.selfCull ?? true,
    filter: o.filter ?? 0,
    emit: o.emit ?? 0,
    hardness: o.hardness ?? 1,
    tool: o.tool ?? null,
    tier: o.tier ?? TIER.HAND,
    drop: o.drop === undefined ? key : o.drop,
    dropMin: o.dropMin ?? 1,
    dropMax: o.dropMax ?? 1,
    dropAlt: o.dropAlt ?? null,     // [itemKey, chance] rolled instead of `drop`
    tint: o.tint ?? null,
    liquid: o.liquid ?? false,
    climbable: o.climbable ?? false,
    replaceable: o.replaceable ?? false,
    gravity: o.gravity ?? false,
    flammable: o.flammable ?? false,
    hurt: o.hurt ?? 0,             // contact damage per second
    slip: o.slip ?? 0,             // 0 = normal friction, 1 = ice
    slow: o.slow ?? 0,             // 0..1 movement penalty (soul sand)
    height: o.height ?? 1,         // collision height for layer blocks
    entity: o.entity ?? null,      // 'chest' | 'furnace' | 'spawner' | 'bed'
    xp: o.xp ?? 0,                 // XP dropped when mined
    interact: o.interact ?? null,  // container/gui opened on right click
    fuel: o.fuel ?? 0,             // burn ticks if used as furnace fuel
    itemKey: o.itemKey ?? key,     // inventory item this block corresponds to
    noItem: o.noItem ?? false,     // block exists only in world, no item form
    creativeOnly: o.creativeOnly ?? false,  // in the creative palette, uncraftable
    fallDamageMult: o.fallDamageMult ?? 1,
  };
  BLOCKS[id] = b;
  return b;
}

// --- stone family ----------------------------------------------------------
def(B.AIR, 'air', 'Air', {
  solid: false, opaque: false, occludes: false, render: 'none',
  hardness: 0, drop: null, replaceable: true, noItem: true, pass: PASS.CUTOUT,
});
def(B.STONE, 'stone', 'Stone', { hardness: 1.5, tool: 'pickaxe', tier: TIER.WOOD, drop: 'cobblestone' });
def(B.GRANITE, 'granite', 'Granite', { hardness: 1.5, tool: 'pickaxe', tier: TIER.WOOD });
def(B.ANDESITE, 'andesite', 'Andesite', { hardness: 1.5, tool: 'pickaxe', tier: TIER.WOOD });
def(B.DIORITE, 'diorite', 'Diorite', { hardness: 1.5, tool: 'pickaxe', tier: TIER.WOOD });
def(B.COBBLESTONE, 'cobblestone', 'Cobblestone', { hardness: 2, tool: 'pickaxe', tier: TIER.WOOD });
def(B.COBBLE_MOSSY, 'mossy_cobblestone', 'Mossy Cobblestone', { hardness: 2, tool: 'pickaxe', tier: TIER.WOOD });
def(B.STONE_BRICKS, 'stone_bricks', 'Stone Bricks', { hardness: 1.5, tool: 'pickaxe', tier: TIER.WOOD });
def(B.CRACKED_STONE_BRICKS, 'cracked_stone_bricks', 'Cracked Stone Bricks', { hardness: 1.5, tool: 'pickaxe', tier: TIER.WOOD });
def(B.MOSSY_STONE_BRICKS, 'mossy_stone_bricks', 'Mossy Stone Bricks', { hardness: 1.5, tool: 'pickaxe', tier: TIER.WOOD });
def(B.BRICKS, 'bricks', 'Bricks', { hardness: 2, tool: 'pickaxe', tier: TIER.WOOD });
def(B.BEDROCK, 'bedrock', 'Bedrock', { hardness: -1, drop: null, noItem: true });

// --- soil ------------------------------------------------------------------
def(B.GRASS, 'grass_block', 'Grass Block', {
  tex: { top: 'grass_top', side: 'grass_side', bottom: 'dirt' },
  hardness: 0.6, tool: 'shovel', drop: 'dirt', tint: 'grass',
});
def(B.DIRT, 'dirt', 'Dirt', { hardness: 0.5, tool: 'shovel' });
def(B.PATH, 'dirt_path', 'Dirt Path', {
  tex: { top: 'path_top', side: 'dirt', bottom: 'dirt' },
  hardness: 0.6, tool: 'shovel', drop: 'dirt',
});
def(B.FARMLAND, 'farmland', 'Farmland', {
  tex: { top: 'farmland', side: 'dirt', bottom: 'dirt' },
  hardness: 0.6, tool: 'shovel', drop: 'dirt',
});
def(B.SAND, 'sand', 'Sand', { hardness: 0.5, tool: 'shovel', gravity: true });
def(B.RED_SAND, 'red_sand', 'Red Sand', { hardness: 0.5, tool: 'shovel', gravity: true });
def(B.SANDSTONE, 'sandstone', 'Sandstone', {
  tex: { top: 'sandstone_top', side: 'sandstone', bottom: 'sandstone_top' },
  hardness: 0.8, tool: 'pickaxe', tier: TIER.WOOD,
});
def(B.RED_SANDSTONE, 'red_sandstone', 'Red Sandstone', {
  tex: { top: 'red_sandstone_top', side: 'red_sandstone', bottom: 'red_sandstone_top' },
  hardness: 0.8, tool: 'pickaxe', tier: TIER.WOOD,
});
// Gravel is the flint source that gates Flint and Steel (and therefore the Nether).
def(B.GRAVEL, 'gravel', 'Gravel', {
  hardness: 0.6, tool: 'shovel', gravity: true, drop: 'gravel',
  dropAlt: ['flint', 0.16],
});
def(B.CLAY, 'clay', 'Clay', { hardness: 0.6, tool: 'shovel', drop: 'clay_ball', dropMin: 4, dropMax: 4 });

// --- fluids ----------------------------------------------------------------
def(B.WATER, 'water', 'Water', {
  pass: PASS.WATER, render: 'liquid', solid: false, opaque: false, occludes: false,
  filter: 2, hardness: -1, drop: null, liquid: true, replaceable: true, noItem: true, height: 0.9,
});
def(B.LAVA, 'lava', 'Lava', {
  pass: PASS.LIQUID, render: 'liquid', solid: false, opaque: false, occludes: false,
  filter: 0, emit: 15, hardness: -1, drop: null, liquid: true, replaceable: true, noItem: true,
  hurt: 4, height: 0.9,
});
export const FLUID = new Uint8Array(BLOCK_COUNT); // 1 water, 2 lava
export const FLOW_LEVEL = new Uint8Array(BLOCK_COUNT); // 0 source, 1..7 lateral, 8 waterfall
FLUID[B.WATER]=1; FLUID[B.LAVA]=2;
for (const [kind, base, max, fall, source] of [[1,140,7,147,B.WATER],[2,148,3,151,B.LAVA]]) {
  for(let level=1;level<=max+1;level++) {
    const falling=level>max, id=falling?fall:base+level-1;
    def(id, `${kind===1?'water':'lava'}_${falling?'fall':'flow_'+level}`, kind===1?'Flowing Water':'Flowing Lava', {
      ...BLOCKS[source], id, tex:kind===1?'water':'lava', noItem:true,
      height:falling?1:Math.max(.15,.9-level*.1),
    });
    FLUID[id]=kind; FLOW_LEVEL[id]=falling?8:level;
  }
}
export const isWater = id => FLUID[id]===1;
export const isLava = id => FLUID[id]===2;
export const flowId = (kind, level) => level===0 ? (kind===1?B.WATER:B.LAVA) : level===8 ? (kind===1?B.WATER_FALL:B.LAVA_FALL) : (kind===1?140:148)+level-1;
def(B.FIRE, 'fire', 'Fire', {
  pass: PASS.CUTOUT, render: 'cross', solid: false, opaque: false, occludes: false,
  emit: 15, hardness: 0, drop: null, replaceable: true, noItem: true, hurt: 1.5,
});

// --- wood ------------------------------------------------------------------
const logDef = (id, key, name, side, top) => def(id, key, name, {
  tex: { side, top, bottom: top }, hardness: 2, tool: 'axe', flammable: true, fuel: 300,
});
logDef(B.OAK_LOG, 'oak_log', 'Oak Log', 'oak_log', 'oak_log_top');
logDef(B.BIRCH_LOG, 'birch_log', 'Birch Log', 'birch_log', 'birch_log_top');
logDef(B.SPRUCE_LOG, 'spruce_log', 'Spruce Log', 'spruce_log', 'spruce_log_top');

const plankDef = (id, key, name, tex) => def(id, key, name, {
  tex, hardness: 2, tool: 'axe', flammable: true, fuel: 300,
});
plankDef(B.OAK_PLANKS, 'oak_planks', 'Oak Planks', 'oak_planks');
plankDef(B.BIRCH_PLANKS, 'birch_planks', 'Birch Planks', 'birch_planks');
plankDef(B.SPRUCE_PLANKS, 'spruce_planks', 'Spruce Planks', 'spruce_planks');

// Leaves occasionally drop an apple, which is the early-game food fallback.
const leafDef = (id, key, name, tex, tint, sapling) => def(id, key, name, {
  tex, pass: PASS.CUTOUT, opaque: false, occludes: false, selfCull: true,
  filter: 1, hardness: 0.2, tool: 'shears', drop: sapling, dropMin: 0, dropMax: 1,
  tint, flammable: true, dropAlt: ['apple', 0.05],
});
leafDef(B.OAK_LEAVES, 'oak_leaves', 'Oak Leaves', 'oak_leaves', 'foliage', 'oak_sapling');
leafDef(B.BIRCH_LEAVES, 'birch_leaves', 'Birch Leaves', 'birch_leaves', 'foliage_birch', 'oak_sapling');
leafDef(B.SPRUCE_LEAVES, 'spruce_leaves', 'Spruce Leaves', 'spruce_leaves', 'foliage_spruce', 'oak_sapling');

def(B.BOOKSHELF, 'bookshelf', 'Bookshelf', {
  tex: { side: 'bookshelf', top: 'oak_planks', bottom: 'oak_planks' },
  hardness: 1.5, tool: 'axe', flammable: true, drop: 'book', dropMin: 3, dropMax: 3,
});

// --- ores ------------------------------------------------------------------
const oreDef = (id, key, name, tex, o) => def(id, key, name, {
  tex, hardness: 3, tool: 'pickaxe', ...o,
});
oreDef(B.COAL_ORE, 'coal_ore', 'Coal Ore', 'coal_ore', { tier: TIER.WOOD, drop: 'coal', xp: 1 });
oreDef(B.IRON_ORE, 'iron_ore', 'Iron Ore', 'iron_ore', { tier: TIER.STONE, drop: 'raw_iron' });
oreDef(B.GOLD_ORE, 'gold_ore', 'Gold Ore', 'gold_ore', { tier: TIER.IRON, drop: 'raw_gold' });
oreDef(B.DIAMOND_ORE, 'diamond_ore', 'Diamond Ore', 'diamond_ore', { tier: TIER.IRON, drop: 'diamond', xp: 4 });
oreDef(B.EMERALD_ORE, 'emerald_ore', 'Emerald Ore', 'emerald_ore', { tier: TIER.IRON, drop: 'emerald', xp: 4 });
oreDef(B.REDSTONE_ORE, 'redstone_ore', 'Redstone Ore', 'redstone_ore', {
  tier: TIER.IRON, drop: 'redstone', dropMin: 4, dropMax: 5, xp: 2, emit: 4,
});
oreDef(B.LAPIS_ORE, 'lapis_ore', 'Lapis Lazuli Ore', 'lapis_ore', {
  tier: TIER.STONE, drop: 'lapis_lazuli', dropMin: 4, dropMax: 8, xp: 2,
});
oreDef(B.QUARTZ_ORE, 'nether_quartz_ore', 'Nether Quartz Ore', 'quartz_ore', {
  tier: TIER.WOOD, drop: 'quartz', xp: 2,
});

def(B.COAL_BLOCK, 'coal_block', 'Block of Coal', { hardness: 5, tool: 'pickaxe', tier: TIER.WOOD, fuel: 16000 });
def(B.IRON_BLOCK, 'iron_block', 'Block of Iron', { hardness: 5, tool: 'pickaxe', tier: TIER.STONE });
def(B.GOLD_BLOCK, 'gold_block', 'Block of Gold', { hardness: 3, tool: 'pickaxe', tier: TIER.IRON });
def(B.DIAMOND_BLOCK, 'diamond_block', 'Block of Diamond', { hardness: 5, tool: 'pickaxe', tier: TIER.IRON });
def(B.LAPIS_BLOCK, 'lapis_block', 'Block of Lapis Lazuli', { hardness: 3, tool: 'pickaxe', tier: TIER.STONE });

// --- glass, obsidian, ice, snow -------------------------------------------
def(B.GLASS, 'glass', 'Glass', {
  pass: PASS.CUTOUT, opaque: false, occludes: false, selfCull: true,
  hardness: 0.3, drop: null,
});
def(B.OBSIDIAN, 'obsidian', 'Obsidian', {
  hardness: 50, tool: 'pickaxe', tier: TIER.DIAMOND,
});
def(B.GLOWING_OBSIDIAN, 'glowing_obsidian', 'Crying Obsidian', {
  tex: 'glowing_obsidian', hardness: 50, tool: 'pickaxe', tier: TIER.DIAMOND, emit: 10,
});
def(B.SNOW_BLOCK, 'snow_block', 'Snow Block', { hardness: 0.2, tool: 'shovel', drop: 'snowball', dropMin: 4, dropMax: 4 });
def(B.SNOW_LAYER, 'snow_layer', 'Snow', {
  tex: 'snow_block', render: 'layer', height: 0.125, solid: true, opaque: false, occludes: false,
  hardness: 0.1, tool: 'shovel', drop: 'snowball', replaceable: true,
});
def(B.ICE, 'ice', 'Ice', {
  pass: PASS.CUTOUT, opaque: false, occludes: false, filter: 2, selfCull: true,
  hardness: 0.5, tool: 'pickaxe', drop: null, slip: 1,
});
def(B.SPONGE, 'sponge', 'Sponge', { hardness: 0.6 });
def(B.WOOL, 'wool', 'Wool', { hardness: 0.8, tool: 'shears', flammable: true, fuel: 100 });

// --- functional ------------------------------------------------------------
def(B.CRAFTING_TABLE, 'crafting_table', 'Crafting Table', {
  tex: { top: 'crafting_top', side: 'crafting_side', bottom: 'oak_planks' },
  hardness: 2.5, tool: 'axe', flammable: true, interact: 'crafting', fuel: 300,
});
def(B.FURNACE, 'furnace', 'Furnace', {
  tex: { top: 'furnace_top', bottom: 'furnace_top', side: 'furnace_side', pz: 'furnace_front' },
  hardness: 3.5, tool: 'pickaxe', tier: TIER.WOOD, interact: 'furnace', entity: 'furnace',
});
def(B.FURNACE_LIT, 'furnace_lit', 'Furnace', {
  tex: { top: 'furnace_top', bottom: 'furnace_top', side: 'furnace_side', pz: 'furnace_front_lit' },
  hardness: 3.5, tool: 'pickaxe', tier: TIER.WOOD, emit: 13, interact: 'furnace',
  entity: 'furnace', drop: 'furnace', itemKey: 'furnace', noItem: true,
});
def(B.CHEST, 'chest', 'Chest', {
  tex: { top: 'chest_top', bottom: 'chest_top', side: 'chest_side', pz: 'chest_front' },
  hardness: 2.5, tool: 'axe', flammable: true, interact: 'chest', entity: 'chest', fuel: 300,
  opaque: false, occludes: false, pass: PASS.CUTOUT,
});
def(B.TORCH, 'torch', 'Torch', {
  render: 'torch', pass: PASS.CUTOUT, solid: false, opaque: false, occludes: false,
  emit: 14, hardness: 0, flammable: false,
});
def(B.TORCH_WALL, 'torch_wall', 'Torch', {
  tex: 'torch', render: 'torch', pass: PASS.CUTOUT, solid: false, opaque: false, occludes: false,
  emit: 14, hardness: 0, drop: 'torch', itemKey: 'torch', noItem: true,
});
def(B.LADDER, 'ladder', 'Ladder', {
  render: 'cross', pass: PASS.CUTOUT, solid: false, opaque: false, occludes: false,
  hardness: 0.4, tool: 'axe', climbable: true, flammable: true,
});
def(B.IRON_BARS, 'iron_bars', 'Iron Bars', {
  render: 'cross', pass: PASS.CUTOUT, solid: true, opaque: false, occludes: false,
  hardness: 5, tool: 'pickaxe', tier: TIER.WOOD,
});
def(B.TNT, 'tnt', 'TNT', {
  tex: { top: 'tnt_top', bottom: 'tnt_bottom', side: 'tnt_side' },
  hardness: 0, flammable: true, interact: 'tnt',
});
// A bed is two blocks laid end to end — a foot and a pillowed head — like the
// real thing, not a single cube. Which of the four ids is used encodes both
// which half this is and which way the bed runs.
const bedDef = (id, key, top) => def(id, key, 'Bed', {
  tex: { top, side: 'bed_side', bottom: 'oak_planks' },
  render: 'layer', height: 0.5625, opaque: false, occludes: false, pass: PASS.CUTOUT,
  hardness: 0.2, interact: 'bed', flammable: true,
  drop: 'bed', itemKey: 'bed',
});
bedDef(B.BED, 'bed', 'bed_top');
bedDef(B.BED_HEAD, 'bed_head', 'bed_head_top');
bedDef(B.BED_X, 'bed_x', 'bed_top_x');
bedDef(B.BED_HEAD_X, 'bed_head_x', 'bed_head_top_x');
for (const id of [B.BED_HEAD, B.BED_X, B.BED_HEAD_X]) BLOCKS[id].noItem = true;

/**
 * Every bed id: which half it is, which axis the bed runs along, and the id of
 * its other half. The direction to that half isn't encoded — callers look both
 * ways along the axis — which keeps the id count down to four.
 */
export const BEDS = {
  [B.BED]: { head: false, axis: 'z', other: B.BED_HEAD },
  [B.BED_HEAD]: { head: true, axis: 'z', other: B.BED },
  [B.BED_X]: { head: false, axis: 'x', other: B.BED_HEAD_X },
  [B.BED_HEAD_X]: { head: true, axis: 'x', other: B.BED_X },
};
export const IS_BED = new Uint8Array(BLOCK_COUNT);
for (const id of Object.keys(BEDS)) IS_BED[id] = 1;
def(B.SPAWNER, 'spawner', 'Monster Spawner', {
  pass: PASS.CUTOUT, opaque: false, occludes: false,
  hardness: 5, tool: 'pickaxe', tier: TIER.WOOD, drop: null, xp: 15, entity: 'spawner', noItem: true,
});
// --- doors ------------------------------------------------------------------
// Four ids cover the two doorway orientations and their open states. A closed
// door is solid so you cannot walk through it; an open one is not.
const doorDef = (id, key, name, o) => def(id, key, name, {
  // The upper half of a door uses the top face's tile and the lower half the
  // side's, so both halves come out of the existing per-face tile table.
  tex: { top: 'oak_door_top', side: 'oak_door_bottom', bottom: 'oak_door_bottom' },
  render: 'door', pass: PASS.CUTOUT, opaque: false, occludes: false,
  hardness: 3, tool: 'axe', flammable: true, interact: 'door',
  drop: 'oak_door', itemKey: 'oak_door', ...o,
});
doorDef(B.OAK_DOOR, 'oak_door', 'Oak Door', { solid: true });
doorDef(B.DOOR_Z_OPEN, 'oak_door_z_open', 'Oak Door', { solid: false, noItem: true });
doorDef(B.DOOR_X, 'oak_door_x', 'Oak Door', { solid: true, noItem: true });
doorDef(B.DOOR_X_OPEN, 'oak_door_x_open', 'Oak Door', { solid: false, noItem: true });

/**
 * How each door swings, and which way its panel lies. `panel` is the axis the
 * panel is *thin* along: 0 = thin in Z (fills the north-south gap), 1 = thin
 * in X. Opening a door swaps the panel onto the adjacent wall.
 */
export const DOORS = {
  [B.OAK_DOOR]: { toggle: B.DOOR_Z_OPEN, panel: 0, open: false },
  [B.DOOR_Z_OPEN]: { toggle: B.OAK_DOOR, panel: 1, open: true },
  [B.DOOR_X]: { toggle: B.DOOR_X_OPEN, panel: 1, open: false },
  [B.DOOR_X_OPEN]: { toggle: B.DOOR_X, panel: 0, open: true },
};
export const DOOR_FAMILY = {};
for(const id of [B.OAK_DOOR,B.DOOR_Z_OPEN,B.DOOR_X,B.DOOR_X_OPEN]) DOOR_FAMILY[id]=[B.OAK_DOOR,B.DOOR_X];
for(const [base,key,name] of [[152,'birch','Birch'],[156,'spruce','Spruce']]) {
  for(let i=0;i<4;i++) {
    doorDef(base+i, i===0?`${key}_door`:`${key}_door_state${i}`,`${name} Door`,{
      tex:{top:`${key}_door_top`,side:`${key}_door_bottom`,bottom:`${key}_door_bottom`},
      solid:i%2===0,noItem:i!==0,drop:`${key}_door`,itemKey:`${key}_door`,
    });
    DOORS[base+i]={toggle:base+(i^1),panel:[0,1,1,0][i],open:i%2===1};
    DOOR_FAMILY[base+i]=[base,base+2];
  }
}
export const IS_DOOR = new Uint8Array(BLOCK_COUNT);
export const DOOR_PANEL = new Uint8Array(BLOCK_COUNT);
for (const [id, d] of Object.entries(DOORS)) {
  IS_DOOR[id] = 1;
  DOOR_PANEL[id] = d.panel;
}

// --- plants ----------------------------------------------------------------
const plantDef = (id, key, name, o = {}) => def(id, key, name, {
  render: 'cross', pass: PASS.CUTOUT, solid: false, opaque: false, occludes: false,
  hardness: 0, replaceable: o.replaceable ?? false, flammable: true, ...o,
});
plantDef(B.TALL_GRASS, 'tall_grass', 'Grass', { tint: 'grass', drop: 'wheat_seeds', dropMin: 0, dropMax: 1, replaceable: true });
plantDef(B.DEAD_BUSH, 'dead_bush', 'Dead Bush', { drop: 'stick', dropMin: 0, dropMax: 2, replaceable: true });
plantDef(B.FLOWER_RED, 'poppy', 'Poppy', { tex: 'flower_red' });
plantDef(B.FLOWER_YELLOW, 'dandelion', 'Dandelion', { tex: 'flower_yellow' });
plantDef(B.WHEAT, 'wheat_crop', 'Wheat', {
  tex: 'wheat', drop: 'wheat', noItem: true, itemKey: 'wheat',
});
plantDef(B.SUGAR_CANE, 'sugar_cane', 'Sugar Cane', { tex: 'sugar_cane' });
def(B.CACTUS, 'cactus', 'Cactus', {
  tex: { top: 'cactus_top', side: 'cactus_side', bottom: 'cactus_top' },
  hardness: 0.4, hurt: 1, opaque: false, occludes: false, pass: PASS.CUTOUT,
});
def(B.PUMPKIN, 'pumpkin', 'Pumpkin', {
  tex: { top: 'pumpkin_top', side: 'pumpkin_side', bottom: 'pumpkin_top', pz: 'pumpkin_face' },
  hardness: 1, tool: 'axe',
});
def(B.MELON, 'melon', 'Melon', {
  tex: { top: 'melon_top', side: 'melon_side', bottom: 'melon_top' },
  hardness: 1, tool: 'axe', drop: 'melon_slice', dropMin: 3, dropMax: 7,
});

// --- nether ----------------------------------------------------------------
def(B.NETHERRACK, 'netherrack', 'Netherrack', { hardness: 0.4, tool: 'pickaxe', tier: TIER.WOOD, flammable: true });
def(B.SOUL_SAND, 'soul_sand', 'Soul Sand', { hardness: 0.5, tool: 'shovel', slow: 0.45, height: 0.875 });
def(B.GLOWSTONE, 'glowstone', 'Glowstone', {
  hardness: 0.3, emit: 15, drop: 'glowstone_dust', dropMin: 2, dropMax: 4,
});
def(B.NETHER_BRICKS, 'nether_bricks', 'Nether Bricks', { hardness: 2, tool: 'pickaxe', tier: TIER.WOOD });
def(B.MAGMA, 'magma_block', 'Magma Block', {
  hardness: 0.5, tool: 'pickaxe', tier: TIER.WOOD, emit: 3, hurt: 1,
});
def(B.NETHER_PORTAL, 'nether_portal', 'Nether Portal', {
  pass: PASS.LIQUID, render: 'cube', solid: false, opaque: false, occludes: false,
  emit: 11, hardness: -1, drop: null, noItem: true, replaceable: false,
});

// --- the end ---------------------------------------------------------------
def(B.END_STONE, 'end_stone', 'End Stone', { hardness: 3, tool: 'pickaxe', tier: TIER.WOOD });
def(B.END_PORTAL_FRAME, 'end_portal_frame', 'End Portal Frame', {
  tex: { top: 'end_frame_top', side: 'end_frame_side', bottom: 'end_stone' },
  render: 'layer', height: 0.8125, opaque: false, occludes: false, pass: PASS.CUTOUT,
  // Obtainable in Creative only, exactly like the real thing — it has no
  // recipe and never drops, but you can place one to build your own portal.
  hardness: -1, drop: null, emit: 1, interact: 'end_frame', creativeOnly: true,
});
def(B.END_PORTAL_FRAME_EYE, 'end_portal_frame_eye', 'End Portal Frame', {
  tex: { top: 'end_frame_eye', side: 'end_frame_side', bottom: 'end_stone' },
  render: 'layer', height: 0.8125, opaque: false, occludes: false, pass: PASS.CUTOUT,
  hardness: -1, drop: null, emit: 3, noItem: true, itemKey: 'end_portal_frame',
});
def(B.END_PORTAL, 'end_portal', 'End Portal', {
  pass: PASS.LIQUID, render: 'layer', height: 0.75, solid: false, opaque: false, occludes: false,
  emit: 15, hardness: -1, drop: null, noItem: true,
});
def(B.DRAGON_EGG, 'dragon_egg', 'Dragon Egg', {
  pass: PASS.CUTOUT, opaque: false, occludes: false,
  hardness: 3, emit: 1, tool: 'pickaxe',
});

// ---------------------------------------------------------------------------
// Slabs — half-height blocks reusing their parent's texture, so they cost no
// atlas space. The mesher's `layer` kind already handles arbitrary heights.
// ---------------------------------------------------------------------------
const slabDef = (id, key, name, tex, o = {}) => def(id, key, name, {
  tex, render: 'layer', height: 0.5, opaque: false, occludes: false, pass: PASS.CUTOUT,
  hardness: o.hardness ?? 2, tool: o.tool ?? 'pickaxe', tier: o.tier ?? TIER.WOOD,
  flammable: o.flammable ?? false, fuel: o.fuel ?? 0,
});
slabDef(B.SLAB_STONE, 'stone_slab', 'Stone Slab', 'smooth_stone', { hardness: 2 });
slabDef(B.SLAB_COBBLE, 'cobblestone_slab', 'Cobblestone Slab', 'cobblestone');
slabDef(B.SLAB_SANDSTONE, 'sandstone_slab', 'Sandstone Slab', 'sandstone', { hardness: 0.8 });
slabDef(B.SLAB_BRICKS, 'brick_slab', 'Brick Slab', 'bricks');
slabDef(B.SLAB_STONE_BRICKS, 'stone_brick_slab', 'Stone Brick Slab', 'stone_bricks', { hardness: 1.5 });
slabDef(B.SLAB_QUARTZ, 'quartz_slab', 'Quartz Slab', 'quartz_block', { hardness: 0.8 });
slabDef(B.SLAB_OAK, 'oak_slab', 'Oak Slab', 'oak_planks',
  { tool: 'axe', tier: TIER.HAND, flammable: true, fuel: 150 });
slabDef(B.SLAB_BIRCH, 'birch_slab', 'Birch Slab', 'birch_planks',
  { tool: 'axe', tier: TIER.HAND, flammable: true, fuel: 150 });
slabDef(B.SLAB_SPRUCE, 'spruce_slab', 'Spruce Slab', 'spruce_planks',
  { tool: 'axe', tier: TIER.HAND, flammable: true, fuel: 150 });

// ---------------------------------------------------------------------------
// Decorative stone
// ---------------------------------------------------------------------------
const stoneDef = (id, key, name, o = {}) => def(id, key, name, {
  hardness: o.hardness ?? 1.5, tool: 'pickaxe', tier: TIER.WOOD, ...o,
});
stoneDef(B.QUARTZ_BLOCK, 'quartz_block', 'Block of Quartz', {
  tex: { top: 'quartz_block_top', side: 'quartz_block', bottom: 'quartz_block_top' }, hardness: 0.8,
});
stoneDef(B.CHISELED_QUARTZ, 'chiseled_quartz_block', 'Chiseled Quartz Block', {
  tex: { top: 'quartz_block_top', side: 'chiseled_quartz', bottom: 'quartz_block_top' }, hardness: 0.8,
});
stoneDef(B.SMOOTH_STONE, 'smooth_stone', 'Smooth Stone', { hardness: 2 });
stoneDef(B.POLISHED_GRANITE, 'polished_granite', 'Polished Granite');
stoneDef(B.POLISHED_ANDESITE, 'polished_andesite', 'Polished Andesite');
stoneDef(B.POLISHED_DIORITE, 'polished_diorite', 'Polished Diorite');
stoneDef(B.CHISELED_STONE_BRICKS, 'chiseled_stone_bricks', 'Chiseled Stone Bricks');
stoneDef(B.CHISELED_SANDSTONE, 'chiseled_sandstone', 'Chiseled Sandstone', {
  tex: { top: 'sandstone_top', side: 'chiseled_sandstone', bottom: 'sandstone_top' }, hardness: 0.8,
});
stoneDef(B.SMOOTH_SANDSTONE, 'smooth_sandstone', 'Smooth Sandstone', { hardness: 0.8 });
stoneDef(B.END_STONE_BRICKS, 'end_stone_bricks', 'End Stone Bricks', { hardness: 3 });
stoneDef(B.TERRACOTTA, 'terracotta', 'Terracotta', { hardness: 1.25 });
def(B.PACKED_ICE, 'packed_ice', 'Packed Ice', { hardness: 0.5, tool: 'pickaxe', slip: 1, drop: null });

// ---------------------------------------------------------------------------
// Storage and utility blocks
// ---------------------------------------------------------------------------
def(B.EMERALD_BLOCK, 'emerald_block', 'Block of Emerald', { hardness: 5, tool: 'pickaxe', tier: TIER.IRON });
def(B.REDSTONE_BLOCK, 'redstone_block', 'Block of Redstone', { hardness: 5, tool: 'pickaxe', tier: TIER.WOOD, emit: 3 });
def(B.HAY_BLOCK, 'hay_block', 'Hay Bale', {
  tex: { top: 'hay_block_top', side: 'hay_block', bottom: 'hay_block_top' },
  hardness: 0.5, flammable: true, fallDamageMult: 0.2,
});
def(B.HONEYCOMB_BLOCK, 'honeycomb_block', 'Honeycomb Block', { hardness: 0.6 });
def(B.BEE_NEST, 'bee_nest', 'Bee Nest', {
  tex: { top: 'bee_nest_top', side: 'bee_nest', bottom: 'bee_nest_top', pz: 'bee_nest_front' },
  hardness: 0.3, tool: 'axe', flammable: true, drop: 'honeycomb', dropMin: 2, dropMax: 3,
});
def(B.JACK_O_LANTERN, 'jack_o_lantern', 'Jack o\'Lantern', {
  tex: { top: 'pumpkin_top', side: 'pumpkin_side', bottom: 'pumpkin_top', pz: 'jack_o_lantern' },
  hardness: 1, tool: 'axe', emit: 15,
});

// ---------------------------------------------------------------------------
// Coloured wool
// ---------------------------------------------------------------------------
const woolDef = (id, key, name, tex) => def(id, key, name, {
  tex, hardness: 0.8, tool: 'shears', flammable: true, fuel: 100,
});
woolDef(B.WOOL_RED, 'red_wool', 'Red Wool', 'wool_red');
woolDef(B.WOOL_ORANGE, 'orange_wool', 'Orange Wool', 'wool_orange');
woolDef(B.WOOL_YELLOW, 'yellow_wool', 'Yellow Wool', 'wool_yellow');
woolDef(B.WOOL_GREEN, 'green_wool', 'Green Wool', 'wool_green');
woolDef(B.WOOL_BLUE, 'blue_wool', 'Blue Wool', 'wool_blue');
woolDef(B.WOOL_PURPLE, 'purple_wool', 'Purple Wool', 'wool_purple');
woolDef(B.WOOL_BLACK, 'black_wool', 'Black Wool', 'wool_black');

// ---------------------------------------------------------------------------
// Underwater flora
// ---------------------------------------------------------------------------
plantDef(B.SEAGRASS, 'seagrass', 'Seagrass', { tint: 'foliage', drop: null });
plantDef(B.KELP, 'kelp', 'Kelp', { tint: 'foliage' });

// ChugCraft workshop stations. IDs are appended for old-world compatibility.
def(B.ENCHANTING_TABLE, 'enchanting_table', 'Enchanting Table', {
  tex: {top:'enchant_top',side:'enchant_side',bottom:'obsidian'},
  hardness:5,tool:'pickaxe',tier:TIER.WOOD,interact:'enchant',emit:5,
});
def(B.ANVIL, 'anvil', 'Anvil', {tex:{top:'anvil_top',side:'anvil_side'},
  hardness:5,tool:'pickaxe',tier:TIER.WOOD,interact:'anvil'});
def(B.BREWING_STAND, 'brewing_stand', 'Brewing Stand', {
  tex:{top:'brew_top',side:'brew_side',bottom:'cobblestone'},
  hardness:1,tool:'pickaxe',tier:TIER.WOOD,interact:'brew',emit:2,
});
plantDef(B.NETHER_WART, 'nether_wart', 'Nether Wart', {dropMin:2,dropMax:3});
// Young crops drop seeds only; wheat_seeds / nether_wart items plant stage 0.
plantDef(B.WHEAT_0, 'wheat_stage0', 'Wheat Seedling', { tex: 'wheat_0', drop: 'wheat_seeds', noItem: true, itemKey: 'wheat_seeds' });
plantDef(B.WHEAT_1, 'wheat_stage1', 'Young Wheat', { tex: 'wheat_1', drop: 'wheat_seeds', noItem: true, itemKey: 'wheat_seeds' });
plantDef(B.WHEAT_2, 'wheat_stage2', 'Growing Wheat', { tex: 'wheat_2', drop: 'wheat_seeds', noItem: true, itemKey: 'wheat_seeds' });
plantDef(B.WART_0, 'nether_wart_stage0', 'Nether Wart Sprout', { tex: 'nether_wart_0', drop: 'nether_wart', noItem: true, itemKey: 'nether_wart' });
plantDef(B.WART_1, 'nether_wart_stage1', 'Young Nether Wart', { tex: 'nether_wart_1', drop: 'nether_wart', noItem: true, itemKey: 'nether_wart' });
plantDef(B.OAK_SAPLING, 'oak_sapling_block', 'Oak Sapling', { tex: 'oak_sapling', drop: 'oak_sapling', noItem: true, itemKey: 'oak_sapling' });
// 3.2 building palette: mesh shapes are shared with collision code.
export const HINGES = {};
for(const [base,key,name] of [[165,'oak_gate','Oak Fence Gate'],[169,'oak_trapdoor','Oak Trapdoor']]) {
 for(let i=0;i<4;i++) {
  def(base+i,i===0?key:`${key}_state${i}`,name,{
   tex:key==='oak_gate'?'oak_planks':'oak_trapdoor',render:'shape',opaque:false,occludes:false,
   solid:i%2===0,hardness:2,tool:'axe',flammable:true,drop:key,itemKey:key,noItem:i!==0,interact:'hinge',
  });
  HINGES[base+i]={base,toggle:base+(i^1),open:i%2===1,axis:i>=2?1:0};
 }
}
for(const [id,key,name,tex] of [[160,'glass_pane','Glass Window Pane','glass'],[161,'blue_glass_pane','Ocean Blue Window','blue_glass'],[162,'amber_glass_pane','Amber Window','amber_glass'],[163,'rose_glass_pane','Rose Window','rose_glass']])
 def(id,key,name,{tex,render:'shape',pass:PASS.LIQUID,opaque:false,occludes:false,hardness:.3,drop:key});
def(B.OAK_FENCE,'oak_fence','Oak Fence',{tex:'oak_planks',render:'shape',opaque:false,occludes:false,hardness:2,tool:'axe',flammable:true});
def(B.LANTERN,'lantern','Lantern',{tex:'lantern',render:'shape',opaque:false,occludes:false,emit:15,hardness:1.5,tool:'pickaxe'});
def(B.MOSAIC,'mosaic','Sunburst Mosaic',{tex:'mosaic',hardness:1.5,tool:'pickaxe',tier:TIER.WOOD});
def(B.BASALT_TILES,'basalt_tiles','Midnight Basalt Tiles',{tex:'basalt_tiles',hardness:2,tool:'pickaxe',tier:TIER.WOOD});
for(const [id,key,name] of [[176,'blue_glass','Ocean Blue Glass'],[177,'amber_glass','Amber Glass'],[178,'rose_glass','Rose Glass']])
 def(id,key,name,{tex:key,pass:PASS.LIQUID,opaque:false,occludes:false,hardness:.3,drop:key});
// Fill any unused ids with air so lookups never return undefined.
for (let i = 0; i < BLOCK_COUNT; i++) if (!BLOCKS[i]) BLOCKS[i] = BLOCKS[0];

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

export const BY_KEY = new Map();
for (const b of BLOCKS) if (b && b.id !== 0) BY_KEY.set(b.key, b);
BY_KEY.set('air', BLOCKS[0]);

export const blockByKey = (key) => BY_KEY.get(key) || null;
export const getBlock = (id) => BLOCKS[id] || BLOCKS[0];

/** Sets of ids the worker/mesher hot-loops read as flat typed arrays. */
export const IS_OPAQUE = new Uint8Array(BLOCK_COUNT);
export const IS_OCCLUDER = new Uint8Array(BLOCK_COUNT);
export const IS_SOLID = new Uint8Array(BLOCK_COUNT);
export const LIGHT_EMIT = new Uint8Array(BLOCK_COUNT);
export const LIGHT_FILTER = new Uint8Array(BLOCK_COUNT);
export const IS_LIQUID = new Uint8Array(BLOCK_COUNT);
export const RENDER_KIND = new Uint8Array(BLOCK_COUNT);   // 0 none,1 cube,2 cross,3 liquid,4 torch,5 layer
export const PASS_OF = new Uint8Array(BLOCK_COUNT);
export const HEIGHT_OF = new Float32Array(BLOCK_COUNT);
export const REPLACEABLE = new Uint8Array(BLOCK_COUNT);

const RENDER_IDS = { none: 0, cube: 1, cross: 2, liquid: 3, torch: 4, layer: 5, door: 6, shape: 7 };
for (let i = 0; i < BLOCK_COUNT; i++) {
  const b = BLOCKS[i];
  IS_OPAQUE[i] = b.opaque ? 1 : 0;
  IS_OCCLUDER[i] = b.occludes ? 1 : 0;
  IS_SOLID[i] = b.solid ? 1 : 0;
  LIGHT_EMIT[i] = b.emit;
  LIGHT_FILTER[i] = b.filter;
  IS_LIQUID[i] = b.liquid ? 1 : 0;
  RENDER_KIND[i] = RENDER_IDS[b.render] ?? 1;
  PASS_OF[i] = b.pass;
  HEIGHT_OF[i] = b.height;
  REPLACEABLE[i] = b.replaceable ? 1 : 0;
}
// AIR must never be treated as an occluder even though its render kind is none.
IS_OCCLUDER[0] = 0; IS_OPAQUE[0] = 0; IS_SOLID[0] = 0;

/** Every distinct tile name referenced by the registry, for atlas packing. */
export function allTileNames() {
  const set = new Set();
  for (let i = 1; i < BLOCK_COUNT; i++) {
    const b = BLOCKS[i];
    if (b.id !== i) continue;
    for (const t of b.tex) set.add(t);
  }
  return [...set];
}
