import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {registerAppTool,registerAppResource,RESOURCE_MIME_TYPE} from '@modelcontextprotocol/ext-apps/server';
import {z} from 'zod';
import {spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import messages from './locales/messages.json';
import {createPythonRuntime, pythonEnvironment} from './runtime/python.mjs';
const messageCodes=new Map(Object.entries(messages).map(([code,row])=>[row['zh-Hans'],code]));

const root=path.resolve(__dirname,'..');
const runtime=createPythonRuntime({root});
async function backend(command,args={}){
 const python=await runtime.ensure();
 return new Promise((resolve,reject)=>{
  const child=spawn(python,['-E','-s','-m','backend.main'],{cwd:root,stdio:['pipe','pipe','pipe'],env:pythonEnvironment()});
  let output=''; const timer=setTimeout(()=>{child.kill();reject(new Error('本地操作超时，配置可能已保存，请重新加载核对。'));},75000);
  child.stdout.on('data',chunk=>{output+=chunk;if(output.length>2*1024*1024){child.kill();reject(new Error('响应过大。'));}});
  // Do not forward Python diagnostics: they may include configuration input.
  child.stderr.on('data',()=>{});
  child.on('error',()=>{clearTimeout(timer);reject(new Error('无法启动本地 Python，请运行插件 setup。'));});
  child.on('close',()=>{clearTimeout(timer);try{const r=JSON.parse(output);r.ok?resolve(r.data):reject(Object.assign(new Error(r.error),{code:r.errorCode,params:r.errorParams}));}catch{reject(new Error('本地配置服务未正常返回。'));}});
  child.stdin.on('error',()=>{});
  child.stdin.end(JSON.stringify({command,args}));
 });
}
function result(data){return {content:[],structuredContent:data};}
function handler(command){return async({payload}={})=>{try{return result(await backend(command,payload?JSON.parse(payload):{}));}catch(e){const code=messages[e.code]?e.code:(e instanceof SyntaxError?'requestJson':messageCodes.get(e.message)||'operationFailed');return {isError:true,structuredContent:{errorCode:code,errorParams:e.params||{}},content:[{type:'text',text:messages[code]['zh-Hans'].replace(/\{(\w+)\}/g,(_,key)=>String(e.params?.[key]??''))}]};}};}
async function start(){
 const server=new McpServer({name:'codex-model-switch-tool',version:'0.1.3'});
 const uri='ui://model-switcher/settings';
 // Opening the page must not wait for a first-time Python download or configuration read.
 registerAppTool(server,'provider_manager',{title:'自定义模型配置',description:'打开本地自定义模型配置界面，配置地址、凭证和默认模型。已有密钥不向模型返回。',inputSchema:{},annotations:{readOnlyHint:true},_meta:{ui:{resourceUri:uri},'openai/ui':{entrypoints:[{type:'global'}]}}},async()=>result({}));
 registerAppTool(server,'provider_read',{title:'读取提供商配置',inputSchema:{},annotations:{readOnlyHint:true},_meta:{ui:{visibility:['app']}}},handler('snapshot'));
 for(const [name,command,title] of [['provider_save','save','保存配置'],['provider_models','discover','刷新模型'],['provider_health','health','测试连接'],['provider_restart','restart','重启 Codex']]){
  registerAppTool(server,name,{title,inputSchema:{payload:z.string().max(512000)},annotations:{readOnlyHint:command==='discover'||command==='health',destructiveHint:command==='restart',openWorldHint:command==='discover'||command==='health'},_meta:{ui:{visibility:['app']}}},handler(command));
 }
 registerAppResource(server,'provider-ui',uri,{},async()=>({contents:[{uri,mimeType:RESOURCE_MIME_TYPE,text:readFileSync(path.join(root,'dist/ui.html'),'utf8'),_meta:{ui:{prefersBorder:false,csp:{connectDomains:[],resourceDomains:[]}},'openai/ui':{preferredDisplayMode:'fullscreen',availableDisplayModes:['fullscreen','inline']}}}]}));
 await server.connect(new StdioServerTransport());
}
start().catch(()=>{process.stderr.write('Model Switcher startup failed.\n');process.exitCode=1;});
