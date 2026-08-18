import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { createRoundtableHostDriver } from '../src/driver.ts'
import type { RoundtableMember } from '../src/types.ts'

/**
 * Near-integration test (spec §11 fallback): the REAL `createRoundtableHostDriver`
 * (which runs the real `createRoundtableDriver` + `runRound` executor) driven
 * end-to-end against a scripted `runMember`/`summarize` (a deterministic
 * `ctx.subagents`) and a REAL `Session` — not the fake `append`-only session
 * the driver unit tests use. The residual gap to a true live-model run is the
 * scripted members: a real headless profile would route members and the host
 * summarizer through a live `ctx.subagents` provider + model adapter.
 */

const A: RoundtableMember = { id: 'a', label: '架构师' }
const B: RoundtableMember = { id: 'b', label: '安全专家' }

interface QueuedMessage {
  id: string
  content: { type: 'text'; text: string }[]
  source: { kind: string }
}

function integrationHarness(workdir: string) {
  const session = Session.create(SessionId(`rt-integration-${Math.random()}`))
  const labels: string[] = []
  const memberPrompts: string[] = []
  const queue: QueuedMessage[] = []
  const listeners = new Map<string, Array<(...args: unknown[]) => unknown>>()
  let hostCalls = 0
  let steerOnNextA = false
  let steerSeq = 0

  const subagents = {
    start: async (_provider: string, req: { label?: string; prompt: { text?: string }[] }) => {
      const label = req.label ?? '?'
      labels.push(label)
      if (label === '会议主持人') {
        hostCalls += 1
        return {
          result: Promise.resolve({ output: [{ type: 'text', text: `【第${hostCalls}轮纪要】` }], stopReason: 'completed' }),
          dispose: async () => {},
        }
      }
      memberPrompts.push(`${label}::${req.prompt.map(b => b.text ?? '').join('')}`)
      // Inject one mid-round steer while the first member of round 2 is speaking:
      // the executor claims it immediately after that member, so it reaches the
      // NEXT member's prompt.
      if (label === '架构师' && steerOnNextA) {
        steerOnNextA = false
        queue.push({ id: `steer-${steerSeq++}`, content: [{ type: 'text', text: '中途插入意见' }], source: { kind: 'user' } })
      }
      return {
        result: Promise.resolve({ output: [{ type: 'text', text: `${label} 发言` }], stopReason: 'completed' }),
        dispose: async () => {},
      }
    },
  }

  const host = {
    id: 'host-1',
    session,
    inbox: {
      claimWhere: (where: (message: QueuedMessage) => boolean, _turn: number) => {
        const matched = queue.filter(where)
        const kept = queue.filter(message => !where(message))
        queue.splice(0, queue.length, ...kept)
        return matched
      },
    },
  }

  const ctx = {
    subagents,
    logger: { warn: () => {} },
    on: (name: string, cb: (...args: unknown[]) => unknown) => {
      const list = listeners.get(name) ?? []
      list.push(cb)
      listeners.set(name, list)
      return () => true
    },
    events: {
      dispatch: (_mode: string, args: unknown[]) => {
        const [name] = args as [string, ...unknown[]]
        return (listeners.get(name) ?? []).slice()
      },
    },
    fs: {
      resolve: async (path: string) => join(workdir, path),
      writeText: async (target: string, content: string) => { await writeFile(target, content) },
    },
  }

  const driver = createRoundtableHostDriver(ctx as never, { provider: 'fork', host: host as never })
  return {
    session, labels, memberPrompts, driver,
    injectSteerOnNextA: () => { steerOnNextA = true },
  }
}

let workdir: string | undefined

afterEach(async () => {
  if (workdir !== undefined) await rm(workdir, { recursive: true, force: true })
  workdir = undefined
})

describe('roundtable multi-round integration (scripted members + real session)', () => {
  it('runs a full discussion end-to-end: fixed roster, summary handoff, mid-round steer, markdown stop', async () => {
    workdir = await mkdtemp(join(tmpdir(), 'dsh-roundtable-integration-'))
    const h = integrationHarness(workdir)

    const handle = h.driver.startDiscussion({ topic: '评审方案', members: [A, B], outputFile: 'out.md' })
    const first = await handle.started
    expect(first?.roundNumber).toBe(1)

    // (1) fixed roster order, every round.
    expect(h.labels).toEqual(['架构师', '安全专家', '会议主持人'])

    // (2) each round's summary feeds the next round.
    h.injectSteerOnNextA()
    const second = await h.driver.continueRound(handle.id, '补充架构细节')
    expect(second?.roundNumber).toBe(2)
    expect(h.labels).toEqual(['架构师', '安全专家', '会议主持人', '架构师', '安全专家', '会议主持人'])
    expect(h.memberPrompts[2]).toContain('【第1轮纪要】')

    // (3) a mid-round steer reaches the next member.
    expect(second?.humanSteers).toEqual(['中途插入意见'])
    expect(h.memberPrompts[3]).toContain('中途插入意见')
    expect(h.memberPrompts[3]).toContain('【第1轮纪要】')

    // (4) "停止" writes a markdown file.
    const markdown = await h.driver.stopDiscussion(handle.id)
    const written = await readFile(join(workdir, 'out.md'), 'utf8')
    expect(written).toBe(markdown)
    expect(written).toContain('# 评审方案')
    expect(written).toContain('## 第 1 轮')
    expect(written).toContain('## 第 2 轮')
    expect(written).toContain('**纪要：**')
    expect(written).toContain('## 综合方案')
    expect(written).not.toContain('### 架构师')

    // The real Session carried the discussion's durable records end-to-end.
    const roundtableTypes = h.session.events
      .filter(event => event.type.startsWith('roundtable/'))
      .map(event => event.type)
    expect(roundtableTypes).toEqual([
      'roundtable/start',
      'roundtable/round-end',
      'roundtable/round-end',
      'roundtable/end',
    ])
  })
})
