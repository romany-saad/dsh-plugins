// @rs-dsh/dsh-quote: browser half (hand-written, no build step).
//
// Select text in a conversation, press "Quote" (optionally add a note), and the
// passage lands in that session's composer as an atomic reference chip, one per
// line at the top of the draft. The chip is part of the draft, so Send/Enter,
// undo-by-backspace, draft persistence, and the host's own @file/@session chips
// all keep working. At send time DSH asks this plugin's codec to serialize each
// chip; the model receives a <quote> block. The sent user bubble renders those
// blocks as quote cards through the conversation.user.text rule/slot pair.
//
// The Quote button, the note box, the edit box and the chip's hover card come
// from @rs-dsh/dsh-core (service rsDshCore), drawn with DSH's own components.
//
// Extension points used (DSH 0.2.x), no DOM surgery on host-owned nodes:
//   rsDshCore                      selection toolbar, cards, DSH components, composer
//   inputTriggers.registerSource   chip owner + codec (serialize at submit)
//   uiConversation.userText        rule that finds <quote> blocks in sent text
//   slots 'conversation.user.text.node'  renderer for those nodes
window.__ModuleLoader__.load({
  id: '@rs-dsh/dsh-quote',
  factory: (require) => {
    'use strict'
    const module = { exports: {} }

    const SOURCE = 'quote'
    const NS = 'dsh-quote'
    const PLUGIN = 'dsh-quote'
    const MAX_QUOTE = 20000
    const MAX_NOTE = 4000

    // ------------------------------------------------------------ pure logic

    /** Collapse whitespace and cut to n code points with an ellipsis. */
    function oneLine(s, n) {
      // U+FFFC and U+E100–E11D are the editor's chip placeholders; never forge them.
      const flat = String(s).replace(/[\uE100-\uE11D\uFFFC]/gu, '').replace(/\s+/g, ' ').trim()
      const chars = Array.from(flat)
      return chars.length <= n ? flat : chars.slice(0, n - 1).join('') + '…'
    }

    /** Chip ref: the whole quote travels in the ref so a reloaded draft still serializes. */
    function encodeRef(quote) {
      const value = { v: 1, text: quote.text }
      if (quote.note) value.note = quote.note
      return JSON.stringify(value)
    }

    function decodeRef(ref) {
      const value = JSON.parse(ref)
      if (value === null || typeof value !== 'object' || typeof value.text !== 'string' || value.text === '') {
        throw new Error('dsh-quote: malformed quote reference')
      }
      return { text: value.text, note: typeof value.note === 'string' ? value.note : '' }
    }

    /** Keep quoted text from closing our own tags early. */
    function escapeTags(s) {
      return s.replace(/<\/(quote|note)>/gi, '<\\/$1>')
    }

    function unescapeTags(s) {
      return s.replace(/<\\\/(quote|note)>/gi, '</$1>')
    }

    /** Model form of one quote. Must stay in sync with QUOTE_BLOCK below. */
    function serializeQuote(quote) {
      let out = '<quote>\n' + escapeTags(quote.text) + '\n'
      if (quote.note) out += '<note>' + escapeTags(quote.note) + '</note>\n'
      return out + '</quote>'
    }

    // One serialized quote plus the newline that follows it in a stacked draft.
    const QUOTE_BLOCK = /<quote>\n([\s\S]*?)\n(?:<note>([\s\S]*?)<\/note>\n)?<\/quote>\n?/g

    /** userText rule: nearest <quote> block at or after `from`. */
    const quoteRule = {
      id: SOURCE,
      order: 15,
      match(text, from) {
        QUOTE_BLOCK.lastIndex = from
        const m = QUOTE_BLOCK.exec(text)
        if (m === null) return undefined
        return {
          id: SOURCE,
          start: m.index,
          end: m.index + m[0].length,
          data: { text: unescapeTags(m[1]), note: m[2] === undefined ? '' : unescapeTags(m[2]) },
        }
      },
    }

    function makeInsert(quote) {
      const note = quote.note ? ' · ' + oneLine(quote.note, 24) : ''
      return {
        source: SOURCE,
        ref: encodeRef(quote),
        label: '“' + oneLine(quote.text, 48) + '”' + note,
        clipboardText: '> ' + oneLine(quote.text, 120),
      }
    }

    /**
     * Insert one quote chip into a draft snapshot, after any quote chips already
     * stacked at the top, each on its own line. Other chips shift; text is kept.
     * @returns the next DraftSnapshot (same shape DSH persists and restores).
     */
    function stackQuote(snapshot, insert) {
      const text = snapshot.text
      const refs = snapshot.references.slice().sort((a, b) => a.offset - b.offset)
      let at = 0
      for (;;) {
        const head = refs.find((r) => r.offset === at && r.source === SOURCE)
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

    /**
     * Index (among this plugin's chips, in draft order) of the nth chip whose
     * ref equals `ref`. Two chips can share a ref when one passage is quoted twice.
     */
    function quoteChipIndex(snapshot, ref, nth) {
      const quotes = snapshot.references.filter((r) => r.source === SOURCE).sort((a, b) => a.offset - b.offset)
      let seen = 0
      for (let i = 0; i < quotes.length; i++) {
        if (quotes[i].ref !== ref) continue
        if (seen === nth) return i
        seen++
      }
      return -1
    }

    function nthQuote(snapshot, index) {
      return snapshot.references.filter((r) => r.source === SOURCE).sort((a, b) => a.offset - b.offset)[index]
    }

    /** Replace the quote chip at `index` (quote-chip order) with `insert`; text around it shifts. */
    function replaceQuote(snapshot, index, insert) {
      const target = nthQuote(snapshot, index)
      if (target === undefined) return snapshot
      const delta = insert.clipboardText.length - target.length
      const text = snapshot.text.slice(0, target.offset) + insert.clipboardText + snapshot.text.slice(target.offset + target.length)
      const references = snapshot.references.map((r) => {
        if (r === target) {
          return { ...r, ref: insert.ref, label: insert.label, clipboardText: insert.clipboardText, length: insert.clipboardText.length }
        }
        return r.offset > target.offset ? { ...r, offset: r.offset + delta } : r
      })
      const next = { text, references }
      if (snapshot.command !== undefined) next.command = snapshot.command
      return next
    }

    /** Remove the quote chip at `index` and the line break stackQuote put after it. */
    function removeQuote(snapshot, index) {
      const target = nthQuote(snapshot, index)
      if (target === undefined) return snapshot
      let end = target.offset + target.length
      if (snapshot.text.charAt(end) === '\n') end += 1
      const cut = end - target.offset
      const text = snapshot.text.slice(0, target.offset) + snapshot.text.slice(end)
      const references = snapshot.references
        .filter((r) => r !== target)
        .map((r) => (r.offset > target.offset ? { ...r, offset: r.offset - cut } : r))
      const next = { text, references }
      if (snapshot.command !== undefined) next.command = snapshot.command
      return next
    }

    /** Normalize a raw DOM selection string into a quote body. */
    function cleanSelection(raw) {
      const text = String(raw).replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
      return Array.from(text).length > MAX_QUOTE ? Array.from(text).slice(0, MAX_QUOTE).join('') : text
    }


    function normalizeNote(value) {
      const trimmed = value.trim()
      return trimmed === '' ? '' : Array.from(trimmed).slice(0, MAX_NOTE).join('')
    }

    // ------------------------------------------------------------ strings

    const zh = {
      quote: '引用',
      noteLabel: '备注（可选）',
      noteHint: 'Enter 添加，Shift+Enter 换行，Esc 取消',
      editHint: 'Enter 保存，Shift+Enter 换行，Esc 取消',
      add: '添加',
      save: '保存',
      remove: '移除',
      cancel: '取消',
      command: '命令草稿中不能插入引用',
      chipHint: '点击编辑备注',
      quoteCard: '引用',
    }
    const en = {
      quote: 'Quote',
      noteLabel: 'Note (optional)',
      noteHint: 'Enter adds · Shift+Enter breaks line · Esc cancels',
      editHint: 'Enter saves · Shift+Enter breaks line · Esc cancels',
      add: 'Add',
      save: 'Save',
      remove: 'Remove',
      cancel: 'Cancel',
      command: 'Quotes cannot go into a command draft',
      chipHint: 'Click to edit the note',
      quoteCard: 'Quote',
    }

    // Everything here sits under [data-rs-dsh="dsh-quote"]; the cards in sent
    // messages carry it too. Controls and surfaces are DSH's own components.
    const STYLE = (scope) => `
${scope} .q-passage{margin:0 0 8px;padding:2px 8px;border-left:2px solid var(--dsw-alias-state-business-primary);
  color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xs-13);white-space:pre-wrap;overflow-wrap:anywhere;
  display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden}
${scope} .q-hint{margin-top:6px;font-size:12px;line-height:16px;color:var(--dsw-alias-label-tertiary)}
${scope} .q-editor{display:flex}
${scope} .q-actions{display:flex;justify-content:flex-end;gap:6px;margin-top:8px}
${scope} .q-actions [data-danger]{margin-right:auto;color:var(--dsw-alias-state-error-primary)}
${scope} .q-tip-card{padding:10px;background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-elevation-panel)}
${scope} .q-tip-card>[aria-hidden="true"]:first-child{display:none}
${scope} .q-tip-body{max-height:min(60vh,420px);overflow:auto}
${scope} .q-tip-body .q-passage{display:block;-webkit-line-clamp:unset}
${scope} .q-tip-note{white-space:pre-wrap;overflow-wrap:anywhere;font:var(--dsw-font-xs-13)}
${scope}.q-card{display:block;margin:2px 0 6px;padding:3px 8px;border-left:2px solid var(--dsw-alias-state-business-primary);
  border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-interactive-bg-hover);white-space:pre-wrap;text-align:left}
${scope}.q-card[data-interactive]{cursor:pointer}
${scope} .q-text{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden;color:var(--dsw-alias-label-secondary)}
${scope}.q-card[data-open] .q-text{display:block}
${scope} .q-note{display:block;margin-top:2px;color:var(--dsw-alias-label-primary)}
[data-composer-chip="quote"]{cursor:pointer}
`

    // ------------------------------------------------------------ plugin body

    function apply(ctx) {
      const core = ctx.rsDshCore
      const { React, jsx, jsxs, ui } = core
      const scope = core.scope(PLUGIN)

      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-quote: dictionaries')
      const t = ctx.locale.bind(NS)
      ctx.effect(() => core.style(PLUGIN, STYLE(core.selector(PLUGIN))), 'dsh-quote: style')
      ctx.effect(() => core.composer.claimChipSource(SOURCE), 'dsh-quote: chip source order')

      let clickedChip = null // { el, index } of the quote chip last pressed in a composer

      // Chip owner. It never offers menu candidates; it exists for the codec and
      // for chip clicks, which DSH routes here through openReference.
      const source = {
        trigger: '@',
        name: SOURCE,
        order: 99,
        showGroupTitle: false,
        candidates: () => Promise.resolve([]),
        onPick: () => undefined,
        openReference: (session, reference) => openChipEditor(session.sessionId, reference.ref),
        codec: {
          clipboardText: (ref) => '> ' + oneLine(decodeRef(ref).text, 120),
          serialize: (ref) => Promise.resolve(serializeQuote(decodeRef(ref))),
        },
      }
      ctx.effect(() => ctx.inputTriggers.registerSource(source), 'dsh-quote: chip source')

      // Sent bubble: <quote> blocks render as cards.
      ctx.effect(() => ctx.uiConversation.userText.register(quoteRule), 'dsh-quote: user-text rule')
      function QuoteCard({ node, interactive }) {
        const [open, setOpen] = React.useState(false)
        const children = [jsx('span', { className: 'q-text', children: node.data.text }, 't')]
        if (node.data.note) children.push(jsx('span', { className: 'q-note', children: node.data.note }, 'n'))
        return jsxs('span', {
          ...scope,
          className: 'q-card',
          'data-dsh-quote': '',
          'data-open': open || undefined,
          'data-interactive': interactive || undefined,
          title: interactive ? undefined : node.data.text,
          onClick: interactive ? () => setOpen((v) => !v) : undefined,
          children,
        })
      }
      ctx.slots.inject('conversation.user.text.node', () => ctx.slots.register({
        name: 'conversation.user.text.node',
        key: SOURCE,
        priority: 100,
      }, QuoteCard))

      // -------------------------------------------------- composer edits

      /**
       * Apply `change(snapshot, index)` to the clicked quote chip. `hint` is the
       * chip's position among quote chips at click time; it disambiguates two
       * chips quoting the same passage, and falls back to the first match when
       * the draft changed meanwhile.
       */
      function editQuote(sessionId, ref, hint, change) {
        const { input, error } = core.composer.editable(sessionId)
        if (error !== undefined) return error
        const snapshot = input.draftSnapshot
        if (snapshot === undefined || snapshot === null || !Array.isArray(snapshot.references)) return t('command')
        const atHint = hint >= 0 ? nthQuote(snapshot, hint) : undefined
        const index = atHint !== undefined && atHint.ref === ref ? hint : quoteChipIndex(snapshot, ref, 0)
        if (index === -1) return null // the chip is gone; nothing to do
        input.setDraft(change(snapshot, index))
        input.focus()
        return null
      }

      // -------------------------------------------------- the note box

      /** The note box, for adding and for editing; DSH's InlineEditor and Buttons on a core card. */
      function NoteBox({ mode, text, note, onSubmit, onRemove, close }) {
        const [value, setValue] = React.useState(note || '')
        const submit = () => { close('submit'); onSubmit(value) }
        const buttons = []
        if (mode === 'edit') buttons.push(jsx(ui.Button, { size: 'sm', variant: 'ghost', 'data-danger': '', onClick: () => { close('remove'); onRemove() }, children: t('remove') }, 'r'))
        buttons.push(jsx(ui.Button, { size: 'sm', variant: 'ghost', onClick: () => close('cancel'), children: t('cancel') }, 'c'))
        buttons.push(jsx(ui.Button, { size: 'sm', variant: 'primary', onClick: submit, children: t(mode === 'edit' ? 'save' : 'add') }, 's'))
        return jsxs('div', {
          ...scope,
          'data-mode': mode,
          children: [
            jsx('blockquote', { className: 'q-passage', children: oneLine(text, 280) }, 'p'),
            jsx('div', { className: 'q-editor', children: jsx(ui.InlineEditor, { value, label: t('noteLabel'), onChange: setValue, onSave: submit, onCancel: () => close('cancel') }) }, 'e'),
            jsx('div', { className: 'q-hint', children: t(mode === 'edit' ? 'editHint' : 'noteHint') }, 'h'),
            jsx('div', { className: 'q-actions', children: buttons }, 'a'),
          ],
        })
      }

      function openNoteBox(anchor, props) {
        core.popover.open({
          plugin: PLUGIN,
          anchor,
          width: 340,
          prefer: 'above',
          label: t('quote'),
          render: (close) => jsx(NoteBox, { ...props, close }),
        })
      }

      function commit(target, note) {
        const quote = { text: target.text }
        const clean = normalizeNote(note)
        if (clean !== '') quote.note = clean
        const failure = core.composer.insertChip(target.sessionId, makeInsert(quote))
        if (failure !== null) { core.composer.notify(target.sessionId, failure); return }
        window.getSelection()?.removeAllRanges()
      }

      /** Chip click (via openReference): open the box with the chip's note. */
      function openChipEditor(sessionId, ref) {
        let quote
        try { quote = decodeRef(ref) } catch (_) { return false }
        hideTip()
        const chip = clickedChip !== null && clickedChip.el.isConnected ? clickedChip : null
        clickedChip = null
        const hint = chip !== null ? chip.index : -1
        const anchor = chip !== null ? () => chip.el.getBoundingClientRect()
          : () => ({ left: window.innerWidth / 2 - 170, right: window.innerWidth / 2 + 170, top: window.innerHeight - 160, bottom: window.innerHeight - 160, width: 340, height: 0 })
        const run = (change) => {
          const failure = editQuote(sessionId, ref, hint, change)
          if (failure !== null) core.composer.notify(sessionId, failure)
        }
        openNoteBox(anchor, {
          mode: 'edit',
          text: quote.text,
          note: quote.note,
          onSubmit: (value) => {
            const next = { text: quote.text }
            const clean = normalizeNote(value)
            if (clean !== '') next.note = clean
            if (clean === quote.note) return
            run((snapshot, index) => replaceQuote(snapshot, index, makeInsert(next)))
          },
          onRemove: () => run((snapshot, index) => removeQuote(snapshot, index)),
        })
        return true
      }

      // The Quote button in the shared selection toolbar.
      ctx.effect(() => core.selection.register({
        plugin: PLUGIN,
        id: 'quote',
        order: 10,
        label: () => t('quote'),
        onSelect: (selection) => {
          const text = cleanSelection(selection.text)
          if (text === '') return
          const target = { sessionId: selection.sessionId, text }
          const rect = selection.rect
          openNoteBox(() => rect, { mode: 'add', text, note: '', onSubmit: (note) => commit(target, note) })
        },
      }), 'dsh-quote: Quote button')

      // -------------------------------------------------- chip hover card
      //
      // The host's chip only carries a native title with the shortened label.
      // Our card shows the full quote and note, read from the live draft: the
      // chip's position among quote chips indexes the draft's quote
      // occurrences. Read-only DOM access; the host's title is suppressed
      // while ours is open and restored after.

      const tipHost = document.createElement('div')
      tipHost.setAttribute('data-rs-dsh', PLUGIN)
      tipHost.setAttribute('role', 'tooltip')
      tipHost.className = 'q-tip'
      tipHost.style.cssText = 'position:fixed;z-index:1190;width:420px;max-width:calc(100vw - 16px)'
      tipHost.hidden = true
      const tipRoot = require('react-dom/client').createRoot(tipHost)
      let tipChip = null
      let tipTitle = null // { el, value } of the host title we muted
      let tipShowTimer = null
      let tipHideTimer = null

      /** Full quote for a composer chip element, or null. */
      function quoteForChip(el) {
        const host = el.closest('[data-conversation-session]')
        const card = el.closest('[data-composer-card]')
        if (host === null || card === null) return null
        const actx = ctx.sessions.scope(host.getAttribute('data-conversation-session'))
        if (actx === undefined) return null
        const index = Array.from(card.querySelectorAll('[data-composer-chip="quote"]')).indexOf(el)
        const occurrences = (ctx.conversation.input.for(actx).state.getSnapshot().occurrences || [])
          .filter((o) => o.source === SOURCE).sort((a, b) => a.offset - b.offset)
        const occurrence = occurrences[index]
        if (occurrence === undefined) return null
        try { return decodeRef(occurrence.ref) } catch (_) { return null }
      }

      function muteTitle(el) {
        const titled = el.querySelector('[title]')
        if (titled === null) return
        tipTitle = { el: titled, value: titled.getAttribute('title') }
        titled.removeAttribute('title')
      }

      function restoreTitle() {
        if (tipTitle !== null && tipTitle.el.isConnected && !tipTitle.el.hasAttribute('title')) {
          tipTitle.el.setAttribute('title', tipTitle.value)
        }
        tipTitle = null
      }

      function hideTip() {
        if (tipShowTimer !== null) { clearTimeout(tipShowTimer); tipShowTimer = null }
        if (tipHideTimer !== null) { clearTimeout(tipHideTimer); tipHideTimer = null }
        tipHost.hidden = true
        tipChip = null
        restoreTitle()
      }

      function showTip(el) {
        const quote = quoteForChip(el)
        if (quote === null) return
        restoreTitle()
        muteTitle(el)
        const children = [jsx('blockquote', { className: 'q-passage', children: quote.text }, 'p')]
        if (quote.note) children.push(jsx('div', { className: 'q-tip-note', children: quote.note }, 'n'))
        children.push(jsx('div', { className: 'q-hint', children: t('chipHint') }, 'h'))
        tipRoot.render(jsx(ui.MenuSurface, { 'data-tip-card': '', className: 'q-tip-card', children: jsx('div', { className: 'q-tip-body', children }) }))
        tipHost.hidden = false
        tipChip = el
        requestAnimationFrame(() => {
          if (tipChip !== el) return
          const rect = el.getBoundingClientRect()
          const height = tipHost.offsetHeight || 120
          const width = tipHost.offsetWidth || 420
          let top = rect.top - height - 6
          if (top < 8) top = rect.bottom + 6
          tipHost.style.left = Math.round(Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))) + 'px'
          tipHost.style.top = Math.round(Math.max(8, Math.min(top, window.innerHeight - height - 8))) + 'px'
        })
      }

      const onTipOver = (e) => {
        const target = e.target instanceof Element ? e.target : null
        if (target === null) return
        if (tipHost.contains(target)) { // pointer moved onto the card: keep it (long quotes scroll)
          if (tipHideTimer !== null) { clearTimeout(tipHideTimer); tipHideTimer = null }
          return
        }
        const chip = target.closest('[data-composer-chip="quote"]')
        if (chip === tipChip && chip !== null) {
          if (tipHideTimer !== null) { clearTimeout(tipHideTimer); tipHideTimer = null }
          return
        }
        if (chip === null) {
          if (tipShowTimer !== null) { clearTimeout(tipShowTimer); tipShowTimer = null }
          if (tipChip !== null && tipHideTimer === null) tipHideTimer = setTimeout(hideTip, 150)
          return
        }
        if (core.popover.isOpen()) return // the editor is open; it already shows everything
        if (tipShowTimer !== null) clearTimeout(tipShowTimer)
        // Mute the host title right away so the native tooltip never races ours.
        restoreTitle()
        muteTitle(chip)
        tipShowTimer = setTimeout(() => { tipShowTimer = null; showTip(chip) }, 250)
      }

      const onPointerDown = (e) => {
        if (!tipHost.hidden && !(e.target instanceof Node && tipHost.contains(e.target))) hideTip()
        // Remember which quote chip is being pressed: openReference only passes
        // the ref, and two chips may quote the same passage. Read-only DOM access.
        const target = e.target instanceof Element ? e.target : null
        const el = target !== null ? target.closest('[data-composer-chip="quote"]') : null
        if (el === null) { clickedChip = null; return }
        const card = el.closest('[data-composer-card]')
        const all = card !== null ? Array.from(card.querySelectorAll('[data-composer-chip="quote"]')) : [el]
        clickedChip = { el, index: all.indexOf(el) }
      }
      const onKeyDown = (e) => { if (e.key === 'Escape' && !tipHost.hidden) hideTip() }
      const onScroll = (e) => { if (!tipHost.hidden && !(e.target instanceof Node && tipHost.contains(e.target))) hideTip() }

      ctx.effect(() => {
        document.body.appendChild(tipHost)
        document.addEventListener('pointerover', onTipOver, true)
        document.addEventListener('pointerdown', onPointerDown, true)
        document.addEventListener('keydown', onKeyDown, true)
        window.addEventListener('scroll', onScroll, true)
        return () => {
          document.removeEventListener('pointerover', onTipOver, true)
          document.removeEventListener('pointerdown', onPointerDown, true)
          document.removeEventListener('keydown', onKeyDown, true)
          window.removeEventListener('scroll', onScroll, true)
          hideTip()
          tipRoot.unmount()
          tipHost.remove()
        }
      }, 'dsh-quote: chip hover card')
    }

    module.exports.name = '@rs-dsh/dsh-quote'
    module.exports.inject = ['conversation', 'inputTriggers', 'locale', 'rsDshCore', 'sessions', 'slots', 'uiConversation']
    module.exports.apply = apply
    // Pure helpers, exported for tests only.
    module.exports._internals = {
      oneLine, encodeRef, decodeRef, serializeQuote, quoteRule, makeInsert, stackQuote, cleanSelection,
      quoteChipIndex, replaceQuote, removeQuote, normalizeNote,
    }
    return module.exports
  },
})
