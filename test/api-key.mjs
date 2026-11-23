// API-key regression: the plugin validates a resolved key locally because
// `@deepseek-ai/dsh-llm` removed its `assertUsableApiKey` export in
// 0.2.3-alpha.2. The transport invariant is unchanged: trim surrounding
// whitespace, reject a blank key, and reject characters an HTTP header cannot
// carry. The key itself never appears in the diagnostic.
// No network, no keys.
import { resolveAccountKey } from '../lib/accounts.js'

const failures = []
const check = (name, cond, detail = '') => {
  if (!cond) failures.push(detail === '' ? name : `${name} (${detail})`)
}

const account = { name: 'only', apiKeyEnv: 'KEY_A' }

/** A context whose credentials seam resolves to `value` (undefined = absent). */
const ctxWith = (value) => ({
  get(service) {
    if (service !== 'credentials') return undefined
    return {
      async resolve() {
        return value === undefined ? undefined : { value }
      },
    }
  },
})

const resolve = async (value) => {
  try {
    return { key: await resolveAccountKey(ctxWith(value), account) }
  } catch (error) {
    return { error }
  }
}

const trimmed = await resolve('  key-a  ')
check('a padded key is trimmed', trimmed.key === 'key-a', JSON.stringify(trimmed))

const blank = await resolve('   ')
check(
  'a whitespace-only key is INVALID_CREDENTIAL',
  blank.error?.code === 'INVALID_CREDENTIAL',
  String(blank.error?.code ?? blank.error),
)
check(
  'the blank-key diagnostic names the credential reference, not the value',
  typeof blank.error?.message === 'string' && blank.error.message.includes('KEY_A') && !blank.error.message.includes('   '),
  String(blank.error?.message),
)

const illegal = await resolve('key-\u00e9')
check(
  'a key with characters an HTTP header cannot carry is INVALID_CREDENTIAL',
  illegal.error?.code === 'INVALID_CREDENTIAL',
  String(illegal.error?.code ?? illegal.error),
)

const missing = await resolve(undefined)
check(
  'a missing credential is MISSING_CREDENTIAL',
  missing.error?.code === 'MISSING_CREDENTIAL',
  String(missing.error?.code ?? missing.error),
)

const empty = await resolve('')
check(
  'an empty credential is MISSING_CREDENTIAL',
  empty.error?.code === 'MISSING_CREDENTIAL',
  String(empty.error?.code ?? empty.error),
)

if (failures.length > 0) {
  console.error(`FAIL (${failures.length})`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log('PASS: API-key validation (trim, blank, illegal characters, missing credential)')
