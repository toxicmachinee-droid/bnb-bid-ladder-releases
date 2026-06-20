'use strict'

const { createExecutionStateStore } = require('../state/execution_state.cjs')
const { buildOperatorSnapshot } = require('../operator/snapshot.cjs')

function normalizeRuntimeFromKeystore(keystoreStatus = {}) {
  const address = keystoreStatus.address || keystoreStatus.readableAddress || null
  return {
    keystoreUnlocked: Boolean(keystoreStatus.unlocked || keystoreStatus.active),
    ownerAddress: address,
    readableAddress: address,
    liveEnabled: true,
    remotePlannerRequired: true,
    forkEnabled: false
  }
}

function buildReadOnlyOperatorSnapshotPayload({
  stateDir,
  keystoreStatus = {},
  recoveryActions = []
} = {}) {
  const store = createExecutionStateStore(stateDir)
  const runtime = normalizeRuntimeFromKeystore(keystoreStatus)
  const snapshot = buildOperatorSnapshot({
    executionJournal: store.loadExecutionJournal(),
    snapshotBook: store.loadPositionSnapshots(),
    monitorSummaryBook: store.loadMonitorSummary(),
    pnlSnapshots: store.loadPnlSnapshots(),
    closeCards: store.loadCloseCards(),
    discoveryReports: store.loadDiscoveryReports(),
    executionExtensionSummaries: store.loadExecutionExtensionSummaries(),
    recoveryActions,
    runtime,
    ownerAddress: runtime.ownerAddress
  })

  return {
    ok: true,
    updatedAt: snapshot.generatedAt,
    ...snapshot,
    workflow: {
      ...snapshot.workflow,
      mode: 'public-read-only',
      production: true,
      planner: 'server',
      remotePlannerRequired: true
    },
    dashboard: {
      ...snapshot.dashboard,
      actions: {
        ...(snapshot.dashboard.actions || {}),
        liveEnabled: true,
        remotePlannerRequired: true,
        forkEnabled: false
      }
    }
  }
}

module.exports = {
  buildReadOnlyOperatorSnapshotPayload,
  normalizeRuntimeFromKeystore
}
