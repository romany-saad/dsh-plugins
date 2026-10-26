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

/** Write text with clipboard.writeText: 'copied', or 'failed' when there is no clipboard or it refuses. */
export async function copyText(text, clipboard) {
  try {
    if (!clipboard || typeof clipboard.writeText !== 'function') return 'failed'
    await clipboard.writeText(text)
    return 'copied'
  } catch {
    return 'failed'
  }
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
