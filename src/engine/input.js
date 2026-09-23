// ============================================================================
// Input: pointer lock, rebindable keys, mouse look, scroll and click edges.
// The game asks "is this action down / was it just pressed" rather than reading
// raw key codes, so rebinding in the options screen works everywhere.
// ============================================================================

export class Input {
  constructor(canvas, settings) {
    this.canvas = canvas;
    this.settings = settings;
    this.down = new Set();
    this.pressed = new Set();     // edge: cleared each frame
    this.released = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
    this.locked = false;
    this.enabled = true;
    this.captureKey = null;       // callback while rebinding
    this._expectUnlock = false;
    this._lastW = 0;
    this._doubleForward = 0;
    this.sprintToggle = false;

    // --- touch layer (engine/touch.js) ---
    // Touch controls press/release named *actions* rather than key codes, so
    // rebinding never affects them and every gameplay check works unchanged.
    this.touchMode = false;       // true on touch devices: no pointer lock
    this.touchMove = null;        // analog {x, z} from the joystick, or null
    this.touchDown = new Set();
    this.touchPressed = new Set();
    this.touchReleased = new Set();
    this._tapQueue = [];          // actions to auto-release next frame

    addEventListener('keydown', (e) => this._onKey(e, true), { capture: true });
    addEventListener('keyup', (e) => this._onKey(e, false), { capture: true });
    addEventListener('mousedown', (e) => this._onMouse(e, true));
    addEventListener('mouseup', (e) => this._onMouse(e, false));
    // Only steal the wheel for the hotbar while the player is actually playing.
    // An open screen keeps the pointer lock, and swallowing the wheel there
    // meant its lists could not be scrolled at all.
    addEventListener('wheel', (e) => {
      if (!this.locked || !this.enabled) return;
      this.wheel += Math.sign(e.deltaY);
      e.preventDefault();
    }, { passive: false });
    addEventListener('mousemove', (e) => {
      // Collected whenever the pointer is locked, even with look disabled: the
      // inventory keeps the lock and drives its own cursor from these deltas.
      if (!this.locked) return;
      this.mouseDX += e.movementX || 0;
      this.mouseDY += e.movementY || 0;
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) {
        this.down.clear();
        // Only an *unexpected* unlock (Esc, alt-tab, focus loss) should pause.
        // Opening chat or a container releases the lock on purpose, and the
        // event arrives asynchronously, so the intent has to be recorded.
        const deliberate = this._expectUnlock;
        this._expectUnlock = false;
        if (!deliberate) this.onUnlock?.();
      }
    });
    document.addEventListener('pointerlockerror', () => { this.locked = false; });
    addEventListener('blur', () => this.down.clear());
    addEventListener('contextmenu', (e) => { if (this.locked) e.preventDefault(); });
  }

  requestLock() {
    // Touch devices have no pointer to lock; asking anyway throws in some
    // browsers and pops a permissions banner in others.
    if (this.touchMode) return;
    this._expectUnlock = false;
    if (this.locked) return;
    const p = this.canvas.requestPointerLock?.({ unadjustedMovement: true });
    if (p && p.catch) p.catch(() => this.canvas.requestPointerLock());
  }
  /** Release the pointer on purpose — this will not trigger onUnlock. */
  exitLock() {
    if (!this.locked) return;
    this._expectUnlock = true;
    document.exitPointerLock();
  }

  /**
   * Mark the next unlock as deliberate without asking for one. Escape always
   * releases the pointer at the browser's insistence; this stops that from
   * being mistaken for the player alt-tabbing away and pausing the game.
   */
  expectUnlock() { this._expectUnlock = true; }

  /** Consume the raw pointer delta without the look-sensitivity scaling. */
  takeRawDelta() {
    const d = [this.mouseDX, this.mouseDY];
    this.mouseDX = 0; this.mouseDY = 0;
    return d;
  }

  _onKey(e, isDown) {
    if (this.captureKey && isDown) {
      e.preventDefault(); e.stopPropagation();
      const cb = this.captureKey; this.captureKey = null;
      cb(e.code === 'Escape' ? null : e.code);
      return;
    }
    // Let the browser handle typing in text fields.
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    const code = e.code;
    // While playing, swallow browser accelerators. Ctrl is the sprint key, and
    // Ctrl+D would otherwise pop the bookmark dialog mid-run. F11/F12 and the
    // devtools chord stay live so the browser is never trapped.
    if (this.locked && isDown) {
      const reserved = code === 'F11' || code === 'F12' ||
        (e.ctrlKey && e.shiftKey) || e.metaKey;
      if (!reserved) e.preventDefault();
    } else if (code === 'F3' || code === 'F5' || (code === 'Tab' && this.locked)) {
      e.preventDefault();
    }
    if (isDown) {
      if (!this.down.has(code)) this.pressed.add(code);
      this.down.add(code);
      // Double-tap forward to sprint — but only on a genuine press. The OS
      // repeats keydown every few tens of milliseconds while a key is held, so
      // counting repeats as taps latched sprint on after half a second of
      // walking and never let go, which made walking feel like sprinting and
      // left the sprint key with nothing to do.
      if (!e.repeat && code === this.settings.keyFor('forward')) {
        const now = performance.now();
        if (now - this._lastW < 260) this.sprintToggle = true;
        this._lastW = now;
      }
    } else {
      this.down.delete(code);
      this.released.add(code);
      if (code === this.settings.keyFor('forward')) this.sprintToggle = false;
    }
  }

  _onMouse(e, isDown) {
    if (this.captureKey && isDown) {
      const cb = this.captureKey; this.captureKey = null;
      cb('Mouse' + e.button);
      e.preventDefault();
      return;
    }
    if (!this.locked) return;
    const code = 'Mouse' + e.button;
    if (isDown) {
      if (!this.down.has(code)) this.pressed.add(code);
      this.down.add(code);
    } else {
      this.down.delete(code);
      this.released.add(code);
    }
  }

  isDown(action) {
    if (this.touchDown.has(action)) return true;
    const c = this.settings.keyFor(action);
    return !!c && this.down.has(c);
  }
  justPressed(action) {
    if (this.touchPressed.has(action)) return true;
    const c = this.settings.keyFor(action);
    return !!c && this.pressed.has(c);
  }
  justReleased(action) {
    if (this.touchReleased.has(action)) return true;
    const c = this.settings.keyFor(action);
    return !!c && this.released.has(c);
  }

  // --- touch action edges ---------------------------------------------------
  touchPress(action) {
    if (!this.touchDown.has(action)) this.touchPressed.add(action);
    this.touchDown.add(action);
  }
  touchRelease(action) {
    if (this.touchDown.delete(action)) this.touchReleased.add(action);
  }
  /** One-frame press + release on the following frame (a screen tap). */
  touchTap(action) {
    this.touchPressed.add(action);
    this.touchDown.add(action);
    this._tapQueue.push(action);
  }
  rawDown(code) { return this.down.has(code); }
  rawPressed(code) { return this.pressed.has(code); }

  /** Consume the accumulated mouse delta, scaled by the sensitivity slider. */
  takeLook() {
    const s = 0.0006 + this.settings.get('sensitivity') * 0.0038;
    const dx = this.mouseDX * s, dy = this.mouseDY * s;
    this.mouseDX = 0; this.mouseDY = 0;
    return this.enabled ? [dx, dy] : [0, 0];
  }
  /** True when the camera should follow pointer/touch deltas. */
  looking() { return this.locked || this.touchMode; }
  takeWheel() { const w = this.wheel; this.wheel = 0; return w; }

  endFrame() {
    this.pressed.clear();
    this.released.clear();
    this.touchPressed.clear();
    this.touchReleased.clear();
    // Taps release on the frame after they pressed, so "justReleased" fires.
    for (const a of this._tapQueue) {
      this.touchDown.delete(a);
      this.touchReleased.add(a);
    }
    this._tapQueue.length = 0;
  }
}
