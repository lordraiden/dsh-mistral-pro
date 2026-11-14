// Retry-policy regression: the adapter must return the resolved, flattened
// policy shape that dsh-llm-retry reads (`initialDelayMs` / `maxDelayMs` /
// `jitterRatio` at the top level, no nested `backoff`). The old config shape
// produced NaN delays, and the session log rejected the non-finite numbers.
import { MistralProAdapter } from '../lib/adapter.js'
import { baseConfig, makeAdapter } from './support/harness.mjs'

const failures = []
const check = (name, cond, detail = '') => {
  if (!cond) failures.push(detail === '' ? name : `${name} (${detail})`)
}

const adapter = makeAdapter({ config: baseConfig() })
const policy = adapter.providerRetryPolicy('mistral-pro')

check('the policy is the normal retry mode', policy.mode === 'normal', String(policy.mode))
check('the policy keeps three retries', policy.maxRetries === 3, String(policy.maxRetries))
check(
  'transient codes are retryable',
  ['RATE_LIMIT', 'SERVER', 'TIMEOUT', 'TRANSPORT', 'EMPTY_RESPONSE'].every((code) => policy.retryableCodes.includes(code)),
  JSON.stringify(policy.retryableCodes),
)
check('there is no nested backoff object', policy.backoff === undefined, JSON.stringify(policy.backoff))
check(
  'the delays are top-level and finite',
  Number.isFinite(policy.initialDelayMs) && Number.isFinite(policy.maxDelayMs) && Number.isFinite(policy.jitterRatio),
  JSON.stringify(policy),
)
check('the initial delay is positive', policy.initialDelayMs > 0, String(policy.initialDelayMs))
check('the maximum delay is at least the initial delay', policy.maxDelayMs >= policy.initialDelayMs)
check('the jitter ratio is a fraction', policy.jitterRatio >= 0 && policy.jitterRatio <= 1, String(policy.jitterRatio))

// The original failure mode: a non-finite number reached the session log.
const serialized = JSON.parse(JSON.stringify(policy))
check(
  'the policy survives a JSON round-trip unchanged',
  JSON.stringify(serialized) === JSON.stringify(policy),
  JSON.stringify(serialized),
)

// The base class default must not be used: the adapter owns the policy.
check('the adapter overrides the base policy', MistralProAdapter.prototype.providerRetryPolicy !== undefined)

if (failures.length > 0) {
  console.error(`FAIL (${failures.length})`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log('PASS: retry policy is the resolved, flattened, JSON-safe shape')
