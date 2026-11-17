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

/**
 * Digest of the `x-affinity` value that actually left the process.
 *
 * The header is undocumented, so the only trustworthy record is the value the
 * adapter put on the request, never the setting that was expected to produce
 * it. The digest deliberately uses the same function as `conversationId`: while
 * the adapter sends the prompt-cache key as the affinity, the two digests are
 * equal, and that equality is the observable signal that affinity follows the
 * prompt key. It disappears as soon as the two identities diverge. Only the
 * digest is logged; the header value never is.
 */
export function affinityId(value) {
  return conversationId(value)
}

/** Per-request hit-rate buckets, in percent, reported by `/cache`. */
export const HIT_RATE_BUCKETS = ['0', '1-25', '26-50', '51-75', '76-99', '100']

/** Conversations the prefix observer remembers at once. */
export const PREFIX_SESSION_LIMIT = 32
/** Messages of one conversation the prefix observer compares. */
export const PREFIX_MESSAGE_LIMIT = 512

/**
 * Compare each request's message list with the previous request of the same
 * conversation, and report whether the prefix grew or was rewritten.
 *
 * A stateless digest cannot answer that question: any digest over "everything
 * except the new turn" grows with the conversation, and any digest over a fixed
 * leading range can only see a rewrite inside that range. The only accurate
 * comparison is against the previous request itself, so this observer keeps a
 * bounded, in-memory digest of each conversation's last message list. Nothing
 * is written to disk and no message content is retained: only one SHA-256
 * digest per message, capped at `messages` per session and at `sessions`
 * sessions (least recently used evicted first).
 *
 * The comparison is also capped, so a result is never stronger than what was
 * actually examined:
 *
 * - `first` — no earlier request of this session was observed.
 * - `append` — the whole previous list matched the head of a longer current
 *   list. Verified even when the current list exceeds the cap, because every
 *   previous message was retained and compared.
 * - `repeat` — both lists were fully retained and are identical.
 * - `rewrite` — a divergence was found inside the compared range, or the whole
 *   current list matched the head of a longer previous list (a truncation).
 * - `unknown` — the compared range matched, but at least one list extends
 *   beyond the cap, so the unexamined suffixes could still differ. This is the
 *   conservative result: equality is never assumed for messages that were not
 *   compared.
 *
 * The result is a request-structure diagnostic over the wire `messages` list
 * only. It says nothing about `tools`, `tool_choice` or any other request
 * field, and nothing about the provider's tokenized prefix, cache placement or
 * routing.
 */
export class PrefixObserver {
  constructor({ sessions = PREFIX_SESSION_LIMIT, messages = PREFIX_MESSAGE_LIMIT } = {}) {
    this.sessions = sessions
    this.messages = messages
    this.state = new Map()
  }

  /**
   * Observe one request.
   * @param key - conversation identity (a DSH session id), never logged.
   * @param messages - the wire messages that will be sent.
   * @returns `{ relation, reused }`, or undefined when there is no identity.
   */
  observe(key, messages) {
    if (typeof key !== 'string' || key === '' || !Array.isArray(messages)) return undefined
    const cap = this.messages
    const digests = messages
      .slice(0, cap)
      .map((message) => fingerprint(JSON.stringify(message)))
    const previous = this.state.get(key)
    let relation = 'first'
    let reused = 0
    if (previous !== undefined) {
      const limit = Math.min(previous.digests.length, digests.length)
      while (reused < limit && previous.digests[reused] === digests[reused]) reused += 1
      if (reused < limit) {
        // A divergence inside the compared range is a fact whatever lies beyond it.
        relation = 'rewrite'
      } else if (previous.count <= cap && messages.length <= cap) {
        // Both lists were fully retained and compared.
        if (previous.count === messages.length) relation = 'repeat'
        else if (previous.count < messages.length) relation = 'append'
        else relation = 'rewrite'
      } else if (previous.count <= cap) {
        // Every previous message was retained and matched the head of a longer
        // current list, so the append is verified even past the cap.
        relation = 'append'
      } else if (messages.length <= cap) {
        // The whole current list matched the head of a longer previous list.
        relation = 'rewrite'
      } else {
        // Both lists extend beyond the cap: the unexamined suffixes are unknown,
        // so neither equality nor a verified append is claimed.
        relation = 'unknown'
      }
    }
    // Re-insert so the map stays least-recently-used first, then evict.
    this.state.delete(key)
    this.state.set(key, { count: messages.length, digests })
    while (this.state.size > this.sessions) {
      const oldest = this.state.keys().next().value
      this.state.delete(oldest)
    }
    return { relation, reused }
  }
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

/** A non-empty string label, or undefined when the entry carries none. */
function label(value) {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** Requests, prompt tokens, cached tokens and the token-weighted hit rate. */
function groupTotals(entries) {
  let promptTokens = 0
  let cachedTokens = 0
  for (const entry of entries) {
    promptTokens += tokenCount(entry.promptTokens)
    cachedTokens += tokenCount(entry.cachedTokens)
  }
  return {
    requests: entries.length,
    promptTokens,
    cachedTokens,
    hitRate: promptTokens === 0 ? 0 : cachedTokens / promptTokens,
  }
}

/**
 * Per-group totals for one label field, busiest group first.
 *
 * The label is a display account name, a public model id or a truncated digest;
 * the group object is keyed by the same field name so a consumer can read
 * `entry.account` / `entry.model` / `entry.affinity` without knowing which
 * breakdown produced it. Unlabelled entries form a `null` group and sort last.
 */
function breakdown(usage, field) {
  const groups = new Map()
  for (const entry of usage) {
    const key = label(entry[field])
    const list = groups.get(key)
    if (list === undefined) groups.set(key, [entry])
    else list.push(entry)
  }
  return [...groups.entries()]
    .map(([key, entries]) => ({ [field]: key ?? null, ...groupTotals(entries) }))
    .sort((left, right) => {
      if (right.requests !== left.requests) return right.requests - left.requests
      if (left[field] === null) return right[field] === null ? 0 : 1
      if (right[field] === null) return -1
      return left[field] < right[field] ? -1 : left[field] > right[field] ? 1 : 0
    })
}

/**
 * The same numbers with the first request of each group removed.
 *
 * `keyOf` returns the group a request belongs to, or undefined when the request
 * carries no identity at all (it then cannot be warm and is skipped entirely).
 */
function steadyState(usage, keyOf) {
  const seen = new Set()
  const warm = []
  for (const entry of usage) {
    const key = keyOf(entry)
    if (key === undefined) continue
    if (!seen.has(key)) {
      seen.add(key)
      continue
    }
    warm.push(entry)
  }
  return groupTotals(warm)
}

/**
 * Route identity of one request: serving account, model, effective affinity and
 * prompt-key generation.
 *
 * A request can only hit when all of them already exist on the serving side:
 * the account owns the cache namespace, the model owns its own cache, the
 * affinity decides the routing, and the prompt key (rotated by compaction)
 * decides the prefix family. The model is part of the identity because a custom
 * `prompt_cache_key` is passed through unchanged and does not carry it, so two
 * models can otherwise share account, affinity and key digest.
 *
 * The tuple is JSON-encoded rather than delimiter-joined: account names and
 * model ids are arbitrary strings, and a value containing the delimiter would
 * otherwise be able to collide with a different split of the same characters.
 * A request with neither an affinity nor a prompt key has no identity to be
 * warm against.
 */
function routeKey(entry) {
  const affinity = label(entry.affinity)
  const conversation = label(entry.conversation)
  if (affinity === undefined && conversation === undefined) return undefined
  return JSON.stringify([label(entry.account) ?? null, label(entry.model) ?? null, affinity ?? null, conversation ?? null])
}

/**
 * Aggregate the `usage` entries of the wire log for the `/cache` route.
 *
 * Pure: it takes the entries `readWire` returned, so it is testable without a
 * log file or a running plugin. Only counts, model ids, account labels and
 * truncated digests leave this function; message content is never read or
 * exposed. `recent` is the last 20 usage entries, newest last.
 *
 * The whole-log `hitRate` mixes requests that cannot share a prefix — the first
 * request of a cache-key family, session-title generation, subagent sessions and
 * post-compaction requests are all cold by design — so it reads as pessimistic.
 * `steadyState` drops the first observed usage entry of each prompt-cache-key
 * digest in the retained window, and `distribution` shows how many requests fall
 * into each per-request hit-rate bucket. `failovers` counts the
 * account switches the adapter logged and `coldAfterFailover` the cold requests
 * that immediately follow one: prompt caches are per account, so the first
 * request on the new account is a full miss by design.
 *
 * `steadyState` keeps its original meaning: one group per prompt-cache key
 * digest, which is the prefix family a hit needs. That group is a cache-key
 * family, not necessarily one conversation (`shared` and custom keys can span
 * independent conversations), and the entry it drops is the first one observed
 * in the retained window rather than a proven cold start. It cannot see the
 * other things a hit needs, so `steadyStateByRoute` reports the same rate with
 * the first request of each (account, model, affinity, prompt-key) route removed,
 * and `byAccount` / `byModel` / `byAffinity` break the pooled numbers down by
 * the dimensions a miss can come from. `recent` carries the same labels per
 * request, so a single miss can be attributed without reading `/wire`.
 *
 * Every figure is relative to the retained log window (`window`), not to the
 * process lifetime: the log is trimmed to `WIRE_LOG_MAX_LINES`, so the request
 * a steady-state view drops is the first one still visible in the window, and it
 * may well have been warm. It is a first *observation*, not proof of a cold start.
 *
 * Only completed responses whose supplier reported usage are logged, so an
 * interrupted stream is absent from every figure here rather than counted as a
 * zero-cache request.
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
    // The aggregate covers the retained log window, not the whole process
    // history: the log is trimmed to `maxLines`, so every figure below is a
    // calculation over the entries that survived rotation.
    window: { maxLines: WIRE_LOG_MAX_LINES, entries: all.length },
    requests: usage.length,
    promptTokens,
    cachedTokens,
    hitRate: promptTokens === 0 ? 0 : cachedTokens / promptTokens,
    steadyState: steadyState(usage, (entry) => label(entry.conversation)),
    steadyStateByRoute: steadyState(usage, routeKey),
    distribution,
    byAccount: breakdown(usage, 'account'),
    byModel: breakdown(usage, 'model'),
    byAffinity: breakdown(usage, 'affinity'),
    failovers,
    coldAfterFailover,
    recent: usage.slice(-20).map((entry) => {
      const prompt = tokenCount(entry.promptTokens)
      const cached = tokenCount(entry.cachedTokens)
      return {
        ts: Number.isFinite(entry.ts) ? entry.ts : null,
        model: label(entry.model) ?? null,
        account: label(entry.account) ?? null,
        affinity: label(entry.affinity) ?? null,
        conversation: label(entry.conversation) ?? null,
        promptTokens: prompt,
        cachedTokens: cached,
        hitRate: prompt === 0 ? null : cached / prompt,
      }
    }),
  }
}
