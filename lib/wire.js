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
 */
export function aggregateUsage(entries) {
  const usage = (Array.isArray(entries) ? entries : []).filter((entry) => entry?.event === 'usage')
  let promptTokens = 0
  let cachedTokens = 0
  for (const entry of usage) {
    promptTokens += tokenCount(entry.promptTokens)
    cachedTokens += tokenCount(entry.cachedTokens)
  }
  return {
    requests: usage.length,
    promptTokens,
    cachedTokens,
    hitRate: promptTokens === 0 ? 0 : cachedTokens / promptTokens,
    recent: usage.slice(-20).map((entry) => ({
      ts: Number.isFinite(entry.ts) ? entry.ts : null,
      model: typeof entry.model === 'string' ? entry.model : null,
      promptTokens: tokenCount(entry.promptTokens),
      cachedTokens: tokenCount(entry.cachedTokens),
    })),
  }
}
