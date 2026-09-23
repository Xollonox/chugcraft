// ============================================================================
// Container screens: inventory (2x2 craft + armour), crafting table (3x3),
// furnace, chest and villager trading — all sharing one slot/drag engine with
// stack splitting, shift-quick-move, tooltips and a searchable recipe book.
// ============================================================================

import { iconFor, buildPlayerPreview } from '../engine/itemicons.js';
import {
  getItem, maxDurability, RARITY_COLOR, makeStack, ITEMS,
  CREATIVE_GROUPS, creativeCatalogue,
} from '../crafting/items.js';
import {
  matchRecipe, consumeGrid, RECIPES, canCraft, fillGrid, recipesFor, recipeLayout,
} from '../crafting/recipes.js';
import { stackLimit, canMerge } from '../player/inventory.js';
import { SMELT_TIME, newFurnace } from '../crafting/smelting.js';
import { B } from '../world/blocks.js';
import { WorkshopUI } from './workshop.js';

const $ = (id) => document.getElementById(id);

export class Containers {
  constructor(game) {
    this.game = game;
    this.root = $('container-root');
    this.ghost = $('drag-ghost');
    this.tooltip = $('tooltip');
    this.open = false;
    this.type = null;
    this.cursor = null;          // the stack "in hand" while dragging
    this.slots = [];
    this._ghost = null;          // recipe-book preview: one entry per grid cell
    this._ghostRecipe = null;
    this.bookOpen = game.settings.get('recipeBook') !== false;
    this.mouse = { x: 0, y: 0 };

    // A left- or right-drag started on a slot paints the held stack across
    // every slot it touches, the way Minecraft does: left spreads the stack
    // evenly, right drops one item per slot. Far nicer than clicking each cell.
    this.drag = null;

    // The screen keeps the pointer locked and draws its own cursor, so the
    // browser stops popping its "press Esc to show your cursor" banner every
    // single time the inventory opens. Real mouse events are used whenever the
    // pointer happens not to be locked.
    this.virtual = false;
    this.cursorEl = $('ui-cursor');

    addEventListener('mousemove', (e) => {
      if (this.virtual) return;
      this.mouse.x = e.clientX; this.mouse.y = e.clientY;
      if (!this.open) return;
      this._positionGhost();
      if (this.drag) this._dragOver(e.target);
    });
    addEventListener('mouseup', () => { if (this.drag) this._endDrag(); });
    // Under pointer lock every button event lands on the canvas, so the click
    // is replayed onto whatever the virtual cursor is actually over.
    addEventListener('mousedown', (e) => {
      // Only genuine hardware clicks get replayed. The replay is itself a
      // MouseEvent that bubbles back up to this very listener, so without the
      // trusted check it would re-enter itself until the stack blew.
      if (!e.isTrusted || !this.open || !this.virtual) return;
      e.preventDefault();
      const el = this._elementUnderCursor();
      if (!el) { this.close(); return; }
      // A replayed event doesn't move focus the way a real click would, so
      // text fields have to be focused by hand or they can never be typed in.
      const field = el.closest ? el.closest('input, textarea') : null;
      if (field) field.focus();
      else if (document.activeElement && document.activeElement !== document.body) {
        document.activeElement.blur();
      }
      el.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true, button: e.button, shiftKey: this._shiftHeld(),
      }));
    }, true);

    // Scrolling has to be routed by hand too: the wheel event lands on the
    // canvas under pointer lock, never on the list the cursor is over.
    addEventListener('wheel', (e) => {
      if (!this.open) return;
      const el = this.virtual ? this._elementUnderCursor() : e.target;
      const scroller = this._scrollableUnder(el);
      if (!scroller) return;
      scroller.scrollTop += Math.sign(e.deltaY) * 40;
      e.preventDefault();
    }, { passive: false });
    this.root.addEventListener('mousedown', (e) => this._onMouse(e));
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // -------------------------------------------------------------------------
  // Virtual cursor
  // -------------------------------------------------------------------------

  _shiftHeld() {
    const d = this.game.input.down;
    return d.has('ShiftLeft') || d.has('ShiftRight');
  }

  _elementUnderCursor() {
    this.cursorEl.style.pointerEvents = 'none';
    return document.elementFromPoint(this.mouse.x, this.mouse.y);
  }

  /** Nearest ancestor of `el` that can actually scroll. */
  _scrollableUnder(el) {
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      if (n.scrollHeight > n.clientHeight + 1) return n;
    }
    return null;
  }

  /**
   * Advance the drawn cursor by a raw pointer delta. Called once per frame.
   * The raw delta is what the camera uses at full look sensitivity, which is
   * far too fast for picking out a 16-pixel slot, so it's scaled down.
   */
  moveCursor(dx, dy) {
    if (!this.open || !this.virtual) return;
    const s = this.game.settings.get('cursorSpeed') ?? 0.5;
    this.mouse.x = Math.max(0, Math.min(innerWidth - 1, this.mouse.x + dx * s));
    this.mouse.y = Math.max(0, Math.min(innerHeight - 1, this.mouse.y + dy * s));
    this.cursorEl.style.left = this.mouse.x + 'px';
    this.cursorEl.style.top = this.mouse.y + 'px';
    this._positionGhost();

    // Hover isn't delivered under pointer lock, so enter/leave are synthesised
    // for whatever the cursor crosses. Every hover listener stays as it is.
    const el = this._elementUnderCursor();
    const slot = el && el.closest ? el.closest('.slot') : null;
    if (slot !== this._hovered) {
      this._hovered?.dispatchEvent(new MouseEvent('mouseleave'));
      this._hovered = slot;
      this.hoverRec = slot && slot.dataset.slot !== undefined
        ? this.slots[Number(slot.dataset.slot)] : null;
      slot?.dispatchEvent(new MouseEvent('mouseenter'));
    }
    if (this.drag) this._dragOver(el);
  }

  // -------------------------------------------------------------------------
  show(type, data) {
    this.type = type;
    this.data = data || {};
    this.open = true;
    this.virtual = !!this.game.input.locked;
    this._hovered = null;
    if (this.virtual) {
      this.mouse.x = innerWidth / 2;
      this.mouse.y = innerHeight / 2;
      this.cursorEl.style.left = this.mouse.x + 'px';
      this.cursorEl.style.top = this.mouse.y + 'px';
    }
    this.cursorEl.classList.toggle('hidden', !this.virtual);
    this.root.classList.toggle('virtual-cursor', this.virtual);
    this.root.classList.remove('hidden');
    this._build();
    this.refresh();
    this.game.audio.play(type === 'chest' ? 'chest' : 'click', { volume: 0.6 });
  }

  close() {
    if (!this.open) return;
    // return anything held or left in the crafting grid
    const inv = this.game.player.inventory;
    const returnStack = (s) => {
      const left=inv.addStack(s);
      if(left){const p=this.game.player.pos;this.game.dropItem(p.x,p.y+0.7,p.z,{...s,count:left},{delay:1});}
    };
    if (this.cursor) { returnStack(this.cursor); this.cursor = null; }
    const grid = this._grid;
    if (grid) {
      for (let i = 0; i < grid.length; i++) {
        if (grid[i]) { returnStack(grid[i]); grid[i] = null; }
      }
    }
    this.clearGhost();
    this.drag = null;
    this.open = false;
    this.type = null;
    this._hovered = null;
    this.hoverRec = null;
    this.virtual = false;
    this.cursorEl.classList.add('hidden');
    this.root.classList.remove('virtual-cursor');
    this.root.classList.add('hidden');
    this.tooltip.classList.add('hidden');
    this.ghost.classList.add('hidden');
    this.game.audio.play('click', { volume: 0.4 });
    this.game.onContainerClosed?.();
  }

  // -------------------------------------------------------------------------
  _slotEl(getter, setter, opts = {}) {
    const d = document.createElement('div');
    d.className = 'slot';
    d.innerHTML = '<div class="icon"></div><div class="dur hidden"><i></i></div><div class="count"></div>';
    const rec = { el: d, get: getter, set: setter, ...opts };
    d.dataset.slot = this.slots.length;
    this.slots.push(rec);
    d.addEventListener('mouseenter', () => { this.hoverRec = rec; this._showTooltip(rec); });
    d.addEventListener('mouseleave', () => {
      if (this.hoverRec === rec) this.hoverRec = null;
      this.tooltip.classList.add('hidden');
    });
    return d;
  }

  /**
   * Swap the slot under the cursor with the off hand. Minecraft's F key; the
   * same shortcut works from the hotbar while playing (see Game.swapOffhand).
   */
  offhandSwap() {
    const rec = this.hoverRec;
    if (!rec || !this.open || rec.output || rec.furnaceOut || rec.armorSlot) return false;
    const inv = this.game.player.inventory;
    const here = rec.get();
    if (!here && !inv.offhand) return false;
    rec.set(inv.offhand || null);
    inv.offhand = here || null;
    this.clearGhost();
    inv.changed();
    this.refresh();
    this._showTooltip(rec);
    this.game.audio.play('click', { volume: 0.4 });
    return true;
  }

  /**
   * Minecraft's hotbar swap: point at any slot, press 1-9, and that item
   * trades places with the matching hotbar slot. Saves dragging things down
   * one at a time from a chest.
   */
  hotbarSwap(index) {
    const rec = this.hoverRec;
    if (!rec || !this.open) return false;
    if (rec.armorSlot) return false;
    const inv = this.game.player.inventory;

    // The crafting result isn't a slot you can put things into — pressing a
    // number over it takes the result and drops it straight into that hotbar
    // slot, which is the whole point of the shortcut when you're mass-crafting.
    if (rec.output) {
      const out = this._output;
      if (!out) return false;
      const dest = inv.slots[index];
      if (dest && !(canMerge(dest, out) && dest.count + out.count <= stackLimit(out.key))) return false;
      const prev = this.cursor;
      this.cursor = null;
      this._takeOutput(rec, false);
      const made = this.cursor;
      this.cursor = prev;
      if (!made) return false;
      if (dest) dest.count += made.count;
      else inv.slots[index] = made;
      inv.changed();
      this.refresh();
      this._showTooltip(rec);
      return true;
    }
    if (rec.furnaceOut) {
      const out = rec.get();
      if (!out) return false;
      const dest = inv.slots[index];
      if (dest && !(canMerge(dest, out) && dest.count + out.count <= stackLimit(out.key))) return false;
      const prev = this.cursor;
      this.cursor = null;
      this._takeOutput(rec, false);
      const made = this.cursor;
      this.cursor = prev;
      if (!made) return false;
      if (dest) dest.count += made.count;
      else inv.slots[index] = made;
      inv.changed();
      this.refresh();
      this._showTooltip(rec);
      return true;
    }
    const here = rec.get();
    const there = inv.slots[index];
    if (!here && !there) return false;
    // The target has to be able to hold what we're sending it.
    if (here && !this._canPlace(rec, there)) return false;
    rec.set(there || null);
    inv.slots[index] = here || null;
    this.clearGhost();
    inv.changed();
    this.refresh();
    this._showTooltip(rec);
    this.game.audio.play('click', { volume: 0.4 });
    return true;
  }

  _grid3(cols, count, getter, setter, opts) {
    const g = document.createElement('div');
    g.className = 'grid';
    g.style.gridTemplateColumns = `repeat(${cols}, auto)`;
    for (let i = 0; i < count; i++) {
      g.appendChild(this._slotEl(() => getter(i), (s) => setter(i, s),
        opts ? { ...opts, gridIndex: i } : undefined));
    }
    return g;
  }

  _build() {
    const inv = this.game.player.inventory;
    this.slots = [];
    this._grid = null; this._output=null; this._recipe=null;
    this.recipeList=null; this.recipeHint=null; this.workshop=null;
    this.previewEl = null;      // rebuilt below only by screens that show it
    this.clearGhost();
    this.root.innerHTML = '';
    // Screens with a recipe book sit in a two-column shell: the book pops out
    // on the left, the inventory proper on the right, exactly as in Minecraft.
    const shell = document.createElement('div');
    shell.className = 'gui-shell';
    this.root.appendChild(shell);
    const panel = document.createElement('div');
    panel.className = 'gui-panel';

    const close = document.createElement('div');
    close.className = 'gui-close';
    close.textContent = '✕';
    close.addEventListener('mousedown', (e) => { e.stopPropagation(); this.close(); });
    panel.appendChild(close);

    const title = document.createElement('div');
    title.className = 'gui-title';
    panel.appendChild(title);

    const top = document.createElement('div');
    top.className = 'gui-row';
    panel.appendChild(top);

    if (this.type === 'inventory' || this.type === 'crafting') {
      const size = this.type === 'inventory' ? 2 : 3;
      title.textContent = this.type === 'inventory' ? 'Inventory' : 'Crafting';
      this._grid = this.type === 'inventory' ? inv.craft : new Array(9).fill(null);
      this._gridSize = size;
      top.classList.add('inv-top');

      // Left: the recipe-book button, then armour, then the character.
      if (this.type === 'inventory') {
        top.appendChild(this._buildArmorPanel());
      } else {
        const bookCol = document.createElement('div');
        bookCol.className = 'gui-cols';
        bookCol.appendChild(this._buildBookButton());
        top.appendChild(bookCol);
      }

      // Right: the crafting grid under its own heading, with the arrow and
      // result to its side — the arrangement the real screen uses.
      const craftBlock = document.createElement('div');
      craftBlock.className = 'craft-block';
      // The crafting-table screen is already titled "Crafting"; only the
      // inventory needs the grid labelled separately.
      if (this.type === 'inventory') {
        const craftLabel = document.createElement('div');
        craftLabel.className = 'gui-subtitle';
        craftLabel.textContent = 'Crafting';
        craftBlock.appendChild(craftLabel);
      }
      const craftRow = document.createElement('div');
      craftRow.className = 'gui-row';
      craftRow.appendChild(this._grid3(size, size * size,
        (i) => this._grid[i], (i, s) => { this._grid[i] = s; }, { craftCell: true }));
      const arrow = document.createElement('div');
      arrow.className = 'gui-sep';
      arrow.textContent = '➤';
      craftRow.appendChild(arrow);
      craftRow.appendChild(this._slotEl(() => this._output, () => {}, { output: true }));
      craftBlock.appendChild(craftRow);
      top.appendChild(craftBlock);

      // The book itself is a separate pop-out panel beside the screen.
      this._bookPanel = this._buildRecipePanel();
      this._bookPanel.classList.toggle('hidden', !this.bookOpen);
      shell.appendChild(this._bookPanel);
    } else if (['enchant','anvil','brew'].includes(this.type)) {
      this.workshop=new WorkshopUI(this);title.textContent=this.workshop.title;top.appendChild(this.workshop.root);
    } else if (this.type === 'furnace') {
      title.textContent = 'Furnace';
      const f = this.data.furnace;
      const col = document.createElement('div');
      col.className = 'gui-cols';
      const r1 = document.createElement('div');
      r1.className = 'gui-row';
      const inCol = document.createElement('div');
      inCol.className = 'gui-cols';
      inCol.appendChild(this._slotEl(() => f.input, (s) => { f.input = s; }, { label: 'Smelt' }));
      this.flameEl = document.createElement('div');
      this.flameEl.className = 'gui-flame';
      this.flameEl.innerHTML = '<div class="f-bg"></div><div class="f-fg"></div>';
      inCol.appendChild(this.flameEl);
      inCol.appendChild(this._slotEl(() => f.fuel, (s) => { f.fuel = s; }, { label: 'Fuel' }));
      r1.appendChild(inCol);
      this.arrowEl = document.createElement('div');
      this.arrowEl.className = 'gui-sep';
      r1.appendChild(this.arrowEl);
      r1.appendChild(this._slotEl(() => f.output, (s) => { f.output = s; }, { output: true, furnaceOut: true }));
      col.appendChild(r1);
      top.appendChild(col);
    } else if (this.type === 'chest') {
      title.textContent = 'Chest';
      const items = this.data.items;
      top.appendChild(this._grid3(9, 27, (i) => items[i], (i, s) => { items[i] = s; }));
    } else if (this.type === 'creative') {
      title.textContent = 'Creative Inventory';
      // Creative has no crafting grid, but it keeps the character view and the
      // armour slots — you still want to see and dress the player.
      top.appendChild(this._buildArmorPanel());
      top.appendChild(this._buildCreativePalette());
    } else if (this.type === 'trade') {
      title.textContent = this.data.title || 'Villager';
      const list = document.createElement('div');
      list.className = 'gui-cols';
      for (const tr of this.data.trades) {
        const row = document.createElement('div');
        row.className = 'gui-row';
        row.style.alignItems = 'center';
        const give = document.createElement('div');
        give.className = 'slot';
        give.innerHTML = `<div class="icon" style="background-image:url(${iconFor(tr.give.key)})"></div>
          <div class="count">${tr.give.count}</div>`;
        const arrow = document.createElement('div');
        arrow.className = 'gui-sep'; arrow.textContent = '➤';
        const get = document.createElement('div');
        get.className = 'slot';
        get.innerHTML = `<div class="icon" style="background-image:url(${iconFor(tr.get.key)})"></div>
          <div class="count">${tr.get.count}</div>`;
        const btn = document.createElement('button');
        btn.className = 'mc-btn small';
        btn.textContent = 'Trade';
        btn.addEventListener('mousedown', (e) => {
          e.stopPropagation();
          this._doTrade(tr);
        });
        row.append(give, arrow, get, btn);
        list.appendChild(row);
      }
      top.appendChild(list);
    }

    // --- player inventory (always present) ---
    const invWrap = document.createElement('div');
    invWrap.className = 'gui-cols';
    // The player's own screens label the storage grid; a chest or furnace
    // heading already says whose inventory the lower half is.
    if (this.type !== 'inventory') {
      const label = document.createElement('div');
      label.className = 'gui-subtitle';
      label.textContent = 'Inventory';
      invWrap.appendChild(label);
    }
    invWrap.appendChild(this._grid3(9, 27, (i) => inv.slots[i + 9], (i, s) => { inv.slots[i + 9] = s; }));
    const hb = this._grid3(9, 9, (i) => inv.slots[i], (i, s) => { inv.slots[i] = s; });
    hb.classList.add('hotbar-row');
    invWrap.appendChild(hb);
    panel.appendChild(invWrap);

    shell.appendChild(panel);
  }

  /** The green book that shows and hides the recipe list, as in Minecraft. */
  _buildBookButton() {
    const b = document.createElement('div');
    b.className = 'book-btn' + (this.bookOpen ? ' on' : '');
    b.title = 'Recipe book';
    b.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      this.bookOpen = !this.bookOpen;
      this.game.settings.set('recipeBook', this.bookOpen);
      this.game.audio.play('click', { volume: 0.5 });
      this._build();
      this.refresh();
    });
    return b;
  }

  /** The four armour slots beside a live view of the player wearing them. */
  _buildArmorPanel() {
    const inv = this.game.player.inventory;
    const row = document.createElement('div');
    row.className = 'gui-row armor-panel';
    const armor = document.createElement('div');
    armor.className = 'grid';
    armor.style.gridTemplateColumns = 'auto';
    const slotNames = ['helmet', 'chestplate', 'leggings', 'boots'];
    for (let i = 0; i < 4; i++) {
      armor.appendChild(this._slotEl(() => inv.armor[i], (s) => { inv.armor[i] = s; },
        { armorSlot: slotNames[i] }));
    }
    row.appendChild(armor);
    const prev = document.createElement('div');
    prev.className = 'player-preview';
    row.appendChild(prev);
    this.previewEl = prev;
    // The off-hand slot sits beside the character, below the armour column,
    // exactly where Minecraft puts it.
    const off = document.createElement('div');
    off.className = 'gui-cols offhand-col';
    off.appendChild(this._slotEl(
      () => inv.offhand, (s) => { inv.offhand = s; }, { offhand: true }));
    row.appendChild(off);
    // The book sits under the armour column, where Minecraft puts it.
    if (this.type === 'inventory') {
      const col = document.createElement('div');
      col.className = 'gui-cols armor-side';
      col.appendChild(row);
      col.appendChild(this._buildBookButton());
      return col;
    }
    return row;
  }

  /**
   * The Creative palette: a tabbed, searchable library of every item. No
   * crafting grid — you just take what you want. Shift takes a full stack.
   */
  _buildCreativePalette() {
    const wrap = document.createElement('div');
    wrap.className = 'creative-panel';
    if (!this._creativeTab) this._creativeTab = CREATIVE_GROUPS[0][0];

    const tabs = document.createElement('div');
    tabs.className = 'creative-tabs';
    for (const [id, label] of CREATIVE_GROUPS) {
      const b = document.createElement('button');
      b.className = 'mc-btn small creative-tab' + (id === this._creativeTab ? ' sel' : '');
      b.textContent = label;
      b.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        this._creativeTab = id;
        this._creativeSearch = '';
        this._build();
        this.refresh();
      });
      tabs.appendChild(b);
    }
    wrap.appendChild(tabs);

    const search = document.createElement('input');
    search.className = 'recipe-search';
    search.placeholder = 'Search all items...';
    search.value = this._creativeSearch || '';
    search.addEventListener('mousedown', (e) => e.stopPropagation());
    search.addEventListener('input', () => {
      this._creativeSearch = search.value;
      this._fillCreativeList();
    });
    wrap.appendChild(search);

    const list = document.createElement('div');
    list.className = 'creative-list';
    wrap.appendChild(list);
    this.creativeList = list;

    const hint = document.createElement('div');
    hint.className = 'recipe-hint';
    hint.textContent = 'Click for one, Shift-click for a full stack. Drop items here to delete them.';
    wrap.appendChild(hint);
    this.creativeHint = hint;

    this._fillCreativeList();
    return wrap;
  }

  _fillCreativeList() {
    const list = this.creativeList;
    if (!list) return;
    // Palette entries deliberately stay OUT of `this.slots`. They hold nothing,
    // and re-filling the list on every search would otherwise renumber the
    // array while the DOM still carried the old indices — which silently
    // rewired clicks on the real inventory slots underneath.
    list.innerHTML = '';
    const q = (this._creativeSearch || '').trim().toLowerCase();
    const cat = creativeCatalogue();
    const keys = q
      ? [...ITEMS.keys()].filter((k) => {
        const it = ITEMS.get(k);
        return k.includes(q) || it.name.toLowerCase().includes(q);
      })
      : (cat.get(this._creativeTab) || []);

    for (const key of keys) {
      const it = ITEMS.get(key);
      if (!it) continue;
      const d = document.createElement('div');
      d.className = 'slot';
      d.dataset.paletteKey = key;
      d.innerHTML = `<div class="icon" style="background-image:url(${iconFor(key)})"></div>`;
      d.title = it.name;
      d.addEventListener('mouseenter', () => this._showTooltip({ palette: true, paletteKey: key }));
      d.addEventListener('mouseleave', () => this.tooltip.classList.add('hidden'));
      list.appendChild(d);
    }
    if (!keys.length) {
      const e = document.createElement('div');
      e.style.gridColumn = '1 / -1';
      e.className = 'recipe-hint';
      e.textContent = 'No items match.';
      list.appendChild(e);
    }
  }

  _buildRecipePanel() {
    const wrap = document.createElement('div');
    wrap.className = 'recipe-panel';
    const search = document.createElement('input');
    search.className = 'recipe-search';
    search.placeholder = 'Search recipes...';
    search.addEventListener('mousedown', (e) => e.stopPropagation());
    search.addEventListener('input', () => this._renderRecipes(search.value));
    wrap.appendChild(search);
    const list = document.createElement('div');
    list.className = 'recipe-list';
    wrap.appendChild(list);
    const hint = document.createElement('div');
    hint.className = 'recipe-hint';
    // Short enough to fit the fixed single-line hint without ellipsis.
    hint.textContent = 'Click a recipe to lay it out.';
    wrap.appendChild(hint);
    this.recipeList = list;
    this.recipeHint = hint;
    this._renderRecipes('');
    return wrap;
  }

  _renderRecipes(query) {
    const inv = this.game.player.inventory;
    const counts = new Map();
    for (const s of inv.slots) if (s) counts.set(s.key, (counts.get(s.key) || 0) + s.count);
    const size = this._gridSize || 2;
    // The list is rebuilt on every refresh, which would otherwise throw you
    // back to the top the moment you clicked a recipe further down.
    const scroll = this.recipeList.scrollTop;
    this.recipeList.innerHTML = '';
    // Recipes too big for this grid are shown rather than hidden. Filtering
    // them out made half the game look unimplemented — you'd open your
    // inventory, search "sword", and conclude swords weren't in the game.
    const list = recipesFor(query || '');
    const fits = (r) => r.size <= size;
    for (const r of [...list].sort((a, b) => (fits(b) ? 1 : 0) - (fits(a) ? 1 : 0))) {
      const tooBig = !fits(r);
      const ok = !tooBig && canCraft(r, counts);
      const d = document.createElement('div');
      d.className = 'slot' + (ok ? '' : ' locked') + (tooBig ? ' needs-table' : '') +
        (this._ghostRecipe === r ? ' sel' : '');
      const it = getItem(r.out.key);
      d.innerHTML = `<div class="icon" style="background-image:url(${iconFor(r.out.key)})"></div>` +
        (r.out.count > 1 ? `<div class="count">${r.out.count}</div>` : '');
      d.title = (it ? it.name : r.out.key) + (tooBig ? ' — needs a crafting table' : '');
      // The hint is a fixed-height single line. It used to append "missing
      // materials", which wrapped, grew the panel and made the screen jitter
      // as the pointer crossed the list.
      d.addEventListener('mouseenter', () => {
        this.recipeHint.textContent = tooBig
          ? `${it ? it.name : r.out.key} — needs a crafting table`
          : (it ? it.name : r.out.key);
      });
      d.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        if (tooBig) {
          this.recipeHint.textContent = `${it ? it.name : r.out.key} — needs a crafting table`;
          this.game.audio.play('click', { rate: 0.6, volume: 0.4 });
          return;
        }
        this._showRecipe(r, size, inv);
      });
      this.recipeList.appendChild(d);
    }
    if (!this.recipeList.children.length) {
      const e = document.createElement('div');
      e.style.gridColumn = '1 / -1';
      e.className = 'recipe-hint';
      e.textContent = 'No recipes match.';
      this.recipeList.appendChild(e);
    }
    this.recipeList.scrollTop = scroll;
  }

  /**
   * Click a recipe: lay it out in the crafting grid. If the materials are all
   * there they go in for real and it's immediately craftable; otherwise the
   * grid shows a ghost of the layout, each cell greyed out unless you hold the
   * ingredient — so the book teaches the shape either way.
   */
  _showRecipe(r, size, inv) {
    this._ghostRecipe = r;
    this._ghost = recipeLayout(r, size);
    const filled = fillGrid(r, this._grid, size, inv);
    this.game.audio.play('click', { volume: filled ? 0.5 : 0.35, rate: filled ? 1 : 0.7 });
    this.refresh();
  }

  clearGhost() {
    this._ghost = null;
    this._ghostRecipe = null;
  }

  /**
   * Decide, once per refresh, which ghost cells the player can actually cover.
   * This has to draw down a shared tally rather than ask "do I own one of
   * these?" per cell — a recipe wanting four planks when you hold one should
   * light a single cell, not all four.
   */
  _tallyGhost() {
    if (!this._ghost) return;
    const counts = new Map();
    for (const s of this.game.player.inventory.slots) {
      if (s) counts.set(s.key, (counts.get(s.key) || 0) + s.count);
    }
    for (const cell of this._ghost) {
      if (!cell) continue;
      cell.have = null;
      for (const k of cell.keys) {
        const n = counts.get(k) || 0;
        if (n > 0) { counts.set(k, n - 1); cell.have = k; break; }
      }
    }
  }

  // -------------------------------------------------------------------------
  refresh() {
    if (!this.open) return;
    // crafting output
    if (this._grid) {
      const r = matchRecipe(this._grid, this._gridSize);
      this._recipe = r;
      this._output = r ? makeStack(r.out.key, r.out.count) : null;
    }
    this._tallyGhost();
    for (const s of this.slots) this._paint(s);
    if (this.previewEl) {
      const inv = this.game.player.inventory;
      const sig = inv.armor.map((a) => (a ? a.key : '-')).join(',');
      if (this.previewEl._sig !== sig) {
        this.previewEl._sig = sig;
        this.previewEl.style.backgroundImage = `url(${buildPlayerPreview(inv.armor)})`;
        this.previewEl.style.backgroundSize = 'contain';
        this.previewEl.style.backgroundRepeat = 'no-repeat';
        this.previewEl.style.backgroundPosition = 'center';
        this.previewEl.style.imageRendering = 'pixelated';
      }
    }
    this._positionGhost();
    if (this.recipeList) this._renderRecipes(this.root.querySelector('.recipe-search')?.value || '');
    if (this.type === 'furnace') this._paintFurnace();
    this.workshop?.render();
  }

  _paint(rec) {
    const s = rec.get();
    const icon = rec.el.firstChild;
    const durEl = rec.el.children[1];
    const count = rec.el.children[2];
    icon.style.backgroundImage = s ? `url(${iconFor(s.key)})` : 'none';
    count.textContent = s && s.count > 1 ? String(s.count) : '';

    // Ghost preview from the recipe book, drawn only in cells that are empty.
    const ghost = !s && rec.craftCell && this._ghost ? this._ghost[rec.gridIndex] : null;
    if (ghost && ghost.keys.length) {
      icon.style.backgroundImage = `url(${iconFor(ghost.have || ghost.keys[0])})`;
      rec.el.classList.add('ghost');
      rec.el.classList.toggle('ghost-missing', !ghost.have);
    } else {
      rec.el.classList.remove('ghost', 'ghost-missing');
    }
    if (s && s.dur !== undefined) {
      const max = maxDurability(s.key) || 1;
      const f = Math.max(0, s.dur / max);
      durEl.classList.toggle('hidden', f >= 1);
      durEl.firstChild.style.width = (f * 100) + '%';
      durEl.firstChild.style.background = f > 0.5
        ? `rgb(${Math.round(255 * (1 - f) * 2)},255,0)` : `rgb(255,${Math.round(255 * f * 2)},0)`;
    } else durEl.classList.add('hidden');
  }

  _paintFurnace() {
    const f = this.data.furnace;
    const burnF = f.burnMax > 0 ? Math.max(0, f.burn / f.burnMax) : 0;
    this.flameEl.querySelector('.f-bg').style.cssText =
      'height:100%;background:#3a3a3a;';
    this.flameEl.querySelector('.f-fg').style.cssText =
      `height:${(burnF * 100).toFixed(0)}%;background:linear-gradient(#ffe066,#ff7a10);`;
    const cook = Math.min(1, f.cook / SMELT_TIME);
    this.arrowEl.textContent = '➤';
    this.arrowEl.style.color = cook > 0 ? '#d08020' : '#6a6a6a';
    this.arrowEl.style.opacity = String(0.45 + cook * 0.55);
  }

  _positionGhost() {
    if (!this.cursor) { this.ghost.classList.add('hidden'); return; }
    this.ghost.classList.remove('hidden');
    this.ghost.innerHTML = `<div class="icon" style="background-image:url(${iconFor(this.cursor.key)})"></div>` +
      (this.cursor.count > 1 ? `<div class="count">${this.cursor.count}</div>` : '');
    this.ghost.style.left = (this.mouse.x - 16) + 'px';
    this.ghost.style.top = (this.mouse.y - 16) + 'px';
  }

  _showTooltip(rec) {
    const s = rec.palette ? makeStack(rec.paletteKey, 1) : rec.get();
    if (!s) {
      const ghost = rec.craftCell && this._ghost ? this._ghost[rec.gridIndex] : null;
      if (ghost && ghost.keys.length) {
        const it = getItem(ghost.have || ghost.keys[0]);
        this.tooltip.classList.remove('hidden');
        this.tooltip.innerHTML =
          `<div class="tooltip-title">${it ? it.name : ghost.keys[0]}</div>` +
          (ghost.have ? '' : '<div class="tooltip-note">you don\'t have this</div>');
        this._placeTooltip();
        return;
      }
      if (rec.armorSlot) {
        this.tooltip.classList.remove('hidden');
        this.tooltip.innerHTML = `<div class="tooltip-sub">${rec.armorSlot}</div>`;
        this._placeTooltip();
      } else if (rec.offhand) {
        this.tooltip.classList.remove('hidden');
        this.tooltip.innerHTML =
          '<div class="tooltip-sub">off hand</div>' +
          '<div class="tooltip-note">right-click uses this</div>';
        this._placeTooltip();
      } else this.tooltip.classList.add('hidden');
      return;
    }
    const it = getItem(s.key);
    let html = `<div class="tooltip-title" style="color:${RARITY_COLOR[it?.rarity || 0]}">${it ? it.name : s.key}</div>`;
    if (it?.tool) {
      html += `<div class="tooltip-sub">${it.tool.type} &middot; damage ${it.tool.damage.toFixed(1)}</div>`;
    }
    if (it?.armor) html += `<div class="tooltip-sub">armour +${it.armor.points}</div>`;
    if (it?.food) html += `<div class="tooltip-good">restores ${it.food.hunger} hunger</div>`;
    if (it?.fuel) html += `<div class="tooltip-sub">burns for ${(it.fuel / 20).toFixed(0)}s</div>`;
    if (s.dur !== undefined) {
      const max = maxDurability(s.key);
      html += `<div class="tooltip-sub">durability ${Math.max(0, Math.round(s.dur))} / ${max}</div>`;
    }
    if (it?.desc) html += `<div class="tooltip-note">${it.desc}</div>`;
    this.tooltip.innerHTML = html;
    this.tooltip.classList.remove('hidden');
    this._placeTooltip();
  }

  _placeTooltip() {
    const r = this.tooltip.getBoundingClientRect();
    let x = this.mouse.x + 14, y = this.mouse.y + 14;
    if (x + r.width > window.innerWidth - 8) x = this.mouse.x - r.width - 12;
    if (y + r.height > window.innerHeight - 8) y = this.mouse.y - r.height - 12;
    this.tooltip.style.left = Math.max(4, x) + 'px';
    this.tooltip.style.top = Math.max(4, y) + 'px';
  }

  // -------------------------------------------------------------------------
  _onMouse(e) {
    const slotEl = e.target.closest('.slot');
    if (!slotEl) {
      if (e.target === this.root) this.close();
      return;
    }
    const right = e.button === 2;
    const shift = e.shiftKey;

    // Creative palette entries are identified by key, not by array index.
    if (slotEl.dataset.paletteKey) {
      e.preventDefault();
      this._takeFromPalette({ paletteKey: slotEl.dataset.paletteKey }, shift, right);
      this.player?.inventory?.changed?.();
      this.refresh();
      this.game.audio.play('click', { volume: 0.35, throttle: 0.03 });
      return;
    }
    if (!slotEl.dataset.slot) return;
    e.preventDefault();
    const rec = this.slots[Number(slotEl.dataset.slot)];
    if (!rec) return;

    // Touching any slot by hand means the player is arranging the grid
    // themselves; the book's ghost stops applying.
    this.clearGhost();

    // Holding a stack and pressing on a slot begins a spread-drag — but only
    // where the stack could actually go. Dropping onto a slot holding
    // something else is a swap: the new item goes down and the old one comes
    // up onto the cursor, which is what the drag path was swallowing.
    const target = rec.get();
    const swappable = target && !canMerge(target, this.cursor);
    if (this.cursor && !shift && !swappable && !rec.output && !rec.furnaceOut) {
      this.drag = {
        right, stack: this.cursor, targets: [],
        original: this.cursor.count, before: new Map(),
      };
      this._dragAdd(rec);
      this.refresh();
      return;
    }

    if (rec.output) this._takeOutput(rec, shift);
    else if (shift) this._quickMove(rec);
    else if (right) this._rightClick(rec);
    else this._leftClick(rec);

    this.game.player.inventory.changed();
    this.refresh();
    this._showTooltip(rec);
    this.game.audio.play('click', { volume: 0.35, throttle: 0.03 });
  }

  // -------------------------------------------------------------------------
  // Drag to spread a stack across slots
  // -------------------------------------------------------------------------

  /** Add the slot under `el` to the current drag, if it's a new valid target. */
  _dragOver(el) {
    const slotEl = el && el.closest ? el.closest('.slot') : null;
    if (!slotEl || slotEl.dataset.slot === undefined) return;
    const rec = this.slots[Number(slotEl.dataset.slot)];
    if (!rec) return;
    if (this._dragAdd(rec)) this.refresh();
  }

  _dragAdd(rec) {
    const d = this.drag;
    if (!d || d.targets.includes(rec)) return false;
    if (rec.output || rec.furnaceOut) return false;
    if (!this._canPlace(rec, d.stack)) return false;
    const s = rec.get();
    if (s && !canMerge(s, d.stack)) return false;
    if (s && s.count >= stackLimit(s.key)) return false;
    d.targets.push(rec);
    this._applyDrag();
    return true;
  }

  /**
   * Re-deal the whole stack from scratch each time a slot joins the drag, so
   * the split stays even as the pointer sweeps across more slots.
   */
  _applyDrag() {
    const d = this.drag;
    if (!d) return;
    // Snapshot each target the first time it joins, then always deal from
    // those snapshots — otherwise the second pass would stack on the first.
    for (const rec of d.targets) {
      if (!d.before.has(rec)) {
        const s = rec.get();
        d.before.set(rec, s ? { ...s } : null);
      }
      const b = d.before.get(rec);
      rec.set(b ? { ...b } : null);
    }

    const n = d.targets.length;
    const perSlot = d.right ? 1 : Math.max(1, Math.floor(d.original / n));
    let left = d.original;
    for (const rec of d.targets) {
      if (left <= 0) break;
      const existing = rec.get();
      const limit = stackLimit(d.stack.key);
      const room = limit - (existing ? existing.count : 0);
      const give = Math.min(perSlot, left, room);
      if (give <= 0) continue;
      if (existing) existing.count += give;
      else {
        rec.set({
          key: d.stack.key, count: give,
          ...(d.stack.dur !== undefined ? { dur: d.stack.dur } : {}),
        });
      }
      left -= give;
    }
    d.stack.count = left;
    this.cursor = left > 0 ? d.stack : null;
  }

  _endDrag() {
    this.drag = null;
    this.game.player.inventory.changed();
    this.refresh();
  }

  _canPlace(rec, stack) {
    if (!stack) return true;
    if (rec.armorSlot) {
      const a = getItem(stack.key)?.armor;
      return !!a && a.slot === rec.armorSlot;
    }
    if (rec.furnaceOut) return false;
    return true;
  }

  _leftClick(rec) {
    const cur = this.cursor;
    const s = rec.get();
    if (!cur) {
      if (!s) return;
      this.cursor = s;
      rec.set(null);
      return;
    }
    if (!this._canPlace(rec, cur)) return;
    if (!s) { rec.set(cur); this.cursor = null; return; }
    if (canMerge(s, cur)) {
      const limit = stackLimit(s.key);
      const take = Math.min(limit - s.count, cur.count);
      s.count += take; cur.count -= take;
      if (cur.count <= 0) this.cursor = null;
      return;
    }
    rec.set(cur);
    this.cursor = s;
  }

  _rightClick(rec) {
    const cur = this.cursor;
    const s = rec.get();
    if (!cur) {
      if (!s) return;
      const half = Math.ceil(s.count / 2);
      const rest = s.count - half;
      this.cursor = { key: s.key, count: half, ...(s.dur !== undefined ? { dur: s.dur } : {}) };
      if (rest > 0) s.count = rest; else rec.set(null);
      return;
    }
    if (!this._canPlace(rec, cur)) return;
    if (!s) {
      rec.set({ key: cur.key, count: 1, ...(cur.dur !== undefined ? { dur: cur.dur } : {}) });
      cur.count--;
      if (cur.count <= 0) this.cursor = null;
      return;
    }
    if (canMerge(s, cur) && s.count < stackLimit(s.key)) {
      s.count++; cur.count--;
      if (cur.count <= 0) this.cursor = null;
    }
  }

  _quickMove(rec) {
    const inv = this.game.player.inventory;
    const s = rec.get();
    if (!s) return;
    const targets = [];
    if (rec.container) {
      for (let i = 0; i < 36; i++) targets.push({ get: () => inv.slots[i], set: (v) => { inv.slots[i] = v; } });
    } else if (this.type === 'chest' && !rec.container) {
      const items = this.data.items;
      for (let i = 0; i < 27; i++) targets.push({ get: () => items[i], set: (v) => { items[i] = v; } });
    } else if (this.type === 'furnace' && !rec.container) {
      const f = this.data.furnace;
      targets.push({ get: () => f.input, set: (v) => { f.input = v; } });
      targets.push({ get: () => f.fuel, set: (v) => { f.fuel = v; } });
    } else {
      // inside the player inventory: hop between hotbar and storage
      const idx = inv.slots.indexOf(s);
      if (idx >= 0) { inv.quickMove(idx); return; }
      for (let i = 0; i < 36; i++) targets.push({ get: () => inv.slots[i], set: (v) => { inv.slots[i] = v; } });
    }
    let moved = s;
    const limit = stackLimit(s.key);
    for (const t of targets) {
      if (moved.count <= 0) break;
      const d = t.get();
      if (d && canMerge(d, moved)) {
        const take = Math.min(limit - d.count, moved.count);
        d.count += take; moved.count -= take;
      }
    }
    if (moved.count > 0) {
      for (const t of targets) {
        if (!t.get()) { t.set(moved); rec.set(null); return; }
      }
    }
    if (moved.count <= 0) rec.set(null);
  }

  /**
   * Creative palette click. Holding something already? Dropping it on the
   * palette deletes it, matching Minecraft. Otherwise mint one (or a stack).
   */
  _takeFromPalette(rec, shift, right) {
    if (this.cursor) { this.cursor = null; this.game.audio.play('pop', { volume: 0.4 }); return; }
    const key = rec.paletteKey;
    const max = stackLimit(key);
    const n = shift ? max : (right ? Math.max(1, Math.ceil(max / 2)) : 1);
    this.cursor = makeStack(key, Math.min(max, n));
  }

  _takeOutput(rec, shift) {
    if (this.type === 'furnace') {
      const f = this.data.furnace;
      if (!f.output) return;
      if (this.cursor && !canMerge(this.cursor, f.output)) return;
      if (this.cursor) this.cursor.count += f.output.count;
      else this.cursor = f.output;
      f.output = null;
      if (f.xp > 0) {
        this.game.player.addXp(Math.max(1, Math.round(f.xp)));
        this.game.audio.play('xp', { volume: 0.6 });
        f.xp = 0;
      }
      return;
    }
    if (!this._recipe) return;
    const inv = this.game.player.inventory;
    const times = shift ? this._maxCrafts() : 1;
    for (let n = 0; n < times; n++) {
      const r = matchRecipe(this._grid, this._gridSize);
      if (!r) break;
      const out = makeStack(r.out.key, r.out.count);
      if (shift) {
        if (inv.capacityFor(out.key) < out.count) break;
        inv.addStack(out);
      } else if (this.cursor) {
        if (!canMerge(this.cursor, out) ||
            this.cursor.count + out.count > stackLimit(out.key)) break;
        this.cursor.count += out.count;
      } else this.cursor = out;
      consumeGrid(this._grid, this._gridSize);
      this.game.onCrafted?.(r);
    }
    this.game.audio.play('craft', { volume: 0.6 });
  }

  _maxCrafts() {
    let min = 64;
    for (const s of this._grid) if (s) min = Math.min(min, s.count);
    return Math.max(1, min);
  }

  _doTrade(tr) {
    const inv = this.game.player.inventory;
    if (inv.count(tr.give.key) < tr.give.count) {
      this.game.audio.play('click', { rate: 0.6 });
      this.game.toast('Trade', 'You need ' + tr.give.count + ' ' + (getItem(tr.give.key)?.name || tr.give.key));
      return;
    }
    if(!inv.transact({[tr.give.key]:tr.give.count},[tr.get])){
      this.game.toast('Inventory full','Make room before trading.');return;
    }
    this.game.audio.play('villager', { volume: 0.7 });
    this.refresh();
  }
}

export { newFurnace, B };
