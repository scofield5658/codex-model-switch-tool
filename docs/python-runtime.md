# Python 环境管理

开发环境与安装后的插件使用同一份 `pyproject.toml`、`uv.lock` 和 `.python-version`。当前固定 CPython 3.12.13，保留 tomlkit 0.13.3，其他后端功能不随本次迁移改变。

## 开发

安装 Node.js 22+、pnpm 10.33.0 和 uv 后，在仓库根目录运行：

```sh
uv sync --locked --managed-python --no-config
pnpm install --frozen-lockfile
pnpm build
pnpm test
pnpm package
```

项目使用 uv 的非发行包模式（`package = false`），无需将后端安装成 Python wheel。项目 `.venv` 仅用于开发、测试和打包，不能复制到其他机器。`pnpm test` 包含后端回归和实际 uv 环境测试，后者使用临时目录，不读取用户模型凭证。

`--managed-python` 限制 uv 使用其管理的解释器，`requires-python` 和 `.python-version` 同时固定版本；`--locked` 拒绝声明与锁文件不一致。命令使用 `--no-config`，避免机器上的 uv 配置文件改变依赖来源。锁文件使用公共 PyPI，不记录个人路径、企业镜像或凭证。

## 插件运行

MCP 服务先完成工具注册，打开页面的入口立即返回，不等待 Python 环境。页面显示加载状态后，通过仅供页面调用的读取工具准备环境和读取配置；失败时可点击“重试”，不会自动重复保存或重启操作。首次读取配置时，启动器按 Python 版本、平台和环境文件内容计算运行目录，执行 `uv sync --locked --managed-python`。准备成功后验证解释器及依赖版本，写入完成标记；后续请求直接使用该解释器。

运行环境独立于源码、Codex 插件缓存以及模型配置目录：

| 系统 | 默认虚拟环境目录 |
| --- | --- |
| macOS | `~/Library/Application Support/codex-model-switch-tool/runtimes/<环境指纹>/<环境代号>/.venv` |
| Linux | `$XDG_DATA_HOME/codex-model-switch-tool/runtimes/<环境指纹>/<环境代号>/.venv`，未设置时使用 `~/.local/share` |
| Windows | `%LOCALAPPDATA%/codex-model-switch-tool/runtimes/<环境指纹>/<环境代号>/.venv`（路径已处理，后端仍不支持 Windows） |

uv 管理的基础 Python 和下载缓存由 uv 自行维护。它们也不是插件发行包的一部分。

插件升级或安装路径变化后，环境文件未变就可复用同一运行环境。新 MCP 进程会验证已准备的环境；已就绪且正常时无需调用 uv，也不访问网络。锁文件或 Python 版本改变会使用新目录，旧目录保留以便回退。环境损坏时通过 uv 创建新的独立环境，验证成功后原子更新完成标记，失败则明确报错。不会在原目录重装依赖，避免影响其他进程。并发初始化优先复用其他进程已准备好的环境；极短的同时完成窗口可能保留多个有效环境，已被进程使用的环境不会自动删除。

## 首次准备与排障

建议安装前在插件根目录执行：

```sh
node dist/setup-runtime.cjs
```

源码目录也可使用 `pnpm setup:runtime`。命令最长等待 3 分钟；页面自动准备最多等待 45 秒。网络受限时可预先准备环境，再离线使用。

- 找不到 uv：按 [uv 官方安装说明](https://docs.astral.sh/uv/getting-started/installation/) 安装。桌面进程 PATH 可能不同，启动器会额外查找 `~/.local/bin`，macOS 还查找常见 Homebrew 目录。
- uv 无法找到锁定的 Python 版本：旧版 uv 的内置下载目录可能不包含该版本。先更新 uv（Homebrew 安装可执行 `brew upgrade uv`），再运行上述 setup 命令；不要降低 `.python-version` 或修改锁文件。
- 自定义 uv 路径：给 MCP 进程设置 `MODEL_SWITCHER_UV`；显式指定失效时不会改用另一个 uv。
- 自定义运行目录：设置绝对路径 `MODEL_SWITCHER_RUNTIME_DIR`。不要放在会随升级清理的插件缓存目录。
- 离线准备：支持 `UV_OFFLINE=1`，但所需 Python 和依赖必须已缓存；没有缓存时明确失败。
- 网络及缓存设置：保留 `UV_CACHE_DIR`、`UV_PYTHON_INSTALL_DIR`、`UV_PYTHON_DOWNLOADS`、TLS 证书与代理环境配置。运行启动器忽略其他 uv 解析参数，避免覆盖项目锁定结果。
- 版本不符合或环境文件缺失：重新安装完整发行包，不要自行修改已安装包的锁文件。
- 目录不可写：修正该用户数据目录权限后重试。失败不会改用系统 Python，也不会读取、保存或重启模型配置。
- 升级后当前聊天仍报旧版启动错误：先核对 `codex plugin list --json` 中本插件的版本和 source 路径，再在已安装插件目录运行 setup 命令。若安装正确而旧聊天仍失败，正常重启 Codex 后重新打开插件；重装文件不会自动替换当前聊天持有的 MCP 连接。

`MODEL_SWITCHER_PYTHON` 不再用于选择解释器；外部 `PYTHONHOME`、`PYTHONPATH` 和激活的虚拟环境不会覆盖插件运行环境。错误提示支持英文、简体与繁体；uv 的原始诊断不会返回到聊天或页面，避免暴露本机信息。

## 升级和 Git 管理

1. 升级 Python 时同时修改 `.python-version` 与 `project.requires-python`；升级依赖时修改 `project.dependencies`。
2. 运行 `uv lock --no-config --managed-python`，检查版本、来源和 hash，再运行 `uv sync --locked --managed-python --no-config`。
3. 完成后端、运行环境、MCP、界面及插件加载测试后，再构建发行包。不要将新版本视为自动兼容。
4. 提交 `pyproject.toml`、`uv.lock` 和 `.python-version`。忽略 `.venv`、uv 缓存、旧虚拟环境备份、构建产物和运行数据。

回退时恢复上一版本的源码与三份环境文件并重新构建，启动器会选择对应旧环境。运行中的其他版本可能仍在使用旧目录，暂不自动清理；确认进程退出且不再需要回退后，可手动清理对应目录。

核心配置操作已适配 macOS、Linux 和 Windows。Windows 使用字节范围锁及私有暂存目录 ACL，文件与进程通信统一 UTF-8；自动重启仅限 macOS，其他系统保存后手动重启。三系统验证由 CI 执行，桌面宿主页面仍需各平台实机验收。

参考：[uv 项目结构](https://docs.astral.sh/uv/concepts/projects/layout/)、[Python 版本管理](https://docs.astral.sh/uv/concepts/python-versions/)、[项目环境路径](https://docs.astral.sh/uv/concepts/projects/config/#project-environment-path)。
