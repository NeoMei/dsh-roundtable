function textOf(blocks) {
    return blocks.map(b => b.type === 'text' ? b.text ?? '' : `[${b.type}]`).join('');
}
function timestampOf(now) {
    if (typeof now === 'string')
        return now;
    if (typeof now === 'number')
        return new Date(now).toISOString();
    return now.toISOString();
}
function memberLine(m) {
    const model = m.agentOptions?.model;
    const provider = m.agentOptions?.provider;
    if (provider !== undefined && model !== undefined)
        return `- **${m.label}** (${provider} · ${model})`;
    if (provider !== undefined)
        return `- **${m.label}** (${provider})`;
    if (model !== undefined)
        return `- **${m.label}** (${model})`;
    return `- **${m.label}**`;
}
export function serializeRoundtableMarkdown(discussion, opts = {}) {
    const title = opts.title ?? (discussion.rounds[0]?.topic ?? '圆桌讨论');
    const roster = discussion.roster.map(memberLine).join('\n');
    const synthesize = opts.synthesize !== false;
    // 每轮只渲染高层纪要（话题 + 纪要），不逐字罗列成员发言；人类意见由纪要
    // 折入。「综合方案」仅在多轮讨论且 synthesize 开启时产出：单轮讨论的本轮
    // 纪要即是结论，不再重复渲染；多轮时把各轮纪要按轮次编号聚合到「综合方案」
    // 分节作为确定性兜底——详细的综合方案由模型/宿主在该分节改写。
    const multiRound = discussion.rounds.length > 1;
    const renderSynthesis = synthesize && multiRound;
    const rounds = discussion.rounds.map(r => `## 第 ${r.roundNumber} 轮\n\n**议题：** ${r.topic}\n\n**纪要：** ${textOf(r.summary)}`).join('\n\n');
    const synthesis = renderSynthesis
        ? `\n\n## 综合方案\n\n${discussion.rounds.map(r => `### 第 ${r.roundNumber} 轮纪要\n\n${textOf(r.summary)}`).join('\n\n')}`
        : '';
    const timestamp = opts.now === undefined ? '' : `\n\n_生成时间：${timestampOf(opts.now)}_`;
    const attendees = `${roster}\n- **会议主持人**（主持人）`;
    return `# ${title} 会议纪要${timestamp}\n\n## 参会人员\n\n${attendees}\n\n${rounds}${synthesis}\n`;
}
//# sourceMappingURL=markdown.js.map