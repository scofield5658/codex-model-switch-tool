import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from backend.store import Store, atomic

class PortabilityTests(unittest.TestCase):
    def test_snapshot_reports_restart_capability(self):
        with tempfile.TemporaryDirectory() as td:
            self.assertEqual(Store(td).snapshot()['canRestart'], sys.platform == 'darwin')

    def test_atomic_unicode_roundtrip_and_cleanup(self):
        with tempfile.TemporaryDirectory(prefix='模型 空格 ') as td:
            path = Path(td)/'配置.toml'
            atomic(path, 'name = "繁體中文 😀"\n')
            self.assertEqual(path.read_bytes(), 'name = "繁體中文 😀"\n'.encode('utf-8'))
            self.assertEqual(list(Path(td).iterdir()), [path])

    def test_lock_released_after_exception_and_serializes_processes(self):
        with tempfile.TemporaryDirectory() as td:
            store = Store(td)
            with self.assertRaises(ValueError):
                with store.locked(): raise ValueError('fixture')
            with store.locked():
                child = subprocess.Popen([sys.executable, '-c', 'from backend.store import Store; import sys; s=Store(sys.argv[1]); print("ready",flush=True);\nwith s.locked(): print("acquired",flush=True)', td], stdout=subprocess.PIPE, text=True)
                try:
                    self.assertEqual(child.stdout.readline().strip(), 'ready')
                    with self.assertRaises(subprocess.TimeoutExpired): child.wait(timeout=.2)
                finally:
                    pass
            try:
                out,_ = child.communicate(timeout=5)
                self.assertEqual(out.strip(), 'acquired')
                self.assertEqual(child.returncode, 0)
            finally:
                if child.poll() is None: child.kill(); child.wait()

    @unittest.skipUnless(os.name == 'nt', 'Windows ACL check')
    def test_windows_written_secret_has_no_broad_read_acl(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td)/'config.toml'
            atomic(path, 'key = "fixture"')
            command = "$ErrorActionPreference='Stop'; $a=[System.IO.File]::GetAccessControl($env:ACL_TEST_FILE); $a.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier]) | ForEach-Object { $_.IdentityReference.Value }"
            result = subprocess.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', command], env={**os.environ, 'ACL_TEST_FILE': str(path)}, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            sids = set(result.stdout.split())
            self.assertTrue(sids, result.stderr)
            self.assertFalse(sids & {'S-1-1-0', 'S-1-5-11', 'S-1-5-32-545'})
