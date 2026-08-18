import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SubagentRuntime } from '@deepseek-ai/dsh-subagent'
import type { MemberUtterance, RoundtableMember } from './types.ts'

export interface MemberRunnerDeps {
  subagents: SubagentRuntime
  provider: string
  parent: Agent
}

export function createMemberRunner(deps: MemberRunnerDeps) {
  return async (member: RoundtableMember, prompt: string, signal: AbortSignal): Promise<MemberUtterance> => {
    const run = await deps.subagents.start(deps.provider, {
      label: member.label,
      prompt: [{ type: 'text', text: prompt }],
      parent: deps.parent,
      ...member.persona !== undefined ? { persona: member.persona } : {},
      ...member.agentOptions !== undefined ? { agentOptions: member.agentOptions } : {},
      ...member.toolFilter !== undefined ? { toolFilter: member.toolFilter } : {},
      ...member.maxDepth !== undefined ? { maxDepth: member.maxDepth } : {},
      signal,
    })
    try {
      const result = await run.result
      // SubagentRun.result does NOT reject on a child-level failure — a model /
      // transport failure resolves with a non-'completed' stopReason. Surface it
      // so the round settles error/cancelled instead of folding an empty/partial
      // reply in as if the member had spoken.
      if (result.stopReason !== 'completed') {
        throw new Error(`roundtable member "${member.label}" stopped: ${result.stopReason}`)
      }
      return { memberId: member.id, label: member.label, output: result.output, stopReason: result.stopReason }
    } finally {
      await run.dispose()
    }
  }
}
