/**
 * Host half of the cross-session reference plugin: resolves canonical
 * `@[label](dsh-session:…)` mentions in direct user prompts into read-only
 * referenced-session snapshots before the step opens.
 *
 * @module dsh-session-reference
 */

import type { Context } from '@deepseek-ai/cordis'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, UserMessage } from '@deepseek-ai/dsh-llm'
import SessionReferenceResolver from './resolver.ts'
import type { Config as ResolverConfig } from './config.ts'
import { parseSessionReferenceText } from './uri.ts'
import type { SessionReferenceInput } from './types.ts'

export type * from './types.ts'
export type { SessionReferenceErrorCode } from './config.ts'
/** Validated deployment limits accepted by the plugin. */
export type Config = ResolverConfig
export {
  DEFAULT_CANDIDATE_LIMIT,
  DEFAULT_MAX_REFERENCE_BYTES,
  MAX_REFERENCES,
  SessionReferenceError,
} from './config.ts'
export {
  SESSION_REFERENCE_SCHEME,
  decodeSessionReferenceUri,
  encodeSessionReferenceUri,
  formatSessionReferenceMention,
  parseSessionReferenceText,
} from './uri.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'session-reference'

/** The agent registry (pre-step ownership) and the cross-session resolver. */
export const inject = ['agents', 'sessionQuery']

/** Validated deployment limits for the single host plugin row. */
export const Config = SessionReferenceResolver.Config

/** One direct prompt's extracted mentions and their readable replacement content. */
interface ExtractedReferences {
  content: ContentBlock[]
  references: SessionReferenceInput[]
}

/** Extract canonical mentions from one content-block list, or return undefined when none match. */
function extractReferences(content: readonly ContentBlock[]): ExtractedReferences | undefined {
  let found = false
  const cleaned: ContentBlock[] = []
  const references: SessionReferenceInput[] = []
  for (const block of content) {
    if (block.type === 'text') {
      const parsed = parseSessionReferenceText(block.text)
      if (parsed.references.length > 0) found = true
      references.push(...parsed.references)
      cleaned.push({ type: 'text', text: parsed.text })
    } else {
      cleaned.push(block)
    }
  }
  return found ? { content: cleaned, references } : undefined
}

/** A direct human prompt (not a tool result, plugin context, or injected snapshot). */
function isDirectUserMessage(message: UserMessage): boolean {
  return message.source.kind === 'user'
}

/**
 * Register a pre-step listener that resolves mentions for the lifetime of `ctx`.
 * @param ctx - plugin context; the listener is disposed with it.
 */
export function apply(ctx: Context, config: ResolverConfig = {}): void {
  const resolver = new SessionReferenceResolver(ctx, config)
  ctx.on('agent/pre-step', async ({ agent, signal }, next): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind === 'reject') return decision
    const out: UserMessage[] = []
    const additional: UserMessage[] = []
    let transformed = false
    for (const message of decision.messages) {
      if (!isDirectUserMessage(message)) {
        out.push(message)
        continue
      }
      const extracted = extractReferences(message.content)
      if (extracted === undefined) {
        out.push(message)
        continue
      }
      const prepared = await resolver.prepare(agent, extracted.content, extracted.references, signal)
      out.push(createUserMessage({ content: prepared.content, source: message.source }))
      /* v8 ignore next -- prepare always returns the snapshot when extractReferences found a mention. */
      if (prepared.additionalContext !== undefined) additional.push(prepared.additionalContext)
      transformed = true
    }
    if (!transformed) return decision
    return { kind: 'enter', messages: [...additional, ...out] }
  })
}
