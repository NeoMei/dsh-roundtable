import { describe, expect, it, vi } from 'vitest'
import { apply, renderNextRoundPrompt } from '../src/host.ts'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import { RoundtableId } from '../src/types.ts'
import type { RoundtableMember } from '../src/types.ts'

const A: RoundtableMember = { id: 'a', label: '架构师' }
const B: RoundtableMember = { id: 'b', label: '安全专家' }
const text = (s: string) => [{ type: 'text' as const, text: s }]

interface FakeMessage {
  id: string
  content: { type: 'text'; text: string }[]
  source: { kind: string; discussionId?: string }
}

interface SubagentResult {
  output: { type: 'text'; text: string }[]
  stopReason: string
}

interface DiscussionHandle {
  id: string
  started: Promise<unknown>
}

interface HostApi {
  startDiscussion(request: { host: unknown; topic: string; members: RoundtableMember[]; outputFile?: string }): DiscussionHandle
  get(host: unknown, id: string): unknown
}

interface RegisteredCommand {
  name: string
  handler: (invocation: { agent: unknown; rawInput: string }) => { kind: 'success' | 'error'; text?: string }
}

interface Harness {
  listeners: Map<string, Array<(...args: unknown[]) => unknown>>
  api: HostApi
  commands: RegisteredCommand[]
  emits: Array<{ name: string; args: unknown[] }>
  memberPrompts: string[]
  labels: string[]
  followups: FakeMessage[]
  nextStep: FakeMessage[]
  nextTurn: FakeMessage[]
  records: Array<{ type: string; data: unknown }>
  writes: Array<{ target: string; text: string }>
  host: unknown
  makeMessage: (content: string, kind: string) => FakeMessage
  release: () => void
}

function makeHarness(opts: { blockMembers?: boolean } = {}): Harness {
  const listeners = new Map<string, Array<(...args: unknown[]) => unknown>>()
  const emits: Array<{ name: string; args: unknown[] }> = []
  const memberPrompts: string[] = []
  const labels: string[] = []
  const writes: Array<{ target: string; text: string }> = []
  const records: Array<{ type: string; data: unknown }> = []
  const followups: FakeMessage[] = []
  const nextStep: FakeMessage[] = []
  const nextTurn: FakeMessage[] = []
  const commands: RegisteredCommand[] = []
  let nextId = 0
  let releaseMember: (() => void) | undefined

  const makeMessage = (content: string, kind: string): FakeMessage =>
    ({ id: `m${nextId++}`, content: [{ type: 'text', text: content }], source: { kind } })

  const host = {
    id: 'host-1',
    session: {
      events: [] as Array<{ type: string; data: unknown }>,
      append(type: string, data: unknown) { records.push({ type, data }); return data },
    },
    inbox: {
      get nextStep() { return nextStep },
      get nextTurn() { return nextTurn },
      get hasPending() { return nextStep.length > 0 || nextTurn.length > 0 },
      prepend(target: 'next-step' | 'next-turn', message: FakeMessage) {
        ;(target === 'next-step' ? nextStep : nextTurn).unshift(message)
      },
      append(target: 'next-step' | 'next-turn', message: FakeMessage) {
        ;(target === 'next-step' ? nextStep : nextTurn).push(message)
      },
      claimWhere(where: (message: FakeMessage) => boolean, _turn: number): FakeMessage[] {
        const matched = nextStep.filter(where)
        nextStep.splice(0, nextStep.length, ...nextStep.filter(message => !where(message)))
        return matched
      },
    },
    followup(message: FakeMessage) {
      followups.push(message)
      nextTurn.push(message)
    },
  }

  const subagents = {
    start: async (_name: string, req: { label?: string; prompt: { text?: string }[] }) => {
      const label = req.label ?? '?'
      labels.push(label)
      if (label !== '会议主持人') {
        memberPrompts.push(`${label}::${req.prompt.map(block => block.text ?? '').join('')}`)
      }
      if (opts.blockMembers && label !== '会议主持人') {
        const result = new Promise<SubagentResult>((resolve) => {
          releaseMember = () => resolve({ output: text(`${label} 发言`), stopReason: 'completed' })
        })
        return { result, dispose: async () => {} }
      }
      const out = label === '会议主持人' ? '【纪要】' : `${label} 发言`
      return {
        result: Promise.resolve({ output: text(out), stopReason: 'completed' }),
        dispose: async () => {},
      }
    },
  }

  const ctx = {
    subagents,
    logger: { warn: () => {} },
    fs: {
      resolve: async (path: string) => `/ws/${path}`,
      writeText: async (target: string, content: string) => { writes.push({ target, text: content }) },
    },
    on(name: string, cb: (...args: unknown[]) => unknown) {
      const list = listeners.get(name)
      if (list === undefined) listeners.set(name, [cb])
      else list.push(cb)
      return () => {
        const entry = listeners.get(name)
        if (entry === undefined) return
        const index = entry.indexOf(cb)
        if (index >= 0) entry.splice(index, 1)
      }
    },
    effect(generator: () => Generator<unknown, unknown, unknown>) {
      generator().next()
      return () => true
    },
    provide(name: string, value: unknown) {
      if (name === 'roundtableHost') provided = value as HostApi
      return () => true
    },
    inject(deps: string[], callback: (inner: { commands: { register: (definition: RegisteredCommand) => void } }) => void) {
      // Optional command child (mirrors plan-mode's `ctx.inject(['commands'], …)`):
      // mount synchronously so the /roundtable command registers in-process.
      const inner = { commands: { register: (definition: RegisteredCommand) => { commands.push(definition) } } }
      if (deps.includes('commands')) callback(inner)
      return Promise.resolve(undefined)
    },
    events: {
      dispatch(_mode: string, args: unknown[]) {
        const [name, ...rest] = args as [string, ...unknown[]]
        emits.push({ name, args: rest })
        return (listeners.get(name) ?? []).slice()
      },
    },
  }

  let provided: HostApi | undefined
  apply(ctx as never, { provider: 'fork' })
  if (provided === undefined) throw new Error('roundtableHost service was not provided')

  return {
    listeners, api: provided, commands, emits, memberPrompts, labels, followups, nextStep, nextTurn, records, writes,
    host, makeMessage,
    release: () => { releaseMember?.() },
  }
}

/** Invoke the registered pre-step handler with the given claimed messages. */
async function runPreStep(harness: Harness, messages: FakeMessage[]): Promise<PreStepDecision> {
  const handlers = harness.listeners.get('agent/pre-step') ?? []
  const handler = handlers[handlers.length - 1] as unknown as (
    payload: { agent: unknown; messages: FakeMessage[] },
    next: () => Promise<PreStepDecision>,
  ) => Promise<PreStepDecision>
  return handler({ agent: harness.host, messages }, () => Promise.resolve({ kind: 'enter', messages: messages as never }))
}

/** Fire the registered agent/session-start handler (the cross-process recovery trigger). */
function runSessionStart(harness: Harness): void {
  const handlers = harness.listeners.get('agent/session-start') ?? []
  const handler = handlers[handlers.length - 1] as unknown as (payload: { agent: unknown }) => void
  handler({ agent: harness.host })
}

/** Fire the registered agent/disposed handler (per-agent teardown). */
function runAgentDisposed(harness: Harness): void {
  const handlers = harness.listeners.get('agent/disposed') ?? []
  const handler = handlers[handlers.length - 1] as unknown as (payload: { agent: unknown }) => void
  handler({ agent: harness.host })
}

/** Start a discussion and await round 1 settling. */
async function startDiscussion(harness: Harness, topic = '评审方案', members: RoundtableMember[] = [A, B]): Promise<DiscussionHandle> {
  const handle = harness.api.startDiscussion({ host: harness.host, topic, members, outputFile: 'out.md' })
  await handle.started
  return handle
}

describe('renderNextRoundPrompt', () => {
  it('以主持人身份询问「是否进入下一轮？」并携带纪要', () => {
    const blocks = renderNextRoundPrompt({
      roundNumber: 1,
      topic: '评审方案',
      utterances: [{ memberId: 'a', label: '架构师', output: text('分层清晰'), stopReason: 'completed' }],
      humanSteers: [],
      summary: text('结构可行'),
    })
    expect(blocks).toHaveLength(1)
    const block = blocks[0]
    if (block?.type !== 'text') throw new Error('expected a text block')
    expect(block.text).toContain('是否进入下一轮？')
    expect(block.text).toContain('评审方案')
    expect(block.text).toContain('架构师')
    expect(block.text).toContain('结构可行')
  })
})

describe('roundtable-host live loop', () => {
  it('注册 ctx.roundtableHost 服务并安装 pre-step 拦截', () => {
    const harness = makeHarness()
    expect(harness.api).toBeTruthy()
    expect(harness.listeners.get('agent/pre-step')?.length).toBeGreaterThan(0)
  })

  it('/roundtable 命令解析 JSON 载荷并启动讨论', async () => {
    const harness = makeHarness()
    const command = harness.commands.find(entry => entry.name === 'roundtable')
    expect(command).toBeTruthy()
    const result = command!.handler({
      agent: harness.host,
      rawInput: ' {"topic":"审计","members":[{"id":"a","label":"架构师","agentOptions":{"provider":"openai","model":"gpt-4o"}}]}',
    })
    expect(result.kind).toBe('success')
    await vi.waitFor(() => { expect(harness.followups).toHaveLength(1) })
    expect(harness.memberPrompts).toHaveLength(1)
  })

  it('/roundtable 命令拒绝非法 JSON 载荷', () => {
    const harness = makeHarness()
    const command = harness.commands.find(entry => entry.name === 'roundtable')
    expect(command).toBeTruthy()
    const result = command!.handler({ agent: harness.host, rawInput: ' not-json' })
    expect(result.kind).toBe('error')
  })

  it('startDiscussion 跑第 1 轮后以 followup 呈现「是否进入下一轮？」', async () => {
    const harness = makeHarness()
    await startDiscussion(harness)
    expect(harness.labels).toEqual(['架构师', '安全专家', '会议主持人'])
    expect(harness.followups).toHaveLength(1)
    const followup = harness.followups[0]
    expect(followup?.source.kind).toBe('roundtable')
    const block = followup?.content[0]
    if (block?.type !== 'text') throw new Error('expected a text followup')
    expect(block.text).toContain('是否进入下一轮？')
  })

  it('人类「继续」路由到 continueRound 并拒绝宿主 turn', async () => {
    const harness = makeHarness()
    await startDiscussion(harness)
    const decision = await runPreStep(harness, [harness.makeMessage('继续', 'user')])
    expect(decision).toEqual({ kind: 'reject' })
    await vi.waitFor(() => { expect(harness.followups).toHaveLength(2) })
    expect(harness.memberPrompts).toHaveLength(4) // 两轮各两个成员
  })

  it('「继续，附带意见」把新意见注入下一轮成员 prompt', async () => {
    const harness = makeHarness()
    await startDiscussion(harness)
    await runPreStep(harness, [harness.makeMessage('继续，再补充架构细节', 'user')])
    await vi.waitFor(() => { expect(harness.followups).toHaveLength(2) })
    expect(harness.memberPrompts[2]).toContain('再补充架构细节')
  })

  it('批量人类消息里仍识别「继续」gate，并保留前面的 steer', async () => {
    const harness = makeHarness()
    await startDiscussion(harness)
    const decision = await runPreStep(harness, [
      harness.makeMessage('补充一点', 'user'),
      harness.makeMessage('继续', 'user'),
    ])
    expect(decision).toEqual({ kind: 'reject' })
    await vi.waitFor(() => { expect(harness.followups).toHaveLength(2) })
    // 「继续」被消费为 gate，跑第 2 轮；前面的 steer 被重新入队并注入下一轮第 2 位成员。
    expect(harness.memberPrompts[3]).toContain('补充一点')
    expect(harness.memberPrompts[3]).not.toContain('继续')
  })

  it('人类「停止」序列化写盘并清理讨论', async () => {
    const harness = makeHarness()
    const handle = await startDiscussion(harness)
    const decision = await runPreStep(harness, [harness.makeMessage('停止', 'user')])
    expect(decision).toEqual({ kind: 'reject' })
    await vi.waitFor(() => { expect(harness.writes).toHaveLength(1) })
    expect(harness.writes[0]?.target).toBe('/ws/out.md')
    expect(harness.writes[0]?.text).toContain('## 第 1 轮')
    expect(harness.api.get(harness.host, handle.id)).toBeUndefined()
  })

  it('轮中 steer 重排进 next-step 供 claimSteer 认领并拒绝宿主 turn', async () => {
    const harness = makeHarness({ blockMembers: true })
    const handle = harness.api.startDiscussion({ host: harness.host, topic: '评审方案', members: [A] })
    // 轮 1 正在运行（成员被阻塞），此时人类插入 steer。
    const decision = await runPreStep(harness, [harness.makeMessage('补充一点', 'user')])
    expect(decision).toEqual({ kind: 'reject' })
    expect(harness.nextStep.map(message => message.content[0]?.text)).toContain('补充一点')
    // 释放成员后，claimSteer 认领该 steer。
    harness.release()
    const minutes = await handle.started as { humanSteers: string[] }
    expect(minutes.humanSteers).toEqual(['补充一点'])
  })

  it('轮中只重排用户消息：非用户来源（roundtable 呈现等）不被恢复进 next-step', async () => {
    const harness = makeHarness({ blockMembers: true })
    harness.api.startDiscussion({ host: harness.host, topic: '评审方案', members: [A] })
    // 轮 1 运行中：一条用户 steer + 一条非用户消息（如宿主的下一轮呈现）。
    const decision = await runPreStep(harness, [
      harness.makeMessage('补充一点', 'user'),
      harness.makeMessage('请汇报', 'roundtable'),
    ])
    expect(decision).toEqual({ kind: 'reject' })
    // 只有用户 steer 被恢复；非用户消息不被 roundtable 驱动触碰。
    const requeued = harness.nextStep.map(message => message.content[0]?.text)
    expect(requeued).toEqual(['补充一点'])
    harness.release()
  })

  it('非人类来源（roundtable 呈现消息）放行给宿主', async () => {
    const harness = makeHarness()
    await startDiscussion(harness)
    const decision = await runPreStep(harness, [harness.makeMessage('请汇报', 'roundtable')])
    expect(decision.kind).toBe('enter')
  })

  it('无活跃讨论时人类消息放行', async () => {
    const harness = makeHarness()
    const decision = await runPreStep(harness, [harness.makeMessage('随便聊聊', 'user')])
    expect(decision.kind).toBe('enter')
  })

  it('awaitingGate 阶段的非 gate 人类消息放行给宿主（不吞进 steer 导致卡死）', async () => {
    const harness = makeHarness()
    await startDiscussion(harness) // 轮 1 结束 → awaitingGate
    const decision = await runPreStep(harness, [harness.makeMessage('我觉得架构还可以再优化', 'user')])
    expect(decision.kind).toBe('enter')
    expect(harness.nextStep).toHaveLength(0)
  })

  it('agent/session-start 从 session 事件流恢复未结束讨论（跨进程恢复）', () => {
    const harness = makeHarness()
    const events = (harness.host as { session: { events: Array<{ type: string; data: unknown }> } }).session.events
    const id = RoundtableId('rt-recovered')
    events.push(
      { type: 'roundtable/start', data: { id, roster: [A, B], topic: '评审方案' } },
      {
        type: 'roundtable/round-end',
        data: {
          discussionId: id,
          minutes: { roundNumber: 1, topic: '评审方案', utterances: [], humanSteers: [], summary: text('纪要') },
        },
      },
    )

    runSessionStart(harness)

    const handle = harness.api.get(harness.host, id) as { discussion: { rounds: unknown[]; roster: RoundtableMember[] } }
    expect(handle).toBeTruthy()
    expect(handle.discussion.roster).toEqual([A, B])
    expect(handle.discussion.rounds).toHaveLength(1)
  })

  it('agent/session-start 恢复中断在第 1 轮中途的讨论（仅 start 事件，含 topic）', () => {
    const harness = makeHarness()
    const events = (harness.host as { session: { events: Array<{ type: string; data: unknown }> } }).session.events
    const id = RoundtableId('rt-mid-round-1')
    events.push({ type: 'roundtable/start', data: { id, roster: [A, B], topic: '评审方案', outputFile: 'out.md' } })

    runSessionStart(harness)

    const handle = harness.api.get(harness.host, id) as {
      id: string
      phase: string
      discussion: { rounds: unknown[]; roster: RoundtableMember[] }
    }
    expect(handle).toBeTruthy()
    expect(handle.id).toBe(id)
    expect(handle.phase).toBe('awaitingGate')
    expect(handle.discussion.rounds).toEqual([])
  })

  it('单活跃讨论限制：已有讨论时第二个 startDiscussion 被大声拒绝', async () => {
    const harness = makeHarness()
    const first = await startDiscussion(harness)
    expect(harness.api.get(harness.host, first.id)).toBeTruthy()
    expect(() => harness.api.startDiscussion({
      host: harness.host, topic: '第二个话题', members: [A],
    })).toThrowError(/single-active|already active/i)
  })

  it('agent/disposed 卸载该 agent 的 recorder 共享监听（每 agent 一次，根 ctx 无累积）', async () => {
    const harness = makeHarness()
    await startDiscussion(harness)
    // startDiscussion 为该 host agent 创建 driver，其 recorder 在根 ctx 注册共享监听。
    expect(harness.listeners.get('roundtable/round-end')?.length).toBe(1)

    runAgentDisposed(harness)

    // agent 拆除后共享监听被卸载：后续每建一个 agent 不会在根 ctx 累积监听。
    expect(harness.listeners.get('roundtable/round-end')?.length ?? 0).toBe(0)
  })
})
