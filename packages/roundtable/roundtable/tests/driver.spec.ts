import { describe, expect, it } from 'vitest'
import {
  createHostSummarizer, createRoundtableDriver, createRoundtableHostDriver, parseGateReply,
} from '../src/driver.ts'
import type { MemberUtterance, RoundMinutes, RoundtableMember } from '../src/types.ts'

const A: RoundtableMember = { id: 'a', label: '架构师' }
const B: RoundtableMember = { id: 'b', label: '安全专家' }
const text = (s: string) => [{ type: 'text' as const, text: s }]

// ---------------------------------------------------------------------------
// 人类门分类
// ---------------------------------------------------------------------------

describe('parseGateReply', () => {
  it('识别「继续」与「停止」，并提取「继续」附带的新意见', () => {
    expect(parseGateReply('继续')).toEqual({ gate: 'continue', opinion: '' })
    expect(parseGateReply('继续，再补充架构细节')).toEqual({ gate: 'continue', opinion: '再补充架构细节' })
    expect(parseGateReply('继续讨论')).toEqual({ gate: 'continue', opinion: '' })
    expect(parseGateReply('停止')).toEqual({ gate: 'stop', opinion: '' })
    // 与「继续讨论」对称：直接输入「停止讨论」即停止（长词优先于「停止」）。
    expect(parseGateReply('停止讨论')).toEqual({ gate: 'stop', opinion: '' })
    expect(parseGateReply('停止讨论，我们评估一下')).toEqual({ gate: 'stop', opinion: '我们评估一下' })
    expect(parseGateReply('咱们停止讨论吧')).toEqual({ gate: 'stop', opinion: '' })
  })

  it('大小写不敏感，且非门命令返回 undefined', () => {
    expect(parseGateReply('Continue')).toEqual({ gate: 'continue', opinion: '' })
    expect(parseGateReply('STOP')).toEqual({ gate: 'stop', opinion: '' })
    expect(parseGateReply('')).toBeUndefined()
    expect(parseGateReply('随便聊聊')).toBeUndefined()
  })

  it('短消息内非句首的独立指令仍被识别（我们继续吧 / 先停止 / 好，继续）', () => {
    expect(parseGateReply('我们继续吧')).toEqual({ gate: 'continue', opinion: '' })
    expect(parseGateReply('先停止')).toEqual({ gate: 'stop', opinion: '' })
    expect(parseGateReply('好，继续')).toEqual({ gate: 'continue', opinion: '' })
    expect(parseGateReply('咱们继续吧')).toEqual({ gate: 'continue', opinion: '' })
    expect(parseGateReply('停止吧')).toEqual({ gate: 'stop', opinion: '' })
    expect(parseGateReply('please continue')).toEqual({ gate: 'continue', opinion: '' })
  })

  it('「继续」/「停止」嵌在较长的意见里时不误判（视为 steer，不当作 gate）', () => {
    expect(parseGateReply('我建议继续推进这个方案')).toBeUndefined()
    expect(parseGateReply('关于停止旧服务我有保留意见')).toBeUndefined()
    expect(parseGateReply('我觉得可以继续，但也要评估风险')).toBeUndefined()
    expect(parseGateReply('先停止这个，我们再评估一下')).toBeUndefined()
    expect(parseGateReply('继续推进')).toBeUndefined()
  })

  it('全角句号「。」与顿号「、」也可作命令词后的分隔符', () => {
    expect(parseGateReply('继续。附带意见')).toEqual({ gate: 'continue', opinion: '附带意见' })
    expect(parseGateReply('停止。导出到文件')).toEqual({ gate: 'stop', opinion: '导出到文件' })
    expect(parseGateReply('继续、附带意见')).toEqual({ gate: 'continue', opinion: '附带意见' })
    expect(parseGateReply('停止、导出到文件')).toEqual({ gate: 'stop', opinion: '导出到文件' })
  })

  it('同一短消息里同时出现继续与停止视为歧义，不分类', () => {
    expect(parseGateReply('停止继续')).toBeUndefined()
    expect(parseGateReply('继续停止')).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// 纯讨论核心
// ---------------------------------------------------------------------------

interface CoreDeps {
  prompts: string[]
  asked: RoundMinutes[]
  writes: string[]
  steers: string[]
  summarize: (members: RoundtableMember[], utterances: MemberUtterance[], topic: string, humanSteers: string[], prior?: { rounds: ReadonlyArray<{ roundNumber: number; summary: unknown[] }>; steers: string[] }) => Promise<{ type: 'text'; text: string }[]>
}

function core(deps: CoreDeps) {
  const signal = new AbortController().signal
  let claimCalls = 0
  return createRoundtableDriver(
    {
      runMember: async (member, prompt) => {
        deps.prompts.push(`${member.label}::${prompt}`)
        return { memberId: member.id, label: member.label, output: text(`${member.label} 发言`), stopReason: 'completed' }
      },
      summarize: deps.summarize,
      claimSteer: () => {
        claimCalls += 1
        const batch = deps.steers.splice(0)
        return claimCalls === 1 ? batch : []
      },
      writeMarkdown: async markdown => { deps.writes.push(markdown) },
      askNextRound: minutes => { deps.asked.push(minutes) },
    },
    { topic: '评审方案', members: [A, B], signal },
  )
}

function coreDeps(steers: string[] = []): CoreDeps {
  return {
    prompts: [],
    asked: [],
    writes: [],
    steers,
    summarize: async (_members, _utterances, topic) => text(`【${topic}纪要】`),
  }
}

describe('createRoundtableDriver', () => {
  it('start 跑第 1 轮并按序注入话题与前者发言，结束后询问人类', async () => {
    const deps = coreDeps()
    const driver = core(deps)
    const minutes = await driver.start()
    expect(minutes.roundNumber).toBe(1)
    expect(minutes.utterances.map(u => u.memberId)).toEqual(['a', 'b'])
    expect(deps.prompts[0]).toContain('评审方案')
    expect(deps.prompts[0]).not.toContain('架构师 发言')
    expect(deps.prompts[1]).toContain('架构师 发言')
    expect(deps.asked).toHaveLength(1)
    expect(deps.asked[0]).toBe(minutes)
    expect(driver.phase).toBe('awaitingGate')
  })

  it('continueRound 跑下一轮，把上轮 summary 作为输入', async () => {
    const deps = coreDeps()
    const driver = core(deps)
    await driver.start()
    const m2 = await driver.continueRound()
    expect(m2.roundNumber).toBe(2)
    expect(driver.discussion.rounds).toHaveLength(2)
    expect(deps.prompts[2]).toContain('【评审方案纪要】')
  })

  it('continueRound 附带的新意见注入下一轮成员 prompt', async () => {
    const deps = coreDeps()
    const driver = core(deps)
    await driver.start()
    await driver.continueRound('再补充架构细节')
    expect(deps.prompts[2]).toContain('再补充架构细节')
  })

  it('轮中 claimSteer 的意见注入下一位成员并记录进 humanSteers', async () => {
    const deps = coreDeps(['补充一点'])
    const driver = core(deps)
    const minutes = await driver.start()
    expect(deps.prompts[1]).toContain('补充一点')
    expect(minutes.humanSteers).toEqual(['补充一点'])
  })

  it('轮中 claimSteer 的意见传入 summarize，使本轮纪要反映人类意见', async () => {
    const deps = coreDeps(['补充一点'])
    let seenSteers: string[] | undefined
    deps.summarize = async (_members, _utterances, _topic, humanSteers) => {
      seenSteers = humanSteers
      return text('【纪要】')
    }
    const driver = core(deps)
    await driver.start()
    expect(seenSteers).toEqual(['补充一点'])
  })

  it('continueRound 把前几轮 humanSteers 折叠进下一轮成员 prompt', async () => {
    const deps = coreDeps(['补充一点'])
    const driver = core(deps)
    await driver.start()
    await driver.continueRound('继续意见')
    // 第 2 轮成员 prompt 同时携带前一轮的 steer 与「继续」附带意见。
    expect(deps.prompts[2]).toContain('补充一点')
    expect(deps.prompts[2]).toContain('继续意见')
  })

  it('stop 在轮次进行中（running）被拒绝，防止部分纪要写盘后轮次继续变异', async () => {
    const signal = new AbortController()
    const deps = coreDeps()
    let release!: () => void
    const driver = createRoundtableDriver(
      {
        runMember: async (member) => {
          // 阻塞成员，使 phase 保持 running。
          await new Promise<void>(resolve => { release = resolve })
          return { memberId: member.id, label: member.label, output: text(`${member.label} 发言`), stopReason: 'completed' }
        },
        summarize: deps.summarize,
        claimSteer: () => [],
        writeMarkdown: async markdown => { deps.writes.push(markdown) },
        askNextRound: minutes => { deps.asked.push(minutes) },
      },
      { topic: '评审方案', members: [A], signal: signal.signal },
    )
    const started = driver.start()
    await Promise.resolve()
    await expect(driver.stop()).rejects.toThrowError(/cannot stop while running/)
    // 讨论保持 active，未被部分停止。
    expect(driver.discussion.status).toBe('active')
    expect(driver.phase).toBe('running')
    release()
    const minutes = await started
    expect(minutes.roundNumber).toBe(1)
  })

  it('轮次进行中讨论被 fail 终结时，丢弃该轮 minutes 并抛错（不 push 进已终结讨论）', async () => {
    const deps = coreDeps()
    let driver!: ReturnType<typeof core>
    const signal = new AbortController()
    const blocked = createRoundtableDriver(
      {
        runMember: async (member) => {
          driver.fail('cancelled') // 成员发言期间讨论被取消
          return { memberId: member.id, label: member.label, output: text(`${member.label} 发言`), stopReason: 'completed' }
        },
        summarize: deps.summarize,
        claimSteer: () => [],
        writeMarkdown: async markdown => { deps.writes.push(markdown) },
        askNextRound: minutes => { deps.asked.push(minutes) },
      },
      { topic: '评审方案', members: [A], signal: signal.signal },
    )
    driver = blocked
    await expect(blocked.start()).rejects.toThrowError(/settled \(cancelled\) while round 1 ran/)
    expect(blocked.discussion.status).toBe('cancelled')
    expect(blocked.discussion.rounds).toEqual([])
    expect(deps.asked).toHaveLength(0)
  })

  it('stop 序列化全部轮次并写盘，settle 为 completed', async () => {
    const deps = coreDeps()
    const driver = core(deps)
    await driver.start()
    const markdown = await driver.stop()
    expect(deps.writes).toEqual([markdown])
    expect(markdown).toContain('# 评审方案')
    expect(markdown).toContain('## 第 1 轮')
    expect(markdown).toContain('**纪要：**')
    expect(markdown).not.toContain('### 架构师')
    expect(driver.discussion.status).toBe('completed')
    expect(driver.phase).toBe('completed')
  })

  it('stop 在异步写盘前同步进入终态：写盘期间到达的「继续」被拒绝，不产生被丢弃的轮次', async () => {
    const deps = coreDeps()
    let releaseWrite!: () => void
    const driver = createRoundtableDriver(
      {
        runMember: async (member) => ({ memberId: member.id, label: member.label, output: text(`${member.label} 发言`), stopReason: 'completed' }),
        summarize: deps.summarize,
        claimSteer: () => [],
        writeMarkdown: async markdown => {
          deps.writes.push(markdown)
          await new Promise<void>(resolve => { releaseWrite = resolve })
        },
        askNextRound: minutes => { deps.asked.push(minutes) },
      },
      { topic: '评审方案', members: [A], signal: new AbortController().signal },
    )
    await driver.start()
    const stopping = driver.stop()
    // 写盘尚未完成，但终态已同步生效。
    expect(driver.phase).toBe('completed')
    expect(driver.discussion.status).toBe('completed')
    expect(deps.writes).toHaveLength(1)
    // 写盘期间到达的「继续」被拒绝，而不是启动一个将被静默丢弃的轮次。
    // 核心的 continueRound 守卫是同步抛出（非 async），因此用函数式断言。
    expect(() => driver.continueRound()).toThrowError(/already completed/)
    expect(() => driver.continueRound('补充')).toThrowError(/already completed/)
    releaseWrite()
    const markdown = await stopping
    expect(markdown).toContain('# 评审方案')
    expect(driver.discussion.rounds).toHaveLength(1)
  })

  it('核心未注入 writeMarkdown 时 stop 不写盘，仅返回 markdown', async () => {
    const deps = coreDeps()
    const driver = createRoundtableDriver(
      {
        runMember: async (member) => ({ memberId: member.id, label: member.label, output: text(`${member.label} 发言`), stopReason: 'completed' }),
        summarize: deps.summarize,
        claimSteer: () => [],
        askNextRound: minutes => { deps.asked.push(minutes) },
      },
      { topic: '评审方案', members: [A], signal: new AbortController().signal },
    )
    await driver.start()
    const markdown = await driver.stop()
    expect(markdown).toContain('# 评审方案')
    expect(deps.writes).toHaveLength(0)
    expect(driver.discussion.status).toBe('completed')
    expect(driver.phase).toBe('completed')
  })

  it('continueRound 的 summarize 收到前几轮纪要与人类意见（整场讨论脉络）', async () => {
    const deps = coreDeps(['第一轮人类意见'])
    let seenPrior: { rounds: ReadonlyArray<{ roundNumber: number; summary: unknown[] }>; steers: string[] } | undefined
    let call = 0
    deps.summarize = async (_members, _utterances, _topic, _humanSteers, prior) => {
      seenPrior = prior
      call += 1
      return text(call === 1 ? '【第一轮纪要】' : '【第二轮纪要】')
    }
    const driver = core(deps)
    await driver.start()
    await driver.continueRound('继续意见')
    expect(seenPrior?.rounds).toEqual([{ roundNumber: 1, summary: text('【第一轮纪要】') }])
    expect(seenPrior?.steers).toEqual(['第一轮人类意见'])
  })

  it('纪要弧有上限：只把最近 K 轮纪要传给 summarize（约束 prompt 长度）', async () => {
    const deps = coreDeps()
    const priors: Array<{ rounds: ReadonlyArray<{ roundNumber: number }> }> = []
    deps.summarize = async (_members, _utterances, _topic, _humanSteers, prior) => {
      priors.push(prior as { rounds: ReadonlyArray<{ roundNumber: number }> })
      return text('【纪要】')
    }
    const driver = core(deps)
    await driver.start() // 轮 1（无 prior）
    await driver.continueRound() // 轮 2（prior: [1]）
    await driver.continueRound() // 轮 3（prior: [1, 2]）
    await driver.continueRound() // 轮 4（prior: [1, 2, 3]）
    await driver.continueRound() // 轮 5（prior 截断为最近 3 轮: [2, 3, 4]）
    const last = priors[priors.length - 1]!.rounds.map(round => round.roundNumber)
    expect(last).toEqual([2, 3, 4])
  })

  it('priorSteers 与纪要弧同窗口：只把最近 K 轮的人类意见传给后续轮次', async () => {
    const deps = coreDeps()
    const priors: Array<{ rounds: ReadonlyArray<{ roundNumber: number }>; steers: string[] }> = []
    deps.summarize = async (_members, _utterances, _topic, _humanSteers, prior) => {
      priors.push(prior as { rounds: ReadonlyArray<{ roundNumber: number }>; steers: string[] })
      return text('【纪要】')
    }
    let claimed = 0
    const driver = createRoundtableDriver(
      {
        runMember: async (member) => ({ memberId: member.id, label: member.label, output: text(`${member.label} 发言`), stopReason: 'completed' }),
        summarize: deps.summarize,
        // 每轮 claim 一个新的人类意见，使每轮都沉淀进 humanSteers。
        claimSteer: () => { claimed += 1; return [`第${claimed}轮意见`] },
        writeMarkdown: async markdown => { deps.writes.push(markdown) },
        askNextRound: minutes => { deps.asked.push(minutes) },
      },
      { topic: '评审方案', members: [A], signal: new AbortController().signal },
    )
    await driver.start()     // 轮 1（无 prior）
    await driver.continueRound() // 轮 2（prior.steers: [第1轮意见]）
    await driver.continueRound() // 轮 3（prior.steers: [1, 2]）
    await driver.continueRound() // 轮 4（prior.steers: [1, 2, 3]）
    await driver.continueRound() // 轮 5（prior.steers 截断为最近 3 轮: [2, 3, 4]）
    const last = priors[priors.length - 1]!.steers
    expect(last).toEqual(['第2轮意见', '第3轮意见', '第4轮意见'])
  })

  it('createHostSummarizer 的 prompt 携带前几轮纪要与人类意见，按轮渲染分隔', async () => {
    const prompts: string[] = []
    const subagents = {
      start: async (_name: string, req: { prompt: { text?: string }[] }) => {
        prompts.push(req.prompt.map(b => b.text ?? '').join(''))
        return {
          result: Promise.resolve({ output: text('【纪要】'), stopReason: 'completed' }),
          dispose: async () => {},
        }
      },
    }
    const summarize = createHostSummarizer({
      subagents: subagents as never, provider: 'fork',
      parent: { id: 'host-1' } as never, signal: new AbortController().signal,
    })
    await summarize([A], [{ memberId: 'a', label: '架构师', output: text('发言'), stopReason: 'completed' }],
      '本轮话题', ['本轮意见'], {
        rounds: [
          { roundNumber: 1, summary: text('第一轮纪要') },
          { roundNumber: 2, summary: text('第二轮纪要') },
        ],
        steers: ['前轮意见'],
      })
    expect(prompts).toHaveLength(1)
    // 每轮纪要按「### 第 k 轮纪要」分节渲染，空行分隔，不逐字拼接。
    expect(prompts[0]).toContain('### 第 1 轮纪要\n\n第一轮纪要')
    expect(prompts[0]).toContain('### 第 2 轮纪要\n\n第二轮纪要')
    expect(prompts[0]).toMatch(/第一轮纪要\n\n### 第 2 轮纪要/)
    expect(prompts[0]).toContain('前轮意见')
    expect(prompts[0]).toContain('本轮话题')
    expect(prompts[0]).toContain('本轮意见')
  })

  it('createHostSummarizer 落定为非 completed 时抛出，而非返回空纪要', async () => {
    const subagents = {
      start: async () => ({
        result: Promise.resolve({ output: text('【纪要】'), stopReason: 'error' }),
        dispose: async () => {},
      }),
    }
    const summarize = createHostSummarizer({
      subagents: subagents as never, provider: 'fork',
      parent: { id: 'host-1' } as never, signal: new AbortController().signal,
    })
    await expect(summarize([A], [{ memberId: 'a', label: '架构师', output: text('发言'), stopReason: 'completed' }],
      '本轮话题', [], undefined)).rejects.toThrowError(/stopped: error/)
  })

  it('fail 幂等 settle 为 cancelled/error', () => {
    const deps = coreDeps()
    const driver = core(deps)
    driver.fail('cancelled')
    expect(driver.discussion.status).toBe('cancelled')
    expect(driver.phase).toBe('cancelled')
    driver.fail('error') // 已终态，幂等
    expect(driver.discussion.status).toBe('cancelled')
  })
})

// ---------------------------------------------------------------------------
// 宿主 agent 适配器
// ---------------------------------------------------------------------------

function adapterCtx(
  labels: string[],
  onMemberStart?: (label: string) => void,
  opts: { blockMembers?: boolean } = {},
) {
  const listeners = new Map<string, Array<(...args: unknown[]) => unknown>>()
  const emitted: Array<{ name: string; args: unknown[] }> = []
  const memberPrompts: string[] = []
  const subagents = {
    start: async (_name: string, req: { label?: string; prompt: { text?: string }[]; signal?: AbortSignal }) => {
      const label = req.label ?? '?'
      labels.push(label)
      if (label !== '会议主持人') {
        memberPrompts.push(`${label}::${req.prompt.map(b => b.text ?? '').join('')}`)
      }
      onMemberStart?.(label)
      if (opts.blockMembers && label !== '会议主持人') {
        const result = new Promise<{ output: { type: 'text'; text: string }[]; stopReason: string }>((_resolve, reject) => {
          req.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
        })
        return { result, dispose: async () => {} }
      }
      const out = label === '会议主持人' ? '【纪要】' : `${label} 发言`
      return {
        result: Promise.resolve({ output: [{ type: 'text', text: out }], stopReason: 'completed' }),
        dispose: async () => {},
      }
    },
  }
  const ctx = {
    subagents,
    logger: { warn: () => {} },
    on(name: string, cb: (...args: unknown[]) => unknown) {
      const list = listeners.get(name) ?? []
      list.push(cb)
      listeners.set(name, list)
      return () => {
        const index = list.indexOf(cb)
        if (index >= 0) list.splice(index, 1)
      }
    },
    events: {
      dispatch(_mode: string, args: unknown[]) {
        const [name, ...rest] = args as [string, ...unknown[]]
        emitted.push({ name, args: rest })
        return (listeners.get(name) ?? []).slice()
      },
    },
  }
  return { ctx, memberPrompts, emitted, listeners }
}

interface FakeMessage {
  id: string
  content: { type: 'text'; text: string }[]
  source: { kind: string }
}

function adapterHost(steers: string[] = []) {
  const records: Array<{ type: string; data: unknown }> = []
  let nextId = 0
  const make = (text: string, kind: string): FakeMessage =>
    ({ id: `m${nextId++}`, content: [{ type: 'text', text }], source: { kind } })
  const queue: FakeMessage[] = steers.map(s => make(s, 'user'))
  const claimed: FakeMessage[] = []
  const host = {
    id: 'host-1',
    session: {
      append(type: string, data: unknown) { records.push({ type, data }); return data },
    },
    inbox: {
      get nextStep() { return queue },
      claimWhere(where: (message: FakeMessage) => boolean, _turn: number): FakeMessage[] {
        const matched = queue.filter(where)
        const kept = queue.filter(message => !where(message))
        queue.splice(0, queue.length, ...kept)
        claimed.push(...matched)
        return matched
      },
    },
  }
  const pushSteer = (s: string) => { queue.push(make(s, 'user')) }
  const pushOther = (s: string) => { queue.push(make(s, 'plugin')) }
  return { host, records, pushSteer, pushOther, queue, claimed }
}

describe('createRoundtableHostDriver', () => {
  it('startDiscussion 跑第 1 轮（成员+主持人），continueRound 跑下一轮', async () => {
    const labels: string[] = []
    const { ctx } = adapterCtx(labels)
    const writes: Array<{ markdown: string; outputFile: string }> = []
    const { host, records } = adapterHost()
    const driver = createRoundtableHostDriver(ctx as never, {
      provider: 'fork',
      host: host as never,
      writeMarkdown: async (markdown, outputFile) => { writes.push({ markdown, outputFile }) },
    })

    const handle = driver.startDiscussion({ topic: 't', members: [A, B], outputFile: 'out.md' })
    const m1 = await handle.started
    expect(m1?.roundNumber).toBe(1)
    expect(labels).toEqual(['架构师', '安全专家', '会议主持人'])
    expect(records.some(r => r.type === 'roundtable/round-end')).toBe(true)

    const m2 = await driver.continueRound(handle.id, '补充架构细节')
    expect(m2?.roundNumber).toBe(2)
    expect(labels).toEqual(['架构师', '安全专家', '会议主持人', '架构师', '安全专家', '会议主持人'])
  })

  it('轮中 steer 经宿主 inbox claim 后注入下一位成员', async () => {
    const labels: string[] = []
    const { host, records, pushSteer } = adapterHost()
    const { ctx, memberPrompts } = adapterCtx(labels, (label) => {
      if (label === '架构师') pushSteer('补充一点')
    })
    const driver = createRoundtableHostDriver(ctx as never, {
      provider: 'fork', host: host as never, writeMarkdown: async () => {},
    })
    const handle = driver.startDiscussion({ topic: 't', members: [A, B] })
    const minutes = await handle.started
    expect(minutes?.humanSteers).toEqual(['补充一点'])
    expect(memberPrompts[1]).toContain('补充一点')
    expect(records.length).toBeGreaterThan(0)
  })

  it('claimSteer 只认领人类 user steer，保留其它 source 的 next-step 消息', async () => {
    const labels: string[] = []
    const { host, pushOther, queue, claimed } = adapterHost()
    const { ctx } = adapterCtx(labels)
    const driver = createRoundtableHostDriver(ctx as never, {
      provider: 'fork', host: host as never, writeMarkdown: async () => {},
    })
    const handle = driver.startDiscussion({ topic: 't', members: [A] })
    pushOther('系统注入的上下文')
    const minutes = await handle.started
    expect(minutes?.humanSteers).toEqual([])
    expect(claimed).toEqual([])
    expect(queue.map(m => m.source.kind)).toEqual(['plugin'])
  })

  it('stopDiscussion 序列化写盘并 settle completed + 记录 roundtable/end', async () => {
    const labels: string[] = []
    const { ctx } = adapterCtx(labels)
    const writes: Array<{ markdown: string; outputFile: string }> = []
    const { host, records } = adapterHost()
    const driver = createRoundtableHostDriver(ctx as never, {
      provider: 'fork', host: host as never,
      writeMarkdown: async (markdown, outputFile) => { writes.push({ markdown, outputFile }) },
    })
    const handle = driver.startDiscussion({ topic: 't', members: [A], outputFile: 'out.md' })
    await handle.started
    const markdown = await driver.stopDiscussion(handle.id)
    expect(writes).toEqual([{ markdown, outputFile: 'out.md' }])
    expect(markdown).toContain('## 第 1 轮')
    expect(handle.discussion.status).toBe('completed')
    expect(records.some(r => r.type === 'roundtable/end')).toBe(true)
    expect(driver.get(handle.id)).toBeUndefined()
  })

  it('未显式提供 outputFile 时 stopDiscussion 跳过写盘（无 UUID 默认文件落盘）', async () => {
    const labels: string[] = []
    const { ctx } = adapterCtx(labels)
    const writes: Array<{ markdown: string; outputFile: string }> = []
    const { host, records } = adapterHost()
    const driver = createRoundtableHostDriver(ctx as never, {
      provider: 'fork', host: host as never,
      writeMarkdown: async (markdown, outputFile) => { writes.push({ markdown, outputFile }) },
    })
    const handle = driver.startDiscussion({ topic: 't', members: [A] })
    await handle.started
    const markdown = await driver.stopDiscussion(handle.id)
    expect(markdown).toContain('## 第 1 轮')
    // 没有 outputFile：绝不写盘，也不出现 roundtable-rt-<uuid>.md 默认文件。
    expect(writes).toHaveLength(0)
    expect(handle.discussion.status).toBe('completed')
    expect(records.some(r => r.type === 'roundtable/end')).toBe(true)
    expect(driver.get(handle.id)).toBeUndefined()
  })

  it('stop 写盘失败时 settle 为 error：roundtable/end 反映没有文件产出', async () => {
    const labels: string[] = []
    const { ctx } = adapterCtx(labels)
    const { host, records } = adapterHost()
    const driver = createRoundtableHostDriver(ctx as never, {
      provider: 'fork', host: host as never,
      writeMarkdown: async () => { throw new Error('disk full') },
    })
    const handle = driver.startDiscussion({ topic: 't', members: [A], outputFile: 'out.md' })
    await handle.started
    await expect(driver.stopDiscussion(handle.id)).rejects.toThrowError(/disk full/)
    // stop 的同步终态是 completed，但没有任何文件产出：durable 记录必须反映
    // error，绝不记录 completed。
    expect(records.some(r => r.type === 'roundtable/end'
      && (r.data as { stopReason: string }).stopReason === 'error')).toBe(true)
    expect(records.some(r => r.type === 'roundtable/end'
      && (r.data as { stopReason: string }).stopReason === 'completed')).toBe(false)
    expect(handle.discussion.status).toBe('error')
    expect(driver.get(handle.id)).toBeUndefined()
  })

  it('「继续」与进行中的「停止」竞争时，守卫拒绝不会把讨论 settle 成 error', async () => {
    const labels: string[] = []
    const { ctx, emitted } = adapterCtx(labels)
    const writes: Array<{ markdown: string; outputFile: string }> = []
    let releaseWrite!: () => void
    const { host, records } = adapterHost()
    const driver = createRoundtableHostDriver(ctx as never, {
      provider: 'fork', host: host as never,
      writeMarkdown: async (markdown, outputFile) => {
        writes.push({ markdown, outputFile })
        await new Promise<void>(resolve => { releaseWrite = resolve })
      },
    })
    const handle = driver.startDiscussion({ topic: 't', members: [A], outputFile: 'out.md' })
    await handle.started
    const stopping = driver.stopDiscussion(handle.id)
    // stop 的同步终态已生效（写盘尚未完成）；此时到达的「继续」触发守卫拒绝。
    expect(handle.phase).toBe('completed')
    const continued = await driver.continueRound(handle.id, '补充')
    expect(continued).toBeUndefined()
    // 守卫拒绝绝不 settle：不产生任何 roundtable/end（尤其不是 error），
    // 讨论保持 completed（由 stop 的同步终态决定）。
    expect(records.some(r => r.type === 'roundtable/end')).toBe(false)
    expect(emitted.some(e => e.name === 'roundtable/end')).toBe(false)
    expect(handle.discussion.status).toBe('completed')
    releaseWrite()
    const markdown = await stopping
    expect(markdown).toContain('## 第 1 轮')
    expect(records.some(r => r.type === 'roundtable/end'
      && (r.data as { stopReason: string }).stopReason === 'completed')).toBe(true)
    expect(driver.get(handle.id)).toBeUndefined()
  })

  it('stop 同步终态生效后到达的 cancelDiscussion 不把 settlement 覆盖成 cancelled', async () => {
    const labels: string[] = []
    const { ctx, emitted } = adapterCtx(labels)
    const writes: Array<{ markdown: string; outputFile: string }> = []
    let releaseWrite!: () => void
    const { host, records } = adapterHost()
    const driver = createRoundtableHostDriver(ctx as never, {
      provider: 'fork', host: host as never,
      writeMarkdown: async (markdown, outputFile) => {
        writes.push({ markdown, outputFile })
        await new Promise<void>(resolve => { releaseWrite = resolve })
      },
    })
    const handle = driver.startDiscussion({ topic: 't', members: [A], outputFile: 'out.md' })
    await handle.started
    const stopping = driver.stopDiscussion(handle.id)
    // stop 的同步终态已生效（写盘尚未完成）；此时到达的 cancel 是迟到的竞争。
    expect(handle.phase).toBe('completed')
    driver.cancelDiscussion(handle.id, '用户放弃')
    // 不产生 cancelled 的 roundtable/end —— 终态由进行中的 stopDiscussion 决定。
    expect(emitted.some(e => e.name === 'roundtable/end')).toBe(false)
    expect(records.some(r => r.type === 'roundtable/end')).toBe(false)
    expect(handle.discussion.status).toBe('completed')
    releaseWrite()
    const markdown = await stopping
    expect(markdown).toContain('## 第 1 轮')
    // 最终以 completed 落定，而不是被迟到的 cancel 覆盖成 cancelled。
    expect(records.some(r => r.type === 'roundtable/end'
      && (r.data as { stopReason: string }).stopReason === 'completed')).toBe(true)
    expect(driver.get(handle.id)).toBeUndefined()
  })

  it('stop 同步终态生效后 dispose 不把 durable 记录覆盖成 cancelled（终态保持 completed）', async () => {
    const labels: string[] = []
    const { ctx } = adapterCtx(labels)
    const writes: Array<{ markdown: string; outputFile: string }> = []
    let releaseWrite!: () => void
    const { host, records } = adapterHost()
    const driver = createRoundtableHostDriver(ctx as never, {
      provider: 'fork', host: host as never,
      writeMarkdown: async (markdown, outputFile) => {
        writes.push({ markdown, outputFile })
        await new Promise<void>(resolve => { releaseWrite = resolve })
      },
    })
    const handle = driver.startDiscussion({ topic: 't', members: [A], outputFile: 'out.md' })
    await handle.started
    const stopping = driver.stopDiscussion(handle.id)
    // stop 的同步终态已生效（写盘尚未完成）；此时 agent 拆除触发 dispose。
    expect(handle.phase).toBe('completed')
    driver.dispose()
    // dispose 的防守性拆除把进行中 stop 的终态记录为 completed——绝不重写为
    // cancelled（镜像 cancelDiscussion 的 stop-before-cancel 守卫）。
    expect(records.some(r => r.type === 'roundtable/end'
      && (r.data as { stopReason: string }).stopReason === 'completed')).toBe(true)
    expect(records.some(r => r.type === 'roundtable/end'
      && (r.data as { stopReason: string }).stopReason === 'cancelled')).toBe(false)
    expect(handle.discussion.status).toBe('completed')
    releaseWrite()
    const markdown = await stopping
    expect(markdown).toContain('## 第 1 轮')
  })

  it('dispose 卸载 recorder 的共享 round-end 监听（每 agent 一次，避免根 ctx 监听累积）', () => {
    const labels: string[] = []
    const { ctx, listeners } = adapterCtx(labels)
    const { host } = adapterHost()
    const driver = createRoundtableHostDriver(ctx as never, {
      provider: 'fork', host: host as never, writeMarkdown: async () => {},
    })
    // 创建 driver（每 agent 一个）即在根 ctx 注册 recorder 的共享监听。
    expect(listeners.get('roundtable/round-end')?.length).toBe(1)
    driver.dispose()
    // dispose 卸载它：agent 拆除后根 ctx 无残留监听。
    expect(listeners.get('roundtable/round-end')?.length ?? 0).toBe(0)
  })

  it('cancelDiscussion settle 为 cancelled', async () => {
    const labels: string[] = []
    const { ctx } = adapterCtx(labels)
    const { host, records } = adapterHost()
    const driver = createRoundtableHostDriver(ctx as never, {
      provider: 'fork', host: host as never, writeMarkdown: async () => {},
    })
    const handle = driver.startDiscussion({ topic: 't', members: [A] })
    await handle.started
    driver.cancelDiscussion(handle.id, '用户放弃')
    expect(handle.discussion.status).toBe('cancelled')
    expect(records.some(r => r.type === 'roundtable/end'
      && (r.data as { stopReason: string }).stopReason === 'cancelled')).toBe(true)
    expect(driver.get(handle.id)).toBeUndefined()
  })

  it('cancelDiscussion 中止外部 signal 的进行中轮次，roundtable/end 与 status 一致', async () => {
    const labels: string[] = []
    const external = new AbortController()
    const { host, records } = adapterHost()
    const { ctx } = adapterCtx(labels, undefined, { blockMembers: true })
    const driver = createRoundtableHostDriver(ctx as never, {
      provider: 'fork', host: host as never, writeMarkdown: async () => {},
    })
    const handle = driver.startDiscussion({ topic: 't', members: [A], signal: external.signal })
    driver.cancelDiscussion(handle.id, '用户放弃')
    const started = await handle.started
    expect(started).toBeUndefined()
    expect(handle.discussion.status).toBe('cancelled')
    expect(records.some(r => r.type === 'roundtable/end'
      && (r.data as { stopReason: string }).stopReason === 'cancelled')).toBe(true)
    expect(driver.get(handle.id)).toBeUndefined()
  })

  it('拒绝空名单与重复成员 id', () => {
    const labels: string[] = []
    const { ctx } = adapterCtx(labels)
    const { host } = adapterHost()
    const driver = createRoundtableHostDriver(ctx as never, {
      provider: 'fork', host: host as never, writeMarkdown: async () => {},
    })
    expect(() => driver.startDiscussion({ topic: 't', members: [] })).toThrowError(/roster is empty/)
    expect(() => driver.startDiscussion({ topic: 't', members: [A, { ...A, label: 'A2' }] })).toThrowError(/duplicate member id/)
  })

  it('拒绝超过 maxMembers（缺省 8）的名单', () => {
    const labels: string[] = []
    const { ctx } = adapterCtx(labels)
    const { host } = adapterHost()
    const driver = createRoundtableHostDriver(ctx as never, {
      provider: 'fork', host: host as never, writeMarkdown: async () => {},
    })
    const nine = Array.from({ length: 9 }, (_, i) => ({ id: `m${i}`, label: `M${i}` }))
    expect(() => driver.startDiscussion({ topic: 't', members: nine })).toThrowError(/roster exceeds maxMembers/)
  })

  it('maxMembers 覆盖后接受更大名单', async () => {
    const labels: string[] = []
    const { ctx } = adapterCtx(labels)
    const { host } = adapterHost()
    const driver = createRoundtableHostDriver(ctx as never, {
      provider: 'fork', host: host as never, writeMarkdown: async () => {}, maxMembers: 10,
    })
    const nine = Array.from({ length: 9 }, (_, i) => ({ id: `m${i}`, label: `M${i}` }))
    const handle = driver.startDiscussion({ topic: 't', members: nine })
    await handle.started
    expect(handle.discussion.rounds).toHaveLength(1)
  })
})
