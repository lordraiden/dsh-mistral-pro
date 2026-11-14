// Shared-key regression: `advanced.promptCacheKey: 'shared'` derives the key
// from the model and the leading system prompt only, so separate conversations
// can reuse the same cached prefix. The no-system-message fallback is covered
// by the adapter suite once the shared key stops degenerating to the model id.
import { baseConfig, makeAdapter } from './support/harness.mjs'

const failures = []
const check = (name, cond, detail = '') => {
  if (!cond) failures.push(detail === '' ? name : `${name} (${detail})`)
}

const MODEL = { id: 'deepseek-v4-1-flash-1017', maxTokens: 128000, reasoning: { efforts: [] } }
const config = (promptCacheKey) =>
  baseConfig({ advanced: { promptCacheKey } })

const adapter = makeAdapter({ config: config('shared') })
const build = (promptCacheKey, messages, model = MODEL) =>
  adapter.buildBody(
    { model: model.id, messages },
    model,
    config(promptCacheKey),
    messages,
  )

const system = [
  { role: 'system', content: 'you are a coding agent' },
  { role: 'user', content: 'run the tests' },
]

const shared = build('shared', system)
check('shared sends a 64-char digest', typeof shared.prompt_cache_key === 'string' && /^[0-9a-f]{64}$/.test(shared.prompt_cache_key))

const otherQuestion = build('shared', [
  { role: 'system', content: 'you are a coding agent' },
  { role: 'user', content: 'a different question' },
])
check('shared ignores the first user message', shared.prompt_cache_key === otherQuestion.prompt_cache_key)

const appended = build('shared', [...system, { role: 'assistant', content: 'ok' }, { role: 'user', content: 'and again' }])
check('shared is stable across appended turns', shared.prompt_cache_key === appended.prompt_cache_key)

const otherSystem = build('shared', [
  { role: 'system', content: 'a different system prompt' },
  { role: 'user', content: 'run the tests' },
])
check('shared changes with the system prompt', shared.prompt_cache_key !== otherSystem.prompt_cache_key)

const otherModel = build('shared', system, { id: 'mistral-large-4', maxTokens: 128000, reasoning: { efforts: [] } })
check('shared changes with the model', shared.prompt_cache_key !== otherModel.prompt_cache_key)

const developer = build('shared', [
  { role: 'developer', content: 'you are a coding agent' },
  { role: 'user', content: 'run the tests' },
])
const otherDeveloper = build('shared', [
  { role: 'developer', content: 'a different developer prompt' },
  { role: 'user', content: 'run the tests' },
])
check(
  'a developer message contributes to the shared key',
  developer.prompt_cache_key !== otherDeveloper.prompt_cache_key,
)
check(
  'a developer message keeps a 64-char digest',
  typeof developer.prompt_cache_key === 'string' && /^[0-9a-f]{64}$/.test(developer.prompt_cache_key),
)

// Contract that holds before and after the no-system-message fallback: the
// derivation is deterministic and always a 64-char digest.
const noSystem = build('shared', [{ role: 'user', content: 'hello' }])
const noSystemAgain = build('shared', [{ role: 'user', content: 'hello' }])
check(
  'shared without a system message is deterministic',
  noSystem.prompt_cache_key === noSystemAgain.prompt_cache_key,
)
check(
  'shared without a system message is still a 64-char digest',
  typeof noSystem.prompt_cache_key === 'string' && /^[0-9a-f]{64}$/.test(noSystem.prompt_cache_key),
)

// auto and off keep their own contracts.
const auto = build('auto', system)
check('auto is a 64-char digest', typeof auto.prompt_cache_key === 'string' && /^[0-9a-f]{64}$/.test(auto.prompt_cache_key))
check('auto and shared differ', auto.prompt_cache_key !== shared.prompt_cache_key)
check('off omits the field', build('off', system).prompt_cache_key === undefined)
check('a custom key passes through', build('team-shard-1', system).prompt_cache_key === 'team-shard-1')

if (failures.length > 0) {
  console.error(`FAIL (${failures.length})`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log('PASS: shared cache key derivation (system prompt, model, stability, fallback contract)')
