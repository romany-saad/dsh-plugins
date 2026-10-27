// A small session log in the shape ctx.sessionQuery.readSession returns.
let seq = 0
const ev = (type, data) => ({ type, seq: seq++, time: 1000 + seq, data })
const text = (t) => ({ type: 'text', text: t })

export function sessionLog() {
  seq = 0
  return [
    ev('request/header', { header: { config: { provider: 'claude', model: 'model-a', reasoningEffort: 'low' } }, reason: 'initial' }),
    ev('turn/start', { turn: 1 }),
    ev('user/message', { id: 'u1', role: 'user', content: [text('Add a cache to the fetcher.')] }),
    ev('session/title', { title: 'Fetcher cache' }),
    ev('step/start', { turn: 1, step: 1 }),
    ev('assistant/message', { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'reasoning', text: 'Think about TTL first.' }, text('I will read fetch.ts.'), { type: 'tool-call', id: 'c1', name: 'read', arguments: '{"file":"fetch.ts"}' }] } }),
    ev('tool/result', { turn: 1, step: 1, message: { role: 'tool', toolCallId: 'c1', content: [text('export function fetchJson(url) { return get(url) }')] } }),
    ev('step/start', { turn: 1, step: 2 }),
    ev('assistant/message', { turn: 1, step: 2, message: { role: 'assistant', content: [{ type: 'reasoning', text: 'Ten minutes is a fair TTL.' }, text('The cache keeps entries for 10 minutes. Stale entries are refreshed in the background.')] } }),
    ev('turn/end', { turn: 1, reason: { kind: 'completed' } }),
    ev('turn/start', { turn: 2 }),
    ev('user/message', { id: 'u2', role: 'user', content: [text('Why 10 minutes?')] }),
    ev('model/selection', { provider: 'claude', model: 'model-b' }),
    ev('assistant/message', { turn: 2, step: 1, message: { role: 'assistant', content: [text('Because the upstream data changes hourly.')] } }),
  ]
}
