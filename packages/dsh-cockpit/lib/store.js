// The board files (design section 4): one versioned JSON file per key,
// written by temp + fsync + rename + directory fsync. No DSH imports.
import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, readdir, rename, rm } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

export const FORMAT = 'dsh-cockpit.board'
export const VERSION = 1

/** An expected failure, returned to the model as { ok: false, code, message }. */
export class BoardError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

export const boardFile = (dataDir, key) => join(dataDir, 'boards', encodeURIComponent(key) + '.json')
export const bindingFile = (dataDir, sessionId) => join(dataDir, 'sessions', encodeURIComponent(sessionId) + '.json')

/** Parse a board file's text; refuse what is not a version-1 board. */
export function parseBoard(text, file = 'board') {
  let board
  try {
    board = JSON.parse(text)
  } catch (error) {
    throw new BoardError('board_unreadable', `${file}: not JSON (${error.message})`)
  }
  if (board === null || typeof board !== 'object' || board.format !== FORMAT) {
    throw new BoardError('board_unreadable', `${file}: not a ${FORMAT} file`)
  }
  if (board.version !== VERSION) {
    throw new BoardError('board_unreadable', `${file}: unknown version ${JSON.stringify(board.version)} (this plugin knows ${VERSION})`)
  }
  if (!Array.isArray(board.tasks)) throw new BoardError('board_unreadable', `${file}: tasks is not an array`)
  return board
}

/** Read a board file; undefined when it does not exist. */
export async function loadBoardFile(file) {
  let text
  try {
    text = await readFile(file, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return undefined
    throw error
  }
  return parseBoard(text, file)
}

/** Publish JSON atomically: a reader sees the old file or the new one, never a part. */
export async function writeJsonAtomic(file, value) {
  const dir = dirname(file)
  const base = basename(file)
  await mkdir(dir, { recursive: true })
  // A crash between write and rename leaves a temp file: remove it now.
  for (const name of await readdir(dir)) {
    if (name.startsWith(`.${base}.`) && name.endsWith('.tmp')) await rm(join(dir, name), { force: true })
  }
  const tmp = join(dir, `.${base}.${process.pid}.${randomUUID()}.tmp`)
  const fh = await open(tmp, 'wx')
  try {
    await fh.writeFile(JSON.stringify(value, null, 2) + '\n')
    await fh.sync()
  } finally {
    await fh.close()
  }
  try {
    await rename(tmp, file)
  } catch (error) {
    await rm(tmp, { force: true })
    throw error
  }
  const dh = await open(dir, 'r')
  try {
    await dh.sync()
  } finally {
    await dh.close()
  }
}

/**
 * Whether a write changes the board's record: a new board, or a change to its
 * tasks or its parent. Only such a write bumps revision; a drift check that
 * changes no task stores its result without bumping it (design 4, finding E1).
 */
export function changesRecord(current, next) {
  if (!current) return true
  return current.parent !== next.parent || JSON.stringify(current.tasks) !== JSON.stringify(next.tasks)
}

/**
 * The plugin's store under one data directory ($DSH_HOME/data/dsh-cockpit).
 * Changes to one key run one at a time in this process: the hub and its
 * builders all see the tools (decision 15), so two agents may write at once.
 */
export function createStore({ dataDir, now = () => new Date().toISOString() }) {
  const tails = new Map()
  const serial = (key, fn) => {
    const run = (tails.get(key) ?? Promise.resolve()).then(fn, fn)
    tails.set(key, run.then(() => {}, () => {}))
    return run
  }
  return {
    dataDir,
    now,
    file: (key) => boardFile(dataDir, key),
    read: (key) => loadBoardFile(boardFile(dataDir, key)),
    /**
     * Read, change and publish one board. `change(current)` returns
     * { board, write } (it may throw a BoardError). A write that changes the
     * record (changesRecord) bumps revision and sets updatedAt and updatedBy;
     * any other write, such as a report-only drift result, keeps all three.
     */
    change(key, change, { by, signal } = {}) {
      return serial(key, async () => {
        const current = await loadBoardFile(boardFile(dataDir, key))
        const { board, write, ...rest } = await change(current)
        if (!write) return { board, ...rest }
        signal?.throwIfAborted()
        let next = board
        if (changesRecord(current, board)) {
          next = { ...board, revision: (current?.revision ?? 0) + 1, updatedAt: now() }
          if (by !== undefined) next.updatedBy = by
        }
        await writeJsonAtomic(boardFile(dataDir, key), next)
        return { board: next, ...rest }
      })
    },
    async readBinding(sessionId) {
      try {
        const b = JSON.parse(await readFile(bindingFile(dataDir, sessionId), 'utf8'))
        return b?.version === 1 && typeof b.key === 'string' ? b.key : undefined
      } catch {
        return undefined
      }
    },
    writeBinding: (sessionId, key) => writeJsonAtomic(bindingFile(dataDir, sessionId), { version: 1, key }),
  }
}
