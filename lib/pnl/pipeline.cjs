'use strict'

const { buildPositionPnlRecord } = require('./engine.cjs')
const { buildWalletPnlSummary } = require('./summary.cjs')

function buildPnlRecordsFromSnapshots(snapshotBook, { quoteSymbol = 'USDT' } = {}) {
  const positions = snapshotBook?.positions || []

  return positions
    .filter((position) => position.status !== 'closed')
    .map((position) => buildPositionPnlRecord({
      positionId: position.positionId || position.tokenId,
      tokenId: position.tokenId,
      dex: position.dex,
      poolAddress: position.poolAddress,
      quoteSymbol: position.quoteSymbol || quoteSymbol,
      deployedQuote: Number(position.deployedQuote || 0),
      entryCostsQuote: Number(position.entryCostsQuote || 0),
      currentValueQuote: Number(position.currentValueQuote || 0),
      accruedFeesQuote: Number(position.accruedFeesQuote || 0),
      claimedFeesQuote: Number(position.claimedFeesQuote || 0),
      hasKnownValuation: String(position.valuationStatus || 'known') !== 'unavailable'
    }))
}

function persistPnlFromSnapshots(store, snapshotBook, options = {}, traceContext = null) {
  const records = buildPnlRecordsFromSnapshots(snapshotBook, options)
  const walletSummary = buildWalletPnlSummary(records)

  const pnlBook = store.savePnlSnapshots({
    version: 1,
    positions: records.map((record) => ({
      positionId: record.costBasis.positionId,
      tokenId: record.costBasis.tokenId,
      costBasis: record.costBasis,
      unrealized: record.unrealized
    })),
    walletSummary
  })

  if (store?.appendDiagnosticTrace) {
    store.appendDiagnosticTrace({
      kind: 'pnl_snapshot_persisted',
      traceId: traceContext?.traceId || null,
      positions: Number(walletSummary.positions || 0),
      totalCostBasisQuote: Number(walletSummary.totalCostBasisQuote || 0),
      totalCurrentValueQuote: Number(walletSummary.totalCurrentValueQuote || 0),
      totalAccruedFeesQuote: Number(walletSummary.totalAccruedFeesQuote || 0),
      totalValueQuote: Number(walletSummary.totalValueQuote || 0),
      totalUnrealizedPnlQuote: Number(walletSummary.totalUnrealizedPnlQuote || 0),
      positionsWithKnownCostBasis: (pnlBook.positions || []).filter((position) => Boolean(position?.unrealized?.hasKnownCostBasis)).length
    })
  }

  return pnlBook
}

module.exports = {
  buildPnlRecordsFromSnapshots,
  persistPnlFromSnapshots
}
