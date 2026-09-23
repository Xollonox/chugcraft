// ============================================================================
// Sky: gradient dome, square sun and phased moon, star field, drifting clouds
// and the global day/night light level that drives both the chunk shader and
// hostile mob spawning.
// ============================================================================

import * as THREE from 'three';
import { DIM } from '../constants.js';
import { nightLighting } from './night-visibility.js';
import { clamp, smoothstep, mulberry32 } from './noise.js';

const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

const SKY_DAY_TOP = [0.22, 0.42, 0.86];
const SKY_DAY_HOR = [0.62, 0.78, 0.96];
const SKY_DUSK_TOP = [0.20, 0.20, 0.46];
const SKY_DUSK_HOR = [0.95, 0.52, 0.24];
const SKY_NIGHT_TOP = [0.016, 0.024, 0.070];
const SKY_NIGHT_HOR = [0.055, 0.075, 0.170];

const DOME_VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const DOME_FRAG = /* glsl */`
precision highp float;
uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uBottom;
uniform float uSunGlow; uniform vec3 uSunDir; uniform vec3 uGlowColor;
varying vec3 vDir;
void main() {
  float h = vDir.y;
  vec3 c;
  if (h > 0.0) c = mix(uHorizon, uTop, pow(clamp(h, 0.0, 1.0), 0.55));
  else c = mix(uHorizon, uBottom, pow(clamp(-h, 0.0, 1.0), 0.42));
  // warm bloom around the sun as it sits near the horizon
  float d = max(0.0, dot(normalize(vDir), normalize(uSunDir)));
  c += uGlowColor * pow(d, 7.0) * uSunGlow;
  gl_FragColor = vec4(c, 1.0);
}`;

// ---------------------------------------------------------------------------
// Clouds
//
// Built as real geometry rather than a textured plane: a coarse grid of cloud
// cells extruded into slabs, with interior faces culled. That gives genuine
// depth and clean edges from any angle — a repeating texture on a quad reads as
// a pixelated ceiling the moment you look up at it.
// ---------------------------------------------------------------------------
const CLOUD_GRID = 48;        // cells across the field
const CLOUD_CELL = 14;        // blocks per cell
const CLOUD_SPAN = CLOUD_GRID * CLOUD_CELL;
export const CLOUD_HEIGHT = 150;

function cloudField(seed) {
  const g = new Float32Array(CLOUD_GRID * CLOUD_GRID);
  const rnd = mulberry32(seed);
  const lat = 12;
  const lattice = new Float32Array(lat * lat);
  for (let i = 0; i < lattice.length; i++) lattice[i] = rnd();
  const at = (x, y) => lattice[(((y % lat) + lat) % lat) * lat + (((x % lat) + lat) % lat)];
  const smooth = (x, y, f) => {
    const fx = (x / CLOUD_GRID) * f, fy = (y / CLOUD_GRID) * f;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
    const t = a + (b - a) * sx;
    return t + (c + (d - c) * sx - t) * sy;
  };
  for (let y = 0; y < CLOUD_GRID; y++) {
    for (let x = 0; x < CLOUD_GRID; x++) {
      // two octaves: broad banks broken up by smaller gaps
      const v = smooth(x, y, 4) * 0.65 + smooth(x, y, 9) * 0.35;
      g[y * CLOUD_GRID + x] = v;
    }
  }
  return g;
}

/**
 * Turn the noise field into occupied cells, then tidy it up.
 *
 * Thresholding smooth noise at roughly half coverage leaves a scatter of lone
 * cells and lone holes right along the contour. On a regular 14-block lattice
 * that scatter reads as a grid drawn across the sky rather than as weather, so
 * two majority passes fold the strays into their neighbours and leave the
 * coherent banks Minecraft actually has.
 */
function cloudCells(field, threshold) {
  let cells = new Uint8Array(CLOUD_GRID * CLOUD_GRID);
  for (let i = 0; i < cells.length; i++) cells[i] = field[i] > threshold ? 1 : 0;
  const at = (c, x, y) => c[(((y % CLOUD_GRID) + CLOUD_GRID) % CLOUD_GRID) * CLOUD_GRID +
    (((x % CLOUD_GRID) + CLOUD_GRID) % CLOUD_GRID)];
  for (let pass = 0; pass < 2; pass++) {
    const next = new Uint8Array(cells.length);
    for (let y = 0; y < CLOUD_GRID; y++) {
      for (let x = 0; x < CLOUD_GRID; x++) {
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) if (dx || dy) n += at(cells, x + dx, y + dy);
        }
        const self = at(cells, x, y);
        // stranded on its own, or a pinhole in the middle of a bank
        next[y * CLOUD_GRID + x] = n <= 2 ? 0 : n >= 6 ? 1 : self;
      }
    }
    cells = next;
  }
  return cells;
}

/** Extrude the occupied cells into a single BufferGeometry. */
function buildCloudGeometry(field, threshold, thickness) {
  const pos = [], nrm = [], idx = [];
  const cells = cloudCells(field, threshold);
  const solid = (x, y) => {
    const gx = ((x % CLOUD_GRID) + CLOUD_GRID) % CLOUD_GRID;
    const gy = ((y % CLOUD_GRID) + CLOUD_GRID) % CLOUD_GRID;
    return cells[gy * CLOUD_GRID + gx] === 1;
  };
  const quad = (a, b, c, d, n) => {
    const base = pos.length / 3;
    for (const v of [a, b, c, d]) pos.push(v[0], v[1], v[2]);
    for (let i = 0; i < 4; i++) nrm.push(n[0], n[1], n[2]);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  const S = CLOUD_CELL, T = thickness;
  for (let cy = 0; cy < CLOUD_GRID; cy++) {
    for (let cx = 0; cx < CLOUD_GRID; cx++) {
      if (!solid(cx, cy)) continue;
      const x0 = cx * S, x1 = x0 + S, z0 = cy * S, z1 = z0 + S;
      const y0 = 0, y1 = T;
      quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0]);
      quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0]);
      // sides only where the neighbouring cell is empty
      if (!solid(cx + 1, cy)) quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0]);
      if (!solid(cx - 1, cy)) quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0]);
      if (!solid(cx, cy + 1)) quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1]);
      if (!solid(cx, cy - 1)) quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  g.translate(-CLOUD_SPAN / 2, 0, -CLOUD_SPAN / 2);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), CLOUD_SPAN);
  return g;
}

const CLOUD_VERT = /* glsl */`
varying float vShade;
varying vec3 vWorld;
void main() {
  // flat directional shading straight off the face normal, like the terrain
  vShade = normal.y > 0.5 ? 1.0 : (normal.y < -0.5 ? 0.72 : 0.86);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const CLOUD_FRAG = /* glsl */`
precision mediump float;
uniform vec3 uColor;
uniform float uOpacity;
uniform vec3 uCam;
uniform float uFade;
varying float vShade;
varying vec3 vWorld;
void main() {
  // fade out at the rim so the field never shows a hard edge
  float d = length(vWorld.xz - uCam.xz);
  float a = uOpacity * (1.0 - smoothstep(uFade * 0.72, uFade, d));
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor * vShade, a);
}`;

function squareTexture(draw, size = 32) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  draw(ctx, size);
  const t = new THREE.CanvasTexture(cv);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  return t;
}

export class Sky {
  constructor(renderer, settings) {
    this.r = renderer;
    this.settings = settings;
    this.dim = DIM.OVERWORLD;
    this.sunLight = 1;
    this.sunDir = new THREE.Vector3(0, 1, 0);
    this.flash = 0;
    this.rainDarken = 0;

    this.group = new THREE.Group();
    this.group.renderOrder = -100;
    renderer.scene.add(this.group);

    // --- dome ---
    this.domeMat = new THREE.ShaderMaterial({
      uniforms: {
        uTop: { value: new THREE.Vector3(...SKY_DAY_TOP) },
        uHorizon: { value: new THREE.Vector3(...SKY_DAY_HOR) },
        uBottom: { value: new THREE.Vector3(0.1, 0.12, 0.18) },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunGlow: { value: 0 },
        uGlowColor: { value: new THREE.Vector3(1.0, 0.5, 0.15) },
      },
      vertexShader: DOME_VERT,
      fragmentShader: DOME_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), this.domeMat);
    this.dome.renderOrder = -100;
    this.dome.frustumCulled = false;
    this.dome.scale.setScalar(900);
    this.group.add(this.dome);

    // --- stars ---
    const starCount = 900;
    const pos = new Float32Array(starCount * 3);
    const sizes = new Float32Array(starCount);
    const rnd = mulberry32(0x57a25);
    for (let i = 0; i < starCount; i++) {
      let x, y, z, l;
      do {
        x = rnd() * 2 - 1; y = rnd() * 2 - 1; z = rnd() * 2 - 1;
        l = Math.hypot(x, y, z);
      } while (l > 1 || l < 0.001);
      pos[i * 3] = (x / l) * 780; pos[i * 3 + 1] = (y / l) * 780; pos[i * 3 + 2] = (z / l) * 780;
      sizes[i] = 1.2 + rnd() * 2.4;
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    sg.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    this.starMat = new THREE.ShaderMaterial({
      uniforms: { uOpacity: { value: 0 } },
      vertexShader: `attribute float aSize; varying float vS;
        void main(){ vS=aSize; vec4 mv=modelViewMatrix*vec4(position,1.0);
        gl_PointSize=aSize*2.0; gl_Position=projectionMatrix*mv; }`,
      fragmentShader: `precision mediump float; uniform float uOpacity; varying float vS;
        void main(){ vec2 d=gl_PointCoord-0.5; if(dot(d,d)>0.25) discard;
        gl_FragColor=vec4(1.0,1.0,1.0,uOpacity); }`,
      transparent: true, depthWrite: false, depthTest: false,
    });
    this.stars = new THREE.Points(sg, this.starMat);
    this.stars.renderOrder = -99;
    this.stars.frustumCulled = false;
    this.group.add(this.stars);

    // --- sun & moon ---
    const sunTex = squareTexture((ctx, s) => {
      ctx.fillStyle = '#fff6d8'; ctx.fillRect(0, 0, s, s);
      ctx.fillStyle = '#ffffff'; ctx.fillRect(s * 0.12, s * 0.12, s * 0.76, s * 0.76);
    });
    this.sunMat = new THREE.MeshBasicMaterial({ map: sunTex, transparent: true, depthWrite: false, depthTest: false, fog: false });
    this.sun = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), this.sunMat);
    this.sun.renderOrder = -98;
    this.sun.frustumCulled = false;
    this.group.add(this.sun);

    this.moonTextures = [];
    for (let p = 0; p < 8; p++) {
      this.moonTextures.push(squareTexture((ctx, s) => {
        ctx.clearRect(0, 0, s, s);
        ctx.fillStyle = '#e8ecf5';
        ctx.beginPath(); ctx.arc(s / 2, s / 2, s * 0.44, 0, Math.PI * 2); ctx.fill();
        // craters
        ctx.fillStyle = '#c8cedd';
        ctx.beginPath(); ctx.arc(s * 0.4, s * 0.38, s * 0.09, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(s * 0.62, s * 0.58, s * 0.07, 0, Math.PI * 2); ctx.fill();
        // phase mask
        const phase = p / 8;
        if (p !== 0) {
          ctx.globalCompositeOperation = 'destination-out';
          const off = (phase <= 0.5 ? phase * 2 : (1 - phase) * 2) * s * 0.9;
          ctx.beginPath();
          ctx.arc(s / 2 + (phase <= 0.5 ? -off : off), s / 2, s * 0.46, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalCompositeOperation = 'source-over';
        }
      }, 48));
    }
    this.moonMat = new THREE.MeshBasicMaterial({ map: this.moonTextures[4], transparent: true, depthWrite: false, depthTest: false, fog: false });
    this.moon = new THREE.Mesh(new THREE.PlaneGeometry(90, 90), this.moonMat);
    this.moon.renderOrder = -98;
    this.moon.frustumCulled = false;
    this.group.add(this.moon);

    // --- clouds: real extruded geometry, two thicknesses ---
    const field = cloudField(0xc10d5);
    this.cloudMat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Vector3(1, 1, 1) },
        uOpacity: { value: 0.85 },
        uCam: { value: new THREE.Vector3() },
        uFade: { value: CLOUD_SPAN * 0.5 },
      },
      vertexShader: CLOUD_VERT,
      fragmentShader: CLOUD_FRAG,
      transparent: true,
      depthWrite: false,
      // Front faces only. Drawing both sides blended each slab's lit top
      // through its shaded underside, and the doubled alpha picked out every
      // cell boundary — the sky ended up looking like graph paper.
      side: THREE.FrontSide,
      fog: false,
    });
    this.cloudGeo = {
      // ~half the sky covered, the way an overworld noon looks in Minecraft;
      // a higher cut-off left the sky nearly empty.
      fancy: buildCloudGeometry(field, 0.47, 5),   // chunky 3D banks
      flat: buildCloudGeometry(field, 0.47, 0.4),  // thin sheet
    };
    this.clouds = new THREE.Mesh(this.cloudGeo.fancy, this.cloudMat);
    this.clouds.position.y = CLOUD_HEIGHT;
    this.clouds.renderOrder = -50;
    this.clouds.frustumCulled = false;
    renderer.scene.add(this.clouds);
    this.cloudOffset = 0;
    this.cloudMode = 2;
  }

  setDimension(dim) {
    this.dim = dim;
    const over = dim === DIM.OVERWORLD;
    this.sun.visible = over;
    this.moon.visible = over;
    this.clouds.visible = over && this.cloudMode > 0;
    this.stars.visible = dim !== DIM.NETHER;
  }

  /** @param mode 0 off, 1 flat sheet, 2 chunky 3D banks */
  setCloudMode(mode) {
    this.cloudMode = mode;
    this.clouds.geometry = mode === 1 ? this.cloudGeo.flat : this.cloudGeo.fancy;
    this.clouds.visible = mode > 0 && this.dim === DIM.OVERWORLD;
  }

  /**
   * @param t normalised time of day, 0 = sunrise, 0.25 = noon, 0.5 = sunset
   */
  update(dt, camera, t, dayNumber = 0) {
    this.group.position.copy(camera.position);
    // Keep the cloud field centred on the player, snapped to whole cells so the
    // drift reads as movement rather than the whole sky sliding with you.
    const snap = (v) => Math.round(v / CLOUD_CELL) * CLOUD_CELL;
    this.clouds.position.set(
      snap(camera.position.x - this.cloudOffset) + this.cloudOffset,
      CLOUD_HEIGHT,
      snap(camera.position.z - this.cloudOffset * 0.25) + this.cloudOffset * 0.25);
    this.cloudMat.uniforms.uCam.value.copy(camera.position);

    const u = this.r.uniforms;
    u.uNightGamma.value = 0;

    if (this.dim === DIM.NETHER) {
      // No sky in the Nether: the ambient term is what makes netherrack legible.
      this.sunLight = 0.30;
      u.uSun.value = this.sunLight;
      u.uSkyTint.value.set(1.0, 0.62, 0.45);
      u.uAmbient.value = 0.30;
      this.domeMat.uniforms.uTop.value.set(0.18, 0.035, 0.03);
      this.domeMat.uniforms.uHorizon.value.set(0.34, 0.07, 0.05);
      this.domeMat.uniforms.uBottom.value.set(0.42, 0.10, 0.05);
      this.domeMat.uniforms.uSunGlow.value = 0;
      u.uFogColor.value.set(0.30, 0.06, 0.05);
      u.uZenith.value.set(0.18, 0.035, 0.03);
      u.uHorizon.value.set(0.34, 0.07, 0.05);
      u.uSunColor.value.set(1.0, 0.45, 0.2);
      u.uDirect.value = 0.06 * (this.r.packDirect || 1);
      this.starMat.uniforms.uOpacity.value = 0;
      this._applyFogRange(0.35, 0.85);
      return;
    }
    if (this.dim === DIM.END) {
      // Bright enough that end stone reads as pale yellow-white against the
      // void, but cold and colourless compared with daylight.
      this.sunLight = 0.72;
      u.uSun.value = this.sunLight;
      u.uSkyTint.value.set(0.86, 0.82, 0.94);
      u.uAmbient.value = 0.20;
      this.domeMat.uniforms.uTop.value.set(0.02, 0.01, 0.035);
      this.domeMat.uniforms.uHorizon.value.set(0.07, 0.04, 0.11);
      this.domeMat.uniforms.uBottom.value.set(0.03, 0.015, 0.05);
      this.domeMat.uniforms.uSunGlow.value = 0;
      u.uFogColor.value.set(0.055, 0.03, 0.09);
      u.uZenith.value.set(0.02, 0.01, 0.035);
      u.uHorizon.value.set(0.10, 0.06, 0.16);
      u.uSunColor.value.set(0.75, 0.65, 0.95);
      u.uDirect.value = 0.10 * (this.r.packDirect || 1);
      this.starMat.uniforms.uOpacity.value = 0.7;
      this.stars.rotation.y += dt * 0.004;
      this._applyFogRange(0.45, 0.95);
      return;
    }

    // --- overworld ---
    const a = t * Math.PI * 2;
    const sy = Math.sin(a), sx = Math.cos(a);
    this.sunDir.set(sx, sy, 0.18).normalize();

    const dayF = smoothstep(-0.14, 0.20, sy);
    const duskF = 1 - Math.min(1, Math.abs(sy) / 0.30);

    const nv = this.settings.get('nightVisibility') ?? .75;
    const readableTop = SKY_NIGHT_TOP.map((c,i)=>c + [0.025,0.035,0.065][i]*nv);
    let top = lerp3(readableTop, SKY_DAY_TOP, dayF);
    let hor = lerp3(SKY_NIGHT_HOR, SKY_DAY_HOR, dayF);
    top = lerp3(top, SKY_DUSK_TOP, duskF * 0.75);
    hor = lerp3(hor, SKY_DUSK_HOR, duskF * 0.85);

    const rain = this.rainDarken;
    const grey = [0.28, 0.30, 0.34];
    top = lerp3(top, grey, rain * 0.92);
    hor = lerp3(hor, grey, rain * 0.95);

    // Feed the same colours to the chunk shader so water reflects the real sky.
    u.uZenith.value.set(top[0], top[1], top[2]);
    u.uHorizon.value.set(hor[0], hor[1], hor[2]);
    u.uSunDir.value.copy(sy > -0.1 ? this.sunDir : this.sunDir.clone().negate());
    const sunWarm = 1 - duskF * 0.35;
    u.uSunColor.value.set(1.0, 0.95 * sunWarm + 0.05, 0.80 * sunWarm);
    // packDirect is the active shader pack's sun multiplier (shaderpacks.js).
    u.uDirect.value = 0.34 * (1 - rain * 0.7) * (this.r.packDirect || 1);

    this.domeMat.uniforms.uTop.value.set(top[0], top[1], top[2]);
    this.domeMat.uniforms.uHorizon.value.set(hor[0], hor[1], hor[2]);
    this.domeMat.uniforms.uBottom.value.set(hor[0] * 0.55, hor[1] * 0.55, hor[2] * 0.6);
    this.domeMat.uniforms.uSunDir.value.copy(this.sunDir);
    this.domeMat.uniforms.uSunGlow.value = duskF * 0.9 * (1 - rain);

    this.sunLight = clamp(0.16 + dayF * 0.84, 0, 1) * (1 - rain * 0.42) + this.flash;
    this.sunLight = clamp(this.sunLight, 0, 1.35);
    const visibility = nightLighting(dayF, this.settings.get('nightVisibility'), rain);
    u.uSun.value = this.sunLight + visibility.boost;
    u.uNightGamma.value = visibility.gamma;
    // Skylight takes on the colour of the sky so dusk really does look warm.
    const tintDay = [1.0, 0.99, 0.96], tintNight = [0.52, 0.60, 0.86], tintDusk = [1.0, 0.78, 0.62];
    let tint = lerp3(tintNight, tintDay, dayF);
    tint = lerp3(tint, tintDusk, duskF * 0.6);
    u.uSkyTint.value.set(tint[0], tint[1], tint[2]);
    u.uAmbient.value = visibility.ambient + this.flash * 0.4;
    u.uFogColor.value.set(hor[0], hor[1], hor[2]);
    this._applyFogRange(0.45, 0.94);

    const nightF = 1 - dayF;
    this.starMat.uniforms.uOpacity.value = nightF * nightF * (1 - rain);
    this.stars.rotation.z = a;

    const D = 600;
    this.sun.position.set(sx * D, sy * D, 0.18 * D);
    this.sun.lookAt(this.group.position);
    this.sunMat.opacity = clamp(dayF * 1.4, 0, 1) * (1 - rain * 0.8);
    this.moon.position.set(-sx * D, -sy * D, -0.18 * D);
    this.moon.lookAt(this.group.position);
    this.moonMat.opacity = clamp(nightF * 1.4, 0, 1) * (1 - rain * 0.8);
    const phase = ((dayNumber % 8) + 8) % 8;
    if (this.moonMat.map !== this.moonTextures[phase]) {
      this.moonMat.map = this.moonTextures[phase];
      this.moonMat.needsUpdate = true;
    }

    // Clouds always drift, wrapping by one cell so the motion never resets
    // visibly. They also take the sky's colour so they warm up at sunset.
    this.cloudOffset += dt * 0.55;
    const cloudBase = lerp3([0.42, 0.45, 0.52], [1, 1, 1], dayF);
    let cloudCol = lerp3(cloudBase, [1.0, 0.80, 0.66], duskF * 0.7);
    // Storm cloud, not white cloud — bright banks over falling rain read wrong.
    cloudCol = lerp3(cloudCol, [0.34, 0.36, 0.40], rain * 0.9);
    this.cloudMat.uniforms.uColor.value.set(cloudCol[0], cloudCol[1], cloudCol[2]);
    this.cloudMat.uniforms.uOpacity.value =
      (0.72 + rain * 0.26) * clamp(0.35 + dayF, 0, 1);

    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 4);
  }

  _applyFogRange(nearF, farF) {
    const u = this.r.uniforms;
    const far = this.r.camera.far / 1.6;
    u.uFogNear.value = far * nearF;
    u.uFogFar.value = far * farF;
  }

  lightningFlash() { this.flash = 0.55; }
}
