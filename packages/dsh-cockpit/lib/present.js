// Tool-card titles: one short line per call saying what it did. Pure, with
// no imports: they depend only on the call's args and, for the result, on the
// value's own presentationMeta projection. DSH's web client ignores
// presentCall/presentResult and picks its renderer through tool.call.toolview
// (dsh-tools README, "Host presentation descriptors"), so client/build.mjs
// inlines this file and the chat cards use callTitle and the recorded meta title.

const MAX = 48
const clip = (s) => { const t = String(s).replace(/\s+/g, ' ').trim(); return t.length > MAX ? t.slice(0, MAX - 1) + '…' : t }
const quote = (s) => '"' + clip(s) + '"'
// board_open may create a board, set its parent and write the session binding.
const KIND = { board_open: 'edit', board_read: 'read', board_add: 'edit', board_update: 'edit' }

const itemsText = (item) => (Array.isArray(item) ? item.join(', ') : String(item))

function readFilters(args = {}) {
  const parts = []
  if (args.item !== undefined) parts.push('item ' + args.item)
  if (Array.isArray(args.status) && args.status.length) parts.push(args.status.join(', '))
  if (args.checkDrift === true) parts.push('drift check')
  return parts
}

function addTitle(item, args) {
  const parts = ['add ' + (item ?? 'next') + ' ' + quote(args.what ?? '')]
  parts.push(args.status ?? 'next')
  if (Array.isArray(args.dependsOn) && args.dependsOn.length) parts.push('after ' + args.dependsOn.join(', '))
  return parts.join(' · ')
}

function updateTitle(args) {
  const items = itemsText(args.item)
  if (args.remove) return 'remove ' + items
  const set = args.set && typeof args.set === 'object' ? args.set : {}
  const entries = Object.entries(set)
  if (!entries.length) return 'update ' + items + ' (no change)'
  let head = 'update ' + items
  if (typeof set.status === 'string') head += ' → ' + set.status
  const rest = entries.filter(([k, v]) => !(k === 'status' && typeof v === 'string')).map(([k, v]) => {
    if (v === null) return 'clear ' + k
    if (k === 'what') return quote(v)
    if (k === 'dependsOn' && Array.isArray(v)) return 'after ' + (v.length ? v.join(', ') : 'nothing')
    if (typeof v === 'object') return k
    return k + ' ' + clip(v)
  })
  return rest.length ? head + ': ' + rest.join(', ') : head
}

/** The pending card's title, from the args alone. */
export function callTitle(name, args = {}) {
  switch (name) {
    case 'board_open': return 'open ' + args.key + (args.parent !== undefined ? ' · parent ' + clip(args.parent) : '')
    case 'board_read': return ['read board', ...readFilters(args)].join(' · ')
    case 'board_add': return addTitle(args.item, args)
    case 'board_update': return updateTitle(args)
    default: return name
  }
}

/** The completed card's title, from the args and the result value; undefined keeps the call title. */
export function resultTitle(name, args = {}, value) {
  if (!value || value.ok !== true) return undefined
  switch (name) {
    case 'board_open': return 'open ' + value.board.key + (value.created ? ' (new)' : '') + (args.parent !== undefined ? ' · parent ' + clip(args.parent) : '')
    case 'board_read': return ['read ' + value.board.key, ...readFilters(args)].join(' · ')
    case 'board_add': return addTitle(value.task.item, { ...args, status: value.task.status })
    default: return undefined
  }
}

/** defineTool fields: presentCall, presentResult and output.presentationMeta. */
export function presentation(name) {
  return {
    presentCall: (args) => ({ card: 'generic', title: callTitle(name, args), kind: KIND[name] ?? 'other' }),
    presentResult: (_args, result) => {
      const title = !result?.isError && typeof result?.meta?.title === 'string' ? result.meta.title : undefined
      return title === undefined ? undefined : { card: 'generic', title }
    },
    presentationMeta: (args, value) => {
      const title = resultTitle(name, args, value)
      return title === undefined ? null : { title }
    },
  }
}
