'use strict'

const { assessSwapRoute } = require('./swap_policy.cjs')

function buildSpotExecutionSummary({
  spotOrder,
  route,
  policy
}) {
  if (!spotOrder) {
    return null
  }

  const decision = assessSwapRoute(route, policy)

  return {
    mode: 'spot',
    side: spotOrder.side,
    tokenIn: spotOrder.tokenIn,
    tokenOut: spotOrder.tokenOut,
    amountIn: spotOrder.amountIn,
    route,
    decision
  }
}

function buildExecutionExtensionsReport({
  spotSummary = null,
  postExitSummary = null
}) {
  const summaries = [spotSummary, postExitSummary].filter(Boolean)
  const blockers = summaries.filter((summary) => summary.decision?.action === 'block' || summary.action === 'block')
  const holds = summaries.filter((summary) => summary.decision?.action === 'hold' || summary.action === 'hold')
  const actionable = summaries.filter((summary) => summary.decision?.action === 'swap' || summary.action === 'swap')

  return {
    generatedAt: new Date().toISOString(),
    spotSummary,
    postExitSummary,
    actionableCount: actionable.length,
    holdCount: holds.length,
    blockerCount: blockers.length,
    readyToExecute: blockers.length === 0 && actionable.length > 0
  }
}

function persistExecutionExtensionsReport(store, payload) {
  if (!store?.appendExecutionExtensionSummary) {
    throw new Error('persistExecutionExtensionsReport requires a state store with appendExecutionExtensionSummary')
  }

  return store.appendExecutionExtensionSummary(buildExecutionExtensionsReport(payload))
}

module.exports = {
  buildSpotExecutionSummary,
  buildExecutionExtensionsReport,
  persistExecutionExtensionsReport
}
