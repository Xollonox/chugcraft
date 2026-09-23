// ============================================================================
// Game loop: the fixed-ish frame loop, per-frame update, camera, and the
// first/third-person hand rendering.
//
// Split out of main.js (see game-shell.js); mixed onto Game.prototype at boot.
// ============================================================================

import * as THREE from 'three';
import { DIM, PLAYER, SEA_LEVEL } from './constants.js';
import { IS_SOLID } from './world/blocks.js';
import { POTION_EFFECTS, getItem } from './crafting/items.js';
import { ENTITY_MIN_LIGHT } from './entities/entity.js';
import {
  buildModel, animateModel, tintModel, buildNameTag, buildArm, applyArmor,
} from './entities/models.js';
import { buildItemMesh } from './engine/itemmesh.js';

export const GameLoop = {
  loop(now) {
    requestAnimationFrame((t) => this.loop(t));
    const dt = Math.min(0.1, (now - (this._last || now)) / 1000);
    this._last = now;
    try {
      this.update(dt);
      this.render(dt);
    } catch (e) {
      console.error(e);
      this.fatal(e);
    }
  },

  fatal(e) {
    const el = document.getElementById('fatal');
    if (!el.classList.contains('hidden')) return;
    el.classList.remove('hidden');
    document.getElementById('fatal-msg').textContent = (e && e.stack) || String(e);
  },

  update(dt) {
    const active = this.state === 'playing' || this.state === 'dead' || this.state === 'victory';

    if (this.state === 'menu') { this.updatePanorama(dt); return; }
    if (!this.world || !this.player) return;

    // Dimension travel runs its own streaming loop while the loading screen is
    // up, so it has to be serviced before the early-out below.
    if (this.state === 'loading') {
      this.world.update(this.player.pos.x, this.player.pos.z, 6);
      this.world.flushSets();
      this.sky.update(dt, this.renderer.camera, this.timeOfDay, this.dayNumber);
      if (this.arrival) this.updateArrival(dt);
      return;
    }
    if (this.state === 'paused') {
      this.world.update(this.player.pos.x, this.player.pos.z, 2);
      this.world.flushSets();
      return;
    }

    this.playtime += dt;
    this.autosaveTimer += dt;
    if (this.autosaveTimer > 60) { this.autosaveTimer = 0; this.save(); }

    // --- time of day ---
    const dayLen = Math.max(60, this.settings.get('dayLength') * 60);
    if (this.world.dim === DIM.OVERWORLD && this.gamerules.doDaylightCycle) this.time += dt;
    // A non-finite clock would propagate NaN through every sky calculation and
    // black the screen out, so never let one survive a frame.
    if (!Number.isFinite(this.time)) this.time = 60;
    this.timeOfDay = (this.time / dayLen) % 1;
    this.dayNumber = Math.floor(this.time / dayLen);

    // The open screen steers its own cursor from the raw pointer delta.
    if (this.containers.open && this.containers.virtual) {
      const [dx, dy] = this.input.takeRawDelta();
      if (dx || dy) this.containers.moveCursor(dx, dy);
    }

    // --- player ---
    if (this.sleep) {
      // Lying in bed: no physics at all. Running the normal update would let
      // gravity nudge the player off the mattress mid-animation.
      this.player.vel.set(0, 0, 0);
    } else if (active && !this.containers.open && this.state === 'playing') {
      this.player.update(dt, this.input, this);
    } else if (this.player) {
      // keep gravity/collision alive while a container is open
      this.player.update(dt, { locked: false, enabled: false, isDown: () => false, justPressed: () => false, sprintToggle: false, takeLook: () => [0, 0] }, this);
    }

    if(this.state==='playing') this.player.tickEffects(dt);
    const effectHud=document.getElementById('effect-hud');
    if(effectHud) effectHud.textContent=Object.entries(this.player.effects).map(([k,v])=>`${POTION_EFFECTS[k]?.name||k} ${Math.ceil(v)}s`).join(' · ');

    // --- streaming ---
    this.world.update(this.player.pos.x, this.player.pos.z, 4);
    this.world.flushSets();

    // --- systems ---
    this.entities.update(dt);
    this.particles.update(dt);
    if (this.gamerules.doMobSpawning) this.spawner.update(dt);
    if (this.gamerules.randomTickSpeed) this.ticker.update(dt);
    this.world.fluids.update(dt);
    if (this.bobber?.dead) this.bobber = null;
    this.tickFurnaces(dt);
    this.sky.update(dt, this.renderer.camera, this.timeOfDay, this.dayNumber);
    this.weather.update(dt, this.player.pos, this.world.biomeAt(
      Math.floor(this.player.pos.x), Math.floor(this.player.pos.z)),
    this.gamerules.doWeatherCycle);

    // Dynamic FOV: a gentle widening while sprinting, and a touch more when
    // flying fast in creative. Eased so it never pops.
    if (this.settings.get('dynamicFov') !== false) {
      const p = this.player;
      const want = p.sprinting ? (p.flying ? 12 : 7) : 0;
      this._fovBoost = (this._fovBoost ?? 0) + (want - (this._fovBoost ?? 0)) * Math.min(1, dt * 7);
      if (Math.abs(this._fovBoost) < 0.01) this._fovBoost = 0;
      this.renderer.setFovBoost(this._fovBoost);
    } else if (this._fovBoost) {
      this._fovBoost = 0;
      this.renderer.setFovBoost(0);
    }

    if (this.sleep) this.updateSleep(dt);
    if (this.state === 'playing' && !this.containers.open && !this.sleep) this.updateInteraction(dt);
    this.updatePortals(dt);
    this.updateAmbience(dt);

    if (this.player.takeLevelUpFlag()) this.audio.play('levelup', { volume: 0.7 });
    if (this._crystalHintTimer > 0) this._crystalHintTimer -= dt;

    if (this.victoryPending > 0) {
      this.victoryPending -= dt;
      if (this.victoryPending <= 0) this.showVictory();
    }

    this.hud.update(dt);
  },

  updatePanorama(dt) {
    if (!this.world) return;
    const p = this.panorama;
    p.angle += dt * 0.035;
    const radius = p.scene?.radius ?? 22;
    const cx = (p.scene?.x ?? 0) + Math.cos(p.angle) * radius;
    const cz = (p.scene?.z ?? 0) + Math.sin(p.angle) * radius;
    this.world.update(cx, cz, 3);
    this.world.flushSets();
    // Glide at a fixed height over whatever is directly below, rather than
    // pinning to the spawn point's altitude — a spawn on a peak used to leave
    // the camera stranded in empty sky above the surrounding land.
    const lift = p.scene?.height ?? 14;
    const ground = this.world.surfaceAt(Math.floor(cx), Math.floor(cz));
    if (ground > 0) {
      const want = ground + lift;
      p.y = p.ready ? p.y + (want - p.y) * Math.min(1, dt * 1.5) : want;
      p.ready = true;
    } else if (!p.ready) p.y = SEA_LEVEL + lift;
    const cam = this.renderer.camera;
    cam.position.set(cx, p.y, cz);
    cam.rotation.set(p.scene?.pitch ?? -0.16, p.angle + Math.PI / 2, 0, 'YXZ');
    // Each scene sits at its own fixed hour, drifting only very slowly, so the
    // title screen always looks composed rather than whatever the clock says.
    this.timeOfDay = (p.time + performance.now() / 1000 / 900) % 1;
    this.sky.update(dt, cam, this.timeOfDay, 0);
    this.particles.update(dt);
    this.renderer.uniforms.uAnimFrame.value = performance.now() / 1000 * 8;
    this.syncFog();
  },

  render() {
    if (this.touch) this.touch.update();
    const cam = this.renderer.camera;
    if (this.state !== 'menu' && this.player) {
      this.applyCamera();
      this.updateHand();
    } else {
      // The hand scene is drawn every frame regardless of state, so whatever
      // the player was holding when they quit would otherwise hang there over
      // the title screen until the page was reloaded.
      if (this.armMesh) this.armMesh.group.visible = false;
      if (this.handMesh) this.handMesh.visible = false;
      if (this.offhandMesh) this.offhandMesh.visible = false;
    }
    const t = performance.now() / 1000;
    this.renderer.uniforms.uAnimFrame.value = t * 8;
    this.renderer.uniforms.uTime.value = t;
    this.syncFog();
    if (this.particles) {
      this.particles.setProjection(
        this.renderer.three.domElement.height, this.renderer.camera.fov);
    }
    // Submerged: the composite pass tints and wobbles the whole frame.
    const underwater = this.player && this.player.headInWater ? 1 : 0;
    if (this._uw === undefined) this._uw = 0;
    this._uw += (underwater - this._uw) * 0.25;
    this.renderer.render({ time: t, underwater: this._uw });
    this.input.endFrame();
    void cam;
  },

  syncFog() {
    const u = this.renderer.uniforms;
    const f = this.renderer.scene.fog;
    if (!f) return;
    f.color.setRGB(u.uFogColor.value.x, u.uFogColor.value.y, u.uFogColor.value.z);
    f.near = u.uFogEnabled.value ? u.uFogNear.value : 1e6;
    f.far = u.uFogEnabled.value ? u.uFogFar.value : 1e7;
    this.renderer.three.setClearColor(f.color, 1);
  },

  applyCamera() {
    const p = this.player;
    const cam = this.renderer.camera;
    let bob = 0, bobX = 0;
    if (this.settings.get('viewBobbing') !== false) {
      bob = Math.sin(p.bobTime * 2) * 0.055 * p.bobAmount;
      bobX = Math.cos(p.bobTime) * 0.045 * p.bobAmount;
    }
    if (this.shakeAmount > 0) {
      this.shakeAmount = Math.max(0, this.shakeAmount - 0.06);
      bob += (Math.random() - 0.5) * this.shakeAmount * 0.4;
      bobX += (Math.random() - 0.5) * this.shakeAmount * 0.4;
    }
    const eye = new THREE.Vector3(p.pos.x + bobX, p.pos.y + p.eyeY + bob, p.pos.z);

    if (p.perspective === 0) {
      cam.position.copy(eye);
      cam.rotation.set(p.pitch, p.yaw, 0, 'YXZ');
    } else {
      const back = p.perspective === 1 ? 1 : -1;
      const dir = p.lookDir(new THREE.Vector3()).multiplyScalar(-back);
      let dist = 4.2;
      const hit = this.world.raycast(eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, dist, (b) => IS_SOLID[b] === 1);
      if (hit) dist = Math.max(0.6, hit.dist - 0.35);
      cam.position.copy(eye).addScaledVector(dir, dist);
      cam.rotation.set(p.pitch * back, p.yaw + (back < 0 ? Math.PI : 0), 0, 'YXZ');
    }

    // hurt tilt
    if (p.hurtTime > 0) cam.rotation.z = Math.sin(p.hurtTime * 22) * p.hurtTime * 0.18;

    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    this.audio.setListener([cam.position.x, cam.position.y, cam.position.z],
      [fwd.x, fwd.y, fwd.z], [up.x, up.y, up.z]);

    // third-person body
    if (p.perspective !== 0) {
      if (!this.playerModel) {
        this.playerModel = buildModel('player');
        this.renderer.scene.add(this.playerModel.group);
        // Floating name label, the way you'd see another player's tag.
        this.nameTag = buildNameTag(this.settings.get('playerName') || 'Player');
        this.nameTag.position.y = PLAYER.HEIGHT + 0.55;
        this.playerModel.group.add(this.nameTag);
      }
      const pm = this.playerModel;
      pm.group.visible = true;
      // Worn armour has to show on the body you can actually see. The call is
      // signature-checked, so running it every frame costs nothing until the
      // player equips or removes a piece.
      applyArmor(pm, p.inventory.armor);
      // ...and so does whatever is in each hand. Armour used to be the only
      // thing that refreshed, so a sword you were plainly holding never showed.
      this.applyHeldToModel(pm, p.inventory.held(), p.inventory.offhand);
      // The tag is parented to the body, which spins with yaw — counter-rotate
      // so it always faces the camera and reads correctly from the front.
      this.nameTag.rotation.z = 0;
      this.nameTag.visible = true;
      pm.group.position.set(p.pos.x, p.pos.y, p.pos.z);
      pm.group.rotation.y = p.yaw + Math.PI;
      const speed = Math.hypot(p.vel.x, p.vel.z);
      this._pmPhase = (this._pmPhase || 0) + speed * 0.02;
      const swing = p.swingTime > 0 ? Math.sin(p.swingTime * Math.PI) * -1.6 : 0;
      animateModel(pm, performance.now() / 1000, Math.min(1, speed / 4), this._pmPhase, 0, p.pitch, swing);
      const l = this.lightAtPlayer();
      tintModel(pm, l, l, l);
    } else if (this.playerModel) this.playerModel.group.visible = false;
  },

  /**
   * Hang the held and off-hand items off the third-person body's arms.
   *
   * Signature-checked the same way `applyArmor` is, so this is free to call
   * every frame and rebuilds only when what you are holding actually changes.
   * The item hangs off the arm pivot, so it swings with the limb for free.
   */
  applyHeldToModel(model, main, off) {
    const sig = (main ? main.key : '-') + '/' + (off ? off.key : '-');
    if (model.heldSig === sig) return false;
    model.heldSig = sig;

    for (const mesh of model.heldMeshes || []) {
      mesh.parent?.remove(mesh);
      mesh.geometry.dispose();
      const i = model.materials.indexOf(mesh.material);
      if (i >= 0) model.materials.splice(i, 1);
      mesh.material.dispose();
    }
    model.heldMeshes = [];

    for (const [stack, partName] of [[main, 'armR'], [off, 'armL']]) {
      if (!stack) continue;
      const it = getItem(stack.key);
      const pivot = model.parts[partName];
      if (!it || !pivot) continue;
      const mesh = buildItemMesh(it, this.renderer.atlas, { scale: 0.62, fog: true });
      if (!mesh) continue;
      const right = partName === 'armR';
      const side = right ? -1 : 1;
      if (mesh.userData.isBlock) {
        // A block sits in the fist, corner-on, like Minecraft's carried cube.
        mesh.position.set(side * 0.09, -0.72, -0.06);
        mesh.rotation.set(0, side * 0.5, 0);
      } else if (it.key === 'shield') {
        // The shield hangs flat across the forearm, face outwards.
        mesh.scale.setScalar(1.05);
        mesh.position.set(side * 0.16, -0.62, 0.02);
        mesh.rotation.set(0, Math.PI / 2, 0);
      } else {
        // Tools and swords point forward out of the fist, angled up slightly
        // the way a held item reads from behind.
        mesh.position.set(side * 0.05, -0.70, -0.12);
        mesh.rotation.set(-Math.PI / 2 + 0.35, 0, side * 0.18);
      }
      pivot.add(mesh);
      model.materials.push(mesh.material);
      model.heldMeshes.push(mesh);
    }
    return true;
  },

  lightAtPlayer() {
    const p = this.player;
    const l = this.world.getLight(Math.floor(p.pos.x), Math.floor(p.pos.y + 1), Math.floor(p.pos.z));
    // Same floor as other entities — the held item and arm must stay readable.
    return Math.max(((l >> 4) & 15) / 15 * this.sky.sunLight, (l & 15) / 15, ENTITY_MIN_LIGHT);
  },

  // =========================================================================
  // First-person hand
  // =========================================================================
  updateHand() {
    const p = this.player;
    const held = p.inventory.held();
    const key = held ? held.key : '';
    if (key !== this.handKey) {
      this.handKey = key;
      if (this.handMesh) {
        this.renderer.handScene.remove(this.handMesh);
        this.handMesh.geometry.dispose();
        if (this.handMesh.material.map && this.handMesh.material.map.isTexture &&
            this.handMesh.material.map !== this.renderer.atlas) this.handMesh.material.map.dispose();
        this.handMesh.material.dispose();
        this.handMesh = null;
      }
      if (held) this.handMesh = this.buildHandMesh(held.key);
      if (this.handMesh) this.renderer.handScene.add(this.handMesh);
    }
    // Empty hand: show the player's own arm instead, bobbing as they walk.
    if (!this.armMesh) {
      this.armMesh = buildArm();
      this.renderer.handScene.add(this.armMesh.group);
    }
    const showArm = !held && p.perspective === 0;
    this.armMesh.group.visible = showArm;
    if (showArm) {
      const sw = p.swingTime;
      const s = Math.sin(sw * Math.PI);
      // gentle stride bob, so an empty hand still feels alive while running
      const stride = Math.sin(p.bobTime * 2) * 0.045 * p.bobAmount;
      const strideZ = Math.cos(p.bobTime) * 0.03 * p.bobAmount;
      const g = this.armMesh.group;
      // The limb points away from the camera and up-left, entering through the
      // bottom-right corner, so you see it foreshortened with the hand at the
      // far end. Laying it broadside across the corner instead made it read as
      // a slab of skin rather than an arm.
      g.position.set(0.67 - s * 0.12, -0.41 + s * 0.18 + stride, -1.40 + s * 0.37 + strideZ);
      g.rotation.set(-0.98 - s * 0.70, 0.06 + s * 0.16, 0.40 - s * 0.12);
      const l = this.lightAtPlayer();
      for (const m of this.armMesh.materials) m.color.setRGB(l, l, l);
    }

    this.updateOffhand();

    if (p.perspective !== 0) { if (this.handMesh) this.handMesh.visible = false; return; }
    if (!this.handMesh) return;
    this.handMesh.visible = true;

    // Blocks are held square-on; tools and sprites are canted so the extruded
    // silhouette reads at a glance, the way Minecraft angles them.
    const sw = p.swingTime;
    const s = Math.sin(sw * Math.PI);
    const eat = this.eatHold > 0 ? Math.sin(this.eatHold * 22) * 0.06 : 0;
    const bow = p.bowCharge;
    // Both sit where the bare arm's hand does — over on the right, clear of the
    // hotbar. The item meshes extend down and to the left of their origin, so
    // they need pushing further right than the arm to look like they're in the
    // same place.
    if (this.handMesh.userData.isBlock) {
      this.handMesh.position.set(0.72 - s * 0.10, -0.50 - s * 0.20 + eat, -0.78 + s * 0.14);
      this.handMesh.rotation.set(-0.10 + s * 1.0, 0.62 - s * 0.45, 0.02);
    } else {
      this.handMesh.position.set(
        0.52 - s * 0.09 - bow * 0.14,
        -0.38 - s * 0.20 + eat + bow * 0.07,
        -0.66 + s * 0.15 + bow * 0.06);
      this.handMesh.rotation.set(
        -0.05 + s * 1.15,
        -0.42 + bow * 0.50,
        1.22 - s * 0.55 - bow * 0.30);
    }
    const l = this.lightAtPlayer();
    if (this.handMesh.material.color) this.handMesh.material.color.setRGB(l, l, l);
  },

  /**
   * The off hand, mirrored into the bottom-left corner. Unlike the right hand
   * there is deliberately no bare arm: an empty off hand shows nothing at all,
   * so the corner stays clear until you actually put something there.
   */
  updateOffhand() {
    const p = this.player;
    const stack = p.inventory.offhand;
    const key = stack ? stack.key : '';
    if (key !== this.offhandKey) {
      this.offhandKey = key;
      if (this.offhandMesh) {
        this.renderer.handScene.remove(this.offhandMesh);
        this.offhandMesh.geometry.dispose();
        if (this.offhandMesh.material.map && this.offhandMesh.material.map.isTexture &&
            this.offhandMesh.material.map !== this.renderer.atlas) this.offhandMesh.material.map.dispose();
        this.offhandMesh.material.dispose();
        this.offhandMesh = null;
      }
      if (stack) this.offhandMesh = this.buildHandMesh(stack.key);
      if (this.offhandMesh) this.renderer.handScene.add(this.offhandMesh);
    }
    if (!this.offhandMesh) return;
    if (p.perspective !== 0) { this.offhandMesh.visible = false; return; }
    this.offhandMesh.visible = true;

    const raise = p.blocking ? 1 : 0;
    this._offRaise = (this._offRaise ?? 0) + (raise - (this._offRaise ?? 0)) * 0.25;
    const r = this._offRaise;
    const stride = Math.sin(p.bobTime * 2) * 0.035 * p.bobAmount;
    const m = this.offhandMesh;
    const isShield = this.offhandKey === 'shield';
    if (isShield) {
      // A shield is a big slab held broadside, filling the bottom-left corner
      // the way it does in Minecraft — not a small item canted like a tool.
      // Raising it swings the face round to cover more of the screen. Sized so
      // the corner is full but the crosshair and the view past it stay clear.
      m.scale.setScalar(1.15 + r * 0.12);
      m.position.set(-0.60 + r * 0.22, -0.70 + stride + r * 0.22, -0.98 + r * 0.06);
      m.rotation.set(0.10 - r * 0.06, 0.34 - r * 0.30, 0.12 - r * 0.08);
    } else if (m.userData.isBlock) {
      m.scale.setScalar(1);
      m.position.set(-0.72, -0.50 + stride + r * 0.14, -0.78 + r * 0.10);
      m.rotation.set(-0.10, -0.62, -0.02);
    } else {
      // Everything else stands upright rather than lying on its side: a tool
      // canted the way the right hand cants it reads as dropped, not held.
      m.scale.setScalar(1);
      m.position.set(-0.52, -0.42 + stride + r * 0.16, -0.70 + r * 0.10);
      m.rotation.set(-0.05, 0.42, -0.30);
    }
    const l = this.lightAtPlayer();
    if (m.material.color) m.material.color.setRGB(l, l, l);
  },

  buildHandMesh(key) {
    const it = getItem(key);
    if (!it) return null;
    const mesh = buildItemMesh(it, this.renderer.atlas, { scale: 0.50, fog: false });
    if (mesh) mesh.userData.isBlockItem = !!mesh.userData.isBlock;
    return mesh;
  },
};
