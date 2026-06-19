'use strict'

const { normalizeConfidence } = require('./defense_policy.cjs')

function toFiniteNumber(value, fallback = null) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

function median(numbers) {
  const sorted = [...numbers].sort((left, right) => left - right)
  const midpoint = Math.floor(sorted.length / 2)
  if (!sorted.length) {
    return null
  }
  if (sorted.length % 2 === 0) {
    return (sorted[midpoint - 1] + sorted[midpoint]) / 2
  }
  return sorted[midpoint]
}

function computeDispersionBps(referencePrice, prices) {
  const ref = toFiniteNumber(referencePrice, null)
  if (!(ref > 0) || !Array.isArray(prices) || prices.length < 2) {
    return 0
  }

  const maxDistance = prices.reduce((result, price) => {
    const numeric = toFiniteNumber(price, null)
    if (!(numeric > 0)) {
      return result
    }
    return Math.max(result, Math.abs(numeric - ref) / ref * 10_000)
  }, 0)

  return Math.round(maxDistance)
}

function normalizeReferenceCandidate(candidate = {}, nowMs = Date.now()) {
  const price = toFiniteNumber(candidate.price, null)
  if (!(price > 0)) {
    return null
  }

  const observedAtMs = candidate.observedAtMs == null
    ? nowMs
    : Number(candidate.observedAtMs)
  const freshnessMs = Number.isFinite(observedAtMs)
    ? Math.max(0, nowMs - observedAtMs)
    : toFiniteNumber(candidate.freshnessMs, Number.MAX_SAFE_INTEGER)

  return {
    source: candidate.source || 'unknown',
    kind: candidate.kind || 'reference',
    price,
    freshnessMs,
    confidence: normalizeConfidence(candidate.confidence, 0.5),
    advisory: candidate.advisory !== false
  }
}

function buildFairValueContext({
  tokenIn,
  tokenOut,
  poolRuntime,
  provider,
  profile,
  now = Date.now(),
  policy = null,
  referenceCandidates = []
} = {}) {
  void provider
  const nowMs = Number(now || Date.now())
  const fallbackPrice = toFiniteNumber(
    poolRuntime?.targetPrice
      || poolRuntime?.currentPoolPrice
      || poolRuntime?.currentPrice
      || null,
    null
  )

  const normalizedCandidates = (referenceCandidates || [])
    .map((candidate) => normalizeReferenceCandidate(candidate, nowMs))
    .filter(Boolean)

  if (fallbackPrice > 0) {
    normalizedCandidates.push({
      source: 'pool-runtime',
      kind: 'fallback',
      price: fallbackPrice,
      freshnessMs: 0,
      confidence: normalizedCandidates.length ? 0.35 : 0.55,
      advisory: true
    })
  }

  const prices = normalizedCandidates.map((candidate) => candidate.price).filter((value) => value > 0)
  const referencePrice = median(prices)
  const dispersionBps = computeDispersionBps(referencePrice, prices)
  const targetFreshnessMs = Number(policy?.thresholds?.freshnessMs || 180_000)
  const oldestFreshnessMs = normalizedCandidates.reduce((result, candidate) => Math.max(result, Number(candidate.freshnessMs || 0)), 0)
  const candidateConfidence = normalizedCandidates.length
    ? normalizedCandidates.reduce((sum, candidate) => sum + Number(candidate.confidence || 0), 0) / normalizedCandidates.length
    : 0
  const freshnessPenalty = oldestFreshnessMs > targetFreshnessMs
    ? Math.min(0.4, (oldestFreshnessMs - targetFreshnessMs) / Math.max(targetFreshnessMs, 1) * 0.2)
    : 0
  const dispersionPenalty = dispersionBps > 0
    ? Math.min(0.35, dispersionBps / 10_000)
    : 0
  const confidence = normalizeConfidence(
    candidateConfidence - freshnessPenalty - dispersionPenalty,
    referencePrice > 0 ? 0.35 : 0
  )
  const effectiveBandBps = Math.max(
    25,
    Math.round(dispersionBps + (1 - confidence) * 600)
  )

  return {
    profile: profile || 'shield-balanced',
    tokenIn: tokenIn || poolRuntime?.inputTokenSymbol || null,
    tokenOut: tokenOut || poolRuntime?.depositTokenSymbol || null,
    referencePrice: referencePrice > 0 ? referencePrice : null,
    lowerBound: referencePrice > 0 ? referencePrice * (1 - effectiveBandBps / 10_000) : null,
    upperBound: referencePrice > 0 ? referencePrice * (1 + effectiveBandBps / 10_000) : null,
    confidence,
    freshnessMs: oldestFreshnessMs,
    sourceCount: normalizedCandidates.length,
    sourceDispersionBps: dispersionBps,
    sources: normalizedCandidates
  }
}

module.exports = {
  toFiniteNumber,
  computeDispersionBps,
  normalizeReferenceCandidate,
  buildFairValueContext
}
