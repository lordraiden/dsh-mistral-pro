// Failover regression: a failure before any visible output moves to the next
// account, and a failure after a tool call surfaces instead of splicing a
// second account's output into the turn. No network, no keys.
import { baseConfig, drain, makeAdapter, startServer, textStream, userMessage } from './support/harness.mjs'

const failures = []
const check = (name, cond, detail = '') => {
  if (!cond) failures.push(detail === '' ? name : `${name} (${detail})`)
}

const MODEL = 'deepseek-v4-1-flash-1017'
const messages = [userMessage('hello')]

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
  response.end(textStream('backup'))
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
await primary.close()
await backup.close()

// --- a failure after a tool call must NOT fail over ---
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
await broken.close()
await fallback.close()

if (failures.length > 0) {
  console.error(`FAIL (${failures.length})`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log('PASS: failover before output, no failover after a tool call')
