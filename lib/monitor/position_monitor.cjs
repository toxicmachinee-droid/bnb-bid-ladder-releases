'use strict'

const { ethers } = require('ethers')
const { getSqrtRatioAtTick, getAmountsForLiquidity } = require('../protocol/v4_math.cjs')
const { POSITION_MANAGER_ABI } = require('../protocol/abi.cjs')
const { getDexConfig } = require('../config/dex_config.cjs')
const { buildCloseCardFromState } = require('../pnl/close_pipeline.cjs')

function nowIso() {
  return new Date().toISOString()
}

function isNonexistentPositionTokenError(error) {
  const message = String(error?.message || error || '').toLowerCase()
  return message.includes('invalid token id')
    || message.includes('nonexistent token')
    || message.includes('not_minted')
    || message.includes('not minted')
    || message.includes('owner query for nonexistent token')
    || message.includes('erc721: owner query for nonexistent token')
}

function closeCardExistsForToken(store, tokenId) {
  if (!store?.loadCloseCards || !tokenId) {
    return false
  }

  const closeBook = store.loadCloseCards()
  return (closeBook.cards || []).some((card) => String(card.tokenId || card.positionId || '') === String(tokenId))
}

function appendRecoveredCloseCardIfMissing(store, trackedPosition, closedAt, reconciliationStatus) {
  const tokenId = String(trackedPosition?.tokenId || trackedPosition?.positionId || '')
  if (!store?.appendCloseCard || !tokenId || closeCardExistsForToken(store, tokenId)) {
    return null
  }

  const fallbackExitValueQuote = Number(
    trackedPosition?.currentValueQuote
    ?? trackedPosition?.totalValueQuote
    ?? trackedPosition?.deployedQuote
    ?? 0
  )
  const closeCard = buildCloseCardFromState({
    positionSnapshot: trackedPosition,
    exitValueQuote: Number.isFinite(fallbackExitValueQuote) ? Math.max(0, fallbackExitValueQuote) : 0,
    accruedFeesQuote: Number(trackedPosition?.accruedFeesQuote || 0),
    claimedFeesQuote: Number(trackedPosition?.claimedFeesQuote || 0),
    autoswapDeltaQuote: 0,
    closeCostsQuote: 0,
    closedAt
  })

  return store.appendCloseCard({
    ...closeCard,
    txHash: trackedPosition?.closeTxHash || null,
    reconciliationStatus,
    proceedsEstimated: true
  })
}

function estimateQuotedPositionValue({ deployedQuote, currentPoolPrice, rangeLowerPrice, rangeUpperPrice }) {
  const deployed = Number(deployedQuote || 0)
  const current = Number(currentPoolPrice || 0)
  const lower = Math.min(Number(rangeLowerPrice || 0), Number(rangeUpperPrice || 0))
  const upper = Math.max(Number(rangeLowerPrice || 0), Number(rangeUpperPrice || 0))

  if (!(deployed > 0) || !(current > 0) || !(lower > 0) || !(upper > lower)) {
    return deployed
  }

  if (current >= upper) {
    return deployed
  }

  const terminalFactor = Math.sqrt(lower / upper)
  if (current <= lower) {
    return deployed * terminalFactor
  }

  return deployed * Math.sqrt(current / upper)
}

function estimateQuotedPositionValueFromLiquidity({ trackedPosition, poolRuntime, position, currentPoolPrice }) {
  try {
    const sqrtPriceX96 = BigInt(poolRuntime?.sqrtPriceX96 || 0)
    const liquidity = BigInt(position?.liquidity || 0)
    if (sqrtPriceX96 <= 0n || liquidity <= 0n) {
      return null
    }

    const sqrtLowerX96 = getSqrtRatioAtTick(Number(position.tickLower))
    const sqrtUpperX96 = getSqrtRatioAtTick(Number(position.tickUpper))
    const { amount0, amount1 } = getAmountsForLiquidity(sqrtPriceX96, sqrtLowerX96, sqrtUpperX96, liquidity)

    const token0Address = String(poolRuntime?.token0Address || trackedPosition?.token0Address || '').toLowerCase()
    const token1Address = String(poolRuntime?.token1Address || trackedPosition?.token1Address || '').toLowerCase()
    const token0Amount = toTokenAmount(amount0, poolRuntime?.token0Decimals)
    const token1Amount = toTokenAmount(amount1, poolRuntime?.token1Decimals)
    const price = Number(currentPoolPrice || 0)
    const depositAddress = String(trackedPosition?.depositTokenAddress || poolRuntime?.depositTokenAddress || '').toLowerCase()
    const inputAddress = String(trackedPosition?.inputTokenAddress || poolRuntime?.inputTokenAddress || '').toLowerCase()

    const toQuoteValue = (tokenAddress, amount) => {
      if (!(amount > 0) || !tokenAddress) {
        return 0
      }
      if (tokenAddress === depositAddress) {
        return amount
      }
      if (tokenAddress === inputAddress && price > 0) {
        return amount * price
      }
      return 0
    }

    const quotedValue = toQuoteValue(token0Address, token0Amount) + toQuoteValue(token1Address, token1Amount)
    return Number.isFinite(quotedValue) && quotedValue > 0 ? quotedValue : 0
  } catch (_) {
    return null
  }
}

function toTokenAmount(amount, decimals) {
  try {
    return Number(ethers.formatUnits(BigInt(amount || 0), Number(decimals || 18)))
  } catch {
    return 0
  }
}

function estimateQuotedFeesValue({ trackedPosition, poolRuntime, nextTokensOwed0, nextTokensOwed1, currentPoolPrice }) {
  const price = Number(currentPoolPrice || 0)
  const depositAddress = String(trackedPosition.depositTokenAddress || poolRuntime.depositTokenAddress || '').toLowerCase()
  const inputAddress = String(trackedPosition.inputTokenAddress || poolRuntime.inputTokenAddress || '').toLowerCase()
  const token0Address = String(poolRuntime.token0Address || trackedPosition.token0Address || '').toLowerCase()
  const token1Address = String(poolRuntime.token1Address || trackedPosition.token1Address || '').toLowerCase()

  const token0Amount = toTokenAmount(nextTokensOwed0, poolRuntime.token0Decimals)
  const token1Amount = toTokenAmount(nextTokensOwed1, poolRuntime.token1Decimals)

  const toQuoteValue = (tokenAddress, amount) => {
    if (!(amount > 0) || !tokenAddress) {
      return 0
    }
    if (tokenAddress === depositAddress) {
      return amount
    }
    if (tokenAddress === inputAddress && price > 0) {
      return amount * price
    }
    return 0
  }

  return toQuoteValue(token0Address, token0Amount) + toQuoteValue(token1Address, token1Amount)
}

function normalizeAddressOrNull(value) {
  const raw = String(value || '').trim()
  if (!raw) {
    return null
  }
  try {
    return ethers.getAddress(raw).toLowerCase()
  } catch (_) {
    return raw.toLowerCase()
  }
}

function assertPositionMatchesTrackedPool(trackedPosition, position) {
  const trackedToken0 = normalizeAddressOrNull(trackedPosition?.token0Address)
  const trackedToken1 = normalizeAddressOrNull(trackedPosition?.token1Address)
  const positionToken0 = normalizeAddressOrNull(position?.token0)
  const positionToken1 = normalizeAddressOrNull(position?.token1)
  const trackedFee = Number(trackedPosition?.fee || 0)
  const positionFee = Number(position?.fee || 0)

  if (trackedToken0 && trackedToken1 && positionToken0 && positionToken1) {
    const trackedPair = [trackedToken0, trackedToken1].sort().join('|')
    const positionPair = [positionToken0, positionToken1].sort().join('|')
    if (trackedPair !== positionPair) {
      throw new Error(`onchain position ${position?.tokenId || trackedPosition?.tokenId} does not match tracked token pair`)
    }
  }

  if (trackedFee > 0 && positionFee > 0 && trackedFee !== positionFee) {
    throw new Error(`onchain position ${position?.tokenId || trackedPosition?.tokenId} does not match tracked fee tier`)
  }
}

async function previewClaimableFeesQuote({ provider, trackedPosition, poolRuntime, position, currentPoolPrice }) {
  if (String(trackedPosition?.protocolVersion || 'v3').toLowerCase() !== 'v3') {
    return null
  }

  try {
    const dexConfig = getDexConfig(trackedPosition.dex, 'v3')
    const positionManager = new ethers.Contract(dexConfig.positionManager, POSITION_MANAGER_ABI, provider)
    const owner = await positionManager.ownerOf(BigInt(position.tokenId || trackedPosition.tokenId))
    const [amount0, amount1] = await positionManager.collect.staticCall({
      tokenId: BigInt(position.tokenId || trackedPosition.tokenId),
      recipient: owner,
      amount0Max: (2n ** 128n) - 1n,
      amount1Max: (2n ** 128n) - 1n
    }, { from: owner })

    return estimateQuotedFeesValue({
      trackedPosition,
      poolRuntime,
      nextTokensOwed0: BigInt(amount0 || 0),
      nextTokensOwed1: BigInt(amount1 || 0),
      currentPoolPrice
    })
  } catch (_) {
    return null
  }
}

function getPositionRangeState({ currentPoolPrice, rangeLowerPrice, rangeUpperPrice, currentTick, tickLower, tickUpper }) {
  const current = Number(currentPoolPrice || 0)
  const lower = Math.min(Number(rangeLowerPrice || 0), Number(rangeUpperPrice || 0))
  const upper = Math.max(Number(rangeLowerPrice || 0), Number(rangeUpperPrice || 0))

  if (current > 0 && lower > 0 && upper > lower) {
    if (current < lower) {
      return 'below'
    }
    if (current > upper) {
      return 'above'
    }
    return 'inside'
  }

  if (Number(currentTick) < Number(tickLower)) {
    return 'below'
  }
  if (Number(currentTick) >= Number(tickUpper)) {
    return 'above'
  }
  return 'inside'
}

function isPositionOutOfRange({ currentTick, tickLower, tickUpper }) {
  return Number(currentTick) < Number(tickLower) || Number(currentTick) >= Number(tickUpper)
}

function buildPositionMonitorSnapshot({ trackedPosition, position, poolRuntime, observedAt = nowIso(), accruedFeesQuoteOverride = null }) {
  const currentPoolPrice = Number(
    poolRuntime.targetPrice
    || trackedPosition.currentPoolPrice
    || trackedPosition.targetPrice
    || 0
  )
  const rangeState = getPositionRangeState({
    currentPoolPrice,
    rangeLowerPrice: trackedPosition.rangeLowerPrice,
    rangeUpperPrice: trackedPosition.rangeUpperPrice,
    currentTick: poolRuntime.tick,
    tickLower: position.tickLower,
    tickUpper: position.tickUpper
  })
  const outOfRange = rangeState !== 'inside'
  const previousTokensOwed0 = BigInt(trackedPosition.tokensOwed0 || 0)
  const previousTokensOwed1 = BigInt(trackedPosition.tokensOwed1 || 0)
  const nextTokensOwed0 = BigInt(position.tokensOwed0)
  const nextTokensOwed1 = BigInt(position.tokensOwed1)
  const exactCurrentValueQuote = estimateQuotedPositionValueFromLiquidity({
    trackedPosition,
    poolRuntime,
    position,
    currentPoolPrice
  })
  const currentValueQuote = exactCurrentValueQuote == null
    ? estimateQuotedPositionValue({
        deployedQuote: trackedPosition.deployedQuote,
        currentPoolPrice,
        rangeLowerPrice: trackedPosition.rangeLowerPrice,
        rangeUpperPrice: trackedPosition.rangeUpperPrice
      })
    : exactCurrentValueQuote
  const accruedFeesQuote = accruedFeesQuoteOverride == null
    ? estimateQuotedFeesValue({
        trackedPosition,
        poolRuntime,
        nextTokensOwed0,
        nextTokensOwed1,
        currentPoolPrice
      })
    : Number(accruedFeesQuoteOverride || 0)

  return {
    positionId: String(trackedPosition.positionId || trackedPosition.tokenId || position.tokenId),
    tokenId: String(position.tokenId),
    dex: trackedPosition.dex || position.dex,
    protocolVersion: trackedPosition.protocolVersion || position.protocolVersion || 'v3',
    poolModel: trackedPosition.poolModel || (String(trackedPosition.protocolVersion || position.protocolVersion || 'v3').toLowerCase() === 'v2' ? 'xyk' : 'cl'),
    supportsBidAsk: trackedPosition.supportsBidAsk == null
      ? ['v3', 'v4'].includes(String(trackedPosition.protocolVersion || position.protocolVersion || 'v3').toLowerCase())
      : Boolean(trackedPosition.supportsBidAsk),
    poolAddress: trackedPosition.poolAddress,
    tokenSymbol: trackedPosition.tokenSymbol || trackedPosition.inputTokenSymbol || null,
    inputTokenAddress: trackedPosition.inputTokenAddress,
    token0Address: trackedPosition.token0Address,
    token1Address: trackedPosition.token1Address,
    depositTokenAddress: trackedPosition.depositTokenAddress,
    quoteSymbol: trackedPosition.quoteSymbol || trackedPosition.depositTokenSymbol || null,
    depositTokenUsdPrice: Number(trackedPosition.depositTokenUsdPrice || poolRuntime.depositTokenUsdPrice || 0),
    status: position.liquidity > 0n ? 'open' : 'closed',
    liquidity: position.liquidity.toString(),
    tickLower: position.tickLower,
    tickUpper: position.tickUpper,
    currentTick: poolRuntime.tick,
    targetPrice: currentPoolPrice,
    currentPoolPrice,
    fee: position.fee,
    poolManager: trackedPosition.poolManager || poolRuntime.poolManager || null,
    hooks: trackedPosition.hooks || poolRuntime.hooks || null,
    parameters: trackedPosition.parameters || poolRuntime.parameters || null,
    tokensOwed0: nextTokensOwed0.toString(),
    tokensOwed1: nextTokensOwed1.toString(),
    feeGrowthDelta0: (nextTokensOwed0 - previousTokensOwed0).toString(),
    feeGrowthDelta1: (nextTokensOwed1 - previousTokensOwed1).toString(),
    outOfRange,
    rangeUpperPrice: trackedPosition.rangeUpperPrice,
    rangeLowerPrice: trackedPosition.rangeLowerPrice,
    rangeUpperPct: trackedPosition.rangeUpperPct,
    rangeLowerPct: trackedPosition.rangeLowerPct,
    deployedQuote: Number(trackedPosition.deployedQuote || 0),
    entryCostsQuote: Number(trackedPosition.entryCostsQuote || 0),
    currentValueQuote,
    accruedFeesQuote,
    claimedFeesQuote: Number(trackedPosition.claimedFeesQuote || 0),
    valuationStatus: 'known',
    monitorError: null,
    lastSeenAt: observedAt,
    monitorUpdatedAt: observedAt
  }
}

async function refreshTrackedPosition({
  provider,
  trackedPosition,
  readPosition,
  readPoolRuntime
}) {
  const position = await readPosition(provider, {
    dex: trackedPosition.dex,
    protocolVersion: trackedPosition.protocolVersion || 'v3',
    tokenId: trackedPosition.tokenId
  })
  assertPositionMatchesTrackedPool(trackedPosition, position)
  const runtimeHints = {
    dex: trackedPosition.dex,
    protocolVersion: trackedPosition.protocolVersion || 'v3',
    poolAddress: trackedPosition.poolAddress,
    inputTokenAddress: trackedPosition.inputTokenAddress,
    depositTokenAddress: trackedPosition.depositTokenAddress,
    fee: position?.fee ?? trackedPosition.fee ?? null,
    hooks: position?.hooks ?? trackedPosition.hooks ?? null
  }

  if (String(trackedPosition.protocolVersion || 'v3').toLowerCase() === 'v4' && String(trackedPosition.dex || '').toLowerCase() === 'uniswap') {
    runtimeHints.poolKey = {
      currency0: position?.token0 || trackedPosition.token0Address,
      currency1: position?.token1 || trackedPosition.token1Address,
      fee: position?.fee ?? trackedPosition.fee,
      tickSpacing: position?.tickSpacing ?? trackedPosition.tickSpacing,
      hooks: position?.hooks ?? trackedPosition.hooks
    }
  }

  const poolRuntime = await readPoolRuntime(provider, {
    ...runtimeHints
  })
  const claimableFeesQuote = await previewClaimableFeesQuote({
    provider,
    trackedPosition,
    poolRuntime,
    position,
    currentPoolPrice: Number(poolRuntime?.targetPrice || trackedPosition?.currentPoolPrice || trackedPosition?.targetPrice || 0)
  })

  return buildPositionMonitorSnapshot({
    trackedPosition,
    position,
    poolRuntime,
    accruedFeesQuoteOverride: claimableFeesQuote
  })
}

async function refreshOpenPositionsFromStore({
  provider,
  store,
  readPosition,
  readPoolRuntime,
  concurrency = 4
}) {
  const snapshotBook = store.loadPositionSnapshots()
  const openPositions = snapshotBook.positions.filter((position) => position.status !== 'closed')
  const refreshed = []
  const runtimeCache = new Map()
  const batchSize = Math.max(1, Math.min(8, Number(concurrency || 4)))

  const readPoolRuntimeCached = async (providerArg, hints) => {
    const cacheKey = [
      String(hints?.dex || ''),
      String(hints?.protocolVersion || ''),
      String(hints?.poolAddress || ''),
      String(hints?.inputTokenAddress || ''),
      String(hints?.depositTokenAddress || ''),
      String(hints?.fee || ''),
      String(hints?.hooks || '')
    ].join('|')

    if (!runtimeCache.has(cacheKey)) {
      runtimeCache.set(cacheKey, Promise.resolve()
        .then(() => readPoolRuntime(providerArg, hints))
        .catch((error) => {
          runtimeCache.delete(cacheKey)
          throw error
        }))
    }

    return runtimeCache.get(cacheKey)
  }

  for (let index = 0; index < openPositions.length; index += batchSize) {
    const batch = openPositions.slice(index, index + batchSize)
    const settled = await Promise.all(batch.map(async (trackedPosition) => {
      try {
        const nextSnapshot = await refreshTrackedPosition({
          provider,
          trackedPosition,
          readPosition,
          readPoolRuntime: readPoolRuntimeCached
        })
        return { status: 'fulfilled', trackedPosition, nextSnapshot }
      } catch (error) {
        return { status: 'rejected', trackedPosition, error }
      }
    }))

    for (const result of settled) {
      if (result.status === 'fulfilled') {
        store.upsertPositionSnapshot(result.nextSnapshot)
        refreshed.push(result.nextSnapshot)
        continue
      }

      const trackedPosition = result.trackedPosition
      const error = result.error
      if (isNonexistentPositionTokenError(error)) {
        const closedAt = trackedPosition.closedAt || nowIso()
        const priorReconciliationStatus = String(trackedPosition.reconciliationStatus || '')
        const reconciliationStatus = priorReconciliationStatus && priorReconciliationStatus !== 'onchain_owned'
          ? priorReconciliationStatus
          : 'closed_onchain_token_absent'
        store.markPositionClosed(String(trackedPosition.positionId || trackedPosition.tokenId), {
          status: 'closed',
          closedAt,
          liquidity: '0',
          tokensOwed0: '0',
          tokensOwed1: '0',
          feeGrowthDelta0: '0',
          feeGrowthDelta1: '0',
          currentValueQuote: 0,
          totalValueQuote: 0,
          accruedFeesQuote: 0,
          currentTick: null,
          outOfRange: false,
          monitorUpdatedAt: nowIso(),
          monitorError: null,
          reconciliationStatus
        })
        appendRecoveredCloseCardIfMissing(store, trackedPosition, closedAt, reconciliationStatus)
      } else {
        store.upsertPositionSnapshot({
          positionId: String(trackedPosition.positionId || trackedPosition.tokenId),
          tokenId: String(trackedPosition.tokenId || trackedPosition.positionId),
          currentValueQuote: 0,
          accruedFeesQuote: 0,
          totalValueQuote: 0,
          tokensOwed0: trackedPosition.tokensOwed0 || '0',
          tokensOwed1: trackedPosition.tokensOwed1 || '0',
          feeGrowthDelta0: '0',
          feeGrowthDelta1: '0',
          valuationStatus: 'unavailable',
          lastSeenAt: trackedPosition.lastSeenAt || null,
          monitorUpdatedAt: nowIso(),
          monitorError: error?.message || String(error || 'refresh failed')
        })
      }
    }
  }

  return refreshed
}

module.exports = {
  estimateQuotedPositionValue,
  estimateQuotedPositionValueFromLiquidity,
  estimateQuotedFeesValue,
  assertPositionMatchesTrackedPool,
  getPositionRangeState,
  isPositionOutOfRange,
  buildPositionMonitorSnapshot,
  refreshTrackedPosition,
  refreshOpenPositionsFromStore
}
