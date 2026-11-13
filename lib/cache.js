/**
 * Prompt-cache identity for Mistral.
 *
 * Mistral keys its prompt cache by the request prefix and by `prompt_cache_key`.
 * Two calls that carry the same key and the same prefix are served from cache and
 * report the hit in `usage.prompt_tokens_details.cached_tokens`.
 *
 * Without a key the cache is not addressable: every turn starts cold, cached_tokens
 * stays 0, and the usage pill looks as if caching were disabled. DSH hands the
 * adapter no conversation id, so the default identity is derived from the
 * installation and stays constant across turns and restarts.
 */
import { createHash } from 'node:crypto'
import { hostname, userInfo } from 'node:os'

function digest(value) {
  return createHash('sha256').update(value).digest('hex')
}

/**
 * Key for this installation. Stable across restarts and distinct between
 * machines, which is all a cache key has to be: it routes lookups, it does not
 * authenticate anything, and the hash hides the inputs.
 */
export function defaultPromptCacheKey() {
  let user = 'unknown'
  try {
    user = userInfo().username
  } catch {
    // Some sandboxes hide the user database; the hostname alone is still stable.
  }
  return `dsh-${digest(`${hostname()}:${user}`).slice(0, 32)}`
}

/** A configured key wins; an empty one falls back to the installation key. */
export function promptCacheKeyFor(config) {
  const configured = config?.cache?.promptCacheKey
  if (typeof configured === 'string' && configured.trim() !== '') return configured.trim()
  return defaultPromptCacheKey()
}
