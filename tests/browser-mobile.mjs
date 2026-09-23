import fs from 'node:fs';
import path from 'node:path';
const OUT=path.resolve('test-output');fs.mkdirSync(OUT,{recursive:true});
// Craftverse 1.1 smoke tests: menus, presets, shader packs, gameplay, touch.
import { chromium } from 'playwright';

const BASE = process.env.CHUGCRAFT_URL || 'http://localhost:8080/';
const SHOT = (n) => path.join(OUT,`${n}.png`);
let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!cond) failures++;
};

const launch = () => chromium.launch({
  ...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),
  headless: true,
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});

function watch(page, errors) {
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
}

async function clickBtn(page, text) {
  const btn = page.locator(`button:visible`, { hasText: text }).first();
  await btn.click();
}

async function createWorld(page, tap = false) {
  const press = async (sel) => tap ? page.tap(sel) : page.click(sel);
  await press('button[data-act="singleplayer"]');
  await page.waitForSelector('#screen-worlds:not(.hidden)');
  await press('button[data-act="create"]');
  await page.waitForSelector('#screen-create:not(.hidden)');
  await page.fill('#in-seed', 'smoketest');
  await press('#btn-do-create');
  await page.waitForFunction(() => window.craftverse && window.craftverse.state === 'playing', null, { timeout: 120000 });
}

// ---------------------------------------------------------------------------
// Desktop run
// ---------------------------------------------------------------------------
async function desktop() {
  console.log('--- desktop ---');
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  watch(page, errors);

  await page.goto(BASE);
  await page.waitForSelector('#screen-title:not(.hidden)', { timeout: 60000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: SHOT('01-title') });
  ok(true, 'title screen reached');

  // Options: new controls present, preset cycling works end to end.
  await page.click('button[data-act="options"]');
  await page.waitForSelector('#screen-options:not(.hidden)');
  const labels = await page.$$eval('#options-grid button', (bs) => bs.map((b) => b.textContent));
  ok(labels.some((t) => t.startsWith('Graphics: High')), `graphics preset button shows High default (${labels.find((t) => t.startsWith('Graphics'))})`);
  ok(labels.some((t) => t.startsWith('Shaders: Vanilla')), 'shader pack button present, Vanilla default');
  ok(labels.some((t) => t.startsWith('Touch Controls: Auto')), 'touch controls button present, Auto default');
  const rsLabel = await page.$$eval('#options-grid .opt-slider .lbl', (ls) => ls.map((l) => l.textContent)).then((ls) => ls.find((t) => t.startsWith('Render Scale')));
  ok(rsLabel === 'Render Scale: 100%', `render scale slider present (${rsLabel})`);

  const presetLabel = () => page.$$eval('#options-grid button', (bs) => bs.map((b) => b.textContent).find((t) => t.startsWith('Graphics:')));
  const clickPreset = async () => { await page.locator('#options-grid button', { hasText: 'Graphics:' }).first().click(); };
  const seen = [];
  for (let i = 0; i < 5; i++) { await clickPreset(); seen.push(await presetLabel()); }
  ok(JSON.stringify(seen) === JSON.stringify(['Graphics: Ultra', 'Graphics: Potato', 'Graphics: Low', 'Graphics: Medium', 'Graphics: High']),
    `preset cycle Ultra→Potato→Low→Medium→High (${seen.join(' | ')})`);
  // Potato preset must drag render distance + scale down with it.
  await clickPreset(); await clickPreset(); // High → Ultra → Potato
  const potatoVals = await page.evaluate(() => {
    const s = window.craftverse.settings;
    return [s.get('renderDistance'), s.get('renderScale'), s.get('ssao'), s.get('graphicsPreset'), window.craftverse.renderer.renderScale];
  });
  ok(JSON.stringify(potatoVals) === JSON.stringify([3, 0.5, false, 0, 0.5]), `Potato applies rd=3 scale=0.5 ssao=off (${JSON.stringify(potatoVals)})`);
  // Hand-tuning a preset-owned setting flips the label to Custom.
  await page.evaluate(() => window.craftverse.settings.set('ssao', true));
  const custom = await page.evaluate(() => window.craftverse.settings.get('graphicsPreset'));
  ok(custom === 5, `hand-tuned setting flips preset to Custom (${custom})`);
  // Back to High for gameplay.
  await page.evaluate(async () => {
    const m = await import('/src/engine/presets.js');
    m.applyPreset(window.craftverse.settings, 3);
  });
  await page.screenshot({ path: SHOT('02-options') });
  await page.click('#btn-options-done');

  // Create a world and reach gameplay.
  await page.waitForSelector('#screen-title:not(.hidden)');
  await createWorld(page);
  ok(true, 'world created, state=playing');
  await page.waitForTimeout(4000);
  await page.screenshot({ path: SHOT('03-gameplay-vanilla') });

  // Shader packs: uniforms actually land, and bloom force-enables.
  const packState = () => page.evaluate(() => {
    const r = window.craftverse.renderer;
    const u = r.postfx.compositeMat.uniforms;
    return {
      bloom: r.postfx.bloomStrength,
      sat: u.uSaturation.value,
      tint: u.uTint.value.toArray().map((v) => +v.toFixed(2)),
      direct: r.packDirect,
      uDirect: +r.uniforms.uDirect.value.toFixed(3),
    };
  });
  const names = ['vanilla', 'sunflare', 'dreamwave', 'nightfall'];
  const packResults = [];
  for (let i = 0; i < 4; i++) {
    await page.evaluate((n) => window.craftverse.settings.set('shaderPack', n), i);
    await page.waitForTimeout(700);
    packResults.push(await packState());
    await page.screenshot({ path: SHOT(`04-pack-${i}-${names[i]}`) });
  }
  ok(packResults[1].bloom === 0.82 && packResults[1].direct === 1.35, `Sunflare uniforms applied (${JSON.stringify(packResults[1])})`);
  ok(packResults[2].tint[2] === 1.07 && packResults[2].sat === 0.94, `Dreamwave uniforms applied (${JSON.stringify(packResults[2])})`);
  ok(packResults[3].direct === 1.25 && Math.abs(packResults[3].uDirect - 0.34 * 1.25) < 0.02, `Nightfall sun multiplier reaches the sky (${JSON.stringify(packResults[3])})`);
  await page.evaluate(() => { window.craftverse.settings.set('bloom', false); window.craftverse.settings.set('shaderPack', 2); });
  const bloomForced = await page.evaluate(() => window.craftverse.settings.get('bloom'));
  ok(bloomForced === true, 'picking a pack force-enables bloom & grading');
  await page.evaluate(() => window.craftverse.settings.set('shaderPack', 0));

  // All five presets survive being applied mid-game.
  for (let i = 0; i < 5; i++) {
    await page.evaluate(async (n) => {
      const m = await import('/src/engine/presets.js');
      m.applyPreset(window.craftverse.settings, n);
    }, i);
    await page.waitForTimeout(900);
    const st = await page.evaluate(() => ({
      state: window.craftverse.state,
      rd: window.craftverse.world.renderDistance,
      scale: window.craftverse.renderer.renderScale,
      preset: window.craftverse.settings.get('graphicsPreset'),
    }));
    ok(st.state === 'playing' && st.preset === i, `preset ${i} applied in-game (${JSON.stringify(st)})`);
    if (i === 0) await page.screenshot({ path: SHOT('05-preset-potato') });
    if (i === 4) await page.screenshot({ path: SHOT('06-preset-ultra') });
  }

  // Frame rate sanity (headless SwiftShader renders on the CPU, so measure on
  // Potato after the remesh settles — the check is "not seized up", not speed).
  await page.evaluate(async () => { const m = await import('/src/engine/presets.js'); m.applyPreset(window.craftverse.settings, 0); });
  await page.waitForTimeout(5000);
  const fps = await page.evaluate(() => new Promise((res) => {
    let n = 0; const t0 = performance.now();
    const tick = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(tick); else res(n / 2); };
    requestAnimationFrame(tick);
  }));
  ok(fps > 5, `game loop alive on software GL (${fps.toFixed(1)} fps headless)`);
  await page.evaluate(async () => { const m = await import('/src/engine/presets.js'); m.applyPreset(window.craftverse.settings, 3); });

  // Interact a little: select hotbar, open+close inventory, pause+resume.
  await page.keyboard.press('Digit3');
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(400);
  const invOpen = await page.evaluate(() => window.craftverse.containers.open);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const invClosed = await page.evaluate(() => !window.craftverse.containers.open);
  ok(invOpen && invClosed, 'inventory opens and closes');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const paused = await page.evaluate(() => window.craftverse.state);
  ok(paused === 'paused', `esc pauses (${paused})`);
  await page.click('button[data-act="resume"]').catch(() => clickBtn(page, 'Back to Game'));
  await page.waitForTimeout(300);
  const resumed = await page.evaluate(() => window.craftverse.state);
  ok(resumed === 'playing', `resume works (${resumed})`);

  const realErrors = errors.filter((e) => !/favicon|Permissions|pointer|PointerLock|AudioContext|WebGL.*fallback|GroupMarker/i.test(e));
  ok(realErrors.length === 0, `no console/page errors on desktop${realErrors.length ? ' -> ' + realErrors.slice(0, 5).join(' ;; ') : ''}`);
  await browser.close();
}

// ---------------------------------------------------------------------------
// Touch / mobile run
// ---------------------------------------------------------------------------
async function mobile() {
  console.log('--- mobile/touch ---');
  const browser = await launch();
  const ctx = await browser.newContext({
    viewport: { width: 900, height: 420 },
    hasTouch: true,
    isMobile: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36',
  });
  const page = await ctx.newPage();
  const errors = [];
  watch(page, errors);

  await page.goto(BASE);
  await page.waitForSelector('#screen-title:not(.hidden)', { timeout: 60000 });
  const auto = await page.evaluate(() => window.craftverse.input.touchMode);
  ok(auto === true, 'touch mode auto-detected on a touch device');
  await page.evaluate(async()=>{const m=await import('/src/engine/presets.js');m.applyPreset(window.craftverse.settings,0);});

  await createWorld(page, true);
  ok(true, 'world created via taps');
  await page.waitForTimeout(3500);
  const uiShown = await page.evaluate(() => !document.getElementById('touch-ui').classList.contains('hidden'));
  ok(uiShown, 'touch UI appears in gameplay');

  // Drive the joystick with synthetic touch events and confirm the player walks.
  const dispatch = (sel, type, x, y, id) => page.evaluate(([sel, type, x, y, id]) => {
    const el = document.querySelector(sel);
    const t = new Touch({ identifier: id, target: el, clientX: x, clientY: y });
    el.dispatchEvent(new TouchEvent(type, {
      touches: type === 'touchend' ? [] : [t],
      changedTouches: [t], bubbles: true, cancelable: true,
    }));
  }, [sel, type, x, y, id]);

  const p0 = await page.evaluate(() => ({ x: window.craftverse.player.pos.x, z: window.craftverse.player.pos.z }));
  await dispatch('#touch-stick-zone', 'touchstart', 140, 330, 1);
  await dispatch('#touch-stick-zone', 'touchmove', 140, 265, 1);   // full push forward
  await page.waitForTimeout(200);
  const stickState = await page.evaluate(() => ({
    move: window.craftverse.input.touchMove,
    baseShown: document.getElementById('touch-stick-base').classList.contains('active'),
  }));
  ok(stickState.baseShown && stickState.move && stickState.move.z < -0.8, `joystick registers forward push (${JSON.stringify(stickState.move)})`);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: SHOT('07-touch-hud') });
  await dispatch('#touch-stick-zone', 'touchend', 140, 265, 1);
  const p1 = await page.evaluate(() => ({ x: window.craftverse.player.pos.x, z: window.craftverse.player.pos.z }));
  const dist = Math.hypot(p1.x - p0.x, p1.z - p0.z);
  ok(dist > 1, `player walked with the joystick (${dist.toFixed(2)} blocks)`);
  const cleared = await page.evaluate(() => window.craftverse.input.touchMove);
  ok(cleared === null, 'joystick release stops movement');

  // Look drag turns the camera.
  const yaw0 = await page.evaluate(() => window.craftverse.player.yaw);
  await dispatch('#touch-look', 'touchstart', 650, 200, 2);
  for (let i = 1; i <= 6; i++) await dispatch('#touch-look', 'touchmove', 650 + i * 20, 200, 2);
  await page.waitForTimeout(250);
  await dispatch('#touch-look', 'touchend', 770, 200, 2);
  const yaw1 = await page.evaluate(() => window.craftverse.player.yaw);
  ok(Math.abs(yaw1 - yaw0) > 0.05, `look drag turns the camera (dyaw=${(yaw1 - yaw0).toFixed(3)})`);

  // Hold-to-mine promotes to the attack action.
  await dispatch('#touch-look', 'touchstart', 500, 210, 3);
  await page.waitForFunction(()=>window.craftverse.input.isDown('attack'),null,{timeout:10000});
  const mining = await page.evaluate(() => window.craftverse.input.isDown('attack'));
  await dispatch('#touch-look', 'touchend', 500, 210, 3);
  await page.waitForFunction(()=>!window.craftverse.input.isDown('attack'),null,{timeout:10000});
  const mined = await page.evaluate(() => !window.craftverse.input.isDown('attack'));
  ok(mining && mined, 'hold-to-mine presses and releases attack');

  // Jump button + sneak toggle + inventory button.
  await dispatch('#tb-jump', 'touchstart', 0, 0, 4);
  await page.waitForTimeout(120);
  const jump = await page.evaluate(() => window.craftverse.input.isDown('jump'));
  await dispatch('#tb-jump', 'touchend', 0, 0, 4);
  ok(jump, 'jump button presses jump');
  await dispatch('#tb-sneak', 'touchstart', 0, 0, 5);
  await dispatch('#tb-sneak', 'touchend', 0, 0, 5);
  await page.waitForTimeout(120);
  const sneak = await page.evaluate(() => window.craftverse.input.isDown('sneak'));
  ok(sneak, 'sneak button toggles on');
  await dispatch('#tb-sneak', 'touchstart', 0, 0, 6);
  await dispatch('#tb-sneak', 'touchend', 0, 0, 6);
  await dispatch('#tb-inv', 'touchstart', 0, 0, 7);
  await dispatch('#tb-inv', 'touchend', 0, 0, 7);
  await page.waitForTimeout(400);
  const invOpen = await page.evaluate(() => window.craftverse.containers.open);
  ok(!!invOpen, 'inventory button opens inventory');
  const uiHidden = await page.evaluate(() => document.getElementById('touch-ui').classList.contains('hidden'));
  ok(uiHidden, 'touch UI hides while a container is open');
  await page.screenshot({ path: SHOT('08-touch-inventory') });
  await dispatch('#tb-pause', 'touchstart', 0, 0, 8); // closed container first? inv button toggles
  await page.evaluate(() => window.craftverse.containers.close());
  await page.waitForTimeout(300);

  const realErrors = errors.filter((e) => !/favicon|Permissions|pointer|PointerLock|AudioContext|WebGL.*fallback/i.test(e));
  ok(realErrors.length === 0, `no console/page errors on touch${realErrors.length ? ' -> ' + realErrors.slice(0, 5).join(' ;; ') : ''}`);
  await browser.close();
}

try {
  await mobile();
} catch (e) {
  failures++;
  console.log('FATAL', e.message);
}
console.log(failures === 0 ? 'ALL SMOKE TESTS PASSED' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
