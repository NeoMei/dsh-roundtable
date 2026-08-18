import { describe, expect, it, vi } from 'vitest'
import { createMemberRunner } from '../src/member-runner.ts'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { RoundtableMember } from '../src/types.ts'

/**
 * Unit coverage for the atomic member runner: a fake `ctx.subagents` whose run
 * resolves to a final output. The runner returns the member's utterance as one
 * atomic result and always disposes the run.
 */

const MEMBER: RoundtableMember = { id: 'a', label: '架构师' }

function fakeSubagents(opts: { reject?: boolean; stopReason?: string } = {}) {
  const dispose = vi.fn(async () => {})
  const start = vi.fn(async () => ({
    result: opts.reject
      ? Promise.reject(new Error('boom'))
      : Promise.resolve({ output: [{ type: 'text', text: '最终发言' }], stopReason: opts.stopReason ?? 'completed' }),
    dispose,
  }))
  return { start, dispose }
}

describe('createMemberRunner', () => {
  it('returns the atomic utterance from run.result and disposes the run', async () => {
    const subagents = fakeSubagents()
    const runner = createMemberRunner({ subagents: subagents as never, provider: 'fork', parent: {} as Agent })
    const utterance = await runner(MEMBER, 'prompt', new AbortController().signal)
    expect(utterance).toEqual({
      memberId: 'a', label: '架构师', output: [{ type: 'text', text: '最终发言' }], stopReason: 'completed',
    })
    expect(subagents.start).toHaveBeenCalledTimes(1)
    expect(subagents.dispose).toHaveBeenCalledTimes(1)
  })

  it('forwards the member persona, agentOptions, toolFilter, maxDepth, signal, and parent', async () => {
    const subagents = fakeSubagents()
    const signal = new AbortController().signal
    const parent = { id: 'host-1' } as Agent
    const runner = createMemberRunner({ subagents: subagents as never, provider: 'fork', parent })
    await runner({
      id: 'a', label: '架构师', persona: 'p', agentOptions: { model: 'm' },
      toolFilter: { allow: [] } as never, maxDepth: 2,
    }, 'prompt', signal)
    const [provider, req] = subagents.start.mock.calls[0]! as unknown as [string, Record<string, unknown>]
    expect(provider).toBe('fork')
    expect(req.label).toBe('架构师')
    expect(req.persona).toBe('p')
    expect(req.agentOptions).toEqual({ model: 'm' })
    expect(req.toolFilter).toEqual({ allow: [] })
    expect(req.maxDepth).toBe(2)
    expect(req.signal).toBe(signal)
    expect(req.parent).toBe(parent)
  })

  it('disposes the run even when run.result rejects', async () => {
    const subagents = fakeSubagents({ reject: true })
    const runner = createMemberRunner({ subagents: subagents as never, provider: 'fork', parent: {} as Agent })
    await expect(runner(MEMBER, 'prompt', new AbortController().signal)).rejects.toThrowError('boom')
    expect(subagents.dispose).toHaveBeenCalledTimes(1)
  })

  it('成员落定为非 completed（模型/传输失败）时抛出，而非当作正常发言', async () => {
    const subagents = fakeSubagents({ stopReason: 'error' })
    const runner = createMemberRunner({ subagents: subagents as never, provider: 'fork', parent: {} as Agent })
    await expect(runner(MEMBER, 'prompt', new AbortController().signal)).rejects.toThrowError(/stopped: error/)
    expect(subagents.dispose).toHaveBeenCalledTimes(1)
  })
})
