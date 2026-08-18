import type { Agent } from '@deepseek-ai/dsh-agent';
import type { SubagentRuntime } from '@deepseek-ai/dsh-subagent';
import type { MemberUtterance, RoundtableMember } from './types.ts';
export interface MemberRunnerDeps {
    subagents: SubagentRuntime;
    provider: string;
    parent: Agent;
}
export declare function createMemberRunner(deps: MemberRunnerDeps): (member: RoundtableMember, prompt: string, signal: AbortSignal) => Promise<MemberUtterance>;
//# sourceMappingURL=member-runner.d.ts.map