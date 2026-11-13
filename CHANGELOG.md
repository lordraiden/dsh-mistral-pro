# Changelog

Fork of [`01NGVI-QINGYI/dsh-mistral-pro`](https://github.com/01NGVI-QINGYI/dsh-mistral-pro). Entries below are additions on top of upstream `0.1.2`.

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
