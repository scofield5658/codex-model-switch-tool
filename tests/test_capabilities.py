import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from backend.store import Store, ConfigError, validate_extra
from backend.network import health

class CapabilityTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name)
        (self.root/'config.toml').write_text('model="gpt-test"\nmodel_reasoning_effort="medium"\n[model_providers.demo]\nname="Demo"\nbase_url="https://api.moonshot.cn/v1"\n')
        self.store=Store(self.root)
    def draft(self):
        s=self.store.snapshot()
        return {**s,'selection':{'provider':'demo','model':'kimi-k3'}}
    def test_official_k3_catalog_and_default(self):
        d=self.draft(); d['providers'][0]['model']='kimi-k3'
        self.store.save(d)
        import tomlkit
        config=tomlkit.parse((self.root/'config.toml').read_text())
        self.assertEqual(config['model_reasoning_effort'],'max')
        row=json.loads(Path(config['model_catalog_json']).read_text())['models'][0]
        self.assertEqual([r['effort'] for r in row['supported_reasoning_levels']],['low','high','max'])
        self.assertEqual(row['default_reasoning_level'],'max')
    def test_k3_none_rejected_before_write(self):
        d=self.draft(); d['providers'][0]['model']='kimi-k3'; d['providers'][0]['extra']['model']={'model_reasoning_effort':'none'}
        before=(self.root/'config.toml').read_text()
        with self.assertRaises(ConfigError): self.store.save(d)
        self.assertEqual((self.root/'config.toml').read_text(),before)
    def test_custom_model_and_native_restore(self):
        d=self.draft(); p=d['providers'][0]; p['baseUrl']='https://custom.example/v1'; p['confirmOriginChange']=True; p['model']='custom'
        d['selection']['model']='custom'
        p['extra']['model_capabilities']={'custom':{'reasoning_levels':['medium','high'],'default_reasoning_level':'high'}}
        self.store.save(d)
        import tomlkit
        config=tomlkit.parse((self.root/'config.toml').read_text())
        self.assertEqual(config['model_reasoning_effort'],'high')
        s=self.store.snapshot(); self.store.save({**s,'selection':{'provider':'openai'}})
        config=tomlkit.parse((self.root/'config.toml').read_text())
        self.assertEqual(config['model_reasoning_effort'],'medium')
        self.assertNotIn('model_catalog_json',config)
    def test_bad_capability_schemas(self):
        for cap in [[],{'m':{'reasoning_levels':['bogus']}},{'m':{'reasoning_levels':['high'],'default_reasoning_level':'low'}},{'m':{'reasoning_levels':['high','high']}},{'m':{'reasoning_levels':['high'],'arbitrary':True}}]:
            with self.subTest(cap=cap), self.assertRaises(ConfigError): validate_extra({'model_capabilities':cap})
    def test_health_uses_same_default_and_rejects_conflict(self):
        p={'baseUrl':'https://api.moonshot.cn/v1','model':'kimi-k3','extra':{'health':{'path':'responses','method':'POST','body':{'model':'$model','input':'OK'}}}}
        with patch('backend.network.request',return_value=(200,b'{}',1)) as req:
            health(p,'fixture')
            self.assertEqual(req.call_args.args[4]['reasoning']['effort'],'max')
            p['extra']['health']['body']['reasoning']={'effort':'none'}
            with self.assertRaises(ConfigError): health(p,'fixture')
            self.assertEqual(req.call_count,1)
    def test_bigmodel_template(self):
        self.assertIn('https://open.bigmodel.cn/api/v1',[t['baseUrl'] for t in self.store.snapshot()['templates']])

    def test_desktop_visibility_restored_and_unrelated_fields_preserved(self):
        with (self.root/'config.toml').open('a') as f: f.write('\n[desktop]\nother=true\nenabled-reasoning-efforts=["medium"]\n')
        d=self.draft(); d['providers'][0]['model']='kimi-k3'; self.store.save(d)
        import tomlkit
        config=tomlkit.parse((self.root/'config.toml').read_text())
        self.assertEqual(list(config['desktop']['enabled-reasoning-efforts']),['medium','low','high','max'])
        self.assertTrue(config['desktop']['other'])
        d=self.store.snapshot(); self.store.save({**d,'selection':{'provider':'openai'}})
        config=tomlkit.parse((self.root/'config.toml').read_text())
        self.assertEqual(list(config['desktop']['enabled-reasoning-efforts']),['medium'])
        self.assertTrue(config['desktop']['other'])

    def test_presets_do_not_apply_to_same_model_on_unknown_endpoint(self):
        from backend.capabilities import capability
        self.assertIsNone(capability('https://custom.example/v1','kimi-k3',{}))
        self.assertIsNone(capability('https://api.moonshot.cn/other','kimi-k3',{}))
        self.assertIsNone(capability('https://api.moonshot.cn/v1','unknown',{}))
        override={'model_capabilities':{'kimi-k3':{'reasoning_levels':['high'],'default_reasoning_level':'high'}}}
        self.assertEqual(capability('https://api.moonshot.cn/v1','kimi-k3',override)['reasoning_levels'],['high'])

    def test_unselected_invalid_effort_does_not_block_saving_native(self):
        d=self.draft();d['selection']={'provider':'openai'}
        d['providers'][0]['model']='kimi-k3';d['providers'][0]['extra']['model']={'model_reasoning_effort':'none'}
        self.store.save(d)
        self.assertEqual(self.store.snapshot()['selection']['provider'],'openai')

    def test_default_remains_implicit_after_save_and_catalog_is_regenerated(self):
        d=self.draft(); d['providers'][0]['model']='kimi-k3'
        self.store.save(d)
        d=self.store.snapshot()
        self.assertNotIn('model_reasoning_effort',d['providers'][0]['extra']['model'])
        p=d['providers'][0];p['extra']['model_capabilities']={'kimi-k3':{'reasoning_levels':['high'],'default_reasoning_level':'high'}}
        result=self.store.save(d)
        self.assertNotIn('model_reasoning_effort',result['providers'][0]['extra']['model'])
        import tomlkit
        config=tomlkit.parse((self.root/'config.toml').read_text())
        self.assertEqual(config['model_reasoning_effort'],'high')
        row=json.loads(Path(config['model_catalog_json']).read_text())['models'][0]
        self.assertEqual(row['supported_reasoning_levels'],[{'effort':'high','description':'high'}])

    def test_empty_capability_rejects_reasoning_in_health_body(self):
        p={'baseUrl':'https://custom.example/v1','model':'plain','extra':{'model_capabilities':{'plain':{'reasoning_levels':[]}},'health':{'path':'responses','method':'POST','body':{'model':'plain','reasoning':{'effort':'high'}}}}}
        with patch('backend.network.request') as req:
            with self.assertRaises(ConfigError): health(p,'fixture')
            req.assert_not_called()

    def test_external_desktop_edits_are_preserved_on_restore(self):
        d=self.draft();d['providers'][0]['model']='kimi-k3';self.store.save(d)
        import tomlkit
        config=tomlkit.parse((self.root/'config.toml').read_text());config['desktop']['enabled-reasoning-efforts']=['low']
        (self.root/'config.toml').write_text(tomlkit.dumps(config))
        d=self.store.snapshot();self.store.save({**d,'selection':{'provider':'openai'}})
        config=tomlkit.parse((self.root/'config.toml').read_text())
        self.assertEqual(list(config['desktop']['enabled-reasoning-efforts']),['low'])

    def test_deepseek_template_and_reasoning_presets(self):
        from backend.capabilities import capability
        template=next(t for t in self.store.snapshot()['templates'] if t['id']=='deepseek')
        self.assertEqual(template['baseUrl'],'https://api.deepseek.com')
        self.assertEqual(template['model'],'')
        for model in ['deepseek-flash','deepseek-v4-pro']:
            self.assertEqual(capability(template['baseUrl'],model,{}),{'reasoning_levels':['low','high','max'],'default_reasoning_level':'high'})
            self.assertIsNone(capability('https://third-party.example/v1',model,{}))
        self.assertIsNone(capability(template['baseUrl'],'deepseek-chat',{}))
