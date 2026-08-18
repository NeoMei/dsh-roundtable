import { describe, expect, it } from 'vitest'
import { serializeRoundtableMarkdown } from '../src/markdown.ts'
import { RoundtableId } from '../src/types.ts'

const member = (id: string, label: string) => ({ id, label })
const text = (s: string) => [{ type: 'text' as const, text: s }]

/** 与 client 侧 `roundtable.client.spec.tsx` 共享的 golden 串，用于跨端 parity。 */
const GOLDEN = `# 评审 会议纪要

_生成时间：2026-08-17T00:00:00.000Z_

## 参会人员

- **架构师** (anthropic · claude-3)
- **安全专家** (openai)
- **会议主持人**（主持人）

## 第 1 轮

**议题：** 审计

**纪要：** 第一轮结论
`

describe('serializeRoundtableMarkdown', () => {
  it('渲染标题、轮次分节与成员分节；每轮仅渲染「话题 + 纪要」高层纪要', () => {
    const md = serializeRoundtableMarkdown({
      id: RoundtableId('d1'),
      roster: [member('arch', '架构师'), member('sec', '安全专家')],
      status: 'completed',
      rounds: [{
        roundNumber: 1,
        topic: '评审方案 A',
        utterances: [
          { memberId: 'arch', label: '架构师', output: text('分层清晰'), stopReason: 'completed' },
          { memberId: 'sec', label: '安全专家', output: text('需加固认证'), stopReason: 'completed' },
        ],
        humanSteers: [],
        summary: text('共识：结构可行，安全待补'),
      }],
    })
    expect(md).toContain('# 评审方案 A 会议纪要')
    expect(md).toContain('## 参会人员')
    expect(md).toContain('会议主持人')
    expect(md).toContain('## 第 1 轮')
    expect(md).toContain('**议题：** 评审方案 A')
    expect(md).toContain('**纪要：** 共识：结构可行，安全待补')
    // 不再逐字罗列成员发言。
    expect(md).not.toContain('### 架构师')
    expect(md).not.toContain('### 安全专家')
    expect(md).not.toContain('分层清晰')
    expect(md).not.toContain('需加固认证')
  })

  it('每轮不渲染成员发言与「人类意见」分节（人类意见由纪要折入）', () => {
    const md = serializeRoundtableMarkdown({
      id: RoundtableId('d1'),
      roster: [member('a', 'A')],
      status: 'completed',
      rounds: [{
        roundNumber: 1,
        topic: 't',
        utterances: [{ memberId: 'a', label: 'A', output: text('发言'), stopReason: 'completed' }],
        humanSteers: ['补充一点', '再看安全'],
        summary: text('s'),
      }],
    })
    expect(md).not.toContain('### A')
    expect(md).not.toContain('发言')
    expect(md).not.toContain('## 人类意见')
    expect(md).not.toContain('- 补充一点')
    expect(md).not.toContain('- 再看安全')
    expect(md).toContain('**纪要：** s')
  })

  it('成员行在存在 provider 时渲染 provider，并与 model 组合', () => {
    const md = serializeRoundtableMarkdown({
      id: RoundtableId('d1'),
      roster: [
        { id: 'a', label: 'A', agentOptions: { provider: 'anthropic', model: 'claude-3' } },
        { id: 'b', label: 'B', agentOptions: { provider: 'openai' } },
      ],
      status: 'completed',
      rounds: [{ roundNumber: 1, topic: 't', utterances: [], humanSteers: [], summary: text('s') }],
    })
    expect(md).toContain('- **A** (anthropic · claude-3)')
    expect(md).toContain('- **B** (openai)')
  })

  it('synthesize: false 省略「综合方案」分节', () => {
    const md = serializeRoundtableMarkdown({
      id: RoundtableId('d1'),
      roster: [member('a', 'A')],
      status: 'completed',
      rounds: [{ roundNumber: 1, topic: 't', utterances: [], humanSteers: [], summary: text('s') }],
    }, { synthesize: false })
    expect(md).not.toContain('## 综合方案')
  })

  it('单轮讨论不渲染「综合方案」：本轮纪要即是结论', () => {
    const md = serializeRoundtableMarkdown({
      id: RoundtableId('d1'),
      roster: [member('a', 'A')],
      status: 'completed',
      rounds: [{ roundNumber: 1, topic: 't', utterances: [], humanSteers: [], summary: text('单轮结论') }],
    }, { synthesize: true })
    expect(md).toContain('**纪要：** 单轮结论')
    expect(md).not.toContain('## 综合方案')
  })

  it('多轮讨论渲染「综合方案」：按轮次编号聚合各轮纪要，每轮分节仍保留「纪要」', () => {
    const md = serializeRoundtableMarkdown({
      id: RoundtableId('d1'),
      roster: [member('a', 'A')],
      status: 'completed',
      rounds: [
        { roundNumber: 1, topic: 't1', utterances: [], humanSteers: [], summary: text('第一轮结论') },
        { roundNumber: 2, topic: 't2', utterances: [], humanSteers: [], summary: text('第二轮结论') },
      ],
    }, { synthesize: true })
    expect(md).toContain('## 综合方案')
    const synthesis = md.slice(md.indexOf('## 综合方案'))
    // 各轮纪要按「第 N 轮纪要」小节聚合进综合方案（确定性兜底）。
    expect(synthesis).toContain('### 第 1 轮纪要')
    expect(synthesis).toContain('第一轮结论')
    expect(synthesis).toContain('### 第 2 轮纪要')
    expect(synthesis).toContain('第二轮结论')
    // 每轮分节仍渲染高层「纪要」。
    expect(md).toContain('**纪要：** 第一轮结论')
    expect(md).toContain('**纪要：** 第二轮结论')
    // 旧式结论与逐字纪要分节不再出现。
    expect(md).not.toContain('## 综合结论')
    expect(md).not.toContain('## 本轮纪要')
  })

  it('多轮 + synthesize: false 不渲染「综合方案」，各轮仍保留「纪要」', () => {
    const md = serializeRoundtableMarkdown({
      id: RoundtableId('d1'),
      roster: [member('a', 'A')],
      status: 'completed',
      rounds: [
        { roundNumber: 1, topic: 't1', utterances: [], humanSteers: [], summary: text('第一轮结论') },
        { roundNumber: 2, topic: 't2', utterances: [], humanSteers: [], summary: text('第二轮结论') },
      ],
    }, { synthesize: false })
    expect(md).not.toContain('## 综合方案')
    expect(md).toContain('**纪要：** 第一轮结论')
    expect(md).toContain('**纪要：** 第二轮结论')
  })

  it('传入 now 时渲染确定性时间戳', () => {
    const md = serializeRoundtableMarkdown({
      id: RoundtableId('d1'),
      roster: [member('a', 'A')],
      status: 'completed',
      rounds: [{ roundNumber: 1, topic: 't', utterances: [], humanSteers: [], summary: text('s') }],
    }, { now: '2026-08-17T00:00:00.000Z' })
    expect(md).toContain('_生成时间：2026-08-17T00:00:00.000Z_')
  })

  it('全量 fixture 产出字节级确定输出（跨端 parity golden）', () => {
    const md = serializeRoundtableMarkdown({
      id: RoundtableId('d1'),
      roster: [
        { id: 'arch', label: '架构师', agentOptions: { provider: 'anthropic', model: 'claude-3' } },
        { id: 'sec', label: '安全专家', agentOptions: { provider: 'openai' } },
      ],
      status: 'completed',
      rounds: [{
        roundNumber: 1,
        topic: '审计',
        utterances: [
          { memberId: 'arch', label: '架构师', output: text('先看边界'), stopReason: 'completed' },
          { memberId: 'sec', label: '安全专家', output: [], stopReason: 'error' },
        ],
        humanSteers: ['补充一点'],
        summary: text('第一轮结论'),
      }],
    }, { title: '评审', now: '2026-08-17T00:00:00.000Z', synthesize: true })
    expect(md).toBe(GOLDEN)
  })
})
