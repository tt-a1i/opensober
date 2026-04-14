# opensober

> *Stay sober. Nothing is magic.*

[English](./README.md) | **简体中文**

一个不装聪明的 opencode 插件。Agent 工具越来越"聪明"、越来越"贴心"、越来越有主张——prompt 背着你被注入、关键字悄悄切模式、fallback 链在你睡觉时烧光 API 配额。opensober 走反方向：每个行为都可见、可关、错了就明摆着让你看见。

**状态：** v0.1.x，API 尚未稳定，尚未发布到 npm。

## 为什么

- **没有隐形自动化。** 不做关键字切模式。不从 prompt 文本里自动执行命令。每一处上下文注入都在配置里明确命名。
- **Readonly agent 逃不出沙盒。** Readonly agent 想把任务委派给 writable agent，会在运行时被拒——由 `task` 工具强制，不是靠文档约定。
- **编辑不会悄悄覆盖过期状态。** `read` 给每一行标上内容哈希；`edit` 如果任何一行的哈希变了，整批拒绝。

## 安装

尚未发布到 npm。本地开发：

```bash
git clone <本仓库>
cd opensober
bun install
bun run build
npm pack                    # 生成 opensober-0.1.0.tgz
```

安装到 opencode：

```bash
cd ~/.config/opencode
bun add /path/to/opensober-0.1.0.tgz
```

在 `~/.config/opencode/opencode.json` 中注册：

```jsonc
{
  // 用 file URL 指向 opensober 的构建入口
  "plugin": ["file:///path/to/.config/opencode/node_modules/opensober/dist/index.js"],

  // orchestrator 必须作为静态 primary agent 声明，才会出现在 opencode 的 agent 选择器里
  "agent": {
    "orchestrator": {
      "model": "your-provider/your-model",
      "mode": "primary"
    }
  }
}
```

> **注意**：opencode 的 UI agent 列表依赖静态配置，不仅仅来自插件动态注册。
> 上面的 `orchestrator` 条目是 UI 锚点；opensober 的 `explore` 和 `reviewer`
> 子 agent 由插件动态注册，通过 `task` 工具调用，不需要静态配置。

Peer 依赖：`@opencode-ai/plugin ^1.4.0`。仅支持 Bun（>= 1.3.0），不提供 Node fallback。

## 快速上手

在项目根目录创建 `.opensober/config.jsonc`：

```jsonc
{
  "version": 1,
  "model": "anthropic/claude-opus-4-6",
  "agents": {
    "quick": {
      "extends": "orchestrator",
      "model": "openai/gpt-5-mini"
    }
  }
}
```

检查配置是否加载成功：

```
$ bunx opensober doctor

== opensober doctor ==

config
  version:       1
  global model:  anthropic/claude-opus-4-6
  layers:
    default       (built-in)
    project       /repo/.opensober/config.jsonc

agents
  explore         anthropic/claude-opus-4-6      readonly, no-delegate
  orchestrator    anthropic/claude-opus-4-6      writable, delegates
  reviewer        anthropic/claude-opus-4-6      readonly, delegates (readonly-only)
  quick           openai/gpt-5-mini              writable, delegates

tools
  edit, read, task

warnings
  (none)
```

退出码：`0` 干净，`1` 有警告，`2` 配置加载失败。

## 命令

| 命令 | 用途 |
|---|---|
| `bunx opensober doctor`  | 健康检查：配置摘要、agents、工具、警告 |
| `bunx opensober run`     | 加载配置并打印一份 session-ready 摘要 |
| `bunx opensober install` | *（尚未实现）* |

`doctor` 和 `run` 都接受 `--cwd <dir>` 和 `--config <path>`。

## 配置分层

四层按顺序合并，后面的覆盖前面的：

1. **default** — 内置基线
2. **user** — `~/.config/opensober/config.jsonc`
3. **project** — `<项目根>/.opensober/config.jsonc`
4. **cli-override** — `--config <path>`

项目根是向上找最近一个含 `.git` 的目录。找不到时会静默跳过 project 层——单文件 / CI 临时目录也能正常工作。

## 内置 agent

三个开箱即用的 agent：

- `orchestrator` — writable，可以委派给任意 agent
- `explore` — readonly，不能委派
- `reviewer` — readonly，只能委派给同样 readonly 的 agent

用户自定义 agent 通过 `extends` 继承。权限标记（`readonly`、`can_delegate`）从 parent 链继承；显式覆盖也允许，但 `task` 工具仍会强制：readonly 调用方不能触及 writable 目标。

## 延伸阅读

- [`v1-scope.md`](./v1-scope.md) — v1 冻结范围
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — 九条硬规则
- [`round-7.5-memo.md`](./round-7.5-memo.md) — SDK 调研备忘录

## 许可证

[MIT](./LICENSE)
