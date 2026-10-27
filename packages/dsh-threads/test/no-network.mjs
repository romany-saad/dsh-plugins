// Loaded with --import before every test file: no test reaches the network (design 9).
globalThis.fetch = () => {
  throw new Error('network access in a test')
}
