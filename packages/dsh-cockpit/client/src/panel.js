// dsh-cockpit's browser half (design section 6, C · Outline, refined, with
// the owner's changes): the read-only Board tab in the right sidebar, the
// progress strip above the chat input, and the chat cards of the four board
// tools. A plain CommonJS body: client/build.mjs wraps it in the module-loader
// factory and inlines lib/rows.js, lib/present.js and client/src/command-box.js,
// so the tab, the strip, the cards and the hub's tree text share their rules.
// Its shell require is react; the chat cards also take the host's tool row
// from ui-primitives when the shell has it (see cardPrimitives).
// Board text is rendered only as text (React escapes it); only http(s) URLs
// become links, in a new tab with rel="noopener noreferrer". Nothing here
// writes to the board or runs a command.
const React = require('react')
const { EMPTY_STATE, boardFlags, boardRows, boardSegments, driftState, driftWords, firstByItem, needsYou, problems, progressText, prText, refUrl, rowCells, shortRef, stripModel, stripText, stripTitle, titleParts } = require('../../lib/rows.js')
const { callTitle } = require('../../lib/present.js')
const { makeCommandBox, copyStep, copyText } = require('./command-box.js')
const { SEG_GAP, SEG_HEIGHT, SEG_MIN, SEG_RADIUS, fillWidth, halfFill, segmentRadius, segmentWidths, segmentsNeed, wholePx } = require('./segments.js')
const h = React.createElement

/**
 * The host's shared components and icons (ui-primitives: StateDot, the
 * Icon* set, DisclosureRow), so the tab, the strip and the cards look like
 * the rest of DSH. Required on first use; null when the shell has none, and
 * then every use falls back to a drawn equivalent.
 */
let primitivesCache
function primitives() {
  if (primitivesCache === undefined) {
    try { primitivesCache = require('@deepseek-ai/dsh-client-ui-primitives') || null } catch { primitivesCache = null }
  }
  return primitivesCache
}
const cardPrimitives = primitives
const { CommandBox, CopyButton } = makeCommandBox(React, { copyIcon: () => copyHostIcon() })

// The package name, which client/build.mjs defines from package.json.
const ID = __packageId
const KIND = 'dsh-cockpit-board'
const POLL_MS = 2000
// With no board bound, a failed answer or a 404 (route.enabled: false), the next poll waits longer.
const IDLE_MS = 10000
// Relative to the document, as dsh-client-ui-deliverables does, so a mounted app works.
const VIEW = 'api/dsh-cockpit/view'
// The board tools whose chat cards this bundle draws (tool.call.toolview keys).
const TOOLS = ['board_open', 'board_read', 'board_add', 'board_update']

// ---- Style: host tokens only (dsh-client-ui-theme), one stylesheet in the head ----
// The panel's own colour names, set per theme on its root. Where a host token
// misses the spec's contrast rule in the light theme (text 4.5:1, marks 3:1),
// the light value mixes it toward label-primary; the PR body has the table.
const TOKENS = [
  '[data-dsh-cockpit-board],[data-dsh-cockpit-dock],[data-dsh-cockpit-card]{',
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
  'body[data-ds-dark-theme] [data-dsh-cockpit-board],body[data-ds-dark-theme] [data-dsh-cockpit-dock],body[data-ds-dark-theme] [data-dsh-cockpit-card]{--dshc-t:var(--dsw-alias-label-tertiary);--dshc-warn:var(--dsw-alias-state-warn-label);',
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
  '.dshc-hd{padding:10px 12px;border-bottom:1px solid var(--dshc-border)}',
  '.dshc-hd1{display:flex;align-items:baseline;justify-content:space-between;gap:12px}',
  '.dshc-hdl{display:flex;align-items:baseline;gap:8px;min-width:0}',
  '.dshc-key{font-size:13px;font-weight:500;flex:none;max-width:60%}',
  '.dshc-parent{font-size:12px;color:var(--dshc-t)}',
  '.dshc-meta{font-size:12px;color:var(--dshc-t);white-space:nowrap;flex:none}',
  '.dshc-drift{font-size:12px;line-height:16px;color:var(--dshc-t);margin-top:2px}',
  '.dshc-sec{padding:8px 12px 10px;border-bottom:1px solid var(--dshc-border)}',
  // Section titles as the host's panels write them (the todo panel): 12-13 px, medium, sentence case.
  '.dshc-sech{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:500;line-height:18px;margin-bottom:6px}',
  '.dshc-warn{color:var(--dshc-warn)}.dshc-err{color:var(--dshc-err)}',
  // The card: title and Open link on one line; the ask and the command span the whole card.
  // The step id is in the title's tooltip, so no column is kept for it.
  '.dshc-ni{display:grid;grid-template-columns:minmax(0,1fr) auto;column-gap:8px;row-gap:4px;background:var(--dshc-l1);border:1px solid var(--dshc-border);border-radius:var(--dsw-radius-md,8px);padding:8px 10px}',
  '.dshc-ni+.dshc-ni{margin-top:6px}',
  '.dshc-nit{font-weight:500}',
  '.dshc-ask{grid-column:1/-1;font-size:12px;line-height:16px;color:var(--dshc-s);overflow-wrap:anywhere}',
  '.dshc-ni .dshc-cmd{grid-column:1/-1;margin-top:2px}',
  '.dshc-open{display:inline-flex;align-items:center;gap:4px;font-size:12px;color:var(--dshc-s);white-space:nowrap}',
  '.dshc-cmd{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:start;background:var(--dshc-l2);border:1px solid var(--dshc-border);border-radius:6px;padding:4px 4px 4px 10px;margin-top:4px;position:relative}',
  '.dshc-cmd code{font-family:' + MONO + ';font-size:12px;line-height:18px;padding:3px 0;color:var(--dshc-p);white-space:pre-wrap;overflow-wrap:anywhere;min-width:0}',
  // The host's small outline button (ui-primitives Button, variant outline, size sm), 24 px tall in a box.
  '.dshc-btn{display:inline-flex;align-items:center;gap:4px;height:24px;padding:0 8px;border-radius:var(--dsw-radius-sm,6px);border:.5px solid var(--dsw-alias-border-l3,var(--dshc-border));background:transparent;color:var(--dshc-p);font:inherit;font-size:12px;font-weight:500;line-height:1;cursor:pointer;white-space:nowrap;flex:none}',
  '.dshc-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}',
  '.dshc-btn[data-copy-state=failed]{color:var(--dshc-err)}',
  '.dshc-prob{display:grid;grid-template-columns:16px minmax(0,1fr) 20px;column-gap:8px;align-items:start;width:100%;min-height:28px;padding:4px 0;border:0;background:none;font:inherit;font-size:12px;line-height:18px;color:var(--dshc-p);text-align:left;cursor:pointer}',
  '.dshc-prob .dshc-ic{color:var(--dshc-err);display:flex;padding-top:2px}.dshc-prob .dshc-go{color:var(--dshc-t);display:flex;justify-content:center;padding-top:2px}',
  // The whole board's progress, inside the header: the count on the key's line, the bar under it.
  '.dshc-overall{margin-top:8px}',
  '.dshc-overall-title{display:flex;align-items:baseline;justify-content:space-between;gap:8px;font-size:12px;line-height:16px;color:var(--dshc-s)}',
  '.dshc-overall-title strong{font-weight:500;color:var(--dshc-p)}',
  // The sections line up with the header's text and the Needs you cards (12 px in).
  '.dshc-groups{padding:8px 12px 12px;display:flex;flex-direction:column;gap:8px}',
  '.dshc-group{border:.5px solid var(--dsw-alias-border-l3,var(--dshc-border));border-radius:var(--dsw-radius-md,8px);overflow:hidden}',
  '.dshc-group-title{margin:0;padding:6px 10px;background:var(--dshc-l1);font-size:12px;font-weight:500;line-height:18px;color:var(--dshc-s);border-bottom:1px solid var(--dshc-border)}',
  '.dshc-group .dshc-li:last-child{border-bottom:0}',
  '.dshc-tree{margin:0;padding:0;list-style:none}',
  '.dshc-li{list-style:none;border-bottom:1px solid var(--dshc-border)}',
  '.dshc-li:focus{outline:2px solid var(--dshc-info);outline-offset:-2px}',
  // A task row: the status mark (16 px), the title, the PR, the chevron. The
  // status word and the step id are in the mark's and the title's tooltips,
  // as in the host's todo list, and in the expanded detail.
  '.dshc-row{display:grid;grid-template-columns:16px minmax(0,1fr) auto 20px;column-gap:8px;row-gap:2px;align-items:start;padding:6px 8px 6px 10px}',
  '.dshc-row>*{min-height:20px}',
  // A parent row is its section's header: the title and the count on one line, the bar under them at full width.
  '.dshc-li.dshc-parentrow{background:var(--dshc-l1)}',
  // The chevron column (and its gap) only takes room when the parent has details to open,
  // so the count ends where the bar does.
  '.dshc-parentrow .dshc-row{grid-template-columns:minmax(0,1fr) auto;padding:6px 10px}',
  '.dshc-parentrow .dshc-row[data-expandable]{grid-template-columns:minmax(0,1fr) auto 20px;padding-right:8px}',
  '.dshc-parentrow .dshc-ct{font-weight:500}',
  '.dshc-parentrow .dshc-cmeta,.dshc-parentrow .dshc-detail{grid-column:1/-1}',
  '.dshc-hdcount{font-size:12px;color:var(--dshc-s);white-space:nowrap;text-align:right}',
  '.dshc-cst{display:flex;align-items:center;justify-content:center;height:20px}',
  '.dshc-check{color:var(--dshc-ok-mark);flex:none}',
  '.dshc-mark{display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;flex:none}',
  '.dshc-dot{width:8px;height:8px;border-radius:50%}',
  '.dshc-dot-now{background:var(--dshc-info)}.dshc-dot-waiting{background:var(--dshc-mark)}',
  '.dshc-ring{width:8px;height:8px;border-radius:50%;border:1.5px solid var(--dshc-s)}',
  '.dshc-dash{width:8px;height:0;border-top:1.5px solid var(--dshc-mark)}',
  '.dshc-ct{display:flex;align-items:flex-start;min-width:0}',
  '.dshc-indent{flex:none}',
  '.dshc-elbow{flex:none;width:8px;height:8px;border-left:1px solid var(--dshc-mark);border-bottom:1px solid var(--dshc-mark);margin:4px 6px 0 2px}',
  '.dshc-closed .dshc-ct{color:var(--dshc-s)}',
  '.dshc-dropped .dshc-tt{text-decoration:line-through}',
  '.dshc-cpr{font-size:12px;color:var(--dshc-s);text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:80px}',
  '.dshc-chev{display:flex;align-items:center;justify-content:center;height:20px;padding:0;border:0;background:none;color:var(--dshc-t);cursor:pointer}',
  '.dshc-chevic{display:inline-flex}.dshc-chevic[data-open]{transform:rotate(90deg)}',
  '.dshc-cmeta{grid-column:2/4;display:flex;flex-direction:column;gap:2px;font-size:12px;line-height:16px;color:var(--dshc-s);min-height:0}',
  '.dshc-block{display:flex;align-items:flex-start;gap:6px;color:var(--dshc-p)}.dshc-block svg{flex:none;margin-top:2px}.dshc-block b{font-weight:500}.dshc-block .dshc-st{color:var(--dshc-t)}',
  '.dshc-mprob{display:flex;align-items:flex-start;gap:6px;color:var(--dshc-err)}.dshc-mprob svg{flex:none;margin-top:2px}',
  // Tags as the host's Tag draws them: a pill with a tinted fill; the text colours keep the 4.5:1 mixes.
  '.dshc-tag{align-self:flex-start;display:inline-flex;align-items:center;border-radius:999px;padding:1px 8px;font-size:11px;font-weight:500;line-height:16px;white-space:nowrap}',
  '.dshc-tag-warn{color:var(--dshc-warn);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 12%,transparent)}',
  '.dshc-tag-ok{color:var(--dshc-ok);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 10%,transparent)}',
  '.dshc-tag-quiet{color:var(--dshc-s);background:var(--dshc-l2)}',
  '.dshc-detail{grid-column:2/-1;margin-top:6px;padding-top:8px;border-top:1px dashed var(--dshc-border);min-height:0}',
  '.dshc-detail dl{display:grid;grid-template-columns:80px minmax(0,1fr);column-gap:8px;row-gap:4px;margin:0 0 4px;font-size:12px;line-height:16px}',
  '.dshc-detail dt{color:var(--dshc-t)}.dshc-detail dd{margin:0;color:var(--dshc-s);overflow-wrap:anywhere}.dshc-detail dd.dshc-mono{color:var(--dshc-p)}',
  '.dshc-pp{color:var(--dshc-s);font-weight:400}',
  '.dshc-need{color:var(--dshc-warn);font-weight:500}',
  // The segmented bar: segments by shape, never moving, in whole pixels only.
  // The box is measured (useWholeWidth); the bar inside it is the box's width
  // rounded down, and each segment's width comes from segmentWidths. Only the
  // first segment's left end and the last one's right end are round (inline
  // border-radius from segmentRadius).
  '.dshc-barbox{display:block;width:100%;height:' + SEG_HEIGHT + 'px;margin:4px 0 2px}',
  '.dshc-bar{display:flex;gap:' + SEG_GAP + 'px;height:' + SEG_HEIGHT + 'px}',
  '.dshc-seg{flex:none;min-width:' + SEG_MIN + 'px;height:' + SEG_HEIGHT + 'px;border-radius:0;cursor:pointer;--dshc-half:50%}',
  // Before the first measure only (layout effect, so never painted): share the width.
  '.dshc-bar:not([data-px]) .dshc-seg{flex:1 1 0}',
  '.dshc-seg[data-segment=done]{background:var(--dshc-ok-mark)}',
  '.dshc-seg[data-segment=now]{background:linear-gradient(to right,var(--dshc-info) var(--dshc-half),transparent var(--dshc-half));box-shadow:inset 0 0 0 1px var(--dshc-info)}',
  '.dshc-seg[data-segment=waiting]{background:var(--dshc-mark)}',
  '.dshc-seg[data-segment="needs you"]{background:var(--dshc-warn-mark);box-shadow:inset 0 0 0 1px var(--dshc-warn)}',
  '.dshc-seg[data-segment=ready]{box-shadow:inset 0 0 0 1px var(--dshc-ok-mark)}',
  '.dshc-seg[data-segment=blocked]{border:1px dashed var(--dshc-mark)}',
  // A 1 px line at a whole pixel (3 px down of 8), not center, which falls on 3.5 px.
  '.dshc-seg[data-segment=dropped]{background:linear-gradient(var(--dshc-mark),var(--dshc-mark)) 0 ' + (SEG_HEIGHT / 2 - 1) + 'px/100% 1px no-repeat}',
  // The continuous bar: the same height and round ends.
  '.dshc-fill{display:block;height:' + SEG_HEIGHT + 'px;border-radius:' + SEG_RADIUS + 'px;overflow:hidden;background:var(--dshc-border)}.dshc-fill>span{display:block;height:100%;background:var(--dshc-ok-mark)}',
  '.dshc-empty{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:0 40px;gap:6px}',
  '.dshc-empty p{margin:0}.dshc-empty-t{font-weight:500}.dshc-empty-s{font-size:12px;line-height:16px;color:var(--dshc-s);max-width:280px}',
  '.dshc-msg{padding:12px;color:var(--dshc-s);overflow-wrap:anywhere}',
  // The progress strip: one 28 px line, sized like the composer's other docks (the goal strip).
  '[data-dsh-cockpit-dock]{box-sizing:border-box;margin:0 auto;width:calc(100% - 2 * var(--dsh-composer-side-clearance,0px) - 4 * var(--dsh-composer-dock-inset,0px))}',
  '[data-dsh-cockpit-dock] *{box-sizing:border-box}',
  '.dshc-stripbox{container-type:inline-size;container-name:dshc-strip}',
  '.dshc-strip{width:100%;max-width:calc(var(--dsh-composer-card-max-width,100%) - 4 * var(--dsh-composer-dock-inset,0px));margin:0 auto;height:28px;padding:0 4px 0 10px;display:flex;align-items:center;gap:5px;overflow:hidden;font-size:12px;line-height:16px;white-space:nowrap;color:var(--dshc-s);font-variant-numeric:tabular-nums;border-radius:var(--dsw-radius-sm,8px);background:var(--dshc-l0);border:1px solid var(--dshc-border);cursor:pointer}',
  // The space, in order of priority: the needs-you action or the focus, the count,
  // the segments, the key. The key drops below 600 px of strip. Below 460 px the
  // segments become the 32 px continuous fill and the count drops "· 1 dropped";
  // a needs-you strip drops the bar there. Below 380 px no bar shows. The focus
  // takes the rest and ellipsizes only at its end. Count, Copy command and
  // Board › never shrink. The strip's tooltip has the full text. A bar squeezed
  // below its segments' 10 px each is the continuous fill (Bar).
  '.dshc-strip .dshc-barbox{flex:0 1000 auto;min-width:32px;margin:0}',
  '.dshc-strip .dshc-alt{flex:0 1000 72px;display:none}',
  '@container dshc-strip (max-width:460px){.dshc-strip .dshc-barbox[data-alt],.dshc-strip .dshc-more,.dshc-strip[data-kind="needs you"] .dshc-barbox{display:none}.dshc-strip .dshc-alt{display:block}}',
  '.dshc-strip .dshc-key{color:var(--dshc-t);font-size:12px;font-weight:400;flex:0 0 auto;max-width:120px}',
  '@container dshc-strip (max-width:600px){.dshc-strip .dshc-key,.dshc-strip .dshc-key+.dshc-sep{display:none}}',
  '@container dshc-strip (max-width:380px){.dshc-strip .dshc-barbox{display:none}}',
  '.dshc-strip .dshc-sep{color:var(--dshc-t);flex:none}',
  '.dshc-strip .dshc-done,.dshc-strip .dshc-go,.dshc-strip .dshc-copy,.dshc-strip .dshc-ic{flex:none}',
  '.dshc-strip .dshc-done{color:var(--dshc-p)}',
  '.dshc-strip .dshc-focus{flex:1 1 auto;min-width:0}',
  '.dshc-strip .dshc-ic{color:var(--dshc-warn);display:inline-flex}',
  '.dshc-strip .dshc-btn{height:22px;padding:0 6px}',
  '.dshc-strip .dshc-go{height:22px;padding:0 4px;border:0;border-radius:4px;background:none;font:inherit;font-size:12px;font-weight:500;color:var(--dshc-s);cursor:pointer}',
  '.dshc-strip .dshc-go:hover,.dshc-strip .dshc-btn:hover{color:var(--dshc-p)}',
  // The chat cards: the host's tool row, with the result's tree text below it.
  '.dshc-card-sum{margin-left:8px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--dsh-content-font-size-secondary,13px);color:var(--dsw-alias-label-secondary)}',
  // The cards use the tab's colour names (TOKENS), so error and stopped text meet
  // 4.5:1 in light too: state-warn-label alone is 2.8:1 on white.
  '.dshc-card-sum[data-state=error]{color:var(--dshc-err)}.dshc-card-sum[data-state=stopped]{color:var(--dshc-warn)}',
  '.dshc-card-out{margin:4px 0 4px 4px;max-height:260px;overflow:auto;white-space:pre;font-family:' + MONO + ';font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}',
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

// ---- Icons: the host's own (ui-primitives) when the shell has them, else a drawn fallback ----
const svg = (size, children, extra) => h('svg', { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, ...extra }, children)
/** The host icon `name` at size, else fallback(). extra goes on a wrapper only when given (the host icons take size and className). */
function hostIcon(name, size, fallback, className) {
  const Icon = primitives()?.[name]
  return typeof Icon === 'function' ? h(Icon, { size, className }) : fallback()
}
const warnIcon = (size = 12) => hostIcon('IconWarningTriangleOutlineRegular', size, () => svg(size, [h('path', { key: 1, d: 'M8 2.5l6 10.5H2z' }), h('path', { key: 2, d: 'M8 6.5v3' }), h('path', { key: 3, d: 'M8 11.6v.1' })]))
const checkIcon = () => svg(14, h('path', { d: 'M3.5 8.5l3 3 6-7' }), { strokeWidth: 1.8, className: 'dshc-check' })
// The host has no lock icon; this one is drawn on its 16 px grid and stroke.
const lockIcon = () => svg(12, [h('rect', { key: 1, x: 3.5, y: 7, width: 9, height: 6.5, rx: 1.5 }), h('path', { key: 2, d: 'M5.5 7V5a2.5 2.5 0 015 0v2' })])
const extIcon = () => hostIcon('IconRightUpOutlineRegular', 12, () => svg(12, [h('path', { key: 1, d: 'M9 3.5h3.5V7' }), h('path', { key: 2, d: 'M12.5 3.5L7 9' }), h('path', { key: 3, d: 'M11 9.5v2.5a1 1 0 01-1 1H4.5a1 1 0 01-1-1V6.5a1 1 0 011-1H7' })], { strokeWidth: 1.5 }))
const downIcon = () => hostIcon('IconChevronDownOutlineRegular', 14, () => svg(14, [h('path', { key: 1, d: 'M8 3.5v9' }), h('path', { key: 2, d: 'M4.5 9L8 12.5 11.5 9' })], { strokeWidth: 1.5 }))
const chevIcon = (open) => h('span', { className: 'dshc-chevic', 'data-open': open || undefined, 'aria-hidden': true },
  hostIcon('IconChevronRightOutlineRegular', 14, () => svg(14, h('path', { d: 'M6 4l4 4-4 4' }))))
const copyHostIcon = () => { const Icon = primitives()?.IconCopyOutlineRegular; return typeof Icon === 'function' ? h(Icon, { size: 12 }) : null }

/** An http(s) URL, or undefined: nothing else ever becomes an href. */
const safeUrl = (url) => (typeof url === 'string' && /^https?:\/\/\S+$/i.test(url) ? url : undefined)
const stop = (e) => e.stopPropagation()
/** A link that opens in a new tab, or the plain text without a safe URL. */
function Link({ url, title, className, children }) {
  const href = safeUrl(url)
  if (!href) return h('span', { className, title }, children)
  return h('a', { href, target: '_blank', rel: 'noopener noreferrer', title, className, onClick: stop }, children)
}

// ---- The view: polled every 2 s, one poller per session ----
// The tab and the strip share one poller per session, which runs while either
// is mounted. One request at a time: the next poll starts POLL_MS after the
// last answer, so an older answer never overwrites a newer one. The state is
// kept per session, so another session's board never shows while its first
// poll runs.
const pollers = new Map()

function poller(sessionId) {
  let p = pollers.get(sessionId)
  if (p) return p
  p = { state: { loading: true }, subs: new Set(), timer: undefined, controller: undefined, stopped: false }
  const load = async () => {
    // A hidden page does not poll; it loads again when shown.
    if (typeof document !== 'undefined' && document.hidden) { p.waiting = true; return }
    const controller = (p.controller = new AbortController())
    let next
    try {
      const res = await fetch(VIEW + '?sessionId=' + encodeURIComponent(sessionId), { signal: controller.signal, cache: 'no-store' })
      const body = res.headers.get('content-type')?.includes('json') ? await res.json() : { error: await res.text() }
      // A failed answer keeps the last view, so a blip neither hides the strip nor blanks the tab.
      next = res.ok ? { view: body } : { view: p.state.view, error: body.error || 'HTTP ' + res.status }
    } catch (error) {
      if (p.stopped || error.name === 'AbortError') return
      next = { view: p.state.view, error: String(error.message || error) }
    }
    if (p.stopped) return
    p.state = next
    for (const fn of p.subs) fn(next)
    p.timer = setTimeout(load, next.error || !next.view?.key ? IDLE_MS : POLL_MS)
  }
  const onShow = () => { if (p.waiting && !document.hidden) { p.waiting = false; clearTimeout(p.timer); load() } }
  p.start = () => { if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onShow); load() }
  p.stop = () => {
    p.stopped = true; clearTimeout(p.timer); if (p.controller) p.controller.abort()
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onShow)
    if (pollers.get(sessionId) === p) pollers.delete(sessionId)
  }
  pollers.set(sessionId, p)
  return p
}

function useView(sessionId) {
  const [state, setState] = React.useState(() => ({ sessionId, ...(pollers.get(sessionId)?.state ?? { loading: true }) }))
  React.useEffect(() => {
    const p = poller(sessionId)
    const fn = (next) => setState({ sessionId, ...next })
    p.subs.add(fn)
    if (p.subs.size === 1) p.start()
    else fn(p.state)
    return () => { p.subs.delete(fn); if (!p.subs.size) p.stop() }
  }, [sessionId])
  return state.sessionId === sessionId ? state : { loading: true }
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
/**
 * "15:22 · 2 min ago". now is the minute clock, so a board changed since its
 * last tick (up to a minute "ahead") is "just now"; only a time more than a
 * minute ahead, such as another machine's clock, is "in the future".
 */
function whenText(iso, now = Date.now()) {
  const at = new Date(iso)
  if (!iso || Number.isNaN(at.getTime())) return iso ? String(iso) : ''
  const s = Math.round((now - at.getTime()) / 1000)
  const ago = s < -60 ? 'in the future' : s < 60 ? 'just now' : s < 3600 ? Math.floor(s / 60) + ' min ago'
    : s < 86400 ? Math.floor(s / 3600) + ' h ago' : Math.floor(s / 86400) + ' d ago'
  return clockText(iso, now) + ' · ' + ago
}

/** The header's right side: "rev 33 · 15:34 · 9 min ago". */
// A fallback hub's file may have no revision or updatedAt: each is shown only when present.
const headerMeta = (board, now) => [Number.isInteger(board.revision) ? 'rev ' + board.revision : '', typeof board.updatedAt === 'string' ? whenText(board.updatedAt, now) : ''].filter(Boolean).join(' · ')

/** "Drift: 1 differs · 16:40", "Drift: matches · 16:40", "Drift: not run yet". */
function driftLine(state, now) {
  const at = state.at ? ' · ' + clockText(state.at, now) : ''
  return 'Drift: ' + driftWords(state) + at
}

/** The drift line shows when a drift command is configured or the file holds a result. */
const showDrift = (view) => Boolean(view.driftConfigured || view.board?.drift)

// ---- Rows: expand state kept by board and item across refreshes and remounts ----
const expanded = new Map()

/** The Board body an event happened in, so a row is looked up in that board only. */
const boardOf = (e) => (e && e.currentTarget && typeof e.currentTarget.closest === 'function' ? e.currentTarget.closest('[data-dsh-cockpit-board]') : null)

/** Move focus to a row of this board (root), centred, without animation. */
function showRow(item, root) {
  const el = root && typeof root.querySelector === 'function' && root.querySelector('li[data-item="' + String(item).replace(/["\\]/g, '\\$&') + '"]')
  if (!el) return
  el.scrollIntoView({ block: 'center' })
  el.focus({ preventScroll: true })
}

/** The header: key, parent and time, the drift line, then the whole board's count and bar (the strip's), in one block. */
function Header({ board, view, rows, now, overall }) {
  const drift = driftState(board.drift, rows)
  return h('header', { className: 'dshc-hd' },
    h('div', { className: 'dshc-hd1' },
      h('span', { className: 'dshc-hdl' },
        h('span', { className: 'dshc-mono dshc-key dshc-trunc', title: board.key }, board.key),
        board.parent ? h('span', { className: 'dshc-parent dshc-trunc', title: board.parent }, board.parent) : null),
      h('span', { className: 'dshc-meta' }, headerMeta(board, now))),
    showDrift(view) ? h('div', { className: 'dshc-drift', 'data-drift': drift.kind, title: drift.error }, driftLine(drift, now)) : null,
    overall && overall.total
      ? h('section', { className: 'dshc-overall', 'aria-label': 'Whole board' },
        h('div', { className: 'dshc-overall-title' }, h('strong', null, 'Whole board'), h('span', null, progressText(overall))),
        h(Bar, { bar: overall }))
      : null)
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
        h(Title, { task: byItem.get(t.item), parent: board.parent, url: r && r.issueUrl, className: 'dshc-wrap dshc-nit', plainTitle: 'Step ' + t.item }),
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
    list.map((p, i) => h('button', { key: i, type: 'button', className: 'dshc-prob', 'data-item': p.item, onClick: (e) => showRow(p.item, boardOf(e)) },
      h('span', { className: 'dshc-ic' }, warnIcon(14)),
      h('span', { className: 'dshc-wrap' }, p.text),
      h('span', { className: 'dshc-go', 'aria-label': 'Go to row', role: 'img' }, downIcon()))))
}

/** The host StateDot state for a mark: done a filled step with its check, waiting an idle dot. */
const DOT_STATE = { check: 'done', 'dot-waiting': 'idle' }
const DOT_APPEARANCE = { check: 'step' }

/**
 * The status mark: the host's StateDot (as the todo list draws its items)
 * for done and waiting. now stays a still info dot: the host's ongoing
 * state is a spinner, and nothing on the board moves. next (a ring) and
 * dropped (a dash) have no StateDot of their own and stay drawn. Without the
 * host, all are drawn.
 */
function Mark({ mark }) {
  const StateDot = primitives()?.StateDot
  if (typeof StateDot === 'function' && DOT_STATE[mark]) return h(StateDot, { state: DOT_STATE[mark], appearance: DOT_APPEARANCE[mark], size: 12 })
  if (mark === 'check') return checkIcon()
  const cls = mark === 'ring' ? 'dshc-ring' : mark === 'dash' ? 'dshc-dash' : 'dshc-dot dshc-' + mark
  return h('span', { className: 'dshc-mark', 'aria-hidden': true }, h('span', { className: cls }))
}

const tag = (key, cls, words, title) => h('span', { key, className: 'dshc-tag ' + cls, title }, words)

const useLayout = (fn, deps) => (React.useLayoutEffect || React.useEffect)(fn, deps)

/** A ref and its element's width in whole pixels (rounded down), kept by a ResizeObserver; 0 until measured. */
function useWholeWidth() {
  const ref = React.useRef(null)
  const [width, setWidth] = React.useState(0)
  useLayout(() => {
    const el = ref.current
    if (!el || typeof el.getBoundingClientRect !== 'function') return
    const read = () => setWidth(wholePx(el.getBoundingClientRect().width))
    read()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(read)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return [ref, width]
}

/**
 * The segmented bar, one segment per counted task, by shape: its box is
 * measured, the bar is the box's whole-pixel width, and segmentWidths splits
 * it. Above 24 tasks (bar.continuous), or when the segments do not fit at
 * 10 px each, or with fill, it is one continuous fill. The parent row draws it
 * full width; the strip at its widest width, shrinking. hasAlt marks the
 * strip's main bar that the narrow strip swaps for its alt fill. A segment's
 * click goes to onSegment(item), else focuses its row.
 */
function Bar({ bar, onSegment = (item, e) => showRow(item, boardOf(e)), width, fill, hasAlt, className }) {
  const [ref, px] = useWholeWidth()
  const n = bar.segments.length
  const widths = px ? segmentWidths(px, n) : undefined
  const box = (child) => h('span', { ref, className: 'dshc-barbox' + (className ? ' ' + className : ''), style: width ? { width } : undefined, 'data-alt': hasAlt ? '' : undefined }, child)
  if (fill || bar.continuous || (px && !widths)) return box(h(Fill, { bar, px }))
  const aria = { role: 'img', 'aria-label': progressText({ done: bar.done, dropped: bar.dropped, total: bar.total }) + ' (work tasks)' }
  return box(h('span', { ...aria, className: 'dshc-bar', 'data-px': widths ? '' : undefined, style: widths ? { width: px } : undefined },
    bar.segments.map((g, i) => h('span', {
      key: g.item, className: 'dshc-seg', 'data-segment': g.kind, 'data-item': g.item, title: g.tooltip,
      style: widths ? { width: widths[i], borderRadius: segmentRadius(i, n), '--dshc-half': halfFill(widths[i]) + 'px' } : { borderRadius: segmentRadius(i, n) },
      onClick: (e) => { e.stopPropagation(); onSegment(g.item, e) },
    }))))
}

/** "2 of 2 done · 1 needs you": a parent's count, on its title line. */
function Count({ progress }) {
  return h('span', { className: 'dshc-hdcount dshc-pp' }, progressText({ ...progress, needsYou: 0 }),
    progress.needsYou ? [' · ', h('span', { key: 'n', className: 'dshc-need' }, progress.needsYou + ' needs you')] : null)
}

function Meta({ c, bar, parent }) {
  const lines = []
  // A root parent's bar; its count is on its title line (TaskRow).
  if (bar) lines.push(h(Bar, { key: 'bar', bar }))
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
  // The step id and the status word, which have no column: in the title's and the mark's tooltips.
  const tip = (c.wrap ? '' : row.title + ' · ') + 'step ' + row.item
  return h('li', { 'data-item': row.item, 'data-status': row.status, tabIndex: -1, className: cls },
    h('div', { className: 'dshc-row', 'data-expandable': c.expandable ? '' : undefined, onClick: c.expandable ? (e) => { if (!e.target.closest || !e.target.closest('a,button,[data-segment],[data-detail]')) toggle() } : undefined, style: c.expandable ? { cursor: 'pointer' } : undefined },
      c.parent ? null : h('span', { className: 'dshc-cst', role: 'img', 'aria-label': c.status, title: c.status }, c.mark ? h(Mark, { mark: c.mark }) : null),
      h('span', { className: 'dshc-ct' },
        c.indent ? h('span', { className: 'dshc-indent', style: { width: c.indent * 16 } }) : null,
        c.elbow ? h('span', { className: 'dshc-elbow', 'aria-hidden': true }) : null,
        h(Title, { task, parent, url: row.issueUrl, className: c.wrap ? 'dshc-wrap' : 'dshc-trunc', plainTitle: tip })),
      c.parent ? h(Count, { progress: c.progress }) : h('span', { className: 'dshc-cpr' }, c.pr ? h(Link, { url: c.prUrl, title: row.pr }, c.pr) : null),
      c.expandable
        ? h('button', { type: 'button', className: 'dshc-chev', 'aria-expanded': isOpen, 'aria-label': 'Details for ' + row.title, onClick: (e) => { e.stopPropagation(); toggle() } }, chevIcon(isOpen))
        // A task row keeps its chevron column; a parent row gives the room to its count.
        : c.parent ? null : h('span', null),
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
  // The first task of an item, as the rows draw it, should a hand-edited file repeat one.
  const byItem = firstByItem(board)
  // The route's flags and problems, drawn by the same rules as the hub's text; computed here only without them.
  const flags = Array.isArray(view.flags) ? view.flags : boardFlags(tasks)
  const list = Array.isArray(view.problems) ? view.problems : problems(tasks, flags)
  const flagsOf = new Map()
  for (const f of flags) { if (!flagsOf.has(f.item)) flagsOf.set(f.item, []); flagsOf.get(f.item).push(f) }
  const overall = boardSegments(board, rows, undefined)
  const groups = []
  const standalone = []
  let group
  for (const row of rows) {
    if (row.depth === 0) {
      group = row.progress ? { item: row.item, title: row.title, rows: [] } : undefined
      if (group) groups.push(group)
    }
    if (group) group.rows.push(row)
    else standalone.push(row)
  }
  if (standalone.length) groups.push({ item: 'standalone', title: 'Standalone tasks', rows: standalone, standalone: true })
  return h('div', null,
    h(Header, { board, view, rows, now, overall }),
    h(NeedsYou, { board, rows, byItem }),
    h(Problems, { list }),
    rows.length
      ? h('div', { className: 'dshc-groups' }, groups.map((g) => h('section', {
        key: (g.standalone ? 'standalone' : 'parent:') + g.item,
        className: 'dshc-group', 'data-board-group': g.item, 'aria-label': g.title,
      },
      g.standalone ? h('h3', { className: 'dshc-group-title' }, g.title) : null,
      h('ul', { className: 'dshc-tree', role: 'list' }, g.rows.map((row) => h(TaskRow, {
        key: String(board.key) + '\u0000' + row.item, boardKey: board.key, parent: board.parent, row, task: byItem.get(row.item), flags: flagsOf.get(row.item) || [],
        bar: row.depth === 0 && row.progress ? boardSegments(board, rows, row.item) : undefined,
      }))))))
      : h('p', { className: 'dshc-msg' }, 'No tasks yet.'))
}

// Tab id -> the navigation revision already shown, so a remounted body does not jump back to an old click.
const scrolledTo = new Map()

/**
 * The strip opens the tab with params { item }; the body shows that row once
 * it is drawn, once per navigation. useTabInfo is the framework's tab reader.
 */
function useShowRow(useTabInfo, ready, root) {
  const tab = typeof useTabInfo === 'function' ? useTabInfo()?.tab : undefined
  const nav = tab && tab.navigation
  const item = nav && nav.params && nav.params.item
  const revision = nav && nav.revision
  React.useEffect(() => {
    if (!ready || item === undefined || scrolledTo.get(tab.id) === revision) return
    scrolledTo.set(tab.id, revision)
    showRow(item, root.current)
  }, [ready, item, revision])
}

function BoardBody({ sessionId, useTabInfo }) {
  useStyle()
  const { loading, view, error } = useView(sessionId)
  const now = useMinute()
  const root = React.useRef(null)
  useShowRow(useTabInfo, Boolean(view && view.board), root)
  const wrap = (child) => h('section', { 'data-dsh-cockpit-board': '', ref: root }, child)
  if (loading) return wrap(h('p', { className: 'dshc-msg' }, 'Loading board…'))
  // A failed poll keeps the last view; only with none is the error shown.
  if (!view) return wrap(h('p', { className: 'dshc-msg', role: 'alert' }, 'Board unavailable: ' + error))
  return wrap(h(BoardView, { view, now }))
}

// ---- The progress strip above the chat input (conversation.input.dock) ----

/** The strip's model for one view answer (pure; exported for tests): undefined, so nothing shows, without a bound board that parsed. */
function dockModel(view) {
  if (!view || !view.key || !view.board || !Array.isArray(view.board.tasks)) return undefined
  const board = { ...view.board, key: view.board.key || view.key }
  const m = stripModel(board, boardRows(board, { links: view.links }))
  // The count, and what a narrow strip may leave out of it (" · 1 dropped").
  const count = m.bar.done + ' of ' + m.bar.total + ' done'
  return { ...m, count, more: m.done.slice(count.length) || undefined, line: stripText(m), tooltip: stripTitle(m) }
}

/** The bar's width in the strip at its widest: its segments at 10 px with 1 px gaps, between 48 and 120 px; squeezed below that, it is the continuous fill. */
const stripBarWidth = (bar) => Math.min(120, Math.max(48, segmentsNeed(bar.segments.length)))

/** The continuous fill: done of the open (not dropped) tasks, in whole pixels once measured (px). */
function Fill({ bar, px }) {
  const label = progressText({ done: bar.done, dropped: bar.dropped, total: bar.total }) + ' (work tasks)'
  const open = bar.total - bar.dropped
  const done = px ? fillWidth(px, bar.done, open) + 'px' : (open > 0 ? Math.round((bar.done / open) * 100) : 100) + '%'
  return h('span', { role: 'img', 'aria-label': label, className: 'dshc-fill', title: label, style: px ? { width: px } : undefined }, h('span', { style: { width: done } }))
}

const sep = (key) => h('span', { key, className: 'dshc-sep', 'aria-hidden': true }, '·')

/**
 * The strip's own box in whole pixels: its width is the room (the dock, at
 * most its max-width) rounded down, and its left edge sits on a whole pixel of
 * the page, so the bar inside starts on one too. Measured on the dock's box,
 * kept by a ResizeObserver and window resizes; until then the CSS centres it.
 */
function useWholeStrip() {
  const ref = React.useRef(null)
  const [snap, setSnap] = React.useState(undefined)
  useLayout(() => {
    const el = ref.current
    const box = el && el.parentElement
    if (!box || typeof box.getBoundingClientRect !== 'function' || typeof getComputedStyle !== 'function') return
    const read = () => {
      const r = box.getBoundingClientRect()
      const max = parseFloat(getComputedStyle(el).maxWidth)
      const width = wholePx(Number.isFinite(max) ? Math.min(r.width, max) : r.width)
      const left = Math.round(r.left + (r.width - width) / 2) - r.left
      setSnap((s) => (s && s.width === width && s.left === left ? s : { width, left }))
    }
    read()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(read)
    observer.observe(box)
    addEventListener('resize', read)
    return () => { observer.disconnect(); removeEventListener('resize', read) }
  }, [])
  return [ref, snap]
}

/** The strip (pure render; exported for tests). openBoard(item?) opens the Board tab at that row. */
function StripView({ m, openBoard }) {
  const [ref, snap] = useWholeStrip()
  const open = (item) => (e) => { if (e && e.stopPropagation) e.stopPropagation(); if (openBoard) openBoard(item) }
  const go = h('button', { key: 'go', type: 'button', className: 'dshc-go', onClick: open(m.item) }, 'Board ›')
  const parts = m.kind === 'needs you'
    ? [
      h('span', { key: 'w', className: 'dshc-ic' }, warnIcon(12)),
      h('span', { key: 'f', className: 'dshc-focus dshc-trunc' },
        h('span', { className: 'dshc-need' }, m.text.startsWith('Needs you:') ? 'Needs you:' : m.text),
        m.text.startsWith('Needs you:') ? m.text.slice('Needs you:'.length) : null),
      m.command ? h(CopyButton, { key: 'c', text: m.command, label: 'Copy command for ' + (m.title || m.item), words: 'Copy command', icon: false }) : null,
      m.command ? sep('s2') : null,
      go,
    ]
    : [
      m.key ? h('span', { key: 'k', className: 'dshc-mono dshc-key dshc-trunc', title: m.key }, m.key) : null,
      m.key ? sep('s1') : null,
      h('span', { key: 'd', className: 'dshc-done' }, m.count, m.more ? h('span', { className: 'dshc-more' }, m.more) : null),
      m.focus ? sep('s2') : null,
      h('span', { key: 'f', className: 'dshc-focus dshc-trunc' }, m.focus || ''),
      go,
    ]
  return h('div', { 'data-dsh-cockpit-dock': '', 'data-strip': m.kind, className: 'dshc-stripbox' },
    // A div, not a button: the segments and buttons inside take their own clicks.
    // The tooltip carries the full text, whatever the width cuts.
    h('div', {
      ref, style: snap ? { width: snap.width, marginLeft: snap.left, marginRight: 0 } : undefined,
      className: 'dshc-strip', role: 'button', tabIndex: 0, 'aria-label': m.line, title: m.tooltip, 'data-kind': m.kind, onClick: open(m.item),
      onKeyDown: (e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open(m.item)() } },
    },
      h(Bar, { bar: m.bar, onSegment: (item) => open(item)(), width: m.bar.continuous ? 72 : stripBarWidth(m.bar), hasAlt: !m.bar.continuous }),
      // The narrow strip's bar, shown by the container query instead of the segments.
      m.bar.continuous ? null : h(Bar, { bar: m.bar, fill: true, className: 'dshc-alt' }),
      parts))
}

function BoardDock({ sessionId, openBoard }) {
  useStyle()
  const { view } = useView(sessionId)
  const m = dockModel(view)
  return m ? h(StripView, { m, openBoard }) : null
}

// ---- Chat cards for the board tools (the keyed tool.call.toolview slot) ----

const parseArgs = (raw) => { try { const v = JSON.parse(raw); return v && typeof v === 'object' && !Array.isArray(v) ? v : {} } catch { return {} } }
const CARD_FIELDS = ['key', 'parent', 'item', 'what', 'status', 'dependsOn', 'set', 'remove', 'checkDrift']
/**
 * A settled call's arguments: its call head's argsRaw, else (the call has
 * left the loaded window) the node's own lazy argument view, else {}.
 */
function settledArgs(block) {
  if (typeof block.call?.argsRaw === 'string') return parseArgs(block.call.argsRaw)
  const view = block.args
  if (!view || typeof view.value !== 'function') return {}
  const out = {}
  for (const k of CARD_FIELDS) { try { const v = view.value(k); if (v !== undefined) out[k] = v } catch {} }
  return out
}

/**
 * A card's state, title and summary (pure; exported for tests). The summary
 * is the result meta's title when the host recorded one, else lib/present.js's
 * call title from the arguments. A result { ok: false } is an error that
 * names its code. output: the result text, shown when the card is opened.
 */
function toolCardModel(props) {
  const block = props.block || {}
  const name = props.toolName || block.name
  if (props.phase === 'preparing') return { state: 'running', title: 'Board', summary: name, output: null }
  const settled = props.phase === 'result'
  const args = settled ? settledArgs(block) : parseArgs(block.argsRaw ?? '')
  if (!settled) return { state: 'running', title: 'Board', summary: callTitle(name, args), output: null }
  const output = (block.content || []).map((c) => (c && c.type === 'text' ? c.text : JSON.stringify(c))).join('\n') || null
  let value
  try { value = output ? JSON.parse(output) : undefined } catch {}
  if (value && value.ok === false) return { state: 'error', title: 'Board', summary: callTitle(name, args) + ' · ' + String(value.code), output, value }
  const metaTitle = block.meta && typeof block.meta.title === 'string' ? block.meta.title : undefined
  const state = block.error?.code === 'interrupted' ? 'stopped' : block.isError ? 'error' : 'ok'
  const summary = (state === 'ok' && metaTitle ? metaTitle : callTitle(name, args)) + (state === 'error' ? ' · failed' : state === 'stopped' ? ' · stopped' : '')
  return { state, title: 'Board', summary, output, value }
}

/** The opened card's text: the result's tree text when it has one, else the result as indented JSON. */
function cardBody(m) {
  if (!m.output) return ''
  if (m.value && typeof m.value === 'object') return typeof m.value.tree === 'string' ? m.value.tree : JSON.stringify(m.value, null, 2)
  return m.output
}

function BoardToolRow(props) {
  useStyle()
  const primitives = cardPrimitives()
  // The result is parsed once per block, not on every render.
  const m = React.useMemo(() => toolCardModel(props), [props.phase, props.block, props.toolName])
  const disclosure = typeof props.useDisclosure === 'function' ? props.useDisclosure() : null
  const [localOpen, setLocalOpen] = React.useState(false)
  const open = disclosure ? disclosure.expanded : localOpen
  const toggle = disclosure ? disclosure.toggle : () => setLocalOpen(!localOpen)
  const expandable = Boolean(m.output)
  const Icon = primitives && primitives.IconChecklistOutlineRegular
  const icon = Icon ? h(Icon, { size: 14 }) : null
  const summary = h('span', { className: 'dshc-card-sum', 'data-state': m.state, title: m.summary }, m.summary)
  const body = open && expandable ? h('pre', { className: 'dshc-card-out' }, cardBody(m)) : null
  const Row = primitives && primitives.DisclosureRow
  if (Row) {
    return h('div', { 'data-tool': props.toolName, 'data-state': m.state, 'data-dsh-cockpit-card': '' },
      h(Row, { icon, title: m.title, open: open && expandable, expandable, onToggle: toggle, running: m.state === 'running', expandOnRowClick: true, collapsedContent: summary, keepContentWhenOpen: true }, body))
  }
  return h('div', { 'data-tool': props.toolName, 'data-state': m.state, 'data-dsh-cockpit-card': '' },
    h('div', {
      role: expandable ? 'button' : undefined, tabIndex: expandable ? 0 : undefined, 'aria-expanded': expandable ? open : undefined, onClick: expandable ? toggle : undefined,
      onKeyDown: expandable ? (e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggle() } } : undefined,
      style: { display: 'flex', alignItems: 'center', cursor: expandable ? 'pointer' : 'default' } }, icon, h('span', null, m.title), summary),
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
  // One card per board tool, keyed by its wire name.
  for (const key of TOOLS) {
    ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({ name: 'tool.call.toolview', key }, BoardToolRow))
  }
  // Above the input box, after the Todo, Goal and Queue docks (orders 0, 10, 20).
  // openTab acts on the on-screen session, the dock's; with an item the tab
  // scrolls to its row (navigation params, see useShowRow).
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'dsh-cockpit-progress',
    order: 30,
    inject: (sessionId) => ({ sessionId, openBoard: (item) => ctx.sidebarRight.openTab(KIND, item === undefined ? undefined : { params: { item } }) }),
  }, BoardDock))
}

module.exports = { apply, inject, BoardView, StripView, Bar, dockModel, segmentWidths, segmentRadius, segmentsFit: (w, n) => segmentWidths(w, n) !== undefined, halfFill, fillWidth, stripBarWidth, toolCardModel, cardBody, whenText, clockText, headerMeta, driftLine, showDrift, safeUrl, copyStep, copyText, refUrl, CSS, ID, KIND, TOOLS }
