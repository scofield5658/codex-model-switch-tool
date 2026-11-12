import messages from '../locales/messages.json';
const bySource=new Map(Object.entries(messages).map(([key,row])=>[row['zh-Hans'],key]));
export function normalizeLocale(value='en'){
 const tag=String(value).replaceAll('_','-').toLowerCase();
 if(!/^zh(?:-|$)/.test(tag))return 'en';
 if(tag.includes('-hant'))return 'zh-Hant';
 if(tag.includes('-hans'))return 'zh-Hans';
 return /-(tw|hk|mo)(-|$)/.test(tag)?'zh-Hant':'zh-Hans';
}
let locale=normalizeLocale(globalThis.navigator?.language);
export function currentLocale(){return locale;}
function descriptor(value,params={}){
 if(value&&typeof value==='object')return {key:value.code||value.key||bySource.get(value.message)||'operationFailed',params:value.params||params};
 return {key:messages[value]?value:bySource.get(value)||'operationFailed',params};
}
export function t(value,params={}){
 const d=descriptor(value,params),row=messages[d.key]||messages.operationFailed;
 const values={...d.params};
 if(values.date)values.date=formatDate(values.date);
 if(values.error)values.error=t(values.error);
 return row[locale].replace(/\{(\w+)\}/g,(_,name)=>String(values[name]??''));
}
export const message=(key,params={})=>({key,params});
export class LocalizedError extends Error{
 constructor(code,params={}){super(messages[code]?.['zh-Hans']||messages.operationFailed['zh-Hans']);this.code=code;this.params=params;}
}
export function remoteError(code,params,text){
 if(messages[code])return new LocalizedError(code,params);
 const known=bySource.get(text);if(known)return new LocalizedError(known);
 // Compatibility with an already-running pre-i18n MCP process.
 const http=/^服务返回 HTTP (\d{3})；请检查地址、凭证及模型权限。$/.exec(text||'');
 if(http)return new LocalizedError('httpError',{status:Number(http[1])});
 const option=/^(model_reasoning_effort|model_reasoning_summary|model_verbosity) 取值无效。$/.exec(text||'');
 if(option)return new LocalizedError('modelOptionInvalid',{field:option[1]});
 return new LocalizedError('operationFailed');
}
export const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function h(value,params={}){
 const d=descriptor(value,params);
 return `<span data-i18n="${escapeHtml(d.key)}" data-i18n-params="${escapeHtml(JSON.stringify(d.params))}">${escapeHtml(t(d.key,d.params))}</span>`;
}
export function a(attribute,key){const d=descriptor(key);return `${attribute}="${escapeHtml(t(d.key))}" data-i18n-${attribute}="${d.key}"`;}
export function setText(element,value,params={}){
 const d=descriptor(value,params);element.dataset.i18n=d.key;element.dataset.i18nParams=JSON.stringify(d.params);element.textContent=t(d.key,d.params);
}
export function setTranslatedAttribute(element,attribute,value,params={}){
 const d=descriptor(value,params);element.setAttribute(`data-i18n-${attribute}`,d.key);element.setAttribute(`data-i18n-${attribute}-params`,JSON.stringify(d.params));element.setAttribute(attribute,t(d.key,d.params));
}
export function localize(root=document){
 for(const el of root.querySelectorAll('[data-i18n]'))el.textContent=t(el.dataset.i18n,JSON.parse(el.dataset.i18nParams||'{}'));
 for(const attr of ['placeholder','aria-label','title'])for(const el of root.querySelectorAll(`[data-i18n-${attr}]`))el.setAttribute(attr,t(el.getAttribute(`data-i18n-${attr}`),JSON.parse(el.getAttribute(`data-i18n-${attr}-params`)||'{}')));
 document.documentElement.lang=locale;document.title=t('title');
}
export function setHostLocale(value){if(typeof value!=='string'||!value.trim())return;locale=normalizeLocale(value);localize();}
export function formatDate(value){
 // Python's ISO timestamps use +0800; normalize to the interoperable +08:00 form.
 const date=new Date(String(value).replace(/([+-]\d{2})(\d{2})$/,'$1:$2'));
 return Number.isNaN(date.getTime())?String(value):new Intl.DateTimeFormat(locale,{dateStyle:'short',timeStyle:'short'}).format(date);
}
