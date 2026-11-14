// Stream-end regression: a stream that closes without [DONE] and without a
// finish_reason is a truncated generation and must raise TRANSPORT, not end the
// turn cleanly with partial output. No network, no keys.
import { baseConfig, drain, makeAdapter, startServer, sse, userMessage } from './support/harness.mjs'

const failures = []
const check = (name, cond, detail = '') => {
  if (!cond) failures.push(detail === '' ? name : `${name} (${detail})`)
}

const MODEL = 'deepseek-v4-1-flash-1017'
const messages = [userMessage('hello')]

async function runAgainst(body) {
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

// --- truncated: text, then the socket closes with no terminal marker ---
const truncated = await runAgainst(
  `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: 'partial' }, finish_reason: null }] })}\n\n`,
)
check('a truncated stream raises an error', truncated.error !== undefined)
check(
  'the truncated stream raises TRANSPORT',
  truncated.error?.code === 'TRANSPORT',
  String(truncated.error?.code ?? truncated.error),
)
check(
  'the partial text was already emitted before the failure',
  truncated.events.some((event) => event.type === 'text-delta' && event.text === 'partial'),
)

// --- a finish_reason without [DONE] is a complete stream ---
const finishOnly = await runAgainst(
  sse(
    [
      { choices: [{ index: 0, delta: { content: 'done' }, finish_reason: null }] },
      { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
    ],
    { done: false },
  ),
)
check('a finish_reason alone is accepted', finishOnly.error === undefined, String(finishOnly.error))
check('the finish event is emitted', finishOnly.events.some((event) => event.type === 'finish' && event.reason.kind === 'stop'))

// --- [DONE] without a finish_reason is also a complete stream ---
const doneOnly = await runAgainst(
  sse([{ choices: [{ index: 0, delta: { content: 'done' }, finish_reason: null }] }], { done: true }),
)
check('[DONE] alone is accepted', doneOnly.error === undefined, String(doneOnly.error))

// --- a stream that produced no content at all is EMPTY_RESPONSE ---
const empty = await runAgainst('data: [DONE]\n\n')
check('an empty response raises an error', empty.error !== undefined)
check('an empty response raises EMPTY_RESPONSE', empty.error?.code === 'EMPTY_RESPONSE', String(empty.error?.code ?? empty.error))

if (failures.length > 0) {
  console.error(`FAIL (${failures.length})`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log('PASS: truncated stream raises TRANSPORT, terminal markers are accepted')
