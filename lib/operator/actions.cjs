'use strict'

function buildOperatorActions({
  monitorSummary,
  discoveryShortlist,
  executionExtensionsReport,
  recoveryActions = [],
  runtime = {}
}) {
  const alerts = monitorSummary?.alerts || []
  const blockedByDiscovery = Number(discoveryShortlist?.summary?.blocked || 0) > 0 && Number(discoveryShortlist?.summary?.accepted || 0) === 0
  const blockedByExecution = executionExtensionsReport?.blockerCount > 0
  const blockedByRecovery = recoveryActions.length > 0
  const walletUnlocked = runtime.keystoreUnlocked == null ? null : Boolean(runtime.keystoreUnlocked)
  const forkReady = runtime.forkReady == null ? null : Boolean(runtime.forkReady)
  const warnings = [
    ...alerts.map((alert) => alert.type),
    ...(Number(discoveryShortlist?.summary?.warned || 0) > 0 ? ['discovery_warned_candidates'] : []),
    ...(executionExtensionsReport?.holdCount > 0 ? ['execution_hold_required'] : []),
    ...(walletUnlocked === false ? ['keystore_locked'] : [])
  ]
  const blockers = [
    ...(blockedByDiscovery ? ['no discovery candidate passed price sanity gate'] : []),
    ...(blockedByExecution ? ['execution extension policy produced blocking action'] : []),
    ...(blockedByRecovery ? ['recovery actions are pending before execution'] : []),
    ...(walletUnlocked === false ? ['keystore session is locked'] : [])
  ]

  return {
    canValidate: true,
    canDryRun: !blockedByRecovery,
    canExecute: !blockedByDiscovery && !blockedByExecution && !blockedByRecovery && walletUnlocked !== false,
    canClaim: walletUnlocked !== false,
    canCloseLive: walletUnlocked !== false,
    canCollectFork: forkReady !== false,
    canMonitor: Number(monitorSummary?.openPositions || 0) > 0,
    canExit: Number(monitorSummary?.openPositions || 0) > 0 && !blockedByRecovery,
    blocked: blockedByDiscovery || blockedByExecution || blockedByRecovery || walletUnlocked === false,
    blockers,
    warnings
  }
}

module.exports = {
  buildOperatorActions
}
