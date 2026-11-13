# 自定义模型配置 · Codex 本地插件

在 Codex 中管理第三方模型的接入地址、API Key、默认模型和推理强度，支持模型列表查询、连接测试及切回内置 GPT。插件只管理本地配置，不代理推理请求，也不改变订阅权益。

支持 macOS、Windows、Linux；图形页面需要 Codex 支持 MCP Apps。界面跟随 Codex 语言，支持英语、简体中文和繁体中文，其他语言回退英语。

## 界面预览

![自定义模型配置界面](docs/images/provider-settings.png)

配置生效后，可在 Codex 模型菜单中选择模型（以下为 Kimi 示例）：

![Codex 中的第三方模型选择菜单](docs/images/codex-model-picker.png)

## 安装与升级

需要 Node.js 22+ 和 [uv](https://docs.astral.sh/uv/getting-started/installation/)。Python 由 uv 自动管理，首次准备环境可能需要联网。

使用发行包中的 `local-marketplace` 目录安装；从源码构建请先参阅下方开发说明：

```sh
codex plugin marketplace add /absolute/path/to/release/local-marketplace
codex plugin add codex-model-switch-tool@model-switch-plugin
```

安装或升级后，正常退出并重新打开 Codex，在 Plugins 中启用“自定义模型配置”。旧页面或聊天可能仍连接旧进程。

旧版用户需先移除 `codex-model-switcher@local-model-tools`，再安装新版，避免重复入口；模型配置不会因此删除。

首次加载失败可点击“重试”。也可在发行包的插件根目录执行 `node dist/setup-runtime.cjs`，预先准备 Python 环境。

## 使用

1. 添加或编辑提供商，填写接入地址、Key 和默认模型。已保存的 Key 不会回显，留空保留原值。
2. 点击“刷新模型”查询列表，也可手动输入模型 ID。列表可见不代表具有调用权限。
3. 按需选择推理强度，或配置“测试连接”；未知模型的推理能力需自行声明。
4. 设为默认后保存。保存前可用“重置”放弃未保存修改。macOS 支持保存并正常重启；Windows、Linux 需手动重启。
5. 重启后新建聊天验证。旧聊天、项目配置、profile 或命令行参数可能影响实际使用的模型。

内置模板包括 DeepSeek、Moonshot、Kimi Code、Z.AI 和 BigModel，也支持自定义服务。模板提供接入地址，部分模型附带推理能力预设；Key、模型及测试请求需自行配置。预设仅匹配对应地址与模型 ID，具体可用性以服务商为准。

选择“内置 GPT”可恢复首次外部切换前记录的原生设置；没有原生配置记录时，需先在本机恢复原生设置。插件无法确认运行中聊天实际使用的模型。

## 高级配置与连接测试

表单以外的参数可通过 Raw Data（JSON）编辑：

- `provider`：协议、重试、超时、请求头及模型目录地址。
- `model`：上下文窗口、自动压缩阈值和推理参数。
- `model_capabilities`：按模型 ID 声明推理档位及默认值。
- `discovery.url`：同源模型列表地址，默认请求接入地址下的 `/models`。
- `health`：可选连接测试请求，可通过“填入连接测试示例”生成草稿。

“测试连接”需要先配置 `health`，其中 `$model` 替换为当前模型。POST 测试可能消耗额度；测试不会自动保存或切换配置。请求仅允许同源 HTTPS 或本机回环 HTTP，不跟随重定向，暂不支持带查询参数的 API 地址。

插件不会转换服务商协议或推理档位，参数应符合目标服务的实际能力。普通模型列表与 Codex 模型目录格式不同；使用自有 `model_catalog_json` 或 `model_catalog_url` 时，需在该目录维护模型能力。

## 本地数据

- Codex 配置：`~/.codex/config.toml`，或 `CODEX_HOME` 指定的位置。
- 插件状态、模型缓存及备份：`~/.codex/model-switcher/`。
- 密钥保存在本机 TOML 中，通过文件权限保护，不是 Keychain 加密存储。
- 保存前自动备份。手动回滚时先退出 Codex，核对 `model-switcher/backups` 中对应的配置和状态文件，避免覆盖其他新增设置。

## 开发

需要 Node.js 22+、pnpm 10.33.0 和 uv。JavaScript 使用 `pnpm-lock.yaml`，Python 使用 `pyproject.toml` 与 `uv.lock`，由 uv 管理 Python 3.12.13。

```sh
uv sync --locked --managed-python --no-config
pnpm install --frozen-lockfile
pnpm build
pnpm test
pnpm package
```

发行包输出到 `release/`，使用者无需安装 pnpm。更多环境说明见 [Python 环境管理](docs/python-runtime.md)。

其他验证命令：

```sh
node tests/mcp-smoke.mjs
uv run --locked --managed-python --no-config python -m tests.codex-catalog
node scripts/build.mjs --test-ui
pnpm exec playwright install chromium
pnpm exec playwright test
uv run --locked --managed-python --no-config python tests/plugin-loader.py
```

测试使用临时配置，不使用真实密钥、发起付费调用或重启当前客户端。真实服务连通性和客户端重启效果需在本机验证。

## 许可证

[MIT](LICENSE)
