import { getItem, maxDurability } from '../crafting/items.js';
import { BREWS, bookshelfCount, equipment, enchantOffer, repairMaterial, enchant, repair, brew } from '../crafting/workshop.js';

export class WorkshopUI {
  constructor(container){
    this.container=container;this.game=container.game;this.type=container.type;
    this.title={enchant:'Enchanting Table',anvil:'Anvil · Repair',brew:'Brewing Stand'}[this.type];
    this.selected=this.type==='brew'?0:null;
    this.root=document.createElement('div');this.root.className='workshop';
    const hint=document.createElement('div');
    hint.textContent=this.type==='brew'?'Water → Awkward → Potion. Each mix uses blaze powder.':'Select equipment in your bag below (unequip worn armor first).';
    this.list=document.createElement('div');this.list.className='workshop-list';
    this.status=document.createElement('div');this.status.className='workshop-status';
    this.button=document.createElement('button');this.button.className='mc-btn execute';
    this.button.addEventListener('mousedown',e=>{e.stopPropagation();if(this.button.disabled)return;this.execute();});
    this.message=document.createElement('div');this.message.className='workshop-status';this.message.setAttribute('role','status');
    this.root.append(hint,this.list,this.status,this.button,this.message);
    this.render();
  }
  render(){
    const p=this.game.player,inv=p.inventory;
    const entries=this.type==='brew'?BREWS.map((r,index)=>({index,name:getItem(r.out).name})):equipment(inv,this.type).map(({s,index})=>({index,name:`${index+1}: ${getItem(s.key).name}`}));
    if(!entries.some(e=>e.index===this.selected))this.selected=entries[0]?.index??null;
    // Do not rebuild buttons during a touch gesture / animation frame.
    const sig=JSON.stringify(entries)+':'+this.selected;
    if(sig!==this._sig){
      this._sig=sig;this.list.replaceChildren();
      for(const e of entries){const b=document.createElement('button');b.textContent=e.name;b.dataset.equipment=e.index;b.classList.toggle('selected',this.selected===e.index);
        b.addEventListener('mousedown',ev=>{ev.stopPropagation();this.selected=e.index;this.message.textContent='';this.render();});this.list.appendChild(b);}
    }
    let valid=this.selected!==null;
    if(this.type==='brew'){
      const r=BREWS[this.selected];
      this.status.textContent=r?'Needs: '+Object.entries(r.cost).map(([k,n])=>`${n} ${getItem(k).name} (${inv.count(k)} owned)`).join(' + '):'Choose a potion.';
      this.button.textContent='Mix potion';
      valid=valid&&Object.entries(r?.cost||{}).every(([k,n])=>inv.has(k,n));
    }else if(this.type==='enchant'){
      this.shelves=bookshelfCount(this.game.world,this.container.data.pos);
      const offer=enchantOffer(inv.slots[this.selected],this.shelves);
      this.status.textContent=offer?`Tier ${offer.rank} · Reach level ${offer.requiredLevel}; spends ${offer.levels} level(s) + ${offer.rank} lapis. Shelves ${this.shelves}/${offer.shelvesRequired}. Your level: ${p.level}.`:'No eligible equipment. Max tier is III.';
      this.button.textContent='Enchant selected equipment';
      valid=valid&&!!offer&&offer.allowedShelves&&p.level>=offer.requiredLevel&&inv.has('lapis_lazuli',offer.rank);
    }else{
      const s=inv.slots[this.selected],mat=repairMaterial(s);
      this.status.textContent=s?`Durability ${s.dur}/${maxDurability(s.key)}. Costs 1 ${getItem(mat)?.name} + 1 level. Restores up to 25%. Your level: ${p.level}.`:'Nothing needs repair.';
      this.button.textContent='Repair selected equipment';valid=valid&&p.level>=1&&inv.has(mat,1);
    }
    this.button.disabled=!valid;
  }
  execute(){
    const p=this.game.player;
    const result=this.type==='enchant'?enchant(p,this.selected,bookshelfCount(this.game.world,this.container.data.pos)):this.type==='anvil'?repair(p,this.selected):brew(p,this.selected);
    this.message.textContent=result.message;
    if(result.ok){this.game.audio.play(this.type==='anvil'?'anvil':this.type==='brew'?'drink':'levelup',{volume:0.65});this.game.stats.itemsCrafted++;}
    this.container.refresh();
  }
}
