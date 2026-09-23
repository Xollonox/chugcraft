// ============================================================================
// Rails & minecarts: the shared logic layer.
//
// Rail shape is *derived*, never stored: a rail looks at its four horizontal
// neighbours and resolves to a straight piece or a quarter-turn curve. The
// chunk worker (meshing the geometry), the main thread (driving the cart) and
// the node test suite all import this one file, so a rail can never render one
// way and behave another.
//
// Every helper takes a `get(x, y, z)` block accessor rather than a world, so
// the tests can run them against a plain Map.
// ============================================================================

import { B } from './blocks.js';

export const isRailId = (id) => id === B.RAIL || id === B.POWERED_RAIL || id === B.POWERED_RAIL_ON;
export const isPoweredRailId = (id) => id === B.POWERED_RAIL || id === B.POWERED_RAIL_ON;

/** A redstone block touching a powered rail switches it on, from any side. */
export function railPoweredAt(get, x, y, z) {
  return get(x + 1, y, z) === B.REDSTONE_BLOCK || get(x - 1, y, z) === B.REDSTONE_BLOCK ||
    get(x, y + 1, z) === B.REDSTONE_BLOCK || get(x, y - 1, z) === B.REDSTONE_BLOCK ||
    get(x, y, z + 1) === B.REDSTONE_BLOCK || get(x, y, z - 1) === B.REDSTONE_BLOCK;
}

/** The id a powered rail should have right now (on while a redstone block is near). */
export function poweredRailIdFor(id, get, x, y, z) {
  if (!isPoweredRailId(id)) return id;
  return railPoweredAt(get, x, y, z) ? B.POWERED_RAIL_ON : B.POWERED_RAIL;
}

/**
 * What should this rail look like? Returns
 *   { kind: 'straight', axis: 'z' | 'x' }
 * or
 *   { kind: 'curve', corner: 'ne' | 'nw' | 'se' | 'sw' }
 * where the corner names the two sides the curve joins (north + east, ...).
 *
 * A lone rail defaults to north-south; the moment a second rail is placed
 * beside it both resolve to the right straight, so the default only ever
 * shows for a single unconnected piece. Powered rails never curve — they
 * always run straight through, like the real thing.
 */
export function railShape(get, x, y, z, powered = false) {
  const n = isRailId(get(x, y, z - 1));
  const s = isRailId(get(x, y, z + 1));
  const w = isRailId(get(x - 1, y, z));
  const e = isRailId(get(x + 1, y, z));
  const ns = n || s, ew = w || e;
  if (ns && ew) {
    // Tees and crossings keep running straight through; only a true elbow
    // becomes a curve.
    if (n && s) return { kind: 'straight', axis: 'z' };
    if (w && e) return { kind: 'straight', axis: 'x' };
    if (powered) return { kind: 'straight', axis: n || s ? 'z' : 'x' };
    return { kind: 'curve', corner: (n ? 'n' : 's') + (w ? 'w' : 'e') };
  }
  if (ns) return { kind: 'straight', axis: 'z' };
  if (ew) return { kind: 'straight', axis: 'x' };
  return { kind: 'straight', axis: 'z' };
}

/**
 * Which way does a cart travelling with velocity (vx, vz) leave this rail?
 * `last` is the cart's last meaningful unit direction, used as the tie-breaker
 * when it is nearly stopped so a curve still picks a stable branch.
 */
export function railTravelDir(shape, vx, vz, last) {
  if (shape.kind === 'straight') {
    return shape.axis === 'z'
      ? { x: 0, z: Math.abs(vz) > 1e-3 ? Math.sign(vz) : (last?.z || 1) }
      : { x: Math.abs(vx) > 1e-3 ? Math.sign(vx) : (last?.x || 1), z: 0 };
  }
  // Curves: entering along one axis leaves along the other, toward the far end.
  const ez = shape.corner[0] === 'n' ? -1 : 1;
  const ex = shape.corner[1] === 'w' ? -1 : 1;
  return Math.abs(vz) > Math.abs(vx) ? { x: ex, z: 0 } : { x: 0, z: ez };
}

export const CART_MAX_SPEED = 8;       // m/s — the same ceiling the real thing uses
export const CART_POWER_ACCEL = 6;     // powered-rail push
export const CART_RIDER_PUSH = 3.5;    // W / joystick acceleration while riding
export const CART_RIDER_BRAKE = 9;     // S / pulled-back joystick braking
export const CART_FRICTION = 0.55;     // exponential decay per second on rails

/**
 * One tick of on-rail speed maths: rolling friction first, then a powered
 * push, then the rider's own throttle. Pure numbers in, pure numbers out, so
 * the test suite can pin the behaviour without a world.
 */
export function cartSpeedStep(speed, dt, opts = {}) {
  const { powered = false, push = 0, maxSpeed = CART_MAX_SPEED } = opts;
  let s = speed * Math.max(0, 1 - CART_FRICTION * dt);
  if (powered) s += CART_POWER_ACCEL * dt;
  if (push) s += push * dt;
  return Math.max(0, Math.min(s, maxSpeed));
}
