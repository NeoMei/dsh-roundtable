import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as SessionInvariant from '@deepseek-ai/dsh-session/invariant'
import * as AgentInvariant from '@deepseek-ai/dsh-agent/invariant'
import * as AgentLoopInvariant from '@deepseek-ai/dsh-agent-loop/invariant'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import * as Spawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { createRoundtableHostDriver } from '../src/driver.ts'
import type { RoundtableMember } from '../src/types.ts'

/**
 * True live-model integration (spec §11): the REAL `createRoundtableHostDriver`
 * driving REAL members and the REAL host summarizer through the REAL agent loop
 * (`ctx.agentLoop` + spawn subagents) with a scripted mock model
 * (`ctx.llm.registerAdapter` + MockAdapter). Only the model is scripted — the
 * loop, sessions, roster order, subagent delegation, and durable records are
 * all live. This is the gap the near-integration suite (`integration.spec.ts`)
 * leaves open by faking `ctx.subagents`.
 */

const A: RoundtableMember = { id: 'a', label: '架构师' }
const B: RoundtableMember = { id: 'b', label: '安全专家' }

type Script = ConstructorParameters<typeof MockAdapter>[0]

async function mountInvariants(ctx: Context): Promise<void> {
  await ctx.plugin(InvariantRegistry)
  await ctx.plugin(SessionInvariant)
  await ctx.plugin(AgentInvariant)
  await ctx.plugin(AgentLoopInvariant)
}

/** Boot a live agent loop whose model is a scripted MockAdapter. */
async function harness(script: Script) {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await mountInvariants(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(Spawn, { providerName: 'spawn' })
  ctx.llm.registerAdapter(['mock'], new MockAdapter(script))
  const host = ctx.agentLoop.create(SessionId(`rt-live-${Math.random()}`), { provider: 'mock', model: 'mock' })
  return { ctx, host }
}

function text(blocks: { type: string; text?: string }[]): string {
  return blocks.filter(block => block.type === 'text').map(block => block.text).join('')
}

describe('roundtable live-host e2e (real agent loop + scripted mock model)', () => {
  it('one full round completes through the live host driver with fixed roster order', async () => {
    // Round 1 consumes exactly three model streams: member A, member B, then
    // the host summarizer — one per live subagent turn.
    const { ctx, host } = await harness([
      textResponse('架构师 发言'),
      textResponse('安全专家 发言'),
      textResponse('【第1轮纪要】'),
    ])
    const driver = createRoundtableHostDriver(ctx, { provider: 'spawn', host, writeMarkdown: async () => {} })

    const handle = driver.startDiscussion({ topic: '评审方案', members: [A, B] })
    const first = await handle.started

    expect(first?.roundNumber).toBe(1)
    // Fixed roster order through the live loop, both member turns and the
    // host summarizer's turn.
    expect(first?.utterances.map(u => u.memberId)).toEqual(['a', 'b'])
    expect(first?.utterances.map(u => text(u.output))).toEqual(['架构师 发言', '安全专家 发言'])
    expect(text(first?.summary ?? [])).toContain('第1轮纪要')
    expect(handle.phase).toBe('awaitingGate')

    // The real host session carries the durable records end-to-end.
    const roundtableTypes = host.session.events
      .filter(event => event.type.startsWith('roundtable/'))
      .map(event => event.type)
    expect(roundtableTypes).toEqual(['roundtable/start', 'roundtable/round-end'])
  })

  it('a second round runs on demand through the live loop, fed by the prior summary', async () => {
    const { ctx, host } = await harness([
      textResponse('架构师 发言'),
      textResponse('安全专家 发言'),
      textResponse('【第1轮纪要】'),
      textResponse('架构师 补充'),
      textResponse('安全专家 补充'),
      textResponse('【第2轮纪要】'),
    ])
    const driver = createRoundtableHostDriver(ctx, { provider: 'spawn', host, writeMarkdown: async () => {} })

    const handle = driver.startDiscussion({ topic: '评审方案', members: [A, B] })
    await handle.started
    const second = await driver.continueRound(handle.id)
    expect(second?.roundNumber).toBe(2)
    expect(second?.utterances.map(u => u.memberId)).toEqual(['a', 'b'])
    expect(text(second?.summary ?? [])).toContain('第2轮纪要')
    expect(driver.get(handle.id)?.discussion.rounds).toHaveLength(2)
  })
})
