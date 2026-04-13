# opensober — v1 Scope (Frozen)

> **冻结日期**：2026-04-13
> **Slogan 候选**：*Stay sober. Nothing is magic.*

---

## 0. 元决策

| 项 | 决定 |
|---|---|
| 插件名 | `opensober` |
| 许可证 | **MIT** |
| 开发路径 | **Clean-room rewrite**（新开 repo，不 fork，不 copy 源码/prompt/文案）|
| 运行时 | Bun only |
| 分发 | npm 包（无平台二进制，无 postinstall）|
| 遥测 | 不做 |
| 文档语言 | 单一 GitHub README |
| 配置文件 | 单一 JSONC（多路径：project → user → defaults）|
| 硬规则 | 加一个概念必删一个（写入 CONTRIBUTING.md）|

---

## 0.1 Clean-Room 开发铁律（必须遵守）

1. 不 fork，不 `git clone` 后改——**新建空 repo**
2. **不 copy-paste 任何源码**，哪怕一行
3. **不复制 prompt 字符串**（agent 系统 prompt 必须全部自写）
4. **不复制命名**（禁用 `sisyphus/prometheus/atlas/hephaestus/oracle/momus/metis` 等）
5. **不复制目录结构 1:1**（可借思想，组织方式自己定）
6. **不复制 LICENSE / README / AGENTS.md 任何段落**
7. 读原代码理解思想可以，**commit message 里写 "inspired by oh-my-opencode" 即可**

**允许复现的是机制/算法**（Hashline Edit 的 LINE#ID 哈希、多层配置合并、LSP 集成），**不允许复现的是具体代码和文案**。

---

## 1. Agents（内置 3 个，用户可扩展）

**设计原则**：agent 即 preset，无 category，无 mode。用户靠 `extends` 定义任意多的 agent。

| Agent | 角色 | 权限 |
|---|---|---|
| `orchestrator` | 默认执行者，规划 + 委派 + 干活 | 全权（`readonly=false`, `can_delegate=true`）|
| `explore` | 轻量探索（grep/glob/read）| `readonly=true`, `can_delegate=false` |
| `reviewer` | 评审，可委派专用只读评审子 agent | `readonly=true`, `can_delegate=true`，但**只能委派给 `readonly=true` 的 agent** |

### Agent Schema（权限字段）

每个 agent 定义包含两个正交布尔：

```ts
interface AgentDefinition {
  readonly: boolean       // 能否使用 write/edit 类工具
  can_delegate: boolean   // 能否调 task 工具
  // ...其它字段：model / effort / prompt / extends / ...
}
```

### 权限强约束（由 task 工具实现，不是文档约定）

`task` 工具在调度前执行两条硬校验，失败直接报错不静默降级：

1. **调用者权限**：`caller.can_delegate === true`，否则拒绝
2. **readonly 传染**：`caller.readonly === true` 时，`target.readonly` 必须也是 `true`，否则拒绝

这保证 reviewer 永远无法通过 `task(agent: "orchestrator")` 绕过只读边界拿到写权限。

### 用户自定义示例

```jsonc
{
  "agents": {
    "quick": { "extends": "orchestrator", "model": "gpt-5-mini", "effort": "low" },
    "deep":  { "extends": "orchestrator", "model": "gpt-5.4", "effort": "high" },
    // 专用审查子 agent（reviewer 可以调起）；prompt 路径相对配置文件所在目录：
    "security-review": { "extends": "reviewer", "prompt": "./prompts/sec-review.md" }
  }
}
```

**砍掉**：`sisyphus / hephaestus / oracle / librarian / multimodal-looker / prometheus / metis / momus / atlas / sisyphus-junior`（全部）

---

## 2. Categories / Modes / Presets

**全部砍**。零抽象层。差异化通过 agent 承载。

---

## 3. Skills

| 项 | 决定 |
|---|---|
| 内置 skill 数 | **0** |
| SKILL.md 加载机制 | ✅ 保留 |
| YAML frontmatter | ✅ 保留 |
| 多路径加载 | ✅ 保留（project + user + Claude Code 兼容路径）|

用户自带 skill，我们不偏爱任何内置。

---

## 4. Commands（内置 4 个）

| 命令 | 功能 | 备注 |
|---|---|---|
| `/loop` | 自引用循环（检测 `<promise>DONE</promise>`）| 改名自 ralph-loop，去 Wiggum 梗 |
| `/cancel-loop` | 取消 loop | 配套 /loop |
| `/stop` | 停止所有延续机制 | 安全阀 |
| `/handoff` | 生成会话交接文档 | 依赖 task journal |

**砍掉**：`/init-deep / /ulw-loop / /refactor / /start-work`

**加载机制**：自定义 command 从 `.opencode/command/` + `~/.config/opencode/command/` + `.claude/commands/` 加载。

---

## 5. Tools（~15 个）

### 代码搜索
- `grep`（ripgrep）
- `glob`

### 编辑（核心差异化）
- `hashline-edit`（LINE#ID 哈希编辑，**从零自写**）
- `write`（默认拒绝覆盖已存在文件）

### LSP（全保留）
- `lsp_diagnostics`
- `lsp_goto_definition`
- `lsp_find_references`
- `lsp_prepare_rename` + `lsp_rename`
- `lsp_symbols`

### AST-Grep
- `ast_grep_search`
- `ast_grep_replace`

### 委派
- `task`（统一入口，支持 `agent`, `model`, `effort`, `run_in_background`）
- `background_output`
- `background_cancel`

### Skill
- `skill`（加载并执行）

### Task Journal（极简持久化，支撑 /handoff）
- `task_create`
- `task_list`
- `task_update`

**砍掉**：`look_at / call_omo_agent（合并进 task）/ skill_mcp（和原生 MCP 工具重复）/ session_list|read|search|info（放 CLI）/ interactive_bash`

---

## 6. Hooks（~20 个）

### 上下文注入（5）
- `directory-agents-injector`（层级 AGENTS.md 注入）
- `directory-readme-injector`
- `rules-injector`（`.rules/` + globs + alwaysApply）
- `compaction-context-injector`
- `preemptive-compaction`

### 监控（1）
- `context-window-monitor`

### 质量与安全（5）
- `thinking-block-validator`
- `edit-error-recovery`
- `write-existing-file-guard`
- `hashline-read-enhancer`
- `hashline-edit-diff-enhancer`

### 恢复（3）
- `session-recovery`
- `context-window-limit-recovery`
- `json-error-recovery`

### 重试（1，关键）
- `transient-retry`（同模型 5 次指数退避：1s → 2s → 4s → 8s → 16s，总上限 ~31s）
  - **不做跨模型 fallback**
  - 网络错误 / 503 / 529 / timeout 归为 transient
  - 其他错误（4xx 认证、400 参数）直抛

### 截断（1）
- `tool-output-truncator`

### 通知（2）
- `background-notification`
- `session-notification`（macOS/Linux/Windows）

### 延续（2）
- `compaction-todo-preserver`
- `stop-continuation-guard`（配套 /stop）

### 集成（2）
- `claude-code-hooks`（执行 settings.json 里的 PreTool/PostTool 脚本）
- `non-interactive-env`

### 可选（默认关）
- `auto-update-checker`（默认关闭）
- `todo-continuation-enforcer`（默认关闭，可开）

**砍掉**：`keyword-detector / auto-slash-command / comment-checker / agent-usage-reminder / question-label-truncator / task-resume-info / empty-task-response-detector / tasks-todowrite-disabler / unstable-agent-babysitter / atlas / prometheus-md-only / no-sisyphus-gpt / no-hephaestus-non-gpt / sisyphus-junior-notepad / think-mode / ralph-loop (原版) / start-work / category-skill-reminder / anthropic-effort / runtime-fallback / model-fallback / delegate-task-retry / interactive-bash-session`

---

## 7. MCP

### 内置（2）
- `grep_app`（GitHub 代码搜索）
- `context7`（文档查询）

**砍**：`websearch`（用户自装）

### 兼容层
- `.mcp.json` 加载 ✅
- `${VAR}` 环境变量展开 ✅
- Claude Code marketplace plugins ✂

### Skill 嵌入 MCP
- stdio ✅
- HTTP（Bearer token 认证）✅
- **OAuth ✂**（v2 再做）

---

## 8. Claude Code 兼容层

- Commands：`.claude/commands/` ✅
- Skills：`.claude/skills/*/SKILL.md` ✅
- Agents：`.claude/agents/*.md` ✅
- MCP：`.mcp.json` / `~/.claude.json` ✅
- Hooks：`settings.json` 的 PreToolUse/PostToolUse ✅
- Plugins marketplace ✂

---

## 9. 基础设施

- 多层配置合并（project → user → defaults）✅
- JSONC 配置 ✅
- Zod v4 schema 校验 ✅
- File-based prompts ✅，**精确支持三种形式，其它一律拒绝**：
  - `file:///abs/path.md` — 绝对路径（必须三斜杠）
  - `file://~/rel/to/home.md` — 家目录展开（`~/` 紧随 `file://`）
  - `./rel.md` 或 `rel.md` — 项目相对，**不带 scheme**，相对配置文件所在目录解析
  - **不支持** `file://relative/...`（按 URL 规范该形式 host=relative，含义不清，直接报错）
- Models.dev 能力探测 ✅
- Factory 模式 `createXXX()`
- Kebab-case 文件命名
- 200 LOC 文件软上限 / 500 LOC 硬上限
- **配置迁移机制 ✂**（不兼容变更直接 break，用 `config_version` + doctor 提示手动迁移）
- **Per-session 日志**（替代全局 `/tmp/xxx.log`）——**基础设施改进，v1 带上**

---

## 10. CLI

| 子命令 | 功能 |
|---|---|
| `install` | 交互式安装配置 |
| `doctor` | 健康诊断 + config 校验 |
| `run` | 非交互会话 |
| `refresh-model-capabilities` | 刷新 models.dev 缓存 |

**砍**：`mcp oauth login`（OAuth 整体 v2 再做）

---

## 11. 外部集成

- openclaw（Discord/Telegram/webhook）**全砍**

---

## 12. 分发

- 纯 npm 包
- **无平台二进制**
- **无 postinstall 脚本**

---

## 13. 延后到 v2 的候选特性

这些不是丢弃，是排到 v2：

| 特性 | 价值 |
|---|---|
| **Budget cap**（token + $/日 + $/session）| 高 |
| **Execution Trace**（`/why` + prompt 透明面板 + hook 调用栈）| 高——最大差异化点 |
| **Dry-run 模式** | 中 |
| **OAuth MCP**（RFC 9728/8414/7591）| 中 |
| **配置迁移机制** | 中 |
| **OS 原生通知增强** | 低 |

---

## 14. 开发纪律（写入 CONTRIBUTING.md）

1. 加一个概念必删一个（agent/tool/hook/skill）
2. 任何"自动"行为必须可禁用且默认可见
3. 500 LOC 文件硬上限
4. 不加 feature flag，不加向后兼容 shim
5. 每个 hook 都要能回答"没我会怎样"——答不出就删
6. README 禁止：review 截图 / Discord 推广 / 反对谁的宣言
7. 绝不默认开启遥测
8. 绝不从 prompt 文本里自动执行命令（no auto-slash-command class）
9. 绝不用 keyword 改变运行模式（no keyword-detector class）

---

## 15. 最终规模对比

| 维度 | oh-my-opencode | opensober v1 | 削减 |
|---|---|---|---|
| Agent | 11 | **3** | −73% |
| Category | 8 | **0** | −100% |
| Mode | 1（隐式）| **0** | −100% |
| Skill（内置）| 6 | **0** | −100% |
| Command | 8 | **4** | −50% |
| Tool | 26 | **~15** | −42% |
| Hook | 52 | **~20** | −62% |
| 内置 MCP | 3 | **2** | −33% |
| 平台二进制 | 11 | **0** | −100% |
| Fallback 层数 | 2（model + runtime） | **1**（同模型 retry） | −50% |
| OAuth RFC 实现 | 4+ | **0**（v1）| −100% |

---

## 下一步：技术架构讨论议题

v1 scope 已冻结，接下来按顺序讨论：

1. **Repo 初始化**——目录结构、`package.json`、`tsconfig.json`、`bunfig.toml`
2. **插件入口**（`src/index.ts`）——OpenCode plugin 初始化生命周期
3. **Config 加载器**（`src/config/`）——Zod schema、多层合并、file:// 解析
4. **Agent 定义 schema**——`extends` 机制、内置 3 个 agent 的 prompt 策略（自写，不 copy）
5. **Hashline Edit 算法**——LINE#ID 哈希生成、编辑时校验、失败恢复（核心差异化特性优先落地）
6. **Tool 注册机制**——`createXXXTool` 工厂、工具权限矩阵
7. **Hook 管线**——PreTool/PostTool/Event/Transform 五层，统一注册
8. **Transient Retry**——5 次指数退避实现、可重试错误分类
9. **Task Journal**——最小持久化、/handoff 集成
10. **CLI scaffold**——Commander.js、install/doctor/run 骨架

**建议顺序**：1 → 2 → 3 → 5（Hashline Edit 先，这是核心差异化）→ 4 → 6 → 7 → 8 → 9 → 10

**你决定从哪个开始。**
