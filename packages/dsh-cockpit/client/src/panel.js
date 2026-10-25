// dsh-cockpit's browser half: a read-only "Board" tab in the right sidebar
// (design C, Outline, refined), a progress strip above the chat input, and
// one-line chat card titles for the four board tools.
// Plain CommonJS body: client/build.mjs wraps it in the module-loader factory
// and inlines the core's pure lib/rows.js, lib/present.js and the CommandBox
// (client/src/command-box.js), so the panel,
// the hub's tree text and the tool cards share their rules.
// Externals come from the shell's module table (react, ui-primitives).
const React = require('react')
const primitives = require('@deepseek-ai/dsh-client-ui-primitives')
const { boardFlags, boardProgress, boardProgressText, boardRows, needsYou, problems, progressText, prText, refUrl, taskUrl, titleText, treeOrder, EMPTY_STATE, problemLine, rowCells, stripModel, stripText } = require('../../lib/rows.js')
const { callTitle } = require('../../lib/present.js')
const { Tag } = primitives
const { makeCommandBox, copyStep, copyText, COPY_LABEL } = require('./command-box.js')
const { CommandBox, useCopy } = makeCommandBox(React)
const h = React.createElement

const ID = '@romany-saad/dsh-cockpit'
const KIND = 'dsh-cockpit-board'
const POLL_MS = 2000
// Relative to the document, as dsh-client-ui-deliverables does, so a mounted app works.
const VIEW = 'api/dsh-cockpit/view'
const TOOLS = ['board_open', 'board_read', 'board_add', 'board_update']

// ---- Style: design C (Outline), refined. Host tokens only; see the batch 6 report. ----
// One stylesheet in the document head, so the rows can use classes (grid,
// hover, wrapping) and the render output stays plain.
const T = {
  surface1: 'var(--dsw-alias-bg-skeleton)', // design surface-l1*: a faint tint in both themes
  surface2: 'var(--dsw-alias-bg-module-platform)', // design surface-l2*
  surface0: 'var(--dsw-alias-bg-base)', // design surface-l0*
  border: 'var(--dsw-alias-border-l1)',
  primary: 'var(--dsw-alias-label-primary)',
  secondary: 'var(--dsw-alias-label-secondary)',
  tertiary: 'var(--dsw-alias-label-tertiary)',
  warn: 'var(--dsw-alias-state-warn-label)',
  error: 'var(--dsw-alias-state-error-primary)', // design state-error*
  success: 'var(--dsw-alias-state-success-primary)', // design state-success*
  info: 'var(--dsw-alias-state-business-primary)', // design state-info*: the Tag primitive's info tone
  mono: 'var(--dsh-font-family-code, var(--dsh-font-family-code-default, ui-monospace, monospace))', // design font-family-mono*
  title: 'var(--dsh-content-font-size-secondary, 13px)', // design font-size-primary* (13 px)
}
const CSS = [
  '[data-dsh-cockpit-board]{box-sizing:border-box;height:100%;overflow:auto;color:' + T.primary + ';font-size:' + T.title + ';line-height:20px;font-variant-numeric:tabular-nums}',
  '.dshc-mono{font-family:' + T.mono + ';font-variant-ligatures:none}',
  '.dshc-trunc{display:block;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.dshc-wrap{display:block;min-width:0;overflow-wrap:anywhere}',
  '[data-dsh-cockpit-board] a{color:inherit;text-decoration:none}[data-dsh-cockpit-board] a:hover{text-decoration:underline}',
  '.dshc-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}',
  '.dshc-hd{padding:12px 12px 10px;border-bottom:1px solid ' + T.border + '}',
  '.dshc-hd1{display:flex;align-items:baseline;justify-content:space-between;gap:12px}',
  '.dshc-hdl{display:flex;align-items:baseline;gap:8px;min-width:0}',
  '.dshc-key{font-size:13px;font-weight:500;flex:none;max-width:60%}',
  '.dshc-parent{font-size:12px;color:' + T.tertiary + '}',
  '.dshc-meta{font-size:12px;color:' + T.tertiary + ';white-space:nowrap;flex:none}',
  '.dshc-drift{font-size:12px;line-height:16px;color:' + T.tertiary + ';margin-top:2px}',
  '.dshc-sec{padding:10px 12px 12px;border-bottom:1px solid ' + T.border + '}',
  '.dshc-sech{display:flex;align-items:center;gap:6px;font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;line-height:16px;margin-bottom:8px}',
  '.dshc-warn{color:' + T.warn + '}.dshc-err{color:' + T.error + '}',
  '.dshc-guess{text-transform:none;letter-spacing:0;font-weight:400;color:' + T.tertiary + '}',
  '.dshc-ni{display:grid;grid-template-columns:36px minmax(0,1fr) auto;column-gap:8px;row-gap:4px;background:' + T.surface1 + ';border:1px solid ' + T.border + ';border-radius:8px;padding:8px}',
  '.dshc-ni+.dshc-ni{margin-top:8px}',
  '.dshc-ni .dshc-id{color:' + T.tertiary + ';font-size:12px}',
  '.dshc-nit{font-weight:500}',
  '.dshc-ask{grid-column:2/4;font-size:12px;line-height:16px;color:' + T.secondary + ';overflow-wrap:anywhere}',
  '.dshc-ni .dshc-cmd{grid-column:1/4}',
  '.dshc-open{display:inline-flex;align-items:center;gap:4px;font-size:12px;color:' + T.secondary + ';white-space:nowrap}',
  '.dshc-cmd{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:start;background:' + T.surface2 + ';border:1px solid ' + T.border + ';border-radius:6px;padding:4px 4px 4px 10px;margin-top:4px;position:relative}',
  '.dshc-cmd code{font-family:' + T.mono + ';font-size:12px;line-height:18px;padding:3px 0;color:' + T.primary + ';white-space:pre-wrap;overflow-wrap:anywhere;min-width:0}',
  '.dshc-btn{display:inline-flex;align-items:center;gap:4px;height:24px;padding:0 8px;border-radius:4px;border:1px solid ' + T.border + ';background:' + T.surface0 + ';color:' + T.primary + ';font:inherit;font-size:12px;font-weight:500;line-height:1;cursor:pointer;white-space:nowrap;flex:none}',
  '.dshc-btn[data-copy-state=failed]{color:' + T.error + '}',
  '.dshc-prob{display:grid;grid-template-columns:16px minmax(0,1fr) auto 20px;column-gap:8px;align-items:center;width:100%;height:28px;padding:0;border:0;background:none;font:inherit;font-size:12px;color:' + T.primary + ';text-align:left;cursor:pointer}',
  '.dshc-prob .dshc-ic{color:' + T.error + '}.dshc-prob .dshc-ids{color:' + T.secondary + '}.dshc-prob .dshc-go{color:' + T.tertiary + ';display:flex;justify-content:center}',
  '.dshc-tree{margin:0;padding:0;list-style:none}',
  '.dshc-li{list-style:none;border-bottom:1px solid ' + T.border + '}',
  '.dshc-li:focus{outline:2px solid ' + T.info + ';outline-offset:-2px}',
  '.dshc-row{display:grid;grid-template-columns:36px 68px minmax(0,1fr) 60px 20px;column-gap:8px;row-gap:2px;align-items:start;padding:6px 12px}',
  '.dshc-row>*{min-height:20px}',
  '.dshc-li.dshc-parentrow{background:' + T.surface1 + '}',
  '.dshc-parentrow .dshc-ct{font-weight:600}',
  '.dshc-cid{font-size:12px;color:' + T.tertiary + ';overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.dshc-cst{display:flex;align-items:center;gap:6px;font-size:12px;color:' + T.secondary + '}',
  '.dshc-check{color:' + T.success + ';flex:none}',
  '.dshc-mark{display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;flex:none}',
  '.dshc-dot{width:8px;height:8px;border-radius:50%;box-sizing:border-box}',
  '.dshc-dot-now{background:' + T.info + '}.dshc-dot-waiting{background:' + T.tertiary + '}',
  '.dshc-ring{width:8px;height:8px;border-radius:50%;box-sizing:border-box;border:1.5px solid ' + T.secondary + '}',
  '.dshc-ct{display:flex;align-items:flex-start;min-width:0}',
  '.dshc-indent{flex:none}',
  '.dshc-elbow{flex:none;width:8px;height:8px;border-left:1px solid ' + T.tertiary + ';border-bottom:1px solid ' + T.tertiary + ';margin:4px 6px 0 2px}',
  '.dshc-done .dshc-ct,.dshc-done .dshc-cst{color:' + T.secondary + '}',
  '.dshc-cpr{font-size:12px;color:' + T.secondary + ';text-align:right;white-space:nowrap}',
  '.dshc-chev{display:flex;align-items:center;justify-content:center;height:20px;padding:0;border:0;background:none;color:' + T.tertiary + ';cursor:pointer}',
  '.dshc-chev svg[data-open]{transform:rotate(90deg)}',
  '.dshc-cmeta{grid-column:3/5;display:flex;flex-direction:column;gap:2px;font-size:12px;line-height:16px;color:' + T.secondary + ';min-height:0}',
  '.dshc-k{color:' + T.tertiary + '}',
  '.dshc-block{display:flex;align-items:center;gap:6px;color:' + T.primary + '}.dshc-block b{font-weight:500}.dshc-block .dshc-st{color:' + T.tertiary + '}',
  '.dshc-mprob{display:flex;align-items:flex-start;gap:6px;color:' + T.error + '}.dshc-mprob svg{flex:none;margin-top:2px}',
  // Over the Tag primitive's outline tone (class + attribute), so these win: square, currentColor border.
  '.dshc-cmeta .dshc-tag[data-tone]{align-self:flex-start;background:transparent;border:1px solid currentColor;border-radius:4px;padding:0 6px;font-weight:600;line-height:16px}',
  '.dshc-cmeta .dshc-tag-warn[data-tone]{color:' + T.warn + '}.dshc-cmeta .dshc-tag-ok[data-tone]{color:' + T.success + '}.dshc-cmeta .dshc-tag-quiet[data-tone]{color:' + T.secondary + '}',
  '.dshc-detail{grid-column:2/5;margin-top:6px;padding-top:8px;border-top:1px dashed ' + T.border + ';min-height:0}',
  '.dshc-detail dl{display:grid;grid-template-columns:80px minmax(0,1fr);column-gap:8px;row-gap:4px;margin:0 0 4px;font-size:12px;line-height:16px}',
  '.dshc-detail dt{color:' + T.tertiary + '}.dshc-detail dd{margin:0;color:' + T.secondary + ';overflow-wrap:anywhere}.dshc-detail dd.dshc-mono{color:' + T.primary + '}',
  '.dshc-pbar{display:flex;gap:2px;height:4px;margin:4px 0 2px}',
  '.dshc-need{color:' + T.warn + ';font-weight:500}',
  '.dshc-empty{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:0 40px;gap:6px}',
  '.dshc-empty p{margin:0}.dshc-empty-t{font-weight:500}.dshc-empty-s{font-size:12px;line-height:16px;color:' + T.secondary + ';max-width:280px}',
  '.dshc-msg{padding:12px;color:' + T.secondary + '}',
].join('\n')

function useStyle() {
  React.useEffect(() => {
    if (typeof document === 'undefined' || document.getElementById('dsh-cockpit-style')) return
    const el = document.createElement('style')
    el.id = 'dsh-cockpit-style'
    el.textContent = CSS
    document.head.appendChild(el)
  }, [])
}

// ---- Icons (16 px grid, stroke) ----
const svg = (size, children, extra) => h('svg', { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, ...extra }, children)
const warnIcon = (size = 12, extra) => svg(size, [h('path', { key: 1, d: 'M8 2.5l6 10.5H2z' }), h('path', { key: 2, d: 'M8 6.5v3' }), h('path', { key: 3, d: 'M8 11.6v.1' })], extra)
const checkIcon = () => svg(14, h('path', { d: 'M3.5 8.5l3 3 6-7' }), { strokeWidth: 1.8, className: 'dshc-check' })
const lockIcon = () => svg(12, [h('rect', { key: 1, x: 3.5, y: 7, width: 9, height: 6.5, rx: 1.5 }), h('path', { key: 2, d: 'M5.5 7V5a2.5 2.5 0 015 0v2' })])
const extIcon = () => svg(12, [h('path', { key: 1, d: 'M9 3.5h3.5V7' }), h('path', { key: 2, d: 'M12.5 3.5L7 9' }), h('path', { key: 3, d: 'M11 9.5v2.5a1 1 0 01-1 1H4.5a1 1 0 01-1-1V6.5a1 1 0 011-1H7' })], { strokeWidth: 1.5 })
const downIcon = () => svg(14, [h('path', { key: 1, d: 'M8 3.5v9' }), h('path', { key: 2, d: 'M4.5 9L8 12.5 11.5 9' })], { strokeWidth: 1.5 })
const chevIcon = (open) => svg(14, h('path', { d: 'M6 4l4 4-4 4' }), { 'data-open': open || undefined })

// ---- The view: polled every 2 s ----
function useView(sessionId) {
  const [state, setState] = React.useState({ loading: true })
  React.useEffect(() => {
    let stopped = false
    let controller
    const load = async () => {
      controller = new AbortController()
      try {
        const res = await fetch(VIEW + '?sessionId=' + encodeURIComponent(sessionId), { signal: controller.signal, cache: 'no-store' })
        const body = res.headers.get('content-type')?.includes('json') ? await res.json() : { error: await res.text() }
        if (!stopped) setState(res.ok ? { view: body } : { error: body.error || 'HTTP ' + res.status })
      } catch (error) {
        if (!stopped && error.name !== 'AbortError') setState({ error: String(error.message || error) })
      }
    }
    load()
    const timer = setInterval(load, POLL_MS)
    return () => { stopped = true; clearInterval(timer); controller?.abort() }
  }, [sessionId])
  return state
}

/** The clock for relative times: it ticks once a minute, not on every refresh. */
function useMinute() {
  const [now, setNow] = React.useState(() => Date.now())
  React.useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(timer) }, [])
  return now
}

const pad2 = (n) => String(n).padStart(2, '0')
/** "15:22 · 2 min ago" in local time; the date is added when it is not today. */
function whenText(iso, now = Date.now()) {
  const at = new Date(iso)
  if (!iso || Number.isNaN(at.getTime())) return iso || ''
  const today = new Date(now)
  const clock = pad2(at.getHours()) + ':' + pad2(at.getMinutes())
  const sameDay = at.getFullYear() === today.getFullYear() && at.getMonth() === today.getMonth() && at.getDate() === today.getDate()
  const local = sameDay ? clock : at.getFullYear() + '-' + pad2(at.getMonth() + 1) + '-' + pad2(at.getDate()) + ' ' + clock
  const s = Math.round((now - at.getTime()) / 1000)
  const ago = s < 0 ? 'in the future' : s < 60 ? 'just now' : s < 3600 ? Math.floor(s / 60) + ' min ago'
    : s < 86400 ? Math.floor(s / 3600) + ' h ago' : Math.floor(s / 86400) + ' d ago'
  return local + ' · ' + ago
}

/** Show the drift line when drift is configured or the file holds a drift result; else hide it. */
const showDrift = (view) => Boolean(view.driftConfigured || view.board?.drift)

/** "Drift check: not run yet", "Drift check: no differences · 16:40", "Drift check: 2 differing · 16:40". */
function driftText(drift, now) {
  if (!drift) return 'Drift check: not run yet'
  const at = drift.checkedAt ? ' · ' + whenText(drift.checkedAt, now).split(' · ')[0] : ''
  if (drift.error) return 'Drift check failed' + at + ': ' + String(drift.error.message || JSON.stringify(drift.error))
  const differing = (drift.items || []).filter((i) => i.differs).length
  return 'Drift check: ' + (differing ? differing + ' differing' : 'no differences') + at
}

/** The header's right side: "rev 33 · 15:34 · 9 min ago". */
const headerMeta = (board, now) => ['rev ' + board.revision, board.updatedAt ? whenText(board.updatedAt, now) : ''].filter(Boolean).join(' · ')

// ---- Rows: show one, expand state kept by board and item across refreshes and remounts ----
const expanded = new Map()

/** Move focus to a row, centred, without animation (the problems lines and dock segments). */
function showRow(item) {
  const el = typeof document !== 'undefined' && document.querySelector('[data-dsh-cockpit-board] li[data-item="' + String(item).replace(/["\\]/g, '\\__BODY__') + '"]')
  if (!el) return
  el.scrollIntoView({ block: 'center' })
  el.focus({ preventScroll: true })
}

function Header({ board, view, now }) {
  return h('header', { className: 'dshc-hd' },
    h('div', { className: 'dshc-hd1' },
      h('span', { className: 'dshc-hdl' },
        h('span', { className: 'dshc-mono dshc-key dshc-trunc', title: board.key }, board.key),
        board.parent ? h('span', { className: 'dshc-parent dshc-trunc', title: board.parent }, board.parent) : null),
      h('span', { className: 'dshc-meta' }, headerMeta(board, now))),
    showDrift(view) ? h('div', { className: 'dshc-drift' }, driftText(board.drift, now)) : null)
}

/** "Open PR #892 ↗" for a pr, "Open #884 ↗" for an issue; nothing without a link. */
function OpenLink({ task, parent }) {
  const url = taskUrl(task, parent)
  if (!url) return null
  const pr = refUrl(task.pr, 'pull', parent)
  const label = pr ? 'Open ' + prText(task.pr) : 'Open ' + (task.issue || '')
  return h('a', { className: 'dshc-open', href: url, target: '_blank', rel: 'noopener noreferrer', onClick: (e) => e.stopPropagation() }, label.trim(), extIcon())
}

function NeedsYou({ board }) {
  const { tasks, guessed } = needsYou(board.tasks)
  if (!tasks.length) return null
  return h('section', { className: 'dshc-sec', 'data-needs-you': '', 'aria-label': 'Needs you' },
    h('div', { className: 'dshc-sech dshc-warn' }, warnIcon(), 'Needs you', guessed ? h('span', { className: 'dshc-guess', title: 'No task sets waitingOn: these wait and their next step starts with "Owner"' }, ' (guessed)') : null),
    tasks.map((t) => h('div', { key: t.item, className: 'dshc-ni', 'data-item': t.item },
      h('span', { className: 'dshc-mono dshc-id' }, t.item),
      h('span', { className: 'dshc-wrap dshc-nit' }, titleText(t)),
      h(OpenLink, { task: t, parent: board.parent }) || h('span', null),
      t.nextAction ? h('span', { className: 'dshc-ask' }, String(t.nextAction).trim()) : null,
      t.readyCommand ? h(CommandBox, { command: String(t.readyCommand).trim(), label: 'Copy command for ' + titleText(t) }) : null)))
}

/** One line per problem; ↓ moves focus to its row. None: nothing. */
function Problems({ tasks }) {
  const list = problems(tasks)
  if (!list.length) return null
  return h('section', { className: 'dshc-sec', 'data-problems': '', 'aria-label': 'Problems in board data' },
    h('div', { className: 'dshc-sech dshc-err' }, 'Board data problems'),
    list.map((p, i) => {
      const line = problemLine(p, tasks)
      return h('button', { key: i, type: 'button', className: 'dshc-prob', title: line.text, onClick: () => showRow(line.item) },
        h('span', { className: 'dshc-ic' }, warnIcon(14)),
        h('span', { className: 'dshc-trunc' }, line.kind),
        h('span', { className: 'dshc-ids' }, line.refs),
        h('span', { className: 'dshc-go', 'aria-label': 'Go to row', role: 'img' }, downIcon()))
    }))
}

function Mark({ mark }) {
  if (mark === 'check') return checkIcon()
  return h('span', { className: 'dshc-mark', 'aria-hidden': true }, h('span', { className: mark === 'ring' ? 'dshc-ring' : 'dshc-dot dshc-' + mark }))
}

const tag = (key, cls, words) => h(Tag, { key, tone: 'outline', className: 'dshc-tag ' + cls }, words)

function Meta({ c, drift, segments }) {
  const lines = []
  if (segments) lines.push(h(Bar, { key: 'bar', m: segments, thin: true, onSegment: showRow }))
  if (c.progress) lines.push(h('span', { key: 'p' }, c.progress, c.progressNeedsYou ? [' · ', h('span', { key: 'n', className: 'dshc-need' }, c.progressNeedsYou)] : null))
  if (c.next) lines.push(h('span', { key: 'next', className: 'dshc-trunc', title: c.next.text }, h('span', { className: 'dshc-k' }, c.next.label + ' '), c.next.text))
  if (c.needsYou) lines.push(tag('you', 'dshc-tag-warn', 'Needs you · see top'))
  if (c.blockedBy.length) {
    lines.push(h('span', { key: 'b', className: 'dshc-block' }, lockIcon(),
      h('span', { className: 'dshc-wrap' }, h('b', null, 'Blocked by '), c.blockedBy.map((b, i) => h('span', { key: i }, i ? ', ' : '', h('b', null, b.ref), ' ', h('span', { className: 'dshc-st' }, '(' + b.status + ')'))))))
  }
  if (c.ready) lines.push(tag('ready', 'dshc-tag-ok', 'ready'))
  c.problems.forEach((p, i) => lines.push(h('span', { key: 'f' + i, className: 'dshc-mprob' }, warnIcon(12), h('span', { className: 'dshc-wrap' }, p))))
  if (drift) lines.push(tag('drift', 'dshc-tag-quiet', 'drift: ' + (drift.status || '?')))
  return lines.length ? h('div', { className: 'dshc-cmeta' }, lines) : null
}

function Detail({ c, drift }) {
  const items = c.detail.concat(drift ? [{ key: 'Drift', value: (drift.status || '?') + (drift.note ? ' (' + drift.note + ')' : ''), mono: false }] : [])
  return h('div', { className: 'dshc-detail', 'data-detail': '' },
    items.length ? h('dl', null, items.map((d) => [h('dt', { key: d.key + 't' }, d.key), h('dd', { key: d.key + 'd', className: d.mono ? 'dshc-mono' : undefined }, d.value)])) : null,
    c.command ? h(CommandBox, { command: c.command, label: 'Copy command for ' + c.title }) : null)
}

function TaskRow({ boardKey, row, flags, drift, segments }) {
  const c = rowCells(row, flags)
  const id = boardKey + '\u0000' + row.item
  const [open, setOpen] = React.useState(expanded.get(id) === true ? true : false)
  const canOpen = c.expandable || Boolean(drift)
  const toggle = () => { expanded.set(id, !open); setOpen(!open) }
  const isOpen = canOpen && open
  const titleCls = c.wrap ? 'dshc-wrap' : 'dshc-trunc'
  return h('li', { 'data-item': row.item, 'data-done': row.done || undefined, tabIndex: -1, className: 'dshc-li' + (c.parent ? ' dshc-parentrow' : '') + (row.done ? ' dshc-done' : '') },
    h('div', { className: 'dshc-row', onClick: canOpen ? (e) => { if (!e.target.closest || !e.target.closest('a,button')) toggle() } : undefined, style: canOpen ? { cursor: 'pointer' } : undefined },
      h('span', { className: 'dshc-mono dshc-cid', title: row.item }, row.item),
      h('span', { className: 'dshc-cst' }, c.mark ? h(Mark, { mark: c.mark }) : null, c.status ? h('span', null, c.status) : null),
      h('span', { className: 'dshc-ct' },
        c.indent ? h('span', { className: 'dshc-indent', style: { width: c.indent * 16 } }) : null,
        c.elbow ? h('span', { className: 'dshc-elbow', 'aria-hidden': true }) : null,
        h('span', { className: titleCls, title: c.wrap ? undefined : c.title }, c.title)),
      h('span', { className: 'dshc-cpr' }, c.pr && c.prUrl ? h('a', { href: c.prUrl, target: '_blank', rel: 'noopener noreferrer', onClick: (e) => e.stopPropagation() }, c.pr) : c.pr || null),
      canOpen
        ? h('button', { type: 'button', className: 'dshc-chev', 'aria-expanded': isOpen, 'aria-label': 'Details for ' + c.title, onClick: (e) => { e.stopPropagation(); toggle() } }, chevIcon(isOpen))
        : h('span', null),
      h(Meta, { c, drift, segments }),
      isOpen ? h(Detail, { c, drift }) : null))
}

function Empty() {
  return h('div', { className: 'dshc-empty', 'data-empty': '' }, h('p', { className: 'dshc-empty-t' }, EMPTY_STATE.title), h('p', { className: 'dshc-empty-s' }, EMPTY_STATE.line))
}

// Tab id -> the navigation revision already shown, so a remounted body does not jump back to an old click.
const scrolledTo = new Map()

/** A dock segment opens the tab with params { item }; the body shows that row once rendered, once per navigation. */
function useShowRow(useTabInfo, ready) {
  const tab = useTabInfo ? useTabInfo().tab : undefined
  const nav = tab && tab.navigation
  const item = nav && nav.params && nav.params.item
  React.useEffect(() => {
    if (!ready || item === undefined || scrolledTo.get(tab.id) === nav.revision) return
    scrolledTo.set(tab.id, nav.revision)
    showRow(item)
  }, [ready, item, nav && nav.revision])
}

function BoardBody({ sessionId, useTabInfo }) {
  useStyle()
  const { loading, view, error } = useView(sessionId)
  const now = useMinute()
  useShowRow(useTabInfo, Boolean(view && view.board))
  const wrap = (child) => h('section', { 'data-dsh-cockpit-board': '' }, child)
  if (loading) return wrap(h('p', { className: 'dshc-msg' }, 'Loading board…'))
  if (error) return wrap(h('p', { className: 'dshc-msg', role: 'alert' }, 'Board unavailable: ' + error))
  if (!view.key) return wrap(h(Empty))
  if (!view.board) return wrap(h('p', { className: 'dshc-msg', role: 'alert' }, view.key + ': ' + view.error))
  const { board } = view
  // Flags from the shared rules, so the panel and the hub's text agree.
  const flagsOf = new Map()
  for (const f of boardFlags(board.tasks)) { if (!flagsOf.has(f.item)) flagsOf.set(f.item, []); flagsOf.get(f.item).push(f) }
  const driftOf = new Map(((board.drift && board.drift.items) || []).filter((i) => i.differs).map((i) => [i.item, i]))
  const progress = dockModel(view)
  const rows = boardRows(board)
  // The thin bar sits in the board's one parent row (the root with children).
  const roots = rows.filter((r) => r.depth === 0 && r.progress)
  return wrap(h('div', null,
    h(Header, { board, view, now }),
    h(NeedsYou, { board }),
    h(Problems, { tasks: board.tasks }),
    rows.length
      ? h('ul', { className: 'dshc-tree', role: 'list' }, rows.map((row) => h(TaskRow, {
        key: row.item, boardKey: board.key, row, flags: flagsOf.get(row.item) || [], drift: driftOf.get(row.item),
        segments: roots.length === 1 && roots[0] === row ? progress : undefined,
      })))
      : h('p', { className: 'dshc-msg' }, 'No tasks yet.')))
}

// ---- The progress strip above the chat input (conversation.input.dock) ----

// Sized like the other composer docks (the goal strip): the composer's width, its panel elevation.
const DOCK = {
  boxSizing: 'border-box', margin: '0 auto',
  width: 'calc(100% - 2 * var(--dsh-composer-side-clearance, 0px) - 4 * var(--dsh-composer-dock-inset, 0px))',
}
const DOCK_BAR = {
  boxSizing: 'border-box', width: '100%', maxWidth: 'calc(var(--dsh-composer-card-max-width, 100%) - 4 * var(--dsh-composer-dock-inset, 0px))',
  margin: '0 auto', height: 32, padding: '0 12px', display: 'flex', alignItems: 'center', gap: 8,
  font: 'inherit', fontSize: 12, textAlign: 'left', border: 0, borderRadius: 'var(--dsw-radius-sm, 8px)', whiteSpace: 'nowrap',
  background: 'var(--dsw-specific-menu, var(--dsw-alias-bg-layer-1))', boxShadow: 'var(--dsw-elevation-panel)',
  '--dsw-elevation-stroke-color': 'var(--dsw-alias-border-l1)', color: T.secondary, fontVariantNumeric: 'tabular-nums',
}
// The bar: one segment per work task, a 2 px gap between; above SEGMENT_MAX one fill.
const TRACK = { flex: 'none', height: 6, display: 'flex', gap: 2, alignItems: 'stretch' }
const SEGMENT = { flex: '1 1 0', minWidth: 3, borderRadius: 1.5, boxSizing: 'border-box' }
const FAINT = 'var(--dsw-alias-border-l4)'
// Status by fill and shape, never moving. Warn means one thing: the owner must
// act (design C), so waiting on anyone else is grey. now is half filled with
// the info accent; ready is a success outline; blocked faint.
const FILL = {
  done: { background: T.success },
  now: { background: 'linear-gradient(to right, ' + T.info + ' 50%, ' + FAINT + ' 50%)', boxShadow: 'inset 0 0 0 1px ' + T.info },
  waiting: { background: T.tertiary },
  'needs you': { background: T.warn, boxShadow: 'inset 0 0 0 1px ' + T.primary },
  ready: { background: 'transparent', boxShadow: 'inset 0 0 0 1px ' + T.success },
  blocked: { background: FAINT },
}

/**
 * The dock's model (pure; exported for tests): undefined, so nothing renders,
 * unless the session has a bound board that parsed; else the progress with its
 * segments, its phrase, the done fraction and the strip (stripModel).
 */
function dockModel(view) {
  if (!view || !view.key || !view.board) return undefined
  const p = boardProgress(view.board)
  const strip = stripModel({ ...view.board, key: view.board.key || view.key })
  return { ...p, text: boardProgressText(p), fraction: p.total ? p.done / p.total : 0, strip, line: stripText(strip) }
}

/** The bar as text, for tests and the report: "[✓][✓][◐ now][·blocked][…waiting]". */
const SEGMENT_TEXT = { done: '✓', now: '◐ now', waiting: '…waiting', 'needs you': '!!needs you', ready: '○ready', blocked: '·blocked' }
const segmentsText = (m) => (m.continuous ? '[' + '█'.repeat(Math.round(m.fraction * 10)).padEnd(10, '░') + ']' : m.segments.map((g) => '[' + SEGMENT_TEXT[g.kind] + ']').join(''))

/** The segmented bar: in the strip (6 px, fixed width) or thin in the panel's parent row (4 px, full width). */
function Bar({ m, onSegment, thin }) {
  const track = thin ? { ...TRACK, height: 4, width: '100%', margin: '4px 0 2px' } : { ...TRACK, width: Math.min(180, Math.max(72, m.segments.length * 16)) }
  const aria = { role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': m.total, 'aria-valuenow': m.done, 'aria-label': 'Tasks done' }
  if (m.continuous || !m.segments.length) {
    return h('span', { ...aria, title: progressText(m), style: { ...track, borderRadius: 2, overflow: 'hidden', background: FAINT, ...(thin ? {} : { width: 72 }) } },
      h('span', { style: { display: 'block', height: '100%', width: Math.round(m.fraction * 100) + '%', background: T.success } }))
  }
  return h('span', { ...aria, style: track },
    m.segments.map((g) => h('span', {
      key: g.item, 'data-segment': g.kind, 'data-item': g.item, title: g.tooltip,
      onClick: onSegment ? (e) => { e.stopPropagation(); onSegment(g.item) } : undefined,
      style: { ...SEGMENT, ...FILL[g.kind], cursor: onSegment ? 'pointer' : 'default' },
    })))
}

const sep = (key) => h('span', { key, 'aria-hidden': true, style: { color: T.tertiary } }, '·')

function CopyCommand({ command, label }) {
  const [state, copy] = useCopy(command)
  return h('button', { type: 'button', className: 'dshc-btn', 'data-copy-state': state, 'aria-label': state === 'idle' ? label : COPY_LABEL[state], onClick: copy, style: { height: 22, color: state === 'failed' ? T.error : T.primary, background: T.surface1 } },
    state === 'idle' ? 'Copy command' : COPY_LABEL[state])
}

function BoardDock({ sessionId, openBoard }) {
  useStyle()
  const { view } = useView(sessionId)
  const m = dockModel(view)
  if (!m) return null
  const s = m.strip
  const open = openBoard ? () => openBoard() : undefined
  const go = h('button', {
    key: 'go', type: 'button', onClick: open ? (e) => { e.stopPropagation(); openBoard(s.kind === 'needs you' ? s.item : undefined) } : undefined,
    style: { font: 'inherit', fontWeight: 500, color: T.secondary, background: 'none', border: 0, padding: '0 2px', cursor: open ? 'pointer' : 'default', flex: 'none' },
  }, 'Board ›')
  const fill = { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }
  const parts = s.kind === 'needs you'
    ? [
      h('span', { key: 'w', style: { color: T.warn, display: 'inline-flex', flex: 'none' } }, warnIcon(12)),
      h('span', { key: 'f', style: fill, title: s.text }, h('span', { style: { color: T.warn, fontWeight: 500 } }, s.text.slice(0, s.text.indexOf(':') + 1) || s.text), s.text.indexOf(':') > 0 ? s.text.slice(s.text.indexOf(':') + 1) : null),
      s.command ? h(CopyCommand, { key: 'c', command: s.command, label: 'Copy command for ' + s.text.slice(11) }) : null,
      s.command ? sep('s2') : null,
      go,
    ]
    : [
      h('span', { key: 'k', className: 'dshc-mono', style: { color: T.tertiary, flex: 'none' } }, s.key),
      sep('s1'),
      h('span', { key: 'd', style: { color: T.primary, flex: 'none' } }, s.done),
      s.focus ? sep('s2') : null,
      h('span', { key: 'f', style: fill, title: s.focus }, s.focus || ''),
      go,
    ]
  return h('div', { 'data-dsh-cockpit-dock': '', 'data-strip': s.kind, style: DOCK },
    // A div, not a button: the segments and buttons inside take their own clicks.
    h('div', {
      role: openBoard ? 'button' : undefined, tabIndex: openBoard ? 0 : undefined, onClick: open, 'aria-label': m.line,
      onKeyDown: open ? (e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open() } } : undefined,
      style: { ...DOCK_BAR, cursor: openBoard ? 'pointer' : 'default' },
    },
      h(Bar, { m, onSegment: openBoard }),
      parts))
}

// ---- Chat cards for the board tools (the keyed tool.call.toolview slot) ----

const muted = { color: T.tertiary }
const secondary = { color: T.secondary }
const mono = { fontFamily: T.mono }
const small = { fontSize: 'var(--dsh-content-font-size-secondary, 12px)' }

const parseArgs = (raw) => { try { const v = JSON.parse(raw); return v && typeof v === 'object' ? v : {} } catch { return {} } }

/**
 * The card's one-line state and title (pure; exported for tests). The title is
 * the result meta's title when the host recorded one, else lib/present.js's
 * call title from the arguments.
 */
function toolCardModel(props) {
  const name = props.toolName || props.block?.name
  const block = props.block || {}
  if (props.phase === 'preparing') return { state: 'running', title: 'Board', summary: name }
  const settled = props.phase === 'result'
  const args = parseArgs(settled ? block.call?.argsRaw ?? '' : block.argsRaw ?? '')
  const metaTitle = settled && block.meta && typeof block.meta.title === 'string' ? block.meta.title : undefined
  const state = !settled ? 'running' : block.error?.code === 'interrupted' ? 'stopped' : block.isError ? 'error' : 'ok'
  let output = null
  if (settled) {
    const parts = (block.content || []).map((c) => (c.type === 'text' ? c.text : JSON.stringify(c)))
    output = parts.join('\n') || null
    if (output) { try { const v = JSON.parse(output); if (v && v.ok === false) return { state: 'error', title: 'Board', summary: callTitle(name, args) + ' · ' + v.code, output } } catch {} }
  }
  const summary = (metaTitle || callTitle(name, args)) + (state === 'error' ? ' · failed' : state === 'stopped' ? ' · stopped' : '')
  return { state, title: 'Board', summary, output }
}

function pretty(output) {
  try { const v = JSON.parse(output); return typeof v?.tree === 'string' ? v.tree : JSON.stringify(v, null, 2) } catch { return output }
}

function BoardToolRow(props) {
  const model = toolCardModel(props)
  const disclosure = props.useDisclosure ? props.useDisclosure() : null
  const [localOpen, setLocalOpen] = React.useState(false)
  const open = disclosure ? disclosure.expanded : localOpen
  const toggle = disclosure ? disclosure.toggle : () => setLocalOpen(!localOpen)
  const expandable = model.output !== null && model.output !== undefined
  const summaryStyle = model.state === 'error' ? { color: 'var(--dsw-alias-state-error-primary)' } : model.state === 'stopped' ? { color: 'var(--dsw-alias-state-warn-label)' } : null
  const Icon = primitives.IconChecklistOutlineRegular
  const icon = Icon ? h(Icon, { size: 14 }) : null
  const summary = h('span', { style: { ...small, ...summaryStyle, marginLeft: 8, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, model.summary)
  const body = open && expandable ? h('pre', { style: { ...mono, ...small, ...secondary, whiteSpace: 'pre-wrap', margin: '4px 0 4px 4px', maxHeight: 260, overflow: 'auto' } }, pretty(model.output)) : null
  if (primitives.DisclosureRow) {
    return h('div', { 'data-tool': props.toolName, 'data-state': model.state },
      h(primitives.DisclosureRow, { icon, title: model.title, open: open && expandable, expandable, onToggle: toggle, running: model.state === 'running', expandOnRowClick: true, collapsedContent: summary, keepContentWhenOpen: true }, body))
  }
  return h('div', { 'data-tool': props.toolName, 'data-state': model.state, style: { ...muted } },
    h('div', { onClick: expandable ? toggle : undefined, style: { cursor: expandable ? 'pointer' : 'default', display: 'flex', alignItems: 'center' } }, icon, h('span', { style: small }, model.title), summary),
    body)
}

const inject = ['slots', 'sidebarRightTabs', 'sidebarRight']

function apply(ctx) {
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: ID,
    kind: KIND,
    title: () => 'Board',
    guide: [{ id: 'open', order: 70, title: () => 'Board', description: () => "This session's dsh-cockpit board" }],
  }), 'dsh-cockpit: sidebar tab')
  ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: ID,
    inject: (sessionId) => ({ sessionId }),
  }, BoardBody))
  for (const key of TOOLS) {
    ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({ name: 'tool.call.toolview', key }, BoardToolRow))
  }
  // Above the input box, after the Todo, Goal and Queue docks (orders 0, 10, 20).
  // A click opens the Board tab: openTab acts on the on-screen session, the dock's;
  // a segment's click also names its row.
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'dsh-cockpit-progress',
    order: 30,
    // With an item, the Board scrolls to its row (navigation params, see useShowRow).
    inject: (sessionId) => ({ sessionId, openBoard: (item) => ctx.sidebarRight.openTab(KIND, item === undefined ? undefined : { params: { item } }) }),
  }, BoardDock))
}

module.exports = { apply, inject, treeOrder, boardRows, boardProgress, needsYou, problems, taskUrl, whenText, showDrift, driftText, headerMeta, dockModel, segmentsText, toolCardModel, copyStep, copyText, TOOLS, CSS }