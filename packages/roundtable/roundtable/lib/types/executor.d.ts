import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import type { MemberUtterance, RoundMinutes, RoundtableMember } from './types.ts';
/** 前一轮的纪要，携带轮次号，供按轮渲染「### 第 k 轮纪要」分隔。 */
export interface PriorRoundSummary {
    roundNumber: number;
    summary: ContentBlock[];
}
export interface RunRoundDeps {
    runMember(member: RoundtableMember, prompt: string, signal: AbortSignal): Promise<MemberUtterance>;
    /**
     * Summarize this round's utterances; `humanSteers` are the steers claimed
     * during THIS round, and `prior` carries the earlier rounds' summaries and
     * human steers so the summary can reflect the whole discussion arc (the
     * host summarizer feeds it into the prompt from round 2 on).
     */
    summarize(members: RoundtableMember[], utterances: MemberUtterance[], topic: string, humanSteers: string[], prior?: {
        rounds: readonly PriorRoundSummary[];
        steers: string[];
    }): Promise<ContentBlock[]>;
    claimSteer(): string[];
}
export interface RunRoundInput {
    roundNumber: number;
    topic: string;
    members: RoundtableMember[];
    priorSummaries: readonly PriorRoundSummary[];
    /** 前几轮「轮中插入」的人类意见（claimSteer 进入 humanSteers），注入本轮成员
     * prompt 以便延续；「继续」附带的新意见随 roundTopic 折叠进当轮话题，不在此通道。 */
    priorSteers?: string[];
    signal: AbortSignal;
}
export declare function runRound(deps: RunRoundDeps, input: RunRoundInput): Promise<RoundMinutes>;
//# sourceMappingURL=executor.d.ts.map