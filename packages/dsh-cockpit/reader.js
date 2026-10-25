// @romany-saad/dsh-cockpit/reader: read boards with plain Node, no DSH imports.
import { readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { BoardError, boardFile, loadBoardFile } from './lib/store.js'
export { boardTree } from './lib/tree.js'

/** $DSH_HOME/data/dsh-cockpit, with the home resolved as dsh-home-paths does. */
export function defaultDataDir(env = process.env) {
  const home = env.DSH_HOME?.trim() ? resolve(env.DSH_HOME.replace(/^~(?=$|\/)/, homedir())) : join(homedir(), '.dsh')
  return join(home, 'data', 'dsh-cockpit')
}

/** The keys of every board in a data directory. */
export async function listBoards(dir = defaultDataDir()) {
  let names
  try {
    names = await readdir(join(dir, 'boards'))
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
  return names.filter((n) => n.endsWith('.json') && !n.startsWith('.')).map((n) => decodeURIComponent(n.slice(0, -5))).sort()
}

/**
 * Read one board by key, or by file path (anything with a slash or ending in .json).
 * Throws a BoardError (code board_unreadable) for a damaged or unknown-version file.
 */
export async function readBoard(keyOrFile, dir = defaultDataDir()) {
  const isPath = isAbsolute(keyOrFile) || keyOrFile.startsWith('.') && keyOrFile.includes('/') || keyOrFile.endsWith('.json')
  const file = isPath ? resolve(keyOrFile) : boardFile(dir, keyOrFile)
  const board = await loadBoardFile(file)
  if (!board) throw new BoardError('board_unknown', `${file}: no such board`)
  return board
}
