// ============================================================================
// Persisted options + key bindings. Every entry here is wired to something the
// game actually reads each frame â€” there are no decorative sliders.
// ============================================================================

const STORAGE_KEY = 'craftverse.settings.v1';

export const DEFAULT_KEYS = {
  forward: 'KeyW',
  back: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  jump: 'Space',
  sneak: 'ShiftLeft',
  sprint: 'ControlLeft',
  inventory: 'KeyE',
  drop: 'KeyQ',
  perspective: 'F5',
  debug: 'F3',
  advancements: 'KeyL',
  offhand: 'KeyF',
  chat: 'Slash',
  attack: 'Mouse0',
  use: 'Mouse2',
  pick: 'Mouse1',
  hotbar1: 'Digit1', hotbar2: 'Digit2', hotbar3: 'Digit3',
  hotbar4: 'Digit4', hotbar5: 'Digit5', hotbar6: 'Digit6',
  hotbar7: 'Digit7', hotbar8: 'Digit8', hotbar9: 'Digit9',
};

export const KEY_LABELS = {
  forward: 'Walk Forwards', back: 'Walk Backwards', left: 'Strafe Left', right: 'Strafe Right',
  jump: 'Jump', sneak: 'Sneak', sprint: 'Sprint', inventory: 'Inventory', drop: 'Drop Item',
  perspective: 'Toggle Perspective', debug: 'Debug Screen', chat: 'Open Chat',
  advancements: 'Advancements',
  offhand: 'Swap Off Hand',
  attack: 'Attack / Destroy', use: 'Use Item / Place', pick: 'Pick Block',
  hotbar1: 'Hotbar Slot 1', hotbar2: 'Hotbar Slot 2', hotbar3: 'Hotbar Slot 3',
  hotbar4: 'Hotbar Slot 4', hotbar5: 'Hotbar Slot 5', hotbar6: 'Hotbar Slot 6',
  hotbar7: 'Hotbar Slot 7', hotbar8: 'Hotbar Slot 8', hotbar9: 'Hotbar Slot 9',
};

export const DEFAULTS = {
  guiScale: 0,          // 0 = auto-fit to the window, 1-4 = fixed multiplier
  playerName: 'Player',
  renderDistance: 8,
  fov: 70,
  sensitivity: 0.5,
  cursorSpeed: 0.5,    // scale for the inventory's own pointer
  masterVolume: 0.8,
  musicVolume: 0.35,
  soundVolume: 0.9,
  gamma: 0.0,
  nightVisibility: .75, // display-only moonlight lift; 0 original, 1 brightest
  fancyLeaves: true,
  smoothLighting: true,
  ssao: true,           // screen-space contact shadows in the post chain
  particles: true,
  cloudMode: 2,         // 0 off, 1 flat sheet, 2 chunky 3D banks
  fog: true,
  bloom: true,
  waving: true,
  reflections: true,
  viewBobbing: true,
  dynamicFov: true,     // the view widens a little while sprinting
  dayLength: 20,       // minutes
  weatherEnabled: true,
  autoJump: false,
  showFps: false,
  recipeBook: true,     // recipe list shown beside the inventory
  graphicsPreset: 3,    // 0 Potato .. 4 Ultra, 5 Custom (see engine/presets.js)
  renderScale: 1,       // internal resolution multiplier, 0.5-1.5
  shaderPack: 0,        // 0 Vanilla + three looks (see engine/shaderpacks.js)
  touchControls: 0,     // 0 auto-detect, 1 always on, 2 always off
  subtitles: false,     // accessibility captions for sounds
};

export class Settings {
  constructor() {
    this.values = { ...DEFAULTS };
    this.keys = { ...DEFAULT_KEYS };
    this.listeners = new Map();
    this.load();
  }

  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const o = JSON.parse(raw);
      if (o.values) Object.assign(this.values, o.values);
      if (o.keys) Object.assign(this.keys, o.keys);
    } catch { /* corrupt settings shouldn't stop the game booting */ }
  }

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ values: this.values, keys: this.keys }));
    } catch { /* private mode */ }
  }

  get(k) { return this.values[k]; }
  set(k, v) {
    if (this.values[k] === v) return;
    this.values[k] = v;
    this.save();
    const ls = this.listeners.get(k);
    if (ls) for (const f of ls) f(v);
  }
  onChange(k, fn) {
    if (!this.listeners.has(k)) this.listeners.set(k, []);
    this.listeners.get(k).push(fn);
  }

  keyFor(action) { return this.keys[action]; }
  setKey(action, code) { this.keys[action] = code; this.save(); }
  resetKeys() { this.keys = { ...DEFAULT_KEYS }; this.save(); }

  /** Actions bound to the same key, for the conflict highlight in the UI. */
  conflictsFor(action) {
    const code = this.keys[action];
    if (!code) return [];
    return Object.keys(this.keys).filter((a) => a !== action && this.keys[a] === code);
  }
}

/** Human-readable name for a KeyboardEvent.code / mouse pseudo-code. */
export function keyName(code) {
  if (!code) return 'None';
  if (code.startsWith('Mouse')) return 'Button ' + (Number(code.slice(5)) + 1);
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  const map = {
    Space: 'Space', ShiftLeft: 'L Shift', ShiftRight: 'R Shift',
    ControlLeft: 'L Ctrl', ControlRight: 'R Ctrl', AltLeft: 'L Alt', AltRight: 'R Alt',
    ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
    Escape: 'Esc', Enter: 'Enter', Tab: 'Tab', Backquote: '`', Slash: '/',
    Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\',
    Semicolon: ';', Quote: "'", Comma: ',', Period: '.', CapsLock: 'Caps',
  };
  return map[code] || code;
}



