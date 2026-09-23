// Local, bounded cellular fluid simulation. Levels live in block IDs, so old
// world saves, workers and chunk deltas need no extra metadata or migration.
import {B,BLOCKS,FLUID,FLOW_LEVEL,flowId} from './blocks.js';
import {CHUNK_Y,idx} from '../constants.js';
const SIDE=[[1,0,0],[-1,0,0],[0,0,1],[0,0,-1]];
const NEAR=[[0,0,0],[0,1,0],[0,-1,0],...SIDE];
const key=(x,y,z)=>`${x},${y},${z}`;
export const fluidDelay=kind=>kind===2?.8:.2;
export const fluidRange=kind=>kind===2?3:7;
export class FluidSimulator {
 constructor(world){this.world=world;this.time=0;this.queue=new Map();this.changes=0;this.processed=0;this.maxWork=192;this.enabled=true;}
 reset(){this.queue.clear();this.time=0;}
 loaded(x,y,z){return y>=0&&y<CHUNK_Y&&this.world.isLoaded(x,z);}
 permeable(id){return id===B.AIR||(!FLUID[id]&&BLOCKS[id]?.replaceable);}
 schedule(x,y,z,kind=1){
  if(!this.loaded(x,y,z))return;
  const k=key(x,y,z);if(this.queue.has(k))return;
  // One entry per coordinate, no recursive fill and no catch-up spike.
  this.queue.set(k,{x,y,z,due:this.time+fluidDelay(kind)});
 }
 changed(x,y,z,old,id){
  // A placed wall, a broken floor or a bucket all wake nearby fluids.
  for(const [dx,dy,dz] of NEAR){const X=x+dx,Y=y+dy,Z=z+dz,b=this.world.getBlock(X,Y,Z);
   const k=FLUID[b]||FLUID[old]||FLUID[id];if(k)this.schedule(X,Y,Z,k);
  }
 }
 write(x,y,z,id){
  const old=this.world.getBlock(x,y,z);if(old===id||!this.loaded(x,y,z))return false;
  this.world.setBlock(x,y,z,id);this.changes++;return true;
 }
 sourceCanSpread(x,y,z,id){
  const below=this.world.getBlock(x,y-1,z);
  // Downward priority: streams only fan out when they meet a floor.
  return y===0||(!this.permeable(below)&&!FLUID[below]);
 }
 tick(x,y,z){
  const w=this.world;
  if(!this.loaded(x,y,z))return;
  // Freeze at an unloaded chunk edge instead of deleting unseen supply.
  if(SIDE.some(([dx,,dz])=>!w.isLoaded(x+dx,z+dz)))return;
  let id=w.getBlock(x,y,z),kind=FLUID[id];
  if(kind){
   // Same result whichever fluid was placed first. Sources make obsidian;
   // flowing lava makes cobblestone. Diagonal blocks do not react.
   for(const [dx,dy,dz] of NEAR.slice(1)){
    const X=x+dx,Y=y+dy,Z=z+dz,nb=w.getBlock(X,Y,Z);
    if(FLUID[nb]&&FLUID[nb]!==kind){
     const lx=kind===2?x:X,ly=kind===2?y:Y,lz=kind===2?z:Z, lava=kind===2?id:nb;
     this.write(lx,ly,lz,FLOW_LEVEL[lava]===0?B.OBSIDIAN:B.COBBLESTONE);
     w.onFluidReaction?.(lx,ly,lz);if(kind===2)return;
    }
   }
  }
  id=w.getBlock(x,y,z);kind=FLUID[id];
  if(!kind&&!this.permeable(id))return;
  if(!(kind&&FLOW_LEVEL[id]===0)){
   const above=w.getBlock(x,y+1,z),aboveKind=FLUID[above];
   let next=0;
   if(aboveKind && (!kind||aboveKind===kind))next=flowId(aboveKind,8);
   else {
    let best=99,bestKind=0;
    for(const [dx,,dz] of SIDE){
     const nx=x+dx,nz=z+dz,n=w.getBlock(nx,y,nz),nk=FLUID[n];
     if(!nk||(kind&&nk!==kind)||!this.sourceCanSpread(nx,y,nz,n))continue;
     const level=FLOW_LEVEL[n]===8?0:FLOW_LEVEL[n];
     if(level+1<=fluidRange(nk)&&level<best){best=level;bestKind=nk;}
    }
    if(bestKind)next=flowId(bestKind,best+1);
   }
   if(!next&&!kind)return;
   this.write(x,y,z,next);id=next;kind=FLUID[id];
  }
  if(!kind)return;
  const below=w.getBlock(x,y-1,z);
  if(this.permeable(below))this.schedule(x,y-1,z,kind);
  if(this.sourceCanSpread(x,y,z,id))for(const [dx,,dz] of SIDE){
   const n=w.getBlock(x+dx,y,z+dz);
   if(this.permeable(n)&&(FLOW_LEVEL[id]===8||FLOW_LEVEL[id]<fluidRange(kind)))this.schedule(x+dx,y,z+dz,kind);
  }
 }
 update(dt){
  if(!this.enabled)return;
  this.time+=Math.min(.1,Math.max(0,dt));let work=0;
  // Snapshot prevents work scheduled by this tick from executing immediately.
  for(const [k,e] of this.queue){
   if(e.due>this.time)continue;
   this.queue.delete(k);this.tick(e.x,e.y,e.z);this.processed++;
   if(++work>=this.maxWork)break;
  }
 }
 onChunk(c){
  if(!c?.blocks)return;
  // Resume saved flows and exposed sources only, not every ocean block.
  for(let y=0;y<CHUNK_Y;y++)for(let z=0;z<16;z++)for(let x=0;x<16;x++){
   const id=c.blocks[idx(x,y,z)];if(!FLUID[id])continue;
   const X=c.cx*16+x,Z=c.cz*16+z;
   if(FLOW_LEVEL[id]||NEAR.slice(2).some(([dx,dy,dz])=>{const n=this.world.getBlock(X+dx,y+dy,Z+dz);return this.permeable(n)||(FLUID[n]&&FLUID[n]!==FLUID[id]);}))this.schedule(X,y,Z,FLUID[id]);
  }
  // A newly loaded neighbour may resume a frozen boundary stream.
  for(let y=0;y<CHUNK_Y;y++)for(let i=-1;i<=16;i++)for(const [x,z] of [[-1,i],[16,i],[i,-1],[i,16]]){
   const X=c.cx*16+x,Z=c.cz*16+z,id=this.world.getBlock(X,y,Z);if(FLUID[id])this.schedule(X,y,Z,FLUID[id]);
  }
 }
}
