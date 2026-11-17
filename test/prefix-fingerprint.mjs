// Prefix-relation regression: a client-side digest of a fixed message range
// cannot tell append-only growth from a rewritten prefix, so the adapter
// compares each request against the previous request of the same DSH session
// and logs `prefixRelation` / `prefixReused`.
//
// The comparison is bounded (512 messages, 32 sessions, digests only) and it is
// only updated for a request that actually reaches the outbound transport. The
// suite pins the conservative cap behaviour, the session-only identity and the
// attempt semantics.
// No network, no keys.
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PrefixObserver, readWire } from '../lib/wire.js'
import { baseConfig, drain, makeAdapter, startServer, sse, userMessage } from './support/harness.mjs'

const failures = []
const check = (name, cond, detail = '') => {
  if (!cond) failures.push(detail === '' ? name : `${name} (${detail})`)
}

const system = (text) => ({ role: 'system', content: [{ type: 'text', text }] })
const user = (text) => ({ role: 'user', content: [{ type: 'text', text }] })
const assistant = (text) => ({ role: 'assistant', content: [{ type: 'text', text }] })

/** `count` distinct user messages, optionally mutated at one index. */
const series = (count, mutateAt, replacement) => {
  const list = Array.from({ length: count }, (_, index) => user(`message-${index}`))
  if (mutateAt !== undefined) list[mutateAt] = user(replacement)
  return list
}

// --- the relation distinguishes growth from a rewrite ---
// Turn 1's full message sequence stays an exact leading sequence of turn 2,
// which is the case a "messages minus the last one" digest cannot express.
const turn1 = [system('you are a coding agent'), user('run the tests')]
const turn2 = [...turn1, assistant('ok'), user('now fix it')]
const turn3 = [...turn2, assistant('fixed'), user('thanks')]

const growth = new PrefixObserver()
const first = growth.observe('session-a', turn1)
check('the first observation is first', first?.relation === 'first' && first.reused === 0, JSON.stringify(first))
const second = growth.observe('session-a', turn2)
check(
  'append-only growth is append and reuses the whole previous list',
  second?.relation === 'append' && second.reused === turn1.length,
  JSON.stringify(second),
)
const third = growth.observe('session-a', turn3)
check(
  'a second append reuses the previous list, not the first',
  third?.relation === 'append' && third.reused === turn2.length,
  JSON.stringify(third),
)
const repeated = growth.observe('session-a', turn3)
check('an identical list is a repeat', repeated?.relation === 'repeat' && repeated.reused === turn3.length, JSON.stringify(repeated))

const rewritten = new PrefixObserver()
rewritten.observe('session-b', turn3)
const systemChange = rewritten.observe('session-b', [system('you are a different agent'), ...turn3.slice(1)])
check(
  'a changed system prompt is a rewrite from the first message',
  systemChange?.relation === 'rewrite' && systemChange.reused === 0,
  JSON.stringify(systemChange),
)
rewritten.observe('session-b', turn3)
const middleChange = rewritten.observe('session-b', [turn3[0], turn3[1], assistant('a different reply'), ...turn3.slice(3)])
check(
  'a rewrite in the middle keeps the common head',
  middleChange?.relation === 'rewrite' && middleChange.reused === 2,
  JSON.stringify(middleChange),
)
rewritten.observe('session-b', turn3)
const truncated = rewritten.observe('session-b', turn1)
check('a truncated history is a rewrite', truncated?.relation === 'rewrite' && truncated.reused === turn1.length, JSON.stringify(truncated))
rewritten.observe('session-b', turn3)
const compaction = rewritten.observe('session-b', [
  turn3[0],
  { ...turn3[1], source: { kind: 'compact-checkpoint', compactionId: 'cmp-1' } },
])
check(
  'a compaction checkpoint rewrites the prefix after the system message',
  compaction?.relation === 'rewrite' && compaction.reused === 1,
  JSON.stringify(compaction),
)

// --- the comparison cap never overstates what was examined ---
// Both lists exceed the cap: only the first 512 messages were compared, so an
// unexamined suffix can differ and equality must not be claimed.
const capEqual = new PrefixObserver()
capEqual.observe('cap-equal', series(600))
const capEqualResult = capEqual.observe('cap-equal', series(600, 550, 'different at 550'))
check(
  'identical heads with a different message past the cap are unknown, not repeat',
  capEqualResult?.relation === 'unknown',
  JSON.stringify(capEqualResult),
)
check('the verified common prefix is the cap', capEqualResult?.reused === 512, JSON.stringify(capEqualResult))

const capLonger = new PrefixObserver()
capLonger.observe('cap-longer', series(600))
const capLongerResult = capLonger.observe('cap-longer', series(700))
check(
  'a longer list is not a verified append past the cap',
  capLongerResult?.relation === 'unknown',
  JSON.stringify(capLongerResult),
)

const capShorter = new PrefixObserver()
capShorter.observe('cap-shorter', series(600))
const capShorterResult = capShorter.observe('cap-shorter', series(550))
check(
  'a shorter list is not a verified rewrite past the cap',
  capShorterResult?.relation === 'unknown',
  JSON.stringify(capShorterResult),
)

const capDiverged = new PrefixObserver()
capDiverged.observe('cap-diverged', series(600))
const capDivergedResult = capDiverged.observe('cap-diverged', series(600, 100, 'different at 100'))
check(
  'a divergence inside the cap is still a verified rewrite',
  capDivergedResult?.relation === 'rewrite' && capDivergedResult.reused === 100,
  JSON.stringify(capDivergedResult),
)

// A fully retained previous list is compared completely, so its append is
// verified even though the current list exceeds the cap.
const verifiedAppend = new PrefixObserver()
verifiedAppend.observe('cap-append', series(300))
const verifiedAppendResult = verifiedAppend.observe('cap-append', series(600))
check(
  'a fully retained previous list gives a verified append past the cap',
  verifiedAppendResult?.relation === 'append' && verifiedAppendResult.reused === 300,
  JSON.stringify(verifiedAppendResult),
)

// A fully retained current list against a longer previous one is a verified
// truncation, not an unverified guess.
const verifiedTruncate = new PrefixObserver()
verifiedTruncate.observe('cap-truncate', series(600))
const verifiedTruncateResult = verifiedTruncate.observe('cap-truncate', series(300))
check(
  'a fully retained current list against a longer previous list is a verified rewrite',
  verifiedTruncateResult?.relation === 'rewrite' && verifiedTruncateResult.reused === 300,
  JSON.stringify(verifiedTruncateResult),
)

// --- identity and bounds ---
const isolated = new PrefixObserver()
isolated.observe('session-c', turn1)
check('a different conversation has no previous request', isolated.observe('session-d', turn1)?.relation === 'first')
check(
  'a request without an identity is not observed',
  isolated.observe(undefined, turn1) === undefined && isolated.observe('', turn1) === undefined,
)
check('a non-array message list is not observed', isolated.observe('session-e', undefined) === undefined)

const lru = new PrefixObserver({ sessions: 2 })
lru.observe('a', turn1)
lru.observe('b', turn1)
lru.observe('a', turn2)
lru.observe('c', turn1)
check('the recently used conversation survives eviction', lru.observe('a', turn3)?.relation === 'append')
check('the least recently used conversation is evicted', lru.observe('b', turn1)?.relation === 'first')

const capped = new PrefixObserver({ messages: 2 })
capped.observe('session-f', turn1)
const cappedAppend = capped.observe('session-f', turn3)
check(
  'a small cap still verifies a fully retained previous list',
  cappedAppend?.relation === 'append' && cappedAppend.reused === 2,
  JSON.stringify(cappedAppend),
)
const cappedRewrite = capped.observe('session-f', [turn3[0], user('a different second message'), ...turn3.slice(2)])
check(
  'a small cap still detects a rewrite inside the compared range',
  cappedRewrite?.relation === 'rewrite' && cappedRewrite.reused === 1,
  JSON.stringify(cappedRewrite),
)

// --- adapter integration ---
const scratch = mkdtempSync(join(tmpdir(), 'dsh-mistral-prefix-'))
const logFile = join(scratch, 'wire.log')
process.env.DSH_MISTRAL_WIRE_LOG = logFile

const MODEL = 'deepseek-v4-1-flash-1017'
const SECRET_TEXT = 'super-secret-new-turn'
const SESSION_ID = 'raw-session-id-must-not-be-logged'

const usageBody = sse([
  { choices: [{ index: 0, delta: { role: 'assistant', content: 'ok' }, finish_reason: null }] },
  { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
  {
    choices: [],
    usage: { prompt_tokens: 420, completion_tokens: 10, total_tokens: 430, prompt_tokens_details: { cached_tokens: 384 } },
  },
])
const server = await startServer((request, response) => {
  response.writeHead(200, { 'content-type': 'text/event-stream' })
  response.end(usageBody)
})

// One adapter for the whole scenario: the observer is per adapter instance, so
// a fresh adapter per call would always report `first`.
const keys = { KEY_A: 'key-a', KEY_B: 'key-b' }
const config = baseConfig({
  accounts: [{ name: 'only', apiKeyEnv: 'KEY_A', baseURL: server.url, enabled: true }],
  advanced: { promptCacheKey: 'auto' },
})
const adapter = makeAdapter({ config, keys })

// `sessionId: null` means "omit the field"; an `undefined` argument would fall
// back to the default parameter instead.
async function run({ messages, sessionId = SESSION_ID, purpose, promptCacheKey = 'auto', signal }) {
  config.advanced.promptCacheKey = promptCacheKey
  return drain(
    adapter.stream({
      model: MODEL,
      messages,
      ...(sessionId === null ? {} : { sessionId }),
      ...(purpose === undefined ? {} : { purpose }),
      ...(signal === undefined ? {} : { signal }),
    }),
  )
}

const requestEntries = () => readWire(400).filter((entry) => entry.event === 'request')
const lastRequest = () => requestEntries().at(-1)

const opening = [system('you are a coding agent'), userMessage('hello')]
const appended = [...opening, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }, userMessage(SECRET_TEXT)]

const firstRun = await run({ messages: opening })
check('the first run completed', firstRun.error === undefined, String(firstRun.error))
check('the first request is logged as first', lastRequest()?.prefixRelation === 'first', JSON.stringify(lastRequest()))
check('the first request reused nothing', lastRequest()?.prefixReused === 0, JSON.stringify(lastRequest()))

const appendRun = await run({ messages: appended })
check('the append run completed', appendRun.error === undefined, String(appendRun.error))
check(
  'an appended turn is logged as append and reuses the previous list',
  lastRequest()?.prefixRelation === 'append' && lastRequest()?.prefixReused === opening.length,
  JSON.stringify(lastRequest()),
)

const repeatRun = await run({ messages: appended })
check('the repeat run completed', repeatRun.error === undefined, String(repeatRun.error))
check('an identical request is logged as repeat', lastRequest()?.prefixRelation === 'repeat', JSON.stringify(lastRequest()))

const rewriteRun = await run({ messages: [system('a different system prompt'), ...appended.slice(1)] })
check('the rewrite run completed', rewriteRun.error === undefined, String(rewriteRun.error))
check(
  'a changed system prompt is logged as a rewrite',
  lastRequest()?.prefixRelation === 'rewrite' && lastRequest()?.prefixReused === 0,
  JSON.stringify(lastRequest()),
)

const compacted = [
  system('a different system prompt'),
  { ...userMessage('summary of the conversation'), source: { kind: 'compact-checkpoint', compactionId: 'cmp-1' } },
]
const compactionRun = await run({ messages: compacted })
check('the compaction run completed', compactionRun.error === undefined, String(compactionRun.error))
check(
  'a compaction is logged as a rewrite that keeps the system message',
  lastRequest()?.prefixRelation === 'rewrite' && lastRequest()?.prefixReused === 1,
  JSON.stringify(lastRequest()),
)

// --- a prompt-cache key is not a conversation identity ---
// `shared` mode gives two independent sessions the same key; they must not be
// compared with each other.
config.advanced.promptCacheKey = 'shared'
await run({ messages: [system('a shared system prompt'), user('session one, turn one')], sessionId: 'shared-session-1' })
await run({ messages: [system('a shared system prompt'), user('session two, turn one')], sessionId: 'shared-session-2' })
check(
  'two independent sessions sharing a shared-mode key are not compared',
  lastRequest()?.prefixRelation === 'first',
  JSON.stringify(lastRequest()),
)
await run({
  messages: [system('a shared system prompt'), user('session one, turn one'), assistant('ok'), user('session one, turn two')],
  sessionId: 'shared-session-1',
})
check(
  'each session still appends against its own history',
  lastRequest()?.prefixRelation === 'append',
  JSON.stringify(lastRequest()),
)

// The same holds for a custom key, which is passed through unchanged.
config.advanced.promptCacheKey = 'team-shard-7'
await run({ messages: [system('custom key prompt'), user('custom one, turn one')], sessionId: 'custom-session-1' })
await run({ messages: [system('custom key prompt'), user('custom two, turn one')], sessionId: 'custom-session-2' })
check(
  'two independent sessions sharing a custom key are not compared',
  lastRequest()?.prefixRelation === 'first',
  JSON.stringify(lastRequest()),
)

// Without a session id there is no reliable identity, so no relation is logged.
await run({ messages: opening, sessionId: null })
check('a request without a session id carries no prefix relation', lastRequest()?.prefixRelation === undefined, JSON.stringify(lastRequest()))

// An auxiliary call is not part of the conversation's message sequence: it is
// not logged with a relation, and it does not disturb the next comparison.
const auxSession = 'session-auxiliary'
await run({ messages: opening, sessionId: auxSession })
const auxiliary = await run({ messages: [userMessage('write a title')], purpose: 'session-title', sessionId: auxSession })
check('the auxiliary run completed', auxiliary.error === undefined, String(auxiliary.error))
check('an auxiliary request carries no prefix relation', lastRequest()?.prefixRelation === undefined, JSON.stringify(lastRequest()))
await run({ messages: appended, sessionId: auxSession })
check(
  'an auxiliary call does not reset the conversation comparison',
  lastRequest()?.prefixRelation === 'append',
  JSON.stringify(lastRequest()),
)

// --- only an actual outbound attempt is observed ---
// A call that cannot resolve credentials never reaches the transport.
keys.KEY_A = undefined
const noCredential = await drain(adapter.stream({ model: MODEL, messages: opening, sessionId: 'session-credential' }))
check('a missing credential fails the call', noCredential.error?.code === 'MISSING_CREDENTIAL', String(noCredential.error?.code))
keys.KEY_A = 'key-a'
await run({ messages: opening, sessionId: 'session-credential' })
check(
  'a call that never resolved credentials is not observed',
  lastRequest()?.prefixRelation === 'first',
  JSON.stringify(lastRequest()),
)

// A call that is already aborted never reaches the transport either.
const aborted = new AbortController()
aborted.abort(new Error('stop before send'))
const abortedRun = await drain(adapter.stream({ model: MODEL, messages: opening, sessionId: 'session-abort', signal: aborted.signal }))
check('an already-aborted call fails', abortedRun.error !== undefined)
await run({ messages: opening, sessionId: 'session-abort' })
check(
  'an already-aborted call is not observed',
  lastRequest()?.prefixRelation === 'first',
  JSON.stringify(lastRequest()),
)

// A request that reaches the transport counts as attempted even when the
// transport itself fails: that is the documented rule.
const closed = await startServer(() => {})
const closedUrl = closed.url
await closed.close()
const transportConfig = baseConfig({
  accounts: [{ name: 'only', apiKeyEnv: 'KEY_A', baseURL: closedUrl, enabled: true }],
  advanced: { promptCacheKey: 'auto' },
})
const transportAdapter = makeAdapter({ config: transportConfig, keys: { KEY_A: 'key-a' } })
const transportFailure = await drain(transportAdapter.stream({ model: MODEL, messages: opening, sessionId: 'session-transport' }))
check('a transport failure surfaces', transportFailure.error?.code === 'TRANSPORT', String(transportFailure.error?.code))
transportConfig.accounts[0].baseURL = server.url
await drain(transportAdapter.stream({ model: MODEL, messages: appended, sessionId: 'session-transport' }))
check(
  'a request that reached the transport counts as attempted',
  lastRequest()?.prefixRelation === 'append' && lastRequest()?.prefixReused === opening.length,
  JSON.stringify(lastRequest()),
)

// A failover attempt is the same logical request: it must not add a second
// observation, and the next turn must still append against the first one.
const primary = await startServer((request, response) => {
  response.writeHead(401, { 'content-type': 'application/json' })
  response.end(JSON.stringify({ error: { message: 'invalid api key' } }))
})
const failoverConfig = baseConfig({
  accounts: [
    { name: 'primary', apiKeyEnv: 'KEY_A', baseURL: primary.url, enabled: true },
    { name: 'backup', apiKeyEnv: 'KEY_B', baseURL: server.url, enabled: true },
  ],
  advanced: { promptCacheKey: 'auto' },
})
const failoverAdapter = makeAdapter({ config: failoverConfig, keys })
const failoverRun = await drain(failoverAdapter.stream({ model: MODEL, messages: opening, sessionId: 'session-failover' }))
check('the failover run completed', failoverRun.error === undefined, String(failoverRun.error))
const attempts = requestEntries().slice(-2)
check(
  'both failover attempts log the same single observation',
  attempts.length === 2 && attempts[0]?.prefixRelation === 'first' && attempts[1]?.prefixRelation === 'first',
  JSON.stringify(attempts.map((entry) => entry.prefixRelation)),
)
await drain(failoverAdapter.stream({ model: MODEL, messages: appended, sessionId: 'session-failover' }))
check(
  'the next turn appends against the single observation',
  lastRequest()?.prefixRelation === 'append' && lastRequest()?.prefixReused === opening.length,
  JSON.stringify(lastRequest()),
)
await primary.close()
await server.close()

// --- privacy: no content, key or session id in the log ---
const logText = readFileSync(logFile, 'utf8')
check(
  'the log never carries message content or a session id',
  !logText.includes(SECRET_TEXT) &&
    !logText.includes('you are a coding agent') &&
    !logText.includes(SESSION_ID) &&
    !logText.includes('shared-session-1') &&
    !logText.includes('custom-session-1'),
)
check(
  'every logged relation is one of the documented values',
  requestEntries().every(
    (entry) =>
      entry.prefixRelation === undefined ||
      ['first', 'append', 'rewrite', 'repeat', 'unknown'].includes(entry.prefixRelation),
  ),
)

if (failures.length > 0) {
  console.error(`FAIL (${failures.length})`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log('PASS: prefix relation (cap conservatism, session identity, outbound attempts, failover, privacy)')
