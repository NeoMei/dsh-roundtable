function textOf(blocks) {
    return blocks.map(b => b.type === 'text' ? b.text ?? '' : '').join('');
}
/** 按轮渲染前几轮纪要：每轮一个 `### 第 k 轮纪要` 分节，空行分隔（review #5）。 */
function renderPriorSummaries(prior) {
    return prior
        .map(round => `### 第 ${round.roundNumber} 轮纪要\n\n${textOf(round.summary)}`)
        .join('\n\n');
}
export async function runRound(deps, input) {
    const { members, topic, priorSummaries, signal, roundNumber } = input;
    const priorSteers = input.priorSteers ?? [];
    const utterances = [];
    const humanSteers = [];
    for (const member of members) {
        const promptParts = [`你正在参加一场圆桌讨论。\n\n**本轮话题：** ${topic}`];
        if (priorSummaries.length > 0)
            promptParts.push(`**前几轮纪要：**\n${renderPriorSummaries(priorSummaries)}`);
        if (priorSteers.length > 0)
            promptParts.push(`**前几轮人类意见：**\n${priorSteers.join('\n')}`);
        if (utterances.length > 0) {
            const history = utterances.map(u => `【${u.label}】${textOf(u.output)}`).join('\n\n');
            promptParts.push(`**本轮已有发言：**\n${history}`);
        }
        if (humanSteers.length > 0)
            promptParts.push(`**人类插入的意见：**\n${humanSteers.join('\n')}`);
        promptParts.push(`\n请在圆桌中扮演「${member.label}」，就本轮话题发表你的观点（可回应前面成员的发言）。`);
        const utterance = await deps.runMember(member, promptParts.join('\n\n'), signal);
        utterances.push(utterance);
        for (const steer of deps.claimSteer())
            humanSteers.push(steer);
    }
    const summary = await deps.summarize(members, utterances, topic, humanSteers, {
        rounds: priorSummaries,
        steers: priorSteers,
    });
    return { roundNumber, topic, utterances, humanSteers, summary };
}
//# sourceMappingURL=executor.js.map