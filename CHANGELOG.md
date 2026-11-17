# Changelog

Fork of [`01NGVI-QINGYI/dsh-mistral-pro`](https://github.com/01NGVI-QINGYI/dsh-mistral-pro), itself forked from
[`santera-pixel/dsh-mistral-pro`](https://github.com/santera-pixel/dsh-mistral-pro). Entries below are additions on
top of upstream `0.1.2`.

## 0.9.0

### Cache diagnostics

- **The wire log records the affinity that was actually sent.** Every `request` line now carries the
  serving `account` and a 16-hex digest of the exact `x-affinity` value placed on the request (omitted
  when no header was sent), and the matching `usage` line carries the same `affinity` digest. The digest
  is read back from the headers handed to the transport, so a later change that derives the affinity from
  a different identity is visible in the log instead of being assumed. While the adapter sends the cache
  key as the affinity the digest equals the `conversation` digest; it diverges as soon as the two
  identities do. No raw header value, cache key, session id or prompt text is logged.
- **`/cache` breaks the hit rate down by account, model and routing identity.** New `byAccount`,
  `byModel` and `byAffinity` arrays report requests, prompt tokens, cached tokens and the token-weighted
  rate per group, busiest first, with a `null` group for unlabelled requests. `recent` entries gain
  `account`, `affinity` and `conversation`. Every pre-existing field keeps its meaning.
- **`steadyStateByRoute` is the cold-start-corrected rate when routing matters too.** `steadyState` keeps
  its original prompt-key-only grouping; the new view removes the first request of each
  `(account, model, affinity, prompt-key)` route, so an account failover, a model change or a key rotation
  after compaction is no longer counted as a warm miss. The model is part of the identity because a custom
  `prompt_cache_key` does not carry it, and the tuple is JSON-encoded so a delimiter inside an account name
  or model id cannot merge two routes. Both views are reported side by side rather than redefining the old
  metric.
- **The prefix diagnostic now compares against the previous request.** `prefixSha256` (a digest of
  everything but the new turn) was not stable across append-only turns, so it could not support the
  documented "unchanged digest means the provider evicted" rule. It is replaced by `prefixRelation`
  (`first` / `append` / `rewrite` / `repeat`) and `prefixReused` on the `request` line, computed by a
  bounded in-memory comparison with the previous request of the same conversation: only per-message
  digests are retained (first 512 messages, 32 most recently used conversations), never content. It
  distinguishes append-only growth from a rewritten prefix, is process-local, and is a request-structure
  diagnostic only — it cannot see the provider's tokenized prefix or cache placement.
- **The steady-state views are documented and labelled as window-relative.** `/cache` now reports `window`
  (`maxLines`, `entries`), and the README plus the statistics panel state that the request a steady-state
  view drops is the first one still visible in the retained 400-line log, not a proven cold start.
- **Missing usage is no longer a zero-cache response.** A `usage` line is written only for a completed
  response whose supplier reported a prompt count; an interrupted stream, a `usage: {}` chunk or a usage
  object without `prompt_tokens` leaves no record, so it cannot drag the hit rate down.
- Covered by `test/cache-diagnostics.mjs` (multiple accounts and models, affinity changes, account
  failover, compaction rotation, missing usage, privacy) and the updated `/cache` shape assertions.

## 0.8.2

### Security

- **The browser routes now require an authenticated Host session.** A Web carrier `resource` route
  gets no admission from the carrier, so `/usage`, `/cache`, `/wire`, `/test`, `/meta`, `/health`,
  `/settings`, `/refresh`, `/models` and `/client` were reachable by any caller that could reach the
  listener — including cross-site requests and DNS rebinding — and answered private account, usage
  and billing data. Every route now asks the composition's `connection` service for a rejection
  first (`requestRejection`): its Host/Origin fence and login-token cookie gate the request before
  any data is read. The guard fails closed — a composition without `connection` registers no route
  at all, a guard that throws refuses, and an in-process `readResource` read is answered only for an
  owner Peer. Covered by `test/route-admission.mjs`.

## 0.8.1

### Fixed

- **The Mistral Pro settings section no longer renders blank.** `applyRouting` was added as a
  `useCallback` below the settings component's loading/error early returns, so the hook count changed
  between the loading render and the ready render and React threw
  `Rendered more hooks than during the previous render`. It is now a plain function, which is safe
  because it is only used from click handlers. Covered by `test/settings-hooks.mjs`.

## 0.8.0

### Routing

- **Consumption priority.** `advanced.priority` selects `vibe-first`, `studio-first` or `auto`. The fixed
  modes pin the two key accounts and never promote a fallback; `auto` keeps the account that last worked
  first.
- **Automatic fallback is now wired.** `advanced.failover` was stored but never read; turning it off now
  returns only the first account, so a failure surfaces instead of switching keys.
- **Settings → Routing** exposes both controls next to the two key rows; changing the priority reorders
  the Vibe/Studio accounts so the account list never contradicts it, and their reorder arrows are
  disabled.
- Covered by `test/routing.mjs`.

## 0.7.0

### Two keys in Settings

- **Settings → Mistral Pro → Keys.** Two rows — **Vibe API key** (`MISTRAL_VIBE_KEY`, account `Vibe`,
  primary) and **Studio API key** (`MISTRAL_API_KEY`, account `Studio`, fallback) — each with Save and
  Test. Saving upserts the account and keeps Vibe before Studio; when Vibe answers 402 or 429 the adapter
  fails over to Studio. The key value is never shown again and never logged.

### Cache statistics

- **The six distribution rows are replaced.** The cache card now shows a stacked mix bar of the
  per-request hit-rate ranges with a compact counter legend, a sparkline of the last 20 requests (height is
  the hit rate, colour is the range, the tooltip shows model and percentage) and a one-line summary such as
  `18 of 20 requests ≥ 76% · 2 cold starts`. The remaining cache figures are unchanged.

## 0.6.2

### Fixed

- **Mistral's 402 `billing_api_budget_exhausted` is classified as QUOTA.** It used to fall through to
  INVALID_REQUEST, so the adapter neither failed over to the next account nor reported a quota condition.
  Covered by `test/error-classification.mjs`.

## 0.6.1

### Packaging

- **`repository`, `homepage` and `bugs` now point at the fork.** They still named the upstream
  `01NGVI-QINGYI/dsh-mistral-pro`, so a Git-source install failed the dshopen.org identity check and an
  npm publish would have been mapped to the upstream repository. No runtime change.

## 0.6.0

### Sidebar usage card and statistics panel

- **The composer usage pill is gone.** It showed only the Vibe budget, so it read 0% while the API wallet
  was being spent. The plugin now adds a card to the sidebar footer (`sidebar.footer.action`), in the same
  slot as Command Code.
- **One combined figure.** The card sums the used amounts and the budgets of both wallets and reports their
  ratio, with a two-colour bar: Vibe in `--dsw-alias-label-tertiary`, API in `--dsw-alias-label-primary`.
- **Click opens a statistics panel** in the layout's `main` slot: both wallets with reset countdowns,
  prepaid credits, month-to-date spend, the combined total, prompt-cache statistics (steady state,
  distribution, failovers, last request), configured accounts and the model count.
- **Settings.** `usage.display` now controls the sidebar card (`auto` / `always` / `off`);
  `usage.showCache` controls the cache card in the panel.
- **Cleanup.** Removed the `conversation.input.right` and `shell.overlay` registrations, the old popover,
  and the now-unused `@deepseek-ai/dsh-client-ui-conversation` client inject.

## 0.5.0

### Cache observability

- **#24 — `/cache` separates cold starts from warm requests.** New `steadyState` (the hit rate without each
  conversation's first request), `distribution` (per-request hit-rate buckets) and `recent[].hitRate`. The
  `usage` wire entry gains `conversation`, a 16-hex digest of `prompt_cache_key`; the raw key is never
  logged, and the field is omitted when the request carries none.
- **#25 — the wire log fingerprints the message prefix.** `prefixSha256` (everything except the new turn),
  `messages` and `prefixMessages` let `/wire` separate a rewritten prefix — an actionable bug — from a
  provider-side eviction, which is not observable from the client.
- **#26 — requests are attributed to an account.** `usage` entries carry `account` (the display name, else
  a digest of `apiKeyEnv`), a `failover` entry is appended per account switch, and `/cache` reports
  `failovers` and `coldAfterFailover`: prompt caches are per account, so the first request after a switch
  is a full miss by design.
- **#27 — the usage popover shows the prompt-cache hit rate.** Overall rate, cached / total prompt tokens
  and the last request, with a refresh action; `usage.showCache` (default on) hides the section.

### Tests

- `test/cache-metrics.mjs` and `test/prefix-fingerprint.mjs` added; `test/failover.mjs` extended with the
  account attribution and failover-entry assertions. 14 suites.

## 0.4.1

### Fixed

- **Token usage now follows DSH's disjoint buckets.** Mistral folds the cached prefix into
  `prompt_tokens`; the adapter reported that folded total as `inputTokens`, so `inputTokens +
  cacheReadTokens` counted the cached prefix twice. Two consequences: the session statistics' cache-hit
  percentage divided by the inflated prompt and showed roughly half the real rate (~50% for a conversation
  that was ~98% cached), and DSH's token meter rejected the attempt as inconsistent
  (`totalTokens - outputTokens < inputTokens + cacheReadTokens`), dropping turn usage and context
  pressure. `inputTokens` is now uncached input only, `cacheReadTokens` keeps the cached prefix, and the
  `/cache` route still divides by the total prompt count. Covered by `test/usage-accounting.mjs`.

### Docs and metadata

- README (EN/ZH/JA) restructured for discoverability: a real `#` heading, a table of contents, an
  "At a glance" table, a "Why this plugin" section, a stream-contract subsection and an FAQ. The
  per-version release notes moved out of the landing page and into this file.
- GitHub topics expanded to fourteen (`deepseek-harness`, `dsh`, `dsh-plugin`, `mistral`, `mistral-ai`,
  `mistral-vibe`, `llm-provider`, `model-provider`, `cordis`, `prompt-caching`) and the repository
  description rewritten bilingually; npm `keywords` expanded to match.

## 0.4.0

Closes the twelve audit issues opened against 0.3.0. Default provider behaviour is unchanged; the release
makes it tested, observable and documented, and adds the two cache behaviours the audit asked for.

### CI and tests

- **#1** — `npm test` runs every `test/*.mjs` suite through `test/run.mjs` and `npm run check` syntax-checks
  every shipped JS file. `.github/workflows/ci.yml` runs both on Node 22 and 24 for every push and pull
  request to `main`, installing the host-provided peer dependencies at an explicit version with `--no-save`.
- **#2** — new suites: `transport` (the native path posts the exact serialized body), `failover` (a 401 fails
  over before output; a mid-stream failure after a tool call does not), `stream-end` (a truncated stream
  raises `TRANSPORT`, an empty one `EMPTY_RESPONSE`), `retry` (the resolved, flattened, JSON-safe policy) and
  `shared-key` (the shared-key derivation and its stability).

### Prompt cache

- **#3** — `shared` falls back to the per-conversation `auto` derivation when the session has no
  system/developer message, instead of degenerating to a model-only key every conversation would share.
- **#4** — finding: DSH's `options.tools` order is canonical and stable for an unchanged tool set
  (`dsh-system-prompt` sorts by name, or uses a fixed configured `toolOrder`; `dsh-session` compares tool
  schemas in order). No code change.
- **#5** — the derived cache key (`auto` and `shared`) rotates once per context compaction, folding in the
  `compactionId` that DSH puts on the replacement user message (`source.kind === 'compact-checkpoint'`).
  Sessions that never compact keep a byte-identical derivation.
- **#6** — finding: `x-affinity` is undocumented and unverified. An A/B against the live API measured no
  difference (7/8 cache hits with the header vs 8/8 without; the only miss was the first cold call); it is
  kept as a possible routing hint, marked as unverified in the code, and the README no longer claims it pins
  requests to a server.

### Diagnostics and robustness

- **#7** — `GET /plugins/dsh-mistral-pro/cache` aggregates the wire log into `requests`, `promptTokens`,
  `cachedTokens` and `hitRate`, plus the 20 newest usage entries.
- **#8** — the wire log is created `0600` and an existing wider file is tightened on the next write; rotation
  keeps the mode.
- **#9** — `response_error` in the finish chunk is inspected: the recorded success shapes stay silent, a
  non-success shape is logged once, and an unusable tool call raises `MALFORMED_RESPONSE` (retryable) before
  the call is dispatched.

### UI and docs

- **#10** — `README.zh.md` and `README.ja.md` are back at parity with the English README.
- **#11** — `cache.affinity`, `cache.reportUsage` and `advanced.transport` are editable in
  Settings → Mistral Pro → Advanced, with labels in en, zh and ja.
- **#12** — `CONTRIBUTING.md` documents the upstream sync strategy (cherry-pick only, never merge upstream
  `main`) and the independent version policy.

### Upstream sync

- Upstream: [`01NGVI-QINGYI/dsh-mistral-pro`](https://github.com/01NGVI-QINGYI/dsh-mistral-pro) `0.1.2`
  (`263a4f0`, a single commit, no tags).
- Intermediate fork: [`santera-pixel/dsh-mistral-pro`](https://github.com/santera-pixel/dsh-mistral-pro)
  `0.2.0`–`0.2.4`.
- Patch series: [upstream issue #1](https://github.com/01NGVI-QINGYI/dsh-mistral-pro/issues/1)
  (`0.1.3`–`0.1.8`), applied by cherry-pick, never merged.
- This fork's `0.x` is independent of upstream's `0.x`: upstream `0.1.3` sorts below this fork's `0.3.0`, so
  version numbers are not comparable. See [CONTRIBUTING.md](CONTRIBUTING.md).

## 0.3.0

Merge of the two independent fix lineages that existed on top of upstream `0.1.2`:

- **`santera-pixel` 0.2.0-0.2.4** — `prompt_cache_key` + `x-affinity` + `stream_options.include_usage`,
  per-role wire-key allowlist, native `node:https` transport with an `advanced.transport` knob, the
  `/wire` diagnostic route, and the empty-tool-name fix.
- **upstream issue #1 patch series 0.1.3-0.1.8** — one `block-start` per block (F-3), `id` always a
  string on `tool-call-delta` (F-6), resolved/flattened retry policy (F-7), truncated stream raises
  `TRANSPORT` instead of ending clean (F-8), no injected `max_tokens` cap (F-9), per-conversation
  `prompt_cache_key` (F-10).

Reconciliation decisions:

- **One cache knob.** `advanced.promptCacheKey` (`'auto'` | `'shared'` | `'off'` | custom string,
  default `'auto'`) is the single setting, because it is the one the settings page exposes. The fork's
  `cache.promptCacheKey` and `lib/cache.js` were removed; `cache.affinity` and `cache.reportUsage`
  stay (config-only, no UI).
- **New `'shared'` cache-key mode.** `'auto'` derives a per-conversation key (model + system prompt +
  first user message), so a new conversation can never reuse the system-prompt prefix. `'shared'`
  derives the key from the model and the leading system prompt only, so separate conversations on the
  same model and system prompt share a cache namespace and the first turn of a new conversation can
  still hit the cached system-prompt prefix. The provider verifies prefix compatibility, so a shared
  key can only miss, never return another conversation's content.
- **Cache observability.** `/plugins/dsh-mistral-pro/wire` now records a `usage` entry per request with
  `promptTokens` and `cachedTokens`, so a hit rate can be measured without reading the session log.
- **`advanced.maxTokensCap` default is `0`** (no cap), from the upstream series. Reasoning shares the
  completion budget, so a cap that looks generous for text can be consumed by thinking alone.
- **Tool-call accumulation** uses the upstream first-wins rule (`id`/`name` only update when
  non-empty) and the fork's `incomingName` filtering; `tool-call-delta` always carries a string `id`.

Additional fix not present in either lineage:

- **Attempt state was shadowed inside `onTool`.** `const state = toolState.get(...)` shadowed the
  attempt state passed to `streamWithAccount`, so `state.emitted` was never set for tool calls and a
  mid-stream failure after a tool call could still trigger account failover and splice two accounts'
  output into one turn. The local is now `tool`, and the attempt state is committed explicitly.

Regression suite: `test/tool-name.mjs` (captured partner-model stream) and `test/merged.mjs`
(cache key, usage reporting, output cap, retry policy shape, wire keys, tool name, attempt state).

## 0.2.4

**Fix: tool calls arrived with an empty name.**

Mistral streams the function name exactly once, on the first `tool_calls` chunk, and then repeats `function.name: ""` on every following chunk of the same call:

```
data: {"choices":[{"delta":{"tool_calls":[{"id":"chatcmpl-tool-…","type":"function","function":{"name":"run_shell","arguments":""},"index":0}]}}]}
data: {"choices":[{"delta":{"tool_calls":[{"function":{"name":"","arguments":"{\"command\": \""},"index":0}]}}]}
```

The adapter took each delta literally (`if (delta.name !== undefined) state.name = delta.name`), so the repeated empty string erased the name it already had. The harness then persisted a tool call named `''` and every dispatch failed with `unknown tool`. Non-streaming responses are unaffected, which is why only the streaming path broke.

The adapter now accepts only a non-empty name and forwards the retained name on each `tool-call-delta`.

Regression test: `test/tool-name.mjs` replays a captured stream (fixture from a live `deepseek-v4-1-flash-1017` response) and asserts the block-end event carries `name: "run_shell"` and the full arguments. Fails on 0.2.3, passes on 0.2.4.

## 0.2.3

`advanced.transport` (`https` | `fetch`, default `https`). Set it to `fetch` when another plugin in the fetch path must stay in the loop; the native `node:https` transport bypasses fetch wrappers entirely. `DSH_MISTRAL_TRANSPORT=fetch` overrides for one process.

## 0.2.2

- Native `node:https` transport (`lib/transport.js`) so the request body reaches Mistral exactly as the adapter serialized it, even when `globalThis.fetch` is patched by another plugin.
- `lib/wire.js` fingerprint ring buffer plus the `/plugins/dsh-mistral-pro/wire` route for inspecting what actually went on the wire.

## 0.2.1

Per-role wire-key allowlist (`WIRE_KEYS`): assistant messages may only carry `role`, `content`, `tool_calls`. Mistral rejects any extra key with `422 extra_forbidden`, `reasoning_content` in particular.

## 0.2.0

- `prompt_cache_key` on every request (`dsh-` + sha256 of `hostname:username`, override with `cache.promptCacheKey`).
- Matching `x-affinity` header, and `stream_options: { include_usage: true }` so cached-token counts arrive.
