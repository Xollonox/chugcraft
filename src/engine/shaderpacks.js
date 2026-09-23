// ============================================================================
// Shader packs: three hand-tuned looks on top of Vanilla, selectable from the
// options screen like resource-pack shaders.
//
// A pack is a recipe for the post chain (bloom strength/threshold, grade curve,
// saturation, vignette, shadow tint, a colour filter) plus a multiplier on the
// directional sun term. Nothing here adds a render pass, so switching packs is
// free — the same frame just gets graded differently.
//
// The sky rewrites uSunColor/uDirect every frame, so packs never write those
// directly; they set renderer.packDirect and sky.js multiplies it in.
// ============================================================================

export const SHADER_PACK_NAMES = ['Vanilla', 'Sunflare', 'Dreamwave', 'Nightfall'];

export const SHADER_PACKS = [
  { // Vanilla — the game's original tuning, byte for byte.
    bloom: 0.55, threshold: 0.84, soft: 0.22,
    vignette: 0.32, contrast: 1.06, saturation: 1.10,
    black: 0.025, curve: 0.30,
    shadowTint: [0.46, 0.51, 0.64], tint: [1, 1, 1],
    direct: 1.0,
    desc: 'The classic ChugCraft look.',
  },
  { // Sunflare — golden-hour warmth, punchy sun, vivid foliage.
    bloom: 0.82, threshold: 0.76, soft: 0.24,
    vignette: 0.24, contrast: 1.10, saturation: 1.26,
    black: 0.030, curve: 0.36,
    shadowTint: [0.45, 0.47, 0.60], tint: [1.06, 1.00, 0.90],
    direct: 1.35,
    desc: 'Warm, vivid, sun-drenched days.',
  },
  { // Dreamwave — soft pastel haze, heavy glow, lifted shadows.
    bloom: 1.05, threshold: 0.64, soft: 0.30,
    vignette: 0.38, contrast: 1.00, saturation: 0.94,
    black: 0.006, curve: 0.16,
    shadowTint: [0.60, 0.56, 0.72], tint: [0.98, 0.99, 1.07],
    direct: 0.70,
    desc: 'Soft, hazy and dreamlike.',
  },
  { // Nightfall — cool cinematic contrast with deep, blue shadows.
    bloom: 0.68, threshold: 0.80, soft: 0.22,
    vignette: 0.46, contrast: 1.13, saturation: 1.03,
    black: 0.050, curve: 0.46,
    shadowTint: [0.33, 0.39, 0.58], tint: [0.93, 0.98, 1.08],
    direct: 1.25,
    desc: 'Moody, cool and cinematic.',
  },
];

export function applyShaderPack(renderer, idx) {
  const p = SHADER_PACKS[idx] || SHADER_PACKS[0];
  const post = renderer.postfx;
  if (post) {
    post.bloomStrength = p.bloom;
    post.brightMat.uniforms.uThreshold.value = p.threshold;
    post.brightMat.uniforms.uSoft.value = p.soft;
    const u = post.compositeMat.uniforms;
    u.uVignette.value = p.vignette;
    u.uContrast.value = p.contrast;
    u.uSaturation.value = p.saturation;
    u.uBlack.value = p.black;
    u.uCurve.value = p.curve;
    u.uShadowTint.value.set(p.shadowTint[0], p.shadowTint[1], p.shadowTint[2]);
    u.uTint.value.set(p.tint[0], p.tint[1], p.tint[2]);
  }
  // Multiplier on the sun's directional term; sky.js folds it in per frame.
  renderer.packDirect = p.direct;
}
