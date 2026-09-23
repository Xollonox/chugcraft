// ============================================================================
// Graphics presets: one tap takes every quality knob from Potato to Ultra.
//
// A preset is just a bundle of values for the existing settings, so everything
// stays individually overridable. The moment any bundled setting is changed by
// hand the preset label flips to "Custom" (see detectPreset), exactly like the
// Fast/Fancy/Custom flow in the real thing.
// ============================================================================

export const PRESET_NAMES = ['Potato', 'Low', 'Medium', 'High', 'Ultra', 'Custom'];
export const CUSTOM_PRESET = PRESET_NAMES.length - 1;

/** Every setting a preset owns. Order matters only for readability. */
export const PRESET_KEYS = [
  'renderDistance', 'renderScale', 'ssao', 'bloom', 'reflections', 'waving',
  'fancyLeaves', 'particles', 'cloudMode', 'smoothLighting', 'fog',
];

export const PRESETS = [
  { // Potato — anything with a WebGL context should hold 60 here.
    renderDistance: 3, renderScale: 0.5, ssao: false, bloom: false,
    reflections: false, waving: false, fancyLeaves: false, particles: false,
    cloudMode: 0, smoothLighting: false, fog: true,
  },
  { // Low — smooth lighting back on; it is cheap and carries the look.
    renderDistance: 5, renderScale: 0.75, ssao: false, bloom: false,
    reflections: false, waving: false, fancyLeaves: false, particles: true,
    cloudMode: 1, smoothLighting: true, fog: true,
  },
  { // Medium — the old defaults, minus the two big post passes.
    renderDistance: 8, renderScale: 1, ssao: false, bloom: true,
    reflections: false, waving: true, fancyLeaves: true, particles: true,
    cloudMode: 1, smoothLighting: true, fog: true,
  },
  { // High — everything on at a comfortable distance.
    renderDistance: 11, renderScale: 1, ssao: true, bloom: true,
    reflections: true, waving: true, fancyLeaves: true, particles: true,
    cloudMode: 2, smoothLighting: true, fog: true,
  },
  { // Ultra — max draw distance; the fog pulls back with it.
    renderDistance: 16, renderScale: 1, ssao: true, bloom: true,
    reflections: true, waving: true, fancyLeaves: true, particles: true,
    cloudMode: 2, smoothLighting: true, fog: true,
  },
];

let applying = false;

/** True while applyPreset is mid-write, so change listeners can tell a preset
 *  apply apart from the player twiddling an individual toggle. */
export function isApplyingPreset() { return applying; }

export function applyPreset(settings, idx) {
  const p = PRESETS[idx];
  if (!p) return;
  applying = true;
  try {
    for (const k of PRESET_KEYS) settings.set(k, p[k]);
  } finally {
    applying = false;
  }
  settings.set('graphicsPreset', idx);
}

/** Which preset the current settings match exactly, or CUSTOM_PRESET. */
export function detectPreset(settings) {
  for (let i = 0; i < PRESETS.length; i++) {
    if (PRESET_KEYS.every((k) => settings.get(k) === PRESETS[i][k])) return i;
  }
  return CUSTOM_PRESET;
}
