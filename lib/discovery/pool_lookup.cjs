'use strict'

const { COMMON_TOKENS } = require('../bnb_v3_config.cjs')

const DEFAULT_DISCOVERY_QUOTES = [
  COMMON_TOKENS.USDT,
  COMMON_TOKENS.USDC
]

function normalizeQuoteTokens(quoteTokens = DEFAULT_DISCOVERY_QUOTES) {
  return quoteTokens
    .filter((token) => token?.address)
    .map((token) => ({
      symbol: token.symbol || 'UNKNOWN',
      address: token.address,
      decimals: token.decimals
    }))
}

async function discoverPoolsForToken(provider, {
  tokenAddress,
  dexes = ['pancakeswap', 'uniswap'],
  quoteTokens = DEFAULT_DISCOVERY_QUOTES,
  findFirstExistingPool,
  readPoolRuntime
}) {
  if (!tokenAddress) {
    throw new Error('discoverPoolsForToken requires tokenAddress')
  }

  if (typeof findFirstExistingPool !== 'function' || typeof readPoolRuntime !== 'function') {
    throw new Error('discoverPoolsForToken requires findFirstExistingPool and readPoolRuntime functions')
  }

  const quotes = normalizeQuoteTokens(quoteTokens)
  const normalizedTokenAddress = String(tokenAddress).toLowerCase()
  const discovered = []

  for (const dex of dexes || []) {
    for (const quoteToken of quotes) {
      if (String(quoteToken.address).toLowerCase() === normalizedTokenAddress) {
        continue
      }

      const poolMatch = await findFirstExistingPool(provider, {
        dex,
        tokenA: tokenAddress,
        tokenB: quoteToken.address
      })

      if (!poolMatch) {
        continue
      }

      const runtime = await readPoolRuntime(provider, {
        dex,
        poolAddress: poolMatch.poolAddress,
        inputTokenAddress: tokenAddress,
        depositTokenAddress: quoteToken.address
      })

      discovered.push({
        id: `${dex}:${poolMatch.poolAddress}`,
        dex,
        quoteSymbol: quoteToken.symbol,
        quoteAddress: quoteToken.address,
        poolAddress: runtime.poolAddress,
        fee: runtime.fee,
        tickSpacing: runtime.tickSpacing,
        price: runtime.targetPrice,
        liquidityUsd: Number(runtime.liquidityUsd || 0),
        runtime
      })
    }
  }

  return discovered
}

module.exports = {
  DEFAULT_DISCOVERY_QUOTES,
  normalizeQuoteTokens,
  discoverPoolsForToken
}
