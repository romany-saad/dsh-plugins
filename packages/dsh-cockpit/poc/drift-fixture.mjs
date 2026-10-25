// Drift fixture for ask E1: reports the task linked to #886 as done, as a
// user's own command would after checking the tracker. Reads the board on stdin.
let input = ''
process.stdin.setEncoding('utf8').on('data', (d) => { input += d }).on('end', () => {
  const board = JSON.parse(input)
  const items = board.tasks
    .filter((t) => t.issue === '#886')
    .map((t) => ({ item: t.item, status: 'done', note: '#891 merged' }))
  process.stdout.write(JSON.stringify({ items }) + '\n')
})
