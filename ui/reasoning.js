import presets from '../backend/reasoning-presets.json';
import {h,t} from './i18n.js';
const levels=['none','minimal','low','medium','high','xhigh','max','ultra'];
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function capability(p){
 return p.extra.model_capabilities?.[p.model]??presets.find(x=>x.urls.includes(p.baseUrl.replace(/\/+$/,''))&&x.models.includes(p.model));
}
export function reasoningEditor(p){
 const cap=capability(p), supported=cap?.reasoning_levels??[], effort=p.extra.model?.model_reasoning_effort??'';
 const options=[...new Set([...supported,...(effort?[effort]:[])])];
 return `<label>${h('reasoningEffort')}<select data-reasoning="effort" ${!p.model?'disabled':''}><option value="" data-i18n="reasoningDefaultOption" data-i18n-params="${esc(JSON.stringify({level:cap?.default_reasoning_level??'—'}))}">${esc(t('reasoningDefaultOption',{level:cap?.default_reasoning_level??'—'}))}</option>${options.map(x=>`<option value="${esc(x)}" ${effort===x?'selected':''}>${esc(x)}</option>`).join('')}</select></label>
 <p class="help">${h('reasoningHint')}</p>${cap&&effort&&!supported.includes(effort)?`<p class="error" role="alert">${h('reasoningUnsupported')}</p>`:''}
 <details class="capability-details"><summary>${h('reasoningCapabilities')}</summary><p class="help">${h('reasoningMappingHint')}</p>
 <fieldset ${!p.model?'disabled':''}><legend>${h('reasoningLevels')}</legend><div class="reasoning-levels">${levels.map(x=>`<label class="check"><input type="checkbox" data-level="${x}" ${supported.includes(x)?'checked':''}>${x}</label>`).join('')}</div></fieldset>
 <label>${h('reasoningCapabilityDefault')}<select data-reasoning="default" ${!supported.length?'disabled':''}><option value="">—</option>${supported.map(x=>`<option value="${esc(x)}" ${cap?.default_reasoning_level===x?'selected':''}>${esc(x)}</option>`).join('')}</select></label>
 <button type="button" data-reasoning="reset">${h('reasoningReset')}</button></details>`;
}
export function bindReasoning(container,read,write){
 for(const input of container.querySelectorAll('[data-reasoning], [data-level]')){
  const action=()=>{
   const p=read(),extra=p.extra;
   if(input.dataset.reasoning==='effort'){
    extra.model??={};
    if(input.value)extra.model.model_reasoning_effort=input.value;else delete extra.model.model_reasoning_effort;
   }else if(input.dataset.reasoning==='reset'){
    if(extra.model_capabilities)delete extra.model_capabilities[p.model];
   }else{
    const cap=structuredClone(capability(p)??{reasoning_levels:[]});
    const supported=[...container.querySelectorAll('[data-level]:checked')].map(x=>x.dataset.level);
    const selected=input.dataset.reasoning==='default'?input.value:cap.default_reasoning_level;
    extra.model_capabilities??={};
    extra.model_capabilities[p.model]={reasoning_levels:supported,...(supported.length?{default_reasoning_level:supported.includes(selected)?selected:supported[0]}:{})};
   }
   write(extra);
  };
  if(input.tagName==='BUTTON')input.onclick=action;else input.onchange=action;
 }
}
