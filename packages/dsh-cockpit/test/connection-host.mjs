// A real cordis Context with DSH's own host connection service
// (HostConnectionService from @deepseek-ai/dsh-client-connection), so the
// routes are dispatched as the host dispatches them: exact routes, the owner
// check and the method check. The browser login is not under test, so the
// service gets no browser auth; requests come in with a Peer, as after login.
import { Context } from '@deepseek-ai/cordis'
import { API_PATH, HostConnectionService } from '@deepseek-ai/dsh-client-connection'

export function createConnectionHost() {
  const ctx = new Context()
  let service
  ctx.plugin({ name: 'test-connection', apply: (c) => { service = new HostConnectionService(c, [], {}) } })
  // A raw web server, to show the plugin never registers on it.
  const webRoutes = []
  ctx.plugin({ name: 'test-webserver', apply: (c) => { c.set('webServer', { register: (route) => { webRoutes.push(route); return () => {} } }) } })
  const handler = () => service.createSharedFetchHandler(API_PATH)
  /** One request as the owner's browser Peer, or as the given Peer. */
  const request = (path, { method = 'GET', peer = service.browserPeer } = {}) =>
    handler().fetch(new Request('http://127.0.0.1' + path, { method }), peer)
  return { ctx, service: () => service, request, webRoutes }
}

/** A Peer that is not the owner, as dsh-api-remote-access admits one. */
export const guestPeer = { id: 'guest', principal: { kind: 'guest' }, interactions: 'none', signal: new AbortController().signal }
