// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  SessionId, SessionListState, WorkspaceId, WorkspaceListState,
} from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import {
  RoundtableFooterAction, type RoundtableFooterActionProps,
} from '../src/client/RoundtableFooterAction.tsx'
import type { RoundtableFooterActionInjected } from '../src/client/slots.ts'
import { zh } from '../src/client/locales.ts'
import { apply, inject } from '../src/client/index.ts'

afterEach(cleanup)

const PARENT_ID = 'parent' as SessionId
const WS_ID = 'ws1' as WorkspaceId
const NEW_ID = 'new' as SessionId

const listState = (): SessionListState => ({
  ids: [PARENT_ID],
  byId: {
    [PARENT_ID]: {
      id: PARENT_ID, displayTitle: 'parent', running: true, blank: false, updatedAt: 0,
    },
  },
  current: PARENT_ID,
  phase: 'ready',
  subagentsByParent: {},
  jobsBySession: {},
  currentAddress: undefined,
})

/** Workspace baseline with one recent workspace and no current-session account. */
function workspaceListState(): WorkspaceListState {
  return {
    items: [{
      workspaceId: WS_ID, path: '/ws', title: 'ws', sessionIds: [],
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    }],
    archivedSessionIds: [],
    state: 'idle',
    phase: 'ready',
    error: null,
    baselinesReady: true,
    recentWorkspaceId: WS_ID,
  }
}

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  slots.register({
    name: 'root',
    children: {
      'sidebar.footer.action': { kind: 'list', scope: 'root' },
    },
  } as never, () => null)
  // The footer action starts a session by queueing the bare「圆桌讨论」message
  // on the current session's prompt channel; the host agent then drives the
  // roundtable skill conversationally.
  const prompt = vi.fn(async () => Promise.resolve({ ok: true, value: { accepted: true } }))
  const open = vi.fn()
  const connectWorkspace = vi.fn(async () => NEW_ID)
  ctx.provide('sessions', {
    list: { getSnapshot: () => listState(), subscribe: () => () => {} },
    binding: () => ({ sessionId: PARENT_ID, session: { prompt }, ctx: undefined }),
    open,
  } as never)
  ctx.provide('workspaces', {
    list: { getSnapshot: () => workspaceListState(), subscribe: () => () => {} },
    connectWorkspace,
  } as never)
  ctx.provide('locale', new LocaleRuntime(ctx))
  return { ctx, slots, prompt, open, connectWorkspace }
}

describe('ui-roundtable apply', () => {
  it('declares every service it binds', () => {
    expect(inject).toEqual(['slots', 'locale', 'sessions', 'workspaces'])
  })

  it('registers the sidebar footer action, then unregisters on teardown', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const entries = b.slots.entries('sidebar.footer.action')
    expect(entries).toHaveLength(1)
    const entry = entries[0]!
    expect(entry.locale).toBe('roundtable')
    expect(entry.component).toBe(RoundtableFooterAction)
    const face = (entry.inject as unknown as () => RoundtableFooterActionInjected)()
    expect(Object.keys(face)).toEqual(['startRoundtableSession'])
    await fiber.dispose()
    expect(b.slots.entries('sidebar.footer.action')).toHaveLength(0)
  })
})

describe('ui-roundtable sidebar footer action', () => {
  it('registers the 新讨论组 entry and its startRoundtableSession verb', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const entries = b.slots.entries('sidebar.footer.action')
    expect(entries).toHaveLength(1)
    const entry = entries[0]!
    expect(entry.locale).toBe('roundtable')
    expect(entry.component).toBe(RoundtableFooterAction)
    const face = (entry.inject as unknown as () => RoundtableFooterActionInjected)()
    expect(Object.keys(face)).toEqual(['startRoundtableSession'])
    // Starting a session connects the recent Workspace, opens the returned
    // session, and queues the bare「圆桌讨论」message for the host skill.
    await expect(face.startRoundtableSession()).resolves.toBeNull()
    expect(b.connectWorkspace).toHaveBeenCalledWith(WS_ID)
    expect(b.open).toHaveBeenCalledWith(NEW_ID)
    expect(b.prompt).toHaveBeenCalledWith([{ type: 'text', text: '圆桌讨论' }], 'queue')
    await fiber.dispose()
    expect(b.slots.entries('sidebar.footer.action')).toHaveLength(0)
  })

  it('reports the connect failure instead of prompting', async () => {
    const b = await bench()
    b.connectWorkspace.mockRejectedValueOnce(new Error('connect exploded'))
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const face = (b.slots.entries('sidebar.footer.action')[0]!.inject as unknown as () => RoundtableFooterActionInjected)()
    await expect(face.startRoundtableSession()).resolves.toBe('connect exploded')
    expect(b.open).not.toHaveBeenCalled()
    expect(b.prompt).not.toHaveBeenCalled()
    await fiber.dispose()
  })
})

describe('RoundtableFooterAction', () => {
  function footerProps(overrides: Partial<RoundtableFooterActionProps> = {}): RoundtableFooterActionProps {
    return {
      wide: true,
      useSessions: selector => selector(listState()),
      useWorkspaces: selector => selector(workspaceListState()),
      startRoundtableSession: () => Promise.resolve(null),
      t: makeTranslate(zh),
      ...overrides,
    }
  }

  it('renders the 新讨论组 button and starts a session on click', async () => {
    const startRoundtableSession = vi.fn(async () => null)
    const view = render(<RoundtableFooterAction {...footerProps({ startRoundtableSession })} />)
    const button = view.container.querySelector('[data-roundtable-footer]') as HTMLButtonElement
    expect(button).toBeTruthy()
    expect(button.textContent).toContain('新讨论组')
    expect(button.disabled).toBe(false)
    fireEvent.click(button)
    await waitFor(() => { expect(startRoundtableSession).toHaveBeenCalledTimes(1) })
  })

  it('disables the button when no workspace can be resolved', () => {
    const empty = (): WorkspaceListState => ({ ...workspaceListState(), items: [], recentWorkspaceId: undefined })
    const view = render(<RoundtableFooterAction {...footerProps({ useWorkspaces: selector => selector(empty()) })} />)
    const button = view.container.querySelector('[data-roundtable-footer]') as HTMLButtonElement
    expect(button.disabled).toBe(true)
  })

  it('shows a short failure line when starting the session fails', async () => {
    const startRoundtableSession = vi.fn(async () => 'no workspace')
    const view = render(<RoundtableFooterAction {...footerProps({ startRoundtableSession })} />)
    fireEvent.click(view.container.querySelector('[data-roundtable-footer]')!)
    await waitFor(() => {
      expect(view.container.querySelector('[data-roundtable-footer-error]')?.textContent).toBe('no workspace')
    })
  })
})
