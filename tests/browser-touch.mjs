import path from 'node:path';
const OUT=path.resolve('test-output');fs.mkdirSync(OUT,{recursive:true});
import fs from 'node:fs';
// ChugCraft 2.0 regression + soak tests.
//
// Covers the two bugs reported against 1.1 (hotbar slots dead on touch, mobs
// unhittable on touch) plus a randomised loop test that hammers the touch UI
// looking for anything else of the same shape.
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

async function createWorld(page, tap = false) {
  const press = async (sel) => (tap ? page.tap(sel) : page.click(sel));
  await press('button[data-act="singleplayer"]');
  await page.waitForSelector('#screen-worlds:not(.hidden)');
  await press('button[data-act="create"]');
  await page.waitForSelector('#screen-create:not(.hidden)');
  await page.fill('#in-seed', 'chugtest');
  await press('#btn-do-create');
  await page.waitForFunction(() => window.chugcraft && window.chugcraft.state === 'playing', null, { timeout: 120000 });
}

// Synthetic touch. Playwright's page.tap() goes through the real hit-test, so
// it cannot tell us whether an overlay is swallowing the event -- which is
// exactly the bug under test -- hence hand-built TouchEvents dispatched at the
// topmost element under the finger, like a real browser would.
async function installTouch(page) {
  await page.evaluate(() => {
    window.__touch = (sel, type, id, dx = 0, dy = 0) => {
      const el = document.querySelector(sel);
      if (!el) throw new Error('no element ' + sel);
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2 + dx;
      const y = r.top + r.height / 2 + dy;
      const target = document.elementFromPoint(x, y) || el;
      const t = new Touch({ identifier: id, target, clientX: x, clientY: y });
      target.dispatchEvent(new TouchEvent(type, {
        touches: type === 'touchend' ? [] : [t],
        changedTouches: [t], bubbles: true, cancelable: true,
      }));
      return { x, y, hit: target.id || target.className || target.tagName };
    };
    // Same thing, but aimed straight at the element instead of at whatever is
    // topmost. Used for the joystick and buttons, where we are testing the
    // handler rather than the stacking order.
    window.__touchEl = (sel, type, id, dx = 0, dy = 0) => {
      const el = document.querySelector(sel);
      if (!el) throw new Error('no element ' + sel);
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2 + dx;
      const y = r.top + r.height / 2 + dy;
      const t = new Touch({ identifier: id, target: el, clientX: x, clientY: y });
      el.dispatchEvent(new TouchEvent(type, {
        touches: type === 'touchend' ? [] : [t],
        changedTouches: [t], bubbles: true, cancelable: true,
      }));
      return { x, y };
    };
    // Run a whole press-and-release inside the page. Driving it from node adds
    // 100-300ms of round-trip per step, which is enough to turn a "tap" into a
    // "hold" on a loaded machine and make these tests lie.
    window.__gesture = (sel, ms, dx = 0, dy = 0) => new Promise((res) => {
      const info = window.__touch(sel, 'touchstart', 77, dx, dy);
      setTimeout(() => { window.__touch(sel, 'touchend', 77, dx, dy); res(info); }, ms);
    });
  });
}

const tapAt = async (page, sel, id, dx = 0, dy = 0, holdMs = 110) =>
  page.evaluate(([s, ms, a, b]) => window.__gesture(s, ms, a, b), [sel, holdMs, dx, dy]);

// ---------------------------------------------------------------------------
// Bug 1 + 2: hotbar selection and attacking on touch
// ---------------------------------------------------------------------------
async function touchRegressions() {
  console.log('--- touch regressions ---');
  const browser = await launch();
  const ctx = await browser.newContext({
    viewport: { width: 900, height: 420 }, hasTouch: true, isMobile: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Mobile Safari/537.36',
  });
  const page = await ctx.newPage();
  const errors = [];
  watch(page, errors);
  await page.goto(BASE);
  await page.waitForSelector('#screen-title:not(.hidden)', { timeout: 60000 });
  await createWorld(page, true);
  await page.waitForTimeout(2500);
  await installTouch(page);

  // --- hotbar --------------------------------------------------------------
  const slots = await page.$$eval('#hotbar .slot', (s) => s.length);
  ok(slots === 9, `hotbar renders 9 slots (${slots})`);

  const picked = [];
  for (const i of [3, 6, 1, 8, 0]) {
    await tapAt(page, `#hotbar .slot[data-i="${i}"]`, 20 + i);
    await page.waitForTimeout(90);
    picked.push(await page.evaluate(() => window.chugcraft.player.inventory.selected));
  }
  ok(JSON.stringify(picked) === JSON.stringify([3, 6, 1, 8, 0]),
    `every hotbar slot selectable by touch (${picked.join(',')})`);

  const hudZ = await page.evaluate(() => getComputedStyle(document.getElementById('hud')).zIndex);
  ok(Number(hudZ) >= 50, `HUD sits above the look layer in touch mode (z-index ${hudZ})`);
  await page.screenshot({ path: SHOT('09-touch-hotbar') });

  // --- attacking a mob -----------------------------------------------------
  const spawn = await page.evaluate(async () => {
    const g = window.chugcraft;
    const m = await import('/src/entities/mobs.js');
    const p = g.player;
    p.pitch = 0;
    const dir = p.lookDir();
    const x = p.pos.x + dir.x * 2.2, z = p.pos.z + dir.z * 2.2;
    const cow = new m.Mob(g, 'cow', x, p.pos.y, z);
    // Pin it in place: a live cow wanders out of the crosshair between the
    // spawn and the tap, which makes this test flap.
    cow.gravity = 0;
    cow.update = () => {};
    const e = g.entities;
    if (e && typeof e.add === 'function') e.add(cow);
    else if (Array.isArray(e)) e.push(cow);
    else if (e && Array.isArray(e.list)) e.list.push(cow);
    window.__cow = cow;
    for (const dy of [0, 0.4, -0.4, 0.8]) {
      cow.pos.y = p.pos.y + dy;
      if (g.pickEntity(5) === cow) return { hp: cow.health, dy, picked: true };
    }
    return { hp: cow.health, picked: g.pickEntity(5) === cow };
  });
  ok(spawn.picked, `test cow is in the crosshair (hp ${spawn.hp})`);

  const stillAimed = await page.evaluate(() => window.chugcraft.pickEntity(5) === window.__cow);
  ok(stillAimed, 'cow stays put in the crosshair');
  await tapAt(page, '#touch-look', 40);
  await page.waitForTimeout(250);
  const afterTap = await page.evaluate(() => window.__cow.health);
  ok(afterTap < spawn.hp, `tap on the world attacks a mob in reach (${spawn.hp} -> ${afterTap})`);

  // Holding should keep swinging on the ATTACK_REPEAT cadence, not stop at one.
  await page.evaluate(() => window.__gesture('#touch-look', 2200));
  await page.waitForTimeout(200);
  const afterHold = await page.evaluate(() => window.__cow.health);
  ok(afterHold < afterTap, `holding repeats the attack (${afterTap} -> ${afterHold})`);

  // A tap on empty air must still place/use, not throw.
  await page.evaluate(() => { window.chugcraft.player.pitch = -0.9; });
  await tapAt(page, '#touch-look', 42);
  await page.waitForTimeout(150);
  const stillPlaying = await page.evaluate(() => window.chugcraft.state);
  ok(stillPlaying === 'playing', `tap with no entity in reach still safe (state ${stillPlaying})`);

  ok(errors.length === 0, `no page errors during touch regressions (${errors.slice(0, 3).join(' | ')})`);
  await ctx.close();
  await browser.close();
}

// ---------------------------------------------------------------------------
// Desktop: hotbar keys and scroll must still work after the touch changes
// ---------------------------------------------------------------------------
async function desktopHotbar() {
  console.log('--- desktop hotbar ---');
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  watch(page, errors);
  await page.goto(BASE);
  await page.waitForSelector('#screen-title:not(.hidden)', { timeout: 60000 });
  await createWorld(page);
  await page.waitForTimeout(2000);

  const seen = [];
  for (const d of ['Digit3', 'Digit7', 'Digit1']) {
    await page.keyboard.press(d);
    await page.waitForTimeout(80);
    seen.push(await page.evaluate(() => window.chugcraft.player.inventory.selected));
  }
  ok(JSON.stringify(seen) === JSON.stringify([2, 6, 0]), `number keys pick hotbar slots (${seen.join(',')})`);

  await page.mouse.wheel(0, 120);
  await page.waitForTimeout(120);
  const scrolled = await page.evaluate(() => window.chugcraft.player.inventory.selected);
  ok(scrolled !== 0, `mouse wheel changes hotbar slot (now ${scrolled})`);

  const legacy = await page.evaluate(() => window.craftverse === window.chugcraft);
  ok(legacy, 'old window.craftverse handle still points at the game');

  const title = await page.title();
  ok(/ChugCraft/i.test(title), `page title renamed (${title})`);

  ok(errors.length === 0, `no page errors on desktop (${errors.slice(0, 3).join(' | ')})`);
  await browser.close();
}

// ---------------------------------------------------------------------------
// Soak: 45s of randomised touch input, watching for errors or a dead game
// ---------------------------------------------------------------------------
async function soak() {
  console.log('--- 45s randomised touch soak ---');
  const browser = await launch();
  const ctx = await browser.newContext({
    viewport: { width: 900, height: 420 }, hasTouch: true, isMobile: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Mobile Safari/537.36',
  });
  const page = await ctx.newPage();
  const errors = [];
  watch(page, errors);
  await page.goto(BASE);
  await page.waitForSelector('#screen-title:not(.hidden)', { timeout: 60000 });
  await createWorld(page, true);
  await page.waitForTimeout(2000);
  await installTouch(page);

  const rnd = (n) => Math.floor(Math.random() * n);
  const end = Date.now() + 45000;
  let actions = 0, moved = 0;
  let lastPos = null;
  let walkProbe = null;

  while (Date.now() < end) {
    const roll = rnd(10);
    try {
      if (roll < 3) {
        await page.evaluate(() => window.__touchEl('#touch-stick-zone', 'touchstart', 1, 0, 0));
        const dx = (rnd(2) ? 1 : -1) * (40 + rnd(40));
        const dy = (rnd(2) ? 1 : -1) * (40 + rnd(40));
        await page.evaluate(([a, b]) => window.__touchEl('#touch-stick-zone', 'touchmove', 1, a, b), [dx, dy]);
        if (walkProbe === null) {
          walkProbe = await page.evaluate(() => {
            const m = window.chugcraft.input.touchMove;
            return m ? [m.x, m.y] : 'none';
          });
        }
        await page.waitForTimeout(220 + rnd(400));
        await page.evaluate(() => window.__touchEl('#touch-stick-zone', 'touchend', 1));
      } else if (roll < 5) {
        await page.evaluate(() => window.__touch('#touch-look', 'touchstart', 2, 100, 0));
        for (let i = 1; i <= 5; i++) {
          await page.evaluate(([d]) => window.__touch('#touch-look', 'touchmove', 2, 100 + d * 18, d * 6), [i]);
        }
        await page.evaluate(() => window.__touch('#touch-look', 'touchend', 2, 190, 30));
      } else if (roll < 6) {
        await tapAt(page, '#touch-look', 3, rnd(200) - 100, rnd(80) - 40);
      } else if (roll < 7) {
        await page.evaluate(([ms]) => window.__gesture('#touch-look', ms), [600 + rnd(700)]);
      } else if (roll < 8) {
        await tapAt(page, `#hotbar .slot[data-i="${rnd(9)}"]`, 5);
      } else if (roll < 9) {
        await page.evaluate(() => window.__touchEl('#tb-jump', 'touchstart', 6));
        await page.waitForTimeout(180);
        await page.evaluate(() => window.__touchEl('#tb-jump', 'touchend', 6));
      } else {
        await page.evaluate(() => window.__touchEl('#tb-inv', 'touchstart', 7));
        await page.evaluate(() => window.__touchEl('#tb-inv', 'touchend', 7));
        await page.waitForTimeout(300);
        await page.evaluate(() => window.__touchEl('#tb-inv', 'touchstart', 8));
        await page.evaluate(() => window.__touchEl('#tb-inv', 'touchend', 8));
      }
      actions++;
    } catch (e) {
      errors.push('action: ' + e.message);
    }

    const st = await page.evaluate(() => {
      const g = window.chugcraft;
      return { state: g.state, pos: [g.player.pos.x, g.player.pos.y, g.player.pos.z] };
    });
    if (st.state !== 'playing' && st.state !== 'container') {
      errors.push('state became ' + st.state);
      break;
    }
    if (lastPos && JSON.stringify(lastPos) !== JSON.stringify(st.pos)) moved++;
    lastPos = st.pos;
  }

  const final = await page.evaluate(() => {
    const g = window.chugcraft;
    return { state: g.state, y: g.player.pos.y, hp: g.player.health, sel: g.player.inventory.selected };
  });
  ok(actions >= 10, `soak ran a decent number of actions (${actions})`);
  ok(Array.isArray(walkProbe) && (Math.abs(walkProbe[0]) > 0.05 || Math.abs(walkProbe[1]) > 0.05),
    `joystick fed the input layer (${JSON.stringify(walkProbe)})`);
  ok(final.state === 'playing' || final.state === 'container', `game still alive after soak (state ${final.state})`);
  ok(final.y > -20, `player did not fall out of the world (y ${final.y.toFixed(1)})`);
  ok(moved > 5, `player actually moved during soak (${moved} of ${actions} samples)`);
  ok(errors.length === 0, `soak produced no errors (${errors.slice(0, 4).join(' | ')})`);
  await page.screenshot({ path: SHOT('10-soak-end') });
  await ctx.close();
  await browser.close();
}

await touchRegressions();
await desktopHotbar();
await soak();
console.log(failures === 0 ? '\nALL V2 TESTS PASSED' : `\n${failures} V2 TEST(S) FAILED`);
process.exit(failures ? 1 : 0);
