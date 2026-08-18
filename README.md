# dsh-roundtable

圆桌讨论（Roundtable）—— DeepSeek Harness 的多智能体圆桌讨论插件。多个成员按固定顺序发言，会议主持人逐轮汇总，最终产出会议纪要 Markdown。

## 包含

| 包 | 说明 |
| --- | --- |
| [`@deepseek-ai/dsh-roundtable`](packages/roundtable/roundtable) | 宿主引擎：单轮执行器、成员运行器、纪要序列化、`roundtable/*` 事件与落盘/恢复 |
| [`@deepseek-ai/dsh-tool-roundtable`](packages/roundtable/tool-roundtable) | 模型侧工具：`roundtable`（跑单轮讨论）、`roundtable_models`（列 provider/模型）、`roundtable_title`（按话题命名会话） |
| [`@deepseek-ai/dsh-client-ui-roundtable`](packages/client/ui-roundtable) | 侧边栏「新讨论组」入口：新建会话并发起圆桌讨论 |
| [`skill/SKILL.md`](skill/SKILL.md) | 圆桌讨论 skill：用 `ask_user_question` 卡片一步步引导话题 → 成员（角色/人设/模型）→ 逐成员发言 → 主持人汇总 → 继续/终止 → 写纪要 |

## 目标版本

**DSH `0.1.0-rc.6`。** 三个插件包的直接 `@deepseek-ai/dsh-*` 依赖 pin 到精确的 `0.1.0-rc.6`（而不是 `^0.1.0-rc.6`），因为 `^0.1.0-rc.6` 会解析到 API 不兼容的 `0.1.0-rc.7+`。核心包的传递依赖仍按它们自身的范围解析。

## 工作方式

1. 侧边栏「新讨论组」→ 新会话 → 触发 `roundtable` skill。
2. skill 用 `ask_user_question` 内联卡片收集话题，再逐个加入成员（角色 / 人设 / 模型，模型来自 `roundtable_models` 的运行时列表）。
3. 每个成员用 `roundtable` 工具（单成员 + `synthesize: false`）在**自己的模型**上运行，是真实的 subagent；发言以普通聊天文字流逐条输出。
4. 主持人汇总，`ask_user_question` 询问继续/终止；终止后写入会议纪要 Markdown。

## 构建

本仓库是源码分发。规范的构建路径是在 **deepseek-harness checkout** 里进行（这也是开发时用的路径）：

1. 把三个包放入 checkout 的 `packages/roundtable/roundtable`、`packages/roundtable/tool-roundtable`、`packages/client/ui-roundtable`；
2. `pnpm build:lib:host` 与 `pnpm build:lib:client`；
3. 每个包 `pnpm pack` 得到 tarball。

> 说明：宿主引擎 + 工具可用发布到 npm 的 `@deepseek-ai/dsh-*@0.1.0-rc.6` 独立做类型检查（`pnpm exec tsc --noEmit -p packages/roundtable/roundtable` 等）。多轮宿主循环（`host.ts` / `driver.ts` 的 `claimSteer`）与 web 客户端 bundle 依赖 harness 内部的宿主循环 / client-runtime API，需在 checkout 内构建与类型检查。

## 安装到 DSH profile

以已构建的三个 tarball 为例：

```sh
cd ~/.dsh/profiles/desktop
pnpm add /path/to/deepseek-ai-dsh-roundtable-0.1.0-rc.6.tgz \
           /path/to/deepseek-ai-dsh-tool-roundtable-0.1.0-rc.6.tgz \
           /path/to/deepseek-ai-dsh-client-ui-roundtable-0.1.0-rc.6.tgz
```

在 profile 的 `cordis.patch.yml` 里插入三个插件：

```yaml
insert:
  - name: roundtable
    provider: spawn
  - name: tool-roundtable
  - name: ui-roundtable
```

把 `skill/SKILL.md` 放到 `~/.agents/skills/roundtable/SKILL.md`。最后**完全重启 DSH Desktop**。

## License

[MIT](LICENSE)
