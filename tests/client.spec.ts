// @vitest-environment jsdom
/**
 * Session-reference browser half: source registration (duplicate-name
 * proof) + fiber-teardown removal (HMR safety) against the real
 * InputTriggerService, then the source behavior contract driven directly on
 * the captured source with real ClientSessionContext projections — candidates
 * from the root session list (self and blank excluded, same-cwd first, then
 * label order, duplicate labels disambiguated with the id), and pick inserting
 * a structured reference whose codec emits the canonical mention. The
 * expected mention is recomputed with Node's base64url so the browser-side
 * encoder is checked against the shared URI format without importing the host
 * package.
 */
import { Buffer } from 'node:buffer'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import type { SessionId, SessionListState, SessionSummary } from '@deepseek-ai/dsh-client-runtime/client'
import type { ClientSessionContext, InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { apply, inject } from '../src/client.ts'

function summary(partial: Partial<SessionSummary> & { id: SessionId }): SessionSummary {
  return { displayTitle: partial.id, running: false, blank: false, updatedAt: 0, ...partial }
}

const sid = (id: string) => id as SessionId

function sessionsWith(sessions: SessionSummary[]) {
  const byId: Record<string, SessionSummary> = {}
  for (const s of sessions) byId[s.id] = s
  const snapshot = { ids: sessions.map(s => s.id), byId, current: undefined } as unknown as SessionListState
  return {
    list: { getSnapshot: () => snapshot },
  }
}

function canonicalMention(sessionId: SessionId, label: string): string {
  const escaped = label.replace(/[\\\]]/g, match => `\\${match}`)
  return `@[${escaped}](dsh-session:${Buffer.from(JSON.stringify(sessionId), 'utf8').toString('base64url')}) `
}

async function bench(sessions: SessionSummary[]) {
  const ctx = new Context()
  let captured: InputTriggerSource | undefined
  ctx.provide('inputTriggers', { registerSource: (src: InputTriggerSource) => { captured = src; return () => {} } })
  ctx.provide('sessions', sessionsWith(sessions))
  ctx.provide('locale', {
    register: () => () => {},
    bind: () => (key: string) => key === 'menu' ? 'Sessions' : key,
  })
  await ctx.plugin({ inject: [...inject], apply }).await()
  return { source: captured! }
}

const proj = (id: string): ClientSessionContext => ({ sessionId: sid(id) })

const req = (query: string) =>
  ({ query, position: 'inline' as const, signal: new AbortController().signal })

const FAMILY: SessionSummary[] = [
  summary({ id: sid('self'), displayTitle: 'self', cwd: '/same' }),
  summary({ id: sid('same-a'), displayTitle: 'alpha', cwd: '/same' }),
  summary({ id: sid('same-b'), displayTitle: 'beta', cwd: '/same' }),
  summary({ id: sid('cwdless'), displayTitle: 'gamma' }),
  summary({ id: sid('other'), displayTitle: 'delta', cwd: '/else' }),
  summary({ id: sid('blank'), displayTitle: 'blank', cwd: '/same', blank: true }),
]

describe('apply', () => {
  it('declares the services it binds', () => {
    expect(inject).toEqual(['inputTriggers', 'sessions', 'locale'])
  })

  it('registers the "@" source with its own localized group title', async () => {
    const ctx = new Context()
    let captured: InputTriggerSource | undefined
    let disposed = false
    ctx.provide('inputTriggers', {
      registerSource: (source: InputTriggerSource) => {
        captured = source
        return () => { disposed = true }
      },
    })
    ctx.provide('sessions', sessionsWith([]))
    ctx.provide('locale', {
      register: () => () => {},
      bind: () => () => 'Sessions',
    })
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(captured).toMatchObject({ trigger: '@', name: 'session-reference' })
    expect(captured?.groupLabel?.()).toBe('Sessions')
    await fiber.dispose()
    expect(disposed).toBe(true)
  })
})

describe('candidates', () => {
  it('excludes self and blank sessions and ranks same-cwd first, then label', async () => {
    const { source } = await bench(FAMILY)
    await expect(source.candidates(proj('self'), req(''))).resolves.toEqual([
      { name: 'alpha', description: '/same' },
      { name: 'beta', description: '/same' },
      { name: 'gamma', description: 'cwdless' },
      { name: 'delta', description: '/else' },
    ])
  })

  it('filters by label, cwd, and id containment', async () => {
    const { source } = await bench(FAMILY)
    await expect(source.candidates(proj('self'), req('bet'))).resolves.toEqual([
      { name: 'beta', description: '/same' },
    ])
  })

  it('disambiguates duplicate labels with the session id', async () => {
    const { source } = await bench([
      summary({ id: sid('self'), displayTitle: 'self', cwd: '/same' }),
      summary({ id: sid('dup-1'), displayTitle: 'dup', cwd: '/same' }),
      summary({ id: sid('dup-2'), displayTitle: 'dup', cwd: '/same' }),
    ])
    const candidates = await source.candidates(proj('self'), req(''))
    expect(candidates.map(candidate => candidate.name)).toEqual(['dup · dup-1', 'dup · dup-2'])
  })
})

describe('pick', () => {
  it('inserts an @title chip whose persisted form is the canonical mention', async () => {
    const { source } = await bench(FAMILY)
    // The pick maps the candidate name back through the candidate fetch.
    await source.candidates(proj('self'), req(''))
    const outcome = source.onPick({
      candidate: { name: 'alpha' },
      session: proj('self'),
      position: 'inline',
      via: 'menu',
      span: { start: 0, end: 1, draftRev: 1 },
    })
    const mention = canonicalMention(sid('same-a'), 'alpha').trimEnd()
    expect(outcome).toEqual({
      insert: {
        source: 'session-reference',
        ref: mention,
        label: 'alpha',
        clipboardText: mention,
        presentation: { variant: 'capsule', sigil: '@' },
      },
    })
  })

  it('misses a candidate name it never served', async () => {
    const { source } = await bench(FAMILY)
    const outcome = source.onPick({
      candidate: { name: 'unknown' },
      session: proj('self'),
      position: 'inline',
      via: 'menu',
      span: { start: 0, end: 1, draftRev: 1 },
    })
    expect(outcome).toBeUndefined()
  })

  it('escapes label metacharacters in the mention', async () => {
    const label = 'back\\slash]label'
    const { source } = await bench([
      summary({ id: sid('self'), displayTitle: 'self', cwd: '/same' }),
      summary({ id: sid('meta'), displayTitle: label, cwd: '/same' }),
    ])
    await source.candidates(proj('self'), req(''))
    const outcome = source.onPick({
      candidate: { name: label },
      session: proj('self'),
      position: 'inline',
      via: 'menu',
      span: { start: 0, end: 1, draftRev: 1 },
    })
    const mention = canonicalMention(sid('meta'), label).trimEnd()
    expect(outcome).toEqual({
      insert: {
        source: 'session-reference',
        ref: mention,
        label,
        clipboardText: mention,
        presentation: { variant: 'capsule', sigil: '@' },
      },
    })
  })

  it('codec keeps the canonical mention for clipboard and model projections', async () => {
    const { source } = await bench(FAMILY)
    const mention = canonicalMention(sid('same-a'), 'alpha').trimEnd()
    expect(source.codec!.clipboardText(mention)).toBe(mention)
    await expect(source.codec!.serialize(mention, new AbortController().signal)).resolves.toBe(mention)
  })

  it('codec rejects an already-aborted submit attempt', async () => {
    const { source } = await bench(FAMILY)
    const controller = new AbortController()
    controller.abort(new Error('cancelled'))
    await expect(source.codec!.serialize('mention', controller.signal)).rejects.toThrow('cancelled')
  })
})
