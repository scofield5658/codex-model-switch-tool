import {remoteError} from './i18n.js';
import {App} from '@modelcontextprotocol/ext-apps';
import {applyHostContext} from './host-context.js';
let app,connection;
export async function connect(){
 if(!connection){
  const next=new App({name:'Model Switcher',version:'0.1.5'},{});
  next.onhostcontextchanged=applyHostContext;
  app=next;
  connection=next.connect().then(()=>applyHostContext(next.getHostContext()??{})).catch(async error=>{
   try{await next.close();}catch{}
   connection=undefined;throw error;
  });
 }
 return connection;
}
export async function call(name,args={}){
 await connect();
 const r=await app.callServerTool({name,arguments:Object.keys(args).length?{payload:JSON.stringify(args)}:{}});
 if(r.isError)throw remoteError(r.structuredContent?.errorCode,r.structuredContent?.errorParams,r.content?.find(c=>c.type==='text')?.text);
 return r.structuredContent;
}
