# Changelog

Fork of [`01NGVI-QINGYI/dsh-mistral-pro`](https://github.com/01NGVI-QINGYI/dsh-mistral-pro), itself forked from
[`santera-pixel/dsh-mistral-pro`](https://github.com/santera-pixel/dsh-mistral-pro). Entries below are additions on
top of upstream `0.1.2`.

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
