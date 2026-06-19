'use strict'

function buildSwapPolicy({
  enabled = false,
  maxSlippageBps = 300,
  minRouteLiquidityUsd = 10_000,
  allowFallbackHold = true,
  maxQuoteAgeMs = 30_000,
  maxQuoteDeviationBps = 1500,
  requireQuote = false,
  ignoreRouteLiquidityFloor = false
} = {}) {
  return {
    enabled: Boolean(enabled),
    maxSlippageBps: Number.isFinite(maxSlippageBps) && maxSlippageBps >= 0 ? maxSlippageBps : 300,
    minRouteLiquidityUsd: Number.isFinite(minRouteLiquidityUsd) && minRouteLiquidityUsd > 0 ? minRouteLiquidityUsd : 10_000,
    allowFallbackHold: Boolean(allowFallbackHold),
    maxQuoteAgeMs: Number.isFinite(maxQuoteAgeMs) && maxQuoteAgeMs >= 0 ? maxQuoteAgeMs : 30_000,
    maxQuoteDeviationBps: Number.isFinite(maxQuoteDeviationBps) && maxQuoteDeviationBps >= 0 ? maxQuoteDeviationBps : 1500,
    requireQuote: Boolean(requireQuote),
    ignoreRouteLiquidityFloor: Boolean(ignoreRouteLiquidityFloor)
  }
}

function assessSwapRoute(route, policy = buildSwapPolicy()) {
  const routeLiquidityUsd = Number(route?.liquidityUsd || 0)
  const priceImpactBps = Number(route?.priceImpactBps || 0)
  const quoteAgeMs = route?.quoteAgeMs == null ? null : Number(route.quoteAgeMs)
  const quoteDeviationBps = route?.quoteDeviationBps == null ? null : Number(route.quoteDeviationBps)
  const quotedAmountOut = BigInt(route?.quotedAmountOut || 0)

  if (!policy.enabled) {
    return {
      action: 'disabled',
      reason: 'autoswap is disabled'
    }
  }

  if (!policy.ignoreRouteLiquidityFloor && routeLiquidityUsd < policy.minRouteLiquidityUsd) {
    return {
      action: policy.allowFallbackHold ? 'hold' : 'block',
      reason: 'route liquidity is below policy minimum'
    }
  }

  if (policy.requireQuote && quotedAmountOut <= 0n) {
    return {
      action: policy.allowFallbackHold ? 'hold' : 'block',
      reason: 'route quote is unavailable'
    }
  }

  if (quoteAgeMs != null && quoteAgeMs > policy.maxQuoteAgeMs) {
    return {
      action: policy.allowFallbackHold ? 'hold' : 'block',
      reason: 'route quote is stale'
    }
  }

  if (quoteDeviationBps != null && quoteDeviationBps > policy.maxQuoteDeviationBps) {
    return {
      action: policy.allowFallbackHold ? 'hold' : 'block',
      reason: 'route quote deviates too far from reference price'
    }
  }

  if (priceImpactBps > policy.maxSlippageBps) {
    return {
      action: policy.allowFallbackHold ? 'hold' : 'block',
      reason: 'route price impact is above max slippage policy'
    }
  }

  return {
    action: 'swap',
    reason: 'route satisfies autoswap policy'
  }
}

function buildPostExitAutoswapPolicy({
  slippagePct = 0.5,
  expectedExitValueQuote = 0,
  routeLiquidityUsd = 0,
  tinyExitThresholdQuote = 10,
  minimumTinyExitSlippageBps = 150
} = {}) {
  const numericSlippagePct = Number(slippagePct)
  const baseSlippageBps = Number.isFinite(numericSlippagePct) && numericSlippagePct >= 0
    ? Math.round(numericSlippagePct * 100)
    : 50
  const expectedQuote = Number(expectedExitValueQuote)
  const isTinyExit = Number.isFinite(expectedQuote) && expectedQuote > 0 && expectedQuote < Number(tinyExitThresholdQuote || 0)
  const effectiveMaxSlippageBps = isTinyExit
    ? Math.max(baseSlippageBps, Math.max(0, Math.round(Number(minimumTinyExitSlippageBps) || 0)))
    : baseSlippageBps
  const numericRouteLiquidity = Number(routeLiquidityUsd)
  const effectiveMinRouteLiquidityUsd = Number.isFinite(numericRouteLiquidity) && numericRouteLiquidity > 0
    ? Math.min(numericRouteLiquidity, 10_000)
    : 10_000

  return buildSwapPolicy({
    enabled: true,
    maxSlippageBps: effectiveMaxSlippageBps,
    minRouteLiquidityUsd: effectiveMinRouteLiquidityUsd,
    allowFallbackHold: true,
    requireQuote: true,
    ignoreRouteLiquidityFloor: isTinyExit
  })
}

module.exports = {
  buildSwapPolicy,
  assessSwapRoute,
  buildPostExitAutoswapPolicy
}
