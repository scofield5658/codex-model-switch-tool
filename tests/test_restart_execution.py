import unittest,tempfile,json,subprocess
from types import SimpleNamespace
from pathlib import Path
from backend.restart import run
class RestartExecutionTests(unittest.TestCase):
    def test_failed_quit_never_reopens_or_force_kills(self):
        calls=[]
        def runner(args,**kwargs):
            calls.append(args);raise subprocess.CalledProcessError(1,args)
        with tempfile.TemporaryDirectory() as td:
            self.assertFalse(run(td,runner,lambda _:None))
            self.assertEqual(json.loads((Path(td)/'restart-status.json').read_text())['status'],'manual-restart-required')
        self.assertEqual(len(calls),1)
        self.assertEqual(calls[0][0],'/usr/bin/osascript')
    def test_successful_quit_waits_for_exit_before_open(self):
        calls=[]
        def runner(args,**kwargs):
            calls.append(args);return SimpleNamespace(stdout='false')
        with tempfile.TemporaryDirectory() as td:
            self.assertTrue(run(td,runner,lambda _:None))
            self.assertEqual(json.loads((Path(td)/'restart-status.json').read_text())['status'],'launch-requested')
        self.assertEqual(calls[-1],['/usr/bin/open','-b','com.openai.codex'])
        self.assertIn('is running',calls[-2][-1])
