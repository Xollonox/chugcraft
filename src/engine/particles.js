// ============================================================================
// Particle system — one pooled THREE.Points draw call for the whole world.
// Square, unlit, gravity-affected bits: block-break debris, splashes, smoke,
// flames, portal sparkles, crit stars and explosion puffs.
// ============================================================================

import * as THREE from 'three';
import { BLOCK_COUNT } from '../world/blocks.js';

const MAX = 4000;

const VERT = /* glsl */`
attribute float aSize;
attribute vec3 aColor;
attribute float aAlpha;
varying vec3 vColor;
varying float vAlpha;
uniform float uScale;
void main() {
  vColor = aColor;
  vAlpha = aAlpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = max(1.0, aSize * uScale / max(0.5, -mv.z));
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = /* glsl */`
precision mediump float;
varying vec3 vColor;
varying float vAlpha;
void main() {
  if (vAlpha <= 0.01) discard;
  gl_FragColor = vec4(vColor, vAlpha);
}`;

export class Particles {
  constructor(scene, world, blockColors) {
    this.world = world;
    this.blockColors = blockColors || new Float32Array(BLOCK_COUNT * 3).fill(0.6);
    this.enabled = true;

    this.pos = new Float32Array(MAX * 3);
    this.col = new Float32Array(MAX * 3);
    this.size = new Float32Array(MAX);
    this.alpha = new Float32Array(MAX);
    this.vel = new Float32Array(MAX * 3);
    this.life = new Float32Array(MAX);
    this.maxLife = new Float32Array(MAX);
    this.grav = new Float32Array(MAX);
    this.drag = new Float32Array(MAX);
    this.collide = new Uint8Array(MAX);
    this.count = 0;
    this.cursor = 0;

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    g.setDrawRange(0, 0);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 34 } },
      vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false,
    });
    this._projH = 0; this._projFov = 0;
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    scene.add(this.points);
  }

  /**
   * gl_PointSize is in framebuffer pixels, so the world-space size of a
   * particle depends on the viewport height and FOV. `aSize` is authored in
   * sixteenths of a block (one texture pixel), which is what makes a break
   * particle read as a chip off the block rather than a dinner plate.
   */
  setProjection(heightPx, fovDeg) {
    if (heightPx === this._projH && fovDeg === this._projFov) return;
    this._projH = heightPx; this._projFov = fovDeg;
    const halfFov = (fovDeg * Math.PI) / 360;
    this.mat.uniforms.uScale.value = heightPx / (2 * Math.tan(halfFov)) / 16;
  }

  _alloc() {
    if (this.count < MAX) return this.count++;
    // recycle the oldest slot
    this.cursor = (this.cursor + 1) % MAX;
    return this.cursor;
  }

  spawn(x, y, z, vx, vy, vz, r, g, b, size, life, opts = {}) {
    if (!this.enabled) return;
    const i = this._alloc();
    const i3 = i * 3;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
    this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
    this.col[i3] = r; this.col[i3 + 1] = g; this.col[i3 + 2] = b;
    this.size[i] = size;
    this.life[i] = life; this.maxLife[i] = life;
    this.alpha[i] = 1;
    this.grav[i] = opts.gravity ?? 16;
    this.drag[i] = opts.drag ?? 1.6;
    this.collide[i] = opts.collide === false ? 0 : 1;
  }

  blockBreak(x, y, z, blockId, n = 9) {
    const c = this.blockColors;
    for (let i = 0; i < n; i++) {
      const j = blockId * 3;
      const v = 0.75 + Math.random() * 0.5;
      this.spawn(
        x + Math.random(), y + Math.random(), z + Math.random(),
        (Math.random() - 0.5) * 3.2, Math.random() * 3.2, (Math.random() - 0.5) * 3.2,
        c[j] * v, c[j + 1] * v, c[j + 2] * v,
        2.2 + Math.random() * 2.2, 0.6 + Math.random() * 0.6
      );
    }
  }

  /** One chip per call — this fires repeatedly while a block is being mined. */
  blockHit(x, y, z, blockId, nx, ny, nz, n = 1) {
    const c = this.blockColors, j = blockId * 3;
    for (let i = 0; i < n; i++) {
      const v = 0.8 + Math.random() * 0.4;
      this.spawn(
        x + 0.5 + nx * 0.55 + (Math.random() - 0.5) * 0.6,
        y + 0.5 + ny * 0.55 + (Math.random() - 0.5) * 0.6,
        z + 0.5 + nz * 0.55 + (Math.random() - 0.5) * 0.6,
        nx * 1.2 + (Math.random() - 0.5), ny * 1.2 + Math.random() * 0.8, nz * 1.2 + (Math.random() - 0.5),
        c[j] * v, c[j + 1] * v, c[j + 2] * v,
        1.8, 0.4 + Math.random() * 0.3
      );
    }
  }

  footstep(x, y, z, blockId) {
    const c = this.blockColors, j = blockId * 3;
    this.spawn(x + (Math.random() - 0.5) * 0.4, y + 0.06, z + (Math.random() - 0.5) * 0.4,
      (Math.random() - 0.5) * 0.6, 0.6, (Math.random() - 0.5) * 0.6,
      c[j], c[j + 1], c[j + 2], 2, 0.45);
  }

  splash(x, y, z, n = 12) {
    for (let i = 0; i < n; i++) {
      this.spawn(x + (Math.random() - 0.5) * 0.7, y, z + (Math.random() - 0.5) * 0.7,
        (Math.random() - 0.5) * 2.4, 2 + Math.random() * 2.4, (Math.random() - 0.5) * 2.4,
        0.55, 0.72, 0.95, 2.2, 0.5 + Math.random() * 0.3);
    }
  }

  /** Pink hearts drifting up: breeding, taming, feeding. */
  hearts(x, y, z, n = 4) {
    for (let i = 0; i < n; i++) {
      this.spawn(x + (Math.random() - 0.5) * 0.9, y + Math.random() * 0.3, z + (Math.random() - 0.5) * 0.9,
        (Math.random() - 0.5) * 0.3, 0.9 + Math.random() * 0.5, (Math.random() - 0.5) * 0.3,
        1.0, 0.25 + Math.random() * 0.15, 0.4, 5 + Math.random() * 3, 0.9 + Math.random() * 0.5,
        { gravity: -0.6, drag: 1.5, collide: false });
    }
  }

  smoke(x, y, z, n = 5, tint = 0.28) {
    for (let i = 0; i < n; i++) {
      this.spawn(x + (Math.random() - 0.5) * 0.5, y + Math.random() * 0.4, z + (Math.random() - 0.5) * 0.5,
        (Math.random() - 0.5) * 0.5, 0.7 + Math.random() * 0.6, (Math.random() - 0.5) * 0.5,
        tint, tint, tint, 4 + Math.random() * 4, 0.9 + Math.random() * 0.8,
        { gravity: -1.2, drag: 1.2, collide: false });
    }
  }

  flame(x, y, z, n = 2) {
    for (let i = 0; i < n; i++) {
      const t = Math.random();
      this.spawn(x + (Math.random() - 0.5) * 0.25, y + Math.random() * 0.2, z + (Math.random() - 0.5) * 0.25,
        (Math.random() - 0.5) * 0.25, 0.5 + Math.random() * 0.5, (Math.random() - 0.5) * 0.25,
        1, 0.55 + t * 0.4, 0.12 + t * 0.2, 2.4 + Math.random() * 2, 0.5 + Math.random() * 0.4,
        { gravity: -2.5, drag: 1.4, collide: false });
    }
  }

  portalSparkle(x, y, z, n = 3) {
    for (let i = 0; i < n; i++) {
      this.spawn(x + (Math.random() - 0.5) * 1.2, y + Math.random() * 2, z + (Math.random() - 0.5) * 1.2,
        (Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 1.2,
        0.6 + Math.random() * 0.35, 0.2, 0.85, 2 + Math.random() * 2, 0.8 + Math.random() * 0.6,
        { gravity: 0, drag: 0.6, collide: false });
    }
  }

  crit(x, y, z, n = 8) {
    for (let i = 0; i < n; i++) {
      this.spawn(x + (Math.random() - 0.5) * 0.7, y + (Math.random() - 0.5) * 0.7, z + (Math.random() - 0.5) * 0.7,
        (Math.random() - 0.5) * 2, Math.random() * 2, (Math.random() - 0.5) * 2,
        1, 0.95, 0.55, 2.4, 0.4, { gravity: 6, collide: false });
    }
  }

  damage(x, y, z, n = 6) {
    for (let i = 0; i < n; i++) {
      this.spawn(x + (Math.random() - 0.5) * 0.6, y + (Math.random() - 0.5) * 0.6, z + (Math.random() - 0.5) * 0.6,
        (Math.random() - 0.5) * 1.6, Math.random() * 1.6, (Math.random() - 0.5) * 1.6,
        0.75, 0.05, 0.05, 2.6, 0.45, { gravity: 6, collide: false });
    }
  }

  explosion(x, y, z, power = 3) {
    const n = Math.min(220, 30 * power);
    for (let i = 0; i < n; i++) {
      const sp = 2 + Math.random() * 7 * (power / 3);
      const th = Math.random() * Math.PI * 2, ph = Math.acos(Math.random() * 2 - 1);
      const g = 0.25 + Math.random() * 0.45;
      this.spawn(x, y, z,
        Math.sin(ph) * Math.cos(th) * sp, Math.cos(ph) * sp * 0.8, Math.sin(ph) * Math.sin(th) * sp,
        g, g * 0.94, g * 0.9, 6 + Math.random() * 8, 0.8 + Math.random() * 0.9,
        { gravity: 2, drag: 2.2, collide: false });
    }
  }

  enderPop(x, y, z, n = 24) {
    for (let i = 0; i < n; i++) {
      this.spawn(x + (Math.random() - 0.5) * 0.8, y + Math.random() * 1.8, z + (Math.random() - 0.5) * 0.8,
        (Math.random() - 0.5) * 1.6, (Math.random() - 0.5) * 1.6, (Math.random() - 0.5) * 1.6,
        0.55, 0.1, 0.7, 2.4, 0.7, { gravity: 0, drag: 1.0, collide: false });
    }
  }

  update(dt) {
    const { pos, vel, life, maxLife, alpha, grav, drag, collide } = this;
    const w = this.world;
    let n = this.count;
    for (let i = 0; i < n; i++) {
      life[i] -= dt;
      if (life[i] <= 0) {
        // swap-remove
        n--;
        if (i !== n) {
          const a = i * 3, b = n * 3;
          pos[a] = pos[b]; pos[a + 1] = pos[b + 1]; pos[a + 2] = pos[b + 2];
          vel[a] = vel[b]; vel[a + 1] = vel[b + 1]; vel[a + 2] = vel[b + 2];
          this.col[a] = this.col[b]; this.col[a + 1] = this.col[b + 1]; this.col[a + 2] = this.col[b + 2];
          this.size[i] = this.size[n];
          life[i] = life[n]; maxLife[i] = maxLife[n];
          grav[i] = grav[n]; drag[i] = drag[n]; collide[i] = collide[n];
        }
        i--;
        continue;
      }
      const i3 = i * 3;
      vel[i3 + 1] -= grav[i] * dt;
      const d = Math.max(0, 1 - drag[i] * dt);
      vel[i3] *= d; vel[i3 + 2] *= d;
      let nx = pos[i3] + vel[i3] * dt;
      let ny = pos[i3 + 1] + vel[i3 + 1] * dt;
      let nz = pos[i3 + 2] + vel[i3 + 2] * dt;
      if (collide[i] && w) {
        if (w.isSolidAt(Math.floor(nx), Math.floor(pos[i3 + 1]), Math.floor(pos[i3 + 2]))) { nx = pos[i3]; vel[i3] = 0; }
        if (w.isSolidAt(Math.floor(nx), Math.floor(ny), Math.floor(pos[i3 + 2]))) {
          ny = pos[i3 + 1]; vel[i3 + 1] = 0; vel[i3] *= 0.6; vel[i3 + 2] *= 0.6;
        }
        if (w.isSolidAt(Math.floor(nx), Math.floor(ny), Math.floor(nz))) { nz = pos[i3 + 2]; vel[i3 + 2] = 0; }
      }
      pos[i3] = nx; pos[i3 + 1] = ny; pos[i3 + 2] = nz;
      const t = life[i] / maxLife[i];
      alpha[i] = t > 0.55 ? 1 : t / 0.55;
    }
    this.count = n;
    this.geo.setDrawRange(0, n);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aColor.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
  }

  clear() { this.count = 0; this.geo.setDrawRange(0, 0); }
}
