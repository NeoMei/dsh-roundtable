import { describe, expect, it } from 'vitest'
import { createRoundtableEngine } from '../src/engine.ts'

interface MemberRequest {
  label: string
  prompt: { text?: string }[]
  signal?: AbortSignal
}

function fakeCtx(opts: { blockMembers?: boolean; llmProviders?: string[]; writeError?: Error } = {}) {
  const calls: string[] = []
  const providers: string[] = []
  const events: Array<{ name: string; args: unknown[] }> = []
  const writes: Array<{ path: string; text: string }> = []
  const warns: string[] = []
  const listeners = new Map<string, Array<(...args: unknown[]) => unknown>>()
  // Optional fake llm service: `ctx.get('llm')` mirrors the cordis seam, so the
  // provider-capability pre-check only sees it when the test mounts it.
  const llm = opts.llmProviders === undefined
    ? undefined
    : { listProviders: () => opts.llmProviders!.map(id => ({ id, name: id })) }
  const subagents = {
    start: async (name: string, req: MemberRequest) => {
      providers.push(name)
      calls.push(req.label)
      if (opts.blockMembers && req.label !== '会议主持人') {
        const result = new Promise<{ output: { type: 'text'; text: string }[]; stopReason: string }>((_resolve, reject) => {
          req.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
        })
        return { result, dispose: async () => {} }
      }
      const text = req.label === '会议主持人' ? '【纪要】' : `${req.label} 发言`
      return {
        result: Promise.resolve({ output: [{ type: 'text', text }], stopReason: 'completed' }),
        dispose: async () => {},
      }
    },
  }
  const ctx = {
    subagents,
    get: (name: string) => (name === 'llm' ? llm : undefined),
    events: {
      dispatch: (_mode: string, args: unknown[]) => {
        const [name, ...rest] = args as [string, ...unknown[]]
        events.push({ name, args: rest })
        return (listeners.get(name) ?? []).slice()
      },
    },
    logger: { warn: (message: unknown) => { warns.push(String(message)) } },
    reflect: { provide: () => {} },
    on: (name: string, cb: (...args: unknown[]) => unknown) => {
      const list = listeners.get(name) ?? []
      list.push(cb)
      listeners.set(name, list)
      return () => true
    },
    fs: {
      resolve: async (path: string) => path,
      writeText: async (path: string, text: string) => {
        if (opts.writeError !== undefined) throw opts.writeError
        writes.push({ path, text })
      },
    },
  }
  return { calls, providers, events, writes, warns, ctx }
}

const parent = { session: { append: () => {} } } as never

describe('createRoundtableEngine', () => {
  it('按顺序跑成员并产出主持人纪要；未提供 outputFile 时不写盘', async () => {
    const { calls, providers, writes, ctx } = fakeCtx()
    const engine = createRoundtableEngine(ctx as never, { provider: 'fork' })
    const run = engine.start({ topic: 't', members: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], parent })
    const result = await run.result
    expect(calls).toEqual(['A', 'B', '会议主持人'])
    expect(providers).toEqual(['fork', 'fork', 'fork'])
    expect(result.stopReason).toBe('completed')
    // The skill flow never passes outputFile: no stray roundtable-rt-*.md file.
    expect(writes).toHaveLength(0)
  })

  it('request.outputFile 覆盖默认文件名', async () => {
    const { writes, ctx } = fakeCtx()
    const engine = createRoundtableEngine(ctx as never, { provider: 'fork' })
    const run = engine.start({ topic: 't', members: [{ id: 'a', label: 'A' }], outputFile: 'out/custom.md', parent })
    await run.result
    expect(writes).toHaveLength(1)
    expect(writes[0]!.path).toBe('out/custom.md')
  })

  it('request.provider 覆盖引擎配置的 provider', async () => {
    const { providers, ctx } = fakeCtx()
    const engine = createRoundtableEngine(ctx as never, { provider: 'fork' })
    const run = engine.start({ topic: 't', members: [{ id: 'a', label: 'A' }], provider: 'anthropic', parent })
    await run.result
    expect(providers).toEqual(['anthropic', 'anthropic'])
  })

  it('synthesize: false 跳过主持人 summarizer，不产出纪要', async () => {
    const { calls, providers, ctx } = fakeCtx()
    const engine = createRoundtableEngine(ctx as never, { provider: 'fork' })
    const run = engine.start({ topic: 't', members: [{ id: 'a', label: 'A' }], synthesize: false, parent })
    const result = await run.result
    expect(result.stopReason).toBe('completed')
    // 只有成员 run，没有「会议主持人」摘要 run。
    expect(calls).toEqual(['A'])
    expect(providers).toEqual(['fork'])
    expect(result.rounds[0]!.summary).toEqual([])
  })

  it('按生命周期发出 roundtable/start、round-end、end', async () => {
    const { events, ctx } = fakeCtx()
    const engine = createRoundtableEngine(ctx as never, { provider: 'fork' })
    const run = engine.start({ topic: 't', members: [{ id: 'a', label: 'A' }], parent })
    await run.result
    const names = events.map(e => e.name)
    expect(names).toEqual([
      'roundtable/start',
      'roundtable/round-end',
      'roundtable/end',
    ])
  })

  it('cancel 中止进行中的轮次并 settle 为 cancelled', async () => {
    const { events, ctx } = fakeCtx({ blockMembers: true })
    const engine = createRoundtableEngine(ctx as never, { provider: 'fork' })
    const run = engine.start({ topic: 't', members: [{ id: 'a', label: 'A' }], parent })
    run.cancel('用户放弃')
    const result = await run.result
    expect(result.stopReason).toBe('cancelled')
    expect(events.some(e => e.name === 'roundtable/end' && e.args[1] === 'cancelled')).toBe(true)
  })

  it('cancel 时 agentsStarted 返回实际已启动的成员数（而非硬编码 0）', async () => {
    const { ctx } = fakeCtx({ blockMembers: true })
    const engine = createRoundtableEngine(ctx as never, { provider: 'fork' })
    const run = engine.start({
      topic: 't', members: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], parent,
    })
    run.cancel('用户放弃')
    const result = await run.result
    expect(result.stopReason).toBe('cancelled')
    // 成员 A 已启动（member-start 已触发）即被中止，成员 B 尚未启动。
    expect(result.agentsStarted).toBe(1)
  })

  it('error 时 agentsStarted 仍反映实际启动的成员数', async () => {
    const { ctx } = fakeCtx({ writeError: new Error('disk full') })
    const engine = createRoundtableEngine(ctx as never, { provider: 'fork' })
    const run = engine.start({
      topic: 't', members: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], outputFile: 'out.md', parent,
    })
    const result = await run.result
    expect(result.stopReason).toBe('error')
    // 两个成员都完整跑完，只是导出失败 → agentsStarted 为 2，不是 0。
    expect(result.agentsStarted).toBe(2)
  })

  it('轮次完成后的写盘失败仍返回已完成的轮次（不序列化空工件），并记录错误日志', async () => {
    const { ctx, warns } = fakeCtx({ writeError: new Error('disk full') })
    const engine = createRoundtableEngine(ctx as never, { provider: 'fork' })
    const run = engine.start({ topic: 't', members: [{ id: 'a', label: 'A' }], outputFile: 'out.md', parent })
    const result = await run.result
    // 轮 1 已跑完，只是导出失败 → 结果携带已完成的轮次而非空数组。
    expect(result.stopReason).toBe('error')
    expect(result.rounds).toHaveLength(1)
    expect(result.rounds[0]!.roundNumber).toBe(1)
    // 失败不静默吞掉：错误路径记录警告，携带安全渲染的抛错信息。
    expect(warns.some(message => message.includes('disk full'))).toBe(true)
  })

  it('dispose 幂等并取消剩余工作', async () => {
    const { ctx } = fakeCtx({ blockMembers: true })
    const engine = createRoundtableEngine(ctx as never, { provider: 'fork' })
    const run = engine.start({ topic: 't', members: [{ id: 'a', label: 'A' }], parent })
    const first = run.dispose()
    const second = run.dispose()
    await first
    await second // 幂等：不抛错
    const result = await run.result
    expect(result.stopReason).toBe('cancelled')
  })

  it('拒绝空名单', () => {
    const { ctx } = fakeCtx()
    const engine = createRoundtableEngine(ctx as never, { provider: 'fork' })
    expect(() => engine.start({ topic: 't', members: [], parent })).toThrowError(/roster is empty/)
  })

  it('拒绝重复成员 id', () => {
    const { ctx } = fakeCtx()
    const engine = createRoundtableEngine(ctx as never, { provider: 'fork' })
    expect(() => engine.start({ topic: 't', members: [{ id: 'a', label: 'A' }, { id: 'a', label: 'A2' }], parent })).toThrowError(/duplicate member id/)
  })

  it('拒绝超过 maxMembers（缺省 8）的名单', () => {
    const { ctx } = fakeCtx()
    const engine = createRoundtableEngine(ctx as never, { provider: 'fork' })
    const members = Array.from({ length: 9 }, (_, i) => ({ id: `m${i}`, label: `M${i}` }))
    expect(() => engine.start({ topic: 't', members, parent })).toThrowError(/roster exceeds maxMembers/)
  })

  it('spec §7: 成员 agentOptions.provider 未在 ctx.llm 注册时拒绝名单', () => {
    const { ctx } = fakeCtx({ llmProviders: ['openai', 'anthropic'] })
    const engine = createRoundtableEngine(ctx as never, { provider: 'fork' })
    const members = [
      { id: 'a', label: 'A', agentOptions: { provider: 'openai' } },
      { id: 'b', label: 'B', agentOptions: { provider: 'no-such-provider' } },
    ]
    expect(() => engine.start({ topic: 't', members, parent })).toThrowError(/no-such-provider/)
  })

  it('spec §7: 未设置 agentOptions.provider 的成员不被拒绝（继承父路由）', async () => {
    const { ctx } = fakeCtx({ llmProviders: ['openai'] })
    const engine = createRoundtableEngine(ctx as never, { provider: 'fork' })
    const run = engine.start({
      topic: 't',
      members: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B', agentOptions: { provider: 'openai' } },
      ],
      parent,
    })
    const result = await run.result
    expect(result.stopReason).toBe('completed')
  })

  it('spec §7: ctx.llm 未挂载时跳过 provider 预检', async () => {
    const { ctx } = fakeCtx()
    const engine = createRoundtableEngine(ctx as never, { provider: 'fork' })
    const run = engine.start({
      topic: 't',
      members: [{ id: 'a', label: 'A', agentOptions: { provider: 'mystery' } }],
      parent,
    })
    const result = await run.result
    expect(result.stopReason).toBe('completed')
  })
})
