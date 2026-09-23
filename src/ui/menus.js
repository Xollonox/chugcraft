// ============================================================================
// All full-screen menus: title (with a live rotating world panorama and splash
// text), world select, create world, options, rebindable controls, pause,
// death, victory and the loading screen.
// ============================================================================

import { keyName, KEY_LABELS, DEFAULTS } from '../engine/settings.js';
import { PRESET_NAMES, PRESETS, applyPreset } from '../engine/presets.js';
import { SHADER_PACK_NAMES } from '../engine/shaderpacks.js';
import { GAMEMODE, DIFFICULTY_NAMES, ADVANCEMENTS } from '../constants.js';
import { listWorlds, deleteWorld, renameWorld } from '../save/db.js';
import { exportBackup, importBackup } from '../save/backup.js';
import { GLYPHS } from './pixelfont.js';

const $ = (id) => document.getElementById(id);

const SPLASHES = [
  'Also try digging straight down!', 'Now with 100% more dragons!', 'Voxels all the way down',
  'Punch a tree to begin', 'Creepers not included', 'Made of pure JavaScript',
  'Seeded for your convenience', 'Diamonds are near bedrock!', 'Don\'t dig straight down!',
  'Mind the lava', 'Eyes of Ender sold separately', 'Blaze rods required',
  'It\'s dangerous to go alone', 'Zero copyrighted pixels', 'Every texture drawn at runtime',
  'The End is just the beginning', 'Sneak to stay safe', '60 frames per second!',
  'Nether portals working as intended', 'Try Hard mode!', 'Crafting table not included',
  'Beat the dragon!', 'Herobrine removed', 'Now in three dimensions',
  'Procedurally awesome', 'One mesh per chunk', 'Ambient occlusion included',
  'Torches are your friend', 'Bring a bucket', 'Watch out behind you',
  'The cake is a placeholder', 'Written in one sitting',
  'Now with shader packs!', 'Potato to Ultra!', 'Touch-screen ready!',
  'Runs on your phone too!', 'Try the Dreamwave shaders!',
];

function drawLogo(text) {
  const scale = 6;
  // The logo shares the UI font's glyph grid, so both stay in one place.
  const glyphs = [...text].map((c) => GLYPHS[c]).filter(Boolean);
  const w = glyphs.length * 6 - 1;
  const h = 7;
  const cv = document.createElement('canvas');
  cv.width = (w + 2) * scale;
  cv.height = (h + 2) * scale;
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  const cell = (gx, gy, fill, top, bottom) => {
    const x = (gx + 1) * scale, y = (gy + 1) * scale;
    ctx.fillStyle = fill; ctx.fillRect(x, y, scale, scale);
    ctx.fillStyle = top; ctx.fillRect(x, y, scale, Math.max(1, scale / 5));
    ctx.fillStyle = bottom; ctx.fillRect(x, y + scale - Math.max(1, scale / 5), scale, Math.max(1, scale / 5));
  };

  // shadow pass
  glyphs.forEach((g, gi) => {
    for (let y = 0; y < 7; y++) {
      for (let x = 0; x < 5; x++) {
        if (g[y][x] !== '#') continue;
        const px = gi * 6 + x, py = y;
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect((px + 1) * scale + scale * 0.3, (py + 1) * scale + scale * 0.35, scale, scale);
      }
    }
  });
  glyphs.forEach((g, gi) => {
    for (let y = 0; y < 7; y++) {
      for (let x = 0; x < 5; x++) {
        if (g[y][x] !== '#') continue;
        const px = gi * 6 + x, py = y;
        // dirt-and-grass block styling, like a certain famous logo
        if (py === 0) cell(px, py, '#5a9438', '#7bb955', '#3f6d28');
        else cell(px, py, '#866043', '#97704f', '#654630');
      }
    }
  });
  return cv;
}

// ---------------------------------------------------------------------------

export class Menus {
  constructor(game) {
    this.game = game;
    this.settings = game.settings;
    this.current = null;
    this.selectedWorld = null;
    this.listening = null;

    this.createState = {
      gamemode: GAMEMODE.SURVIVAL,
      difficulty: 2,
      structures: true,
      bonusChest: false,
      cheats: false,
    };

    this._wireStatic();
    this._buildLogo();
    this._buildOptions();
    this._buildControls();
  }

  // -------------------------------------------------------------------------
  _wireStatic() {
    document.addEventListener('mousedown', (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      this.game.audio.play('click', { volume: 0.6 });
      switch (btn.dataset.act) {
        case 'singleplayer': this.show('worlds'); break;
        case 'options': this._optionsReturn = this.current; this.show('options'); break;
        case 'controls': this.show('controls'); break;
        case 'title': this.show('title'); break;
        case 'worlds': this.show('worlds'); break;
        case 'create': this.show('create'); break;
        case 'howto': this.showInfo('How to Play', HOWTO_HTML); break;
        case 'about': this.showInfo('About ChugCraft', ABOUT_HTML); break;
        default: break;
      }
    });

    $('btn-play-world').addEventListener('mousedown', () => {
      if (this.selectedWorld) this.game.loadWorld(this.selectedWorld.id);
    });
    $('btn-delete-world').addEventListener('mousedown', async () => {
      if (!this.selectedWorld) return;
      const name = this.selectedWorld.name;
      // eslint-disable-next-line no-alert
      if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
      await deleteWorld(this.selectedWorld.id);
      this.selectedWorld = null;
      this.refreshWorlds();
    });
    $('btn-rename-world').addEventListener('mousedown', async () => {
      if (!this.selectedWorld) return;
      // eslint-disable-next-line no-alert
      const name = prompt('World name', this.selectedWorld.name);
      if (!name) return;
      await renameWorld(this.selectedWorld.id, name.slice(0, 32));
      this.refreshWorlds();
    });

    $('btn-export-world').addEventListener('click',async()=>{
      try{if(!this.selectedWorld)throw new Error('Select a saved world first.');await exportBackup(this.selectedWorld.id);}
      catch(e){$('backup-status').textContent=e.message;}
    });
    $('btn-import-world').addEventListener('click',()=>$('world-import').click());
    $('world-import').addEventListener('change',async e=>{
      const file=e.target.files[0];if(!file)return;
      try{await importBackup(file);$('backup-status').textContent='Imported as a separate world. Original saves unchanged.';this.refreshWorlds();}
      catch(err){$('backup-status').textContent=err.message;}finally{e.target.value='';}
    });
    $('btn-backup-now').addEventListener('click',async()=>{
      if(await this.game.save())try{await exportBackup(this.game.saveMeta.id);}catch(e){this.game.toast('Backup failed',e.message);}
    });
    const gmBtn = $('btn-gamemode');
    const dfBtn = $('btn-difficulty');
    const stBtn = $('btn-structures');
    const bcBtn = $('btn-bonus');
    const chBtn = $('btn-cheats');
    const syncCreate = () => {
      gmBtn.textContent = 'Game Mode: ' + (this.createState.gamemode === GAMEMODE.SURVIVAL ? 'Survival' : 'Creative');
      dfBtn.textContent = 'Difficulty: ' + DIFFICULTY_NAMES[this.createState.difficulty];
      stBtn.textContent = 'Generate Structures: ' + (this.createState.structures ? 'ON' : 'OFF');
      bcBtn.textContent = 'Bonus Chest: ' + (this.createState.bonusChest ? 'ON' : 'OFF');
      // Creative always has commands; survival is the interesting case.
      const cheats = this.createState.gamemode === GAMEMODE.CREATIVE || this.createState.cheats;
      chBtn.textContent = 'Allow Commands: ' + (cheats ? 'ON' : 'OFF');
      chBtn.disabled = this.createState.gamemode === GAMEMODE.CREATIVE;
      $('cheats-desc').textContent = cheats
        ? 'Chat commands enabled. Advancements still count â€” unlike Minecraft.'
        : 'Chat commands disabled for this world. Advancements are unaffected.';
      $('mode-desc').textContent = this.createState.gamemode === GAMEMODE.SURVIVAL
        ? 'Search for resources, craft, gain levels, health and hunger. Beat the Ender Dragon to win.'
        : 'Unlimited resources, free flying (double-tap jump) and no damage.';
      dfBtn.disabled = this.createState.gamemode === GAMEMODE.CREATIVE;
    };
    gmBtn.addEventListener('mousedown', () => {
      this.createState.gamemode = this.createState.gamemode === GAMEMODE.SURVIVAL ? GAMEMODE.CREATIVE : GAMEMODE.SURVIVAL;
      syncCreate(); this.game.audio.play('click');
    });
    dfBtn.addEventListener('mousedown', () => {
      this.createState.difficulty = (this.createState.difficulty + 1) % 4;
      syncCreate(); this.game.audio.play('click');
    });
    stBtn.addEventListener('mousedown', () => {
      this.createState.structures = !this.createState.structures; syncCreate(); this.game.audio.play('click');
    });
    bcBtn.addEventListener('mousedown', () => {
      this.createState.bonusChest = !this.createState.bonusChest; syncCreate(); this.game.audio.play('click');
    });
    chBtn.addEventListener('mousedown', () => {
      this.createState.cheats = !this.createState.cheats; syncCreate(); this.game.audio.play('click');
    });
    this._syncCreate = syncCreate;
    syncCreate();

    $('btn-do-create').addEventListener('mousedown', () => {
      const name = ($('in-name').value || 'New World').slice(0, 32);
      const seed = $('in-seed').value;
      this.game.createWorld({ name, seed, ...this.createState });
    });

    $('btn-options-done').addEventListener('mousedown', () => {
      this.show(this._optionsReturn === 'pause' ? 'pause' : 'title');
    });
    $('btn-controls-done').addEventListener('mousedown', () => this.show('options'));
    $('btn-reset-keys').addEventListener('mousedown', () => {
      this.settings.resetKeys(); this._buildControls();
    });

    $('btn-resume').addEventListener('mousedown', () => this.game.resume());
    $('btn-save-quit').addEventListener('mousedown', () => this.game.quitToTitle());
    $('btn-advancements').addEventListener('mousedown', () => {
      this.game.advancementScreen.show();
    });
    $('btn-howto-pause').addEventListener('mousedown', () => {
      this._infoReturn = 'pause';
      this.showInfo('How to Play', HOWTO_HTML);
    });
    $('btn-respawn').addEventListener('mousedown', () => this.game.respawn());
    $('btn-death-title').addEventListener('mousedown', () => this.game.quitToTitle());
    $('btn-info-back').addEventListener('mousedown', () => this.show(this._infoReturn || 'title'));
    $('btn-victory-continue').addEventListener('mousedown', () => this.game.endVictory());
  }

  _buildLogo() {
    const el = $('title-logo');
    el.innerHTML = '';
    el.appendChild(drawLogo('CHUG'));
    const second = drawLogo('CRAFT');
    second.style.marginLeft = '2px';
    el.appendChild(second);
  }

  // -------------------------------------------------------------------------
  // Options
  // -------------------------------------------------------------------------
  _buildOptions() {
    const grid = $('options-grid');
    grid.innerHTML = '';
    const s = this.settings;

    const section = (t) => {
      const d = document.createElement('div');
      d.className = 'opt-section';
      d.textContent = t;
      grid.appendChild(d);
    };
    const slider = (key, label, min, max, step, fmt) => {
      const wrap = document.createElement('div');
      wrap.className = 'opt-slider';
      wrap.innerHTML = '<div class="knob"></div><div class="lbl"></div>';
      const knob = wrap.firstChild, lbl = wrap.children[1];
      const paint = () => {
        const v = s.get(key);
        const f = (v - min) / (max - min);
        knob.style.left = `calc(${(f * 100).toFixed(2)}% - ${f * 1}px)`;
        knob.style.width = 'calc(var(--ui) * 16)';
        knob.style.left = `calc((100% - var(--ui) * 16) * ${f})`;
        lbl.textContent = `${label}: ${fmt(v)}`;
      };
      const setFromEvent = (e) => {
        const r = wrap.getBoundingClientRect();
        let f = (e.clientX - r.left) / r.width;
        f = Math.max(0, Math.min(1, f));
        let v = min + f * (max - min);
        v = Math.round(v / step) * step;
        v = Math.round(v * 1000) / 1000;
        s.set(key, v);
        paint();
      };
      let dragging = false;
      wrap.addEventListener('mousedown', (e) => { dragging = true; setFromEvent(e); });
      addEventListener('mousemove', (e) => { if (dragging) setFromEvent(e); });
      addEventListener('mouseup', () => { dragging = false; });
      wrap.style.touchAction='none';
      wrap.addEventListener('touchstart',e=>{e.preventDefault();setFromEvent(e.changedTouches[0]);},{passive:false});
      wrap.addEventListener('touchmove',e=>{e.preventDefault();setFromEvent(e.changedTouches[0]);},{passive:false});
      paint();
      wrap._paint = paint;
      grid.appendChild(wrap);
      return wrap;
    };
    /** Multi-state option button; the value is the index into `labels`. */
    const cycle = (key, label, labels) => {
      const b = document.createElement('button');
      b.className = 'mc-btn';
      const paint = () => {
        const v = Math.max(0, Math.min(labels.length - 1, s.get(key) ?? 0));
        b.textContent = `${label}: ${labels[v]}`;
      };
      b.addEventListener('mousedown', () => {
        s.set(key, ((s.get(key) ?? 0) + 1) % labels.length);
        paint(); this.game.audio.play('click');
      });
      paint();
      grid.appendChild(b);
      return b;
    };
    const toggle = (key, label, onLabel = 'ON', offLabel = 'OFF') => {
      const b = document.createElement('button');
      b.className = 'mc-btn';
      const paint = () => { b.textContent = `${label}: ${s.get(key) ? onLabel : offLabel}`; };
      b.addEventListener('mousedown', () => {
        s.set(key, !s.get(key)); paint(); this.game.audio.play('click');
      });
      paint();
      grid.appendChild(b);
      return b;
    };

    section('Quality & Shaders');
    // One-tap quality presets, Potato through Ultra. Picking one rewrites the
    // video settings below; hand-tuning any of them flips this to Custom.
    {
      const b = document.createElement('button');
      b.className = 'mc-btn';
      const paint = () => {
        const v = Math.max(0, Math.min(PRESET_NAMES.length - 1, s.get('graphicsPreset') ?? 3));
        b.textContent = `Graphics: ${PRESET_NAMES[v]}`;
      };
      b.addEventListener('mousedown', () => {
        const cur = s.get('graphicsPreset') ?? 3;
        applyPreset(s, (cur + 1) % PRESETS.length); // Custom cycles back to Potato
        this.game.audio.play('click');
        this._buildOptions(); // repaint every control the preset just rewrote
      });
      paint();
      grid.appendChild(b);
    }
    slider('renderScale', 'Render Scale', 0.5, 1.5, 0.05, (v) => `${Math.round(v * 100)}%`);
    cycle('shaderPack', 'Shaders', SHADER_PACK_NAMES);
    cycle('touchControls', 'Touch Controls', ['Auto', 'ON', 'OFF']);

    section('Video');
    slider('guiScale', 'GUI Scale', 0, 4, 1, (v) => (v === 0 ? 'Auto' : String(v)));
    slider('renderDistance', 'Render Distance', 2, 16, 1, (v) => `${v}`);
    slider('fov', 'FOV', 30, 110, 1, (v) => (v === 70 ? 'Normal' : String(v)));
    slider('gamma', 'Brightness', 0, 1, 0.05, (v) => (v === 0 ? 'Moody' : v >= 1 ? 'Bright' : `${Math.round(v * 100)}%`));
    slider('nightVisibility', 'Night visibility', 0, 1, .05, v=>v===0?'Original':`${Math.round(v*100)}%`);
    toggle('smoothLighting', 'Smooth Lighting');
    toggle('ssao', 'Ambient Occlusion');
    // textContent, not innerHTML â€” an entity here would show up literally
    toggle('bloom', 'Bloom & Grading');
    toggle('reflections', 'Water Reflections');
    toggle('waving', 'Waving Foliage');
    toggle('fancyLeaves', 'Leaves', 'Fancy', 'Fast');
    toggle('particles', 'Particles', 'All', 'Off');
    cycle('cloudMode', 'Clouds', ['OFF', 'Flat', '3D']);
    toggle('fog', 'Fog');
    toggle('viewBobbing', 'View Bobbing');
    toggle('dynamicFov', 'Dynamic FOV');
    toggle('showFps', 'FPS Counter');

    section('Sound');
    slider('masterVolume', 'Master Volume', 0, 1, 0.05, (v) => (v === 0 ? 'OFF' : `${Math.round(v * 100)}%`));
    slider('musicVolume', 'Music', 0, 1, 0.05, (v) => (v === 0 ? 'OFF' : `${Math.round(v * 100)}%`));
    slider('soundVolume', 'Sounds', 0, 1, 0.05, (v) => (v === 0 ? 'OFF' : `${Math.round(v * 100)}%`));
    toggle('subtitles', 'Subtitles');

    section('Controls & World');
    slider('sensitivity', 'Mouse Sensitivity', 0, 1, 0.02, (v) => `${Math.round(v * 200)}%`);
    slider('cursorSpeed', 'Menu Cursor Speed', 0.15, 1.2, 0.05, (v) => `${Math.round(v * 100)}%`);
    slider('dayLength', 'Day Length', 2, 60, 1, (v) => `${v} min`);
    toggle('weatherEnabled', 'Weather');
    const wbtn = document.createElement('button');
    wbtn.className = 'mc-btn';
    wbtn.textContent = 'Cycle Weather Now';
    wbtn.addEventListener('mousedown', () => {
      const st = this.game.weather.cycle();
      this.game.audio.play('click');
      wbtn.textContent = 'Weather: ' + ['Clear', 'Rain', 'Thunder'][st];
    });
    grid.appendChild(wbtn);

    const reset = document.createElement('button');
    reset.className = 'mc-btn';
    reset.textContent = 'Reset All Options';
    reset.addEventListener('mousedown', () => {
      for (const k of Object.keys(DEFAULTS)) s.set(k, DEFAULTS[k]);
      this._buildOptions();
    });
    grid.appendChild(reset);
  }

  _buildControls() {
    const grid = $('controls-grid');
    grid.innerHTML = '';
    const s = this.settings;
    for (const action of Object.keys(KEY_LABELS)) {
      const lbl = document.createElement('div');
      lbl.className = 'k-label';
      lbl.textContent = KEY_LABELS[action];
      const btn = document.createElement('button');
      btn.className = 'mc-btn';
      btn.textContent = keyName(s.keyFor(action));
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        if (this.listening) this.listening.el.classList.remove('listening');
        btn.classList.add('listening');
        btn.textContent = '> ? <';
        this.listening = { action, el: btn };
        this.game.input.captureKey = (code) => {
          btn.classList.remove('listening');
          this.listening = null;
          if (code) s.setKey(action, code);
          this._buildControls();
        };
      });
      if (s.conflictsFor(action).length) btn.classList.add('conflict');
      grid.append(lbl, btn);
    }
  }

  refreshOptionSliders() {
    for (const el of $('options-grid').querySelectorAll('.opt-slider')) el._paint?.();
  }

  // -------------------------------------------------------------------------
  // World list
  // -------------------------------------------------------------------------
  async refreshWorlds() {
    const list = $('world-list');
    list.innerHTML = '<div class="world-empty">Loadingâ€¦</div>';
    const worlds = await listWorlds();
    list.innerHTML = '';
    if (!worlds.length) {
      list.innerHTML = '<div class="world-empty">No worlds yet.<br>Create one to begin your adventure.</div>';
    }
    for (const w of worlds) {
      const row = document.createElement('div');
      row.className = 'world-row';
      const when = w.lastPlayed ? new Date(w.lastPlayed).toLocaleString() : 'never';
      const mins = Math.round((w.playtime || 0) / 60);
      row.innerHTML = `
        <div class="world-icon" style="background:${w.won ? 'linear-gradient(#2a1040,#120620)' : 'linear-gradient(#5a9438,#866043)'}"></div>
        <div class="world-meta">
          <div class="world-name">${escapeHtml(w.name)}${w.won ? ' <span class="won">â˜…</span>' : ''}</div>
          <div class="world-sub">${w.gamemode === GAMEMODE.CREATIVE ? 'Creative' : 'Survival'} &middot; ${DIFFICULTY_NAMES[w.difficulty] || 'Normal'} &middot; seed ${w.seed}</div>
          <div class="world-sub">last played ${when} &middot; ${mins} min played${w.won ? ' &middot; dragon defeated' : ''}</div>
        </div>`;
      row.addEventListener('mousedown', () => {
        this.selectedWorld = w;
        for (const c of list.children) c.classList.remove('sel');
        row.classList.add('sel');
        $('btn-play-world').disabled = false;
        $('btn-delete-world').disabled = false;
        $('btn-rename-world').disabled = false;
      });
      row.addEventListener('dblclick', () => this.game.loadWorld(w.id));
      list.appendChild(row);
    }
    if (!this.selectedWorld || !worlds.find((w) => w.id === this.selectedWorld.id)) {
      this.selectedWorld = null;
      $('btn-play-world').disabled = true;
      $('btn-delete-world').disabled = true;
      $('btn-rename-world').disabled = true;
    }
  }

  // -------------------------------------------------------------------------
  show(name) {
    for (const el of document.querySelectorAll('.screen')) el.classList.add('hidden');
    this.current = name;
    if (!name) return;
    const el = $('screen-' + name);
    if (el) el.classList.remove('hidden');
    if (name === 'title') {
      $('splash-text').textContent = SPLASHES[(Math.random() * SPLASHES.length) | 0];
    }
    if (name === 'worlds') this.refreshWorlds();
    if (name === 'create') {
      $('in-name').value = 'New World';
      $('in-seed').value = '';
      this._syncCreate();
    }
    if (name === 'options') this.refreshOptionSliders();
    this.game.onScreenChange?.(name);
  }

  showInfo(title, html) {
    $('info-title').textContent = title;
    $('info-body').innerHTML = html;
    if (!this._infoReturn) this._infoReturn = 'title';
    this.show('info');
  }

  hideAll() { this.show(null); }

  setLoading(progress, tip) {
    $('loading-fill').style.width = Math.round(progress * 100) + '%';
    if (tip) $('loading-tip').textContent = tip;
  }

  showDeath(cause, score) {
    $('death-cause').textContent = cause || '';
    $('death-score').textContent = 'Score: ' + score;
    this.show('death');
  }

  // -------------------------------------------------------------------------
  showVictory(stats) {
    const el = $('victory-scroll');
    const lines = [
      { c: 'big', t: 'THE END' },
      { c: '', t: '' },
      { c: 'c3', t: 'You have defeated the Ender Dragon.' },
      { c: '', t: '' },
      { c: 'c1', t: 'The dragon is gone. The pillars stand quiet.' },
      { c: 'c1', t: 'Somewhere far below, a portal is waiting.' },
      { c: '', t: '' },
      { c: 'c2', t: `You began with nothing but your hands.` },
      { c: 'c2', t: `You ended with a world reshaped.` },
      { c: '', t: '' },
      { c: 'c3', t: `Blocks broken: ${stats.blocksBroken}` },
      { c: 'c3', t: `Blocks placed: ${stats.blocksPlaced}` },
      { c: 'c3', t: `Items crafted: ${stats.itemsCrafted}` },
      { c: 'c3', t: `Mobs defeated: ${stats.mobsKilled}` },
      { c: 'c3', t: `Deaths: ${stats.deaths}` },
      { c: 'c3', t: `Time played: ${Math.floor(stats.playtime / 60)}m ${Math.floor(stats.playtime % 60)}s` },
      { c: '', t: '' },
      { c: 'c1', t: 'Every texture in this world was drawn from scratch,' },
      { c: 'c1', t: 'pixel by pixel, the moment the page loaded.' },
      { c: '', t: '' },
      { c: 'c2', t: 'Thank you for playing ChugCraft.' },
      { c: '', t: '' },
      { c: 'big', t: 'â˜…' },
    ];
    el.innerHTML = `<div class="vinner">${lines
      .map((l) => `<div class="${l.c}">${l.t || '&nbsp;'}</div>`).join('')}</div>`;
    const inner = el.firstChild;
    inner.style.top = '100%';
    this.show('victory');
    const start = performance.now();
    const anim = () => {
      if (this.current !== 'victory') return;
      const t = (performance.now() - start) / 1000;
      inner.style.top = `calc(100% - ${t * 42}px)`;
      if (t < 90) requestAnimationFrame(anim);
    };
    requestAnimationFrame(anim);
  }

  advancementList(unlocked) {
    return ADVANCEMENTS.map(([k, name, desc]) =>
      `<li><b>${name}</b> â€” ${desc} ${unlocked?.[k] ? '<span style="color:#5f5">âœ”</span>' : ''}</li>`).join('');
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const HOWTO_HTML = `
<h3>Goal</h3>
<p>Start with your bare hands and work your way to <b>the End</b>, where the Ender Dragon waits.
Everything below is doable in a single survival session.</p>
<h3>Controls</h3>
<ul>
  <li><b>WASD</b> move &middot; <b>Space</b> jump &middot; <b>Shift</b> sneak &middot; <b>Ctrl</b> or double-tap <b>W</b> to sprint</li>
  <li><b>Left click</b> mine / attack (hold to break) &middot; <b>Right click</b> place / use / interact</li>
  <li><b>1â€“9</b> or <b>mouse wheel</b> select hotbar &middot; <b>E</b> inventory &middot; <b>Q</b> drop</li>
  <li><b>F3</b> debug info &middot; <b>F5</b> change perspective &middot; <b>Esc</b> pause</li>
  <li><b>Touch:</b> left-thumb joystick to move (push far forward to sprint) &middot; drag the right side to look
  &middot; <b>tap</b> to place / use &middot; <b>hold</b> to mine &middot; on-screen buttons for jump, sneak, drop,
  inventory and pause. Force it on or off under Options &rarr; Touch Controls.</li>
</ul>
<h3>The road to the dragon</h3>
<ul>
  <li>Punch <b>trees</b> â†’ planks â†’ sticks â†’ <b>crafting table</b> â†’ wooden pickaxe.</li>
  <li>Mine <b>stone</b> â†’ stone tools â†’ <b>furnace</b>. Cook meat, smelt iron.</li>
  <li>Dig deep. <b>Iron</b> sits mid-depth, <b>diamonds</b> only near bedrock (y&nbsp;5â€“15) â€” bring torches and watch for lava.</li>
  <li>Diamond pickaxe â†’ mine <b>obsidian</b> (a lava pool plus a water bucket makes plenty).</li>
  <li>Build a <b>4Ã—5 obsidian frame</b> and light the inside with <b>flint and steel</b> (iron + flint from gravel).</li>
  <li>In the <b>Nether</b>, find a fortress and kill <b>Blazes</b> for blaze rods. Watch for ghasts.</li>
  <li>Kill <b>Endermen</b> for ender pearls â€” look one straight in the eye to make it charge you.</li>
  <li>Craft <b>Eyes of Ender</b> (blaze powder + ender pearl). Throw one and follow it to the <b>stronghold</b>, then dig down.</li>
  <li>Fill all <b>12 end portal frames</b> with eyes and jump in.</li>
  <li>In the End: <b>destroy every End Crystal</b> on the obsidian pillars first â€” they heal the dragon â€” then kill the dragon.</li>
</ul>
<h3>Building, flowing liquids &amp; readable nights</h3>
<ul>
 <li><b>Too dark?</b> Options &rarr; Video &rarr; <b>Night visibility</b>. Defaults to 75%; raise it to 100% for brighter nights. Daytime stays unchanged.</li>
 <li>Water and lava now <b>flow down and around walls</b>. Water spreads 7 blocks, lava 3. Pick up the source with an empty bucket to drain the stream.</li>
 <li>Craft <b>oak, birch or spruce doors</b> from six matching planks. USE toggles doors, gates and trapdoors (right-click on desktop).</li>
 <li>Six glass blocks make <b>16 connected window panes</b>. Colour glass with blue, yellow or red dye for ocean, amber or rose windows.</li>
 <li>Build fences, warm <b>lanterns</b>, sunburst mosaics and midnight basalt paths. Recipes appear in the crafting book; items are in Creative &rarr; Building.</li>
</ul>
<h3>Survival tips</h3>
<ul>
  <li>Hunger drains as you sprint and mine. Keep it above 18 to regenerate health.</li>
  <li>Hostile mobs spawn in the dark. Torches stop spawns and light your way home.</li>
  <li>Creepers explode. Hit them and back off, or shoot them with a bow.</li>
  <li>A <b>bed</b> skips the night and sets your respawn point.</li>
  <li>Falling more than 3 blocks hurts. Water breaks a fall.</li>
</ul>`;

const ABOUT_HTML = `
<h3>ChugCraft</h3>
<p>An original voxel survival game built from scratch for the browser on top of
<b>Three.js</b> and WebGL. Not affiliated with, endorsed by, or containing any assets from Mojang or Microsoft.</p>
<h3>Everything is generated at runtime</h3>
<ul>
  <li>Every block texture is hand-authored pixel art painted into a canvas the moment the page loads â€”
      no image files are downloaded.</li>
  <li>Every sound is synthesised with the Web Audio API from noise and oscillators.</li>
  <li>Terrain, caves, ore veins, strongholds and Nether fortresses all come from one seed.</li>
</ul>
<h3>Under the hood</h3>
<ul>
  <li>16Ã—16Ã—128 chunks meshed in a <b>Web Worker</b>: one geometry per render pass per chunk, face-culled,
      with baked ambient occlusion and smooth sky/block lighting.</li>
  <li>A flood-fill light engine with a proper removal pass, so torches and roofs behave.</li>
  <li>Worlds persist to <b>IndexedDB</b> as a delta from the generated terrain, so saves stay small.</li>
</ul>
<p style="margin-top:1em;color:#888">Type the same seed twice and you will get the same world, every time.</p>`;

export { SPLASHES };


