# dsh-roundtable

圆桌讨论（Roundtable）—— DeepSeek Harness 的多智能体圆桌讨论插件。多个成员按固定顺序发言，会议主持人逐轮汇总，最终把整场讨论落成一份会议纪要 Markdown。

- 成员是**真实的 subagent**，各自跑在自己的模型上（可跨 provider）。
- 全程用 `ask_user_question` 内联卡片引导，用户不用手敲选项、不会输错。
- 成员发言以**普通聊天文字流**逐条输出，没有特殊面板。
- 会话按话题自动命名，结束时写出结构化的会议纪要文件。

---

## 目录

1. [仓库结构](#仓库结构)
2. [工作原理](#工作原理)
3. [三个插件包](#三个插件包)
4. [模型侧工具](#模型侧工具)
5. [会话事件](#会话事件)
6. [会议纪要格式](#会议纪要格式)
7. [要求](#要求)
8. [安装](#安装)
9. [使用](#使用)
10. [配置](#配置)
11. [开发](#开发)
12. [已知限制](#已知限制)
13. [License](#license)

---

## 仓库结构

```
dsh-roundtable/
├── packages/
│   ├── roundtable/
│   │   ├── roundtable/        @deepseek-ai/dsh-roundtable     宿主引擎
│   │   └── tool-roundtable/   @deepseek-ai/dsh-tool-roundtable 模型侧工具
│   └── client/
│       └── ui-roundtable/     @deepseek-ai/dsh-client-ui-roundtable 侧边栏入口
├── skill/
│   └── SKILL.md               圆桌讨论 skill（对话式引导）
├── install.sh                 一键安装脚本
├── README.md
└── LICENSE                     MIT
```

| 包 | 作用 |
| --- | --- |
| `@deepseek-ai/dsh-roundtable` | 宿主引擎：单轮执行器、成员运行器、主持人汇总、纪要序列化、`roundtable/*` 事件与落盘/跨进程恢复 |
| `@deepseek-ai/dsh-tool-roundtable` | 模型侧工具：`roundtable` / `roundtable_models` / `roundtable_title` |
| `@deepseek-ai/dsh-client-ui-roundtable` | 侧边栏「新讨论组」入口：新建会话并发起圆桌讨论 |
| `skill/SKILL.md` | 圆桌讨论 skill：卡片式引导 + 逐成员发言 + 汇总 + 写纪要 |

---

## 工作原理

```
侧边栏「新讨论组」
   └─> 新建会话，发送「圆桌讨论」
         └─> roundtable skill 接管
               ├─ 问话题（ask_user_question 输入卡片）
               │     └─> roundtable_title 把会话名设为话题
               ├─ 逐个加成员：角色 → 人设 → 模型（roundtable_models 给运行时列表）
               │     └─ 问「还要再加一个吗？」直到否
               ├─ 逐成员发言：
               │     roundtable 工具（单成员 + synthesize:false）
               │     └─> 真实 subagent 在该成员自己的模型上运行
               │     └─> 发言以普通聊天消息逐条输出
               ├─ 主持人汇总本轮纪要
               ├─ 问「继续下一轮 / 终止讨论」
               └─ 终止 ──> 写出会议纪要 Markdown
```

**关键点：** 每个成员是 `ctx.subagents.start(provider, …)` 启动的真实子代理，`agentOptions.provider/model` 决定它跑在哪个模型上（与宿主无关，可跨 provider）。成员跑完一个，输出一个，按顺序。

---

## 三个插件包

### `@deepseek-ai/dsh-roundtable`（宿主引擎）

提供 `ctx.roundtable` 服务，核心是单轮讨论：

```ts
const run = ctx.roundtable.start({
  topic: string,
  members: RoundtableMember[],   // 数组顺序即发言顺序
  parent: Agent,                 // 调用方 agent（落盘到它的 session）
  synthesize?: boolean,          // 默认 true；false = 只跑成员、不产出综合方案
  provider?: string,             // 覆盖引擎默认的 subagent provider
  outputFile?: string,           // 停止时写纪要的路径（不给则不落盘文件）
  signal?: AbortSignal,
})
const { stopReason, agentsStarted, rounds } = await run.result
```

成员结构：

```ts
interface RoundtableMember {
  id: string          // 唯一标识
  label: string       // 显示名，如「架构师」
  persona?: string    // 角色遮蔽
  agentOptions?: {    // 该成员的独立模型路由
    provider?: string
    model?: string
    maxTokens?: number
  }
  toolFilter?: ToolRestriction
  maxDepth?: number
}
```

- 校验：名单非空、无重复 `id`、不超过 `maxMembers`（默认 8）；成员显式设置的 `agentOptions.provider` 必须在 `ctx.llm` 已注册。
- 终止原因 `stopReason`：`completed` / `cancelled` / `error`。
- 成员失败（模型/传输错误）会让整轮落定为 `error`（**不会**把空/残缺发言当成正常发言）。

引擎配置（Cordis Config）：

```ts
interface Config {
  provider?: string     // 默认 'spawn'：成员与主持人 subagent 跑在哪个 provider
  maxMembers?: number   // 默认 8
}
```

### `@deepseek-ai/dsh-tool-roundtable`（模型侧工具）

注册三个工具（见[模型侧工具](#模型侧工具)），并把 `roundtable` 工具的使用引导注入 system prompt。

### `@deepseek-ai/dsh-client-ui-roundtable`（侧边栏入口）

在侧边栏底部注册「新讨论组」按钮：解析当前/最近 Workspace → 新建会话 → 发送「圆桌讨论」→ 交给 skill。按钮在无法解析目标 Workspace 时禁用。

---

## 模型侧工具

### `roundtable`

跑一轮多智能体讨论，返回纪要。

```ts
{
  topic: string           // 讨论话题，必填
  members: Array<{        // 成员，数组顺序即发言顺序，必填
    id: string
    label: string
    persona?: string
    provider?: string
    model?: string
  }>
  synthesize?: boolean    // 默认 true
}
```

返回：

```ts
{
  stopReason: 'completed' | 'cancelled' | 'error'
  markdown: string        // 会议纪要 markdown（synthesize:true 时含综合方案）
  utterances: Array<{     // 每个成员的原文（synthesize:false 时用这个）
    memberId: string
    label: string
    text: string
  }>
}
```

- `synthesize: true`（默认）：跑完整一轮 + 主持人汇总，返回带纪要/综合方案的 markdown。
- `synthesize: false`：**只跑成员、跳过主持人汇总**，render 直接给成员原文 —— 这是 skill 逐成员发言用的模式。
- 非 `completed` 落定（成员失败/取消）会抛错，工具结果成为 `isError`，宿主能感知失败。

### `roundtable_models`

列出运行时已注册的 LLM provider 与模型，供成员模型卡片选择（不读 settings.yaml，直接读 `ctx.llm`）。

```ts
{}  // 无参数
// 返回
{
  default?: { provider: string; model: string }   // 调用 agent 的当前模型
  providers: Array<{
    provider: string
    name: string
    models: Array<{ id: string; name: string }>
  }>
}
```

单个 provider 列模型失败（缺凭证/非法目录）会被**跳过**，不拖垮整张卡片。

### `roundtable_title`

把当前会话标题设为给定标题（通常是话题）。

```ts
{ title: string }   // 必填
// 返回 { title: string }
```

---

## 会话事件

引擎通过 `ctx.events` 发出三个 `roundtable/*` 事件，落盘到调用方 `parent` 的 Session（recorder 投影），也支持跨进程恢复：

| 事件 | 载荷 | 含义 |
| --- | --- | --- |
| `roundtable/start` | `RoundtableInfo { id, roster, topic, outputFile? }` | 讨论开启（固定名单 + 话题） |
| `roundtable/round-end` | `{ discussionId, minutes }` | 一轮落定（纪要 + 成员发言） |
| `roundtable/end` | `{ discussionId, stopReason }` | 讨论终止 |

这三个事件是 `log-only` 类型，走 `session.append` 落盘；`recoverRoundtableDiscussions` 可以从事件日志里重建未终止的讨论。

---

## 会议纪要格式

`serializeRoundtableMarkdown` 确定性输出：

```markdown
# <话题> 会议纪要

## 参会人员

- **架构师**（anthropic · claude-3）
- **会议主持人**（主持人）

## 第 1 轮

**议题：** <本轮话题>

**纪要：** <本轮纪要+结论>

## 综合方案            ← 仅多轮 + synthesize 开启时出现

### 第 1 轮纪要
…
```

- 每轮只渲染**高层纪要**（议题 + 纪要），不逐字罗列成员发言。
- 「综合方案」只在多轮讨论且 `synthesize: true` 时产出，聚合各轮纪要。

---

## 要求

- **DSH（DeepSeek Harness）`0.1.0-rc.6`**。
- 三个插件包的**直接** `@deepseek-ai/dsh-*` 依赖 pin 到精确的 `0.1.0-rc.6`，因为 `^0.1.0-rc.6` 会解析到 API 不兼容的 `0.1.0-rc.7+`。
- pnpm（profile 侧安装用）。

---

## 安装

### 0. 一键安装脚本（推荐）

构建出三个 tarball 后，用仓库自带的 [`install.sh`](install.sh) 一步完成安装：

```sh
./install.sh --tgz-dir /path/to/tgz          # 三个 tarball 所在目录
# 或直接给三个 tarball（任意顺序）
./install.sh /path/a.tgz /path/b.tgz /path/c.tgz
```

脚本会自动：把 tarball 复制进 profile 的 `roundtable-tgzs/`（`file:` 依赖指向稳定路径）→ `pnpm add` 三个包 → 幂等写入 `cordis.patch.yml` 的 insert 条目（已存在则跳过）→ 复制 skill 到 `~/.agents/skills/roundtable/SKILL.md` → 提示重启。

```sh
./install.sh --help          # 全部选项
./install.sh --dry-run --tgz-dir /path/to/tgz   # 只预演，不执行
./install.sh --profile ~/.dsh/profiles/other --tgz-dir /path/to/tgz   # 指定 profile
```

下面第 1–4 步是脚本所做之事的逐步手动版，供排查/自定义用。

### 1. 构建（在 deepseek-harness checkout 里）

本仓库是**源码分发**，规范构建路径是在与目标 DSH 同版本的 deepseek-harness checkout 里：

```sh
# 把三个包放进 checkout：
#   packages/roundtable/roundtable
#   packages/roundtable/tool-roundtable
#   packages/client/ui-roundtable
pnpm build:lib:host      # 构建宿主（引擎 + 工具）
pnpm build:lib:client    # 构建客户端 bundle
```

然后每个包打包：

```sh
cd packages/roundtable/roundtable && pnpm pack
cd packages/roundtable/tool-roundtable && pnpm pack
cd packages/client/ui-roundtable && pnpm pack
```

得到三个 tarball：
- `deepseek-ai-dsh-roundtable-0.1.0-rc.6.tgz`
- `deepseek-ai-dsh-tool-roundtable-0.1.0-rc.6.tgz`
- `deepseek-ai-dsh-client-ui-roundtable-0.1.0-rc.6.tgz`

### 2. 装进 profile

```sh
cd ~/.dsh/profiles/desktop
pnpm add /path/to/deepseek-ai-dsh-roundtable-0.1.0-rc.6.tgz \
         /path/to/deepseek-ai-dsh-tool-roundtable-0.1.0-rc.6.tgz \
         /path/to/deepseek-ai-dsh-client-ui-roundtable-0.1.0-rc.6.tgz
```

在 profile 的 `cordis.patch.yml` 里插入三个插件：

```yaml
- insert:
    - id: roundtable
      name: '@deepseek-ai/dsh-roundtable'
      config:
        provider: spawn          # 可选，默认 spawn

    - id: tool-roundtable
      name: '@deepseek-ai/dsh-tool-roundtable'

    - id: ui-roundtable
      name: '@deepseek-ai/dsh-client-ui-roundtable'
```

### 3. 安装 skill

```sh
mkdir -p ~/.agents/skills/roundtable
cp skill/SKILL.md ~/.agents/skills/roundtable/SKILL.md
```

### 4. 重启

**完全重启 DSH Desktop**，宿主插件才会加载。

---

## 使用

1. 点侧边栏底部「新讨论组」。
2. 自动新建会话并发送「圆桌讨论」，skill 开始用卡片引导。
3. 按卡片依次输入/选择：话题 → 成员（角色 → 人设 → 模型，可加多人）→ 开始。
4. 成员逐个发言（普通聊天消息）；主持人每轮汇总后问「继续下一轮 / 终止讨论」。
5. 选「终止」后，主持人写出会议纪要 Markdown 并给出文件路径。

用户可随时在卡片里输入额外意见，会折入下一轮话题。

---

## 配置

| 位置 | 项 | 默认 | 说明 |
| --- | --- | --- | --- |
| 引擎 `roundtable` | `provider` | `spawn` | 成员与主持人 subagent 的 provider |
| 引擎 `roundtable` | `maxMembers` | `8` | 单场讨论成员上限 |
| 工具 `tool-roundtable` | `toolName` | `roundtable` | `roundtable` 工具的注册名 |

成员模型不在此处配置 —— 由 skill 用 `roundtable_models` 的运行时列表让用户逐个选择。

---

## 开发

源码依赖 `@deepseek-ai/dsh-*@0.1.0-rc.6`（发布在 npm）。在 checkout 内：

```sh
pnpm vitest run packages/roundtable packages/client/ui-roundtable   # 单元测试（host 125+ / client）
pnpm tsc -b tsconfig.host.json                                     # 宿主类型检查
pnpm tsc -b tsconfig.client.json                                   # 客户端类型检查
```

> 说明：宿主引擎 + 工具可用发布的 rc.6 包独立做类型检查。多轮宿主循环（`host.ts` / `driver.ts` 的 `claimSteer`）与 web 客户端 bundle 依赖 harness 内部的宿主循环 / client-runtime API，需在 checkout 内构建与类型检查。

---

## 已知限制

- **成员发言非流式**：成员是各自子会话里的真实 subagent，发言要等该成员跑完才作为一条消息出现（这是 DSH subagent 的固有约束）。
- 多轮宿主循环（`host.ts`）是代码库里保留的另一种驱动方式，**未接线**到当前 skill 流程；当前由 skill 驱动多轮。
- 依赖 pin 到 `0.1.0-rc.6`；核心包的传递依赖仍按它们自身的范围解析，升级 DSH 需重新核对 API。

---

## License

[MIT](LICENSE)
