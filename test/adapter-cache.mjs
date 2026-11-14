// Prompt-cache regression: the 'shared' mode falls back to the
// per-conversation derivation when there is no system/developer message to
// share; the derived key rotates once per compaction; `x-affinity` is sent only
// when `cache.affinity` is on. Exercises the real public path (`buildBody` with
// `advanced.promptCacheKey`, and `stream` against a local server), not a
// private helper. No network, no keys.
import { baseConfig, drain, makeAdapter, startServer, textStream } from './support/harness.mjs'

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

// --- compaction: the derived key rotates once per compaction ---
// DSH marks the replacement user message of a compaction with
// `source.kind === 'compact-checkpoint'` and a `compactionId`. The adapter reads
// the original messages from `options.messages` (the wire messages passed as
// the fourth argument have no `source`), so these cases exercise the real split.
const wireConversation = [
  { role: 'system', content: 'you are a coding agent' },
  { role: 'user', content: 'summary of the compacted conversation' },
]
const plainSource = [
  { role: 'system', content: 'you are a coding agent', source: { kind: 'system-prompt' } },
  { role: 'user', content: 'summary of the compacted conversation', source: { kind: 'user' } },
]
const checkpointSource = (compactionId, extra = []) => [
  plainSource[0],
  { ...plainSource[1], source: { kind: 'compact-checkpoint', compactionId } },
  ...extra,
]
const buildWithSource = (promptCacheKey, wire, source, model = MODEL) =>
  adapter.buildBody({ model: model.id, messages: source }, model, config(promptCacheKey), wire)

const autoPlain = buildWithSource('auto', wireConversation, plainSource)
const autoCompacted = buildWithSource('auto', wireConversation, checkpointSource('cmp-1'))
check('a compaction rotates the auto key', autoPlain.prompt_cache_key !== autoCompacted.prompt_cache_key)
check('a compacted auto key is still a 64-char digest', isDigest(autoCompacted.prompt_cache_key))

const sharedPlain = buildWithSource('shared', wireConversation, plainSource)
const sharedCompacted = buildWithSource('shared', wireConversation, checkpointSource('cmp-1'))
check('a compaction rotates the shared key', sharedPlain.prompt_cache_key !== sharedCompacted.prompt_cache_key)
check('a compacted shared key is still a 64-char digest', isDigest(sharedCompacted.prompt_cache_key))

// Two turns of the same post-compaction conversation share the id: no rotation.
const appendedWire = [...wireConversation, { role: 'assistant', content: 'ok' }, { role: 'user', content: 'and again' }]
const appendedSource = checkpointSource('cmp-1', [
  { role: 'assistant', content: 'ok', source: { kind: 'model' } },
  { role: 'user', content: 'and again', source: { kind: 'user' } },
])
check(
  'two turns sharing a compactionId keep the same auto key',
  buildWithSource('auto', appendedWire, appendedSource).prompt_cache_key === autoCompacted.prompt_cache_key,
)
check(
  'two turns sharing a compactionId keep the same shared key',
  buildWithSource('shared', appendedWire, appendedSource).prompt_cache_key === sharedCompacted.prompt_cache_key,
)

// A second compaction rotates the key again.
const recompacted = checkpointSource('cmp-2')
check(
  'a new compactionId rotates the auto key again',
  buildWithSource('auto', wireConversation, recompacted).prompt_cache_key !== autoCompacted.prompt_cache_key,
)
check(
  'a new compactionId rotates the shared key again',
  buildWithSource('shared', wireConversation, recompacted).prompt_cache_key !== sharedCompacted.prompt_cache_key,
)

// No marker: a non-checkpoint source is ignored, so a session that never
// compacted derives exactly the same key as before this change.
check(
  'a non-checkpoint source does not change the auto key',
  autoPlain.prompt_cache_key === build('auto', wireConversation).prompt_cache_key,
)
check(
  'a non-checkpoint source does not change the shared key',
  sharedPlain.prompt_cache_key === build('shared', wireConversation).prompt_cache_key,
)
check(
  'a custom key is never rotated by a compaction',
  buildWithSource('team-shard-1', wireConversation, checkpointSource('cmp-1')).prompt_cache_key === 'team-shard-1',
)

// The no-system-message fallback must carry the generation through too.
const noSystemWire = [{ role: 'user', content: 'summary' }]
const noSystemCheckpoint = [{ role: 'user', content: 'summary', source: { kind: 'compact-checkpoint', compactionId: 'cmp-1' } }]
check(
  'the shared fallback carries the compaction generation',
  buildWithSource('shared', noSystemWire, noSystemCheckpoint).prompt_cache_key ===
    buildWithSource('auto', noSystemWire, noSystemCheckpoint).prompt_cache_key,
)

// --- x-affinity: undocumented routing hint, gated by cache.affinity ---
// The header is kept (see the comment at its construction in lib/adapter.js),
// but it must only be sent when the setting is on, and it must never replace
// `prompt_cache_key`.
async function affinityRun(affinity) {
  let received
  const server = await startServer((request, response) => {
    const chunks = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => {
      received = { headers: request.headers, body: Buffer.concat(chunks).toString('utf8') }
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.end(textStream('ok'))
    })
  })
  const config = baseConfig({
    accounts: [{ name: 'only', apiKeyEnv: 'KEY_A', baseURL: server.url, enabled: true }],
    cache: { affinity },
  })
  const adapter = makeAdapter({ config, keys: { KEY_A: 'key-a' } })
  const result = await drain(adapter.stream({ model: MODEL.id, messages: [{ role: 'user', content: 'hello' }] }))
  await server.close()
  return { received, result }
}

const affinityOn = await affinityRun(true)
check('the affinity stream completed', affinityOn.result.error === undefined, String(affinityOn.result.error))
const sentKey = affinityOn.received === undefined ? undefined : JSON.parse(affinityOn.received.body).prompt_cache_key
check('prompt_cache_key is still sent when affinity is on', isDigest(sentKey))
check('x-affinity is sent when cache.affinity is true', typeof affinityOn.received?.headers['x-affinity'] === 'string')
check('x-affinity matches prompt_cache_key', affinityOn.received?.headers['x-affinity'] === sentKey)

const affinityOff = await affinityRun(false)
check('the no-affinity stream completed', affinityOff.result.error === undefined, String(affinityOff.result.error))
const offKey = affinityOff.received === undefined ? undefined : JSON.parse(affinityOff.received.body).prompt_cache_key
check('prompt_cache_key is still sent when affinity is off', isDigest(offKey))
check('x-affinity is omitted when cache.affinity is false', affinityOff.received?.headers['x-affinity'] === undefined)

if (failures.length > 0) {
  console.error(`FAIL (${failures.length})`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log('PASS: shared cache key fallback, compaction rotation, and x-affinity gating')
