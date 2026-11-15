// Settings-section hook-order regression: the settings component returns early
// while it is loading, so every hook it calls must sit above those early
// returns. A hook added below them changes the hook count between the loading
// render and the ready render, React throws, and the whole Mistral Pro settings
// section renders blank. No network, no keys, no real React.
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const failures = []
const check = (name, cond, detail = '') => {
  if (!cond) failures.push(detail === '' ? name : `${name} (${detail})`)
}

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')

// A React stand-in that counts the hooks of SettingsSection and enforces the
// rules of hooks: the count must be identical on every render.
let renderIndex = 0
let hookIndex = 0
let previousCount = null
let overrides = []
let tracking = false

function beginRender() {
  tracking = true
  hookIndex = 0
}

function endRender() {
  tracking = false
  const count = hookIndex
  if (previousCount !== null && count !== previousCount) {
    throw new Error(
      count > previousCount
        ? `rendered more hooks than during the previous render (${previousCount} -> ${count})`
        : `rendered fewer hooks than expected (${previousCount} -> ${count})`,
    )
  }
  previousCount = count
}

const React = {
  createElement(type, props, ...children) {
    if (typeof type === 'function') {
      if (type.name === 'SettingsSection') {
        beginRender()
        try {
          return type({ ...(props ?? {}), children })
        } finally {
          endRender()
        }
      }
      return type({ ...(props ?? {}), children })
    }
    return { type, props: props ?? {}, children }
  },
  useState(initial) {
    if (!tracking) return [initial, () => {}]
    const index = hookIndex++
    const override = overrides[renderIndex]
    const value = override && index < override.length ? override[index] : initial
    return [value, () => {}]
  },
  useEffect() {
    if (tracking) hookIndex++
  },
  useCallback(fn) {
    if (tracking) hookIndex++
    return fn
  },
  useMemo(fn) {
    if (tracking) hookIndex++
    return fn()
  },
  useRef(value) {
    if (tracking) hookIndex++
    return { current: value }
  },
}

let renderer = null
const t = (key) => key
const ctx = {
  effect(fn) {
    fn()
  },
  locale: { register() {}, bind() { return t } },
  slots: {
    inject(_name, fn) { fn() },
    register(spec, render) {
      if (spec?.name === 'settings.section') renderer = render
      return () => {}
    },
  },
  get() { return undefined },
  inject() {},
  remote: {},
}

const window = {
  __ModuleLoader__: {
    load({ factory }) {
      const plugin = factory((id) => {
        if (id === 'react') return React
        throw new Error(`unexpected require: ${id}`)
      })
      plugin.apply(ctx)
    },
  },
}

vm.runInNewContext(source, { window, console, document: undefined })

check('the settings section registers a renderer', renderer !== null)

if (renderer !== null) {
  // Render 1: the component is still loading, so it returns before the routing
  // controls and never reaches any hook below the early returns.
  renderIndex = 0
  overrides = []
  let loadingCount = null
  try {
    renderer({})
    loadingCount = previousCount
  } catch (error) {
    check('the loading render does not throw', false, String(error?.message ?? error))
  }

  // Render 2: the settings have loaded and the draft exists, so the component
  // runs past the early returns and reaches every hook below them.
  const readyState = {
    status: 'ready',
    meta: { settingsNs: 'mistral-pro', baseURL: 'https://api.mistral.ai', usage: {}, advanced: {} },
    value: {},
    revision: 1,
    creds: {},
    models: [],
    error: null,
  }
  const draft = { accounts: [], usage: {}, advanced: {}, cache: {} }
  renderIndex = 1
  overrides = [[], [readyState, draft]]
  let readyCount = null
  try {
    renderer({})
    readyCount = previousCount
  } catch (error) {
    check('the ready render does not throw', false, String(error?.message ?? error))
  }

  check('the settings component was actually tracked', loadingCount !== null && loadingCount > 0, String(loadingCount))
  check(
    'the hook count is identical on the loading and ready renders',
    loadingCount !== null && readyCount !== null && loadingCount === readyCount,
    `${loadingCount} -> ${readyCount}`,
  )
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL: ${failure}`)
  process.exit(1)
}
console.log('PASS: the settings section keeps a stable hook order across renders')
