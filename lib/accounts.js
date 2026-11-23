/**
 * Account ordering, credential resolution and failover cooldowns.
 *
 * The configuration order is the primary order. A successful fallback is
 * promoted in memory for the rest of the process lifetime, so a session that
 * lost its primary account keeps using the account that actually works without
 * rewriting the user's profile. Cooldowns are memory-only for the same reason.
 */
import { LlmError } from '@deepseek-ai/dsh-llm'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'

const PKG = 'dsh-mistral-pro'

/**
 * Characters an HTTP header value carries verbatim and every provider key uses:
 * printable ASCII, space excluded. A key outside this set cannot reach any
 * provider, so this is a transport invariant rather than one provider's policy.
 */
const LEGAL_API_KEY = /^[\x21-\x7E]+$/

/**
 * Validate one supplied API key, trimming surrounding whitespace first.
 *
 * Local copy of the check `@deepseek-ai/dsh-llm` exported as
 * `assertUsableApiKey` through 0.2.2-rc.5. That export was removed in
 * 0.2.3-alpha.2, while the transport invariant it enforces has not changed, so
 * keeping the check here lets the plugin load on both releases instead of
 * pinning itself to one. The key never enters the message: `ref` names where to
 * fix it.
 * @param raw - the credential exactly as supplied.
 * @param pkg - the refusing package name, prefixed to the diagnostic.
 * @param ref - the credential reference the value resolved through.
 * @returns the trimmed, usable key.
 */
function assertUsableApiKey(raw, pkg, ref) {
  const value = typeof raw === 'string' ? raw.trim() : ''
  if (value.length === 0) {
    throw new LlmError(
      `${pkg}: the API key resolved from ${ref} is blank; set ${ref} to the raw key`
        + ' (the web Models page writes it) or export it in the launching environment',
      'INVALID_CREDENTIAL',
    )
  }
  if (!LEGAL_API_KEY.test(value)) {
    throw new LlmError(
      `${pkg}: the API key resolved from ${ref} contains characters no HTTP header can carry;`
        + ` set ${ref} to the raw key alone (the web Models page writes it)`,
      'INVALID_CREDENTIAL',
    )
  }
  return value
}

/**
 * Resolve one account's API key through the credential seam.
 * @param ctx - plugin context (may or may not mount `credentials`).
 * @param account - normalized account.
 * @returns the usable key.
 * @throws LlmError MISSING_CREDENTIAL or INVALID_CREDENTIAL.
 */
export async function resolveAccountKey(ctx, account) {
  const credentials = ctx.get('credentials')
  if (credentials !== undefined) {
    const hit = await credentials.resolve(account.apiKeyEnv)
    if (hit !== undefined && hit.value.length > 0) {
      return assertUsableApiKey(hit.value, PKG, account.apiKeyEnv)
    }
  } else {
    const ambient = launchEnvironmentOf(ctx).get(account.apiKeyEnv)
    if (ambient !== undefined && ambient.value.length > 0) {
      return assertUsableApiKey(ambient.value, PKG, account.apiKeyEnv)
    }
  }
  throw new LlmError(
    `${PKG}: no API key for account "${account.name}"; store ${account.apiKeyEnv} through the credentials service (the Mistral Pro settings page writes it), or export it in the launching environment`,
    'MISSING_CREDENTIAL',
  )
}

/** Read the admin cookie used by the usage service; undefined when absent. */
export async function resolveAdminCookie(ctx, ref) {
  const credentials = ctx.get('credentials')
  if (credentials !== undefined) {
    const hit = await credentials.resolve(ref)
    if (hit !== undefined && hit.value.trim() !== '') return hit.value.trim()
    return undefined
  }
  const ambient = launchEnvironmentOf(ctx).get(ref)
  if (ambient !== undefined && ambient.value.trim() !== '') return ambient.value.trim()
  return undefined
}

/** Memory-only account health. */
export class AccountPool {
  constructor() {
    this.cooldowns = new Map()
    this.promoted = undefined
  }

  /** Try order: promoted account first, then configuration order. */
  ordered(config) {
    const enabled = config.accounts.filter((account) => account.enabled)
    if (this.promoted === undefined) return enabled
    const index = enabled.findIndex((account) => account.name === this.promoted)
    if (index <= 0) return enabled
    return [enabled[index], ...enabled.slice(0, index), ...enabled.slice(index + 1)]
  }

  /**
   * Accounts to attempt for one request, cooling ones moved to the back.
   *
   * `advanced.priority` decides the base order: `vibe-first` and
   * `studio-first` pin the two key accounts and never promote a fallback;
   * `auto` keeps the promoted account first. `advanced.failover: false`
   * returns only the first account, so a failure surfaces instead of moving
   * to the next one.
   */
  attemptOrder(config) {
    const enabled = config.accounts.filter((account) => account.enabled)
    const priority = config.advanced?.priority ?? 'auto'
    const failover = config.advanced?.failover !== false
    let base
    if (priority === 'auto') {
      base = this.ordered(config)
    } else {
      const first = priority === 'studio-first' ? 'Studio' : 'Vibe'
      const second = first === 'Vibe' ? 'Studio' : 'Vibe'
      const rank = (account) => (account.name === first ? 0 : account.name === second ? 1 : 2)
      // Array#sort is stable, so other accounts keep their configured order.
      base = [...enabled].sort((left, right) => rank(left) - rank(right))
    }
    // No fallback means no second account at all: the first one is used even
    // while it cools down, so a failure surfaces instead of switching keys.
    if (!failover) return base.slice(0, 1)
    const now = Date.now()
    const ready = base.filter((account) => (this.cooldowns.get(account.name) ?? 0) <= now)
    const cooling = base.filter((account) => (this.cooldowns.get(account.name) ?? 0) > now)
    return [...ready, ...cooling]
  }

  coolingUntil(name) {
    const until = this.cooldowns.get(name)
    return until !== undefined && until > Date.now() ? until : undefined
  }

  markFailure(name, cooldownSeconds) {
    if (cooldownSeconds <= 0) return
    this.cooldowns.set(name, Date.now() + cooldownSeconds * 1000)
  }

  markSuccess(name) {
    this.cooldowns.delete(name)
    this.promoted = name
  }

  describe(config) {
    return this.ordered(config).map((account) => ({
      name: account.name,
      apiKeyEnv: account.apiKeyEnv,
      baseURL: account.baseURL,
      enabled: account.enabled,
      coolingUntil: this.coolingUntil(account.name) ?? null,
      primary: this.promoted === account.name,
    }))
  }
}
