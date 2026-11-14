// Transport regression: the default `node:https` path must put the adapter's
// already-serialized bytes on the socket, unchanged, and the knob must select
// the right path. No network, no keys.
import { postJson, usesNativeTransport } from '../lib/transport.js'
import { baseConfig, drain, makeAdapter, startServer, textStream, userMessage } from './support/harness.mjs'

const failures = []
const check = (name, cond, detail = '') => {
  if (!cond) failures.push(detail === '' ? name : `${name} (${detail})`)
}

// --- transport selection ---
check('https is the native transport by default', usesNativeTransport(undefined, 'https') === true)
check('the fetch knob disables the native transport', usesNativeTransport(undefined, 'fetch') === false)
check('a proxy dispatcher forces fetch', usesNativeTransport({}, 'https') === false)

const previous = process.env.DSH_MISTRAL_TRANSPORT
process.env.DSH_MISTRAL_TRANSPORT = 'fetch'
check('DSH_MISTRAL_TRANSPORT=fetch overrides the native transport', usesNativeTransport(undefined, 'https') === false)
if (previous === undefined) delete process.env.DSH_MISTRAL_TRANSPORT
else process.env.DSH_MISTRAL_TRANSPORT = previous

// --- postJson posts the exact serialized bytes ---
let direct = null
const directServer = await startServer((request, response) => {
  const chunks = []
  request.on('data', (chunk) => chunks.push(chunk))
  request.on('end', () => {
    direct = { body: Buffer.concat(chunks).toString('utf8'), headers: request.headers }
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.end(textStream('direct'))
  })
})

const payload = JSON.stringify({ model: 'm', messages: [{ role: 'user', content: 'x' }], stream: true })
const directResponse = await postJson(`${directServer.url}/chat/completions`, {
  headers: { authorization: 'Bearer test-key', 'content-type': 'application/json' },
  body: payload,
  signal: new AbortController().signal,
  transport: 'https',
})
await directResponse.text()
check('native postJson resolves a 2xx response', directResponse.ok === true && directResponse.status === 200)
check('the server received the exact serialized bytes', direct.body === payload, JSON.stringify(direct.body))
check(
  'content-length is the byte length of the payload',
  direct.headers['content-length'] === String(Buffer.byteLength(payload, 'utf8')),
  String(direct.headers['content-length']),
)
check('the authorization header survives the native path', direct.headers.authorization === 'Bearer test-key')
await directServer.close()

// --- the adapter posts exactly the body it built ---
let streamed = null
const streamServer = await startServer((request, response) => {
  const chunks = []
  request.on('data', (chunk) => chunks.push(chunk))
  request.on('end', () => {
    streamed = Buffer.concat(chunks).toString('utf8')
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.end(textStream('streamed'))
  })
})

const options = { model: 'deepseek-v4-1-flash-1017', messages: [userMessage('hello')] }
const config = baseConfig({
  accounts: [{ name: 'primary', apiKeyEnv: 'KEY_A', baseURL: streamServer.url, enabled: true }],
  advanced: { transport: 'https' },
})
const adapter = makeAdapter({ config, keys: { KEY_A: 'test-key' } })
const model = await adapter.resolveModel('mistral-pro', options.model)
const converted = await adapter.toMessages(options.messages, config)
const expected = JSON.stringify(adapter.buildBody(options, model, config, converted))
const streamedRun = await drain(adapter.stream(options))
check('the adapter stream completed without an error', streamedRun.error === undefined, String(streamedRun.error))
check('the adapter emitted the streamed text', streamedRun.events.some((event) => event.type === 'text-delta'))
check('the adapter posted exactly the body it built', streamed === expected, JSON.stringify(streamed))
await streamServer.close()

if (failures.length > 0) {
  console.error(`FAIL (${failures.length})`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log('PASS: native transport posts the exact serialized body (transport selection, bytes, headers)')
