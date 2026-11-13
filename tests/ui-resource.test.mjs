import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,copyFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';

// Exercise the built server: simulate a host that caches resources by URI.
test('changed UI content gets a new advertised URI while unchanged builds remain stable',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'model-ui-version-'));
 const cache=new Map();
 try{
  await mkdir(path.join(root,'dist'));
  await copyFile('dist/server.cjs',path.join(root,'dist/server.cjs'));
  // The settings resource must be available before Python is initialized.
  for(const file of ['pyproject.toml','uv.lock','.python-version'])await copyFile(file,path.join(root,file));
  async function launch(html){
   await writeFile(path.join(root,'dist/ui.html'),html);
   const client=new Client({name:'ui-cache-test',version:'1.0'});
   try{
    await client.connect(new StdioClientTransport({command:process.execPath,args:[path.join(root,'dist/server.cjs')],env:{...process.env,CODEX_HOME:root,MODEL_SWITCHER_UV:'/missing-uv'}}));
    const entry=(await client.listTools()).tools.find(t=>t.name==='provider_manager');
    const uri=entry._meta.ui.resourceUri;
    if(!cache.has(uri))cache.set(uri,(await client.readResource({uri})).contents[0].text);
    return {uri,html:cache.get(uri)};
   }finally{await client.close();}
  }
  const old=await launch('<html>old confirm UI</html>');
  const next=await launch('<html>new delete dialog UI</html>');
  assert.notEqual(next.uri,old.uri,'A cached resource must not hide an updated UI');
  assert.equal(next.html,'<html>new delete dialog UI</html>');
  assert.equal((await launch(next.html)).uri,next.uri,'Unchanged UI should keep its cache identity');
 }finally{await rm(root,{recursive:true,force:true});}
});
