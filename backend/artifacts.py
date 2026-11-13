"""Conservative ownership tracking for disposable plugin files, not user config."""
import hashlib
import json
from pathlib import Path
import tomlkit


def strings(value):
    if isinstance(value, dict):
        for item in value.values(): yield from strings(item)
    elif isinstance(value, list):
        for item in value: yield from strings(item)
    elif isinstance(value, str):
        yield value


def provider_references(value, providers):
    if isinstance(value, dict):
        provider = value.get('model_provider')
        found = {provider} if isinstance(provider, str) and provider in providers else set()
        return found.union(*(provider_references(v, providers) for v in value.values()))
    if isinstance(value, list):
        return set().union(*(provider_references(v, providers) for v in value))
    return set()


class Artifacts:
    """Call under Store.locked; never infer ownership from a filename alone."""
    def __init__(self, root):
        self.root = root
        self.manifest = root / 'artifacts.json'

    def _read(self):
        if not self.manifest.exists(): return {}
        data = json.loads(self.manifest.read_text(encoding='utf-8'))
        if not isinstance(data, dict) or any(
            not isinstance(record, dict) or not isinstance(record.get('provider'), str)
            or not isinstance(record.get('sha256'), str) for record in data.values()
        ): raise ValueError('Invalid artifact manifest')
        return data

    def _safe_path(self, relative):
        path = Path(relative)
        if len(path.parts) != 2 or path.parts[0] not in ('catalogs', 'generated') or path.suffix != '.json':
            return None
        path = self.root / path
        if path.parent.is_symlink() or path.is_symlink(): return None
        if path.parent.resolve().parent != self.root.resolve(): return None
        return path

    def write(self, path, content, provider):
        from .store import atomic
        # Old/untracked files are not adopted, even when a refresh rewrites them.
        try: records = self._read()
        except (OSError, ValueError): records = None
        relative = path.relative_to(self.root).as_posix()
        record = (records or {}).get(relative, {})
        safe = self._safe_path(relative)
        owned = safe is not None and (not path.exists() or (
            record.get('provider') == provider and record.get('sha256') == hashlib.sha256(path.read_bytes()).hexdigest()))
        atomic(path, content)
        if records is not None:
            if owned:
                records[relative] = {'provider': provider, 'sha256': hashlib.sha256(content.encode('utf-8')).hexdigest()}
            else:
                records.pop(relative, None)
            atomic(self.manifest, json.dumps(records, ensure_ascii=False, indent=2))

    def cleanup(self, deleted, doc, state):
        from .store import atomic
        warnings = []
        referenced = provider_references(doc, deleted)
        if referenced: warnings.append('deletionReferencesRetained')
        try:
            records = self._read()
            # References from native settings and rollback files must keep working.
            values = list(strings(doc)) + list(strings(state))
            backups = self.root / 'backups'
            # glob suppresses scan errors; unreadable backups must block cleanup.
            for path in backups.iterdir() if backups.exists() else ():
                if path.suffix == '.toml': values.extend(strings(tomlkit.parse(path.read_text(encoding='utf-8'))))
                elif path.suffix == '.json': values.extend(strings(json.loads(path.read_text(encoding='utf-8'))))
            paths = set()
            for value in values:
                if not value.lower().endswith('.json'): continue
                # Resolve relative references conservatively against both usual roots.
                p = Path(value).expanduser()
                if p.is_absolute(): paths.add(p.resolve())
                else:
                    paths.add((self.root.parent / p).resolve())
                    paths.add(p.resolve())
        except (OSError, ValueError, RuntimeError):
            return list(dict.fromkeys(warnings + ['deletionFilesRetained']))
        retained = False
        # Unknown files may belong to legacy versions or users. Report, never adopt.
        for name in ('catalogs', 'generated'):
            directory = self.root / name
            try:
                if directory.is_symlink():
                    retained = True
                elif directory.exists():
                    retained |= any(p.suffix == '.json' and p.relative_to(self.root).as_posix() not in records
                                    for p in directory.iterdir())
            except OSError:
                retained = True
        for relative, record in list(records.items()):
            if not isinstance(record, dict) or record.get('provider') not in deleted: continue
            try:
                path = self._safe_path(relative)
                if path is None:
                    retained = True
                elif not path.exists():
                    records.pop(relative)
                elif record['provider'] in referenced or path.resolve() in paths:
                    retained = True
                elif not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != record.get('sha256'):
                    retained = True
                else:
                    path.unlink()
                    records.pop(relative)
            except (OSError, ValueError, RuntimeError):
                retained = True
        try:
            if self.manifest.exists(): atomic(self.manifest, json.dumps(records, ensure_ascii=False, indent=2))
        except OSError:
            retained = True
        if retained: warnings.append('deletionFilesRetained')
        return warnings
