/**
 * Outbound transport for chat completions.
 *
 * Mistral rejects assistant messages that carry `reasoning_content`
 * (`422 extra_forbidden`). The adapter sanitizes every message before it is
 * serialized, but that guarantee only holds up to the wire: other plugins
 * replace `globalThis.fetch` and re-serialize the request body on the way out.
 * billion-context does exactly that, and its "strict reasoning echo" repair
 * adds `reasoning_content: ""` to every assistant tool-call message whenever
 * the model id looks like a DeepSeek model — `deepseek-v4-1-flash-1017` does:
 *
 *   if (upstreamOrigin !== undefined && /deepseek/i.test(upstreamOrigin)) return true
 *   return typeof model === 'string' && model.length > 0 && /deepseek/i.test(model)
 *
 * A fetch wrapper cannot patch `node:https`, so the default transport posts the
 * already-serialized bytes straight to the socket. Set
 * `DSH_MISTRAL_TRANSPORT=fetch` to route through the global fetch again, and
 * note that a configured `advanced.proxy` always uses fetch + undici
 * `ProxyAgent` because that path needs the dispatcher.
 */
import http from 'node:http'
import https from 'node:https'
import { Readable } from 'node:stream'

const MAX_ERROR_BODY = 64 * 1024

function headerReader(raw) {
  return (name) => {
    const value = raw[String(name).toLowerCase()]
    if (value === undefined) return null
    return Array.isArray(value) ? value.join(', ') : value
  }
}

/**
 * POST a pre-serialized JSON body.
 *
 * Resolves to a fetch-shaped response: `{ ok, status, headers, body, text, json }`.
 * A non-2xx response buffers its body (capped) so `text()` stays cheap, and a
 * 2xx response exposes a web ReadableStream for the SSE reader loop.
 *
 * @param url - absolute chat-completions endpoint.
 * @param options.headers - request headers, without `content-length`.
 * @param options.body - serialized JSON string.
 * @param options.signal - abort signal owned by the caller.
 * @param options.dispatcher - undici dispatcher; when set, uses global fetch.
 */
export async function postJson(url, { headers, body, signal, dispatcher }) {
  if (dispatcher !== undefined) {
    return fetch(url, { method: 'POST', headers, body, signal, dispatcher })
  }
  const target = new URL(url)
  const transport = target.protocol === 'http:' ? http : https
  const payload = typeof body === 'string' ? body : JSON.stringify(body)
  const port = target.port === '' ? (target.protocol === 'http:' ? 80 : 443) : Number(target.port)

  return new Promise((resolve, reject) => {
    const request = transport.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port,
        path: `${target.pathname}${target.search}`,
        method: 'POST',
        headers: { ...headers, 'content-length': Buffer.byteLength(payload, 'utf8') },
      },
      (response) => {
        const status = response.statusCode ?? 0
        const ok = status >= 200 && status < 300
        const readHeaders = headerReader(response.headers)
        if (!ok) {
          const chunks = []
          let size = 0
          response.on('data', (chunk) => {
            if (size >= MAX_ERROR_BODY) return
            chunks.push(chunk)
            size += chunk.length
          })
          response.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8').slice(0, MAX_ERROR_BODY)
            resolve({
              ok,
              status,
              headers: { get: readHeaders },
              body: undefined,
              async text() {
                return text
              },
              async json() {
                return JSON.parse(text)
              },
            })
          })
          response.on('error', reject)
          return
        }
        resolve({
          ok,
          status,
          headers: { get: readHeaders },
          body: Readable.toWeb(response),
          async text() {
            const chunks = []
            for await (const chunk of response) chunks.push(Buffer.from(chunk))
            return Buffer.concat(chunks).toString('utf8')
          },
          async json() {
            return JSON.parse(await this.text())
          },
        })
      },
    )

    let settled = false
    const fail = (error) => {
      if (settled) return
      settled = true
      reject(error)
    }
    const abort = () => {
      const error = new Error('The operation was aborted')
      error.name = 'AbortError'
      request.destroy(error)
    }
    request.on('error', fail)
    if (signal?.aborted === true) {
      abort()
      return
    }
    signal?.addEventListener('abort', abort, { once: true })
    request.on('close', () => signal?.removeEventListener?.('abort', abort))
    request.write(payload, 'utf8')
    request.end()
  })
}

/** Whether the default transport is active (no proxy dispatcher, env not opting out). */
export function usesNativeTransport(dispatcher) {
  return dispatcher === undefined && process.env.DSH_MISTRAL_TRANSPORT !== 'fetch'
}
