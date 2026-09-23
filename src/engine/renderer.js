// ============================================================================
// Three.js setup + the chunk shader.
//
// Chunk geometry carries baked per-vertex data (AO * face shade * biome tint in
// aColor, sky/block light in aLight, animation frame count in aAnim) so the
// fragment shader is a handful of multiplies and the whole world renders in
// three draw calls per chunk at most.
// ============================================================================

import * as THREE from 'three';
import { paintAtlas, paintCrackStrip, ATLAS_TILES } from './atlas.js';
import { PostFX } from './postfx.js';
import { PASS_COUNT } from '../constants.js';

const VERT = /* glsl */`
attribute vec3 aColor;
attribute vec2 aLight;
attribute float aAnim;      // packed: animation frame count + wave class * 32

uniform float uAnimFrame;
uniform float uTileStep;
uniform float uTime;
uniform float uWaveAmount;  // 0 disables all vertex animation

varying vec2 vUv;
varying vec3 vColor;
varying vec2 vLight;
varying float vFogDepth;
varying vec3 vWorld;

void main() {
  vColor = aColor;
  vLight = aLight;

  float frames = mod(aAnim, 32.0);
  float wave = floor(aAnim * 0.03125);

  float f = frames > 1.5 ? floor(mod(uAnimFrame, frames)) : 0.0;
  vUv = uv + vec2(f * uTileStep, 0.0);

  vec3 p = position;
  if (uWaveAmount > 0.0 && wave > 0.5) {
    float ph = p.x * 0.72 + p.z * 0.61 + p.y * 0.21;
    if (wave < 2.5) {
      // leaves rustle gently, loose plants sway harder
      float amp = (wave < 1.5 ? 0.020 : 0.055) * uWaveAmount;
      p.x += sin(uTime * 1.9 + ph) * amp;
      p.z += cos(uTime * 1.5 + ph * 1.3) * amp;
    } else {
      // water swell: two offset sines so the surface never looks periodic
      p.y += (sin(uTime * 1.3 + ph) * 0.045 + sin(uTime * 2.2 + ph * 1.7) * 0.025) * uWaveAmount;
    }
  }

  vWorld = p;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vFogDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */`
precision highp float;

uniform sampler2D uAtlas;
uniform float uSun;
uniform vec3 uSkyTint;
uniform vec3 uBlockTint;
uniform float uAmbient;
uniform float uGamma;
uniform float uNightGamma;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform float uAlphaTest;
uniform float uOpacity;
uniform float uFogEnabled;
uniform vec3 uSunDir;        // world-space direction towards the sun
uniform vec3 uSunColor;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform float uDirect;       // strength of the directional sun term
uniform float uTime;
#ifdef WATER
uniform float uReflect;      // per-material: 0 turns water reflections off
#endif

varying vec2 vUv;
varying vec3 vColor;
varying vec2 vLight;
varying float vFogDepth;
varying vec3 vWorld;

void main() {
  vec4 tex = texture2D(uAtlas, vUv);
  if (tex.a < uAlphaTest) discard;

  // Flat face normal recovered from screen-space derivatives â€” exact for voxel
  // faces and free, versus shipping a normal attribute for every vertex.
  vec3 N = normalize(cross(dFdx(vWorld), dFdy(vWorld)));

  float sky = vLight.x * uSun;
  float blk = vLight.y;

  // Directional shading modulates the baked light rather than adding to it, so
  // faces turned towards the sun gain contrast without lifting the whole scene.
  float ndl = max(0.0, dot(N, uSunDir));
  float shade = 1.0 - uDirect * 0.5 + ndl * uDirect * uSun;

  vec3 lit = max(uSkyTint * sky * shade, uBlockTint * blk * blk);
  lit = max(lit, vec3(uAmbient));

  vec3 col = tex.rgb * vColor * lit;
  float alpha = tex.a * uOpacity;

#ifdef WATER
  vec3 V = normalize(cameraPosition - vWorld);
  if (uReflect > 0.0) {
  // ripple the normal so reflections and glints break up across the surface
  float rx = sin(vWorld.x * 2.1 + uTime * 1.7) * 0.07 + sin(vWorld.z * 1.3 - uTime * 1.1) * 0.05;
  float rz = cos(vWorld.z * 2.3 + uTime * 1.4) * 0.07 + cos(vWorld.x * 1.1 + uTime * 0.9) * 0.05;
  vec3 Nw = normalize(N + vec3(rx, 0.0, rz));
  if (dot(Nw, V) < 0.0) Nw = -Nw;

  float fres = pow(1.0 - clamp(dot(Nw, V), 0.0, 1.0), 4.0);
  vec3 R = reflect(-V, Nw);
  vec3 skyRefl = mix(uHorizon, uZenith, clamp(R.y * 0.5 + 0.5, 0.0, 1.0));
  col = mix(col, skyRefl * (0.35 + uSun * 0.75), fres * 0.8 * max(0.25, vLight.x));

  float spec = pow(max(0.0, dot(reflect(-uSunDir, Nw), V)), 80.0);
  col += uSunColor * spec * uSun * 1.6 * vLight.x;

  alpha = mix(alpha, 1.0, fres * 0.55);
  }
#endif

  col = pow(col, vec3(1.0 / (1.0 + uGamma + uNightGamma)));

  float fogF = uFogEnabled * smoothstep(uFogNear, uFogFar, vFogDepth);
  col = mix(col, uFogColor, fogF);

  gl_FragColor = vec4(col, alpha);
}
`;

export class Renderer {
  constructor(canvas, settings) {
    this.settings = settings;
    this.canvas = canvas;
    // Internal resolution multiplier (the Render Scale option). Below 1 the
    // frame renders smaller and the GPU scales it up — the single biggest
    // lever on fill-rate-bound machines, which is most laptops and phones.
    this.renderScale = settings ? (settings.get('renderScale') || 1) : 1;
    // Directional-sun multiplier owned by the active shader pack; the sky
    // folds it into uDirect every frame (see engine/shaderpacks.js).
    this.packDirect = 1;
    this.three = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.three.setPixelRatio(this._pixelRatio());
    this.three.setClearColor(0x87ceeb, 1);
    this.three.autoClear = true;
    this.three.sortObjects = true;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.08, 1600);
    this.camera.rotation.order = 'YXZ';

    // Separate scene layer for the first-person held item so it never clips.
    this.handScene = new THREE.Scene();
    this.handCamera = new THREE.PerspectiveCamera(70, 1, 0.01, 12);

    // Entity and item meshes carry their directional shading in a baked vertex
    // colour (see engine/shading.js) rather than relying on scene lights, so
    // they match the chunk shader exactly and never drift with three's version.

    // --- atlas -------------------------------------------------------------
    const atlasCanvas = paintAtlas();
    this.atlasCanvas = atlasCanvas;
    const tex = new THREE.CanvasTexture(atlasCanvas);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;   // mipmaps off: zero cross-tile bleed
    tex.generateMipmaps = false;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    this.atlas = tex;

    const crackCanvas = paintCrackStrip();
    const ctex = new THREE.CanvasTexture(crackCanvas);
    ctex.magFilter = THREE.NearestFilter;
    ctex.minFilter = THREE.NearestFilter;
    ctex.generateMipmaps = false;
    this.crackTex = ctex;

    // --- shared uniforms ---------------------------------------------------
    this.uniforms = {
      uAtlas: { value: tex },
      uSun: { value: 1 },
      uSkyTint: { value: new THREE.Vector3(1, 1, 1) },
      uBlockTint: { value: new THREE.Vector3(1.0, 0.80, 0.55) },
      uAmbient: { value: 0.075 },
      uGamma: { value: 0 },
      uNightGamma: { value: 0 },
      uFogColor: { value: new THREE.Vector3(0.53, 0.72, 0.95) },
      uFogNear: { value: 40 },
      uFogFar: { value: 140 },
      uAnimFrame: { value: 0 },
      uTileStep: { value: 1 / ATLAS_TILES },
      uFogEnabled: { value: 1 },
      uTime: { value: 0 },
      uWaveAmount: { value: 1 },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Vector3(1.0, 0.95, 0.82) },
      uZenith: { value: new THREE.Vector3(0.22, 0.42, 0.86) },
      uHorizon: { value: new THREE.Vector3(0.62, 0.78, 0.96) },
      uDirect: { value: 0.46 },
    };

    const mk = (o) => new THREE.ShaderMaterial({
      uniforms: { ...this.uniforms, uAlphaTest: { value: o.alphaTest }, uOpacity: { value: o.opacity ?? 1 } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      defines: o.defines || {},
      transparent: o.transparent ?? false,
      depthWrite: o.depthWrite ?? true,
      side: o.side ?? THREE.FrontSide,
    });

    this.materials = [
      mk({ alphaTest: 0.0 }),                                              // OPAQUE
      mk({ alphaTest: 0.5 }),                                              // CUTOUT
      mk({ alphaTest: 0.02, transparent: true, side: THREE.DoubleSide }),  // LIQUID
      mk({                                                                 // WATER
        alphaTest: 0.02, transparent: true, side: THREE.DoubleSide,
        opacity: 0.82, defines: { WATER: '' },
      }),
    ];
    // Keep the shared uniform objects identical across materials, then give the
    // water pass its own reflection toggle.
    for (const m of this.materials) {
      for (const k of Object.keys(this.uniforms)) m.uniforms[k] = this.uniforms[k];
    }
    this.materials[3].uniforms.uReflect = { value: 1 };

    // Block highlight wireframe
    const hgeo = new THREE.BoxGeometry(1.002, 1.002, 1.002);
    this.highlight = new THREE.LineSegments(
      new THREE.EdgesGeometry(hgeo),
      new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55, depthTest: true })
    );
    this.highlight.visible = false;
    this.highlight.renderOrder = 5;
    this.scene.add(this.highlight);

    // Breaking overlay cube
    this.crackMat = new THREE.MeshBasicMaterial({
      map: ctex, transparent: true, depthWrite: false, polygonOffset: true,
      polygonOffsetFactor: -2, polygonOffsetUnits: -2, opacity: 0.85,
    });
    this.crack = new THREE.Mesh(new THREE.BoxGeometry(1.004, 1.004, 1.004), this.crackMat);
    this.crack.visible = false;
    this.crack.renderOrder = 6;
    this.scene.add(this.crack);
    this._crackStage = -1;

    this.postfx = new PostFX(this.three);
    this.postfx.enabled = settings ? settings.get('bloom') !== false : true;

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  /** UV-shift the crack cube onto one of the 10 damage stages. */
  setCrackStage(stage) {
    if (stage === this._crackStage) return;
    this._crackStage = stage;
    const geo = this.crack.geometry;
    const uv = geo.attributes.uv;
    if (!geo.userData.baseUV) geo.userData.baseUV = uv.array.slice();
    const base = geo.userData.baseUV;
    const step = 1 / 10;
    for (let i = 0; i < uv.count; i++) {
      uv.array[i * 2] = base[i * 2] * step + stage * step;
      uv.array[i * 2 + 1] = base[i * 2 + 1];
    }
    uv.needsUpdate = true;
  }

  /** Device pixel ratio, capped, then scaled by the Render Scale option. */
  _pixelRatio() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    return Math.max(0.35, Math.min(2.5, dpr * (this.renderScale || 1)));
  }

  setRenderScale(scale) {
    const s = Math.max(0.5, Math.min(1.5, scale || 1));
    if (s === this.renderScale) return;
    this.renderScale = s;
    this.resize();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.three.setPixelRatio(this._pixelRatio());
    this.three.setSize(w, h, false);
    if (this.postfx) this.postfx.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.handCamera.aspect = w / h;
    this.handCamera.updateProjectionMatrix();
    if (this.postfx) this.postfx.setCamera(this.camera);
    this.applyGuiScale();
  }

  /**
   * The pixel-art UI is sized from one CSS variable. Auto keeps it chunky but
   * readable at any window size; a fixed scale pins it, like Minecraft's own
   * GUI Scale option, and is clamped so the HUD can never exceed the viewport.
   */
  applyGuiScale() {
    const w = window.innerWidth, h = window.innerHeight;
    const auto = Math.max(1.6, Math.min(4.2, Math.min(w / 460, h / 300)));
    const pick = this.settings ? this.settings.get('guiScale') : 0;
    // The widest fixed element is the ~220-unit menu column.
    const maxUnit = Math.max(1.2, Math.min(w / 232, h / 200));
    const unit = !pick ? auto : Math.min(pick * 1.5, maxUnit);
    document.documentElement.style.setProperty('--ui', unit.toFixed(2) + 'px');
  }

  setFov(deg) {
    this.baseFov = deg;
    this.camera.fov = deg;
    this.camera.updateProjectionMatrix();
    // The hand camera deliberately keeps the base FOV: letting the held item
    // stretch with the sprint zoom looks like the arm is being pulled away.
    this.handCamera.fov = deg;
    this.handCamera.updateProjectionMatrix();
    if (this.postfx) this.postfx.setCamera(this.camera);
  }

  /**
   * Sprinting widens the view a little, which is what sells the speed. The
   * value eases in and out so it never snaps.
   */
  setFovBoost(boost) {
    const base = this.baseFov ?? this.camera.fov;
    const want = base + boost;
    if (Math.abs(this.camera.fov - want) < 0.01) return;
    this.camera.fov = want;
    this.camera.updateProjectionMatrix();
    if (this.postfx) this.postfx.setCamera(this.camera);
  }

  setRenderDistance(chunks) {
    const far = Math.max(64, chunks * 16 + 40);
    this.camera.far = far * 1.6;
    this.camera.updateProjectionMatrix();
    if (this.postfx) this.postfx.setCamera(this.camera);
    this.uniforms.uFogFar.value = far * 0.94;
    this.uniforms.uFogNear.value = far * 0.45;
  }

  /** @param opts.time seconds, @param opts.underwater 0..1 */
  render(opts = {}) {
    const post = this.postfx && this.postfx.enabled;
    const target = post ? this.postfx.sceneRT : null;

    this.three.setRenderTarget(target);
    this.three.autoClear = true;
    this.three.clear();
    this.three.render(this.scene, this.camera);
    // Ambient occlusion is read off the world's depth, so it has to be built
    // here — the hand pass below clears depth and would leave nothing to read.
    if (post) {
      this.postfx.renderAO();
      this.three.setRenderTarget(target);
    }
    // The held item lives in its own scene with a near clip plane, so it can
    // never poke through walls; clear depth between the two.
    this.three.autoClear = false;
    this.three.clearDepth();
    this.three.render(this.handScene, this.handCamera);
    this.three.autoClear = true;
    this.three.setRenderTarget(null);

    if (post) {
      // The hand covers world pixels whose occlusion is already in the buffer;
      // clear it there or the AO shows through the arm.
      this.postfx.maskHand(this.handScene, this.handCamera);
      this.postfx.composite(opts.time || 0, opts.underwater || 0);
    }
  }
}

/** Build a THREE.BufferGeometry from a mesher pass payload. */
export function geometryFromPass(p) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(p.position, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(p.uv, 2));
  g.setAttribute('aColor', new THREE.BufferAttribute(p.color, 3, true));
  g.setAttribute('aLight', new THREE.BufferAttribute(p.light, 2, true));
  g.setAttribute('aAnim', new THREE.BufferAttribute(p.anim, 1, false));
  g.setIndex(new THREE.BufferAttribute(p.index, 1));
  g.computeBoundingSphere();
  return g;
}

export { PASS_COUNT, THREE };



