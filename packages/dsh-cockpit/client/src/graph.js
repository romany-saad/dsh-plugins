// The Board tab's graph view: a layered layout of the board's tasks, in whole
// pixels, that fills the width it is given (no sideways scroll in a narrow
// sidebar). Import-free: client/build.mjs inlines it into the browser bundle.
//
// Edges: a parent above each child ('parent'), a dependency above each task
// that depends on it ('depends'). A task's layer is the longest path to it
// over both; a cycle (a hand-edited file) is cut at the number of tasks. A
// layer wider than the columns that fit wraps onto further rows, each row
// centred. Within a layer, tasks sit under the tasks they come from
// (barycentre of their x), else in board order.

export const GRAPH_NODE_MIN = 132
export const GRAPH_NODE_H = 44
export const GRAPH_GAP_X = 12
export const GRAPH_GAP_Y = 28
export const GRAPH_WRAP_GAP = 12

/**
 * @param {{item: string, parent?: string, dependsOn?: string[]}[]} nodes in board (tree) order
 * @param {{width?: number}} [options] the room, in px
 * @returns {{nodes: {item: string, x: number, y: number, w: number, h: number, layer: number}[],
 *   edges: {from: string, to: string, kind: 'parent'|'depends', d: string}[], width: number, height: number, cols: number}}
 */
export function graphLayout(nodes, { width = 320 } = {}) {
  const index = new Map()
  nodes.forEach((n, i) => { if (!index.has(n.item)) index.set(n.item, i) })
  const list = nodes.filter((n, i) => index.get(n.item) === i)
  const edges = []
  const seen = new Set()
  const link = (from, to, kind) => {
    const key = from + '\u0000' + to
    if (from === to || !index.has(from) || seen.has(key)) return
    seen.add(key)
    edges.push({ from, to, kind })
  }
  for (const n of list) {
    if (typeof n.parent === 'string') link(n.parent, n.item, 'parent')
    for (const d of Array.isArray(n.dependsOn) ? n.dependsOn : []) link(d, n.item, 'depends')
  }
  const rank = new Map(list.map((n) => [n.item, 0]))
  for (let pass = 0; pass < list.length; pass++) {
    let changed = false
    for (const e of edges) {
      const r = rank.get(e.from) + 1
      if (r > rank.get(e.to) && r < list.length) { rank.set(e.to, r); changed = true }
    }
    if (!changed) break
  }
  const w = Math.max(GRAPH_NODE_MIN, Math.floor(Number.isFinite(width) ? width : 320))
  const cols = Math.max(1, Math.floor((w + GRAPH_GAP_X) / (GRAPH_NODE_MIN + GRAPH_GAP_X)))
  const nodeW = Math.floor((w - (cols - 1) * GRAPH_GAP_X) / cols)
  const incoming = new Map(list.map((n) => [n.item, []]))
  for (const e of edges) incoming.get(e.to).push(e.from)
  const layers = [...new Set(list.map((n) => rank.get(n.item)))].sort((a, b) => a - b)
  const placed = new Map()
  let y = 0
  layers.forEach((layer, li) => {
    const members = list.filter((n) => rank.get(n.item) === layer)
    const centre = (n) => {
      const xs = incoming.get(n.item).map((p) => placed.get(p)).filter(Boolean).map((p) => p.x + p.w / 2)
      return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined
    }
    const keyed = members.map((n) => ({ n, c: centre(n), i: index.get(n.item) }))
    keyed.sort((a, b) => (a.c === undefined || b.c === undefined ? a.i - b.i : a.c - b.c || a.i - b.i))
    for (let start = 0; start < keyed.length; start += cols) {
      const row = keyed.slice(start, start + cols)
      const offset = Math.floor(((cols - row.length) * (nodeW + GRAPH_GAP_X)) / 2)
      row.forEach(({ n }, k) => placed.set(n.item, { item: n.item, x: offset + k * (nodeW + GRAPH_GAP_X), y, w: nodeW, h: GRAPH_NODE_H, layer: li }))
      y += GRAPH_NODE_H + (start + cols < keyed.length ? GRAPH_WRAP_GAP : 0)
    }
    if (li < layers.length - 1) y += GRAPH_GAP_Y
  })
  const out = list.map((n) => placed.get(n.item))
  const drawn = edges.map((e) => {
    const a = placed.get(e.from)
    const b = placed.get(e.to)
    const x1 = a.x + Math.floor(a.w / 2)
    const x2 = b.x + Math.floor(b.w / 2)
    let d
    if (b.y > a.y + a.h) {
      const y1 = a.y + a.h
      const y2 = b.y
      const c = Math.max(8, Math.floor((y2 - y1) / 2))
      d = 'M' + x1 + ' ' + y1 + ' C' + x1 + ' ' + (y1 + c) + ' ' + x2 + ' ' + (y2 - c) + ' ' + x2 + ' ' + y2
    } else {
      // The same row or upwards (a cut cycle): round the side of the nodes.
      const side = Math.max(a.x + a.w, b.x + b.w) + 8
      d = 'M' + (a.x + a.w) + ' ' + (a.y + Math.floor(a.h / 2)) + ' C' + side + ' ' + (a.y + Math.floor(a.h / 2)) + ' ' + side + ' ' + (b.y + Math.floor(b.h / 2)) + ' ' + (b.x + b.w) + ' ' + (b.y + Math.floor(b.h / 2))
    }
    return { ...e, d }
  })
  return { nodes: out, edges: drawn, width: w, height: y, cols }
}
