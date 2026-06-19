'use strict'

function toFiniteNumber(value, fallback = 0) {
  const normalized = Number(value)
  return Number.isFinite(normalized) ? normalized : fallback
}

function buildPositionCostBasis({
  positionId,
  tokenId,
  dex,
  poolAddress,
  quoteSymbol = 'USDT',
  deployedQuote = 0,
  entryCostsQuote = 0,
  openedAt = new Date().toISOString()
}) {
  const deployed = toFiniteNumber(deployedQuote)
  const entryCosts = toFiniteNumber(entryCostsQuote)

  return {
    positionId: String(positionId || tokenId),
    tokenId: tokenId === undefined ? undefined : String(tokenId),
    dex,
    poolAddress,
    quoteSymbol,
    deployedQuote: deployed,
    entryCostsQuote: entryCosts,
    totalCostBasisQuote: deployed + entryCosts,
    openedAt
  }
}

module.exports = {
  buildPositionCostBasis,
  toFiniteNumber
}
