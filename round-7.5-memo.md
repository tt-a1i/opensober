# Round 7.5 — Task 真实执行：SDK 调研备忘录

> 调研日期：2026-04-13
> 基于版本：
> - `@opencode-ai/sdk`: **1.4.3**
> - `@opencode-ai/plugin`: **1.4.3**
>
> 范围：`@opencode-ai/sdk`（HTTP client）的 session 生命周期，为 Round 8 "task 真实执行" 下决策
> 产出：**纯调研，不改代码**，不写 spike
>
> 如果 SDK 升级，回看本文时优先重验第 8 节的 spike TODO；其中任何假设可能随 SDK 版本变化。

---

## 1. SDK 相关 API 地图

### 入口
- `createOpencodeClient(config?)` → `OpencodeClient`（来自 `@opencode-ai/sdk/client`）
- **PluginInput 已直接携带一个 client 实例**：plugin 入口 `input.client` 就是本 session 对应的 client——不需要自己建连

### OpencodeClient 表面（本次只关注与 task 执行相关的）

```ts
client.session.<op>    // 所有 session 操作
client.event.subscribe // 服务器发送事件（SSE），用于流式监听
```

### Session 操作（按相关度排序）

| 方法 | 参数 | 返回 | 关键点 |
|---|---|---|---|
| `session.create` | `{ body: { parentID?, title? } }` | `Session`（含 `id`, `parentID`, `directory`, ...） | **`parentID` 就是父子关系的建立方式** |
| `session.prompt` | `{ path: {id}, body: { agent?, parts, model?, tools?, ... } }` | `{ info: AssistantMessage, parts: Part[] }` | **同步阻塞**，等 agent 回复完整消息 |
| `session.promptAsync` | 同上 | `204 void` | **立即返回**，不等结果 |
| `session.messages` | `{ path: {id} }` | `{ info, parts }[]` | 列所有历史消息 |
| `session.message` | `{ path: {id, messageID} }` | `{ info, parts }` | 单条消息 |
| `session.status` | `{ query: {directory?} }` | `Record<sessionID, SessionStatus>` | `"idle" \| "retry" \| "busy"` |
| `session.abort` | `{ path: {id} }` | void | 取消 |
| `session.children` | `{ path: {id} }` | `Session[]` | 获取子会话列表 |
| `session.fork` | `{ path: {id}, body: {messageID} }` | 同 create | 从某消息分叉出新会话 |
| `session.get` / `list` / `delete` | … | … | 常规 |

### Event 流（可选）
- `client.event.subscribe()` 返回 `ServerSentEventsResult`
- 可监听 `message.updated` / `message.part.updated` / `session.status` / `session.idle` 等
- **如果要做流式进度回显**，这里是源头

---

## 2. 最小可行执行路径

### SubtaskPartInput 发现 — 但不适合我们的 tool 模型

SDK 原生定义了：
```ts
export type SubtaskPartInput = {
  id?: string
  type: "subtask"
  prompt: string
  description: string
  agent: string
}
```

并且 `Part` 的 union 里有 `{ type: "subtask", ... }` 变体。说明 **opencode 内部已经把"子任务委派"作为一种消息部件**来建模。

**但这个不是给 tool 用的。** `SubtaskPartInput` 是 agent 输出消息时的一个 part；它要求 agent 的 LLM 直接生成一个"subtask part"作为响应的一部分。我们的 `task` 工具是 mid-session 被 agent 调用的函数，返回字符串——完全不同的层。

**结论**：不走 SubtaskPartInput，走 child session。

### 推荐最小可行路径（promptAsync + poll + messages）

> **重要更正**：本节原先推荐 `session.prompt` 的同步阻塞路径。对照 oh-my-opencode 的生产代码（`src/tools/delegate-task/sync-*`）后确认：**`session.prompt` 的阻塞语义不可靠**，OmO 在真实场景下走的是 promptAsync + 轮询 + 回取 messages 的路线。我们沿用其经过验证的形态。

```
1. task(agent, prompt) 被 orchestrator 调用
2. assertCanDelegate(caller, target, config)                    [已有]
3. parentSession = await client.session.get({ path: { id: ctx.sessionID } })
   → 取出 parent 的 directory / projectID，以便 child 继承
4. childSession = await client.session.create({
     body: { parentID: ctx.sessionID, title },
     query: { directory: parentSession.directory },
   })
5. await client.session.promptAsync({
     path: { id: childSession.id },
     body: {
       agent: args.agent,
       parts: [{ type: "text", text: args.prompt }],
     },
   })
   // 立即返回 204；child 在后台推进
6. 轮询循环（带 ctx.abort 监听）：
   a. await sleep(POLL_INTERVAL_MS)
   b. if (ctx.abort.aborted) → await client.session.abort({ path: { id: childSession.id } })
      → throw with "task cancelled by parent"
   c. status = await client.session.status(...)
   d. 计数 assistant turns，超上限（建议 300）→ abort + throw
   e. if (status[childSession.id] === "idle" && 有终止消息) → break
7. messages = await client.session.messages({ path: { id: childSession.id } })
   → 取最新一条 assistant 消息 + 其 parts
8. 检查 info.error；若 set 则分类并抛出对应工具级错误
9. 提取文本：parts.filter(p => p.type === "text").map(p => p.text).join("\n\n")
10. 返回文本 + 结构化 header（caller/target/model/cost/tokens/duration）
```

关键点：

- **不用 `session.prompt`**：其返回时机不稳定，可能在 agent 完整回合前就 resolve
- **abort 传染手动做**：v1-scope §1 的权限契约要求 ctx.abort 能真正停止 child；SDK 不自动传染
- **循环上限 + 节流**：防无限工具循环，建议 max_turns = 300，poll_interval = 500ms~1s
- **结果从 `session.messages` 取**，不是 prompt 的直接返回值
- **`permission` override**：`session.create.body.permission` 应传 `question/*: deny`，否则 child 可能停在向用户提问

### 异步版（后面才做）

```
1-3. 同上
4. client.session.promptAsync(...) → 204
5. 返回 `{ task_id: childSession.id, status: "running" }`
6. 新增工具：`task_status({ task_id })` / `task_result({ task_id })`
   - status → client.session.status
   - result → client.session.messages，拿最新一条 assistant
```

需要配套一个新工具（`task_status` 或 `task_result`），以及状态展示规范。

---

## 3. 父子会话边界

### 共享（自动继承）
- **项目 / 工作目录**：child 继承 parent 的 project + directory（Session 类型里有 `projectID` 和 `directory`，create 时不用传）
- **opencode 内部的 config**：同一个 opencode 实例服务两者，所以 provider / model / hook / plugin 配置是共享的
- **parentID 链**：child 记住了 parent，可以通过 `session.children(parent)` 反查

### 不共享
- **消息历史**：child 有自己的 message list，parent 看不到 child 内部对话（除非查 `session.messages(childID)`）
- **agent 身份**：parent 跑 `orchestrator` 时 child 跑 `args.agent`——各自独立
- **todo 列表**：`session.todo(id)` 按 sessionID 查
- **成本计算**：AssistantMessage 各自带 `cost` + `tokens`，不会自动汇总到 parent

### 边界模糊地带
- **permission.ask 回调**：不确定是走父还是子会话。Round 8 实测后记录
- **file.edited 事件**：child 修文件时 parent 的 plugin hook 会不会收到？需要实测

---

## 4. Abort / Timeout / Error 传播

### Abort
- tool 的 `ctx.abort: AbortSignal` 已经是 opencode 给我们的钩子
- parent 被 cancel 时，该信号会 fire
- **需要自己做**：监听该信号 → 调 `client.session.abort({ path: { id: childID } })`
- **未知**：opencode 自己是否已经处理父子 abort 的传染？看代码暂无证据。**默认按"需要自己做"处理**

### Timeout
- 没有内置 API
- 推荐：用 `AbortController` + `setTimeout` 自己合成
- `Promise.race([session.prompt(...), timeout])` → 超时就 session.abort

### Error
- `AssistantMessage.error?` 含 5 种类型：
  - `ProviderAuthError` — 认证失败
  - `UnknownError` — 未分类
  - `MessageOutputLengthError` — token 超限
  - `MessageAbortedError` — 主动取消（expected）
  - `ApiError` — HTTP 层错误（含 retryable 标志）
- **v1 策略**：任一 error 就转成 `TaskExecutionError` 抛出，按错误类型给 action hint（和 Round 7 的 edit 错误格式一致）

---

## 5. 后台执行 — v1 里放吗？

**建议：v1.0（Round 8）不做，v1.1 做。**

理由：
- 后台模式需要一整套新概念：task_id、status/result 工具、TTL、取消、列表、清理
- v1 先把"同步委派"打磨好，就能覆盖 reviewer 调 security-review / orchestrator 调 explore 的 90% 场景
- 异步是性能优化，不是基础功能
- SDK 提供 `promptAsync`——随时能加，不会浪费

**v1 里只做同步。用户想要异步，等 v1.1。**

---

## 6. Round 8 方案草图

### 6.1 文件变更预览

| 文件 | 操作 |
|---|---|
| `src/index.ts` | 传 `input.client` 给 createTools |
| `src/tools/index.ts` | createTools 签名加 `{ client: OpencodeClient }` |
| `src/tools/task/task.ts` | 把 stub 换成真 `runChildSession` 调用 |
| `src/tools/task/runner.ts` | **新**：`runChildSession(client, parentID, agent, prompt, abort) → string` |
| `src/tools/task/runner.test.ts` | **新**：需要 mock OpencodeClient（重点测试 abort / error / 文本提取） |
| `src/tools/task/task.test.ts` | 改：把 stub 断言换成 mocked-runner 返回的真输出 |

预计 ~300-400 LOC（runner 是重头）

### 6.2 createTools 签名改动

```ts
// before
export function createTools(config: ResolvedConfig): Record<ToolName, ToolDefinition>

// after
export interface ToolDependencies {
  readonly client: OpencodeClient
}
export function createTools(config: ResolvedConfig, deps: ToolDependencies): Record<ToolName, ToolDefinition>
```

read / edit 不需要 client，但把 deps 作为第二个参数统一传，未来扩展面小。

### 6.3 runChildSession 签名

```ts
export interface RunChildOptions {
  readonly parentSessionID: string
  readonly targetAgent: string
  readonly prompt: string
  readonly abort: AbortSignal
}

export interface RunChildResult {
  readonly childSessionID: string
  readonly text: string
  readonly model: { providerID: string; modelID: string }
  readonly cost: number
  readonly tokens: { input: number; output: number; /* ... */ }
  readonly durationMs: number
}

export async function runChildSession(
  client: OpencodeClient,
  opts: RunChildOptions,
): Promise<RunChildResult>
```

返回丰富的元数据，let task.ts 决定怎么呈现给 agent（Round 7 的 key:value 风格沿用）。

### 6.4 Mock 策略

`OpencodeClient` 是生成的大接口。测试不能真启 opencode 服务器。选项：

| 选项 | 优点 | 缺点 |
|---|---|---|
| A. 手写最小 mock（`{ session: { create, prompt, abort } }`） | 透明，快 | 每次 SDK 升级可能漏字段 |
| B. `mock.module("@opencode-ai/sdk")` | 完整隔离 | mock 全局状态泄漏（Round 1 踩过的坑）|
| C. HTTP 服务器夹具 | 最真实 | 最慢，启动开销大 |

**推荐 A**：`task/runner.test.ts` 手写一个 fake 实现 `Pick<OpencodeClient, "session">`，够跑测试就行。

### 6.5 同步版的错误呈现（沿用 Round 7）

```
task failed
  caller:          orchestrator
  target:          reviewer
  child session:   sess_abc123
  duration:        4.2s
  error:           provider-auth

Provider "anthropic" reported: invalid API key.

Action: check your OPENCODE_ANTHROPIC_API_KEY or provider config.
```

成功版：
```
task completed
  caller:          orchestrator
  target:          reviewer
  child session:   sess_abc123
  duration:        12.4s
  model:           anthropic/claude-opus-4-6
  cost:            $0.0234
  tokens:          in=4521 out=891

<assistant message text here, potentially multi-paragraph>
```

---

## 7. Round 8 开盘前需要拍板的 7 个问题

这些留给 Round 8 的设计盘，不在本备忘录里敲定。列出来让决策时不漏项：

1. **createTools 第二参数叫什么**：`deps` / `runtime` / `ctx`
2. **同步 OR 两版都做**：我推只做同步
3. **输出字段收哪些**：上面 6.5 给了 7 个字段，要不要减
4. **abort 传染是否 v1 就做**：我推做——代价小价值大
5. **timeout 是否暴露给 agent**：`task({ agent, prompt, timeout_seconds? })` 还是隐式走 abort
6. **child session 是否用 title**：好处是 parent 调 list/children 时看着清楚；缺点是多一个字段
7. **错误分类 → Action 的映射表**：5 种 error × 每种一句 action，需要具体措辞

---

## 8. 实测 TODO（Round 8 开始时 spike 验证）

下面几件事我本次调研**没有验证**，Round 8 开始时要先做 5 分钟 spike：

- [ ] `session.prompt` 是不是真的阻塞到 agent 完整回合结束（含 agent 内部 tool 调用循环）
- [ ] parent 的 `ctx.abort` 是否自动传染给 child session（不传染时我们要自己传）
- [ ] child 里发生的 `file.edited` 事件会不会被 parent 的 plugin hook 收到
- [ ] `session.prompt` body 里的 `agent` 字段是不是直接对应 opensober 的 agent name（而非 provider/model 格式）
- [ ] `session.prompt` 响应的 `parts` 数组里 `text` 部件是所有 assistant text 的合集（含多段），还是只有最后一段

前两条影响正确性，后三条影响我们怎么组织输出。

---

## 9. 一句话判断

**Round 8 走 promptAsync + poll + messages**（见 §2 更正后的路径）。SDK 有完整的父子会话 + abort 能力，核心工作是：
1. 把 client 从 plugin entry 穿到 task 工具（同时补 `injectServerAuthIntoClient`）
2. 写一个带轮询循环的 `runChildSession`（约 150 行）
3. 套上 Round 7 的 key:output 输出风格
4. 处理好 abort 手动传染 + error 的 5 种分类 + max_turns 上限

**不走 `session.prompt` 同步路径**（OmO 的生产代码证明它不可靠）。  
**不走 SubtaskPartInput**（那是给 LLM 直接输出用的，不适合我们的 tool 模型）。  
**不做异步/后台**（留 v1.1）。  
**不做流式进度**（留 v2）。

Round 8 开设计盘前，先过一遍第 10 节的 gap report + 第 7 节的 7 个拍板问题就可以动手。

---

## 10. Subagent gap report（Round 7 后对照 oh-my-opencode）

Round 7 之后又做了一轮针对性对照审查（4 个并发 subagent 各负责一块），发现 opensober 相对于 OmO 生产实现有多处运行时风险。下面按严重性重排，标注我们当前处理状态。

### BLOCKER — Round 8 动工前必须处理

| # | 问题 | 当前状态 |
|---|---|---|
| B1 | `session.prompt` 阻塞语义不可靠，必须走 promptAsync + poll | ✅ §2 已重写 |
| B2 | `$schema` 顶层字段被 `.strict()` 拒，真实用户会踩 | ✅ 已修（见 commit feat(config): accept top-level $schema...）|
| B3 | `createTools(config)` 接不下 client，task 拿不到 ctx.sessionID | 🔜 Round 8 第一件事 |

### IMPORTANT — 进入 Round 8 前置清单

| # | 问题 | OmO 参考 | 处理 |
|---|---|---|---|
| I1 | 缺 `injectServerAuthIntoClient` | `src/shared/opencode-server-auth.ts:158` | Round 8 |
| I2 | 缺 child session `permission: question/* deny` | `src/tools/delegate-task/sync-session-creator.ts:17` | Round 8 |
| I3 | 缺 plugin dispose / 重载幂等 | `src/index.ts:23, 38`；`src/plugin-dispose.ts:18-24` | Round 8（加 manager 时）|
| I4 | `.mcp.json` + `${VAR}` 展开 v1-scope 里 ✅ 但未实现 | `src/features/claude-code-mcp-loader/*` | ✅ scope 已降级为 deferred |
| I5 | 缺 `tools.disabled` 开关 | `src/plugin/tool-registry.ts:283` | ✅ 已修 |
| I6 | `read` 没硬截断，大文件吃光 context | `src/hooks/tool-output-truncator.ts` | v1.1 |
| I7 | 缺 max-turns 断路器 | `src/tools/delegate-task/sync-session-poller.ts:53,150-158` | Round 8（已纳入 §2 路径）|
| I8 | logger module-level state 重载不安全 | `src/shared/logger.ts:7-11` | Round 8 加 dispose 时一起 |

### NICE-TO-HAVE — v1.1+ 或用到再说

- sanitizeJsonSchema（`contentEncoding` 等关键字剥离）——目前没用到 base64 类 schema
- `experimental.max_tools` 上限——我们只 3 个工具
- `query.directory` 转发——Round 8 方案里已顺带纳入
- `config.get()` 取系统默认 model——model 来自我们自己的 config
- 外部 plugin 冲突检测——小众
- SIGINT/SIGTERM 注册 cleanup——Round 8 加 manager 时再看

### 对 Round 8 的影响

§2 的核心路径已重写。§6 / §7 的拍板问题仍然有效，但现在多了以下**必须一并解决**的条目：

- `runChildSession` 必须在循环里监听 `ctx.abort` 并主动调 `client.session.abort(childID)`
- `createTools` 签名补 `{ client, /* 其它 deps */ }`
- `src/index.ts` 入口进 `injectServerAuthIntoClient(ctx.client)` 等效实现
- `session.create.body` 带 `permission` override + `query.directory` 继承
- 把 stub `task.ts` 换成真 runner 时，Round 7 的 key:value 输出格式继续用
