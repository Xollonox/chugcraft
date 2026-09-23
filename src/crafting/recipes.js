// ============================================================================
// Crafting. Shaped recipes match a trimmed pattern anywhere in the grid;
// shapeless recipes match as a multiset. Tags ("#planks") let one recipe accept
// any wood type, exactly like the real thing.
//
// Every recipe on the critical path to the Ender Dragon is here, and the recipe
// book UI is generated from this same list so nothing can silently go missing.
// ============================================================================

import { ITEMS, getItem } from './items.js';

export const TAGS = {
  planks: ['oak_planks', 'birch_planks', 'spruce_planks'],
  logs: ['oak_log', 'birch_log', 'spruce_log'],
  coals: ['coal', 'charcoal'],
  wool: ['wool'],
  stone: ['cobblestone', 'stone'],
};

export const RECIPES = [];

let nextId = 0;
function shaped(out, count, pattern, keys, opts = {}) {
  const r = {
    id: nextId++, type: 'shaped', pattern, keys,
    out: { key: out, count },
    size: Math.max(pattern.length, ...pattern.map((p) => p.length)),
    category: opts.category || 'misc',
    // Mirrored variants are craftable but hidden from the book, so the list
    // isn't padded with a second entry for every axe and hoe.
    alt: !!opts.alt,
  };
  RECIPES.push(r);
  return r;
}
function shapeless(out, count, ingredients, opts = {}) {
  const r = {
    id: nextId++, type: 'shapeless', ingredients,
    out: { key: out, count },
    size: ingredients.length > 4 ? 3 : 2,
    category: opts.category || 'misc',
  };
  RECIPES.push(r);
  return r;
}

// ---------------------------------------------------------------------------
// Wood & basics
// ---------------------------------------------------------------------------
shapeless('oak_planks', 4, ['oak_log'], { category: 'building' });
shapeless('birch_planks', 4, ['birch_log'], { category: 'building' });
shapeless('spruce_planks', 4, ['spruce_log'], { category: 'building' });
shaped('stick', 4, ['#', '#'], { '#': '#planks' }, { category: 'misc' });
shaped('crafting_table', 1, ['##', '##'], { '#': '#planks' }, { category: 'building' });
shaped('furnace', 1, ['###', '# #', '###'], { '#': 'cobblestone' }, { category: 'building' });
shaped('chest', 1, ['###', '# #', '###'], { '#': '#planks' }, { category: 'building' });
shaped('torch', 4, ['C', 'S'], { C: '#coals', S: 'stick' }, { category: 'misc' });
shaped('ladder', 3, ['S S', 'SSS', 'S S'], { S: 'stick' }, { category: 'building' });
for(const wood of ['oak','birch','spruce'])shaped(`${wood}_door`,3,['##','##','##'],{'#':`${wood}_planks`},{category:'building'});
shaped('glass_pane',16,['###','###'],{'#':'glass'},{category:'building'});
// --- 3.3: rails & minecarts ---
shaped('rail',16,['III','ISI','III'],{I:'iron_ingot',S:'stick'},{category:'misc'});
shaped('powered_rail',6,['GGG','GSG','GRG'],{G:'gold_ingot',S:'stick',R:'redstone'},{category:'misc'});
shaped('minecart',1,['I I','III'],{I:'iron_ingot'},{category:'misc'});
for(const [colour,dye] of [['blue','blue_dye'],['amber','yellow_dye'],['rose','red_dye']]){
 shaped(`${colour}_glass`,8,['GGG','GDG','GGG'],{G:'glass',D:dye},{category:'building'});
 shaped(`${colour}_glass_pane`,16,['###','###'],{'#':`${colour}_glass`},{category:'building'});
}
shaped('oak_fence',3,['PSP','PSP'],{P:'oak_planks',S:'stick'},{category:'building'});
shaped('oak_gate',1,['SPS','SPS'],{P:'oak_planks',S:'stick'},{category:'building'});
shaped('oak_trapdoor',2,['PPP','PPP'],{P:'oak_planks'},{category:'building'});
shaped('lantern',1,[' I ','ITI',' I '],{I:'iron_ingot',T:'torch'},{category:'building'});
shaped('mosaic',4,['ST','TS'],{S:'sandstone',T:'terracotta'},{category:'building'});
shaped('basalt_tiles',4,['CN','NC'],{C:'cobblestone',N:'netherrack'},{category:'building'});
shaped('bookshelf', 1, ['###', 'BBB', '###'], { '#': '#planks', B: 'book' }, { category: 'building' });
shapeless('book', 1, ['paper', 'paper', 'paper', 'leather'], { category: 'misc' });
shaped('paper', 3, ['SSS'], { S: 'sugar_cane' }, { category: 'misc' });
shaped('bed', 1, ['WWW', 'PPP'], { W: 'wool', P: '#planks' }, { category: 'building' });
shaped('wool', 1, ['SS', 'SS'], { S: 'string' }, { category: 'building' });
shaped('tnt', 1, ['GSG', 'SGS', 'GSG'], { G: 'gunpowder', S: 'sand' }, { category: 'misc' });
shaped('stone_bricks', 4, ['##', '##'], { '#': 'stone' }, { category: 'building' });
shaped('sandstone', 1, ['##', '##'], { '#': 'sand' }, { category: 'building' });
shaped('red_sandstone', 1, ['##', '##'], { '#': 'red_sand' }, { category: 'building' });
shaped('bricks', 1, ['##', '##'], { '#': 'brick' }, { category: 'building' });
shaped('glowstone', 1, ['##', '##'], { '#': 'glowstone_dust' }, { category: 'building' });
shaped('snow_block', 1, ['##', '##'], { '#': 'snowball' }, { category: 'building' });
shaped('iron_bars', 16, ['III', 'III'], { I: 'iron_ingot' }, { category: 'building' });
// Minecraft's shield: six planks around a single iron ingot, tapering to a
// point at the bottom.
shaped('shield', 1, ['WIW', 'WWW', ' W '], { W: '#planks', I: 'iron_ingot' }, { category: 'combat' });

// ---------------------------------------------------------------------------
// Tools & weapons — the full wood -> stone -> iron -> diamond tech tree
// ---------------------------------------------------------------------------
const TOOL_MATS = {
  wooden: '#planks', stone: 'cobblestone', iron: 'iron_ingot', diamond: 'diamond',
};
for (const [mat, ing] of Object.entries(TOOL_MATS)) {
  shaped(`${mat}_pickaxe`, 1, ['MMM', ' S ', ' S '], { M: ing, S: 'stick' }, { category: 'tools' });
  shaped(`${mat}_shovel`, 1, ['M', 'S', 'S'], { M: ing, S: 'stick' }, { category: 'tools' });
  shaped(`${mat}_sword`, 1, ['M', 'M', 'S'], { M: ing, S: 'stick' }, { category: 'combat' });
  // Axes and hoes are the two asymmetric tools, and Minecraft accepts either
  // handedness. Only the left-handed layout existed here, so laying one out
  // the other way round simply refused to craft. The book shows the first.
  shaped(`${mat}_axe`, 1, ['MM', 'MS', ' S'], { M: ing, S: 'stick' }, { category: 'tools' });
  shaped(`${mat}_axe`, 1, ['MM', 'SM', 'S '], { M: ing, S: 'stick' }, { category: 'tools', alt: true });
  shaped(`${mat}_hoe`, 1, ['MM', ' S', ' S'], { M: ing, S: 'stick' }, { category: 'tools' });
  shaped(`${mat}_hoe`, 1, ['MM', 'S ', 'S '], { M: ing, S: 'stick' }, { category: 'tools', alt: true });
}

// ---------------------------------------------------------------------------
// Armour
// ---------------------------------------------------------------------------
const ARMOR_MATS = { leather: 'leather', iron: 'iron_ingot', diamond: 'diamond' };
for (const [mat, ing] of Object.entries(ARMOR_MATS)) {
  shaped(`${mat}_helmet`, 1, ['MMM', 'M M'], { M: ing }, { category: 'combat' });
  shaped(`${mat}_chestplate`, 1, ['M M', 'MMM', 'MMM'], { M: ing }, { category: 'combat' });
  shaped(`${mat}_leggings`, 1, ['MMM', 'M M', 'M M'], { M: ing }, { category: 'combat' });
  shaped(`${mat}_boots`, 1, ['M M', 'M M'], { M: ing }, { category: 'combat' });
}

// ---------------------------------------------------------------------------
// Utility items
// ---------------------------------------------------------------------------
shapeless('flint_and_steel', 1, ['iron_ingot', 'flint'], { category: 'tools' });
shaped('bucket', 1, ['M M', ' M '], { M: 'iron_ingot' }, { category: 'tools' });
shaped('shears', 1, [' M', 'M '], { M: 'iron_ingot' }, { category: 'tools' });
shaped('bow', 1, [' SB', 'S B', ' SB'], { S: 'stick', B: 'string' }, { category: 'combat' });
shaped('arrow', 4, ['F', 'S', 'T'], { F: 'flint', S: 'stick', T: 'feather' }, { category: 'combat' });

// ---------------------------------------------------------------------------
// The win path
// ---------------------------------------------------------------------------
shapeless('blaze_powder', 2, ['blaze_rod'], { category: 'brewing' });
shapeless('ender_eye', 1, ['blaze_powder', 'ender_pearl'], { category: 'brewing' });

// ---------------------------------------------------------------------------
// Food
// ---------------------------------------------------------------------------
shaped('bread', 1, ['WWW'], { W: 'wheat' }, { category: 'food' });
shaped('golden_apple', 1, ['GGG', 'GAG', 'GGG'], { G: 'gold_ingot', A: 'apple' }, { category: 'food' });

// ---------------------------------------------------------------------------
// Storage blocks
// ---------------------------------------------------------------------------
const BLOCKIFY = [
  ['coal', 'coal_block'], ['iron_ingot', 'iron_block'], ['gold_ingot', 'gold_block'],
  ['diamond', 'diamond_block'], ['lapis_lazuli', 'lapis_block'],
];
for (const [item, block] of BLOCKIFY) {
  shaped(block, 1, ['###', '###', '###'], { '#': item }, { category: 'building' });
  shapeless(item, 9, [block], { category: 'building' });
}
shapeless('gold_ingot', 1, ['gold_nugget', 'gold_nugget', 'gold_nugget', 'gold_nugget', 'gold_nugget',
  'gold_nugget', 'gold_nugget', 'gold_nugget', 'gold_nugget'], { category: 'misc' });

// ---------------------------------------------------------------------------
// Slabs — three across gives six, as in the real thing
// ---------------------------------------------------------------------------
const SLABS = [
  ['stone_slab', 'smooth_stone'], ['cobblestone_slab', 'cobblestone'],
  ['sandstone_slab', 'sandstone'], ['brick_slab', 'bricks'],
  ['stone_brick_slab', 'stone_bricks'], ['quartz_slab', 'quartz_block'],
  ['oak_slab', 'oak_planks'], ['birch_slab', 'birch_planks'], ['spruce_slab', 'spruce_planks'],
];
for (const [slab, from] of SLABS) {
  shaped(slab, 6, ['###'], { '#': from }, { category: 'building' });
}

// ---------------------------------------------------------------------------
// Decorative stone
// ---------------------------------------------------------------------------
shaped('quartz_block', 1, ['##', '##'], { '#': 'quartz' }, { category: 'building' });
shaped('chiseled_quartz_block', 1, ['#', '#'], { '#': 'quartz_slab' }, { category: 'building' });
shaped('polished_granite', 4, ['##', '##'], { '#': 'granite' }, { category: 'building' });
shaped('polished_andesite', 4, ['##', '##'], { '#': 'andesite' }, { category: 'building' });
shaped('polished_diorite', 4, ['##', '##'], { '#': 'diorite' }, { category: 'building' });
shaped('chiseled_stone_bricks', 1, ['#', '#'], { '#': 'stone_brick_slab' }, { category: 'building' });
shaped('chiseled_sandstone', 1, ['#', '#'], { '#': 'sandstone_slab' }, { category: 'building' });
shaped('end_stone_bricks', 4, ['##', '##'], { '#': 'end_stone' }, { category: 'building' });
shaped('packed_ice', 1, ['###', '###', '###'], { '#': 'ice' }, { category: 'building' });
shaped('jack_o_lantern', 1, ['P', 'T'], { P: 'pumpkin', T: 'torch' }, { category: 'building' });

// ---------------------------------------------------------------------------
// More storage blocks
// ---------------------------------------------------------------------------
for (const [it, block] of [['emerald', 'emerald_block'], ['redstone', 'redstone_block'],
  ['wheat', 'hay_block'], ['honeycomb', 'honeycomb_block']]) {
  shaped(block, 1, ['###', '###', '###'], { '#': it }, { category: 'building' });
  shapeless(it, 9, [block], { category: 'building' });
}

// ---------------------------------------------------------------------------
// Dyes and coloured wool
// ---------------------------------------------------------------------------
shapeless('red_dye', 1, ['poppy'], { category: 'materials' });
shapeless('yellow_dye', 1, ['dandelion'], { category: 'materials' });
shapeless('blue_dye', 1, ['lapis_lazuli'], { category: 'materials' });
shapeless('green_dye', 1, ['cactus'], { category: 'materials' });
shapeless('black_dye', 1, ['ink_sac'], { category: 'materials' });
shapeless('bone_meal', 3, ['bone'], { category: 'materials' });
shapeless('white_dye', 1, ['bone_meal'], { category: 'materials' });
shapeless('orange_dye', 2, ['red_dye', 'yellow_dye'], { category: 'materials' });
shapeless('purple_dye', 2, ['red_dye', 'blue_dye'], { category: 'materials' });

for (const [dye, wool] of [['red_dye', 'red_wool'], ['orange_dye', 'orange_wool'],
  ['yellow_dye', 'yellow_wool'], ['green_dye', 'green_wool'], ['blue_dye', 'blue_wool'],
  ['purple_dye', 'purple_wool'], ['black_dye', 'black_wool']]) {
  shapeless(wool, 1, ['wool', dye], { category: 'building' });
}

// ---------------------------------------------------------------------------
// More food and tools
// ---------------------------------------------------------------------------
shapeless('sugar', 1, ['sugar_cane'], { category: 'food' });
shaped('cookie', 8, ['WSW'], { W: 'wheat', S: 'sugar' }, { category: 'food' });
shaped('pumpkin_pie', 1, ['PSE'], { P: 'pumpkin', S: 'sugar', E: 'egg' }, { category: 'food' });
shaped('fishing_rod', 1, ['  S', ' SB', 'S B'], { S: 'stick', B: 'string' }, { category: 'tools' });

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

shaped('enchanting_table',1,[' B ','DOD','OOO'],{B:'book',D:'diamond',O:'obsidian'});
shaped('anvil',1,['BBB',' I ','III'],{B:'iron_block',I:'iron_ingot'});
shaped('brewing_stand',1,[' B ','CCC'],{B:'blaze_rod',C:'cobblestone'});
shaped('glass_bottle',3,['G G',' G '],{G:'glass'});
shapeless('magma_cream',1,['slimeball','blaze_powder']);
shaped('glistering_melon',1,['GGG','GMG','GGG'],{G:'gold_nugget',M:'melon_slice'});
shapeless('gold_nugget',9,['gold_ingot']);

export function ingredientMatches(spec, stack) {
  if (!spec || spec === ' ') return !stack;
  if (!stack) return false;
  if (spec[0] === '#') {
    const tag = TAGS[spec.slice(1)];
    return !!tag && tag.includes(stack.key);
  }
  return stack.key === spec;
}

function trimPattern(pattern) {
  const rows = pattern.map((r) => r.split(''));
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  for (const r of rows) while (r.length < w) r.push(' ');
  let top = 0, bottom = h - 1, left = 0, right = w - 1;
  const rowEmpty = (y) => rows[y].every((c) => c === ' ');
  const colEmpty = (x) => rows.every((r) => r[x] === ' ');
  while (top <= bottom && rowEmpty(top)) top++;
  while (bottom >= top && rowEmpty(bottom)) bottom--;
  while (left <= right && colEmpty(left)) left++;
  while (right >= left && colEmpty(right)) right--;
  const out = [];
  for (let y = top; y <= bottom; y++) out.push(rows[y].slice(left, right + 1));
  return out;
}
for (const r of RECIPES) if (r.type === 'shaped') r.trimmed = trimPattern(r.pattern);

/** Bounding box of the filled cells of a square crafting grid. */
function gridBounds(grid, size) {
  let minX = size, minY = size, maxX = -1, maxY = -1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (grid[y * size + x]) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return { minX, minY, maxX, maxY, empty: maxX < 0 };
}

export function matchRecipe(grid, size) {
  const b = gridBounds(grid, size);
  if (b.empty) return null;
  const gw = b.maxX - b.minX + 1, gh = b.maxY - b.minY + 1;

  for (const r of RECIPES) {
    if (r.type === 'shaped') {
      const t = r.trimmed;
      if (t.length !== gh || t[0].length !== gw) continue;
      if (t.length > size || t[0].length > size) continue;
      let ok = true;
      for (let y = 0; y < gh && ok; y++) {
        for (let x = 0; x < gw; x++) {
          const ch = t[y][x];
          const spec = ch === ' ' ? null : (r.keys[ch] ?? ch);
          const cell = grid[(b.minY + y) * size + (b.minX + x)];
          if (!ingredientMatches(spec, cell)) { ok = false; break; }
        }
      }
      if (!ok) continue;
      // any cell outside the trimmed area must be empty
      let extra = false;
      for (let y = 0; y < size && !extra; y++) {
        for (let x = 0; x < size; x++) {
          if (y >= b.minY && y < b.minY + gh && x >= b.minX && x < b.minX + gw) continue;
          if (grid[y * size + x]) { extra = true; break; }
        }
      }
      if (extra) continue;
      return r;
    } else {
      const cells = [];
      for (let i = 0; i < size * size; i++) if (grid[i]) cells.push(grid[i]);
      if (cells.length !== r.ingredients.length) continue;
      const pool = [...r.ingredients];
      let ok = true;
      for (const c of cells) {
        const i = pool.findIndex((spec) => ingredientMatches(spec, c));
        if (i < 0) { ok = false; break; }
        pool.splice(i, 1);
      }
      if (ok && pool.length === 0) return r;
    }
  }
  return null;
}

/** Consume one of every ingredient after the output has been taken. */
export function consumeGrid(grid, size) {
  for (let i = 0; i < size * size; i++) {
    const s = grid[i];
    if (!s) continue;
    s.count--;
    if (s.count <= 0) grid[i] = null;
  }
}

// ---------------------------------------------------------------------------
// Recipe book helpers
// ---------------------------------------------------------------------------

function specCandidates(spec) {
  if (!spec || spec === ' ') return [];
  if (spec[0] === '#') return TAGS[spec.slice(1)] || [];
  return [spec];
}

/** Flat ingredient requirement list, e.g. { oak_planks: 4, stick: 2 }. */
export function recipeNeeds(r) {
  const specs = [];
  if (r.type === 'shaped') {
    for (const row of r.trimmed) for (const ch of row) {
      if (ch === ' ') continue;
      specs.push(r.keys[ch] ?? ch);
    }
  } else specs.push(...r.ingredients);
  return specs;
}

/** True when the player's inventory contains everything the recipe needs. */
export function canCraft(r, counts) {
  const specs = recipeNeeds(r);
  const used = new Map();
  for (const spec of specs) {
    const cands = specCandidates(spec);
    let ok = false;
    for (const c of cands) {
      const have = (counts.get(c) || 0) - (used.get(c) || 0);
      if (have > 0) { used.set(c, (used.get(c) || 0) + 1); ok = true; break; }
    }
    if (!ok) return false;
  }
  return true;
}

export function recipesFor(query) {
  const q = query.trim().toLowerCase();
  const listed = RECIPES.filter((r) => !r.alt);
  if (!q) return listed;
  return listed.filter((r) => {
    const it = getItem(r.out.key);
    return (it?.name.toLowerCase().includes(q)) || r.out.key.includes(q) || r.category.includes(q);
  });
}

/**
 * Where each ingredient sits in a `size` x `size` grid, for the recipe book's
 * ghost preview. Entries are `{ spec, keys }`, where `keys` lists every item
 * that would satisfy the slot — the UI draws the first as the icon and checks
 * the rest against the inventory to decide whether to grey it out.
 */
export function recipeLayout(r, size) {
  const cells = new Array(size * size).fill(null);
  const put = (i, spec) => {
    if (i < 0 || i >= cells.length) return;
    cells[i] = { spec, keys: specCandidates(spec) };
  };
  if (r.type === 'shaped') {
    const t = r.trimmed;
    for (let y = 0; y < t.length && y < size; y++) {
      for (let x = 0; x < t[y].length && x < size; x++) {
        const ch = t[y][x];
        if (ch === ' ') continue;
        put(y * size + x, r.keys[ch] ?? ch);
      }
    }
  } else {
    r.ingredients.forEach((spec, i) => put(i, spec));
  }
  return cells;
}

/**
 * Lay a recipe out in a crafting grid, pulling items from the inventory.
 * Returns false if something is missing.
 */
export function fillGrid(r, grid, size, inv) {
  // put anything already in the grid back first
  for (let i = 0; i < grid.length; i++) {
    if (grid[i]) { inv.add(grid[i].key, grid[i].count, grid[i].dur); grid[i] = null; }
  }
  const counts = new Map();
  for (const s of inv.slots) if (s) counts.set(s.key, (counts.get(s.key) || 0) + s.count);
  if (!canCraft(r, counts)) return false;

  const place = (index, spec) => {
    for (const c of specCandidates(spec)) {
      if (inv.count(c) > 0) {
        inv.remove(c, 1);
        grid[index] = { key: c, count: 1 };
        return true;
      }
    }
    return false;
  };

  if (r.type === 'shaped') {
    const t = r.trimmed;
    for (let y = 0; y < t.length; y++) {
      for (let x = 0; x < t[y].length; x++) {
        const ch = t[y][x];
        if (ch === ' ') continue;
        if (!place(y * size + x, r.keys[ch] ?? ch)) return false;
      }
    }
  } else {
    r.ingredients.forEach((spec, i) => place(i, spec));
  }
  return true;
}

export { ITEMS };
