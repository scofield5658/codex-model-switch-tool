import unittest, tempfile, json
from pathlib import Path
from backend.store import Store, ConfigError

CONFIG = '''# keep my settings
model = "gpt-6-astra"
model_reasoning_effort = "low"
[mcp_servers.myserver]
command = "node"
[model_providers.kimi-code-plan-cn]
name = "Kimi Code"
base_url = "https://api.kimi.com/coding/v1"
wire_api = "responses"
experimental_bearer_token = "private-test-key"
'''

class StoreTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.config = self.root/'config.toml'
        self.config.write_text(CONFIG)
        self.store = Store(self.root)
    def draft(self):
        s = self.store.snapshot()
        return {'revision':s['revision'], 'providers':s['providers'], 'selection':s['selection']}
    def test_snapshot_never_discloses_saved_secret(self):
        s = self.store.snapshot()
        self.assertNotIn('private-test-key', json.dumps(s))
        self.assertTrue(s['providers'][0]['keyConfigured'])
    def test_blank_key_preserves_secret_and_unrelated_settings(self):
        d = self.draft(); d['providers'][0]['key']=''
        self.store.save(d)
        text = self.config.read_text()
        self.assertIn('private-test-key', text)
        self.assertIn('# keep my settings', text)
        self.assertIn('[mcp_servers.myserver]', text)
        self.assertEqual(self.config.stat().st_mode & 0o777, 0o600)
    def test_replacement_is_saved_but_never_returned(self):
        d=self.draft(); d['providers'][0]['key']='replacement-secret'
        result=self.store.save(d)
        self.assertIn('replacement-secret',self.config.read_text())
        self.assertNotIn('replacement-secret',json.dumps(result))
    def test_external_edit_rejects_stale_save(self):
        d=self.draft(); self.config.write_text(CONFIG+'\n# external edit\n')
        with self.assertRaises(ConfigError): self.store.save(d)
        self.assertIn('# external edit',self.config.read_text())
    def test_raw_cannot_overwrite_secret_or_inject_commands(self):
        for extra in [{'provider':{'experimental_bearer_token':'bad'}}, {'provider':{'auth':{'command':'evil'}}}]:
            d=self.draft(); d['providers'][0]['extra']=extra
            with self.assertRaises(ConfigError): self.store.save(d)
        self.assertEqual(self.config.read_text(),CONFIG)
    def test_change_origin_cannot_reuse_saved_key_without_confirmation(self):
        d=self.draft(); d['providers'][0]['baseUrl']='https://other.example/v1'
        with self.assertRaises(ConfigError): self.store.save(d)
    def test_switch_and_restore_native_removes_external_overrides(self):
        d=self.draft(); d['selection']={'provider':'kimi-code-plan-cn','model':'k3'}
        d['providers'][0]['extra']['model']={'model_context_window':262144}
        self.store.save(d)
        self.assertIn('model_provider = "kimi-code-plan-cn"',self.config.read_text())
        d=self.draft(); d['selection']={'provider':'openai','model':'gpt-6-astra'}
        self.store.save(d)
        text=self.config.read_text()
        self.assertNotIn('model_provider =',text)
        self.assertNotIn('model_context_window =',text)
        self.assertIn('model_reasoning_effort = "low"',text)
    def test_deletion_requires_explicit_id(self):
        d=self.draft(); d['providers']=[]
        with self.assertRaises(ConfigError): self.store.save(d)
    def test_saved_revision_changes_when_only_health_changes(self):
        d=self.draft(); old=d['revision']
        d['providers'][0]['extra']['health']={'path':'responses','method':'POST','body':{'input':'ping','model':'$model'},'expectStatus':200}
        new=self.store.save(d)
        self.assertNotEqual(old,new['revision'])
    def test_malformed_config_error_does_not_echo_secret(self):
        self.config.write_text('token = "private-test-key\n')
        with self.assertRaises(ConfigError) as cm: self.store.snapshot()
        self.assertNotIn('private-test-key',str(cm.exception))

if __name__=='__main__': unittest.main()

class CatalogTests(unittest.TestCase):
    setUp=StoreTests.setUp
    draft=StoreTests.draft
    def test_selected_external_model_gets_separate_catalog(self):
        d=self.draft(); d['selection']={'provider':'kimi-code-plan-cn','model':'k3'}
        self.store.save(d)
        import tomlkit
        doc=tomlkit.parse(self.config.read_text())
        path=Path(doc['model_catalog_json'])
        catalog=json.loads(path.read_text())
        self.assertEqual(catalog['models'][0]['slug'],'k3')
        self.assertNotIn('private-test-key',path.read_text())
    def test_native_baseline_follows_user_edits_while_native_active(self):
        self.store.save(self.draft())
        self.config.write_text(self.config.read_text().replace('gpt-6-astra','gpt-new'))
        self.store.save(self.draft())
        self.assertIn('gpt-new',self.config.read_text())

class ReviewRegressionTests(unittest.TestCase):
    setUp=StoreTests.setUp
    draft=StoreTests.draft
    def test_empty_native_defaults_can_be_restored(self):
        self.config.write_text(CONFIG.replace('model = "gpt-6-astra"\n','').replace('model_reasoning_effort = "low"\n',''))
        d=self.draft();d['selection']={'provider':'kimi-code-plan-cn','model':'k3'};self.store.save(d)
        d=self.draft();d['selection']={'provider':'openai','model':''};self.store.save(d)
        self.assertNotIn('model_provider =',self.config.read_text())
    def test_editing_safe_headers_keeps_hidden_auth_headers(self):
        self.config.write_text(CONFIG+'[model_providers.kimi-code-plan-cn.http_headers]\nAuthorization="Bearer header-secret"\n')
        d=self.draft();d['providers'][0]['extra']['provider']['http_headers']={'X-Feature':'enabled'}
        self.store.save(d)
        self.assertIn('header-secret',self.config.read_text())
        self.assertIn('X-Feature',self.config.read_text())
    def test_existing_uppercase_provider_can_be_saved(self):
        self.config.write_text(CONFIG.replace('kimi-code-plan-cn','ZAI'))
        self.store.save(self.draft())
        self.assertIn('[model_providers.ZAI]',self.config.read_text())
    def test_invalid_runtime_types_and_enums_never_save(self):
        for extra in [{'provider':{'supports_websockets':'yes'}},{'model':{'model_reasoning_effort':'banana'}},{'model':{'model_reasoning_summary':'banana'}},{'model':{'model_verbosity':'banana'}}]:
            d=self.draft();d['providers'][0]['extra']=extra
            with self.assertRaises(ConfigError): self.store.save(d)
        self.assertEqual(self.config.read_text(),CONFIG)
    def test_existing_active_model_options_survive_noop_save(self):
        self.config.write_text(CONFIG.replace('model = "gpt-6-astra"','model = "k3"\nmodel_provider = "kimi-code-plan-cn"\nmodel_context_window = 262144\nmodel_catalog_json = "/tmp/user-managed-models.json"'))
        self.store.save(self.draft())
        text=self.config.read_text()
        self.assertIn('model_context_window = 262144',text)
        self.assertIn('model_reasoning_effort = "low"',text)
        self.assertIn('/tmp/user-managed-models.json',text)
    def test_interrupted_state_commit_recovers_consistently(self):
        from unittest.mock import patch
        import backend.store as module
        real=module.atomic
        def interrupt(path,text):
            if path==self.store.statepath: raise OSError('fixture interrupted write')
            return real(path,text)
        d=self.draft();d['selection']={'provider':'kimi-code-plan-cn','model':'k3'}
        with patch.object(module,'atomic',side_effect=interrupt):
            with self.assertRaises(OSError): self.store.save(d)
        recovered=Store(self.root).snapshot()
        self.assertEqual(recovered['selection'],{'provider':'kimi-code-plan-cn','model':'k3'})
        self.assertEqual(recovered['nativeModel'],'gpt-6-astra')
        self.assertFalse((self.store.dir/'transaction.json').exists())
