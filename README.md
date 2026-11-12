# 自定义模型配置 · Codex 本地插件

管理 provider、API Key 和默认模型；支持模型列表查询、重置、可选连接测试、Raw Data、保存和保存并重启。面向 macOS、Windows、Linux 的本地 Codex 配置（图形页面需要宿主支持 MCP Apps）；不代理推理请求，不改变订阅权益。

## 界面预览

在插件中管理提供商、编辑接入配置并选择默认模型：

![自定义模型配置界面](docs/images/provider-settings.png)

配置生效后，在 Codex 的模型菜单中选择服务商提供的模型。下图为 Kimi 示例，实际列表以所配置的服务商为准：

![Codex 中的第三方模型选择菜单](docs/images/codex-model-picker.png)

## 使用

安装后打开插件“自定义模型配置”，或使用全局导航入口。页面先显示加载状态，再准备 Python 环境和读取配置；失败时可在页面内点击“重试”。需要 Node.js 22+ 和 uv，详见下方安装说明。

1. 展开提供商，可直接编辑“配置名称”、接入地址、默认模型。已有 Key 只显示“已配置”，不会回填；输入框留空始终保留原密钥。
2. “刷新模型”从服务商查询模型列表。失败时已有列表保留，可手动输入准确模型 ID。列表出现不代表模型调用权限已验证。
3. “设为默认”选择下次启动的 provider。保存前可以重置（保留编辑并恢复最近保存值）。此操作均不写入磁盘。
4. 重置、保存与保存并重启位于顶部操作栏，滚动时保持可见。“保存”写入配置；macOS 的“保存并重启”要求明确确认各窗口任务已结束，随后正常退出并重新打开客户端，不强制结束进程。Windows/Linux 显示“保存后手动重启”，保存后给出操作提示。若退出被系统拒绝，手动重启即可。
5. 重启后新建聊天验证。插件无法可靠读取桌面运行中的模型/provider，旧聊天可能保留原值；不会把文件内容当成当前运行结果。

内置 GPT 为固定选项，恢复首次外部切换前的原生设置；原生设置激活期间的外部人工修改也会被保留。若首次使用插件时已经选中了外部服务且没有记录原生配置，自动恢复按钮不可用，需先在本机恢复原生设置再读取。

## Raw Data

表单以外的参数采用 JSON。示例：

```json
{
  "provider": {"wire_api": "responses"},
  "model": {"model_context_window": 262144},
  "discovery": {},
  "health": null
}
```

`provider` 支持 `wire_api`、`request_max_retries`、`stream_max_retries`、`stream_idle_timeout_ms`、`http_headers`、`model_catalog_url`、`supports_websockets`。认证命令和密钥不允许在 Raw 中编辑；导入配置的隐藏请求头被保留，新增普通头采用合并方式。

`model` 支持 `model_context_window`、`model_auto_compact_token_limit`、`model_reasoning_effort`、`model_reasoning_summary`、`model_verbosity`。字段合法不代表服务商支持；须按服务实际能力填写。Kimi Code Moderato 的 `k3` 使用 262144 上下文，不应套用更高档位参数。

`discovery.url` 可指定同源完整模型列表 URL；默认使用 Base URL 下的 `/models`。`provider.model_catalog_url` 要求服务返回 Codex 完整目录格式，不是普通 OpenAI `data[].id` 列表。没有远程 Codex 目录时，插件将查询到的模型 ID 写入独立目录文件；只生成最小元数据，未知能力不推断。已有用户维护的本地目录会保留。

### 可选连接测试

“测试连接”仅在配置 `health` 后可用。可在高级配置中用“填入连接测试示例”生成以下草稿：

```json
{
  "path": "responses",
  "method": "POST",
  "body": {"model": "$model", "input": "Reply with OK.", "max_output_tokens": 64},
  "expectStatus": 200,
  "timeoutSeconds": 20
}
```

示例写入 Raw Data 的 `health` 字段；部分推理模型需要更大的输出限制，可自行修改。`$model` 替换为当前所选模型。GET 健康端点通常仅证明服务可达；POST 可能消耗少量额度。检查不会自动保存、切换或重启。改变地址、Key、模型或 Raw 后，旧检查结果立即失效。

请求仅允许同源 HTTPS 或 loopback HTTP，不跟随重定向。带查询参数的 API 地址暂不支持。命令认证、OpenAI 登录认证以及 env_http_headers 的插件内测试暂不支持，原有配置保留。

## 数据与回滚

- Codex 文件：`~/.codex/config.toml`（或进程的 CODEX_HOME）。
- 插件状态、模型缓存、生成目录及备份：`~/.codex/model-switcher/`。
- 凭证按现有 Codex 方式保存在本机 TOML；不是 Keychain 加密存储。POSIX 文件及备份为 0600；Windows 写入文件继承私有暂存目录的当前用户/管理员 ACL，不将 chmod 当成 ACL。不打包上传。
- 写入前备份、修订号检查、进程锁、原子替换；中断事务会在下次读取时恢复。其他程序不遵守锁时，最后检查和写入之间仍存在极短并发窗口。
- 保存后需要历史回滚时，备份位于 `model-switcher/backups`。先退出 Codex，核对对应 `.toml` 与 `.json`，恢复配置与插件状态；不要直接覆盖期间新增的其他设置。
- 本插件不处理项目配置/profile/命令行覆盖，实际加载结果仍以客户端为准。

## 开发与验证

需要 Node.js 22+、pnpm 10.33.0 和 [uv](https://docs.astral.sh/uv/getting-started/installation/)（本项目验证版本 0.13.7）。Python 3.12.13 由 uv 管理，无需自行配置系统 Python。JavaScript 使用 `pnpm-lock.yaml`；Python 使用 `pyproject.toml`、`uv.lock`、`.python-version`。

```sh
uv sync --locked --managed-python --no-config
pnpm install --frozen-lockfile
pnpm build
pnpm test
node tests/mcp-smoke.mjs
uv run --locked --managed-python --no-config python -m tests.codex-catalog
node scripts/build.mjs --test-ui
pnpm exec playwright install chromium
pnpm exec playwright test
pnpm package
uv run --locked --managed-python --no-config python tests/plugin-loader.py
```

`pnpm build`、`pnpm test`、`pnpm package` 均通过 uv 进入项目 `.venv`。`--locked` 要求依赖声明和锁文件一致，不会自动升级依赖；`--no-config` 避免继承机器上的 uv 配置文件。Python 环境细节与升级步骤见 [Python 环境管理](docs/python-runtime.md)。

浏览器测试默认使用 Playwright Chromium，只访问临时配置。所有测试均不使用真实 Key、不发起真实收费调用、不重启当前客户端。重启辅助程序使用受控命令替身验证流程；真实客户端退出/重新启动需用户执行按钮后验收。

## 本地安装

发行目录 `release/local-marketplace` 包含完整的本地 marketplace。发行包包含 JS bundle、Python 源码与环境锁文件；用户无需安装 pnpm。首次准备 Python 和依赖可能需要联网，之后复用本机运行环境。

```sh
pnpm setup:runtime
codex plugin marketplace add /absolute/path/to/release/local-marketplace
codex plugin add codex-model-switch-tool@model-switch-plugin
```

`pnpm setup:runtime` 用于源码开发者预先准备运行环境；直接使用发行包时，在插件根目录运行 `node dist/setup-runtime.cjs`。也可让首次打开页面自动准备，超过 45 秒会提示改用上述命令，准备完成后重新加载即可。不会自动安装 uv 或退回系统 Python。

插件未显示时正常退出并重新打开桌面端。在 `Plugins` 中找到“自定义模型配置”并启用。只安装本地，不发布至云端。

升级安装完成不代表当前聊天已切换到新 MCP 进程。旧聊天或已打开的插件页可能继续连接旧版服务；若仍显示旧界面或启动错误，等其他任务结束后正常退出并重新打开 Codex，再进入插件验证。

## 可移植性与发布准备

源码仓库和插件内部 ID 统一为 `codex-model-switch-tool`。`model-switch-plugin` 是发行包提供的 marketplace（插件来源目录）名称，不是用户账号。

旧版本使用 `codex-model-switcher@local-model-tools`；新标识会被视为不同插件，不会原地替换旧安装。已有用户请先移除旧插件，再按上述命令添加新版 marketplace 并安装新插件，避免两个入口同时存在。此命名调整不迁移或删除本机模型配置。

- 运行入口使用 PATH 中的 Node.js；Python 由 uv 按锁文件准备，随后直接使用该虚拟环境中的解释器。`MODEL_SWITCHER_PYTHON` 已停用；可通过 `MODEL_SWITCHER_UV` 指定 uv 可执行文件，通过 `MODEL_SWITCHER_RUNTIME_DIR` 指定运行环境根目录（绝对路径）。
- 核心配置读写、模型查询与连接测试已适配 macOS、Windows、Linux：Unix 使用 flock，Windows 使用字节范围锁；文件与进程通信使用 UTF-8。三系统测试配置见 `.github/workflows/test.yml`，实际通过状态以 CI 为准；当前本地验收系统为 macOS。
- 自动重启仅支持 macOS，通过 bundle ID 查找客户端，不依赖安装目录；其他系统需手动重启。
- 实际插件加载测试使用 PATH 中的 codex，可通过 TEST_CODEX_BIN 指定。
- 仓库不收录用户配置、密钥、历史调试材料或依赖目录。`docs/images` 仅收录已确认可公开的界面示例，其他本地截图继续忽略。
- 项目采用 [MIT License](LICENSE)。

## 界面语言

配置页自动跟随 Codex 的语言，支持 English、简体中文、繁體中文，无需在插件中切换。语言改变时保留未保存草稿与编辑状态；未支持的语言回退英语。侧边栏的插件名称属于安装元数据，仍为固定名称。实现与测试见 [国际化说明](docs/i18n-assessment.md)。

## 作者

[guoz5658](https://github.com/scofield5658) · guoz5658@outlook.com

## 推理强度与模型能力

编辑提供商时，默认模型下方可选择推理强度。“使用模型默认值”采用该模型能力声明中的默认档位；展开“当前模型的推理能力”可配置自定义模型支持的档位及默认值。保存并重启后，可在 Codex 模型菜单中选择声明的档位。旧聊天可能仍携带旧值，首次切换建议新建聊天。

官方预设只按精确接入地址和模型 ID 匹配，更新时间为 2026-11-12：

| 接入 | 模型 ID | 推理档位 | 默认值 |
| --- | --- | --- | --- |
| Moonshot 开放平台 | `kimi-k3` | low / high / max | max |
| Kimi Code | `k3`、`k3-256k`、`k3.1-pro`、`k3.1-pro-highspeed` | low / high / max | high |
| Kimi Code | `kimi-for-coding` | low / high / max | max |
| Z.AI / BigModel（智谱中国） | `glm-5.3` | low / high / max | max |

依据：[Moonshot K3](https://github.com/MoonshotAI/Kimi-K3#6-model-usage)、[Kimi Code 的 Codex 配置](https://www.kimi.com/code/docs/third-party-tools/codex.html)、[Z.AI Codex 配置](https://docs.z.ai/devpack/tool/codex)、[BigModel Codex 配置](https://docs.bigmodel.cn/cn/coding-plan/tool/codex)。BigModel 预置地址为 `https://open.bigmodel.cn/api/v1`；与现有三个模板并列，新增时仍不填充模型、Key 或测试请求。

未知模型不猜测档位。自定义能力按模型 ID 保存在 Raw Data 的 `model_capabilities`，例如：

```json
{
  "model_capabilities": {
    "my-model": {
      "reasoning_levels": ["low", "high"],
      "default_reasoning_level": "high"
    }
  }
}
```

可声明 Codex 接受的 `none/minimal/low/medium/high/xhigh/max/ultra` 的子集；非空档位必须含有默认值，空列表表示未提供可切换档位。`model.model_reasoning_effort` 保留为启动覆盖值，不属于当前模型声明的值会在切换保存及 Responses 连接测试前被拒绝。连接测试使用同一有效推理强度，测试 body 中的冲突参数须先修改。

这里的“映射”是服务端协议兼容：Codex 原样发送 `reasoning.effort`，插件不转换请求，也不会把所有厂商的同名档位视为相同计算量。BigModel 的 [Responses 文档](https://docs.bigmodel.cn/cn/guide/develop/responses/introduction) 描述了服务端档位转换；内置菜单采用其 Codex 专用示例。若自定义服务只接受 `thinking.type` 或 token budget，需由该服务提供 Responses 兼容层，不能在插件里仅改名称来实现转换。

能力写入插件生成的模型目录。已有 `model_catalog_json` 用户文件或 `model_catalog_url` 保持原样，菜单能力须在该外部目录维护。生成目录需要的档位会补充到 `desktop.enabled-reasoning-efforts`；切回内置 GPT 时恢复之前的字段，保留其他 desktop 设置和之后的外部修改。宿主版本或账号可见性设置仍可能影响菜单展示。
