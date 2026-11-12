"""Exercise the actual Codex plugin loader, not just the standalone MCP server."""
import json,os,subprocess,tempfile,selectors,time
from pathlib import Path
cli=os.environ.get('TEST_CODEX_BIN','codex')
market=Path('release/local-marketplace').resolve()
with tempfile.TemporaryDirectory(prefix='switcher-loader-') as td:
    env={**os.environ,'CODEX_HOME':td}
    for args in [['plugin','marketplace','add',str(market),'--json'],['plugin','add','codex-model-switcher@local-model-tools','--json']]:
        subprocess.run([cli]+args,env=env,check=True,capture_output=True,text=True)
    p=subprocess.Popen([cli,'app-server','--stdio'],env=env,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    sel=selectors.DefaultSelector();sel.register(p.stdout,selectors.EVENT_READ);sel.register(p.stderr,selectors.EVENT_READ)
    warnings=[]
    def send(x):p.stdin.write(json.dumps(x)+'\n');p.stdin.flush()
    def receive(id):
        deadline=time.monotonic()+30
        while time.monotonic()<deadline:
            for key,_ in sel.select(1):
                line=key.fileobj.readline()
                if not line:continue
                if key.fileobj==p.stderr:
                    if 'model-switcher' in line or 'plugin MCP' in line:warnings.append(line[:1500])
                    continue
                item=json.loads(line)
                if item.get('id')==id:return item
        raise RuntimeError('App server timeout; '+''.join(warnings))
    try:
        send({'id':1,'method':'initialize','params':{'clientInfo':{'name':'plugin-loader-test','version':'0.1.0'},'capabilities':{'experimentalApi':True}}})
        assert 'result' in receive(1)
        send({'method':'initialized','params':{}})
        send({'id':2,'method':'mcpServerStatus/list','params':{}})
        result=receive(2)
        rows=result.get('result',{}).get('data',[])
        row=next((r for r in rows if 'model-switcher' in r.get('name','')),None)
        assert row is not None, 'Plugin MCP missing from host status: '+''.join(warnings)
        tools=row.get('tools',{})
        entry=next((t for t in (tools.values() if isinstance(tools,dict) else tools) if t.get('name')=='provider_manager'),None)
        assert entry is not None, 'Host did not load provider_manager: '+json.dumps(row,ensure_ascii=False)
        assert {'type':'global'} in entry['_meta']['openai/ui']['entrypoints']
        assert entry['_meta']['ui']['resourceUri']=='ui://model-switcher/settings'
        print('Host loaded provider_manager with global entrypoint and UI resource.')
    finally:
        p.terminate();p.wait(timeout=10);sel.close()
