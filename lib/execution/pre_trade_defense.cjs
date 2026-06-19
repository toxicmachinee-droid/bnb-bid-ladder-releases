'use strict'

const { ethers } = require('ethers')
const { poolInterface } = require('../protocol/abi.cjs')
const { v4ClPoolManagerInterface, uniswapV4StateViewInterface } = require('../protocol/v4_abi.cjs')
const { computeReadablePrice } = require('../protocol/ticks.cjs')
const { normalizeAddress } = require('../protocol/address.cjs')
const { buildPreTradeDefensePolicy, classifyPairRisk, resolveDefenseVerdict, normalizeRiskScore, normalizeConfidence } = require('./defense_policy.cjs')
const { buildFairValueContext } = require('./fair_value.cjs')
const { buildGasEnvelope } = require('./gas_monitor.cjs')

const DEFENSE_POOL_STATE_READ_TIMEOUT_MS = 600
const DEFENSE_GAS_ENVELOPE_FAST_FALLBACK_MS = 650

function withTimeout(promise, timeoutMs, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`${label || 'operation'} timed out after ${timeoutMs}ms`)), timeoutMs)
    })
  ])
}

function toFiniteNumber(value, fallback = null) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

function computeBpsDelta(left, right) {
  const base = toFiniteNumber(left, null)
  const candidate = toFiniteNumber(right, null)
  if (!(base > 0) || candidate == null) {
    return null
  }
  return Math.round(Math.abs(candidate - base) / base * 10_000)
}

function buildFallbackGasEnvelope(policy, action) {
  const gasProfile = policy?.gasProfile || {}
  const fallbackLegacyGasPrice = BigInt(gasProfile.legacyGasPriceFloorWei || 50_000_000n)
  return {
    action,
    urgency: gasProfile.urgency || 'urgent',
    maxFeePerGas: undefined,
    maxPriorityFeePerGas: undefined,
    legacyGasPrice: fallbackLegacyGasPrice,
    inclusionTtlMs: Number(gasProfile.inclusionTtlMs || 10_000),
    replacementTriggerMs: Number(gasProfile.replacementTriggerMs || 8_000),
    cancelTriggerMs: Number(gasProfile.cancelTriggerMs || 18_000),
    source: 'fast-fallback'
  }
}

async function buildDefenseGasEnvelope({ provider, policy, action, allowFastFallback = false }) {
  const buildPromise = buildGasEnvelope({
    provider,
    profile: policy,
    action,
    urgency: policy.gasProfile?.urgency
  })

  if (!allowFastFallback) {
    return buildPromise.catch(() => null)
  }

  const envelope = await withTimeout(
    buildPromise,
    DEFENSE_GAS_ENVELOPE_FAST_FALLBACK_MS,
    'defense gas envelope'
  ).catch(() => null)

  return envelope || buildFallbackGasEnvelope(policy, action)
}

async function readPoolPriceAtBlockTag(provider, poolRuntime, blockTag = 'latest') {
  if (!provider || !poolRuntime) {
    return null
  }

  const version = String(poolRuntime.protocolVersion || 'v3').toLowerCase()
  try {
    if (version === 'v4' && String(poolRuntime.dex || '').toLowerCase() === 'pancakeswap') {
      const data = v4ClPoolManagerInterface.encodeFunctionData('getSlot0', [String(poolRuntime.poolAddress)])
      const raw = await provider.call({
        to: poolRuntime.poolManager,
        data
      }, blockTag)
      const [slot0] = v4ClPoolManagerInterface.decodeFunctionResult('getSlot0', raw)
      return {
        tick: Number(slot0.tick),
        price: computeReadablePrice({
          sqrtPriceX96: slot0.sqrtPriceX96,
          token0Decimals: Number(poolRuntime.token0Decimals || 18),
          token1Decimals: Number(poolRuntime.token1Decimals || 18),
          token0Address: poolRuntime.token0Address,
          token1Address: poolRuntime.token1Address,
          targetAddress: poolRuntime.inputTokenAddress,
          normalizeAddress
        })
      }
    }

    if (version === 'v4' && String(poolRuntime.dex || '').toLowerCase() === 'uniswap') {
      const data = uniswapV4StateViewInterface.encodeFunctionData('getSlot0', [String(poolRuntime.poolAddress)])
      const raw = await provider.call({
        to: poolRuntime.stateView,
        data
      }, blockTag)
      const [slot0] = uniswapV4StateViewInterface.decodeFunctionResult('getSlot0', raw)
      return {
        tick: Number(slot0.tick),
        price: computeReadablePrice({
          sqrtPriceX96: slot0.sqrtPriceX96,
          token0Decimals: Number(poolRuntime.token0Decimals || 18),
          token1Decimals: Number(poolRuntime.token1Decimals || 18),
          token0Address: poolRuntime.token0Address,
          token1Address: poolRuntime.token1Address,
          targetAddress: poolRuntime.inputTokenAddress,
          normalizeAddress
        })
      }
    }

    const raw = await provider.call({
      to: poolRuntime.poolAddress,
      data: poolInterface.encodeFunctionData('slot0', [])
    }, blockTag)
    const [slot0] = poolInterface.decodeFunctionResult('slot0', raw)
    return {
      tick: Number(slot0.tick),
      price: computeReadablePrice({
        sqrtPriceX96: slot0.sqrtPriceX96,
        token0Decimals: Number(poolRuntime.token0Decimals || 18),
        token1Decimals: Number(poolRuntime.token1Decimals || 18),
        token0Address: poolRuntime.token0Address,
        token1Address: poolRuntime.token1Address,
        targetAddress: poolRuntime.inputTokenAddress,
        normalizeAddress
      })
    }
  } catch (_) {
    return null
  }
}

async function simulateExecutionRisk({
  action,
  executionPlan,
  provider,
  poolRuntime,
  blockTags = ['latest', 'pending'],
  poolStateTimeoutMs = DEFENSE_POOL_STATE_READ_TIMEOUT_MS
} = {}) {
  void executionPlan
  const [latestResult, pendingResult] = await Promise.all(
    (blockTags || ['latest', 'pending']).map(async (blockTag) => {
      const poolState = await withTimeout(
        readPoolPriceAtBlockTag(provider, poolRuntime, blockTag),
        poolStateTimeoutMs,
        `read ${blockTag} pool state`
      ).catch(() => null)
      return {
        blockTag,
        ok: Boolean(poolState),
        state: poolState
      }
    })
  )

  const latest = latestResult?.state || null
  const pending = pendingResult?.state || null
  const deteriorationBps = computeBpsDelta(latest?.price, pending?.price)

  return {
    action: action || 'open',
    latest,
    pending,
    deteriorationBps,
    executable: Boolean(latest || pending),
    revertReason: latest || pending ? null : 'pool_state_unavailable'
  }
}

async function evaluatePreTradeDefense({
  action,
  executionPlan,
  poolRuntime,
  provider,
  signerAddress,
  profile = 'shield-balanced',
  submissionCapabilities = {},
  fairValueContext = null,
  referenceCandidates = [],
  now = Date.now()
} = {}) {
  void signerAddress
  const pairClass = classifyPairRisk({
    tokenInSymbol: poolRuntime?.inputTokenSymbol,
    tokenOutSymbol: poolRuntime?.depositTokenSymbol,
    inputTokenSymbol: executionPlan?.inputTokenSymbol,
    depositTokenSymbol: executionPlan?.depositTokenSymbol
  })
  const policy = buildPreTradeDefensePolicy({
    profile,
    action,
    pairClass
  })
  const normalizedAction = String(action || 'open').trim().toLowerCase()
  const isOpenAction = normalizedAction === 'open'
  const isCloseLifecycleAction = normalizedAction === 'close' || normalizedAction === 'collect_close'
  const gasEnvelopePromise = buildDefenseGasEnvelope({
    provider,
    policy,
    action,
    allowFastFallback: isCloseLifecycleAction
  })
  const resolvedFairValueContext = fairValueContext || buildFairValueContext({
    tokenIn: poolRuntime?.inputTokenSymbol,
    tokenOut: poolRuntime?.depositTokenSymbol,
    poolRuntime,
    provider,
    profile,
    policy,
    referenceCandidates,
    now
  })
  const simulation = await simulateExecutionRisk({
    action,
    executionPlan,
    provider,
    poolRuntime
  })
  const latestPrice = toFiniteNumber(simulation.latest?.price, toFiniteNumber(poolRuntime?.targetPrice, null))
  const pendingPrice = toFiniteNumber(simulation.pending?.price, latestPrice)
  const referencePrice = toFiniteNumber(resolvedFairValueContext.referencePrice, latestPrice)
  const immediateImpairmentBps = computeBpsDelta(referencePrice, pendingPrice)
  const confidence = normalizeConfidence(
    resolvedFairValueContext.confidence - (simulation.pending ? 0 : 0.12),
    resolvedFairValueContext.referencePrice ? 0.4 : 0.15
  )
  const reasons = []
  const warnings = []
  let hardBlock = false
  let shouldWarn = false
  const hasFallbackPrice = latestPrice != null
    || pendingPrice != null
    || toFiniteNumber(poolRuntime?.targetPrice, null) != null
    || toFiniteNumber(poolRuntime?.currentPoolPrice, null) != null
    || toFiniteNumber(poolRuntime?.currentPrice, null) != null
    || toFiniteNumber(resolvedFairValueContext.referencePrice, null) != null
  const isShieldPair = String(policy?.pairClass || '').toLowerCase() === 'shield'
  const allowLifecycleFallback = hasFallbackPrice && (isOpenAction || isCloseLifecycleAction)

  if (!simulation.executable) {
    if (allowLifecycleFallback) {
      warnings.push('pool_state_unavailable_for_simulation')
      shouldWarn = true
    } else {
      reasons.push('pool_state_unavailable_for_simulation')
      hardBlock = true
    }
  }

  if (resolvedFairValueContext.referencePrice == null) {
    if (allowLifecycleFallback) {
      warnings.push('fair_value_unavailable')
      shouldWarn = true
    } else {
      reasons.push('fair_value_unavailable')
      hardBlock = true
    }
  }

  if (simulation.deteriorationBps != null && simulation.deteriorationBps >= policy.thresholds.deteriorationBlockBps) {
    reasons.push('pending_state_materially_worse')
    hardBlock = true
  } else if (simulation.deteriorationBps != null && simulation.deteriorationBps >= policy.thresholds.deteriorationWarnBps) {
    warnings.push('pending_state_deterioration_warning')
    shouldWarn = true
  }

  if (immediateImpairmentBps != null && immediateImpairmentBps >= policy.thresholds.impairmentBlockBps) {
    reasons.push('immediate_mark_to_fair_impairment_exceeded')
    hardBlock = true
  } else if (immediateImpairmentBps != null && immediateImpairmentBps >= policy.thresholds.impairmentWarnBps) {
    warnings.push('immediate_mark_to_fair_impairment_warning')
    shouldWarn = true
  }

  if (resolvedFairValueContext.freshnessMs > policy.thresholds.freshnessMs) {
    warnings.push('fair_value_reference_is_stale')
    shouldWarn = true
  }

  if (confidence < policy.thresholds.minConfidenceWarn) {
    warnings.push('low_confidence_reference')
    shouldWarn = true
  }

  if (isOpenAction && isShieldPair && confidence < policy.thresholds.lowConfidenceFloor && !resolvedFairValueContext.referencePrice && hasFallbackPrice) {
    hardBlock = false
    shouldWarn = true
    if (!warnings.includes('shield_open_fallback_mode')) {
      warnings.push('shield_open_fallback_mode')
    }
  }

  if (submissionCapabilities?.allowTxpoolInspection === true && submissionCapabilities?.mempoolHostilityScore != null) {
    const hostilityScore = normalizeRiskScore(submissionCapabilities.mempoolHostilityScore, 0)
    if (hostilityScore >= policy.mempool.blockHostility) {
      reasons.push('mempool_hostility_exceeded')
      hardBlock = true
    } else if (hostilityScore >= policy.mempool.warnHostility) {
      warnings.push('mempool_hostility_warning')
      shouldWarn = true
    }
  }

  const gasEnvelope = await gasEnvelopePromise.catch(() => null)
  if (!gasEnvelope) {
    reasons.push('gas_envelope_unavailable')
    hardBlock = true
  } else if (gasEnvelope.source === 'fast-fallback') {
    warnings.push('gas_envelope_unavailable_fast_fallback')
    shouldWarn = true
  }

  const score = normalizeRiskScore(
    Math.max(
      Number(simulation.deteriorationBps || 0) / Math.max(policy.thresholds.deteriorationBlockBps, 1),
      Number(immediateImpairmentBps || 0) / Math.max(policy.thresholds.impairmentBlockBps, 1),
      1 - confidence
    ),
    0
  )

  return {
    verdict: resolveDefenseVerdict({
      hardBlock,
      shouldWarn,
      score,
      confidence,
      policy
    }),
    score,
    confidence,
    reasons,
    warnings,
    metrics: {
      latestPrice,
      pendingPrice,
      referencePrice,
      expectedQuote: null,
      pendingDeteriorationBps: simulation.deteriorationBps,
      immediateImpairmentBps
    },
    gasEnvelope,
    childVerdicts: [],
    simulation,
    fairValueContext: resolvedFairValueContext,
    policy
  }
}

module.exports = {
  DEFENSE_POOL_STATE_READ_TIMEOUT_MS,
  DEFENSE_GAS_ENVELOPE_FAST_FALLBACK_MS,
  computeBpsDelta,
  readPoolPriceAtBlockTag,
  simulateExecutionRisk,
  evaluatePreTradeDefense
}
