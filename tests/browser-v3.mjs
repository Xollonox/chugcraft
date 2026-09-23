import path from 'node:path';
const OUT=path.resolve('test-output');fs.mkdirSync(OUT,{recursive:true});
import { chromium } from 'playwright';
import fs from 'node:fs';
const results=[];const ok=(v,name)=>{results.push({name,pass:!!v});console.log((v?'PASS ':'FAIL ')+name);};
const b=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),headless:true,args:['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
const ctx=await b.newContext({viewport:{width:900,height:420},hasTouch:true,isMobile:true});
const page=await ctx.newPage();const errors=[],warnings=[];
page.on('pageerror',e=>errors.push(e.message));page.on('console',e=>{if(e.type()==='error')errors.push(e.text());if(e.type()==='warning')warnings.push(e.text());});
try{
 await page.goto(process.env.CHUGCRAFT_URL || 'http://localhost:8080/');await page.waitForSelector('#screen-title:not(.hidden)');
 await page.evaluate(async()=>{const {applyPreset}=await import('/src/engine/presets.js');applyPreset(window.chugcraft.settings,0);});
 await page.tap('[data-act="singleplayer"]');await page.tap('[data-act="create"]');await page.fill('#in-seed','chugtest');await page.tap('#btn-do-create');
 await page.waitForFunction(()=>window.chugcraft?.state==='playing',null,{timeout:120000});
 await page.evaluate(async()=>{
  window.g=window.chugcraft;g.gamerules.doMobSpawning=false;g.player.difficulty=0;
  window.item=await import('/src/crafting/items.js');window.B=(await import('/src/world/blocks.js')).B;
  window.touch=(id,type,x=null,y=null)=>{const el=document.getElementById(id),r=el.getBoundingClientRect();
   const t=new Touch({identifier:42,target:el,clientX:x??r.x+r.width/2,clientY:y??r.y+r.height/2});
   el.dispatchEvent(new TouchEvent(type,{bubbles:true,cancelable:true,changedTouches:[t],touches:type==='touchend'||type==='touchcancel'?[]:[t]}));};
 });
 ok(await page.evaluate(()=>g.touch.enabled),'auto mobile mode');
 for(let i=0;i<9;i++){await page.tap(`#hotbar .slot[data-i="${i}"]`);ok(await page.evaluate(i=>g.player.inventory.selected===i,i),'native touch selects hotbar '+(i+1));}
 await page.screenshot({path:path.join(OUT,'v3-mobile.png')});
 // Cancelled world-touch must never use/attack.
 ok(await page.evaluate(()=>{let n=0;const old=g.input.touchTap.bind(g.input);g.input.touchTap=a=>{n++;old(a);};touch('touch-look','touchstart');touch('touch-look','touchcancel');g.input.touchTap=old;return n===0&&!g.touch._look;}),'touchcancel does not place or attack');
 // Buttons expose durable use actions, not one-frame taps.
 await page.evaluate(()=>{g.player.inventory.clear();g.player.inventory.slots[0]=item.makeStack('bread',2);g.player.inventory.selected=0;g.player.hunger=10;g.player.pitch=1.4;});
 await page.evaluate(()=>touch('tb-use','touchstart'));await page.waitForFunction(()=>g.player.hunger>10,null,{timeout:20000});await page.evaluate(()=>touch('tb-use','touchend'));
 ok(await page.evaluate(()=>g.player.inventory.count('bread')===1),'mobile USE eats food after holding');
 await page.evaluate(()=>{g.player.inventory.clear();g.player.inventory.slots[0]=item.makeStack('potion_speed');});
 await page.evaluate(()=>touch('tb-use','touchstart'));await page.waitForFunction(()=>g.player.effects.speed>0,null,{timeout:20000});await page.evaluate(()=>touch('tb-use','touchend'));
 ok(await page.evaluate(()=>g.player.inventory.count('glass_bottle')===1&&g.player.effects.speed>170),'mobile potion drinking applies timed effect and returns bottle');
 ok(await page.evaluate(()=>document.querySelector('#effect-hud').textContent.includes('Speed')),'active potion duration appears on HUD');
 ok(await page.evaluate(()=>{const p=g.player;p.health=10;p.applyPotion(item.getItem('potion_healing').potion);return p.health===14;}),'healing restores four health');
 ok(await page.evaluate(()=>{const p=g.player;p.health=10;p.applyPotion(item.getItem('potion_fire_resistance').potion);const changed=p.hurt(4,'burned to death',g,true);return !changed&&p.health===10;}),'fire resistance blocks lava/fire damage');
 ok(await page.evaluate(()=>{const p=g.player;p.health=10;p.effects={regeneration:30};p.tickEffects(2);const a=p.health===11;p.tickEffects(28);return a&&!p.effects.regeneration;}),'regeneration heals then expires');
 // Bow holds enough charge and releases exactly one arrow.
 await page.evaluate(()=>{g.player.inventory.clear();g.player.inventory.slots[0]=item.makeStack('bow');g.player.inventory.add('arrow',3);});
 await page.evaluate(()=>touch('tb-use','touchstart'));await page.waitForFunction(()=>g.player.bowCharge>.4,null,{timeout:20000});await page.evaluate(()=>touch('tb-use','touchend'));
 await page.waitForFunction(()=>g.player.inventory.count('arrow')===2);
 ok(true,'mobile USE draws and releases bow');
 // Actual attack path with a pinned target in unobstructed sky.
 await page.evaluate(async()=>{
  g.player.pitch=0;g.player.pos.y=100;g.player.vel.set(0,0,0);g.player.gamemode=1;g.player.flying=true;
  const {Mob}=await import('/src/entities/mobs.js');const p=g.player,d=p.lookDir();
  const cow=new Mob(g,'cow',p.pos.x+d.x*2.2,p.pos.y,p.pos.z+d.z*2.2);cow.gravity=0;cow.update=()=>{};g.entities.add(cow);window.cow=cow;
  g.player.inventory.clear();
 });
 await page.evaluate(()=>touch('tb-attack','touchstart'));await page.waitForFunction(()=>cow.health<10);await page.evaluate(()=>touch('tb-attack','touchend'));
 ok(true,'dedicated mobile HIT attacks aimed mob');
 ok(await page.evaluate(()=>{touch('tb-use','touchstart');touch('tb-attack','touchstart');g.pause();g.touch.update();return !g.input.isDown('use')&&!g.input.isDown('attack');}),'pause releases held touch actions');
 await page.evaluate(()=>{g.resume();g.player.gamemode=0;g.player.flying=false;g.player.pos.set(.5,65,.5);});
 // Place and interact with all three new blocks through normal game entry points.
 for(const [block,type] of [['ENCHANTING_TABLE','enchant'],['ANVIL','anvil'],['BREWING_STAND','brew']]){
  await page.evaluate(([block,type])=>{
   const p=g.player;g.player.health=20;g.player.level=30;p.inventory.clear();p.inventory.slots[0]=item.makeStack('diamond_pickaxe');p.inventory.slots[0].dur=300;
   p.inventory.add('lapis_lazuli',12);p.inventory.add('diamond',3);p.inventory.add('water_bottle');p.inventory.add('nether_wart',3);p.inventory.add('blaze_powder',10);
   const x=2,y=Math.floor(p.pos.y),z=2;g.world.setBlock(x,y,z,B[block]);
   g.interactBlock({x,y,z,id:B[block]}, {interact:type},null,null);
  },[block,type]);
  await page.waitForSelector('.workshop button.execute');
  ok(await page.evaluate(type=>g.containers.type===type,type),'placed '+type+' station opens workshop');
  await page.tap('.workshop button.execute');
  ok(await page.evaluate(type=>type==='enchant'?g.player.inventory.held().key.endsWith('_ench1'):type==='anvil'?g.player.inventory.held().dur>300:g.player.inventory.count('awkward_potion')===1,type),'native mobile '+type+' transaction works');
  if(type==='enchant')await page.screenshot({path:path.join(OUT,'v3-enchanting.png')});
  await page.tap('.gui-close');
 }
 // Full inventory: close must spill excess stacks instead of deleting them.
 ok(await page.evaluate(()=>{
  const inv=g.player.inventory;inv.slots=Array.from({length:36},()=>item.makeStack('stone',64));g.openContainer('crafting');
  g.containers.cursor=item.makeStack('diamond',2);g.containers._grid[0]=item.makeStack('iron_ingot',3);
  const old=g.dropItem.bind(g),dropped=[];g.dropItem=(x,y,z,s,o)=>{dropped.push({...s});return old(x,y,z,s,o);};g.containers.close();g.dropItem=old;
  return dropped.some(s=>s.key==='diamond'&&s.count===2)&&dropped.some(s=>s.key==='iron_ingot'&&s.count===3);
 }),'full-bag container close spills cursor and crafting stacks');
 // Save while workbench is open must include cursor/grid exactly once.
 const saveResult=await page.evaluate(async()=>{
  const inv=g.player.inventory;inv.clear();g.openContainer('crafting');g.containers.cursor=item.makeStack('diamond',2);g.containers._grid[0]=item.makeStack('iron_ingot',3);
  g.player.effects={speed:120};const saved=await g.save();const db=await import('/src/save/db.js');const r=await db.loadWorld(g.saveMeta.id);
  const counts=k=>r.data.player.inventory.slots.reduce((n,s)=>n+(s?.[0]===k?s[1]:0),0);
  const backup=await import('/src/save/backup.js');const checked=backup.parseBackup(backup.encodeBackup(r));
  window.savedID=g.saveMeta.id;
  return {saved,diamonds:counts('diamond'),iron:counts('iron_ingot'),valid:checked.id===r.id,open:g.containers.open};
 });
 ok(saveResult.saved&&saveResult.diamonds===2&&saveResult.iron===3&&saveResult.open,'autosave snapshots temporary inventory without closing UI');
 ok(saveResult.valid,'real generated world passes backup validator');
 // Actual file download and import (restored into a separate world).
 await page.evaluate(()=>{g.containers.close();g.pause();});
 const pending=page.waitForEvent('download');await page.tap('#btn-backup-now');const download=await pending;
 await download.saveAs(path.join(OUT,'v3-world-test.json'));
 ok(download.suggestedFilename().endsWith('.chugcraft.json'),'pause menu downloads a real world backup');
 await page.tap('#btn-save-quit');await page.waitForSelector('#screen-title:not(.hidden)');await page.tap('[data-act="singleplayer"]');
 await page.setInputFiles('#world-import',path.join(OUT,'v3-world-test.json'));await page.waitForFunction(()=>document.querySelector('#backup-status').textContent.includes('Imported'));
 ok(await page.evaluate(async()=>{const db=await import('/src/save/db.js');return (await db.listWorlds()).length>=2;}),'import creates a separate world without overwriting original');
 await page.evaluate(async()=>{await g.loadWorld(window.savedID);});
 ok(await page.evaluate(()=>g.player.inventory.count('diamond')===2&&g.player.inventory.count('iron_ingot')===3&&g.player.effects.speed>0),'save/reload preserves inventory and potion effects');
 // Drops must survive a real reload with durability intact.
 await page.evaluate(async()=>{
   g.containers.close();g.dropItem(g.player.pos.x+4,100,g.player.pos.z,{key:'iron_pickaxe_ench1',count:1,dur:123},{delay:30,vx:0,vy:0,vz:0});
   await g.save();await g.loadWorld(g.saveMeta.id);
 });
 ok(await page.evaluate(()=>g.entities.list.some(e=>e.kind==='item'&&e.stack.key==='iron_pickaxe_ench1'&&e.stack.dur===123)),'dropped enchanted tool survives save/reload');
 // A dead saved player must return to the death screen, not walk at zero HP.
 await page.evaluate(async()=>{g.player.health=0;g.player.dead=true;g.player.deathCause='test';await g.save();await g.loadWorld(g.saveMeta.id);});
 ok(await page.evaluate(()=>g.state==='dead'&&!document.querySelector('#screen-death').classList.contains('hidden')),'dead save reload shows death screen');
 await page.tap('#btn-respawn');await page.waitForFunction(()=>g.state==='playing');
 // Older save shape (no v3 fields) continues to load.
 await page.evaluate(async()=>{
   const db=await import('/src/save/db.js');await g.save();const r=await db.loadWorld(g.saveMeta.id);
   delete r.data.player.effects;delete r.data.player.dead;delete r.data.player.deathCause;delete r.data.lastDeath;
   await db.saveWorld(r);await g.loadWorld(r.id);
 });
 ok(await page.evaluate(()=>g.state==='playing'&&g.player.health>0&&Object.keys(g.player.effects).length===0),'pre-v3 save shape loads with safe defaults');
 // Portrait layout: targets must be inside viewport and hit-testable.
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(600);
 ok(await page.evaluate(()=>[...document.querySelectorAll('#hotbar .slot,#tb-use,#tb-attack,#tb-jump')].every(e=>{const r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return r.x>=0&&r.right<=innerWidth+1&&r.y>=0&&r.bottom<=innerHeight+1&&(hit===e||e.contains(hit));})),'portrait hotbar and action buttons fit and receive touches');
 await page.screenshot({path:path.join(OUT,'v3-portrait.png')});
 // Deterministic interaction soak: alternate menus/hotbar/joystick over 20 cycles.
 for(let i=0;i<20;i++){
  await page.tap(`#hotbar .slot[data-i="${i%9}"]`);
  await page.evaluate(i=>{if(i%4===0){g.openContainer('inventory');g.containers.close();}else if(i%4===1){g.pause();g.resume();}else{touch('touch-look','touchstart');touch('touch-look','touchcancel');}},i);
 }
 ok(await page.evaluate(()=>g.state==='playing'&&Number.isFinite(g.player.pos.y)&&!g.input.isDown('attack')),'20-cycle mobile menu/input soak remains playable without stuck attack');
 // NPC interaction must be reachable from the player's actual Use action.
 await page.setViewportSize({width:900,height:420});
 await page.evaluate(async()=>{
   const {Mob}=await import('/src/entities/mobs.js');
   const p=g.player;p.pos.set(.5,100,.5);p.yaw=0;p.pitch=0;p.gamemode=1;p.flying=true;p.vel.set(0,0,0);
   p.inventory.clear();p.inventory.add('wheat',20);p.inventory.selected=0;
   const n=new Mob(g,'villager',.5,100,-1.7,{profession:'farmer'});n.gravity=0;n.update=()=>{};g.entities.add(n);window.npc=n;
 });
 await page.evaluate(()=>touch('tb-use','touchstart'));
 await page.waitForFunction(()=>g.containers.type==='trade');
 ok(true,'Use action opens nearby villager trading screen');
 await page.locator('#container-root button', {hasText:'Trade'}).first().tap();
 ok(await page.evaluate(()=>g.player.inventory.count('wheat')===0&&g.player.inventory.count('emerald')===1),'villager trade exchanges items from actual UI');
 await page.tap('.gui-close');
 ok(await page.evaluate(()=>{
   g.world.setBlock(0,101,-1,B.STONE);g.world.setBlock(0,100,-1,B.STONE);
   const hidden=g.pickEntity(4.8)!==window.npc;
   g.world.setBlock(0,101,-1,B.AIR);g.world.setBlock(0,100,-1,B.AIR);return hidden;
 }),'solid wall blocks entity targeting');
 ok(errors.length===0,'zero browser runtime errors: '+errors.join(' | '));
 const missing=warnings.filter(s=>/missing painter|failed/i.test(s));ok(!missing.length,'no missing textures/icons: '+missing.join(' | '));
}catch(e){ok(false,'FATAL '+e.stack);await page.screenshot({path:path.join(OUT,'v3-failure.png')}).catch(()=>{});}
finally{await b.close();fs.writeFileSync(path.join(OUT,'browser3-results.json'),JSON.stringify({results,errors,warnings},null,2));}
console.log(`RESULT ${results.filter(r=>r.pass).length}/${results.length} passed`);
process.exit(results.some(r=>!r.pass)?1:0);
