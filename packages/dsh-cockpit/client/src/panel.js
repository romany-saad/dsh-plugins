// dsh-cockpit's browser half: the read-only Board tab in the right sidebar
// (design section 6, C · Outline, refined, with the owner's changes).
// A plain CommonJS body: client/build.mjs wraps it in the module-loader
// factory and inlines lib/rows.js and client/src/command-box.js, so the tab
// and the hub's tree text share their rules. Its one shell require is react.
// Board text is rendered only as text (React escapes it); only http(s) URLs
// become links, in a new tab with rel="noopener noreferrer". Nothing here
// writes to the board or runs a command.
const React = require('react')
const { EMPTY_STATE, boardFlags, boardRows, boardSegments, driftState, driftWords, needsYou, problems, progressText, prText, refUrl, rowCells, shortRef, titleParts } = require('../../lib/rows.js')
const { makeCommandBox, copyStep, copyText } = require('./command-box.js')
const { CommandBox } = makeCommandBox(React)
const h = React.createElement

const ID = '@romany-saad/dsh-cockpit'
const KIND = 'dsh-cockpit-board'
const POLL_MS = 2000
// Relative to the document, as dsh-client-ui-deliverables does, so a mounted app works.
const VIEW = 'api/dsh-cockpit/view'

// ---- Style: host tokens only (dsh-client-ui-theme), one stylesheet in the head ----
// The panel's own colour names, set per theme on its root. Where a host token
// misses the spec's contrast rule in the light theme (text 4.5:1, marks 3:1),
// the light value mixes it toward label-primary; the PR body has the table.
const TOKENS = [
  '[data-dsh-cockpit-board]{',
  '--dshc-l0:var(--dsw-alias-bg-base);--dshc-l1:var(--dsw-alias-bg-skeleton);--dshc-l2:var(--dsw-alias-bg-module-platform);',
  '--dshc-border:var(--dsw-alias-border-l1);--dshc-p:var(--dsw-alias-label-primary);--dshc-s:var(--dsw-alias-label-secondary);',
  '--dshc-mark:var(--dsw-alias-label-tertiary);--dshc-info:var(--dsw-alias-state-business-primary);',
  // Light: label-tertiary text is 3.7:1 on white, so tertiary text uses label-secondary.
  '--dshc-t:var(--dsw-alias-label-secondary);',
  '--dshc-warn:color-mix(in srgb,var(--dsw-alias-state-warn-label) 65%,var(--dsw-alias-label-primary));',
  '--dshc-warn-mark:var(--dsw-alias-state-warn-primary);',
  '--dshc-ok:color-mix(in srgb,var(--dsw-alias-state-success-primary) 60%,var(--dsw-alias-label-primary));',
  '--dshc-ok-mark:color-mix(in srgb,var(--dsw-alias-state-success-primary) 80%,var(--dsw-alias-label-primary));',
  '--dshc-err:color-mix(in srgb,var(--dsw-alias-state-error-primary) 80%,var(--dsw-alias-label-primary))}',
  'body[data-ds-dark-theme] [data-dsh-cockpit-board]{--dshc-t:var(--dsw-alias-label-tertiary);--dshc-warn:var(--dsw-alias-state-warn-label);',
  '--dshc-ok:var(--dsw-alias-state-success-primary);--dshc-ok-mark:var(--dsw-alias-state-success-primary);--dshc-err:var(--dsw-alias-state-error-primary)}',
].join('')
const MONO = 'var(--ds-font-family-code,ui-monospace,monospace)'
const CSS = [
  TOKENS,
  '[data-dsh-cockpit-board]{box-sizing:border-box;height:100%;overflow:auto;color:var(--dshc-p);font-size:13px;line-height:20px;font-variant-numeric:tabular-nums}',
  '[data-dsh-cockpit-board] *{box-sizing:border-box}',
  '.dshc-mono{font-family:' + MONO + ';font-variant-ligatures:none}',
  '.dshc-trunc{display:block;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.dshc-wrap{display:block;min-width:0;overflow-wrap:anywhere}',
  '[data-dsh-cockpit-board] a{color:inherit;text-decoration:none}[data-dsh-cockpit-board] a:hover{text-decoration:underline}',
  '.dshc-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}',
  '.dshc-hd{padding:12px 12px 10px;border-bottom:1px solid var(--dshc-border)}',
  '.dshc-hd1{display:flex;align-items:baseline;justify-content:space-between;gap:12px}',
  '.dshc-hdl{display:flex;align-items:baseline;gap:8px;min-width:0}',
  '.dshc-key{font-size:13px;font-weight:500;flex:none;max-width:60%}',
  '.dshc-parent{font-size:12px;color:var(--dshc-t)}',
  '.dshc-meta{font-size:12px;color:var(--dshc-t);white-space:nowrap;flex:none}',
  '.dshc-drift{font-size:12px;line-height:16px;color:var(--dshc-t);margin-top:2px}',
  '.dshc-sec{padding:10px 12px 12px;border-bottom:1px solid var(--dshc-border)}',
  '.dshc-sech{display:flex;align-items:center;gap:6px;font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;line-height:16px;margin-bottom:8px}',
  '.dshc-warn{color:var(--dshc-warn)}.dshc-err{color:var(--dshc-err)}',
  '.dshc-ni{display:grid;grid-template-columns:36px minmax(0,1fr) auto;column-gap:8px;row-gap:4px;background:var(--dshc-l1);border:1px solid var(--dshc-border);border-radius:8px;padding:8px}',
  '.dshc-ni+.dshc-ni{margin-top:8px}',
  '.dshc-ni .dshc-id{color:var(--dshc-t);font-size:12px}',
  '.dshc-nit{font-weight:500}',
  '.dshc-ask{grid-column:2/4;font-size:12px;line-height:16px;color:var(--dshc-s);overflow-wrap:anywhere}',
  '.dshc-ni .dshc-cmd{grid-column:1/4}',
  '.dshc-open{display:inline-flex;align-items:center;gap:4px;font-size:12px;color:var(--dshc-s);white-space:nowrap}',
  '.dshc-cmd{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:start;background:var(--dshc-l2);border:1px solid var(--dshc-border);border-radius:6px;padding:4px 4px 4px 10px;margin-top:4px;position:relative}',
  '.dshc-cmd code{font-family:' + MONO + ';font-size:12px;line-height:18px;padding:3px 0;color:var(--dshc-p);white-space:pre-wrap;overflow-wrap:anywhere;min-width:0}',
  '.dshc-btn{display:inline-flex;align-items:center;gap:4px;height:24px;padding:0 8px;border-radius:4px;border:1px solid var(--dshc-border);background:var(--dshc-l0);color:var(--dshc-p);font:inherit;font-size:12px;font-weight:500;line-height:1;cursor:pointer;white-space:nowrap;flex:none}',
  '.dshc-btn[data-copy-state=failed]{color:var(--dshc-err)}',
  '.dshc-prob{display:grid;grid-template-columns:16px minmax(0,1fr) 20px;column-gap:8px;align-items:start;width:100%;min-height:28px;padding:4px 0;border:0;background:none;font:inherit;font-size:12px;line-height:18px;color:var(--dshc-p);text-align:left;cursor:pointer}',
  '.dshc-prob .dshc-ic{color:var(--dshc-err);display:flex;padding-top:2px}.dshc-prob .dshc-go{color:var(--dshc-t);display:flex;justify-content:center;padding-top:2px}',
  '.dshc-tree{margin:0;padding:0;list-style:none}',
  '.dshc-li{list-style:none;border-bottom:1px solid var(--dshc-border)}',
  '.dshc-li:focus{outline:2px solid var(--dshc-info);outline-offset:-2px}',
  '.dshc-row{display:grid;grid-template-columns:36px 68px minmax(0,1fr) 60px 20px;column-gap:8px;row-gap:2px;align-items:start;padding:6px 12px}',
  '.dshc-row>*{min-height:20px}',
  '.dshc-li.dshc-parentrow{background:var(--dshc-l1)}',
  '.dshc-parentrow .dshc-ct{font-weight:600}',
  '.dshc-cid{font-size:12px;color:var(--dshc-t);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.dshc-cst{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--dshc-s)}',
  '.dshc-check{color:var(--dshc-ok-mark);flex:none}',
  '.dshc-mark{display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;flex:none}',
  '.dshc-dot{width:8px;height:8px;border-radius:50%}',
  '.dshc-dot-now{background:var(--dshc-info)}.dshc-dot-waiting{background:var(--dshc-mark)}',
  '.dshc-ring{width:8px;height:8px;border-radius:50%;border:1.5px solid var(--dshc-s)}',
  '.dshc-dash{width:8px;height:0;border-top:1.5px solid var(--dshc-mark)}',
  '.dshc-ct{display:flex;align-items:flex-start;min-width:0}',
  '.dshc-indent{flex:none}',
  '.dshc-elbow{flex:none;width:8px;height:8px;border-left:1px solid var(--dshc-mark);border-bottom:1px solid var(--dshc-mark);margin:4px 6px 0 2px}',
  '.dshc-closed .dshc-ct,.dshc-closed .dshc-cst{color:var(--dshc-s)}',
  '.dshc-dropped .dshc-tt{text-decoration:line-through}',
  '.dshc-cpr{font-size:12px;color:var(--dshc-s);text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
  '.dshc-chev{display:flex;align-items:center;justify-content:center;height:20px;padding:0;border:0;background:none;color:var(--dshc-t);cursor:pointer}',
  '.dshc-chev svg[data-open]{transform:rotate(90deg)}',
  '.dshc-cmeta{grid-column:3/5;display:flex;flex-direction:column;gap:2px;font-size:12px;line-height:16px;color:var(--dshc-s);min-height:0}',
  '.dshc-block{display:flex;align-items:flex-start;gap:6px;color:var(--dshc-p)}.dshc-block svg{flex:none;margin-top:2px}.dshc-block b{font-weight:500}.dshc-block .dshc-st{color:var(--dshc-t)}',
  '.dshc-mprob{display:flex;align-items:flex-start;gap:6px;color:var(--dshc-err)}.dshc-mprob svg{flex:none;margin-top:2px}',
  '.dshc-tag{align-self:flex-start;border:1px solid currentColor;border-radius:4px;padding:0 6px;font-size:11px;font-weight:600;line-height:16px}',
  '.dshc-tag-warn{color:var(--dshc-warn)}.dshc-tag-ok{color:var(--dshc-ok)}.dshc-tag-quiet{color:var(--dshc-s)}',
  '.dshc-detail{grid-column:2/5;margin-top:6px;padding-top:8px;border-top:1px dashed var(--dshc-border);min-height:0}',
  '.dshc-detail dl{display:grid;grid-template-columns:80px minmax(0,1fr);column-gap:8px;row-gap:4px;margin:0 0 4px;font-size:12px;line-height:16px}',
  '.dshc-detail dt{color:var(--dshc-t)}.dshc-detail dd{margin:0;color:var(--dshc-s);overflow-wrap:anywhere}.dshc-detail dd.dshc-mono{color:var(--dshc-p)}',
  '.dshc-pp{color:var(--dshc-s);font-weight:400}',
  '.dshc-need{color:var(--dshc-warn);font-weight:500}',
  // The thin bar: segments by shape, never moving.
  '.dshc-bar{display:flex;gap:2px;height:6px;width:100%;margin:4px 0 2px}',
  '.dshc-seg{flex:1 1 0;min-width:3px;border-radius:1.5px;cursor:pointer}',
  '.dshc-seg[data-segment=done]{background:var(--dshc-ok-mark)}',
  '.dshc-seg[data-segment=now]{background:linear-gradient(to right,var(--dshc-info) 50%,transparent 50%);box-shadow:inset 0 0 0 1px var(--dshc-info)}',
  '.dshc-seg[data-segment=waiting]{background:var(--dshc-mark)}',
  '.dshc-seg[data-segment="needs you"]{background:var(--dshc-warn-mark);box-shadow:inset 0 0 0 1px var(--dshc-warn)}',
  '.dshc-seg[data-segment=ready]{box-shadow:inset 0 0 0 1px var(--dshc-ok-mark)}',
  '.dshc-seg[data-segment=blocked]{border:1px dashed var(--dshc-mark)}',
  '.dshc-seg[data-segment=dropped]{background:linear-gradient(var(--dshc-mark),var(--dshc-mark)) center/100% 1px no-repeat}',
  '.dshc-fill{display:block;height:6px;width:100%;border-radius:2px;overflow:hidden;background:var(--dshc-border);margin:4px 0 2px}.dshc-fill>span{display:block;height:100%;background:var(--dshc-ok-mark)}',
  '.dshc-empty{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:0 40px;gap:6px}',
  '.dshc-empty p{margin:0}.dshc-empty-t{font-weight:500}.dshc-empty-s{font-size:12px;line-height:16px;color:var(--dshc-s);max-width:280px}',
  '.dshc-msg{padding:12px;color:var(--dshc-s);overflow-wrap:anywhere}',
].join('\n')

function useStyle() {
  React.useEffect(() => {
    if (typeof document === 'undefined') return
    let el = document.getElementById('dsh-cockpit-style')
    if (!el) {
      el = document.createElement('style')
      el.id = 'dsh-cockpit-style'
      document.head.appendChild(el)
    }
    // A reloaded bundle replaces the rules of the one before it.
    if (el.textContent !== CSS) el.textContent = CSS
  }, [])
}

// ---- Icons (16 px grid, stroke) ----
const svg = (size, children, extra) => h('svg', { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, ...extra }, children)
const warnIcon = (size = 12) => svg(size, [h('path', { key: 1, d: 'M8 2.5l6 10.5H2z' }), h('path', { key: 2, d: 'M8 6.5v3' }), h('path', { key: 3, d: 'M8 11.6v.1' })])
const checkIcon = () => svg(14, h('path', { d: 'M3.5 8.5l3 3 6-7' }), { strokeWidth: 1.8, className: 'dshc-check' })
const lockIcon = () => svg(12, [h('rect', { key: 1, x: 3.5, y: 7, width: 9, height: 6.5, rx: 1.5 }), h('path', { key: 2, d: 'M5.5 7V5a2.5 2.5 0 015 0v2' })])
const extIcon = () => svg(12, [h('path', { key: 1, d: 'M9 3.5h3.5V7' }), h('path', { key: 2, d: 'M12.5 3.5L7 9' }), h('path', { key: 3, d: 'M11 9.5v2.5a1 1 0 01-1 1H4.5a1 1 0 01-1-1V6.5a1 1 0 011-1H7' })], { strokeWidth: 1.5 })
const downIcon = () => svg(14, [h('path', { key: 1, d: 'M8 3.5v9' }), h('path', { key: 2, d: 'M4.5 9L8 12.5 11.5 9' })], { strokeWidth: 1.5 })
const chevIcon = (open) => svg(14, h('path', { d: 'M6 4l4 4-4 4' }), { 'data-open': open || undefined })

/** An http(s) URL, or undefined: nothing else ever becomes an href. */
const safeUrl = (url) => (typeof url === 'string' && /^https?:\/\/\S+$/i.test(url) ? url : undefined)
const stop = (e) => e.stopPropagation()
/** A link that opens in a new tab, or the plain text without a safe URL. */
function Link({ url, title, className, children }) {
  const href = safeUrl(url)
  if (!href) return h('span', { className, title }, children)
  return h('a', { href, target: '_blank', rel: 'noopener noreferrer', title, className, onClick: stop }, children)
}

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
/** "15:22" in local time, with the date when it is not today. */
function clockText(iso, now = Date.now()) {
  const at = new Date(iso)
  if (!iso || Number.isNaN(at.getTime())) return iso ? String(iso) : ''
  const today = new Date(now)
  const clock = pad2(at.getHours()) + ':' + pad2(at.getMinutes())
  const sameDay = at.getFullYear() === today.getFullYear() && at.getMonth() === today.getMonth() && at.getDate() === today.getDate()
  return sameDay ? clock : at.getFullYear() + '-' + pad2(at.getMonth() + 1) + '-' + pad2(at.getDate()) + ' ' + clock
}
/** "15:22 · 2 min ago". */
function whenText(iso, now = Date.now()) {
  const at = new Date(iso)
  if (!iso || Number.isNaN(at.getTime())) return iso ? String(iso) : ''
  const s = Math.round((now - at.getTime()) / 1000)
  const ago = s < 0 ? 'in the future' : s < 60 ? 'just now' : s < 3600 ? Math.floor(s / 60) + ' min ago'
    : s < 86400 ? Math.floor(s / 3600) + ' h ago' : Math.floor(s / 86400) + ' d ago'
  return clockText(iso, now) + ' · ' + ago
}

/** The header's right side: "rev 33 · 15:34 · 9 min ago". */
const headerMeta = (board, now) => ['rev ' + board.revision, board.updatedAt ? whenText(board.updatedAt, now) : ''].filter(Boolean).join(' · ')

/** "Drift: 1 differs · 16:40", "Drift: matches · 16:40", "Drift: not run yet". */
function driftLine(state, now) {
  const at = state.at ? ' · ' + clockText(state.at, now) : ''
  return 'Drift: ' + driftWords(state) + at
}

/** The drift line shows when a drift command is configured or the file holds a result. */
const showDrift = (view) => Boolean(view.driftConfigured || view.board?.drift)

// ---- Rows: expand state kept by board and item across refreshes and remounts ----
const expanded = new Map()

/** Move focus to a row, centred, without animation (the problems lines). */
function showRow(item) {
  const el = typeof document !== 'undefined' && document.querySelector('[data-dsh-cockpit-board] li[data-item="' + String(item).replace(/["\\]/g, '\\$&') + '"]')
  if (!el) return
  el.scrollIntoView({ block: 'center' })
  el.focus({ preventScroll: true })
}

function Header({ board, view, rows, now }) {
  const drift = driftState(board.drift, rows)
  return h('header', { className: 'dshc-hd' },
    h('div', { className: 'dshc-hd1' },
      h('span', { className: 'dshc-hdl' },
        h('span', { className: 'dshc-mono dshc-key dshc-trunc', title: board.key }, board.key),
        board.parent ? h('span', { className: 'dshc-parent dshc-trunc', title: board.parent }, board.parent) : null),
      h('span', { className: 'dshc-meta' }, headerMeta(board, now))),
    showDrift(view) ? h('div', { className: 'dshc-drift', 'data-drift': drift.kind, title: drift.error }, driftLine(drift, now)) : null)
}

/** The title cell's text: the issue (short, linked, full in the tooltip), then what. */
function Title({ task, parent, url, className, plainTitle }) {
  const p = titleParts(task, parent)
  return h('span', { className: 'dshc-tt ' + className, title: plainTitle },
    p.issue ? h(Link, { url, title: p.issue }, p.ref) : null,
    p.issue && p.what ? ' ' : null,
    p.what)
}

/** "Open PR #892 ↗" for a linked pr, else "Open #884 ↗" for a linked issue; nothing without a link. */
function OpenLink({ row, parent }) {
  const pr = safeUrl(row.prUrl)
  const url = pr || safeUrl(row.issueUrl)
  if (!url) return null
  const label = pr ? 'Open ' + prText(row.pr) : 'Open ' + shortRef(row.issue, parent)
  return h('a', { className: 'dshc-open', href: url, target: '_blank', rel: 'noopener noreferrer', title: pr ? row.pr : row.issue, onClick: stop }, label, extIcon())
}

function NeedsYou({ board, rows, byItem }) {
  const mine = needsYou(board.tasks)
  if (!mine.length) return null
  const rowOf = new Map(rows.map((r) => [r.item, r]))
  return h('section', { className: 'dshc-sec', 'data-needs-you': '', 'aria-label': 'Needs you' },
    h('div', { className: 'dshc-sech dshc-warn' }, warnIcon(), 'Needs you'),
    mine.map((t) => {
      const r = rowOf.get(t.item)
      const ask = typeof t.nextAction === 'string' && t.nextAction.trim() ? t.nextAction.trim() : undefined
      const command = typeof t.readyCommand === 'string' && t.readyCommand.trim() ? t.readyCommand.trim() : undefined
      return h('div', { key: t.item, className: 'dshc-ni', 'data-item': t.item },
        h('span', { className: 'dshc-mono dshc-id' }, t.item),
        h(Title, { task: byItem.get(t.item), parent: board.parent, url: r && r.issueUrl, className: 'dshc-wrap dshc-nit' }),
        r ? h(OpenLink, { row: r, parent: board.parent }) || h('span', null) : h('span', null),
        ask ? h('span', { className: 'dshc-ask' }, ask) : null,
        command ? h(CommandBox, { command, label: 'Copy command for ' + (r ? r.title : t.item) }) : null)
    }))
}

/** One line per problem, naming its reference; ↓ moves focus to its row. None: nothing. */
function Problems({ list }) {
  if (!list.length) return null
  return h('section', { className: 'dshc-sec', 'data-problems': '', 'aria-label': 'Board data problems' },
    h('div', { className: 'dshc-sech dshc-err' }, 'Board data problems'),
    list.map((p, i) => h('button', { key: i, type: 'button', className: 'dshc-prob', 'data-item': p.item, onClick: () => showRow(p.item) },
      h('span', { className: 'dshc-ic' }, warnIcon(14)),
      h('span', { className: 'dshc-wrap' }, p.text),
      h('span', { className: 'dshc-go', 'aria-label': 'Go to row', role: 'img' }, downIcon()))))
}

function Mark({ mark }) {
  if (mark === 'check') return checkIcon()
  const cls = mark === 'ring' ? 'dshc-ring' : mark === 'dash' ? 'dshc-dash' : 'dshc-dot dshc-' + mark
  return h('span', { className: 'dshc-mark', 'aria-hidden': true }, h('span', { className: cls }))
}

const tag = (key, cls, words, title) => h('span', { key, className: 'dshc-tag ' + cls, title }, words)

/** The thin bar of the parent row: one segment per work task, by shape; above 24 one fill. */
function Bar({ bar }) {
  const aria = { role: 'img', 'aria-label': progressText({ done: bar.done, dropped: bar.dropped, total: bar.total }) + ' (work tasks)' }
  if (bar.continuous) {
    const open = bar.total - bar.dropped
    const width = open > 0 ? Math.round((bar.done / open) * 100) : 100
    return h('span', { ...aria, className: 'dshc-fill', title: aria['aria-label'] }, h('span', { style: { width: width + '%' } }))
  }
  return h('span', { ...aria, className: 'dshc-bar' },
    bar.segments.map((g) => h('span', { key: g.item, className: 'dshc-seg', 'data-segment': g.kind, 'data-item': g.item, title: g.tooltip, onClick: (e) => { e.stopPropagation(); showRow(g.item) } })))
}

function Meta({ c, bar, parent }) {
  const lines = []
  if (bar) lines.push(h(Bar, { key: 'bar', bar }))
  if (c.progress) {
    lines.push(h('span', { key: 'p', className: 'dshc-pp' }, progressText({ ...c.progress, needsYou: 0 }),
      c.progress.needsYou ? [' · ', h('span', { key: 'n', className: 'dshc-need' }, c.progress.needsYou + ' needs you')] : null))
  }
  if (c.line) lines.push(h('span', { key: 'line', className: 'dshc-wrap', 'data-line': '' }, c.line))
  if (c.needsYou) lines.push(tag('you', 'dshc-tag-warn', 'Needs you · see top'))
  if (c.blockedBy.length) {
    lines.push(h('span', { key: 'b', className: 'dshc-block' }, lockIcon(),
      h('span', { className: 'dshc-wrap' }, h('b', null, 'Blocked by '), c.blockedBy.map((b, i) => h('span', { key: i }, i ? ', ' : '', h('b', { title: b.ref }, shortRef(b.ref, parent)), ' ', h('span', { className: 'dshc-st' }, '(' + b.status + ')'))))))
  }
  if (c.ready) lines.push(tag('ready', 'dshc-tag-ok', 'ready'))
  c.problems.forEach((p, i) => lines.push(h('span', { key: 'f' + i, className: 'dshc-mprob' }, warnIcon(12), h('span', { className: 'dshc-wrap' }, p))))
  if (c.reported) lines.push(tag('drift', 'dshc-tag-quiet', c.reported.text, c.reported.note))
  return lines.length ? h('div', { className: 'dshc-cmeta' }, lines) : null
}

function Detail({ c, title }) {
  return h('div', { className: 'dshc-detail', 'data-detail': '' },
    c.detail.length ? h('dl', null, c.detail.map((d) => [h('dt', { key: d.key + 't' }, d.key), h('dd', { key: d.key + 'd', className: d.mono ? 'dshc-mono' : undefined }, d.value)])) : null,
    c.command ? h(CommandBox, { command: c.command, label: 'Copy command for ' + title }) : null)
}

function TaskRow({ boardKey, parent, row, task, flags, bar }) {
  const c = rowCells(row, flags)
  const id = boardKey + '\u0000' + row.item
  const [open, setOpen] = React.useState(expanded.get(id) === true)
  const toggle = () => { expanded.set(id, !open); setOpen(!open) }
  const isOpen = c.expandable && open
  const cls = 'dshc-li' + (c.parent ? ' dshc-parentrow' : '') + (row.closed ? ' dshc-closed' : '') + (row.dropped ? ' dshc-dropped' : '')
  return h('li', { 'data-item': row.item, 'data-status': row.status, tabIndex: -1, className: cls },
    h('div', { className: 'dshc-row', onClick: c.expandable ? (e) => { if (!e.target.closest || !e.target.closest('a,button,[data-segment]')) toggle() } : undefined, style: c.expandable ? { cursor: 'pointer' } : undefined },
      h('span', { className: 'dshc-mono dshc-cid', title: row.item }, row.item),
      h('span', { className: 'dshc-cst' }, c.mark ? h(Mark, { mark: c.mark }) : null, c.status ? h('span', null, c.status) : null),
      h('span', { className: 'dshc-ct' },
        c.indent ? h('span', { className: 'dshc-indent', style: { width: c.indent * 16 } }) : null,
        c.elbow ? h('span', { className: 'dshc-elbow', 'aria-hidden': true }) : null,
        h(Title, { task, parent, url: row.issueUrl, className: c.wrap ? 'dshc-wrap' : 'dshc-trunc', plainTitle: c.wrap ? undefined : row.title })),
      h('span', { className: 'dshc-cpr' }, c.pr ? h(Link, { url: c.prUrl, title: row.pr }, c.pr) : null),
      c.expandable
        ? h('button', { type: 'button', className: 'dshc-chev', 'aria-expanded': isOpen, 'aria-label': 'Details for ' + row.title, onClick: (e) => { e.stopPropagation(); toggle() } }, chevIcon(isOpen))
        : h('span', null),
      h(Meta, { c, bar, parent }),
      isOpen ? h(Detail, { c, title: row.title }) : null))
}

function Empty() {
  return h('div', { className: 'dshc-empty', 'data-empty': '' }, h('p', { className: 'dshc-empty-t' }, EMPTY_STATE.title), h('p', { className: 'dshc-empty-s' }, EMPTY_STATE.line))
}

/** The tab's body for one view answer (pure render; exported for tests). */
function BoardView({ view, now }) {
  if (!view.key) return h(Empty)
  if (!view.board) return h('p', { className: 'dshc-msg', role: 'alert' }, view.key + ': ' + view.error)
  const { board } = view
  const tasks = Array.isArray(board.tasks) ? board.tasks : []
  const links = view.links && typeof view.links === 'object' ? view.links : {}
  const rows = boardRows(board, { links })
  const byItem = new Map(tasks.map((t) => [t.item, t]))
  // Flags and problems from the shared rules, so the tab and the hub's text agree.
  const flags = boardFlags(tasks)
  const flagsOf = new Map()
  for (const f of flags) { if (!flagsOf.has(f.item)) flagsOf.set(f.item, []); flagsOf.get(f.item).push(f) }
  // The thin bar sits in the board's one parent row (the root with children).
  const roots = rows.filter((r) => r.depth === 0 && r.progress)
  const bar = roots.length === 1 ? boardSegments(board) : undefined
  return h('div', null,
    h(Header, { board, view, rows, now }),
    h(NeedsYou, { board, rows, byItem }),
    h(Problems, { list: problems(tasks, flags) }),
    rows.length
      ? h('ul', { className: 'dshc-tree', role: 'list' }, rows.map((row) => h(TaskRow, {
        key: row.item, boardKey: board.key, parent: board.parent, row, task: byItem.get(row.item), flags: flagsOf.get(row.item) || [],
        bar: bar && roots[0] === row ? bar : undefined,
      })))
      : h('p', { className: 'dshc-msg' }, 'No tasks yet.'))
}

function BoardBody({ sessionId }) {
  useStyle()
  const { loading, view, error } = useView(sessionId)
  const now = useMinute()
  const wrap = (child) => h('section', { 'data-dsh-cockpit-board': '' }, child)
  if (loading) return wrap(h('p', { className: 'dshc-msg' }, 'Loading board…'))
  if (error) return wrap(h('p', { className: 'dshc-msg', role: 'alert' }, 'Board unavailable: ' + error))
  return wrap(h(BoardView, { view, now }))
}

const inject = ['slots', 'sidebarRightTabs']

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
}

module.exports = { apply, inject, BoardView, whenText, clockText, headerMeta, driftLine, showDrift, safeUrl, copyStep, copyText, refUrl, CSS, ID, KIND }
