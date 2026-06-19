'use strict'

function buildWalletPnlSummary(records) {
  const normalized = records || []

  return normalized.reduce((summary, record) => {
    const hasKnownUnrealizedPnl = Boolean(record.unrealized?.hasKnownUnrealizedPnl)
    summary.positions += 1
    summary.totalCostBasisQuote += Number(record.costBasis?.totalCostBasisQuote || 0)
    summary.totalCurrentValueQuote += Number(record.unrealized?.currentValueQuote || 0)
    summary.totalAccruedFeesQuote += Number(record.unrealized?.accruedFeesQuote || 0)
    summary.totalClaimedFeesQuote += Number(record.unrealized?.claimedFeesQuote || 0)
    summary.totalValueQuote += Number(record.unrealized?.totalValueQuote || 0)
    summary.totalUnrealizedPnlQuote += hasKnownUnrealizedPnl ? Number(record.unrealized?.pnlQuote || 0) : 0
    if (hasKnownUnrealizedPnl) {
      summary.positionsWithKnownUnrealizedPnl += 1
    }
    return summary
  }, {
    positions: 0,
    positionsWithKnownUnrealizedPnl: 0,
    totalCostBasisQuote: 0,
    totalCurrentValueQuote: 0,
    totalAccruedFeesQuote: 0,
    totalClaimedFeesQuote: 0,
    totalValueQuote: 0,
    totalUnrealizedPnlQuote: 0
  })
}

module.exports = {
  buildWalletPnlSummary
}
