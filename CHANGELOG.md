# Changelog

Fork of [`01NGVI-QINGYI/dsh-mistral-pro`](https://github.com/01NGVI-QINGYI/dsh-mistral-pro), itself forked from
[`santera-pixel/dsh-mistral-pro`](https://github.com/santera-pixel/dsh-mistral-pro). Entries below are additions on
top of upstream `0.1.2`.

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
