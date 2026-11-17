// Regression suite for the `/cache` route: the aggregation is a pure function
// over the existing wire log, so a synthetic log exercises the whole contract.
// No network, no keys.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { aggregateUsage, appendWire, readWire, WIRE_LOG_MAX_LINES } from '../lib/wire.js'

const scratch = mkdtempSync(join(tmpdir(), 'dsh-mistral-wire-cache-'))
process.env.DSH_MISTRAL_WIRE_LOG = join(scratch, 'wire.log')

const failures = []
const check = (name, cond, detail = '') => {
  if (!cond) failures.push(detail === '' ? name : `${name} (${detail})`)
}

// 25 usage entries interleaved with non-usage entries. The first 20 carry a
// cache hit and the last 5 miss, so every aggregate can be checked by hand.
for (let index = 1; index <= 25; index += 1) {
  appendWire({
    event: 'usage',
    ts: index * 1000,
    model: index % 2 === 0 ? 'mistral-large-4' : 'mistral-small-4',
    promptTokens: 1000,
    cachedTokens: index <= 20 ? 900 : 0,
  })
  appendWire({ event: 'request', ts: index * 1000 + 1, model: 'mistral-large-4', messages: 3, sha256: 'deadbeefdeadbeef' })
}

const entries = readWire(WIRE_LOG_MAX_LINES)
const aggregate = aggregateUsage(entries)
check('the log holds every synthetic entry', entries.length === 50, String(entries.length))
check('requests counts only usage entries', aggregate.requests === 25, String(aggregate.requests))
check('promptTokens sums usage entries', aggregate.promptTokens === 25000, String(aggregate.promptTokens))
check('cachedTokens sums usage entries', aggregate.cachedTokens === 18000, String(aggregate.cachedTokens))
check('hitRate is cachedTokens / promptTokens', aggregate.hitRate === 18000 / 25000, String(aggregate.hitRate))
check('recent is the last 20 usage entries', aggregate.recent.length === 20, String(aggregate.recent.length))
check(
  'recent is newest last',
  aggregate.recent[0].ts === 6000 && aggregate.recent.at(-1).ts === 25000,
  `${aggregate.recent[0].ts}..${aggregate.recent.at(-1).ts}`,
)
check('recent keeps model ids', aggregate.recent.at(-1).model === 'mistral-small-4', String(aggregate.recent.at(-1).model))
check(
  'recent exposes counts, model ids, a hit rate and the attribution labels',
  aggregate.recent.every(
    (entry) =>
      JSON.stringify(Object.keys(entry).sort()) ===
      '["account","affinity","cachedTokens","conversation","hitRate","model","promptTokens","ts"]',
  ),
  JSON.stringify(aggregate.recent[0]),
)
check(
  'the aggregate has exactly the documented top-level keys',
  JSON.stringify(Object.keys(aggregate).sort()) ===
    '["byAccount","byAffinity","byModel","cachedTokens","coldAfterFailover","distribution","failovers","hitRate","promptTokens","recent","requests","steadyState","steadyStateByRoute","window"]',
  JSON.stringify(Object.keys(aggregate)),
)
check(
  'the pre-existing fields keep their meaning beside the new breakdowns',
  aggregate.requests === 25 && aggregate.promptTokens === 25000 && aggregate.cachedTokens === 18000 && aggregate.hitRate === 18000 / 25000,
  JSON.stringify({ requests: aggregate.requests, promptTokens: aggregate.promptTokens, cachedTokens: aggregate.cachedTokens }),
)
check(
  'the aggregate reports the retained window it was computed over',
  aggregate.window.maxLines === WIRE_LOG_MAX_LINES && aggregate.window.entries === entries.length,
  JSON.stringify(aggregate.window),
)
check(
  'a log without account, model-free or affinity labels still produces breakdowns',
  aggregate.byModel.length === 2 && aggregate.byAccount.length === 1 && aggregate.byAccount[0].account === null,
  JSON.stringify({ byModel: aggregate.byModel, byAccount: aggregate.byAccount }),
)

// --- an empty log is zeroed, not NaN ---
process.env.DSH_MISTRAL_WIRE_LOG = join(scratch, 'empty.log')
const empty = aggregateUsage(readWire(WIRE_LOG_MAX_LINES))
check('an empty log reports zero requests', empty.requests === 0 && empty.promptTokens === 0 && empty.cachedTokens === 0)
check('an empty log reports hitRate 0, not NaN', empty.hitRate === 0 && !Number.isNaN(empty.hitRate))
check('an empty log has an empty recent window', empty.recent.length === 0)
const none = aggregateUsage([])
check(
  'aggregateUsage([]) is zeroed',
  none.requests === 0 && none.promptTokens === 0 && none.cachedTokens === 0 && none.hitRate === 0 && none.recent.length === 0,
)

// --- malformed entries cannot leak NaN into the route ---
const malformed = aggregateUsage([
  { event: 'usage', promptTokens: 'nope', cachedTokens: null },
  { raw: '{"broken"' },
  null,
  { event: 'request' },
])
check(
  'malformed entries cannot produce NaN',
  malformed.requests === 1 && malformed.promptTokens === 0 && malformed.cachedTokens === 0 && malformed.hitRate === 0,
  JSON.stringify(malformed),
)

// --- the route reads the whole log, not readWire's default 40-entry window ---
process.env.DSH_MISTRAL_WIRE_LOG = join(scratch, 'long.log')
for (let index = 1; index <= 45; index += 1) {
  appendWire({ event: 'usage', ts: index, model: 'mistral-large-4', promptTokens: 10, cachedTokens: 5 })
}
check('the route reads the whole 400-line log', aggregateUsage(readWire(WIRE_LOG_MAX_LINES)).requests === 45)
check('the default readWire window would truncate the aggregate', aggregateUsage(readWire()).requests === 40)

if (failures.length > 0) {
  console.error(`FAIL (${failures.length})`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log('PASS: /cache aggregation (shape, sums, hit rate, 20-entry window, empty log, whole-log read)')
