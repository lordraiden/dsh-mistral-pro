// Security regression: the browser routes answer private account, usage and
// billing data, and a Web carrier `resource` route gets no admission from the
// carrier itself. Every route must therefore ask the Connection service for a
// rejection first and fail closed when it cannot. No network, no keys.
import { apply } from '../index.js'
import { NON_OWNER_STATUS, NO_CONNECTION_STATUS, routeRejection } from '../lib/admission.js'

const failures = []
const check = (name, cond, detail = '') => {
  if (!cond) failures.push(detail === '' ? name : `${name} (${detail})`)
}

// --- the guard itself ---
const request = new Request('http://127.0.0.1/plugins/dsh-mistral-pro/models')
const owner = { principal: { kind: 'owner' } }
const stranger = { principal: { kind: 'guest' } }

check('no connection and no peer fails closed', routeRejection(undefined, request, undefined) === NO_CONNECTION_STATUS)
check('an owner Peer may read in process', routeRejection(undefined, request, owner) === undefined)
check('a non-owner Peer is refused in process', routeRejection(undefined, request, stranger) === NON_OWNER_STATUS)
check('a connection rejection is passed through', routeRejection({ requestRejection: () => 401 }, request, undefined) === 401)
check('an allowed connection request proceeds', routeRejection({ requestRejection: () => undefined }, request, undefined) === undefined)
check(
  'a throwing guard fails closed',
  routeRejection(
    {
      requestRejection: () => {
        throw new Error('boom')
      },
    },
    request,
    undefined,
  ) === NON_OWNER_STATUS,
)

// --- the routes as `apply` registers them ---
function makeCtx(services, routes = []) {
  const child = {
    effect(fn) {
      fn()
      return () => {}
    },
    get(name) {
      return services[name]
    },
    settings: services.settings,
    webServer: services.webServer,
    connection: services.connection,
  }
  const ctx = {
    fiber: { entry: { options: { id: 'dsh-mistral-pro' } } },
    logger: { info() {}, warn() {} },
    emit() {},
    on() {},
    effect(fn) {
      fn()
      return () => {}
    },
    get(name) {
      return services[name]
    },
    inject(deps, callback) {
      if (deps.every((dep) => services[dep] !== undefined)) callback(child)
    },
    llm: {
      registerConfigurableProviders() {},
      registerAdapter() {},
      registerModelDiscovery() {},
      listProviders() {
        return [{ id: 'mistral-pro' }]
      },
    },
  }
  return { ctx, routes }
}

function makeWebServer(routes) {
  return {
    register(route) {
      routes.push(route)
      return () => {}
    },
  }
}

// Without `connection` there is nothing to authenticate with: no route at all.
{
  const routes = []
  const wired = makeCtx({ webServer: makeWebServer(routes) }, routes)
  apply(wired.ctx, {})
  check('no connection service registers no browser route', routes.length === 0, String(routes.length))
}

// With both services every route is registered behind the guard.
{
  let rejection
  const connection = { requestRejection: () => rejection }
  const routes = []
  const wired = makeCtx({ webServer: makeWebServer(routes), connection }, routes)
  apply(wired.ctx, {})

  check('every browser route is registered', routes.length > 0, String(routes.length))
  check(
    'every route is a prefix resource under the plugin path',
    routes.every((route) => route.kind === 'prefix' && route.path.startsWith('/plugins/dsh-mistral-pro/')),
  )

  const models = routes.find((route) => route.path === '/plugins/dsh-mistral-pro/models')
  check('the /models route exists', models !== undefined)

  rejection = 401
  const refused = await models.resource(request, undefined)
  check('an unauthenticated request is refused', refused.status === 401, String(refused.status))
  const refusedBody = await refused.json()
  check('the refusal names no data', refusedBody.ok === false && refusedBody.error?.code === 'UNAUTHORIZED')
  check('the refusal body carries no models', refusedBody.models === undefined)

  rejection = undefined
  const allowed = await models.resource(request, undefined)
  check('an authenticated request is answered', allowed.status === 200, String(allowed.status))
  const allowedBody = await allowed.json()
  check('the authenticated response carries the catalog', allowedBody.ok === true && Array.isArray(allowedBody.models))

  // An in-process read names its Peer; a non-owner must not reach the handler.
  const inProcess = await models.resource(request, stranger)
  check('a non-owner in-process read is refused', inProcess.status === NON_OWNER_STATUS, String(inProcess.status))
  const ownerRead = await models.resource(request, owner)
  check('an owner in-process read is answered', ownerRead.status === 200, String(ownerRead.status))
}

if (failures.length > 0) {
  console.error(`FAIL (${failures.length})`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log('PASS: browser route admission (fail closed, 401/403, owner-only in-process reads)')
