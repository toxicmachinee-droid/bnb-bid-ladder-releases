'use strict'

function buildRecoveryPlan({
  recoveryActions = [],
  dashboard = {}
}) {
  const steps = []

  for (const action of recoveryActions) {
    if (action.type === 'reconcile_submitted_execution') {
      steps.push({
        type: action.type,
        priority: 'high',
        description: `reconcile submitted execution ${action.executionId || ''}`.trim()
      })
    }

    if (action.type === 'refresh_open_position') {
      steps.push({
        type: action.type,
        priority: 'medium',
        description: `refresh open position ${action.positionId}`
      })
    }
  }

  if (Number(dashboard.monitorSummary?.outOfRangePositions || 0) > 0) {
    steps.push({
      type: 'review_out_of_range_positions',
      priority: 'medium',
      description: 'review open positions that are currently out of range'
    })
  }

  return {
    blocked: steps.length > 0,
    steps
  }
}

module.exports = {
  buildRecoveryPlan
}
