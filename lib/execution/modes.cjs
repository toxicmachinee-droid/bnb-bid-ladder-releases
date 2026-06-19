'use strict'

const EXECUTION_MODES = Object.freeze({
  DRY_RUN: 'dry-run',
  LIVE: 'live'
})

function normalizeExecutionMode(mode) {
  const normalized = String(mode || EXECUTION_MODES.DRY_RUN).trim().toLowerCase()

  if (normalized === EXECUTION_MODES.DRY_RUN || normalized === EXECUTION_MODES.LIVE) {
    return normalized
  }

  throw new Error(`unsupported execution mode "${mode}"`)
}

function isLiveExecution(mode) {
  return normalizeExecutionMode(mode) === EXECUTION_MODES.LIVE
}

function assertLiveExecutionAllowed({ mode, approved = false, validationPassed = false }) {
  const normalizedMode = normalizeExecutionMode(mode)

  if (normalizedMode !== EXECUTION_MODES.LIVE) {
    return normalizedMode
  }

  if (!approved) {
    throw new Error('live execution requires explicit approval')
  }

  if (!validationPassed) {
    throw new Error('live execution requires validation pass')
  }

  return normalizedMode
}

module.exports = {
  EXECUTION_MODES,
  normalizeExecutionMode,
  isLiveExecution,
  assertLiveExecutionAllowed
}
