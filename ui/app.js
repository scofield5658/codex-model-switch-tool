import {t,h,a,message,remoteError,setText,setTranslatedAttribute,localize} from './i18n.js';
import {bindModelPicker} from './model-picker.js';
import {connect,call} from './transport.js';
import './style.css';
const el=document.querySelector('#app');
let saved,draft,editing=null,deleted=[],raws={},busy=false,dirty=false,results={},notice='',failure='';
const clone=x=>structuredClone(x);
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function baseline(data){saved=clone(data);draft=clone(data);deleted=[];raws={};dirty=false;results={};}
function raw(p){return raws[p.id]??JSON.stringify(p.extra,null,2);}
function parse(p){try{return {...p,extra:JSON.parse(raw(p))};}catch{throw new Error('Raw Data JSON 格式错误，请修正或重置。');}}
function clearMessage(){notice='';failure='';}
function changed(p){
 dirty=true;clearMessage();delete results[p.id];syncToolbar();
 document.querySelector('#messages').replaceChildren();
 const container=[...el.querySelectorAll('[data-id]')].find(x=>x.dataset.id===p.id);
 container?.querySelector('.dot')?.remove();
 if(container){
  if(p.name){container.querySelector('h2').textContent=p.name;delete container.querySelector('h2').dataset.i18n;}else setText(container.querySelector('h2'),'未命名提供商');
  const model=container.querySelector('.card-head p');if(p.model){model.textContent=p.model;delete model.dataset.i18n;}else setText(model,'尚未选择模型');
 }
}
function syncToolbar(){const state=document.querySelector('#draft-state');if(dirty)setText(state,'有未保存修改');else{state.textContent='';delete state.dataset.i18n;}}
function render(){
 if(!draft){renderInitialization();return;}
 el.innerHTML=`<main data-ui-revision="compact-20261112"><header><div><h1>${h("自定义模型配置")}</h1><p>${h("管理接入，选择下次启动使用的模型。")}</p></div><button id="reload" class="quiet">${h("重新加载")}</button></header>
 <section class="toolbar" ${a('aria-label','配置操作')}><span id="draft-state" aria-live="polite">${dirty?h('有未保存修改'):''}</span><div><button id="reset">${h("重置")}</button><button id="save">${h("保存")}</button><button id="restart" class="primary">${h("保存并重启")}</button></div></section>
 <section class="summary"><span>${h("已保存默认")}</span><strong>${esc(saved.selection.provider)} <small>${esc(saved.selection.model)}</small></strong><p>${h("当前运行模型待核实；保存后请重启，并在新聊天中验证。")}</p></section>
 <div id="messages">${failure?`<p role="alert" class="error">${h(failure)}</p>`:''}${notice?`<p role="status" class="notice">${h(notice)}</p>`:''}</div>
 <section class="providers" ${a('aria-label','提供商列表')}>
 <article class="provider native"><div class="card-head"><div><h2>${h("内置 GPT")}</h2><p>${draft.nativeModel?esc(draft.nativeModel):h('未记录原始配置')}</p></div><button id="native" ${!draft.nativeAvailable?'disabled':''} class="${draft.selection.provider==='openai'?'selected':''}">${h(draft.selection.provider==='openai'?'已选为默认':'设为默认')}</button></div></article>
 ${draft.providers.map(p=>card(p)).join('')}
 </section>
 <button id="add" class="add">${h("＋ 添加模型提供商")}</button>
 <dialog id="restart-dialog"><h2>${h("保存并重启 Codex")}</h2><p>${h("这会退出整个客户端。插件无法自动核实所有聊天的运行状态，请先结束各窗口中的任务。")}</p><p>${h("重启后请新建聊天验证。已有聊天可能仍保留原来的模型。")}</p><label class="check"><input type="checkbox" id="idle">${h("我已确认所有任务结束，可以重启")}</label><div class="dialog-actions"><button id="dismiss-restart">${h("取消")}</button><button id="confirm-restart" disabled class="primary">${h("确认保存并重启")}</button></div></dialog>
 <dialog id="add-dialog"><h2>${h("添加模型提供商")}</h2><label>${h("服务商模板")}<select id="template"><option value="" data-i18n="custom">${t('custom')}</option>${draft.templates.map(t=>`<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('')}</select></label><label>${h("名称")}<input id="new-name" ${a('placeholder','例如：Kimi Code')}></label><label>Provider ID<input id="new-id" ${a('placeholder','小写字母、数字和连字符')}></label><p id="add-error" class="error" role="alert"></p><div class="dialog-actions"><button id="dismiss-add">${h("取消")}</button><button id="confirm-add" class="primary">${h("添加")}</button></div></dialog>
 </main>`;
 bind();localize(el);if(busy)setBusy(true);
}
function card(p){
 const r=results[p.id]; const selected=draft.selection.provider===p.id;
 return `<article class="provider" data-id="${esc(p.id)}"><div class="card-head"><div><h2>${esc(p.name)} ${r?.ok?'<span class="dot"></span>':''}</h2><p>${p.model?esc(p.model):h('尚未选择模型')}</p></div><div class="actions"><button data-action="select" ${selected?'class="selected"':''}>${h(selected?'已选为默认':'设为默认')}</button><button data-action="edit">${h(editing===p.id?'收起':'编辑')}</button><button data-action="delete" class="danger">${h("删除")}</button></div></div>
 ${editing===p.id?`<div class="editor"><label>${h("配置名称")}<input data-field="name" value="${esc(p.name)}" ${a('placeholder','例如：Kimi Code')} autocomplete="off"></label><p class="help identity">Provider ID：<code>${esc(p.id)}</code></p>
 <label>${h("接入地址")}<input data-field="baseUrl" value="${esc(p.baseUrl)}" type="url" autocomplete="off" spellcheck="false"></label>
 <label>API Key<input data-field="key" type="password" value="${esc(p.key||'')}" ${a('placeholder',p.keyConfigured?'keepKey':'enterKey')} autocomplete="new-password" ${p.authEditable===false?'disabled':''}></label><p class="help">${h(p.keyConfigured?'已配置，保存的密钥不会再次展示。':'密钥只保存在本机配置中。')}</p>
 <div class="field"><label for="model-${esc(p.id)}">${h("默认模型")}</label><div class="model-row"><div class="model-picker"><input id="model-${esc(p.id)}" data-field="model" value="${esc(p.model)}" role="combobox" aria-expanded="false" aria-autocomplete="list" aria-controls="options-${esc(p.id)}" ${a('placeholder','选择或输入模型 ID')} autocomplete="off"><button type="button" class="model-toggle" ${a('aria-label','展开模型列表')}><svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button><div class="model-options" id="options-${esc(p.id)}" role="listbox" popover></div></div><button data-action="models">${h("刷新模型")}</button></div></div><p class="help">${p.modelsAt?h('modelsUpdated',{date:p.modelsAt}):h('modelsHint')}</p>
 <div class="health-row"><button data-action="health" ${!healthConfigured(p)?'disabled':''}>${h("测试连接")}</button><span>${h(connectionHint(p))}</span></div>
 <details><summary>${h("高级配置")}<span>Raw Data</span></summary><p class="help">${h('rawHint')}</p><textarea ${a('aria-label','高级配置 JSON')} data-field="raw" spellcheck="false">${esc(raw(p))}</textarea><button data-action="health-template">${h("填入连接测试示例")}</button></details></div>`:''}</article>`;
}
function healthConfigured(p){try{return !!parse(p).extra.health;}catch{return false;}}
function connectionHint(p){return healthConfigured(p)?'使用当前草稿；POST 测试可能消耗额度。':'未配置测试请求，可在高级配置中设置。';}
function setBusy(value){busy=value;for(const b of el.querySelectorAll('button,input,select,textarea'))b.disabled=value||b.dataset.originalDisabled==='true';}
async function run(fn){if(busy)return;clearMessage();busy=true;render();try{await fn();}catch(e){failure=e;}finally{busy=false;render();}}
function bind(){
 for(const b of el.querySelectorAll('button,input,select,textarea'))b.dataset.originalDisabled=String(b.disabled);
 document.querySelector('#reload').onclick=()=>{if(dirty&&!confirm(t('reloadConfirm')))return;run(async()=>{baseline(await call('provider_read'));editing=null;notice='已重新加载。';});};
 document.querySelector('#native').onclick=()=>{draft.selection={provider:'openai',model:draft.nativeModel};dirty=true;render();};
 document.querySelector('#reset').onclick=()=>{draft=clone(saved);raws={};deleted=[];dirty=false;results={};if(!draft.providers.some(p=>p.id===editing))editing=null;clearMessage();render();};
 document.querySelector('#save').onclick=()=>run(save);
 document.querySelector('#restart').onclick=()=>document.querySelector('#restart-dialog').showModal();
 document.querySelector('#idle').onchange=e=>document.querySelector('#confirm-restart').disabled=!e.target.checked;
 document.querySelector('#dismiss-restart').onclick=()=>document.querySelector('#restart-dialog').close();
 document.querySelector('#confirm-restart').onclick=()=>{document.querySelector('#restart-dialog').close();run(async()=>{await save();const r=await call('provider_restart',{revision:saved.revision,confirmedIdle:true});notice=message('restartScheduled');});};
 document.querySelector('#add').onclick=()=>{document.querySelector('#add-error').textContent='';delete document.querySelector('#add-error').dataset.i18n;document.querySelector('#add-dialog').showModal();};
 document.querySelector('#dismiss-add').onclick=()=>document.querySelector('#add-dialog').close();
 document.querySelector('#template').onchange=e=>{const t=draft.templates.find(t=>t.id===e.target.value);document.querySelector('#new-id').value=t?.id||'';document.querySelector('#new-name').value=t?.name||'';};
 document.querySelector('#confirm-add').onclick=()=>{
  const id=document.querySelector('#new-id').value.trim(),name=document.querySelector('#new-name').value.trim();
  if(!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id)||!name||draft.providers.some(p=>p.id===id)||['openai','ollama','lmstudio','gcp','amazon-bedrock','amazon-bedrock-runtime'].includes(id)){setText(document.querySelector('#add-error'),'addInvalid');return;}
  const template=draft.templates.find(t=>t.id===document.querySelector('#template').value);
  draft.providers.push({id,name,baseUrl:template?.baseUrl||'',model:template?.model||'',keyConfigured:false,extra:{provider:{wire_api:'responses'},model:{},discovery:{},health:null},models:[]});
  deleted=deleted.filter(x=>x!==id);editing=id;dirty=true;render();
 };
 for(const container of el.querySelectorAll('[data-id]')){
  const p=draft.providers.find(x=>x.id===container.dataset.id);
  for(const input of container.querySelectorAll('[data-field]'))input.oninput=e=>{
   const field=input.dataset.field;
   if(field==='raw')raws[p.id]=input.value;else p[field]=input.value;
   if(field==='baseUrl')p.confirmOriginChange=false;
   if(field==='model'&&draft.selection.provider===p.id)draft.selection.model=p.model;
   changed(p);
   const healthButton=container.querySelector('[data-action="health"]');healthButton.disabled=!healthConfigured(p);
   setText(container.querySelector('.health-row span'),connectionHint(p));
  };
  if(container.querySelector('.model-picker'))bindModelPicker(container,p);
  for(const b of container.querySelectorAll('[data-action]'))b.onclick=()=>{
   switch(b.dataset.action){
    case 'edit':editing=editing===p.id?null:p.id;render();break;
    case 'select':draft.selection={provider:p.id,model:p.model};dirty=true;render();break;
    case 'delete':if(draft.selection.provider===p.id){failure='请先选择其他默认提供商，再删除此项。';render();break;}if(confirm(t('deleteConfirm',{name:p.name}))){draft.providers=draft.providers.filter(x=>x.id!==p.id);if(saved.providers.some(x=>x.id===p.id))deleted.push(p.id);dirty=true;render();}break;
    case 'models':refreshModels(p,b);break;
    case 'health':run(async()=>{const q=confirmOrigin(parse(p));const r=await call('provider_health',{provider:q});results[p.id]={ok:r.ok};notice=message('healthPassed');});break;
    case 'health-template':try{const x=parse(p).extra;x.health={path:'responses',method:'POST',body:{model:'$model',input:'Reply with OK.',max_output_tokens:64},expectStatus:200,timeoutSeconds:20};raws[p.id]=JSON.stringify(x,null,2);changed(p);render();}catch(e){failure=e;render();}break;
   }
  };
 }
}
async function refreshModels(p,button){
 if(busy)return;
 const pane=document.querySelector('#app'),scroll=pane.scrollTop;
 setBusy(true);button.setAttribute('aria-busy','true');button.innerHTML=`<span class="spinner" aria-hidden="true"></span>${h("刷新模型")}`;
 try{
  const r=await call('provider_models',{provider:confirmOrigin(parse(p))});
  p.models=r.models;p.modelsAt=r.checkedAt;
  setTranslatedAttribute(button,'title','modelsFetched',{count:r.models.length});button.removeAttribute('aria-label');button.removeAttribute('data-i18n-aria-label');
 }catch(e){const translated=remoteError(e.code,e.params,e.message);const error=message(translated.code,translated.params);setTranslatedAttribute(button,'title','refreshFailed',{error});setTranslatedAttribute(button,'aria-label','refreshFailed',{error});}
 finally{setBusy(false);button.removeAttribute('aria-busy');button.innerHTML=h('refreshModels');pane.scrollTop=scroll;}
}
function confirmOrigin(p){
 const old=saved.providers.find(x=>x.id===p.id);
 let changedOrigin=false;try{changedOrigin=old&&new URL(old.baseUrl).origin!==new URL(p.baseUrl).origin;}catch{throw new Error('接入地址无效。');}
 if(changedOrigin&&!p.key&&!p.confirmOriginChange){if(!confirm(t('originConfirm')))throw new Error('已取消域名变更。');p.confirmOriginChange=true;const d=draft.providers.find(x=>x.id===p.id);if(d)d.confirmOriginChange=true;}
 return p;
}
async function save(){
 const providers=draft.providers.map(p=>confirmOrigin(parse(p)));
 const data=await call('provider_save',{revision:saved.revision,providers,selection:draft.selection,deletedIds:deleted});
 baseline(data);notice='已保存，下次启动生效。';
}
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
let initializing=false,initializationPhase='initializing',initializationSlow=false;
function renderInitialization(){
 el.innerHTML=`<main class="initialization"><h1>${h('title')}</h1><section class="loading" aria-busy="true"><span class="loading-spinner" aria-hidden="true"></span><div role="status" aria-live="polite"><p>${h(initializationPhase)}</p><p class="help">${h(initializationSlow?'initializationSlow':'initializationHint')}</p></div></section></main>`;
}
async function initialize(){
 if(initializing)return;
 initializing=true;initializationPhase='initializing';initializationSlow=false;
 renderInitialization();
 const timer=setTimeout(()=>{initializationSlow=true;renderInitialization();},10000);
 try{
  await connect();initializationPhase='loading';renderInitialization();
  baseline(await call('provider_read'));render();
 }catch(e){
  el.innerHTML=`<main class="initialization"><h1>${h('title')}</h1><p role="alert" class="error">${h('initializationFailed')}</p><details class="initialization-details"><summary>${h('errorDetails')}</summary><p>${h(e)}</p></details><button id="retry-load">${h('retry')}</button></main>`;
  document.querySelector('#retry-load').onclick=initialize;
 }finally{clearTimeout(timer);initializing=false;}
}
initialize();
