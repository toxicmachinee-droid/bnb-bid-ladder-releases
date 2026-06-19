'use strict'

const { getPositionRangeState, estimateQuotedPositionValueFromLiquidity } = require('../monitor/position_monitor.cjs')
const { reconcileClosedPositionFromExecution } = require('../pnl/reconciliation.cjs')

function nowIso() {
  return new Date().toISOString()
}

function normalizeBudgetUsd(positionPlan) {
  const value = Number(positionPlan?.budgetUsd || 0)
  return Number.isFinite(value) ? value : 0
}

function buildOpenedPositionSnapshot({
  execution,
  positionPlan,
  tokenId,
  onchainPosition,
  observedAt = nowIso(),
  openedTxHash = null
}) {
  const currentTick = Number(execution.poolRuntime?.tick)
  const tickLower = Number(onchainPosition.tickLower)
  const tickUpper = Number(onchainPosition.tickUpper)
  const deployedQuote = normalizeBudgetUsd(positionPlan)
  const currentPoolPrice = Number(execution.currentPrice || execution.anchorPrice || execution.poolRuntime.targetPrice || 0)
  const exactOnchainValueQuote = estimateQuotedPositionValueFromLiquidity({
    trackedPosition: {
      inputTokenAddress: execution.poolRuntime.inputTokenAddress,
      depositTokenAddress: execution.plan.depositTokenAddress,
      token0Address: execution.poolRuntime.token0Address,
      token1Address: execution.poolRuntime.token1Address
    },
    poolRuntime: execution.poolRuntime,
    position: onchainPosition,
    currentPoolPrice
  })
  const normalizedOnchainValueQuote = Number.isFinite(exactOnchainValueQuote) && exactOnchainValueQuote > 0
    ? exactOnchainValueQuote
    : deployedQuote

  const upperPrice = Math.max(Number(positionPlan?.priceHigh || 0), Number(positionPlan?.priceLow || 0))
  const lowerPrice = Math.min(Number(positionPlan?.priceHigh || 0), Number(positionPlan?.priceLow || 0))
  const upperPct = Number.isFinite(Number(positionPlan?.startDrop)) ? -Number(positionPlan.startDrop) : null
  const lowerPct = Number.isFinite(Number(positionPlan?.endDrop)) ? -Number(positionPlan.endDrop) : null
  const rangeState = getPositionRangeState({
    currentPoolPrice,
    rangeLowerPrice: lowerPrice,
    rangeUpperPrice: upperPrice,
    currentTick,
    tickLower,
    tickUpper
  })

  return {
    positionId: String(tokenId),
    tokenId: String(tokenId),
    dex: execution.plan.dex,
    protocolVersion: execution.plan.protocolVersion || execution.poolRuntime.protocolVersion || 'v3',
    poolModel: String(execution.plan.protocolVersion || execution.poolRuntime.protocolVersion || 'v3').toLowerCase() === 'v2' ? 'xyk' : 'cl',
    supportsBidAsk: ['v3', 'v4'].includes(String(execution.plan.protocolVersion || execution.poolRuntime.protocolVersion || 'v3').toLowerCase()),
    poolAddress: execution.poolRuntime.poolAddress,
    tokenSymbol: execution.poolRuntime.inputTokenSymbol || null,
    inputTokenAddress: execution.poolRuntime.inputTokenAddress,
    token0Address: execution.poolRuntime.token0Address,
    token1Address: execution.poolRuntime.token1Address,
    depositTokenAddress: execution.plan.depositTokenAddress,
    quoteSymbol: execution.plan.depositTokenSymbol || execution.poolRuntime.depositTokenSymbol || 'USDT',
    depositTokenUsdPrice: Number(execution.poolRuntime?.depositTokenUsdPrice || 0),
    status: onchainPosition.liquidity > 0n ? 'open' : 'closed',
    targetPrice: currentPoolPrice,
    currentPoolPrice,
    currentTick: Number.isFinite(currentTick) ? currentTick : null,
    tickLower,
    tickUpper,
    liquidity: onchainPosition.liquidity.toString(),
    fee: Number(onchainPosition.fee || execution.poolRuntime.fee || 0),
    poolManager: execution.poolRuntime.poolManager || null,
    hooks: execution.poolRuntime.hooks || null,
    parameters: execution.poolRuntime.parameters || null,
    tokensOwed0: onchainPosition.tokensOwed0.toString(),
    tokensOwed1: onchainPosition.tokensOwed1.toString(),
    feeGrowthDelta0: '0',
    feeGrowthDelta1: '0',
    outOfRange: rangeState !== 'inside',
    rangeUpperPrice: upperPrice,
    rangeLowerPrice: lowerPrice,
    rangeUpperPct: upperPct == null || lowerPct == null ? upperPct : Math.max(upperPct, lowerPct),
    rangeLowerPct: upperPct == null || lowerPct == null ? lowerPct : Math.min(upperPct, lowerPct),
    deployedQuote: normalizedOnchainValueQuote,
    entryCostsQuote: 0,
    currentValueQuote: normalizedOnchainValueQuote,
    accruedFeesQuote: 0,
    claimedFeesQuote: 0,
    valuationStatus: onchainPosition.valuationStatus || 'known',
    openedTxHash: openedTxHash || null,
    openedRunKey: openedTxHash || null,
    openedAt: observedAt,
    lastSeenAt: observedAt,
    monitorUpdatedAt: observedAt,
    updatedAt: observedAt
  }
}

function persistOpenedPositionsFromExecution({
  store,
  execution,
  mintedTokenIds,
  onchainPositions,
  observedAt = nowIso(),
  openedTxHash = null
}) {
  const snapshots = mintedTokenIds.map((tokenId, index) => {
    const positionPlan = execution.plan.positions[index]
    const onchainPosition = onchainPositions[index]

    if (!positionPlan || !onchainPosition) {
      throw new Error('minted token ids and onchain positions must align with plan positions')
    }

    const snapshot = buildOpenedPositionSnapshot({
      execution,
      positionPlan,
      tokenId,
      onchainPosition,
      observedAt,
      openedTxHash
    })
    store.upsertPositionSnapshot(snapshot)
    return snapshot
  })

  return snapshots
}

function persistClosedPositionsFromExecution({
  store,
  openedSnapshots,
  exitArtifacts
}) {
  return openedSnapshots.map((positionSnapshot, index) => reconcileClosedPositionFromExecution({
    store,
    positionSnapshot,
    executionArtifact: exitArtifacts[index] || {}
  }))
}

module.exports = {
  buildOpenedPositionSnapshot,
  persistOpenedPositionsFromExecution,
  persistClosedPositionsFromExecution
}
