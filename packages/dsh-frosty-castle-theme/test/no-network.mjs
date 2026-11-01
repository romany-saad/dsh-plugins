globalThis.fetch = () => { throw new Error('network access in a test') }
