// CommandBox: a command in monospace with a Copy button fixed at its top right.
// The command wraps at spaces first, then anywhere (white-space: pre-wrap with
// overflow-wrap: anywhere, in a minmax(0, 1fr) grid cell), so it never widens
// the panel. Import-free: client/build.mjs inlines it; React comes from the
// caller, so the copy state machine below is testable without a browser.

/** How long "Copied" (or "Copy failed") shows before the button reads Copy again. */
export const COPY_RESET_MS = 1500

/** The button's words in each state. */
export const COPY_LABEL = { idle: 'Copy', copied: 'Copied', failed: 'Copy failed' }

/**
 * The copy state machine: idle | copied | failed. 'copied' and 'failed' come
 * from the clipboard write; 'reset' (COPY_RESET_MS later) returns to idle.
 * Anything else keeps the state.
 */
export function copyStep(state, event) {
  if (event === 'copied' || event === 'failed') return event
  if (event === 'reset') return 'idle'
  return state
}

/**
 * Copy through a hidden, read-only text field and document.execCommand('copy'): the way a page
 * copies where the clipboard API is missing, as on a plain-HTTP address (the API needs HTTPS or
 * localhost). It must run from the click that asked for it. true when the browser copied.
 */
export function copyWithTextField(text, doc) {
  if (!doc || !doc.body || typeof doc.createElement !== 'function' || typeof doc.execCommand !== 'function') return false
  const field = doc.createElement('textarea')
  field.value = text
  field.setAttribute('readonly', '')
  field.setAttribute('aria-hidden', 'true')
  field.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;padding:0;border:0;opacity:0;pointer-events:none'
  const active = doc.activeElement
  doc.body.appendChild(field)
  try {
    field.focus({ preventScroll: true })
    field.select()
    field.setSelectionRange(0, text.length)
    return doc.execCommand('copy') === true
  } catch {
    return false
  } finally {
    field.remove()
    if (active && typeof active.focus === 'function') active.focus({ preventScroll: true })
  }
}

/**
 * Write text to the clipboard: 'copied', or 'failed'. clipboard.writeText first; where there is
 * none, or it refuses, the hidden text field (copyWithTextField), so copying also works over plain HTTP.
 */
export async function copyText(text, clipboard, doc = typeof document === 'undefined' ? undefined : document) {
  if (clipboard && typeof clipboard.writeText === 'function') {
    try {
      await clipboard.writeText(text)
      return 'copied'
    } catch {}
  }
  return copyWithTextField(String(text), doc) ? 'copied' : 'failed'
}

/** The copy icon: two overlapping rounded squares. */
export function copyIcon(h) {
  return h('svg', { width: 12, height: 12, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinejoin: 'round', 'aria-hidden': true },
    h('rect', { x: 5.5, y: 5.5, width: 8, height: 8, rx: 1.5 }), h('path', { d: 'M10.5 3.5H4a1.5 1.5 0 00-1.5 1.5v6' }))
}

/**
 * The hook and components, built on the caller's React.
 * useCopy(text) -> [state, copy]; copy(event) copies text and stops the click.
 * CopyButton({ text, label, words, icon }) is the button with its live region,
 * announcing Copied or Copy failed without moving focus; words is its idle text.
 * CommandBox({ command, label }) draws the box; label names the button for
 * screen readers ("Copy command for #886").
 */
export function makeCommandBox(React, { copyIcon: hostCopyIcon } = {}) {
  const h = React.createElement
  // The host's copy icon when the caller has one, else the drawn one.
  const drawIcon = () => (hostCopyIcon && hostCopyIcon()) || copyIcon(h)
  function useCopy(text) {
    const [state, setState] = React.useState('idle')
    const timer = React.useRef(undefined)
    React.useEffect(() => () => clearTimeout(timer.current), [])
    const copy = (e) => {
      if (e && e.stopPropagation) e.stopPropagation()
      const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined
      copyText(text, clipboard).then((result) => {
        setState((s) => copyStep(s, result))
        clearTimeout(timer.current)
        timer.current = setTimeout(() => setState((s) => copyStep(s, 'reset')), COPY_RESET_MS)
      })
    }
    return [state, copy]
  }
  function CopyButton({ text, label, words = COPY_LABEL.idle, icon = true }) {
    const [state, copy] = useCopy(text)
    return h('span', { className: 'dshc-copy' },
      h('button', { type: 'button', className: 'dshc-btn', 'aria-label': state === 'idle' ? label || 'Copy command' : COPY_LABEL[state], 'data-copy-state': state, onClick: copy },
        icon ? drawIcon() : null, state === 'idle' ? words : COPY_LABEL[state]),
      // Announce the result without moving focus.
      h('span', { role: 'status', className: 'dshc-sr' }, state === 'idle' ? '' : COPY_LABEL[state]))
  }
  function CommandBox({ command, label }) {
    return h('div', { className: 'dshc-cmd', 'data-command-box': '' },
      h('code', null, command),
      h(CopyButton, { text: command, label }))
  }
  return { CommandBox, CopyButton, useCopy }
}
