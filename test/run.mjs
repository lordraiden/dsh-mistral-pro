// Runs every regression suite in test/ in a child process, one at a time.
//
// A new suite is picked up by adding `test/<name>.mjs`; nothing else has to be
// registered, so a contributor cannot forget to wire it into `npm test`.
import { readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const suites = readdirSync(here, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.mjs') && entry.name !== 'run.mjs')
  .map((entry) => entry.name)
  .sort()

if (suites.length === 0) {
  console.error('FAIL: no regression suites found in test/')
  process.exit(1)
}

const failed = []
for (const suite of suites) {
  console.log(`\n=== ${suite} ===`)
  const result = spawnSync(process.execPath, [join(here, suite)], { stdio: 'inherit' })
  if (result.error !== undefined) {
    console.error(`FAIL: ${suite}: ${result.error.message}`)
    failed.push(suite)
  } else if (result.status !== 0) {
    failed.push(suite)
  }
}

console.log(`\n${suites.length - failed.length}/${suites.length} suites passed`)
if (failed.length > 0) {
  console.error(`FAIL: ${failed.join(', ')}`)
  process.exit(1)
}
