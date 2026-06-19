'use strict'

const { buildAutoswapPlan, buildExecutionExtensionPlan } = require('./swap_planner.cjs')

function normalizeCloseSwapPayload({
  positionSnapshot,
  executionArtifact = {},
  route,
  policy,
  targetTokenSymbol = positionSnapshot?.quoteSymbol || 'USDT'
}) {
  const tokenIn = executionArtifact.receivedTokenSymbol || executionArtifact.tokenOutSymbol || positionSnapshot?.inputTokenSymbol
  const tokenOut = targetTokenSymbol
  const amountIn = executionArtifact.receivedAmount || executionArtifact.amountOut || executionArtifact.autoswapAmountIn || '0'

  return {
    positionSnapshot,
    executionArtifact,
    route,
    policy,
    tokenIn,
    tokenOut,
    amountIn
  }
}

function buildPostExitAutoswapPlan(payload) {
  const normalized = normalizeCloseSwapPayload(payload)
  const autoswap = buildAutoswapPlan({
    route: normalized.route,
    policy: normalized.policy,
    tokenIn: normalized.tokenIn,
    tokenOut: normalized.tokenOut,
    amountIn: normalized.amountIn
  })

  return {
    positionId: normalized.positionSnapshot?.positionId || normalized.positionSnapshot?.tokenId || null,
    tokenId: normalized.positionSnapshot?.tokenId || null,
    dex: normalized.positionSnapshot?.dex || null,
    closeTxHash: normalized.executionArtifact?.txHash || null,
    realizedPnlQuote: Number(normalized.executionArtifact?.realizedPnlQuote || 0),
    autoswap
  }
}

function buildPostExitExecutionSummary(payload) {
  const autoswapPlan = buildPostExitAutoswapPlan(payload)
  const extensionPlan = buildExecutionExtensionPlan({
    autoswap: autoswapPlan.autoswap
  })

  return {
    ...autoswapPlan,
    hasActionableSwap: extensionPlan.hasActionableSwap,
    action: autoswapPlan.autoswap.decision.action,
    reason: autoswapPlan.autoswap.decision.reason
  }
}

function persistPostExitExecutionSummary(store, payload) {
  if (!store?.appendExecutionExtensionSummary) {
    throw new Error('persistPostExitExecutionSummary requires a state store with appendExecutionExtensionSummary')
  }

  return store.appendExecutionExtensionSummary(buildPostExitExecutionSummary(payload))
}

module.exports = {
  normalizeCloseSwapPayload,
  buildPostExitAutoswapPlan,
  buildPostExitExecutionSummary,
  persistPostExitExecutionSummary
}
