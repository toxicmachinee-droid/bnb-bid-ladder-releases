'use strict'

function toFiniteNumber(value, fallback = 0) {
  const normalized = Number(value)
  return Number.isFinite(normalized) ? normalized : fallback
}

function buildRecoveredOpenPositionSnapshot({
  existingSnapshot = null,
  trackedPosition = null,
  position = null,
  poolRuntime = null,
  currentPoolPrice = 0,
  detectedCurrentValueQuote = null,
  observedAt = new Date().toISOString(),
  recoveredAt = observedAt,
  openedRunKey = null
}) {
  const preservedSnapshot = existingSnapshot || trackedPosition || {}
  const deployedQuote = toFiniteNumber(
    preservedSnapshot.deployedQuote,
    toFiniteNumber(trackedPosition?.deployedQuote, 0)
  )
  const entryCostsQuote = toFiniteNumber(
    preservedSnapshot.entryCostsQuote,
    toFiniteNumber(trackedPosition?.entryCostsQuote, 0)
  )
  const claimedFeesQuote = toFiniteNumber(
    preservedSnapshot.claimedFeesQuote,
    toFiniteNumber(trackedPosition?.claimedFeesQuote, 0)
  )
  const currentValueQuote = toFiniteNumber(
    preservedSnapshot.currentValueQuote,
    toFiniteNumber(detectedCurrentValueQuote, toFiniteNumber(trackedPosition?.currentValueQuote, deployedQuote))
  )

  return {
    positionId: String(preservedSnapshot.positionId || preservedSnapshot.tokenId || position?.tokenId || trackedPosition?.positionId || trackedPosition?.tokenId),
    tokenId: String(preservedSnapshot.tokenId || position?.tokenId || trackedPosition?.tokenId || preservedSnapshot.positionId || trackedPosition?.positionId),
    dex: preservedSnapshot.dex || trackedPosition?.dex || position?.dex || null,
    protocolVersion: preservedSnapshot.protocolVersion || trackedPosition?.protocolVersion || position?.protocolVersion || 'v3',
    poolModel: preservedSnapshot.poolModel || trackedPosition?.poolModel || position?.poolModel || 'cl',
    supportsBidAsk: preservedSnapshot.supportsBidAsk == null
      ? trackedPosition?.supportsBidAsk == null
        ? ['v3', 'v4'].includes(String(preservedSnapshot.protocolVersion || trackedPosition?.protocolVersion || position?.protocolVersion || 'v3').toLowerCase())
        : Boolean(trackedPosition?.supportsBidAsk)
      : Boolean(preservedSnapshot.supportsBidAsk),
    poolAddress: preservedSnapshot.poolAddress || trackedPosition?.poolAddress || position?.poolAddress || null,
    tokenSymbol: preservedSnapshot.tokenSymbol || trackedPosition?.tokenSymbol || trackedPosition?.inputTokenSymbol || null,
    inputTokenAddress: preservedSnapshot.inputTokenAddress || trackedPosition?.inputTokenAddress || null,
    token0Address: preservedSnapshot.token0Address || trackedPosition?.token0Address || position?.token0Address || null,
    token1Address: preservedSnapshot.token1Address || trackedPosition?.token1Address || position?.token1Address || null,
    depositTokenAddress: preservedSnapshot.depositTokenAddress || trackedPosition?.depositTokenAddress || position?.depositTokenAddress || null,
    quoteSymbol: preservedSnapshot.quoteSymbol || trackedPosition?.quoteSymbol || trackedPosition?.depositTokenSymbol || 'USDT',
    depositTokenUsdPrice: toFiniteNumber(
      preservedSnapshot.depositTokenUsdPrice,
      toFiniteNumber(trackedPosition?.depositTokenUsdPrice, 0)
    ),
    status: 'open',
    targetPrice: toFiniteNumber(preservedSnapshot.targetPrice, toFiniteNumber(trackedPosition?.currentPoolPrice, currentPoolPrice)),
    currentPoolPrice: toFiniteNumber(preservedSnapshot.currentPoolPrice, currentPoolPrice),
    currentTick: preservedSnapshot.currentTick == null ? trackedPosition?.currentTick ?? null : preservedSnapshot.currentTick,
    tickLower: position?.tickLower ?? trackedPosition?.tickLower ?? preservedSnapshot.tickLower ?? null,
    tickUpper: position?.tickUpper ?? trackedPosition?.tickUpper ?? preservedSnapshot.tickUpper ?? null,
    liquidity: String(position?.liquidity ?? trackedPosition?.liquidity ?? preservedSnapshot.liquidity ?? '0'),
    fee: toFiniteNumber(position?.fee, toFiniteNumber(trackedPosition?.fee, 0)),
    poolManager: preservedSnapshot.poolManager || trackedPosition?.poolManager || poolRuntime?.poolManager || null,
    hooks: preservedSnapshot.hooks || trackedPosition?.hooks || poolRuntime?.hooks || null,
    parameters: preservedSnapshot.parameters || trackedPosition?.parameters || poolRuntime?.parameters || null,
    tokensOwed0: String(position?.tokensOwed0 ?? trackedPosition?.tokensOwed0 ?? preservedSnapshot.tokensOwed0 ?? '0'),
    tokensOwed1: String(position?.tokensOwed1 ?? trackedPosition?.tokensOwed1 ?? preservedSnapshot.tokensOwed1 ?? '0'),
    feeGrowthDelta0: '0',
    feeGrowthDelta1: '0',
    outOfRange: Boolean(preservedSnapshot.outOfRange ?? trackedPosition?.outOfRange ?? false),
    rangeUpperPrice: toFiniteNumber(preservedSnapshot.rangeUpperPrice, trackedPosition?.rangeUpperPrice ?? 0),
    rangeLowerPrice: toFiniteNumber(preservedSnapshot.rangeLowerPrice, trackedPosition?.rangeLowerPrice ?? 0),
    rangeUpperPct: preservedSnapshot.rangeUpperPct ?? trackedPosition?.rangeUpperPct ?? null,
    rangeLowerPct: preservedSnapshot.rangeLowerPct ?? trackedPosition?.rangeLowerPct ?? null,
    deployedQuote,
    entryCostsQuote,
    currentValueQuote,
    accruedFeesQuote: 0,
    claimedFeesQuote,
    openedTxHash: preservedSnapshot.openedTxHash || trackedPosition?.openedTxHash || null,
    openedRunKey: preservedSnapshot.openedRunKey || trackedPosition?.openedRunKey || openedRunKey || null,
    openedAt: preservedSnapshot.openedAt || trackedPosition?.openedAt || null,
    recoveredAt,
    lastSeenAt: observedAt,
    monitorUpdatedAt: observedAt,
    updatedAt: observedAt,
    recoveredFromChain: true,
    recoverySource: 'chain_ownership_sync',
    recoveryTrace: {
      recoveredAt,
      existingSnapshotFound: Boolean(existingSnapshot),
      hadKnownCostBasis: deployedQuote > 0 || entryCostsQuote > 0
    }
  }
}

function deriveRecoveryActions({ executionJournal, positionSnapshots }) {
  const journalEntries = executionJournal?.entries || []
  const positions = positionSnapshots?.positions || []
  const actions = []

  for (const entry of journalEntries) {
    if (entry.status === 'submitted' && !entry.receiptHash) {
      actions.push({
        type: 'reconcile_submitted_execution',
        executionId: entry.executionId,
        txHash: entry.txHash || null
      })
    }
  }

  for (const position of positions) {
    if (position.status === 'open' && !position.lastSeenAt) {
      actions.push({
        type: 'refresh_open_position',
        positionId: String(position.positionId || position.tokenId)
      })
    }
  }

  return actions
}

module.exports = {
  buildRecoveredOpenPositionSnapshot,
  deriveRecoveryActions
}
