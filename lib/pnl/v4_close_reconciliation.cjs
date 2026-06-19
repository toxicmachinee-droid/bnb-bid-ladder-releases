'use strict'

const { ethers } = require('ethers')
const { V4_DEPLOYMENTS } = require('../bnb_v3_config.cjs')
const {
  UNISWAP_V4_POSITION_MANAGER_ABI,
  UNISWAP_V4_STATE_VIEW_ABI
} = require('../protocol/v4_abi.cjs')
const { normalizeAddress } = require('../protocol/address.cjs')
const { computeReadablePrice } = require('../protocol/ticks.cjs')
const {
  buildUniswapV4PoolIdFromKey,
  decodeUniswapV4PositionInfo,
  buildUniswapV4PositionKey,
  calculateUniswapV4UnclaimedFees
} = require('../protocol/uniswap_v4_runtime.cjs')
const { getSqrtRatioAtTick, getAmountsForLiquidity } = require('../protocol/v4_math.cjs')
const { ERC20_ABI } = require('../protocol/abi.cjs')

const ERC20_DECIMALS_ABI = ERC20_ABI.filter((entry) => String(entry).includes('decimals'))

function toFiniteNumber(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function normalizeOptionalAddress(value) {
  try {
    return value ? normalizeAddress(value) : null
  } catch {
    return null
  }
}

function sameAddress(a, b) {
  const left = normalizeOptionalAddress(a)
  const right = normalizeOptionalAddress(b)
  return Boolean(left && right && left.toLowerCase() === right.toLowerCase())
}

function rawToDecimal(rawAmount, decimals = 18) {
  return Number(ethers.formatUnits(BigInt(rawAmount || 0), Number(decimals || 18)))
}

function resolveDepositUsdMultiplier(tokenContext = {}) {
  const multiplier = toFiniteNumber(tokenContext.depositTokenUsdPrice ?? tokenContext.quoteTokenUsdPrice, 1)
  return multiplier > 0 ? multiplier : 1
}

function resolveTargetPrice(precloseState = {}, tokenContext = {}) {
  const direct = toFiniteNumber(tokenContext.targetPrice ?? tokenContext.currentPoolPrice, 0)
  if (direct > 0) {
    return direct
  }

  const inputTokenAddress = normalizeOptionalAddress(tokenContext.inputTokenAddress)
  const token0Address = normalizeOptionalAddress(precloseState.poolKey?.currency0)
  const token1Address = normalizeOptionalAddress(precloseState.poolKey?.currency1)
  if (!inputTokenAddress || !token0Address || !token1Address || precloseState.sqrtPriceX96 == null) {
    return 0
  }

  const computed = computeReadablePrice({
    sqrtPriceX96: precloseState.sqrtPriceX96,
    token0Decimals: Number(tokenContext.token0Decimals || 18),
    token1Decimals: Number(tokenContext.token1Decimals || 18),
    token0Address,
    token1Address,
    targetAddress: inputTokenAddress,
    normalizeAddress
  })
  return toFiniteNumber(computed, 0)
}

function rawCurrencyToQuote(rawAmount, currencyAddress, tokenContext = {}, precloseState = {}) {
  const token0Address = normalizeOptionalAddress(precloseState.poolKey?.currency0)
  const token1Address = normalizeOptionalAddress(precloseState.poolKey?.currency1)
  const depositTokenAddress = normalizeOptionalAddress(tokenContext.depositTokenAddress || tokenContext.quoteTokenAddress)
  const inputTokenAddress = normalizeOptionalAddress(tokenContext.inputTokenAddress)
  const depositUsd = resolveDepositUsdMultiplier(tokenContext)
  const decimals = sameAddress(currencyAddress, token0Address)
    ? Number(tokenContext.token0Decimals || 18)
    : (sameAddress(currencyAddress, token1Address)
        ? Number(tokenContext.token1Decimals || 18)
        : 18)
  const tokenAmount = rawToDecimal(rawAmount, decimals)

  if (depositTokenAddress && sameAddress(currencyAddress, depositTokenAddress)) {
    return tokenAmount * depositUsd
  }

  if (inputTokenAddress && sameAddress(currencyAddress, inputTokenAddress)) {
    const targetPrice = resolveTargetPrice(precloseState, tokenContext)
    return targetPrice > 0 ? tokenAmount * targetPrice * depositUsd : 0
  }

  return 0
}

function buildTokenContextFromCard(card = {}, snapshot = {}) {
  return {
    inputTokenAddress: card.inputTokenAddress || snapshot.inputTokenAddress,
    depositTokenAddress: card.depositTokenAddress || card.quoteTokenAddress || snapshot.depositTokenAddress,
    quoteTokenAddress: card.quoteTokenAddress || snapshot.depositTokenAddress,
    token0Decimals: card.token0Decimals ?? snapshot.token0Decimals ?? snapshot.depositTokenDecimals ?? 18,
    token1Decimals: card.token1Decimals ?? snapshot.token1Decimals ?? snapshot.inputTokenDecimals ?? 18,
    targetPrice: card.targetPrice ?? snapshot.targetPrice ?? snapshot.currentPoolPrice,
    currentPoolPrice: card.currentPoolPrice ?? snapshot.currentPoolPrice,
    depositTokenUsdPrice: card.depositTokenUsdPrice ?? snapshot.depositTokenUsdPrice ?? 1,
    quoteTokenUsdPrice: card.quoteTokenUsdPrice ?? snapshot.quoteTokenUsdPrice
  }
}

function buildUniswapV4PrecloseCloseCardRepair({
  card,
  precloseState,
  tokenContext
}) {
  if (!card || !precloseState?.poolKey || precloseState.sqrtPriceX96 == null) {
    return null
  }

  const liquidity = BigInt(precloseState.positionState?.[0] ?? precloseState.liquidity ?? 0)
  if (liquidity <= 0n) {
    return null
  }

  const tickLower = Number(precloseState.tickLower)
  const tickUpper = Number(precloseState.tickUpper)
  if (!Number.isFinite(tickLower) || !Number.isFinite(tickUpper)) {
    return null
  }

  const amounts = getAmountsForLiquidity(
    precloseState.sqrtPriceX96,
    getSqrtRatioAtTick(tickLower),
    getSqrtRatioAtTick(tickUpper),
    liquidity
  )
  const feeAmounts = calculateUniswapV4UnclaimedFees({
    liquidity,
    feeGrowthInside0LastX128: precloseState.positionState?.[1] ?? 0n,
    feeGrowthInside1LastX128: precloseState.positionState?.[2] ?? 0n,
    currentFeeGrowthInside0X128: precloseState.currentFeeGrowthInside?.[0] ?? precloseState.positionState?.[1] ?? 0n,
    currentFeeGrowthInside1X128: precloseState.currentFeeGrowthInside?.[1] ?? precloseState.positionState?.[2] ?? 0n
  })

  const currency0 = precloseState.poolKey.currency0
  const currency1 = precloseState.poolKey.currency1
  const principalQuote = rawCurrencyToQuote(amounts.amount0, currency0, tokenContext, precloseState)
    + rawCurrencyToQuote(amounts.amount1, currency1, tokenContext, precloseState)
  const feesQuote = rawCurrencyToQuote(feeAmounts.tokensOwed0, currency0, tokenContext, precloseState)
    + rawCurrencyToQuote(feeAmounts.tokensOwed1, currency1, tokenContext, precloseState)
  const exitValueQuote = principalQuote + feesQuote
  const costBasisQuote = toFiniteNumber(card.costBasisQuote || card.deployedQuote, 0)
  const claimedFeesQuote = toFiniteNumber(card.claimedFeesQuote, 0)
  const autoswapDeltaQuote = toFiniteNumber(card.autoswapDeltaQuote, 0)
  const closeCostsQuote = toFiniteNumber(card.closeCostsQuote, 0)
  const netProceedsQuote = exitValueQuote + claimedFeesQuote + autoswapDeltaQuote - closeCostsQuote
  const realizedPnlQuote = netProceedsQuote - costBasisQuote
  const realizedPnlPct = costBasisQuote > 0 ? (realizedPnlQuote / costBasisQuote) * 100 : 0

  if (!Number.isFinite(exitValueQuote) || exitValueQuote <= 0) {
    return null
  }

  return {
    ...card,
    costBasisQuote,
    deployedQuote: toFiniteNumber(card.deployedQuote, costBasisQuote),
    exitValueQuote,
    exitValueIncludesAccruedFees: true,
    feesQuote,
    accruedFeesQuote: feesQuote,
    netProceedsQuote,
    realizedPnlQuote,
    realizedPnlPct,
    reconciliationStatus: 'reconciled_v4_preclose_state',
    proceedsEstimated: false,
    hasTrustedCloseValuation: true,
    closeValuationWarning: null
  }
}

async function readErc20Decimals(provider, address) {
  const normalized = normalizeOptionalAddress(address)
  if (!normalized) {
    return 18
  }
  const token = new ethers.Contract(normalized, ERC20_DECIMALS_ABI, provider)
  const decimals = await token.decimals().catch(() => 18)
  return Number(decimals || 18)
}

async function readUniswapV4PrecloseState(provider, {
  tokenId,
  blockTag,
  config = V4_DEPLOYMENTS.uniswap
}) {
  const positionManager = new ethers.Contract(config.positionManager, UNISWAP_V4_POSITION_MANAGER_ABI, provider)
  const stateView = new ethers.Contract(config.stateView, UNISWAP_V4_STATE_VIEW_ABI, provider)
  const [[poolKey, positionInfo], fallbackLiquidity] = await Promise.all([
    positionManager.getPoolAndPositionInfo(BigInt(tokenId), { blockTag }),
    positionManager.getPositionLiquidity(BigInt(tokenId), { blockTag })
  ])
  const decoded = decodeUniswapV4PositionInfo(positionInfo)
  const poolId = buildUniswapV4PoolIdFromKey(poolKey)
  const positionId = buildUniswapV4PositionKey(config.positionManager, tokenId, decoded.tickLower, decoded.tickUpper)
  const [slot0, positionState, currentFeeGrowthInside] = await Promise.all([
    stateView.getSlot0(poolId, { blockTag }),
    stateView.getPositionInfo(poolId, positionId, { blockTag }),
    stateView.getFeeGrowthInside(poolId, decoded.tickLower, decoded.tickUpper, { blockTag })
  ])

  return {
    poolKey,
    poolId,
    tickLower: decoded.tickLower,
    tickUpper: decoded.tickUpper,
    sqrtPriceX96: slot0?.[0],
    liquidity: positionState?.[0] ?? fallbackLiquidity,
    positionState,
    currentFeeGrowthInside
  }
}

function shouldRepairUniswapV4EstimatedCloseCard(card = {}) {
  return String(card.protocolVersion || '').toLowerCase() === 'v4'
    && String(card.dex || '').toLowerCase() === 'uniswap'
    && String(card.reconciliationStatus || '') === 'estimated_batch_close_allocation'
    && Boolean(card.proceedsEstimated)
    && String(card.txHash || '').startsWith('0x')
    && String(card.tokenId || card.positionId || '').trim()
}

async function repairUniswapV4EstimatedCloseCards({
  provider,
  store,
  maxCards = 48
}) {
  if (!provider || !store?.loadCloseCards || !store?.saveCloseCards) {
    return 0
  }

  const closeBook = store.loadCloseCards()
  const snapshotBook = store.loadPositionSnapshots ? store.loadPositionSnapshots() : { positions: [] }
  const snapshotsByTokenId = new Map((snapshotBook.positions || []).map((snapshot) => [String(snapshot.tokenId || snapshot.positionId || ''), snapshot]))
  const candidates = (closeBook.cards || [])
    .map((card, index) => ({ card, index }))
    .filter(({ card }) => shouldRepairUniswapV4EstimatedCloseCard(card))
    .slice(0, Math.max(0, Number(maxCards) || 0))

  if (!candidates.length) {
    return 0
  }

  const receiptByTx = new Map()
  const decimalsByAddress = new Map()
  const nextCards = [...(closeBook.cards || [])]
  let repairedCount = 0

  for (const { card, index } of candidates) {
    const txHash = String(card.txHash)
    if (!receiptByTx.has(txHash)) {
      receiptByTx.set(txHash, await provider.getTransactionReceipt(txHash).catch(() => null))
    }
    const receipt = receiptByTx.get(txHash)
    if (!receipt?.blockNumber || Number(receipt.blockNumber) <= 1) {
      continue
    }

    const snapshot = snapshotsByTokenId.get(String(card.tokenId || card.positionId || '')) || {}
    const blockTag = Number(receipt.blockNumber) - 1
    const precloseState = await readUniswapV4PrecloseState(provider, {
      tokenId: card.tokenId || card.positionId,
      blockTag
    }).catch(() => null)
    if (!precloseState) {
      continue
    }

    const context = buildTokenContextFromCard(card, snapshot)
    for (const [field, currency] of [['token0Decimals', precloseState.poolKey.currency0], ['token1Decimals', precloseState.poolKey.currency1]]) {
      if (!Number.isFinite(Number(context[field])) || Number(context[field]) <= 0) {
        const normalized = normalizeOptionalAddress(currency)
        if (!normalized) {
          continue
        }
        if (!decimalsByAddress.has(normalized.toLowerCase())) {
          decimalsByAddress.set(normalized.toLowerCase(), await readErc20Decimals(provider, normalized))
        }
        context[field] = decimalsByAddress.get(normalized.toLowerCase())
      }
    }

    const repaired = buildUniswapV4PrecloseCloseCardRepair({
      card,
      precloseState,
      tokenContext: context
    })
    if (!repaired) {
      continue
    }

    nextCards[index] = repaired
    repairedCount += 1
  }

  if (repairedCount > 0) {
    store.saveCloseCards({
      ...closeBook,
      updatedAt: new Date().toISOString(),
      cards: nextCards
    })
  }

  return repairedCount
}

module.exports = {
  buildTokenContextFromCard,
  buildUniswapV4PrecloseCloseCardRepair,
  readUniswapV4PrecloseState,
  repairUniswapV4EstimatedCloseCards,
  shouldRepairUniswapV4EstimatedCloseCard
}
