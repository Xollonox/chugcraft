// Local-only world backups. Never overwrite an existing world during import.
import { loadWorld, saveWorld, newWorldId } from './db.js';
import { getItem, maxDurability } from '../crafting/items.js';
import { BLOCKS, BLOCK_COUNT } from '../world/blocks.js';
const LIMIT=20*1024*1024;
const assert=(v,m)=>{if(!v)throw new Error('Invalid backup: '+m);};
const obj=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
const int=(v,min,max)=>Number.isInteger(v)&&v>=min&&v<=max;
const position=v=>Array.isArray(v)&&v.length===3&&v.every(n=>Number.isFinite(n)&&Math.abs(n)<=30000000);
function stack(s,tuple=false){
 if(s===null)return;
 assert(tuple?Array.isArray(s)&&s.length>=2&&s.length<=3:obj(s),'item stack');
 const key=tuple?s[0]:s.key,count=tuple?s[1]:s.count,dur=tuple?s[2]:s.dur,it=getItem(key);
 assert(it&&int(count,1,it.stack),'unknown item or invalid stack count');
 if(dur!==undefined)assert(Number.isFinite(dur)&&dur>0&&dur<=maxDurability(key),'item durability');
}
export function validateRecord(rec){
 assert(obj(rec)&&typeof rec.name==='string'&&rec.name.length<=128,'world name');
 assert(Number.isFinite(rec.seed),'seed');
 assert(int(rec.gamemode,0,1)&&int(rec.difficulty,0,3),'game mode/difficulty');
 const d=rec.data;assert(obj(d)&&obj(d.player)&&Array.isArray(d.world)&&d.world.length===3,'world data');
 assert(int(d.dim,0,2)&&Number.isFinite(d.time),'dimension/time');
 const p=d.player;assert(position(p.pos),'player position');
 assert(int(p.gamemode,0,1)&&int(p.difficulty,0,3),'player mode');
 for(const k of ['health','hunger','saturation','air','xp','level'])assert(Number.isFinite(p[k])&&p[k]>=0&&p[k]<=1e7,k);
 for(const k of ['yaw','pitch'])assert(Number.isFinite(p[k]),k);
 if(p.spawnPoint!==null&&p.spawnPoint!==undefined)assert(position(p.spawnPoint),'spawn');
 const inv=p.inventory;assert(obj(inv),'inventory');
 for(const [key,n] of [['slots',36],['armor',4],['craft',4]]){assert(Array.isArray(inv[key])&&inv[key].length===n,key);inv[key].forEach(s=>stack(s,true));}
 if(inv.offhand)stack(inv.offhand,true);
 assert(int(inv.selected,0,8),'selected slot');
 for(const dim of d.world){
  assert(obj(dim),'dimension data');
  for(const k of ['chunkEdits','be','sp','po'])assert(Array.isArray(dim[k])&&dim[k].length<=100000,k);
  for(const entry of dim.chunkEdits){
   assert(Array.isArray(entry)&&entry.length===2,'chunk entry');const [k,a]=entry;
   assert(typeof k==='string'&&/^-?\d+,-?\d+$/.test(k)&&Array.isArray(a)&&a.length%2===0&&a.length<=65536,'chunk edits');
   for(let i=0;i<a.length;i+=2)assert(int(a[i],0,32767)&&int(a[i+1],0,BLOCK_COUNT-1)&&(a[i+1]===0||BLOCKS[a[i+1]].id===a[i+1]),'block index/id');
  }
  for(const entries of [dim.be,dim.sp,dim.po])for(const e of entries)assert(Array.isArray(e)&&e.length===2&&typeof e[0]==='string','world entry');
  for(const [key,be] of dim.be){
   assert(/^-?\d+,-?\d+,-?\d+$/.test(key)&&obj(be),'block entity');
   if(be.items!==undefined){assert(Array.isArray(be.items)&&be.items.length<=54,'chest items');be.items.forEach(s=>stack(s));}
   if(be.furnace){const f=be.furnace;assert(obj(f),'furnace');for(const k of ['input','fuel','output'])stack(f[k]);for(const k of ['burn','burnMax','cook','xp'])assert(Number.isFinite(f[k])&&f[k]>=0,'furnace timer');}
  }
 }
 if(d.items){assert(Array.isArray(d.items)&&d.items.length<=10000,'dropped items');for(const e of d.items){assert(obj(e)&&position([e.x,e.y,e.z]),'entity position');if(e.t==='item')stack(e.s);else if(e.t==='mob'){assert(typeof e.type==='string'&&e.type.length<=32,'mob type');if(e.hp!==undefined)assert(Number.isFinite(e.hp),'mob hp');}else if(e.t==='cart'){for(const k of ['vx','vy','vz'])if(e[k]!==undefined)assert(Number.isFinite(e[k]),'cart velocity');}}}
 return rec;
}
export function parseBackup(text){
 assert(typeof text==='string'&&new TextEncoder().encode(text).length<=LIMIT,'file too large (20 MiB max)');
 const envelope=JSON.parse(text,(key,value)=>{
  assert(!['__proto__','constructor','prototype'].includes(key),'unsafe property');
  if(typeof value==='number')assert(Number.isFinite(value),'non-finite number');return value;
 });
 assert(envelope?.format==='chugcraft-world'&&envelope.schema===1,'unsupported file format');
 return validateRecord(envelope.world);
}
export function encodeBackup(rec){return JSON.stringify({format:'chugcraft-world',schema:1,gameVersion:'3.2.0',world:rec});}
export async function exportBackup(id){
 const rec=await loadWorld(id);if(!rec)throw new Error('Save this world first.');
 const blob=new Blob([encodeBackup(rec)],{type:'application/json'}),url=URL.createObjectURL(blob);
 const a=document.createElement('a');a.href=url;a.download=(rec.name.replace(/[^a-z0-9_-]/gi,'_')||'world')+'.chugcraft.json';a.click();
 setTimeout(()=>URL.revokeObjectURL(url),30000);
}
export async function importBackup(file){
 if(file.size>LIMIT)throw new Error('Backup exceeds 20 MiB.');
 const rec=parseBackup(await file.text());
 rec.id=newWorldId();rec.name=(rec.name+' (imported)').slice(0,128);rec.lastPlayed=Date.now();
 await saveWorld(rec);return rec.id;
}
