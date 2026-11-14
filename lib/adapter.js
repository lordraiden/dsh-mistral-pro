/**
 * OpenAI-compatible streaming adapter for Mistral's inference API.
 *
 * One stream is one provider attempt per account: the adapter walks the
 * configured account order, and only a failure that happens before any visible
 * content reaches the user may move to the next account. Once text, reasoning
 * or a tool call has been emitted the attempt is committed, so a mid-stream
 * provider error surfaces as a terminal failure instead of spliced output.
 */
import {
  LlmAdapter,
  LlmError,
  attributionHeaders,
  isContextWindowExceededError,
  isQuotaExceededError,
  resolveRetryPolicy,
} from '@deepseek-ai/dsh-llm'
import { createHash } from 'node:crypto'
import { DISPLAY_NAME } from './config.js'
import { listModels as catalogListModels, resolveModelInfo, outputCap } from './catalog.js'
import { resolveAccountKey } from './accounts.js'
import { postJson } from './transport.js'
import { appendWire, fingerprint, reasoningCount, summarizeMessages } from './wire.js'

const PKG = 'dsh-mistral-pro'
const MAX_ERROR_BODY = 4096

/** Failures that justify trying the next account before any output. */
const FAILOVER_CODES = new Set(['AUTH', 'RATE_LIMIT', 'QUOTA', 'MISSING_CREDENTIAL', 'INVALID_CREDENTIAL'])

export class MistralProAdapter extends LlmAdapter {
  /**
   * @param options.ctx - plugin context, used for credentials and attachments.
   * @param options.readConfig - returns the current normalized configuration.
   * @param options.pool - account ordering and cooldown state.
   * @param options.discovered - live model ids discovered from the provider.
   */
  constructor({ ctx, readConfig, pool, discovered }) {
    super()
    this.ctx = ctx
    this.readConfig = readConfig
    this.pool = pool
    this.discovered = discovered
  }

  providerInfo(provider) {
    return { id: provider, name: DISPLAY_NAME }
  }

  providerRetryPolicy(provider) {
    // F-7 fix: the adapter's returned policy object is used AS-IS by dsh-llm
    // (`adapter.providerRetryPolicy(provider) ?? resolveRetryPolicy(...)` only
    // falls back when the adapter returns undefined), and dsh-llm-retry reads
    // `policy.initialDelayMs` / `policy.maxDelayMs` / `policy.jitterRatio` at
    // the TOP level. Returning the *config* shape with a nested `backoff`
    // object made `localDelay` compute `Math.min(undefined * 2**n, undefined)`
    // = NaN, and the harness session log rejects non-finite numbers, so the
    // FIRST transient provider failure (timeout, transport reset, 5xx, 429)
    // died with `session event "llm/retry" carries non-JSON-serializable data`
    // instead of being retried — long generations failed far more often, which
    // is why the bug correlated with max-effort / large outputs. Run the
    // declared values through the SDK's own resolver, which validates, applies
    // defaults, and flattens backoff into the ResolvedNormalRetryPolicy shape
    // (same pattern as the reference provider dsh-llm-deepseek).
    return resolveRetryPolicy(
      {
        mode: 'normal',
        maxRetries: 3,
        retryableCodes: ['RATE_LIMIT', 'SERVER', 'TIMEOUT', 'TRANSPORT', 'EMPTY_RESPONSE'],
        backoff: { initialDelayMs: 800, maxDelayMs: 15000, jitterRatio: 0.2 },
      },
      `${PKG}: retryPolicy`,
    )
  }

  async listModels(provider) {
    return catalogListModels(this.readConfig(), this.discovered.models)
  }

  async resolveModel(provider, model) {
    return resolveModelInfo(model, this.readConfig(), this.discovered.models)
  }

  async prepareCall(provider, model, signal) {
    const info = await this.resolveModel(provider, model, signal)
    return { model: info, stream: (options) => this.stream(options) }
  }

  /**
   * Stream one model call, failing over between accounts until one produces output.
   * @param options - the `llm` service request.
   */
  async *stream(options) {
    const config = this.readConfig()
    const model = resolveModelInfo(options.model, config, this.discovered.models)
    const messages = await this.toMessages(options.messages, config)
    const body = this.buildBody(options, model, config, messages)
    const attempts = this.pool.attemptOrder(config)

    if (attempts.length === 0) {
      throw new LlmError(`${PKG}: no enabled Mistral account is configured`, 'MISSING_CREDENTIAL')
    }

    let lastError
    for (const account of attempts) {
      let apiKey
      try {
        apiKey = await resolveAccountKey(this.ctx, account)
      } catch (error) {
        lastError = error
        continue
      }
      // Visible output commits the attempt: only a failure before the first
      // emitted block may move to the next account.
      const state = { emitted: false }

      const controller = new AbortController()
      const onAbort = () => controller.abort(options.signal?.reason)
      if (options.signal !== undefined) {
        if (options.signal.aborted) throw options.signal.reason
        options.signal.addEventListener('abort', onAbort, { once: true })
      }
      const deadline = setTimeout(() => controller.abort(new Error('request timeout')), config.advanced.requestTimeoutMs)

      try {
        yield* this.streamWithAccount({ options, config, model, body, account, apiKey, controller, state })
        this.pool.markSuccess(account.name)
        return
      } catch (error) {
        const failover = !state.emitted && this.shouldFailover(error)
        if (failover) {
          this.pool.markFailure(account.name, config.advanced.cooldownSeconds)
          lastError = error
          continue
        }
        throw error
      } finally {
        clearTimeout(deadline)
        if (options.signal !== undefined) options.signal.removeEventListener('abort', onAbort)
      }
    }

    throw lastError ?? new LlmError(`${PKG}: every configured account failed`, 'AUTH')
  }

  shouldFailover(error) {
    if (!(error instanceof LlmError)) return false
    return FAILOVER_CODES.has(error.code)
  }

  buildBody(options, model, config, messages) {
    const body = {
      model: model?.wireId ?? options.model,
      messages: messages.map(sanitizeMessage),
      stream: true,
    }
    // F-9 fix: `max_tokens` is only sent when something actually asked for a
    // cap (host `maxTokens`, or an explicit `advanced.maxTokensCap`). The
    // previous behavior injected `min(65536, …)` into EVERY request through
    // the model info's `defaultMaxTokens`, and partner reasoning models spend
    // that same completion budget on thinking: with `effort=max` the injected
    // cap could be consumed by reasoning alone, the provider answered
    // `finish_reason: "length"`, and the harness ends a `max-tokens` turn
    // SILENTLY (no error, no notice) — the user saw thinking and then nothing,
    // or the text's last line with no tool call after it. Omitting the field
    // lets the provider apply its own full output budget.
    const maxTokens = options.maxTokens ?? outputCap(model, config)
    if (Number.isFinite(maxTokens) && maxTokens > 0) {
      body.max_tokens = Math.min(Math.floor(maxTokens), model.maxTokens ?? maxTokens)
    }
    if (Number.isFinite(options.temperature)) body.temperature = options.temperature
    if (Array.isArray(options.stop) && options.stop.length > 0) body.stop = options.stop
    if (Array.isArray(options.tools) && options.tools.length > 0) {
      body.tools = options.tools.map((tool) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      }))
      body.tool_choice = 'auto'
    }
    const effort = options.reasoningEffort
    if (typeof effort === 'string' && model.reasoning !== undefined) {
      const supported = model.reasoning.efforts.some((entry) => entry.id === effort)
      if (supported) body.reasoning_effort = effort
    }
    if (config.cache.reportUsage) {
      body.stream_options = { include_usage: true }
    }
    // F-10 fix: Mistral's prompt caching is explicit — the documented chat
    // parameter `prompt_cache_key` (string|null) is what routes a request to a
    // cache shard, and the docs tell integrators to "use the same key for
    // requests with shared prompt prefixes, such as multi-turn conversations".
    // 'auto' derives a stable hash of the request's stable prefix (model id +
    // system message + first message), so appended turns keep the same key
    // while different conversations naturally shard apart; reasoning effort,
    // temperature and max_tokens are deliberately NOT part of the key so
    // changing them mid-conversation cannot evict the prefix. Cache keys never
    // affect content: Mistral still verifies prefix compatibility, so a key
    // collision can only miss, never poison.
    const cacheSetting = config.advanced.promptCacheKey
    if (cacheSetting !== 'off') {
      // A compaction rewrites the conversation prefix, so the cached prefix the
      // old key pointed at no longer exists. Rotate the derived key once per
      // compaction (the newest checkpoint id) instead of inserting the new
      // prefix under the stale key. Custom string keys are user-managed and
      // pass through unchanged.
      const generation = compactionGeneration(options.messages)
      body.prompt_cache_key =
        cacheSetting === 'auto'
          ? autoPromptCacheKey(body.model, messages, generation)
          : cacheSetting === 'shared'
            ? sharedPromptCacheKey(body.model, messages, generation)
            : cacheSetting
    }
    return body
  }

  async toMessages(messages, config) {
    const out = []
    for (const message of messages) {
      if (message.role === 'system' || message.role === 'developer') {
        out.push({ role: 'system', content: this.textOf(message.content) })
        continue
      }
      if (message.role === 'user') {
        out.push({ role: 'user', content: await this.userContent(message.content, config) })
        continue
      }
      if (message.role === 'assistant') {
        out.push(this.assistantMessage(message))
        continue
      }
      if (message.role === 'tool') {
        out.push({
          role: 'tool',
          tool_call_id: message.toolCallId,
          content: this.textOf(message.content),
        })
      }
    }
    return out
  }

  textOf(blocks) {
    return (blocks ?? [])
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('')
  }

  async userContent(blocks, config) {
    const parts = []
    for (const block of blocks ?? []) {
      if (block.type === 'text') {
        parts.push({ type: 'text', text: block.text })
      } else if (block.type === 'image') {
        const url = await this.imageURL(block)
        if (url !== undefined) parts.push({ type: 'image_url', image_url: { url } })
        else parts.push({ type: 'text', text: '[image omitted: attachment service unavailable]' })
      } else if (block.type === 'file') {
        parts.push({ type: 'text', text: `[file: ${block.attachment?.name ?? 'attachment'}]` })
      }
    }
    if (parts.length === 1 && parts[0].type === 'text') return parts[0].text
    return parts
  }

  assistantMessage(message) {
    const reasoning = (message.content ?? [])
      .filter((block) => block.type === 'reasoning')
      .map((block) => block.text)
      .join('')
    const text = this.textOf(message.content)
    const toolCalls = (message.content ?? [])
      .filter((block) => block.type === 'tool-call')
      .map((block) => ({
        id: block.id,
        type: 'function',
        function: { name: block.name, arguments: block.arguments },
      }))
    const content = []
    if (reasoning !== '') content.push({ type: 'thinking', thinking: [{ type: 'text', text: reasoning }] })
    if (text !== '') content.push({ type: 'text', text })
    const result = { role: 'assistant', content: content.length === 0 ? '' : content }
    if (toolCalls.length > 0) result.tool_calls = toolCalls
    return result
  }

  async imageURL(block) {
    const attachments = this.ctx.get('attachments')
    if (attachments === undefined) return undefined
    try {
      const stored = await attachments.readImage(block.attachment)
      const mediaType = stored.ref?.mediaType ?? block.attachment?.mediaType ?? 'image/png'
      const base64 = Buffer.from(stored.data).toString('base64')
      return `data:${mediaType};base64,${base64}`
    } catch {
      return undefined
    }
  }

  async *streamWithAccount({ options, config, model, body, account, apiKey, controller, state }) {
    const headers = {
      ...attributionHeaders(),
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
      accept: 'text/event-stream',
      ...(config.cache.affinity && typeof body.prompt_cache_key === 'string'
        ? { 'x-affinity': body.prompt_cache_key }
        : {}),
    }
    const endpoint = `${account.baseURL}/chat/completions`
    const payload = JSON.stringify(body)
    const startedAt = Date.now()
    appendWire({
      event: 'request',
      endpoint,
      model: body.model,
      bytes: Buffer.byteLength(payload, 'utf8'),
      messages: Array.isArray(body.messages) ? body.messages.length : 0,
      reasoning: reasoningCount(body.messages),
      layout: summarizeMessages(body.messages),
      sha256: fingerprint(payload),
    })
    let response
    try {
      response = await postJson(endpoint, {
        headers,
        body: payload,
        signal: controller.signal,
        transport: config.advanced.transport,
        ...(await this.dispatcher(config)),
      })
    } catch (error) {
      if (options.signal?.aborted === true) throw options.signal.reason
      if (controller.signal.aborted) {
        throw new LlmError(`${PKG}: request to ${account.baseURL} timed out`, 'TIMEOUT', { cause: error })
      }
      throw new LlmError(`${PKG}: transport failure reaching ${account.baseURL}: ${errorMessage(error)}`, 'TRANSPORT', {
        cause: error,
      })
    }

    appendWire({
      event: 'response',
      model: body.model,
      status: response.status,
      requestId: response.headers.get('x-request-id') ?? null,
      ms: Date.now() - startedAt,
      sha256: fingerprint(payload),
    })

    if (!response.ok) {
      const text = await safeText(response)
      const failure = classifyHttpFailure(response.status, text, response.headers.get('x-request-id') ?? undefined)
      throw failure
    }

    const reader = response.body?.getReader()
    if (reader === undefined) {
      throw new LlmError(`${PKG}: provider returned an empty response body`, 'EMPTY_RESPONSE', { status: response.status })
    }

    const decoder = new TextDecoder()
    let buffer = ''
    let reasoning = ''
    let text = ''
    let reasoningIndex = -1
    let textIndex = -1
    const toolBlocks = new Map()
    const toolState = new Map()
    let nextIndex = 0
    let finishReason
    let responseError
    let sawDone = false
    let usage
    let idleTimer

    const armIdle = () => {
      if (idleTimer !== undefined) clearTimeout(idleTimer)
      idleTimer = setTimeout(() => controller.abort(new Error('stream idle timeout')), config.advanced.streamIdleTimeoutMs)
    }

    try {
      armIdle()
      let finished = false
      for (;;) {
        if (finished) break
        let chunk
        try {
          chunk = await reader.read()
        } catch (error) {
          if (options.signal?.aborted === true) throw options.signal.reason
          if (controller.signal.aborted) {
            throw new LlmError(`${PKG}: stream from ${account.baseURL} stalled`, 'TIMEOUT', { cause: error })
          }
          throw new LlmError(`${PKG}: stream from ${account.baseURL} failed: ${errorMessage(error)}`, 'TRANSPORT', {
            cause: error,
          })
        }
        if (chunk.done) break
        armIdle()
        buffer += decoder.decode(chunk.value, { stream: true })

        let newline
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline).trim()
          buffer = buffer.slice(newline + 1)
          if (line === '' || line.startsWith(':')) continue
          if (!line.startsWith('data:')) continue
          const payload = line.slice(5).trim()
          if (payload === '[DONE]') {
            sawDone = true
            buffer = ''
            finished = true
            break
          }
          let json
          try {
            json = JSON.parse(payload)
          } catch {
            continue
          }
          const events = this.handleChunk(json, {
            onReasoning: (delta) => {
              // F-3 fix: emit `block-start` only when the block is opened. The
              // live conversation UI (dsh-client-ui-chat) resets a block to empty
              // on EVERY `block-start`, so re-emitting it per delta wipes the
              // visible reasoning text on each chunk and collapses the thinking
              // panel. The reference provider (dsh-llm-deepseek) emits
              // `block-start` exactly once per block index.
              const events = []
              if (reasoningIndex < 0) {
                reasoningIndex = nextIndex++
                events.push({ type: 'block-start', index: reasoningIndex, blockType: 'reasoning' })
              }
              reasoning += delta
              state.emitted = true
              events.push({ type: 'reasoning-delta', index: reasoningIndex, text: delta })
              return events
            },
            onText: (delta) => {
              // F-3 fix: same contract as onReasoning — one `block-start` per block.
              const events = []
              if (textIndex < 0) {
                textIndex = nextIndex++
                events.push({ type: 'block-start', index: textIndex, blockType: 'text' })
              }
              text += delta
              state.emitted = true
              events.push({ type: 'text-delta', index: textIndex, text: delta })
              return events
            },
            onTool: (delta) => {
              // Mistral streams the function name once (first chunk) and then repeats
              // `name: ""` on every following chunk. Taking those literally would erase
              // the name we already have, so only a non-empty name is accepted.
              const incomingName = typeof delta.name === 'string' && delta.name !== '' ? delta.name : undefined
              let blockIndex = toolBlocks.get(delta.toolIndex)
              const events = []
              if (blockIndex === undefined) {
                blockIndex = nextIndex++
                toolBlocks.set(delta.toolIndex, blockIndex)
                toolState.set(delta.toolIndex, { id: delta.id, name: incomingName, arguments: '' })
                events.push({ type: 'block-start', index: blockIndex, blockType: 'tool-call' })
              }
              const tool = toolState.get(delta.toolIndex)
              // F-5 fix: only non-empty id/name may update the accumulated state.
              // Some OpenAI-compatible proxies (Mistral partner models) deviate
              // from the OpenAI spec and repeat `name`/`id` as null or "" on
              // continuation chunks instead of omitting the fields; accepting
              // empty values turns the executed call into `unknown tool ""`.
              if (delta.id !== undefined && delta.id !== '') tool.id = delta.id
              // First valid name wins: continuation chunks may repeat the name
              // as ""/null (Mistral partner models) or, hypothetically, carry
              // partial fragments — either way later non-empty values are not
              // allowed to replace the one the call was announced with.
              if (incomingName !== undefined && tool.name === undefined) tool.name = incomingName
              tool.arguments += delta.argumentsDelta
              // The attempt is committed once a tool call is visible: a failure
              // after this point must surface as a terminal error, never as a
              // failover that splices a second account's output into the turn.
              // (The local `tool` object used to shadow this attempt state, so
              // `state.emitted` was never set for tool calls.)
              state.emitted = true
              // F-6 fix: the harness stream contract requires `id` to be a
              // string on EVERY `tool-call-delta` — dsh-llm's
              // AssistantStreamAccumulator throws
              // `TypeError: tool-call-delta id must be a string` on a missing
              // id, which kills the turn mid-tool-call right after the model
              // announced it. Partner models may open a tool call with no id at
              // all, so fall back to `""`: the accumulator explicitly tolerates
              // an empty id, live consumers keep the previous one, and the
              // closing `block-end` always carries the final id. The name is
              // emitted as the stable accumulated value (instead of the raw
              // delta) so identical repeats compress in the replay stream and
              // empty continuation names never clear a shown name.
              events.push({
                type: 'tool-call-delta',
                index: blockIndex,
                id: tool.id ?? '',
                ...(tool.name === undefined || tool.name === '' ? {} : { name: tool.name }),
                argumentsDelta: delta.argumentsDelta,
              })
              return events
            },
            onFinish: (reason) => {
              finishReason = reason
              return []
            },
            onResponseError: (value) => {
              // Keep the last reported object: Mistral attaches it to the
              // finish chunk, and a stream can only finish once.
              responseError = value
              return []
            },
            onUsage: (value) => {
              usage = value
              return []
            },
          })
          for (const event of events) yield event
        }
      }
    } finally {
      if (idleTimer !== undefined) clearTimeout(idleTimer)
      try {
        await reader.cancel()
      } catch {
        // The reader is already closed or cancelled; nothing to release.
      }
    }

    // F-8 fix: a stream that closes without `[DONE]` and without any
    // `finish_reason` was cut mid-generation (provider drop, proxy timeout,
    // connection reset). Breaking out of the read loop as if it were a clean
    // end made the turn COMPLETE SILENTLY with whatever partial content had
    // already streamed — thinking with no answer after it, or the text's last
    // line with the tool calls that were about to follow. The harness treats
    // that as a normal `stop` finish: no retry, no error, nothing. The
    // reference provider (dsh-llm-deepseek) throws in exactly this situation
    // ("stream ended before message_stop"); mirror it with a retryable
    // TRANSPORT code so dsh-llm-retry re-runs the request as a fresh attempt
    // (the partial attempt is settled durably as `assistant/attempt` and is
    // never spliced into the retry).
    if (!sawDone && finishReason === undefined) {
      throw new LlmError(
        `${PKG}: stream from ${account.baseURL} ended before a terminal [DONE]/finish_reason (connection closed mid-generation)`,
        'TRANSPORT',
      )
    }

    if (!state.emitted && (reasoning === '' && text === '' && toolState.size === 0)) {
      throw new LlmError(`${PKG}: provider completed without producing any content`, 'EMPTY_RESPONSE')
    }

    // Mistral's finish chunk can carry a `response_error` validation report.
    // Observed success shapes are `format_error: null` with only `valid_*`
    // markers in `content_validation` / `tool_calls_validation` (both arrays may
    // be empty); `extra_tags` is `[]` in every observed payload and its
    // non-empty meaning is undocumented, so it is never treated as a failure.
    // A non-success shape is logged exactly once per stream. When the turn
    // finished as `tool_calls`, the call itself is unusable: throw before the
    // tool-call `block-end` is yielded so a broken call is never dispatched.
    const malformed = describeResponseError(responseError)
    if (malformed !== undefined) {
      this.ctx?.logger?.warn?.(`${PKG}: provider reported a malformed response: ${malformed}`)
      if (finishReason === 'tool_calls') {
        throw new LlmError(`${PKG}: provider reported a malformed tool call: ${malformed}`, 'MALFORMED_RESPONSE')
      }
    }

    for (const [toolIndex, blockIndex] of toolBlocks) {
      const state = toolState.get(toolIndex)
      yield {
        type: 'block-end',
        index: blockIndex,
        block: { type: 'tool-call', id: state.id ?? `call-${blockIndex}`, name: state.name ?? '', arguments: state.arguments },
      }
    }
    if (textIndex >= 0) yield { type: 'block-end', index: textIndex, block: { type: 'text', text } }
    if (reasoningIndex >= 0) yield { type: 'block-end', index: reasoningIndex, block: { type: 'reasoning', text: reasoning } }
    if (usage !== undefined) {
      // Cache observability: `cached_tokens` is the only signal that says whether
      // the prefix actually hit, and it is billed at 10% of the input price.
      appendWire({
        event: 'usage',
        model: body.model,
        promptTokens: usage.inputTokens,
        cachedTokens: usage.cacheReadTokens,
        sha256: fingerprint(payload),
      })
      yield { type: 'usage', usage }
    }
    const kind = toolState.size > 0 ? 'tool-calls' : finishReason === 'length' ? 'max-tokens' : 'stop'
    yield { type: 'finish', reason: { kind } }
  }

  /** Translate one OpenAI-compatible SSE payload into adapter events. */
  handleChunk(json, sink) {
    if (json?.usage !== null && typeof json?.usage === 'object') {
      sink.onUsage({
        inputTokens: numberOrZero(json.usage.prompt_tokens),
        outputTokens: numberOrZero(json.usage.completion_tokens),
        totalTokens: numberOrZero(json.usage.total_tokens),
        cacheReadTokens: numberOrZero(json.usage.prompt_tokens_details?.cached_tokens),
      })
    }
    const choice = Array.isArray(json?.choices) ? json.choices[0] : undefined
    if (choice === undefined) return []
    const delta = choice.delta ?? {}
    const events = []

    if (typeof delta.reasoning_content === 'string' && delta.reasoning_content !== '') {
      events.push(...sink.onReasoning(delta.reasoning_content))
    }
    if (typeof delta.reasoning === 'string' && delta.reasoning !== '') {
      events.push(...sink.onReasoning(delta.reasoning))
    }

    const content = delta.content
    if (typeof content === 'string' && content !== '') {
      events.push(...sink.onText(content))
    } else if (Array.isArray(content)) {
      for (const part of content) {
        if (part?.type === 'text' && typeof part.text === 'string' && part.text !== '') {
          events.push(...sink.onText(part.text))
        } else if (part?.type === 'thinking') {
          for (const inner of part.thinking ?? []) {
            if (typeof inner?.text === 'string' && inner.text !== '') events.push(...sink.onReasoning(inner.text))
          }
        }
      }
    }

    if (Array.isArray(delta.tool_calls)) {
      for (const call of delta.tool_calls) {
        // F-5 fix: tolerate spec deviations seen from Mistral partner models —
        // `function.name: null` on chunks, empty-string id/name repeats, and
        // the name flattened onto the call object instead of `function.name`.
        const fn = typeof call.function === 'object' && call.function !== null ? call.function : {}
        const nestedName = typeof fn.name === 'string' && fn.name !== '' ? fn.name : undefined
        const flatName = typeof call.name === 'string' && call.name !== '' ? call.name : undefined
        events.push(
          ...sink.onTool({
            toolIndex: Number.isInteger(call.index) ? call.index : 0,
            id: typeof call.id === 'string' && call.id !== '' ? call.id : undefined,
            name: nestedName ?? flatName,
            argumentsDelta: typeof fn.arguments === 'string' ? fn.arguments : '',
          }),
        )
      }
    }

    if (choice.finish_reason !== null && choice.finish_reason !== undefined) {
      sink.onFinish(choice.finish_reason)
    }
    if (choice.response_error !== null && choice.response_error !== undefined) {
      sink.onResponseError?.(choice.response_error)
    }
    return events
  }

  async dispatcher(config) {
    if (config.advanced.proxy === '') return {}
    try {
      const { ProxyAgent } = await import('undici')
      return { dispatcher: new ProxyAgent(config.advanced.proxy) }
    } catch (error) {
      throw new LlmError(`${PKG}: proxy "${config.advanced.proxy}" cannot be used: ${errorMessage(error)}`, 'TRANSPORT', {
        cause: error,
      })
    }
  }
}

function numberOrZero(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/**
 * Wire keys each role is allowed to carry.
 *
 * Mistral validates assistant messages strictly: any extra key is a 422
 * (`extra_forbidden`), and `reasoning_content` in particular is an OpenAI-side
 * replay field that this API does not accept. The adapter builds messages itself,
 * so this is a boundary guard: if a message ever arrives carrying foreign keys,
 * they are dropped here and reported once instead of being shipped and rejected.
 */
const WIRE_KEYS = {
  system: ['role', 'content'],
  user: ['role', 'content'],
  assistant: ['role', 'content', 'tool_calls'],
  tool: ['role', 'tool_call_id', 'content'],
}

const warnedKeys = new Set()

function sanitizeMessage(message) {
  const allowed = WIRE_KEYS[message.role] ?? ['role', 'content']
  const out = {}
  const dropped = []
  for (const key of Object.keys(message)) {
    if (allowed.includes(key)) out[key] = message[key]
    else dropped.push(key)
  }
  if (dropped.length > 0) {
    const signature = `${message.role}:${dropped.sort().join(',')}`
    if (!warnedKeys.has(signature)) {
      warnedKeys.add(signature)
      console.warn(`${PKG}: dropped non-wire keys from a ${message.role} message: ${dropped.join(', ')}`)
    }
  }
  return out
}

/** Cap for the text mass hashed into the auto prompt-cache key. */
const CACHE_KEY_TEXT_LIMIT = 131072

/**
 * F-10 ('auto'): stable per-conversation prompt-cache key.
 *
 * Hashes the request's stable prefix — model id plus the first two messages
 * (system + conversation opener), text parts only, image parts collapsed to a
 * type marker so multi-megabyte data URLs never enter the hash. Later turns
 * append to the conversation and keep this prefix byte-identical, so the key
 * is stable for the whole session while different conversations shard apart.
 * A compaction generation, when present, is mixed in so the key rotates once
 * per compaction; without one the derivation is byte-identical to before.
 */
function autoPromptCacheKey(modelId, messages, generation) {
  const hash = createHash('sha256')
  hash.update('dsh-mistral-pro/v1\n')
  hash.update(modelId)
  if (generation !== undefined) {
    hash.update('\n\u0002compact:')
    hash.update(generation)
  }
  for (const message of messages.slice(0, 2)) {
    hash.update('\n\u0000')
    hash.update(message.role)
    hash.update('\u0001')
    hash.update(fingerprintContent(message.content))
  }
  return hash.digest('hex')
}

/**
 * F-10 ('shared'): cache key derived from the model and the leading system
 * prompt only.
 *
 * Mistral documents `prompt_cache_key` as a routing hint that "increases the
 * chance of a cache hit" and matches on a compatible cached prefix. A
 * per-conversation key (the 'auto' default) can never reuse the system prompt
 * across conversations, because every conversation gets a different key. This
 * mode trades that isolation for cross-conversation reuse of the (usually
 * large) system prompt: every conversation on the same model and system prompt
 * shares one key, so the first turn of a new conversation can still hit the
 * cached system-prompt prefix. The provider still verifies prefix
 * compatibility, so a shared key can only miss, never return another
 * conversation's content.
 *
 * A session with no leading system/developer message has no shared prefix to
 * justify a cross-conversation key: hashing nothing but the model id would
 * funnel every unrelated conversation on that model into one cache namespace
 * (and, before this fallback, literally returned the same digest for all of
 * them). Fall back to the per-conversation derivation instead; the key stays a
 * 64-char digest and the shared derivation is unchanged when a system message
 * is present.
 *
 * A compaction generation, when present, is mixed in exactly like the 'auto'
 * derivation: a compaction rewrites the prefix, so the shared key must rotate
 * too rather than insert the new prefix under the old key.
 */
function sharedPromptCacheKey(modelId, messages, generation) {
  const hash = createHash('sha256')
  hash.update('dsh-mistral-pro/v1/shared\n')
  hash.update(modelId)
  if (generation !== undefined) {
    hash.update('\n\u0002compact:')
    hash.update(generation)
  }
  let sharedPrefix = false
  for (const message of messages) {
    if (message.role !== 'system' && message.role !== 'developer') break
    sharedPrefix = true
    hash.update('\n\u0000')
    hash.update(message.role)
    hash.update('\u0001')
    hash.update(fingerprintContent(message.content))
  }
  if (!sharedPrefix) return autoPromptCacheKey(modelId, messages, generation)
  return hash.digest('hex')
}

/**
 * Newest compaction id in the original DSH message list, if any.
 *
 * DSH rewrites the conversation prefix on compaction and marks the replacement
 * user message with `source.kind === 'compact-checkpoint'` plus a
 * `compactionId` (`@deepseek-ai/dsh-compaction`'s `compactCheckpointSource`).
 * The adapter receives the original messages through `options.messages`, so a
 * single scan finds the newest marker without diffing message lists or keeping
 * per-session state. A session that never compacted has no marker and the key
 * derivation is byte-identical to before.
 */
function compactionGeneration(messages) {
  if (!Array.isArray(messages)) return undefined
  let generation
  for (const message of messages) {
    const source = message?.source
    if (source?.kind === 'compact-checkpoint' && typeof source.compactionId === 'string') generation = source.compactionId
  }
  return generation
}

/** Deterministic text-only fingerprint of one OpenAI-compatible message content. */
function fingerprintContent(content) {
  if (typeof content === 'string') return content.slice(0, CACHE_KEY_TEXT_LIMIT)
  if (!Array.isArray(content)) return ''
  const parts = content.map((part) => {
    if (part?.type === 'text' && typeof part.text === 'string') {
      return { type: 'text', text: part.text.slice(0, CACHE_KEY_TEXT_LIMIT) }
    }
    if (part?.type === 'image_url') return { type: 'image' }
    if (part?.type === 'thinking') return { type: 'thinking' }
    return { type: typeof part?.type === 'string' ? part.type : 'unknown' }
  })
  return JSON.stringify(parts).slice(0, CACHE_KEY_TEXT_LIMIT)
}

/**
 * Describe a Mistral `response_error` validation report.
 *
 * Success is `format_error: null` plus only `valid_*` markers in the two
 * validation arrays (either array may be empty or absent). `extra_tags` is
 * deliberately not part of the verdict: it is `[]` in every observed payload
 * and its non-empty meaning is undocumented, so a non-empty value alone is not
 * a failure; it is only attached to a failure description for diagnostics.
 *
 * @returns undefined for the success shape, otherwise a short description of
 *   the failing markers, suitable for one log line and an error message.
 */
function describeResponseError(value) {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'object' || Array.isArray(value)) return `unexpected response_error: ${jsonSnippet(value)}`
  const failures = []
  if (value.format_error !== null && value.format_error !== undefined) {
    failures.push(`format_error=${jsonSnippet(value.format_error)}`)
  }
  for (const field of ['content_validation', 'tool_calls_validation']) {
    const entries = value[field]
    if (entries === undefined || entries === null) continue
    if (!Array.isArray(entries)) {
      failures.push(`${field}=${jsonSnippet(entries)}`)
      continue
    }
    for (const entry of entries) {
      if (typeof entry !== 'string' || !entry.startsWith('valid_')) failures.push(`${field}=${jsonSnippet(entry)}`)
    }
  }
  if (failures.length === 0) return undefined
  if (Array.isArray(value.extra_tags) && value.extra_tags.length > 0) failures.push(`extra_tags=${jsonSnippet(value.extra_tags)}`)
  return failures.join(', ')
}

/** Short JSON rendering for log lines; never throws on cyclic or exotic values. */
function jsonSnippet(value) {
  try {
    const text = JSON.stringify(value)
    if (typeof text !== 'string') return String(value)
    return text.length > 200 ? `${text.slice(0, 200)}…` : text
  } catch {
    return String(value)
  }
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

async function safeText(response) {
  try {
    const text = await response.text()
    return text.length > MAX_ERROR_BODY ? `${text.slice(0, MAX_ERROR_BODY)}…` : text
  } catch {
    return ''
  }
}

/** Map an HTTP failure onto the provider-neutral failure taxonomy. */
export function classifyHttpFailure(status, body, requestId) {
  const detail = `${status} ${body}`
  const options = { status, ...(requestId === undefined ? {} : { requestId }) }
  if (status === 401 || status === 403) {
    return new LlmError(`${PKG}: authentication failed (${status}): ${body.slice(0, 300)}`, 'AUTH', options)
  }
  if (status === 429) {
    const code = isQuotaExceededError(detail) ? 'QUOTA' : 'RATE_LIMIT'
    return new LlmError(`${PKG}: rate limited or out of quota (${status}): ${body.slice(0, 300)}`, code, options)
  }
  if (isContextWindowExceededError(detail)) {
    return new LlmError(`${PKG}: request exceeds the model context window: ${body.slice(0, 300)}`, 'CONTEXT_WINDOW_EXCEEDED', options)
  }
  if (isQuotaExceededError(detail)) {
    return new LlmError(`${PKG}: account quota exhausted: ${body.slice(0, 300)}`, 'QUOTA', options)
  }
  if (status >= 500) {
    return new LlmError(`${PKG}: provider server error (${status}): ${body.slice(0, 300)}`, 'SERVER', options)
  }
  return new LlmError(`${PKG}: request rejected (${status}): ${body.slice(0, 300)}`, 'INVALID_REQUEST', options)
}
