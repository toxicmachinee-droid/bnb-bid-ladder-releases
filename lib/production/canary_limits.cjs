'use strict'

const fs = require('fs')
const path = require('path')
const { EXECUTION_MODES, normalizeExecutionMode } = require('../execution/modes.cjs')

const DEFAULT_CANARY_LIMITS_PATH = path.resolve(process.cwd(), 'config', 'canary_limits.json')

function toFiniteNumber(value, fallback = null) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

function loadCanaryLimits(configPath = process.env.BOT_CANARY_LIMITS_PATH || DEFAULT_CANARY_LIMITS_PATH) {
  const resolvedPath = path.resolve(configPath)

  if (!fs.existsSync(resolvedPath)) {
    return {
      path: resolvedPath,
      exists: false,
      limits: null
    }
  }

  const payload = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'))
  return {
    path: resolvedPath,
    exists: true,
    limits: payload
  }
}

function buildExecutionIntent(payload = {}) {
  const execution = payload.execution || {}
  const plan = execution.plan || payload.plan || {}
  const positions = Array.isArray(plan.positions) ? plan.positions : []
  const totalFromPositions = positions.reduce((sum, position) => {
    const budgetUsd = toFiniteNumber(position?.budgetUsd, 0)
    return sum + (budgetUsd > 0 ? budgetUsd : 0)
  }, 0)
  const totalCapitalUsd = toFiniteNumber(
    payload.totalCapitalUsd,
    toFiniteNumber(execution.capitalUsd, toFiniteNumber(plan.capitalUsd, totalFromPositions))
  ) || 0
  const requestCount = Math.max(0, Number(
    payload.requestCount != null
      ? payload.requestCount
      : (Array.isArray(payload.requests) ? payload.requests.length : 0)
  ))

  return {
    mode: execution.mode || payload.mode || null,
    totalCapitalUsd,
    requestCount,
    autoswapRequested: Boolean(payload.autoswapRequested),
    expectedDailyLossUsd: toFiniteNumber(payload.expectedDailyLossUsd, null),
    currentOpenCapitalUsd: toFiniteNumber(payload.currentOpenCapitalUsd, 0) || 0,
    currentDailyTxCount: toFiniteNumber(payload.currentDailyTxCount, 0) || 0,
    currentDailyGasCostBnb: toFiniteNumber(payload.currentDailyGasCostBnb, 0) || 0,
    estimatedMaxGasCostBnb: toFiniteNumber(payload.estimatedMaxGasCostBnb, null),
    currentNativeGasBalanceBnb: toFiniteNumber(payload.currentNativeGasBalanceBnb, null)
  }
}

function buildCanaryLimitsReport({
  mode = EXECUTION_MODES.DRY_RUN,
  canaryLimits = null,
  executionIntent = null
} = {}) {
  const normalizedMode = normalizeExecutionMode(mode)
  const intent = buildExecutionIntent(executionIntent || {})

  if (normalizedMode !== EXECUTION_MODES.LIVE) {
    return {
      mode: normalizedMode,
      ready: true,
      blockers: [],
      limitsLoaded: true,
      limitsEnabled: true,
      intent
    }
  }

  const blockers = []
  const limits = canaryLimits || null

  if (!limits) {
    blockers.push('missing_canary_limits')
  }

  if (limits && limits.enabled !== true) {
    blockers.push('canary_limits_disabled')
  }

  const maxOpenCapitalUsd = toFiniteNumber(limits?.maxOpenCapitalUsd, null)
  const maxPerTxUsd = toFiniteNumber(limits?.maxPerTxUsd, null)
  const maxDailyLossUsd = toFiniteNumber(limits?.maxDailyLossUsd, null)
  const maxTxCount = toFiniteNumber(limits?.maxTxCount, null)
  const maxDailyGasCostBnb = toFiniteNumber(limits?.maxDailyGasCostBnb, null)
  const maxEstimatedGasCostBnb = toFiniteNumber(limits?.maxEstimatedGasCostBnb, null)
  const minNativeGasReserveBnb = toFiniteNumber(limits?.minNativeGasReserveBnb, null)

  if (maxTxCount != null && !(maxTxCount > 0)) {
    blockers.push('invalid_max_tx_count')
  }

  if (
    intent.totalCapitalUsd > 0
    && maxOpenCapitalUsd > 0
    && intent.totalCapitalUsd + Number(intent.currentOpenCapitalUsd || 0) > maxOpenCapitalUsd
  ) {
    blockers.push('open_capital_exceeds_canary_limit')
  }

  if (intent.totalCapitalUsd > 0 && maxPerTxUsd > 0 && intent.totalCapitalUsd > maxPerTxUsd) {
    blockers.push('per_tx_capital_exceeds_canary_limit')
  }

  if (intent.requestCount > 0 && maxTxCount > 0 && intent.requestCount > maxTxCount) {
    blockers.push('request_count_exceeds_canary_limit')
  }

  if (intent.autoswapRequested && limits?.allowAutoswap !== true) {
    blockers.push('autoswap_disabled_by_canary_policy')
  }

  if (intent.expectedDailyLossUsd != null && maxDailyLossUsd > 0 && intent.expectedDailyLossUsd > maxDailyLossUsd) {
    blockers.push('daily_loss_cap_exceeded')
  }

  if (
    intent.estimatedMaxGasCostBnb != null
    && maxEstimatedGasCostBnb > 0
    && intent.estimatedMaxGasCostBnb > maxEstimatedGasCostBnb
  ) {
    blockers.push('estimated_gas_cost_exceeds_canary_limit')
  }

  if (
    intent.estimatedMaxGasCostBnb != null
    && maxDailyGasCostBnb > 0
    && Number(intent.currentDailyGasCostBnb || 0) + intent.estimatedMaxGasCostBnb > maxDailyGasCostBnb
  ) {
    blockers.push('daily_gas_cost_exceeds_canary_limit')
  }

  if (
    intent.estimatedMaxGasCostBnb != null
    && intent.currentNativeGasBalanceBnb != null
    && minNativeGasReserveBnb > 0
    && Number(intent.currentNativeGasBalanceBnb || 0) - Number(intent.estimatedMaxGasCostBnb || 0) < minNativeGasReserveBnb
  ) {
    blockers.push('native_gas_balance_below_reserve')
  }

  return {
    mode: normalizedMode,
    ready: blockers.length === 0,
    blockers,
    limitsLoaded: Boolean(limits),
    limitsEnabled: limits?.enabled === true,
    limits: limits ? {
      mode: limits.mode || null,
      maxOpenCapitalUsd,
      maxPerTxUsd,
      maxDailyLossUsd,
      maxTxCount,
      maxDailyGasCostBnb,
      maxEstimatedGasCostBnb,
      minNativeGasReserveBnb,
      allowAutoswap: limits.allowAutoswap === true
    } : null,
    intent
  }
}

function assertCanaryLimits(payload) {
  const report = buildCanaryLimitsReport(payload)

  if (!report.ready) {
    throw new Error(`canary limits blocked: ${report.blockers.join(', ')}`)
  }

  return report
}

module.exports = {
  DEFAULT_CANARY_LIMITS_PATH,
  loadCanaryLimits,
  buildExecutionIntent,
  buildCanaryLimitsReport,
  assertCanaryLimits
}
