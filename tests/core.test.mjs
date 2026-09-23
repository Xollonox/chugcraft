import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Inventory } from '../src/player/inventory.js';
import { getItem, makeStack, maxDurability, ITEMS } from '../src/crafting/items.js';
import { RECIPES, matchRecipe, recipeLayout } from '../src/crafting/recipes.js';
import { enchant, repair, brew, bookshelfCount } from '../src/crafting/workshop.js';
import { B, BLOCKS, allTileNames } from '../src/world/blocks.js';
import { PAINTERS, paintTile } from '../src/engine/tiles.js';
import { encodeBackup, parseBackup } from '../src/save/backup.js';
import { fortressLayout } from '../src/world/structures.js';
const player=()=>({inventory:new Inventory(),level:30,spendLevels(n){if(this.level<n)return false;this.level-=n;return true;}});
const fill=inv=>{inv.slots=Array.from({length:36},()=>makeStack('stone',64));};

test('gold nugget conversion conserves material',()=>{
 const r=matchRecipe(Array.from({length:9},()=>makeStack('gold_nugget')),3);
 assert.equal(r.out.count,1);assert.equal(r.out.key,'gold_ingot');
});
test('all recipe outputs and ingredients are registered',()=>{
 for(const r of RECIPES){assert.ok(getItem(r.out.key),r.out.key);
  for(const ing of r.type==='shaped'?Object.values(r.keys):r.ingredients)if(!ing.startsWith('#'))assert.ok(getItem(ing),ing);}
});
test('new stations craft with exact grid patterns',()=>{
 for(const key of ['enchanting_table','anvil','brewing_stand','glass_bottle']){
  const r=RECIPES.find(r=>r.out.key===key);const grid=Array(9).fill(null);
  r.pattern.forEach((row,y)=>[...row].forEach((c,x)=>{if(c!==' ')grid[y*3+x]=makeStack(r.keys[c]);}));
  assert.equal(matchRecipe(grid,3)?.out.key,key);
 }
});
test('failed full-bag exchange is atomic',()=>{
 const inv=new Inventory();fill(inv);inv.slots[0]=makeStack('emerald',12);
 const before=JSON.stringify(inv.serialize());
 assert.equal(inv.transact({emerald:1},[makeStack('diamond')]),false);
 assert.equal(JSON.stringify(inv.serialize()),before);
});
test('exchange can reuse a freed ingredient slot',()=>{
 const inv=new Inventory();fill(inv);inv.slots[0]=makeStack('emerald',1);
 assert.equal(inv.transact({emerald:1},[makeStack('diamond')]),true);assert.equal(inv.count('diamond'),1);
});
test('partial stack capacity detected before crafting',()=>{
 const inv=new Inventory();fill(inv);inv.slots[0]=makeStack('oak_planks',62);
 assert.equal(inv.capacityFor('oak_planks'),2);assert.equal(inv.capacityFor('diamond'),0);
});
test('enchant consumes resources and preserves wear percentage',()=>{
 const p=player();p.inventory.slots[0]=makeStack('diamond_pickaxe');p.inventory.slots[0].dur=780;p.inventory.add('lapis_lazuli',6);
 assert.equal(enchant(p,0,0).ok,true);const s=p.inventory.slots[0];
 assert.equal(s.key,'diamond_pickaxe_ench1');assert.equal(p.level,29);assert.equal(p.inventory.count('lapis_lazuli'),5);
 assert.ok(Math.abs(s.dur/maxDurability(s.key)-780/1561)<0.001);
 assert.ok(getItem(s.key).tool.speed>getItem('diamond_pickaxe').tool.speed);
});
test('higher enchant tiers require shelves, cap at III',()=>{
 const p=player();p.inventory.slots[0]=makeStack('iron_sword');p.inventory.add('lapis_lazuli',9);
 assert.ok(enchant(p,0,0).ok);const before=JSON.stringify(p.inventory.serialize());
 assert.equal(enchant(p,0,0).ok,false);assert.equal(JSON.stringify(p.inventory.serialize()),before);
 assert.ok(enchant(p,0,5).ok);assert.ok(enchant(p,0,10).ok);assert.equal(enchant(p,0,15).ok,false);
 assert.equal(getItem(p.inventory.held().key).tool.damage,getItem('iron_sword').tool.damage+3);
});
test('enchant insufficient levels/resources never modifies equipment',()=>{
 const p=player();p.level=2;p.inventory.slots[0]=makeStack('iron_axe');p.inventory.add('lapis_lazuli',3);
 const s=JSON.stringify(p.inventory.serialize());assert.equal(enchant(p,0,15).ok,false);assert.equal(JSON.stringify(p.inventory.serialize()),s);
 p.level=30;p.inventory.remove('lapis_lazuli',3);assert.equal(enchant(p,0,15).ok,false);assert.equal(p.level,30);
});
test('bookshelf count requires air gap',()=>{
 const w={getBlock:(x,y,z)=>Math.max(Math.abs(x),Math.abs(z))===2?B.BOOKSHELF:B.AIR};
 assert.equal(bookshelfCount(w,[0,0,0]),15);
 assert.equal(bookshelfCount({getBlock:()=>B.BOOKSHELF},[0,0,0]),0);
});
test('repair preserves enchanted key and charges a material+level',()=>{
 const p=player();p.inventory.slots[0]=makeStack('diamond_pickaxe_ench2');p.inventory.slots[0].dur=100;p.inventory.add('diamond',1);
 assert.ok(repair(p,0).ok);assert.equal(p.inventory.held().key,'diamond_pickaxe_ench2');
 assert.equal(p.inventory.held().dur,100+Math.ceil(maxDurability(p.inventory.held().key)/4));
 assert.equal(p.inventory.count('diamond'),0);assert.equal(p.level,29);
});
test('undamaged repairs are refused without costs',()=>{
 const p=player();p.inventory.slots[0]=makeStack('diamond_sword');p.inventory.add('diamond');
 assert.equal(repair(p,0).ok,false);assert.equal(p.inventory.count('diamond'),1);assert.equal(p.level,30);
});
test('brew water into awkward and all five potions',()=>{
 for(let n=1;n<=5;n++){
  const p=player();for(const k of ['water_bottle','nether_wart','blaze_powder','sugar','magma_cream','ghast_tear','glistering_melon'])p.inventory.add(k,k==='blaze_powder'?4:1);
  assert.ok(brew(p,0).ok);assert.ok(brew(p,n).ok);assert.equal(p.inventory.count('awkward_potion'),0);
 }
});
test('brewing with missing ingredients is atomic',()=>{
 const p=player();p.inventory.add('water_bottle');const before=JSON.stringify(p.inventory.serialize());
 assert.equal(brew(p,0).ok,false);assert.equal(JSON.stringify(p.inventory.serialize()),before);
});
test('upgrade keys and durability roundtrip through inventory saves',()=>{
 const inv=new Inventory();inv.slots[0]=makeStack('diamond_chestplate_ench3');inv.slots[0].dur=50;
 inv.add('potion_speed');inv.offhand=makeStack('shield');inv.selected=8;
 const copy=new Inventory();copy.deserialize(JSON.parse(JSON.stringify(inv.serialize())));
 assert.deepEqual(copy.serialize(),inv.serialize());
});
test('invalid selected slot clamps safely',()=>{
 const inv=new Inventory();inv.deserialize({selected:200});assert.equal(inv.selected,8);
 inv.deserialize({selected:NaN});assert.equal(inv.selected,0);
});
test('all block texture references have authored painters',()=>{
 for(const name of allTileNames()){
  const old=console.warn;let warn=false;console.warn=()=>{warn=true;};
  const tile=paintTile(name);console.warn=old;assert.equal(warn,false,name);assert.ok(tile.frames.length);
 }
});
test('fortresses supply nether wart without relying on random loot',()=>{
 const site={x:0,z:0,y:64,seed:123};const layout=fortressLayout(site);
 assert.ok(layout.entities.some(e=>e.items?.some(s=>s.key==='nether_wart')));
});
function record(){return {id:'test',name:'Test',seed:12,gamemode:0,difficulty:2,data:{dim:0,time:60,
 player:{pos:[0.5,65,0.5],yaw:0,pitch:0,health:20,hunger:20,saturation:5,air:300,xp:0,level:0,gamemode:0,difficulty:2,inventory:new Inventory().serialize()},
 world:Array.from({length:3},()=>({chunkEdits:[],be:[],sp:[],po:[]})),items:[]}};}
test('backup roundtrip preserves save data',()=>{const r=record();assert.deepEqual(parseBackup(encodeBackup(r)),r);});
test('malformed backups and invalid block IDs rejected',()=>{
 assert.throws(()=>parseBackup('{}'));const r=record();r.data.world[0].chunkEdits=[['0,0',[0,9999]]];assert.throws(()=>parseBackup(encodeBackup(r)));
});
test('negative counts, unsafe properties and nonfinite positions rejected',()=>{
 const r=record();r.data.player.inventory.slots[0]=['diamond',-1];assert.throws(()=>parseBackup(encodeBackup(r)));
 assert.throws(()=>parseBackup('{"__proto__":{}}'));r.data.player.pos[0]=NaN;assert.throws(()=>parseBackup(encodeBackup(r)));
});
