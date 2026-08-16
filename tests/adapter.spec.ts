import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { agentEvents, type Agent, type PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { type Session, SessionId } from '@deepseek-ai/dsh-session'
import SessionQueryEngine from '@deepseek-ai/dsh-session-query'
import { apply, formatSessionReferenceMention, inject, name } from '../src/index.ts'

class TestSessionQueryEngine extends SessionQueryEngine {
  override searchSessions(
    ..._args: Parameters<SessionQueryEngine['searchSessions']>
  ): ReturnType<SessionQueryEngine['searchSessions']> {
    return Promise.resolve({ items: [] })
  }

  override searchEvents(
    ...args: Parameters<SessionQueryEngine['searchEvents']>
  ): ReturnType<SessionQueryEngine['searchEvents']> {
    return this.readSurface(args[0].sessionId).then(surface => ({
      session: surface.session,
      items: [],
    }))
  }
}

async function harness(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SessionStore)
  await ctx.plugin(TestSessionQueryEngine)
  await ctx.plugin({ inject: [...inject], apply })
  return ctx
}

function fakeAgent(session: Session): Agent {
  return { id: session.id, session } as Agent
}

const SIGNAL = new AbortController().signal

async function fire(
  ctx: Context,
  agent: Agent,
  messages: UserMessage[],
  base: 'enter' | 'reject' = 'enter',
): Promise<PreStepDecision> {
  return agentEvents(ctx, agent).waterfall(
    'agent/pre-step',
    { messages, turn: 1, step: 1, signal: SIGNAL },
    () => Promise.resolve(base === 'enter'
      ? { kind: 'enter' as const, messages }
      : { kind: 'reject' as const }),
  )
}

describe('session reference plugin', () => {
  it('declares the agent registry and exact session-query capability', () => {
    expect(name).toBe('session-reference')
    expect(inject).toEqual(['agents', 'sessionQuery'])
  })

  it('resolves a canonical mention into a referenced-session snapshot before the readable prompt', async () => {
    const ctx = await harness()
    const source = ctx.sessions.create(SessionId('source'), { meta: { cwd: '/same', createdAt: 1 } })
    source.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'source transcript' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    const target = ctx.sessions.create(SessionId('target'), { meta: { cwd: '/same', createdAt: 2 } })
    const mention = formatSessionReferenceMention({ sessionId: source.id, label: 'Source' })
    const direct = createUserMessage({
      content: [{ type: 'text', text: `see ${mention}` }], source: { kind: 'user' },
    })

    const decision = await fire(ctx, fakeAgent(target), [direct])

    expect(decision.kind).toBe('enter')
    if (decision.kind !== 'enter') return
    expect(decision.messages).toHaveLength(2)
    const [snapshot, readable] = decision.messages
    expect(snapshot?.source.kind).toBe('session-reference')
    expect(readable?.source.kind).toBe('user')
    expect(readable?.content).toEqual([{ type: 'text', text: 'see @Source' }])
  })

  it('preserves non-text blocks alongside the resolved mention', async () => {
    const ctx = await harness()
    const source = ctx.sessions.create(SessionId('source'), { meta: { cwd: '/same', createdAt: 1 } })
    source.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'source transcript' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    const target = ctx.sessions.create(SessionId('target'), { meta: { cwd: '/same', createdAt: 2 } })
    const mention = formatSessionReferenceMention({ sessionId: source.id, label: 'Source' })
    const direct = createUserMessage({
      content: [
        { type: 'text', text: `see ${mention}` },
        { type: 'reasoning', text: 'private reasoning' },
      ],
      source: { kind: 'user' },
    })

    const decision = await fire(ctx, fakeAgent(target), [direct])

    expect(decision.kind).toBe('enter')
    if (decision.kind !== 'enter') return
    expect(decision.messages).toHaveLength(2)
    expect(decision.messages[1]?.source.kind).toBe('user')
    expect(decision.messages[1]?.content).toEqual([
      { type: 'text', text: 'see @Source' },
      { type: 'reasoning', text: 'private reasoning' },
    ])
  })

  it('leaves a message without a mention untouched', async () => {
    const ctx = await harness()
    const target = ctx.sessions.create(SessionId('target'), { meta: { createdAt: 1 } })
    const plain = createUserMessage({
      content: [{ type: 'text', text: 'no mention here' }], source: { kind: 'user' },
    })

    const decision = await fire(ctx, fakeAgent(target), [plain])

    expect(decision).toEqual({ kind: 'enter', messages: [plain] })
  })

  it('passes a rejected decision through untouched', async () => {
    const ctx = await harness()
    const target = ctx.sessions.create(SessionId('target'), { meta: { createdAt: 1 } })
    const mention = formatSessionReferenceMention({ sessionId: SessionId('other'), label: 'Other' })
    const direct = createUserMessage({
      content: [{ type: 'text', text: `see ${mention}` }], source: { kind: 'user' },
    })

    const decision = await fire(ctx, fakeAgent(target), [direct], 'reject')

    expect(decision).toEqual({ kind: 'reject' })
  })

  it('does not resolve mentions carried by plugin context', async () => {
    const ctx = await harness()
    const target = ctx.sessions.create(SessionId('target'), { meta: { createdAt: 1 } })
    const mention = formatSessionReferenceMention({ sessionId: SessionId('other'), label: 'Other' })
    const pluginContext = createUserMessage({
      content: [{ type: 'text', text: `see ${mention}` }], source: { kind: 'plugin', plugin: 'workspace' },
    })

    const decision = await fire(ctx, fakeAgent(target), [pluginContext])

    expect(decision).toEqual({ kind: 'enter', messages: [pluginContext] })
  })
})
