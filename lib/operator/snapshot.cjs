'use strict'

const { buildDashboardState } = require('./dashboard.cjs')
const { buildExecutionTimeline } = require('./timeline.cjs')
const { buildOperatorWorkflowState } = require('./workflow.cjs')

function buildOperatorSnapshot(payload) {
  const dashboard = buildDashboardState(payload)
  const timeline = buildExecutionTimeline({
    executionJournal: payload.executionJournal,
    closeCards: payload.closeCards,
    discoveryReports: payload.discoveryReports,
    executionExtensionSummaries: payload.executionExtensionSummaries
  })
  const workflow = buildOperatorWorkflowState({
    walletSummary: dashboard.walletSummary,
    monitorSummary: dashboard.monitorSummary,
    actions: dashboard.actions,
    positions: dashboard.positions,
    execution: dashboard.execution,
    discovery: dashboard.discovery
  })

  return {
    generatedAt: new Date().toISOString(),
    dashboard,
    timeline,
    workflow
  }
}

function buildOperatorSnapshotFromStore(store, { recoveryActions = [] } = {}) {
  return buildOperatorSnapshot({
    executionJournal: store.loadExecutionJournal(),
    snapshotBook: store.loadPositionSnapshots(),
    monitorSummaryBook: store.loadMonitorSummary(),
    pnlSnapshots: store.loadPnlSnapshots(),
    closeCards: store.loadCloseCards(),
    discoveryReports: store.loadDiscoveryReports(),
    executionExtensionSummaries: store.loadExecutionExtensionSummaries(),
    recoveryActions
  })
}

function persistOperatorSnapshot(store, payload) {
  if (!store?.appendDashboardSnapshot) {
    throw new Error('persistOperatorSnapshot requires a state store with appendDashboardSnapshot')
  }

  return store.appendDashboardSnapshot(buildOperatorSnapshot(payload))
}

module.exports = {
  buildOperatorSnapshot,
  buildOperatorSnapshotFromStore,
  persistOperatorSnapshot
}
