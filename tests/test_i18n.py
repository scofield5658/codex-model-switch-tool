import ast
import json
import re
import subprocess
import sys
import tempfile
import os
import unittest
from pathlib import Path
from backend.store import ConfigError

ROOT = Path(__file__).resolve().parent.parent

class I18nTests(unittest.TestCase):
    def test_catalogs_have_matching_parameters_and_all_backend_errors(self):
        catalog=json.loads((ROOT/'locales/messages.json').read_text())
        sources={entry['zh-Hans'] for entry in catalog.values()}
        for key,entry in catalog.items():
            self.assertEqual(set(entry), {'en','zh-Hans','zh-Hant'},key)
            parameters=[set(re.findall(r'\{(\w+)\}',value)) for value in entry.values()]
            self.assertTrue(all(p==parameters[0] for p in parameters),key)
        for path in (ROOT/'backend').glob('*.py'):
            for node in ast.walk(ast.parse(path.read_text())):
                if isinstance(node,ast.Call) and isinstance(node.func,ast.Name) and node.func.id=='ConfigError' and node.args and isinstance(node.args[0],ast.Constant):
                    self.assertIn(node.args[0].value,sources,path.name)
    def test_error_code_preserves_existing_message(self):
        error=ConfigError('名称不能为空。')
        self.assertEqual(str(error),'名称不能为空。')
        self.assertEqual(error.code,'nameRequired')
        self.assertEqual(error.params,{})
    def test_command_error_envelope_adds_code_without_removing_error(self):
        with tempfile.TemporaryDirectory() as directory:
            result=subprocess.run([sys.executable,'-m','backend.main'],input=json.dumps({'command':'unknown'}),text=True,capture_output=True,check=True,cwd=ROOT,env={**os.environ,'CODEX_HOME':directory})
        data=json.loads(result.stdout)
        self.assertEqual(data,{'ok':False,'error':'未知操作。','errorCode':'unknownOperation','errorParams':{}})
