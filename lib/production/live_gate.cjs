'use strict'

const { EXECUTION_MODES, normalizeExecutionMode } = require('../execution/modes.cjs')
const { assertPreLiveReady } = require('./prelive_gate.cjs')

function issueLivePermit({
  approver = 'operator',
  reason = 'manual_live_approval',
  ttlMs = 5 * 60 * 1000,
  issuedAt = new Date().toISOString()
} = {}) {
  return {
    approver,
    reason,
    issuedAt,
    expiresAt: new Date(Date.parse(issuedAt) + Math.max(1, ttlMs)).toISOString()
  }
}

function isLivePermitValid(livePermit, now = new Date().toISOString()) {
  if (!livePermit?.issuedAt || !livePermit?.expiresAt) {
    return false
  }

  const nowTs = Date.parse(now)
  const issuedTs = Date.parse(livePermit.issuedAt)
  const expiresTs = Date.parse(livePermit.expiresAt)

  return Number.isFinite(nowTs) &&
    Number.isFinite(issuedTs) &&
    Number.isFinite(expiresTs) &&
    nowTs >= issuedTs &&
    nowTs <= expiresTs
}

function assertLiveExecutionGate({
  mode,
  livePermit,
  now,
  signerMetadata,
  ...assessmentPayload
}) {
  const normalizedMode = normalizeExecutionMode(mode)

  if (normalizedMode !== EXECUTION_MODES.LIVE) {
    return {
      mode: normalizedMode,
      permitRequired: false,
      permitValid: true,
      readiness: null
    }
  }

  const readiness = assertPreLiveReady({
    mode: normalizedMode,
    signerMetadata,
    ...assessmentPayload
  })

  if (!isLivePermitValid(livePermit, now)) {
    throw new Error('live execution requires a valid unexpired live permit')
  }

  return {
    mode: normalizedMode,
    permitRequired: true,
    permitValid: true,
    readiness
  }
}

module.exports = {
  issueLivePermit,
  isLivePermitValid,
  assertLiveExecutionGate
}
