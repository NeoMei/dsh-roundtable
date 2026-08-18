import { describe, expect, it } from 'vitest'
import { runRound } from '../src/executor.ts'
import type { MemberUtterance, RoundtableMember } from '../src/types.ts'

const text = (s: string) => [{ type: 'text' as const, text: s }]

function deps(seen: string[]) {
  return {
    async runMember(member: { id: string, label: string }, prompt: string) {
      seen.push(prompt)
      return { memberId: member.id, label: member.label, output: text(`${member.label} 发言`), stopReason: 'completed' }
    },
    async summarize(
      _members: RoundtableMember[], _utterances: MemberUtterance[], _topic: string, _humanSteers: string[],
      _prior?: { rounds: readonly unknown[]; steers: string[] },
    ) { return text('纪要') },
    claimSteer: (): string[] => [],
  }
}

describe('runRound', () => {
  it('按固定顺序跑成员，后者可见前者发言', async () => {
    const prompts: string[] = []
    const minutes = await runRound(deps(prompts), {
      roundNumber: 1, topic: '话题', members: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
      priorSummaries: [], signal: new AbortController().signal,
    })
    expect(minutes.utterances.map(u => u.memberId)).toEqual(['a', 'b'])
    expect(prompts[0]).toContain('话题')
    expect(prompts[0]).not.toContain('A 发言')
    expect(prompts[1]).toContain('A 发言')
  })

  it('把 priorSummaries 注入每个成员 prompt，按轮渲染「### 第 k 轮纪要」分隔', async () => {
    const prompts: string[] = []
    await runRound(deps(prompts), {
      roundNumber: 2, topic: '话题', members: [{ id: 'a', label: 'A' }],
      priorSummaries: [
        { roundNumber: 1, summary: text('第一轮纪要') },
        { roundNumber: 2, summary: text('第二轮纪要') },
      ],
      signal: new AbortController().signal,
    })
    expect(prompts[0]).toContain('### 第 1 轮纪要\n\n第一轮纪要')
    expect(prompts[0]).toContain('### 第 2 轮纪要\n\n第二轮纪要')
    expect(prompts[0]).toMatch(/第一轮纪要\n\n### 第 2 轮纪要/)
  })

  it('成员间 claimSteer 的意见注入下一位成员', async () => {
    const prompts: string[] = []
    let calls = 0
    const d = deps(prompts)
    d.claimSteer = () => { calls += 1; return calls === 1 ? ['补充一点'] : [] }
    await runRound(d, {
      roundNumber: 1, topic: '话题', members: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
      priorSummaries: [], signal: new AbortController().signal,
    })
    expect(prompts[1]).toContain('补充一点')
  })

  it('前几轮人类意见（priorSteers）注入本轮成员 prompt', async () => {
    const prompts: string[] = []
    await runRound(deps(prompts), {
      roundNumber: 2, topic: '话题', members: [{ id: 'a', label: 'A' }],
      priorSummaries: [], priorSteers: ['上轮补充', '继续意见'],
      signal: new AbortController().signal,
    })
    expect(prompts[0]).toContain('上轮补充')
    expect(prompts[0]).toContain('继续意见')
  })

  it('本轮 humanSteers 传入 summarize，使纪要反映人类意见', async () => {
    const prompts: string[] = []
    let calls = 0
    let seenSteers: string[] | undefined
    const d = deps(prompts)
    d.claimSteer = () => { calls += 1; return calls === 1 ? ['补充一点'] : [] }
    d.summarize = async (_members, _utterances, _topic, humanSteers) => {
      seenSteers = humanSteers
      return text('纪要')
    }
    const minutes = await runRound(d, {
      roundNumber: 1, topic: '话题', members: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
      priorSummaries: [], signal: new AbortController().signal,
    })
    expect(seenSteers).toEqual(['补充一点'])
    expect(minutes.humanSteers).toEqual(['补充一点'])
  })

  it('把 priorSummaries 与 priorSteers 传入 summarize，使结论看到整场讨论脉络', async () => {
    const prompts: string[] = []
    let seenPrior: { rounds: readonly unknown[]; steers: string[] } | undefined
    const d = deps(prompts)
    d.summarize = async (_members, _utterances, _topic, _humanSteers, prior) => {
      seenPrior = prior
      return text('纪要')
    }
    await runRound(d, {
      roundNumber: 2, topic: '话题', members: [{ id: 'a', label: 'A' }],
      priorSummaries: [{ roundNumber: 1, summary: text('上轮纪要') }], priorSteers: ['上轮意见'],
      signal: new AbortController().signal,
    })
    expect(seenPrior?.rounds).toEqual([{ roundNumber: 1, summary: text('上轮纪要') }])
    expect(seenPrior?.steers).toEqual(['上轮意见'])
  })
})
