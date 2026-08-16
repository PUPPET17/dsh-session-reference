/**
 * Session reference source, browser half: registers the '@' source whose
 * candidates come from the root session list (self and blank sessions
 * excluded, same-cwd first, then label order); picking inserts a structured
 * chip while its codec serializes the canonical `@[label](dsh-session:…)`
 * mention the host half resolves into a read-only referenced-session
 * snapshot. The URI is encoded here with browser APIs so the browser bundle
 * remains independent of the Node-only resolver modules in this package.
 */
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ClientContext, SessionId, SessionSummary } from '@deepseek-ai/dsh-client-runtime/client'
import type { InputTriggerServiceContract, InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Menu copy owned by the external session-reference source. */
    'dsh-session-reference': 'menu'
  }
}

/** URI scheme shared with dsh-session-reference's canonical mention format. */
const SESSION_REFERENCE_SCHEME = 'dsh-session:'

/** Encode a session id as the canonical `dsh-session:<base64url(JSON.stringify(id))>` URI. */
function encodeSessionUri(sessionId: SessionId): string {
  const bytes = new TextEncoder().encode(JSON.stringify(sessionId))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  const base64 = btoa(binary)
  return `${SESSION_REFERENCE_SCHEME}${base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`
}

/** Escape `\` and `]` so a label round-trips through the Markdown mention. */
function escapeLabel(label: string): string {
  return label.replace(/[\\\]]/g, match => `\\${match}`)
}

/** Render the canonical `@[label](dsh-session:…)` mention the host half parses. */
function formatMention(sessionId: SessionId, label: string): string {
  return `@[${escapeLabel(label)}](${encodeSessionUri(sessionId)})`
}

/** Locale namespace owned by this external feature. */
const LOCALE_NAMESPACE = 'dsh-session-reference'

/** Required services: the trigger roster, session list, and source-owned localization. */
export const inject = ['inputTriggers', 'sessions', 'locale']

/**
 * Client plugin body: register the '@' session-reference source over the root session list.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const sessions = ctx.sessions
  const inputTriggers = ctx.get('inputTriggers') as InputTriggerServiceContract
  ctx.effect(() => ctx.locale.register(LOCALE_NAMESPACE, {
    zh: { menu: '会话' },
    en: { menu: 'Sessions' },
  }), 'dsh-session-reference: menu dictionaries')
  const t = ctx.locale.bind(LOCALE_NAMESPACE)
  // Candidate name -> { sessionId, label }, rebuilt per candidate fetch.
  const byName = new Map<string, { sessionId: SessionId; label: string }>()

  const source: InputTriggerSource = {
    trigger: '@',
    name: 'session-reference',
    order: 1,
    groupLabel: () => t('menu'),
    candidates(session, { query }) {
      const snapshot = sessions.list.getSnapshot()
      const currentCwd = snapshot.byId[session.sessionId]?.cwd
      const needle = query.toLowerCase()
      const titleCounts = new Map<string, number>()

      const rows: SessionSummary[] = []
      for (const row of Object.values(snapshot.byId)) {
        if (row.id === session.sessionId || row.blank) continue
        if (needle !== '' && !`${row.displayTitle} ${row.cwd ?? ''} ${row.id}`.toLowerCase().includes(needle)) continue
        rows.push(row)
        titleCounts.set(row.displayTitle, (titleCounts.get(row.displayTitle) ?? 0) + 1)
      }

      const rank = (row: SessionSummary): number =>
        currentCwd !== undefined && row.cwd === currentCwd ? 0 : row.cwd === undefined ? 1 : 2
      rows.sort((a, b) => rank(a) - rank(b) || a.displayTitle.localeCompare(b.displayTitle))

      byName.clear()
      return Promise.resolve(rows.map((row) => {
        /* v8 ignore next -- every candidate row set its own title count above. */
        const duplicated = (titleCounts.get(row.displayTitle) ?? 0) > 1
        const name = duplicated ? `${row.displayTitle} · ${row.id}` : row.displayTitle
        byName.set(name, { sessionId: row.id, label: row.displayTitle })
        return { name, description: row.cwd ?? row.id }
      }))
    },
    onPick({ candidate }) {
      const hit = byName.get(candidate.name)
      if (hit === undefined) return undefined
      const mention = formatMention(hit.sessionId, hit.label)
      return {
        insert: {
          source: 'session-reference',
          ref: mention,
          label: hit.label,
          clipboardText: mention,
          presentation: { variant: 'capsule', sigil: '@' },
        },
      }
    },
    codec: {
      clipboardText: ref => ref,
      serialize(ref, signal) {
        if (signal.aborted) {
          const reason: unknown = signal.reason
          return Promise.reject(reason instanceof Error ? reason : new Error('session reference serialization aborted'))
        }
        return Promise.resolve(ref)
      },
    },
  }

  ctx.effect(() => inputTriggers.registerSource(source), 'dsh-session-reference: @ source')
}
