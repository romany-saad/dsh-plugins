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
// Extension points used (DSH 0.2.x), no DOM surgery on host-owned nodes:
//   inputTriggers.registerSource   chip owner + codec (serialize at submit)
//   conversation.input.for(actx)   draft snapshot / setDraft / notify / focus
//   uiConversation.userText        rule that finds <quote> blocks in sent text
//   slots 'conversation.user.text.node'  renderer for those nodes
window.__ModuleLoader__.load({
  id: '@rs-dsh/dsh-quote',
  factory: (require) => {
    'use strict'
    const module = { exports: {} }

    const SOURCE = 'quote'
    const NS = 'dsh-quote'
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

    // ------------------------------------------------------------ strings

    const zh = {
      quote: '引用',
      notePlaceholder: '备注（可选）· Enter 添加，Shift+Enter 换行',
      editPlaceholder: '备注（可选）· Enter 保存，Shift+Enter 换行',
      add: '添加',
      save: '保存',
      remove: '移除',
      cancel: '取消',
      busy: '当前无法编辑输入框，稍后再试',
      command: '命令草稿中不能插入引用',
      noSession: '找不到该会话的输入框',
      editHint: '点击编辑备注',
    }
    const en = {
      quote: 'Quote',
      notePlaceholder: 'Note (optional) · Enter adds, Shift+Enter breaks line',
      editPlaceholder: 'Note (optional) · Enter saves, Shift+Enter breaks line',
      add: 'Add',
      save: 'Save',
      remove: 'Remove',
      cancel: 'Cancel',
      busy: 'The composer is busy; try again in a moment',
      command: 'Quotes cannot go into a command draft',
      noSession: 'No composer found for this conversation',
      editHint: 'Click to edit the note',
    }

    const CSS = `
.dshq-bar{position:fixed;z-index:1200;display:flex;gap:2px;padding:3px;border-radius:10px;
  background:var(--dsw-specific-input-major,#2b2b2e);box-shadow:var(--dsw-elevation-soft,0 4px 16px rgba(0,0,0,.25));
  border:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3));font:13px/20px var(--dsw-font-family,system-ui)}
.dshq-bar[hidden]{display:none}
.dshq-bar button{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-primary,#eee);
  padding:3px 10px;border-radius:7px;cursor:pointer;font:inherit}
.dshq-bar button:hover,.dshq-bar button:focus-visible{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.15));outline:none}
.dshq-pop{position:fixed;z-index:1200;width:320px;max-width:calc(100vw - 16px);box-sizing:border-box;padding:10px;border-radius:12px;
  background:var(--dsw-specific-input-major,#2b2b2e);box-shadow:var(--dsw-elevation-soft,0 4px 16px rgba(0,0,0,.25));
  border:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3));font:13px/20px var(--dsw-font-family,system-ui);
  color:var(--dsw-alias-label-primary,#eee)}
.dshq-pop blockquote{margin:0 0 8px;padding:2px 8px;border-left:3px solid var(--dsw-alias-state-business-primary,#4c6ef5);
  color:var(--dsw-alias-label-secondary,#aaa);max-height:72px;overflow:hidden;white-space:pre-wrap}
.dshq-pop textarea{box-sizing:border-box;width:100%;min-height:64px;resize:vertical;padding:6px 8px;border-radius:8px;
  border:.5px solid var(--dsw-alias-border-l4,rgba(127,127,127,.4));background:transparent;color:inherit;font:inherit;outline:none}
.dshq-pop .dshq-actions{display:flex;justify-content:flex-end;gap:6px;margin-top:8px}
.dshq-pop button{appearance:none;border:0;border-radius:7px;padding:3px 12px;cursor:pointer;font:inherit;
  background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.15));color:inherit}
.dshq-pop button[data-primary]{background:var(--dsw-alias-button-info-fill,#4c6ef5);color:#fff}
.dshq-pop button[data-danger]{margin-right:auto;background:transparent;color:var(--dsw-alias-state-error-primary,#e5484d)}
.dshq-pop button[data-danger]:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.15))}
[data-composer-chip="quote"]{cursor:pointer}
.dshq-tip{position:fixed;z-index:1190;width:420px;max-width:calc(100vw - 16px);max-height:min(60vh,420px);overflow:auto;
  box-sizing:border-box;padding:8px 10px;border-radius:10px;pointer-events:auto;
  background:var(--dsw-specific-input-major,#2b2b2e);box-shadow:var(--dsw-elevation-soft,0 4px 16px rgba(0,0,0,.25));
  border:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3));font:13px/20px var(--dsw-font-family,system-ui);
  color:var(--dsw-alias-label-primary,#eee)}
.dshq-tip[hidden]{display:none}
.dshq-tip blockquote{margin:0;padding:2px 8px;border-left:3px solid var(--dsw-alias-state-business-primary,#4c6ef5);
  color:var(--dsw-alias-label-secondary,#aaa);white-space:pre-wrap;overflow-wrap:anywhere}
.dshq-tip .dshq-tip-note{margin-top:6px;white-space:pre-wrap;overflow-wrap:anywhere}
.dshq-tip .dshq-tip-hint{margin-top:6px;font-size:12px;color:var(--dsw-alias-label-caption,#888)}
.dshq-card{display:block;margin:2px 0 6px;padding:3px 8px;border-left:3px solid var(--dsw-alias-state-business-primary,#4c6ef5);
  border-radius:4px;background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.1));white-space:pre-wrap;text-align:left}
.dshq-card[data-interactive]{cursor:pointer}
.dshq-text{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden;color:var(--dsw-alias-label-secondary,#aaa)}
.dshq-card[data-open] .dshq-text{display:block}
.dshq-note{display:block;margin-top:2px;color:var(--dsw-alias-label-primary,#eee)}
`

    // ------------------------------------------------------------ plugin body

    function apply(ctx) {
      const React = require('react')
      const { jsx, jsxs } = require('react/jsx-runtime')

      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-quote: dictionaries')
      const t = ctx.locale.bind(NS)

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
        const children = [jsx('span', { className: 'dshq-text', children: node.data.text }, 't')]
        if (node.data.note) children.push(jsx('span', { className: 'dshq-note', children: node.data.note }, 'n'))
        return jsxs('span', {
          className: 'dshq-card',
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

      /** Resolve an editable composer for a session, or a localized refusal. */
      function editableInput(sessionId) {
        const actx = ctx.sessions.scope(sessionId)
        if (actx === undefined) return { error: t('noSession') }
        const input = ctx.conversation.input.for(actx)
        const state = input.state.getSnapshot()
        if (state.phase === 'claimed') return { error: t('command') }
        if (state.phase !== 'plain') return { error: t('busy') }
        return { actx, input }
      }

      function notify(sessionId, text) {
        const actx = ctx.sessions.scope(sessionId)
        if (actx !== undefined) ctx.conversation.input.for(actx).notify('error', text)
      }

      function insertQuote(sessionId, quote) {
        const { actx, input, error } = editableInput(sessionId)
        if (error !== undefined) return error
        const insert = makeInsert(quote)
        const snapshot = input.draftSnapshot
        if (snapshot !== undefined && snapshot !== null && Array.isArray(snapshot.references)) {
          if (snapshot.command !== undefined) return t('command')
          // Structured setDraft rebuilds the document with every chip intact.
          input.setDraft(stackQuote(snapshot, insert))
        } else {
          // Older hosts without draftSnapshot: insert at the caret instead.
          const span = input.actions.captureInsertion()
          if (actx.bail(actx, 'slash/input-insert-reference', { reference: insert, span }) !== true) return t('busy')
        }
        input.focus()
        return null
      }

      /**
       * Apply `change(snapshot, index)` to the clicked quote chip. `hint` is the
       * chip's position among quote chips at click time; it disambiguates two
       * chips quoting the same passage, and falls back to the first match when
       * the draft changed meanwhile.
       */
      function editQuote(sessionId, ref, hint, change) {
        const { input, error } = editableInput(sessionId)
        if (error !== undefined) return error
        const snapshot = input.draftSnapshot
        if (snapshot === undefined || snapshot === null || !Array.isArray(snapshot.references)) return t('busy')
        const atHint = hint >= 0 ? nthQuote(snapshot, hint) : undefined
        const index = atHint !== undefined && atHint.ref === ref ? hint : quoteChipIndex(snapshot, ref, 0)
        if (index === -1) return null // the chip is gone; nothing to do
        input.setDraft(change(snapshot, index))
        input.focus()
        return null
      }

      // -------------------------------------------------- selection toolbar

      const style = document.createElement('style')
      style.setAttribute('data-dsh-quote-style', '')
      style.textContent = CSS
      const bar = document.createElement('div')
      bar.className = 'dshq-bar'
      bar.setAttribute('role', 'toolbar')
      bar.hidden = true
      const quoteBtn = document.createElement('button')
      quoteBtn.type = 'button'
      bar.append(quoteBtn)

      let pending = null // { sessionId, text, rect }
      let pop = null
      let clickedChip = null // { el, index } of the quote chip last pressed in a composer

      function labelButtons() {
        quoteBtn.textContent = t('quote')
      }

      function selectionTarget() {
        const sel = window.getSelection()
        if (sel === null || sel.isCollapsed || sel.rangeCount === 0) return null
        const range = sel.getRangeAt(0)
        const node = range.commonAncestorContainer
        const el = node instanceof Element ? node : node.parentElement
        if (el === null) return null
        const chat = el.closest('[data-conversation-region="chat"][data-conversation-session]')
        if (chat === null || el.closest('[data-composer-card],[data-dsh-quote],input,textarea,[contenteditable="true"]') !== null) return null
        const text = cleanSelection(sel.toString())
        if (text === '') return null
        const rect = range.getBoundingClientRect()
        if (rect.width === 0 && rect.height === 0) return null
        return { sessionId: chat.getAttribute('data-conversation-session'), text, rect }
      }

      function place(el, rect, height) {
        const width = el.offsetWidth || 200
        const left = Math.max(8, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - 8))
        let top = rect.top - height - 8
        if (top < 8) top = rect.bottom + 8
        el.style.left = Math.round(left) + 'px'
        el.style.top = Math.round(Math.max(8, Math.min(top, window.innerHeight - height - 8))) + 'px'
      }

      function hideBar() {
        bar.hidden = true
        pending = null
      }

      function closePop() {
        if (pop !== null) { pop.remove(); pop = null }
      }

      // -------------------------------------------------- chip hover tooltip
      //
      // The host's chip only carries a native title with the shortened label.
      // Our tooltip shows the full quote and note, read from the live draft:
      // the chip's position among quote chips indexes the draft's quote
      // occurrences. Read-only DOM access; the host's title is suppressed
      // while ours is open and restored after.

      const tip = document.createElement('div')
      tip.className = 'dshq-tip'
      tip.setAttribute('data-dsh-quote', '')
      tip.setAttribute('role', 'tooltip')
      tip.hidden = true
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
        tip.hidden = true
        tipChip = null
        restoreTitle()
      }

      function showTip(el) {
        const quote = quoteForChip(el)
        if (quote === null) return
        restoreTitle()
        muteTitle(el)
        tip.replaceChildren()
        const body = document.createElement('blockquote')
        body.textContent = quote.text
        tip.append(body)
        if (quote.note) {
          const note = document.createElement('div')
          note.className = 'dshq-tip-note'
          note.textContent = quote.note
          tip.append(note)
        }
        const hint = document.createElement('div')
        hint.className = 'dshq-tip-hint'
        hint.textContent = t('editHint')
        tip.append(hint)
        tip.hidden = false
        tip.scrollTop = 0
        const rect = el.getBoundingClientRect()
        // Above the chip (the composer sits at the bottom); clamp into the viewport.
        const height = tip.offsetHeight || 120
        const width = tip.offsetWidth || 420
        let top = rect.top - height - 6
        if (top < 8) top = rect.bottom + 6
        tip.style.left = Math.round(Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))) + 'px'
        tip.style.top = Math.round(Math.max(8, Math.min(top, window.innerHeight - height - 8))) + 'px'
        tipChip = el
      }

      const onTipOver = (e) => {
        const target = e.target instanceof Element ? e.target : null
        if (target === null) return
        if (tip.contains(target)) { // pointer moved onto the tooltip: keep it (long quotes scroll)
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
        if (pop !== null) return // the editor is open; it already shows everything
        if (tipShowTimer !== null) clearTimeout(tipShowTimer)
        // Mute the host title right away so the native tooltip never races ours.
        restoreTitle()
        muteTitle(chip)
        tipShowTimer = setTimeout(() => { tipShowTimer = null; showTip(chip) }, 250)
      }

      function refresh() {
        if (pop !== null) return
        const target = selectionTarget()
        if (target === null) { hideBar(); return }
        pending = target
        labelButtons()
        bar.hidden = false
        place(bar, target.rect, bar.offsetHeight || 32)
      }

      function normalizeNote(value) {
        const trimmed = value.trim()
        return trimmed === '' ? '' : Array.from(trimmed).slice(0, MAX_NOTE).join('')
      }

      function commit(target, note) {
        const quote = { text: target.text }
        const clean = normalizeNote(note)
        if (clean !== '') quote.note = clean
        const failure = insertQuote(target.sessionId, quote)
        if (failure !== null) { notify(target.sessionId, failure); return }
        const sel = window.getSelection()
        if (sel !== null) sel.removeAllRanges()
      }

      /**
       * The one note box, for adding and for editing.
       * @param opts.rect - anchor rectangle.
       * @param opts.text - quoted passage shown as preview.
       * @param opts.note - initial note.
       * @param opts.mode - 'add' or 'edit'.
       * @param opts.onSubmit - called with the note text.
       * @param opts.onRemove - edit mode only.
       */
      function openEditor(opts) {
        hideTip()
        closePop()
        hideBar()
        pop = document.createElement('div')
        pop.className = 'dshq-pop'
        pop.setAttribute('data-dsh-quote', '')
        pop.setAttribute('data-mode', opts.mode)
        pop.setAttribute('role', 'dialog')
        const preview = document.createElement('blockquote')
        preview.textContent = oneLine(opts.text, 280)
        const area = document.createElement('textarea')
        area.placeholder = t(opts.mode === 'edit' ? 'editPlaceholder' : 'notePlaceholder')
        area.value = opts.note || ''
        const actions = document.createElement('div')
        actions.className = 'dshq-actions'
        const button = (label, attr) => {
          const b = document.createElement('button')
          b.type = 'button'
          b.textContent = label
          if (attr) b.setAttribute(attr, '')
          return b
        }
        const remove = opts.mode === 'edit' ? button(t('remove'), 'data-danger') : null
        const cancel = button(t('cancel'))
        const primary = button(t(opts.mode === 'edit' ? 'save' : 'add'), 'data-primary')
        if (remove !== null) actions.append(remove)
        actions.append(cancel, primary)
        pop.append(preview, area, actions)
        document.body.appendChild(pop)
        place(pop, opts.rect, pop.offsetHeight || 160)
        const submit = () => { const value = area.value; closePop(); opts.onSubmit(value) }
        cancel.addEventListener('click', closePop)
        primary.addEventListener('click', submit)
        if (remove !== null) remove.addEventListener('click', () => { closePop(); opts.onRemove() })
        area.addEventListener('keydown', (e) => {
          if (e.isComposing || e.keyCode === 229) return
          if (e.key === 'Escape') { e.preventDefault(); closePop() }
          else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() }
        })
        area.focus()
        area.setSelectionRange(area.value.length, area.value.length)
      }

      /** Chip click (via openReference): open the editor with the chip's note. */
      function openChipEditor(sessionId, ref) {
        let quote
        try { quote = decodeRef(ref) } catch (_) { return false }
        const chip = clickedChip !== null && clickedChip.el.isConnected ? clickedChip : null
        clickedChip = null
        const hint = chip !== null ? chip.index : -1
        const rect = chip !== null ? chip.el.getBoundingClientRect()
          : { left: window.innerWidth / 2, top: window.innerHeight - 160, width: 0, height: 0, bottom: window.innerHeight - 160 }
        const run = (change) => {
          const failure = editQuote(sessionId, ref, hint, change)
          if (failure !== null) notify(sessionId, failure)
        }
        openEditor({
          mode: 'edit',
          rect,
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

      // Keep the selection alive while the toolbar is clicked.
      bar.addEventListener('pointerdown', (e) => e.preventDefault())
      quoteBtn.addEventListener('click', () => {
        const target = pending
        if (target) openEditor({ mode: 'add', rect: target.rect, text: target.text, note: '', onSubmit: (note) => commit(target, note) })
      })

      let timer = null
      const schedule = () => {
        if (timer !== null) clearTimeout(timer)
        timer = setTimeout(() => { timer = null; refresh() }, 120)
      }
      const onPointerDown = (e) => {
        if (pop !== null && !pop.contains(e.target)) closePop()
        if (!tip.hidden && !(e.target instanceof Node && tip.contains(e.target))) hideTip()
        // Remember which quote chip is being pressed: openReference only passes
        // the ref, and two chips may quote the same passage. Read-only DOM access.
        const target = e.target instanceof Element ? e.target : null
        const el = target !== null ? target.closest('[data-composer-chip="quote"]') : null
        if (el === null) { clickedChip = null; return }
        const card = el.closest('[data-composer-card]')
        const all = card !== null ? Array.from(card.querySelectorAll('[data-composer-chip="quote"]')) : [el]
        clickedChip = { el, index: all.indexOf(el) }
      }
      const onKeyDown = (e) => {
        if (e.key === 'Escape' && !bar.hidden) hideBar()
        if (e.key === 'Escape' && !tip.hidden) hideTip()
      }
      const onScroll = (e) => {
        if (!bar.hidden) hideBar()
        if (!tip.hidden && !(e.target instanceof Node && tip.contains(e.target))) hideTip()
      }

      ctx.effect(() => {
        document.head.appendChild(style)
        document.body.appendChild(bar)
        document.body.appendChild(tip)
        document.addEventListener('selectionchange', schedule)
        document.addEventListener('pointerover', onTipOver, true)
        document.addEventListener('pointerdown', onPointerDown, true)
        document.addEventListener('keydown', onKeyDown, true)
        window.addEventListener('scroll', onScroll, true)
        return () => {
          if (timer !== null) clearTimeout(timer)
          document.removeEventListener('selectionchange', schedule)
          document.removeEventListener('pointerover', onTipOver, true)
          hideTip()
          tip.remove()
          document.removeEventListener('pointerdown', onPointerDown, true)
          document.removeEventListener('keydown', onKeyDown, true)
          window.removeEventListener('scroll', onScroll, true)
          closePop()
          bar.remove()
          style.remove()
        }
      }, 'dsh-quote: selection toolbar')
    }

    module.exports.name = '@rs-dsh/dsh-quote'
    module.exports.inject = ['conversation', 'inputTriggers', 'locale', 'sessions', 'slots', 'uiConversation']
    module.exports.apply = apply
    // Pure helpers, exported for tests only.
    module.exports._internals = {
      oneLine, encodeRef, decodeRef, serializeQuote, quoteRule, makeInsert, stackQuote, cleanSelection,
      quoteChipIndex, replaceQuote, removeQuote,
    }
    return module.exports
  },
})
