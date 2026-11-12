# 国际化实现

配置页支持英语、简体中文、繁体中文，自动跟随 Codex，不提供插件内部语言切换器。

## 宿主语言

通过 MCP Apps SDK 的 app.getHostContext().locale 初始化，通过 onhostcontextchanged.locale 更新。zh-Hant、zh-TW、zh-HK、zh-MO 映射繁体；zh-Hans 及其他 zh 映射简体。显式脚本标记优先于地区（如 zh-Hans-TW 为简体）。英语和其他语言回退英语。宿主未提供 locale 时参考 navigator.language。

宿主通知通过 ui/host-context.js 进入 ui/i18n.js。语言变化仅更新标记为 UI 文案的文字与属性，不重新创建 DOM，因此保留草稿、密钥输入、Raw Data、焦点、光标、展开状态和弹窗状态。用户填写的名称、模型 ID、API URL 和 JSON 不参与翻译。

## 文案与错误

locales/messages.json 使用稳定语义键，每项包含 en、zh-Hans、zh-Hant 三种文案。前端支持以语义键或已有简体文案查找，便于渐进维护。h/a 标记模板中的文字和属性，setText/setTranslatedAttribute 标记运行时提示。参数只按名称替换，不执行 HTML。时间经 Intl.DateTimeFormat 格式化。

后端 ConfigError 保留既有中文 error 字段，新增 errorCode/errorParams。前端按稳定键翻译；旧 MCP 进程只返回文本时支持已知静态提示以及 HTTP 状态码等有限格式，其余使用通用错误提示。不会直接转发远程响应体、凭证或 Python 异常诊断。

打包包含 locales 目录，供 Python 后端读取；前端词典打入 HTML bundle。无新增运行时依赖。

## 支持边界

侧边栏名称和工具标题属于安装清单/工具元数据，保留“自定义模型配置”等固定名称；当前未发现宿主清单提供可依赖的三语动态字段。配置页标题、正文、提示、确认框、可访问性标签、后端错误及日期均随宿主语言变化。

## 验证

自动化验证包括 Python、Playwright、MCP 冒烟及 Codex plugin loader；最新结果以测试运行记录为准。覆盖词典完整性与参数一致性、语言标签回退、三语窄屏、切换保留草稿/焦点/弹窗、请求进行中切换、后端错误码以及旧服务错误文本兼容。

实际 Codex MCP App 已自动以 zh-Hant 加载，标题为“自訂模型設定”，表单和日期呈现繁体格式。未改动用户模型配置、密钥或客户端语言设置。验证截图只保留本地，不纳入 Git。
