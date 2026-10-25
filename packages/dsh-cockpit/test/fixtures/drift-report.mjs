// A fixture drift command (acceptance test 6): reports the task linked to
// #886 as done, as a user's own command would after checking its tracker,
// and every other task as it is. Reads the board on stdin.
let input = ''
process.stdin.setEncoding('utf8').on('data', (d) => { input += d }).on('end', () => {
  const board = JSON.parse(input)
  const items = board.tasks.map((t) => (t.issue === '#886' ? { item: t.item, status: 'done', note: '#891 merged' } : { item: t.item, status: t.status }))
  process.stdout.write(JSON.stringify({ items }) + '\n')
})
