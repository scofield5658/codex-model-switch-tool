"""Deletion only removes explicitly owned, unchanged, unreferenced artifacts."""
import json
import unittest
from pathlib import Path
from unittest.mock import patch
import tomlkit
from backend.store import Store, ConfigError
from backend.main import execute
from tests import test_store


class DeletionTests(unittest.TestCase):
    setUp = test_store.StoreTests.setUp
    draft = test_store.StoreTests.draft

    def cache(self):
        provider = self.draft()['providers'][0]
        with patch.dict('os.environ', {'CODEX_HOME': str(self.root)}), patch(
            'backend.main.discover', return_value={'models': [{'id': 'k3'}]}
        ):
            execute('discover', {'provider': provider})
        return next((self.store.dir / 'catalogs').glob('*.json'))

    def delete(self):
        d = self.draft()
        d.update(providers=[], deletedIds=['kimi-code-plan-cn'])
        return self.store.save(d)

    def test_delete_cleans_owned_cache_but_preserves_secrets_in_backups(self):
        cache = self.cache()
        self.delete()
        self.assertFalse(cache.exists())
        self.assertNotIn('private-test-key', self.config.read_text())
        self.assertIn('myserver', tomlkit.parse(self.config.read_text())['mcp_servers'])
        self.assertTrue(any('private-test-key' in p.read_text() for p in (self.store.dir/'backups').glob('*.toml')))
        self.assertNotIn('kimi-code-plan-cn', json.loads(self.store.statepath.read_text())['providers'])
        self.store.save(self.draft())  # repeated save is safe

    def test_profile_reference_is_preserved_and_reported(self):
        cache = self.cache()
        self.config.write_text(self.config.read_text()+'\n[profiles.shared]\nmodel_provider="kimi-code-plan-cn"\n')
        result = self.delete()
        self.assertTrue(cache.exists())
        self.assertEqual(tomlkit.parse(self.config.read_text())['profiles']['shared']['model_provider'], 'kimi-code-plan-cn')
        self.assertIn('deletionReferencesRetained', result.get('warnings', []))

    def test_modified_and_untracked_files_are_not_removed(self):
        cache = self.cache()
        cache.write_text('user modified')
        untracked = cache.with_name('untracked.json'); untracked.write_text('external')
        result = self.delete()
        self.assertEqual(cache.read_text(), 'user modified')
        self.assertEqual(untracked.read_text(), 'external')
        self.assertIn('deletionFilesRetained', result.get('warnings', []))

    def test_missing_cache_does_not_fail_deletion(self):
        self.cache().unlink()
        self.delete()
        self.assertEqual(self.store.snapshot()['providers'], [])

    def test_stale_save_never_deletes_files(self):
        cache = self.cache()
        d = self.draft(); d.update(providers=[], deletedIds=['kimi-code-plan-cn'])
        self.config.write_text(self.config.read_text()+'\n# external change\n')
        with self.assertRaises(ConfigError): self.store.save(d)
        self.assertTrue(cache.exists())

    def test_cleanup_failure_does_not_report_committed_save_as_failed(self):
        cache = self.cache()
        original = Path.unlink
        def deny(path, *args, **kwargs):
            if path == cache: raise PermissionError('fixture')
            return original(path, *args, **kwargs)
        with patch.object(Path, 'unlink', deny): result = self.delete()
        self.assertEqual(result['providers'], [])
        self.assertTrue(cache.exists())
        self.assertIn('deletionFilesRetained', result.get('warnings', []))

    def test_backup_path_reference_preserves_artifact(self):
        cache = self.cache()
        backup = self.store.dir/'backups'/'manual.toml'; backup.parent.mkdir(exist_ok=True)
        backup.write_text('model_catalog_json='+json.dumps(str(cache)))
        result = self.delete()
        self.assertTrue(cache.exists())
        self.assertIn('deletionFilesRetained', result.get('warnings', []))

    def test_symlink_target_is_not_removed(self):
        cache = self.cache()
        target = self.root/'external.json'; target.write_bytes(cache.read_bytes())
        cache.unlink()
        try: cache.symlink_to(target)
        except OSError: self.skipTest('symlinks unavailable')
        self.delete()
        self.assertTrue(target.exists())
        self.assertTrue(cache.is_symlink())

    def generated(self):
        # Generate a catalog without activating it, as happens before a failed save.
        p = self.draft()['providers'][0]
        return Path(self.store._write_catalog(p['id'], {'base_url': p['baseUrl']}, 'k3', {}))

    def test_unreferenced_generated_file_removed_but_other_provider_survives(self):
        own = self.generated()
        other = Path(self.store._write_catalog('other', {'base_url': 'https://other.example/v1'}, 'custom', {}))
        self.delete()
        self.assertFalse(own.exists())
        self.assertTrue(other.exists())

    def test_shared_catalog_path_preserved_without_provider_reference(self):
        own = self.generated()
        doc = tomlkit.parse(self.config.read_text())
        doc['profiles'] = {'shared': {'model_catalog_json': str(own)}}
        self.config.write_text(tomlkit.dumps(doc))
        self.delete()
        self.assertTrue(own.exists())

    def test_old_untracked_catalog_not_adopted_after_regeneration(self):
        own = self.generated()
        (self.store.dir/'artifacts.json').unlink()
        self.generated()
        self.delete()
        self.assertTrue(own.exists())

    def test_corrupt_manifest_does_not_fail_saved_deletion(self):
        own = self.cache()
        (self.store.dir/'artifacts.json').write_text('[]')
        result = self.delete()
        self.assertEqual(result['providers'], [])
        self.assertTrue(own.exists())
        self.assertIn('deletionFilesRetained', result['warnings'])

    def test_save_commit_failure_keeps_cleanup_candidates(self):
        own = self.cache()
        from backend import store as module
        original = module.atomic
        def fail(path, text):
            if path == self.config: raise OSError('fixture')
            return original(path, text)
        with patch.object(module, 'atomic', fail):
            with self.assertRaises(OSError): self.delete()
        self.assertTrue(own.exists())
        self.assertEqual(len(self.store.snapshot()['providers']), 1)

    def test_manifest_cannot_authorize_external_paths(self):
        import hashlib
        external = self.root/'outside.json'; external.write_text('external')
        self.store.dir.mkdir(exist_ok=True)
        (self.store.dir/'artifacts.json').write_text(json.dumps({
            '../outside.json': {'provider':'kimi-code-plan-cn', 'sha256':hashlib.sha256(external.read_bytes()).hexdigest()}
        }))
        self.delete()
        self.assertEqual(external.read_text(), 'external')

    def test_shared_environment_key_remains_untouched(self):
        with patch.dict('os.environ', {'SHARED_MODEL_KEY': 'shared-test-secret'}):
            import os
            doc=tomlkit.parse(self.config.read_text())
            entry=doc['model_providers']['kimi-code-plan-cn']
            del entry['experimental_bearer_token']; entry['env_key']='SHARED_MODEL_KEY'
            self.config.write_text(tomlkit.dumps(doc))
            self.delete()
            self.assertEqual(os.environ['SHARED_MODEL_KEY'], 'shared-test-secret')

    def test_late_discovery_does_not_recreate_deleted_provider_cache(self):
        p = self.draft()['providers'][0]
        def response_after_deletion(*args):
            self.delete()
            return {'models': [{'id': 'k3'}]}
        with patch.dict('os.environ', {'CODEX_HOME': str(self.root)}), patch('backend.main.discover', side_effect=response_after_deletion):
            execute('discover', {'provider': p})
        self.assertEqual(list((self.store.dir/'catalogs').glob('*.json')), [])

    def test_snapshot_flags_shared_reference_before_deletion(self):
        self.config.write_text(self.config.read_text()+'\n[profiles.shared]\nmodel_provider="kimi-code-plan-cn"\n')
        self.assertTrue(self.store.snapshot()['providers'][0].get('referencedElsewhere'))

    def test_untracked_legacy_files_are_preserved_with_notice(self):
        own = self.cache()
        (self.store.dir/'artifacts.json').unlink()
        result = self.delete()
        self.assertTrue(own.exists())
        self.assertIn('deletionFilesRetained', result.get('warnings', []))

    @unittest.skipIf(__import__('os').name == 'nt', 'POSIX permissions fixture')
    def test_unreadable_backup_directory_keeps_referenced_files(self):
        import os
        if os.geteuid() == 0: self.skipTest('root bypasses directory permissions')
        own = self.generated()
        backup_dir = self.store.dir/'backups'; backup_dir.mkdir()
        (backup_dir/'manual.toml').write_text('model_catalog_json='+json.dumps(str(own)))
        backup_dir.chmod(0o300)  # saves may write known names, but cannot enumerate backups
        try:
            result = self.delete()
            self.assertTrue(own.exists())
            self.assertIn('deletionFilesRetained', result.get('warnings', []))
        finally:
            backup_dir.chmod(0o700)
