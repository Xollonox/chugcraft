// ============================================================================
// Game chat commands: the command table, autocomplete and `/` handling.
//
// Split out of main.js (see game-shell.js); mixed onto Game.prototype at boot.
// GAMERULES moves here too so the gamerule command and the game share one
// source of truth without a circular import.
// ============================================================================

import * as THREE from 'three';
import { ADVANCEMENTS, CHUNK_Y, GAMEMODE } from '../constants.js';
import { blockByKey, BY_KEY } from './blocks.js';
import { ITEMS, getItem } from '../crafting/items.js';
import { BIOME, BIOME_NAMES } from './worldgen.js';
import { nearestStronghold } from './structures.js';
import { Mob, MOBS } from '../entities/mobs.js';
import { ItemEntity, XpOrb } from '../entities/projectiles.js';

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

export const GameCommands = {
  /**
   * Whether this world was created with commands enabled. Creative always has
   * them; survival is opt-in at world creation. Note that, unlike Minecraft,
   * turning them on does NOT disable advancements — see `unlock()`.
   */
  commandsAllowed() {
    if (!this.saveMeta) return true;              // panorama / tests
    return this.saveMeta.cheats !== false;
  },

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
  },

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
          this.hud.chat(`/${c.name}${c.args && c.args.length ? ' …' : ''}  —  ${c.desc}`);
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
        this.hud.chat(`Granted ${n} xp — now level ${p.level}.`);
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
          this.hud.chat(`No ${what} locator yet — /locate stronghold and /locate spawn work.`);
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
        this.hud.chat(`You are at ${bx}, ${by}, ${bz} — biome ${BIOME_NAMES[biome] ?? biome}`);
        break;
      }
      case 'advancements': {
        let done = 0;
        for (const [k, name, desc] of ADVANCEMENTS) {
          const got = !!this.advancements?.[k];
          if (got) done++;
          this.hud.chat(`${got ? '[x]' : '[ ]'} ${name} — ${desc}`);
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
  },
};
