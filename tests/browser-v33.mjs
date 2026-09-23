// ChugCraft 3.3 — rails & minecarts gameplay suite.
// Plays the real game twice: once in a mobile (touch) session and once in a
// desktop (mouse + keyboard) session. Lays a track, places and rides a
// minecart, checks curves, powered boosts, dismounting, saving and reloading.
import {chromium} from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const OUT=path.resolve('test-output/v33');
fs.mkdirSync(OUT,{recursive:true});
const checks=[],errors=[];
function ok(v,name){checks.push({name,pass:!!v});console.log((v?'PASS ':'FAIL ')+name);}

const browser=await chromium.launch({
  ...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),
  headless:true,
  args:['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage'],
});
const URL_=process.env.CHUGCRAFT_URL||'http://localhost:8080/';

async function waitCart(page,cond,timeout=15000){
  const t0=Date.now();
  while(Date.now()-t0<timeout){
    const s=await page.evaluate(()=>{const c=g.entities.list.find(e=>e.kind==='cart');
      return c?{x:c.pos.x,y:c.pos.y,z:c.pos.z,speed:Math.hypot(c.vel.x,c.vel.z)}:null;});
    if(s&&cond(s))return s;
    await page.waitForTimeout(80);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Shared fixture: a flat yard with an L-shaped track.
//   straight N-S (x=0, z=0..6) -> elbow (0,7) -> straight E-W (x=1..12, z=7)
//   (3,7) is a powered rail whose redstone block arrived with the fixture,
//   so its stored state is stale until a cart rolls over it (self-heal test).
//   (6,7) is a powered rail properly switched on by the neighbour pass.
// ---------------------------------------------------------------------------
async function buildYard(page){
  await page.evaluate(async()=>{
    window.g=window.chugcraft;
    window.reg=await import('/src/world/blocks.js');window.B=reg.B;
    window.it=await import('/src/crafting/items.js');
    window.rails=await import('/src/world/rails.js');
    const B=window.B;
    g.gamerules.doMobSpawning=false;g.gamerules.doDaylightCycle=false;g.gamerules.doWeatherCycle=false;
    g.gamerules.randomTickSpeed=false;g.player.difficulty=0;g.player.gamemode=1;g.player.flying=true;
    g.player.pos.set(0.5,95,0.5);g.player.vel.set(0,0,0);
    for(let x=-6;x<=14;x++)for(let z=-4;z<=14;z++){g.world.setBlock(x,90,z,B.STONE);for(let y=91;y<=100;y++)g.world.setBlock(x,y,z,B.AIR);}
    for(let z=0;z<=6;z++)g.world.setBlock(0,91,z,B.RAIL);
    g.world.setBlock(0,91,7,B.RAIL);
    for(let x=1;x<=12;x++)g.world.setBlock(x,91,7,B.RAIL);
    g.world.setBlock(3,91,7,B.POWERED_RAIL);g.world.setBlock(3,92,7,B.REDSTONE_BLOCK);
    g.world.setBlock(6,91,7,B.POWERED_RAIL);g.world.setBlock(6,92,7,B.REDSTONE_BLOCK);
    g.world.flushSets();
    g.refreshRailPowerAround(6,92,7);
    window.hold=(key,count=1)=>{g.player.inventory.clear();g.player.inventory.selected=0;g.player.inventory.slots[0]=it.makeStack(key,count);g.player.inventory.changed();};
    window.aim=(x,y,z)=>{const p=g.player,e=p.eyePosition(),dx=x-e.x,dy=y-e.y,dz=z-e.z;p.yaw=Math.atan2(-dx,-dz);p.pitch=Math.atan2(dy,Math.hypot(dx,dz));};
    window.stand=(x,y,z)=>{g.player.pos.set(x,y,z);g.player.vel.set(0,0,0);};
    window.carts=()=>g.entities.list.filter(e=>e.kind==='cart');
    window.clearCarts=()=>{g.entities.list.filter(e=>e.kind==='cart').forEach(e=>e.remove());};
    // Stand within reach of the first cart and look straight at it.
    window.aimCart=()=>{const c=carts()[0];if(!c)return;g.player.pos.set(c.pos.x-2.2,c.pos.y+1.2,c.pos.z-2.2);g.player.vel.set(0,0,0);aim(c.pos.x,c.pos.y+0.35,c.pos.z);};
    g.time=0.25*g.settings.get('dayLength')*60;
  });
  await page.waitForTimeout(2500);
}

try{
  // =========================================================================
  // Pass 1 — touch / mobile session
  // =========================================================================
  const touch=await browser.newContext({viewport:{width:960,height:540},hasTouch:true,isMobile:true});
  const page=await touch.newPage();
  page.on('pageerror',e=>errors.push('touch: '+e.message));
  page.on('console',e=>{if(e.type()==='error')errors.push('touch: '+e.text());});
  const use=async()=>{await page.tap('#tb-use');await page.waitForTimeout(280);};

  await page.goto(URL_);
  await page.waitForSelector('#screen-title:not(.hidden)');
  await page.evaluate(async()=>{const {applyPreset}=await import('/src/engine/presets.js');applyPreset(window.chugcraft.settings,0);});
  await page.tap('[data-act="singleplayer"]');
  await page.tap('[data-act="create"]');
  await page.fill('#in-seed','rails-yard');
  await page.tap('#btn-do-create');
  await page.waitForFunction(()=>window.chugcraft?.state==='playing',null,{timeout:240000});
  await buildYard(page);

  // Geometry really reached the chunk mesher.
  ok(await page.evaluate(()=>[...g.world.chunks.values()].some(c=>c.meshes.some(m=>m?.geometry?.attributes.position.count>0))),
    'worker meshes the rail yard without errors');

  // Track shapes and powered states.
  const shapes=await page.evaluate(()=>{
    const get=(x,y,z)=>g.world.getBlock(x,y,z);
    return {
      straight:rails.railShape(get,0,91,3),
      curve:rails.railShape(get,0,91,7),
      ew:rails.railShape(get,3,91,7),
      poweredOn:g.world.getBlock(6,91,7),
      poweredOff:g.world.getBlock(3,91,7),
    };
  });
  ok(shapes.straight.kind==='straight'&&shapes.straight.axis==='z','straight track resolves to the Z axis');
  ok(shapes.curve.kind==='curve'&&shapes.curve.corner==='ne','elbow resolves as a north-east curve');
  ok(shapes.ew.kind==='straight'&&shapes.ew.axis==='x','E-W straight resolves after the elbow');
  ok(await page.evaluate(()=>g.world.getBlock(6,91,7)===B.POWERED_RAIL_ON),'redstone neighbour switched the powered rail on');
  ok(await page.evaluate(()=>g.world.getBlock(3,91,7)===B.POWERED_RAIL),'powered rail without the neighbour pass stays off');

  // Boost + friction, measured on a riderless cart so the numbers are physics.
  await page.evaluate(async()=>{
    const {Minecart}=await import('/src/entities/minecart.js');
    clearCarts();
    const c=new Minecart(g,4.5,91.0625,7.5);c.vel.set(2,0,0);g.entities.add(c);
  });
  const boosted=await waitCart(page,s=>s.x>=6.9,12000);
  ok(boosted&&boosted.speed>=2.8,`powered rail accelerates a rolling cart (${boosted?boosted.speed.toFixed(2):'n/a'} m/s)`);
  await page.evaluate(async()=>{
    const {Minecart}=await import('/src/entities/minecart.js');
    clearCarts();
    const c=new Minecart(g,8.5,91.0625,7.5);c.vel.set(3,0,0);g.entities.add(c);
  });
  const coasted=await waitCart(page,s=>s.x>=10.4,12000);
  ok(coasted&&coasted.speed<2.7&&coasted.speed>0.4,`plain rails slow the cart down (${coasted?coasted.speed.toFixed(2):'n/a'} m/s)`);
  await page.evaluate(()=>clearCarts());

  // Rail placement through the normal USE path (aim at the ground, place).
  await page.evaluate(()=>{hold('rail',4);stand(-3.5,92,-2.5);aim(-3.5,90.6,-1.5);});
  await page.waitForTimeout(300);
  await use();
  ok(await page.evaluate(()=>{
    for(let x=-6;x<=-1;x++)for(let y=91;y<=92;y++)for(let z=-4;z<=0;z++)
      if(g.world.getBlock(x,y,z)===B.RAIL)return true;
    return false;
  }),'rail places through the mobile USE path');

  // Cart placement and boarding through the normal USE path.
  await page.evaluate(()=>{hold('minecart');stand(-2.5,92,0.5);aim(0,91.4,0.5);});
  await page.waitForTimeout(300);
  await use();
  ok(await page.evaluate(()=>carts().length===1&&carts()[0].onRail),'minecart places onto the rail');
  ok(await page.evaluate(()=>Math.abs(carts()[0].pos.y-(91+0.0625))<0.001),'cart sits on the rail plate');

  await page.evaluate(()=>aimCart());
  await page.waitForTimeout(300);
  await use();
  ok(await page.evaluate(()=>!!g.player.riding&&carts()[0].rider==='player'),'USE boards the minecart');
  await page.screenshot({path:path.join(OUT,'v33-mount.png')});

  // Ride the whole L: throttle with W and watch it turn the corner.
  await page.keyboard.down('KeyW');
  let maxSpeed=0,minY=99,maxY=0,sawTurn=false;
  for(let i=0;i<220;i++){
    await page.waitForTimeout(100);
    const s=await page.evaluate(()=>{const c=carts()[0];return c?{x:c.pos.x,y:c.pos.y,z:c.pos.z,speed:Math.hypot(c.vel.x,c.vel.z)}:null;});
    if(!s)break;
    maxSpeed=Math.max(maxSpeed,s.speed);
    if(s.z>6.6)minY=Math.min(minY,s.y),maxY=Math.max(maxY,s.y);
    if(s.x>1.2)sawTurn=true;
    if(i===8)await page.screenshot({path:path.join(OUT,'v33-riding.png')});
    if(s.x>=9.5)break;
  }
  await page.keyboard.up('KeyW');
  const end=await page.evaluate(()=>{const c=carts()[0];return c?{x:c.pos.x,z:c.pos.z}:null;});
  ok(end&&end.x>=9.5,`cart rides the whole L-shaped track (${end?`x=${end.x.toFixed(1)} z=${end.z.toFixed(1)}`:'lost'})`);
  ok(sawTurn,'cart follows the curve instead of leaving the track');
  ok(maxSpeed>1.5,`cart reaches rolling speed (${maxSpeed.toFixed(2)} m/s)`);
  ok(minY>91&&maxY<91.3,'cart never derails while on rails');
  ok(await page.evaluate(()=>g.world.getBlock(3,91,7)===B.POWERED_RAIL_ON),'a cart rolling over a stale powered rail switches it on');

  // Dismount with the touch sneak toggle.
  await page.tap('#tb-sneak');
  await page.waitForTimeout(400);
  ok(await page.evaluate(()=>!g.player.riding&&!carts()[0].rider),'touch sneak dismounts cleanly');
  await page.tap('#tb-sneak');
  await page.waitForTimeout(250);

  // Park the cart (pin its velocity so the save position is deterministic),
  // then save, backup round-trip, and a full reload.
  await page.waitForTimeout(1800);
  await page.evaluate(()=>{const c=carts()[0];if(c)c.vel.set(0,0,0);});
  await page.waitForTimeout(400);
  await page.evaluate(async()=>{await g.save();window.savedId=g.saveMeta.id;});
  const saved=await page.evaluate(async()=>{
    const db=await import('/src/save/db.js');const bk=await import('/src/save/backup.js');
    const rec=await db.loadWorld(window.savedId);
    const cart=(rec.data.items||[]).find(e=>e.t==='cart')||null;
    let round=null,roundError=null;
    try{const parsed=bk.parseBackup(bk.encodeBackup(rec));round=(parsed.data.items||[]).find(e=>e.t==='cart')||null;}
    catch(err){roundError=String(err&&err.message||err);}
    return {cart:cart?{x:cart.x,y:cart.y,z:cart.z}:null,round:round?{x:round.x,z:round.z}:null,roundError};
  });
  ok(saved.cart&&Number.isFinite(saved.cart.x),'minecart serializes into the save file');
  ok(saved.round&&!saved.roundError,`backup export/import round-trips the minecart${saved.roundError?': '+saved.roundError:''}`);

  await page.evaluate(async()=>{await g.loadWorld(g.saveMeta.id);});
  await page.waitForFunction(()=>window.chugcraft?.state==='playing',null,{timeout:180000});
  await page.waitForTimeout(1500);
  const reloaded=await page.evaluate(()=>({carts:carts().map(c=>({x:c.pos.x,y:c.pos.y,z:c.pos.z}))}));
  ok(reloaded.carts.length===1&&saved.cart&&Math.abs(reloaded.carts[0].x-saved.cart.x)<0.6,
    'reloading the world restores the minecart where it was left');
  await page.screenshot({path:path.join(OUT,'v33-reloaded.png')});

  // Showcase shots for visual review: the yard and a curve/powered close-up.
  await page.evaluate(()=>{g.player.flying=true;g.player.pos.set(7.5,99,-4.5);aim(4,91,7);});
  await page.waitForTimeout(800);
  await page.screenshot({path:path.join(OUT,'v33-track.png')});
  await page.evaluate(()=>{g.player.pos.set(-2.5,93.2,4.2);aim(1.4,91.0,7.2);});
  await page.waitForTimeout(800);
  await page.screenshot({path:path.join(OUT,'v33-curve.png')});
  await touch.close();

  // =========================================================================
  // Pass 2 — desktop session (mouse button 2 = use, WASD, shift)
  // =========================================================================
  const desk=await browser.newContext({viewport:{width:960,height:540}});
  const page2=await desk.newPage();
  page2.on('pageerror',e=>errors.push('desktop: '+e.message));
  page2.on('console',e=>{if(e.type()==='error')errors.push('desktop: '+e.text());});
  const clickUse=async()=>{
    await page2.evaluate(()=>{
      g.input.locked=true;
      const code=g.settings.keyFor('use');
      const btn=Number(String(code).replace('Mouse',''))||2;
      window.dispatchEvent(new MouseEvent('mousedown',{button:btn,bubbles:true}));
      setTimeout(()=>window.dispatchEvent(new MouseEvent('mouseup',{button:btn,bubbles:true})),140);
    });
    await page2.waitForTimeout(320);
  };
  await page2.goto(URL_);
  await page2.waitForSelector('#screen-title:not(.hidden)');
  await page2.evaluate(async()=>{const {applyPreset}=await import('/src/engine/presets.js');applyPreset(window.chugcraft.settings,0);});
  await page2.click('[data-act="singleplayer"]');
  await page2.click('[data-act="create"]');
  await page2.fill('#in-seed','rails-desk');
  await page2.click('#btn-do-create');
  await page2.waitForFunction(()=>window.chugcraft?.state==='playing',null,{timeout:240000});
  await buildYard(page2);
  await page2.evaluate(()=>{hold('minecart');stand(1.5,92,5.5);aim(3,91.4,7.2);});
  await page2.waitForTimeout(300);
  await clickUse();
  ok(await page2.evaluate(()=>carts().length===1),'desktop right-click places the minecart');
  await page2.evaluate(()=>aimCart());
  await page2.waitForTimeout(300);
  await clickUse();
  ok(await page2.evaluate(()=>!!g.player.riding),'desktop right-click boards the minecart');
  const start=await page2.evaluate(()=>carts()[0].pos.x);
  await page2.keyboard.down('KeyW');
  await page2.waitForTimeout(1600);
  await page2.keyboard.up('KeyW');
  const deskMoved=await page2.evaluate(()=>{const c=carts()[0];return {x:c.pos.x,speed:Math.hypot(c.vel.x,c.vel.z)};});
  ok(deskMoved.x>start+0.8||deskMoved.speed>0.8,`desktop W rolls the cart (x ${start.toFixed(1)} -> ${deskMoved.x.toFixed(1)})`);
  await page2.keyboard.press('ShiftLeft');
  await page2.waitForTimeout(400);
  ok(await page2.evaluate(()=>!g.player.riding),'desktop shift dismounts');
  await page2.screenshot({path:path.join(OUT,'v33-desktop.png')});
  await desk.close();
}catch(err){
  console.log('SUITE ERROR: '+(err&&err.stack||err));
  errors.push('suite: '+String(err&&err.message||err));
}

const failed=checks.filter(c=>!c.pass);
console.log(`\n${checks.length-failed.length}/${checks.length} checks passed`);
if(errors.length){console.log('page errors:');errors.slice(0,10).forEach(e=>console.log('  '+e));}
fs.writeFileSync(path.join(OUT,'results.json'),JSON.stringify({checks,errors},null,1));
await browser.close();
if(failed.length||errors.length)process.exitCode=1;
