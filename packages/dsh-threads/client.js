// @rs-dsh/dsh-threads: browser half (hand-written, no build step).
//
// Select text in a conversation and press "Comment": the comment is saved
// with the passage, the passage is highlighted, and the session's own model
// replies briefly in a small thread next to it. "Send to chat" puts a thread
// in the composer as a chip; at send it becomes a <comment-thread> block,
// which the sent bubble shows as a card.
//
// The Comment button sits in the one selection toolbar of @rs-dsh/dsh-core
// (service rsDshCore), and the comment box and the thread are core cards
// drawn with DSH's own components: InlineEditor, Button, MarkdownText for
// the replies, TextShimmer while one is on its way.
//
// Extension points (DSH 0.2.x), no DOM surgery on host-owned nodes:
//   rsDshCore                           toolbar, cards, DSH components, composer
//   host routes api/dsh-threads/*       threads, create, comment, retry, delete
//   CSS Custom Highlight API            highlights paint over host text without changing it
//   inputTriggers.registerSource        chip owner + codec (serialize at submit)
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
    const PLUGIN = 'dsh-threads'
    const API = 'api/dsh-threads/'
    const CONTEXT = 64
    const MAX_PASSAGE = 2000
    const HIGHLIGHT = 'dsh-threads'
    const HIGHLIGHT_OPEN = 'dsh-threads-open'

    // ------------------------------------------------------------ pure logic



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

    /** The chip for a thread; `oneLine` is the core's text flattener. */
    function makeInsert(thread, oneLine) {
      return {
        source: SOURCE,
        ref: encodeRef(thread),
        label: 'Thread “' + oneLine(thread.anchor.text, 40) + '” · ' + thread.messages.length,
        clipboardText: '> ' + oneLine(thread.anchor.text, 120),
      }
    }


    // DSH has no plain comment glyph; this is the bubble of its IconNewChatOutline
    // (dsh-client-ui-primitives) without the plus, at the same 16px view box.
    const BUBBLE_PATH = 'M2.37091 11.2501C1.58745 9.89288 1.32067 8.29835 1.61969 6.76006C1.91872 5.22177 2.76342 3.8433 3.99826 2.87846C5.2331 1.91362 6.77494 1.42737 8.33988 1.50925C9.90482 1.59113 11.3875 2.23562 12.5149 3.32406C13.6425 4.41269 14.3387 5.87206 14.4754 7.4334C14.612 8.99474 14.18 10.5529 13.2587 11.8209C12.3375 13.0888 10.9891 13.9813 9.46194 14.3337C8.18691 14.628 6.85895 14.5294 5.64989 14.0605C5.1712 13.8748 4.76962 13.4932 4.26534 13.3967C3.67413 13.2835 2.95257 13.5598 2.03794 14.3337'

    /** The bubble as an SVG element for the badge; aria-hidden, the badge carries the name. */
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
      commentLabel: 'Comment',
      replyLabel: 'Reply',
      newHint: 'Enter posts · Shift+Enter breaks line · Esc cancels',
      replyHint: 'Enter sends · Shift+Enter breaks line',
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
      network: 'The request failed',
      full: 'This thread is full. Start a new one, or send it to the chat.',
      reasoningCollapsed: 'Expand the reasoning to see the highlighted passage.',
      detached: 'The passage is not on the page now.',
      readOnly: 'Continue this session to reply or delete.',
      thread: 'Comment thread',
      messageCount: '{n} messages',
      unread: '{n} unread',
      copy: 'Copy',
      copied: 'Copied',
      code: 'Code',
      wrap: 'Wrap',
      unwrap: 'Unwrap',
      footnotes: 'Footnotes',
    }
    const zh = {
      comment: '评论',
      commentLabel: '评论',
      replyLabel: '回复',
      newHint: 'Enter 发布，Shift+Enter 换行，Esc 取消',
      replyHint: 'Enter 发送，Shift+Enter 换行',
      post: '发布',
      send: '发送',
      cancel: '取消',
      close: '关闭',
      you: '你',
      ai: 'AI',
      thinking: '思考中…',
      retry: '重试',
      toChat: '发送到对话',
      delete: '删除',
      deleteConfirm: '删除这条评论及其回复？',
      network: '请求失败',
      full: '此评论的回复已达上限。请新建评论，或发送到对话。',
      reasoningCollapsed: '展开思考过程以查看高亮内容。',
      detached: '所评论的内容当前未显示在页面上。',
      readOnly: '继续这个会话后才能回复或删除。',
      thread: '评论',
      messageCount: '{n} 条消息',
      unread: '{n} 条未读',
      copy: '复制',
      copied: '已复制',
      code: '代码',
      wrap: '自动换行',
      unwrap: '取消自动换行',
      footnotes: '脚注',
    }

    // Everything sits under [data-rs-dsh="dsh-threads"]: the cards, the badge
    // layer and the cards in sent messages. Controls are DSH's components.
    const STYLE = (scope) => `
::highlight(${HIGHLIGHT}){background-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 18%,transparent);text-decoration:underline;text-decoration-color:var(--dsw-alias-state-warn-primary);text-decoration-thickness:2px;text-underline-offset:3px}
::highlight(${HIGHLIGHT_OPEN}){background-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 36%,transparent);text-decoration:underline;text-decoration-color:var(--dsw-alias-state-warn-primary);text-decoration-thickness:2px;text-underline-offset:3px}
${scope} .th-passage{flex:none;margin:0 0 8px;padding:2px 8px;border-left:2px solid var(--dsw-alias-state-warn-primary);
  color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xs-13);white-space:pre-wrap;overflow-wrap:anywhere;
  display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden}
${scope} .th-note{flex:none;margin-bottom:6px;font-size:12px;line-height:16px;color:var(--dsw-alias-label-tertiary)}
${scope} .th-list{flex:auto;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:10px;margin-bottom:8px}
${scope} .th-msg{min-width:0;font:var(--dsw-font-xs-13);color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}
${scope} .th-msg[data-role="user"] .th-text{white-space:pre-wrap}
${scope} .th-msg [data-markdown-variant="compact"]{color:var(--dsw-alias-label-primary)}
${scope} .th-who{display:block;font-size:12px;line-height:16px;color:var(--dsw-alias-label-tertiary);margin-bottom:2px}
${scope} .th-thinking{font:var(--dsw-font-xs-13);color:var(--dsw-alias-label-tertiary)}
${scope} .th-error{flex:none;display:flex;align-items:center;gap:6px;flex-wrap:wrap;font:var(--dsw-font-xs-13);color:var(--dsw-alias-state-error-primary)}
${scope} .th-editor{flex:none;display:flex}
${scope} .th-hint{flex:none;margin-top:4px;font-size:12px;line-height:16px;color:var(--dsw-alias-label-tertiary)}
${scope} .th-actions{flex:none;display:flex;justify-content:flex-end;gap:6px;margin-top:8px}
${scope} .th-actions [data-danger]{margin-right:auto;padding:0 6px;color:var(--dsw-alias-label-tertiary)}
${scope} .th-actions [data-danger]:hover{color:var(--dsw-alias-state-error-primary)}
${scope}.th-layer{position:fixed;inset:0;z-index:1100;pointer-events:none;overflow:hidden}
${scope} .th-badge{position:fixed;pointer-events:auto;cursor:pointer;display:inline-flex;align-items:center;gap:3px;height:20px;padding:0 6px;
  border:0;border-radius:999px;font:500 11px/17px var(--dsw-font-family);
  color:var(--dsw-alias-state-warn-primary);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 14%,var(--dsw-alias-bg-base))}
${scope} .th-badge:hover{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 24%,var(--dsw-alias-bg-base))}
${scope} .th-badge[data-replying]{animation:th-pulse 1.2s ease-in-out infinite}
${scope} .th-badge[data-unread]{color:var(--dsw-alias-bg-base);background:var(--dsw-alias-state-warn-primary)}
${scope} .th-badge[data-unread]:hover{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 85%,var(--dsw-alias-label-primary))}
${scope} .th-unread{width:6px;height:6px;margin-left:1px;border-radius:50%;background:currentColor}
${scope} .th-badge[data-failed]{color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 14%,var(--dsw-alias-bg-base))}
@keyframes th-pulse{50%{opacity:.45}}
${scope}.th-card{display:block;margin:2px 0 6px;padding:3px 8px;border-left:2px solid var(--dsw-alias-state-warn-primary);
  border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-interactive-bg-hover);white-space:pre-wrap;text-align:left}
${scope}.th-card[data-interactive]{cursor:pointer}
${scope} .th-card-title{display:flex;align-items:center;gap:4px;font-size:12px;color:var(--dsw-alias-label-tertiary)}
${scope} .th-card-passage{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;color:var(--dsw-alias-label-secondary)}
${scope}.th-card[data-open] .th-card-passage{display:block}
${scope} .th-card-msg{display:block;margin-top:2px}
${scope} .th-card-msg b{font-weight:600}
`

    // ------------------------------------------------------------ plugin body

    function apply(ctx) {
      const core = ctx.rsDshCore
      const { React, jsx, jsxs, ui, oneLine } = core
      const scope = core.scope(PLUGIN)

      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-threads: dictionaries')
      const t = ctx.locale.bind(NS)
      const count = (n) => String(t('messageCount')).replace('{n}', String(n))
      ctx.effect(() => core.style(PLUGIN, STYLE(core.selector(PLUGIN))), 'dsh-threads: style')
      ctx.effect(() => core.composer.claimChipSource(SOURCE), 'dsh-threads: chip source order')
      const labels = () => ({
        code: { copyLabel: t('copy'), copiedLabel: t('copied'), toolbarLabels: { codeLabel: t('code'), wrapLabel: t('wrap'), unwrapLabel: t('unwrap') } },
        footnotes: t('footnotes'),
      })
      // DSH's speech bubble, the closest DSH icon to "comment".
      const Bubble = ({ size }) => jsx(ui.IconNewChatOutlineRegular, { size })

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
          jsxs('span', { className: 'th-card-title', children: [jsx(BubbleGlyph, {}, 'i'), t('thread') + ' · ' + count(messages.length)] }, 'h'),
          jsx('span', { className: 'th-card-passage', children: passage }, 'p'),
        ]
        if (isOpen) {
          messages.forEach((m, i) => children.push(jsxs('span', {
            className: 'th-card-msg',
            children: [jsx('b', { children: (m.role === 'user' ? t('you') : t('ai')) + ': ' }), m.text],
          }, 'm' + i)))
        }
        return jsxs('span', {
          ...scope,
          className: 'th-card',
          'data-open': isOpen || undefined,
          'data-interactive': interactive || undefined,
          onClick: interactive ? () => setOpen((v) => !v) : undefined,
          children,
        })
      }
      // The card's icon: the same bubble, plus-less, as the badge.
      function BubbleGlyph() {
        return jsx('svg', { width: 12, height: 12, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true', strokeWidth: 1.3, children: jsx('path', { d: BUBBLE_PATH, stroke: 'currentColor' }) })
      }
      ctx.slots.inject('conversation.user.text.node', () => ctx.slots.register({
        name: 'conversation.user.text.node',
        key: SOURCE,
        priority: 100,
      }, ThreadCard))

      function sendToChat(sessionId, thread) {
        return core.composer.insertChip(sessionId, makeInsert(thread, oneLine))
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
      // The open thread re-renders when the store or the highlights change.
      const listeners = new Set()
      function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) }
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

      // -------------------------------------------------- unread replies
      //
      // Per browser, in localStorage: how many messages of each thread were
      // on screen when it was last open. AI replies past that are unread. A
      // thread with no record counts replies after this browser first ran
      // the plugin, so threads from before don't all light up at once.

      const SEEN_KEY = 'dsh-threads:seen'
      const SINCE_KEY = 'dsh-threads:seen-since'
      function readStore(key, fallback) {
        try { const v = JSON.parse(window.localStorage.getItem(key)); return v ?? fallback } catch (_) { return fallback }
      }
      function writeStore(key, value) {
        try { window.localStorage.setItem(key, JSON.stringify(value)) } catch (_) { /* private mode, quota: unread stays in memory */ }
      }
      let seen = readStore(SEEN_KEY, {})
      if (seen === null || typeof seen !== 'object' || Array.isArray(seen)) seen = {}
      let since = readStore(SINCE_KEY, null)
      if (!Number.isFinite(since)) { since = Date.now(); writeStore(SINCE_KEY, since) }

      /** AI replies in a thread that were not on screen when it was last open. */
      function unreadCount(sessionId, thread) {
        const count = seen[sessionId + ' ' + thread.id]
        return thread.messages.filter((m, i) => m.role === 'ai' && (Number.isFinite(count) ? i >= count : m.time > since)).length
      }

      function markSeen(sessionId, thread) {
        const k = sessionId + ' ' + thread.id
        if (seen[k] === thread.messages.length) return
        seen = { ...seen, [k]: thread.messages.length }
        writeStore(SEEN_KEY, seen)
        placeBadges()
      }

      function forgetSeen(sessionId, threadId) {
        const k = sessionId + ' ' + threadId
        if (!(k in seen)) return
        const { [k]: _, ...rest } = seen
        seen = rest
        writeStore(SEEN_KEY, seen)
      }

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
      const NOT_REPLY = '[data-variant="think"],[data-tool],[data-variant="others"],[data-variant="bash"],button,[data-rs-dsh]'

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
              const skip = el.closest(kind === 'assistant' ? NOT_REPLY : 'button,[data-rs-dsh]')
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

      /**
       * The anchor for a selection the core reports (selectionContext()), or
       * null when the passage cannot take a comment: tool output, a collapsed
       * reasoning block, a message still being sent.
       */
      function anchorFor(selection) {
        if (selection === null) return null
        const { region, element: el, range, rect } = selection
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
        const text = selection.text
        if (text.length > MAX_PASSAGE) return null
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
        return { sessionId: selection.sessionId, anchor, rect }
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
        for (const fn of listeners) fn()
      }

      // One badge after each highlighted passage, in a layer of our own.
      const layer = document.createElement('div')
      layer.className = 'th-layer'
      layer.setAttribute('data-rs-dsh', PLUGIN)
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
            badge.className = 'th-badge'
            badge.addEventListener('click', (e) => { e.stopPropagation(); openThread(sessionId, threadId) })
            badges.set(k, badge)
            layer.append(badge)
          }
          const unread = unreadCount(sessionId, thread)
          const parts = [bubbleSvg(12), document.createTextNode(String(thread.messages.length))]
          if (unread > 0) {
            const dot = document.createElement('span')
            dot.className = 'th-unread'
            dot.setAttribute('aria-hidden', 'true')
            parts.push(dot)
          }
          badge.replaceChildren(...parts)
          const unreadText = unread > 0 ? ' · ' + String(t('unread')).replace('{n}', String(unread)) : ''
          badge.title = oneLine(thread.messages[0].text, 120) + unreadText
          badge.setAttribute('aria-label', t('thread') + ': ' + oneLine(thread.messages[0].text, 80) + unreadText)
          badge.toggleAttribute('data-unread', unread > 0)
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


      // -------------------------------------------------- the cards

      /** The box for a new comment on the selected passage. */
      function NewComment({ target, close }) {
        const [value, setValue] = React.useState('')
        const [busy, setBusy] = React.useState(false)
        const [error, setError] = React.useState(null)
        const submit = async () => {
          if (busy || value.trim() === '') return
          setBusy(true)
          setError(null)
          try {
            const thread = await call('create', { sessionId: target.sessionId, anchor: target.anchor, text: value })
            window.getSelection()?.removeAllRanges()
            putThread(target.sessionId, thread)
            openThread(target.sessionId, thread.id)
          } catch (e) {
            setError(e.message)
            setBusy(false)
          }
        }
        return jsxs('div', {
          ...scope,
          'data-mode': 'new',
          style: { display: 'contents' },
          children: [
            jsx('blockquote', { className: 'th-passage', children: oneLine(target.anchor.text, 280) }, 'p'),
            jsx('div', { className: 'th-editor', children: jsx(ui.InlineEditor, { value, label: t('commentLabel'), onChange: setValue, onSave: submit, onCancel: () => close('cancel') }) }, 'e'),
            jsx('div', { className: 'th-hint', children: t('newHint') }, 'h'),
            error !== null ? jsx('div', { className: 'th-error', role: 'alert', children: error }, 'x') : null,
            jsx('div', { className: 'th-actions', children: [
              jsx(ui.Button, { size: 'sm', variant: 'ghost', onClick: () => close('cancel'), children: t('cancel') }, 'c'),
              jsx(ui.Button, { size: 'sm', variant: 'primary', disabled: busy || value.trim() === '', onClick: submit, children: t('post') }, 's'),
            ] }, 'a'),
          ],
        })
      }

      function openNew(target) {
        core.popover.open({
          plugin: PLUGIN,
          anchor: () => target.rect,
          width: 360,
          prefer: 'above',
          label: t('comment'),
          render: (close) => jsx(NewComment, { target, close }),
        })
      }

      /** The open thread: passage, messages, reply box and actions. Follows the store. */
      function Thread({ sessionId, threadId, close }) {
        const thread = React.useSyncExternalStore(subscribe, () => threadOf(sessionId, threadId))
        const canWrite = React.useSyncExternalStore(subscribe, () => store.get(sessionId)?.canWrite !== false)
        const shown = React.useSyncExternalStore(subscribe, () => placed.has(sessionId + ' ' + threadId))
        const [value, setValue] = React.useState('')
        const [busy, setBusy] = React.useState(false)
        const [error, setError] = React.useState(null)
        const list = React.useRef(null)
        React.useEffect(() => { if (thread === undefined) close('gone') }, [thread === undefined])
        // What is on screen while the thread is open counts as read, replies arriving included.
        React.useEffect(() => { if (thread !== undefined) markSeen(sessionId, thread) }, [thread?.messages.length])
        React.useLayoutEffect(() => { if (list.current) list.current.scrollTop = list.current.scrollHeight }, [thread?.messages.length, thread?.replying, thread?.failure])
        if (thread === undefined) return null
        const submit = async () => {
          if (busy || value.trim() === '' || thread.replying) return
          setBusy(true)
          setError(null)
          try {
            putThread(sessionId, await call('comment', { sessionId, threadId, text: value }))
            setValue('')
          } catch (e) {
            setError(e.code === 'thread_full' ? t('full') : e.message)
          } finally {
            setBusy(false)
          }
        }
        const retry = async () => {
          try { putThread(sessionId, await call('retry', { sessionId, threadId })) } catch (e) { setError(e.message) }
        }
        const remove = async () => {
          if (!window.confirm(t('deleteConfirm'))) return
          try {
            await call('delete', { sessionId, threadId })
            close('deleted')
            dropThread(sessionId, threadId)
            forgetSeen(sessionId, threadId)
          } catch (e) {
            setError(e.message)
          }
        }
        const toChat = () => {
          const failure = sendToChat(sessionId, thread)
          if (failure !== null) setError(failure)
          else close('sent')
        }
        const notes = []
        if (!shown) notes.push(thread.anchor.kind === 'reasoning' ? t('reasoningCollapsed') : t('detached'))
        if (!canWrite) notes.push(t('readOnly'))
        const items = thread.messages.map((m) => jsxs('div', {
          className: 'th-msg',
          'data-role': m.role,
          children: [
            jsx('span', { className: 'th-who', children: m.role === 'user' ? t('you') : t('ai') + (m.model ? ' · ' + m.model : '') }),
            m.role === 'ai'
              ? jsx(ui.MarkdownText, { text: m.text, labels: labels(), variant: 'compact' })
              : jsx('span', { className: 'th-text', children: m.text }),
          ],
        }, m.id))
        if (thread.replying) items.push(jsx('div', { className: 'th-thinking', children: jsx(ui.TextShimmer, { children: t('thinking') }) }, 'wait'))
        else if (thread.failure !== undefined) {
          items.push(jsxs('div', { className: 'th-error', role: 'alert', children: [
            thread.failure,
            canWrite ? jsx(ui.Button, { size: 'sm', variant: 'outline', icon: jsx(ui.IconRefreshOutlineRegular, { size: 14 }), onClick: retry, children: t('retry') }) : null,
          ] }, 'fail'))
        }
        return jsxs('div', {
          ...scope,
          'data-mode': 'thread',
          style: { display: 'contents' },
          children: [
            jsx('blockquote', { className: 'th-passage', children: thread.anchor.text }, 'p'),
            notes.length > 0 ? jsx('div', { className: 'th-note', children: notes.join(' ') }, 'n') : null,
            jsx('div', { className: 'th-list', ref: list, children: items }, 'l'),
            canWrite ? jsx('div', { className: 'th-editor', children: jsx(ui.InlineEditor, { value, label: t('replyLabel'), onChange: setValue, onSave: submit, onCancel: () => close('cancel') }) }, 'e') : null,
            canWrite ? jsx('div', { className: 'th-hint', children: t('replyHint') }, 'h') : null,
            error !== null ? jsx('div', { className: 'th-error', role: 'alert', children: error }, 'x') : null,
            jsx('div', { className: 'th-actions', children: [
              canWrite ? jsx(ui.Button, { size: 'sm', variant: 'ghost', 'data-danger': '', 'aria-label': t('delete'), title: t('delete'), icon: jsx(ui.IconTrashOutlineRegular, { size: 16 }), onClick: remove }, 'd') : null,
              jsx(ui.Button, { size: 'sm', variant: 'outline', onClick: toChat, children: t('toChat') }, 'c'),
              canWrite ? jsx(ui.Button, { size: 'sm', variant: 'primary', disabled: busy || thread.replying === true || value.trim() === '', onClick: submit, children: t('send') }, 's')
                : jsx(ui.Button, { size: 'sm', variant: 'ghost', onClick: () => close('close'), children: t('close') }, 'x'),
            ] }, 'a'),
          ],
        })
      }

      function openThread(sessionId, threadId) {
        if (threadOf(sessionId, threadId) === undefined) return
        open = { sessionId, threadId }
        placeHighlights()
        const key = sessionId + ' ' + threadId
        const fallback = { left: window.innerWidth / 2 - 180, right: window.innerWidth / 2 + 180, top: 80, bottom: 80, width: 360, height: 0 }
        core.popover.open({
          plugin: PLUGIN,
          anchor: () => placed.get(key)?.getBoundingClientRect() ?? badges.get(key)?.getBoundingClientRect() ?? fallback,
          width: 380,
          label: t('thread'),
          onClose: () => {
            if (open !== null && open.sessionId === sessionId && open.threadId === threadId) { open = null; placeHighlights() }
          },
          render: (close) => jsx(Thread, { sessionId, threadId, close }),
        })
      }

      // -------------------------------------------------- wiring

      function changed() {
        placeHighlights()
        schedulePoll()
      }

      // The Comment button in the shared selection toolbar.
      ctx.effect(() => core.selection.register({
        plugin: PLUGIN,
        id: 'comment',
        order: 20,
        label: () => t('comment'),
        icon: jsx(Bubble, { size: 14 }),
        when: (selection) => anchorFor(selection) !== null,
        onSelect: (selection) => {
          const target = anchorFor(selection)
          if (target !== null) openNew(target)
        },
      }), 'dsh-threads: Comment button')

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
        // rs-dsh's own layers and cards changing is no reason to recompute.
        if (records.every((r) => (r.target instanceof Element ? r.target : r.target.parentElement)?.closest('[data-rs-dsh]') != null)) return
        mutTimer = setTimeout(() => { mutTimer = null; syncSessions(); placeHighlights() }, 250)
      })

      let frame = null
      const onScroll = () => {
        if (frame === null) frame = requestAnimationFrame(() => { frame = null; placeBadges() })
      }

      const onClick = (e) => {
        if (e.button !== 0 || core.popover.isOpen()) return
        const sel = window.getSelection()
        if (sel !== null && !sel.isCollapsed) return
        const target = e.target instanceof Element ? e.target : null
        if (target === null || target.closest('[data-conversation-region="chat"]') === null) return
        if (target.closest('a,button,input,textarea,[contenteditable="true"],[data-rs-dsh]') !== null) return
        const hit = threadAtPoint(e.clientX, e.clientY)
        if (hit !== null) openThread(hit.sessionId, hit.threadId)
      }

      const onFocus = () => { for (const id of visibleSessions()) load(id) }

      ctx.effect(() => {
        document.body.appendChild(layer)
        document.addEventListener('click', onClick)
        window.addEventListener('scroll', onScroll, true)
        window.addEventListener('resize', onScroll)
        window.addEventListener('focus', onFocus)
        observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['data-conversation-session', 'data-expanded'] })
        syncSessions()
        return () => {
          observer.disconnect()
          for (const timer of [mutTimer, pollTimer]) if (timer !== null) clearTimeout(timer)
          if (frame !== null) cancelAnimationFrame(frame)
          document.removeEventListener('click', onClick)
          window.removeEventListener('scroll', onScroll, true)
          window.removeEventListener('resize', onScroll)
          window.removeEventListener('focus', onFocus)
          if (highlights) { window.CSS.highlights.delete(HIGHLIGHT); window.CSS.highlights.delete(HIGHLIGHT_OPEN) }
          layer.remove()
        }
      }, 'dsh-threads: highlights, badges and threads')
    }

    module.exports.name = '@rs-dsh/dsh-threads'
    module.exports.inject = ['inputTriggers', 'locale', 'rsDshCore', 'slots', 'uiConversation']
    module.exports.apply = apply
    // Pure helpers, exported for tests only.
    module.exports._internals = {
      stripSpace, parseNodeKey, nodeKeyOf, locate,
      encodeRef, decodeRef, serializeThread, threadRule, makeInsert,
    }
    return module.exports
  },
})
