export { RoundtableId } from './types.ts'
export type {
  MemberUtterance, RoundMinutes, RoundtableDiscussion, RoundtableEndData,
  RoundtableInfo, RoundtableMember, RoundtableRoundEndData, RoundtableStopReason,
} from './types.ts'
export type { RoundtableRun, RoundtableStartRequest } from './runtime-types.ts'
export { serializeRoundtableMarkdown } from './markdown.ts'
export { createRoundtableRecorder } from './recorder.ts'
export type { RoundtableRecorder, RoundtableRecorderHandle } from './recorder.ts'
export { recoverRoundtableDiscussions } from './recovery.ts'
export type { RecoveredRoundtableDiscussion } from './recovery.ts'
export { RoundtableError, RoundtableEngine } from './service.ts'
export type { RoundtableErrorCode } from './service.ts'
export {
  createRoundtableDriver, createHostSummarizer, createRoundtableHostDriver,
  parseGateReply,
} from './driver.ts'
export type {
  HostSummarizerDeps, RoundtableDiscussionHandle, RoundtableDriver,
  RoundtableDriverDeps, RoundtableDriverInput, RoundtableDriverPhase,
  RoundtableGate, RoundtableGateReply, RoundtableHostDriver,
  RoundtableHostDriverDeps, StartDiscussionRequest,
} from './driver.ts'

// The seam (`RoundtableEngine`) and its concrete provider share this package;
// the provider is the package's loadable plugin entry (mirrors how
// `@deepseek-ai/dsh-workflow-worker-thread` default-exports its concrete engine).
export { RoundtableEngineProvider, createRoundtableEngine } from './engine.ts'
export type { Config as RoundtableEngineConfig } from './engine.ts'

export { RoundtableEngineProvider as default } from './engine.ts'
