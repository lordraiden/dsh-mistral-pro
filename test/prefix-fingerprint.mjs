// Prefix-relation regression: a client-side digest of a fixed message range
// cannot tell append-only growth from a rewritten prefix (any "everything but
// the new turn" digest grows with the conversation), so the adapter compares
// each request against the previous request of the same conversation and logs
// `prefixRelation` / `prefixReused`. The comparison is bounded and in memory:
// only per-message digests are retained, never content.
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

// --- the observer distinguishes growth from a rewrite ---
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
  'the message cap still detects growth in the compared range',
  cappedAppend?.relation === 'append' && cappedAppend.reused === 2,
  JSON.stringify(cappedAppend),
)
const cappedRewrite = capped.observe('session-f', [turn3[0], user('a different second message'), ...turn3.slice(2)])
check(
  'the message cap still detects a rewrite inside the compared range',
  cappedRewrite?.relation === 'rewrite' && cappedRewrite.reused === 1,
  JSON.stringify(cappedRewrite),
)

// --- the adapter logs the relation on the request line ---
const scratch = mkdtempSync(join(tmpdir(), 'dsh-mistral-prefix-'))
const logFile = join(scratch, 'wire.log')
process.env.DSH_MISTRAL_WIRE_LOG = logFile

const MODEL = 'deepseek-v4-1-flash-1017'
const SECRET_TEXT = 'super-secret-new-turn'
const SESSION_ID = 'raw-session-id-must-not-be-logged'

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
// One adapter for the whole scenario: the observer is per adapter instance, so
// a fresh adapter per call would always report `first`.
const config = baseConfig({
  accounts: [{ name: 'only', apiKeyEnv: 'KEY_A', baseURL: server.url, enabled: true }],
  advanced: { promptCacheKey: 'auto' },
})
const adapter = makeAdapter({ config, keys: { KEY_A: 'key-a' } })

// `sessionId: null` means "omit the field"; an `undefined` argument would fall
// back to the default parameter instead.
async function runStream({ messages, sessionId = SESSION_ID, purpose, promptCacheKey = 'auto' }) {
  config.advanced.promptCacheKey = promptCacheKey
  return drain(
    adapter.stream({
      model: MODEL,
      messages,
      ...(sessionId === null ? {} : { sessionId }),
      ...(purpose === undefined ? {} : { purpose }),
    }),
  )
}

const requestEntries = () => readWire(400).filter((entry) => entry.event === 'request')

const opening = [system('you are a coding agent'), userMessage('hello')]
const appended = [...opening, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }, userMessage(SECRET_TEXT)]

const firstRun = await runStream({ messages: opening })
check('the first run completed', firstRun.error === undefined, String(firstRun.error))
check('the first request is logged as first', requestEntries().at(-1)?.prefixRelation === 'first', JSON.stringify(requestEntries().at(-1)))
check('the first request reused nothing', requestEntries().at(-1)?.prefixReused === 0, JSON.stringify(requestEntries().at(-1)))

const appendRun = await runStream({ messages: appended })
check('the append run completed', appendRun.error === undefined, String(appendRun.error))
const appendEntry = requestEntries().at(-1)
check(
  'an appended turn is logged as append and reuses the previous list',
  appendEntry?.prefixRelation === 'append' && appendEntry.prefixReused === opening.length,
  JSON.stringify(appendEntry),
)

const rewriteRun = await runStream({ messages: [system('a different system prompt'), ...appended.slice(1)] })
check('the rewrite run completed', rewriteRun.error === undefined, String(rewriteRun.error))
check(
  'a changed system prompt is logged as a rewrite',
  requestEntries().at(-1)?.prefixRelation === 'rewrite' && requestEntries().at(-1)?.prefixReused === 0,
  JSON.stringify(requestEntries().at(-1)),
)

const compacted = [
  system('a different system prompt'),
  { ...userMessage('summary of the conversation'), source: { kind: 'compact-checkpoint', compactionId: 'cmp-1' } },
]
const compactionRun = await runStream({ messages: compacted })
check('the compaction run completed', compactionRun.error === undefined, String(compactionRun.error))
check(
  'a compaction is logged as a rewrite that keeps the system message',
  requestEntries().at(-1)?.prefixRelation === 'rewrite' && requestEntries().at(-1)?.prefixReused === 1,
  JSON.stringify(requestEntries().at(-1)),
)

// An auxiliary call is not part of the conversation's message sequence: it is
// not logged with a relation, and it does not disturb the next comparison.
const auxiliary = await runStream({ messages: [userMessage('write a title')], purpose: 'session-title' })
check('the auxiliary run completed', auxiliary.error === undefined, String(auxiliary.error))
check('an auxiliary request carries no prefix relation', requestEntries().at(-1)?.prefixRelation === undefined, JSON.stringify(requestEntries().at(-1)))
const afterAuxiliary = await runStream({
  messages: [...compacted, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }, userMessage('next turn')],
})
check('the post-auxiliary run completed', afterAuxiliary.error === undefined, String(afterAuxiliary.error))
check(
  'an auxiliary call does not reset the conversation comparison',
  requestEntries().at(-1)?.prefixRelation === 'append' && requestEntries().at(-1)?.prefixReused === compacted.length,
  JSON.stringify(requestEntries().at(-1)),
)

// No session id and no prompt key: there is no identity to compare.
const keyless = await runStream({ messages: opening, sessionId: null, promptCacheKey: 'off' })
check('the keyless run completed', keyless.error === undefined, String(keyless.error))
check('a request without an identity carries no prefix relation', requestEntries().at(-1)?.prefixRelation === undefined, JSON.stringify(requestEntries().at(-1)))

// The prompt-key digest is the fallback identity when no session id is supplied.
const fallbackFirst = await runStream({ messages: opening, sessionId: null })
check('the fallback run completed', fallbackFirst.error === undefined, String(fallbackFirst.error))
check('the fallback identity starts as first', requestEntries().at(-1)?.prefixRelation === 'first', JSON.stringify(requestEntries().at(-1)))
const fallbackSecond = await runStream({ messages: appended, sessionId: null })
check('the fallback append run completed', fallbackSecond.error === undefined, String(fallbackSecond.error))
check(
  'the prompt-key digest is used when the session id is absent',
  requestEntries().at(-1)?.prefixRelation === 'append',
  JSON.stringify(requestEntries().at(-1)),
)

await server.close()

// --- privacy: no content, key or session id in the log ---
const logText = readFileSync(logFile, 'utf8')
check(
  'the log never carries message content or the session id',
  !logText.includes(SECRET_TEXT) && !logText.includes('you are a coding agent') && !logText.includes(SESSION_ID),
)
check(
  'the request line carries only counts and a relation label',
  requestEntries().every(
    (entry) =>
      entry.prefixRelation === undefined ||
      ['first', 'append', 'rewrite', 'repeat'].includes(entry.prefixRelation),
  ),
)

if (failures.length > 0) {
  console.error(`FAIL (${failures.length})`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log('PASS: prefix relation (append vs rewrite, compaction, auxiliary calls, identity fallback, bounds, privacy)')
