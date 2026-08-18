import { describe, expect, it } from 'vitest'
import { apply } from '../src/index.ts'

function fakeCtx(opts: { rounds?: unknown[]; stopReason?: string } = {}) {
  const registered: unknown[] = []
  const started: unknown[] = []
  return {
    registered, started,
    ctx: {
      systemPrompt: { section: () => {} },
      tools: { register: (t: unknown) => { registered.push(t) } },
      roundtable: {
        start: (r: unknown) => {
          started.push(r)
          return {
            id: 'rt-1',
            result: Promise.resolve({
              stopReason: opts.stopReason ?? 'completed',
              agentsStarted: 1,
              rounds: opts.rounds ?? [],
            }),
            dispose: async () => {},
          }
        },
      },
    },
  }
}

describe('tool-roundtable', () => {
  it('把 members 映射成 agentOptions 并启动', async () => {
    const { registered, started, ctx } = fakeCtx()
    apply(ctx as never, { toolName: 'roundtable' })
    const tool = registered[0] as { execute: (a: unknown, e: unknown) => Promise<unknown> }
    await tool.execute(
      { topic: 't', members: [{ id: 'a', label: 'A', provider: 'anthropic', model: 'claude-3' }] },
      { agent: { id: 'p' }, signal: new AbortController().signal },
    )
    const req = started[0] as { members: { agentOptions?: { provider: string; model: string } }[] }
    expect(req.members[0]!.agentOptions).toEqual({ provider: 'anthropic', model: 'claude-3' })
  })

  it('synthesize: false 转发给引擎并省略综合方案', async () => {
    const round = { roundNumber: 1, topic: 't', utterances: [], humanSteers: [], summary: [{ type: 'text', text: '结论' }] }
    const { registered, started, ctx } = fakeCtx({ rounds: [round] })
    apply(ctx as never, { toolName: 'roundtable' })
    const tool = registered[0] as { execute: (a: unknown, e: unknown) => Promise<unknown> }
    const out = await tool.execute(
      { topic: 't', members: [{ id: 'a', label: 'A' }], synthesize: false },
      { agent: { id: 'p' }, signal: new AbortController().signal },
    ) as { markdown: string }
    expect((started[0] as { synthesize?: boolean }).synthesize).toBe(false)
    expect(out.markdown).not.toContain('## 综合方案')
  })

  it('synthesize: false 时返回成员原文 utterances，render 输出原文而非空 markdown', async () => {
    const round = {
      roundNumber: 1,
      topic: 't',
      utterances: [{ memberId: 'a', label: '架构师', output: [{ type: 'text', text: '分层清晰' }], stopReason: 'completed' }],
      humanSteers: [],
      summary: [],
    }
    const { registered, ctx } = fakeCtx({ rounds: [round] })
    apply(ctx as never, { toolName: 'roundtable' })
    const tool = registered[0] as {
      execute: (a: unknown, e: unknown) => Promise<unknown>
      output: { render: (a: unknown, v: unknown) => Array<{ text: string }> }
    }
    const out = await tool.execute(
      { topic: 't', members: [{ id: 'a', label: '架构师' }], synthesize: false },
      { agent: { id: 'p' }, signal: new AbortController().signal },
    ) as { utterances: { label: string; text: string }[] }
    expect(out.utterances[0]!.text).toBe('分层清晰')
    const rendered = tool.output.render({ synthesize: false }, out)
    expect(rendered[0]!.text).toContain('分层清晰')
  })

  it('成员失败（非 completed 落定）时 execute 抛出，使工具结果成为 isError 而非成功空结果', async () => {
    const { registered, ctx } = fakeCtx({ stopReason: 'error' })
    apply(ctx as never, { toolName: 'roundtable' })
    const tool = registered[0] as { execute: (a: unknown, e: unknown) => Promise<unknown> }
    await expect(tool.execute(
      { topic: 't', members: [{ id: 'a', label: 'A' }] },
      { agent: { id: 'p' }, signal: new AbortController().signal },
    )).rejects.toThrowError(/roundtable error/)
  })

  it('取消（cancelled 落定）同样抛出，而不是返回序列化后的空轮次', async () => {
    const { registered, ctx } = fakeCtx({ stopReason: 'cancelled' })
    apply(ctx as never, { toolName: 'roundtable' })
    const tool = registered[0] as { execute: (a: unknown, e: unknown) => Promise<unknown> }
    await expect(tool.execute(
      { topic: 't', members: [{ id: 'a', label: 'A' }] },
      { agent: { id: 'p' }, signal: new AbortController().signal },
    )).rejects.toThrowError(/roundtable cancelled/)
  })

  it('roundtable_models 从 ctx.llm 列出 providers/models 并附带 default', async () => {
    const registered: unknown[] = []
    const llm = {
      listProviders: () => [
        { id: 'p1', name: 'Provider One' },
        { id: 'p2', name: 'Provider Two' },
      ],
      listModels: async (provider: string) => provider === 'p1'
        ? [
          { provider: 'p1', id: 'm1', name: 'Model One' },
          { provider: 'p1', id: 'm2', name: 'Model Two' },
        ]
        : [{ provider: 'p2', id: 'm3', name: 'Model Three' }],
    }
    const ctx = {
      systemPrompt: { section: () => {} },
      tools: { register: (t: unknown) => { registered.push(t) } },
      llm,
    }
    apply(ctx as never, { toolName: 'roundtable' })
    const tool = registered[1] as { execute: (a: unknown, e: unknown) => Promise<unknown> }
    const out = await tool.execute(
      {},
      { agent: { id: 'p', options: { provider: 'p1', model: 'm1' } }, signal: new AbortController().signal },
    ) as {
      default?: { provider: string; model: string }
      providers: Array<{ provider: string; name: string; models: Array<{ id: string; name: string }> }>
    }
    expect(out.default).toEqual({ provider: 'p1', model: 'm1' })
    expect(out.providers).toEqual([
      { provider: 'p1', name: 'Provider One', models: [{ id: 'm1', name: 'Model One' }, { id: 'm2', name: 'Model Two' }] },
      { provider: 'p2', name: 'Provider Two', models: [{ id: 'm3', name: 'Model Three' }] },
    ])
  })

  it('roundtable_models 单个 provider 列模型失败时跳过它，不拖垮整张卡片', async () => {
    const registered: unknown[] = []
    const llm = {
      listProviders: () => [
        { id: 'ok', name: 'OK Provider' },
        { id: 'bad', name: 'Bad Provider' },
      ],
      listModels: async (provider: string) => {
        if (provider === 'bad') throw new Error('no credentials')
        return [{ provider, id: 'm1', name: 'Model One' }]
      },
    }
    const ctx = {
      systemPrompt: { section: () => {} },
      tools: { register: (t: unknown) => { registered.push(t) } },
      llm,
    }
    apply(ctx as never, { toolName: 'roundtable' })
    const tool = registered[1] as { execute: (a: unknown, e: unknown) => Promise<unknown> }
    const out = await tool.execute(
      {},
      { agent: { id: 'p', options: { provider: 'ok', model: 'm1' } }, signal: new AbortController().signal },
    ) as { providers: Array<{ provider: string }> }
    expect(out.providers.map(p => p.provider)).toEqual(['ok'])
  })
})
