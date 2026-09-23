// Shared renderer/collision geometry. Coordinates are block-local AABBs.
import {B,BLOCKS,IS_SOLID,IS_DOOR,DOOR_PANEL,HINGES} from './blocks.js';
export const isPane=id=>id>=B.GLASS_PANE&&id<=B.ROSE_GLASS_PANE;
const rotate=b=>[b[2],b[1],b[0],b[5],b[4],b[3]];
export function shapeBoxes(id,get){
 if(IS_DOOR[id])return [DOOR_PANEL[id]?[0,0,0,.1875,1,1]:[0,0,0,1,1,.1875]];
 if(isPane(id)||id===B.OAK_FENCE){
  const pane=isPane(id),a=pane?.4375:.375,b=1-a;
  const joins=[[1,0],[-1,0],[0,1],[0,-1]].map(([x,z])=>{
   const n=get(x,0,z);return pane?(isPane(n)||!!BLOCKS[n]?.solid):(n===id||HINGES[n]?.base===B.OAK_GATE||!!BLOCKS[n]?.opaque);
  });
  if(pane){
   if(!joins.some(Boolean))return [[0,0,a,1,1,b],[a,0,0,b,1,1]];
   const out=[[a,0,a,b,1,b]];
   if(joins[0])out.push([b,0,a,1,1,b]);if(joins[1])out.push([0,0,a,a,1,b]);
   if(joins[2])out.push([a,0,b,b,1,1]);if(joins[3])out.push([a,0,0,b,1,a]);return out;
  }
  const out=[[a,0,a,b,1,b]];
  for(const y of [.35,.72]){
   if(joins[0])out.push([b,y,.4375,1,y+.16,.5625]);if(joins[1])out.push([0,y,.4375,a,y+.16,.5625]);
   if(joins[2])out.push([.4375,y,b,.5625,y+.16,1]);if(joins[3])out.push([.4375,y,0,.5625,y+.16,a]);
  }return out;
 }
 const h=HINGES[id];
 if(h){
  let boxes;
  if(h.base===B.OAK_TRAPDOOR)boxes=h.open?[[0,0,0,1,1,.1875]]:[[0,0,0,1,.1875,1]];
  else boxes=h.open?[[0,0,.375,.1875,1,.625],[.8125,0,.375,1,1,.625]]:
   [[0,0,.375,.1875,1,.625],[.8125,0,.375,1,1,.625],[.1875,.35,.4375,.8125,.51,.5625],[.1875,.72,.4375,.8125,.88,.5625]];
  return h.axis?boxes.map(rotate):boxes;
 }
 if(id===B.LANTERN)return [[.25,.08,.25,.75,.68,.75],[.1875,.06,.1875,.8125,.16,.8125],[.1875,.65,.1875,.8125,.75,.8125],[.43,.75,.43,.57,1,.57]];
 return [[0,0,0,1,BLOCKS[id]?.height??1,1]];
}
export function collisionBoxes(world,x,y,z,id=world.getBlock(x,y,z)){
 if(!IS_SOLID[id])return [];
 const boxes=shapeBoxes(id,(dx,dy,dz)=>world.getBlock(x+dx,y+dy,z+dz));
 return boxes.map(b=>[x+b[0],y+b[1],z+b[2],x+b[3],y+(id===B.OAK_FENCE?1.5:b[4]),z+b[5]]);
}
export function overlaps(a,b,eps=.0001){return a.x1>b[0]+eps&&a.x0<b[3]-eps&&a.y1>b[1]+eps&&a.y0<b[4]-eps&&a.z1>b[2]+eps&&a.z0<b[5]-eps;}
