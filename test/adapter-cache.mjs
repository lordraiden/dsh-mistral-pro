// Prompt-cache key regression: the 'shared' mode falls back to the
// per-conversation derivation when there is no system/developer message to
// share, and keeps the shared derivation when there is one. Exercises the real
// public path (`buildBody` with `advanced.promptCacheKey`), not a private
// helper. No network, no keys.
import { baseConfig, makeAdapter } from './support/harness.mjs'

const failures = []
const check = (name, cond, detail = '') => {
  if (!cond) failures.push(detail === '' ? name : `${name} (${detail})`)
}

const MODEL = { id: 'deepseek-v4-1-flash-1017', maxTokens: 128000, reasoning: { efforts: [] } }
const config = (promptCacheKey) => baseConfig({ advanced: { promptCacheKey } })

const adapter = makeAdapter({ config: config('shared') })
const build = (promptCacheKey, messages, model = MODEL) =>
  adapter.buildBody({ model: model.id, messages }, model, config(promptCacheKey), messages)

const isDigest = (value) => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)

// --- no system message: 'shared' must not degenerate to a model-only key ---
const noSystem = [{ role: 'user', content: 'hello' }]
const sharedNoSystem = build('shared', noSystem)
const autoNoSystem = build('auto', noSystem)
check('shared without a system message is a 64-char digest', isDigest(sharedNoSystem.prompt_cache_key))
check(
  'shared without a system message falls back to the auto derivation',
  sharedNoSystem.prompt_cache_key === autoNoSystem.prompt_cache_key,
  `${sharedNoSystem.prompt_cache_key} != ${autoNoSystem.prompt_cache_key}`,
)
check(
  'the fallback still shards different conversations apart',
  sharedNoSystem.prompt_cache_key !== build('shared', [{ role: 'user', content: 'a different question' }]).prompt_cache_key,
)
check(
  'the fallback is deterministic',
  sharedNoSystem.prompt_cache_key === build('shared', noSystem).prompt_cache_key,
)

// A leading developer message counts as a shared prefix, exactly like a system
// message, so the fallback must not trigger for it.
const developerOnly = build('shared', [{ role: 'developer', content: 'you are a coding agent' }])
check(
  'a leading developer message keeps the shared derivation',
  isDigest(developerOnly.prompt_cache_key) &&
    developerOnly.prompt_cache_key !== build('auto', [{ role: 'developer', content: 'you are a coding agent' }]).prompt_cache_key,
)

// --- with a system message: the shared derivation is unchanged ---
const system = [
  { role: 'system', content: 'you are a coding agent' },
  { role: 'user', content: 'run the tests' },
]
const shared = build('shared', system)
check('shared with a system message is a 64-char digest', isDigest(shared.prompt_cache_key))
check(
  'shared ignores the first user message when a system message is present',
  shared.prompt_cache_key ===
    build('shared', [
      { role: 'system', content: 'you are a coding agent' },
      { role: 'user', content: 'a different question' },
    ]).prompt_cache_key,
)
check(
  'shared still changes with the system prompt',
  shared.prompt_cache_key !==
    build('shared', [
      { role: 'system', content: 'a different system prompt' },
      { role: 'user', content: 'run the tests' },
    ]).prompt_cache_key,
)
check(
  'shared with a system message is not the auto key',
  shared.prompt_cache_key !== build('auto', system).prompt_cache_key,
)

if (failures.length > 0) {
  console.error(`FAIL (${failures.length})`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log('PASS: shared cache key falls back to the per-conversation derivation without a system message')
