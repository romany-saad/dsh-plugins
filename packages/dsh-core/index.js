// @rs-dsh/dsh-core: Node half. Everything runs in the browser bundle
// (client.js); the host side has nothing to do. The row exists so the
// client half loads once, however many rs-dsh plugins insert it.
export const name = 'dsh-core'

export function apply() {}
