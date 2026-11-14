// Regression suite for the merged lineage: fork 0.2.4 (transport, wire, cache)
// + upstream issue #1 patch series 0.1.3-0.1.8 (F-3..F-10) + the attempt-state
// shadowing fix. No network, no keys: a local server replays a captured stream.
import http from 'node:http'
import { MistralProAdapter } from '../lib/adapter.js'

const failures = []
const check = (name, cond, detail = '') => {
  if (!cond) failures.push(detail === '' ? name : `${name} (${detail})`)
}

const adapter = Object.create(MistralProAdapter.prototype)
adapter.dispatcher = async () => ({})

const MODEL = { id: 'deepseek-v4-1-flash-1017', maxTokens: 128000, reasoning: { efforts: [{ id: 'high' }] } }
const baseConfig = {
  cache: { affinity: true, reportUsage: true },
  advanced: { promptCacheKey: 'auto', maxTokensCap: 0, transport: 'fetch', proxy: '', streamIdleTimeoutMs: 20000 },
}
const messages = [
  { role: 'system', content: 'you are a coding agent' },
  { role: 'user', content: 'run the tests' },
]
const build = (config, msgs = messages, options = {}) =>
  adapter.buildBody({ model: MODEL.id, messages: msgs, ...options }, MODEL, config, msgs)

// --- F-10: prompt cache key ---
const body = build(baseConfig)
check('auto sends a 64-char prompt_cache_key', typeof body.prompt_cache_key === 'string' && body.prompt_cache_key.length === 64)
const appended = [...messages, { role: 'assistant', content: 'ok' }, { role: 'user', content: 'and again' }]
check('cache key stable across appended turns', build(baseConfig, appended).prompt_cache_key === body.prompt_cache_key)
check('off omits prompt_cache_key', build({ ...baseConfig, advanced: { ...baseConfig.advanced, promptCacheKey: 'off' } }).prompt_cache_key === undefined)
check('custom key passes through', build({ ...baseConfig, advanced: { ...baseConfig.advanced, promptCacheKey: 'team-shard-1' } }).prompt_cache_key === 'team-shard-1')
check('different conversation shards apart', build(baseConfig, [{ role: 'user', content: 'unrelated' }]).prompt_cache_key !== body.prompt_cache_key)

// --- 'shared' mode: reuse the system-prompt prefix across conversations ---
const sharedConfig = { ...baseConfig, advanced: { ...baseConfig.advanced, promptCacheKey: 'shared' } }
const sharedA = build(sharedConfig, messages)
const sharedB = build(sharedConfig, [{ role: 'system', content: 'you are a coding agent' }, { role: 'user', content: 'a different question' }])
check('shared key ignores the first user message', sharedA.prompt_cache_key === sharedB.prompt_cache_key)
check('shared key changes with the system prompt', build(sharedConfig, [{ role: 'system', content: 'different system' }, { role: 'user', content: 'x' }]).prompt_cache_key !== sharedA.prompt_cache_key)
check('shared key changes with the model', build(sharedConfig, messages, { model: 'mistral-large-4' }).prompt_cache_key !== sharedA.prompt_cache_key)
check('shared key is a 64-char digest', typeof sharedA.prompt_cache_key === 'string' && sharedA.prompt_cache_key.length === 64)

// --- fork: usage reporting ---
check('stream_options.include_usage requested', body.stream_options?.include_usage === true)
check('reportUsage=false omits stream_options', build({ ...baseConfig, cache: { ...baseConfig.cache, reportUsage: false } }).stream_options === undefined)

// --- F-9: no injected output cap ---
check('cap 0 sends no max_tokens', body.max_tokens === undefined, String(body.max_tokens))
check('explicit cap honored', build({ ...baseConfig, advanced: { ...baseConfig.advanced, maxTokensCap: 4096 } }).max_tokens === 4096)
check('host maxTokens clamped to model budget', build(baseConfig, messages, { maxTokens: 999999 }).max_tokens === 128000)

// --- F-7: retry policy is the resolved, flattened shape ---
const policy = adapter.providerRetryPolicy('mistral-pro')
check('retry policy has no nested backoff', policy.backoff === undefined, JSON.stringify(policy))
check('retry policy delays are finite', Number.isFinite(policy.initialDelayMs) && Number.isFinite(policy.maxDelayMs) && Number.isFinite(policy.jitterRatio), JSON.stringify(policy))
check('retry policy keeps 3 retries', policy.maxRetries === 3)

// --- fork: wire-key allowlist ---
const dirty = [{ role: 'assistant', content: 'x', reasoning_content: '', tool_calls: [] }]
const clean = adapter.buildBody({ model: 'm', messages: dirty }, { id: 'm', maxTokens: 1000, reasoning: { efforts: [] } }, baseConfig, dirty)
check('reasoning_content dropped from assistant message', clean.messages[0].reasoning_content === undefined)
check('tool_calls preserved', Array.isArray(clean.messages[0].tool_calls))

// --- F-5/F-6 + shadowing: replay a captured partner-model stream ---
const SSE = [
  { choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] },
  { choices: [{ index: 0, delta: { tool_calls: [{ id: 'chatcmpl-tool-8d2d', type: 'function', function: { name: 'run_shell', arguments: '' }, index: 0 }] }, finish_reason: null }] },
  { choices: [{ index: 0, delta: { tool_calls: [{ function: { name: '', arguments: '{"command": "' }, index: 0 }] }, finish_reason: null }] },
  { choices: [{ index: 0, delta: { tool_calls: [{ function: { name: '', arguments: 'echo hi' }, index: 0 }] }, finish_reason: null }] },
  { choices: [{ index: 0, delta: { tool_calls: [{ function: { name: '', arguments: '"}' }, index: 0 }] }, finish_reason: null }] },
  { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
]
const fixture = SSE.map((c) => `data: ${JSON.stringify(c)}`).join('\n\n') + '\n\ndata: [DONE]\n\n'

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'x-request-id': 'test' })
  res.end(fixture)
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port

const attemptState = { emitted: false }
const events = []
for await (const event of adapter.streamWithAccount({
  options: {},
  config: { ...baseConfig, cache: { ...baseConfig.cache, affinity: false } },
  model: MODEL,
  body: { model: MODEL.id, messages: [{ role: 'user', content: 'hi' }] },
  account: { name: 'test', baseURL: `http://127.0.0.1:${port}` },
  apiKey: 'test-key',
  controller: new AbortController(),
  state: attemptState,
})) events.push(event)
server.close()

const end = events.find((e) => e.type === 'block-end' && e.block?.type === 'tool-call')
check('tool-call block-end exists', end !== undefined)
if (end !== undefined) {
  check('tool name survives repeated empty deltas', end.block.name === 'run_shell', JSON.stringify(end.block.name))
  check('tool id preserved', end.block.id === 'chatcmpl-tool-8d2d', JSON.stringify(end.block.id))
  check('arguments accumulated', end.block.arguments === '{"command": "echo hi"}', JSON.stringify(end.block.arguments))
}
const deltas = events.filter((e) => e.type === 'tool-call-delta')
check('every tool-call-delta carries a string id', deltas.every((d) => typeof d.id === 'string'))
check('no tool-call-delta reintroduces an empty name', deltas.every((d) => d.name === undefined || d.name !== ''))
check('attempt state committed on tool call (shadowing fix)', attemptState.emitted === true)
check('exactly one block-start for the tool call', events.filter((e) => e.type === 'block-start' && e.blockType === 'tool-call').length === 1)

if (failures.length > 0) {
  console.error(`FAIL (${failures.length})`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log('PASS: merged lineage (cache key, usage, output cap, retry policy, wire keys, tool name, attempt state)')
