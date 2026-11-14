// Usage-accounting regression: DSH's TokenUsage counts are disjoint, so the
// adapter must report uncached input in `inputTokens` and the cached prefix in
// `cacheReadTokens`. Mistral folds both into `prompt_tokens`; reporting that
// folded total as `inputTokens` double-counts the cached prefix in every
// consumer that adds the buckets and shows about half the real hit rate.
// No network, no keys.
import { aggregateUsage, readWire } from '../lib/wire.js'
import { baseConfig, drain, makeAdapter, startServer, sse, userMessage } from './support/harness.mjs'

const failures = []
const check = (name, cond, detail = '') => {
  if (!cond) failures.push(detail === '' ? name : `${name} (${detail})`)
}

const MODEL = 'deepseek-v4-1-flash-1017'
const messages = [userMessage('hello')]

async function runAgainst(usage) {
  const body = sse([
    { choices: [{ index: 0, delta: { role: 'assistant', content: 'ok' }, finish_reason: null }] },
    { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
    { choices: [], usage },
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

// --- Mistral folds the cached prefix into prompt_tokens ---
const cached = await runAgainst({
  prompt_tokens: 420,
  completion_tokens: 10,
  total_tokens: 430,
  prompt_tokens_details: { cached_tokens: 384 },
})
const usageEvent = cached.events.find((event) => event.type === 'usage')
check('a usage event is emitted', usageEvent !== undefined)
check('inputTokens is uncached input only', usageEvent?.usage.inputTokens === 36, String(usageEvent?.usage.inputTokens))
check('cacheReadTokens carries the cached prefix', usageEvent?.usage.cacheReadTokens === 384, String(usageEvent?.usage.cacheReadTokens))
check('outputTokens is preserved', usageEvent?.usage.outputTokens === 10, String(usageEvent?.usage.outputTokens))
check('totalTokens keeps the provider total', usageEvent?.usage.totalTokens === 430, String(usageEvent?.usage.totalTokens))
check(
  'the disjoint buckets add up to the provider total',
  usageEvent !== undefined
    && usageEvent.usage.inputTokens + usageEvent.usage.cacheReadTokens + usageEvent.usage.outputTokens === 430,
)

// --- the wire log keeps the total prompt count, so /cache keeps its meaning ---
const entries = readWire(20)
const wire = entries.filter((entry) => entry.event === 'usage').at(-1)
check('the wire log records the total prompt tokens', wire?.promptTokens === 420, String(wire?.promptTokens))
check('the wire log records the cached tokens', wire?.cachedTokens === 384, String(wire?.cachedTokens))
const aggregate = aggregateUsage(entries)
check('the aggregate hit rate is cached / total prompt', Math.abs(aggregate.hitRate - 384 / 420) < 1e-9, String(aggregate.hitRate))

// --- no cache details at all: everything is uncached input ---
const cold = await runAgainst({ prompt_tokens: 420, completion_tokens: 10, total_tokens: 430 })
const coldUsage = cold.events.find((event) => event.type === 'usage')
check('a cold call reports the whole prompt as uncached', coldUsage?.usage.inputTokens === 420, String(coldUsage?.usage.inputTokens))
check('a cold call reports no cached tokens', coldUsage?.usage.cacheReadTokens === 0, String(coldUsage?.usage.cacheReadTokens))

// --- a provider that reports more cached than prompt tokens is clamped ---
const odd = await runAgainst({
  prompt_tokens: 420,
  completion_tokens: 10,
  total_tokens: 430,
  prompt_tokens_details: { cached_tokens: 500 },
})
const oddUsage = odd.events.find((event) => event.type === 'usage')
check('cached tokens never make inputTokens negative', oddUsage?.usage.inputTokens === 0, String(oddUsage?.usage.inputTokens))
check('the cached count is preserved as reported', oddUsage?.usage.cacheReadTokens === 500, String(oddUsage?.usage.cacheReadTokens))

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL: ${failure}`)
  process.exit(1)
}
console.log('PASS: usage buckets are disjoint and the wire log keeps the total prompt count')
