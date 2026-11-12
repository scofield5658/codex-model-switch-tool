import unittest
from backend.restart import restart_plan
from backend.store import ConfigError
class RestartTests(unittest.TestCase):
    def test_requires_explicit_idle_confirmation(self):
        with self.assertRaises(ConfigError): restart_plan(False, 'darwin')
    def test_non_macos_returns_manual_guidance(self):
        with self.assertRaises(ConfigError): restart_plan(True, 'linux')
    def test_plan_uses_graceful_quit_and_correct_bundle(self):
        p=restart_plan(True,'darwin')
        self.assertEqual(p['bundleId'],'com.openai.codex')
        self.assertFalse(p['forceKill'])
