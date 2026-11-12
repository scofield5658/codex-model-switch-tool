// Test-only HTTP bridge. Always uses a disposable config, never the user's CODEX_HOME.
import http from 'node:http';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import {createPythonRuntime, pythonEnvironment} from '../runtime/python.mjs';
const python=await createPythonRuntime({root:process.cwd()}).ensure();
const home=await mkdtemp(tmpdir()+'/switcher-ui-');
await writeFile(home+'/config.toml','model="gpt-6-astra"\nmodel_reasoning_effort="low"\n[model_providers.kimi-code-plan-cn]\nname="Kimi Code"\nbase_url="https://api.kimi.com/coding/v1"\nexperimental_bearer_token="test-only-saved-key"\n[model_providers.moonshotai-cn]\nname="Moonshot"\nbase_url="https://api.moonshot.cn/v1"\n[model_providers.zai-coding-plan]\nname="Z.AI Coding Plan"\nbase_url="https://api.z.ai/api/v1"\n');
const commands={provider_read:'snapshot',provider_save:'save'};
const server=http.createServer(async(req,res)=>{
 try{
  if(req.method==='GET'&&req.url==='/'){res.setHeader('Content-Type','text/html');res.end(await readFile('dist/test-ui.html'));return;}
  const command=commands[req.url?.split('/').pop()];
  if(req.method!=='POST'||!command){res.writeHead(404);res.end();return;}
  let body='';for await(const chunk of req){body+=chunk;if(body.length>512000)throw new Error('large');}
  const child=spawn(python,['-E','-s','-m','backend.main'],{env:{...pythonEnvironment(),CODEX_HOME:home},stdio:['pipe','pipe','inherit']});
  let out='';child.stdout.on('data',x=>out+=x);child.on('close',()=>{res.setHeader('Content-Type','application/json');const result=JSON.parse(out);if(result.ok)result.data.canRestart=true;res.end(JSON.stringify(result));});
  child.stdin.end(JSON.stringify({command,args:JSON.parse(body)}));
 }catch{res.writeHead(500);res.end('{}');}
});
server.listen(43187,'127.0.0.1',()=>console.log('Fixture UI: http://127.0.0.1:43187'));
for(const sig of ['SIGTERM','SIGINT'])process.on(sig,async()=>{server.close();await rm(home,{recursive:true,force:true});process.exit();});
