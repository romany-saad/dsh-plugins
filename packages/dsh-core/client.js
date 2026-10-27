// @rs-dsh/dsh-core: browser half (hand-written, no build step).
//
// The shared UI layer for rs-dsh plugins, built on DSH's own UI library
// (@deepseek-ai/dsh-client-ui-primitives) so the plugins look like DSH and
// follow its updates. It provides one service, `rsDshCore`:
//
//   ui                     the DSH components and icons the plugins use
//   selection.register()   a button in the one selection toolbar
//   popover.open()         an anchored card (React) with outside-click and Escape
//   style(plugin, css)     one stylesheet per plugin, scoped by convention
//   scope(plugin)          the root attribute a plugin's elements carry
//   selectionContext()     what the current selection is over
//
// The library is assumed present: DSH's web shell ships it in its shared
// module table. If it is ever missing, the core fails loudly at start with
// one message instead of drawing look-alikes (see README "Limits").
window.__ModuleLoader__.load({
  id: '@rs-dsh/dsh-core',
  factory: (require) => {
    'use strict'
    const module = { exports: {} }

    const NS = 'dsh-core'
    const ROOT = 'data-rs-dsh'
    const PRIMITIVES = '@deepseek-ai/dsh-client-ui-primitives'

    // The components and icons the rs-dsh plugins use. A test checks every
    // name against the real library at the pinned DSH version.
    const UI_EXPORTS = [
      'Button', 'MenuSurface', 'InlineEditor', 'TextShimmer', 'MarkdownText', 'Tooltip', 'Toast',
      'IconTrashOutlineRegular', 'IconSendOutlineRegular', 'IconCopyOutlineRegular', 'IconCloseOutlineRegular',
      'IconNewChatOutlineRegular', 'IconEditOutlineRegular', 'IconCheckOutlineRegular', 'IconRefreshOutlineRegular',
      'IconWarningOutlineRegular', 'IconChevronDownOutlineRegular', 'IconChevronUpOutlineRegular',
    ]

    // ------------------------------------------------------------ pure logic

    /** The library's exports the plugins use; throws one clear error if any is gone. */
    function pickUi(lib) {
      if (lib === null || typeof lib !== 'object') {
        throw new Error(`dsh-core: ${PRIMITIVES} is not available in this DSH build; the rs-dsh plugins need it`)
      }
      const missing = UI_EXPORTS.filter((name) => lib[name] === undefined)
      if (missing.length > 0) {
        throw new Error(`dsh-core: this DSH build's ${PRIMITIVES} lacks ${missing.join(', ')}; update the rs-dsh plugins`)
      }
      const ui = {}
      for (const name of UI_EXPORTS) ui[name] = lib[name]
      return ui
    }

    /** A plugin name usable in an attribute value and a CSS selector. */
    function checkPlugin(plugin) {
      if (typeof plugin !== 'string' || !/^[a-z][a-z0-9-]*$/.test(plugin)) {
        throw new Error('dsh-core: plugin names are lowercase letters, digits and dashes: ' + JSON.stringify(plugin))
      }
      return plugin
    }

    /**
     * Where to put a floating card of `size` next to `rect`, inside the
     * viewport: above when it fits there (`prefer: 'above'`), else below.
     */
    function placeNear(rect, size, viewport, { prefer = 'below', gap = 8, align = 'start' } = {}) {
      const margin = 8
      const fitsBelow = rect.bottom + gap + size.height <= viewport.height - margin
      const fitsAbove = rect.top - gap - size.height >= margin
      const above = prefer === 'above' ? fitsAbove || !fitsBelow : !fitsBelow && fitsAbove
      let top = above ? rect.top - gap - size.height : rect.bottom + gap
      top = Math.max(margin, Math.min(top, viewport.height - size.height - margin))
      let left = align === 'center' ? rect.left + rect.width / 2 - size.width / 2 : rect.left
      left = Math.max(margin, Math.min(left, viewport.width - size.width - margin))
      return { top: Math.round(top), left: Math.round(left), above }
    }

    /** Collapse whitespace and cut to n code points with an ellipsis; never forges editor placeholders. */
    function oneLine(s, n) {
      const flat = String(s).replace(/[\uE100-\uE11D\uFFFC]/gu, '').replace(/\s+/g, ' ').trim()
      const chars = Array.from(flat)
      return chars.length <= n ? flat : chars.slice(0, n - 1).join('') + '\u2026'
    }

    /**
     * Insert one chip into a draft snapshot, after the chips already stacked
     * at the top whose source is in `stackAfter` (by default its own), each on
     * its own line, so chips keep the order they were added in. Other chips
     * shift; text is kept. Returns the next snapshot (the shape DSH persists).
     */
    function stackChip(snapshot, insert, stackAfter = [insert.source]) {
      const text = snapshot.text
      const refs = snapshot.references.slice().sort((a, b) => a.offset - b.offset)
      let at = 0
      for (;;) {
        const head = refs.find((r) => r.offset === at && stackAfter.includes(r.source))
        if (head === undefined) break
        at = head.offset + head.length
        if (text.charAt(at) === '\n') at += 1
        else break
      }
      const lead = at > 0 && text.charAt(at - 1) !== '\n' ? '\n' : ''
      const added = lead + insert.clipboardText + '\n'
      const offset = at + lead.length
      const shifted = refs.map((r) => (r.offset >= at ? { ...r, offset: r.offset + added.length } : r))
      const chip = {
        source: insert.source,
        ref: insert.ref,
        offset,
        length: insert.clipboardText.length,
        label: insert.label,
        clipboardText: insert.clipboardText,
      }
      const references = shifted.concat([chip]).sort((a, b) => a.offset - b.offset)
      const next = { text: text.slice(0, at) + added + text.slice(at), references }
      if (snapshot.command !== undefined) next.command = snapshot.command
      return next
    }

    /** Toolbar buttons in order: by `order`, then by registration. */
    function sortButtons(buttons) {
      return buttons.slice().sort((a, b) => a.order - b.order || a.seq - b.seq)
    }

    /** Normalize a raw DOM selection string. */
    function cleanSelection(raw) {
      return String(raw).replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
    }

    /** Whether a pointer or key event happened inside `el`, across portals that keep a DOM path. */
    function eventInside(event, el) {
      if (el === null || el === undefined) return false
      const path = typeof event.composedPath === 'function' ? event.composedPath() : []
      if (path.includes(el)) return true
      return event.target instanceof Node && el.contains(event.target)
    }

    // ------------------------------------------------------------ strings

    const en = {
      actions: 'Selection actions',
      busy: 'The composer is busy; try again in a moment',
      command: 'This cannot go into a command draft',
      noSession: 'No composer found for this conversation',
    }
    const zh = {
      actions: '选中文本操作',
      busy: '当前无法编辑输入框，稍后再试',
      command: '命令草稿中不能插入',
      noSession: '找不到该会话的输入框',
    }

    // The only stylesheet the core owns: positioning of its two floating hosts.
    // Everything visible inside them is DSH's own components and tokens. The
    // toolbar keeps the menu's translucent material; text-heavy cards take the
    // solid layer of DSH's preview cards, so the page never shows through.
    const STYLE = `
[${ROOT}="dsh-core"][data-part]{position:fixed;z-index:1200;max-width:calc(100vw - 16px)}
[${ROOT}="dsh-core"][data-part][hidden]{display:none}
[${ROOT}="dsh-core"] [data-part-card]{box-sizing:border-box;padding:4px;--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);
  box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-primary);
  --dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2)}
[${ROOT}="dsh-core"][data-part="toolbar"] [data-part-card]{display:flex;gap:2px}
[${ROOT}="dsh-core"][data-part="popover"] [data-part-card]{padding:10px;display:flex;flex-direction:column;max-height:min(70vh,560px);
  background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-elevation-panel)}
[${ROOT}="dsh-core"][data-part="popover"] [data-part-card]>[aria-hidden="true"]:first-child{display:none}
`
    // ------------------------------------------------------------ plugin body

    function apply(ctx) {
      const React = require('react')
      const { jsx, jsxs } = require('react/jsx-runtime')
      const { createRoot } = require('react-dom/client')
      let lib
      try { lib = require(PRIMITIVES) } catch (_) { lib = null }
      const ui = pickUi(lib)

      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-core: dictionaries')
      const t = ctx.locale.bind(NS)

      // -------------------------------------------------- styles

      const sheets = new Map() // plugin → <style>
      /** One stylesheet per plugin; returns a disposer. A second call replaces the text. */
      function style(plugin, css) {
        checkPlugin(plugin)
        let el = sheets.get(plugin)
        if (el === undefined) {
          el = document.createElement('style')
          el.setAttribute('data-rs-dsh-style', plugin)
          document.head.appendChild(el)
          sheets.set(plugin, el)
        }
        el.textContent = css
        return () => {
          if (sheets.get(plugin) === el) { el.remove(); sheets.delete(plugin) }
        }
      }
      const scope = (plugin) => ({ [ROOT]: checkPlugin(plugin) })
      const selector = (plugin) => `[${ROOT}="${checkPlugin(plugin)}"]`

      // -------------------------------------------------- composer

      /** A session's composer when it can take a chip, or { error } in the user's language. */
      function editableInput(sessionId) {
        if (ctx.sessions === undefined || ctx.conversation === undefined) return { error: t('noSession') }
        const actx = ctx.sessions.scope(sessionId)
        if (actx === undefined) return { error: t('noSession') }
        const input = ctx.conversation.input.for(actx)
        const phase = input.state.getSnapshot().phase
        if (phase === 'claimed') return { error: t('command') }
        if (phase !== 'plain') return { error: t('busy') }
        return { actx, input }
      }

      // Chip sources of the rs-dsh plugins; a new chip stacks after all of them.
      const chipSources = new Set()
      /** Declare a chip source as an rs-dsh one; returns a disposer. */
      function claimChipSource(source) {
        chipSources.add(source)
        return () => chipSources.delete(source)
      }

      /** Stack a chip at the top of a session's draft. Returns null, or the reason it could not. */
      function insertChip(sessionId, insert) {
        const { actx, input, error } = editableInput(sessionId)
        if (error !== undefined) return error
        const snapshot = input.draftSnapshot
        if (snapshot !== undefined && snapshot !== null && Array.isArray(snapshot.references)) {
          if (snapshot.command !== undefined) return t('command')
          input.setDraft(stackChip(snapshot, insert, [...chipSources, insert.source]))
        } else {
          const span = input.actions.captureInsertion()
          if (actx.bail(actx, 'slash/input-insert-reference', { reference: insert, span }) !== true) return t('busy')
        }
        input.focus()
        return null
      }

      /** Show a notice under a session's composer. */
      function notify(sessionId, text, level = 'error') {
        const actx = ctx.sessions?.scope(sessionId)
        if (actx !== undefined) ctx.conversation.input.for(actx).notify(level, text)
      }

      // -------------------------------------------------- selection context

      /**
       * What the current selection is over, or null: the conversation it is
       * in, the chat row, the range and its rectangle, and the cleaned text.
       * Selections in the composer, in inputs or in rs-dsh's own UI are none.
       */
      function selectionContext() {
        const sel = window.getSelection()
        if (sel === null || sel.isCollapsed || sel.rangeCount === 0) return null
        const range = sel.getRangeAt(0)
        const node = range.commonAncestorContainer
        const el = node instanceof Element ? node : node.parentElement
        if (el === null) return null
        const region = el.closest('[data-conversation-region="chat"][data-conversation-session]')
        if (region === null) return null
        if (el.closest(`[data-composer-card],[${ROOT}],input,textarea,[contenteditable="true"]`) !== null) return null
        const text = cleanSelection(sel.toString())
        if (text === '') return null
        const rect = range.getBoundingClientRect()
        if (rect.width === 0 && rect.height === 0) return null
        return {
          sessionId: region.getAttribute('data-conversation-session'),
          region,
          element: el,
          row: el.closest('[data-chat-node-key]'),
          range: range.cloneRange(),
          rect,
          text,
        }
      }

      // -------------------------------------------------- popover host

      // One anchored card at a time, rendered with React into a host of its
      // own on <body>. Opening another closes the current one.
      let current = null // { host, root, onClose, anchor }

      function closePopover(reason = 'api') {
        const open = current
        if (open === null) return
        current = null
        // Close is often called from inside the card's own React event (Enter
        // in an editor, a button). Detach now; unmount once React has finished
        // that event, never during it.
        open.host.remove()
        setTimeout(() => open.root.unmount(), 0)
        try { open.onClose?.(reason) } catch (error) { console.error(error) }
      }

      /**
       * Open a card next to `anchor` (a DOMRect or () => DOMRect).
       * `render(close)` returns the React content. Returns { close, update }.
       */
      function openPopover({ plugin, anchor, render, width = 360, prefer = 'below', align = 'start', onClose, label }) {
        checkPlugin(plugin)
        closePopover('replaced')
        hideToolbar()
        const host = document.createElement('div')
        host.setAttribute(ROOT, 'dsh-core')
        host.setAttribute('data-part', 'popover')
        host.setAttribute('data-plugin', plugin)
        host.setAttribute('role', 'dialog')
        if (label) host.setAttribute('aria-label', label)
        host.style.width = width + 'px'
        host.style.visibility = 'hidden'
        document.body.appendChild(host)
        const root = createRoot(host)
        const entry = { host, root, onClose, anchor, prefer, align }
        current = entry
        const close = (reason = 'api') => { if (current === entry) closePopover(reason) }
        const place = () => {
          if (current !== entry) return
          const rect = typeof entry.anchor === 'function' ? entry.anchor() : entry.anchor
          if (!rect) return
          const box = host.getBoundingClientRect()
          const at = placeNear(rect, { width: box.width || width, height: box.height || 200 }, { width: window.innerWidth, height: window.innerHeight }, { prefer: entry.prefer, align: entry.align })
          host.style.left = at.left + 'px'
          host.style.top = at.top + 'px'
          host.style.visibility = ''
        }
        const draw = () => {
          root.render(jsx(ui.MenuSurface, { 'data-part-card': '', children: jsx(PopoverBody, { render, close, place }) }))
        }
        draw()
        return { close, update: draw, place }
      }

      /** Re-places the card after each render, so it follows its content's size. */
      function PopoverBody({ render, close, place }) {
        React.useLayoutEffect(() => { place() })
        return render(close)
      }

      // -------------------------------------------------- selection toolbar

      const buttons = [] // { id, plugin, label, icon, order, seq, when, onSelect }
      let seq = 0
      let pending = null // selectionContext() the toolbar shows for
      const toolbar = document.createElement('div')
      toolbar.setAttribute(ROOT, 'dsh-core')
      toolbar.setAttribute('data-part', 'toolbar')
      toolbar.setAttribute('role', 'toolbar')
      toolbar.hidden = true
      const toolbarRoot = createRoot(toolbar)

      /**
       * Add a button to the selection toolbar.
       * @param spec.id        unique within the plugin
       * @param spec.label     text on the button
       * @param spec.onSelect  (selection) => void, with selectionContext()'s value
       * @param spec.when      optional (selection) => boolean; hidden when false
       * @param spec.icon      optional React node
       * @param spec.order     optional number, lower first (default 100)
       * @returns a disposer
       */
      function registerButton(spec) {
        const plugin = checkPlugin(spec.plugin)
        if (typeof spec.id !== 'string' || spec.id === '' || typeof spec.onSelect !== 'function') {
          throw new Error('dsh-core: a selection button needs plugin, id, label and onSelect')
        }
        if (buttons.some((b) => b.plugin === plugin && b.id === spec.id)) throw new Error(`dsh-core: ${plugin}/${spec.id} is already registered`)
        const entry = { order: 100, ...spec, plugin, seq: seq++ }
        buttons.push(entry)
        if (pending !== null) showToolbar(pending)
        return () => {
          const at = buttons.indexOf(entry)
          if (at !== -1) buttons.splice(at, 1)
          if (pending !== null) showToolbar(pending)
        }
      }

      function visibleButtons(target) {
        return sortButtons(buttons).filter((b) => {
          if (typeof b.when !== 'function') return true
          try { return b.when(target) === true } catch (error) { console.error(error); return false }
        })
      }

      function Toolbar({ target, items }) {
        return jsx(React.Fragment, {
          children: items.map((b) => jsx(ui.Button, {
            variant: 'ghost',
            size: 'sm',
            icon: b.icon,
            'data-plugin': b.plugin,
            'data-action': b.id,
            onMouseDown: (e) => e.preventDefault(),
            onClick: () => {
              hideToolbar()
              try { b.onSelect(target) } catch (error) { console.error(error) }
            },
            children: typeof b.label === 'function' ? b.label() : b.label,
          }, b.plugin + '/' + b.id)),
        })
      }

      function showToolbar(target) {
        const items = visibleButtons(target)
        if (items.length === 0) { hideToolbar(); return }
        pending = target
        toolbar.setAttribute('aria-label', t('actions'))
        toolbarRoot.render(jsx(ui.MenuSurface, { compact: true, 'data-part-card': '', children: jsx(Toolbar, { target, items }) }))
        toolbar.hidden = false
        requestAnimationFrame(() => {
          if (pending !== target) return
          const box = toolbar.getBoundingClientRect()
          const at = placeNear(target.rect, { width: box.width || 120, height: box.height || 36 }, { width: window.innerWidth, height: window.innerHeight }, { prefer: 'above', align: 'center' })
          toolbar.style.left = at.left + 'px'
          toolbar.style.top = at.top + 'px'
        })
      }

      function hideToolbar() {
        toolbar.hidden = true
        pending = null
      }

      function refresh() {
        if (current !== null) { hideToolbar(); return }
        const target = selectionContext()
        if (target === null) { hideToolbar(); return }
        showToolbar(target)
      }

      let timer = null
      const onSelectionChange = () => {
        if (timer !== null) clearTimeout(timer)
        timer = setTimeout(() => { timer = null; refresh() }, 120)
      }
      const onPointerDown = (e) => {
        if (current !== null && !eventInside(e, current.host)) closePopover('outside')
      }
      const onKeyDown = (e) => {
        if (e.key !== 'Escape') return
        if (current !== null) { e.stopPropagation(); closePopover('escape'); return }
        if (!toolbar.hidden) hideToolbar()
      }
      const onScroll = (e) => {
        if (!toolbar.hidden) hideToolbar()
        if (current !== null && !eventInside(e, current.host)) {
          const rect = typeof current.anchor === 'function' ? current.anchor() : null
          if (rect) {
            const box = current.host.getBoundingClientRect()
            const at = placeNear(rect, { width: box.width, height: box.height }, { width: window.innerWidth, height: window.innerHeight }, { prefer: current.prefer, align: current.align })
            current.host.style.left = at.left + 'px'
            current.host.style.top = at.top + 'px'
          }
        }
      }

      ctx.effect(() => {
        const disposeStyle = style('dsh-core', STYLE)
        document.body.appendChild(toolbar)
        document.addEventListener('selectionchange', onSelectionChange)
        document.addEventListener('pointerdown', onPointerDown, true)
        document.addEventListener('keydown', onKeyDown, true)
        window.addEventListener('scroll', onScroll, true)
        window.addEventListener('resize', onScroll)
        return () => {
          if (timer !== null) clearTimeout(timer)
          document.removeEventListener('selectionchange', onSelectionChange)
          document.removeEventListener('pointerdown', onPointerDown, true)
          document.removeEventListener('keydown', onKeyDown, true)
          window.removeEventListener('scroll', onScroll, true)
          window.removeEventListener('resize', onScroll)
          closePopover('dispose')
          toolbarRoot.unmount()
          toolbar.remove()
          disposeStyle()
        }
      }, 'dsh-core: selection toolbar and popover host')

      const api = {
        version: 1,
        ui,
        React,
        jsx,
        jsxs,
        style,
        scope,
        selector,
        selectionContext,
        oneLine,
        stackChip,
        composer: { editable: editableInput, insertChip, notify, claimChipSource },
        selection: { register: registerButton, hide: hideToolbar },
        popover: { open: openPopover, close: () => closePopover('api'), isOpen: () => current !== null },
      }
      ctx.provide('rsDshCore', api)
    }

    module.exports.name = '@rs-dsh/dsh-core'
    module.exports.inject = ['conversation', 'locale', 'sessions']
    module.exports.apply = apply
    // Pure helpers, exported for tests only.
    module.exports._internals = { UI_EXPORTS, pickUi, checkPlugin, placeNear, sortButtons, cleanSelection, eventInside, oneLine, stackChip, ROOT }
    return module.exports
  },
})
