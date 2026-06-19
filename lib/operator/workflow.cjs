'use strict'

function buildOperatorWorkflowState({
  walletSummary,
  monitorSummary,
  actions,
  positions,
  execution,
  discovery
}) {
  const openCards = positions?.openCards || []
  const closedCards = positions?.closedCards || []
  const recoveryActions = execution?.recoveryActions || []
  const latestShortlist = discovery?.latestShortlist || null
  const latestExtensions = execution?.latestExtensions || null

  let nextStep = 'validate'

  if (recoveryActions.length > 0) {
    nextStep = 'recover'
  } else if (Number(walletSummary?.positions || 0) === 0 && (!latestShortlist || Number(latestShortlist.summary?.accepted || 0) === 0)) {
    nextStep = 'discover'
  } else if (actions?.canExecute && Number(walletSummary?.positions || 0) === 0) {
    nextStep = 'execute'
  } else if (actions?.canMonitor && openCards.length > 0) {
    nextStep = 'monitor'
  } else if (latestExtensions?.readyToExecute) {
    nextStep = 'execute_extension'
  }

  return {
    phase: recoveryActions.length > 0 ? 'recovery' : openCards.length > 0 ? 'active_positions' : 'ready',
    nextStep,
    hasOpenPositions: openCards.length > 0,
    hasClosedPositions: closedCards.length > 0,
    outOfRangePositions: Number(monitorSummary?.outOfRangePositions || 0),
    stalePositions: Number(monitorSummary?.stalePositions || 0),
    blocked: Boolean(actions?.blocked),
    blockers: actions?.blockers || [],
    warnings: actions?.warnings || []
  }
}

module.exports = {
  buildOperatorWorkflowState
}
