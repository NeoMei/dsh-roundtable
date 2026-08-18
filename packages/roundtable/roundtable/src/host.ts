/**
 * Live host-loop wiring for multi-round roundtable discussions.
 *
 * Where {@link createRoundtableHostDriver} is the injectable discussion-level
 * adapter, this plugin is the live seam that owns it: it holds one discussion
 * registry per host {@link @deepseek-ai/dsh-agent#Agent}, routes a human chat
 * message into the steer queue versus the round gate, and presents
 * "是否进入下一轮？" as the host's own follow-up turn. It mirrors
 * `@deepseek-ai/dsh-goal-round-driver`'s live-loop seams (`agent/pre-step`,
 * `agent/created` / `agent/disposed` / `agent/session-start`) without touching
 * the host agent's internal driver.
 *
 * The discussion is started through the `ctx.roundtableHost` service
 * (`startDiscussion`), which the member-selection UI (a follow-up task) calls.
 * The human-gated multi-round path is driven from there entirely by chat:
 * "继续" (optionally followed by an opinion) runs the next round, "停止"
 * serializes every round to markdown via `ctx.fs`, and any other human input
 * while a round is running is a mid-round steer claimed by the running round.
 *
 * @module @neomei/dsh-roundtable/host
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
// Type-only: pulls the `ctx.commands` merge for the `/roundtable` command child.
import type {} from '@deepseek-ai/dsh-commands'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, UserMessage } from '@deepseek-ai/dsh-llm'
import {
  createRoundtableHostDriver, parseGateReply,
} from './driver.ts'
import type {
  RoundtableDiscussionHandle, RoundtableGateReply, RoundtableHostDriver,
} from './driver.ts'
import { RoundtableError } from './service.ts'
import type { RoundMinutes, RoundtableId, RoundtableMember } from './types.ts'

export const name = 'roundtable-host'
/** Services this plugin injects: member/host subagents and the workspace filesystem. */
export const inject = ['subagents', 'fs']

export interface Config {
  /** `ctx.subagents` provider members and the host summarizer run on. */
  provider?: string
  /** 成员上限，缺省 8（spec §6）。 */
  maxMembers?: number
  /** 会议主持人 persona，缺省见 {@link createHostSummarizer}。 */
  hostPersona?: string
}

export const Config: z<Config> = z.object({
  provider: z.string().default('spawn'),
  maxMembers: z.number().default(8),
  hostPersona: z.string().required(false),
})

/** Host's own "是否进入下一轮？" follow-up turn carries this source. */
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    roundtable: { kind: 'roundtable'; discussionId: RoundtableId }
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context { roundtableHost: RoundtableHostApi }
}

/** Programmatic discussion start (the future member-selection UI's trigger). */
export interface RoundtableHostStartRequest {
  host: Agent
  topic: string
  members: RoundtableMember[]
  outputFile?: string
}

/** Public host-loop surface, registered as `ctx.roundtableHost`. */
export interface RoundtableHostApi {
  /**
   * Start a discussion on the host agent's live loop: validate the roster,
   * register the discussion, and run round 1.
   * @param request - the host agent, topic, roster, and optional output file.
   * @returns the stable discussion handle (started promise, phase, minutes).
   */
  startDiscussion(request: RoundtableHostStartRequest): RoundtableDiscussionHandle
  /**
   * Cancel a live discussion so it settles `cancelled`.
   * @param host - the host agent whose discussion to cancel.
   * @param id - the discussion id.
   */
  cancelDiscussion(host: Agent, id: RoundtableId): void
  /**
   * Look up a live discussion on the host agent.
   * @param host - the host agent whose registry to query.
   * @param id - the discussion id.
   * @returns the discussion handle, or undefined when no such discussion is live.
   */
  get(host: Agent, id: RoundtableId): RoundtableDiscussionHandle | undefined
}

/**
 * Per-host-agent live state: the discussion adapter plus its active discussion
 * registry, keyed by `discussionId`. The host loop is deliberately
 * single-active (spec: one discussion per agent at a time): a bare human
 * "继续"/"停止"/steer carries no discussionId, so with several concurrent
 * discussions the `agent/pre-step` message→discussion association is
 * ambiguous — `startDiscussion` therefore rejects while one is active rather
 * than silently sharing a slot.
 */
interface HostState {
  readonly agent: Agent
  driver: RoundtableHostDriver
  /** Active discussion ids in start order. */
  discussions: Map<RoundtableId, true>
  stopping: boolean
}

function textOf(blocks: ContentBlock[]): string {
  return blocks.map(block => (block.type === 'text' ? block.text ?? '' : '')).join('')
}

function renderThrown(value: unknown): string {
  return value instanceof Error ? value.message : String(value)
}

/**
 * Parse the JSON payload the member-picker UI sends through the `/roundtable`
 * command. The client owns no Host types, so the payload is structural JSON;
 * the host validates and re-shapes it into {@link RoundtableMember}s here.
 */
function parseStartPayload(rawInput: string):
  { ok: true; topic: string; members: RoundtableMember[] } | { ok: false; error: string } {
  let value: unknown
  try {
    value = JSON.parse(rawInput.trim())
  } catch {
    return { ok: false, error: '/roundtable needs a JSON payload: {"topic":"…","members":[{"id":"…","label":"…"}]}' }
  }
  if (typeof value !== 'object' || value === null) {
    return { ok: false, error: '/roundtable payload must be a JSON object' }
  }
  const record = value as Record<string, unknown>
  const topic = record.topic
  if (typeof topic !== 'string' || topic.trim() === '') {
    return { ok: false, error: '/roundtable payload needs a non-empty string `topic`' }
  }
  const membersRaw = record.members
  if (!Array.isArray(membersRaw)) {
    return { ok: false, error: '/roundtable payload needs a `members` array' }
  }
  const members: RoundtableMember[] = []
  for (const entry of membersRaw) {
    if (typeof entry !== 'object' || entry === null) {
      return { ok: false, error: 'each roundtable member must be a JSON object' }
    }
    const member = entry as Record<string, unknown>
    const id = member.id
    const label = member.label
    if (typeof id !== 'string' || id.trim() === '') {
      return { ok: false, error: 'each roundtable member needs a non-empty string `id`' }
    }
    if (typeof label !== 'string' || label.trim() === '') {
      return { ok: false, error: `roundtable member "${id}" needs a non-empty string label` }
    }
    const parsed: RoundtableMember = { id: id.trim(), label: label.trim() }
    if (typeof member.persona === 'string' && member.persona.trim() !== '') {
      parsed.persona = member.persona.trim()
    }
    if (member.agentOptions !== undefined) {
      if (typeof member.agentOptions !== 'object' || member.agentOptions === null) {
        return { ok: false, error: `roundtable member "${id}" agentOptions must be an object` }
      }
      const options = member.agentOptions as Record<string, unknown>
      const agentOptions: NonNullable<RoundtableMember['agentOptions']> = {}
      if (typeof options.provider === 'string' && options.provider.trim() !== '') {
        agentOptions.provider = options.provider.trim()
      }
      if (typeof options.model === 'string' && options.model.trim() !== '') {
        agentOptions.model = options.model.trim()
      }
      if (typeof options.maxTokens === 'number'
        && Number.isSafeInteger(options.maxTokens) && options.maxTokens > 0) {
        agentOptions.maxTokens = options.maxTokens
      }
      if (Object.keys(agentOptions).length > 0) parsed.agentOptions = agentOptions
    }
    members.push(parsed)
  }
  return { ok: true, topic: topic.trim(), members }
}

/**
 * The host's own follow-up prompt for one settled round: report the minutes
 * and ask the human whether to enter the next round. Deterministic, mirroring
 * {@link renderGoalRoundPrompt}.
 */
export function renderNextRoundPrompt(minutes: RoundMinutes): ContentBlock[] {
  const utterances = minutes.utterances.length === 0
    ? '（无成员发言）'
    : minutes.utterances.map(utterance => `【${utterance.label}】${textOf(utterance.output)}`).join('\n\n')
  const summary = textOf(minutes.summary)
  const text = [
    `第 ${minutes.roundNumber} 轮圆桌讨论已结束。`,
    `本轮话题：${minutes.topic}`,
    '',
    `**成员发言：**\n${utterances}`,
    '',
    `**本轮纪要：** ${summary}`,
    '',
    '请以会议主持人身份，向人类汇报本轮结论，然后询问「是否进入下一轮？」，'
    + '并说明回复「继续」进入下一轮、回复「停止」结束并导出纪要。本轮已结束，'
    + '不要调用任何工具或委派子代理。',
  ].join('\n')
  return [{ type: 'text', text }]
}

/** Re-queue claimed step input, preserving order and skipping an optionally consumed gate message. */
function restoreClaimed(agent: Agent, messages: UserMessage[], excluded?: UserMessage): void {
  for (const message of messages.toReversed()) {
    if (excluded !== undefined && message.id === excluded.id) continue
    if (agent.inbox.nextStep.some(candidate => candidate.id === message.id)
      || agent.inbox.nextTurn.some(candidate => candidate.id === message.id)) continue
    agent.inbox.prepend('next-step', message)
  }
}

/** Install the live host loop and register `ctx.roundtableHost`. */
export function apply(ctx: Context, config: Config): void {
  const provider = config.provider ?? 'spawn'
  const maxMembers = config.maxMembers ?? 8
  const states = new Map<Agent, HostState>()

  function stateFor(agent: Agent): HostState {
    const existing = states.get(agent)
    if (existing !== undefined) return existing
    const state: HostState = { agent, driver: undefined as unknown as RoundtableHostDriver, discussions: new Map(), stopping: false }
    state.driver = createRoundtableHostDriver(ctx, {
      provider,
      host: agent,
      maxMembers,
      ...(config.hostPersona !== undefined ? { hostPersona: config.hostPersona } : {}),
      askNextRound: (discussionId, minutes) => presentNextRound(state, discussionId, minutes),
    })
    states.set(agent, state)
    return state
  }

  function presentNextRound(state: HostState, discussionId: RoundtableId, minutes: RoundMinutes): void {
    if (state.stopping) return
    if (!state.discussions.has(discussionId)) return
    const message = createUserMessage({
      content: renderNextRoundPrompt(minutes),
      source: { kind: 'roundtable', discussionId },
    })
    try {
      state.agent.followup(message)
    } catch (error: unknown) {
      ctx.logger.warn(`roundtable-host: could not present next-round prompt: ${renderThrown(error)}`)
    }
  }

  function startDiscussion(request: RoundtableHostStartRequest): RoundtableDiscussionHandle {
    const state = stateFor(request.host)
    if (state.discussions.size > 0) {
      throw new RoundtableError(
        `roundtable-host: a discussion is already active on agent "${request.host.id}"`
        + ` (${[...state.discussions.keys()][0]}); the host loop is single-active — stop or cancel`
        + ' it before starting another',
        'DISCUSSION_ACTIVE',
      )
    }
    const handle = state.driver.startDiscussion({
      topic: request.topic,
      members: request.members,
      ...(request.outputFile !== undefined ? { outputFile: request.outputFile } : {}),
    })
    state.discussions.set(handle.id, true)
    return handle
  }

  function cancelDiscussion(host: Agent, id: RoundtableId): void {
    const state = states.get(host)
    if (state === undefined) return
    state.discussions.delete(id)
    state.driver.cancelDiscussion(id)
  }

  function get(host: Agent, id: RoundtableId): RoundtableDiscussionHandle | undefined {
    return states.get(host)?.driver.get(id)
  }

  ctx.provide('roundtableHost', { startDiscussion, cancelDiscussion, get })

  // The `/roundtable` slash command is the client bridge for the member-picker
  // UI: the picker sends `{ topic, members }` through `ctx.remote.commands.execute`
  // (the same client→host path ui-plan uses for `/plan off`), and this handler
  // starts the discussion on the receiving agent via `roundtableHost.startDiscussion`.
  // `recordInput: false` keeps the machine-generated roster out of the command
  // log; the authoritative payload is the `roundtable/start` event.
  ctx.inject(['commands'], (commandCtx) => {
    commandCtx.commands.register({
      name: 'roundtable',
      description: 'Start a multi-round roundtable discussion',
      input: { hint: '{"topic":"…","members":[{"id":"…","label":"…"}]}' },
      recordInput: false,
      handler: ({ agent, rawInput }) => {
        const parsed = parseStartPayload(rawInput)
        if (!parsed.ok) return { kind: 'error', text: parsed.error }
        try {
          const handle = startDiscussion({ host: agent, topic: parsed.topic, members: parsed.members })
          return { kind: 'success', text: `Roundtable started (${String(handle.id)}).` }
        } catch (error: unknown) {
          return { kind: 'error', text: renderThrown(error) }
        }
      },
    })
  })

  ctx.effect(function* () {
    ctx.on('agent/created', ({ agent }) => { stateFor(agent) })

    ctx.on('agent/disposed', ({ agent }) => {
      const state = states.get(agent)
      if (state === undefined) return
      state.stopping = true
      for (const id of state.discussions.keys()) state.driver.cancelDiscussion(id)
      state.discussions.clear()
      // Detach the per-agent recorder's shared round-* listeners so no listener
      // accumulates on the root context per agent (incl. member subagents).
      state.driver.dispose()
      states.delete(agent)
    })

    ctx.on('agent/session-start', ({ agent }) => {
      const state = stateFor(agent)
      // A fresh session replaces any discussions left live by the previous one.
      for (const id of state.discussions.keys()) state.driver.cancelDiscussion(id)
      state.discussions.clear()
      // Spec §8: 讨论可跨进程恢复. Rebuild durable-but-unsettled discussions
      // from the session log so a resumed session can keep driving its active
      // discussion ("继续"/"停止") instead of starting over. The durable
      // `roundtable/start` payload carries the topic (and output file), so a
      // discussion interrupted mid-round-1 is resumable too.
      for (const handle of state.driver.recover(agent.session)) {
        state.discussions.set(handle.id, true)
      }
    })

    ctx.on('agent/pre-step', async ({ agent, messages }, next): Promise<PreStepDecision> => {
      const state = states.get(agent)
      if (state === undefined) return next()
      // Single-active routing: a human "user" message carries no discussionId,
      // so chat traffic can only be attributed when exactly one discussion owns
      // this agent. `startDiscussion` enforces that invariant; if several
      // discussions ever coexist (e.g. a log with multiple unsettled
      // discussions), the loop defers to the agent instead of guessing.
      if (state.discussions.size !== 1) return next()
      const discussionId = [...state.discussions.keys()][0]!
      const handle = state.driver.get(discussionId)
      if (handle === undefined) {
        state.discussions.delete(discussionId)
        return next()
      }
      const humans = messages.filter(message => message.source.kind === 'user')
      if (humans.length === 0) return next()

      // Terminal discussions must never swallow human input: clean up the stale
      // registration and let the agent answer normally.
      if (handle.phase === 'completed' || handle.phase === 'cancelled' || handle.phase === 'error') {
        state.discussions.delete(discussionId)
        return next()
      }

      // A gate reply is only authoritative while the host is awaiting it; find
      // it among all claimed human input so a queued steer cannot shadow a
      // trailing "继续"/"停止".
      let consumed: UserMessage | undefined
      let gate: RoundtableGateReply | undefined
      if (handle.phase === 'awaitingGate') {
        for (const message of humans) {
          const reply = parseGateReply(textOf(message.content))
          if (reply !== undefined) {
            consumed = message
            gate = reply
            break
          }
        }
        if (gate !== undefined) {
          if (gate.gate === 'continue') {
            const opinion = gate.opinion
            void state.driver.continueRound(discussionId, opinion).catch((error: unknown) => {
              ctx.logger.warn(`roundtable-host: continue failed: ${renderThrown(error)}`)
            })
          } else {
            void state.driver.stopDiscussion(discussionId).then(() => {
              state.discussions.delete(discussionId)
            }).catch((error: unknown) => {
              ctx.logger.warn(`roundtable-host: stop failed: ${renderThrown(error)}`)
            })
          }
          // The gate command itself is consumed; re-queue only the human
          // messages (steers) and veto the host's step (no model turn for the
          // command). Non-user messages (the driver's own next-round
          // presentation, plugin context) are not steers — the loop re-claims
          // them on the next boundary instead of the driver touching them.
          restoreClaimed(agent, messages.filter(message => message.source.kind === 'user'), consumed)
          return { kind: 'reject' }
        }
        // No gate command while awaiting the gate: the human is saying something
        // else. Pass it through to the host agent instead of swallowing it into a
        // steer no running round will ever claim (that was the hang).
        return next()
      }

      // phase === 'running': any other human input is a mid-round steer. Re-queue
      // it so the running round's `claimSteer` picks it up, and veto the host's
      // own step (no model turn while a round is in flight). Only user messages
      // are re-queued — non-user messages are not steers and the driver must
      // not touch them.
      restoreClaimed(agent, messages.filter(message => message.source.kind === 'user'))
      return { kind: 'reject' }
    })

    yield async () => {
      for (const state of states.values()) {
        state.stopping = true
        for (const id of state.discussions.keys()) state.driver.cancelDiscussion(id)
        state.driver.dispose()
      }
      states.clear()
    }
  }, 'roundtable-host lifecycle')
}
