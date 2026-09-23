// ============================================================================
// ChugCraft â€” entry point and game orchestration.
//
// Owns the state machine (menu -> loading -> playing -> paused/dead/victory),
// the fixed-ish game loop, all block interaction (mining, placing, using), the
// three dimensions and the portals between them, saving, and the victory flow.
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

const CRACK_STAGES = 10;
/** Seconds between swings while the attack button is held down. */
const ATTACK_REPEAT = 0.45;

/**
 * Hand-picked backdrops for the title screen. Each is a throwaway world of its
 * own, at a fixed hour, so the menu never shows the state of whatever world you
 * were last in. `time` is a fraction of the day: 0.18 morning, 0.25 noon.
 */
const PANORAMAS = [
  // Each spot was picked by sweeping the seed's height field for all-land,
  // high-relief, multi-biome ground â€” blind coordinates kept landing in open
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

/**
 * Command table, used both for `/help` and for chat autocomplete. `args` lists
 * the completions for each positional argument: an array of literals, the
 * marker '<item>' for the item registry, or null for free text.
 */
const TIME_WORDS = ['day', 'noon', 'sunset', 'night', 'midnight', 'sunrise', 'set'];
const DIFFICULTY_WORDS = ['peaceful', 'easy', 'normal', 'hard'];
const LOCATE_TARGETS = ['stronghold', 'village', 'fortress', 'temple', 'spawn'];
const KILL_TARGETS = ['hostile', 'passive', 'items', 'all'];
export const GAMERULES = {
  keepInventory: false,
  doDaylightCycle: true,
  doWeatherCycle: true,
  doMobSpawning: true,
  mobGriefing: true,
  randomTickSpeed: true,   // crops grow, saplings sprout, farmland dries
};
const GAMERULE_NAMES = Object.keys(GAMERULES);
const BOOL_WORDS = ['true', 'false'];

const COMMANDS = [
  { name: 'help', desc: 'list every command', args: [] },
  { name: 'time', desc: 'change the time of day', args: [TIME_WORDS, TIME_WORDS.slice(0, 6)] },
  { name: 'weather', desc: 'force the weather', args: [['clear', 'rain', 'thunder']] },
  { name: 'gamemode', desc: 'switch survival/creative', args: [['survival', 'creative', '0', '1']] },
  { name: 'difficulty', desc: 'set the difficulty', args: [DIFFICULTY_WORDS] },
  { name: 'give', desc: 'grant an item (creative)', args: ['<item>', null] },
  { name: 'clear', desc: 'empty your inventory, or one item from it', args: ['<item>'] },
  { name: 'summon', desc: 'spawn a mob in front of you', args: ['<mob>', null] },
  { name: 'kill', desc: 'kill yourself', args: [] },
  { name: 'killall', desc: 'remove nearby entities', args: [KILL_TARGETS] },
  { name: 'heal', desc: 'refill health and hunger', args: [] },
  { name: 'feed', desc: 'refill hunger', args: [] },
  { name: 'xp', desc: 'grant experience points', args: [null] },
  { name: 'setblock', desc: 'replace the block you are looking at', args: ['<block>'] },
  { name: 'fill', desc: 'fill a cube around you (radius up to 12)', args: ['<block>', null] },
  { name: 'tp', desc: 'teleport to x y z, or to spawn', args: [['spawn'], null, null] },
  { name: 'spawnpoint', desc: 'set your respawn point here', args: [] },
  { name: 'spawn', desc: 'return to your spawn point', args: [] },
  { name: 'locate', desc: 'find the nearest structure', args: [LOCATE_TARGETS] },
  { name: 'stronghold', desc: 'locate the nearest stronghold', args: [] },
  { name: 'gamerule', desc: 'read or change a game rule', args: [GAMERULE_NAMES, BOOL_WORDS] },
  { name: 'pos', desc: 'show your coordinates and biome', args: [] },
  { name: 'seed', desc: 'show the world seed', args: [] },
  { name: 'advancements', desc: 'list your progress', args: [] },
  { name: 'name', desc: 'set the name on your tag', args: [null] },
  { name: 'say', desc: 'send a chat message', args: [null] },
  { name: 'me', desc: 'send an action message', args: [null] },
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
    // purpose â€” those must not drag the pause menu up with them.
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
   * the curated scenes below on a throwaway world of its own â€” never the world
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
   * population â€” and so anyone you killed stays dead.
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
          // Escape always abandons the whole chat, as it does in Minecraft â€”
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
    this.menus.setLoading(0.02, 'Preparing worldâ€¦');
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
      this.menus.setLoading(0.05 + p * 0.9, p < 0.5 ? 'Generating terrainâ€¦' : 'Building lightingâ€¦');
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
      'diamond_sword', 'flint_and_steel', 'ender_eye']) {
      inv.add(k, k.includes('_') && getItem(k)?.tool ? 1 : 64);
    }
  }

  // =========================================================================
  // Save / quit
  // =========================================================================
  async save() {
    if (!this.saveMeta || !this.world) return;
    this.world.flushSets();
    const items = [];
    this.entities.each((e) => { const s = e.serialize?.(); if (s) items.push(s); });
    // Include transient container stacks in the saved snapshot without closing
    // the player's UI or mutating their live bag during an autosave.
    const playerSnapshot=this.player.serialize();
    if(this.containers.open){
      const temp=new Inventory();temp.deserialize(playerSnapshot.inventory);
      const extras=[this.containers.cursor];
      if(this.containers.type==='crafting') extras.push(...(this.containers._grid||[]));
      for(const stack of extras){if(!stack)continue;const left=temp.addStack(stack);
        if(left)items.push({t:'item',x:this.player.pos.x,y:this.player.pos.y+0.6,z:this.player.pos.z,s:{...stack,count:left},life:300});
      }
      playerSnapshot.inventory=temp.serialize();
    }
    const rec = {
      ...this.saveMeta,
      lastPlayed: Date.now(),
      won: this.won,
      playtime: this.playtime,
      data: {
        dim: this.world.dim,
        time: this.time,
        world: this.world.serialize(),
        player: playerSnapshot,
        stats: this.stats,
        advancements: this.advancements,
        gamerules: this.gamerules,
        weather: this.weather.serialize(),
        dragonDead: this.dragonDead,
        dragonHealth: this.dragon ? this.dragon.health : this.dragonHealth,
        crystalsDestroyed: this.crystalsDestroyed,
        portals: this.portalCache,
        lastDeath:this.lastDeath||null,
        items,
      },
    };
    try { await DB.saveWorld(rec); return true; }
    catch (e) {
      console.warn('[save] failed', e);
      this.toast('Save failed','Storage may be full or blocked. Keep this tab open.');
      return false;
    }
  }

  async quitToTitle() {
    if (this.state !== 'menu' && !(await this.save())) return;
    this.audio.stopAllLoops();
    this.input.exitLock();
    this.hud.show(false);
    this.containers.close();
    this.advancementScreen.hide();
    if (this.sleep) this.endSleep(false);
    this.hud.setFade(0);
    this.state = 'menu';
    this.player = null;
    this.saveMeta = null;
    this.startPanorama();
    this.menus.show('title');
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.input.enabled = false;
    this.input.exitLock();
    this._optionsFrom = 'pause';
    this.menus.show('pause');
    this.save();
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.input.enabled = true;
    this.menus.hideAll();
    this.input.requestLock();
  }

  /**
   * Chat releases the pointer but must not pause the game. Held keys are
   * dropped so the player doesn't keep walking while typing.
   */
  openChat(initial = '') {
    if (this.hud.chatOpen || this.state !== 'playing') return;
    // Like the inventory, chat keeps the pointer lock â€” typing works fine
    // under it, and dropping the lock is what summoned the browser's banner.
    // Disabling input is enough to stop the mouse turning the camera.
    this.input.enabled = false;
    this.input.down.clear();
    this.hud.openChat(initial);
  }

  closeChat(submit) {
    if (!this.hud.chatOpen) return;
    const text = this.hud.chatInput.value;
    this.hud.closeChat();
    this.input.enabled = true;
    this.input.down.clear();
    this.input.takeRawDelta();               // discard drift from while typing
    if (submit && text.trim()) this.runCommand(text);
    if (this.state === 'playing' && !this.input.locked) this.input.requestLock();
  }

  /**
   * The advancements tree. It keeps the pointer lock like the other screens,
   * and the real cursor is only needed for the Done button â€” Escape and the
   * advancements key both close it.
   */
  toggleAdvancements() {
    if (this.advancementScreen.open) { this.advancementScreen.hide(); return; }
    this.advancementScreen.show();
    this.input.enabled = false;
    this.input.down.clear();
    this.input.exitLock();
  }

  onAdvancementsClosed() {
    this.input.enabled = true;
    this.input.down.clear();
    if (this.state === 'playing') this.input.requestLock();
  }

  openContainer(type, data) {
    // The pointer lock is deliberately kept: releasing it made Chrome show its
    // "press Esc to show your cursor" banner every single time the inventory
    // opened. The screen draws its own cursor instead.
    this.containers.show(type, data);
    this.input.enabled = false;
    // Drop every held key. Otherwise a Shift or Ctrl still logically "down"
    // when the screen opens leaks straight back into sneak/sprint on close.
    this.input.down.clear();
    this.input.sprintToggle = false;
    this.player.sneaking = false;
    this.player.sprinting = false;
  }

  onContainerClosed() {
    this.input.enabled = true;
    this.input.down.clear();
    this.input.sprintToggle = false;
    // Only ask for the lock back if it was actually lost (Escape forces the
    // browser to release it). Re-requesting a lock we still hold would show
    // the banner again for nothing.
    if (this.state === 'playing' && !this.input.locked) this.input.requestLock();
  }

  // =========================================================================
  // Loop
  // =========================================================================
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
  }

  fatal(e) {
    const el = document.getElementById('fatal');
    if (!el.classList.contains('hidden')) return;
    el.classList.remove('hidden');
    document.getElementById('fatal-msg').textContent = (e && e.stack) || String(e);
  }

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
  }

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
    // pinning to the spawn point's altitude â€” a spawn on a peak used to leave
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
  }

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
  }

  syncFog() {
    const u = this.renderer.uniforms;
    const f = this.renderer.scene.fog;
    if (!f) return;
    f.color.setRGB(u.uFogColor.value.x, u.uFogColor.value.y, u.uFogColor.value.z);
    f.near = u.uFogEnabled.value ? u.uFogNear.value : 1e6;
    f.far = u.uFogEnabled.value ? u.uFogFar.value : 1e7;
    this.renderer.three.setClearColor(f.color, 1);
  }

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
      // The tag is parented to the body, which spins with yaw â€” counter-rotate
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
  }

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
  }

  lightAtPlayer() {
    const p = this.player;
    const l = this.world.getLight(Math.floor(p.pos.x), Math.floor(p.pos.y + 1), Math.floor(p.pos.z));
    // Same floor as other entities â€” the held item and arm must stay readable.
    return Math.max(((l >> 4) & 15) / 15 * this.sky.sunLight, (l & 15) / 15, ENTITY_MIN_LIGHT);
  }

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
    // Both sit where the bare arm's hand does â€” over on the right, clear of the
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
  }

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
  }

  buildHandMesh(key) {
    const it = getItem(key);
    if (!it) return null;
    const mesh = buildItemMesh(it, this.renderer.atlas, { scale: 0.50, fog: false });
    if (mesh) mesh.userData.isBlockItem = !!mesh.userData.isBlock;
    return mesh;
  }

  // =========================================================================
  // Interaction
  // =========================================================================
  updateInteraction(dt) {
    const p = this.player;
    const inp = this.input;
    const eye = p.eyePosition();
    const dir = p.lookDir();

    // hotbar selection
    const w = inp.takeWheel();
    if (w) p.inventory.selected = ((p.inventory.selected + w) % 9 + 9) % 9;
    for (let i = 1; i <= 9; i++) {
      if (inp.justPressed('hotbar' + i)) p.inventory.selected = i - 1;
    }

    if(this._useHeld!==p.inventory.held()){
      this.bowHold=0;this.eatHold=0;this.drinkHold=0;p.bowCharge=0;p.blocking=false;
      this._useHeld=p.inventory.held();
    }
    this.lookHit = this.world.raycast(eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, PLAYER.REACH);
    const hl = this.renderer.highlight;
    if (this.lookHit) {
      hl.visible = true;
      const bh = BLOCKS[this.lookHit.id];
      const h = bh.render === 'layer' || bh.render === 'liquid' ? bh.height : 1;
      hl.position.set(this.lookHit.x + 0.5, this.lookHit.y + h / 2, this.lookHit.z + 0.5);
      hl.scale.set(1, h, 1);
    } else hl.visible = false;

    // --- attack ---
    if (inp.justPressed('attack')) {
      const ent = this.pickEntity(PLAYER.REACH);
      p.swing();
      if (ent) { this.attackEntity(ent); this._attackCd = ATTACK_REPEAT; }
      else if (!this.lookHit) this.audio.play('click', { volume: 0.2, rate: 0.6 });
    } else if (inp.isDown('attack')) {
      // Holding the attack button keeps swinging at whatever is in reach, on a
      // fixed cooldown. Touch hold-to-attack depends on this (a held finger
      // only ever produces one "just pressed"), and it saves desktop players
      // from having to click frantically at a chasing mob.
      this._attackCd = (this._attackCd || 0) - dt;
      if (this._attackCd <= 0) {
        const ent = this.pickEntity(PLAYER.REACH);
        if (ent) { p.swing(); this.attackEntity(ent); this._attackCd = ATTACK_REPEAT; }
      }
    } else this._attackCd = 0;
    if (inp.isDown('attack') && this.lookHit && !this.pickEntity(PLAYER.REACH)) {
      this.tickMining(dt);
    } else {
      this.mineProgress = 0;
      this.mineTarget = null;
      this.renderer.crack.visible = false;
    }
    if (inp.isDown('attack') && p.swingTime <= 0) p.swing();

    // --- use / place ---
    const held = p.inventory.held();
    const item = held ? getItem(held.key) : null;

    if (inp.justPressed('use')) this.startUse(held, item);
    if (!this.containers.open && inp.isDown('use') && held===p.inventory.held()) this.holdUse(dt, held, item);
    if (inp.justReleased('use')) this.endUse(held, item);

    // pick block
    if (inp.justPressed('pick') && this.lookHit) {
      const def = BLOCKS[this.lookHit.id];
      if (def.itemKey && getItem(def.itemKey)) {
        if (p.gamemode === GAMEMODE.CREATIVE) {
          const slot = p.inventory.selected;
          p.inventory.slots[slot] = makeStack(def.itemKey, 1);
          p.inventory.changed();
        } else p.inventory.pickBlock(def.itemKey);
      }
    }
  }

  tickMining(dt) {
    const hit = this.lookHit;
    const p = this.player;
    const def = BLOCKS[hit.id];
    if (def.hardness < 0) { this.renderer.crack.visible = false; return; }

    const key = `${hit.x},${hit.y},${hit.z}`;
    if (this.mineTarget !== key) { this.mineTarget = key; this.mineProgress = 0; }

    if (p.gamemode === GAMEMODE.CREATIVE) { this.breakBlock(hit.x, hit.y, hit.z, true); return; }

    const held = p.inventory.held();
    const tool = held ? getItem(held.key)?.tool : null;
    let speed = 1;
    if (tool && (tool.type === def.tool || (tool.type === 'shears' && (def.tool === 'shears' || def.key === 'wool')))) {
      speed = tool.speed;
    }
    if (p.inWater && !p.onGround) speed *= 0.2;
    else if (p.inWater) speed *= 0.5;
    if (!p.onGround) speed *= 0.35;

    const canHarvest = def.tier === 0 ||
      (tool && tool.type === def.tool && tool.tier >= def.tier);
    const time = (def.hardness * (canHarvest ? 1.5 : 5)) / speed;
    this.mineProgress += dt / Math.max(0.05, time);

    const stage = Math.min(CRACK_STAGES - 1, Math.floor(this.mineProgress * CRACK_STAGES));
    this.renderer.crack.visible = true;
    this.renderer.crack.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
    this.renderer.setCrackStage(stage);

    this._digSoundT = (this._digSoundT || 0) + dt;
    if (this._digSoundT > 0.28) {
      this._digSoundT = 0;
      this.audio.play(materialSound(def), { volume: 0.34, rate: 1.4, pos: [hit.x, hit.y, hit.z] });
      this.particles.blockHit(hit.x, hit.y, hit.z, hit.id, hit.nx, hit.ny, hit.nz, 1);
    }

    if (this.mineProgress >= 1) {
      this.breakBlock(hit.x, hit.y, hit.z, canHarvest);
      this.mineProgress = 0;
      if (held && getItem(held.key)?.tool) {
        if (p.inventory.damageHeld(1)) this.audio.play('dig_wood', { rate: 0.5, volume: 0.8 });
      }
      p.addExhaustion(0.005);
    }
  }

  breakBlock(x, y, z, harvest) {
    const id = this.world.getBlock(x, y, z);
    if (id === B.AIR) return;
    const def = BLOCKS[id];
    if (def.hardness < 0) return;

    this.particles.blockBreak(x, y, z, id);
    this.audio.play(materialSound(def), { volume: 0.75, pos: [x, y, z] });

    if (harvest && this.player.gamemode !== GAMEMODE.CREATIVE) {
      const drops = this.rollDrops(def);
      for (const d of drops) this.dropItem(x + 0.5, y + 0.5, z + 0.5, d);
      if (def.xp) this.spawnXp(x + 0.5, y + 0.5, z + 0.5, def.xp);
    }

    // block entity contents spill out
    const data = this.world.getEntityData(x, y, z);
    if (data && data.items) {
      for (const s of data.items) if (s) this.dropItem(x + 0.5, y + 0.6, z + 0.5, s);
      this.world.deleteEntityData(x, y, z);
    }
    if (data && data.furnace) {
      for (const s of [data.furnace.input, data.furnace.fuel, data.furnace.output]) {
        if (s) this.dropItem(x + 0.5, y + 0.6, z + 0.5, s);
      }
      this.world.deleteEntityData(x, y, z);
    }

    this.world.setBlock(x, y, z, B.AIR);
    this.stats.blocksBroken++;
    this.afterBlockChange(x, y, z);
    // A door is one object in two blocks: break either half and the other goes
    // too, or you're left with a plank hovering in a doorway.
    if (IS_DOOR[id]) {
      for (const dy of [-1, 1]) {
        if (!IS_DOOR[this.world.getBlock(x, y + dy, z)]) continue;
        this.world.setBlock(x, y + dy, z, B.AIR);
        this.afterBlockChange(x, y + dy, z);
      }
    }
    // Same for a bed's other half.
    if (IS_BED[id]) {
      const partner = this.bedPartner(x, y, z, id);
      if (partner) {
        this.world.setBlock(partner[0], partner[1], partner[2], B.AIR);
        this.afterBlockChange(partner[0], partner[1], partner[2]);
      }
    }
    this.checkAdvancementsForBlock(id);

    // deactivate a nether portal whose frame was broken
    if (id === B.OBSIDIAN) this.breakPortalAround(x, y, z);
  }

  rollDrops(def) {
    const out = [];
    if (def.dropAlt && Math.random() < def.dropAlt[1]) {
      out.push({ key: def.dropAlt[0], count: 1 });
      return out;
    }
    if (!def.drop) return out;
    const n = def.dropMin === def.dropMax
      ? def.dropMin
      : def.dropMin + Math.floor(Math.random() * (def.dropMax - def.dropMin + 1));
    if (n > 0) out.push({ key: def.drop, count: n });
    return out;
  }

  /** Support checks + falling sand/gravel, run after any block change. */
  afterBlockChange(x, y, z) {
    // plants and torches need something under them
    for (const [dx, dy, dz] of [[0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]) {
      const nx = x + dx, ny = y + dy, nz = z + dz;
      const b = this.world.getBlock(nx, ny, nz);
      const d = BLOCKS[b];
      if (!d) continue;
      if ((d.render === 'cross' || b === B.TORCH || b === B.SNOW_LAYER) && b !== B.AIR) {
        if (!IS_SOLID[this.world.getBlock(nx, ny - 1, nz)]) {
          const drops = this.rollDrops(d);
          for (const dr of drops) this.dropItem(nx + 0.5, ny + 0.5, nz + 0.5, dr);
          this.world.setBlock(nx, ny, nz, B.AIR);
        }
      }
    }
    // falling blocks
    for (let yy = y; yy < Math.min(CHUNK_Y - 1, y + 24); yy++) {
      const b = this.world.getBlock(x, yy, z);
      if (b === B.AIR) continue;
      if (!BLOCKS[b].gravity) break;
      let ty = yy;
      while (ty > 1 && this.world.getBlock(x, ty - 1, z) === B.AIR) ty--;
      if (ty !== yy) {
        this.world.setBlock(x, yy, z, B.AIR);
        this.world.setBlock(x, ty, z, b);
      }
    }
  }

  /** Trade the selected hotbar slot with the off hand. */
  swapOffhand() {
    const inv = this.player.inventory;
    const held = inv.held();
    if (!held && !inv.offhand) return false;
    inv.slots[inv.selected] = inv.offhand || null;
    inv.offhand = held || null;
    inv.changed();
    this.audio.play('click', { volume: 0.45 });
    return true;
  }

  // -------------------------------------------------------------------------
  startUse(held, item) {
    const p = this.player;
    const hit = this.lookHit;

    // Use (not Attack) opens the existing trading screen on a villager.
    // The old game had the UI and NPC flag, but no path connecting the two.
    const npc=this.pickEntity(PLAYER.REACH);
    if(npc?.category==='mob' && !this.input.isDown('sneak') && this.interactEntity(npc, held, item)) return;

    // Hoe on grass or dirt makes farmland; needs open sky above the block.
    if (item?.tool?.type === 'hoe' && hit && canTill(this.world, hit.x, hit.y, hit.z)) {
      this.world.setBlock(hit.x, hit.y, hit.z, B.FARMLAND);
      this.afterBlockChange(hit.x, hit.y, hit.z);
      this.audio.play('hoe_till', { pos: [hit.x + 0.5, hit.y + 1, hit.z + 0.5], volume: 0.7 });
      if (p.gamemode !== GAMEMODE.CREATIVE) p.inventory.damageHeld(1);
      p.swing();
      return;
    }
    // 1. interact with the targeted block
    if (hit) {
      const def = BLOCKS[hit.id];
      if (def.interact && !this.input.isDown('sneak')) {
        if (this.interactBlock(hit, def, held, item)) return;
      }
    }

    // Minecraft's hand priority: the main hand goes first, and the off hand
    // only gets a turn when the main hand has nothing to do with a right
    // click â€” i.e. it isn't a placeable block and has no use action of its own.
    const mainHasUse = !!item && (item.useAction || item.food ||
      (item.block !== null && item.block !== undefined));
    if (!mainHasUse) {
      const off = this.player.inventory.offhand;
      const offItem = off ? getItem(off.key) : null;
      if (offItem && this.useOffhand(off, offItem)) return;
    }

    // 2. item actions
    if (item?.useAction) {
      switch (item.useAction) {
        case 'fill_bottle': return void this.fillBottle();
        case 'drink': this.drinkHold=0;this._drinkingKey=held.key;return;
        case 'block': if(p.shieldDown<=0){p.blocking=true;p.blockTime=0.3;} return;
        case 'ignite': return void this.useFlintAndSteel(hit);
        case 'throw_pearl': {
          this.throwItem('ender_pearl');
          return;
        }
        case 'throw_snowball': { this.throwItem('snowball'); return; }
        case 'throw_eye': { this.throwEye(); return; }
        case 'bucket_fill': {
          const e=p.eyePosition(), d=p.lookDir();
          return void this.useBucket(this.world.raycast(e.x,e.y,e.z,d.x,d.y,d.z,PLAYER.REACH,b=>b!==B.AIR&&(!(isWater(b)||isLava(b))||b===B.WATER||b===B.LAVA)),false);
        }
        case 'bucket_place': return void this.useBucket(hit, true);
        case 'bow': { this.bowHold = 0; return; }
        case 'bone_meal': return void this.useBoneMeal(hit);
        case 'fish': return void this.useFishingRod();
        default: break;
      }
    }
    if (item?.food) {
      if (p.hunger < 20 || item.food.effect === 'regen') { this.eatHold = 0; return; }
    }

    // 3. place a block
    if (item?.block !== null && item?.block !== undefined) this.placeBlock(item);
  }

  /**
   * Right-click with whatever is in the off hand. Returns false when it has
   * nothing to offer, so the main hand can carry on.
   */
  useOffhand(stack, item) {
    const p = this.player;
    if (item.useAction === 'block') {
      // A shield: raise it, unless a blocked hit has just knocked it down.
      // hurt() stops the damage outright while it is up.
      if (p.shieldDown <= 0) { p.blocking = true; p.blockTime = 0.35; }
      return true;
    }
    if (item.block !== null && item.block !== undefined) {
      const before = p.inventory.offhand?.count ?? 0;
      this.placeBlock(item, { fromOffhand: true });
      return (p.inventory.offhand?.count ?? 0) !== before || p.gamemode === GAMEMODE.CREATIVE;
    }
    if (item.food && (p.hunger < 20 || item.food.effect === 'regen')) {
      this.eatHold = 0;
      this._eatingOffhand = true;
      return true;
    }
    if (item.useAction === 'ignite') { this.useFlintAndSteel(this.lookHit); return true; }
    void stack;
    return false;
  }

  fillBottle() {
    const p=this.player,e=p.eyePosition(),d=p.lookDir();
    for(let t=0;t<=PLAYER.REACH;t+=0.1){
      const id=this.world.getBlock(Math.floor(e.x+d.x*t),Math.floor(e.y+d.y*t),Math.floor(e.z+d.z*t));
      if(id===B.WATER){
        if(p.inventory.transact({glass_bottle:1},[{key:'water_bottle',count:1}]))this.audio.play('bucket');
        else this.toast('Inventory full','Make room for a water bottle.');
        return;
      }
      if(IS_SOLID[id])return;
    }
    this.toast('Water needed','Aim the bottle at nearby water.');
  }

  holdUse(dt, held, item) {
    const p = this.player;
    if(item?.useAction==='block') {if(p.shieldDown<=0){p.blocking=true;p.blockTime=0.2;}return;}
    if(item?.useAction==='drink'){
      if(this._drinkingKey!==held.key){this._drinkingKey=held.key;this.drinkHold=0;}
      this.drinkHold=(this.drinkHold||0)+dt;p.eatTime=0.2;
      if(this.drinkHold>=1.5){
        this.drinkHold=0;
        if(p.inventory.transact({[held.key]:1},[{key:'glass_bottle',count:1}])){
          p.applyPotion(item.potion);this.audio.play('drink',{volume:0.8});
          this.toast(item.name,item.potion?.effect?item.desc:'Bottle returned');
        }
      }return;
    }
    if(this._eatingOffhand){
      const s=p.inventory.offhand,it=getItem(s?.key);
      if(!it?.food){this._eatingOffhand=false;return;}
      this.eatHold+=dt;p.eatTime=0.2;
      if(this.eatHold>=1.5){this.eatHold=0;if(p.eat(s.key)){
        if(--s.count<=0)p.inventory.offhand=null;p.inventory.changed();this.audio.play('eat');
      }}return;
    }
    // Keep the shield up for as long as the button is down. Only startUse used
    // to raise it, so it dropped again the moment its short timer expired.
    const mainHasUse = !!item && (item.useAction || item.food ||
      (item.block !== null && item.block !== undefined));
    if (!mainHasUse) {
      const off = p.inventory.offhand;
      const offItem = off ? getItem(off.key) : null;
      if (offItem?.useAction === 'block') {
        // Held down, the shield stays up — and comes back up by itself once
        // the recoil from a blocked hit has passed.
        if (p.shieldDown <= 0) { p.blocking = true; p.blockTime = 0.2; }
        return;
      }
    }
    if (item?.food && (p.hunger < 20 || item.food.effect === 'regen')) {
      this.eatHold += dt;
      p.eatTime = 0.2;
      if (this.eatHold % 0.28 < dt) {
        this.audio.play('eat', { volume: 0.5 });
        this.particles.blockBreak(p.pos.x - 0.2, p.pos.y + 1.2, p.pos.z - 0.2, B.DIRT, 2);
      }
      if (this.eatHold >= 1.5) {
        this.eatHold = 0;
        if (p.eat(held.key)) {
          p.inventory.consumeHeld(1);
          if (held.key === 'water_bucket' || held.key === 'lava_bucket') p.inventory.add('bucket', 1);
          this.audio.play('eat', { rate: 0.8, volume: 0.8 });
        }
      }
      return;
    }
    if (item?.useAction === 'bow') {
      this.bowHold = Math.min(1, this.bowHold + dt / 1.1);
      p.bowCharge = this.bowHold;
      return;
    }
    // continuous placement while the button is held
    if (item?.block !== null && item?.block !== undefined) {
      this._placeTimer = (this._placeTimer || 0) + dt;
      if (this._placeTimer > 0.22) { this._placeTimer = 0; this.placeBlock(item); }
    }
  }

  endUse(held, item) {
    this.drinkHold=0;this._drinkingKey=null;this.player.blocking=false;this._eatingOffhand=false;
    this.eatHold = 0;
    this.player.eatTime = 0;
    this._placeTimer = 0;
    if (item?.useAction === 'bow' && this.bowHold > 0.12) {
      const p = this.player;
      const hasArrow = p.gamemode === GAMEMODE.CREATIVE || p.inventory.count('arrow') > 0;
      if (hasArrow) {
        if (p.gamemode !== GAMEMODE.CREATIVE) p.inventory.remove('arrow', 1);
        const eye = p.eyePosition();
        const dir = p.lookDir();
        this.entities.add(new Arrow(this, eye.x, eye.y, eye.z, dir, this.bowHold, 'player'));
        this.audio.play('bow', { volume: 0.8 });
        p.inventory.damageHeld(1);
      }
    }
    this.bowHold = 0;
    this.player.bowCharge = 0;
  }

  /**
   * Swing a door. Both halves move together, so grabbing either the top or the
   * bottom opens the whole thing â€” which is what you expect and what stops a
   * door from ending up half open and half shut.
   */
  toggleDoor(x, y, z) {
    const w = this.world;
    let baseY = y;
    while (IS_DOOR[w.getBlock(x, baseY - 1, z)]) baseY--;
    let swung = 0;
    for (let dy = 0; dy < 2; dy++) {
      const id = w.getBlock(x, baseY + dy, z);
      const d = DOORS[id];
      if (!d) break;
      w.setBlock(x, baseY + dy, z, d.toggle);
      swung++;
    }
    if (!swung) return false;
    const nowOpen = DOORS[w.getBlock(x, baseY, z)].open;
    this.audio.play(nowOpen ? 'door_open' : 'door_close', { pos: [x, y, z], volume: 0.75 });
    return true;
  }

  interactBlock(hit, def, held, item) {
    const { x, y, z } = hit;
    switch (def.interact) {
      case 'enchant': case 'anvil': case 'brew': this.openContainer(def.interact,{pos:[x,y,z]});return true;
      case 'crafting': this.openContainer('crafting'); return true;
      case 'furnace': {
        const data = this.world.getEntityData(x, y, z, () => ({ type: 'furnace', furnace: newFurnace() }));
        if (!data.furnace) data.furnace = newFurnace();
        data.pos = [x, y, z];
        this.openContainer('furnace', data);
        return true;
      }
      case 'chest': {
        const data = this.world.getEntityData(x, y, z, () => ({ type: 'chest', items: [] }));
        if (!data.items) data.items = [];
        while (data.items.length < 27) data.items.push(null);
        this.openContainer('chest', data);
        return true;
      }
      case 'door': return this.toggleDoor(x, y, z);
      case 'hinge': { const h=HINGES[this.world.getBlock(x,y,z)];if(!h)return false;
        this.world.setBlock(x,y,z,h.toggle);this.audio.play(h.open?'door_close':'door_open',{pos:[x,y,z]});return true; }
      case 'bed': return this.useBed(x, y, z);
      case 'tnt': {
        if (held && held.key === 'flint_and_steel') {
          this.world.setBlock(x, y, z, B.AIR);
          this.entities.add(new PrimedTnt(this, x + 0.5, y, z + 0.5));
          this.player.inventory.damageHeld(1);
          this.audio.play('ignite', { pos: [x, y, z] });
          return true;
        }
        return false;
      }
      case 'end_frame': {
        if (held && held.key === 'ender_eye') {
          this.world.setBlock(x, y, z, B.END_PORTAL_FRAME_EYE);
          this.player.inventory.consumeHeld(1);
          this.audio.play('teleport', { pos: [x, y, z], rate: 0.7 });
          this.particles.portalSparkle(x + 0.5, y + 1, z + 0.5, 12);
          this.checkEndPortal(x, y, z);
          return true;
        }
        return false;
      }
      default: return false;
    }
    void item;
  }

  /** Take one block off whichever hand placed it. */
  _consumePlaced(opts) {
    const inv = this.player.inventory;
    if (!opts.fromOffhand) { inv.consumeHeld(1); return; }
    const s = inv.offhand;
    if (!s) return;
    s.count--;
    if (s.count <= 0) inv.offhand = null;
    inv.changed();
  }

  placeBlock(item, opts = {}) {
    const hit = this.lookHit;
    if (!hit) return;
    const p = this.player;
    const targetDef = BLOCKS[hit.id];
    let bx = hit.x, by = hit.y, bz = hit.z;
    if (!targetDef.replaceable) { bx += hit.nx; by += hit.ny; bz += hit.nz; }
    if (by < 0 || by >= CHUNK_Y) return;

    const existing = this.world.getBlock(bx, by, bz);
    if (existing !== B.AIR && !BLOCKS[existing].replaceable) return;

    let id = item.block;
    // Crops and saplings only take on their soil (farmland, soul sand, grass).
    if (soilFor(id) !== undefined && !canPlantOn(id, this.world.getBlock(bx, by - 1, bz))) return;
    // torches on walls, snow-style layering, etc.
    if (id === B.TORCH && !IS_SOLID[this.world.getBlock(bx, by - 1, bz)]) {
      const supported = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) =>
        IS_SOLID[this.world.getBlock(bx + dx, by, bz + dz)]);
      if (!supported) return;
    }
    if (BLOCKS[id].render === 'cross' && !IS_SOLID[this.world.getBlock(bx, by - 1, bz)]) return;

    // A bed is two blocks long, laid away from the player. Both halves need
    // solid footing and clear space before either is placed.
    if (IS_BED[id]) {
      const facingZ = Math.abs(Math.cos(p.yaw)) >= Math.abs(Math.sin(p.yaw));
      const dir = facingZ
        ? [0, 0, Math.cos(p.yaw) > 0 ? -1 : 1]
        : [Math.sin(p.yaw) > 0 ? -1 : 1, 0, 0];
      const hx = bx + dir[0], hz = bz + dir[2];
      const clear = (X, Z) => {
        const at = this.world.getBlock(X, by, Z);
        return (at === B.AIR || BLOCKS[at].replaceable) && IS_SOLID[this.world.getBlock(X, by - 1, Z)];
      };
      if (!clear(bx, bz) || !clear(hx, hz)) return;
      // You lie with your feet where you stood and your head further away.
      const foot = facingZ ? B.BED : B.BED_X;
      const head = facingZ ? B.BED_HEAD : B.BED_HEAD_X;
      this.world.setBlock(bx, by, bz, foot);
      this.world.setBlock(hx, by, hz, head);
      if (p.gamemode !== GAMEMODE.CREATIVE) p.inventory.consumeHeld(1);
      this.stats.blocksPlaced++;
      p.swing();
      this.audio.play(materialSound(BLOCKS[foot]), { volume: 0.6, rate: 0.9, pos: [bx, by, bz] });
      this.afterBlockChange(bx, by, bz);
      this.afterBlockChange(hx, by, hz);
      return;
    }

    // A door is two blocks tall and faces the way you're standing: it needs
    // headroom, solid footing, and an orientation before anything is placed.
    if (IS_DOOR[id]) {
      if (by + 1 >= CHUNK_Y) return;
      if (!IS_SOLID[this.world.getBlock(bx, by - 1, bz)]) return;
      const above = this.world.getBlock(bx, by + 1, bz);
      if (above !== B.AIR && !BLOCKS[above].replaceable) return;
      const facingZ = Math.abs(Math.cos(p.yaw)) >= Math.abs(Math.sin(p.yaw));
      id = DOOR_FAMILY[id][facingZ?0:1];
      this.world.setBlock(bx, by, bz, id);
      this.world.setBlock(bx, by + 1, bz, id);
      if (p.gamemode !== GAMEMODE.CREATIVE) this._consumePlaced(opts);
      this.stats.blocksPlaced++;
      p.swing();
      this.audio.play(materialSound(BLOCKS[id]), { volume: 0.6, rate: 0.9, pos: [bx, by, bz] });
      this.afterBlockChange(bx, by, bz);
      this.afterBlockChange(bx, by + 1, bz);
      return;
    }

    if (HINGES[id]) { const h=HINGES[id]; id=h.base+(Math.abs(Math.cos(p.yaw))>=Math.abs(Math.sin(p.yaw))?0:2); }

    // don't place inside the player
    if (IS_SOLID[id]) {
      const box = p.aabb();
      const h = BLOCKS[id].height;
      if (!(box.x1 <= bx || box.x0 >= bx + 1 || box.y1 <= by || box.y0 >= by + h ||
            box.z1 <= bz || box.z0 >= bz + 1)) return;
    }

    this.world.setBlock(bx, by, bz, id);
    if (BLOCKS[id].entity === 'chest') {
      this.world.getEntityData(bx, by, bz, () => ({ type: 'chest', items: new Array(27).fill(null) }));
    }
    if (BLOCKS[id].entity === 'furnace') {
      this.world.getEntityData(bx, by, bz, () => ({ type: 'furnace', furnace: newFurnace() }));
    }
    if (p.gamemode !== GAMEMODE.CREATIVE) this._consumePlaced(opts);
    this.stats.blocksPlaced++;
    p.swing();
    this.audio.play(materialSound(BLOCKS[id]), { volume: 0.6, rate: 0.9, pos: [bx, by, bz] });
    this.particles.blockHit(bx, by, bz, id, 0, 1, 0);
    this.afterBlockChange(bx, by, bz);
  }

  dropHeld(all) {
    const p = this.player;
    const s = p.inventory.held();
    if (!s) return;
    const n = all ? s.count : 1;
    const eye = p.eyePosition();
    const dir = p.lookDir();
    this.dropItem(eye.x + dir.x * 0.6, eye.y - 0.2, eye.z + dir.z * 0.6,
      { key: s.key, count: n, ...(s.dur !== undefined ? { dur: s.dur } : {}) },
      { vx: dir.x * 6, vy: dir.y * 6 + 1.6, vz: dir.z * 6, delay: 1.2 });
    p.inventory.consumeHeld(n);
  }

  // -------------------------------------------------------------------------
  pickEntity(maxDist) {
    const p = this.player;
    const eye = p.eyePosition();
    const dir = p.lookDir();
    const obstruction=this.world.raycast(eye.x,eye.y,eye.z,dir.x,dir.y,dir.z,maxDist,id=>IS_SOLID[id]===1);
    let best = null, bd = obstruction?Math.min(maxDist,obstruction.dist):maxDist;
    this.entities.each((e) => {
      if (e.dead || (e.category !== 'mob' && e.category !== 'crystal' && e.category !== 'boss')) return;
      const c = new THREE.Vector3(e.pos.x, e.pos.y + e.height * 0.5, e.pos.z);
      const to = c.clone().sub(eye);
      const along = to.dot(dir);
      if (along < 0 || along > bd) return;
      const perp = to.clone().addScaledVector(dir, -along).length();
      const r = Math.max(e.width, e.height) * 0.5 + 0.35;
      if (perp > r) return;
      bd = along;
      best = e;
    });
    return best;
  }

  attackEntity(e) {
    const p = this.player;
    const held = p.inventory.held();
    const tool = held ? getItem(held.key)?.tool : null;
    let dmg = (tool ? tool.damage : 1) + (p.effects.strength>0?3:0);
    if (p.gamemode === GAMEMODE.CREATIVE) dmg = 1000;
    const crit = !p.onGround && p.vel.y < -0.2;
    if (crit) { dmg *= 1.5; this.particles.crit(e.pos.x, e.pos.y + e.height * 0.6, e.pos.z, 5); }
    e.damage?.(dmg, 'player');
    e.knockback?.(p.pos.x, p.pos.z, 1);
    if (held && tool) p.inventory.damageHeld(1);
    p.addExhaustion(0.1);
    this.audio.play('dig_wood', { rate: 1.6, volume: 0.4 });
  }

  // =========================================================================
  // Items, XP, drops
  // =========================================================================
  dropItem(x, y, z, stack, opts) {
    if (!stack || !stack.key || stack.count <= 0) return null;
    const e = new ItemEntity(this, x, y, z, { ...stack }, opts);
    return this.entities.add(e);
  }

  spawnXp(x, y, z, amount) {
    let left = amount;
    let guard = 0;
    while (left > 0 && guard++ < 40) {
      const n = Math.min(left, 1 + Math.floor(Math.random() * 4));
      left -= n;
      this.entities.add(new XpOrb(this, x, y, z, n));
    }
  }

  onItemPickup(key, count) {
    this.audio.play('pop', { volume: 0.5, throttle: 0.05 });
    const inv = this.player.inventory;
    for (let i = 0; i < 9; i++) {
      if (inv.slots[i]?.key === key) {
        this.hud.slotEls[i].classList.add('pop');
        setTimeout(() => this.hud.slotEls[i]?.classList.remove('pop'), 240);
        break;
      }
    }
    this.checkAdvancementsForItem(key);
    void count;
  }

  onMobKilled(mob) {
    this.stats.mobsKilled++;
    void mob;
  }

  onMobBred(a, b, baby) {
    this.stats.animalsBred = (this.stats.animalsBred || 0) + 1;
    this.unlockAdvancement?.('husbandry');
    void a; void b; void baby;
  }

  // =========================================================================
  // 3.1: feeding, taming, shearing, trading, farming, fishing
  // =========================================================================

  /** Right-click on a mob. Returns true when the click was consumed. */
  interactEntity(mob, held, item) {
    const p = this.player;
    const result = mob.interact?.(held);
    if (!result) return false;
    const creative = p.gamemode === GAMEMODE.CREATIVE;
    const name = MOBS[mob.kind] ? mob.kind.replace('_', ' ') : 'animal';
    switch (result) {
      case 'fed':
        if (!creative) p.inventory.consumeHeld(1);
        p.swing();
        return true;
      case 'tamed':
        if (!creative) p.inventory.consumeHeld(1);
        this.toast('Tamed!', `The ${name} is yours now`, held?.key);
        this.unlockAdvancement?.('best_friends');
        p.swing();
        return true;
      case 'tame_failed':
        if (!creative) p.inventory.consumeHeld(1);
        p.swing();
        return true;
      case 'sheared':
        if (!creative) p.inventory.damageHeld(1);
        p.swing();
        return true;
      case 'sit': this.toast('Wolf', 'Sitting — click again to follow'); return true;
      case 'stand': this.toast('Wolf', 'Following you'); return true;
      case 'trade': {
        const prof = PROFESSIONS[mob.profession];
        this.openContainer('trade', { trades: mob.trades, title: prof ? `${prof.name} Villager` : 'Villager', mob });
        return true;
      }
      default: return false;
    }
    void item;
  }

  useBoneMeal(hit) {
    if (!hit) return;
    const p = this.player;
    // Bone meal on the side of a lawn targets the grass block, on a crop the crop.
    // Aiming at the soil under a crop should still feed the crop.
    let grew = boneMeal(this.world, hit.x, hit.y, hit.z);
    if (!grew && hit.ny === 1) grew = boneMeal(this.world, hit.x, hit.y + 1, hit.z);
    if (!grew) return;
    this.afterBlockChange(hit.x, hit.y, hit.z);
    for (let dy = 0; dy <= 8; dy++) this.afterBlockChange(hit.x, hit.y + dy, hit.z);
    this.particles.hearts(hit.x + 0.5, hit.y + 0.9, hit.z + 0.5, 4);
    this.audio.play('dig_grass', { pos: [hit.x + 0.5, hit.y + 0.5, hit.z + 0.5], rate: 1.3, volume: 0.6 });
    if (p.gamemode !== GAMEMODE.CREATIVE) p.inventory.consumeHeld(1);
    p.swing();
  }

  useFishingRod() {
    const p = this.player;
    p.swing();
    if (this.bobber && !this.bobber.dead) {
      // Reel in.
      const b = this.bobber;
      if (b.biting) {
        const loot = rollFishingLoot(Math.random, (k) => !!getItem(k));
        const dx = p.pos.x - b.pos.x, dz = p.pos.z - b.pos.z;
        const l = Math.hypot(dx, dz) || 1;
        this.dropItem(b.pos.x, b.pos.y + 0.3, b.pos.z, { key: loot.key, count: loot.count },
          { vx: (dx / l) * Math.min(9, l * 2.2), vy: 6 + l * 0.35, vz: (dz / l) * Math.min(9, l * 2.2), delay: 0.6 });
        this.spawnXp(p.pos.x, p.pos.y + 0.5, p.pos.z, 1 + Math.floor(Math.random() * 6));
        this.stats.fishCaught = (this.stats.fishCaught || 0) + 1;
        this.unlockAdvancement?.('fishy_business');
        this.audio.play('splash', { pos: [b.pos.x, b.pos.y, b.pos.z], volume: 0.7 });
        if (p.gamemode !== GAMEMODE.CREATIVE) p.inventory.damageHeld(1);
      } else {
        this.audio.play('bow', { rate: 1.8, volume: 0.35 });
      }
      b.remove();
      this.bobber = null;
      return;
    }
    // Cast.
    const eye = p.eyePosition();
    const dir = p.lookDir();
    const rainy = this.weather.intensity > 0.4;
    this.bobber = this.entities.add(new Bobber(this, eye.x + dir.x * 0.5, eye.y - 0.1, eye.z + dir.z * 0.5, dir, rainy));
    this.audio.play('bow', { rate: 1.6, volume: 0.45 });
  }

  onCrafted(recipe) {
    this.stats.itemsCrafted += recipe.out.count;
    this.checkAdvancementsForItem(recipe.out.key);
  }

  onFootstep(p) {
    const b = this.world.getBlock(Math.floor(p.pos.x), Math.floor(p.pos.y - 0.2), Math.floor(p.pos.z));
    if (b === B.AIR) return;
    const def = BLOCKS[b];
    const s = materialSound(def).replace('dig_', 'step_');
    this.audio.play(s in { step_grass: 1, step_stone: 1, step_wood: 1, step_sand: 1, step_snow: 1 } ? s : 'step_stone',
      { volume: 0.28, pos: [p.pos.x, p.pos.y, p.pos.z] });
    if (this.settings.get('particles') !== false && Math.random() < 0.4) {
      this.particles.footstep(p.pos.x, p.pos.y, p.pos.z, b);
    }
  }

  onPlayerHurt(dmg, cause) {
    this.audio.play('hurt', { volume: 0.8 });
    this.shake(0.35);
    void dmg; void cause;
  }

  /** A hit the shield stopped: a dull clonk and a shove, but no damage. */
  onShieldBlock(amount, from) {
    this.audio.play('shield_block', { volume: 0.7 });
    this.shake(0.18);
    const p = this.player;
    if (from) {
      const dx = p.pos.x - from.x, dz = p.pos.z - from.z;
      const l = Math.hypot(dx, dz) || 1;
      const push = Math.min(3.4, 1.2 + amount * 0.2);
      p.vel.x += (dx / l) * push;
      p.vel.z += (dz / l) * push;
    }
  }

  onPlayerDeath(cause) {
    this.stats.deaths++;
    this.lastDeath={pos:[Math.floor(this.player.pos.x),Math.floor(this.player.pos.y),Math.floor(this.player.pos.z)],dim:this.world.dim};
    document.getElementById('death-location').textContent=`Last location: ${this.lastDeath.pos.join(', ')} · ${['Overworld','Nether','End'][this.world.dim]}`;
    this.state = 'dead';
    this.input.enabled = false;
    this.input.exitLock();
    this.containers.close();
    this.audio.play('death', { volume: 0.9 });
    if (!this.gamerules.keepInventory) {
      const drop = this.player.inventory.drainAll();
      for (const s of drop) {
        this.dropItem(this.player.pos.x, this.player.pos.y + 0.6, this.player.pos.z, s, { delay: 2 });
      }
    }
    const score = Math.round(this.player.xp + this.player.level * 7 + this.stats.blocksBroken);
    this.menus.showDeath(cause, score);
    this.save();
  }

  respawn() {
    const p = this.player;
    let pos = p.spawnPoint;
    this.menus.hideAll();
    this.hud.show(true);
    if (this.world.dim !== DIM.OVERWORLD) {
      // travelTo drives the loading screen and hands control back on arrival
      p.respawn(pos || [0.5, 80, 0.5]);
      this.travelTo(DIM.OVERWORLD, pos || [0.5, 80, 0.5], { silent: true });
      return;
    }
    if (!pos) pos = this.world.findSpawn(0, 0) || [0.5, 90, 0.5];
    const safe = this.world.surfaceAt(Math.floor(pos[0]), Math.floor(pos[2]));
    p.respawn([pos[0], safe > 0 ? safe : pos[1], pos[2]]);
    this.state = 'playing';
    this.input.enabled = true;
    this.input.requestLock();
  }

  shake(a) { this.shakeAmount = Math.min(1.2, this.shakeAmount + a); }
  toast(t, s, i) { this.hud.toast(t, s, i); }
  blockName(id) { return BLOCKS[id]?.name || 'Air'; }

  hintCrystals() {
    if (this._crystalHintTimer > 0) return;
    this._crystalHintTimer = 6;
    this.toast('The End Crystals', 'Destroy the crystals on the pillars â€” they heal the dragon', 'ender_eye');
  }

  // =========================================================================
  // Furnaces & ambience
  // =========================================================================
  tickFurnaces(dt) {
    this._furnaceAcc = (this._furnaceAcc || 0) + dt;
    const ticks = Math.floor(this._furnaceAcc * 20);
    if (ticks <= 0) return;
    this._furnaceAcc -= ticks / 20;
    const store = this.world.blockEntities[this.world.dim];
    for (const [key, data] of store) {
      if (!data.furnace) continue;
      const changed = tickFurnace(data.furnace, Math.min(ticks, 40));
      if (!changed) continue;
      const [x, y, z] = key.split(',').map(Number);
      const cur = this.world.getBlock(x, y, z);
      const lit = isLit(data.furnace);
      if (lit && cur === B.FURNACE) this.world.setBlock(x, y, z, B.FURNACE_LIT, { noSave: false });
      else if (!lit && cur === B.FURNACE_LIT) this.world.setBlock(x, y, z, B.FURNACE, { noSave: false });
      if (lit && Math.random() < 0.25) {
        this.particles.smoke(x + 0.5, y + 1.05, z + 0.5, 1, 0.35);
      }
    }
    if (this.containers.open && this.containers.type === 'furnace') this.containers.refresh();
  }

  updateAmbience(dt) {
    this._ambSample=(this._ambSample||0)+dt;
    if(this._ambSample<0.1)return;
    dt=this._ambSample;this._ambSample=0;
    const p = this.player;
    const w = this.world;
    let water = 0, lava = 0, portal = 0, furnace=0;
    const px = Math.floor(p.pos.x), py = Math.floor(p.pos.y), pz = Math.floor(p.pos.z);
    for (let dy = -3; dy <= 3; dy += 2) {
      for (let dz = -5; dz <= 5; dz += 2) {
        for (let dx = -5; dx <= 5; dx += 2) {
          const b = w.getBlock(px + dx, py + dy, pz + dz);
          if(b===B.FURNACE_LIT)furnace++;
          if (isWater(b)) water++;
          else if (isLava(b)) lava++;
          else if (b === B.NETHER_PORTAL || b === B.END_PORTAL) portal++;
        }
      }
    }
    this.audio.setLoop('water_amb', Math.min(0.6, water / 40) * (p.headInWater ? 2 : 1));
    this.audio.setLoop('lava_amb', Math.min(0.7, lava / 30));
    this.audio.setLoop('portal_hum', Math.min(0.6, portal / 6));
    this.audio.setLoop('furnace_amb',Math.min(0.4,furnace*0.2));

    // Cave ambience. It only creeps in when you are both deep and properly
    // roofed over, so a shaded valley at ground level stays silent.
    let roof = 0;
    for (let dy = 2; dy <= 24; dy += 2) {
      if (w.getBlock(px, py + dy, pz)) roof++;
    }
    const depth = Math.max(0, Math.min(1, (56 - py) / 40));
    this.audio.setLoop('cave_amb', roof >= 4 ? depth * 0.55 : 0);

    if (this.settings.get('particles') !== false) {
      // torch flames and portal sparkles near the player
      this._ambT = (this._ambT || 0) + dt;
      if (this._ambT > 0.08) {
        this._ambT = 0;
        for (let i = 0; i < 6; i++) {
          const x = px + Math.floor((Math.random() - 0.5) * 18);
          const y = py + Math.floor((Math.random() - 0.5) * 10);
          const z = pz + Math.floor((Math.random() - 0.5) * 18);
          const b = w.getBlock(x, y, z);
          if (b === B.TORCH) this.particles.flame(x + 0.5, y + 0.62, z + 0.5, 1);
          else if (b === B.NETHER_PORTAL || b === B.END_PORTAL) this.particles.portalSparkle(x + 0.5, y + 0.5, z + 0.5, 1);
          else if (isLava(b) && w.getBlock(x, y + 1, z) === B.AIR && Math.random() < 0.25) {
            this.particles.flame(x + 0.5, y + 1, z + 0.5, 1);
          }
        }
      }
    }
  }

  onLightning(x, y, z) {
    const d = Math.hypot(x - this.player.pos.x, z - this.player.pos.z);
    if (d < 4) this.player.hurt(5, 'was struck by lightning', this);
    const b = this.world.getBlock(x, y - 1, z);
    if (BLOCKS[b]?.flammable && this.world.getBlock(x, y, z) === B.AIR && Math.random() < 0.4) {
      this.world.setBlock(x, y, z, B.FIRE);
      setTimeout(() => {
        if (this.world && this.world.getBlock(x, y, z) === B.FIRE) this.world.setBlock(x, y, z, B.AIR);
      }, 8000);
    }
  }

  // =========================================================================
  // Portals & dimensions
  // =========================================================================
  useFlintAndSteel(hit) {
    if (!hit) return;
    const p = this.player;
    const { x, y, z, nx, ny, nz } = hit;
    if (hit.id === B.OBSIDIAN) {
      if (this.tryLightNetherPortal(x + nx, y + ny, z + nz)) {
        p.inventory.damageHeld(1);
        this.audio.play('ignite', { pos: [x, y, z] });
        this.unlockAdvancement('nether_ready');
        return;
      }
    }
    const fx = x + nx, fy = y + ny, fz = z + nz;
    if (this.world.getBlock(fx, fy, fz) === B.AIR && IS_SOLID[this.world.getBlock(fx, fy - 1, fz)]) {
      this.world.setBlock(fx, fy, fz, B.FIRE);
      this.audio.play('ignite', { pos: [fx, fy, fz] });
      p.inventory.damageHeld(1);
      setTimeout(() => {
        if (this.world && this.world.getBlock(fx, fy, fz) === B.FIRE) {
          this.world.setBlock(fx, fy, fz, B.AIR);
        }
      }, 6000 + Math.random() * 6000);
    }
  }

  /**
   * Flood-fill the air pocket enclosed by obsidian in either vertical plane.
   * Anything fully enclosed and at least 2x3 becomes a portal.
   */
  tryLightNetherPortal(sx, sy, sz) {
    for (const axis of ['x', 'z']) {
      const cells = this.floodPortal(sx, sy, sz, axis);
      if (cells) {
        for (const [x, y, z] of cells) this.world.setBlock(x, y, z, B.NETHER_PORTAL);
        this.audio.play('portal_travel', { volume: 0.6, rate: 1.4 });
        this.toast('Nether Portal', 'Step through to travel', 'obsidian');
        return true;
      }
    }
    return false;
  }

  floodPortal(sx, sy, sz, axis) {
    const w = this.world;
    if (w.getBlock(sx, sy, sz) !== B.AIR) return null;
    const seen = new Set();
    const stack = [[sx, sy, sz]];
    const cells = [];
    const dirs = axis === 'x'
      ? [[0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]
      : [[0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0]];
    let minY = Infinity, maxY = -Infinity, minO = Infinity, maxO = -Infinity;
    while (stack.length) {
      const [x, y, z] = stack.pop();
      const k = `${x},${y},${z}`;
      if (seen.has(k)) continue;
      seen.add(k);
      if (cells.length > 120) return null;
      const b = w.getBlock(x, y, z);
      if (b === B.OBSIDIAN) continue;
      if (b !== B.AIR && b !== B.FIRE) return null;
      cells.push([x, y, z]);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      const o = axis === 'x' ? z : x;
      minO = Math.min(minO, o); maxO = Math.max(maxO, o);
      for (const [dx, dy, dz] of dirs) stack.push([x + dx, y + dy, z + dz]);
    }
    if (!cells.length) return null;
    const h = maxY - minY + 1, wdt = maxO - minO + 1;
    if (h < 3 || wdt < 2 || h > 21 || wdt > 21) return null;
    // Verify the whole rectangle is air and fully framed.
    for (const [x, y, z] of cells) {
      for (const [dx, dy, dz] of dirs) {
        const b = w.getBlock(x + dx, y + dy, z + dz);
        if (b !== B.AIR && b !== B.OBSIDIAN && b !== B.FIRE) return null;
      }
    }
    return cells;
  }

  breakPortalAround(x, y, z) {
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      if (this.world.getBlock(x + dx, y + dy, z + dz) === B.NETHER_PORTAL) {
        this.clearPortalBlocks(x + dx, y + dy, z + dz);
      }
    }
  }

  clearPortalBlocks(sx, sy, sz) {
    const stack = [[sx, sy, sz]];
    const seen = new Set();
    let guard = 0;
    while (stack.length && guard++ < 200) {
      const [x, y, z] = stack.pop();
      const k = `${x},${y},${z}`;
      if (seen.has(k)) continue;
      seen.add(k);
      if (this.world.getBlock(x, y, z) !== B.NETHER_PORTAL) continue;
      this.world.setBlock(x, y, z, B.AIR);
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
        stack.push([x + dx, y + dy, z + dz]);
      }
    }
  }

  updatePortals(dt) {
    const p = this.player;
    if (p.inPortal >= 1 && !this.arrival) {
      const to = this.world.dim === DIM.NETHER ? DIM.OVERWORLD : DIM.NETHER;
      const scale = to === DIM.NETHER ? 1 / NETHER_SCALE : NETHER_SCALE;
      this.travelTo(to, [p.pos.x * scale, p.pos.y, p.pos.z * scale], { portal: true });
      return;
    }
    if (p.inEndPortal && !this.arrival) {
      if (this.world.dim === DIM.END) {
        this.travelTo(DIM.OVERWORLD, p.spawnPoint || [0.5, 80, 0.5]);
        if (this.won) this.showVictory();
      } else {
        this.travelTo(DIM.END, [0.5, 68, 0.5]);
      }
    }
    void dt;
  }

  /**
   * @param opts.portal  build/reuse a linked nether portal at the destination
   * @param opts.silent  skip the travel sound (respawns, debug jumps)
   */
  travelTo(dim, pos, opts = {}) {
    if (this.arrival) return;
    const p = this.player;
    if (!opts.silent) this.audio.play('portal_travel', { volume: 0.9 });
    this.save();
    this.entities.clear();
    this.dragon = null;
    this.particles.clear();
    p.inPortal = 0;
    p.inEndPortal = false;
    p.vel.set(0, 0, 0);
    p.fallDistance = 0;

    this.world.setDimension(dim);
    this.sky.setDimension(dim);
    this.weather.setDimension(dim);
    p.pos.set(pos[0], Math.max(4, Math.min(CHUNK_Y - 4, pos[1])), pos[2]);

    this.state = 'loading';
    this.input.enabled = false;
    this.menus.show('loading');
    this.menus.setLoading(0.05, dim === DIM.NETHER ? 'Entering the Netherâ€¦'
      : dim === DIM.END ? 'Entering the Endâ€¦' : 'Returning to the Overworldâ€¦');
    this.arrival = { dim, pos: [...pos], t: 0, portal: !!opts.portal };
  }

  updateArrival(dt) {
    if (!this.arrival) return;
    const a = this.arrival;
    a.t += dt;
    const p = this.player;
    this.world.update(p.pos.x, p.pos.z, 8);
    this.world.flushSets();
    const cx = Math.floor(p.pos.x / 16), cz = Math.floor(p.pos.z / 16);
    let ready = 0;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) if (this.world.chunks.has(`${cx + dx},${cz + dz}`)) ready++;
    }
    this.menus.setLoading(0.05 + (ready / 9) * 0.9, 'Building the worldâ€¦');
    if (ready < 9 && a.t < 14) return;

    this.arrival = null;
    if (a.portal && a.dim !== DIM.END) this.ensureArrivalPortal(a.dim, p);
    if (a.dim === DIM.END) this.setupEndFight();

    // land safely
    let y = Math.floor(p.pos.y);
    let found = -1;
    for (let d = 0; d < 40; d++) {
      for (const yy of [y - d, y + d]) {
        if (yy < 2 || yy > CHUNK_Y - 4) continue;
        if (this.world.getBlock(Math.floor(p.pos.x), yy, Math.floor(p.pos.z)) === B.AIR &&
            this.world.getBlock(Math.floor(p.pos.x), yy + 1, Math.floor(p.pos.z)) === B.AIR &&
            IS_SOLID[this.world.getBlock(Math.floor(p.pos.x), yy - 1, Math.floor(p.pos.z))]) {
          found = yy; break;
        }
      }
      if (found >= 0) break;
    }
    if (found >= 0) p.pos.y = found;

    this.menus.hideAll();
    this.state = 'playing';
    this.input.enabled = true;
    this.input.requestLock();
    this.particles.enderPop(p.pos.x, p.pos.y + 1, p.pos.z, 30);
    if (a.dim === DIM.NETHER) this.unlockAdvancement('nether');
    if (a.dim === DIM.END) this.unlockAdvancement('end');
  }

  /** Find an existing portal near the arrival point, or carve a fresh one. */
  ensureArrivalPortal(dim, p) {
    const w = this.world;
    const px = Math.floor(p.pos.x), pz = Math.floor(p.pos.z);
    for (let r = 0; r <= 12; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          for (let y = 6; y < CHUNK_Y - 6; y++) {
            if (w.getBlock(px + dx, y, pz + dz) === B.NETHER_PORTAL) {
              p.pos.set(px + dx + 0.5, y, pz + dz + 0.5);
              return;
            }
          }
        }
      }
    }
    // build one
    let baseY = -1;
    const lo = dim === DIM.NETHER ? 34 : 8;
    const hi = dim === DIM.NETHER ? 96 : CHUNK_Y - 12;
    const start = Math.max(lo, Math.min(hi, Math.floor(p.pos.y)));
    for (let d = 0; d < 60; d++) {
      for (const y of [start - d, start + d]) {
        if (y < lo || y > hi) continue;
        if (!IS_SOLID[w.getBlock(px, y - 1, pz)]) continue;
        let clear = true;
        for (let k = 0; k < 5 && clear; k++) if (w.getBlock(px, y + k, pz) === B.LAVA) clear = false;
        if (clear) { baseY = y; break; }
      }
      if (baseY > 0) break;
    }
    if (baseY < 0) baseY = Math.max(lo, Math.min(hi, Math.floor(p.pos.y)));

    // clear a pocket and build a 4x5 obsidian frame on the X axis
    for (let dx = -3; dx <= 3; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        for (let dy = -1; dy <= 6; dy++) {
          const b = w.getBlock(px + dx, baseY + dy, pz + dz);
          if (dy === -1) { if (!IS_SOLID[b]) w.setBlock(px + dx, baseY - 1, pz + dz, B.OBSIDIAN); }
          else if (b !== B.AIR) w.setBlock(px + dx, baseY + dy, pz + dz, B.AIR);
        }
      }
    }
    for (let dx = -1; dx <= 2; dx++) {
      w.setBlock(px + dx, baseY - 1, pz, B.OBSIDIAN);
      w.setBlock(px + dx, baseY + 4, pz, B.OBSIDIAN);
    }
    for (let dy = 0; dy <= 3; dy++) {
      w.setBlock(px - 1, baseY + dy, pz, B.OBSIDIAN);
      w.setBlock(px + 2, baseY + dy, pz, B.OBSIDIAN);
    }
    for (let dx = 0; dx <= 1; dx++) {
      for (let dy = 0; dy <= 3; dy++) w.setBlock(px + dx, baseY + dy, pz, B.NETHER_PORTAL);
    }
    p.pos.set(px + 0.5, baseY, pz + 2.5);
    if (!IS_SOLID[w.getBlock(px, baseY - 1, pz + 2)]) w.setBlock(px, baseY - 1, pz + 2, B.OBSIDIAN);
  }

  // -------------------------------------------------------------------------
  checkEndPortal(x, y, z) {
    // Find the 12-frame ring this frame belongs to and activate it when full.
    for (let cx = x - 2; cx <= x + 2; cx++) {
      for (let cz = z - 2; cz <= z + 2; cz++) {
        const ring = [];
        for (let i = -1; i <= 1; i++) {
          ring.push([cx + i, cz - 2], [cx + i, cz + 2], [cx - 2, cz + i], [cx + 2, cz + i]);
        }
        let filled = 0;
        for (const [fx, fz] of ring) {
          const b = this.world.getBlock(fx, y, fz);
          if (b === B.END_PORTAL_FRAME_EYE) filled++;
          else if (b !== B.END_PORTAL_FRAME) { filled = -99; break; }
        }
        if (filled === 12) {
          for (let i = -1; i <= 1; i++) {
            for (let j = -1; j <= 1; j++) this.world.setBlock(cx + i, y, cz + j, B.END_PORTAL);
          }
          this.audio.play('portal_travel', { volume: 1 });
          this.toast('End Portal', 'The portal is open. Jump in.', 'ender_eye');
          this.unlockAdvancement('stronghold');
          return;
        }
      }
    }
  }

  setupEndFight() {
    if (this.dragonDead) {
      // place the exit portal + trophy for a returning player
      this.buildExitPortal();
      return;
    }
    // Pillar positions must match worldgen exactly.
    const PILLARS = 10;
    for (let i = 0; i < PILLARS; i++) {
      if (this.crystalsDestroyed.includes(i)) continue;
      const ang = (i / PILLARS) * Math.PI * 2;
      const px = Math.round(Math.cos(ang) * 36), pz = Math.round(Math.sin(ang) * 36);
      const ph = 64 + 20 + (i % 4) * 7;
      const c = new EndCrystal(this, px + 0.5, ph + 2, pz + 0.5);
      c.index = i;
      this.entities.add(c);
    }
    this.dragon = new EnderDragon(this, this.dragonHealth);
    this.entities.add(this.dragon);
    this.toast('The Ender Dragon', 'Destroy the End Crystals first!', 'ender_eye');
  }

  onCrystalDestroyed(c) {
    if (c.index !== undefined && !this.crystalsDestroyed.includes(c.index)) {
      this.crystalsDestroyed.push(c.index);
    }
    const left = Math.max(0, this.entities.countCategory('crystal') - 1);
    if (left === 0) this.toast('End Crystals', 'All crystals destroyed â€” the dragon is vulnerable!');
    else this.toast('End Crystal destroyed', `${left} remaining`);
  }

  onDragonDying() {
    this.state = 'playing';
    this.audio.stopMusic();
  }

  onDragonDead() {
    this.dragonDead = true;
    this.dragon = null;
    this.won = true;
    if (this.saveMeta) this.saveMeta.won = true;
    this.spawnXp(0.5, 68, 0.5, 120);
    this.buildExitPortal();
    this.unlockAdvancement('dragon');
    this.victoryPending = 3.2;
    this.save();
  }

  buildExitPortal() {
    const w = this.world;
    const TOP = 64;
    for (let dx = -3; dx <= 3; dx++) {
      for (let dz = -3; dz <= 3; dz++) {
        const d = Math.max(Math.abs(dx), Math.abs(dz));
        for (let dy = 1; dy <= 4; dy++) w.setBlock(dx, TOP + dy, dz, B.AIR);
        if (d === 3) w.setBlock(dx, TOP + 1, dz, B.BEDROCK);
        else if (d === 0) w.setBlock(dx, TOP + 1, dz, B.END_PORTAL);
        else w.setBlock(dx, TOP + 1, dz, d === 1 ? B.END_PORTAL : B.BEDROCK);
      }
    }
    w.setBlock(0, TOP + 4, 0, B.DRAGON_EGG);
    w.setBlock(0, TOP + 3, 0, B.BEDROCK);
    w.setBlock(0, TOP + 2, 0, B.BEDROCK);

    // The portal opens directly under the player's feet, so step them clear â€”
    // otherwise the victory is cut short by an instant trip home.
    const p = this.player;
    if (p && Math.max(Math.abs(p.pos.x), Math.abs(p.pos.z)) < 5) {
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          for (let dy = 1; dy <= 3; dy++) w.setBlock(6 + dx, TOP + dy, dz, B.AIR);
        }
      }
      w.setBlock(6, TOP, 0, B.END_STONE);
      p.pos.set(6.5, TOP + 1, 0.5);
      p.vel.set(0, 0, 0);
      p.fallDistance = 0;
      p.inEndPortal = false;
    }
  }

  showVictory() {
    if (this._victoryShown) return;
    this._victoryShown = true;
    this.state = 'victory';
    this.input.enabled = false;
    this.input.exitLock();
    this.hud.show(false);
    this.menus.showVictory({ ...this.stats, playtime: this.playtime });
    this.audio.startMusic();
    this.save();
  }

  endVictory() {
    this._victoryShown = false;
    this.menus.hideAll();
    this.hud.show(true);
    this.state = 'playing';
    this.input.enabled = true;
    this.input.requestLock();
  }

  // =========================================================================
  // Advancements
  // =========================================================================
  /**
   * Advancements are always earnable here, in creative and with commands on
   * alike â€” Minecraft locks them out, we deliberately don't.
   */
  unlockAdvancement(key) {
    if (this.advancements[key]) return;
    const a = ADVANCEMENTS.find((x) => x[0] === key);
    this.advancements[key] = true;
    if (a) {
      this.toast('Advancement Made!', a[1]);
      this.audio.play('levelup', { volume: 0.5 });
    }
    if (this.advancementScreen?.open) this.advancementScreen.render();
  }

  checkAdvancementsForBlock(id) {
    if (id === B.OAK_LOG || id === B.BIRCH_LOG || id === B.SPRUCE_LOG) this.unlockAdvancement('wood');
    if (id === B.DIAMOND_ORE) this.unlockAdvancement('diamonds');
    if (id === B.OBSIDIAN) this.unlockAdvancement('obsidian');
  }

  checkAdvancementsForItem(key) {
    if (key === 'crafting_table') this.unlockAdvancement('bench');
    if (key.startsWith('stone_')) this.unlockAdvancement('stone_age');
    if (key === 'iron_ingot') this.unlockAdvancement('iron');
    if (key === 'diamond') this.unlockAdvancement('diamonds');
    if (key === 'obsidian') this.unlockAdvancement('obsidian');
    if (key === 'blaze_rod') this.unlockAdvancement('blaze');
    if (key === 'ender_pearl') this.unlockAdvancement('pearl');
    if (key === 'ender_eye') this.unlockAdvancement('eye');
  }

  // =========================================================================
  // Misc actions
  // =========================================================================
  throwItem(key) {
    const p = this.player;
    if (p.gamemode !== GAMEMODE.CREATIVE && !p.inventory.consumeHeld(1)) return;
    const eye = p.eyePosition();
    const dir = p.lookDir();
    this.entities.add(new ThrownItem(this, eye.x + dir.x * 0.4, eye.y, eye.z + dir.z * 0.4, dir, key));
    this.audio.play('bow', { rate: 1.4, volume: 0.5 });
  }

  throwEye() {
    const p = this.player;
    if (this.world.dim !== DIM.OVERWORLD) {
      this.toast('Eye of Ender', 'It only works in the Overworld');
      return;
    }
    const site = nearestStronghold(this.world.seed, p.pos.x, p.pos.z);
    const dist = site ? Math.hypot(site.x - p.pos.x, site.z - p.pos.z) : 0;
    if (p.gamemode !== GAMEMODE.CREATIVE && !p.inventory.consumeHeld(1)) return;
    const eye = p.eyePosition();
    this.entities.add(new EnderEye(this, eye.x, eye.y, eye.z));
    if (dist < 14) {
      this.toast('Eye of Ender', 'The stronghold is right below you â€” dig down!');
      this.unlockAdvancement('stronghold');
    }
  }

  useBucket(hit, placing) {
    const p = this.player;
    const held = p.inventory.held();
    if (!hit) return;
    if (placing) {
      const bx = hit.x + hit.nx, by = hit.y + hit.ny, bz = hit.z + hit.nz;
      const at=this.world.getBlock(bx,by,bz);
      if(by<0||by>=CHUNK_Y||!this.world.isLoaded(bx,bz)||at===B.WATER||at===B.LAVA||!BLOCKS[at].replaceable&&at!==B.AIR) return;
      const fluid = held.key === 'water_bucket' ? B.WATER : B.LAVA;
      this.world.setBlock(bx, by, bz, fluid);
      if(p.gamemode!==GAMEMODE.CREATIVE) p.inventory.slots[p.inventory.selected] = makeStack('bucket', 1);
      p.inventory.changed();
      this.audio.play('splash', { pos: [bx, by, bz] });
      // Reactions are handled by the same simulation in either placement order.
    } else {
      const b = this.world.getBlock(hit.x, hit.y, hit.z);
      if (b === B.WATER || b === B.LAVA) {
        this.world.setBlock(hit.x, hit.y, hit.z, B.AIR);
        p.inventory.slots[p.inventory.selected] = makeStack(b === B.WATER ? 'water_bucket' : 'lava_bucket', 1);
        p.inventory.changed();
        this.audio.play('splash', { pos: [hit.x, hit.y, hit.z], rate: 0.7 });
      }
    }
  }

  /** Water touching lava makes obsidian â€” the intended route to a portal. */
  coolLava(x, y, z) {
    let made = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) !== 1) continue;
          if (this.world.getBlock(x + dx, y + dy, z + dz) === B.LAVA) {
            this.world.setBlock(x + dx, y + dy, z + dz, B.OBSIDIAN);
            this.particles.smoke(x + dx + 0.5, y + dy + 1, z + dz + 0.5, 6);
            made++;
          }
        }
      }
    }
    if (made) {
      this.audio.play('fizz', { pos: [x, y, z] });
      this.toast('Obsidian', 'Mine it with a diamond pickaxe', 'obsidian');
    }
  }

  /** The coordinates of a bed's other half, looking both ways along its axis. */
  bedPartner(x, y, z, id = this.world.getBlock(x, y, z)) {
    const def = BEDS[id];
    if (!def) return null;
    const d = def.axis === 'x' ? [1, 0, 0] : [0, 0, 1];
    for (const s of [1, -1]) {
      const px = x + d[0] * s, pz = z + d[2] * s;
      if (this.world.getBlock(px, y, pz) === def.other) return [px, y, pz];
    }
    return null;
  }

  useBed(x, y, z) {
    const p = this.player;
    p.spawnPoint = [x + 0.5, y + 1, z + 1.5];
    const night = this.timeOfDay > 0.52 || this.timeOfDay < 0.02;
    if (!night) {
      this.toast('Bed', 'You can only sleep at night. Spawn point set.');
      return true;
    }
    if (this.sleep) return true;
    this.beginSleep(x, y, z);
    return true;
  }

  /**
   * Lie down: the screen fades to black over a couple of seconds, the player
   * is pinned in place on the bed, and morning arrives at the far end. A
   * "Leave Bed" button cancels it at any point during the fade.
   */
  beginSleep(x, y, z) {
    const p = this.player;
    this.sleep = { x, y, z, t: 0, phase: 'in', bed: [x + 0.5, y + 0.6, z + 0.5] };
    p.vel.set(0, 0, 0);
    p.sneaking = false;
    p.sprinting = false;
    this.input.enabled = false;
    this.input.down.clear();
    this.hud.setSleeping(true);
    this.audio.play('click', { rate: 0.5, volume: 0.6 });
  }

  /** Stop sleeping — either cancelled, or finished and waking up. */
  endSleep(woke) {
    if (!this.sleep) return;
    this.sleep = null;
    this.hud.setSleeping(false);
    this.hud.setFade(0);
    this.input.enabled = true;
    this.input.down.clear();
    this.input.takeRawDelta();
    if (this.state === 'playing' && !this.input.locked) this.input.requestLock();
    if (!woke) this.toast('Bed', 'You got up. Spawn point set.');
  }

  updateSleep(dt) {
    const s = this.sleep;
    if (!s) return;
    const p = this.player;
    // Pinned to the bed while the animation runs.
    p.vel.set(0, 0, 0);
    if (s.restY === undefined) s.restY = p.pos.y;
    p.pos.set(s.bed[0], s.restY, s.bed[2]);
    s.t += dt;

    const FADE = 1.6, HOLD = 0.7;
    if (s.phase === 'in') {
      this.hud.setFade(Math.min(1, s.t / FADE));
      if (s.t >= FADE + HOLD) {
        // Morning: skip to dawn, clear the weather and top the player up.
        const dayLen = Math.max(60, this.settings.get('dayLength') * 60);
        this.time = (Math.floor(this.time / dayLen) + 1) * dayLen + 2;
        p.heal(2);
        this.weather.force(WEATHER.CLEAR);
        this.weather.intensity = 0;
        this.sky.rainDarken = 0;
        s.phase = 'out';
        s.t = 0;
        this.hud.setSleeping(false);
        this.toast('Good morning', 'You slept through the night', 'bed');
      }
      return;
    }
    this.hud.setFade(Math.max(0, 1 - s.t / FADE));
    if (s.t >= FADE) this.endSleep(true);
  }

  // =========================================================================
  // Chat commands
  // =========================================================================

  /**
   * Whether this world was created with commands enabled. Creative always has
   * them; survival is opt-in at world creation. Note that, unlike Minecraft,
   * turning them on does NOT disable advancements â€” see `unlock()`.
   */
  commandsAllowed() {
    if (!this.saveMeta) return true;              // panorama / tests
    return this.saveMeta.cheats !== false;
  }

  /**
   * Autocomplete source. Returns the candidates for the token under the caret
   * plus where that token starts, so the HUD can splice the choice back in.
   */
  completionsFor(text) {
    const empty = { items: [], tokenStart: text.length };
    if (!text.startsWith('/') || !this.commandsAllowed()) return empty;

    // Split into tokens, remembering where the one under the caret begins.
    const tokenStart = Math.max(text.lastIndexOf(' ') + 1, 0);
    const token = text.slice(tokenStart).toLowerCase();
    // A trailing space already produces an empty final token, so the index of
    // the token under the caret is parts.length - 1 either way.
    const parts = text.slice(1).split(/\s+/);
    const argIndex = parts.length - 1;

    const filter = (list) => list
      .filter((c) => c.value.toLowerCase().startsWith(token))
      .sort((a, b) => a.value.localeCompare(b.value));

    if (argIndex <= 0) {
      // completing the command name itself (the leading "/" stays put)
      return {
        items: filter(COMMANDS.map((c) => ({ value: '/' + c.name, desc: c.desc })))
          .map((c) => ({ ...c })),
        tokenStart,
      };
    }

    const cmd = COMMANDS.find((c) => c.name === parts[0].toLowerCase());
    if (!cmd || !cmd.args) return empty;
    const spec = cmd.args[argIndex - 1];
    if (!spec) return empty;
    if (spec === '<item>') {
      return { items: filter([...ITEMS.keys()].map((k) => ({ value: k }))), tokenStart };
    }
    if (spec === '<mob>') {
      return { items: filter(Object.keys(MOBS).map((k) => ({ value: k }))), tokenStart };
    }
    if (spec === '<block>') {
      return { items: filter([...BY_KEY.keys()].map((k) => ({ value: k }))), tokenStart };
    }
    if (Array.isArray(spec)) {
      return { items: filter(spec.map((v) => ({ value: v }))), tokenStart };
    }
    return empty;
  }

  runCommand(text) {
    const raw = (text || '').trim();
    if (!raw) return;
    if (!raw.startsWith('/')) { this.hud.chat('<you> ' + raw); return; }
    if (!this.commandsAllowed()) {
      this.hud.chat('Commands are off in this world. Turn on "Allow Commands" when creating one.');
      return;
    }
    const [cmd, ...args] = raw.slice(1).split(/\s+/);
    const p = this.player;
    const dayLen = Math.max(60, this.settings.get('dayLength') * 60);
    switch (cmd) {
      case 'help':
        for (const c of COMMANDS) {
          this.hud.chat(`/${c.name}${c.args && c.args.length ? ' â€¦' : ''}  â€”  ${c.desc}`);
        }
        this.hud.chat('Tab completes commands and arguments.');
        break;
      case 'time': {
        // Accepts "/time day" and "/time set day" alike. Previously the `set`
        // form ran Number('day') -> NaN, which poisoned the whole day/night
        // calculation and turned the screen black.
        const word = (args[0] === 'set' || args[0] === 'add' ? args[1] : args[0]) || '';
        const NAMED = { day: 0.15, noon: 0.25, sunset: 0.48, dusk: 0.48, night: 0.62, midnight: 0.75, sunrise: 0.98 };
        const dayStart = Math.floor(this.time / dayLen) * dayLen;
        if (word in NAMED) {
          this.time = dayStart + dayLen * NAMED[word];
          this.hud.chat(`Time set to ${word}.`);
        } else if (word !== '' && Number.isFinite(Number(word))) {
          // a bare number is a fraction of the day (0..1), or ticks if > 1
          const n = Number(word);
          const frac = n > 1 ? ((n / 24000) % 1) : n;
          this.time = dayStart + dayLen * frac;
          const hours = frac * 24;
          const hh = Math.floor(hours) % 24, mm = Math.floor((hours - Math.floor(hours)) * 60);
          this.hud.chat(`Time set to ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}.`);
        } else {
          this.hud.chat('Usage: /time day|noon|sunset|night|midnight|sunrise  or  /time set <0-1>');
        }
        break;
      }
      case 'weather': {
        const map = { clear: 0, rain: 1, thunder: 2 };
        if (args[0] in map) { this.weather.force(map[args[0]]); this.hud.chat('Weather: ' + args[0]); }
        break;
      }
      case 'gamemode':
        p.gamemode = args[0] === '1' || args[0] === 'creative' ? GAMEMODE.CREATIVE : GAMEMODE.SURVIVAL;
        this.hud.chat('Game mode: ' + (p.gamemode ? 'Creative' : 'Survival'));
        break;
      case 'tp': {
        if ((args[0] || '').toLowerCase() === 'spawn') {
          const s = p.spawnPoint || this.world.findSpawn(0, 0);
          if (s) { p.pos.set(s[0], s[1], s[2]); p.vel.set(0, 0, 0); this.hud.chat('Teleported to spawn.'); }
          break;
        }
        const [x, y, z] = args.map(Number);
        if (args.length < 3 || ![x, y, z].every(Number.isFinite)) {
          this.hud.chat('Usage: /tp <x> <y> <z>  or  /tp spawn');
          break;
        }
        p.pos.set(x, y, z);
        p.vel.set(0, 0, 0);
        this.hud.chat(`Teleported to ${x}, ${y}, ${z}.`);
        break;
      }
      case 'seed': this.hud.chat('Seed: ' + this.world.seed); break;
      case 'name': {
        const n = args.join(' ').slice(0, 16).trim();
        if (!n) { this.hud.chat('Usage: /name <your name>'); break; }
        this.settings.set('playerName', n);
        this.hud.chat('Name set to ' + n + ' (press F5 to see it)');
        break;
      }
      case 'kill': p.hurt(1000, 'used /kill', this, true); break;
      case 'spawn': {
        const s = p.spawnPoint || this.world.findSpawn(0, 0);
        if (s) { p.pos.set(s[0], s[1], s[2]); p.vel.set(0, 0, 0); }
        break;
      }
      case 'stronghold': {
        const s = nearestStronghold(this.world.seed, p.pos.x, p.pos.z);
        this.hud.chat(`Nearest stronghold: ${s.x}, ~${s.y}, ${s.z}`);
        break;
      }
      case 'give': {
        if (p.gamemode !== GAMEMODE.CREATIVE) { this.hud.chat('Creative mode only.'); break; }
        const key = args[0];
        if (!getItem(key)) { this.hud.chat('Unknown item: ' + key); break; }
        const n = Math.max(1, Math.min(6400, Number(args[1] || 1) || 1));
        p.inventory.add(key, n);
        this.hud.chat(`Gave ${n} x ${getItem(key).name}.`);
        break;
      }
      case 'clear': {
        const key = args[0];
        if (key) {
          if (!getItem(key)) { this.hud.chat('Unknown item: ' + key); break; }
          const had = p.inventory.count(key);
          p.inventory.remove(key, had);
          this.hud.chat(`Removed ${had} x ${getItem(key).name}.`);
        } else {
          const dropped = p.inventory.drainAll();
          this.hud.chat(`Cleared ${dropped.length} stack${dropped.length === 1 ? '' : 's'}.`);
        }
        p.inventory.changed();
        break;
      }
      case 'summon': {
        const kind = args[0];
        if (!MOBS[kind]) { this.hud.chat('Unknown mob: ' + (kind || '') + '. Try /summon <name>'); break; }
        const count = Math.max(1, Math.min(20, Number(args[1] || 1) || 1));
        const fwd = p.lookDir(new THREE.Vector3());
        let made = 0;
        for (let i = 0; i < count; i++) {
          const ang = (i / count) * Math.PI * 2;
          const x = p.pos.x + fwd.x * 3 + Math.cos(ang) * (count > 1 ? 1.5 : 0);
          const z = p.pos.z + fwd.z * 3 + Math.sin(ang) * (count > 1 ? 1.5 : 0);
          const y = this.world.surfaceAt(Math.floor(x), Math.floor(z));
          const mob = new Mob(this, kind, x, y > 0 ? y : p.pos.y, z);
          mob.persistent = true;             // a summoned mob shouldn't despawn
          this.entities.add(mob);
          made++;
        }
        this.hud.chat(`Summoned ${made} ${kind}${made === 1 ? '' : 's'}.`);
        break;
      }
      case 'killall': {
        const what = args[0] || 'hostile';
        let n = 0;
        for (const e of [...this.entities.list]) {
          if (e === p) continue;
          const cat = e.def?.category;
          const isMob = e instanceof Mob;
          const isItem = e instanceof ItemEntity || e instanceof XpOrb;
          const match = what === 'all' ? (isMob || isItem)
            : what === 'items' ? isItem
              : what === 'passive' ? (isMob && cat !== 'hostile')
                : (isMob && cat === 'hostile');
          if (match) { e.remove(); n++; }
        }
        this.hud.chat(`Removed ${n} entit${n === 1 ? 'y' : 'ies'}.`);
        break;
      }
      case 'heal':
        p.health = p.maxHealth;
        p.hunger = 20; p.saturation = 5; p.air = p.maxAir;
        this.hud.chat('Healed.');
        break;
      case 'feed':
        p.hunger = 20; p.saturation = 5;
        this.hud.chat('Fed.');
        break;
      case 'xp': {
        const n = Math.round(Number(args[0]));
        if (!Number.isFinite(n)) { this.hud.chat('Usage: /xp <points>'); break; }
        p.addXp(n);
        this.hud.chat(`Granted ${n} xp â€” now level ${p.level}.`);
        break;
      }
      case 'setblock': {
        const b = blockByKey(args[0]);
        if (!b) { this.hud.chat('Unknown block: ' + (args[0] || '')); break; }
        const eye = new THREE.Vector3(p.pos.x, p.pos.y + p.eyeY, p.pos.z);
        const dir = p.lookDir(new THREE.Vector3());
        const hit = this.world.raycast(eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, 8);
        if (!hit) { this.hud.chat('Look at a block first.'); break; }
        this.world.setBlock(hit.x, hit.y, hit.z, b.id);
        this.hud.chat(`Set ${hit.x} ${hit.y} ${hit.z} to ${b.name}.`);
        break;
      }
      case 'fill': {
        const b = blockByKey(args[0]);
        if (!b) { this.hud.chat('Unknown block: ' + (args[0] || '')); break; }
        // Capped hard: a big fill is thousands of light updates and remeshes.
        const r = Math.max(0, Math.min(12, Math.round(Number(args[1] ?? 3)) || 0));
        const cx = Math.floor(p.pos.x), cy = Math.floor(p.pos.y), cz = Math.floor(p.pos.z);
        let n = 0;
        for (let dx = -r; dx <= r; dx++) {
          for (let dy = -r; dy <= r; dy++) {
            for (let dz = -r; dz <= r; dz++) {
              const y = cy + dy;
              if (y < 1 || y >= CHUNK_Y - 1) continue;
              this.world.setBlock(cx + dx, y, cz + dz, b.id);
              n++;
            }
          }
        }
        this.hud.chat(`Filled ${n} blocks with ${b.name}.`);
        break;
      }
      case 'difficulty': {
        const i = DIFFICULTY_WORDS.indexOf((args[0] || '').toLowerCase());
        if (i < 0) { this.hud.chat('Usage: /difficulty ' + DIFFICULTY_WORDS.join('|')); break; }
        p.difficulty = i;
        this.hud.chat('Difficulty: ' + DIFFICULTY_WORDS[i]);
        break;
      }
      case 'gamerule': {
        const rule = GAMERULE_NAMES.find((r) => r.toLowerCase() === (args[0] || '').toLowerCase());
        if (!rule) {
          this.hud.chat('Rules: ' + GAMERULE_NAMES.join(', '));
          for (const r of GAMERULE_NAMES) this.hud.chat(`  ${r} = ${this.gamerules[r]}`);
          break;
        }
        if (args[1] === undefined) { this.hud.chat(`${rule} = ${this.gamerules[rule]}`); break; }
        this.gamerules[rule] = args[1].toLowerCase() === 'true';
        this.hud.chat(`${rule} set to ${this.gamerules[rule]}.`);
        break;
      }
      case 'spawnpoint':
        p.spawnPoint = [p.pos.x, p.pos.y, p.pos.z];
        this.hud.chat(`Respawn point set to ${p.pos.x.toFixed(0)} ${p.pos.y.toFixed(0)} ${p.pos.z.toFixed(0)}.`);
        break;
      case 'locate': {
        const what = (args[0] || 'stronghold').toLowerCase();
        if (what === 'spawn') {
          const s = p.spawnPoint || this.world.findSpawn(0, 0) || [0, 0, 0];
          this.hud.chat(`Spawn: ${Math.round(s[0])}, ${Math.round(s[1])}, ${Math.round(s[2])}`);
          break;
        }
        if (what !== 'stronghold') {
          this.hud.chat(`No ${what} locator yet â€” /locate stronghold and /locate spawn work.`);
          break;
        }
        const s = nearestStronghold(this.world.seed, p.pos.x, p.pos.z);
        const d = Math.round(Math.hypot(s.x - p.pos.x, s.z - p.pos.z));
        this.hud.chat(`Nearest stronghold: ${s.x}, ~${s.y}, ${s.z} (${d} blocks away)`);
        break;
      }
      case 'pos': {
        const bx = Math.floor(p.pos.x), by = Math.floor(p.pos.y), bz = Math.floor(p.pos.z);
        const biome = this.world.biomeAt(bx, bz);
        this.hud.chat(`You are at ${bx}, ${by}, ${bz} â€” biome ${BIOME_NAMES[biome] ?? biome}`);
        break;
      }
      case 'advancements': {
        let done = 0;
        for (const [k, name, desc] of ADVANCEMENTS) {
          const got = !!this.advancements?.[k];
          if (got) done++;
          this.hud.chat(`${got ? '[x]' : '[ ]'} ${name} â€” ${desc}`);
        }
        this.hud.chat(`${done} / ${ADVANCEMENTS.length} unlocked.`);
        break;
      }
      case 'say': {
        const msg = args.join(' ').trim();
        if (msg) this.hud.chat(`<${this.settings.get('playerName') || 'Player'}> ${msg}`);
        break;
      }
      case 'me': {
        const msg = args.join(' ').trim();
        if (msg) this.hud.chat(`* ${this.settings.get('playerName') || 'Player'} ${msg}`);
        break;
      }
      default: this.hud.chat('Unknown command. Try /help');
    }
  }
}

// ---------------------------------------------------------------------------
const game = new Game();
window.chugcraft = game;
// Kept as an alias so older bookmarks, dev consoles and test scripts that
// reach for window.craftverse still find the game after the rename.
window.craftverse = game;
game.boot().catch((e) => { console.error(e); game.fatal(e); });

export default game;
export { Game, Mob, MOBS, BIOME, DIFFICULTY, explode, TOOL_MATERIALS, blockByKey };



