/** 把多轮纪要确定性序列化成 markdown，不依赖模型即兴生成。 */
import type { RoundtableDiscussion } from './types.ts';
/** 序列化选项；全部可选以保证测试/导入稳定。 */
export interface SerializeMarkdownOptions {
    /** 标题，缺省取首轮话题，否则「圆桌讨论」。 */
    title?: string;
    /** 是否产出「综合方案」分节，默认 true。 */
    synthesize?: boolean;
    /** 生成时间：字符串原样输出，数字按 epoch 毫秒，Date 用 ISO。缺省不输出时间戳。 */
    now?: string | number | Date;
}
export declare function serializeRoundtableMarkdown(discussion: RoundtableDiscussion, opts?: SerializeMarkdownOptions): string;
//# sourceMappingURL=markdown.d.ts.map