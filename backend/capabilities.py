"""Reasoning metadata only: Codex sends requests directly, without local remapping."""
import copy
import json
from pathlib import Path

LEVELS = ('none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra')
PRESETS = json.loads(Path(__file__).with_name('reasoning-presets.json').read_text(encoding='utf-8'))


def capability(base_url, model, extra):
    override = extra.get('model_capabilities', {}).get(model)
    if override is not None:
        return copy.deepcopy(override)
    for preset in PRESETS:
        if base_url.rstrip('/') in preset['urls'] and model in preset['models']:
            return {k: copy.deepcopy(preset[k]) for k in ('reasoning_levels', 'default_reasoning_level')}
    return None


def effective_effort(base_url, model, extra):
    # Imported lazily to keep the existing error/localization boundary in store.
    from .store import ConfigError
    cap = capability(base_url, model, extra)
    effort = extra.get('model', {}).get('model_reasoning_effort')
    if cap is not None:
        if effort is not None and effort not in cap['reasoning_levels']:
            raise ConfigError('当前模型不支持所选推理强度，请修改推理配置。')
        if effort is None:
            effort = cap.get('default_reasoning_level')
    return effort


def validate_capabilities(caps):
    from .store import ConfigError
    valid = isinstance(caps, dict) and len(caps) <= 100
    if valid:
        for model, cap in caps.items():
            if not isinstance(model, str) or not model.strip() or len(model) > 256 or not isinstance(cap, dict) or set(cap) - {'reasoning_levels', 'default_reasoning_level'}:
                valid = False; break
            levels = cap.get('reasoning_levels')
            if not isinstance(levels, list) or any(not isinstance(x, str) or x not in LEVELS for x in levels) or len(set(levels)) != len(levels):
                valid = False; break
            default = cap.get('default_reasoning_level')
            if (levels and default not in levels) or (not levels and default is not None):
                valid = False; break
    if not valid:
        raise ConfigError('模型能力配置无效：档位不能重复，默认值必须属于支持的档位。')
