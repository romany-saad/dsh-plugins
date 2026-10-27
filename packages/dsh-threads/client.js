// @rs-dsh/dsh-threads: browser half (hand-written, no build step).
//
// Select text in a conversation and press "Comment": the comment is saved
// with the passage, the passage is highlighted, and the session's own model
// replies briefly in a small thread next to it. "Send to chat" puts a thread
// in the composer as a chip; at send it becomes a <comment-thread> block,
// which the sent bubble shows as a card.
//
// Extension points (DSH 0.2.x), no DOM surgery on host-owned nodes:
//   host routes api/dsh-threads/*       threads, create, comment, retry, delete
//   CSS Custom Highlight API            highlights paint over host text without changing it
//   inputTriggers.registerSource        chip owner + codec (serialize at submit)
//   conversation.input.for(actx)        draft snapshot / setDraft / focus
//   uiConversation.userText + slot      <comment-thread> blocks render as cards
// The host's DOM is only read: data-conversation-session, data-chat-node-key
// and the reasoning rows (data-variant="think", data-expanded).
window.__ModuleLoader__.load({
  id: '@rs-dsh/dsh-threads',
  factory: (require) => {
    'use strict'
    const module = { exports: {} }

    const SOURCE = 'comment'
    const NS = 'dsh-threads'
    const API = 'api/dsh-threads/'
    const CONTEXT = 64
    const HIGHLIGHT = 'dsh-threads'
    const HIGHLIGHT_OPEN = 'dsh-threads-open'

    // ------------------------------------------------------------ pure logic

    /** Collapse whitespace and cut to n code points with an ellipsis. */
    function oneLine(s, n) {
      const flat = String(s).replace(/[\uE100-\uE11D\uFFFC]/gu, '').replace(/\s+/g, ' ').trim()
      const chars = Array.from(flat)
      return chars.length <= n ? flat : chars.slice(0, n - 1).join('') + '…'
    }

    /** Normalize a raw DOM selection string. */
    function cleanSelection(raw) {
      return String(raw).replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
    }

    const stripSpace = (s) => String(s).replace(/\s+/g, '')

    /**
     * What a row's data-chat-node-key names: a user message (by its id) or an
     * assistant step (by turn and step). Undefined for anything else.
     */
    function parseNodeKey(key) {
      const m = /^\d+:(input-message|assistant-step)(.+)$/.exec(String(key))
      if (m === null) return undefined
      if (m[1] === 'input-message') return { kind: 'user', messageId: m[2] }
      const s = /^(\d+):(\d+)$/.exec(m[2])
      return s === null ? undefined : { kind: 'assistant', turn: Number(s[1]), step: Number(s[2]) }
    }

    /** The row key an anchor lives in (the inverse of parseNodeKey). */
    function nodeKeyOf(anchor) {
      const kind = anchor.kind === 'user' ? 'input-message' : 'assistant-step'
      const id = anchor.kind === 'user' ? anchor.messageId : anchor.turn + ':' + anchor.step
      return kind.length + ':' + kind + id
    }

    /**
     * Where the passage is in a text with all whitespace removed. Each
     * occurrence is scored by how much of the stored text before and after
     * it matches; the best wins. Returns the start index or -1.
     */
    function locate(haystack, anchor) {
      const needle = stripSpace(anchor.text)
      if (needle === '') return -1
      const prefix = stripSpace(anchor.prefix || '')
      const suffix = stripSpace(anchor.suffix || '')
      let best = -1, bestScore = -1
      for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + 1)) {
        let before = 0
        while (before < prefix.length && at - 1 - before >= 0 && haystack[at - 1 - before] === prefix[prefix.length - 1 - before]) before++
        let after = 0
        const end = at + needle.length
        while (after < suffix.length && end + after < haystack.length && haystack[end + after] === suffix[after]) after++
        if (before + after > bestScore) { best = at; bestScore = before + after }
      }
      return best
    }

    // The chip's ref carries the thread itself, so a reloaded draft still serializes.
    function encodeRef(thread) {
      return JSON.stringify({
        v: 1,
        passage: thread.anchor.text,
        messages: thread.messages.map((m) => ({ role: m.role, text: m.text })),
      })
    }

    function decodeRef(ref) {
      const value = JSON.parse(ref)
      if (value === null || typeof value !== 'object' || typeof value.passage !== 'string' || !Array.isArray(value.messages)) {
        throw new Error('dsh-threads: malformed thread reference')
      }
      return {
        passage: value.passage,
        messages: value.messages.filter((m) => m && (m.role === 'user' || m.role === 'ai') && typeof m.text === 'string'),
      }
    }

    const escapeTags = (s) => s.replace(/<\/(comment-thread|passage|comment|reply)>/gi, '<\\/$1>')
    const unescapeTags = (s) => s.replace(/<\\\/(comment-thread|passage|comment|reply)>/gi, '</$1>')

    const THREAD_INTRO = '(A side thread: the user commented on a passage of this conversation; the replies came from an assistant that could only read the session.)'

    /** Model form of one thread. Must stay in sync with THREAD_BLOCK below. */
    function serializeThread(thread) {
      let out = '<comment-thread>\n' + THREAD_INTRO + '\n<passage>\n' + escapeTags(thread.passage) + '\n</passage>\n'
      for (const m of thread.messages) {
        const tag = m.role === 'user' ? 'comment' : 'reply'
        out += '<' + tag + '>' + escapeTags(m.text) + '</' + tag + '>\n'
      }
      return out + '</comment-thread>'
    }

    const THREAD_BLOCK = /<comment-thread>\n\(A side thread: [^\n]*\)\n<passage>\n([\s\S]*?)\n<\/passage>\n((?:<(?:comment|reply)>[\s\S]*?<\/(?:comment|reply)>\n)*)<\/comment-thread>\n?/g
    const THREAD_ITEM = /<(comment|reply)>([\s\S]*?)<\/\1>\n/g

    /** userText rule: nearest <comment-thread> block at or after `from`. */
    const threadRule = {
      id: SOURCE,
      order: 16,
      match(text, from) {
        THREAD_BLOCK.lastIndex = from
        const m = THREAD_BLOCK.exec(text)
        if (m === null) return undefined
        const messages = []
        THREAD_ITEM.lastIndex = 0
        for (let item = THREAD_ITEM.exec(m[2]); item !== null; item = THREAD_ITEM.exec(m[2])) {
          messages.push({ role: item[1] === 'comment' ? 'user' : 'ai', text: unescapeTags(item[2]) })
        }
        return { id: SOURCE, start: m.index, end: m.index + m[0].length, data: { passage: unescapeTags(m[1]), messages } }
      },
    }

    function makeInsert(thread) {
      return {
        source: SOURCE,
        ref: encodeRef(thread),
        label: 'Thread “' + oneLine(thread.anchor.text, 40) + '” · ' + thread.messages.length,
        clipboardText: '> ' + oneLine(thread.anchor.text, 120),
      }
    }

    /**
     * Insert one chip into a draft snapshot, after the chips of this source
     * already stacked at the top, each on its own line. Other chips shift.
     */
    function stackChip(snapshot, insert) {
      const text = snapshot.text
      const refs = snapshot.references.slice().sort((a, b) => a.offset - b.offset)
      let at = 0
      for (;;) {
        const head = refs.find((r) => r.offset === at && r.source === insert.source)
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

    // DSH has no plain comment glyph; this is the bubble of its IconNewChatOutline
    // (dsh-client-ui-primitives) without the plus, at the same 16px view box and stroke.
    const BUBBLE_PATH = 'M2.37091 11.2501C1.58745 9.89288 1.32067 8.29835 1.61969 6.76006C1.91872 5.22177 2.76342 3.8433 3.99826 2.87846C5.2331 1.91362 6.77494 1.42737 8.33988 1.50925C9.90482 1.59113 11.3875 2.23562 12.5149 3.32406C13.6425 4.41269 14.3387 5.87206 14.4754 7.4334C14.612 8.99474 14.18 10.5529 13.2587 11.8209C12.3375 13.0888 10.9891 13.9813 9.46194 14.3337C8.18691 14.628 6.85895 14.5294 5.64989 14.0605C5.1712 13.8748 4.76962 13.4932 4.26534 13.3967C3.67413 13.2835 2.95257 13.5598 2.03794 14.3337'

    /** The bubble as an SVG element (badge) — aria-hidden, the badge carries the name. */
    function bubbleSvg(size) {
      const ns = 'http://www.w3.org/2000/svg'
      const svg = document.createElementNS(ns, 'svg')
      for (const [k, v] of [['width', size], ['height', size], ['viewBox', '0 0 16 16'], ['fill', 'none'], ['aria-hidden', 'true'], ['stroke-width', '1.3']]) svg.setAttribute(k, String(v))
      const path = document.createElementNS(ns, 'path')
      path.setAttribute('d', BUBBLE_PATH)
      path.setAttribute('stroke', 'currentColor')
      svg.append(path)
      return svg
    }

    // ------------------------------------------------------------ strings

    const en = {
      comment: 'Comment',
      placeholder: 'Comment · Enter posts, Shift+Enter breaks line',
      replyPlaceholder: 'Reply · Enter sends',
      post: 'Comment',
      send: 'Send',
      cancel: 'Cancel',
      close: 'Close',
      you: 'You',
      ai: 'AI',
      thinking: 'Thinking…',
      retry: 'Try again',
      toChat: 'Send to chat',
      delete: 'Delete',
      deleteConfirm: 'Delete this thread?',
      busy: 'The composer is busy; try again in a moment',
      command: 'A thread cannot go into a command draft',
      noSession: 'No composer found for this conversation',
      network: 'The request failed',
      full: 'This thread is full. Start a new one, or send it to the chat.',
      reasoningCollapsed: 'Expand the reasoning to see the highlighted passage.',
      detached: 'The passage is not on the page now.',
      readOnly: 'Continue this session to reply or delete.',
      thread: 'Comment thread',
      messageCount: '{n} messages',
    }
    const zh = {
      comment: '评论',
      placeholder: '评论 · Enter 发布，Shift+Enter 换行',
      replyPlaceholder: '回复 · Enter 发送',
      post: '评论',
      send: '发送',
      cancel: '取消',
      close: '关闭',
      you: '你',
      ai: 'AI',
      thinking: '思考中…',
      retry: '重试',
      toChat: '发送到对话',
      delete: '删除',
      deleteConfirm: '删除这个讨论？',
      busy: '当前无法编辑输入框，稍后再试',
      command: '命令草稿中不能插入讨论',
      noSession: '找不到该会话的输入框',
      network: '请求失败',
      full: '这个讨论已满。请新建一个，或发送到对话。',
      reasoningCollapsed: '展开思考过程以查看高亮内容。',
      detached: '该段落当前不在页面上。',
      readOnly: '继续这个会话后才能回复或删除。',
      thread: '评论讨论',
      messageCount: '{n} 条消息',
    }

    const STYLE = `
::highlight(${HIGHLIGHT}){background-color:rgba(255,190,0,.22);text-decoration:underline;text-decoration-color:rgba(214,140,0,.9);text-decoration-thickness:2px;text-underline-offset:3px}
::highlight(${HIGHLIGHT_OPEN}){background-color:rgba(255,190,0,.48);text-decoration:underline;text-decoration-color:rgba(214,140,0,.9);text-decoration-thickness:2px;text-underline-offset:3px}
.dshth-bar{position:fixed;z-index:1200;display:flex;gap:2px;padding:3px;border-radius:10px;
  background:var(--dsw-specific-input-major,#2b2b2e);box-shadow:var(--dsw-elevation-soft,0 4px 16px rgba(0,0,0,.25));
  border:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3));font:13px/20px var(--dsw-font-family,system-ui)}
.dshth-bar[hidden]{display:none}
.dshth-bar button{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-primary,#eee);
  padding:3px 10px;border-radius:7px;cursor:pointer;font:inherit}
.dshth-bar button:hover,.dshth-bar button:focus-visible{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.15));outline:none}
.dshth-pop{position:fixed;z-index:1200;width:360px;max-width:calc(100vw - 16px);max-height:min(70vh,560px);display:flex;flex-direction:column;
  box-sizing:border-box;padding:10px;border-radius:12px;
  background:var(--dsw-specific-input-major,#2b2b2e);box-shadow:var(--dsw-elevation-soft,0 4px 16px rgba(0,0,0,.25));
  border:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3));font:13px/20px var(--dsw-font-family,system-ui);
  color:var(--dsw-alias-label-primary,#eee)}
.dshth-pop [hidden]{display:none!important}
.dshth-pop blockquote{flex:none;margin:0 0 8px;padding:2px 8px;border-left:3px solid rgba(214,140,0,.9);
  color:var(--dsw-alias-label-secondary,#aaa);white-space:pre-wrap;overflow-wrap:anywhere;
  display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden}
.dshth-list{flex:auto;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:8px;margin-bottom:8px}
.dshth-msg{white-space:pre-wrap;overflow-wrap:anywhere}
.dshth-who{display:block;font-size:12px;line-height:16px;color:var(--dsw-alias-label-caption,#888)}
.dshth-thinking{color:var(--dsw-alias-label-caption,#888);font-style:italic}
.dshth-error{flex:none;color:var(--dsw-alias-state-error-primary,#e5484d);white-space:pre-wrap}
.dshth-pop textarea{flex:none;box-sizing:border-box;width:100%;min-height:56px;resize:vertical;padding:6px 8px;border-radius:8px;
  border:.5px solid var(--dsw-alias-border-l4,rgba(127,127,127,.4));background:transparent;color:inherit;font:inherit;outline:none}
.dshth-actions{flex:none;display:flex;justify-content:flex-end;gap:6px;margin-top:8px}
.dshth-pop button{appearance:none;border:0;border-radius:7px;padding:3px 12px;cursor:pointer;font:inherit;
  background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.15));color:inherit}
.dshth-pop button[data-primary]{background:var(--dsw-alias-button-info-fill,#4c6ef5);color:#fff}
.dshth-pop button[data-danger]{margin-right:auto;background:transparent;color:var(--dsw-alias-state-error-primary,#e5484d)}
.dshth-pop button[data-danger]:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.15))}
.dshth-pop button:disabled{opacity:.5;cursor:default}
.dshth-note{flex:none;margin-bottom:6px;font-size:12px;color:var(--dsw-alias-label-caption,#888)}
.dshth-layer{position:fixed;inset:0;z-index:1100;pointer-events:none;overflow:hidden}
.dshth-badge{position:fixed;pointer-events:auto;cursor:pointer;display:flex;align-items:center;gap:3px;height:18px;padding:0 5px;border-radius:9px;
  font:600 11px/18px var(--dsw-font-family,system-ui);color:#7a4b00;background:#ffd46b;border:0;box-shadow:0 1px 3px rgba(0,0,0,.18)}
.dshth-badge[data-replying]{animation:dshth-pulse 1.2s ease-in-out infinite}
.dshth-badge[data-failed]{background:#ffb4b4;color:#7a0000}
@keyframes dshth-pulse{50%{opacity:.45}}
.dshth-card{display:block;margin:2px 0 6px;padding:3px 8px;border-left:3px solid rgba(214,140,0,.9);
  border-radius:4px;background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.1));white-space:pre-wrap;text-align:left}
.dshth-card[data-interactive]{cursor:pointer}
.dshth-card-title{display:flex;align-items:center;gap:4px;font-size:12px;color:var(--dsw-alias-label-caption,#888)}
.dshth-card-passage{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;color:var(--dsw-alias-label-secondary,#aaa)}
.dshth-card[data-open] .dshth-card-passage{display:block}
.dshth-card-msg{display:block;margin-top:2px}
.dshth-card-msg b{font-weight:600}
`

    // ------------------------------------------------------------ plugin body

    function apply(ctx) {
      const React = require('react')
      const { jsx, jsxs } = require('react/jsx-runtime')

      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-threads: dictionaries')
      const t = ctx.locale.bind(NS)
      const count = (n) => String(t('messageCount')).replace('{n}', String(n))

      // -------------------------------------------------- chip + sent card

      const source = {
        trigger: '@',
        name: SOURCE,
        order: 99,
        showGroupTitle: false,
        candidates: () => Promise.resolve([]),
        onPick: () => undefined,
        openReference: () => false,
        codec: {
          clipboardText: (ref) => '> ' + oneLine(decodeRef(ref).passage, 120),
          serialize: (ref) => Promise.resolve(serializeThread(decodeRef(ref))),
        },
      }
      ctx.effect(() => ctx.inputTriggers.registerSource(source), 'dsh-threads: chip source')
      ctx.effect(() => ctx.uiConversation.userText.register(threadRule), 'dsh-threads: user-text rule')

      function ThreadCard({ node, interactive }) {
        const [isOpen, setOpen] = React.useState(false)
        const { passage, messages } = node.data
        const children = [
          jsxs('span', { className: 'dshth-card-title', children: [
            jsx('svg', { width: 12, height: 12, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true', strokeWidth: 1.3, children: jsx('path', { d: BUBBLE_PATH, stroke: 'currentColor' }) }),
            t('thread') + ' · ' + count(messages.length),
          ] }, 'h'),
          jsx('span', { className: 'dshth-card-passage', children: passage }, 'p'),
        ]
        if (isOpen) {
          messages.forEach((m, i) => children.push(jsxs('span', {
            className: 'dshth-card-msg',
            children: [jsx('b', { children: (m.role === 'user' ? t('you') : t('ai')) + ': ' }), m.text],
          }, 'm' + i)))
        }
        return jsxs('span', {
          className: 'dshth-card',
          'data-dsh-threads': '',
          'data-open': isOpen || undefined,
          'data-interactive': interactive || undefined,
          onClick: interactive ? () => setOpen((v) => !v) : undefined,
          children,
        })
      }
      ctx.slots.inject('conversation.user.text.node', () => ctx.slots.register({
        name: 'conversation.user.text.node',
        key: SOURCE,
        priority: 100,
      }, ThreadCard))

      function sendToChat(sessionId, thread) {
        const actx = ctx.sessions.scope(sessionId)
        if (actx === undefined) return t('noSession')
        const input = ctx.conversation.input.for(actx)
        const phase = input.state.getSnapshot().phase
        if (phase === 'claimed') return t('command')
        if (phase !== 'plain') return t('busy')
        const insert = makeInsert(thread)
        const snapshot = input.draftSnapshot
        if (snapshot !== undefined && snapshot !== null && Array.isArray(snapshot.references)) {
          if (snapshot.command !== undefined) return t('command')
          input.setDraft(stackChip(snapshot, insert))
        } else {
          const span = input.actions.captureInsertion()
          if (actx.bail(actx, 'slash/input-insert-reference', { reference: insert, span }) !== true) return t('busy')
        }
        input.focus()
        return null
      }

      // -------------------------------------------------- server

      async function call(path, body) {
        let response
        try {
          response = await fetch(API + path, body === undefined
            ? { cache: 'no-store' }
            : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
        } catch (_) {
          throw new Error(t('network'))
        }
        let value
        try { value = await response.json() } catch (_) { value = {} }
        if (!response.ok) {
          const error = new Error(value.message || t('network'))
          error.code = value.error
          throw error
        }
        return value
      }

      // sessionId → { threads: object[], canWrite: boolean, error?: string }
      const store = new Map()
      const loading = new Map()

      function load(sessionId) {
        if (loading.has(sessionId)) return loading.get(sessionId)
        const run = call('threads?sessionId=' + encodeURIComponent(sessionId)).then((value) => {
          store.set(sessionId, { threads: value.threads, canWrite: value.canWrite })
        }, (error) => {
          store.set(sessionId, { threads: store.get(sessionId)?.threads ?? [], canWrite: false, error: error.message })
        }).finally(() => {
          loading.delete(sessionId)
          changed()
        })
        loading.set(sessionId, run)
        return run
      }

      function putThread(sessionId, thread) {
        const entry = store.get(sessionId) ?? { threads: [], canWrite: true }
        const at = entry.threads.findIndex((x) => x.id === thread.id)
        const threads = entry.threads.slice()
        if (at === -1) threads.push(thread)
        else threads[at] = thread
        store.set(sessionId, { ...entry, threads })
        changed()
      }

      function dropThread(sessionId, threadId) {
        const entry = store.get(sessionId)
        if (entry === undefined) return
        store.set(sessionId, { ...entry, threads: entry.threads.filter((x) => x.id !== threadId) })
        changed()
      }

      const threadOf = (sessionId, threadId) => store.get(sessionId)?.threads.find((x) => x.id === threadId)

      // Poll while a reply is on its way.
      let pollTimer = null
      function schedulePoll() {
        if (pollTimer !== null) return
        const shown = visibleSessions()
        const waiting = [...store.entries()].filter(([id, e]) => shown.includes(id) && e.threads.some((x) => x.replying)).map(([id]) => id)
        if (waiting.length === 0) return
        pollTimer = setTimeout(() => {
          pollTimer = null
          waiting.forEach(load)
        }, 1500)
      }

      // -------------------------------------------------- DOM reading

      const chatRegions = () => Array.from(document.querySelectorAll('[data-conversation-region="chat"][data-conversation-session]'))
      const visibleSessions = () => chatRegions().map((el) => el.getAttribute('data-conversation-session'))
      const escapeAttr = (s) => (window.CSS && window.CSS.escape ? window.CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&'))

      // Inside an assistant row, only the reply's own text counts.
      const NOT_REPLY = '[data-variant="think"],[data-tool],[data-variant="others"],[data-variant="bash"],button,[data-dsh-threads]'

      /** The elements an anchor's text lives in, in document order. */
      function anchorRoots(region, anchor) {
        const rows = Array.from(region.querySelectorAll('[data-chat-node-key="' + escapeAttr(nodeKeyOf(anchor)) + '"]'))
        if (anchor.kind === 'reasoning') {
          const thinks = []
          for (const row of rows) thinks.push(...row.querySelectorAll('[data-variant="think"]'))
          const think = thinks[anchor.block]
          return think !== undefined && think.hasAttribute('data-expanded') ? [think] : []
        }
        return rows
      }

      /**
       * Every non-space character of the roots' text, with its text node and
       * offset, and the same characters as one string.
       */
      function textMap(roots, kind) {
        const chars = []
        let text = ''
        for (const root of roots) {
          const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
            acceptNode(node) {
              const el = node.parentElement
              if (el === null) return NodeFilter.FILTER_REJECT
              const skip = el.closest(kind === 'assistant' ? NOT_REPLY : 'button,[data-dsh-threads]')
              return skip !== null && root.contains(skip) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
            },
          })
          for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
            const value = node.nodeValue
            for (let i = 0; i < value.length; i++) {
              const c = value[i]
              if (/\s/.test(c)) continue
              chars.push({ node, offset: i })
              text += c
            }
          }
        }
        return { chars, text }
      }

      /** The anchor the current selection would get, with its rectangle; null when it cannot be commented. */
      function selectionAnchor() {
        const sel = window.getSelection()
        if (sel === null || sel.isCollapsed || sel.rangeCount === 0) return null
        const range = sel.getRangeAt(0)
        const node = range.commonAncestorContainer
        const el = node instanceof Element ? node : node.parentElement
        if (el === null) return null
        const region = el.closest('[data-conversation-region="chat"][data-conversation-session]')
        if (region === null || el.closest('[data-composer-card],[data-dsh-threads],[data-dsh-quote],input,textarea,[contenteditable="true"]') !== null) return null
        const row = el.closest('[data-chat-node-key]')
        if (row === null) return null
        const where = parseNodeKey(row.getAttribute('data-chat-node-key'))
        if (where === undefined || row.querySelector('[data-submission-echo]') !== null) return null
        let anchor, roots
        const think = el.closest('[data-variant="think"]')
        if (where.kind === 'assistant' && think !== null) {
          if (!think.hasAttribute('data-expanded')) return null
          const all = []
          for (const r of region.querySelectorAll('[data-chat-node-key="' + escapeAttr(row.getAttribute('data-chat-node-key')) + '"]')) {
            all.push(...r.querySelectorAll('[data-variant="think"]'))
          }
          anchor = { kind: 'reasoning', turn: where.turn, step: where.step, block: all.indexOf(think) }
          roots = [think]
        } else {
          if (where.kind === 'assistant' && el.closest('[data-tool],[data-variant="others"],[data-variant="bash"]') !== null) return null
          anchor = { ...where }
          roots = anchorRoots(region, anchor)
        }
        const text = cleanSelection(sel.toString())
        if (text === '') return null
        const rect = range.getBoundingClientRect()
        if (rect.width === 0 && rect.height === 0) return null
        // The text around the passage, to find it again among repeats.
        const map = textMap(roots, anchor.kind)
        let first = -1, last = -1
        for (let i = 0; i < map.chars.length; i++) {
          const c = map.chars[i]
          let inside
          try { inside = range.comparePoint(c.node, c.offset) === 0 && range.comparePoint(c.node, c.offset + 1) === 0 } catch (_) { inside = false }
          if (inside) { if (first === -1) first = i; last = i }
        }
        if (first === -1) return null
        anchor.text = text
        anchor.prefix = map.text.slice(Math.max(0, first - CONTEXT), first)
        anchor.suffix = map.text.slice(last + 1, last + 1 + CONTEXT)
        return { sessionId: region.getAttribute('data-conversation-session'), anchor, rect }
      }

      // -------------------------------------------------- highlights

      const highlights = typeof Highlight === 'function' && window.CSS !== undefined && window.CSS.highlights !== undefined
      let placed = new Map() // `${sessionId} ${threadId}` → Range, for the threads found on the page
      let open = null // { sessionId, threadId } of the open thread

      function placeHighlights() {
        const next = new Map()
        for (const region of chatRegions()) {
          const sessionId = region.getAttribute('data-conversation-session')
          const entry = store.get(sessionId)
          if (entry === undefined) continue
          const maps = new Map()
          for (const thread of entry.threads) {
            const roots = anchorRoots(region, thread.anchor)
            if (roots.length === 0) continue
            const mapKey = nodeKeyOf(thread.anchor) + (thread.anchor.kind === 'reasoning' ? '#r' + thread.anchor.block : '')
            let map = maps.get(mapKey)
            if (map === undefined) { map = textMap(roots, thread.anchor.kind); maps.set(mapKey, map) }
            const at = locate(map.text, thread.anchor)
            if (at === -1) continue
            const last = map.chars[at + stripSpace(thread.anchor.text).length - 1]
            const range = document.createRange()
            range.setStart(map.chars[at].node, map.chars[at].offset)
            const width = last.node.nodeValue.codePointAt(last.offset) > 0xffff ? 2 : 1
            range.setEnd(last.node, Math.min(last.offset + width, last.node.nodeValue.length))
            next.set(sessionId + ' ' + thread.id, range)
          }
        }
        placed = next
        if (highlights) {
          const all = [], opened = []
          for (const [k, range] of placed) {
            if (open !== null && k === open.sessionId + ' ' + open.threadId) opened.push(range)
            else all.push(range)
          }
          window.CSS.highlights.set(HIGHLIGHT, new Highlight(...all))
          window.CSS.highlights.set(HIGHLIGHT_OPEN, new Highlight(...opened))
        }
        placeBadges()
      }

      // One badge after each highlighted passage, in a layer of our own.
      const layer = document.createElement('div')
      layer.className = 'dshth-layer'
      layer.setAttribute('data-dsh-threads', '')
      const badges = new Map() // key → button

      // Badges sit in the gutter right of the conversation column, level with
      // the passage's first line, so they never cover text. Badges on the same
      // line stack sideways.
      function placeBadges() {
        const regions = new Map(chatRegions().map((r) => [r.getAttribute('data-conversation-session'), r]))
        const seen = new Set()
        const lines = [] // { top, right } of badges placed so far
        for (const [k, range] of placed) {
          const [sessionId, threadId] = k.split(' ')
          const thread = threadOf(sessionId, threadId)
          const region = regions.get(sessionId)
          if (thread === undefined || region === undefined) continue
          const rect = range.getClientRects()[0]
          const clip = region.getBoundingClientRect()
          if (rect === undefined || rect.bottom < clip.top + 4 || rect.top > clip.bottom - 4) continue
          const start = range.startContainer
          const row = (start instanceof Element ? start : start.parentElement)?.closest('[data-chat-node-key]')
          const column = row?.getBoundingClientRect() ?? rect
          seen.add(k)
          let badge = badges.get(k)
          if (badge === undefined) {
            badge = document.createElement('button')
            badge.type = 'button'
            badge.className = 'dshth-badge'
            badge.addEventListener('click', (e) => { e.stopPropagation(); openThread(sessionId, threadId) })
            badges.set(k, badge)
            layer.append(badge)
          }
          badge.replaceChildren(bubbleSvg(12), document.createTextNode(String(thread.messages.length)))
          badge.title = oneLine(thread.messages[0].text, 120)
          badge.setAttribute('aria-label', t('thread') + ': ' + oneLine(thread.messages[0].text, 80))
          badge.toggleAttribute('data-replying', thread.replying === true)
          badge.toggleAttribute('data-failed', thread.failure !== undefined)
          const top = Math.round(rect.top + rect.height / 2 - 9)
          let left = Math.round(column.right + 10)
          for (const l of lines) if (Math.abs(l.top - top) < 18 && l.right > left - 4) left = l.right + 4
          left = Math.min(left, Math.round(clip.right - (badge.offsetWidth || 40) - 4))
          lines.push({ top, right: left + (badge.offsetWidth || 40) })
          badge.style.left = left + 'px'
          badge.style.top = top + 'px'
        }
        for (const [k, badge] of badges) {
          if (!seen.has(k)) { badge.remove(); badges.delete(k) }
        }
      }

      /** The thread whose highlight holds this point, if any; the latest one wins. */
      function threadAtPoint(x, y) {
        let node, offset
        if (typeof document.caretPositionFromPoint === 'function') {
          const p = document.caretPositionFromPoint(x, y)
          if (p === null) return null
          node = p.offsetNode; offset = p.offset
        } else if (typeof document.caretRangeFromPoint === 'function') {
          const r = document.caretRangeFromPoint(x, y)
          if (r === null) return null
          node = r.startContainer; offset = r.startOffset
        } else {
          return null
        }
        let found = null
        for (const [k, range] of placed) {
          let inside = false
          try { inside = range.isPointInRange(node, offset) } catch (_) { inside = false }
          if (inside) found = k
        }
        if (found === null) return null
        const [sessionId, threadId] = found.split(' ')
        return { sessionId, threadId }
      }

      // -------------------------------------------------- the popovers

      const style = document.createElement('style')
      style.setAttribute('data-dsh-threads-style', '')
      style.textContent = STYLE
      const bar = document.createElement('div')
      bar.className = 'dshth-bar'
      bar.setAttribute('role', 'toolbar')
      bar.setAttribute('data-dsh-threads', '')
      bar.hidden = true
      const commentBtn = document.createElement('button')
      commentBtn.type = 'button'
      bar.append(commentBtn)

      let pending = null // the selection's { sessionId, anchor, rect }
      let pop = null // { el, kind: 'new' | 'thread', render? }

      function place(el, rect, height) {
        const width = el.offsetWidth || 200
        const left = Math.max(8, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - 8))
        let top = rect.top - height - 8
        if (top < 8) top = rect.bottom + 8
        el.style.left = Math.round(left) + 'px'
        el.style.top = Math.round(Math.max(8, Math.min(top, window.innerHeight - height - 8))) + 'px'
      }

      /** Below the passage, or above it when there is no room. */
      function placeBelow(el, rect) {
        const width = el.offsetWidth || 360
        const height = el.offsetHeight || 240
        let top = rect.bottom + 8
        if (top + height > window.innerHeight - 8) top = rect.top - height - 8
        el.style.left = Math.round(Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))) + 'px'
        el.style.top = Math.round(Math.max(8, Math.min(top, window.innerHeight - height - 8))) + 'px'
      }

      function hideBar() {
        bar.hidden = true
        pending = null
      }

      function closePop() {
        if (pop === null) return
        pop.el.remove()
        const wasThread = pop.kind === 'thread'
        pop = null
        if (wasThread) { open = null; placeHighlights() }
      }

      function button(label, attr) {
        const b = document.createElement('button')
        b.type = 'button'
        b.textContent = label
        if (attr) b.setAttribute(attr, '')
        return b
      }

      function onEnter(area, submit, cancel) {
        area.addEventListener('keydown', (e) => {
          if (e.isComposing || e.keyCode === 229) return
          if (e.key === 'Escape') { e.preventDefault(); cancel() }
          else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() }
        })
      }

      function popover(mode) {
        const el = document.createElement('div')
        el.className = 'dshth-pop'
        el.setAttribute('data-dsh-threads', '')
        el.setAttribute('data-mode', mode)
        el.setAttribute('role', 'dialog')
        return el
      }

      /** The box for a new comment on the selected passage. */
      function openNew(target) {
        closePop()
        hideBar()
        const el = popover('new')
        const preview = document.createElement('blockquote')
        preview.textContent = oneLine(target.anchor.text, 280)
        const area = document.createElement('textarea')
        area.placeholder = t('placeholder')
        const error = document.createElement('div')
        error.className = 'dshth-error'
        error.hidden = true
        const actions = document.createElement('div')
        actions.className = 'dshth-actions'
        const cancel = button(t('cancel'))
        const post = button(t('post'), 'data-primary')
        actions.append(cancel, post)
        el.append(preview, area, error, actions)
        document.body.appendChild(el)
        pop = { el, kind: 'new' }
        place(el, target.rect, el.offsetHeight || 180)
        let busy = false
        const submit = async () => {
          if (busy || area.value.trim() === '') return
          busy = true
          post.disabled = true
          error.hidden = true
          try {
            const thread = await call('create', { sessionId: target.sessionId, anchor: target.anchor, text: area.value })
            if (pop !== null && pop.el === el) closePop()
            window.getSelection()?.removeAllRanges()
            putThread(target.sessionId, thread)
            openThread(target.sessionId, thread.id)
          } catch (e) {
            error.textContent = e.message
            error.hidden = false
          } finally {
            busy = false
            post.disabled = false
          }
        }
        cancel.addEventListener('click', closePop)
        post.addEventListener('click', submit)
        onEnter(area, submit, closePop)
        area.focus()
      }

      /** The thread popover: the passage, the messages, a reply box and the actions. */
      function openThread(sessionId, threadId) {
        if (threadOf(sessionId, threadId) === undefined) return
        closePop()
        hideBar()
        const el = popover('thread')
        const preview = document.createElement('blockquote')
        const note = document.createElement('div')
        note.className = 'dshth-note'
        const list = document.createElement('div')
        list.className = 'dshth-list'
        const area = document.createElement('textarea')
        area.placeholder = t('replyPlaceholder')
        const error = document.createElement('div')
        error.className = 'dshth-error'
        error.hidden = true
        const actions = document.createElement('div')
        actions.className = 'dshth-actions'
        const del = button(t('delete'), 'data-danger')
        const toChat = button(t('toChat'))
        const close = button(t('close'))
        const send = button(t('send'), 'data-primary')
        actions.append(del, toChat, close, send)
        el.append(preview, note, list, area, error, actions)
        document.body.appendChild(el)
        open = { sessionId, threadId }

        let busy = false
        let shownCount = -1
        const showError = (message) => { error.textContent = message; error.hidden = false }
        const render = () => {
          const current = threadOf(sessionId, threadId)
          if (current === undefined) { closePop(); return }
          const canWrite = store.get(sessionId)?.canWrite !== false
          preview.textContent = current.anchor.text
          const notes = []
          if (!placed.has(sessionId + ' ' + threadId)) notes.push(current.anchor.kind === 'reasoning' ? t('reasoningCollapsed') : t('detached'))
          if (!canWrite) notes.push(t('readOnly'))
          note.textContent = notes.join(' ')
          note.hidden = notes.length === 0
          const stamp = current.messages.length + (current.replying ? 'r' : '') + (current.failure ?? '')
          if (stamp !== shownCount) {
            shownCount = stamp
            list.replaceChildren()
            for (const m of current.messages) {
              const item = document.createElement('div')
              item.className = 'dshth-msg'
              item.setAttribute('data-role', m.role)
              const who = document.createElement('span')
              who.className = 'dshth-who'
              who.textContent = m.role === 'user' ? t('you') : t('ai') + (m.model ? ' · ' + m.model : '')
              const text = document.createElement('span')
              text.className = 'dshth-text'
              text.textContent = m.text
              item.append(who, text)
              list.append(item)
            }
            if (current.replying) {
              const wait = document.createElement('div')
              wait.className = 'dshth-thinking'
              wait.textContent = t('thinking')
              list.append(wait)
            } else if (current.failure !== undefined) {
              const fail = document.createElement('div')
              fail.className = 'dshth-error'
              fail.textContent = current.failure + ' '
              if (canWrite) {
                const again = button(t('retry'))
                again.addEventListener('click', async () => {
                  try { putThread(sessionId, await call('retry', { sessionId, threadId })) } catch (e) { showError(e.message) }
                })
                fail.append(again)
              }
              list.append(fail)
            }
            list.scrollTop = list.scrollHeight
          }
          area.hidden = !canWrite
          send.hidden = !canWrite
          del.hidden = !canWrite
          send.disabled = busy || current.replying === true
        }
        pop = { el, kind: 'thread', render }
        placeHighlights()
        render()
        const anchorRect = placed.get(sessionId + ' ' + threadId)?.getBoundingClientRect()
          ?? { left: window.innerWidth / 2 - 180, top: 80, bottom: 80, width: 0, height: 0, right: 0 }
        placeBelow(el, anchorRect)

        const submit = async () => {
          const current = threadOf(sessionId, threadId)
          if (busy || area.value.trim() === '' || current?.replying) return
          busy = true
          error.hidden = true
          render()
          try {
            const next = await call('comment', { sessionId, threadId, text: area.value })
            area.value = ''
            putThread(sessionId, next)
          } catch (e) {
            showError(e.code === 'thread_full' ? t('full') : e.message)
          } finally {
            busy = false
            if (pop !== null && pop.el === el) render()
          }
        }
        send.addEventListener('click', submit)
        close.addEventListener('click', closePop)
        onEnter(area, submit, closePop)
        toChat.addEventListener('click', () => {
          const current = threadOf(sessionId, threadId)
          if (current === undefined) return
          const failure = sendToChat(sessionId, current)
          if (failure !== null) showError(failure)
          else closePop()
        })
        del.addEventListener('click', async () => {
          if (!window.confirm(t('deleteConfirm'))) return
          try {
            await call('delete', { sessionId, threadId })
            closePop()
            dropThread(sessionId, threadId)
          } catch (e) {
            showError(e.message)
          }
        })
        if (store.get(sessionId)?.canWrite !== false) area.focus()
      }

      // -------------------------------------------------- wiring

      function changed() {
        placeHighlights()
        if (pop !== null && pop.kind === 'thread') pop.render()
        schedulePoll()
      }

      function refreshBar() {
        if (pop !== null) { hideBar(); return }
        const target = selectionAnchor()
        if (target === null) { hideBar(); return }
        pending = target
        commentBtn.textContent = t('comment')
        bar.hidden = false
        // Sit beside dsh-quote's toolbar when it shows for the same selection.
        const quoteBar = document.querySelector('.dshq-bar')
        if (quoteBar !== null && !quoteBar.hidden) {
          const q = quoteBar.getBoundingClientRect()
          bar.style.left = Math.round(Math.min(q.right + 4, window.innerWidth - (bar.offsetWidth || 90) - 8)) + 'px'
          bar.style.top = Math.round(q.top) + 'px'
        } else {
          place(bar, target.rect, bar.offsetHeight || 32)
        }
      }

      bar.addEventListener('pointerdown', (e) => e.preventDefault())
      commentBtn.addEventListener('click', () => { if (pending !== null) openNew(pending) })

      let selTimer = null
      const onSelection = () => {
        if (selTimer !== null) clearTimeout(selTimer)
        // A little after dsh-quote's toolbar (120 ms), so this one can sit beside it.
        selTimer = setTimeout(() => { selTimer = null; refreshBar() }, 160)
      }

      // Load a session's threads when its conversation appears.
      let known = new Set()
      function syncSessions() {
        const shown = new Set(visibleSessions())
        for (const id of shown) if (!known.has(id)) load(id)
        known = shown
      }

      let mutTimer = null
      const observer = new MutationObserver((records) => {
        if (mutTimer !== null) return
        // Our own layer and popovers changing is no reason to recompute.
        if (records.every((r) => r.target instanceof Element ? r.target.closest('[data-dsh-threads]') !== null : r.target.parentElement?.closest('[data-dsh-threads]') != null)) return
        mutTimer = setTimeout(() => { mutTimer = null; syncSessions(); placeHighlights() }, 250)
      })

      let frame = null
      const onScroll = (e) => {
        if (!bar.hidden) hideBar()
        if (pop !== null && e.target instanceof Node && pop.el.contains(e.target)) return
        if (frame === null) frame = requestAnimationFrame(() => { frame = null; placeBadges() })
      }

      const onPointerDown = (e) => {
        const target = e.target instanceof Element ? e.target : null
        if (target !== null && target.closest('.dshq-bar') !== null) hideBar()
        if (pop !== null && !(target !== null && (pop.el.contains(target) || target.closest('.dshth-badge') !== null))) closePop()
      }

      const onClick = (e) => {
        if (e.button !== 0 || pop !== null) return
        const sel = window.getSelection()
        if (sel !== null && !sel.isCollapsed) return
        const target = e.target instanceof Element ? e.target : null
        if (target === null || target.closest('[data-conversation-region="chat"]') === null) return
        if (target.closest('a,button,input,textarea,[contenteditable="true"],[data-dsh-threads]') !== null) return
        const hit = threadAtPoint(e.clientX, e.clientY)
        if (hit !== null) openThread(hit.sessionId, hit.threadId)
      }

      const onKeyDown = (e) => {
        if (e.key === 'Escape' && !bar.hidden) hideBar()
        if (e.key === 'Escape' && pop !== null && !pop.el.contains(e.target)) closePop()
      }

      const onFocus = () => { for (const id of visibleSessions()) load(id) }

      ctx.effect(() => {
        document.head.appendChild(style)
        document.body.appendChild(bar)
        document.body.appendChild(layer)
        document.addEventListener('selectionchange', onSelection)
        document.addEventListener('pointerdown', onPointerDown, true)
        document.addEventListener('click', onClick)
        document.addEventListener('keydown', onKeyDown, true)
        window.addEventListener('scroll', onScroll, true)
        window.addEventListener('resize', onScroll)
        window.addEventListener('focus', onFocus)
        observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['data-conversation-session', 'data-expanded'] })
        syncSessions()
        return () => {
          observer.disconnect()
          for (const timer of [selTimer, mutTimer, pollTimer]) if (timer !== null) clearTimeout(timer)
          if (frame !== null) cancelAnimationFrame(frame)
          document.removeEventListener('selectionchange', onSelection)
          document.removeEventListener('pointerdown', onPointerDown, true)
          document.removeEventListener('click', onClick)
          document.removeEventListener('keydown', onKeyDown, true)
          window.removeEventListener('scroll', onScroll, true)
          window.removeEventListener('resize', onScroll)
          window.removeEventListener('focus', onFocus)
          closePop()
          if (highlights) { window.CSS.highlights.delete(HIGHLIGHT); window.CSS.highlights.delete(HIGHLIGHT_OPEN) }
          layer.remove()
          bar.remove()
          style.remove()
        }
      }, 'dsh-threads: selection, highlights and threads')
    }

    module.exports.name = '@rs-dsh/dsh-threads'
    module.exports.inject = ['conversation', 'inputTriggers', 'locale', 'sessions', 'slots', 'uiConversation']
    module.exports.apply = apply
    // Pure helpers, exported for tests only.
    module.exports._internals = {
      oneLine, cleanSelection, stripSpace, parseNodeKey, nodeKeyOf, locate,
      encodeRef, decodeRef, serializeThread, threadRule, makeInsert, stackChip,
    }
    return module.exports
  },
})
