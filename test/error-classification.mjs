// Error-classification regression: the provider-neutral failure code decides
// whether the adapter fails over to another account, retries, or surfaces the
// error. Mistral's 402 `billing_api_budget_exhausted` is a quota condition and
// must not fall through to INVALID_REQUEST. No network, no keys.
import { classifyHttpFailure } from '../lib/adapter.js'

const failures = []
const check = (name, cond, detail = '') => {
  if (!cond) failures.push(detail === '' ? name : `${name} (${detail})`)
}

const codeOf = (status, body) => classifyHttpFailure(status, body)?.code

// --- authentication ---
check('401 is AUTH', codeOf(401, '{"message":"invalid api key"}') === 'AUTH', String(codeOf(401, 'x')))
check('403 is AUTH', codeOf(403, '{"message":"forbidden"}') === 'AUTH', String(codeOf(403, 'x')))

// --- the Mistral API budget cap ---
const budgetBody = JSON.stringify({
  object: 'error',
  message: 'API budget exhausted.',
  type: 'billing_api_budget_exhausted',
  param: null,
  code: '2303',
  raw_status_code: 402,
})
check('402 billing_api_budget_exhausted is QUOTA', codeOf(402, budgetBody) === 'QUOTA', String(codeOf(402, budgetBody)))
check(
  'the 402 message names the budget',
  /API budget exhausted/.test(classifyHttpFailure(402, budgetBody)?.message ?? ''),
  classifyHttpFailure(402, budgetBody)?.message,
)

// --- rate limiting vs quota on 429 ---
check('429 with insufficient quota is QUOTA', codeOf(429, '{"message":"insufficient quota"}') === 'QUOTA', String(codeOf(429, 'x')))
check('429 without a quota phrase is RATE_LIMIT', codeOf(429, '{"message":"too many requests"}') === 'RATE_LIMIT', String(codeOf(429, 'x')))

// --- context window ---
check(
  'a context overflow is CONTEXT_WINDOW_EXCEEDED',
  codeOf(400, '{"message":"maximum context length is 128000 tokens"}') === 'CONTEXT_WINDOW_EXCEEDED',
  String(codeOf(400, 'x')),
)

// --- server and generic failures ---
check('500 is SERVER', codeOf(500, '{"message":"internal"}') === 'SERVER', String(codeOf(500, 'x')))
check('400 without a known phrase is INVALID_REQUEST', codeOf(400, '{"message":"bad request"}') === 'INVALID_REQUEST', String(codeOf(400, 'x')))

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL: ${failure}`)
  process.exit(1)
}
console.log('PASS: HTTP failures map onto the provider-neutral taxonomy, including the 402 budget cap')
