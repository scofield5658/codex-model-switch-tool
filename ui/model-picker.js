import {setText} from './i18n.js';
export function bindModelPicker(container,provider){
 const input=container.querySelector('[data-field="model"]'),toggle=container.querySelector('.model-toggle'),list=container.querySelector('.model-options');
 let active=-1,items=[];
 const close=()=>{list.hidePopover();input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');};
 const select=id=>{input.value=id;input.dispatchEvent(new Event('input',{bubbles:true}));close();input.focus();};
 const mark=()=>{[...list.children].forEach((e,i)=>{e.setAttribute('aria-selected',String(i===active));if(i===active){input.setAttribute('aria-activedescendant',e.id);e.scrollIntoView({block:'nearest'});}});};
 function open(filter=false){
  items=(provider.models||[]).filter(m=>!filter||m.id.toLowerCase().includes(input.value.toLowerCase()));active=-1;list.replaceChildren();
  for(const [i,m] of items.entries()){
   const option=document.createElement('div');option.role='option';option.id=`${list.id}-${i}`;option.textContent=m.id;option.title=m.name||m.id;
   option.onmousedown=e=>e.preventDefault();option.onclick=()=>select(m.id);list.append(option);
  }
  if(!items.length){const empty=document.createElement('p');setText(empty,'noMatches');list.append(empty);}
  const rect=input.getBoundingClientRect(),pane=document.querySelector('#app').getBoundingClientRect();
  const below=pane.bottom-rect.bottom-6,above=rect.top-6,height=Math.min(200,Math.max(below,above));
  list.style.cssText=`left:${rect.left}px;width:${rect.width}px;max-height:${height}px;top:auto;bottom:auto;`;
  if(below>=Math.min(200,items.length*30+16))list.style.top=`${rect.bottom+4}px`;else list.style.bottom=`${innerHeight-rect.top+4}px`;
  list.showPopover();input.setAttribute('aria-expanded','true');
 }
 list.addEventListener('toggle',e=>{if(e.newState==='closed'){input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');}});
 toggle.onclick=()=>{if(list.matches(':popover-open'))close();else{input.focus();open();}};
 input.addEventListener('input',()=>open(true));
 input.addEventListener('keydown',e=>{
  if(e.key==='Escape'||e.key==='Tab'){close();return;}
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();if(!list.matches(':popover-open'))open();active=Math.max(0,Math.min(items.length-1,active+(e.key==='ArrowDown'?1:-1)));mark();}
  if(e.key==='Enter'&&list.matches(':popover-open')){e.preventDefault();if(items[active])select(items[active].id);else close();}
 });
}
