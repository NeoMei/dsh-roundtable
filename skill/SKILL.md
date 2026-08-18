---
name: roundtable
description: Use when the user opens with 圆桌讨论 (often with a topic) — set up the discussion by asking the user via the ask_user_question tool (inline choice/yes-no/input cards), add member agents one by one, then run a streaming turn-by-turn discussion whose host summarizes and asks whether to terminate, and on termination writes a markdown file.
---

# Roundtable Discussion (圆桌讨论)

## Overview

A multi-round discussion with a fixed neutral 会议主持人 and user-picked members. **All setup questions MUST go through the `ask_user_question` tool** — it renders inline choice / yes-no / input cards, so the user never has to type long free-form answers and cannot mistype an option. Never ask setup questions as plain chat text.

**Echo each card immediately**: after EVERY card is submitted, immediately output the chosen content as a normal chat message so the user sees what they just picked. Echo the 人设 too — do NOT skip it. Examples:
- 「已确定话题：…」
- 「已确定人设：关注系统分层与可扩展性」（after the persona card, ALWAYS echo the persona)
- 「已选择模型：glm-5.3」
- 「已加入：架构师｜人设：关注系统分层｜模型：glm-5.3」（after all three are set)

## Fixed Host Persona (always present, never editable)

**会议主持人**: neutral, impartial facilitator — keeps utterances on topic, produces each round's 纪要 (positions + agreement/disagreement), and asks whether to terminate. Never ask the user to configure it.

## Flow

1. **Topic** — if the user's opening message already contains the topic, use it. Otherwise call `ask_user_question` with a single text-input question (no options, or with a hint) asking for the topic. The topic may be long; the input card accepts it. After the topic is known, call the `roundtable_title` tool with it so the session is named after the topic (not a generic 圆桌讨论).

2. **Add members ONE BY ONE**, each via `ask_user_question`:
   - First ask which role to add: `ask_user_question` with choice options (recommend roles by topic, e.g. 架构师 / 安全专家 / 产品经理 / 性能专家 …) plus the user can type a custom role. One card = one member.
   - Then ask that member's persona (人设), and let the user MODIFY it: `ask_user_question` showing the role's DEFAULT persona as one option (「用默认人设：…」) plus the user can type a custom persona in the card's input. Record the final persona (default or the user's edit).
   - Then ask that member's model in TWO cards (provider → model): FIRST call the `roundtable_models` tool (no parameters) to get the live provider/model list from the runtime. Card 1 `ask_user_question` — choose the provider: options = 「默认（当前会话模型）」 (from the returned `default`) plus each `providers[].provider` (label it with its `name`). If the user picks a provider, Card 2 `ask_user_question` — choose the model under that provider: options = that provider's `models[].id`. Record `agentOptions = { provider, model }` (omit `agentOptions` for 默认).
   - Then ask 「还要再加一个 agent 吗？」: `ask_user_question` yes/no (是/否).
   - Repeat until the user answers 否.

3. **Start the discussion** — members speak ONE AT A TIME, in order:
   - For each member, run that ONE member (its persona + its model) on `topic + all prior utterances` — use the `roundtable` tool with a single-member roster and `synthesize: false`.
   - Then output the member's reply as a NORMAL chat message, streamed in the ordinary text flow: `【<label>】\n<utterance>`. One member = one normal visible message. Do NOT render it inside any special panel/box.

4. **Summarize and ask to terminate** — after the round, stream the 会议主持人's 纪要, then call `ask_user_question` yes/no: 「继续下一轮 / 终止讨论」. If the user has an extra opinion, they can type it in the card's input.

5. **User interjects anytime** — fold any user opinion into the next round's topic.

6. **On terminate** — write the final Markdown file with this structure, and hand the user the file path:
   - `# <话题>`
   - Per round: `## 第 k 轮` — a HIGH-LEVEL summary of that round (concise overview of what the members concluded, NOT the full member utterances).
   - `## 综合方案` — a DETAILED comprehensive plan that synthesizes ALL rounds' content into a concrete, actionable conclusion: the recommended approach, the rationale drawn from each round, points of agreement and disagreement, and any open questions.

## Member note

Each member: `id` (unique), `label`, optional `persona`, optional `provider`/`model` (any registered provider — non-DeepSeek models are supported).
