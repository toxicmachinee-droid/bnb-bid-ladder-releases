'use strict'

function roundTickDown(tick, spacing) {
  return Math.floor(tick / spacing) * spacing
}

function roundTickUp(tick, spacing) {
  return Math.ceil(tick / spacing) * spacing
}

function priceToRawTick(price) {
  return Math.log(price) / Math.log(1.0001)
}

function computeReadablePrice({ sqrtPriceX96, token0Decimals, token1Decimals, token0Address, token1Address, targetAddress, normalizeAddress }) {
  const sqrtRatioX32 = Number(BigInt(sqrtPriceX96) >> 64n)
  const sqrt = sqrtRatioX32 / (2 ** 32)
  const priceToken1PerToken0 = sqrt * sqrt * (10 ** (token0Decimals - token1Decimals))

  if (!Number.isFinite(priceToken1PerToken0) || priceToken1PerToken0 <= 0) {
    return null
  }

  const normalizedTarget = normalizeAddress(targetAddress).toLowerCase()
  const isTargetToken0 = normalizeAddress(token0Address).toLowerCase() === normalizedTarget

  return isTargetToken0 ? priceToken1PerToken0 : 1 / priceToken1PerToken0
}

function displayPriceToTick(displayPrice, pool, normalizeAddress) {
  const inputIsToken0 = normalizeAddress(pool.inputTokenAddress).toLowerCase() === normalizeAddress(pool.token0Address).toLowerCase()

  if (inputIsToken0) {
    const rawPrice = displayPrice * (10 ** (pool.token1Decimals - pool.token0Decimals))
    return priceToRawTick(rawPrice)
  }

  const rawPrice = (1 / displayPrice) * (10 ** (pool.token1Decimals - pool.token0Decimals))
  return priceToRawTick(rawPrice)
}

function getCurrentTick(pool, currentTick) {
  const tick = Number(currentTick ?? pool?.tick)
  return Number.isFinite(tick) ? tick : null
}

function buildSingleSidedTickRange({
  minTickRaw,
  maxTickRaw,
  tickSpacing,
  currentTick,
  depositSide
}) {
  if (depositSide === 'token0') {
    const tickLower = roundTickUp(Math.max(minTickRaw, currentTick), tickSpacing)
    let tickUpper = roundTickUp(maxTickRaw, tickSpacing)

    if (tickUpper <= tickLower) {
      tickUpper = tickLower + tickSpacing
    }

    return {
      tickLower,
      tickUpper
    }
  }

  if (depositSide === 'token1') {
    let tickLower = roundTickDown(minTickRaw, tickSpacing)
    const tickUpper = roundTickDown(Math.min(maxTickRaw, currentTick), tickSpacing)

    if (tickUpper <= tickLower) {
      tickLower = tickUpper - tickSpacing
    }

    return {
      tickLower,
      tickUpper
    }
  }

  return null
}

function buildTickRange({ lowerDisplayPrice, upperDisplayPrice, tickSpacing, pool, normalizeAddress, currentTick = null, singleSidedDepositSide = null }) {
  const lowerTickRaw = displayPriceToTick(lowerDisplayPrice, pool, normalizeAddress)
  const upperTickRaw = displayPriceToTick(upperDisplayPrice, pool, normalizeAddress)
  const minTickRaw = Math.min(lowerTickRaw, upperTickRaw)
  const maxTickRaw = Math.max(lowerTickRaw, upperTickRaw)
  const resolvedCurrentTick = getCurrentTick(pool, currentTick)

  if ((singleSidedDepositSide === 'token0' || singleSidedDepositSide === 'token1') && resolvedCurrentTick != null) {
    return buildSingleSidedTickRange({
      minTickRaw,
      maxTickRaw,
      tickSpacing,
      currentTick: resolvedCurrentTick,
      depositSide: singleSidedDepositSide
    })
  }

  let tickLower = roundTickUp(minTickRaw, tickSpacing)
  let tickUpper = roundTickDown(maxTickRaw, tickSpacing)

  if (tickUpper <= tickLower) {
    tickLower = roundTickDown(minTickRaw, tickSpacing)
    tickUpper = roundTickUp(maxTickRaw, tickSpacing)

    if (tickUpper <= tickLower) {
      tickUpper = tickLower + tickSpacing
    }
  }

  return {
    tickLower,
    tickUpper
  }
}

module.exports = {
  roundTickDown,
  roundTickUp,
  priceToRawTick,
  computeReadablePrice,
  displayPriceToTick,
  buildSingleSidedTickRange,
  buildTickRange
}
