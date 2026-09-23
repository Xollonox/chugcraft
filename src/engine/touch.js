// ============================================================================
// Touch controls: a floating movement joystick, drag-to-look, tap-to-place,
// hold-to-mine, and a handful of on-screen buttons (jump, sneak, drop, pause,
// inventory). Modelled on Minecraft Pocket Edition's defaults.
//
// Everything funnels through the same Input action layer the keyboard uses:
// the joystick writes an analog vector the player reads directly, and buttons
// press/release named actions, so every gameplay system works unmodified.
// ============================================================================

import { GAMEMODE, PLAYER } from '../constants.js';

const $ = (id) => document.getElementById(id);

/** Best-effort "is this a touch-first device". The setting can override it. */
export function isTouchDevice() {
  const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  return (navigator.maxTouchPoints || 0) > 0 && (coarse || 'ontouchstart' in window);
}

// A real finger tap on a phone routinely lasts 250-320ms, so the old 240ms
// window quietly threw away a lot of taps -- which is why attacking by tapping
// felt like it did not work at all. Anything under this and not dragged counts.
const TAP_TIME = 350;        // ms: shorter is a tap (place/use)
const HOLD_TIME = 380;      // ms: past the tap window, a steady finger starts mining
const TAP_SLOP = 14;         // px of movement before a tap stops being a tap
const LOOK_GAIN = 2.4;       // touch px -> equivalent mouse px

export class TouchControls {
  constructor(game) {
    this.game = game;
    this.input = game.input;
    this.settings = game.settings;
    this.root = $('touch-ui');
    this.enabled = false;
    this._shown = false;
    this._stick = null;        // active joystick touch
    this._look = null;         // active look/aim touch
    this._sneakOn = false;
    this._sprintLatch = false;

    this._bind();
    this.refresh();
    this.settings.onChange('touchControls', () => this.refresh());
  }

  /** Re-evaluate the Auto/ON/OFF setting against the device. */
  refresh() {
    const mode = this.settings.get('touchControls') ?? 0;
    this.enabled = mode === 1 || (mode === 0 && isTouchDevice());
    this.input.touchMode = this.enabled;
    document.body.classList.toggle('touch-mode', this.enabled);
    if (!this.enabled) this._releaseAll();
  }

  /** Called once per frame: the overlay only exists while actually playing. */
  update() {
    const g = this.game;
    const show = this.enabled && g.state === 'playing' &&
      !g.containers.open && !g.hud.chatOpen && !g.sleep;
    if (show !== this._shown) {
      this._shown = show;
      this.root.classList.toggle('hidden', !show);
      if (!show) this._releaseAll();
    }
    // Promote a steady press into mining once it has been held long enough.
    const lk = this._look;
    if (lk && !lk.mining && !lk.dragged &&
        performance.now() - lk.t0 > HOLD_TIME) {
      lk.mining = true;
      this.input.touchPress('attack');
    }
  }

  _releaseAll() {
    if (this._look?.mining) this.input.touchRelease('attack');
    this._look = null;
    this._stick = null;
    this.input.touchMove = null;
    for(const action of ['jump','attack','use'])this.input.touchRelease(action);
    this.input.touchPressed.clear();this.input._tapQueue.length=0;
    if(this.game.player){this.game.player.blocking=false;this.game.player.bowCharge=0;}
    this.game.bowHold=0;this.game.eatHold=0;this.game.drinkHold=0;
    this.root.querySelectorAll('.active').forEach(el=>el.classList.remove('active'));
    if (this._sneakOn) { this._sneakOn = false; this.input.touchRelease('sneak'); }
    this.input.sprintToggle = false;
    this._sprintLatch = false;
    $('tb-sneak')?.classList.remove('active');
    const base = $('touch-stick-base');
    if (base) base.classList.remove('active');
  }

  // ---------------------------------------------------------------------------
  _bind() {
    const zone = $('touch-stick-zone');
    const base = $('touch-stick-base');
    const knob = $('touch-stick-knob');
    const look = $('touch-look');

    // --- movement joystick (floating: it appears where the thumb lands) -----
    zone.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (this._stick) return;
      const t = e.changedTouches[0];
      this._stick = { id: t.identifier, x: t.clientX, y: t.clientY };
      const bounds=zone.getBoundingClientRect();
      base.style.left = (t.clientX-bounds.left) + 'px';
      base.style.top = (t.clientY-bounds.top) + 'px';
      base.classList.add('active');
      knob.style.transform = 'translate(-50%, -50%)';
    }, { passive: false });

    zone.addEventListener('touchmove', (e) => {
      e.preventDefault();
      const st = this._stick;
      if (!st) return;
      for (const t of e.changedTouches) {
        if (t.identifier !== st.id) continue;
        const r = Math.max(40, base.clientWidth / 2);
        let dx = (t.clientX - st.x) / r;
        let dy = (t.clientY - st.y) / r;
        const len = Math.hypot(dx, dy);
        if (len > 1) { dx /= len; dy /= len; }
        this.input.touchMove = { x: dx, z: dy };   // up on the stick = forward
        knob.style.transform =
          `translate(calc(-50% + ${(dx * r).toFixed(1)}px), calc(-50% + ${(dy * r).toFixed(1)}px))`;
        // Pushing hard forward latches sprint, easing off releases it.
        if (dy < -0.88 && len > 0.9) {
          if (!this._sprintLatch) { this._sprintLatch = true; this.input.sprintToggle = true; }
        } else if (this._sprintLatch && (len < 0.72 || dy > -0.45)) {
          this._sprintLatch = false;
          this.input.sprintToggle = false;
        }
      }
    }, { passive: false });

    const endStick = (e) => {
      e.preventDefault();
      const st = this._stick;
      if (!st) return;
      for (const t of e.changedTouches) {
        if (t.identifier !== st.id) continue;
        this._stick = null;
        this.input.touchMove = null;
        this.input.sprintToggle = false;
        this._sprintLatch = false;
        base.classList.remove('active');
        knob.style.transform = 'translate(-50%, -50%)';
      }
    };
    zone.addEventListener('touchend', endStick, { passive: false });
    zone.addEventListener('touchcancel', endStick, { passive: false });

    // --- look / aim / tap-place / hold-mine ---------------------------------
    look.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (this._look) return;
      const t = e.changedTouches[0];
      this._look = {
        id: t.identifier, x: t.clientX, y: t.clientY,
        t0: performance.now(), moved: 0, dragged: false, mining: false,
      };
    }, { passive: false });

    look.addEventListener('touchmove', (e) => {
      e.preventDefault();
      const lk = this._look;
      if (!lk) return;
      for (const t of e.changedTouches) {
        if (t.identifier !== lk.id) continue;
        const dx = t.clientX - lk.x, dy = t.clientY - lk.y;
        lk.x = t.clientX; lk.y = t.clientY;
        lk.moved += Math.abs(dx) + Math.abs(dy);
        if (lk.moved > TAP_SLOP) lk.dragged = true;
        // Feed the same accumulator the mouse uses; sensitivity applies there.
        this.input.mouseDX += dx * LOOK_GAIN;
        this.input.mouseDY += dy * LOOK_GAIN;
      }
    }, { passive: false });

    const endLook = (e) => {
      e.preventDefault();
      const lk = this._look;
      if (!lk) return;
      for (const t of e.changedTouches) {
        if (t.identifier !== lk.id) continue;
        this._look = null;
        const heldFor = performance.now() - lk.t0;
        if (lk.mining) this.input.touchRelease('attack');
        // Two things used to eat taps here: a fixed 240ms window (real taps
        // routinely run longer), and mining kicking in during a long frame
        // while the finger was already lifting. So a press that never started
        // mining is a tap whatever its duration, and one that did is still a
        // tap if the finger was genuinely only down for a moment.
        if (!lk.dragged && (!lk.mining || heldFor <= TAP_TIME)) {
          // A tap on a mob hits it; a tap on the world places/uses. Without
          // this split, tapping an animal tried to place a block against it
          // and nothing could ever be attacked by tapping.
          this.input.touchTap(this._entityInReach() ? 'attack' : 'use');
        }
      }
    };
    look.addEventListener('touchend', endLook, { passive: false });
    look.addEventListener('touchcancel', () => this._releaseAll(), { passive: false });

    // --- buttons -------------------------------------------------------------
    this._holdButton($('tb-jump'), 'jump');
    this._holdButton($('tb-attack'),'attack');
    this._holdButton($('tb-use'),'use');
    this._tapButton($('tb-swap'),()=>this.game.swapOffhand());
    addEventListener('blur',()=>this._releaseAll());
    document.addEventListener('visibilitychange',()=>{if(document.hidden)this._releaseAll();});

    this._tapButton($('tb-sneak'), () => {
      this._sneakOn = !this._sneakOn;
      $('tb-sneak').classList.toggle('active', this._sneakOn);
      if (this._sneakOn) this.input.touchPress('sneak');
      else this.input.touchRelease('sneak');
    });

    this._tapButton($('tb-drop'), () => this.game.dropHeld(false));

    this._tapButton($('tb-pause'), () => {
      if (this.game.state === 'playing') this.game.pause();
    });

    // --- hotbar ---------------------------------------------------------------
    // The hotbar lives in the HUD, underneath the full-screen look layer, so
    // taps on it never reached it. Handle them here and stop the tap from
    // falling through to the look/aim layer behind.
    const hotbar = $('hotbar');
    if (hotbar) {
      hotbar.addEventListener('touchstart', (e) => {
        const slot = e.target.closest && e.target.closest('.slot');
        if (!slot) return;
        e.preventDefault();
        e.stopPropagation();
        const g = this.game;
        if (g.state !== 'playing' || !g.player || g.containers.open) return;
        g.player.inventory.selected = Number(slot.dataset.i);
        g.player.inventory.changed?.();
        g.audio.play('click', { volume: 0.25 });
      }, { passive: false });
    }

    this._tapButton($('tb-inv'), () => {
      const g = this.game;
      if (g.state !== 'playing' || !g.player) return;
      if (g.containers.open) { g.containers.close(); return; }
      if (g.player.gamemode === GAMEMODE.CREATIVE) g.openContainer('creative');
      else g.openContainer('inventory');
    });
  }

  /** Whatever mob/crystal the crosshair is on, within arm's reach. */
  _entityInReach() {
    const g = this.game;
    if (g.state !== 'playing' || !g.player) return null;
    try { return g.pickEntity(PLAYER.REACH); } catch { return null; }
  }

  /** Press-and-hold button bound to a named input action. */
  _holdButton(el, action) {
    if (!el) return;
    el.addEventListener('touchstart', (e) => {
      e.preventDefault();
      el.classList.add('active');
      this.input.touchPress(action);
    }, { passive: false });
    const end = (e) => {
      e.preventDefault();
      el.classList.remove('active');
      this.input.touchRelease(action);
    };
    el.addEventListener('touchend', end, { passive: false });
    el.addEventListener('touchcancel', end, { passive: false });
  }

  /** Simple tap button with pressed styling. */
  _tapButton(el, fn) {
    if (!el) return;
    el.addEventListener('touchstart', (e) => {
      e.preventDefault();
      el.classList.add('active');
    }, { passive: false });
    el.addEventListener('touchend', (e) => {
      e.preventDefault();
      el.classList.remove('active');
      fn();
    }, { passive: false });
    el.addEventListener('touchcancel', (e) => {
      e.preventDefault();
      el.classList.remove('active');
    }, { passive: false });
  }
}
