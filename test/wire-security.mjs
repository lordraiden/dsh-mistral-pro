// Security regression: the wire log is prompt metadata and `%TEMP%` is usually
// a world-readable `/tmp`, so it must be created `0600`, an existing wider log
// must be tightened on the next write, and rotation must keep that mode.
// No network, no keys.
import { chmodSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { appendWire, readWire, wireLogPath } from '../lib/wire.js'

const scratch = mkdtempSync(join(tmpdir(), 'dsh-mistral-wire-security-'))
const logFile = join(scratch, 'wire.log')
process.env.DSH_MISTRAL_WIRE_LOG = logFile

const failures = []
const check = (name, cond, detail = '') => {
  if (!cond) failures.push(detail === '' ? name : `${name} (${detail})`)
}
const modeOf = (path) => statSync(path).mode & 0o777
const octal = (mode) => `0${mode.toString(8)}`

check('wireLogPath follows DSH_MISTRAL_WIRE_LOG', wireLogPath() === logFile, wireLogPath())

// --- a fresh file is created 0600 ---
appendWire({ event: 'request', model: 'test-model' })
check('fresh log exists', statSync(logFile).isFile())
check('fresh log is 0600', modeOf(logFile) === 0o600, octal(modeOf(logFile)))
const first = JSON.parse(readFileSync(logFile, 'utf8').trim())
check('log format is unchanged (one JSON object per line)', first.event === 'request' && typeof first.ts === 'number')

// --- an existing 0644 log is tightened on the next write ---
chmodSync(logFile, 0o644)
check('precondition: log widened to 0644', modeOf(logFile) === 0o644, octal(modeOf(logFile)))
appendWire({ event: 'request', model: 'test-model' })
check('existing 0644 log tightened to 0600', modeOf(logFile) === 0o600, octal(modeOf(logFile)))

// --- rotation keeps the cap and the mode ---
for (let index = 0; index < 405; index += 1) appendWire({ event: 'request', index })
const lines = readFileSync(logFile, 'utf8').split('\n').filter(Boolean)
check('rotation keeps the 400-line cap', lines.length === 400, String(lines.length))
check('rotation keeps 0600', modeOf(logFile) === 0o600, octal(modeOf(logFile)))
check('rotation keeps the newest entries', JSON.parse(lines.at(-1)).index === 404)

// --- a logging failure never interrupts a request ---
// A regular file in the parent position makes the path unwritable with ENOTDIR
// on every platform, including when the suite runs as root.
const blocker = join(scratch, 'not-a-directory')
writeFileSync(blocker, 'x')
process.env.DSH_MISTRAL_WIRE_LOG = join(blocker, 'wire.log')
let threw = false
try {
  appendWire({ event: 'request', model: 'test-model' })
} catch {
  threw = true
}
check('an unwritable log path does not throw', threw === false)
check('an unwritable log path reads as empty', readWire().length === 0)

if (failures.length > 0) {
  console.error(`FAIL (${failures.length})`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log('PASS: wire log permissions (fresh 0600, tightened 0644, rotation, failure isolation)')
