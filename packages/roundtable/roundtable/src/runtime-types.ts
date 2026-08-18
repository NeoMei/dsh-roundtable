import type { Agent } from '@deepseek-ai/dsh-agent'
import type { RoundMinutes, RoundtableId, RoundtableMember, RoundtableStopReason } from './types.ts'

export interface RoundtableStartRequest {
  topic: string
  members: RoundtableMember[]
  parent: Agent
  synthesize?: boolean
  provider?: string
  outputFile?: string
  signal?: AbortSignal
}

export interface RoundtableRun {
  id: RoundtableId
  result: Promise<{ stopReason: RoundtableStopReason; agentsStarted: number; rounds: RoundMinutes[] }>
  cancel(reason?: string): void
  dispose(): Promise<void>
}
