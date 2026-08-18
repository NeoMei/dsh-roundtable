import { describe, expect, it } from 'vitest'
import type { SessionEvent, SessionEventMap, SessionEventType } from '@deepseek-ai/dsh-session'
import { createRoundtableHostDriver } from '../src/driver.ts'
import { recoverRoundtableDiscussions } from '../src/recovery.ts'
import { RoundtableId } from '../src/types.ts'
import type { RoundMinutes, RoundtableInfo } from '../src/types.ts'

const A = { id: 'a', label: '架构师' }
const B = { id: 'b', label: '安全专家' }
const info: RoundtableInfo = { id: RoundtableId('rt-1'), roster: [A, B], topic: '评审方案', outputFile: 'out/评审.md' }
const text = (s: string) => [{ type: 'text' as const, text: s }]

const minutes = (n: number, topic = '评审方案'): RoundMinutes => ({
  roundNumber: n,
  topic,
  utterances: [],
  humanSteers: [],
  summary: text(`【第${n}轮纪要】`),
})

/** Build one fake durable session event with an explicit seq. */
function event<K extends SessionEventType>(type: K, data: SessionEventMap[K], seq: number): SessionEvent {
  return { type, seq, time: 0, data } as SessionEvent
}

describe('recoverRoundtableDiscussions', () => {
  it('rebuilds the roster and accumulated rounds from start + round-end events', () => {
    const recovered = recoverRoundtableDiscussions([
      event('roundtable/start', info, 0),
      event('roundtable/round-end', { discussionId: info.id, minutes: minutes(1) }, 1),
      event('roundtable/round-end', { discussionId: info.id, minutes: minutes(2, '评审方案（继续）') }, 2),
    ])
    expect(recovered).toHaveLength(1)
    expect(recovered[0]!.info).toEqual(info)
    expect(recovered[0]!.rounds.map(r => r.roundNumber)).toEqual([1, 2])
    expect(recovered[0]!.rounds[0]!.topic).toBe('评审方案')
  })

  it('rebuilds a discussion interrupted mid-round-1 (start only, no rounds) with its topic/outputFile', () => {
    const recovered = recoverRoundtableDiscussions([
      event('roundtable/start', info, 0),
    ])
    expect(recovered).toHaveLength(1)
    expect(recovered[0]!.info).toEqual(info)
    expect(recovered[0]!.info.topic).toBe('评审方案')
    expect(recovered[0]!.info.outputFile).toBe('out/评审.md')
    expect(recovered[0]!.rounds).toEqual([])
  })

  it('excludes a discussion closed by a matching roundtable/end', () => {
    const recovered = recoverRoundtableDiscussions([
      event('roundtable/start', info, 0),
      event('roundtable/round-end', { discussionId: info.id, minutes: minutes(1) }, 1),
      event('roundtable/end', { discussionId: info.id, stopReason: 'completed' }, 2),
    ])
    expect(recovered).toEqual([])
  })

  it('ignores a round-end that arrives after its discussion already ended', () => {
    const recovered = recoverRoundtableDiscussions([
      event('roundtable/start', info, 0),
      event('roundtable/end', { discussionId: info.id, stopReason: 'cancelled' }, 1),
      event('roundtable/round-end', { discussionId: info.id, minutes: minutes(1) }, 2),
    ])
    expect(recovered).toEqual([])
  })

  it('does not re-open a settled id with a duplicate start after its end', () => {
    const recovered = recoverRoundtableDiscussions([
      event('roundtable/start', info, 0),
      event('roundtable/end', { discussionId: info.id, stopReason: 'completed' }, 1),
      // 已终结讨论的重复 start（或后续 start）不得重新打开。
      event('roundtable/start', info, 2),
      event('roundtable/round-end', { discussionId: info.id, minutes: minutes(1) }, 3),
    ])
    expect(recovered).toEqual([])
  })

  it('ignores a duplicate start while the discussion is already open (keeps accumulated rounds)', () => {
    const recovered = recoverRoundtableDiscussions([
      event('roundtable/start', info, 0),
      event('roundtable/round-end', { discussionId: info.id, minutes: minutes(1) }, 1),
      // 重复 start 不得重置已累积的轮次。
      event('roundtable/start', info, 2),
      event('roundtable/round-end', { discussionId: info.id, minutes: minutes(2) }, 3),
    ])
    expect(recovered).toHaveLength(1)
    expect(recovered[0]!.rounds.map(r => r.roundNumber)).toEqual([1, 2])
  })
})

function fakeDriverCtx() {
  const listeners = new Map<string, Array<(...args: unknown[]) => unknown>>()
  return {
    ctx: {
      subagents: {
        start: async () => ({
          result: Promise.resolve({ output: text('x'), stopReason: 'completed' }),
          dispose: async () => {},
        }),
      },
      events: {
        dispatch: (_mode: string, args: unknown[]) => {
          const [name] = args as [string, ...unknown[]]
          return (listeners.get(name) ?? []).slice()
        },
      },
      logger: { warn: () => {} },
      on: (name: string, cb: (...args: unknown[]) => unknown) => {
        const list = listeners.get(name) ?? []
        list.push(cb)
        listeners.set(name, list)
        return () => true
      },
      fs: {
        resolve: async (path: string) => path,
        writeText: async () => {},
      },
    },
  }
}

function fakeHost() {
  return {
    id: 'host-1',
    session: { events: [] },
    inbox: { claimWhere: () => [] as unknown[] },
  }
}

describe('createRoundtableHostDriver.recover', () => {
  it('rebuilds an unsettled discussion into the registry, awaiting the gate', () => {
    const { ctx } = fakeDriverCtx()
    const host = fakeHost()
    const driver = createRoundtableHostDriver(ctx as never, { provider: 'fork', host: host as never })
    const session = {
      events: [
        event('roundtable/start', info, 0),
        event('roundtable/round-end', { discussionId: info.id, minutes: minutes(1) }, 1),
      ],
    }

    const handles = driver.recover(session as never)
    expect(handles).toHaveLength(1)
    expect(handles[0]!.id).toBe(info.id)
    expect(handles[0]!.discussion.roster).toEqual(info.roster)
    expect(handles[0]!.discussion.rounds.map(r => r.roundNumber)).toEqual([1])
    expect(handles[0]!.phase).toBe('awaitingGate')
    expect(driver.get(info.id)?.discussion.id).toBe(info.id)
  })

  it('rebuilds a mid-round-1 discussion (start only) awaiting the gate, and continueRound re-runs round 1 from the durable topic', async () => {
    const { ctx } = fakeDriverCtx()
    const host = fakeHost()
    const driver = createRoundtableHostDriver(ctx as never, { provider: 'fork', host: host as never })
    const session = {
      events: [
        event('roundtable/start', info, 0),
      ],
    }

    const handles = driver.recover(session as never)
    expect(handles).toHaveLength(1)
    expect(handles[0]!.id).toBe(info.id)
    expect(handles[0]!.discussion.roster).toEqual(info.roster)
    expect(handles[0]!.discussion.rounds).toEqual([])
    expect(handles[0]!.phase).toBe('awaitingGate')

    // The recovered topic drives the re-run of round 1; the output file is
    // wired from the durable payload, not the default.
    const minutes = await driver.continueRound(info.id)
    expect(minutes?.roundNumber).toBe(1)
    expect(minutes?.topic).toBe('评审方案')
    expect(driver.get(info.id)?.discussion.rounds).toHaveLength(1)
  })

  it('skips a settled discussion', () => {
    const { ctx } = fakeDriverCtx()
    const host = fakeHost()
    const driver = createRoundtableHostDriver(ctx as never, { provider: 'fork', host: host as never })
    const settled = RoundtableId('rt-settled')
    const session = {
      events: [
        // Opened, settled once, then closed: nothing left to resume.
        event('roundtable/start', { id: settled, roster: [A], topic: 't' }, 0),
        event('roundtable/round-end', { discussionId: settled, minutes: minutes(1) }, 1),
        event('roundtable/end', { discussionId: settled, stopReason: 'completed' }, 2),
      ],
    }

    expect(driver.recover(session as never)).toEqual([])
    expect(driver.get(settled)).toBeUndefined()
  })

  it('re-arms the recorder for a rebuilt discussion: continuation rounds persist to the same session without a duplicate start', async () => {
    const { ctx } = fakeDriverCtx()
    const appended: Array<{ type: string; data: unknown }> = []
    const session = {
      events: [
        event('roundtable/start', info, 0),
        event('roundtable/round-end', { discussionId: info.id, minutes: minutes(1) }, 1),
      ],
      append(type: string, data: unknown) { appended.push({ type, data }); return data },
    }
    const host = { id: 'host-1', session, inbox: { claimWhere: () => [] as unknown[] } }
    const driver = createRoundtableHostDriver(ctx as never, { provider: 'fork', host: host as never })

    const handles = driver.recover(session as never)
    expect(handles).toHaveLength(1)
    // 恢复本身不追加重复的 roundtable/start。
    expect(appended).toEqual([])

    // 恢复的讨论继续下一轮：round-end 持久化到同一 session。
    const next = await driver.continueRound(info.id)
    expect(next?.roundNumber).toBe(2)
    expect(appended.some(a => a.type === 'roundtable/round-end')).toBe(true)

    // 停止后落盘终态。
    await driver.stopDiscussion(info.id)
    expect(appended.some(a => a.type === 'roundtable/end' && (a.data as { stopReason: string }).stopReason === 'completed')).toBe(true)
  })
})
