// ============================================================================
// Weather: clear -> rain -> thunderstorm, with biome awareness (snow in cold
// biomes, never in deserts), darkened sky, ambient loop, and lightning strikes
// that flash the world and crack overhead.
// ============================================================================

import * as THREE from 'three';
import { DIM } from '../constants.js';
import { BIOME } from '../world/worldgen.js';

const DROPS = 2600;
// Rain is simulated in a tight column around the player rather than across the
// whole view. Spread over a 30-block radius the same budget of drops read as a
// handful of stray streaks in an otherwise clear sky; packed into 14 it reads
// as actual weather, and nothing is visible past the fog anyway.
const DROP_RADIUS = 14;

/** A new world always opens on a long clear spell — no rain on arrival. */
const FIRST_CLEAR_MIN = 600;
const FIRST_CLEAR_RANGE = 600;

export const WEATHER = { CLEAR: 0, RAIN: 1, THUNDER: 2 };

export class Weather {
  constructor(scene, sky, audio, settings, world) {
    this.scene = scene;
    this.sky = sky;
    this.audio = audio;
    this.settings = settings;
    this.world = world;
    this.state = WEATHER.CLEAR;
    this.intensity = 0;
    this.timer = FIRST_CLEAR_MIN + Math.random() * FIRST_CLEAR_RANGE;
    this.forced = null;
    this.snowing = false;
    this.strikeTimer = 6;
    this.dim = DIM.OVERWORLD;

    // --- rain streaks (LineSegments) ---
    const pos = new Float32Array(DROPS * 6);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.rainGeo = g;
    this.rainPos = pos;
    this.rainMat = new THREE.LineBasicMaterial({
      color: 0x9fc4e8, transparent: true, opacity: 0.45, depthWrite: false,
    });
    this.rain = new THREE.LineSegments(g, this.rainMat);
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    scene.add(this.rain);

    // World-space x, y, z plus the y this drop should land on. Storing world
    // coordinates (rather than offsets from the player) means a cached ground
    // height stays valid as the player walks around.
    this.drops = new Float32Array(DROPS * 4);
    this.speeds = new Float32Array(DROPS);
    for (let i = 0; i < DROPS; i++) {
      this.drops[i * 4 + 3] = Infinity;         // forces a respawn on frame one
      this.speeds[i] = 22 + Math.random() * 14;
    }

    // --- lightning bolt visual ---
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(64 * 3), 3));
    this.boltMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 });
    this.bolt = new THREE.Line(bg, this.boltMat);
    this.bolt.frustumCulled = false;
    this.bolt.visible = false;
    scene.add(this.bolt);
    this.boltTime = 0;
  }

  setDimension(dim) {
    this.dim = dim;
    if (dim !== DIM.OVERWORLD) {
      this.rain.visible = false;
      this.audio.setLoop('rain', 0);
    }
  }

  force(state) {
    this.forced = state;
    this.state = state;
    this.timer = 300;
  }

  cycle() {
    const order = [WEATHER.CLEAR, WEATHER.RAIN, WEATHER.THUNDER];
    this.force(order[(order.indexOf(this.state) + 1) % 3]);
    return this.state;
  }

  /**
   * @param cycleAllowed false freezes the random cycle (the doWeatherCycle
   *   game rule). A weather set by hand still applies either way.
   */
  update(dt, player, biome, cycleAllowed = true) {
    const overworld = this.dim === DIM.OVERWORLD;
    const enabled = this.settings.get('weatherEnabled') !== false;

    if (overworld && this.forced !== null) {
      // A forced state runs out and hands control back, rather than pinning the
      // sky for the rest of the session.
      this.timer -= dt;
      if (this.timer <= 0) {
        this.forced = null;
        this.timer = 120 + Math.random() * 240;
      }
    } else if (overworld && enabled && cycleAllowed) {
      this.timer -= dt;
      if (this.timer <= 0) {
        const r = Math.random();
        if (this.state === WEATHER.CLEAR) {
          this.state = r < 0.72 ? WEATHER.RAIN : WEATHER.THUNDER;
          this.timer = 60 + Math.random() * 120;
        } else {
          this.state = WEATHER.CLEAR;
          this.timer = 180 + Math.random() * 360;
        }
      }
    }
    if (!overworld || !enabled) this.state = WEATHER.CLEAR;

    const target = this.state === WEATHER.CLEAR ? 0 : this.state === WEATHER.RAIN ? 0.7 : 1;
    // Deserts stay dry; cold biomes get snow instead of rain.
    const dry = biome === BIOME.DESERT;
    const cold = biome === BIOME.SNOWY || biome === BIOME.MOUNTAINS;
    this.snowing = cold;
    const want = dry ? 0 : target;
    this.intensity += (want - this.intensity) * Math.min(1, dt * 1.2);
    if (want === 0 && this.intensity < 0.02) this.intensity = 0;
    // Rain without an overcast sky looks like a glitch; the sky has to go grey
    // with it, and hard, or you get sunshine and streaks at the same time.
    this.sky.rainDarken = this.intensity * (this.state === WEATHER.THUNDER ? 1 : 0.82);

    const active = this.intensity > 0.02 && this.settings.get('particles') !== false;
    this.rain.visible = active;
    this.rainMat.opacity = this.intensity * (cold ? 0.8 : 0.62);
    this.rainMat.color.setHex(cold ? 0xffffff : 0x9fc4e8);
    this.audio.setLoop('rain', this.intensity * 0.5);

    if (active) this._updateDrops(dt, player, cold);

    // --- lightning ---
    if (this.state === WEATHER.THUNDER && this.intensity > 0.5 && overworld) {
      this.strikeTimer -= dt;
      if (this.strikeTimer <= 0) {
        this.strikeTimer = 5 + Math.random() * 16;
        this.strike(player);
      }
    }
    if (this.boltTime > 0) {
      this.boltTime -= dt;
      this.boltMat.opacity = Math.max(0, this.boltTime / 0.22);
      if (this.boltTime <= 0) this.bolt.visible = false;
    }
  }

  /** Move a drop to a fresh column near the player and look up where it lands. */
  _respawnDrop(i, px, py, pz) {
    const d = this.drops, o = i * 4;
    const x = px + (Math.random() - 0.5) * 2 * DROP_RADIUS;
    const z = pz + (Math.random() - 0.5) * 2 * DROP_RADIUS;
    d[o] = x;
    d[o + 2] = z;
    d[o + 1] = py + 8 + Math.random() * 16;
    const h = this.world.heightAt(Math.floor(x), Math.floor(z));
    // Land on the air block directly above the surface. Unloaded columns get a
    // floor well below the player so the drop simply falls out of view.
    d[o + 3] = h < 0 ? py - 32 : h + 1;
  }

  _updateDrops(dt, player, cold) {
    const px = player.x, py = player.y, pz = player.z;
    const pos = this.rainPos, d = this.drops;
    const len = cold ? 0.25 : 1.6;
    const speedMul = cold ? 0.22 : 1;
    for (let i = 0; i < DROPS; i++) {
      const o = i * 4;
      d[o + 1] -= this.speeds[i] * speedMul * dt;
      if (cold) {
        // snow drifts sideways; re-check the column it drifted into
        d[o] += Math.sin(d[o + 1] * 0.6 + i) * dt * 0.7;
        d[o + 2] += Math.cos(d[o + 1] * 0.5 + i) * dt * 0.7;
      }
      if (d[o + 1] <= d[o + 3] ||
          d[o + 1] < py - 28 || d[o + 1] > py + 44 ||
          Math.abs(d[o] - px) > DROP_RADIUS + 8 || Math.abs(d[o + 2] - pz) > DROP_RADIUS + 8) {
        this._respawnDrop(i, px, py, pz);
      }
      const j = i * 6;
      pos[j] = d[o]; pos[j + 1] = d[o + 1]; pos[j + 2] = d[o + 2];
      pos[j + 3] = d[o]; pos[j + 4] = d[o + 1] - len; pos[j + 5] = d[o + 2];
    }
    this.rainGeo.attributes.position.needsUpdate = true;
  }

  strike(player) {
    const ang = Math.random() * Math.PI * 2;
    const dist = 12 + Math.random() * 46;
    const x = Math.floor(player.x + Math.cos(ang) * dist);
    const z = Math.floor(player.z + Math.sin(ang) * dist);
    const groundY = this.world.heightAt(x, z);
    if (groundY < 0) return;

    // jagged bolt
    const arr = this.bolt.geometry.attributes.position.array;
    let cx = x + 0.5, cz = z + 0.5;
    const top = groundY + 60;
    for (let i = 0; i < 64; i++) {
      const t = i / 63;
      arr[i * 3] = cx + (Math.random() - 0.5) * 1.6 * (1 - t);
      arr[i * 3 + 1] = top - t * (top - groundY - 1);
      arr[i * 3 + 2] = cz + (Math.random() - 0.5) * 1.6 * (1 - t);
      cx += (Math.random() - 0.5) * 0.5;
      cz += (Math.random() - 0.5) * 0.5;
    }
    this.bolt.geometry.attributes.position.needsUpdate = true;
    this.bolt.visible = true;
    this.boltTime = 0.22;
    this.boltMat.opacity = 1;
    this.sky.lightningFlash();
    this.audio.play('thunder', { volume: Math.max(0.15, 1 - dist / 90) });
    this.onStrike?.(x, groundY + 1, z);
  }

  serialize() { return { state: this.state, timer: this.timer, forced: this.forced }; }
  deserialize(o) {
    if (!o) return;
    this.state = o.state ?? WEATHER.CLEAR;
    this.timer = o.timer ?? 120;
    this.forced = o.forced ?? null;
  }
}
