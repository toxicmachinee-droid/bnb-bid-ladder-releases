'use strict'

function createNonceManager(signer, { startNonce } = {}) {
  let nextNonce = startNonce === undefined ? null : BigInt(startNonce)

  async function current() {
    if (nextNonce === null) {
      nextNonce = BigInt(await signer.getNonce('pending'))
    }

    return nextNonce
  }

  async function allocate() {
    const nonce = await current()
    nextNonce = nonce + 1n
    return nonce
  }

  function reset(value = null) {
    nextNonce = value === null ? null : BigInt(value)
  }

  return {
    current,
    allocate,
    reset
  }
}

module.exports = {
  createNonceManager
}
