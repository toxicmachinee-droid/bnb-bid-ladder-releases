'use strict'

function applySlippage(amount, slippageBps) {
  return amount * BigInt(Math.max(0, 10_000 - slippageBps)) / 10_000n
}

function applySlippageBigInt(amount, slippageBps) {
  return applySlippage(amount, slippageBps)
}

module.exports = {
  applySlippage,
  applySlippageBigInt
}
