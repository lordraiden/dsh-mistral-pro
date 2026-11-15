// Key-account regression: the Settings "Keys" rows create or update the Vibe
// and Studio accounts through one pure helper. The two key accounts lead the
// list (Vibe, then Studio); every other account keeps its relative order.
// No network, no keys.
import { KEY_ACCOUNT_ORDER, upsertKeyAccount } from '../lib/config.js'

const failures = []
const check = (name, cond, detail = '') => {
  if (!cond) failures.push(detail === '' ? name : `${name} (${detail})`)
}
const names = (accounts) => accounts.map((account) => account.name).join(',')
const VIBE = { name: 'Vibe', ref: 'MISTRAL_VIBE_KEY' }
const STUDIO = { name: 'Studio', ref: 'MISTRAL_API_KEY' }

check('the canonical key order is Vibe then Studio', KEY_ACCOUNT_ORDER.join(',') === 'Vibe,Studio', KEY_ACCOUNT_ORDER.join(','))

// --- create from empty ---
const fromEmpty = upsertKeyAccount([], VIBE)
check('creating from empty yields one Vibe account', fromEmpty.length === 1 && fromEmpty[0].name === 'Vibe', names(fromEmpty))
check('the created account carries the credential ref', fromEmpty[0].apiKeyEnv === 'MISTRAL_VIBE_KEY', fromEmpty[0].apiKeyEnv)
check('the created account is enabled', fromEmpty[0].enabled === true, String(fromEmpty[0].enabled))

// --- Studio is appended after Vibe ---
const both = upsertKeyAccount(fromEmpty, STUDIO)
check('Studio is appended after Vibe', names(both) === 'Vibe,Studio', names(both))
check('Studio carries MISTRAL_API_KEY', both[1].apiKeyEnv === 'MISTRAL_API_KEY', both[1].apiKeyEnv)

// --- update an existing account ---
const existing = [
  { name: 'Vibe', apiKeyEnv: 'OLD_VIBE', baseURL: 'https://vibe.example/v1', enabled: false },
  { name: 'Work', apiKeyEnv: 'WORK_KEY', baseURL: '', enabled: true },
]
const updated = upsertKeyAccount(existing, VIBE)
check('an existing Vibe account is updated, not duplicated', updated.length === 2 && updated[0].name === 'Vibe', names(updated))
check('the update rewrites apiKeyEnv', updated[0].apiKeyEnv === 'MISTRAL_VIBE_KEY', updated[0].apiKeyEnv)
check('the update re-enables the account', updated[0].enabled === true, String(updated[0].enabled))
check('the update preserves the base URL', updated[0].baseURL === 'https://vibe.example/v1', updated[0].baseURL)
check('the update preserves the other account', updated[1].name === 'Work' && updated[1].apiKeyEnv === 'WORK_KEY', names(updated))

// --- ordering with extra accounts ---
const extra = [
  { name: 'Work', apiKeyEnv: 'WORK_KEY', baseURL: '', enabled: true },
  { name: 'Studio', apiKeyEnv: 'MISTRAL_API_KEY', baseURL: '', enabled: true },
  { name: 'Personal', apiKeyEnv: 'PERSONAL_KEY', baseURL: '', enabled: true },
]
const ordered = upsertKeyAccount(extra, VIBE)
check('Vibe and Studio lead the list', names(ordered) === 'Vibe,Studio,Work,Personal', names(ordered))
check('other accounts keep their relative order', ordered.slice(2).map((account) => account.name).join(',') === 'Work,Personal', names(ordered))

// --- an existing Studio is moved behind a newly created Vibe ---
const studioFirst = [
  { name: 'Studio', apiKeyEnv: 'MISTRAL_API_KEY', baseURL: '', enabled: true },
  { name: 'Work', apiKeyEnv: 'WORK_KEY', baseURL: '', enabled: true },
]
const reordered = upsertKeyAccount(studioFirst, VIBE)
check('Vibe is inserted before an existing Studio', names(reordered) === 'Vibe,Studio,Work', names(reordered))

// --- updating Studio keeps the canonical order ---
const studioUpdated = upsertKeyAccount(both, STUDIO)
check('updating Studio keeps Vibe first', names(studioUpdated) === 'Vibe,Studio', names(studioUpdated))
check('updating Studio keeps its ref', studioUpdated[1].apiKeyEnv === 'MISTRAL_API_KEY', studioUpdated[1].apiKeyEnv)

// --- idempotence ---
const once = upsertKeyAccount(extra, VIBE)
const twice = upsertKeyAccount(once, VIBE)
check('applying the same upsert twice is idempotent', JSON.stringify(once) === JSON.stringify(twice), JSON.stringify(twice))

// --- no mutation ---
const input = [
  { name: 'Work', apiKeyEnv: 'WORK_KEY', baseURL: '', enabled: true },
  { name: 'Vibe', apiKeyEnv: 'OLD', baseURL: '', enabled: false },
]
const snapshot = JSON.stringify(input)
const result = upsertKeyAccount(input, VIBE)
check('the input array is not mutated', JSON.stringify(input) === snapshot, JSON.stringify(input))
check('the result is a new array', result !== input)
check('the updated entry is a new object', result.find((account) => account.name === 'Vibe') !== input.find((account) => account.name === 'Vibe'))
check('the untouched entry is preserved', result.find((account) => account.name === 'Work') === input.find((account) => account.name === 'Work'))

if (failures.length > 0) {
  console.error(`FAIL (${failures.length})`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log('PASS: key accounts (create, update, ordering, idempotence, no mutation)')
