// Failover regression: a failure before any visible output moves to the next
// account, and a failure after a tool call surfaces instead of splicing a
// second account's output into the turn. The wire log records exactly one
// `failover` entry per switch and attributes the request to the account that
// answered, without ever logging a key. No network, no keys.
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { aggregateUsage, readWire } from '../lib/wire.js'
import { baseConfig, drain, makeAdapter, sse, startServer, textStream, userMessage } from './support/harness.mjs'

const failures = []
const check = (name, cond, detail = '') => {
  if (!cond) failures.push(detail === '' ? name : `${name} (${detail})`)
}

const MODEL = 'deepseek-v4-1-flash-1017'
const messages = [userMessage('hello')]

// The runner shares one wire log across suites, so this suite points the log at
// its own file to keep the failover assertions deterministic.
const scratch = mkdtempSync(join(tmpdir(), 'dsh-mistral-failover-'))
const logFile = join(scratch, 'wire.log')
process.env.DSH_MISTRAL_WIRE_LOG = logFile
const logText = () => readFileSync(process.env.DSH_MISTRAL_WIRE_LOG, 'utf8')
const digest = (text) => createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16)

/** A successful stream that also reports usage, so a `usage` entry is logged. */
const usageStream = (text) =>
  sse([
    { choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }] },
    { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
    {
      choices: [],
      usage: { prompt_tokens: 420, completion_tokens: 10, total_tokens: 430, prompt_tokens_details: { cached_tokens: 0 } },
    },
  ])

// --- 401 on the primary fails over to the backup ---
let primaryHits = 0
let backupHits = 0
const primary = await startServer((request, response) => {
  primaryHits += 1
  response.writeHead(401, { 'content-type': 'application/json' })
  response.end(JSON.stringify({ error: { message: 'invalid api key' } }))
})
const backup = await startServer((request, response) => {
  backupHits += 1
  response.writeHead(200, { 'content-type': 'text/event-stream' })
  response.end(usageStream('backup'))
})

const config = baseConfig({
  accounts: [
    { name: 'primary', apiKeyEnv: 'KEY_A', baseURL: primary.url, enabled: true },
    { name: 'backup', apiKeyEnv: 'KEY_B', baseURL: backup.url, enabled: true },
  ],
})
const adapter = makeAdapter({ config, keys: { KEY_A: 'key-a', KEY_B: 'key-b' } })
const failedOver = await drain(adapter.stream({ model: MODEL, messages }))

check('failover completes without an error', failedOver.error === undefined, String(failedOver.error))
const text = failedOver.events
  .filter((event) => event.type === 'text-delta')
  .map((event) => event.text)
  .join('')
check('only the backup account output is emitted', text === 'backup', JSON.stringify(text))
check('the primary account was tried first', primaryHits === 1, String(primaryHits))
check('the backup account was tried once', backupHits === 1, String(backupHits))
check('the turn finishes normally', failedOver.events.some((event) => event.type === 'finish' && event.reason.kind === 'stop'))

// The switch itself is logged once, with both accounts and the failure code.
const log = readWire(400)
const failoverEntries = log.filter((entry) => entry.event === 'failover')
check('a failover logs exactly one failover entry', failoverEntries.length === 1, String(failoverEntries.length))
check(
  'the failover entry names the accounts and the reason',
  failoverEntries[0]?.from === 'primary' && failoverEntries[0]?.to === 'backup' && failoverEntries[0]?.reason === 'AUTH',
  JSON.stringify(failoverEntries[0]),
)
const answered = log.filter((entry) => entry.event === 'usage').at(-1)
check('the usage entry names the account that answered', answered?.account === 'backup', String(answered?.account))
check(
  'no key material appears anywhere in the log',
  !logText().includes('key-a') && !logText().includes('key-b'),
)
const failedOverAggregate = aggregateUsage(log)
check(
  'the aggregate counts the failover and no cold request after it',
  failedOverAggregate.failovers === 1 && failedOverAggregate.coldAfterFailover === 0,
  JSON.stringify({ failovers: failedOverAggregate.failovers, coldAfterFailover: failedOverAggregate.coldAfterFailover }),
)
await primary.close()
await backup.close()

// --- an account without a display name is identified by a digest, never a key ---
process.env.DSH_MISTRAL_WIRE_LOG = join(scratch, 'wire-nameless.log')
const namelessPrimary = await startServer((request, response) => {
  response.writeHead(401, { 'content-type': 'application/json' })
  response.end(JSON.stringify({ error: { message: 'invalid api key' } }))
})
const namelessBackup = await startServer((request, response) => {
  response.writeHead(200, { 'content-type': 'text/event-stream' })
  response.end(usageStream('nameless'))
})
const namelessConfig = baseConfig({
  accounts: [
    { apiKeyEnv: 'KEY_A', baseURL: namelessPrimary.url, enabled: true },
    { apiKeyEnv: 'KEY_B', baseURL: namelessBackup.url, enabled: true },
  ],
})
const namelessAdapter = makeAdapter({ config: namelessConfig, keys: { KEY_A: 'key-a', KEY_B: 'key-b' } })
const nameless = await drain(namelessAdapter.stream({ model: MODEL, messages }))
check('the nameless-account failover completes', nameless.error === undefined, String(nameless.error))
const namelessLog = readWire(400)
const namelessFailover = namelessLog.find((entry) => entry.event === 'failover')
const namelessUsage = namelessLog.filter((entry) => entry.event === 'usage').at(-1)
check(
  'a nameless account is identified by a digest of its credential ref',
  namelessUsage?.account === digest('KEY_B'),
  String(namelessUsage?.account),
)
check(
  'the failover entry hashes both nameless accounts',
  namelessFailover?.from === digest('KEY_A') && namelessFailover?.to === digest('KEY_B'),
  JSON.stringify(namelessFailover),
)
check('the nameless log still carries no key material', !logText().includes('key-a') && !logText().includes('key-b'))
await namelessPrimary.close()
await namelessBackup.close()

// --- a failure after a tool call must NOT fail over ---
process.env.DSH_MISTRAL_WIRE_LOG = join(scratch, 'wire-midstream.log')
let brokenHits = 0
let fallbackHits = 0
const broken = await startServer((request, response) => {
  brokenHits += 1
  response.writeHead(200, { 'content-type': 'text/event-stream' })
  response.write(
    `data: ${JSON.stringify({
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              { id: 'call-1', type: 'function', function: { name: 'run_shell', arguments: '{"command":' }, index: 0 },
            ],
          },
          finish_reason: null,
        },
      ],
    })}\n\n`,
  )
  // Connection closes mid-generation: no [DONE], no finish_reason.
  response.end()
})
const fallback = await startServer((request, response) => {
  fallbackHits += 1
  response.writeHead(200, { 'content-type': 'text/event-stream' })
  response.end(textStream('fallback'))
})

const midStreamConfig = baseConfig({
  accounts: [
    { name: 'broken', apiKeyEnv: 'KEY_A', baseURL: broken.url, enabled: true },
    { name: 'fallback', apiKeyEnv: 'KEY_B', baseURL: fallback.url, enabled: true },
  ],
})
const midStreamAdapter = makeAdapter({ config: midStreamConfig, keys: { KEY_A: 'key-a', KEY_B: 'key-b' } })
const midStream = await drain(midStreamAdapter.stream({ model: MODEL, messages }))

check('a mid-stream failure surfaces as an error', midStream.error !== undefined)
check(
  'the truncated stream raises TRANSPORT',
  midStream.error?.code === 'TRANSPORT',
  String(midStream.error?.code ?? midStream.error),
)
check('no fallback account was tried after output', fallbackHits === 0, String(fallbackHits))
check('the broken account was tried once', brokenHits === 1, String(brokenHits))
check(
  'no fallback text was spliced into the turn',
  !midStream.events.some((event) => event.type === 'text-delta'),
)
check(
  'a failure after output logs no failover entry',
  readWire(400).every((entry) => entry.event !== 'failover'),
)
await broken.close()
await fallback.close()

if (failures.length > 0) {
  console.error(`FAIL (${failures.length})`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log('PASS: failover before output, no failover after a tool call, account attribution without keys')
