/**
 * Admission for the plugin's browser routes.
 *
 * The Web carrier's `resource` routes are not part of the Connection's `/api`
 * transport, so nothing authenticates them by default: a `resource` handler
 * receives the raw request and, for an HTTP call, no Peer. Every route that
 * answers private account, usage or billing data therefore asks the
 * composition's `connection` service for a rejection first — its Host/Origin
 * fence defeats DNS rebinding and cross-site calls, and its browser
 * authentication (the login-token cookie) gates every caller before any data
 * is reachable.
 *
 * The guard fails closed: a composition without `connection` cannot
 * authenticate anyone, so it refuses the request instead of serving it, and a
 * guard that throws refuses too.
 */

/** Status returned when the composition has no `connection` service to authenticate with. */
export const NO_CONNECTION_STATUS = 503

/** Status returned when an in-process read speaks for a non-owner Peer. */
export const NON_OWNER_STATUS = 403

/**
 * Decide whether one browser route may answer a request.
 * @param connection - the composition's `connection` service, or undefined.
 * @param request - the Fetch request the route received.
 * @param peer - the Peer an in-process `readResource` read speaks for; absent over HTTP.
 * @returns the HTTP status refusing the request, or undefined when it may proceed.
 */
export function routeRejection(connection, request, peer) {
  // An in-process read names its caller; only the Host owner may read private data.
  if (peer !== undefined) {
    return peer?.principal?.kind === 'owner' ? undefined : NON_OWNER_STATUS
  }
  if (connection === undefined) return NO_CONNECTION_STATUS
  try {
    return connection.requestRejection(request)
  } catch {
    // A guard that cannot decide must not serve private data.
    return NON_OWNER_STATUS
  }
}
