/**
 * Roundtable seam vocabulary: discussion state, round minutes, member roster,
 * and the `roundtable/*` event payloads. Types only, per the package convention.
 * @module @neomei/dsh-roundtable/types
 */
import type { Branded } from '@deepseek-ai/dsh-brand';
import type { AgentOptions } from '@deepseek-ai/dsh-agent';
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import type { ToolRestriction } from '@deepseek-ai/dsh-tools';
/** Identifies one roundtable discussion. */
export type RoundtableId = Branded<'RoundtableId'>;
export declare function RoundtableId(id: string): RoundtableId;
/** Why a discussion settled. */
export type RoundtableStopReason = 'completed' | 'cancelled' | 'error';
/** 圆桌成员（讨论全程固定）。 */
export interface RoundtableMember {
    /** 唯一标识，用于发言归属。 */
    id: string;
    /** 显示名，如「架构师」。 */
    label: string;
    /** 角色遮蔽，透传 SubagentStartRequest.persona。 */
    persona?: string;
    /** 成员独立模型路由（一等字段，见 spec §9）。 */
    agentOptions?: AgentOptions;
    /** 工具裁剪，透传。 */
    toolFilter?: ToolRestriction;
    /** 委派深度上限，透传。 */
    maxDepth?: number;
}
/** 单个成员的一轮发言。 */
export interface MemberUtterance {
    memberId: string;
    label: string;
    output: ContentBlock[];
    stopReason: string;
}
/** 一轮纪要：最小可交付单元，也是 markdown 导出的基本单位。 */
export interface RoundMinutes {
    roundNumber: number;
    /** 本轮起始话题。 */
    topic: string;
    /** 本轮各成员发言，按顺序。 */
    utterances: MemberUtterance[];
    /** 本轮中人类插入的意见。 */
    humanSteers: string[];
    /** 主持人本轮纪要+结论。 */
    summary: ContentBlock[];
}
/** 讨论级状态（minutes store 持久化）。 */
export interface RoundtableDiscussion {
    id: RoundtableId;
    roster: RoundtableMember[];
    rounds: RoundMinutes[];
    status: RoundtableStopReason | 'active';
}
/** 讨论级身份快照，由每个 roundtable/* 事件携带（借用不可变数据）。 */
export interface RoundtableInfo {
    id: RoundtableId;
    roster: RoundtableMember[];
    /**
     * 讨论主题。随 durable `roundtable/start` 落盘，使中断在第 1 轮中途
     * （仅 `roundtable/start`、无任何已落盘轮次）的讨论也能跨进程恢复。
     */
    topic: string;
    /** 停止时纪要写盘路径；落盘以便恢复的讨论沿用原导出位置。 */
    outputFile?: string;
}
/** 一场讨论的终止落盘记录（durable `roundtable/end` 事件载荷）。 */
export interface RoundtableEndData {
    discussionId: RoundtableId;
    stopReason: RoundtableStopReason;
}
/** durable `roundtable/round-end` 事件载荷：讨论身份 + 一轮纪要，供客户端按讨论聚合各轮。 */
export interface RoundtableRoundEndData {
    /** 所属讨论的稳定标识。 */
    discussionId: RoundtableId;
    /** 本轮纪要。 */
    minutes: RoundMinutes;
}
declare module '@deepseek-ai/dsh-session/types' {
    interface SessionEventMap {
        /** 开启一场圆桌讨论的落盘记录：稳定讨论身份与固定成员名单。 */
        'roundtable/start': RoundtableInfo;
        /** 一轮纪要：轮次结束后追加到宿主 Session 的持久化记录。 */
        'roundtable/round-end': RoundtableRoundEndData;
        /** 讨论终止：run 落定后追加到宿主 Session 的持久化记录。 */
        'roundtable/end': RoundtableEndData;
    }
}
//# sourceMappingURL=types.d.ts.map