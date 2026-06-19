'use strict'

const { deriveRecoveryActions } = require('../state/recovery.cjs')
const { buildRecoveryPlan } = require('./recovery_plan.cjs')

function buildRestartRecoverySnapshot({
  executionJournal,
  positionSnapshots,
  dashboard
}) {
  const recoveryActions = deriveRecoveryActions({
    executionJournal,
    positionSnapshots
  })
  const recoveryPlan = buildRecoveryPlan({
    recoveryActions,
    dashboard
  })

  return {
    recoveryActions,
    recoveryPlan,
    blocked: recoveryPlan.blocked
  }
}

function buildRestartRecoverySnapshotFromStore(store, { dashboard }) {
  return buildRestartRecoverySnapshot({
    executionJournal: store.loadExecutionJournal(),
    positionSnapshots: store.loadPositionSnapshots(),
    dashboard
  })
}

module.exports = {
  buildRestartRecoverySnapshot,
  buildRestartRecoverySnapshotFromStore
}
