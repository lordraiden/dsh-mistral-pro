// Routing regression: `advanced.priority` decides which key is tried first and
// whether a fallback is promoted; `advanced.failover: false` removes the second
// account entirely. No network, no keys.
import { AccountPool } from '../lib/accounts.js'
import { baseConfig } from './support/harness.mjs'

const failures = []
const check = (name, cond, detail = '') => {
  if (!cond) failures.push(detail === '' ? name : `${name} (${detail})`)
}

const accounts = [
  { name: 'Vibe', apiKeyEnv: 'MISTRAL_VIBE_KEY', baseURL: '', enabled: true },
  { name: 'Studio', apiKeyEnv: 'MISTRAL_API_KEY', baseURL: '', enabled: true },
  { name: 'Extra', apiKeyEnv: 'EXTRA_KEY', baseURL: '', enabled: true },
]
const names = (pool, config) => pool.attemptOrder(config).map((account) => account.name).join(',')

// --- automatic: configured order, then the account that last worked ---
let pool = new AccountPool()
let config = baseConfig({ accounts, advanced: { priority: 'auto' } })
check('auto keeps the configured order', names(pool, config) === 'Vibe,Studio,Extra', names(pool, config))
pool.markSuccess('Studio')
check('auto promotes the account that worked', names(pool, config) === 'Studio,Vibe,Extra', names(pool, config))

// --- fixed priorities never promote a fallback ---
pool = new AccountPool()
config = baseConfig({ accounts, advanced: { priority: 'vibe-first' } })
check('vibe-first starts with Vibe', names(pool, config) === 'Vibe,Studio,Extra', names(pool, config))
pool.markSuccess('Studio')
check('vibe-first never promotes a fallback', names(pool, config) === 'Vibe,Studio,Extra', names(pool, config))

pool = new AccountPool()
config = baseConfig({ accounts, advanced: { priority: 'studio-first' } })
check('studio-first starts with Studio', names(pool, config) === 'Studio,Vibe,Extra', names(pool, config))
pool.markSuccess('Vibe')
check('studio-first never promotes a fallback', names(pool, config) === 'Studio,Vibe,Extra', names(pool, config))

// --- a cooling account moves to the back, other accounts keep their order ---
pool = new AccountPool()
config = baseConfig({ accounts, advanced: { priority: 'vibe-first' } })
pool.markFailure('Vibe', 300)
check('a cooling account moves to the back', names(pool, config) === 'Studio,Extra,Vibe', names(pool, config))

// --- no fallback: only the first account, even while it cools down ---
pool = new AccountPool()
config = baseConfig({ accounts, advanced: { priority: 'vibe-first', failover: false } })
check('no fallback returns only the first account', names(pool, config) === 'Vibe', names(pool, config))
pool.markFailure('Vibe', 300)
check('no fallback still uses the first account while cooling', names(pool, config) === 'Vibe', names(pool, config))

// --- disabled accounts are skipped ---
pool = new AccountPool()
config = baseConfig({
  accounts: accounts.map((account) => (account.name === 'Studio' ? { ...account, enabled: false } : account)),
  advanced: { priority: 'vibe-first' },
})
check('disabled accounts are skipped', names(pool, config) === 'Vibe,Extra', names(pool, config))

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL: ${failure}`)
  process.exit(1)
}
console.log('PASS: routing priority, promotion and the no-fallback mode')
