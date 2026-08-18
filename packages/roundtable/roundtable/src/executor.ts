import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { MemberUtterance, RoundMinutes, RoundtableMember } from './types.ts'

/** 前一轮的纪要，携带轮次号，供按轮渲染「### 第 k 轮纪要」分隔。 */
export interface PriorRoundSummary {
  roundNumber: number
  summary: ContentBlock[]
}

export interface RunRoundDeps {
  runMember(member: RoundtableMember, prompt: string, signal: AbortSignal): Promise<MemberUtterance>
  /**
   * Summarize this round's utterances; `humanSteers` are the steers claimed
   * during THIS round, and `prior` carries the earlier rounds' summaries and
   * human steers so the summary can reflect the whole discussion arc (the
   * host summarizer feeds it into the prompt from round 2 on).
   */
  summarize(
    members: RoundtableMember[],
    utterances: MemberUtterance[],
    topic: string,
    humanSteers: string[],
    prior?: { rounds: readonly PriorRoundSummary[]; steers: string[] },
  ): Promise<ContentBlock[]>
  claimSteer(): string[]
}

export interface RunRoundInput {
  roundNumber: number
  topic: string
  members: RoundtableMember[]
  priorSummaries: readonly PriorRoundSummary[]
  /** 前几轮「轮中插入」的人类意见（claimSteer 进入 humanSteers），注入本轮成员
   * prompt 以便延续；「继续」附带的新意见随 roundTopic 折叠进当轮话题，不在此通道。 */
  priorSteers?: string[]
  signal: AbortSignal
}

function textOf(blocks: ContentBlock[]): string {
  return blocks.map(b => b.type === 'text' ? b.text ?? '' : '').join('')
}

/** 按轮渲染前几轮纪要：每轮一个 `### 第 k 轮纪要` 分节，空行分隔（review #5）。 */
function renderPriorSummaries(prior: readonly PriorRoundSummary[]): string {
  return prior
    .map(round => `### 第 ${round.roundNumber} 轮纪要\n\n${textOf(round.summary)}`)
    .join('\n\n')
}

export async function runRound(deps: RunRoundDeps, input: RunRoundInput): Promise<RoundMinutes> {
  const { members, topic, priorSummaries, signal, roundNumber } = input
  const priorSteers = input.priorSteers ?? []
  const utterances: MemberUtterance[] = []
  const humanSteers: string[] = []
  for (const member of members) {
    const promptParts: string[] = [`你正在参加一场圆桌讨论。\n\n**本轮话题：** ${topic}`]
    if (priorSummaries.length > 0) promptParts.push(`**前几轮纪要：**\n${renderPriorSummaries(priorSummaries)}`)
    if (priorSteers.length > 0) promptParts.push(`**前几轮人类意见：**\n${priorSteers.join('\n')}`)
    if (utterances.length > 0) {
      const history = utterances.map(u => `【${u.label}】${textOf(u.output)}`).join('\n\n')
      promptParts.push(`**本轮已有发言：**\n${history}`)
    }
    if (humanSteers.length > 0) promptParts.push(`**人类插入的意见：**\n${humanSteers.join('\n')}`)
    promptParts.push(`\n请在圆桌中扮演「${member.label}」，就本轮话题发表你的观点（可回应前面成员的发言）。`)
    const utterance = await deps.runMember(member, promptParts.join('\n\n'), signal)
    utterances.push(utterance)
    for (const steer of deps.claimSteer()) humanSteers.push(steer)
  }
  const summary = await deps.summarize(members, utterances, topic, humanSteers, {
    rounds: priorSummaries,
    steers: priorSteers,
  })
  return { roundNumber, topic, utterances, humanSteers, summary }
}
