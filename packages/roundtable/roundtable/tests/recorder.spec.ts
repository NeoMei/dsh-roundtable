import { describe, expect, it } from 'vitest'
import { createRoundtableRecorder } from '../src/recorder.ts'
import { RoundtableId } from '../src/types.ts'

const info = { id: RoundtableId('rt-1'), roster: [], topic: 'topic' }
const minutes = { roundNumber: 1, topic: 'topic', utterances: [], humanSteers: [], summary: [{ type: 'text', text: 'summary' }] }

function fakeCtx() {
  const handlers = new Map<string, (...args: unknown[]) => void>()
  const warnings: string[] = []
  return {
    handlers,
    warnings,
    ctx: {
      on: (name: string, listener: (...args: unknown[]) => void) => {
        handlers.set(name, listener)
        return () => { handlers.delete(name) }
      },
      logger: { warn: (message: unknown) => { warnings.push(String(message)) } },
    },
  }
}

function fakeSession() {
  const appended: Array<[string, unknown]> = []
  return {
    appended,
    session: { append: (type: string, data: unknown) => { appended.push([type, data]) } },
  }
}

describe('createRoundtableRecorder', () => {
  it('projects the start, round-end minutes, and the finish terminal into the active session', () => {
    const { handlers, ctx } = fakeCtx()
    const { appended, session } = fakeSession()
    const recorder = createRoundtableRecorder(ctx as never)
    recorder.start(session as never, info)
    expect(appended).toEqual([['roundtable/start', info]])

    handlers.get('roundtable/round-end')!(info, minutes)
    expect(appended).toEqual([
      ['roundtable/start', info],
      ['roundtable/round-end', { discussionId: info.id, minutes }],
    ])

    recorder.finish(info.id, 'completed')
    expect(appended).toEqual([
      ['roundtable/start', info],
      ['roundtable/round-end', { discussionId: info.id, minutes }],
      ['roundtable/end', { discussionId: info.id, stopReason: 'completed' }],
    ])
  })

  it('ignores round-end for an unknown or abandoned discussion', () => {
    const { handlers, ctx } = fakeCtx()
    const { appended, session } = fakeSession()
    const recorder = createRoundtableRecorder(ctx as never)

    handlers.get('roundtable/round-end')!(info, minutes)
    expect(appended).toEqual([])

    recorder.start(session as never, info)
    expect(appended).toEqual([['roundtable/start', info]])
    recorder.abandon(info.id)
    handlers.get('roundtable/round-end')!(info, minutes)
    expect(appended).toEqual([['roundtable/start', info]])
  })

  it('resume re-registers a recovered discussion without appending a duplicate start, and continuation records persist', () => {
    const { handlers, ctx } = fakeCtx()
    const { appended, session } = fakeSession()
    const recorder = createRoundtableRecorder(ctx as never)

    // 恢复路径：start 记录已存在于日志，resume 只重建 active 关联。
    recorder.resume(session as never, info)
    expect(appended).toEqual([])

    handlers.get('roundtable/round-end')!(info, minutes)
    expect(appended).toEqual([
      ['roundtable/round-end', { discussionId: info.id, minutes }],
    ])

    recorder.finish(info.id, 'cancelled')
    expect(appended).toEqual([
      ['roundtable/round-end', { discussionId: info.id, minutes }],
      ['roundtable/end', { discussionId: info.id, stopReason: 'cancelled' }],
    ])
  })

  it('contains an append failure, warns, and drops the discussion', () => {
    const { handlers, warnings, ctx } = fakeCtx()
    const session = { append: () => { throw new Error('boom') } }
    const recorder = createRoundtableRecorder(ctx as never)
    recorder.start(session as never, info)

    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('roundtable/start')

    // The failed start append dropped the discussion: a later event is a no-op.
    handlers.get('roundtable/round-end')!(info, minutes)
    expect(warnings).toHaveLength(1)
  })

  it('dispose detaches the shared round-end listener and drops active discussions', () => {
    const { handlers, ctx } = fakeCtx()
    const { appended, session } = fakeSession()
    const recorder = createRoundtableRecorder(ctx as never)
    // The shared listener is registered on the context.
    expect(handlers.has('roundtable/round-end')).toBe(true)

    recorder.start(session as never, info)
    recorder.dispose()
    // The listener is detached (no per-agent listener leak on the root ctx).
    expect(handlers.has('roundtable/round-end')).toBe(false)

    // The active map is gone too: a late terminal settlement appends nothing.
    recorder.finish(info.id, 'completed')
    expect(appended.some(entry => entry[0] === 'roundtable/end')).toBe(false)
  })
})
