'use strict'

function buildLiveReadinessReport({
  validations = {},
  workflow = {},
  actions = {},
  requiredEnv = {},
  recoveryActions = [],
  signerMetadata = {},
  canaryLimits = null
}) {
  const missingEnv = Object.entries(requiredEnv)
    .filter(([, value]) => !value)
    .map(([key]) => key)
  const failedValidations = Object.entries(validations)
    .filter(([, passed]) => passed !== true)
    .map(([key]) => key)
  const signerBlockers = []

  if (signerMetadata.source && signerMetadata.source !== 'keystore') {
    signerBlockers.push(`invalid_live_signer_source:${signerMetadata.source}`)
  }

  if (signerMetadata.source === 'keystore' && signerMetadata.sessionBound !== true) {
    signerBlockers.push('keystore_session_not_bound')
  }

  if (signerMetadata.source === 'keystore' && !signerMetadata.unlockExpiresAt) {
    signerBlockers.push('missing_keystore_unlock_expiry')
  }

  if (signerMetadata.unlockExpiresAt) {
    const unlockExpiresAtMs = Date.parse(signerMetadata.unlockExpiresAt)
    if (!Number.isFinite(unlockExpiresAtMs) || unlockExpiresAtMs <= Date.now()) {
      signerBlockers.push('keystore_session_expired')
    }
  }

  if (signerMetadata.expectedWalletAddress && signerMetadata.actualWalletAddress &&
    String(signerMetadata.expectedWalletAddress).toLowerCase() !== String(signerMetadata.actualWalletAddress).toLowerCase()) {
    signerBlockers.push('wallet_address_mismatch')
  }

  if (signerMetadata.expectedKeystoreWalletId && signerMetadata.actualKeystoreWalletId &&
    String(signerMetadata.expectedKeystoreWalletId) !== String(signerMetadata.actualKeystoreWalletId)) {
    signerBlockers.push('keystore_wallet_id_mismatch')
  }

  const blockers = [
    ...failedValidations.map((key) => `validation_not_passed:${key}`),
    ...missingEnv.map((key) => `missing_env:${key}`),
    ...signerBlockers,
    ...((canaryLimits?.blockers || []).map((blocker) => `canary_limit:${blocker}`)),
    ...(workflow.blocked ? (workflow.blockers || ['workflow_blocked']) : []),
    ...(actions.canExecute === false ? ['actions_do_not_allow_execute'] : []),
    ...(recoveryActions.length > 0 ? ['recovery_actions_pending'] : [])
  ]

  return {
    ready: blockers.length === 0,
    blockers,
    checks: {
      validationsPassed: failedValidations.length === 0,
      envReady: missingEnv.length === 0,
      signerReady: signerBlockers.length === 0,
      canaryReady: (canaryLimits?.blockers || []).length === 0,
      workflowReady: !workflow.blocked,
      actionsReady: actions.canExecute !== false,
      recoveryClear: recoveryActions.length === 0
    }
  }
}

function assertLiveReadiness(payload) {
  const report = buildLiveReadinessReport(payload)

  if (!report.ready) {
    throw new Error(`live readiness blocked: ${report.blockers.join(', ')}`)
  }

  return report
}

module.exports = {
  buildLiveReadinessReport,
  assertLiveReadiness
}
