// @rs-dsh/dsh-drafts: browser half (hand-written, no build step).
//
// A new conversation you typed into and then left keeps its draft: DSH saves
// every Session's composer draft in localStorage (`dsh.conversation.<id>`),
// but the Session stays blank, so the sidebar hides it, and New Session opens
// another blank one. This plugin lists those drafts in a card above the
// composer of a blank new conversation, with Open and Discard.
//
// Extension points used (DSH 0.2.x), no DOM surgery on host-owned nodes:
//   slots 'conversation.input.dock'  the card, above the composer
//   useSessions / useWorkspaces    which Sessions are blank, archived, where
//   sessions.create({ sessionId })   resume the blank Session (Host reuses it)
//   uiWorkspace.openSession          navigate to it
//   conversation.input.for().setDraft  clear a draft that is loaded in memory
window.__ModuleLoader__.load({
  id: '@rs-dsh/dsh-drafts',
  factory: () => {
    'use strict'
    const module = { exports: {} }

    const NS = 'dsh-drafts'
    const PLUGIN = 'dsh-drafts'
    // DSH's per-Session Conversation store key (ui-conversation CONVERSATION_STORE_KEY).
    const STORE_PREFIX = 'dsh.conversation.'
    const PREVIEW = 160

    // ------------------------------------------------------------ pure logic

    /** The text of a stored draft value: a legacy string or a { text, references } snapshot. */
    function draftText(value) {
      if (typeof value === 'string') return value
      if (value !== null && typeof value === 'object' && typeof value.text === 'string') return value.text
      return ''
    }

    /** Parse one store entry; the draft value and its text, or null. */
    function parseEntry(raw) {
      if (typeof raw !== 'string') return null
      let stored
      try { stored = JSON.parse(raw) } catch (_) { return null }
      if (stored === null || typeof stored !== 'object' || !('draft' in stored)) return null
      const text = draftText(stored.draft)
      return { stored, draft: stored.draft, text }
    }

    /** Every non-empty saved draft in a Storage: sessionId → { draft, text }. */
    function readDrafts(storage) {
      const out = new Map()
      if (storage === undefined || storage === null) return out
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i)
        if (key === null || !key.startsWith(STORE_PREFIX)) continue
        const id = key.slice(STORE_PREFIX.length)
        if (id === '') continue
        const entry = parseEntry(storage.getItem(key))
        if (entry === null || entry.text.trim() === '') continue
        out.set(id, { draft: entry.draft, text: entry.text })
      }
      return out
    }

    /**
     * The drafts left in blank new conversations, newest first: the Session is
     * in the Host list, still blank, not archived, not a subagent, and not the
     * one open now.
     */
    function lostDrafts({ drafts, sessions, workspaces, currentId }) {
      const archived = new Set(workspaces?.archivedSessionIds ?? [])
      const items = workspaces?.items ?? []
      const listed = new Set(sessions?.ids ?? [])
      const out = []
      for (const [id, entry] of drafts) {
        if (id === currentId || !listed.has(id) || archived.has(id)) continue
        const summary = sessions.byId[id]
        if (summary === undefined || summary.blank !== true) continue
        if (summary.origin === 'subagent' || summary.parentId !== undefined) continue
        const workspace = items.find((w) => w.sessionIds.includes(id))
        out.push({
          id,
          text: entry.text,
          draft: entry.draft,
          updatedAt: typeof summary.updatedAt === 'number' ? summary.updatedAt : 0,
          cwd: summary.cwd,
          agentPreset: typeof summary.projectionValues?.agentPreset === 'string' ? summary.projectionValues.agentPreset : undefined,
          workspaceId: workspace?.workspaceId,
          workspaceTitle: workspace?.title,
        })
      }
      return out.sort((a, b) => b.updatedAt - a.updatedAt || (a.id < b.id ? -1 : 1))
    }

    /** Copy a store entry's draft, keeping the rest of its fields, with `draft` replaced. */
    function withDraft(raw, draft) {
      const entry = parseEntry(raw)
      const base = entry === null ? { view: null, viewRequest: null } : entry.stored
      return JSON.stringify({ ...base, draft })
    }

    // ------------------------------------------------------------ strings

    const zh = {
      title: '未发送的草稿',
      count: '{n} 条',
      open: '打开',
      discard: '丢弃',
      undo: '撤销',
      discarded: '草稿已丢弃',
      defaultWorkspace: '默认工作区',
      openFailed: '无法打开该草稿，请稍后重试。',
      expand: '展开草稿',
      collapse: '收起草稿',
      'time.now': '刚刚',
      'time.minutes': '{n}分钟',
      'time.hours': '{n}小时',
      'time.days': '{n}天',
      'time.months': '{n}个月',
      'time.years': '{n}年',
      'time.ago': '{t}前',
    }
    const en = {
      title: 'Unsent drafts',
      count: '{n}',
      open: 'Open',
      discard: 'Discard',
      undo: 'Undo',
      discarded: 'Draft discarded',
      defaultWorkspace: 'Default workspace',
      openFailed: 'This draft could not be opened; try again in a moment',
      expand: 'Show drafts',
      collapse: 'Hide drafts',
      // The sidebar hover card's wording (ui-workspace time.*).
      'time.now': 'now',
      'time.minutes': '{n}min',
      'time.hours': '{n}h',
      'time.days': '{n}d',
      'time.months': '{n}mo',
      'time.years': '{n}y',
      'time.ago': '{t} ago',
    }

    // Drawn like DSH's own todo dock above the composer.
    const STYLE = (scope) => `
${scope}.dr-root{box-sizing:border-box;flex:none;margin:0 auto;overflow:hidden;
  width:calc(100% - 2 * var(--dsh-composer-side-clearance,16px) - 4 * var(--dsh-composer-dock-inset,8px));
  max-width:calc(var(--dsh-composer-card-max-width,952px) - 4 * var(--dsh-composer-dock-inset,8px));
  --dsw-elevation-stroke-color:var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-lg);
  background:var(--dsw-specific-menu);backdrop-filter:var(--dsw-menu-backdrop-filter);box-shadow:var(--dsw-elevation-panel)}
${scope} .dr-body{display:flex;flex-direction:column;gap:4px;padding:6px 12px}
${scope} .dr-header{display:flex;align-items:center;gap:10px;width:100%;padding:0;border:none;background:none;cursor:pointer;text-align:left}
${scope} .dr-title{flex:none;color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500;line-height:24px}
${scope} .dr-count{flex:auto;min-width:0;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px}
${scope} .dr-chevron{flex:none;display:grid;place-items:center;color:var(--dsw-alias-label-tertiary)}
${scope} .dr-list{display:flex;flex-direction:column;gap:2px;max-height:220px;margin:0 -6px;padding:0;list-style:none;overflow-y:auto}
${scope} .dr-item{display:flex;align-items:center;gap:8px;min-width:0;padding:4px 6px;border-radius:var(--dsw-radius-md)}
${scope} .dr-item:hover{background:var(--dsw-alias-interactive-bg-hover)}
${scope} .dr-main{flex:auto;min-width:0;display:flex;flex-direction:column;border:none;background:none;padding:0;text-align:left;cursor:pointer}
${scope} .dr-text{color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
${scope} .dr-meta{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
${scope} .dr-actions{flex:none;display:flex;gap:4px}
${scope} .dr-item[data-discarded] .dr-text{color:var(--dsw-alias-label-tertiary);font-style:italic}
${scope} .dr-error{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:16px}
`

    // ------------------------------------------------------------ plugin body

    function apply(ctx) {
      const core = ctx.rsDshCore
      const { React, jsx, jsxs, ui, oneLine } = core
      const scope = core.scope(PLUGIN)

      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-drafts: dictionaries')
      const t = ctx.locale.bind(NS)
      ctx.effect(() => core.style(PLUGIN, STYLE(core.selector(PLUGIN))), 'dsh-drafts: style')

      const storage = () => (typeof localStorage === 'undefined' ? null : localStorage)

      // A local version bump re-reads localStorage after this tab writes it;
      // the `storage` event covers other tabs.
      let version = 0
      const listeners = new Set()
      const bump = () => { version++; for (const fn of listeners) fn() }
      const onStorage = (e) => { if (e.key === null || e.key.startsWith(STORE_PREFIX)) bump() }
      ctx.effect(() => {
        window.addEventListener('storage', onStorage)
        return () => window.removeEventListener('storage', onStorage)
      }, 'dsh-drafts: storage events')
      const subscribeVersion = (fn) => { listeners.add(fn); return () => listeners.delete(fn) }
      const getVersion = () => version

      /** The in-memory input of a loaded Session, or undefined. */
      function loadedInput(id) {
        const actx = ctx.sessions.scope(id)
        return actx === undefined ? undefined : ctx.conversation.input.for(actx)
      }

      /** Clear one draft; returns the raw store entry to put back on Undo. */
      function discard(id) {
        const store = storage()
        const key = STORE_PREFIX + id
        const before = store === null ? null : store.getItem(key)
        const input = loadedInput(id)
        if (input !== undefined) input.setDraft({ text: '', references: [] })
        if (store !== null && before !== null) store.setItem(key, withDraft(before, ''))
        bump()
        return before
      }

      function undoDiscard(id, before) {
        const store = storage()
        if (store === null || before === null) return
        const input = loadedInput(id)
        const entry = parseEntry(before)
        if (input !== undefined && entry !== null && typeof entry.draft === 'object') input.setDraft(entry.draft)
        store.setItem(STORE_PREFIX + id, before)
        bump()
      }

      /**
       * Resume the blank Session through the Host, then open it. The Host reuses
       * a named blank that is still eligible; otherwise it makes a new Session,
       * and the draft is copied there (chips included) before it is opened.
       */
      async function open(item) {
        const request = {
          sessionId: item.id,
          ...(item.workspaceId !== undefined ? { workspaceId: item.workspaceId } : item.cwd !== undefined ? { cwd: item.cwd } : {}),
        }
        let id
        try {
          id = await ctx.sessions.create(item.agentPreset === undefined ? request : { ...request, agentPreset: item.agentPreset })
        } catch (error) {
          const code = error?.rpcError?.code
          if (item.agentPreset === undefined || (code !== 'agent-preset/not-found' && code !== 'agent-preset/invalid')) throw error
          id = await ctx.sessions.create(request)
        }
        if (id !== item.id) {
          const store = storage()
          if (store !== null) {
            store.setItem(STORE_PREFIX + id, withDraft(store.getItem(STORE_PREFIX + id), item.draft))
            store.setItem(STORE_PREFIX + item.id, withDraft(store.getItem(STORE_PREFIX + item.id), ''))
          }
        }
        ctx.uiWorkspace.openSession(id)
        bump()
      }

      /** "5min ago" as the sidebar's hover card dates a Session, bucketed by DSH's relativeTime. */
      function timeAgo(at, now) {
        if (!at) return ''
        const { unit, n } = ui.relativeTime(at, now)
        return unit === 'now' ? t('time.now') : t('time.ago', { t: t('time.' + unit, { n }) })
      }

      function DraftRow({ item, now, discarded, onDiscard, onUndo }) {
        const [busy, setBusy] = React.useState(false)
        const [error, setError] = React.useState(null)
        const workspace = item.workspaceTitle === undefined ? undefined
          : item.workspaceTitle === 'default-workspace' ? t('defaultWorkspace') : item.workspaceTitle
        const meta = [workspace, timeAgo(item.updatedAt, now)].filter(Boolean).join(' · ')
        if (discarded) {
          return jsxs('li', {
            className: 'dr-item',
            'data-discarded': '',
            children: [
              jsx('div', { className: 'dr-main', children: jsx('span', { className: 'dr-text', children: t('discarded') }) }, 'm'),
              jsx('div', { className: 'dr-actions', children: jsx(ui.Button, { size: 'sm', variant: 'ghost', onClick: () => onUndo(item), children: t('undo') }) }, 'a'),
            ],
          })
        }
        const run = () => {
          if (busy) return
          setBusy(true)
          setError(null)
          open(item).catch((reason) => {
            console.warn('dsh-drafts: open failed:', reason)
            setError(t('openFailed'))
            setBusy(false)
          })
        }
        return jsxs('li', {
          className: 'dr-item',
          'data-draft-session': item.id,
          children: [
            jsxs('button', {
              type: 'button',
              className: 'dr-main',
              title: oneLine(item.text, 600),
              onClick: run,
              children: [
                jsx('span', { className: 'dr-text', children: oneLine(item.text, PREVIEW) }, 't'),
                error === null
                  ? jsx('span', { className: 'dr-meta', children: meta }, 'm')
                  : jsx('span', { className: 'dr-error', role: 'alert', children: error }, 'e'),
              ],
            }, 'm'),
            jsxs('div', {
              className: 'dr-actions',
              children: [
                jsx(ui.Button, { size: 'sm', variant: 'ghost', disabled: busy, onClick: () => onDiscard(item), children: t('discard') }, 'd'),
                jsx(ui.Button, { size: 'sm', variant: 'outline', disabled: busy, onClick: run, children: t('open') }, 'o'),
              ],
            }, 'a'),
          ],
        })
      }

      function DraftsDock({ sessionId, useSession, useSessions, useWorkspaces }) {
        const snapshot = useSession((s) => s)
        const sessions = useSessions((s) => s)
        const workspaces = useWorkspaces((s) => s)
        React.useSyncExternalStore(subscribeVersion, getVersion)
        const [collapsed, setCollapsed] = React.useState(false)
        // A discarded row stays in its place with Undo until the card goes: id → { item, before }.
        const [discarded, setDiscarded] = React.useState(() => new Map())

        const blank = snapshot !== undefined && snapshot.blank === true && !snapshot.promptAttempted && !snapshot.running
        const found = blank && sessions !== undefined ? lostDrafts({ drafts: readDrafts(storage()), sessions, workspaces, currentId: sessionId }) : []
        const items = found.filter((i) => !discarded.has(i.id))
        for (const { item } of discarded.values()) items.push(item)
        items.sort((a, b) => b.updatedAt - a.updatedAt || (a.id < b.id ? -1 : 1))
        const onDiscard = (item) => {
          const before = discard(item.id)
          setDiscarded((m) => new Map(m).set(item.id, { item, before }))
        }
        const onUndo = (item) => {
          const entry = discarded.get(item.id)
          if (entry !== undefined) undoDiscard(item.id, entry.before)
          setDiscarded((m) => { const next = new Map(m); next.delete(item.id); return next })
        }
        if (!blank || items.length === 0) return null

        const now = Date.now()
        return jsx('section', {
          ...scope,
          className: 'dr-root',
          'aria-label': t('title'),
          children: jsxs('div', {
            className: 'dr-body',
            children: [
              jsxs('button', {
                type: 'button',
                className: 'dr-header',
                'aria-expanded': !collapsed,
                'aria-label': collapsed ? t('expand') : t('collapse'),
                onClick: () => setCollapsed((v) => !v),
                children: [
                  jsx('span', { className: 'dr-title', children: t('title') }, 't'),
                  jsx('span', { className: 'dr-count', children: t('count', { n: items.length - discarded.size }) }, 'c'),
                  jsx('span', { className: 'dr-chevron', 'aria-hidden': true, children: jsx(collapsed ? ui.IconChevronUpOutlineRegular : ui.IconChevronDownOutlineRegular, {}) }, 'v'),
                ],
              }, 'h'),
              collapsed ? null : jsx('ul', {
                className: 'dr-list',
                children: items.map((item) => jsx(DraftRow, { item, now, discarded: discarded.has(item.id), onDiscard, onUndo }, item.id)),
              }, 'l'),
            ],
          }),
        })
      }

      ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
        name: 'conversation.input.dock',
        id: 'rs-dsh-drafts',
        order: -10,
      }, DraftsDock))
    }

    module.exports.name = '@rs-dsh/dsh-drafts'
    module.exports.inject = ['conversation', 'locale', 'rsDshCore', 'sessions', 'slots', 'uiWorkspace']
    module.exports.apply = apply
    // Pure helpers, exported for tests only.
    module.exports._internals = { STORE_PREFIX, draftText, parseEntry, readDrafts, lostDrafts, withDraft }
    return module.exports
  },
})
