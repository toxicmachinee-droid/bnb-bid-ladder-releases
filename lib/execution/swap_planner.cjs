'use strict'

const { assessSwapRoute } = require('./swap_policy.cjs')

function buildAutoswapPlan({
  route,
  policy,
  tokenIn,
  tokenOut,
  amountIn
}) {
  const decision = assessSwapRoute(route, policy)

  return {
    mode: 'autoswap',
    tokenIn,
    tokenOut,
    amountIn,
    route,
    decision
  }
}

function buildExecutionExtensionPlan({
  spotOrder = null,
  autoswap = null
}) {
  return {
    spotOrder,
    autoswap,
    hasActionableSwap: autoswap?.decision?.action === 'swap',
    hasSpotOrder: Boolean(spotOrder)
  }
}

module.exports = {
  buildAutoswapPlan,
  buildExecutionExtensionPlan
}
