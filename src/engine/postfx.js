// ============================================================================
// Post-processing: bloom, colour grading and vignette.
//
// The scene renders into a half-float target, bright areas are extracted and
// blurred at quarter resolution, then everything is composited in one pass.
// This is what makes lava, glowstone, torches, portals and the sun *glow*
// rather than just being bright pixels.
//
// Deliberately hand-rolled rather than using three's EffectComposer: the
// examples/jsm addons aren't part of the module build we vendor, and a bespoke
// chain is both smaller and cheaper than the general-purpose one.
// ============================================================================

import * as THREE from 'three';

const QUAD_VERT = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const BRIGHT_FRAG = /* glsl */`
precision mediump float;
uniform sampler2D uScene;
uniform float uThreshold;
uniform float uSoft;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(uScene, vUv).rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  // soft knee so surfaces don't pop in and out of the bloom as light changes
  float k = smoothstep(uThreshold, uThreshold + uSoft, l);
  gl_FragColor = vec4(c * k, 1.0);
}`;

const BLUR_FRAG = /* glsl */`
precision mediump float;
uniform sampler2D uTex;
uniform vec2 uDir;          // texel-sized step along the blur axis
varying vec2 vUv;
void main() {
  // 9-tap Gaussian, linear-sampled down to 5 fetches
  vec3 c = texture2D(uTex, vUv).rgb * 0.2270270270;
  vec2 o1 = uDir * 1.3846153846;
  vec2 o2 = uDir * 3.2307692308;
  c += texture2D(uTex, vUv + o1).rgb * 0.3162162162;
  c += texture2D(uTex, vUv - o1).rgb * 0.3162162162;
  c += texture2D(uTex, vUv + o2).rgb * 0.0702702703;
  c += texture2D(uTex, vUv - o2).rgb * 0.0702702703;
  gl_FragColor = vec4(c, 1.0);
}`;

/**
 * Screen-space ambient occlusion.
 *
 * Vertex AO only darkens a block's own corners; it knows nothing about the
 * shape of the scene around it. This adds the contact shadow you get where any
 * two surfaces meet â€” under leaves, along wall bases, inside doorways â€” which
 * is what stops a voxel world from looking like flat-shaded cardboard.
 *
 * View-space positions are reconstructed from the depth buffer, so it costs one
 * extra half-resolution pass and no extra geometry.
 */
const SSAO_FRAG = /* glsl */`
precision highp float;
uniform sampler2D uDepth;
uniform vec2 uTexel;
uniform float uNear;
uniform float uFar;
uniform float uRadius;
uniform float uStrength;
uniform float uBias;
uniform float uProjScale;   // focal length in pixels, turns a world radius into pixels
uniform vec2 uInvFocal;     // tan(fov/2) * (aspect, 1), for unprojecting
uniform float uDebug;
varying vec2 vUv;

float linearDepth(vec2 uv) {
  float z = texture2D(uDepth, uv).x * 2.0 - 1.0;
  return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear));
}

/** Screen position + depth back to a view-space point. */
vec3 viewPos(vec2 uv) {
  float d = linearDepth(uv);
  vec2 ndc = uv * 2.0 - 1.0;
  return vec3(ndc * uInvFocal * d, -d);
}

/**
 * Surface normal from two neighbouring depth samples.
 *
 * Deliberately not dFdx/dFdy: this is a RawShaderMaterial, so three prepends
 * nothing, and GLSL ES 1.00 has no derivatives without an extension that isn't
 * reliably available. The shader silently failed to link, which is why the
 * occlusion buffer came out a flat grey.
 */
vec3 normalAt(vec2 uv, vec3 P) {
  vec3 px = viewPos(uv + vec2(uTexel.x, 0.0));
  vec3 py = viewPos(uv + vec2(0.0, uTexel.y));
  vec3 n = normalize(cross(px - P, py - P));
  return n.z < 0.0 ? -n : n;      // always face the camera
}

void main() {
  float d = linearDepth(vUv);
  // uDebug: 1 shows linear depth, 2 shows the reconstructed normal. Both are
  // the fastest way to tell a broken depth attachment from a bad kernel.
  if (uDebug > 0.5 && uDebug < 1.5) { gl_FragColor = vec4(vec3(d / uFar), 1.0); return; }
  if (uDebug > 1.5) {
    gl_FragColor = vec4(normalAt(vUv, viewPos(vUv)) * 0.5 + 0.5, 1.0);
    return;
  }
  if (d >= uFar * 0.9) { gl_FragColor = vec4(1.0); return; }

  vec3 P = viewPos(vUv);
  // Comparing samples against this tangent plane is what stops a flat floor
  // seen at a glancing angle from occluding itself.
  vec3 N = normalAt(vUv, P);

  // Radius in pixels shrinks with distance so occlusion stays world-sized.
  float px = clamp(uProjScale * uRadius / d, 2.0, 40.0);

  // 12 taps on a spiral, rotated per pixel so the pattern doesn't band.
  float ang = fract(sin(dot(vUv, vec2(12.9898, 78.233))) * 43758.5453) * 6.2831853;
  float occ = 0.0;
  for (int i = 0; i < 12; i++) {
    float f = (float(i) + 0.5) / 12.0;
    float a = ang + f * 6.2831853 * 2.4;
    vec2 o = vec2(cos(a), sin(a)) * px * sqrt(f) * uTexel;
    vec3 S = viewPos(vUv + o);
    vec3 V = S - P;
    float len = length(V);
    if (len < 0.0001) continue;
    // Only geometry rising above the surface occludes it, and only within the
    // radius â€” otherwise a distant silhouette smears a halo across the sky.
    float above = max(0.0, dot(N, V / len) - uBias);
    float atten = clamp(1.0 - len / uRadius, 0.0, 1.0);
    occ += above * atten;
  }
  occ /= 12.0;
  gl_FragColor = vec4(vec3(clamp(1.0 - occ * uStrength, 0.0, 1.0)), 1.0);
}`;

/** Cross-shaped blur that keeps the AO from crossing depth discontinuities. */
const SSAO_BLUR_FRAG = /* glsl */`
precision mediump float;
uniform sampler2D uTex;
uniform vec2 uDir;
varying vec2 vUv;
void main() {
  float c = texture2D(uTex, vUv).r * 0.383;
  c += texture2D(uTex, vUv + uDir).r * 0.242;
  c += texture2D(uTex, vUv - uDir).r * 0.242;
  c += texture2D(uTex, vUv + uDir * 2.0).r * 0.0665;
  c += texture2D(uTex, vUv - uDir * 2.0).r * 0.0665;
  gl_FragColor = vec4(vec3(c), 1.0);
}`;

const COMPOSITE_FRAG = /* glsl */`
precision mediump float;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform sampler2D uAO;
uniform float uAOMix;
uniform float uDebugAO;   // 1 shows the raw occlusion buffer
uniform float uBloomStrength;
uniform float uVignette;
uniform float uContrast;
uniform float uSaturation;
uniform float uUnderwater;
uniform vec3 uUnderwaterTint;
uniform float uTime;
uniform vec3 uShadowTint;    // colour the AO/shadow end is pushed towards
uniform float uBlack;        // black point lifted down before the curve
uniform float uCurve;        // how much S-curve contrast to blend in
uniform vec3 uTint;          // shader-pack colour filter, (1,1,1) = neutral
varying vec2 vUv;

/**
 * Contrast curve.
 *
 * Deliberately not a filmic/ACES tonemap: the chunk shader already writes
 * display-referred colour, and running an HDR tone curve over that washed the
 * whole frame out — pale sky, milky sand. Instead the black point is pulled
 * down and a smoothstep S-curve deepens the shadows and rolls the highlights,
 * which is what gives the picture its shape.
 */
vec3 grade(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  c = max(c - uBlack, 0.0) / max(1e-4, 1.0 - uBlack);
  return mix(c, c * c * (3.0 - 2.0 * c), uCurve);
}

void main() {
  vec2 uv = vUv;

  // gentle refraction wobble when the camera is submerged
  if (uUnderwater > 0.0) {
    uv += vec2(
      sin(uv.y * 34.0 + uTime * 1.9) * 0.0022,
      cos(uv.x * 29.0 + uTime * 1.5) * 0.0022) * uUnderwater;
  }

  vec3 col = texture2D(uScene, uv).rgb;

  // Ambient occlusion multiplies the scene before bloom, so a glowing block
  // still spills light out of the crevice it sits in.
  float ao = mix(1.0, texture2D(uAO, uv).r, uAOMix);
  if (uDebugAO > 0.5) { gl_FragColor = vec4(vec3(texture2D(uAO, uv).r), 1.0); return; }
  col *= mix(uShadowTint, vec3(1.0), ao);

  col += texture2D(uBloom, uv).rgb * uBloomStrength;

  if (uUnderwater > 0.0) {
    col = mix(col, col * uUnderwaterTint, uUnderwater * 0.75);
  }

  col = grade(col * uContrast);
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(l), col, uSaturation);
  // Shader-pack colour filter: a gentle multiplicative grade, applied after
  // the curve so packs shift the mood without crushing or clipping anything.
  col = clamp(col * uTint, 0.0, 1.0);

  // vignette, measured from the centre in aspect-corrected space
  float d = length((vUv - 0.5) * vec2(1.0, 0.85));
  col *= 1.0 - smoothstep(0.42, 0.92, d) * uVignette;

  gl_FragColor = vec4(max(col, 0.0), 1.0);
}`;

/** Fullscreen triangle â€” cheaper than a quad and avoids the diagonal seam. */
function fullscreenTriangle() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
  return g;
}

export class PostFX {
  constructor(renderer) {
    this.renderer = renderer;
    this.enabled = true;
    // Tuned so only genuinely emissive things bloom. Lower thresholds catch the
    // daytime sky and wash the whole frame out.
    this.bloomStrength = 0.55;

    const half = renderer.capabilities.isWebGL2 ? THREE.HalfFloatType : THREE.UnsignedByteType;
    const rtOpts = {
      type: half,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
      stencilBuffer: false,
    };
    this.sceneRT = new THREE.WebGLRenderTarget(1, 1, rtOpts);
    // SSAO reads the scene's depth, so the main target grows a depth texture.
    // Leave the depth texture on its defaults: three picks a format the driver
    // will actually attach, and forcing a 16-bit type silently produced a
    // constant buffer on some stacks.
    this.sceneRT.depthTexture = new THREE.DepthTexture(1, 1);
    this.sceneRT.depthTexture.minFilter = THREE.NearestFilter;
    this.sceneRT.depthTexture.magFilter = THREE.NearestFilter;
    this.brightRT = new THREE.WebGLRenderTarget(1, 1, { ...rtOpts, depthBuffer: false });
    this.blurRT = new THREE.WebGLRenderTarget(1, 1, { ...rtOpts, depthBuffer: false });
    const aoOpts = {
      type: THREE.UnsignedByteType,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      depthBuffer: false, stencilBuffer: false,
    };
    this.aoRT = new THREE.WebGLRenderTarget(1, 1, aoOpts);
    this.aoBlurRT = new THREE.WebGLRenderTarget(1, 1, aoOpts);
    this.ssao = true;

    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.geo = fullscreenTriangle();

    this.brightMat = new THREE.RawShaderMaterial({
      uniforms: {
        uScene: { value: this.sceneRT.texture },
        uThreshold: { value: 0.84 },
        uSoft: { value: 0.22 },
      },
      vertexShader: 'attribute vec3 position;\nattribute vec2 uv;\n' + QUAD_VERT,
      fragmentShader: BRIGHT_FRAG,
      depthTest: false, depthWrite: false,
    });
    this.blurMat = new THREE.RawShaderMaterial({
      uniforms: { uTex: { value: null }, uDir: { value: new THREE.Vector2() } },
      vertexShader: 'attribute vec3 position;\nattribute vec2 uv;\n' + QUAD_VERT,
      fragmentShader: BLUR_FRAG,
      depthTest: false, depthWrite: false,
    });
    this.ssaoMat = new THREE.RawShaderMaterial({
      uniforms: {
        uDepth: { value: this.sceneRT.depthTexture },
        uTexel: { value: new THREE.Vector2() },
        uNear: { value: 0.1 },
        uFar: { value: 400 },
        uRadius: { value: 1.7 },
        uStrength: { value: 4.6 },
        uBias: { value: 0.05 },
        uProjScale: { value: 500 },
        uInvFocal: { value: new THREE.Vector2(1, 1) },
        uDebug: { value: 0 },
      },
      vertexShader: 'attribute vec3 position;\nattribute vec2 uv;\n' + QUAD_VERT,
      fragmentShader: SSAO_FRAG,
      depthTest: false, depthWrite: false,
    });
    this.ssaoBlurMat = new THREE.RawShaderMaterial({
      uniforms: { uTex: { value: null }, uDir: { value: new THREE.Vector2() } },
      vertexShader: 'attribute vec3 position;\nattribute vec2 uv;\n' + QUAD_VERT,
      fragmentShader: SSAO_BLUR_FRAG,
      depthTest: false, depthWrite: false,
    });
    this.compositeMat = new THREE.RawShaderMaterial({
      uniforms: {
        uScene: { value: this.sceneRT.texture },
        uBloom: { value: this.brightRT.texture },
        uAO: { value: this.aoRT.texture },
        uAOMix: { value: 1 },
        uDebugAO: { value: 0 },
        uBloomStrength: { value: this.bloomStrength },
        uVignette: { value: 0.32 },
        // Tone mapping compresses the top end, so the input is lifted a little
        // to land back at the same overall exposure with far more shape.
        uContrast: { value: 1.06 },
        uBlack: { value: 0.025 },
        uCurve: { value: 0.30 },
        uSaturation: { value: 1.10 },
        uUnderwater: { value: 0 },
        uUnderwaterTint: { value: new THREE.Vector3(0.35, 0.62, 1.0) },
        // Occluded areas cool off slightly rather than going flat grey, the way
        // real shadows pick up skylight.
        uShadowTint: { value: new THREE.Vector3(0.46, 0.51, 0.64) },
        uTint: { value: new THREE.Vector3(1, 1, 1) },
        uTime: { value: 0 },
      },
      vertexShader: 'attribute vec3 position;\nattribute vec2 uv;\n' + QUAD_VERT,
      fragmentShader: COMPOSITE_FRAG,
      depthTest: false, depthWrite: false,
    });

    this.quad = new THREE.Mesh(this.geo, this.compositeMat);
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.quad);
  }

  setSize(w, h) {
    const pr = this.renderer.getPixelRatio();
    const W = Math.max(1, Math.floor(w * pr));
    const H = Math.max(1, Math.floor(h * pr));
    if (W === this._w && H === this._h) return;
    this._w = W; this._h = H;
    this.sceneRT.setSize(W, H);
    const bw = Math.max(1, W >> 2), bh = Math.max(1, H >> 2);
    this.brightRT.setSize(bw, bh);
    this.blurRT.setSize(bw, bh);
    // Half resolution: AO is a low-frequency signal and the blur hides the rest.
    const aw = Math.max(1, W >> 1), ah = Math.max(1, H >> 1);
    this.aoRT.setSize(aw, ah);
    this.aoBlurRT.setSize(aw, ah);
    this.ssaoMat.uniforms.uTexel.value.set(1 / aw, 1 / ah);
  }

  /** Camera-dependent SSAO constants; called whenever the projection changes. */
  setCamera(camera) {
    const u = this.ssaoMat.uniforms;
    u.uNear.value = camera.near;
    u.uFar.value = camera.far;
    // Half the vertical resolution divided by tan(fov/2) â€” the focal length in
    // AO-buffer pixels, which is what turns a world radius into a pixel radius.
    const h = Math.max(1, this.aoRT.height);
    const tan = Math.tan((camera.fov * Math.PI / 180) / 2);
    u.uProjScale.value = (h * 0.5) / tan;
    u.uInvFocal.value.set(tan * camera.aspect, tan);
  }

  _draw(target, material) {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Build the occlusion buffer from the scene's depth.
   *
   * This has to run straight after the world is drawn and *before* the held
   * item: the hand is rendered into the same target after a depth clear, so by
   * composite time the depth buffer holds nothing but the player's arm and the
   * AO comes out uniformly white.
   */
  renderAO() {
    if (!this.ssao) return;
    const r = this.renderer;
    const prevAutoClear = r.autoClear;
    r.autoClear = true;
    this.ssaoMat.uniforms.uDepth.value = this.sceneRT.depthTexture;
    this._draw(this.aoBlurRT, this.ssaoMat);
    const aw = this.aoRT.width, ah = this.aoRT.height;
    this.ssaoBlurMat.uniforms.uTex.value = this.aoBlurRT.texture;
    this.ssaoBlurMat.uniforms.uDir.value.set(1 / aw, 0);
    this._draw(this.aoRT, this.ssaoBlurMat);
    this.ssaoBlurMat.uniforms.uTex.value = this.aoRT.texture;
    this.ssaoBlurMat.uniforms.uDir.value.set(0, 1 / ah);
    this._draw(this.aoBlurRT, this.ssaoBlurMat);
    r.autoClear = prevAutoClear;
  }

  /**
   * Punch the held item and arm out of the occlusion buffer.
   *
   * AO is built from the world's depth alone, but the composite multiplies it
   * over every pixel — including the ones the hand is drawn on top of. That
   * printed the world's occlusion onto the arm, so you appeared to see creases
   * and corners *through* whatever you were holding. Painting the hand's
   * silhouette white here means those pixels come out unoccluded.
   */
  maskHand(scene, camera) {
    if (!this.ssao || !this.enabled) return;
    const r = this.renderer;
    const swapped = [];
    scene.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      swapped.push([o, o.material]);
      o.material = this._maskMaterial(o.material);
    });
    if (!swapped.length) return;
    const prevAutoClear = r.autoClear;
    r.autoClear = false;
    r.setRenderTarget(this.aoBlurRT);
    r.render(scene, camera);
    r.autoClear = prevAutoClear;
    for (const [o, m] of swapped) o.material = m;
  }

  /**
   * A stand-in for a hand material that writes pure white. It has to keep the
   * source's texture and alpha cut-off, or a sword would stamp its whole
   * rectangular quad into the buffer instead of just the blade.
   */
  _maskMaterial(src) {
    if (!this._maskMats) this._maskMats = new WeakMap();
    let m = this._maskMats.get(src);
    if (!m) {
      m = new THREE.ShaderMaterial({
        uniforms: { uMap: { value: null }, uAlphaTest: { value: 0 }, uHasMap: { value: 0 } },
        vertexShader: /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`,
        fragmentShader: /* glsl */`
precision mediump float;
uniform sampler2D uMap;
uniform float uAlphaTest;
uniform float uHasMap;
varying vec2 vUv;
void main() {
  if (uHasMap > 0.5 && texture2D(uMap, vUv).a < uAlphaTest) discard;
  gl_FragColor = vec4(1.0);
}`,
        depthTest: false,
        depthWrite: false,
        side: src.side ?? THREE.FrontSide,
      });
      this._maskMats.set(src, m);
    }
    m.uniforms.uMap.value = src.map || null;
    m.uniforms.uHasMap.value = src.map ? 1 : 0;
    m.uniforms.uAlphaTest.value = src.alphaTest || 0;
    return m;
  }

  /** Bright-pass, blur, then composite the result to the screen. */
  composite(time, underwater) {
    const r = this.renderer;
    const prevAutoClear = r.autoClear;
    r.autoClear = true;

    this.compositeMat.uniforms.uAO.value = this.aoBlurRT.texture;
    this.compositeMat.uniforms.uAOMix.value = this.ssao ? 1 : 0;

    this.brightMat.uniforms.uScene.value = this.sceneRT.texture;
    this._draw(this.brightRT, this.brightMat);

    const bw = this.brightRT.width, bh = this.brightRT.height;
    this.blurMat.uniforms.uTex.value = this.brightRT.texture;
    this.blurMat.uniforms.uDir.value.set(1 / bw, 0);
    this._draw(this.blurRT, this.blurMat);

    this.blurMat.uniforms.uTex.value = this.blurRT.texture;
    this.blurMat.uniforms.uDir.value.set(0, 1 / bh);
    this._draw(this.brightRT, this.blurMat);

    // second, wider pass gives the glow a soft falloff instead of a hard disc
    this.blurMat.uniforms.uTex.value = this.brightRT.texture;
    this.blurMat.uniforms.uDir.value.set(2.4 / bw, 0);
    this._draw(this.blurRT, this.blurMat);
    this.blurMat.uniforms.uTex.value = this.blurRT.texture;
    this.blurMat.uniforms.uDir.value.set(0, 2.4 / bh);
    this._draw(this.brightRT, this.blurMat);

    const u = this.compositeMat.uniforms;
    u.uScene.value = this.sceneRT.texture;
    u.uBloom.value = this.brightRT.texture;
    u.uBloomStrength.value = this.bloomStrength;
    u.uTime.value = time;
    u.uUnderwater.value = underwater;
    this._draw(null, this.compositeMat);

    r.autoClear = prevAutoClear;
  }

  dispose() {
    this.sceneRT.dispose();
    this.sceneRT.depthTexture?.dispose();
    this.brightRT.dispose();
    this.blurRT.dispose();
    this.aoRT.dispose();
    this.aoBlurRT.dispose();
    this.geo.dispose();
    this.brightMat.dispose();
    this.blurMat.dispose();
    this.ssaoMat.dispose();
    this.ssaoBlurMat.dispose();
    this.compositeMat.dispose();
  }
}






