'use strict'

function sortPoolsByLiquidity(pools) {
  return [...(pools || [])].sort((left, right) => Number(right.liquidityUsd || 0) - Number(left.liquidityUsd || 0))
}

function selectReferencePool(pools) {
  return sortPoolsByLiquidity(pools)[0] || null
}

function shortlistPools(pools, {
  minLiquidityUsd = 0,
  limit = 5
} = {}) {
  return sortPoolsByLiquidity(pools)
    .filter((pool) => Number(pool.liquidityUsd || 0) >= minLiquidityUsd)
    .slice(0, limit)
}

module.exports = {
  sortPoolsByLiquidity,
  selectReferencePool,
  shortlistPools
}
