// ============================================================================
// The advancements screen â€” Minecraft's achievement tree.
//
// Advancements were being awarded and then only ever surfaced as a toast, so
// they had nowhere to live. This lays them out as a branching tree with elbow
// connectors: earned tiles are lit, the ones you could earn next are outlined,
// and everything further out is dimmed. That turns the list into a map of the
// route to the dragon.
//
// The layout is a plain tidy-tree pass: x comes from depth, y from walking the
// leaves in order and centring each parent over its children. No library, and
// it re-flows automatically if the tree in constants.js changes.
// ============================================================================

import { ADVANCEMENTS, ADVANCEMENT_TREE } from '../constants.js';
import { iconFor } from '../engine/itemicons.js';

// The route to the dragon is a long chain with one fork, so the tree runs top
// to bottom and branches sideways: laid out the other way the tiles were a
// pixel-thin strip running off the right of the screen.
const TILE_W = 98;   // --ui units
const TILE_H = 20;
const COL = 106;      // horizontal spacing between siblings
const ROW = 30;      // vertical spacing between depths

function layout() {
  const meta = new Map();
  for (const [key, name, desc] of ADVANCEMENTS) {
    const t = ADVANCEMENT_TREE[key] || { parent: null, icon: 'stone' };
    meta.set(key, { key, name, desc, parent: t.parent, icon: t.icon, children: [] });
  }
  const roots = [];
  for (const n of meta.values()) {
    const p = n.parent ? meta.get(n.parent) : null;
    if (p) p.children.push(n); else roots.push(n);
  }

  let nextRow = 0;
  const place = (n, depth) => {
    n.depth = depth;
    if (!n.children.length) { n.row = nextRow++; return; }
    for (const c of n.children) place(c, depth + 1);
    // centre the parent on the span of its children
    n.row = (n.children[0].row + n.children[n.children.length - 1].row) / 2;
  };
  for (const r of roots) place(r, 0);
  return { nodes: [...meta.values()], roots };
}

export class AdvancementScreen {
  constructor(game) {
    this.game = game;
    this.root = document.getElementById('screen-advancements');
    this.body = document.getElementById('adv-body');
    this.summary = document.getElementById('adv-summary');
    this.open = false;
    document.getElementById('btn-adv-close')
      .addEventListener('mousedown', () => this.hide());
  }

  toggle() { if (this.open) this.hide(); else this.show(); }

  show() {
    this.open = true;
    this.root.classList.remove('hidden');
    this.render();
    this.game.audio.play('click', { volume: 0.5 });
  }

  hide() {
    if (!this.open) return;
    this.open = false;
    this.root.classList.add('hidden');
    this.game.audio.play('click', { volume: 0.4 });
    this.game.onAdvancementsClosed?.();
  }

  render() {
    const won = this.game.advancements || {};
    const { nodes } = layout();
    this.body.innerHTML = '';

    const maxRow = Math.max(...nodes.map((n) => n.row));
    const maxDepth = Math.max(...nodes.map((n) => n.depth));
    const canvas = document.createElement('div');
    canvas.className = 'adv-canvas';
    canvas.style.width = `calc(var(--ui) * ${maxRow * COL + TILE_W + 8})`;
    canvas.style.height = `calc(var(--ui) * ${maxDepth * ROW + TILE_H + 8})`;

    // Siblings spread across x, depth runs down y.
    const x = (n) => n.row * COL;
    const y = (n) => n.depth * ROW;

    // Connectors first so tiles sit on top of them.
    const seg = (l, t, w, h) => {
      const d = document.createElement('div');
      d.className = 'adv-link';
      d.style.left = `calc(var(--ui) * ${l})`;
      d.style.top = `calc(var(--ui) * ${t})`;
      d.style.width = `calc(var(--ui) * ${w})`;
      d.style.height = `calc(var(--ui) * ${h})`;
      canvas.appendChild(d);
    };
    for (const n of nodes) {
      if (!n.parent) continue;
      const p = nodes.find((m) => m.key === n.parent);
      const x0 = x(p) + TILE_W / 2, x1 = x(n) + TILE_W / 2;
      const y0 = y(p) + TILE_H, y1 = y(n);
      const mid = y0 + (y1 - y0) / 2;
      seg(x0, y0, 2, mid - y0);                                   // down from parent
      seg(Math.min(x0, x1), mid, Math.abs(x1 - x0) || 2, 2);      // across
      seg(x1, mid, 2, y1 - mid);                                  // down into child
    }

    for (const n of nodes) {
      const done = !!won[n.key];
      // "Next up" is anything unearned whose parent is done (or a root).
      const reachable = !done && (!n.parent || !!won[n.parent]);
      const el = document.createElement('div');
      el.className = 'adv-node' + (done ? ' done' : reachable ? ' next' : ' locked');
      el.style.left = `calc(var(--ui) * ${x(n)})`;
      el.style.top = `calc(var(--ui) * ${y(n)})`;
      el.innerHTML =
        `<div class="adv-icon" style="background-image:url(${iconFor(n.icon)})"></div>` +
        `<div class="adv-text"><div class="adv-name">${n.name}</div>` +
        `<div class="adv-desc">${n.desc}</div></div>`;
      canvas.appendChild(el);
    }

    this.body.appendChild(canvas);
    const done = nodes.filter((n) => won[n.key]).length;
    this.summary.textContent = `${done} of ${nodes.length} unlocked`;
  }
}

export { layout as advancementLayout };

