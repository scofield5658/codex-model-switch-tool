"""Preserve user TOML; only explicit saves modify it. Never return saved credentials."""
import copy
import os
import sys
import hashlib
import json
import re
import tempfile
import time
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import urlsplit
import tomlkit
from .artifacts import Artifacts, provider_references
from .capabilities import LEVELS, capability, effective_effort, validate_capabilities

if os.name == "nt":
    import msvcrt
else:
    import fcntl

_MESSAGES = json.loads((Path(__file__).resolve().parent.parent/'locales/messages.json').read_text(encoding='utf-8'))
_MESSAGE_CODES = {row['zh-Hans']: code for code, row in _MESSAGES.items()}

class ConfigError(Exception):
    def __init__(self, message, code=None, params=None):
        super().__init__(message)
        self.code = code or _MESSAGE_CODES.get(message, 'operationFailed')
        self.params = params or {}

RESERVED = {'openai', 'ollama', 'lmstudio', 'amazon-bedrock', 'amazon-bedrock-runtime', 'gcp'}
MODEL_KEYS = {'model_reasoning_effort', 'model_reasoning_summary', 'model_context_window', 'model_auto_compact_token_limit', 'model_verbosity'}
TOP_KEYS = MODEL_KEYS | {'model', 'model_provider', 'model_catalog_json'}
PROVIDER_KEYS = {'wire_api', 'request_max_retries', 'stream_max_retries', 'stream_idle_timeout_ms', 'http_headers', 'model_catalog_url', 'supports_websockets'}
DEFAULTS = {
    'deepseek': ('DeepSeek', 'https://api.deepseek.com', ''),
    'kimi-code-plan-cn': ('Kimi Code', 'https://api.kimi.com/coding/v1', 'k3'),
    'moonshotai-cn': ('Moonshot', 'https://api.moonshot.cn/v1', 'kimi-k3'),
    'bigmodel-cn': ('BigModel（智谱中国）', 'https://open.bigmodel.cn/api/v1', ''),
    'zai-coding-plan': ('Z.AI Coding Plan', 'https://api.z.ai/api/v1', 'glm-5.3'),
}

def digest(text):
    return hashlib.sha256(text.encode()).hexdigest()

def atomic(path, text):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    # Windows files inherit the private staging directory ACL; rename preserves it.
    # Python 3.12.13 applies owner/administrator access for mkdir(mode=0o700).
    with tempfile.TemporaryDirectory(dir=path.parent, prefix='.write-') as staging:
        fd, temp = tempfile.mkstemp(dir=staging)
        with os.fdopen(fd, 'w', encoding='utf-8', newline='') as out:
            if os.name != 'nt': os.fchmod(out.fileno(), 0o600)
            out.write(text); out.flush(); os.fsync(out.fileno())
        os.replace(temp, path)

def origin(url):
    u = urlsplit(url)
    if u.scheme not in ('https', 'http') or not u.hostname or u.username or u.password or u.fragment or u.query:
        raise ConfigError('地址必须是无凭证、无查询参数的 HTTP(S) URL。')
    if u.scheme == 'http' and u.hostname not in ('localhost', '127.0.0.1', '::1'):
        raise ConfigError('非本机服务必须使用 HTTPS。')
    return (u.scheme, u.hostname, u.port or (443 if u.scheme=='https' else 80))

def validate_extra(extra):
    if not isinstance(extra, dict) or set(extra)-{'provider','model','discovery','health','model_capabilities'}:
        raise ConfigError('Raw Data 只支持 provider、model、discovery、health、model_capabilities。')
    validate_capabilities(extra.get('model_capabilities', {}))
    p=extra.get('provider', {}); m=extra.get('model', {})
    if not isinstance(p,dict) or set(p)-PROVIDER_KEYS or not isinstance(m,dict) or set(m)-MODEL_KEYS:
        raise ConfigError('Raw Data 包含不支持的字段；凭证和认证命令不能在这里编辑。')
    if p.get('wire_api','responses')!='responses': raise ConfigError('当前仅支持 Responses 协议。')
    if 'supports_websockets' in p and type(p['supports_websockets']) is not bool: raise ConfigError('supports_websockets 必须为布尔值。')
    if 'model_catalog_url' in p and (not isinstance(p['model_catalog_url'],str) or not p['model_catalog_url']): raise ConfigError('model_catalog_url 必须为非空地址。')
    headers=p.get('http_headers',{})
    if not isinstance(headers,dict) or any(not isinstance(k,str) or not isinstance(v,str) or not re.fullmatch(r'[A-Za-z0-9-]+',k) or re.search(r'auth|key|token|cookie|secret|host|content-length', k, re.I) or '\n' in v or '\r' in v for k,v in headers.items()):
        raise ConfigError('自定义请求头不能包含凭证、Host 或换行。')
    for k,v in p.items():
        if k.endswith(('_ms','_retries')) and (type(v)!=int or v<0 or v>300000): raise ConfigError('超时和重试参数必须是合理的非负整数。')
    for k in ('model_context_window','model_auto_compact_token_limit'):
        if k in m and (type(m[k])!=int or m[k]<=0): raise ConfigError('上下文参数必须为正整数。')
    for k in ('model_reasoning_effort','model_reasoning_summary','model_verbosity'):
        if k in m and not isinstance(m[k],str): raise ConfigError('模型选项必须为字符串。')
    enums={'model_reasoning_effort':set(LEVELS),'model_reasoning_summary':{'auto','concise','detailed','none'},'model_verbosity':{'low','medium','high'}}
    for k,allowed in enums.items():
        if k in m and m[k] not in allowed: raise ConfigError(k+' 取值无效。', 'modelOptionInvalid', {'field': k})
    if m.get('model_context_window') and m.get('model_auto_compact_token_limit',0)>=m['model_context_window']:
        raise ConfigError('自动压缩阈值必须小于上下文窗口。')
    d=extra.get('discovery',{})
    if not isinstance(d,dict) or set(d)-{'url'} or not isinstance(d.get('url',''),str): raise ConfigError('discovery 仅支持 url。')
    h=extra.get('health')
    if h is not None:
        if not isinstance(h,dict) or set(h)-{'path','method','body','expectStatus','timeoutSeconds'}: raise ConfigError('连接测试配置字段无效。')
        if not isinstance(h.get('path'),str) or not h['path']: raise ConfigError('连接测试需要 path。')
        if h.get('method','GET') not in ('GET','POST'): raise ConfigError('连接测试仅支持 GET/POST。')
        if type(h.get('expectStatus',200))!=int or not 200<=h.get('expectStatus',200)<400: raise ConfigError('成功状态码无效。')
        if type(h.get('timeoutSeconds',20)) not in (int,float) or not 1<=h.get('timeoutSeconds',20)<=60: raise ConfigError('测试超时应在 1–60 秒之间。')
    if len(json.dumps(extra))>64000: raise ConfigError('Raw Data 过大。')
    return copy.deepcopy(extra)

class Store:
    def __init__(self, home=None):
        self.home=Path(home or os.environ.get('CODEX_HOME') or Path.home()/'.codex')
        self.path=self.home/'config.toml'
        self.dir=self.home/'model-switcher'
        self.statepath=self.dir/'state.json'
    @contextmanager
    def locked(self):
        self.dir.mkdir(parents=True,exist_ok=True,mode=0o700)
        with open(self.dir/'lock','a+b') as lock:
            if os.name == 'nt':
                if lock.seek(0, os.SEEK_END) == 0:
                    lock.write(b'\0'); lock.flush()
                lock.seek(0)
                msvcrt.locking(lock.fileno(), msvcrt.LK_LOCK, 1)
            else:
                os.chmod(self.dir/'lock',0o600)
                fcntl.flock(lock,fcntl.LOCK_EX)
            try:
                yield
            finally:
                if os.name == 'nt':
                    lock.seek(0)
                    msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)
                else:
                    fcntl.flock(lock,fcntl.LOCK_UN)
    def _read(self):
        text=self.path.read_text(encoding='utf-8') if self.path.exists() else ''
        try: doc=tomlkit.parse(text)
        except Exception: raise ConfigError('config.toml 格式错误，未读取或修改；请在本地修复。') from None
        journal=self.dir/'transaction.json'
        if journal.exists():
            tx=json.loads(journal.read_text(encoding='utf-8'))
            if digest(text)==tx['nextHash']:
                atomic(self.statepath,json.dumps(tx['state'],ensure_ascii=False,indent=2))
            elif digest(text)!=tx['oldHash']:
                raise ConfigError('上次保存中断且配置已被其他程序修改，请从备份人工核对。')
            journal.unlink()
        try: state=json.loads(self.statepath.read_text(encoding='utf-8')) if self.statepath.exists() else {}
        except Exception: raise ConfigError('插件状态文件损坏，请先恢复插件状态备份。') from None
        return text,doc,state
    def snapshot(self):
        with self.locked():
            return self._snapshot(*self._read())
    def _cached(self,id,p):
        credential=p.get('experimental_bearer_token') or os.environ.get(p.get('env_key',''),'')
        path=self.dir/'catalogs'/(digest(id+p.get('base_url','').rstrip('/')+credential)+'.json')
        try: return json.loads(path.read_text(encoding='utf-8')) if path.exists() else {}
        except (ValueError,OSError): return {}
    def _write_catalog(self,id,entry,model,extra):
        model_options=extra.get('model',{})
        cached=self._cached(id,entry)
        rows=cached.get('models',[])
        ids=list(dict.fromkeys([model]+[r['id'] for r in rows]+list(extra.get('model_capabilities',{}))))
        catalog={'models':[]}
        for slug in ids:
            item={'slug':slug,'display_name':slug,'base_instructions':'You are a coding assistant. Follow the user instructions and use available tools to complete tasks.',
                'supported_reasoning_levels':[],'shell_type':'shell_command','visibility':'list','supported_in_api':True,
                'priority':len(catalog['models']),'support_verbosity':False,'truncation_policy':{'mode':'tokens','limit':10000},'experimental_supported_tools':[]}
            cap=capability(entry['base_url'],slug,extra)
            if cap is not None:
                item['supported_reasoning_levels']=[{'effort':level,'description':level} for level in cap['reasoning_levels']]
                if cap.get('default_reasoning_level'):
                    item['default_reasoning_level']=cap['default_reasoning_level']
            if slug==model and model_options.get('model_context_window'):
                item['context_window']=model_options['model_context_window']
            catalog['models'].append(item)
        content=json.dumps(catalog,ensure_ascii=False,indent=2)
        path=self.dir/'generated'/(id+'-'+digest(content)[:16]+'.json')
        Artifacts(self.dir).write(path,content,id)
        return str(path)
    def _snapshot(self,text,doc,state):
        providers=[]
        for id,p in doc.get('model_providers',{}).items():
            if id in RESERVED: continue
            meta=state.get('providers',{}).get(id,{})
            cached=self._cached(id,p)
            extra=copy.deepcopy(meta.get('extra',{'provider':{},'model':{},'discovery':{},'health':None}))
            if doc.get('model_provider','openai')==id:
                configured_effort=extra.get('model',{}).get('model_reasoning_effort')
                extra['model']={k:copy.deepcopy(doc[k].unwrap() if hasattr(doc[k],'unwrap') else doc[k]) for k in MODEL_KEYS if k in doc}
                cap=capability(p.get('base_url',''),doc.get('model',''),extra)
                if 'extra' in meta and configured_effort is None and cap and extra['model'].get('model_reasoning_effort')==cap.get('default_reasoning_level'):
                    extra['model'].pop('model_reasoning_effort',None)
            extra['provider']={k:copy.deepcopy(p[k].unwrap() if hasattr(p[k],'unwrap') else p[k]) for k in PROVIDER_KEYS if k in p and k!='http_headers'}
            # Do not expose existing headers: may contain credentials under arbitrary names.
            suggested=DEFAULTS.get(id,('', '', ''))[2]
            model=doc.get('model','') if doc.get('model_provider','openai')==id else meta.get('model',suggested)
            providers.append({'id':id,'name':p.get('name',id),'baseUrl':p.get('base_url',''),'model':model,'keyConfigured':bool(p.get('experimental_bearer_token') or p.get('env_key') or p.get('auth') or p.get('requires_openai_auth')),'referencedElsewhere':id in provider_references({k:v for k,v in doc.items() if k!='model_provider'}, {id}),'authEditable':not bool(p.get('auth') or p.get('requires_openai_auth')),'extra':extra,'models':cached.get('models',[]),'modelsAt':cached.get('checkedAt'), 'authSource':'环境变量' if p.get('env_key') else '已保存凭证'})
        baseline=({k:doc[k] for k in TOP_KEYS if k in doc} if doc.get('model_provider','openai')=='openai' else state.get('native'))
        return {'revision':digest(text+'\0'+json.dumps(state,sort_keys=True)), 'providers':providers,
            'selection':{'provider':doc.get('model_provider','openai'),'model':doc.get('model','')},
            'nativeModel':(baseline or {}).get('model',''), 'nativeAvailable':baseline is not None,
            'canRestart':sys.platform == 'darwin','runtimeStatus':'unknown','savedAt':state.get('savedAt'), 'templates':[{'id':k,'name':v[0],'baseUrl':v[1],'model':v[2]} for k,v in DEFAULTS.items()]}
    def _provider(self,p,doc):
        if not isinstance(p,dict): raise ConfigError('提供商格式错误。')
        id=p.get('id','')
        if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,63}',id) or id in RESERVED: raise ConfigError('Provider ID 无效或保留。')
        if not isinstance(p.get('name'),str) or not p['name'].strip(): raise ConfigError('名称不能为空。')
        url=p.get('baseUrl','').rstrip('/'); origin(url)
        if not isinstance(p.get('model',''),str): raise ConfigError('模型 ID 无效。')
        extra=validate_extra(p.get('extra',{}))
        key=p.get('key','')
        if not isinstance(key,str) or len(key)>16000 or '\n' in key or '\r' in key: raise ConfigError('Key 格式无效。')
        old=doc.get('model_providers',{}).get(id,{})
        if key and (old.get('auth') or old.get('requires_openai_auth')): raise ConfigError('该提供商采用其他认证方式，不能在此替换 Key。')
        if old.get('base_url') and origin(url)!=origin(old['base_url']) and not key and not p.get('confirmOriginChange',False):
            raise ConfigError('接入域名已改变，请明确确认后才能沿用已保存凭证。')
        # Catalog URLs receive auth in Codex itself; constrain them too.
        for remote in (extra.get('provider',{}).get('model_catalog_url'),extra.get('discovery',{}).get('url')):
            if remote and origin(remote)!=origin(url): raise ConfigError('模型目录必须与接入地址同源。')
        return id,url,extra,key
    def resolve(self,p):
        """Return credentials exclusively to local backend callers, never over MCP."""
        with self.locked():
            _,doc,_=self._read(); id,url,extra,key=self._provider(p,doc)
            old=doc.get('model_providers',{}).get(id,{})
            if old.get('auth') or old.get('requires_openai_auth') or old.get('env_http_headers'): raise ConfigError('该认证方式暂不支持插件直接测试。')
            credential=key or old.get('experimental_bearer_token') or os.environ.get(old.get('env_key',''),'')
            headers=dict(old.get('http_headers',{}))
            headers.update(extra.get('provider',{}).get('http_headers',{}))
            if not credential and not any(re.search(r'auth|key|token',h,re.I) for h in headers): raise ConfigError('未配置可用 Key，或插件进程未读取到对应环境变量。')
            return {'id':id,'baseUrl':url,'model':p.get('model',''),'extra':extra,'headers':headers,'_configured':id in doc.get('model_providers',{})},credential
    def _desktop_reasoning(self,doc,state,levels):
        key='enabled-reasoning-efforts'
        desktop=doc.get('desktop',{})
        current=list(desktop[key]) if key in desktop else None
        previous=state.pop('desktopReasoning',None)
        if previous and current==previous['applied']:
            if previous['before'] is None:
                del desktop[key]
                if not desktop: doc.pop('desktop',None)
            else: desktop[key]=previous['before']
            current=previous['before']
        if not levels: return
        # Preserve existing visibility choices; only add levels this catalog needs.
        baseline=current if current is not None else ['low','medium','high','xhigh','ultra','persistent']
        applied=list(dict.fromkeys(baseline+levels))
        if applied!=current:
            doc.setdefault('desktop',tomlkit.table())[key]=applied
            state['desktopReasoning']={'before':current,'applied':applied}

    def save(self,payload):
        with self.locked():
            text,doc,state=self._read()
            snap=self._snapshot(text,doc,state)
            if payload.get('revision')!=snap['revision']: raise ConfigError('配置已被其他窗口或程序修改，请重新加载后再保存。')
            items=payload.get('providers')
            if not isinstance(items,list) or len(items)>100: raise ConfigError('提供商列表格式错误。')
            ids=[p.get('id') for p in items]
            if len(set(ids))!=len(ids): raise ConfigError('Provider ID 重复。')
            existing={p['id'] for p in snap['providers']}
            deleted=set(payload.get('deletedIds',[]))
            if existing-set(ids)!=deleted: raise ConfigError('删除提供商必须明确确认。')
            selection=payload.get('selection',{}); target=selection.get('provider')
            if target not in set(ids)|RESERVED: raise ConfigError('请选择存在的默认提供商。')
            if target!=snap['selection']['provider'] and target in RESERVED-{'openai'}: raise ConfigError('本插件仅管理内置 OpenAI 和自定义提供商。')
            if doc.get('model_provider','openai')=='openai':
                state['native']={k:copy.deepcopy(doc[k].unwrap() if hasattr(doc[k],'unwrap') else doc[k]) for k in TOP_KEYS if k in doc}
            state.setdefault('providers',{})
            provider_table=doc.setdefault('model_providers',tomlkit.table())
            for id in deleted:
                del provider_table[id]; state['providers'].pop(id,None)
            for p in items:
                id,url,extra,key=self._provider(p,doc)
                entry=provider_table.setdefault(id,tomlkit.table())
                entry['name']=p['name']; entry['base_url']=url
                # Known visible fields replace their previous values. Hidden headers/auth survive.
                for k in PROVIDER_KEYS-{'http_headers'}:
                    if k in entry and k not in extra.get('provider',{}): del entry[k]
                for k,v in extra.get('provider',{}).items():
                    if k=='http_headers':
                        headers=entry.setdefault(k,tomlkit.table())
                        for header,value in v.items(): headers[header]=value
                    else: entry[k]=v
                entry.setdefault('wire_api','responses')
                if key:
                    entry['experimental_bearer_token']=key
                    if 'env_key' in entry: del entry['env_key']
                oldmeta=state['providers'].get(id,{})
                state['providers'][id]={**oldmeta,'model':p.get('model',''),'extra':extra}
            desktop_levels=[]
            if target=='openai':
                if 'native' not in state: raise ConfigError('尚未记录原始 GPT 配置，不能自动恢复。')
                for k in TOP_KEYS:
                    if k in doc: del doc[k]
                for k,v in state['native'].items(): doc[k]=v
            elif target not in RESERVED:
                picked=next(p for p in items if p['id']==target)
                model=selection.get('model') or picked.get('model')
                if not isinstance(model,str) or not model.strip(): raise ConfigError('请选择默认模型。')
                effort=effective_effort(picked['baseUrl'],model,picked.get('extra',{}))
                existing_catalog=doc.get('model_catalog_json') if snap['selection']['provider']==target else None
                for k in MODEL_KEYS|{'model_catalog_json'}:
                    if k in doc: del doc[k]
                doc['model_provider']=target; doc['model']=model
                state['providers'][target]['model']=model
                for k,v in picked.get('extra',{}).get('model',{}).items(): doc[k]=v
                if effort is not None: doc['model_reasoning_effort']=effort
                if not picked.get('extra',{}).get('provider',{}).get('model_catalog_url'):
                    if existing_catalog and Path(existing_catalog).parent.resolve()!=(self.dir/'generated').resolve():
                        doc['model_catalog_json']=existing_catalog
                    else:
                        doc['model_catalog_json']=self._write_catalog(target,provider_table[target],model,picked.get('extra',{}))
                        catalog=json.loads(Path(doc['model_catalog_json']).read_text(encoding='utf-8'))
                        desktop_levels=list(dict.fromkeys(r['effort'] for m in catalog['models'] for r in m['supported_reasoning_levels']))
            self._desktop_reasoning(doc,state,desktop_levels)
            nexttext=tomlkit.dumps(doc)
            # Parsing twice catches unsupported data types before committing.
            tomlkit.parse(nexttext)
            state['savedAt']=time.strftime('%Y-%m-%dT%H:%M:%S%z')
            backup=self.dir/'backups'/str(time.time_ns())
            atomic(backup.with_suffix('.toml'),text)
            if self.statepath.exists(): atomic(backup.with_suffix('.json'),self.statepath.read_text(encoding='utf-8'))
            tx={'oldHash':digest(text),'nextHash':digest(nexttext),'state':state}
            atomic(self.dir/'transaction.json',json.dumps(tx,ensure_ascii=False))
            # Recheck immediately before commit; plugin instances also share an advisory lock.
            current=self.path.read_text(encoding='utf-8') if self.path.exists() else ''
            if current!=text:
                (self.dir/'transaction.json').unlink()
                raise ConfigError('保存期间配置发生变化，已停止写入。')
            atomic(self.path,nexttext)
            atomic(self.statepath,json.dumps(state,ensure_ascii=False,indent=2))
            (self.dir/'transaction.json').unlink()
            result=self._snapshot(nexttext,doc,state)
            if deleted:
                # Cleanup is best effort and only follows a fully committed save.
                try:
                    if self.path.read_text(encoding='utf-8')==nexttext:
                        result['warnings']=Artifacts(self.dir).cleanup(deleted,doc,state)
                    else:
                        result['warnings']=['deletionFilesRetained']
                except (OSError, ValueError, RuntimeError):
                    result['warnings']=['deletionFilesRetained']
            return result
