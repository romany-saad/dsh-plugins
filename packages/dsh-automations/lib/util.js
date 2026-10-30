// Shared helpers: canonical hashing, derived Session ids, error text.
import { createHash } from 'node:crypto'

export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).filter((k) => value[k] !== undefined).sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`
  }
  return JSON.stringify(value)
}
export const hash = (value) => createHash('sha256').update(canonical(value)).digest('hex')

// The seed keeps the name of the plugin this package grew from, so a profile
// that switches over re-adopts its existing task Sessions.
export function derivedSessionId(taskId, sessionKey) {
  const h = createHash('sha256').update(`dsh-automation-sync:${taskId}:${sessionKey}`).digest('hex')
  return `session-${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
}

export class SourceError extends Error {}

export function fail(where, message) {
  throw new SourceError(`${where}: ${message}`)
}

export function errorText(error) {
  if (error && typeof error === 'object') {
    const code = error.code ? `${error.code}: ` : ''
    return `${code}${error.message ?? String(error)}`
  }
  return String(error)
}
