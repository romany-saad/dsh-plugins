// The segmented bar's geometry, one model for the Board tab's parent row and
// the progress strip, in whole pixels only. Import-free: client/build.mjs
// inlines it into the browser bundle.

/** The narrowest segment, its height, and the gap between two segments, in px. */
export const SEG_MIN = 10
export const SEG_HEIGHT = 8
export const SEG_GAP = 1
/** Half the height, so the bar's two outer ends are round. A literal 50% would make an elliptical end on a segment wider than it is tall. */
export const SEG_RADIUS = SEG_HEIGHT / 2

/** A measured width as whole pixels, rounded down; 0 for no width. */
export const wholePx = (width) => (Number.isFinite(width) && width > 0 ? Math.floor(width) : 0)

/** The width n segments need at their narrowest, with the gaps between them. */
export const segmentsNeed = (n) => (n > 0 ? n * SEG_MIN + (n - 1) * SEG_GAP : 0)

/** Whether n segments fit in width; when they do not, the bar is one continuous fill. */
export const segmentsFit = (width, n) => n > 0 && segmentsNeed(n) <= wholePx(width)

/**
 * Each segment's width in whole pixels, so that with the gaps they fill
 * wholePx(width) exactly: floor((width - gaps) / n) each, and the pixels left
 * over one each to the first segments. undefined when they do not fit.
 */
export function segmentWidths(width, n) {
  if (!segmentsFit(width, n)) return undefined
  const room = wholePx(width) - (n - 1) * SEG_GAP
  const base = Math.floor(room / n)
  const extra = room - base * n
  return Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0))
}

/**
 * Segment i of n's border-radius (top-left top-right bottom-right
 * bottom-left): square, except the first segment's left end and the last
 * one's right end; a single segment is round at both.
 */
export function segmentRadius(i, n) {
  const r = SEG_RADIUS + 'px'
  const left = i === 0 ? r : '0'
  const right = i === n - 1 ? r : '0'
  return left + ' ' + right + ' ' + right + ' ' + left
}

/** The filled half of a 'now' segment, in whole pixels. */
export const halfFill = (width) => Math.floor(wholePx(width) / 2)

/** The done part of the continuous fill, in whole pixels: done of open (not dropped) tasks. */
export const fillWidth = (width, done, open) => (open > 0 ? Math.round((wholePx(width) * Math.min(done, open)) / open) : wholePx(width))

/** The order of a stacked bar's runs: settled work first, then what moves, what waits, what is left. */
export const RUN_ORDER = ['done', 'now', 'needs you', 'waiting', 'ready', 'blocked', 'dropped']

/**
 * The continuous bar as runs, one per kind present, in RUN_ORDER, each as
 * wide as its share of the segments, so a bar too narrow for its segments
 * still shows the board's state, not only what is done. In whole pixels once
 * measured: with the 1 px gaps they fill wholePx(width) exactly, the leftover
 * by largest remainder, and every run keeps at least 2 px when there is room.
 * Unmeasured (width 0): pct, a percentage, instead.
 * @param {{kind: string}[]} segments
 * @returns {{kind: string, count: number, width?: number, pct?: number}[]}
 */
export function stackRuns(segments, width) {
  const counts = new Map()
  for (const s of segments) counts.set(s.kind, (counts.get(s.kind) || 0) + 1)
  const kinds = RUN_ORDER.filter((k) => counts.get(k)).concat([...counts.keys()].filter((k) => !RUN_ORDER.includes(k)))
  const n = segments.length
  const px = wholePx(width)
  if (!n) return []
  if (!px) return kinds.map((kind) => ({ kind, count: counts.get(kind), pct: (counts.get(kind) / n) * 100 }))
  const room = Math.max(0, px - (kinds.length - 1) * SEG_GAP)
  const exact = kinds.map((k) => (room * counts.get(k)) / n)
  const widths = exact.map(Math.floor)
  let left = room - widths.reduce((a, b) => a + b, 0)
  exact.map((x, i) => [x - widths[i], i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]).forEach(([, i]) => { if (left > 0) { widths[i]++; left-- } })
  const MIN = 2
  if (room >= MIN * kinds.length) {
    for (let i = 0; i < widths.length; i++) {
      while (widths[i] < MIN) {
        let big = 0
        for (let j = 1; j < widths.length; j++) if (widths[j] > widths[big]) big = j
        widths[big]--
        widths[i]++
      }
    }
  }
  return kinds.map((kind, i) => ({ kind, count: counts.get(kind), width: widths[i] }))
}
