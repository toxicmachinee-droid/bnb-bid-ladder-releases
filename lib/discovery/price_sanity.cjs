'use strict'

function normalizePositiveNumber(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null
}

function appendComparablePrice(target, seen, price, basis, allowInverse = false) {
  const normalized = normalizePositiveNumber(price)
  if (normalized === null) {
    return
  }

  const directKey = `${basis}:${normalized.toPrecision(12)}`
  if (!seen.has(directKey)) {
    seen.add(directKey)
    target.push({
      price: normalized,
      basis
    })
  }

  if (!allowInverse) {
    return
  }

  const inverse = 1 / normalized
  if (!Number.isFinite(inverse) || inverse <= 0) {
    return
  }
  const inverseKey = `${basis}:inv:${inverse.toPrecision(12)}`
  if (!seen.has(inverseKey)) {
    seen.add(inverseKey)
    target.push({
      price: inverse,
      basis: `${basis}:inverse`
    })
  }
}

function buildComparablePriceSet(pool) {
  const prices = []
  const seen = new Set()

  appendComparablePrice(prices, seen, pool?.priceUsd, 'priceUsd', false)
  appendComparablePrice(prices, seen, pool?.tokenPriceUsd, 'tokenPriceUsd', false)
  appendComparablePrice(prices, seen, pool?.poolPrice, 'poolPrice', true)
  appendComparablePrice(prices, seen, pool?.price, 'price', true)

  return prices
}

function computePriceDivergenceBps(referencePrice, candidatePrice) {
  const ref = Number(referencePrice)
  const candidate = Number(candidatePrice)

  if (!Number.isFinite(ref) || ref <= 0 || !Number.isFinite(candidate) || candidate <= 0) {
    return null
  }

  return Math.abs(candidate - ref) / ref * 10_000
}

function computeComparableDivergence(referencePool, candidatePool) {
  const referencePrices = buildComparablePriceSet(referencePool)
  const candidatePrices = buildComparablePriceSet(candidatePool)

  let best = null
  for (const reference of referencePrices) {
    for (const candidate of candidatePrices) {
      const divergenceBps = computePriceDivergenceBps(reference.price, candidate.price)
      if (divergenceBps === null) {
        continue
      }
      if (!best || divergenceBps < best.divergenceBps) {
        best = {
          divergenceBps,
          referenceBasis: reference.basis,
          candidateBasis: candidate.basis
        }
      }
    }
  }

  return best
}

function assessPoolPriceSanity({
  referencePool,
  candidatePool,
  warningThresholdBps = 300,
  blockThresholdBps = 1000
}) {
  const comparable = computeComparableDivergence(referencePool, candidatePool)
  const divergenceBps = comparable?.divergenceBps ?? null

  if (divergenceBps === null) {
    return {
      status: 'unknown',
      divergenceBps: null,
      shouldWarn: false,
      shouldBlock: false,
      referenceBasis: null,
      candidateBasis: null
    }
  }

  return {
    status: divergenceBps >= blockThresholdBps ? 'block' : divergenceBps >= warningThresholdBps ? 'warn' : 'ok',
    divergenceBps,
    shouldWarn: divergenceBps >= warningThresholdBps,
    shouldBlock: divergenceBps >= blockThresholdBps,
    referenceBasis: comparable?.referenceBasis || null,
    candidateBasis: comparable?.candidateBasis || null
  }
}

function chooseSafeCandidatePools({
  pools,
  warningThresholdBps = 300,
  blockThresholdBps = 1000
}) {
  const { selectReferencePool } = require('./pool_ranking.cjs')
  const referencePool = selectReferencePool(pools)

  if (!referencePool) {
    return []
  }

  return (pools || []).map((pool) => ({
    ...pool,
    sanity: assessPoolPriceSanity({
      referencePool,
      candidatePool: pool,
      warningThresholdBps,
      blockThresholdBps
    })
  }))
}

module.exports = {
  computePriceDivergenceBps,
  assessPoolPriceSanity,
  chooseSafeCandidatePools
}
