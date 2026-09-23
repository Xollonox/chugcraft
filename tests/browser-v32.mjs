import {chromium} from 'playwright';import fs from 'node:fs';import path from 'node:path';
const OUT=path.resolve('test-output/v32');fs.mkdirSync(OUT,{recursive:true});
const checks=[],errors=[];function ok(v,name){checks.push({name,pass:!!v});console.log((v?'PASS ':'FAIL ')+name);}
const browser=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),headless:true,args:['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
const page=await (await browser.newContext({viewport:{width:960,height:540},hasTouch:true,isMobile:true})).newPage();
page.on('pageerror',e=>errors.push(e.message));page.on('console',e=>{if(e.type()==='error')errors.push(e.text());});
async function use(){await page.tap('#tb-use');await page.waitForTimeout(200);}
try{
 await page.goto(process.env.CHUGCRAFT_URL||'http://localhost:8080/');await page.waitForSelector('#screen-title:not(.hidden)');
 await page.evaluate(async()=>{const {applyPreset}=await import('/src/engine/presets.js');applyPreset(window.chugcraft.settings,0);});
 await page.tap('[data-act="singleplayer"]');await page.tap('[data-act="create"]');await page.fill('#in-seed','moonlit-cottage');await page.tap('#btn-do-create');await page.waitForFunction(()=>window.chugcraft?.state==='playing',null,{timeout:120000});
 await page.evaluate(async()=>{
  window.g=window.chugcraft;window.reg=await import('/src/world/blocks.js');window.B=reg.B;window.it=await import('/src/crafting/items.js');window.shapes=await import('/src/world/shapes.js');
  g.gamerules.doMobSpawning=false;g.gamerules.randomTickSpeed=false;g.gamerules.doDaylightCycle=false;g.gamerules.doWeatherCycle=false;g.player.difficulty=0;g.player.gamemode=1;g.player.flying=true;g.player.pos.set(.5,92,10.5);g.player.vel.set(0,0,0);
  g.world.fluids.enabled=false;
  for(let x=-12;x<=12;x++)for(let z=-12;z<=12;z++){g.world.setBlock(x,90,z,B.STONE);for(let y=91;y<=104;y++)g.world.setBlock(x,y,z,B.AIR);}
  // Basins for water and lava prevent giant natural fixtures affecting timing.
  for(const cx of [-6,6])for(let x=cx-3;x<=cx+3;x++)for(let z=-6;z<=0;z++)if(x===cx-3||x===cx+3||z===-6||z===0)g.world.setBlock(x,91,z,B.STONE_BRICKS);
  g.world.flushSets();g.world.fluids.reset();g.world.fluids.enabled=true;
  window.hold=(key,count=1)=>{g.player.inventory.clear();g.player.inventory.selected=0;g.player.inventory.slots[0]=it.makeStack(key,count);g.player.inventory.changed();};
  window.stand=(x,y,z)=>{g.player.pos.set(x,y,z);g.player.vel.set(0,0,0);};
  window.aim=(x,y,z)=>{const p=g.player,e=p.eyePosition(),dx=x-e.x,dy=y-e.y,dz=z-e.z;p.yaw=Math.atan2(-dx,-dz);p.pitch=Math.atan2(dy,Math.hypot(dx,dz));};
 });
 ok(await page.evaluate(()=>g.settings.get('nightVisibility')===.75),'readable nights enabled by default');
 // Night lift stays independent from simulation sunlight and leaves day alone.
 const lights=await page.evaluate(()=>{const r=[];for(const t of [.25,.75])for(const v of [0,.75,1]){g.settings.set('nightVisibility',v);g.sky.update(0,g.renderer.camera,t,0);r.push({t,v,sun:g.renderer.uniforms.uSun.value,ambient:g.renderer.uniforms.uAmbient.value,gamma:g.renderer.uniforms.uNightGamma.value,game:g.sky.sunLight});}return r;});
 ok(lights[4].sun>lights[3].sun*3&&lights[4].ambient>lights[3].ambient*2&&lights[4].gamma>.3&&lights[3].gamma===0,'default night lighting is visibly stronger than original');
 ok(lights[0].sun===lights[2].sun&&lights[0].ambient===lights[2].ambient,'night control does not brighten daytime');
 ok(lights[3].game===lights[5].game,'visibility setting does not change gameplay sunlight');
 // Native mobile bucket use; survival resources measured without creative exceptions.
 await page.evaluate(()=>{stand(-5.5,92,1.5);hold('water_bucket');aim(-5.5,90.99,-2.5);});await page.waitForTimeout(300);await use();
 await page.waitForFunction(()=>reg.isWater(g.world.getBlock(-6,91,-3)),null,{timeout:15000});
 ok(await page.evaluate(()=>g.world.getBlock(-6,91,-3)===B.WATER),'mobile USE places water source');
 await page.waitForFunction(()=>reg.isWater(g.world.getBlock(-5,91,-3)),null,{timeout:15000});
 ok(await page.evaluate(()=>g.world.getBlock(-5,91,-3)!==B.WATER),'placed water really spreads into levelled flow');
 ok(await page.evaluate(()=>g.world.getBlock(-2,91,-3)===B.AIR),'basin walls contain flowing water');
 await page.evaluate(()=>{hold('bucket');aim(-5.5,91.2,-2.5);});await page.waitForTimeout(300);await use();
 ok(await page.evaluate(()=>g.player.inventory.held()?.key==='water_bucket'),'empty bucket can select and pick up the source');
 await page.waitForFunction(()=>{for(let x=-8;x<=-4;x++)for(let z=-5;z<=-1;z++)if(reg.isWater(g.world.getBlock(x,91,z)))return false;return true;},null,{timeout:45000});
 ok(true,'source pickup drains the pool instead of leaving permanent flow');
 await page.evaluate(()=>{stand(6.5,92,1.5);hold('lava_bucket');aim(6.5,90.99,-2.5);});await page.waitForTimeout(300);await use();
 await page.waitForFunction(()=>reg.isLava(g.world.getBlock(7,91,-3)),null,{timeout:20000});
 ok(true,'placed lava spreads in the live game');
 await page.evaluate(()=>g.world.setBlock(5,91,-3,B.WATER));
 await page.waitForFunction(()=>g.world.getBlock(6,91,-3)===B.OBSIDIAN,null,{timeout:20000});ok(true,'water/lava source contact creates obsidian');
 // Model/environment consistency for flowing liquids.
 ok(await page.evaluate(()=>{g.world.setBlock(0,96,0,reg.flowId(1,4));stand(.5,96,.5);g.player._sampleEnvironment();return g.player.inWater&&!g.player.headInWater;}),'flowing shallow water wets feet but not the head');
 ok(await page.evaluate(()=>{g.world.setBlock(0,96,0,reg.flowId(2,2));g.player._sampleEnvironment();return g.player.inLava;}),'flowing lava is treated as lava by player physics');
 await page.evaluate(()=>{g.world.setBlock(0,96,0,B.AIR);stand(.5,91,6.5);});
 // Door placement is through the normal player entry point, toggle via native touch.
 for(const key of ['oak_door','birch_door','spruce_door']){
  await page.evaluate(key=>{g.world.setBlock(0,91,3,B.AIR);g.world.setBlock(0,92,3,B.AIR);stand(.5,91,6.5);hold(key);g.lookHit={x:0,y:90,z:3,nx:0,ny:1,nz:0,id:B.STONE};g.player.yaw=0;g.placeBlock(it.getItem(key));aim(.5,91.65,3.05);},key);
  await page.waitForTimeout(400);
  ok(await page.evaluate(key=>{const id=g.world.getBlock(0,91,3);return reg.IS_DOOR[id]&&reg.BLOCKS[id].itemKey===key&&g.world.getBlock(0,92,3)===id;},key),key+' places as two matching halves');
  await use();
  ok(await page.evaluate(()=>{const id=g.world.getBlock(0,91,3);return reg.DOORS[id]?.open&&g.world.getBlock(0,92,3)===id;}),key+' opens both halves with mobile USE');
  await use();
  ok(await page.evaluate(()=>!reg.DOORS[g.world.getBlock(0,91,3)]?.open),key+' closes with mobile USE');
 }
 for(const key of ['oak_gate','oak_trapdoor']){
  await page.evaluate(key=>{g.world.setBlock(0,91,3,B.AIR);g.world.setBlock(0,92,3,B.AIR);hold(key);g.lookHit={x:0,y:90,z:3,nx:0,ny:1,nz:0,id:B.STONE};g.player.yaw=0;g.placeBlock(it.getItem(key));aim(.5,key==='oak_gate'?91.5:91.1,3.5);},key);
  await page.waitForTimeout(400);await use();
  ok(await page.evaluate(()=>reg.HINGES[g.world.getBlock(0,91,3)]?.open),key+' opens via mobile USE');
 }
 // Thin geometry collision test: side empty space is traversable, panel is not.
 ok(await page.evaluate(()=>{g.world.setBlock(0,95,0,B.BIRCH_DOOR);return !g.player._blockedBy({x0:.2,x1:.8,y0:95.1,y1:95.8,z0:.4,z1:.9})&&g.player._blockedBy({x0:.2,x1:.8,y0:95.1,y1:95.8,z0:.01,z1:.15});}),'closed doors collide with panels, not invisible full cubes');
 ok(await page.evaluate(()=>{g.world.setBlock(0,95,0,B.GLASS_PANE);g.world.setBlock(-1,95,0,B.STONE);g.world.setBlock(1,95,0,B.STONE);const boxes=shapes.collisionBoxes(g.world,0,95,0);return boxes.length===3&&boxes.every(b=>b[5]-b[2]===.125); }),'connected windows use thin collision matching the mesh');
 // Build an original showcase cottage: tinted windows, lanterns, mosaic path,
 // a source-fed fountain and an enclosed lava exhibit. Export as a demo world.
 await page.evaluate(()=>{
  g.world.fluids.enabled=false;
  for(let x=-12;x<=12;x++)for(let z=-12;z<=12;z++){
   g.world.setBlock(x,90,z,B.GRASS);for(let y=91;y<=104;y++)g.world.setBlock(x,y,z,B.AIR);
  }
  for(let x=-4;x<=4;x++)for(let z=-6;z<=0;z++){
   g.world.setBlock(x,90,z,B.BASALT_TILES);
   for(let y=91;y<=94;y++)if(x===-4||x===4||z===-6||z===0)g.world.setBlock(x,y,z,B.BIRCH_PLANKS);
   g.world.setBlock(x,95,z,B.SPRUCE_PLANKS);
  }
  for(let x=-5;x<=5;x++)for(let z=-7;z<=1;z++)if(x===-5||x===5||z===-7||z===1)g.world.setBlock(x,95,z,B.SLAB_SPRUCE);
  g.world.setBlock(0,91,0,B.SPRUCE_DOOR);g.world.setBlock(0,92,0,B.SPRUCE_DOOR);
  for(const [x,id] of [[-3,B.BLUE_GLASS_PANE],[-2,B.BLUE_GLASS_PANE],[2,B.AMBER_GLASS_PANE],[3,B.AMBER_GLASS_PANE]])for(let y=92;y<=93;y++)g.world.setBlock(x,y,0,id);
  for(let z=-4;z<=-2;z++)for(let y=92;y<=93;y++)g.world.setBlock(4,y,z,B.ROSE_GLASS_PANE);
  for(let z=1;z<=11;z++){g.world.setBlock(0,90,z,B.MOSAIC);g.world.setBlock(-1,90,z,B.BASALT_TILES);g.world.setBlock(1,90,z,B.BASALT_TILES);}
  for(const x of [-5,5])for(let z=3;z<=9;z++)g.world.setBlock(x,91,z,B.OAK_FENCE);
  for(const z of [3,9])for(let x=-5;x<=5;x++)g.world.setBlock(x,91,z,B.OAK_FENCE);
  for(const z of [3,9])g.world.setBlock(0,91,z,B.OAK_GATE);
  for(const x of [-5,5])for(const z of [3,9])g.world.setBlock(x,92,z,B.LANTERN);
  g.world.setBlock(-3,93,-3,B.LANTERN);g.world.setBlock(3,93,-3,B.LANTERN);
  g.world.setBlock(-2,91,-4,B.CRAFTING_TABLE);g.world.setBlock(2,91,-4,B.CHEST);
  // Fountain on the west: contained pool with a two-block waterfall column.
  for(let x=-11;x<=-7;x++)for(let z=1;z<=5;z++){
   g.world.setBlock(x,90,z,B.STONE_BRICKS);if(x===-11||x===-7||z===1||z===5)g.world.setBlock(x,91,z,B.STONE_BRICKS);
  }
  g.world.setBlock(-9,94,3,B.WATER);
  // Enclosed lava channel to the east, safely separated from the cottage.
  for(let x=7;x<=11;x++)for(let z=1;z<=5;z++){
   g.world.setBlock(x,90,z,B.BASALT_TILES);if(x===7||x===11||z===1||z===5)g.world.setBlock(x,91,z,B.BASALT_TILES);
  }
  g.world.setBlock(9,91,3,B.LAVA);
  g.world.fluids.reset();g.world.fluids.enabled=true;g.world.fluids.schedule(-9,94,3);g.world.fluids.schedule(9,91,3,2);
  g.player.inventory.clear();['water_bucket','lava_bucket','birch_door','glass_pane','oak_fence','oak_gate','oak_trapdoor','lantern','mosaic'].forEach((key,i)=>g.player.inventory.slots[i]=it.makeStack(key,key.includes('bucket')?1:16));g.player.inventory.changed();
  stand(10.5,96,13.5);aim(0,92,-1);g.player.gamemode=1;g.player.flying=true;
  g.time=.25*g.settings.get('dayLength')*60;g.world.flushSets();g.settings.set('nightVisibility',.75);
 });
 await page.waitForTimeout(4000);
 ok(await page.evaluate(()=>g.world.chunks.size>0&&[...g.world.chunks.values()].some(c=>c.meshes.some(m=>m?.geometry?.attributes.position.count>0))),'worker builds all new geometry without errors');
 await page.screenshot({path:path.join(OUT,'cottage-day.png')});
 await page.evaluate(()=>{g.time=.75*g.settings.get('dayLength')*60;g.settings.set('nightVisibility',0);});await page.waitForTimeout(500);
 await page.screenshot({path:path.join(OUT,'night-original.png')});
 await page.evaluate(()=>g.settings.set('nightVisibility',.75));await page.waitForTimeout(500);
 await page.screenshot({path:path.join(OUT,'night-readable.png')});
 const packs=[];
 for(let i=0;i<4;i++){
  await page.evaluate(i=>g.settings.set('shaderPack',i),i);await page.waitForTimeout(250);
  packs.push(await page.evaluate(()=>g.renderer.uniforms.uSun.value>.45&&g.settings.get('nightVisibility')===.75));
 }
 ok(packs.every(Boolean),'night visibility survives all three shader packs and vanilla');
 await page.evaluate(()=>{g.settings.set('shaderPack',0);g.world.setBlock(0,96,0,B.AIR);g.world.setBlock(-1,95,0,B.AIR);g.world.setBlock(1,95,0,B.AIR);g.time=.25*g.settings.get('dayLength')*60;});
 await page.evaluate(async()=>{await g.save();const db=await import('/src/save/db.js');const bk=await import('/src/save/backup.js');const r=await db.loadWorld(g.saveMeta.id);r.name='Moonlit Cottage — ChugCraft 3.2';r.gamemode=1;r.data.player.gamemode=1;window.demoText=bk.encodeBackup(r);window.demoID=r.id;});
 fs.writeFileSync(path.join(OUT,'Moonlit-Cottage.chugcraft.json'),await page.evaluate(()=>window.demoText));
 ok(await page.evaluate(()=>JSON.parse(demoText).world.data.world[0].chunkEdits.length>0),'showcase world exports through the backup validator');
 await page.evaluate(async()=>{await g.loadWorld(demoID);});await page.waitForFunction(()=>g.state==='playing',null,{timeout:120000});
 ok(await page.evaluate(()=>g.world.getBlock(-3,92,0)===B.BLUE_GLASS_PANE&&g.world.getBlock(0,91,0)===B.SPRUCE_DOOR),'new building blocks and door material survive reload');
 ok(await page.evaluate(()=>g.world.getBlock(-9,94,3)===B.WATER&&g.world.getBlock(-9,93,3)===B.WATER_FALL),'fountain source and waterfall levels survive reload');
 ok(await page.evaluate(()=>g.settings.get('nightVisibility')===.75),'night visibility setting persists across world reload');
 // Frame-based soak uses actual scheduler, with capped per-frame fluid work.
 await page.evaluate(()=>{g.player.gamemode=1;g.player.flying=true;g.player.pos.y=98;});
 for(let i=0;i<8;i++){await page.evaluate(i=>{g.world.setBlock(-9,94,3,i%2?B.WATER:B.AIR);g.openContainer('inventory');g.containers.close();g.pause();g.resume();},i);await page.waitForTimeout(200);}
 ok(await page.evaluate(()=>g.state==='playing'&&Number.isFinite(g.player.pos.y)&&g.world.fluids.queue.size<20000),'repeated source/menu changes remain playable with bounded work');

}catch(e){ok(false,'suite crashed: '+e.message);console.error(e.stack);}
await page.screenshot({path:path.join(OUT,'final.png')}).catch(()=>{});
ok(errors.length===0,'no browser runtime/console errors');if(errors.length)console.log(errors);
fs.writeFileSync(path.join(OUT,'results.json'),JSON.stringify({checks,errors},null,2));console.log(`RESULT ${checks.filter(x=>x.pass).length}/${checks.length}`);await browser.close();process.exit(checks.every(x=>x.pass)?0:1);
