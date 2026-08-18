import type { Context } from '@deepseek-ai/cordis'
import type { FileSystem } from '@deepseek-ai/dsh-fs'
import z from '@deepseek-ai/schemastery'
import { RoundtableEngine, RoundtableError } from './service.ts'
import type { RoundtableStartRequest, RoundtableRun } from './runtime-types.ts'
import type { RoundMinutes } from './types.ts'
import { createMemberRunner } from './member-runner.ts'
import { runRound, type RunRoundDeps } from './executor.ts'
import { serializeRoundtableMarkdown } from './markdown.ts'
import { RoundtableId } from './types.ts'
import { createRoundtableRecorder } from './recorder.ts'
import { createHostSummarizer, renderDriverError } from './driver.ts'

/** Engine-provider config: the `ctx.subagents` provider members and the host summarizer run on. */
export interface Config {
  provider?: string
  /** 成员上限，缺省 8（spec §6）。 */
  maxMembers?: number
}

/**
 * The concrete roundtable engine provider: registers `ctx.roundtable` and runs
 * one single-round discussion per `start()` call. Mirrors `WorkerThreadWorkflowEngine`
 * (the concrete `WorkflowEngine` provider) — but the roundtable seam `RoundtableEngine`
 * and its provider share this package, so this class IS the seam's loadable entry.
 */
export class RoundtableEngineProvider extends RoundtableEngine {
  static inject = ['subagents', 'fs']
  static Config: z<Config> = z.object({ provider: z.string().default('spawn'), maxMembers: z.number().default(8) })

  private readonly provider: string
  private readonly maxMembers: number
  private readonly recorder: ReturnType<typeof createRoundtableRecorder>

  constructor(ctx: Context, config: Config) {
    super(ctx)
    // schemastery (static Config) fills `provider` on the loader path; the
    // factory always passes it explicitly. The fallback records the default.
    this.provider = config.provider ?? 'spawn'
    this.maxMembers = config.maxMembers ?? 8
    this.recorder = createRoundtableRecorder(ctx)
  }

  start(request: RoundtableStartRequest): RoundtableRun {
    if (request.members.length === 0) throw new RoundtableError('roster is empty', 'ROSTER_INVALID')
    if (request.members.length > this.maxMembers) throw new RoundtableError(`roster exceeds maxMembers (${this.maxMembers})`, 'ROSTER_INVALID')
    const ids = new Set(request.members.map(m => m.id))
    if (ids.size !== request.members.length) throw new RoundtableError('duplicate member id', 'ROSTER_INVALID')

    // Spec §7: a member's independent model route (`agentOptions.provider`) must
    // be among the providers `ctx.llm` has registered. Only checked when the llm
    // service is mounted AND the member explicitly set a provider — an unset
    // provider inherits the parent route and is never rejected here.
    const llm = this.ctx.get('llm')
    if (llm !== undefined) {
      const available = new Set(llm.listProviders().map(entry => entry.id))
      for (const member of request.members) {
        const provider = member.agentOptions?.provider
        if (provider !== undefined && !available.has(provider)) {
          throw new RoundtableError(
            `member "${member.id}" routes to provider "${provider}" which is not registered`
            + ` (available: ${[...available].join(', ') || 'none'})`,
            'ROSTER_INVALID',
          )
        }
      }
    }

    const id = RoundtableId(`rt-${crypto.randomUUID()}`)
    const info = {
      id,
      roster: request.members,
      topic: request.topic,
      ...(request.outputFile !== undefined ? { outputFile: request.outputFile } : {}),
    }
    // Owned controller fused with the external request signal (mirrors the host driver).
    const controller = new AbortController()
    const signal = request.signal === undefined
      ? controller.signal
      : AbortSignal.any([request.signal, controller.signal])
    const provider = request.provider ?? this.provider
    this.emitRoundtableEvent('roundtable/start', info)
    this.recorder.start(request.parent.session, info)

    const memberRunner = createMemberRunner({
      subagents: this.ctx.subagents, provider, parent: request.parent,
    })
    // synthesize:false asks for no conclusion, so skip the host summarizer
    // subagent entirely (no round summary is produced).
    const summarize: RunRoundDeps['summarize'] = request.synthesize === false
      ? async () => []
      : createHostSummarizer({
        subagents: this.ctx.subagents, provider, parent: request.parent, signal,
      })
    const claimSteer = () => [] // 单轮工具：轮中 steer 由多轮宿主驱动承担

    let disposed = false
    // Rounds that actually settled, so a mid-run cancel/error still reports the
    // work that DID complete instead of serializing an empty artifact.
    const settledRounds: RoundMinutes[] = []
    // Members that actually STARTED (runMember invoked), so a mid-run
    // cancel/error reports the real progress instead of a hardcoded 0.
    let membersStarted = 0
    const runMember: RunRoundDeps['runMember'] = async (member, prompt, signal) => {
      membersStarted += 1
      return memberRunner(member, prompt, signal)
    }

    const result = (async () => {
      try {
        const minutes = await runRound(
          {
            runMember, summarize, claimSteer,
          },
          { roundNumber: 1, topic: request.topic, members: request.members, priorSummaries: [], signal },
        )
        settledRounds.push(minutes)
        this.emitRoundtableEvent('roundtable/round-end', info, minutes)
        const discussion = { id, roster: request.members, rounds: [minutes], status: 'completed' as const }
        const markdown = serializeRoundtableMarkdown(discussion, { synthesize: request.synthesize !== false })
        // The per-member skill flow never passes `outputFile`: only write when
        // the caller explicitly requested a file, otherwise return the markdown
        // without dropping a stray `roundtable-rt-<uuid>.md` artifact.
        if (request.outputFile !== undefined) {
          const fs: FileSystem = this.ctx.fs
          await fs.writeText(await fs.resolve(request.outputFile), markdown)
        }
        this.emitRoundtableEvent('roundtable/end', info, 'completed')
        this.recorder.finish(id, 'completed')
        return { stopReason: 'completed' as const, agentsStarted: request.members.length, rounds: settledRounds }
      } catch (error) {
        if (signal.aborted) {
          this.emitRoundtableEvent('roundtable/end', info, 'cancelled')
          this.recorder.finish(id, 'cancelled')
          return { stopReason: 'cancelled' as const, agentsStarted: membersStarted, rounds: settledRounds }
        }
        // A genuine run failure (member/subagent, summarize, or the export
        // write) must not vanish silently: surface it in the log, rendered
        // safely without trusting the thrown value (parity with the driver).
        this.ctx.logger.warn(`roundtable: discussion "${id}" settled error: ${renderDriverError(error)}`)
        this.emitRoundtableEvent('roundtable/end', info, 'error')
        this.recorder.finish(id, 'error')
        return { stopReason: 'error' as const, agentsStarted: membersStarted, rounds: settledRounds }
      }
    })()

    return {
      id,
      result,
      cancel: (reason) => { controller.abort(reason) },
      dispose: async () => {
        if (disposed) return
        disposed = true
        controller.abort()
        await result
      },
    }
  }
}

/** Back-compat factory: build the provider instance for direct/in-process use. */
export function createRoundtableEngine(ctx: Context, deps: { provider: string }): RoundtableEngine {
  return new RoundtableEngineProvider(ctx, { provider: deps.provider })
}
