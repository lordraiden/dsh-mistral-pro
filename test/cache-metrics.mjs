// Cache-metrics regression: `/cache` reports a steady-state hit rate that
// ignores each conversation's cold start, a per-request distribution, and a
// per-request hit rate in `recent`. The conversation id is a truncated digest of
// the `prompt_cache_key`, so the raw key never reaches the log or the route.
// No network, no keys.
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { aggregateUsage, conversationId, HIT_RATE_BUCKETS, readWire } from '../lib/wire.js'
import { baseConfig, drain, makeAdapter, startServer, sse, userMessage } from './support/harness.mjs'

const failures = []
const check = (name, cond, detail = '') => {
  if (!cond) failures.push(detail === '' ? name : `${name} (${detail})`)
}
const sum = (distribution) => Object.values(distribution).reduce((total, count) => total + count, 0)

// --- an empty log is zeroed, not NaN ---
const empty = aggregateUsage([])
check(
  'an empty log reports zero requests and zero tokens',
  empty.requests === 0 && empty.promptTokens === 0 && empty.cachedTokens === 0 && empty.hitRate === 0,
  JSON.stringify(empty),
)
check(
  'an empty log reports a zeroed steady state',
  empty.steadyState.requests === 0 &&
    empty.steadyState.promptTokens === 0 &&
    empty.steadyState.cachedTokens === 0 &&
    empty.steadyState.hitRate === 0,
  JSON.stringify(empty.steadyState),
)
check(
  'an empty log reports an empty distribution',
  sum(empty.distribution) === 0 && HIT_RATE_BUCKETS.every((bucket) => empty.distribution[bucket] === 0),
  JSON.stringify(empty.distribution),
)
check('an empty log has an empty recent window', empty.recent.length === 0)

// --- one cold conversation plus one warm conversation ---
// Every conversation's first request is cold by design: it cannot share a
// prefix with anything. The whole-log rate is dragged down by those, the
// steady-state rate is not.
const conversations = [
  { event: 'usage', ts: 1, model: 'mistral-large-4', promptTokens: 1000, cachedTokens: 0, conversation: 'conv-a' },
  { event: 'request', ts: 2, model: 'mistral-large-4', messages: 2, sha256: 'deadbeefdeadbeef' },
  { event: 'usage', ts: 3, model: 'mistral-large-4', promptTokens: 1000, cachedTokens: 900, conversation: 'conv-a' },
  { event: 'usage', ts: 4, model: 'mistral-large-4', promptTokens: 500, cachedTokens: 0, conversation: 'conv-b' },
  { event: 'usage', ts: 5, model: 'mistral-large-4', promptTokens: 500, cachedTokens: 500, conversation: 'conv-b' },
  // No key on the request (`advanced.promptCacheKey: off`): its own conversation.
  { event: 'usage', ts: 6, model: 'mistral-large-4', promptTokens: 800, cachedTokens: 800 },
]
const aggregate = aggregateUsage(conversations)
check('requests counts only usage entries', aggregate.requests === 5, String(aggregate.requests))
check('promptTokens sums every usage entry', aggregate.promptTokens === 3800, String(aggregate.promptTokens))
check('cachedTokens sums every usage entry', aggregate.cachedTokens === 2200, String(aggregate.cachedTokens))
check(
  'the whole-log hitRate keeps its meaning',
  Math.abs(aggregate.hitRate - 2200 / 3800) < 1e-9,
  String(aggregate.hitRate),
)
check(
  'steadyState drops the first request of each conversation',
  aggregate.steadyState.requests === 2,
  String(aggregate.steadyState.requests),
)
check(
  'steadyState sums only the warm requests',
  aggregate.steadyState.promptTokens === 1500 && aggregate.steadyState.cachedTokens === 1400,
  JSON.stringify(aggregate.steadyState),
)
check(
  'steadyState.hitRate is the warm rate',
  Math.abs(aggregate.steadyState.hitRate - 1400 / 1500) < 1e-9,
  String(aggregate.steadyState.hitRate),
)
check(
  'an entry without a conversation is excluded from steadyState',
  aggregate.steadyState.requests === 2 && aggregate.steadyState.promptTokens === 1500,
  JSON.stringify(aggregate.steadyState),
)
check(
  'distribution counts every request with a non-zero prompt',
  sum(aggregate.distribution) === 5,
  JSON.stringify(aggregate.distribution),
)
check(
  'distribution buckets the cold starts and the hits',
  aggregate.distribution['0'] === 2 &&
    aggregate.distribution['76-99'] === 1 &&
    aggregate.distribution['100'] === 2 &&
    aggregate.distribution['1-25'] === 0,
  JSON.stringify(aggregate.distribution),
)
check('recent keeps the last usage entries', aggregate.recent.length === 5, String(aggregate.recent.length))
check(
  'recent carries a per-request hit rate',
  aggregate.recent[0].hitRate === 0 && aggregate.recent.at(-1).hitRate === 1,
  JSON.stringify(aggregate.recent.map((entry) => entry.hitRate)),
)

// --- bucket boundaries, in percent ---
const buckets = aggregateUsage(
  [
    [1000, 0], // 0%
    [1000, 1], // 0.1%
    [1000, 250], // 25%
    [1000, 260], // 26%
    [1000, 500], // 50%
    [1000, 510], // 51%
    [1000, 750], // 75%
    [1000, 760], // 76%
    [1000, 990], // 99%
    [1000, 1000], // 100%
  ].map(([promptTokens, cachedTokens]) => ({ event: 'usage', promptTokens, cachedTokens })),
).distribution
check(
  'bucket boundaries are inclusive as documented',
  buckets['0'] === 1 &&
    buckets['1-25'] === 2 &&
    buckets['26-50'] === 2 &&
    buckets['51-75'] === 2 &&
    buckets['76-99'] === 2 &&
    buckets['100'] === 1,
  JSON.stringify(buckets),
)

// --- a zero-prompt entry has no measurable hit rate ---
const zeroPrompt = aggregateUsage([
  { event: 'usage', ts: 1, promptTokens: 0, cachedTokens: 0, conversation: 'conv-z' },
  { event: 'usage', ts: 2, promptTokens: 0, cachedTokens: 0 },
])
check(
  'a zero-prompt entry is excluded from distribution',
  sum(zeroPrompt.distribution) === 0,
  JSON.stringify(zeroPrompt.distribution),
)
check(
  'recent.hitRate is null for a zero-prompt entry',
  zeroPrompt.recent.length === 2 && zeroPrompt.recent.every((entry) => entry.hitRate === null),
  JSON.stringify(zeroPrompt.recent),
)
check('a zero-prompt log keeps hitRate at 0, not NaN', zeroPrompt.hitRate === 0, String(zeroPrompt.hitRate))

// --- the conversation id is a stable digest of the key ---
const id = conversationId('team-shard-1')
check('conversationId is 16 hex characters', typeof id === 'string' && /^[0-9a-f]{16}$/.test(id), String(id))
check('conversationId is stable for the same key', id === conversationId('team-shard-1'), String(id))
check('conversationId differs across keys', id !== conversationId('team-shard-2'))
check('conversationId never contains the raw key', id.includes('team-shard-1') === false, id)
check(
  'conversationId is undefined without a key',
  conversationId(undefined) === undefined && conversationId('') === undefined && conversationId(42) === undefined,
)

// --- the adapter logs the digest, never the raw key or the content ---
const scratch = mkdtempSync(join(tmpdir(), 'dsh-mistral-cache-metrics-'))
const logFile = join(scratch, 'wire.log')
process.env.DSH_MISTRAL_WIRE_LOG = logFile

const CUSTOM_KEY = 'my-team-shard-7'
const SECRET_TEXT = 'super-secret-prompt-text'
const MODEL = 'deepseek-v4-1-flash-1017'

async function runStream(promptCacheKey) {
  const body = sse([
    { choices: [{ index: 0, delta: { role: 'assistant', content: 'ok' }, finish_reason: null }] },
    { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
    {
      choices: [],
      usage: { prompt_tokens: 420, completion_tokens: 10, total_tokens: 430, prompt_tokens_details: { cached_tokens: 384 } },
    },
  ])
  const server = await startServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.end(body)
  })
  const config = baseConfig({
    accounts: [{ name: 'only', apiKeyEnv: 'KEY_A', baseURL: server.url, enabled: true }],
    advanced: { promptCacheKey },
  })
  const adapter = makeAdapter({ config, keys: { KEY_A: 'key-a' } })
  const result = await drain(adapter.stream({ model: MODEL, messages: [userMessage(SECRET_TEXT)] }))
  await server.close()
  return result
}

const custom = await runStream(CUSTOM_KEY)
check('the custom-key stream completed', custom.error === undefined, String(custom.error))
const customUsage = readWire(400).filter((entry) => entry.event === 'usage').at(-1)
check('the usage entry carries the conversation digest', customUsage?.conversation === conversationId(CUSTOM_KEY), String(customUsage?.conversation))
check('the usage entry carries no raw key', customUsage?.prompt_cache_key === undefined)
check(
  'the whole log carries no raw key and no content',
  !readFileSync(logFile, 'utf8').includes(CUSTOM_KEY) && !readFileSync(logFile, 'utf8').includes(SECRET_TEXT),
)

const off = await runStream('off')
check('the keyless stream completed', off.error === undefined, String(off.error))
const offUsage = readWire(400).filter((entry) => entry.event === 'usage').at(-1)
check('a keyless request omits the conversation field', offUsage?.conversation === undefined, JSON.stringify(offUsage))
check(
  'the route response never carries the raw key',
  !JSON.stringify(aggregateUsage(readWire(400))).includes(CUSTOM_KEY),
)

if (failures.length > 0) {
  console.error(`FAIL (${failures.length})`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log('PASS: /cache steady state, distribution, per-request hit rate, and conversation digests')
