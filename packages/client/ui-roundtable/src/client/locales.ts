/** `roundtable` namespace dictionaries. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'roundtable'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'title': '圆桌讨论',
  'footer.action': '新讨论组',
  'roster.empty': '无成员',
  'round.title': '第 {number} 轮',
  'round.topic': '话题',
  'round.steers': '人类意见',
  'round.summary': '本轮纪要',
  'round.empty': '本轮没有成员发言',
  'live.title': '发言中…',
  'export': '导出 Markdown',
  'continue': '继续下一轮',
  'stop': '停止讨论',
  'status.active': '进行中',
  'status.completed': '已完成',
  'status.cancelled': '已取消',
  'status.error': '出错',
}

/** English dictionary (same key set). */
export const en: Record<RoundtableKey, string> = {
  'title': 'Roundtable',
  'footer.action': 'New discussion',
  'roster.empty': 'No members',
  'round.title': 'Round {number}',
  'round.topic': 'Topic',
  'round.steers': 'Human input',
  'round.summary': 'Summary',
  'round.empty': 'No members spoke this round',
  'live.title': 'Speaking…',
  'export': 'Export Markdown',
  'continue': 'Continue next round',
  'stop': 'Stop discussion',
  'status.active': 'Active',
  'status.completed': 'Completed',
  'status.cancelled': 'Cancelled',
  'status.error': 'Error',
}

/** Union of this namespace's dictionary keys. */
export type RoundtableKey = keyof typeof zh
