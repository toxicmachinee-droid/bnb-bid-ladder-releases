'use strict'

const { shortlistPools, selectReferencePool } = require('./pool_ranking.cjs')
const { chooseSafeCandidatePools } = require('./price_sanity.cjs')

function buildDiscoveryDecision(candidate, { warningThresholdBps = 300, blockThresholdBps = 1000 } = {}) {
  const sanity = candidate?.sanity || {
    status: 'unknown',
    divergenceBps: null,
    shouldWarn: false,
    shouldBlock: false
  }

  if (sanity.shouldBlock || sanity.status === 'block') {
    return {
      action: 'block',
      reason: `price divergence is above ${blockThresholdBps} bps`,
      divergenceBps: sanity.divergenceBps
    }
  }

  if (sanity.shouldWarn || sanity.status === 'warn') {
    return {
      action: 'warn',
      reason: `price divergence is above ${warningThresholdBps} bps`,
      divergenceBps: sanity.divergenceBps
    }
  }

  return {
    action: 'ok',
    reason: 'candidate is within configured price sanity thresholds',
    divergenceBps: sanity.divergenceBps
  }
}

function evaluatePoolCandidates(pools, {
  minLiquidityUsd = 0,
  limit = 5,
  warningThresholdBps = 300,
  blockThresholdBps = 1000
} = {}) {
  const shortlist = shortlistPools(pools, { minLiquidityUsd, limit })
  const referencePool = selectReferencePool(shortlist)
  const evaluated = chooseSafeCandidatePools({
    pools: shortlist,
    warningThresholdBps,
    blockThresholdBps
  }).map((candidate) => ({
    ...candidate,
    decision: buildDiscoveryDecision(candidate, {
      warningThresholdBps,
      blockThresholdBps
    })
  }))

  return {
    referencePool,
    candidates: evaluated,
    accepted: evaluated.filter((candidate) => candidate.decision.action === 'ok'),
    warned: evaluated.filter((candidate) => candidate.decision.action === 'warn'),
    blocked: evaluated.filter((candidate) => candidate.decision.action === 'block')
  }
}

module.exports = {
  buildDiscoveryDecision,
  evaluatePoolCandidates
}
