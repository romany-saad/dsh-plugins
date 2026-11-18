// The Board tab's graph view: a layered layout of the board's tasks, in whole
// pixels, that fills the width it is given (no sideways scroll in a narrow
// sidebar). Import-free: client/build.mjs inlines it into the browser bundle.
//
// A parent is a box (a container) holding its steps, laid out the same way
// inside it; a step with no children is a node. Within one box (or at the top),
// the steps are put in layers by their dependencies: a step sits below the
// steps it depends on, a dependency inside another box counting as that box.
// A cycle (a hand-edited file) is cut at the number of steps, and a parent loop
// at the step that closes it. In a layer, the nodes fill columns that fit the
// width and wrap onto more rows, each row centred; a box takes the full width.
// Only dependencies are drawn as lines: the boxes show the parents.

export const GRAPH_NODE_MIN = 132
export const GRAPH_NODE_H = 44
export const GRAPH_GAP_X = 12
export const GRAPH_GAP_Y = 28
export const GRAPH_WRAP_GAP = 12
/** A box's inner padding, and its header's height (its mark, title and count). */
export const GRAPH_PAD = 8
export const GRAPH_HEAD = 30

const centre = (r) => r.x + Math.floor(r.w / 2)
function curve(x1, y1, x2, y2) {
  const s = y2 >= y1 ? 1 : -1
  const c = Math.max(8, Math.floor(Math.abs(y2 - y1) / 2))
  return 'M' + x1 + ' ' + y1 + ' C' + x1 + ' ' + (y1 + s * c) + ' ' + x2 + ' ' + (y2 - s * c) + ' ' + x2 + ' ' + y2
}
/** A dependency line from box a to box b: bottom to top when b is below, top to bottom when above, else round their right side. */
function route(a, b) {
  if (b.y >= a.y + a.h) return curve(centre(a), a.y + a.h, centre(b), b.y)
  if (a.y >= b.y + b.h) return curve(centre(a), a.y, centre(b), b.y + b.h)
  const side = Math.max(a.x + a.w, b.x + b.w) + 8
  const ya = a.y + Math.floor(Math.min(a.h, GRAPH_NODE_H) / 2)
  const yb = b.y + Math.floor(Math.min(b.h, GRAPH_NODE_H) / 2)
  return 'M' + (a.x + a.w) + ' ' + ya + ' C' + side + ' ' + ya + ' ' + side + ' ' + yb + ' ' + (b.x + b.w) + ' ' + yb
}

/**
 * @param {{item: string, parent?: string, dependsOn?: string[]}[]} nodes in board (tree) order
 * @param {{width?: number}} [options] the room, in px
 * @returns {{nodes: {item: string, x: number, y: number, w: number, h: number, container: boolean}[],
 *   edges: {from: string, to: string, kind: 'depends', d: string}[], width: number, height: number}}
 */
export function graphLayout(nodes, { width = 320 } = {}) {
  const index = new Map()
  nodes.forEach((n, i) => { if (n && typeof n.item === 'string' && !index.has(n.item)) index.set(n.item, i) })
  const list = nodes.filter((n, i) => n && index.get(n.item) === i)
  const byItem = new Map(list.map((n) => [n.item, n]))
  const parentOf = new Map()
  for (const n of list) if (typeof n.parent === 'string' && n.parent !== n.item && byItem.has(n.parent)) parentOf.set(n.item, n.parent)
  // A parent loop: the step that closes it goes to the top level.
  for (const n of list) {
    const seen = new Set()
    for (let p = parentOf.get(n.item); p !== undefined; p = parentOf.get(p)) {
      if (p === n.item) { parentOf.delete(n.item); break }
      if (seen.has(p)) break
      seen.add(p)
    }
  }
  const childrenOf = new Map(list.map((n) => [n.item, []]))
  for (const n of list) if (parentOf.has(n.item)) childrenOf.get(parentOf.get(n.item)).push(n.item)
  const deps = new Map(list.map((n) => [n.item, [...new Set((Array.isArray(n.dependsOn) ? n.dependsOn : []).filter((d) => d !== n.item && byItem.has(d)))]]))
  const subtree = (item) => { const out = [item]; for (let i = 0; i < out.length; i++) out.push(...childrenOf.get(out[i])); return out }
  const placed = new Map()

  /** Lay out items (siblings, in board order) in w px from (x0, y0); returns the height used. */
  function block(items, w, x0, y0) {
    const here = new Set(items)
    const lift = (t) => { for (let p = t; p !== undefined; p = parentOf.get(p)) if (here.has(p)) return p }
    const links = []
    for (const i of items) for (const u of subtree(i)) for (const d of deps.get(u)) { const s = lift(d); if (s !== undefined && s !== i) links.push([s, i]) }
    const rank = new Map(items.map((i) => [i, 0]))
    for (let pass = 0; pass < items.length; pass++) {
      let changed = false
      for (const [a, b] of links) { const r = rank.get(a) + 1; if (r > rank.get(b) && r < items.length) { rank.set(b, r); changed = true } }
      if (!changed) break
    }
    const cols = Math.max(1, Math.floor((w + GRAPH_GAP_X) / (GRAPH_NODE_MIN + GRAPH_GAP_X)))
    const nodeW = Math.max(1, Math.floor((w - (cols - 1) * GRAPH_GAP_X) / cols))
    const layers = [...new Set(items.map((i) => rank.get(i)))].sort((a, b) => a - b)
    let y = y0
    layers.forEach((layer, li) => {
      let first = true
      const gap = () => { if (!first) y += GRAPH_WRAP_GAP; first = false }
      let run = []
      const flush = () => {
        for (let s = 0; s < run.length; s += cols) {
          gap()
          const row = run.slice(s, s + cols)
          const offset = Math.floor(((cols - row.length) * (nodeW + GRAPH_GAP_X)) / 2)
          row.forEach((item, k) => placed.set(item, { item, x: x0 + offset + k * (nodeW + GRAPH_GAP_X), y, w: nodeW, h: GRAPH_NODE_H, container: false }))
          y += GRAPH_NODE_H
        }
        run = []
      }
      for (const item of items) {
        if (rank.get(item) !== layer) continue
        if (!childrenOf.get(item).length) { run.push(item); continue }
        flush()
        gap()
        const top = y
        const inner = block(childrenOf.get(item), Math.max(1, w - 2 * GRAPH_PAD), x0 + GRAPH_PAD, top + GRAPH_HEAD)
        const h = GRAPH_HEAD + inner + GRAPH_PAD
        placed.set(item, { item, x: x0, y: top, w, h, container: true })
        y = top + h
      }
      flush()
      if (li < layers.length - 1) y += GRAPH_GAP_Y
    })
    return y - y0
  }

  const w = Math.max(GRAPH_NODE_MIN, Math.floor(Number.isFinite(width) ? width : 320))
  const height = block(list.filter((n) => !parentOf.has(n.item)).map((n) => n.item), w, 0, 0)
  const edges = []
  for (const n of list) for (const d of deps.get(n.item)) edges.push({ from: d, to: n.item, kind: 'depends', d: route(placed.get(d), placed.get(n.item)) })
  return { nodes: list.map((n) => placed.get(n.item)), edges, width: w, height }
}

/**
 * What stays lit while one node is hovered or focused: the node, the steps it
 * depends on and the steps that depend on it (its 'depends' edges, one step
 * each way), and those edges. Parent edges are not followed. undefined item:
 * nothing is dimmed (undefined).
 * @param {{from: string, to: string, kind: string}[]} edges graphLayout's edges
 * @returns {{items: Set<string>, edges: Set<string>, dependencies: string[], dependants: string[]}|undefined}
 */
export function graphFocus(edges, item) {
  if (item === undefined || item === null) return undefined
  const items = new Set([item])
  const lit = new Set()
  const dependencies = []
  const dependants = []
  for (const e of edges) {
    if (e.kind !== 'depends') continue
    if (e.to === item) { items.add(e.from); lit.add(edgeId(e)); dependencies.push(e.from) }
    else if (e.from === item) { items.add(e.to); lit.add(edgeId(e)); dependants.push(e.to) }
  }
  return { items, edges: lit, dependencies, dependants }
}

/** An edge's key: from, to and kind. */
export const edgeId = (e) => e.from + '>' + e.to + ':' + e.kind