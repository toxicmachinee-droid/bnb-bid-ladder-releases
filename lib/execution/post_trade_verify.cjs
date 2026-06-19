'use strict'

const { normalizeRiskScore } = require('./defense_policy.cjs')

function toFiniteNumber(value, fallback = null) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

function computeDeviationBps(expectedValue, actualValue) {
  const expected = toFiniteNumber(expectedValue, null)
  const actual = toFiniteNumber(actualValue, null)
  if (!(expected > 0) || actual == null) {
    return null
  }
  return Math.round(Math.abs(actual - expected) / expected * 10_000)
}

function buildSeverityFromDeviation(deviationBps, warnThresholdBps, blockThresholdBps) {
  if (deviationBps == null) {
    return 'info'
  }
  if (deviationBps >= blockThresholdBps) {
    return 'critical'
  }
  if (deviationBps >= warnThresholdBps) {
    return 'warning'
  }
  return 'ok'
}

function verifyExecutedAction({
  action,
  receipt,
  preTradeAssessment,
  provider,
  poolRuntimeAtInclusion,
  realizedMetrics = {}
} = {}) {
  void provider
  const expectedMetrics = preTradeAssessment?.metrics || {}
  const warnThresholdBps = Number(preTradeAssessment?.policy?.thresholds?.deteriorationWarnBps || 100)
  const blockThresholdBps = Number(preTradeAssessment?.policy?.thresholds?.deteriorationBlockBps || 250)
  const actualReferencePrice = toFiniteNumber(
    poolRuntimeAtInclusion?.targetPrice
      || poolRuntimeAtInclusion?.currentPoolPrice
      || realizedMetrics.referencePrice,
    null
  )
  const expectedReferencePrice = toFiniteNumber(
    expectedMetrics.pendingPrice
      || expectedMetrics.latestPrice
      || preTradeAssessment?.fairValueContext?.referencePrice,
    null
  )
  const priceDeviationBps = computeDeviationBps(expectedReferencePrice, actualReferencePrice)
  const proceedsDeviationBps = computeDeviationBps(expectedMetrics.expectedQuote, realizedMetrics.actualQuote)
  const severity = buildSeverityFromDeviation(
    Math.max(priceDeviationBps || 0, proceedsDeviationBps || 0),
    warnThresholdBps,
    blockThresholdBps
  )

  return {
    ok: Boolean(receipt) && severity !== 'critical',
    action: action || null,
    severity,
    realizedMetrics: {
      ...realizedMetrics,
      inclusionPrice: actualReferencePrice,
      expectedPrice: expectedReferencePrice,
      priceDeviationBps,
      proceedsDeviationBps
    },
    alerts: severity === 'critical'
      ? ['post_trade_deviation_exceeded']
      : severity === 'warning'
        ? ['post_trade_deviation_warning']
        : [],
    anomalyScore: normalizeRiskScore(Math.max(priceDeviationBps || 0, proceedsDeviationBps || 0) / Math.max(blockThresholdBps, 1), 0)
  }
}

module.exports = {
  computeDeviationBps,
  verifyExecutedAction
}
