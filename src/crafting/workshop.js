// ChugCraft's compact, deterministic workshop rules. No DOM dependencies.
import { getItem, makeStack, maxDurability } from './items.js';
import { Inventory } from '../player/inventory.js';
import { B } from '../world/blocks.js';

export const BREWS = [
  {out:'awkward_potion',cost:{water_bottle:1,nether_wart:1,blaze_powder:1}},
  {out:'potion_speed',cost:{awkward_potion:1,sugar:1,blaze_powder:1}},
  {out:'potion_strength',cost:{awkward_potion:1,blaze_powder:2}},
  {out:'potion_fire_resistance',cost:{awkward_potion:1,magma_cream:1,blaze_powder:1}},
  {out:'potion_regeneration',cost:{awkward_potion:1,ghast_tear:1,blaze_powder:1}},
  {out:'potion_healing',cost:{awkward_potion:1,glistering_melon:1,blaze_powder:1}},
];
export function bookshelfCount(world,pos) {
  if(!pos)return 0;
  const [x,y,z]=pos;let n=0;
  for(let dx=-2;dx<=2;dx++)for(let dz=-2;dz<=2;dz++){
    if(Math.max(Math.abs(dx),Math.abs(dz))!==2)continue;
    const ax=x+Math.sign(dx),az=z+Math.sign(dz);
    for(let dy=0;dy<2;dy++)if(world.getBlock(ax,y+dy,az)===B.AIR && world.getBlock(x+dx,y+dy,z+dz)===B.BOOKSHELF)n++;
  }
  return Math.min(15,n);
}
export function enchantOffer(stack,shelves=0){
  const base=getItem(stack?.key), key=base?.upgrade?.base||stack?.key;
  const rank=(base?.upgrade?.rank||0)+1;
  const next=getItem(`${key}_ench${rank}`);
  if(!next)return null;
  return {key:next.key,rank,cost:{lapis_lazuli:rank},levels:rank,requiredLevel:rank*3,shelvesRequired:(rank-1)*5,
    allowedShelves:shelves>=(rank-1)*5};
}
export function repairMaterial(stack){
  const def=getItem(stack?.key),key=def?.upgrade?.base||stack?.key||'';
  if(key.startsWith('diamond_'))return 'diamond';
  if(key.startsWith('iron_')||['shears','flint_and_steel'].includes(key))return 'iron_ingot';
  if(key.startsWith('stone_'))return 'cobblestone';
  if(key.startsWith('wooden_')||key==='shield')return 'oak_planks';
  if(key.startsWith('leather_'))return 'leather';
  if(key==='bow'||key==='fishing_rod')return 'string';
  return null;
}
export function equipment(inv,type){
  return inv.slots.map((s,index)=>({s,index})).filter(({s})=>s &&
    (type==='enchant'?enchantOffer(s)!==null:repairMaterial(s)&&s.dur<maxDurability(s.key)));
}
export function enchant(player,index,shelves){
  const inv=player.inventory, s=inv.slots[index], offer=enchantOffer(s,shelves);
  if(!offer)return {ok:false,message:'Select unmaxed equipment from your bag.'};
  if(!offer.allowedShelves)return {ok:false,message:`Needs ${offer.shelvesRequired} nearby bookshelves with an air gap.`};
  if(player.level<offer.requiredLevel)return {ok:false,message:`Reach level ${offer.requiredLevel} first.`};
  const temp=new Inventory();temp.deserialize(inv.serialize());
  if(!temp.transact(offer.cost))return {ok:false,message:'Not enough lapis lazuli.'};
  const next=makeStack(offer.key);
  next.dur=Math.max(1,Math.floor(maxDurability(next.key)*s.dur/maxDurability(s.key)));
  temp.slots[index]=next;
  player.spendLevels(offer.levels);inv.slots=temp.slots;inv.changed();
  return {ok:true,message:getItem(next.key).desc};
}
export function repair(player,index){
  const inv=player.inventory,s=inv.slots[index],material=repairMaterial(s),max=maxDurability(s?.key);
  if(!s||!material||!max||s.dur>=max)return {ok:false,message:'Select damaged equipment from your bag.'};
  if(player.level<1)return {ok:false,message:'Repairing costs one level.'};
  const temp=new Inventory();temp.deserialize(inv.serialize());
  if(!temp.transact({[material]:1}))return {ok:false,message:`Need 1 ${getItem(material).name}.`};
  temp.slots[index].dur=Math.min(max,s.dur+Math.ceil(max*0.25));
  player.spendLevels(1);inv.slots=temp.slots;inv.changed();
  return {ok:true,message:'Repaired 25% of maximum durability. Enchant tier preserved.'};
}
export function brew(player,index){
  const r=BREWS[index];
  if(!r)return {ok:false,message:'Choose a potion.'};
  if(!player.inventory.transact(r.cost,[makeStack(r.out)]))return {ok:false,message:'Check ingredients and make room for the result.'};
  return {ok:true,message:`Mixed ${getItem(r.out).name}. Hold Use to drink.`};
}
