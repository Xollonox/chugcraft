// ============================================================================
// ChugCraft — global constants shared by the main thread and the chunk worker.
// This module must stay dependency-free so the worker can import it cheaply.
// ============================================================================

export const CHUNK_X = 16;
export const CHUNK_Z = 16;
export const CHUNK_Y = 128;              // world height (0 .. 127)
export const CHUNK_AREA = CHUNK_X * CHUNK_Z;
export const CHUNK_VOL = CHUNK_X * CHUNK_Z * CHUNK_Y;
export const SEA_LEVEL = 62;

// Index helpers. Layout is x + z*16 + y*256 so a horizontal slice is contiguous,
// which is what both the mesher and the lighting flood-fill walk most often.
export const idx = (x, y, z) => x + z * CHUNK_X + y * CHUNK_AREA;

export const DIM = { OVERWORLD: 0, NETHER: 1, END: 2 };
export const DIM_NAMES = ['overworld', 'nether', 'the_end'];
export const NETHER_SCALE = 8;           // overworld:nether coordinate ratio

export const GAMEMODE = { SURVIVAL: 0, CREATIVE: 1 };
export const DIFFICULTY = { PEACEFUL: 0, EASY: 1, NORMAL: 2, HARD: 3 };
export const DIFFICULTY_NAMES = ['Peaceful', 'Easy', 'Normal', 'Hard'];
export const DIFFICULTY_MULT = [0, 0.6, 1.0, 1.5];

// Tool material tiers. Blocks declare the minimum tier that yields a drop.
export const TIER = { HAND: 0, WOOD: 1, STONE: 2, IRON: 3, DIAMOND: 4 };

// Render passes emitted by the mesher; each becomes one BufferGeometry.
// WATER is split from LIQUID so it can carry reflections and swell without
// lava and portal blocks paying for it.
export const PASS = { OPAQUE: 0, CUTOUT: 1, LIQUID: 2, WATER: 3 };
export const PASS_COUNT = 4;

// Per-vertex vertex-animation classes, packed into the high bits of aAnim.
export const WAVE = { NONE: 0, LEAF: 1, PLANT: 2, WATER: 3 };

// Face order used everywhere (mesher, AO tables, block texture maps).
export const FACE = { PX: 0, NX: 1, PY: 2, NY: 3, PZ: 4, NZ: 5 };
export const FACE_NORMALS = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
];

export const DAY_LENGTH_DEFAULT = 20 * 60;    // seconds for a full day/night cycle
export const TICKS_PER_SECOND = 20;

export const MAX_LIGHT = 15;

export const PLAYER = {
  WIDTH: 0.6,
  HEIGHT: 1.8,
  EYE: 1.62,
  EYE_SNEAK: 1.42,
  WALK: 4.317,
  SPRINT: 5.612,
  SNEAK: 1.3,
  SWIM: 2.2,
  JUMP_VELOCITY: 8.4,       // tuned with GRAVITY for a ~1.25 block jump
  GRAVITY: 28.0,
  TERMINAL: 60,
  REACH: 4.8,
  STEP_HEIGHT: 0.6,
};

export const GRAVITY_ENTITY = 24;

// Progression milestones recorded on the save so the UI can celebrate them.
/**
 * The advancement tree: `key -> { parent, icon }`. Parents drive the branch
 * layout on the advancements screen; `icon` is the item drawn on the tile.
 * The shape deliberately mirrors the real route to the dragon, so the screen
 * doubles as a map of what to do next.
 */
export const ADVANCEMENT_TREE = {
  wood: { parent: null, icon: 'oak_log' },
  bench: { parent: 'wood', icon: 'crafting_table' },
  stone_age: { parent: 'bench', icon: 'stone_pickaxe' },
  iron: { parent: 'stone_age', icon: 'iron_ingot' },
  on_a_rail: { parent: 'iron', icon: 'minecart' },
  diamonds: { parent: 'iron', icon: 'diamond' },
  obsidian: { parent: 'diamonds', icon: 'obsidian' },
  nether: { parent: 'obsidian', icon: 'flint_and_steel' },
  blaze: { parent: 'nether', icon: 'blaze_rod' },
  pearl: { parent: 'nether', icon: 'ender_pearl' },
  eye: { parent: 'blaze', icon: 'ender_eye' },
  stronghold: { parent: 'eye', icon: 'end_portal_frame' },
  end: { parent: 'stronghold', icon: 'end_stone' },
  dragon: { parent: 'end', icon: 'dragon_egg' },
};

export const ADVANCEMENTS = [
  ['wood', 'Getting Wood', 'Punch a tree'],
  ['bench', 'Benchmarking', 'Craft a crafting table'],
  ['stone_age', 'Stone Age', 'Craft a stone tool'],
  ['iron', 'Acquire Hardware', 'Smelt an iron ingot'],
  ['diamonds', 'DIAMONDS!', 'Mine a diamond'],
  ['obsidian', 'Ice Bucket Challenge', 'Obtain obsidian'],
  ['nether', 'We Need to Go Deeper', 'Enter the Nether'],
  ['blaze', 'Into Fire', 'Obtain a blaze rod'],
  ['pearl', 'The Next Generation', 'Obtain an ender pearl'],
  ['eye', 'Eye Spy', 'Craft an eye of ender'],
  ['stronghold', 'Eye of the Storm', 'Find a stronghold'],
  ['end', 'The End?', 'Enter the End'],
  ['dragon', 'Free the End', 'Defeat the Ender Dragon'],
  ['husbandry', 'The Parrots and the Bats', 'Breed two animals together'],
  ['best_friends', 'Best Friends Forever', 'Tame a wolf'],
  ['fishy_business', 'Fishy Business', 'Catch a fish'],
  ['seedy_place', 'A Seedy Place', 'Plant a seed and watch it grow'],
  ['on_a_rail', 'On a Rail', 'Ride a minecart'],
];
