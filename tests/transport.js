import {remoteError} from '../ui/i18n.js';
import {applyHostContext} from '../ui/host-context.js';
export async function connect(){
 // Exercise production context handling without connecting to a real host or config.
 applyHostContext({locale:window.__fixtureLocale||'zh-CN'});
 window.addEventListener('fixture:host-context',event=>applyHostContext(event.detail));
}
export async function call(name,args={}){
 const response=await fetch('/api/'+name,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(args)});
 const result=await response.json();if(!result.ok)throw remoteError(result.errorCode,result.errorParams,result.error);return result.data;
}
