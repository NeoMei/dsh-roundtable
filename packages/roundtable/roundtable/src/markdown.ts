/** 把多轮纪要确定性序列化成 markdown，不依赖模型即兴生成。 */
import type { RoundtableDiscussion, RoundtableMember } from './types.ts'

/** 序列化选项；全部可选以保证测试/导入稳定。 */
export interface SerializeMarkdownOptions {
  /** 标题，缺省取首轮话题，否则「圆桌讨论」。 */
  title?: string
  /** 是否产出「综合方案」分节，默认 true。 */
  synthesize?: boolean
  /** 生成时间：字符串原样输出，数字按 epoch 毫秒，Date 用 ISO。缺省不输出时间戳。 */
  now?: string | number | Date
}

function textOf(blocks: { type: string; text?: string }[]): string {
  return blocks.map(b => b.type === 'text' ? b.text ?? '' : `[${b.type}]`).join('')
}

function timestampOf(now: string | number | Date): string {
  if (typeof now === 'string') return now
  if (typeof now === 'number') return new Date(now).toISOString()
  return now.toISOString()
}

function memberLine(m: RoundtableMember): string {
  const model = m.agentOptions?.model
  const provider = m.agentOptions?.provider
  if (provider !== undefined && model !== undefined) return `- **${m.label}** (${provider} · ${model})`
  if (provider !== undefined) return `- **${m.label}** (${provider})`
  if (model !== undefined) return `- **${m.label}** (${model})`
  return `- **${m.label}**`
}

export function serializeRoundtableMarkdown(
  discussion: RoundtableDiscussion,
  opts: SerializeMarkdownOptions = {},
): string {
  const title = opts.title ?? (discussion.rounds[0]?.topic ?? '圆桌讨论')
  const roster = discussion.roster.map(memberLine).join('\n')
  const synthesize = opts.synthesize !== false
  // 每轮只渲染高层纪要（话题 + 纪要），不逐字罗列成员发言；人类意见由纪要
  // 折入。「综合方案」仅在多轮讨论且 synthesize 开启时产出：单轮讨论的本轮
  // 纪要即是结论，不再重复渲染；多轮时把各轮纪要按轮次编号聚合到「综合方案」
  // 分节作为确定性兜底——详细的综合方案由模型/宿主在该分节改写。
  const multiRound = discussion.rounds.length > 1
  const renderSynthesis = synthesize && multiRound
  const rounds = discussion.rounds.map(r =>
    `## 第 ${r.roundNumber} 轮\n\n**议题：** ${r.topic}\n\n**纪要：** ${textOf(r.summary)}`).join('\n\n')
  const synthesis = renderSynthesis
    ? `\n\n## 综合方案\n\n${discussion.rounds.map(r => `### 第 ${r.roundNumber} 轮纪要\n\n${textOf(r.summary)}`).join('\n\n')}`
    : ''
  const timestamp = opts.now === undefined ? '' : `\n\n_生成时间：${timestampOf(opts.now)}_`
  const attendees = `${roster}\n- **会议主持人**（主持人）`
  return `# ${title} 会议纪要${timestamp}\n\n## 参会人员\n\n${attendees}\n\n${rounds}${synthesis}\n`
}
