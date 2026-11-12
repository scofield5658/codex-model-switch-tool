"""One JSON command on stdin; one sanitized result on stdout."""
import json
import sys
from .store import Store, ConfigError, atomic, digest
from .network import discover, health
from .restart import schedule_restart

def execute(command,args):
    store=Store()
    if command=='snapshot': return store.snapshot()
    if command=='save': return store.save(args)
    if command in ('discover','health'):
        p,key=store.resolve(args['provider'])
        if command=='health': return health(p,key)
        result=discover(p,key)
        cache=store.dir/'catalogs'/(digest(p['id']+p['baseUrl']+key)+'.json')
        atomic(cache,json.dumps(result,ensure_ascii=False))
        return result
    if command=='restart':
        if args.get('revision')!=store.snapshot()['revision']: raise ConfigError('配置已变化，请重新加载后再重启。')
        return schedule_restart(args.get('confirmedIdle'),store.dir)
    raise ConfigError('未知操作。')

if __name__=='__main__':
    sys.stdin.reconfigure(encoding='utf-8')
    sys.stdout.reconfigure(encoding='utf-8')
    try:
        incoming=sys.stdin.read(512*1024+1)
        if len(incoming)>512*1024: raise ConfigError('请求过大。')
        req=json.loads(incoming)
        result=execute(req['command'],req.get('args',{}))
        print(json.dumps({'ok':True,'data':result},ensure_ascii=False))
    except ConfigError as e: print(json.dumps({'ok':False,'error':str(e),'errorCode':e.code,'errorParams':e.params},ensure_ascii=False))
    except Exception: print(json.dumps({'ok':False,'error':'操作未完成，请检查本地配置格式及文件权限。','errorCode':'localFailure','errorParams':{}},ensure_ascii=False))
