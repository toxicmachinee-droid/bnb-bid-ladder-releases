'use strict'

const { buildPositionCostBasis } = require('./cost_basis.cjs')
const { buildCloseCard } = require('./engine.cjs')

function buildCloseCardFromState({
  positionSnapshot,
  exitValueQuote = 0,
  accruedFeesQuote,
  claimedFeesQuote,
  autoswapDeltaQuote = 0,
  closeCostsQuote = 0,
  exitValueIncludesAccruedFees = false,
  closedAt = new Date().toISOString()
}) {
  const costBasis = buildPositionCostBasis({
    positionId: positionSnapshot.positionId || positionSnapshot.tokenId,
    tokenId: positionSnapshot.tokenId,
    dex: positionSnapshot.dex,
    poolAddress: positionSnapshot.poolAddress,
    quoteSymbol: positionSnapshot.quoteSymbol || 'USDT',
    deployedQuote: Number(positionSnapshot.deployedQuote || 0),
    entryCostsQuote: Number(positionSnapshot.entryCostsQuote || 0),
    openedAt: positionSnapshot.openedAt
  })
  const closeCard = buildCloseCard({
    costBasis,
    exitValueQuote,
    accruedFeesQuote: accruedFeesQuote === undefined
      ? Number(positionSnapshot.accruedFeesQuote || 0)
      : accruedFeesQuote,
    claimedFeesQuote: claimedFeesQuote === undefined
      ? Number(positionSnapshot.claimedFeesQuote || 0)
      : claimedFeesQuote,
    autoswapDeltaQuote,
    closeCostsQuote,
    exitValueIncludesAccruedFees
  })

  return {
    ...closeCard,
    dex: positionSnapshot.dex,
    poolAddress: positionSnapshot.poolAddress,
    protocolVersion: positionSnapshot.protocolVersion || 'v3',
    tokenSymbol: positionSnapshot.tokenSymbol || null,
    tokenId: positionSnapshot.tokenId,
    openedAt: positionSnapshot.openedAt || null,
    openedTxHash: positionSnapshot.openedTxHash || null,
    openedRunKey: positionSnapshot.openedRunKey || positionSnapshot.openedTxHash || null,
    fee: positionSnapshot.fee,
    feeTierLabel: positionSnapshot.feeTierLabel || null,
    closedAt
  }
}

function persistCloseCardFromState(store, payload) {
  const closeCard = buildCloseCardFromState(payload)
  return store.appendCloseCard(closeCard)
}

module.exports = {
  buildCloseCardFromState,
  persistCloseCardFromState
}
