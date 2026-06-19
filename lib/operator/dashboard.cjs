'use strict'

const { buildOperatorActions } = require('./actions.cjs')
const { buildPositionCards, normalizeOwnerAddress } = require('./cards.cjs')
const { buildExecutionTimeline } = require('./timeline.cjs')

function pickLatest(items, key) {
  const list = items || []
  return list.length ? list[list.length - 1][key] ?? list[list.length - 1] : null
}

function buildClosedPnlSummary(closeCardsOrBuiltCards) {
  const cards = Array.isArray(closeCardsOrBuiltCards?.closedCards)
    ? closeCardsOrBuiltCards.closedCards
    : (closeCardsOrBuiltCards?.cards || [])

  return cards.reduce((summary, card) => {
    const trusted = card.hasTrustedCloseValuation == null
      ? true
      : Boolean(card.hasTrustedCloseValuation)
    summary.closedPositions += 1
    summary.totalNetProceedsQuote += trusted ? Number(card.netProceedsQuote || 0) : 0
    summary.totalRealizedPnlQuote += trusted ? Number(card.realizedPnlQuote || 0) : 0
    summary.totalFeesQuote += Number(card.feesQuote || 0)
    summary.totalCloseCostsQuote += Number(card.closeCostsQuote || 0)
    summary.totalAutoswapDeltaQuote += Number(card.autoswapDeltaQuote || 0)
    if (!trusted) {
      summary.untrustedValuations += 1
    }
    return summary
  }, {
    closedPositions: 0,
    totalNetProceedsQuote: 0,
    totalRealizedPnlQuote: 0,
    totalFeesQuote: 0,
    totalCloseCostsQuote: 0,
    totalAutoswapDeltaQuote: 0,
    untrustedValuations: 0
  })
}

function buildWalletSummaryFromOpenCards(openCards = []) {
  return openCards.reduce((summary, card) => {
    summary.positions += 1
    summary.totalCostBasisQuote += Number(card.costBasisQuote || 0)
    summary.totalCurrentValueQuote += Number(card.currentValueQuote || 0)
    summary.totalAccruedFeesQuote += Number(card.accruedFeesQuote || 0)
    summary.totalValueQuote += Number(card.totalValueQuote || 0)
    summary.totalUnrealizedPnlQuote += Number(card.unrealizedPnlQuote || 0)
    return summary
  }, {
    positions: 0,
    totalCostBasisQuote: 0,
    totalCurrentValueQuote: 0,
    totalAccruedFeesQuote: 0,
    totalValueQuote: 0,
    totalUnrealizedPnlQuote: 0
  })
}

function buildDashboardState({
  executionJournal,
  snapshotBook,
  monitorSummaryBook,
  pnlSnapshots,
  closeCards,
  discoveryReports,
  executionExtensionSummaries,
  recoveryActions = [],
  runtime = {},
  ownerAddress: explicitOwnerAddress = null
}) {
  const ownerAddress = normalizeOwnerAddress(explicitOwnerAddress || runtime.ownerAddress || runtime.readableAddress)
  const latestDiscoveryReport = pickLatest(discoveryReports?.reports, 'shortlist')
  const latestExecutionExtensions = pickLatest(executionExtensionSummaries?.summaries)
  const latestMonitorSummary = monitorSummaryBook?.summary || {
    openPositions: 0,
    outOfRangePositions: 0,
    stalePositions: 0,
    alerts: []
  }
  const cards = buildPositionCards({
    snapshotBook,
    pnlSnapshots,
    closeCards,
    ownerAddress
  })
  const actions = buildOperatorActions({
    monitorSummary: latestMonitorSummary,
    discoveryShortlist: latestDiscoveryReport,
    executionExtensionsReport: latestExecutionExtensions,
    recoveryActions,
    runtime
  })
  const timeline = buildExecutionTimeline({
    executionJournal,
    closeCards,
    discoveryReports,
    executionExtensionSummaries
  })
  const closedSummary = buildClosedPnlSummary(cards)

  return {
    generatedAt: new Date().toISOString(),
    walletSummary: ownerAddress
      ? buildWalletSummaryFromOpenCards(cards.openCards)
      : (pnlSnapshots?.walletSummary || {
          positions: 0,
          totalCostBasisQuote: 0,
          totalCurrentValueQuote: 0,
          totalAccruedFeesQuote: 0,
          totalValueQuote: 0,
          totalUnrealizedPnlQuote: 0
        }),
    monitorSummary: latestMonitorSummary,
    execution: {
      recentEntries: (executionJournal?.entries || []).slice(-10),
      timeline,
      recoveryActions,
      latestExtensions: latestExecutionExtensions
    },
    discovery: {
      latestShortlist: latestDiscoveryReport
    },
    positions: cards,
    closedSummary,
    actions
  }
}

function buildDashboardStateFromStore(store, {
  recoveryActions = [],
  runtime = {}
} = {}) {
  return buildDashboardState({
    executionJournal: store.loadExecutionJournal(),
    snapshotBook: store.loadPositionSnapshots(),
    monitorSummaryBook: store.loadMonitorSummary(),
    pnlSnapshots: store.loadPnlSnapshots(),
    closeCards: store.loadCloseCards(),
    discoveryReports: store.loadDiscoveryReports(),
    executionExtensionSummaries: store.loadExecutionExtensionSummaries(),
    recoveryActions,
    runtime
  })
}

module.exports = {
  buildClosedPnlSummary,
  buildWalletSummaryFromOpenCards,
  buildDashboardState,
  buildDashboardStateFromStore
}
