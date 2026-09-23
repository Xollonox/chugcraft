// Rails & minecarts: pure-logic checks for the 3.3 transport system.
// Runs without a browser — every helper takes a plain block accessor.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  B, BLOCKS, IS_RAIL, IS_POWERED_RAIL, IS_RAIL_ON, allTileNames,
} from '../src/world/blocks.js';
import {
  railShape, railTravelDir, railPoweredAt, poweredRailIdFor, cartSpeedStep,
  isRailId, isPoweredRailId, CART_MAX_SPEED,
} from '../src/world/rails.js';
import { RECIPES, matchRecipe } from '../src/crafting/recipes.js';
import { getItem, makeStack } from '../src/crafting/items.js';
import { paintTile } from '../src/engine/tiles.js';

const RAIL_TILES = [
  'rail_ns', 'rail_ew', 'rail_curve_ne', 'rail_curve_nw', 'rail_curve_se', 'rail_curve_sw',
  'powered_rail_ns', 'powered_rail_ew', 'powered_rail_ns_on', 'powered_rail_ew_on',
];

/** Tiny block world: a Map behind a get(x,y,z) accessor. */
function world() {
  const map = new Map();
  const get = (x, y, z) => map.get(`${x},${y},${z}`) ?? B.AIR;
  get.set = (x, y, z, id) => { map.set(`${x},${y},${z}`, id); return get; };
  return get;
}

function paintedCount(frame, pick) {
  let n = 0;
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    if (pick && !pick(x, y)) continue;
    if (frame.d[(y * 16 + x) * 4 + 3] > 0) n++;
  }
  return n;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------
test('rails are registered with items, flags and safe drop tables', () => {
  assert.equal(B.RAIL, 179);
  assert.equal(B.POWERED_RAIL, 180);
  assert.equal(B.POWERED_RAIL_ON, 181);
  assert.equal(IS_RAIL[B.RAIL], 1);
  assert.equal(IS_RAIL[B.POWERED_RAIL_ON], 1);
  assert.equal(IS_RAIL[B.STONE], 0);
  assert.equal(IS_POWERED_RAIL[B.POWERED_RAIL], 1);
  assert.equal(IS_POWERED_RAIL[B.RAIL], 0);
  assert.equal(IS_RAIL_ON[B.POWERED_RAIL_ON], 1);
  assert.equal(isRailId(B.RAIL) && isRailId(B.POWERED_RAIL) && isRailId(B.POWERED_RAIL_ON), true);
  assert.equal(isPoweredRailId(B.POWERED_RAIL_ON) && !isPoweredRailId(B.RAIL), true);
  // Rails are walk-through plates with no collision.
  assert.equal(BLOCKS[B.RAIL].solid, false);
  assert.equal(BLOCKS[B.POWERED_RAIL].solid, false);
  // Items: rail + powered_rail place blocks; the ON state shares the item.
  assert.equal(getItem('rail').block, B.RAIL);
  assert.equal(getItem('powered_rail').block, B.POWERED_RAIL);
  assert.equal(getItem('minecart').stack, 1);
  assert.equal(BLOCKS[B.POWERED_RAIL_ON].itemKey, 'powered_rail');
  assert.equal(BLOCKS[B.POWERED_RAIL_ON].drop, 'powered_rail');
  assert.equal(BLOCKS[B.POWERED_RAIL_ON].noItem, true);
});

// ---------------------------------------------------------------------------
// Shape resolution
// ---------------------------------------------------------------------------
test('a lone rail is straight, and lines resolve to the right axis', () => {
  const w = world();
  w.set(0, 10, 0, B.RAIL);
  assert.deepEqual(railShape(w, 0, 10, 0), { kind: 'straight', axis: 'z' });
  w.set(0, 10, 1, B.RAIL);
  assert.deepEqual(railShape(w, 0, 10, 0), { kind: 'straight', axis: 'z' });
  const x = world();
  x.set(0, 10, 0, B.RAIL).set(1, 10, 0, B.RAIL);
  assert.deepEqual(railShape(x, 0, 10, 0), { kind: 'straight', axis: 'x' });
});

test('elbows become curves, tees and crossings stay straight', () => {
  const elbow = world();
  elbow.set(0, 10, 0, B.RAIL).set(0, 10, -1, B.RAIL).set(1, 10, 0, B.RAIL);
  assert.deepEqual(railShape(elbow, 0, 10, 0), { kind: 'curve', corner: 'ne' });
  const tee = world();
  tee.set(0, 10, 0, B.RAIL).set(0, 10, -1, B.RAIL).set(0, 10, 1, B.RAIL).set(1, 10, 0, B.RAIL);
  assert.deepEqual(railShape(tee, 0, 10, 0), { kind: 'straight', axis: 'z' });
  const cross = world();
  cross.set(0, 10, 0, B.RAIL).set(0, 10, -1, B.RAIL).set(0, 10, 1, B.RAIL).set(1, 10, 0, B.RAIL).set(-1, 10, 0, B.RAIL);
  assert.deepEqual(railShape(cross, 0, 10, 0), { kind: 'straight', axis: 'z' });
});

test('powered rails never curve, even at an elbow', () => {
  const w = world();
  w.set(0, 10, 0, B.POWERED_RAIL).set(0, 10, -1, B.RAIL).set(1, 10, 0, B.RAIL);
  const shape = railShape(w, 0, 10, 0, true);
  assert.equal(shape.kind, 'straight');
});

// ---------------------------------------------------------------------------
// Power
// ---------------------------------------------------------------------------
test('a redstone block on any side switches a powered rail on', () => {
  const sides = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  for (const [dx, dy, dz] of sides) {
    const w = world();
    w.set(0, 10, 0, B.POWERED_RAIL);
    w.set(dx, 10 + dy, dz, B.REDSTONE_BLOCK);
    assert.equal(railPoweredAt(w, 0, 10, 0), true);
    assert.equal(poweredRailIdFor(B.POWERED_RAIL, w, 0, 10, 0), B.POWERED_RAIL_ON);
  }
  const off = world();
  off.set(0, 10, 0, B.POWERED_RAIL).set(3, 10, 0, B.REDSTONE_BLOCK);
  assert.equal(railPoweredAt(off, 0, 10, 0), false);
  assert.equal(poweredRailIdFor(B.POWERED_RAIL, off, 0, 10, 0), B.POWERED_RAIL);
  // Non-powered rails are never rewritten by the power pass.
  assert.equal(poweredRailIdFor(B.RAIL, off, 0, 10, 0), B.RAIL);
});

// ---------------------------------------------------------------------------
// Cart motion maths
// ---------------------------------------------------------------------------
test('cart travel follows straights and turns cleanly at curves', () => {
  assert.deepEqual(railTravelDir({ kind: 'straight', axis: 'z' }, 0, -3, null), { x: 0, z: -1 });
  assert.deepEqual(railTravelDir({ kind: 'straight', axis: 'x' }, 2.5, 0, null), { x: 1, z: 0 });
  // A stopped cart keeps its last direction on a straight.
  assert.deepEqual(railTravelDir({ kind: 'straight', axis: 'z' }, 0, 0, { x: 0, z: -1 }), { x: 0, z: -1 });
  // Curve 'ne' joins north and east: entering north-bound leaves east, and
  // entering east-bound leaves north.
  assert.deepEqual(railTravelDir({ kind: 'curve', corner: 'ne' }, 0, -4, null), { x: 1, z: 0 });
  assert.deepEqual(railTravelDir({ kind: 'curve', corner: 'ne' }, 4, 0, null), { x: 0, z: -1 });
  assert.deepEqual(railTravelDir({ kind: 'curve', corner: 'sw' }, 0, 4, null), { x: -1, z: 0 });
  assert.deepEqual(railTravelDir({ kind: 'curve', corner: 'sw' }, -4, 0, null), { x: 0, z: 1 });
});

test('rolling friction slows a cart, powered rails and riders speed it up', () => {
  let s = 4;
  for (let i = 0; i < 60; i++) s = cartSpeedStep(s, 1 / 60, {});
  assert.ok(s < 4 && s > 0, `coasts down (${s})`);
  // A powered rail pushes even a stopped cart forward, up to the cap.
  let p = 0;
  for (let i = 0; i < 300; i++) p = cartSpeedStep(p, 1 / 60, { powered: true });
  assert.ok(p > 3, `powered boost (${p})`);
  assert.ok(p <= CART_MAX_SPEED + 1e-9, 'never exceeds the speed cap');
  // Rider throttle: forward accelerates, brake decays to zero and stays sane.
  let f = 0;
  for (let i = 0; i < 60; i++) f = cartSpeedStep(f, 1 / 60, { push: 3.5 });
  assert.ok(f > 1.5, `rider push (${f})`);
  let b = 6;
  for (let i = 0; i < 120; i++) b = cartSpeedStep(b, 1 / 60, { push: -9 });
  assert.equal(b, 0);
});

// ---------------------------------------------------------------------------
// Recipes & art
// ---------------------------------------------------------------------------
test('rail, powered rail and minecart recipes match exact grids', () => {
  for (const key of ['rail', 'powered_rail', 'minecart']) {
    const r = RECIPES.find((r) => r.out.key === key);
    assert.ok(r, key);
    const grid9 = Array(9).fill(null);
    r.pattern.forEach((row, y) => [...row].forEach((c, x) => {
      if (c !== ' ') grid9[y * 3 + x] = makeStack(r.keys[c]);
    }));
    assert.equal(matchRecipe(grid9, 3)?.out.key, key, key);
  }
  assert.equal(RECIPES.find((r) => r.out.key === 'rail').out.count, 16);
  assert.equal(RECIPES.find((r) => r.out.key === 'powered_rail').out.count, 6);
});

test('every rail tile is packed into the atlas and painted', () => {
  const names = allTileNames();
  for (const name of RAIL_TILES) {
    assert.ok(names.includes(name), `${name} is in the atlas tile list`);
    const { frames } = paintTile(name);
    const painted = paintedCount(frames[0]);
    assert.ok(painted > 24, `${name} has visible pixels (${painted})`);
  }
});

test('rail art orientation matches the track it represents', () => {
  const ns = paintTile('rail_ns').frames[0];
  const ew = paintTile('rail_ew').frames[0];
  // The NS track runs through the two middle columns; EW through the rows.
  assert.ok(paintedCount(ns, (x) => x === 4 || x === 5) > 20, 'ns rails are vertical');
  assert.ok(paintedCount(ew, (x, y) => y === 4 || y === 5) > 20, 'ew rails are horizontal');
  // The NE curve lives in the top-right; nothing reaches the far bottom-left.
  const ne = paintTile('rail_curve_ne').frames[0];
  const topRight = paintedCount(ne, (x, y) => x >= 8 && y < 8);
  const bottomLeft = paintedCount(ne, (x, y) => x < 8 && y >= 8);
  assert.ok(topRight > bottomLeft, `curve leans to its corner (${topRight} vs ${bottomLeft})`);
  assert.equal(paintedCount(ne, (x, y) => x < 4 && y > 11), 0, 'curve corner is empty');
});
