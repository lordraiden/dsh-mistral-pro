// Cache-diagnostics regression: the wire log records the affinity value that
// actually left the process (as a digest), and `/cache` breaks the hit rate down
// by serving account, model and effective routing identity without changing the
// meaning of the existing fields.
//
// The suite also pins the "missing usage is not a miss" rule: only a completed
// response whose supplier reported usage produces a `usage` entry, so an
// interrupted stream can never be counted as a zero-cache request.
// No network, no keys.
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { affinityId, aggregateUsage, conversationId, readWire } from '../lib/wire.js'
import { baseConfig, drain, makeAdapter, startServer, sse, textStream, userMessage } from './support/harness.mjs'

const failures = []
const check = (name, cond, detail = '') => {
  if (!cond) failures.push(detail === '' ? name : `${name} (${detail})`)
}
const isDigest = (value) => typeof value === 'string' && /^[0-9a-f]{16}$/.test(value)
const isKey = (value) => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)

const scratch = mkdtempSync(join(tmpdir(), 'dsh-mistral-cache-diag-'))
let logSeq = 0
/** Point the wire log at a fresh file for one scenario. */
function freshLog() {
  logSeq += 1
  const path = join(scratch, `wire-${logSeq}.log`)
  process.env.DSH_MISTRAL_WIRE_LOG = path
  return path
}
const usageEntries = () => readWire(400).filter((entry) => entry.event === 'usage')
const requestEntries = () => readWire(400).filter((entry) => entry.event === 'request')

// --- the affinity digest is a privacy-safe identity ---
const digest = affinityId('team-shard-1')
check('affinityId is 16 hex characters', isDigest(digest), String(digest))
check('affinityId is stable for the same value', digest === affinityId('team-shard-1'))
check('affinityId differs across values', digest !== affinityId('team-shard-2'))
check('affinityId never contains the raw value', digest.includes('team-shard-1') === false, digest)
check('affinityId has no value without a header', affinityId(undefined) === undefined && affinityId('') === undefined)
check(
  'affinityId equals conversationId for the same value, so equality stays observable',
  digest === conversationId('team-shard-1'),
  `${digest} != ${conversationId('team-shard-1')}`,
)

// --- the adapter logs the affinity it actually sent ---
const MODEL = 'deepseek-v4-1-flash-1017'
const SECRET_TEXT = 'super-secret-prompt-text'
const SESSION_ID = 'raw-session-id-must-not-be-logged'
const usageStream = () =>
  sse([
    { choices: [{ index: 0, delta: { role: 'assistant', content: 'ok' }, finish_reason: null }] },
    { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
    {
      choices: [],
      usage: { prompt_tokens: 420, completion_tokens: 10, total_tokens: 430, prompt_tokens_details: { cached_tokens: 384 } },
    },
  ])

/**
 * Run one stream against a local server and return the request it received.
 * `respond` decides the SSE body, so one helper covers success, keyless and
 * interrupted scenarios.
 */
async function runStream({ cache = {}, advanced = {}, respond = usageStream, messages = [userMessage(SECRET_TEXT)] }) {
  let received
  const server = await startServer((request, response) => {
    const chunks = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => {
      received = { headers: request.headers, body: Buffer.concat(chunks).toString('utf8') }
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.end(respond(request, response))
    })
  })
  const config = baseConfig({
    accounts: [{ name: 'Vibe', apiKeyEnv: 'KEY_A', baseURL: server.url, enabled: true }],
    cache,
    advanced,
  })
  const adapter = makeAdapter({ config, keys: { KEY_A: 'key-a' } })
  const result = await drain(adapter.stream({ model: MODEL, messages, sessionId: SESSION_ID }))
  await server.close()
  return { received, result }
}

// Affinity on: the digest must describe the header the server actually saw.
const affinityLog = freshLog()
const affinityOn = await runStream({ cache: { affinity: true } })
check('the affinity stream completed', affinityOn.result.error === undefined, String(affinityOn.result.error))
const sentAffinity = affinityOn.received?.headers['x-affinity']
const sentKey = affinityOn.received === undefined ? undefined : JSON.parse(affinityOn.received.body).prompt_cache_key
check('x-affinity is a 64-char derived key', isKey(sentAffinity), String(sentAffinity))
check('the request entry digests the header the server received', requestEntries().at(-1)?.affinity === affinityId(sentAffinity), JSON.stringify(requestEntries().at(-1)))
check('the usage entry digests the header the server received', usageEntries().at(-1)?.affinity === affinityId(sentAffinity), JSON.stringify(usageEntries().at(-1)))
check(
  'the affinity digest equals the conversation digest while affinity follows the prompt key',
  usageEntries().at(-1)?.affinity === usageEntries().at(-1)?.conversation,
  JSON.stringify(usageEntries().at(-1)),
)
check(
  'the conversation digest still describes the prompt_cache_key',
  usageEntries().at(-1)?.conversation === conversationId(sentKey),
  String(usageEntries().at(-1)?.conversation),
)
const affinityText = readFileSync(affinityLog, 'utf8')
check(
  'the log never carries the raw affinity, the raw key, the session id or the prompt',
  !affinityText.includes(sentAffinity) &&
    !affinityText.includes(sentKey) &&
    !affinityText.includes(SESSION_ID) &&
    !affinityText.includes(SECRET_TEXT),
)

// Affinity off: no header, and no affinity field anywhere in the log.
freshLog()
const affinityOff = await runStream({ cache: { affinity: false } })
check('the no-affinity stream completed', affinityOff.result.error === undefined, String(affinityOff.result.error))
check('no x-affinity header is sent when the setting is off', affinityOff.received?.headers['x-affinity'] === undefined)
check(
  'no affinity field is logged when the header was not sent',
  requestEntries().every((entry) => entry.affinity === undefined) && usageEntries().every((entry) => entry.affinity === undefined),
  JSON.stringify(requestEntries().at(-1)),
)

// Keyless: no prompt_cache_key means no affinity either, and no conversation.
freshLog()
const keyless = await runStream({ cache: { affinity: true }, advanced: { promptCacheKey: 'off' } })
check('the keyless stream completed', keyless.result.error === undefined, String(keyless.result.error))
check('a keyless request sends no prompt_cache_key', JSON.parse(keyless.received.body).prompt_cache_key === undefined)
check('a keyless request sends no x-affinity', keyless.received.headers['x-affinity'] === undefined)
check(
  'a keyless request logs neither a conversation nor an affinity',
  usageEntries().at(-1)?.conversation === undefined && usageEntries().at(-1)?.affinity === undefined,
  JSON.stringify(usageEntries().at(-1)),
)

// Two conversations that share a prefix share the affinity digest; a different
// prefix gets a different one. The provider still verifies prefix compatibility,
// so a shared identity can only miss.
freshLog()
const systemMessage = (text) => ({ role: 'system', content: [{ type: 'text', text }] })
const sharedPrefix = [systemMessage('you are a coding agent'), userMessage('same opener')]
await runStream({ cache: { affinity: true }, messages: sharedPrefix })
await runStream({ cache: { affinity: true }, messages: sharedPrefix })
await runStream({ cache: { affinity: true }, messages: [systemMessage('you are a coding agent'), userMessage('different opener')] })
const [firstPrefix, secondPrefix, otherPrefix] = usageEntries()
check('the same prefix keeps the same affinity digest', firstPrefix?.affinity === secondPrefix?.affinity, JSON.stringify([firstPrefix?.affinity, secondPrefix?.affinity]))
check('a different prefix gets a different affinity digest', firstPrefix?.affinity !== otherPrefix?.affinity)

// --- missing usage is never recorded as a zero-cache response ---
freshLog()
const noUsage = await runStream({ cache: { affinity: true }, respond: () => textStream('ok') })
check('a stream without a usage chunk completes', noUsage.result.error === undefined, String(noUsage.result.error))
check('a completed stream without usage logs no usage entry', usageEntries().length === 0, String(usageEntries().length))
check('the request is still recorded, so the absence is visible', requestEntries().length === 1)
check('the route reports no requests rather than a 0% hit rate', aggregateUsage(readWire(400)).requests === 0)

freshLog()
const interrupted = await runStream({
  cache: { affinity: true },
  // Usage arrives, then the connection closes before [DONE]/finish_reason.
  respond: () =>
    `data: ${JSON.stringify({
      choices: [],
      usage: { prompt_tokens: 420, completion_tokens: 10, total_tokens: 430, prompt_tokens_details: { cached_tokens: 384 } },
    })}\n\n`,
})
check('an interrupted stream raises TRANSPORT', interrupted.result.error?.code === 'TRANSPORT', String(interrupted.result.error?.code))
check('an interrupted stream logs no usage entry', usageEntries().length === 0, String(usageEntries().length))
check(
  'an interrupted stream is not counted as a zero-cache request',
  aggregateUsage(readWire(400)).requests === 0 && aggregateUsage(readWire(400)).hitRate === 0,
)

freshLog()
const emptyUsage = await runStream({
  cache: { affinity: true },
  respond: () =>
    sse([
      { choices: [{ index: 0, delta: { role: 'assistant', content: 'ok' }, finish_reason: null }] },
      { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
      { choices: [], usage: {} },
    ]),
})
check('an empty usage object completes', emptyUsage.result.error === undefined, String(emptyUsage.result.error))
check('an empty usage object is not a zero-token response', usageEntries().length === 0, String(usageEntries().length))

// --- the breakdowns attribute a miss to account, model and routing identity ---
const entry = (over) => ({ event: 'usage', ts: 1, model: 'mistral-large-4', account: 'Vibe', promptTokens: 1000, cachedTokens: 900, ...over })
const breakdown = aggregateUsage([
  entry({ ts: 1, cachedTokens: 900 }),
  entry({ ts: 2, cachedTokens: 800 }),
  entry({ ts: 3, account: 'Studio', cachedTokens: 0 }),
  entry({ ts: 4, model: 'mistral-small-4', cachedTokens: 500 }),
])
check(
  'byAccount groups by serving account, busiest first',
  JSON.stringify(breakdown.byAccount) ===
    JSON.stringify([
      { account: 'Vibe', requests: 3, promptTokens: 3000, cachedTokens: 2200, hitRate: 2200 / 3000 },
      { account: 'Studio', requests: 1, promptTokens: 1000, cachedTokens: 0, hitRate: 0 },
    ]),
  JSON.stringify(breakdown.byAccount),
)
check(
  'byModel groups by model id, busiest first',
  JSON.stringify(breakdown.byModel) ===
    JSON.stringify([
      { model: 'mistral-large-4', requests: 3, promptTokens: 3000, cachedTokens: 1700, hitRate: 1700 / 3000 },
      { model: 'mistral-small-4', requests: 1, promptTokens: 1000, cachedTokens: 500, hitRate: 0.5 },
    ]),
  JSON.stringify(breakdown.byModel),
)
check(
  'an account-specific miss is visible instead of being pooled away',
  breakdown.byAccount[0].hitRate > breakdown.hitRate && breakdown.byAccount[1].hitRate === 0,
  JSON.stringify({ pooled: breakdown.hitRate, accounts: breakdown.byAccount }),
)

const affinityBreakdown = aggregateUsage([
  entry({ affinity: 'aaaa000000000001', cachedTokens: 900 }),
  entry({ affinity: 'aaaa000000000001', cachedTokens: 0 }),
  entry({ affinity: 'bbbb000000000002', cachedTokens: 500 }),
  entry({ affinity: undefined, cachedTokens: 1000 }),
])
check(
  'byAffinity groups by routing identity and keeps an unlabelled bucket last',
  JSON.stringify(affinityBreakdown.byAffinity) ===
    JSON.stringify([
      { affinity: 'aaaa000000000001', requests: 2, promptTokens: 2000, cachedTokens: 900, hitRate: 0.45 },
      { affinity: 'bbbb000000000002', requests: 1, promptTokens: 1000, cachedTokens: 500, hitRate: 0.5 },
      { affinity: null, requests: 1, promptTokens: 1000, cachedTokens: 1000, hitRate: 1 },
    ]),
  JSON.stringify(affinityBreakdown.byAffinity),
)

// --- steadyState keeps its meaning; steadyStateByRoute removes route cold starts ---
// One conversation (c1) survives an account failover, then compacts into c2.
const routeLog = [
  entry({ ts: 1, account: 'Vibe', affinity: 'a1', conversation: 'c1', cachedTokens: 0 }),
  entry({ ts: 2, account: 'Vibe', affinity: 'a1', conversation: 'c1', cachedTokens: 900 }),
  entry({ ts: 3, account: 'Studio', affinity: 'a1', conversation: 'c1', cachedTokens: 0 }),
  entry({ ts: 4, account: 'Studio', affinity: 'a1', conversation: 'c1', cachedTokens: 950 }),
  entry({ ts: 5, account: 'Vibe', affinity: 'a1', conversation: 'c2', cachedTokens: 0 }),
  entry({ ts: 6, account: 'Vibe', affinity: 'a1', conversation: 'c2', cachedTokens: 800 }),
  entry({ ts: 7, account: undefined, affinity: undefined, conversation: undefined, cachedTokens: 0 }),
]
const routeAggregate = aggregateUsage(routeLog)
check(
  'steadyState still drops only the first request of each prompt-key family',
  routeAggregate.steadyState.requests === 4 &&
    routeAggregate.steadyState.promptTokens === 4000 &&
    routeAggregate.steadyState.cachedTokens === 2650,
  JSON.stringify(routeAggregate.steadyState),
)
check(
  'steadyStateByRoute also drops the cold request on the new account and after compaction',
  routeAggregate.steadyStateByRoute.requests === 3 &&
    routeAggregate.steadyStateByRoute.promptTokens === 3000 &&
    routeAggregate.steadyStateByRoute.cachedTokens === 2650,
  JSON.stringify(routeAggregate.steadyStateByRoute),
)
check(
  'the route-aware rate is higher than the prompt-key-only rate, which counts the failover miss',
  routeAggregate.steadyStateByRoute.hitRate > routeAggregate.steadyState.hitRate,
  JSON.stringify({ route: routeAggregate.steadyStateByRoute.hitRate, conversation: routeAggregate.steadyState.hitRate }),
)
// Both account changes in this log are cold (the failover and the return after
// the compaction), and the counter keeps reporting them as such.
check('cold requests after an account change are still attributed separately', routeAggregate.coldAfterFailover === 2, String(routeAggregate.coldAfterFailover))
check(
  'a request with no routing identity is excluded from both steady-state views',
  routeAggregate.steadyState.requests === 4 && routeAggregate.steadyStateByRoute.requests === 3,
  JSON.stringify({ steady: routeAggregate.steadyState.requests, route: routeAggregate.steadyStateByRoute.requests }),
)

// A stable affinity with a rotating prompt key (a compaction) is a new route,
// but the same affinity keeps the routing identity visible in the breakdown.
const rotation = aggregateUsage([
  entry({ affinity: 'a1', conversation: 'c1', cachedTokens: 900 }),
  entry({ affinity: 'a1', conversation: 'c2', cachedTokens: 0 }),
  entry({ affinity: 'a1', conversation: 'c2', cachedTokens: 850 }),
])
check(
  'a compaction keeps one affinity group but starts a new route',
  rotation.byAffinity.length === 1 && rotation.byAffinity[0].requests === 3,
  JSON.stringify(rotation.byAffinity),
)
check(
  'the first request after a rotation is not counted as a warm miss',
  rotation.steadyStateByRoute.requests === 1 && rotation.steadyStateByRoute.cachedTokens === 850,
  JSON.stringify(rotation.steadyStateByRoute),
)

// --- recent entries carry the labels needed to attribute one miss ---
const recent = aggregateUsage([
  entry({ ts: 10, account: 'Vibe', affinity: 'a1', conversation: 'c1', model: 'mistral-large-4', cachedTokens: 0 }),
]).recent[0]
check(
  'recent carries account, affinity and conversation beside the existing fields',
  recent.account === 'Vibe' &&
    recent.affinity === 'a1' &&
    recent.conversation === 'c1' &&
    recent.model === 'mistral-large-4' &&
    recent.promptTokens === 1000 &&
    recent.cachedTokens === 0 &&
    recent.hitRate === 0 &&
    recent.ts === 10,
  JSON.stringify(recent),
)
check(
  'recent reports null, not undefined, for a missing label',
  aggregateUsage([entry({ ts: 11, account: undefined, affinity: undefined, conversation: undefined })]).recent[0].account === null,
)

// --- the route response stays free of raw values ---
const routeJson = JSON.stringify(aggregateUsage(readWire(400)))
check('the route response never carries a raw key or affinity', !routeJson.includes(sentAffinity ?? '\u0000') && !routeJson.includes(SECRET_TEXT))

if (failures.length > 0) {
  console.error(`FAIL (${failures.length})`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log('PASS: cache diagnostics (affinity digest of the sent header, account/model/affinity breakdowns, route steady state, missing usage)')
