/**
 * Wire fingerprint log.
 *
 * Records what the adapter actually put on the socket, so a rejected request can
 * be audited without a packet capture. Every entry is one JSON line: the model
 * id, the message count, each message's role and key list, how many messages
 * carry `reasoning_content`, and a truncated SHA-256 of the serialized body.
 *
 * The log is a diagnostic, not a source of truth: writes are best-effort and a
 * failure to log never interrupts a request. Path is `%TEMP%\dsh-mistral-wire.log`
 * unless `DSH_MISTRAL_WIRE_LOG` says otherwise.
 *
 * The file is created with mode `0600` and tightened to `0600` on every write,
 * because `%TEMP%` is usually `/tmp` (`1777`) and the entries are prompt
 * metadata. Rotation preserves the mode.
 */
import { appendFileSync, chmodSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Rotation cap, also the limit the `/cache` route reads. */
export const WIRE_LOG_MAX_LINES = 400

const LOG_MODE = 0o600

function logPath() {
  return process.env.DSH_MISTRAL_WIRE_LOG ?? join(tmpdir(), 'dsh-mistral-wire.log')
}

/** Absolute path of the log file, for the `/wire` route. */
export function wireLogPath() {
  return logPath()
}

/** Short stable digest of a serialized body. */
export function fingerprint(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16)
}

/**
 * Conversation id for one `prompt_cache_key`, or undefined when the request
 * carried none.
 *
 * The key can be a user-supplied string, so only a truncated digest is ever
 * logged: it groups the requests of one conversation in `/cache` without
 * recording the key itself.
 */
export function conversationId(key) {
  if (typeof key !== 'string' || key === '') return undefined
  return createHash('sha256').update(key, 'utf8').digest('hex').slice(0, 16)
}

/** Per-request hit-rate buckets, in percent, reported by `/cache`. */
export const HIT_RATE_BUCKETS = ['0', '1-25', '26-50', '51-75', '76-99', '100']

/**
 * Short stable digest of a message list's prefix, excluding the last message.
 *
 * `fingerprint` over the whole body shows that two requests differ, not where.
 * The prefix is what a provider's prompt cache can reuse, so comparing this
 * digest across the requests of one conversation tells a rewritten prefix (a
 * plugin changed the system prompt, a tool order changed, a compaction
 * happened) from a provider-side eviction. Only the digest is logged; message
 * content never leaves this function. An empty prefix (a single-message
 * conversation) hashes the serialized empty list, so it is always defined.
 */
export function prefixFingerprint(messages) {
  const list = Array.isArray(messages) ? messages : []
  const prefix = list.slice(0, Math.max(0, list.length - 1))
  return fingerprint(JSON.stringify(prefix))
}

/** Bucket label for one request's hit rate; `promptTokens` must be non-zero. */
function hitRateBucket(promptTokens, cachedTokens) {
  const percent = (cachedTokens / promptTokens) * 100
  if (percent <= 0) return '0'
  if (percent >= 100) return '100'
  if (percent <= 25) return '1-25'
  if (percent <= 50) return '26-50'
  if (percent <= 75) return '51-75'
  return '76-99'
}

/** Per-message role plus the keys that would travel, in order. */
export function summarizeMessages(messages) {
  if (!Array.isArray(messages)) return []
  return messages.map((message, index) => ({
    i: index,
    role: typeof message?.role === 'string' ? message.role : null,
    keys: Object.keys(message ?? {}),
  }))
}

/** How many messages still carry the field Mistral rejects. */
export function reasoningCount(messages) {
  if (!Array.isArray(messages)) return 0
  return messages.reduce((total, message) => (message?.reasoning_content !== undefined ? total + 1 : total), 0)
}

function trim() {
  try {
    const path = logPath()
    const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean)
    if (lines.length > WIRE_LOG_MAX_LINES) {
      writeFileSync(path, `${lines.slice(-WIRE_LOG_MAX_LINES).join('\n')}\n`, { encoding: 'utf8', mode: LOG_MODE })
      chmodSync(path, LOG_MODE)
    }
  } catch {
    /* rotation is best-effort */
  }
}

/** Append one entry; never throws. */
export function appendWire(entry) {
  try {
    const path = logPath()
    appendFileSync(path, `${JSON.stringify({ ts: Date.now(), ...entry })}\n`, { encoding: 'utf8', mode: LOG_MODE })
    // `mode` only applies when the file is created, so a log left behind by an
    // older version (0644 in /tmp) is tightened on its next write.
    chmodSync(path, LOG_MODE)
    trim()
  } catch {
    /* diagnostics must never break a call */
  }
}

/** Newest entries, oldest first. */
export function readWire(limit = 40) {
  try {
    const lines = readFileSync(logPath(), 'utf8').split('\n').filter(Boolean)
    return lines.slice(-limit).map((line) => {
      try {
        return JSON.parse(line)
      } catch {
        return { raw: line }
      }
    })
  } catch {
    return []
  }
}

/** Coerce a token count to a finite, non-negative number. */
function tokenCount(value) {
  return Number.isFinite(value) && value > 0 ? value : 0
}

/**
 * Aggregate the `usage` entries of the wire log for the `/cache` route.
 *
 * Pure: it takes the entries `readWire` returned, so it is testable without a
 * log file or a running plugin. Only counts and model ids leave this function;
 * message content is never read or exposed. `recent` is the last 20 usage
 * entries, newest last.
 *
 * The whole-log `hitRate` mixes requests that cannot share a prefix — the first
 * request of a conversation, session-title generation, subagent sessions and
 * post-compaction requests are all cold by design — so it reads as pessimistic.
 * `steadyState` drops the first usage entry of each conversation to report the
 * rate a warm conversation actually sees, and `distribution` shows how many
 * requests fall into each per-request hit-rate bucket. `failovers` counts the
 * account switches the adapter logged and `coldAfterFailover` the cold requests
 * that immediately follow one: prompt caches are per account, so the first
 * request on the new account is a full miss by design.
 */
export function aggregateUsage(entries) {
  const all = Array.isArray(entries) ? entries : []
  const usage = all.filter((entry) => entry?.event === 'usage')
  let promptTokens = 0
  let cachedTokens = 0
  const distribution = Object.fromEntries(HIT_RATE_BUCKETS.map((bucket) => [bucket, 0]))
  for (const entry of usage) {
    const prompt = tokenCount(entry.promptTokens)
    const cached = tokenCount(entry.cachedTokens)
    promptTokens += prompt
    cachedTokens += cached
    // A zero-prompt entry has no measurable hit rate, so it is not bucketed.
    if (prompt > 0) distribution[hitRateBucket(prompt, cached)] += 1
  }

  // Steady state: every usage entry except the first one of each conversation.
  // An entry with no `conversation` marker (the request carried no
  // `prompt_cache_key`) is its own conversation, so it is excluded as well.
  const seenConversations = new Set()
  let steadyRequests = 0
  let steadyPromptTokens = 0
  let steadyCachedTokens = 0
  for (const entry of usage) {
    const conversation = typeof entry.conversation === 'string' && entry.conversation !== '' ? entry.conversation : undefined
    if (conversation === undefined) continue
    if (!seenConversations.has(conversation)) {
      seenConversations.add(conversation)
      continue
    }
    steadyRequests += 1
    steadyPromptTokens += tokenCount(entry.promptTokens)
    steadyCachedTokens += tokenCount(entry.cachedTokens)
  }

  // Failovers: the adapter logs one `failover` entry per account switch, and a
  // request that lands on a different account than the previous one with no
  // cached tokens is the expected cold start after that switch. Counting it
  // separately keeps it from reading as a cache regression.
  let failovers = 0
  let coldAfterFailover = 0
  let previousAccount
  for (const entry of all) {
    if (entry?.event === 'failover') {
      failovers += 1
      continue
    }
    if (entry?.event !== 'usage') continue
    const account = typeof entry.account === 'string' && entry.account !== '' ? entry.account : undefined
    if (account !== undefined && previousAccount !== undefined && account !== previousAccount && tokenCount(entry.cachedTokens) === 0) {
      coldAfterFailover += 1
    }
    previousAccount = account
  }

  return {
    requests: usage.length,
    promptTokens,
    cachedTokens,
    hitRate: promptTokens === 0 ? 0 : cachedTokens / promptTokens,
    steadyState: {
      requests: steadyRequests,
      promptTokens: steadyPromptTokens,
      cachedTokens: steadyCachedTokens,
      hitRate: steadyPromptTokens === 0 ? 0 : steadyCachedTokens / steadyPromptTokens,
    },
    distribution,
    failovers,
    coldAfterFailover,
    recent: usage.slice(-20).map((entry) => {
      const prompt = tokenCount(entry.promptTokens)
      const cached = tokenCount(entry.cachedTokens)
      return {
        ts: Number.isFinite(entry.ts) ? entry.ts : null,
        model: typeof entry.model === 'string' ? entry.model : null,
        promptTokens: prompt,
        cachedTokens: cached,
        hitRate: prompt === 0 ? null : cached / prompt,
      }
    }),
  }
}
