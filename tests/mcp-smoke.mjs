import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
const entry=process.argv[2]||'dist/server.cjs';
const home=await mkdtemp(tmpdir()+'/switcher-mcp-');
await writeFile(home+'/config.toml','model="gpt-test"\n[model_providers.demo]\nname="Demo"\nbase_url="https://example.com/v1"\nexperimental_bearer_token="never-return-this"\n');
const client=new Client({name:'smoke-test',version:'1.0'});
try{
 await client.connect(new StdioClientTransport({command:process.execPath,args:[entry],env:{...process.env,CODEX_HOME:home,MODEL_SWITCHER_RUNTIME_DIR:home+'/runtime',MODEL_SWITCHER_PYTHON:'/invalid-system-python',PYTHONHOME:'/invalid',PYTHONPATH:'/invalid'}}));
 const tools=await client.listTools();
 assert(tools.tools.some(t=>t.name==='provider_manager'));
 assert.equal(tools.tools.filter(t=>!t._meta?.ui?.visibility?.includes('app')).length,1);
 for(const tool of tools.tools.filter(t=>t.name!=='provider_manager')) assert.deepEqual(tool._meta.ui.visibility,['app']);
 const opened=await client.callTool({name:'provider_manager',arguments:{}});
 assert.equal(opened.isError,undefined);
 assert.deepEqual(opened.structuredContent,{});
 const result=await client.callTool({name:'provider_read',arguments:{}});
 assert(!JSON.stringify(result).includes('never-return-this'));
 assert.equal(result.structuredContent.providers[0].keyConfigured,true);
 const ui=await client.readResource({uri:'ui://model-switcher/settings'});
 assert(ui.contents[0].text.includes('自定义模型配置'));
 assert((await readFile(home+'/config.toml','utf8')).includes('never-return-this'));
 const invalid=await client.callTool({name:'provider_save',arguments:{payload:'{invalid'}});
 assert.equal(invalid.isError,true);assert.equal(invalid.structuredContent.errorCode,'requestJson');
 console.log('MCP registration, app-only mutation, UI resource and credential isolation passed');
}finally{await client.close();await rm(home,{recursive:true,force:true});}

const failedHome=await mkdtemp(tmpdir()+'/switcher-mcp-failure-');
const failed=new Client({name:'failure-test',version:'1.0'});
try{
 await failed.connect(new StdioClientTransport({command:process.execPath,args:[entry],env:{...process.env,CODEX_HOME:failedHome,MODEL_SWITCHER_RUNTIME_DIR:failedHome+'/runtime',MODEL_SWITCHER_UV:'/missing-uv'}}));
 // Initialization must not prevent the host from discovering the tool or retrieving its error UI.
 assert((await failed.listTools()).tools.some(t=>t.name==='provider_manager'));
 const opened=await failed.callTool({name:'provider_manager',arguments:{}});
 assert(!opened.isError,'The settings page must open even before Python is ready');
 const result=await failed.callTool({name:'provider_read',arguments:{}});
 assert.equal(result.isError,true);
 assert.equal(result.structuredContent.errorCode,'uvMissing');
 assert(!JSON.stringify(result).includes(failedHome));
 assert((await failed.readResource({uri:'ui://model-switcher/settings'})).contents[0].text.includes('uvMissing'));
 console.log('MCP reports missing uv with a sanitized error while preserving tool/UI discovery.');
}finally{await failed.close();await rm(failedHome,{recursive:true,force:true});}

const coldHome=await mkdtemp(tmpdir()+'/switcher-mcp-cold-');
const cold=new Client({name:'cold-start-test',version:'1.0'});
try{
 const uv=coldHome+'/slow-uv';
 await writeFile(uv,`#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(coldHome+'/uv-called')},'called');setTimeout(()=>process.exit(0),5000);`,{mode:0o700});
 await cold.connect(new StdioClientTransport({command:process.execPath,args:[entry],env:{...process.env,CODEX_HOME:coldHome,MODEL_SWITCHER_RUNTIME_DIR:coldHome+'/runtime',MODEL_SWITCHER_UV:uv}}));
 const result=await cold.callTool({name:'provider_manager',arguments:{}},undefined,{timeout:1500});
 assert(!result.isError);
 await assert.rejects(readFile(coldHome+'/uv-called'),{code:'ENOENT'});
 assert((await cold.readResource({uri:'ui://model-switcher/settings'})).contents[0].text.includes('自定义模型配置'));
 console.log('Cold settings entry opens without waiting for Python or accessing configuration.');
}finally{await cold.close();await rm(coldHome,{recursive:true,force:true});}
