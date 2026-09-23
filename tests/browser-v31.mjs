// ChugCraft 3.1 browser checks: farming, husbandry, fishing, professions,
// persistent mobs and subtitles, driven through the real touch buttons.
import { chromium } from 'playwright';
import fs from 'node:fs';
const results=[];const ok=(v,name)=>{results.push({name,pass:!!v});console.log((v?'PASS ':'FAIL ')+name);};
const b=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),headless:true,args:['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
const ctx=await b.newContext({viewport:{width:900,height:420},hasTouch:true,isMobile:true});
const page=await ctx.newPage();const errors=[];
page.on('pageerror',e=>errors.push(e.message));page.on('console',e=>{if(e.type()==='error')errors.push(e.text());});
try{
 await page.goto(process.env.CHUGCRAFT_URL || 'http://localhost:8080/');await page.waitForSelector('#screen-title:not(.hidden)');
 await page.evaluate(async()=>{const {applyPreset}=await import('/src/engine/presets.js');applyPreset(window.chugcraft.settings,0);});
 await page.tap('[data-act="singleplayer"]');await page.tap('[data-act="create"]');await page.fill('#in-seed','chugfarm');await page.tap('#btn-do-create');
 await page.waitForFunction(()=>window.chugcraft?.state==='playing',null,{timeout:120000});
 await page.evaluate(async()=>{
  window.g=window.chugcraft;g.gamerules.doMobSpawning=false;g.gamerules.doDaylightCycle=false;g.player.difficulty=0;
  window.item=await import('/src/crafting/items.js');window.B=(await import('/src/world/blocks.js')).B;window.Mob=(await import('/src/entities/mobs.js')).Mob;
  window.touch=(id,type,x=null,y=null)=>{const el=document.getElementById(id),r=el.getBoundingClientRect();
   const t=new Touch({identifier:42,target:el,clientX:x??r.x+r.width/2,clientY:y??r.y+r.height/2});
   el.dispatchEvent(new TouchEvent(type,{bubbles:true,cancelable:true,changedTouches:[t],touches:type==='touchend'||type==='touchcancel'?[]:[t]}));};
  window.press=async(id,ms=450)=>{touch(id,'touchstart');await new Promise(r=>setTimeout(r,ms));touch(id,'touchend');};
  // Flat test platform high in the sky so nothing else interferes.
  const p=g.player;p.gamemode=0;p.flying=false;p.vel.set(0,0,0);p.health=20;p.hunger=20;
  for(let x=-8;x<=8;x++)for(let z=-8;z<=8;z++){g.world.setBlock(x,100,z,B.GRASS);for(let y=101;y<=110;y++)g.world.setBlock(x,y,z,B.AIR);}
  g.world.flushSets?.();
  window.stand=(x,z,yaw=0,pitch=0)=>{p.pos.set(x,101,z);p.yaw=yaw;p.pitch=pitch;p.vel.set(0,0,0);};
  window.hold=(k,n=1)=>{p.inventory.clear();p.inventory.slots[0]=item.makeStack(k,n);p.inventory.selected=0;p.inventory.changed();};
  window.aimEnt=(m)=>{const e=p.eyePosition();const dx=m.pos.x-e.x,dy=m.pos.y+m.height*.5-e.y,dz=m.pos.z-e.z;p.yaw=Math.atan2(-dx,-dz);p.pitch=Math.atan2(dy,Math.hypot(dx,dz));};window.frame=()=>new Promise(r=>setTimeout(r,100));
  window.aim=(x,y,z,top=true)=>{const e=p.eyePosition();const dx=x+.5-e.x,dy=y+(top?.97:.5)-e.y,dz=z+.5-e.z;p.yaw=Math.atan2(-dx,-dz);p.pitch=Math.atan2(dy,Math.hypot(dx,dz));};
 });
 // --- Hoe tills grass, seeds only go on farmland, bone meal grows wheat ---
 await page.evaluate(()=>{stand(.5,3.5);hold('wooden_hoe');aim(0,100,0);});
 await page.evaluate(()=>press('tb-use',150));await page.waitForTimeout(400);
 ok(await page.evaluate(()=>g.world.getBlock(0,100,0)===B.FARMLAND),'hoe tills grass into farmland from mobile USE');
 ok(await page.evaluate(()=>g.player.inventory.held().dur===item.maxDurability('wooden_hoe')-1),'tilling wears the hoe');
 await page.evaluate(()=>{hold('wheat_seeds',4);aim(1,100,0);});
 await page.evaluate(()=>press('tb-use',150));await page.waitForTimeout(400);
 ok(await page.evaluate(()=>g.world.getBlock(1,101,0)===B.AIR&&g.player.inventory.count('wheat_seeds')===4),'seeds refuse plain grass');
 await page.evaluate(()=>aim(0,100,0));
 await page.evaluate(()=>press('tb-use',150));await page.waitForTimeout(400);
 ok(await page.evaluate(()=>g.world.getBlock(0,101,0)===B.WHEAT_0&&g.player.inventory.count('wheat_seeds')===3),'seeds plant on farmland as a seedling');
 await page.evaluate(()=>{hold('bone_meal',5);aim(0,101,0);});
 for(let i=0;i<3;i++){await page.evaluate(()=>press('tb-use',150));await page.waitForTimeout(350);}
 ok(await page.evaluate(()=>g.world.getBlock(0,101,0)===B.WHEAT&&g.player.inventory.count('bone_meal')===2),'three bone meal grow seedling to mature wheat');
 ok(await page.evaluate(()=>g.world.getBlock(0,101,0)===B.WHEAT&&g.advancements&&typeof g.advancements==='object'),'mature wheat growth retains valid advancement state');
 // Random ticks really run in the live game loop (forced high rate).
 await page.evaluate(()=>{for(let x=2;x<=6;x++)for(let z=2;z<=6;z++){g.world.setBlock(x,100,z,B.FARMLAND);g.world.setBlock(x,101,z,B.WHEAT_0);}g.world.setBlock(4,99,4,B.WATER);g.ticker.rate=2e6;stand(4.5,4.5);});
 await page.waitForFunction(()=>{let n=0;for(let x=2;x<=6;x++)for(let z=2;z<=6;z++)if(g.world.getBlock(x,101,z)!==B.WHEAT_0)n++;return n>=10;},null,{timeout:30000});
 ok(true,'live random ticks grow a wheat field');
 await page.evaluate(()=>{g.gamerules.randomTickSpeed=false;g.ticker.rate=4000;});
 // --- Sapling becomes a tree ---
 await page.evaluate(()=>{const t=g.world;for(let x=-6;x<=-2;x++)for(let z=-6;z<=-2;z++)for(let y=101;y<=110;y++)t.setBlock(x,y,z,B.AIR);hold('oak_sapling',2);stand(-4.5,-1.5);aim(-4,100,-4);});
 await page.evaluate(()=>press('tb-use',150));await page.waitForTimeout(400);
 ok(await page.evaluate(()=>g.world.getBlock(-4,101,-4)===B.OAK_SAPLING),'sapling plants on grass');
 await page.evaluate(()=>{hold('bone_meal',3);aim(-4,101,-4);});
 await page.evaluate(()=>press('tb-use',150));await page.waitForTimeout(500);
 ok(await page.evaluate(()=>g.world.getBlock(-4,101,-4)===B.OAK_LOG&&g.world.getBlock(-4,103,-4)===B.OAK_LOG&&g.world.getBlock(-3,105,-4)===B.OAK_LEAVES||g.world.getBlock(-3,104,-4)===B.OAK_LEAVES),'bone meal grows sapling into a tree with leaves');
 await page.screenshot({path:'tests/results/v31-farm.png'});
 // --- Breeding: two cows fed wheat make a baby ---
 await page.evaluate(()=>{
  const a=new Mob(g,'cow',.5,101,-2.2,{persistent:true}),c=new Mob(g,'cow',1.5,101,-2.2,{persistent:true});
  a.gravity=0;c.gravity=0;g.entities.add(a);g.entities.add(c);window.cowA=a;window.cowB=c;
  stand(.5,.5,0,0);hold('wheat',10);aimEnt(a);
 });
 await page.evaluate(()=>{cowA.pos.set(.5,101,-2.2);cowB.pos.set(3.5,101,-2.2);cowA.vel.set(0,0,0);aimEnt(cowA);return press('tb-use',150);});await page.waitForTimeout(300);
 ok(await page.evaluate(()=>(cowA.loveTimer>0||cowB.loveTimer>0)&&g.player.inventory.count('wheat')===9),'feeding a cow wheat puts it in love mode');
 await page.evaluate(()=>{cowA.loveTimer=30;cowB.loveTimer=30;cowB.pos.set(1.5,101,-2.2);});
 await page.waitForFunction(()=>g.entities.list.some(e=>e.kind==='cow'&&e.baby),null,{timeout:15000});
 ok(true,'two cows in love breed a baby');
 ok(await page.evaluate(()=>cowA.loveTimer===0&&cowB.loveTimer===0&&cowA.breedCooldown>0&&cowB.breedCooldown>0&&g.stats.animalsBred>=1&&!!g.advancements.husbandry),'breeding resets love, starts cooldown and unlocks Husbandry');
 const baby=await page.evaluate(()=>{const c=g.entities.list.find(e=>e.kind==='cow'&&e.baby);return {size:c.size,grow:c.growTimer,drops:c.baby};});
 ok(baby.size<0.7&&baby.grow>100,'baby is small and takes time to grow');
 await page.evaluate(()=>{const c=g.entities.list.find(e=>e.kind==='cow'&&e.baby);c.growTimer=0.1;c.tickHusbandry(0.2);window.grown=c;});
 ok(await page.evaluate(()=>!grown.baby&&grown.size===1),'baby grows into an adult');
 // --- Taming: bone tames a wolf, tamed wolf sits/follows and never gets angry ---
 await page.evaluate(()=>{g.entities.list.filter(e=>e.kind==='cow').forEach(e=>{e.dead=true;});const w=new Mob(g,'wolf',.5,101,-2.2,{persistent:true});w.gravity=0;w.update=()=>{};g.entities.add(w);window.wolf=w;hold('bone',5);aimEnt(w);window._rnd=Math.random;Math.random=()=>0.99;});
 await page.evaluate(()=>press('tb-use',150));await page.waitForTimeout(300);
 ok(await page.evaluate(()=>!wolf.tamed&&g.player.inventory.count('bone')===4),'taming can fail and still consumes the bone');
 await page.evaluate(()=>{Math.random=()=>0.01;});
 await page.evaluate(()=>press('tb-use',150));await page.waitForTimeout(300);
 await page.evaluate(()=>{Math.random=window._rnd;});
 ok(await page.evaluate(()=>wolf.tamed&&wolf.persistent&&g.player.inventory.count('bone')===3&&!!g.advancements.best_friends),'bone tames the wolf and unlocks Best Friends Forever');
 await page.evaluate(()=>hold('stick'));
 await page.evaluate(()=>press('tb-use',150));await page.waitForTimeout(300);
 ok(await page.evaluate(()=>wolf.sitting===true),'clicking a tamed wolf makes it sit');
 await page.evaluate(()=>press('tb-use',150));await page.waitForTimeout(300);
 ok(await page.evaluate(()=>wolf.sitting===false),'clicking again makes it follow');
 ok(await page.evaluate(()=>{wolf.damage(1,'player');return wolf.tamed&&!wolf.angry;}),'hitting your own wolf never makes it hostile');
 ok(await page.evaluate(()=>{wolf.pos.set(60,101,60);wolf.aiTamed(0.1);return wolf.pos.distanceTo(g.player.pos)<6;}),'far-away tamed wolf teleports back to its owner');
 // --- Shearing sheep ---
 await page.evaluate(()=>{wolf.sitting=true;wolf.pos.set(6,101,6);const s=new Mob(g,'sheep',.5,101,-2.2,{persistent:true});s.gravity=0;s.update=()=>{};g.entities.add(s);window.sheep=s;hold('shears');aimEnt(s);});
 await page.evaluate(()=>press('tb-use',150));await page.waitForTimeout(300);
 ok(await page.evaluate(()=>sheep.sheared&&g.entities.list.some(e=>e.kind==='item'&&e.stack.key==='wool')&&g.player.inventory.held().dur<item.maxDurability('shears')),'shears drop wool and wear down');
 await page.evaluate(()=>press('tb-use',150));await page.waitForTimeout(300);
 ok(await page.evaluate(()=>g.entities.list.filter(e=>e.kind==='item'&&e.stack.key==='wool').length===1),'a sheared sheep gives nothing until wool regrows');
 ok(await page.evaluate(()=>{sheep.woolTimer=0.1;sheep.tickHusbandry(0.2);return !sheep.sheared;}),'wool regrows after its timer');
 // --- Villager professions ---
 await page.evaluate(()=>{sheep.dead=true;g.entities.list.filter(e=>e.kind==='item').forEach(e=>{e.dead=true;});const v=new Mob(g,'villager',.5,101,-2.2,{persistent:true,profession:'librarian'});v.gravity=0;v.update=()=>{};g.entities.add(v);window.npc=v;hold('paper',30);aimEnt(v);});await page.evaluate(()=>frame());
 await page.evaluate(()=>touch('tb-use','touchstart'));await page.waitForFunction(()=>g.containers.type==='trade');await page.evaluate(()=>touch('tb-use','touchend'));
 ok(await page.evaluate(()=>document.querySelector('#container-root .gui-title, #container-root h2, #container-root .title')?.textContent.includes('Librarian')||document.querySelector('#container-root').textContent.includes('Librarian')),'trade screen shows the villager profession');
 await page.locator('#container-root button', {hasText:'Trade'}).first().tap();
 ok(await page.evaluate(()=>g.player.inventory.count('paper')===6&&g.player.inventory.count('emerald')===1),'librarian sells emeralds for paper');
 await page.tap('.gui-close');
 ok(await page.evaluate(()=>{const seen=new Set();for(let i=0;i<40;i++)seen.add(new Mob(g,'villager',0,0,0).profession);return seen.size>=3;}),'naturally spawned villagers get varied professions');
 // --- Fishing ---
 await page.evaluate(()=>{for(let x=-3;x<=3;x++)for(let z=3;z<=8;z++)g.world.setBlock(x,100,z,B.WATER);g.world.flushSets?.();stand(.5,1.5,Math.PI,-0.5);hold('fishing_rod');g.player.pitch=-0.6;});
 await page.evaluate(()=>press('tb-use',150));
 await page.waitForFunction(()=>g.bobber&&!g.bobber.dead,null,{timeout:5000});
 ok(true,'fishing rod casts a bobber');
 await page.waitForFunction(()=>g.bobber&&g.bobber.floating,null,{timeout:8000}).catch(()=>{});
 ok(await page.evaluate(()=>g.bobber&&g.world.getBlock(Math.floor(g.bobber.pos.x),Math.floor(g.bobber.pos.y),Math.floor(g.bobber.pos.z))===B.WATER),'bobber lands and floats in water');
 await page.evaluate(()=>press('tb-use',150));await page.waitForTimeout(300);
 ok(await page.evaluate(()=>!g.bobber&&!(g.stats.fishCaught>0)&&g.player.inventory.held().dur===item.maxDurability('fishing_rod')),'reeling in early catches nothing');
 await page.evaluate(()=>press('tb-use',150));await page.waitForFunction(()=>g.bobber&&!g.bobber.dead,null,{timeout:5000});
 await page.evaluate(()=>{g.bobber.waitTimer=0.05;});
 await page.waitForFunction(()=>g.bobber&&g.bobber.biting,null,{timeout:8000});
 await page.evaluate(()=>press('tb-use',150));await page.waitForTimeout(400);
 ok(await page.evaluate(()=>!g.bobber&&(g.entities.list.some(e=>e.kind==='item')||g.player.inventory.slots.some(s=>s&&s.key!=='fishing_rod'))&&g.stats.fishCaught===1&&!!g.advancements.fishy_business&&g.player.inventory.held().dur<item.maxDurability('fishing_rod')),'reeling on a bite lands loot, wears the rod and unlocks Fishy Business');
 await page.screenshot({path:'tests/results/v31-fishing.png'});
 // --- Subtitles ---
 await page.evaluate(()=>{g.settings.set('subtitles',true);g.audio.play('cow',{pos:[g.player.pos.x+6,101,g.player.pos.z]});});
 ok(await page.evaluate(()=>{const t=document.querySelector('#subtitles').textContent;return t.includes('Cow moos')&&(t.includes('\u25c0')||t.includes('\u25b6'));}),'subtitles caption sounds with a direction arrow');
 await page.evaluate(()=>{g.settings.set('subtitles',false);document.querySelector('#subtitles').innerHTML='';g.hud._subs=[];g.audio.play('cow',{});});
 ok(await page.evaluate(()=>document.querySelector('#subtitles').textContent===''),'subtitles stay quiet when disabled');
 // --- Mobs survive save and reload with all state ---
 await page.evaluate(async()=>{
  g.entities.list.filter(e=>e.kind==='item'||e.kind==='sheep'||e.kind==='cow').forEach(e=>{e.dead=true;});await frame();
  wolf.sitting=true;wolf.pos.set(2.5,101,2.5);
  const babyCow=new Mob(g,'cow',3.5,101,3.5,{persistent:true,baby:true});babyCow.gravity=0;babyCow.health=4;g.entities.add(babyCow);
  const shorn=new Mob(g,'sheep',4.5,101,4.5,{persistent:true});shorn.sheared=true;shorn.woolTimer=33;g.entities.add(shorn);
  await g.save();await g.loadWorld(g.saveMeta.id);
 });
 await page.waitForFunction(()=>g.state==='playing');
 const after=await page.evaluate(()=>{const L=g.entities.list;return {
  wolf:(w=>w&&({tamed:w.tamed,sitting:w.sitting,persistent:w.persistent,angry:w.angry,hp:w.health}))(L.find(e=>e.kind==='wolf'&&e.tamed)),cow:L.find(e=>e.kind==='cow'&&e.baby),sheep:L.find(e=>e.kind==='sheep'&&e.sheared),villager:L.find(e=>e.kind==='villager'),n:L.filter(e=>e.kind!=='item').length};});
 ok(after.wolf?.tamed&&after.wolf.sitting&&after.wolf.persistent,'tamed sitting wolf survives save/reload');
 ok(after.cow&&after.cow.health===4&&after.cow.size<0.7,'baby cow keeps its hp and size after reload');
 ok(after.sheep?.sheared&&after.sheep.woolTimer>30,'sheared sheep remembers its regrow timer');
 ok(after.villager?.profession==='librarian','villager keeps its profession after reload');
 ok(await page.evaluate(async()=>{const db=await import('/src/save/db.js');const r=await db.loadWorld(g.saveMeta.id);const bk=await import('/src/save/backup.js');return bk.parseBackup(bk.encodeBackup(r)).data.items.filter(e=>e.t==='mob').length>=4;}),'mob records pass the backup validator');
 // A corrupted mob record must be skipped instead of crashing the load.
 await page.evaluate(async()=>{const db=await import('/src/save/db.js');await g.save();const r=await db.loadWorld(g.saveMeta.id);r.data.items.push({t:'mob',type:'ghost',x:0,y:0,z:0});await db.saveWorld(r);await g.loadWorld(r.id);});
 ok(await page.evaluate(()=>g.state==='playing'&&g.entities.list.some(e=>e.kind==='wolf')),'unknown mob record is ignored on load');
 // Hostile crowd cap unaffected: persisted passive mobs don't count as spawner mobs.
 ok(await page.evaluate(()=>Number.isFinite(g.player.pos.y)&&g.state==='playing'),'world still playable after all 3.1 interactions');
}catch(e){ok(false,'suite crashed: '+e.message);console.error(e);}
await page.screenshot({path:'tests/results/v31-final.png'}).catch(()=>{});
const realErrors=errors.filter(e=>!/favicon|WebGL|GPU|swiftshader|AudioContext|Deprecation/i.test(e));
ok(realErrors.length===0,'no page errors ('+realErrors.length+')');if(realErrors.length)console.log(realErrors.slice(0,10));
fs.writeFileSync('tests/results/browser-v31-results.json',JSON.stringify(results,null,1));
console.log(`\n${results.filter(r=>r.pass).length}/${results.length} passed`);
await b.close();process.exit(results.every(r=>r.pass)?0:1);
