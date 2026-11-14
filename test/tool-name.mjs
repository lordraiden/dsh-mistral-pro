// Regression: Mistral streams the tool name once, then repeats `name: ""`.
// The adapter must keep the first non-empty name instead of erasing it.
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { MistralProAdapter } from '../lib/adapter.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const captured = path.join(here, 'fixtures', 'mistral-tool-name.sse')

// Keep diagnostic writes out of the live host's wire log.
process.env.DSH_MISTRAL_WIRE_LOG = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-mistral-tool-name-')), 'wire.log')

const fixture = fs.existsSync(captured)
  ? fs.readFileSync(captured, 'utf8')
  : [
      'data: ' + JSON.stringify({ id: 'c1', choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] }),
      'data: ' + JSON.stringify({ id: 'c2', choices: [{ index: 0, delta: { tool_calls: [{ id: 'chatcmpl-tool-8d2d17bcf504eb84', type: 'function', function: { name: 'run_shell', arguments: '' }, index: 0 }] }, finish_reason: null }] }),
      'data: ' + JSON.stringify({ id: 'c3', choices: [{ index: 0, delta: { tool_calls: [{ function: { name: '', arguments: '{"command": "' }, index: 0 }] }, finish_reason: null }] }),
      'data: ' + JSON.stringify({ id: 'c4', choices: [{ index: 0, delta: { tool_calls: [{ function: { name: '', arguments: 'echo hi' }, index: 0 }] }, finish_reason: null }] }),
      'data: ' + JSON.stringify({ id: 'c5', choices: [{ index: 0, delta: { tool_calls: [{ function: { name: '', arguments: '"}' }, index: 0 }] }, finish_reason: null }] }),
      'data: ' + JSON.stringify({ id: 'c6', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 287, completion_tokens: 40, total_tokens: 327 } }),
      'data: [DONE]',
    ].join('\n\n') + '\n\n'

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'x-request-id': 'test-request' })
  res.end(fixture)
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port

const adapter = Object.create(MistralProAdapter.prototype)
adapter.dispatcher = async () => ({})

const config = {
  cache: { affinity: false, promptCacheKey: undefined },
  advanced: { transport: 'fetch', streamIdleTimeoutMs: 20000, proxy: '' },
}
const events = []
for await (const event of adapter.streamWithAccount({
  options: {},
  config,
  model: { id: 'test-model' },
  body: { model: 'test-model', messages: [{ role: 'user', content: 'hi' }] },
  account: { name: 'test', baseURL: `http://127.0.0.1:${port}` },
  apiKey: 'test-key',
  controller: new AbortController(),
  state: { emitted: false },
})) {
  events.push(event)
}
server.close()

const end = events.find(e => e.type === 'block-end' && e.block?.type === 'tool-call')
const failures = []
if (end === undefined) failures.push('no tool-call block-end event')
else {
  if (end.block.name !== 'run_shell') failures.push(`block-end name is ${JSON.stringify(end.block.name)}, expected "run_shell"`)
  if (end.block.id !== 'chatcmpl-tool-8d2d17bcf504eb84') failures.push(`block-end id is ${JSON.stringify(end.block.id)}`)
  if (end.block.arguments !== '{"command": "echo hi"}') failures.push(`arguments are ${JSON.stringify(end.block.arguments)}`)
}
const delta = events.filter(e => e.type === 'tool-call-delta')
for (const d of delta) if (d.name === '' || d.name === undefined) failures.push(`tool-call-delta carried empty name at index ${d.index}`)

if (failures.length > 0) {
  console.error('FAIL')
  for (const f of failures) console.error(' -', f)
  process.exit(1)
}
console.log('PASS: name survives repeated empty deltas ->', end.block.name, JSON.stringify(end.block.arguments))
