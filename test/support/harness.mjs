// Shared fixtures for the regression suites: a local HTTP server, a normalized
// configuration, an adapter with a fake credential seam, and stream helpers.
// Nothing here touches the network or a real API key.
import http from 'node:http'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MistralProAdapter } from '../../lib/adapter.js'
import { AccountPool } from '../../lib/accounts.js'

// Keep diagnostic writes out of the live host's log.
const scratch = mkdtempSync(join(tmpdir(), 'dsh-mistral-test-'))
process.env.DSH_MISTRAL_WIRE_LOG = join(scratch, 'wire.log')

const DEFAULT_ADVANCED = {
  failover: true,
  cooldownSeconds: 300,
  requestTimeoutMs: 10000,
  streamIdleTimeoutMs: 5000,
  modelsRefreshMinutes: 60,
  maxTokensCap: 0,
  promptCacheKey: 'auto',
  proxy: '',
  transport: 'https',
}

const DEFAULT_CACHE = { affinity: false, reportUsage: true }

/** Normalized configuration with the fields the adapter reads. */
export function baseConfig(overrides = {}) {
  const { advanced = {}, cache = {}, ...rest } = overrides
  return {
    baseURL: 'http://127.0.0.1',
    accounts: [],
    models: {},
    usage: {},
    advanced: { ...DEFAULT_ADVANCED, ...advanced },
    cache: { ...DEFAULT_CACHE, ...cache },
    ...rest,
  }
}

/** Adapter wired to a config and an in-memory credential store. */
export function makeAdapter({ config, keys = {} }) {
  const ctx = {
    get(service) {
      if (service !== 'credentials') return undefined
      return {
        async resolve(ref) {
          return keys[ref] === undefined ? undefined : { value: keys[ref] }
        },
      }
    },
  }
  const adapter = new MistralProAdapter({
    ctx,
    readConfig: () => config,
    pool: new AccountPool(),
    discovered: { ids: [], models: [] },
  })
  adapter.dispatcher = async () => ({})
  return adapter
}

/** Start a throwaway HTTP server on 127.0.0.1 and return its base URL. */
export async function startServer(handler) {
  const server = http.createServer(handler)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return {
    server,
    port,
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

/** Serialize OpenAI-style chunks as an SSE body; `done` appends `[DONE]`. */
export function sse(chunks, { done = true } = {}) {
  const body = chunks.map((chunk) => `data: ${JSON.stringify(chunk)}`).join('\n\n')
  return `${body}${done ? '\n\ndata: [DONE]\n\n' : '\n\n'}`
}

/** Consume an async stream, returning the events and the terminal error. */
export async function drain(stream) {
  const events = []
  try {
    for await (const event of stream) events.push(event)
    return { events, error: undefined }
  } catch (error) {
    return { events, error }
  }
}

/** One DSH user message with a single text block. */
export function userMessage(text) {
  return { role: 'user', content: [{ type: 'text', text }] }
}

/** A minimal successful stream: one text delta, a stop finish and [DONE]. */
export function textStream(text = 'ok') {
  return sse([
    { choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }] },
    { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
  ])
}
