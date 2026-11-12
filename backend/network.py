"""Bounded same-origin provider calls; never relay response bodies in errors."""
import json
import time
from urllib.parse import urljoin
from urllib.request import Request, build_opener, HTTPRedirectHandler
from urllib.error import HTTPError, URLError
from .store import ConfigError, origin

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs): return None

def endpoint(base,path):
    url=urljoin(base.rstrip('/')+'/',path)
    if origin(url)!=origin(base): raise ConfigError('测试和模型查询地址必须与接入地址同源。')
    return url

def request(p,key,path,method='GET',body=None,timeout=20):
    url=endpoint(p['baseUrl'],path)
    headers={'Accept':'application/json','User-Agent':'Codex-Model-Switcher/0.1'}
    if key: headers['Authorization']='Bearer '+key
    headers.update(p.get('headers',p.get('extra',{}).get('provider',{}).get('http_headers',{})))
    data=None
    if body is not None:
        data=json.dumps(body).encode(); headers['Content-Type']='application/json'
    start=time.monotonic()
    try:
        with build_opener(NoRedirect).open(Request(url,data=data,headers=headers,method=method),timeout=timeout) as response:
            raw=response.read(1024*1024+1)
            if len(raw)>1024*1024: raise ConfigError('响应超过 1 MiB，已停止读取。')
            return response.status,raw,round((time.monotonic()-start)*1000)
    except HTTPError as e:
        e.close()
        raise ConfigError('服务返回 HTTP %s；请检查地址、凭证及模型权限。' % e.code, 'httpError', {'status': e.code}) from None
    except (URLError,TimeoutError,OSError):
        raise ConfigError('连接失败或超时，请检查网络和服务地址。') from None

def discover(p,key):
    path=p.get('extra',{}).get('discovery',{}).get('url') or p.get('extra',{}).get('provider',{}).get('model_catalog_url') or 'models'
    _,raw,ms=request(p,key,path)
    try:
        data=json.loads(raw); rows=data.get('models',data.get('data',[]))
        if not isinstance(rows,list): raise ValueError()
        models=[]; seen=set()
        for row in rows:
            id=row.get('slug') or row.get('id')
            if not isinstance(id,str) or not id or len(id)>256 or id in seen: continue
            seen.add(id); models.append({'id':id,'name':row.get('display_name') or id})
        if not models: raise ValueError()
    except (ValueError,AttributeError,TypeError): raise ConfigError('服务未返回可识别的模型列表，可手动输入模型 ID。') from None
    return {'models':models,'elapsedMs':ms,'checkedAt':time.strftime('%Y-%m-%dT%H:%M:%S%z'),'source':'remote'}

def substitute(value,model):
    if isinstance(value,dict): return {k:substitute(v,model) for k,v in value.items()}
    if isinstance(value,list): return [substitute(v,model) for v in value]
    return model if value=='$model' else value

def health(p,key):
    h=p.get('extra',{}).get('health')
    if not h: raise ConfigError('未配置连接测试。')
    status,raw,ms=request(p,key,h['path'],h.get('method','GET'),substitute(h.get('body'),p.get('model','')),h.get('timeoutSeconds',20))
    if status!=h.get('expectStatus',200): raise ConfigError('HTTP 状态与连接测试预期不符。')
    # A Responses error may be delivered with HTTP 200.
    try:
        data=json.loads(raw)
        if isinstance(data,dict) and (data.get('error') or data.get('status') in ('failed','cancelled','incomplete')):
            raise ConfigError('服务返回了失败或未完成的模型响应。')
    except (ValueError,UnicodeDecodeError): pass
    return {'ok':True,'status':status,'elapsedMs':ms,'checkedAt':time.strftime('%Y-%m-%dT%H:%M:%S%z'),'message':'配置的连接测试通过；不代表全部 Agent 能力已验证。'}
