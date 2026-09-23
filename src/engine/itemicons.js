// ============================================================================
// Item icons. Block items are rendered as little isometric cubes built from the
// same tiles the world uses; everything else is hand-drawn 16x16 pixel art.
// Output is a Map of itemKey -> data URL, consumed by the DOM-based UI.
// ============================================================================

import { P, TILE, paintTile } from './tiles.js';
import { ITEMS } from '../crafting/items.js';
import { BLOCKS } from '../world/blocks.js';

const ICON = 32;
const tileCache = new Map();

function tilePixels(name) {
  if (!tileCache.has(name)) tileCache.set(name, paintTile(name).frames[0]);
  return tileCache.get(name);
}

function surfaceToCanvas(p, shade = 1) {
  const c = document.createElement('canvas');
  c.width = p.n; c.height = p.n;
  const ctx = c.getContext('2d');
  const data = new Uint8ClampedArray(p.d);
  if (shade !== 1) {
    for (let i = 0; i < data.length; i += 4) {
      data[i] *= shade; data[i + 1] *= shade; data[i + 2] *= shade;
    }
  }
  ctx.putImageData(new ImageData(data, p.n, p.n), 0, 0);
  return c;
}

/** Draw a 16x16 tile onto a parallelogram (origin + two edge vectors). */
function drawFace(ctx, img, ox, oy, ux, uy, vx, vy) {
  ctx.save();
  ctx.setTransform(ux / TILE, uy / TILE, vx / TILE, vy / TILE, ox, oy);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0);
  ctx.restore();
}

function isoBlockIcon(blockId) {
  const b = BLOCKS[blockId];
  const cv = document.createElement('canvas');
  cv.width = ICON; cv.height = ICON;
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  const kind = b.render;
  if (kind === 'cross' || kind === 'torch' || kind === 'none') {
    const flat = surfaceToCanvas(tilePixels(b.tex[4]));
    ctx.drawImage(flat, 0, 0, TILE, TILE, 0, 0, ICON, ICON);
    return cv.toDataURL();
  }

  const top = surfaceToCanvas(tilePixels(b.tex[2]), 1.0);
  const left = surfaceToCanvas(tilePixels(b.tex[5]), 0.78);
  const right = surfaceToCanvas(tilePixels(b.tex[0]), 0.6);

  // 32x32 isometric cube: top rhombus + two side parallelograms.
  drawFace(ctx, top, 0, 8, 16, -8, 16, 8);
  drawFace(ctx, left, 0, 8, 16, 8, 0, 16);
  drawFace(ctx, right, 16, 16, 16, -8, 0, 16);
  return cv.toDataURL();
}

// ---------------------------------------------------------------------------
// Hand-drawn item painters (16x16, transparent background)
// ---------------------------------------------------------------------------

const WOOD = [0x6b5230, 0x8a6a3c, 0x4f3b1f];

function line(p, x0, y0, x1, y1, c) {
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy, x = x0, y = y0;
  for (let guard = 0; guard < 64; guard++) {
    p.set(x, y, c);
    if (x === x1 && y === y1) break;
    const e2 = err * 2;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx) { err += dx; y += sy; }
  }
}

function blob(p, cx, cy, r, c, hi) {
  for (let y = -Math.ceil(r); y <= Math.ceil(r); y++) {
    for (let x = -Math.ceil(r); x <= Math.ceil(r); x++) {
      if (Math.hypot(x, y) <= r) p.set(cx + x, cy + y, c);
    }
  }
  if (hi !== undefined) { p.set(cx - 1, cy - 1, hi); p.set(cx, cy - 1, hi); }
}

/** Loose pile of dust/powder grains. */
function dust(main, dark, hi) {
  return (p) => {
    const pts = [[5, 10], [6, 9], [7, 10], [8, 9], [9, 10], [10, 9], [6, 11], [7, 12], [8, 11], [9, 12],
      [5, 8], [10, 11], [7, 8], [9, 8], [8, 7], [11, 10], [4, 11], [6, 6], [10, 7]];
    for (const [x, y] of pts) p.set(x, y, main);
    for (const [x, y] of [[6, 12], [9, 13], [4, 12], [11, 11]]) p.set(x, y, dark);
    for (const [x, y] of [[7, 9], [9, 9], [8, 8]]) p.set(x, y, hi);
  };
}

function gem(main, dark, hi) {
  return (p) => {
    const rows = [[6, 4], [5, 6], [4, 8], [4, 8], [5, 6], [6, 4], [7, 2]];
    rows.forEach((r, i) => {
      const y = 4 + i;
      for (let x = r[0]; x < r[0] + r[1]; x++) p.set(x, y, main);
    });
    for (let i = 0; i < 6; i++) p.set(4 + i, 6 + i > 10 ? 10 : 6 + i, dark);
    p.set(7, 5, hi); p.set(8, 5, hi); p.set(6, 6, hi);
    for (let x = 4; x < 12; x++) p.set(x, 11, dark);
  };
}

function ingot(main, dark, hi) {
  return (p) => {
    for (let y = 6; y < 11; y++) {
      const inset = y < 7 ? 3 : y > 9 ? 2 : 2;
      for (let x = 2 + inset; x < 14 - inset; x++) p.set(x, y, main);
    }
    for (let x = 4; x < 12; x++) { p.set(x, 10, dark); }
    for (let x = 6; x < 11; x++) p.set(x, 6, hi);
    p.set(5, 7, hi); p.set(11, 9, dark);
  };
}

function meat(main, dark, bone) {
  return (p) => {
    blob(p, 8, 8, 4.2, main);
    for (let k = 0; k < 8; k++) p.set(5 + (k % 4) * 2, 6 + ((k / 4) | 0) * 4, dark);
    if (bone !== undefined) { p.set(12, 12, bone); p.set(13, 13, bone); p.set(12, 13, bone); }
  };
}

function toolIcon(matColors, kind) {
  const [mMain, mDark, mHi] = matColors;
  return (p) => {
    // shared wooden handle running lower-left to upper-right
    if (kind !== 'sword') {
      for (let i = 0; i < 8; i++) {
        p.set(9 - i, 5 + i, WOOD[1]);
        p.set(10 - i, 5 + i, WOOD[0]);
        p.set(9 - i, 6 + i, WOOD[2]);
      }
    }
    if (kind === 'pickaxe') {
      const arc = [[5, 5], [6, 4], [7, 3], [8, 3], [9, 3], [10, 3], [11, 3], [12, 4], [13, 5]];
      for (const [x, y] of arc) { p.set(x, y, mMain); p.set(x, y + 1, mDark); }
      for (const [x, y] of [[7, 2], [8, 2], [9, 2], [10, 2], [11, 2]]) p.set(x, y, mHi);
      p.set(5, 6, mDark); p.set(13, 6, mDark);
    } else if (kind === 'axe') {
      // A proper axe head: a narrow neck against the haft that flares into a
      // straight cutting edge on the outside. Rows are given as [y, x0, x1] so
      // the silhouette is a readable wedge rather than a circular blob.
      const rows = [
        [2, 10, 12], [3, 9, 13], [4, 8, 13], [5, 8, 13], [6, 9, 13], [7, 10, 12],
      ];
      for (const [y, x0, x1] of rows) {
        for (let x = x0; x <= x1; x++) p.set(x, y, mMain);
      }
      // bevelled cutting edge down the outer side, shadow along the bottom
      for (const [y, , x1] of rows) p.set(x1, y, mHi);
      for (const [y, x0] of rows) p.set(x0, y, mDark);
      p.set(11, 7, mDark); p.set(12, 7, mDark);
      p.set(11, 2, mHi);
    } else if (kind === 'shovel') {
      for (let y = 2; y < 7; y++) for (let x = 8; x < 13; x++) {
        if (y === 6 && (x === 8 || x === 12)) continue;
        p.set(x, y, y < 4 ? mMain : mDark);
      }
      for (let x = 9; x < 12; x++) p.set(x, 2, mHi);
    } else if (kind === 'hoe') {
      for (let x = 8; x < 14; x++) p.set(x, 3, mMain);
      for (let x = 8; x < 14; x++) p.set(x, 4, mDark);
      for (let y = 4; y < 7; y++) p.set(8, y, mMain);
      p.set(9, 2, mHi); p.set(12, 2, mHi);
    } else if (kind === 'sword') {
      for (let i = 0; i < 9; i++) {
        p.set(4 + i, 11 - i, mMain);
        p.set(5 + i, 11 - i, mHi);
        p.set(4 + i, 12 - i, mDark);
      }
      p.set(13, 2, mHi); p.set(12, 2, mMain);
      for (const [x, y] of [[2, 11], [3, 10], [4, 11], [3, 12], [2, 12], [4, 12]]) p.set(x, y, mDark);
      p.set(1, 13, WOOD[0]); p.set(2, 13, WOOD[1]); p.set(1, 14, WOOD[2]); p.set(0, 14, WOOD[2]);
    }
  };
}

const ARMOR_COLORS = {
  leather: [0xa06540, 0x6d4227, 0xc48a60],
  iron: [0xd8d8d8, 0x9a9a9a, 0xf4f4f4],
  diamond: [0x4ee0d0, 0x2aa79a, 0xb8fff5],
};

function armorIcon(mat, piece) {
  const [c, d, h] = ARMOR_COLORS[mat];
  return (p) => {
    if (piece === 'helmet') {
      for (let y = 3; y < 9; y++) for (let x = 4; x < 12; x++) {
        if (y === 3 && (x < 5 || x > 10)) continue;
        p.set(x, y, y < 5 ? c : d);
      }
      for (let x = 6; x < 10; x++) p.set(x, 7, 0x2a2a2a);
      for (let x = 5; x < 11; x++) p.set(x, 4, h);
      for (let y = 9; y < 11; y++) { p.set(4, y, d); p.set(11, y, d); }
    } else if (piece === 'chestplate') {
      for (let y = 3; y < 12; y++) for (let x = 3; x < 13; x++) {
        if (y < 5 && (x > 5 && x < 10)) continue;
        if (y > 9 && (x < 5 || x > 10)) continue;
        p.set(x, y, c);
      }
      for (let y = 5; y < 12; y++) { p.set(3, y, d); p.set(12, y, d); }
      for (let x = 6; x < 10; x++) p.set(x, 5, h);
      p.set(7, 7, d); p.set(8, 7, d);
    } else if (piece === 'leggings') {
      for (let y = 3; y < 7; y++) for (let x = 4; x < 12; x++) p.set(x, y, c);
      for (let y = 7; y < 13; y++) {
        for (let x = 4; x < 7; x++) p.set(x, y, d);
        for (let x = 9; x < 12; x++) p.set(x, y, d);
      }
      for (let x = 4; x < 12; x++) p.set(x, 3, h);
    } else {
      for (let y = 7; y < 12; y++) {
        for (let x = 2; x < 7; x++) p.set(x, y, y > 9 ? d : c);
        for (let x = 9; x < 14; x++) p.set(x, y, y > 9 ? d : c);
      }
      for (let x = 2; x < 7; x++) p.set(x, 7, h);
      for (let x = 9; x < 14; x++) p.set(x, 7, h);
    }
  };
}

const ITEM_PAINTERS = {
  stick: (p) => { for (let i = 0; i < 9; i++) { p.set(4 + i, 12 - i, WOOD[1]); p.set(5 + i, 12 - i, WOOD[0]); p.set(4 + i, 13 - i, WOOD[2]); } },
  coal: dust(0x1c1c1c, 0x0a0a0a, 0x3c3c3c),
  charcoal: dust(0x2e2418, 0x140f08, 0x4a3a26),
  gunpowder: dust(0x6e6e6e, 0x3a3a3a, 0x9a9a9a),
  redstone: dust(0xd21f1f, 0x8c1010, 0xff6a6a),
  glowstone_dust: dust(0xf7d878, 0xc79e17, 0xfff3c0),
  blaze_powder: dust(0xffb020, 0xd06a00, 0xffe680),
  lapis_lazuli: (p) => { blob(p, 8, 8, 4, 0x2c53c6, 0x6f92f0); for (const [x, y] of [[5, 10], [11, 7], [8, 12]]) p.set(x, y, 0x17307e); },
  quartz: (p) => { blob(p, 8, 8, 4, 0xece5dc, 0xffffff); for (const [x, y] of [[5, 10], [11, 10], [8, 12]]) p.set(x, y, 0xbdb3a8); },
  diamond: gem(0x5decdb, 0x2aa79a, 0xd7fffa),
  emerald: gem(0x3fd94f, 0x1d8a2b, 0xc4ffcb),
  iron_ingot: ingot(0xd8d8d8, 0x9a9a9a, 0xf4f4f4),
  gold_ingot: ingot(0xfcdb4a, 0xc79e17, 0xfff2a0),
  raw_iron: (p) => { blob(p, 8, 8, 4.2, 0xd8a878, 0xf0cfa8); for (const [x, y] of [[6, 10], [10, 9], [8, 11]]) p.set(x, y, 0xa87a4e); },
  raw_gold: (p) => { blob(p, 8, 8, 4.2, 0xfcdb4a, 0xfff2a0); for (const [x, y] of [[6, 10], [10, 9], [8, 11]]) p.set(x, y, 0xc79e17); },
  gold_nugget: (p) => { blob(p, 8, 9, 2.4, 0xfcdb4a, 0xfff2a0); p.set(9, 10, 0xc79e17); },
  string: (p) => { for (let i = 0; i < 12; i++) { p.set(3 + ((i * 7) % 10), 2 + i, 0xe8e8e8); p.set(4 + ((i * 7) % 10), 2 + i, 0xb8b8b8); } },
  feather: (p) => {
    for (let i = 0; i < 10; i++) p.set(5 + i * 0.6 | 0, 13 - i, 0xd8d8d8);
    for (let i = 0; i < 7; i++) { p.set(4 + (i * 0.6 | 0), 11 - i, 0xf4f4f4); p.set(7 + (i * 0.6 | 0), 11 - i, 0xf4f4f4); }
    p.set(4, 13, 0xa0a0a0); p.set(5, 14, 0xa0a0a0);
  },
  leather: (p) => { for (let y = 4; y < 12; y++) for (let x = 3; x < 13; x++) p.set(x, y, (x + y) % 5 === 0 ? 0x6d4227 : 0xa06540); p.frame(3, 4, 10, 8, 0x5a3520); },
  bone: (p) => {
    for (let i = 0; i < 8; i++) { p.set(4 + i, 11 - i, 0xe8e4d8); p.set(5 + i, 11 - i, 0xc8c4b4); }
    for (const [x, y] of [[3, 11], [3, 12], [4, 12], [2, 12], [11, 3], [12, 3], [12, 4], [13, 3]]) p.set(x, y, 0xf4f0e4);
  },
  flint: (p) => { for (const [x, y] of [[5, 6], [6, 5], [7, 5], [8, 5], [9, 6], [10, 7], [10, 8], [9, 9], [8, 10], [7, 10], [6, 10], [5, 9], [4, 8], [4, 7]]) p.set(x, y, 0x3a3a42); blob(p, 7, 7, 2.2, 0x4e4e58, 0x6a6a76); },
  clay_ball: (p) => blob(p, 8, 9, 3.6, 0x9aa0ab, 0xc3c9d4),
  brick: (p) => { for (let y = 6; y < 11; y++) for (let x = 3; x < 13; x++) p.set(x, y, 0x9a5b48); p.frame(3, 6, 10, 5, 0x7a4030); },
  paper: (p) => { for (let y = 3; y < 13; y++) for (let x = 3; x < 13; x++) p.set(x, y, 0xf4f4f0); p.frame(3, 3, 10, 10, 0xc8c8c0); for (const y of [6, 8, 10]) for (let x = 5; x < 11; x++) p.set(x, y, 0xd0d0c8); },
  book: (p) => { for (let y = 2; y < 14; y++) for (let x = 4; x < 12; x++) p.set(x, y, 0x8a3a2a); for (let y = 3; y < 13; y++) for (let x = 5; x < 11; x++) p.set(x, y, 0xf0ecd8); for (let y = 2; y < 14; y++) { p.set(4, y, 0x5a2418); p.set(11, y, 0x5a2418); } },
  wheat: (p) => { for (let i = 0; i < 10; i++) p.set(8, 5 + i, 0x8a9a3a); for (let i = 0; i < 5; i++) { p.set(6, 3 + i * 2, 0xd8c060); p.set(10, 4 + i * 2, 0xd8c060); p.set(7, 3 + i * 2, 0xc0a840); p.set(9, 4 + i * 2, 0xc0a840); } },
  wheat_seeds: (p) => { for (const [x, y] of [[5, 8], [7, 7], [9, 9], [6, 11], [10, 7], [8, 11], [11, 10]]) { p.set(x, y, 0x7a9a3a); p.set(x + 1, y, 0x5a7a24); } },
  snowball: (p) => blob(p, 8, 9, 4, 0xf0f6ff, 0xffffff),
  oak_sapling: (p) => { for (let y = 9; y < 15; y++) p.set(8, y, 0x6b5230); for (const [x, y] of [[6, 5], [7, 4], [8, 4], [9, 4], [10, 5], [5, 6], [6, 6], [7, 6], [8, 6], [9, 6], [10, 6], [11, 6], [6, 7], [7, 7], [8, 7], [9, 7], [10, 7], [7, 8], [8, 8], [9, 8]]) p.set(x, y, (x + y) % 3 ? 0x336d25 : 0x448a30); },
  melon_slice: (p) => { for (let y = 4; y < 13; y++) for (let x = 3; x < 13; x++) { const d = Math.hypot(x - 8, y - 12); if (d < 8.5) p.set(x, y, d > 7.4 ? 0x2f7a2a : d > 6.6 ? 0x6aa83a : 0xe0464a); } for (const [x, y] of [[6, 8], [9, 9], [7, 10]]) p.set(x, y, 0x2a2a2a); },
  rotten_flesh: (p) => { blob(p, 8, 8, 4.4, 0x8a6a4a); for (const [x, y] of [[5, 6], [10, 7], [7, 10], [11, 9], [4, 9]]) p.set(x, y, 0x5a4028); for (const [x, y] of [[7, 6], [9, 8]]) p.set(x, y, 0xa88a68); },
  spider_eye: (p) => { blob(p, 8, 8, 4, 0x8a2020); blob(p, 8, 8, 2, 0x2a1010); p.set(7, 7, 0xd06060); },
  slimeball: (p) => { blob(p, 8, 9, 4.2, 0x7ec46a); p.set(6, 7, 0xb0e8a0); p.set(7, 7, 0xb0e8a0); },
  egg: (p) => { for (let y = 3; y < 13; y++) for (let x = 4; x < 12; x++) { const d = Math.hypot((x - 7.5) / 3.6, (y - 8.5) / 5); if (d < 1) p.set(x, y, 0xe8e0d0); } p.set(6, 5, 0xffffff); for (const [x, y] of [[9, 7], [6, 10], [10, 10]]) p.set(x, y, 0xc8bca8); },
  ghast_tear: (p) => { for (let y = 3; y < 13; y++) for (let x = 5; x < 11; x++) { const d = Math.hypot((x - 7.5) / 2.8, (y - 9) / 4); if (d < 1) p.set(x, y, 0xd8e8e0); } p.set(7, 4, 0xf4fffc); p.set(6, 8, 0xffffff); },
  magma_cream: (p) => { blob(p, 8, 9, 4.2, 0x6a4a2a); blob(p, 8, 9, 2.4, 0xff8c1a); p.set(7, 8, 0xffd060); },
  arrow: (p) => {
    for (let i = 0; i < 8; i++) p.set(4 + i, 11 - i, 0x8a6a3c);
    for (const [x, y] of [[12, 2], [13, 2], [12, 3], [11, 3], [13, 3], [11, 2]]) p.set(x, y, 0xc8c8c8);
    for (const [x, y] of [[3, 12], [2, 12], [3, 13], [4, 12], [2, 13], [4, 13]]) p.set(x, y, 0xf0f0f0);
  },
  blaze_rod: (p) => {
    for (let i = 0; i < 11; i++) { p.set(4 + i, 12 - i, 0xffb020); p.set(5 + i, 12 - i, 0xffd060); p.set(4 + i, 13 - i, 0xd06a00); }
    for (const [x, y] of [[3, 13], [13, 3]]) { p.set(x, y, 0xffe680); }
  },
  ender_pearl: (p) => {
    blob(p, 8, 8, 4.6, 0x0f2e2a);
    for (let y = 4; y < 13; y++) for (let x = 3; x < 13; x++) {
      const d = Math.hypot(x - 8, y - 8);
      if (d < 4.6 && ((x * 3 + y * 5) % 7 < 2)) p.set(x, y, 0x2aa88a);
    }
    p.set(6, 6, 0x7fe8c8); p.set(7, 6, 0x5ad0aa);
  },
  ender_eye: (p) => {
    blob(p, 8, 8, 4.6, 0x1a4a3a);
    blob(p, 8, 8, 3.0, 0x2fbf6a);
    blob(p, 8, 8, 1.4, 0x0c1a12);
    p.set(6, 6, 0xa8ffd0); p.set(10, 10, 0x145c34);
  },
  apple: (p) => { blob(p, 8, 9, 4.4, 0xd8302a); p.set(6, 7, 0xf07060); p.set(7, 7, 0xf07060); for (let y = 3; y < 6; y++) p.set(8, y, 0x6b5230); p.set(10, 4, 0x448a30); p.set(11, 4, 0x448a30); p.set(10, 3, 0x336d25); },
  bread: (p) => { for (let y = 5; y < 12; y++) for (let x = 3; x < 13; x++) { const d = Math.hypot((x - 8) / 5, (y - 8.5) / 3.4); if (d < 1) p.set(x, y, d > 0.7 ? 0x9a6a30 : 0xc89a54); } for (const [x, y] of [[6, 6], [9, 7], [7, 9]]) p.set(x, y, 0xe0be80); },
  raw_beef: meat(0xd05a5a, 0x9a3838, 0xe8d8c8),
  cooked_beef: meat(0x8a4a24, 0x5a2e14, 0xe8d8c8),
  raw_porkchop: meat(0xe89a9a, 0xc06a6a, 0xf4e8d8),
  cooked_porkchop: meat(0xc07a44, 0x8a4e28, 0xf4e8d8),
  raw_chicken: meat(0xe8b898, 0xc08a68, 0xf4f0e0),
  cooked_chicken: meat(0xc08a4a, 0x8a5a28, 0xf4f0e0),
  raw_mutton: meat(0xd88080, 0xa85454, 0xf0e0d0),
  cooked_mutton: meat(0xa06038, 0x6a3a1c, 0xf0e0d0),
  golden_apple: (p) => { blob(p, 8, 9, 4.4, 0xfcdb4a); p.set(6, 7, 0xfff2a0); p.set(7, 7, 0xfff2a0); for (let y = 3; y < 6; y++) p.set(8, y, 0x8a6a10); p.set(10, 4, 0x9ade60); p.set(11, 4, 0x9ade60); },
  flint_and_steel: (p) => {
    for (const [x, y] of [[4, 6], [5, 5], [6, 5], [7, 6], [7, 7], [6, 8], [5, 8], [4, 7]]) p.set(x, y, 0x3a3a42);
    blob(p, 5, 6, 1.2, 0x4e4e58);
    for (let i = 0; i < 6; i++) { p.set(8 + i, 8 + i, 0xd8d8d8); p.set(9 + i, 8 + i, 0x9a9a9a); }
    p.set(13, 13, 0x6d4227); p.set(12, 13, 0x6d4227);
  },
  bucket: (p) => {
    for (let y = 5; y < 13; y++) { const inset = y > 10 ? 1 : 0; for (let x = 4 + inset; x < 12 - inset; x++) p.set(x, y, x < 6 ? 0xf0f0f0 : 0xc8c8c8); }
    for (let x = 3; x < 13; x++) p.set(x, 4, 0xe8e8e8);
    p.set(3, 5, 0xa0a0a0); p.set(12, 5, 0xa0a0a0);
  },
  water_bucket: (p) => { ITEM_PAINTERS.bucket(p); for (let y = 6; y < 11; y++) for (let x = 5; x < 11; x++) p.set(x, y, 0x3a6fd8); p.set(6, 7, 0x6f9bee); },
  lava_bucket: (p) => { ITEM_PAINTERS.bucket(p); for (let y = 6; y < 11; y++) for (let x = 5; x < 11; x++) p.set(x, y, 0xd45a12); p.set(6, 7, 0xffc44a); },
  shears: (p) => {
    for (let i = 0; i < 6; i++) { p.set(4 + i, 4 + i, 0xd8d8d8); p.set(10 - i, 4 + i, 0xd8d8d8); }
    for (const [x, y] of [[3, 11], [4, 12], [3, 12], [11, 11], [11, 12], [12, 12]]) p.set(x, y, 0x606060);
    p.set(7, 8, 0x9a9a9a); p.set(8, 8, 0x9a9a9a);
  },
  bow: (p) => {
    for (const [x, y] of [[9, 2], [10, 3], [11, 4], [11, 5], [12, 6], [12, 7], [12, 8], [11, 9], [11, 10], [10, 11], [9, 12], [8, 13], [7, 13]]) { p.set(x, y, 0x6b5230); p.set(x - 1, y, 0x8a6a3c); }
    line(p, 9, 2, 7, 13, 0xe8e8e8);
    for (let i = 0; i < 7; i++) p.set(4 + i, 8 - (i * 0.4 | 0), 0xc8c8c8);
  },
  shield: (p) => {
    // Wooden face inside an iron rim, tapering to a point at the bottom.
    const rows = [
      [1, 3, 12], [2, 3, 12], [3, 3, 12], [4, 3, 12], [5, 3, 12], [6, 3, 12],
      [7, 3, 12], [8, 3, 12], [9, 4, 11], [10, 4, 11], [11, 5, 10], [12, 6, 9],
      [13, 7, 8],
    ];
    for (const [y, x0, x1] of rows) {
      for (let x = x0; x <= x1; x++) {
        const edge = x === x0 || x === x1 || y === 1 || y === 13;
        p.set(x, y, edge ? 0xb8bcc4 : (x + y) % 3 === 0 ? 0x8a6a3c : 0x9c7a48);
      }
    }
    // iron boss down the centre
    for (let y = 3; y <= 10; y++) p.set(7, y, 0xd6dae0);
    for (let y = 5; y <= 8; y++) { p.set(6, y, 0xc2c6cc); p.set(8, y, 0xc2c6cc); }
    p.set(7, 2, 0xe8ecf2);
  },
};

// --- dyes, fish and the rest of the new item set ---------------------------
const dyeIcon = (main, dark, hi) => (p) => {
  for (const [x, y] of [[6, 6], [7, 5], [8, 5], [9, 6], [10, 7], [5, 7],
    [6, 8], [7, 9], [8, 9], [9, 8], [10, 9], [5, 10], [7, 11], [9, 11], [8, 7]]) p.set(x, y, main);
  for (const [x, y] of [[6, 11], [10, 10], [4, 8]]) p.set(x, y, dark);
  for (const [x, y] of [[7, 6], [8, 6]]) p.set(x, y, hi);
};
const fishIcon = (body, belly, fin) => (p) => {
  for (let y = 5; y < 12; y++) {
    for (let x = 3; x < 12; x++) {
      const d = Math.hypot((x - 7.5) / 4.4, (y - 8) / 2.7);
      if (d < 1) p.set(x, y, y > 9 ? belly : body);
    }
  }
  for (const [x, y] of [[12, 6], [13, 5], [12, 8], [13, 10], [12, 9]]) p.set(x, y, fin);
  p.set(5, 7, 0x101010);
  for (const [x, y] of [[7, 5], [8, 5]]) p.set(x, y, fin);
};

Object.assign(ITEM_PAINTERS, {
  bone_meal: dust(0xe8e4d0, 0xb8b4a0, 0xffffff),
  ink_sac: (p) => { blob(p, 8, 8, 4, 0x18181c, 0x3a3a44); p.set(6, 6, 0x4a4a55); },
  honeycomb: (p) => {
    for (let y = 4; y < 13; y++) for (let x = 3; x < 13; x++) {
      if ((x + y) % 2 === 0) p.set(x, y, 0xf0b840); else p.set(x, y, 0xd8901c);
    }
    p.frame(3, 4, 10, 9, 0xa86a10);
  },
  sugar: dust(0xf4f4f4, 0xc8c8c8, 0xffffff),
  red_dye: dyeIcon(0xbe3a3a, 0x7f2020, 0xe86a6a),
  orange_dye: dyeIcon(0xe98d31, 0xa85a13, 0xffb96a),
  yellow_dye: dyeIcon(0xefdb46, 0xae9a1c, 0xfff08a),
  green_dye: dyeIcon(0x5da838, 0x36681c, 0x8ed46a),
  blue_dye: dyeIcon(0x3f58c6, 0x21327e, 0x7a8ff0),
  purple_dye: dyeIcon(0x9440c6, 0x5c1f80, 0xc07af0),
  black_dye: dyeIcon(0x2a2a30, 0x101014, 0x555560),
  white_dye: dyeIcon(0xf0f0f0, 0xc0c0c0, 0xffffff),
  raw_cod: fishIcon(0xb0a58c, 0xd8d0bc, 0x8a8068),
  cooked_cod: fishIcon(0xc79a56, 0xe0bc80, 0x9a7038),
  raw_salmon: fishIcon(0xc4604a, 0xe08a70, 0x9a4432),
  cooked_salmon: fishIcon(0xd2764a, 0xecA070 & 0xffffff, 0xa85a32),
  cookie: (p) => {
    blob(p, 8, 8, 4.4, 0xc08a4a, 0xd8a468);
    for (const [x, y] of [[6, 6], [9, 7], [7, 10], [10, 10], [5, 9]]) p.set(x, y, 0x4a2c12);
  },
  pumpkin_pie: (p) => {
    for (let y = 5; y < 13; y++) for (let x = 2; x < 14; x++) {
      const d = Math.hypot((x - 8) / 6, (y - 9) / 4);
      if (d < 1) p.set(x, y, y < 7 ? 0xe0a848 : 0xc07a2a);
    }
    for (const [x, y] of [[5, 6], [8, 5], [11, 6]]) p.set(x, y, 0xf4d08a);
    for (let x = 3; x < 13; x++) p.set(x, 12, 0x8a5a20);
  },
  fishing_rod: (p) => {
    for (let i = 0; i < 9; i++) { p.set(4 + i, 12 - i, 0x8a6a3c); p.set(5 + i, 12 - i, 0x6b5230); }
    for (let i = 0; i < 7; i++) p.set(13, 3 + i, 0xe8e8e8);
    p.set(13, 10, 0xc0c0c0); p.set(12, 11, 0xc0c0c0);
  },
});

for (const mat of ['wooden', 'stone', 'iron', 'diamond']) {
  const colors = {
    wooden: [0xa8834c, 0x6b5230, 0xc8a068],
    stone: [0x8b8b8b, 0x5a5a5a, 0xb4b4b4],
    iron: [0xd8d8d8, 0x9a9a9a, 0xf4f4f4],
    diamond: [0x4ee0d0, 0x2aa79a, 0xb8fff5],
  }[mat];
  for (const kind of ['pickaxe', 'axe', 'shovel', 'sword', 'hoe']) {
    ITEM_PAINTERS[`${mat}_${kind}`] = toolIcon(colors, kind);
  }
}
for (const mat of ['leather', 'iron', 'diamond']) {
  for (const piece of ['helmet', 'chestplate', 'leggings', 'boots']) {
    ITEM_PAINTERS[`${mat}_${piece}`] = armorIcon(mat, piece);
  }
}

// ---------------------------------------------------------------------------

let ICONS = null;
/** Raw 16x16 RGBA for every hand-drawn item, kept for 3D extrusion. */
const ICON_PIXELS = new Map();

/** Pixel data behind a non-block item icon, or null for block items. */
export function iconPixels(key) {
  if (!ICONS) buildItemIcons();
  return ICON_PIXELS.get(key) || null;
}

/** Build (once) every item icon as a data URL. */
function paintBottle(p,color) {
  for(let y=5;y<14;y++)for(let x=4;x<12;x++){
    if(y<7&&(x<6||x>9))continue;
    p.set(x,y,x===4||x===11||y===13?0xc7eff2:color);
  }
  for(let y=2;y<6;y++){p.set(6,y,0xb4d6df);p.set(9,y,0xb4d6df);}
  for(let x=6;x<10;x++)p.set(x,2,0xac8455);
  p.set(5,8,0xffffff);p.set(5,9,0xffffff);
}
ITEM_PAINTERS.glass_bottle=p=>paintBottle(p,0x587986);

export function buildItemIcons() {
  if (ICONS) return ICONS;
  ICONS = new Map();
  for (const [key, it] of ITEMS) {
    try {
      if (it.block !== null && it.block !== undefined) {
        ICONS.set(key, isoBlockIcon(it.block));
        continue;
      }
      const painter = ITEM_PAINTERS[it.icon] || ITEM_PAINTERS[key];
      const p = new P(0x9e3779b9 ^ key.length * 2654435761);
      p.clear();
      if (it.potion) paintBottle(p,it.potion.color);
      else if (painter) painter(p);
      else {
        blob(p, 8, 8, 4, 0xff00ff, 0xffffff);
        console.warn('[icons] missing painter for', key);
      }
      if(it.upgrade) for(let y=0;y<16;y++)for(let x=0;x<16;x++){
        const i=(y*16+x)*4;
        if(p.d[i+3] && (x+y)%6<2){p.d[i]=Math.min(255,p.d[i]+55);p.d[i+2]=Math.min(255,p.d[i+2]+85);}
      }
      ICON_PIXELS.set(key, new Uint8ClampedArray(p.d));
      const src = surfaceToCanvas(p);
      const cv = document.createElement('canvas');
      cv.width = ICON; cv.height = ICON;
      const ctx = cv.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(src, 0, 0, TILE, TILE, 0, 0, ICON, ICON);
      ICONS.set(key, cv.toDataURL());
    } catch (e) {
      console.warn('[icons] failed', key, e);
    }
  }
  return ICONS;
}

export function iconFor(key) {
  if (!ICONS) buildItemIcons();
  return ICONS.get(key) || '';
}

/**
 * Paper doll for the inventory screen: a blocky front-on player, overpainted
 * with whichever armour pieces are currently equipped.
 */
export function buildPlayerPreview(armor) {
  const W = 32, H = 48;
  const buf = new Uint8ClampedArray(W * H * 4);
  const set = (x, y, c, a = 255) => {
    if (x < 0 || x >= W || y < 0 || y >= H) return;
    const i = (y * W + x) * 4;
    buf[i] = (c >> 16) & 255; buf[i + 1] = (c >> 8) & 255; buf[i + 2] = c & 255; buf[i + 3] = a;
  };
  const box = (x, y, w, h, c, shade = 1) => {
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const n = 0.92 + ((i * 7 + j * 13) % 5) * 0.035;
        const r = Math.min(255, ((c >> 16) & 255) * shade * n);
        const g = Math.min(255, ((c >> 8) & 255) * shade * n);
        const b = Math.min(255, (c & 255) * shade * n);
        set(x + i, y + j, (r << 16) | (g << 8) | b);
      }
    }
  };

  const SKIN = 0xc39877, SHIRT = 0x2f6fb5, PANTS = 0x3a3a6a, HAIR = 0x5a3a20;
  // head, body, arms, legs
  box(10, 4, 12, 12, SKIN);
  box(10, 4, 12, 3, HAIR);
  set(13, 10, 0x2a4a8a); set(14, 10, 0x2a4a8a);
  set(17, 10, 0x2a4a8a); set(18, 10, 0x2a4a8a);
  for (let x = 13; x < 19; x++) set(x, 13, 0x7a4a30);
  box(11, 16, 10, 14, SHIRT);
  box(5, 16, 6, 14, SKIN, 0.9);
  box(21, 16, 6, 14, SKIN, 0.9);
  box(11, 30, 5, 14, PANTS);
  box(16, 30, 5, 14, PANTS, 0.92);

  const COLORS = {
    leather: [0xa06540, 0x6d4227], iron: [0xd8d8d8, 0x9a9a9a], diamond: [0x4ee0d0, 0x2aa79a],
  };
  for (const piece of armor || []) {
    if (!piece) continue;
    const a = ITEMS.get(piece.key)?.armor;
    if (!a) continue;
    const [c, d] = COLORS[a.material] || COLORS.iron;
    if (a.slot === 'helmet') { box(9, 3, 14, 8, c); box(11, 8, 10, 3, d); }
    else if (a.slot === 'chestplate') { box(10, 15, 12, 12, c); box(4, 16, 7, 10, d); box(21, 16, 7, 10, d); }
    else if (a.slot === 'leggings') { box(10, 27, 12, 8, c); }
    else if (a.slot === 'boots') { box(10, 38, 6, 7, d); box(16, 38, 6, 7, d); }
  }

  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  cv.getContext('2d').putImageData(new ImageData(buf, W, H), 0, 0);
  return cv.toDataURL();
}

/** Small standalone sprites used by the HUD (hearts, food, armour, bubbles). */
export function buildHudSprites() {
  const out = {};
  const make = (draw) => {
    const p = new P(1); p.clear(); draw(p);
    const src = surfaceToCanvas(p, 1);
    const cv = document.createElement('canvas');
    cv.width = 18; cv.height = 18;
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(src, 0, 0, 16, 16, 1, 1, 16, 16);
    return cv.toDataURL();
  };
  const heartShape = (p, c, dark, hi) => {
    const rows = [
      [3, 3, 3], [8, 3, 3], [2, 4, 5], [7, 4, 5], [2, 5, 11], [2, 6, 11],
      [3, 7, 9], [4, 8, 7], [5, 9, 5], [6, 10, 3], [7, 11, 1],
    ];
    for (const [x, y, w] of rows) for (let i = 0; i < w; i++) p.set(x + i, y, c);
    for (const [x, y] of [[3, 4], [4, 4], [3, 5], [4, 3]]) p.set(x, y, hi);
    for (const [x, y] of [[7, 11], [6, 10], [8, 10], [11, 6], [2, 6]]) p.set(x, y, dark);
  };
  const outlineHeart = (p) => heartShape(p, 0x3a1010, 0x1a0606, 0x4a1a1a);
  out.heart_bg = make((p) => outlineHeart(p));
  out.heart = make((p) => { outlineHeart(p); heartShape(p, 0xe02020, 0x8a1010, 0xff8080); });
  out.heart_half = make((p) => {
    outlineHeart(p);
    const tmp = new P(2); tmp.clear(); heartShape(tmp, 0xe02020, 0x8a1010, 0xff8080);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 8; x++) { const c = tmp.get(x, y); if (c[3]) p.set(x, y, [c[0], c[1], c[2]]); }
  });
  const drumShape = (p, c, dark, hi) => {
    for (let y = 3; y < 9; y++) for (let x = 3; x < 12; x++) {
      const d = Math.hypot((x - 7.5) / 4.5, (y - 5.5) / 3);
      if (d < 1) p.set(x, y, c);
    }
    for (const [x, y] of [[4, 4], [5, 4]]) p.set(x, y, hi);
    for (let i = 0; i < 5; i++) { p.set(7 + i, 9 + (i > 2 ? 1 : 0), dark); p.set(8 + i, 8 + i, dark); }
    for (const [x, y] of [[3, 3], [4, 3], [3, 2]]) p.set(x, y, 0xf0e8d8);
  };
  out.food_bg = make((p) => drumShape(p, 0x3a2a10, 0x1a1206, 0x4a3a20));
  out.food = make((p) => { drumShape(p, 0x3a2a10, 0x1a1206, 0x4a3a20); drumShape(p, 0xc08040, 0x6a4020, 0xe0a860); });
  out.food_half = make((p) => {
    drumShape(p, 0x3a2a10, 0x1a1206, 0x4a3a20);
    const tmp = new P(3); tmp.clear(); drumShape(tmp, 0xc08040, 0x6a4020, 0xe0a860);
    for (let y = 0; y < 16; y++) for (let x = 8; x < 16; x++) { const c = tmp.get(x, y); if (c[3]) p.set(x, y, [c[0], c[1], c[2]]); }
  });
  const shield = (p, c, hi) => {
    for (let y = 2; y < 13; y++) {
      const w = y < 9 ? 11 : 11 - (y - 8) * 2;
      const x0 = 3 + ((11 - w) >> 1);
      for (let x = x0; x < x0 + w; x++) p.set(x, y, c);
    }
    for (let x = 4; x < 12; x++) p.set(x, 3, hi);
  };
  out.armor_bg = make((p) => shield(p, 0x2a2a2a, 0x3a3a3a));
  out.armor = make((p) => { shield(p, 0x2a2a2a, 0x3a3a3a); shield(p, 0xd8d8d8, 0xffffff); });
  out.armor_half = make((p) => {
    shield(p, 0x2a2a2a, 0x3a3a3a);
    const tmp = new P(4); tmp.clear(); shield(tmp, 0xd8d8d8, 0xffffff);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 8; x++) { const c = tmp.get(x, y); if (c[3]) p.set(x, y, [c[0], c[1], c[2]]); }
  });
  out.bubble = make((p) => { blob(p, 8, 8, 4.4, 0x1a3a6a); blob(p, 8, 8, 3.4, 0x88c0f0); p.set(6, 6, 0xffffff); });
  out.bubble_pop = make((p) => { blob(p, 8, 8, 4.4, 0x1a3a6a); blob(p, 8, 8, 2.2, 0x88c0f0); });
  out.xp_orb = make((p) => { blob(p, 8, 8, 4, 0x80ff20); p.set(6, 6, 0xd8ffa0); });
  return out;
}
