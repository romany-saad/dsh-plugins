// @romany-saad/dsh-cockpit/reader: read boards with plain Node, no DSH imports.
import { readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { BoardError, boardFile, loadBoardFile } from './lib/store.js'
export { boardTree } from './lib/tree.js'

/**
 * $DSH_HOME/data/dsh-cockpit, with the home resolved as dsh-home-paths does
 * (a blank DSH_HOME is unset; a leading ~ is the user's home), and where the
 * home came from: "from DSH_HOME=/tmp/x" or "DSH_HOME unset: ~/.dsh".
 * @returns {{ dir: string, source: string }}
 */
export function dataDirSource(env = process.env) {
  const set = env.DSH_HOME?.trim()
  if (set) {
    const home = resolve(env.DSH_HOME.replace(/^~(?=$|[\\/])/, homedir()))
    return { dir: join(home, 'data', 'dsh-cockpit'), source: 'from DSH_HOME=' + env.DSH_HOME }
  }
  return { dir: join(homedir(), '.dsh', 'data', 'dsh-cockpit'), source: 'DSH_HOME unset: ~/.dsh' }
}

/** $DSH_HOME/data/dsh-cockpit. */
export const defaultDataDir = (env = process.env) => dataDirSource(env).dir

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
 * Read one board by key, or by file path (anything absolute, starting with
 * "./" or "../", or ending in .json).
 * A miss throws a BoardError (code board_unknown) that names the folder it
 * looked in and where that came from:
 *   no board "sim-883" in /tmp/x/data/dsh-cockpit (from DSH_HOME=/tmp/x)
 *   no board "sim-883" in /home/u/.dsh/data/dsh-cockpit (DSH_HOME unset: ~/.dsh)
 * A damaged or unknown-version file throws a BoardError (code board_unreadable).
 * @param {string} keyOrFile
 * @param {string} [dir] the data directory; omitted, it comes from DSH_HOME
 */
export async function readBoard(keyOrFile, dir) {
  const isPath = isAbsolute(keyOrFile) || /^\.\.?[\\/]/.test(keyOrFile) || keyOrFile.endsWith('.json')
  if (isPath) {
    const file = resolve(keyOrFile)
    const board = await loadBoardFile(file)
    if (!board) throw new BoardError('board_unknown', `no board file ${file}`)
    return board
  }
  const where = dir === undefined ? dataDirSource() : { dir, source: 'from the dir argument' }
  const board = await loadBoardFile(boardFile(where.dir, keyOrFile))
  if (!board) throw new BoardError('board_unknown', `no board ${JSON.stringify(keyOrFile)} in ${where.dir} (${where.source})`)
  return board
}
