// `response_error` regression: Mistral's finish chunk can carry a validation
// report. The recorded success shape must stay silent, a non-success shape must
// be logged once, and a non-success shape on a tool-call finish must throw
// MALFORMED_RESPONSE before the tool-call block-end is yielded (so a broken
// call is never dispatched). Local server only; no network, no keys.
import { baseConfig, drain, makeAdapter, startServer, sse, userMessage } from './support/harness.mjs'

const failures = []
const check = (name, cond, detail = '') => {
  if (!cond) failures.push(detail === '' ? name : `${name} (${detail})`)
}

const MODEL = 'deepseek-v4-1-flash-1017'
const messages = [userMessage('hello')]

// The exact shapes captured from deepseek-v4-1-flash-1017 (streaming, 2026-11-14).
const SUCCESS_TEXT = { format_error: null, content_validation: ['valid_text_chunk'], tool_calls_validation: [], extra_tags: [] }
const SUCCESS_TOOL = { format_error: null, content_validation: [], tool_calls_validation: ['valid_tool_call'], extra_tags: [] }
const INVALID_TEXT = { format_error: null, content_validation: ['invalid_text_chunk'], tool_calls_validation: [], extra_tags: [] }
const INVALID_TOOL = { format_error: null, content_validation: [], tool_calls_validation: ['invalid_tool_call'], extra_tags: [] }
const FORMAT_ERROR = { format_error: 'tool call arguments are not valid JSON', content_validation: [], tool_calls_validation: [], extra_tags: [] }

const finish = (reason, responseError) => ({
  choices: [{ index: 0, delta: {}, finish_reason: reason, ...(responseError === undefined ? {} : { response_error: responseError }) }],
})

const textChunks = (responseError) => [
  { choices: [{ index: 0, delta: { role: 'assistant', content: 'done' }, finish_reason: null }] },
  finish('stop', responseError),
]

const toolChunks = (responseError) => [
  { choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] },
  {
    choices: [
      {
        index: 0,
        delta: { tool_calls: [{ id: 'chatcmpl-tool-1', type: 'function', function: { name: 'run_shell', arguments: '{"command": "echo hi"}' }, index: 0 }] },
        finish_reason: null,
      },
    ],
  },
  finish('tool_calls', responseError),
]

async function runAgainst(chunks) {
  const warnings = []
  const server = await startServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.end(sse(chunks))
  })
  const config = baseConfig({
    accounts: [{ name: 'only', apiKeyEnv: 'KEY_A', baseURL: server.url, enabled: true }],
  })
  const adapter = makeAdapter({ config, keys: { KEY_A: 'key-a' } })
  adapter.ctx.logger = { warn: (message) => warnings.push(message) }
  const result = await drain(adapter.stream({ model: MODEL, messages }))
  await server.close()
  return { ...result, warnings }
}

// --- success shape: no log, no throw (no behaviour change) ---
const successText = await runAgainst(textChunks(SUCCESS_TEXT))
check('a success-shape text stream completes', successText.error === undefined, String(successText.error))
check('a success-shape text stream emits no warning', successText.warnings.length === 0, JSON.stringify(successText.warnings))
check(
  'a success-shape text stream still finishes as stop',
  successText.events.some((event) => event.type === 'finish' && event.reason.kind === 'stop'),
)

const successTool = await runAgainst(toolChunks(SUCCESS_TOOL))
check('a success-shape tool stream completes', successTool.error === undefined, String(successTool.error))
check('a success-shape tool stream emits no warning', successTool.warnings.length === 0, JSON.stringify(successTool.warnings))
check(
  'a success-shape tool stream still yields the tool-call block-end',
  successTool.events.some((event) => event.type === 'block-end' && event.block?.type === 'tool-call'),
)

// --- non-success shape on a text finish: one warning, still completes ---
const invalidText = await runAgainst(textChunks(INVALID_TEXT))
check('a non-success text stream completes', invalidText.error === undefined, String(invalidText.error))
check('a non-success text stream logs exactly one warning', invalidText.warnings.length === 1, JSON.stringify(invalidText.warnings))
check(
  'the warning names the failing marker',
  typeof invalidText.warnings[0] === 'string' && invalidText.warnings[0].includes('invalid_text_chunk'),
  String(invalidText.warnings[0]),
)
check(
  'a non-success text stream still finishes as stop',
  invalidText.events.some((event) => event.type === 'finish' && event.reason.kind === 'stop'),
)

// --- non-success shape on a tool-call finish: one warning, MALFORMED_RESPONSE ---
const invalidTool = await runAgainst(toolChunks(INVALID_TOOL))
check('a non-success tool stream raises an error', invalidTool.error !== undefined)
check(
  'a non-success tool stream raises MALFORMED_RESPONSE',
  invalidTool.error?.code === 'MALFORMED_RESPONSE',
  String(invalidTool.error?.code ?? invalidTool.error),
)
check('a non-success tool stream logs exactly one warning', invalidTool.warnings.length === 1, JSON.stringify(invalidTool.warnings))
check(
  'the warning names the failing marker',
  typeof invalidTool.warnings[0] === 'string' && invalidTool.warnings[0].includes('invalid_tool_call'),
  String(invalidTool.warnings[0]),
)
check(
  'no tool-call block-end is yielded for a broken call',
  !invalidTool.events.some((event) => event.type === 'block-end' && event.block?.type === 'tool-call'),
)

// --- a non-null format_error is a failure marker too ---
const formatError = await runAgainst(toolChunks(FORMAT_ERROR))
check(
  'a non-null format_error raises MALFORMED_RESPONSE on a tool-call finish',
  formatError.error?.code === 'MALFORMED_RESPONSE',
  String(formatError.error?.code ?? formatError.error),
)
check('a non-null format_error logs exactly one warning', formatError.warnings.length === 1, JSON.stringify(formatError.warnings))
check(
  'the warning includes the format_error text',
  typeof formatError.warnings[0] === 'string' && formatError.warnings[0].includes('format_error'),
  String(formatError.warnings[0]),
)

// --- a non-empty extra_tags alone is not a failure (undocumented meaning) ---
const extraTags = await runAgainst(textChunks({ ...SUCCESS_TEXT, extra_tags: ['observed-extra-tag'] }))
check('a non-empty extra_tags alone does not raise', extraTags.error === undefined, String(extraTags.error))
check('a non-empty extra_tags alone does not warn', extraTags.warnings.length === 0, JSON.stringify(extraTags.warnings))

if (failures.length > 0) {
  console.error(`FAIL (${failures.length})`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log('PASS: response_error success is silent, non-success warns, broken tool calls raise MALFORMED_RESPONSE')
