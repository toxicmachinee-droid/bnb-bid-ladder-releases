'use strict'

const { EXECUTION_MODES, normalizeExecutionMode } = require('../execution/modes.cjs')

function maskSecret(value) {
  if (!value) {
    return null
  }

  const stringValue = String(value)

  if (stringValue.length <= 8) {
    return '***'
  }

  return `${stringValue.slice(0, 4)}...${stringValue.slice(-4)}`
}

function buildRequiredEnv({ mode = EXECUTION_MODES.DRY_RUN } = {}) {
  const normalizedMode = normalizeExecutionMode(mode)
  const base = ['BSC_RPC_URL']

  if (normalizedMode === EXECUTION_MODES.LIVE) {
    return [
      ...base,
      'BOT_KEYSTORE_WALLET_ID',
      'BOT_WALLET_ADDRESS'
    ]
  }

  return base
}

function validateEnvironment(env = process.env, { mode = EXECUTION_MODES.DRY_RUN } = {}) {
  const requiredKeys = buildRequiredEnv({ mode })
  const missingKeys = requiredKeys.filter((key) => !env[key])
  const normalizedMode = normalizeExecutionMode(mode)
  const liveUsesRawPrivateKey = normalizedMode === EXECUTION_MODES.LIVE && Boolean(env?.BOT_PRIVATE_KEY)

  return {
    mode: normalizedMode,
    ok: missingKeys.length === 0 && !liveUsesRawPrivateKey,
    requiredKeys,
    missingKeys: [
      ...missingKeys,
      ...(liveUsesRawPrivateKey ? ['BOT_PRIVATE_KEY_DEPRECATED_FOR_LIVE'] : [])
    ],
    flags: {
      liveUsesRawPrivateKey
    },
    snapshot: requiredKeys.reduce((result, key) => {
      const value = env[key]
      result[key] = key.toLowerCase().includes('key') ? maskSecret(value) : value || null
      return result
    }, {
      BOT_PRIVATE_KEY: liveUsesRawPrivateKey ? 'deprecated_for_live' : null
    })
  }
}

module.exports = {
  maskSecret,
  buildRequiredEnv,
  validateEnvironment
}
