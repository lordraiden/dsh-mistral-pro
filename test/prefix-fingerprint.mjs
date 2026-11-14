// Prefix-fingerprint regression: `usage` entries carry a digest of everything
// but the new turn, so `/wire` can tell a rewritten prefix (a plugin changed the
// system prompt, a tool order changed, a compaction) from a provider-side cache
// eviction. Only the digest is logged; message content never is.
// No network, no keys.
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { prefixFingerprint, readWire } from '../lib/wire.js'
import { baseConfig, drain, makeAdapter, startServer, sse, userMessage } from './support/harness.mjs'

const failures = []
const check = (name, cond, detail = '') => {
  if (!cond) failures.push(detail === '' ? name : `${name} (${detail})`)
}
const isDigest = (value) => typeof value === 'string' && /^[0-9a-f]{16}$/.test(value)

const system = (text) => ({ role: 'system', content: text })
const user = (text) => ({ role: 'user', content: text })
const assistant = (text) => ({ role: 'assistant', content: text })

// --- the digest covers messages[0..-2], so the new turn never enters it ---
const turn = [system('you are a coding agent'), user('run the tests'), assistant('ok'), user('now fix it')]
check('prefixFingerprint is 16 hex characters', isDigest(prefixFingerprint(turn)), String(prefixFingerprint(turn)))
check(
  'a turn that only appends a message keeps the prefix digest',
  prefixFingerprint(turn) === prefixFingerprint([...turn.slice(0, -1), user('a different last message')]),
  `${prefixFingerprint(turn)} != ${prefixFingerprint([...turn.slice(0, -1), user('a different last message')])}`,
)
check(
  'the digest is deterministic',
  prefixFingerprint(turn) === prefixFingerprint(turn.map((message) => ({ ...message }))),
)
check(
  'the last message is excluded whatever its role',
  prefixFingerprint(turn) === prefixFingerprint([...turn.slice(0, -1), assistant('a different reply')]),
)

// --- a rewritten prefix changes the digest ---
check(
  'a changed system prompt changes the digest',
  prefixFingerprint(turn) !== prefixFingerprint([system('you are a different agent'), ...turn.slice(1)]),
)
check(
  'reordering two messages changes the digest',
  prefixFingerprint(turn) !== prefixFingerprint([turn[0], turn[2], turn[1], turn[3]]),
)
check(
  'a longer conversation has a longer-prefix digest',
  prefixFingerprint(turn) !== prefixFingerprint(turn.slice(0, 2)),
)

// --- a single-message conversation hashes the empty prefix ---
const single = [user('hello')]
check('a single-message conversation has a defined digest', isDigest(prefixFingerprint(single)))
check(
  'a single-message conversation hashes the empty prefix',
  prefixFingerprint(single) === prefixFingerprint([]),
  `${prefixFingerprint(single)} != ${prefixFingerprint([])}`,
)
check('prefixFingerprint tolerates a non-array', isDigest(prefixFingerprint(undefined)))

// --- the adapter logs the fields, never the content ---
const scratch = mkdtempSync(join(tmpdir(), 'dsh-mistral-prefix-'))
const logFile = join(scratch, 'wire.log')
process.env.DSH_MISTRAL_WIRE_LOG = logFile

const MODEL = 'deepseek-v4-1-flash-1017'
const SYSTEM_TEXT = 'you are a coding agent'
const SECRET_TEXT = 'super-secret-new-turn'

async function runStream(messages) {
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
  })
  const adapter = makeAdapter({ config, keys: { KEY_A: 'key-a' } })
  const result = await drain(adapter.stream({ model: MODEL, messages }))
  await server.close()
  return result
}

const first = await runStream([{ role: 'system', content: [{ type: 'text', text: SYSTEM_TEXT }] }, userMessage('hello')])
check('the first stream completed', first.error === undefined, String(first.error))
const second = await runStream([
  { role: 'system', content: [{ type: 'text', text: SYSTEM_TEXT }] },
  userMessage('hello'),
  { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
  userMessage(SECRET_TEXT),
])
check('the second stream completed', second.error === undefined, String(second.error))
const third = await runStream([
  { role: 'system', content: [{ type: 'text', text: SYSTEM_TEXT }] },
  userMessage('hello'),
  { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
  userMessage('a different new turn'),
])
check('the third stream completed', third.error === undefined, String(third.error))
const singleRun = await runStream([userMessage('hello')])
check('the single-message stream completed', singleRun.error === undefined, String(singleRun.error))

const usage = readWire(400).filter((entry) => entry.event === 'usage')
check('every request logged one usage entry', usage.length === 4, String(usage.length))
check(
  'usage entries carry the documented prefix fields',
  usage.every(
    (entry) =>
      JSON.stringify(Object.keys(entry).sort()) ===
      '["account","cachedTokens","conversation","event","messages","model","prefixMessages","prefixSha256","promptTokens","sha256","ts"]',
  ),
  JSON.stringify(usage[0]),
)
check('messages is the wire message count', usage[0]?.messages === 2 && usage[1]?.messages === 4, JSON.stringify(usage.map((entry) => entry.messages)))
check(
  'prefixMessages is the message count minus one',
  usage[0]?.prefixMessages === 1 && usage[1]?.prefixMessages === 3,
  JSON.stringify(usage.map((entry) => entry.prefixMessages)),
)
check(
  'the first turn hashes the leading system message',
  usage[0]?.prefixSha256 ===
    prefixFingerprint([
      { role: 'system', content: SYSTEM_TEXT },
      { role: 'user', content: 'any new turn' },
    ]),
  `${usage[0]?.prefixSha256}`,
)
check(
  'appending a turn keeps the prefix digest of the shared history',
  usage[1]?.prefixSha256 === usage[2]?.prefixSha256,
  `${usage[1]?.prefixSha256} != ${usage[2]?.prefixSha256}`,
)
check(
  'a growing conversation changes the digest only through its prefix',
  usage[0]?.prefixSha256 !== usage[1]?.prefixSha256,
)
check(
  'a single-message conversation has prefixMessages 0 and the empty-prefix digest',
  usage[3]?.prefixMessages === 0 && usage[3]?.prefixSha256 === prefixFingerprint([]),
  JSON.stringify(usage[3]),
)
check(
  'the log never carries message content',
  !readFileSync(logFile, 'utf8').includes(SECRET_TEXT) && !readFileSync(logFile, 'utf8').includes(SYSTEM_TEXT),
)

if (failures.length > 0) {
  console.error(`FAIL (${failures.length})`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log('PASS: prefix fingerprint (last-message exclusion, rewrite detection, empty prefix, no content)')
