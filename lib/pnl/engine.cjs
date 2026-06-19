'use strict'

const { buildPositionCostBasis, toFiniteNumber } = require('./cost_basis.cjs')

function calculateUnrealizedPnl({
  costBasis,
  currentValueQuote = 0,
  accruedFeesQuote = 0,
  claimedFeesQuote = 0,
  hasKnownValuation = true
}) {
  const currentValue = toFiniteNumber(currentValueQuote)
  const accruedFees = toFiniteNumber(accruedFeesQuote)
  const claimedFees = toFiniteNumber(claimedFeesQuote)
  const totalValueQuote = currentValue + accruedFees + claimedFees
  const totalCostBasisQuote = toFiniteNumber(costBasis.totalCostBasisQuote)
  const hasKnownCostBasis = totalCostBasisQuote > 0
  const valuationKnown = Boolean(hasKnownValuation)
  const hasKnownUnrealizedPnl = hasKnownCostBasis && valuationKnown
  const pnlQuote = hasKnownUnrealizedPnl
    ? totalValueQuote - totalCostBasisQuote
    : 0
  const pnlPct = hasKnownUnrealizedPnl
    ? pnlQuote / costBasis.totalCostBasisQuote * 100
    : 0

  return {
    positionId: costBasis.positionId,
    quoteSymbol: costBasis.quoteSymbol,
    hasKnownCostBasis,
    hasKnownValuation: valuationKnown,
    hasKnownUnrealizedPnl,
    currentValueQuote: currentValue,
    accruedFeesQuote: accruedFees,
    claimedFeesQuote: claimedFees,
    totalValueQuote,
    pnlQuote,
    pnlPct
  }
}

function calculateRealizedPnl({
  costBasis,
  exitValueQuote = 0,
  accruedFeesQuote = 0,
  claimedFeesQuote = 0,
  autoswapDeltaQuote = 0,
  closeCostsQuote = 0,
  exitValueIncludesAccruedFees = false
}) {
  const exitValue = toFiniteNumber(exitValueQuote)
  const accruedFees = toFiniteNumber(accruedFeesQuote)
  const claimedFees = toFiniteNumber(claimedFeesQuote)
  const autoswapDelta = toFiniteNumber(autoswapDeltaQuote)
  const closeCosts = toFiniteNumber(closeCostsQuote)
  const unclaimedFeesToAdd = exitValueIncludesAccruedFees ? 0 : accruedFees
  const grossProceedsQuote = exitValue + unclaimedFeesToAdd + claimedFees + autoswapDelta
  const netProceedsQuote = grossProceedsQuote - closeCosts
  const pnlQuote = netProceedsQuote - toFiniteNumber(costBasis.totalCostBasisQuote)
  const pnlPct = costBasis.totalCostBasisQuote > 0
    ? pnlQuote / costBasis.totalCostBasisQuote * 100
    : 0

  return {
    positionId: costBasis.positionId,
    quoteSymbol: costBasis.quoteSymbol,
    exitValueQuote: exitValue,
    accruedFeesQuote: accruedFees,
    claimedFeesQuote: claimedFees,
    totalFeesQuote: accruedFees + claimedFees,
    exitValueIncludesAccruedFees: Boolean(exitValueIncludesAccruedFees),
    autoswapDeltaQuote: autoswapDelta,
    closeCostsQuote: closeCosts,
    grossProceedsQuote,
    netProceedsQuote,
    pnlQuote,
    pnlPct
  }
}

function buildCloseCard({
  costBasis,
  exitValueQuote = 0,
  accruedFeesQuote = 0,
  claimedFeesQuote = 0,
  autoswapDeltaQuote = 0,
  closeCostsQuote = 0,
  exitValueIncludesAccruedFees = false
}) {
  const realized = calculateRealizedPnl({
    costBasis,
    exitValueQuote,
    accruedFeesQuote,
    claimedFeesQuote,
    autoswapDeltaQuote,
    closeCostsQuote,
    exitValueIncludesAccruedFees
  })

  return {
    positionId: costBasis.positionId,
    quoteSymbol: costBasis.quoteSymbol,
    deployedQuote: costBasis.deployedQuote,
    costBasisQuote: costBasis.totalCostBasisQuote,
    feesQuote: realized.totalFeesQuote,
    accruedFeesQuote: realized.accruedFeesQuote,
    claimedFeesQuote: realized.claimedFeesQuote,
    exitValueQuote: realized.exitValueQuote,
    exitValueIncludesAccruedFees: realized.exitValueIncludesAccruedFees,
    autoswapDeltaQuote: realized.autoswapDeltaQuote,
    closeCostsQuote: realized.closeCostsQuote,
    netProceedsQuote: realized.netProceedsQuote,
    realizedPnlQuote: realized.pnlQuote,
    realizedPnlPct: realized.pnlPct
  }
}

function buildPositionPnlRecord({
  positionId,
  tokenId,
  dex,
  poolAddress,
  quoteSymbol,
  deployedQuote,
  entryCostsQuote,
  currentValueQuote,
  accruedFeesQuote,
  claimedFeesQuote,
  hasKnownValuation = true
}) {
  const costBasis = buildPositionCostBasis({
    positionId,
    tokenId,
    dex,
    poolAddress,
    quoteSymbol,
    deployedQuote,
    entryCostsQuote
  })
  const unrealized = calculateUnrealizedPnl({
    costBasis,
    currentValueQuote,
    accruedFeesQuote,
    claimedFeesQuote,
    hasKnownValuation
  })

  return {
    costBasis,
    unrealized
  }
}

module.exports = {
  calculateUnrealizedPnl,
  calculateRealizedPnl,
  buildCloseCard,
  buildPositionPnlRecord
}
