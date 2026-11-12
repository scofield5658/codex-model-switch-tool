import json, os, subprocess, tempfile, selectors, time
from pathlib import Path
from backend.store import Store
with tempfile.TemporaryDirectory() as td:
    root=Path(td)
    (root/'config.toml').write_text('model="gpt-test"\n[model_providers.demo]\nname="Demo"\nbase_url="https://example.com/v1"\nexperimental_bearer_token="fixture-key"\n')
    store=Store(root); data=store.snapshot()
    store.save({'revision':data['revision'],'providers':data['providers'],'selection':{'provider':'demo','model':'fixture-model'}})
    cli=os.environ.get('TEST_CODEX_BIN','codex')
    p=subprocess.Popen([cli,'app-server','--stdio'],env={**os.environ,'CODEX_HOME':td},stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True)
    sel=selectors.DefaultSelector();sel.register(p.stdout,selectors.EVENT_READ)
    def send(x):p.stdin.write(json.dumps(x)+'\n');p.stdin.flush()
    def receive(id):
        deadline=time.monotonic()+20
        while time.monotonic()<deadline:
            if sel.select(1):
                line=p.stdout.readline()
                if not line:raise RuntimeError('App server exited')
                item=json.loads(line)
                if item.get('id')==id:return item
        raise RuntimeError('App server timeout')
    try:
        send({'id':1,'method':'initialize','params':{'clientInfo':{'name':'fixture-test','version':'0.1.0'}}})
        assert 'result' in receive(1)
        send({'method':'initialized','params':{}})
        send({'id':2,'method':'model/list','params':{}})
        result=receive(2)
        assert 'result' in result,result
        models=result['result'].get('data',[])
        assert any(m.get('model')=='fixture-model' for m in models),result
        print('Codex app-server accepted generated catalog and listed fixture-model.')
    finally:
        p.terminate();p.wait(timeout=10);sel.close()
