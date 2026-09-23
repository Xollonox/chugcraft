// ============================================================================
// ChugCraft — entry point and game orchestration.
//
// Owns the state machine (menu -> loading -> playing -> paused/dead/victory),
// the fixed-ish game loop, all block interaction (mining, placing, using), the
// three dimensions and the portals between them, saving, and the victory flow.
//
// The Game class grew past 3,000 lines, so its behaviour now lives in seven
// behaviour modules that are mixed onto Game.prototype right after the class:
// game-shell (save/quit/screens), game-loop (frame loop/camera/hand),
// game-interact (aim/mine/use), game-actions (place/doors/minecarts),
// game-world (drops/interaction/ambience), game-portals (dimensions/End/sleep)
// and game-commands (chat). Every method body is unchanged; only its home
// file moved.
// ============================================================================

import * as THREE from 'three';
import {
  DIM, GAMEMODE, DIFFICULTY, CHUNK_Y, SEA_LEVEL, PLAYER, ADVANCEMENTS, NETHER_SCALE,
} from './constants.js';
import { Settings } from './engine/settings.js';
import { Input } from './engine/input.js';
import { Renderer } from './engine/renderer.js';
import { Sky } from './engine/sky.js';
import { Weather, WEATHER } from './engine/weather.js';
import { Particles } from './engine/particles.js';
import { GameAudio, materialSound, CAPTIONS } from './engine/audio.js';
import { computeBlockColors } from './engine/atlas.js';
import { buildItemIcons } from './engine/itemicons.js';
import { buildItemMesh } from './engine/itemmesh.js';
import { World } from './world/world.js';
import {
  B, BLOCKS, IS_SOLID, blockByKey, BY_KEY, DOORS, IS_DOOR, BEDS, IS_BED, DOOR_FAMILY, HINGES, isWater, isLava,
} from './world/blocks.js';
import { BIOME, BIOME_NAMES } from './world/worldgen.js';
import { nearestStronghold } from './world/structures.js';
import { Player } from './player/player.js';
import { Inventory } from './player/inventory.js';
import { POTION_EFFECTS } from './crafting/items.js';
import { ITEMS, getItem, makeStack, TOOL_MATERIALS } from './crafting/items.js';
import { newFurnace, tickFurnace, isLit } from './crafting/smelting.js';
import { EntityManager, ENTITY_MIN_LIGHT } from './entities/entity.js';
import {
  buildModel, animateModel, tintModel, buildNameTag, buildArm, applyArmor,
} from './entities/models.js';
import { Mob, MobSpawner, MOBS } from './entities/mobs.js';
import { Bobber, rollFishingLoot } from './entities/bobber.js';
import { BlockTicker, canTill, canPlantOn, boneMeal, soilFor } from './world/ticking.js';
import { PROFESSIONS } from './entities/husbandry.js';
import {
  ItemEntity, XpOrb, Arrow, ThrownItem, EnderEye, PrimedTnt, explode,
} from './entities/projectiles.js';
import { EndCrystal, EnderDragon } from './entities/dragon.js';
import { Minecart } from './entities/minecart.js';
import { isRailId, isPoweredRailId, poweredRailIdFor } from './world/rails.js';
import { HUD } from './ui/hud.js';
import { Containers } from './ui/containers.js';
import { Menus } from './ui/menus.js';
import { PRESET_KEYS, isApplyingPreset, detectPreset } from './engine/presets.js';
import { applyShaderPack } from './engine/shaderpacks.js';
import { TouchControls } from './engine/touch.js';
import { AdvancementScreen } from './ui/advancements.js';
import { installPixelFont } from './ui/pixelfont.js';
import { parseSeed } from './engine/noise.js';
import * as DB from './save/db.js';
import { GameShell } from './game-shell.js';
import { GameLoop } from './game-loop.js';
import { GameInteract } from './game-interact.js';
import { GameActions } from './game-actions.js';
import { GameWorld } from './game-world.js';
import { GamePortals } from './game-portals.js';
import { GameCommands, GAMERULES } from './game-commands.js';

/**
 * Hand-picked backdrops for the title screen. Each is a throwaway world of its
 * own, at a fixed hour, so the menu never shows the state of whatever world you
 * were last in. `time` is a fraction of the day: 0.18 morning, 0.25 noon.
 */
const PANORAMAS = [
  // Each spot was picked by sweeping the seed's height field for all-land,
  // high-relief, multi-biome ground — blind coordinates kept landing in open
  // ocean, which made for a very dull menu.
  { seed: 'coldsnap', x: 400, z: -200, radius: 26, height: 8, pitch: -0.16, time: 0.20 },
  { seed: 'sunrise-bay', x: 300, z: 600, radius: 24, height: 8, pitch: -0.14, time: 0.11 },
  { seed: 'dunes', x: 400, z: -300, radius: 26, height: 9, pitch: -0.16, time: 0.25 },
  { seed: 'stonecut', x: 400, z: 200, radius: 24, height: 9, pitch: -0.18, time: 0.17 },
  { seed: 'lantern', x: 400, z: 400, radius: 22, height: 8, pitch: -0.14, time: 0.30 },
  { seed: 'highlands', x: 200, z: 500, radius: 26, height: 8, pitch: -0.14, time: 0.23 },
  { seed: 'driftwood', x: -200, z: 500, radius: 24, height: 9, pitch: -0.16, time: 0.14 },
  { seed: 'craftverse', x: 400, z: 0, radius: 24, height: 8, pitch: -0.14, time: 0.27 },
];

class Game {
  constructor() {
    this.state = 'boot';
    this.settings = new Settings();
    this.canvas = document.getElementById('viewport');
    this.audio = new GameAudio(this.settings);
    this.renderer = new Renderer(this.canvas, this.settings);
    this.input = new Input(this.canvas, this.settings);
    this.sky = new Sky(this.renderer, this.settings);

    // Entity materials use scene fog; keep it in lockstep with the chunk shader.
    this.renderer.scene.fog = new THREE.Fog(0x87ceeb, 40, 160);

    this.blockColors = computeBlockColors(this.renderer.atlasCanvas);
    buildItemIcons();

    this.world = null;
    this.player = null;
    this.entities = new EntityManager(this);
    this.particles = null;
    this.weather = null;
    this.spawner = null;
    this.dragon = null;

    this.time = 60;                // seconds of world time
    this.timeOfDay = 0.05;
    this.dayNumber = 0;
    this.playtime = 0;
    this.lookHit = null;
    this.mineProgress = 0;
    this.mineTarget = null;
    this.shakeAmount = 0;
    this.arrival = null;
    this.saveMeta = null;
    this.autosaveTimer = 0;
    this.stats = { blocksBroken: 0, blocksPlaced: 0, itemsCrafted: 0, mobsKilled: 0, deaths: 0 };
    this.advancements = {};
    this.gamerules = { ...GAMERULES };
    this.villageSpawns = new Set();
    this.won = false;
    this.victoryPending = 0;
    this.handMesh = null;
    this.handKey = null;
    this.playerModel = null;
    this.eatHold = 0;
    this.bowHold = 0;
    this._boxes = [];
    this._crystalHintTimer = 0;

    this.hud = new HUD(this);
    // Subtitles: every played sound with a caption shows up in the HUD, with
    // a left/right arrow when the source is clearly off to one side.
    this.audio.onPlay = (name, opts) => {
      if (this.state !== 'playing' || !this.settings.get('subtitles')) return;
      const text = CAPTIONS[name];
      if (!text) return;
      let dir = null;
      if (opts?.pos && this.player) {
        const dx = opts.pos[0] - this.player.pos.x, dz = opts.pos[2] - this.player.pos.z;
        const fx = -Math.sin(this.player.yaw), fz = -Math.cos(this.player.yaw);
        const side = fx * dz - fz * dx;   // positive: to the right of the facing direction
        const len = Math.hypot(dx, dz);
        if (len > 2 && Math.abs(side) / len > 0.35) dir = side > 0 ? 'right' : 'left';
      }
      this.hud.caption(text, dir);
    };
    this.containers = new Containers(this);
    this.menus = new Menus(this);
    this.touch = new TouchControls(this);
    this.advancementScreen = new AdvancementScreen(this);

    // Losing pointer lock normally means the player alt-tabbed or hit Esc, so
    // pause. But opening a container or the chat bar releases the lock on
    // purpose — those must not drag the pause menu up with them.
    this.input.onUnlock = () => {
      if (this.state !== 'playing') return;
      if (this.containers.open || this.hud.chatOpen) return;
      this.pause();
    };

    this._wireSettings();
    this._wireKeys();
    window.addEventListener('beforeunload', () => { if (this.state !== 'menu' && this.world) this.save(); });
  }

  // =========================================================================
  // Boot
  // =========================================================================
  async boot() {
    // Build the pixel-art UI face before anything is drawn, so no frame of the
    // interface flashes in the fallback monospace.
    this.pixelFont = await installPixelFont();
    this.hud.show(false);
    this.menus.show('title');
    this.state = 'menu';
    this.startPanorama();
    this.loop(performance.now());

    const resume = () => {
      this.audio.resume();
      this.audio.applyVolumes();
      if (this.settings.get('musicVolume') > 0) this.audio.startMusic();
    };
    document.addEventListener('mousedown', resume, { once: true });
    document.addEventListener('keydown', resume, { once: true });
  }

  /**
   * A live, slowly rotating world behind the title screen. It is always one of
   * the curated scenes below on a throwaway world of its own — never the world
   * you were just playing, and never that world's time of day or weather.
   */
  startPanorama() {
    this.disposeWorld();
    const scene = PANORAMAS[(Math.random() * PANORAMAS.length) | 0];
    this.world = new World({
      seed: parseSeed(scene.seed), structures: true, scene: this.renderer.scene,
      materials: this.renderer.materials, settings: this.settings,
      renderDistance: 6,
    });
    this.particles = new Particles(this.renderer.scene, this.world, this.blockColors);
    this.weather = new Weather(this.renderer.scene, this.sky, this.audio, this.settings, this.world);
    // Wipe anything the previous session left on the sky: quitting mid-storm
    // used to leave the title screen grey and overcast.
    this.weather.force(WEATHER.CLEAR);
    this.weather.intensity = 0;
    this.sky.rainDarken = 0;
    this.sky.flash = 0;
    this.sky.setDimension(DIM.OVERWORLD);
    this.panorama = {
      scene, angle: Math.random() * Math.PI * 2, y: 0, ready: false,
      time: scene.time,
    };
    this.renderer.setRenderDistance(6);
  }

  /**
   * Villages ship a list of residents with their chunks. Nothing was listening
   * for it, which is why every village was a ghost town. Positions are
   * remembered for the session so re-entering a chunk doesn't clone the whole
   * population — and so anyone you killed stays dead.
   */
  _wireWorldEvents(world) {
    this.villageSpawns = new Set();
    world.on('villagers', (list) => {
      if (this.state === 'menu' || !this.player) return;
      for (const v of list) {
        const key = `${Math.round(v.x * 2)}:${Math.round(v.z * 2)}:${v.kind || 'villager'}`;
        if (this.villageSpawns.has(key)) continue;
        this.villageSpawns.add(key);
        const kind = v.kind === 'iron_golem' ? 'iron_golem' : 'villager';
        if (this.entities.count(kind) > 40) continue;
        const ground = this.world.surfaceAt(Math.floor(v.x), Math.floor(v.z));
        const mob = new Mob(this, kind, v.x, ground > 0 ? ground : v.y, v.z);
        mob.persistent = true;
        this.entities.add(mob);
      }
    });
  }

  disposeWorld() {
    this.entities.clear();
    this.dragon = null;
    if (this.particles) this.particles.clear();
    if (this.world) { this.world.dispose(); this.world = null; }
  }

  // =========================================================================
  // Settings plumbing
  // =========================================================================
  _wireSettings() {
    const s = this.settings;
    const applyAll = () => {
      this.renderer.setFov(s.get('fov'));
      this.renderer.setRenderDistance(s.get('renderDistance'));
      this.renderer.uniforms.uGamma.value = s.get('gamma');
      this.renderer.uniforms.uFogEnabled.value = s.get('fog') === false ? 0 : 1;
      this.renderer.uniforms.uWaveAmount.value = s.get('waving') === false ? 0 : 1;
      this.renderer.postfx.enabled = s.get('bloom') !== false;
      this.renderer.postfx.ssao = s.get('ssao') !== false;
      // Water keeps its ripples either way; reflections are the expensive half.
      this.renderer.materials[3].uniforms.uReflect.value =
        s.get('reflections') === false ? 0 : 1;
      if (this.world) this.world.renderDistance = s.get('renderDistance');
      if (this.particles) this.particles.enabled = s.get('particles') !== false;
      this.sky.setCloudMode(s.get('cloudMode') ?? 2);
      this.renderer.setRenderScale(s.get('renderScale') || 1);
      // Shader pack after the bloom/ssao toggles above, so the pack's bloom
      // strength and grading always land on top of the defaults.
      applyShaderPack(this.renderer, s.get('shaderPack') ?? 0);
      this.audio.applyVolumes();
    };
    for (const k of ['fov', 'renderDistance', 'gamma', 'fog', 'particles', 'cloudMode',
      'bloom', 'waving', 'reflections', 'renderScale', 'shaderPack']) s.onChange(k, applyAll);
    // Every pack except Vanilla grades the frame in the post chain, which only
    // runs when "Bloom & Grading" is on — so picking a pack switches it on.
    s.onChange('shaderPack', (v) => {
      if (v > 0 && s.get('bloom') === false) s.set('bloom', true);
    });
    // Hand-tuning any preset-owned setting flips the Graphics label to Custom
    // (or back to a named preset if the values happen to match one exactly).
    for (const k of PRESET_KEYS) {
      s.onChange(k, () => {
        if (isApplyingPreset()) return;
        const d = detectPreset(s);
        if (s.get('graphicsPreset') !== d) s.set('graphicsPreset', d);
      });
    }
    s.onChange('guiScale', () => this.renderer.applyGuiScale());
    s.onChange('playerName', () => {
      // rebuild the label on next third-person frame
      if (this.nameTag) {
        this.playerModel.group.remove(this.nameTag);
        this.nameTag = null;
        this.playerModel = null;
      }
    });
    s.onChange('fancyLeaves', (v) => {
      if (this.world) this.world.worker.postMessage({ type: 'options', fastLeaves: v === false });
    });
    s.onChange('masterVolume', () => this.audio.applyVolumes());
    s.onChange('soundVolume', () => this.audio.applyVolumes());
    s.onChange('musicVolume', (v) => {
      this.audio.applyVolumes();
      if (v > 0) this.audio.startMusic(); else this.audio.stopMusic();
    });
    s.onChange('smoothLighting', (v) => { if (this.world) this.world.setSmoothLighting(v); });
    s.onChange('ssao', (v) => { if (this.renderer.postfx) this.renderer.postfx.ssao = v !== false; });
    s.onChange('showFps', () => { });
    applyAll();
  }

  _wireKeys() {
    addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) {
        if (!this.hud.chatOpen) return;
        if (e.code === 'Tab') {
          // Tab completes; with a live list it also cycles through it.
          e.preventDefault();
          if (!this.hud.applySuggestion()) this.hud.moveSuggestion(e.shiftKey ? -1 : 1);
        } else if (e.code === 'ArrowUp') {
          if (this.hud.moveSuggestion(-1)) e.preventDefault();
        } else if (e.code === 'ArrowDown') {
          if (this.hud.moveSuggestion(1)) e.preventDefault();
        } else if (e.code === 'Enter' || e.code === 'NumpadEnter') {
          e.preventDefault();
          this.closeChat(true);
        } else if (e.code === 'Escape') {
          // Escape always abandons the whole chat, as it does in Minecraft —
          // the suggestion list is a hint, not a modal to dismiss first. The
          // browser will drop the pointer lock too; flag that as intentional.
          e.preventDefault();
          this.input.expectUnlock();
          this.closeChat(false);
        }
        return;
      }
      if (e.code === 'Escape') {
        e.preventDefault();
        // Escape forces the browser to drop the pointer lock, so flag it as
        // deliberate or the release would read as an alt-tab and pause.
        if (this.containers.open) {
          this.input.expectUnlock();
          this.containers.close();
          this.input.requestLock();
          return;
        }
        if (this.advancementScreen.open) {
          this.input.expectUnlock();
          this.advancementScreen.hide();
          return;
        }
        // Escape gets you out of bed rather than opening the pause menu.
        if (this.sleep) { this.input.expectUnlock(); this.endSleep(false); return; }
        if (this.state === 'playing') this.pause();
        else if (this.state === 'paused') this.resume();
        else if (this.menus.current === 'options') this.menus.show(this._optionsFrom || 'title');
        else if (this.menus.current === 'controls') this.menus.show('options');
        else if (this.menus.current === 'info') this.menus.show(this.menus._infoReturn || 'title');
        else if (this.menus.current === 'create') this.menus.show('worlds');
        else if (this.menus.current === 'worlds') this.menus.show('title');
        return;
      }
      if (this.state !== 'playing') return;
      // Pointing at a slot and pressing 1-9 trades it with that hotbar slot,
      // and F trades it with the off hand.
      if (this.containers.open) {
        if (e.code === this.settings.keyFor('offhand')) {
          if (this.containers.offhandSwap()) e.preventDefault();
          return;
        }
        for (let i = 0; i < 9; i++) {
          if (e.code !== this.settings.keyFor('hotbar' + (i + 1))) continue;
          if (this.containers.hotbarSwap(i)) e.preventDefault();
          return;
        }
      }
      // While playing, F swaps the selected hotbar slot with the off hand.
      if (e.code === this.settings.keyFor('offhand')) {
        e.preventDefault();
        this.swapOffhand();
      }
      if (e.code === this.settings.keyFor('debug')) { e.preventDefault(); this.hud.toggleDebug(); }
      if (e.code === this.settings.keyFor('inventory')) {
        e.preventDefault();
        if (this.containers.open) { this.containers.close(); this.input.requestLock(); }
        else if (this.player.gamemode === GAMEMODE.CREATIVE) this.openContainer('creative');
        else this.openContainer('inventory');
      }
      if (e.code === this.settings.keyFor('perspective')) {
        e.preventDefault();
        this.player.perspective = (this.player.perspective + 1) % 3;
      }
      if (e.code === this.settings.keyFor('advancements')) {
        e.preventDefault();
        this.toggleAdvancements();
      }
      if (e.code === this.settings.keyFor('chat') || e.code === 'KeyT') {
        e.preventDefault();
        this.openChat(e.code === this.settings.keyFor('chat') ? '/' : '');
      }
      if (e.code === this.settings.keyFor('drop')) this.dropHeld(e.shiftKey);
    });
  }

  // =========================================================================
  // World lifecycle
  // =========================================================================
  async createWorld(opts) {
    const seed = parseSeed(opts.seed);
    const id = DB.newWorldId();
    this.saveMeta = {
      id, name: opts.name, seed, gamemode: opts.gamemode, difficulty: opts.difficulty,
      structures: opts.structures, created: Date.now(), lastPlayed: Date.now(),
      // Creative implies commands; survival makes it a choice at creation time.
      cheats: opts.gamemode === GAMEMODE.CREATIVE || !!opts.cheats,
      won: false, playtime: 0, version: 1,
    };
    this.bonusChest = opts.bonusChest;
    await this.enterWorld(null);
  }

  async loadWorld(id) {
    const rec = await DB.loadWorld(id);
    if (!rec) { this.menus.refreshWorlds(); return; }
    this.saveMeta = {
      id: rec.id, name: rec.name, seed: rec.seed, gamemode: rec.gamemode,
      difficulty: rec.difficulty, structures: rec.structures !== false,
      // Worlds made before this option existed keep working: creative gets
      // commands, survival doesn't, which is what they behaved like.
      cheats: rec.cheats ?? (rec.gamemode === GAMEMODE.CREATIVE),
      created: rec.created, lastPlayed: Date.now(), won: rec.won, playtime: rec.playtime || 0,
      version: rec.version || 1,
    };
    this.bonusChest = false;
    await this.enterWorld(rec);
  }

  async enterWorld(rec) {
    this.state = 'loading';
    this.menus.show('loading');
    this.menus.setLoading(0.02, 'Preparing world…');
    this.hud.show(false);
    this.audio.stopAllLoops();

    await new Promise((r) => setTimeout(r, 30));

    this.disposeWorld();
    const meta = this.saveMeta;
    this.world = new World({
      seed: meta.seed, structures: meta.structures, scene: this.renderer.scene,
      materials: this.renderer.materials, settings: this.settings,
      renderDistance: this.settings.get('renderDistance'),
    });
    this._wireWorldEvents(this.world);
    this.particles = new Particles(this.renderer.scene, this.world, this.blockColors);
    this.weather = new Weather(this.renderer.scene, this.sky, this.audio, this.settings, this.world);
    this.weather.onStrike = (x, y, z) => this.onLightning(x, y, z);
    this.world.onFluidReaction = (x,y,z)=>{
      this.audio.play('fizz',{pos:[x,y,z],throttle:.3,volume:.55});
      this.particles.smoke(x+.5,y+1,z+.5,3);
    };
    this.player = new Player(this.world, this.settings);
    this.player.gamemode = meta.gamemode;
    this.player.difficulty = meta.difficulty;
    this.entities = new EntityManager(this);
    this.spawner = new MobSpawner(this);
    this.ticker = new BlockTicker(this);
    this.bobber = null;
    this.dragon = null;
    this.won = meta.won;
    this.stats = { blocksBroken: 0, blocksPlaced: 0, itemsCrafted: 0, mobsKilled: 0, deaths: 0 };
    this.advancements = {};
    this.gamerules = { ...GAMERULES };
    this.playtime = meta.playtime || 0;
    this.panorama = null;
    this.renderer.setRenderDistance(this.settings.get('renderDistance'));

    let targetDim = DIM.OVERWORLD;
    if (rec && rec.data) {
      const d = rec.data;
      this.world.deserialize(d.world);
      this.player.deserialize(d.player);
      this.time = d.time ?? 60;
      this.stats = { ...this.stats, ...(d.stats || {}) };
      this.advancements = d.advancements || {};
      this.gamerules = { ...GAMERULES, ...(d.gamerules || {}) };
      this.weather.deserialize(d.weather);
      this.dragonDead = !!d.dragonDead;
      this.crystalsDestroyed = d.crystalsDestroyed || [];
      this.dragonHealth = d.dragonHealth ?? 200;
      targetDim = d.dim ?? DIM.OVERWORLD;
      this.portalCache = d.portals || {};
      this.lastDeath=d.lastDeath||null;
    } else {
      this.dragonDead = false;
      this.crystalsDestroyed = [];
      this.dragonHealth = 200;
      this.portalCache = {};
      this.time = 60;
      this.player.pos.set(0.5, 100, 0.5);
    }
    this.player.inventory.onBreak = () => this.audio.play('tool_break',{volume:0.8});
    this.player.inventory.onChange = () => { if (this.containers.open) this.containers.refresh(); };

    this.sky.setDimension(targetDim);
    this.weather.setDimension(targetDim);
    if (targetDim !== DIM.OVERWORLD) this.world.setDimension(targetDim);

    // Stream in the chunks around the player before showing the world.
    await this.waitForChunks(rec ? [this.player.pos.x, this.player.pos.z] : [0, 0], (p) => {
      this.menus.setLoading(0.05 + p * 0.9, p < 0.5 ? 'Generating terrain…' : 'Building lighting…');
    });

    if (!rec) {
      const spawn = this.world.findSpawn(0, 0) || [0.5, 90, 0.5];
      this.player.pos.set(spawn[0], spawn[1], spawn[2]);
      this.player.spawnPoint = [spawn[0], spawn[1], spawn[2]];
      if (this.bonusChest) this.placeBonusChest(spawn);
      if (meta.gamemode === GAMEMODE.CREATIVE) this.giveCreativeKit();
      this.spawner.initialPopulate();
    } else {
      // make sure we didn't load inside terrain
      if (this.player.pos.y < 1) this.player.pos.y = SEA_LEVEL + 12;
    }

    // Item drops were written to saves but never rehydrated on load.
    for(const e of rec?.data?.items||[]){
      if(e.t==='mob'){ const m=Mob.fromRecord(this,e); if(m)this.entities.add(m); continue; }
      if(e.t==='cart'){ const c=new Minecart(this,e.x,e.y,e.z);
        if(Number.isFinite(e.vx))c.vel.set(e.vx||0,e.vy||0,e.vz||0); this.entities.add(c); continue; }
      if(e.t!=='item'||!getItem(e.s?.key)||e.s.count<=0)continue;
      const drop=this.dropItem(e.x,e.y,e.z,{...e.s},{delay:1,vx:0,vy:0,vz:0});
      if(drop)drop.lifetime=Number.isFinite(e.life)?Math.max(0,Math.min(300,e.life)):300;
    }
    this.menus.setLoading(1, 'Ready');
    this.menus.hideAll();
    this.hud.show(true);
    this.state = 'playing';
    this.input.enabled = true;
    this.input.requestLock();
    this.audio.resume();
    if (this.settings.get('musicVolume') > 0) this.audio.startMusic();
    this.hud.chat(`Welcome to ${meta.name}. Seed: ${meta.seed}`);
    if (!rec) this.toast('Getting Started', 'Punch a tree to collect wood', 'oak_log');

    if (targetDim === DIM.END) this.setupEndFight();
    if(this.player.dead){
      this.state='dead';this.input.enabled=false;this.input.exitLock();
      this.menus.showDeath(this.player.deathCause,this.player.level);
      document.getElementById('death-location').textContent=this.lastDeath?`Last location: ${this.lastDeath.pos.join(', ')} · ${['Overworld','Nether','End'][this.lastDeath.dim]}`:'';
    }
  }

  waitForChunks(center, onProgress) {
    return new Promise((resolve) => {
      const need = 25;
      const started = performance.now();
      const tick = () => {
        if (!this.world) { resolve(); return; }
        const cx = Math.floor(center[0] / 16), cz = Math.floor(center[1] / 16);
        let have = 0;
        for (let dz = -2; dz <= 2; dz++) {
          for (let dx = -2; dx <= 2; dx++) {
            if (this.world.chunks.has(`${cx + dx},${cz + dz}`)) have++;
          }
        }
        this.world.update(center[0], center[1], 6);
        onProgress?.(Math.min(1, have / need));
        if (have >= need || performance.now() - started > 15000) { resolve(); return; }
        setTimeout(tick, 24);
      };
      tick();
    });
  }

  placeBonusChest(spawn) {
    const x = Math.round(spawn[0]) + 2, z = Math.round(spawn[2]);
    const y = this.world.surfaceAt(x, z);
    if (y < 1) return;
    this.world.setBlock(x, y, z, B.CHEST);
    this.world.getEntityData(x, y, z, () => ({
      type: 'chest',
      items: [
        makeStack('oak_planks', 12), makeStack('stick', 8), makeStack('apple', 4),
        makeStack('wooden_pickaxe', 1), makeStack('wooden_axe', 1), makeStack('torch', 8),
      ],
    }));
  }

  giveCreativeKit() {
    const inv = this.player.inventory;
    for (const k of ['stone', 'oak_planks', 'glass', 'torch', 'obsidian', 'diamond_pickaxe',
      'diamond_sword', 'flint_and_steel', 'ender_eye', 'rail', 'minecart']) {
      inv.add(k, k.includes('_') && getItem(k)?.tool ? 1 : 64);
    }
  }
}

// The rest of the Game behaviour lives in modules mixed onto the prototype:
// game-shell (save/quit/screens), game-loop (frame loop/camera/hand),
// game-interact (aim/mine/use), game-actions (place/doors/minecarts),
// game-world (drops/interaction/ambience), game-portals (dimensions/End/sleep)
// and game-commands (chat).
Object.assign(Game.prototype, GameShell, GameLoop, GameInteract, GameActions, GameWorld, GamePortals, GameCommands);

export { GAMERULES };

// ---------------------------------------------------------------------------
const game = new Game();
window.chugcraft = game;
// Kept as an alias so older bookmarks, dev consoles and test scripts that
// reach for window.craftverse still find the game after the rename.
window.craftverse = game;
game.boot().catch((e) => { console.error(e); game.fatal(e); });

export default game;
export { Game, Mob, MOBS, BIOME, DIFFICULTY, explode, TOOL_MATERIALS, blockByKey };
