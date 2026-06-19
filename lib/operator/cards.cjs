'use strict'

const { ethers } = require('ethers')

function normalizeOwnerAddress(value) {
  const raw = String(value || '').trim()
  if (!raw) {
    return null
  }
  try {
    return ethers.getAddress(raw)
  } catch (_) {
    return raw.toLowerCase()
  }
}

function getPositionOwnerAddress(entry = {}, fallback = null) {
  const source = entry || {}
  return normalizeOwnerAddress(
    source.ownerAddress
    || source.walletAddress
    || source.owner
    || fallback
  )
}

function ownerMatchesFilter(entry = {}, ownerAddress = null, fallback = null) {
  const filterOwner = normalizeOwnerAddress(ownerAddress)
  if (!filterOwner) {
    return true
  }
  const entryOwner = getPositionOwnerAddress(entry, fallback)
  return Boolean(entryOwner) && entryOwner.toLowerCase() === filterOwner.toLowerCase()
}

function buildOpenPositionCard(positionSnapshot, pnlRecord) {
  return {
    positionId: String(positionSnapshot.positionId || positionSnapshot.tokenId),
    tokenId: positionSnapshot.tokenId,
    ownerAddress: getPositionOwnerAddress(positionSnapshot),
    dex: positionSnapshot.dex,
    protocolVersion: positionSnapshot.protocolVersion || 'v3',
    poolModel: positionSnapshot.poolModel || (String(positionSnapshot.protocolVersion || 'v3').toLowerCase() === 'v2' ? 'xyk' : 'cl'),
    supportsBidAsk: positionSnapshot.supportsBidAsk == null
      ? ['v3', 'v4'].includes(String(positionSnapshot.protocolVersion || 'v3').toLowerCase())
      : Boolean(positionSnapshot.supportsBidAsk),
    status: positionSnapshot.status,
    poolAddress: positionSnapshot.poolAddress,
    tokenSymbol: positionSnapshot.tokenSymbol || 'TOKEN',
    inputTokenAddress: positionSnapshot.inputTokenAddress || null,
    token0Address: positionSnapshot.token0Address || null,
    token1Address: positionSnapshot.token1Address || null,
    outOfRange: Boolean(positionSnapshot.outOfRange),
    targetPrice: Number(positionSnapshot.targetPrice || 0),
    currentPoolPrice: Number(positionSnapshot.currentPoolPrice || positionSnapshot.targetPrice || 0),
    currentTick: positionSnapshot.currentTick,
    tickLower: positionSnapshot.tickLower,
    tickUpper: positionSnapshot.tickUpper,
    fee: positionSnapshot.fee,
    feeTierLabel: positionSnapshot.feeTierLabel || formatFeeTierLabelFromRawFee(positionSnapshot.fee),
    liquidity: positionSnapshot.liquidity,
    quoteSymbol: pnlRecord?.costBasis?.quoteSymbol || positionSnapshot.quoteSymbol || 'USDT',
    depositTokenUsdPrice: Number(positionSnapshot.depositTokenUsdPrice || 0),
    costBasisQuote: Number(pnlRecord?.costBasis?.totalCostBasisQuote || 0),
    hasKnownCostBasis: Boolean(pnlRecord?.unrealized?.hasKnownCostBasis),
    hasKnownValuation: pnlRecord?.unrealized?.hasKnownValuation == null
      ? true
      : Boolean(pnlRecord.unrealized.hasKnownValuation),
    hasKnownUnrealizedPnl: pnlRecord?.unrealized?.hasKnownUnrealizedPnl == null
      ? Boolean(pnlRecord?.unrealized?.hasKnownCostBasis)
      : Boolean(pnlRecord.unrealized.hasKnownUnrealizedPnl),
    currentValueQuote: Number(pnlRecord?.unrealized?.currentValueQuote || 0),
    accruedFeesQuote: Number(pnlRecord?.unrealized?.accruedFeesQuote || 0),
    claimedFeesQuote: Number(positionSnapshot.claimedFeesQuote || 0),
    totalValueQuote: Number(pnlRecord?.unrealized?.totalValueQuote || 0),
    unrealizedPnlQuote: Number(pnlRecord?.unrealized?.pnlQuote || 0),
    unrealizedPnlPct: Number(pnlRecord?.unrealized?.pnlPct || 0),
    rangeUpperPrice: Number(positionSnapshot.rangeUpperPrice || 0),
    rangeLowerPrice: Number(positionSnapshot.rangeLowerPrice || 0),
    rangeUpperPct: positionSnapshot.rangeUpperPct == null ? null : Number(positionSnapshot.rangeUpperPct),
    rangeLowerPct: positionSnapshot.rangeLowerPct == null ? null : Number(positionSnapshot.rangeLowerPct),
    lastSeenAt: positionSnapshot.lastSeenAt || null,
    openedAt: positionSnapshot.openedAt || null,
    openedTxHash: positionSnapshot.openedTxHash || null,
    openedRunKey: positionSnapshot.openedRunKey || null,
    recoveredAt: positionSnapshot.recoveredAt || null,
    recoveredFromChain: Boolean(positionSnapshot.recoveredFromChain),
    valuationStatus: positionSnapshot.valuationStatus || 'known',
    monitorError: positionSnapshot.monitorError || null
  }
}

function buildClosedPositionCard(closeCard, positionSnapshot = null) {
  const hasExplicitNetProceeds = Object.prototype.hasOwnProperty.call(closeCard, 'netProceedsQuote')
    || Object.prototype.hasOwnProperty.call(closeCard, 'exitValueQuote')
  const hasExplicitRealizedPnl = Object.prototype.hasOwnProperty.call(closeCard, 'realizedPnlQuote')
  const costBasisQuote = Number(closeCard.costBasisQuote || closeCard.deployedQuote || positionSnapshot?.costBasisQuote || 0)
  const reconciliationStatus = String(closeCard.reconciliationStatus || '')
  const exitValueIncludesAccruedFees = Boolean(closeCard.exitValueIncludesAccruedFees)
    || reconciliationStatus === 'reconciled_receipt_transfers'
  const hasReceiptIncludedAccruedFees = exitValueIncludesAccruedFees
    && Object.prototype.hasOwnProperty.call(closeCard, 'exitValueQuote')
  const repairedNetProceedsQuote = hasReceiptIncludedAccruedFees
    ? Number(closeCard.exitValueQuote || 0)
      + Number(closeCard.claimedFeesQuote || 0)
      + Number(closeCard.autoswapDeltaQuote || 0)
      - Number(closeCard.closeCostsQuote || 0)
    : Number(closeCard.netProceedsQuote || 0)
  const netProceedsQuote = repairedNetProceedsQuote
  const realizedPnlQuote = hasReceiptIncludedAccruedFees
    ? netProceedsQuote - costBasisQuote
    : Number(closeCard.realizedPnlQuote || 0)
  const realizedPnlPct = hasReceiptIncludedAccruedFees && costBasisQuote > 0
    ? (realizedPnlQuote / costBasisQuote) * 100
    : Number(closeCard.realizedPnlPct || 0)
  const hasMissingCloseValuation = !hasExplicitNetProceeds || !hasExplicitRealizedPnl
  const hasSuspiciousCloseValuation = costBasisQuote > 0
    && costBasisQuote < 5
    && netProceedsQuote > Math.max(costBasisQuote * 10, costBasisQuote + 5)
    && Math.abs(realizedPnlPct) > 1000
  const hasEstimatedCloseValuation = Boolean(closeCard.proceedsEstimated)
    || reconciliationStatus.startsWith('estimated_')
    || String(closeCard.reconciliationStatus || '').startsWith('closed_onchain_')
  const hasTrustedCloseValuation = !hasMissingCloseValuation && !hasSuspiciousCloseValuation && !hasEstimatedCloseValuation
  const rawFee = closeCard.fee == null ? positionSnapshot?.fee : closeCard.fee
  const feeTierLabel = closeCard.feeTierLabel
    || positionSnapshot?.feeTierLabel
    || formatFeeTierLabelFromRawFee(rawFee)

  return {
    positionId: String(closeCard.positionId),
    tokenId: closeCard.tokenId || null,
    ownerAddress: getPositionOwnerAddress(closeCard, getPositionOwnerAddress(positionSnapshot)),
    dex: closeCard.dex || null,
    protocolVersion: closeCard.protocolVersion || positionSnapshot?.protocolVersion || 'v3',
    poolAddress: closeCard.poolAddress || null,
    tokenSymbol: closeCard.tokenSymbol || positionSnapshot?.tokenSymbol || 'TOKEN',
    inputTokenAddress: closeCard.inputTokenAddress || positionSnapshot?.inputTokenAddress || null,
    token0Address: closeCard.token0Address || positionSnapshot?.token0Address || null,
    token1Address: closeCard.token1Address || positionSnapshot?.token1Address || null,
    depositTokenAddress: closeCard.depositTokenAddress || positionSnapshot?.depositTokenAddress || null,
    quoteSymbol: closeCard.quoteSymbol || 'USDT',
    openedAt: closeCard.openedAt || positionSnapshot?.openedAt || null,
    openedTxHash: closeCard.openedTxHash || positionSnapshot?.openedTxHash || null,
    openedRunKey: closeCard.openedRunKey || positionSnapshot?.openedRunKey || closeCard.openedTxHash || positionSnapshot?.openedTxHash || null,
    fee: rawFee,
    feeTierLabel,
    closedAt: closeCard.closedAt || null,
    recordedAt: closeCard.recordedAt || null,
    txHash: closeCard.txHash || closeCard.closeTxHash || null,
    deployedQuote: Number(closeCard.deployedQuote || positionSnapshot?.deployedQuote || costBasisQuote || 0),
    costBasisQuote,
    netProceedsQuote,
    realizedPnlQuote,
    realizedPnlPct,
    feesQuote: Number(closeCard.feesQuote || 0),
    closeCostsQuote: Number(closeCard.closeCostsQuote || 0),
    autoswapDeltaQuote: Number(closeCard.autoswapDeltaQuote || 0),
    exitValueIncludesAccruedFees,
    proceedsEstimated: Boolean(closeCard.proceedsEstimated),
    reconciliationStatus: closeCard.reconciliationStatus || null,
    hasTrustedCloseValuation,
    closeValuationWarning: hasMissingCloseValuation
      ? 'close valuation missing from persisted close card'
      : hasSuspiciousCloseValuation
        ? 'close valuation outlier hidden until refreshed from live receipts'
        : (hasEstimatedCloseValuation ? 'close valuation estimated from recovered on-chain state' : null)
  }
}

function formatFeeTierLabelFromRawFee(fee) {
  const numeric = Number(fee || 0)
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null
  }
  return `${(numeric / 10000).toFixed(2)}%`
}

function closeCardIdentity(card = {}) {
  const tokenId = String(card.tokenId || '').trim()
  if (tokenId) {
    return `token:${tokenId}`
  }
  const positionId = String(card.positionId || '').trim()
  return positionId ? `position:${positionId}` : null
}

function closeCardTimestamp(card = {}) {
  const timestamp = Date.parse(card.closedAt || card.recordedAt || '')
  return Number.isFinite(timestamp) ? timestamp : 0
}

function compareCloseCardsNewestFirst(left, right) {
  const byTime = closeCardTimestamp(right) - closeCardTimestamp(left)
  if (byTime !== 0) {
    return byTime
  }
  const byTxPresence = Number(Boolean(right.txHash || right.closeTxHash)) - Number(Boolean(left.txHash || left.closeTxHash))
  if (byTxPresence !== 0) {
    return byTxPresence
  }
  return String(right.tokenId || right.positionId || '').localeCompare(String(left.tokenId || left.positionId || ''))
}

function dedupeCloseCards(cards = []) {
  const byIdentity = new Map()
  const anonymousCards = []

  for (const card of cards || []) {
    const key = closeCardIdentity(card)
    if (!key) {
      anonymousCards.push(card)
      continue
    }

    const existing = byIdentity.get(key)
    if (!existing) {
      byIdentity.set(key, card)
      continue
    }

    const [older, newer] = compareCloseCardsNewestFirst(existing, card) <= 0
      ? [card, existing]
      : [existing, card]
    byIdentity.set(key, {
      ...older,
      ...newer,
      txHash: newer.txHash || newer.closeTxHash || older.txHash || older.closeTxHash || null
    })
  }

  return anonymousCards
    .concat([...byIdentity.values()])
    .sort(compareCloseCardsNewestFirst)
}

function buildRecoveredCloseCardFromSnapshot(positionSnapshot = {}) {
  const costBasisQuote = Number(positionSnapshot.costBasisQuote || positionSnapshot.deployedQuote || 0)
  const realizedPnlQuote = Number(positionSnapshot.realizedPnlQuote || 0)
  const netProceedsQuote = Number(positionSnapshot.netProceedsQuote || costBasisQuote + realizedPnlQuote || 0)
  return {
    positionId: String(positionSnapshot.positionId || positionSnapshot.tokenId),
    tokenId: positionSnapshot.tokenId || positionSnapshot.positionId || null,
    ownerAddress: getPositionOwnerAddress(positionSnapshot),
    dex: positionSnapshot.dex || null,
    protocolVersion: positionSnapshot.protocolVersion || 'v3',
    poolAddress: positionSnapshot.poolAddress || null,
    tokenSymbol: positionSnapshot.tokenSymbol || 'TOKEN',
    inputTokenAddress: positionSnapshot.inputTokenAddress || null,
    token0Address: positionSnapshot.token0Address || null,
    token1Address: positionSnapshot.token1Address || null,
    depositTokenAddress: positionSnapshot.depositTokenAddress || null,
    quoteSymbol: positionSnapshot.quoteSymbol || 'USDT',
    closedAt: positionSnapshot.closedAt || positionSnapshot.lastSeenAt || positionSnapshot.updatedAt || null,
    recordedAt: positionSnapshot.closedAt || null,
    txHash: positionSnapshot.closeTxHash || null,
    costBasisQuote,
    netProceedsQuote,
    realizedPnlQuote,
    realizedPnlPct: Number(positionSnapshot.realizedPnlPct || 0),
    feesQuote: Number(positionSnapshot.claimedFeesQuote || positionSnapshot.accruedFeesQuote || 0),
    closeCostsQuote: Number(positionSnapshot.closeCostsQuote || 0),
    autoswapDeltaQuote: Number(positionSnapshot.autoswapDeltaQuote || 0),
    reconciliationStatus: positionSnapshot.reconciliationStatus || 'closed_snapshot_recovered',
    proceedsEstimated: true,
    closeValuationWarning: 'close card recovered from closed position snapshot; live close valuation is estimated until refreshed'
  }
}

function buildPositionCards({
  snapshotBook,
  pnlSnapshots,
  closeCards,
  ownerAddress = null
}) {
  const pnlByPositionId = new Map((pnlSnapshots?.positions || []).map((record) => [String(record.positionId), record]))
  const snapshotByPositionId = new Map((snapshotBook?.positions || []).map((position) => [String(position.positionId || position.tokenId), position]))
  const rawCloseCards = (closeCards?.cards || []).filter((card) => {
    const snapshot = snapshotByPositionId.get(String(card.positionId || card.tokenId))
    return ownerMatchesFilter(card, ownerAddress, getPositionOwnerAddress(snapshot))
  })
  const closeCardKeys = new Set(rawCloseCards.map(closeCardIdentity).filter(Boolean))
  const recoveredCloseCards = (snapshotBook?.positions || [])
    .filter((position) => ownerMatchesFilter(position, ownerAddress))
    .filter((position) => String(position.status || '').toLowerCase() === 'closed')
    .filter((position) => {
      const key = closeCardIdentity(position)
      return key && !closeCardKeys.has(key)
    })
    .map((position) => buildRecoveredCloseCardFromSnapshot(position))
  const openCards = (snapshotBook?.positions || [])
    .filter((position) => ownerMatchesFilter(position, ownerAddress))
    .filter((position) => position.status !== 'closed')
    .map((position) => buildOpenPositionCard(position, pnlByPositionId.get(String(position.positionId || position.tokenId))))
  const closedPositionCards = dedupeCloseCards(rawCloseCards.concat(recoveredCloseCards))
    .map((card) => buildClosedPositionCard(card, snapshotByPositionId.get(String(card.positionId || card.tokenId))))

  return {
    openCards,
    closedCards: closedPositionCards
  }
}

module.exports = {
  buildOpenPositionCard,
  buildClosedPositionCard,
  buildRecoveredCloseCardFromSnapshot,
  normalizeOwnerAddress,
  ownerMatchesFilter,
  dedupeCloseCards,
  buildPositionCards
}
