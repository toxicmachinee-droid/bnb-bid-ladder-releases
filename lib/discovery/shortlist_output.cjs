'use strict'

const { evaluatePoolCandidates } = require('./evaluation.cjs')

function buildShortlistOutput(pools, options = {}) {
  const evaluation = evaluatePoolCandidates(pools, options)

  return {
    generatedAt: new Date().toISOString(),
    referencePool: evaluation.referencePool
      ? {
          id: evaluation.referencePool.id,
          dex: evaluation.referencePool.dex,
          liquidityUsd: evaluation.referencePool.liquidityUsd,
          price: evaluation.referencePool.price
        }
      : null,
    candidates: evaluation.candidates.map((candidate) => ({
      poolModel: String(candidate.protocolVersion || '').toLowerCase() === 'v2' ? 'xyk' : 'cl',
      supportsBidAsk: ['v3', 'v4'].includes(String(candidate.protocolVersion || '').toLowerCase()),
      id: candidate.id,
      dex: candidate.dex,
      protocolVersion: candidate.protocolVersion,
      tokenSymbol: candidate.tokenSymbol,
      tokenName: candidate.tokenName,
      tokenAddress: candidate.tokenAddress,
      quoteSymbol: candidate.quoteSymbol,
      quoteTokenName: candidate.quoteTokenName,
      quoteAddress: candidate.quoteAddress,
      poolAddress: candidate.poolAddress,
      pairAddress: candidate.pairAddress || candidate.poolAddress,
      labels: Array.isArray(candidate.labels) ? candidate.labels : [],
      fee: candidate.fee,
      tickSpacing: candidate.tickSpacing ?? null,
      poolManager: candidate.poolManager || null,
      hooks: candidate.hooks || null,
      parameters: candidate.parameters || null,
      sqrtPriceX96: candidate.sqrtPriceX96 || null,
      liquidityUsd: candidate.liquidityUsd,
      totalQuoteLiquidityUsd: candidate.totalQuoteLiquidityUsd,
      price: candidate.price,
      priceUsd: candidate.priceUsd,
      marketCapUsd: candidate.marketCapUsd,
      fdvUsd: candidate.fdvUsd,
      pairCreatedAt: candidate.pairCreatedAt,
      ageHours: candidate.ageHours,
      ageLabel: candidate.ageLabel,
      volume: candidate.volume || {},
      dexUrl: candidate.dexUrl || null,
      sourceCoverage: candidate.sourceCoverage || {},
      decision: candidate.decision,
      sanity: candidate.sanity
    })),
    summary: {
      accepted: evaluation.accepted.length,
      warned: evaluation.warned.length,
      blocked: evaluation.blocked.length
    }
  }
}

module.exports = {
  buildShortlistOutput
}
