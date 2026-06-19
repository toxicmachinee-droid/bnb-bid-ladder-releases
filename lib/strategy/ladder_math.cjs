'use strict'

const { buildBidAskPreview, estimatePlannedLossPct, METEORA_REFERENCE_LADDER } = require('../../ui/position_setup_shared.js')

const MAX_LADDER_DROP_PCT = 99
const LADDER_TARGET_PRICE_STEP = 1.5
const MAX_ADAPTIVE_ROWS = 48
const STABLE_SYMBOLS = new Set(['USDT', 'USDC', 'BUSD', 'FDUSD', 'USDE'])

function clampDropTarget(value, fallback = 0) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) {
    return fallback
  }
  return Math.min(Math.max(numeric, 0), MAX_LADDER_DROP_PCT)
}

function deriveSegmentCount(targetDropAbs) {
  const target = clampDropTarget(targetDropAbs, 0)
  if (target <= 0) {
    return 0
  }
  if (target <= 5) {
    return 1
  }
  if (target <= 20) {
    return 2
  }
  if (target <= 40) {
    return 3
  }
  if (target <= 75) {
    return 5
  }
  if (target <= 90) {
    return 7
  }
  if (target <= 96) {
    return 8
  }
  return 10
}

function buildAdaptivePresetDrops(targetDropAbs = 74) {
  const target = clampDropTarget(targetDropAbs, 74)
  const count = deriveSegmentCount(target)

  if (!count) {
    return []
  }

  const drops = []
  const floorRatio = Math.max(1e-6, 1 - target / 100)
  const rowRatio = Math.pow(floorRatio, 1 / count)
  let previous = 0

  for (let index = 1; index <= count; index += 1) {
    let drop = Number(((1 - Math.pow(rowRatio, index)) * 100).toFixed(2))
    if (index === count) {
      drop = Number(target.toFixed(2))
    }
    if (drop <= previous) {
      drop = Number(Math.min(target, previous + 0.01).toFixed(2))
    }
    drops.push(drop)
    previous = drop
  }

  return drops
}

const DEFAULT_PRESET_DROPS = buildAdaptivePresetDrops(74)

function resolvePresetDrops(targetDropAbs, presetDrops = null) {
  if (Array.isArray(presetDrops) && presetDrops.length) {
    return presetDrops
  }
  return buildAdaptivePresetDrops(targetDropAbs)
}

function buildTemplateSegments(presetDrops = DEFAULT_PRESET_DROPS) {
  const segments = []
  let previousDrop = 0

  for (const endDrop of presetDrops) {
    const midpoint = (previousDrop + endDrop) / 2
    segments.push({
      startDrop: previousDrop,
      endDrop,
      baseWeight: midpoint ** 2
    })
    previousDrop = endDrop
  }

  return segments
}

function buildActiveSegments(targetDropAbs, presetDrops = null) {
  const segments = []
  const sourceDrops = resolvePresetDrops(targetDropAbs, presetDrops)

  for (const segment of buildTemplateSegments(sourceDrops)) {
    if (targetDropAbs <= segment.startDrop) {
      break
    }

    const clippedEndDrop = Math.min(segment.endDrop, targetDropAbs)
    const midpoint = (segment.startDrop + clippedEndDrop) / 2

    segments.push({
      startDrop: segment.startDrop,
      endDrop: clippedEndDrop,
      baseWeight: midpoint ** 2
    })

    if (segment.endDrop >= targetDropAbs) {
      break
    }
  }

  return segments
}

function buildLadderRows({ price, capitalUsd, targetDropAbs, presetDrops = null }) {
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error('price must be a positive number')
  }

  if (!Number.isFinite(capitalUsd) || capitalUsd <= 0) {
    throw new Error('capitalUsd must be a positive number')
  }

  if (!Number.isFinite(targetDropAbs) || targetDropAbs <= 0) {
    throw new Error('targetDropAbs must be a positive number')
  }

  const preview = buildBidAskPreview({
    currentPrice: price,
    capitalUsd,
    minPct: -targetDropAbs,
    maxPct: 0
  })

  if (!preview?.summary?.ready || !Array.isArray(preview.rows) || !preview.rows.length) {
    throw new Error('canonical bid/ask preview could not be built')
  }

  return preview.rows.map((row, index) => {
    const startDrop = index === 0 ? 0 : Math.abs(Number(preview.rows[index - 1].lowerPct || 0))
    const endDrop = Math.abs(Number(row.lowerPct || 0))
    const pHigh = Number(row.upperPrice || 0)
    const pLow = Number(row.lowerPrice || 0)
    const capitalShareUsd = Number(row.capitalUsd || 0)
    const capitalPct = Number(row.sharePct || 0)
    const avgBuy = Math.sqrt(pHigh * pLow)
    const expectedTokens = Number(row.expectedTokens || 0)
    const avgEntry = expectedTokens > 0 ? capitalShareUsd / expectedTokens : 0
    const plannedLossPct = Number(row.plannedLossPct || row.lossAtLevel || 0)

    return {
      index: row.index,
      startDrop,
      endDrop,
      pHigh,
      pLow,
      capitalShareUsd,
      capitalPct,
      avgBuy,
      expectedTokens,
      avgEntry,
      plannedLossPct,
      lossAtLevel: plannedLossPct
    }
  })
}

function inferDepositTokenUsdPrice(pool) {
  const symbol = String(pool.depositTokenSymbol || pool.quoteSymbol || '').toUpperCase()
  if (STABLE_SYMBOLS.has(symbol)) {
    return 1
  }

  if (Number.isFinite(pool.depositTokenUsdPrice) && pool.depositTokenUsdPrice > 0) {
    return pool.depositTokenUsdPrice
  }

  if (Number.isFinite(pool.inputTokenUsdPrice) && pool.inputTokenUsdPrice > 0 && Number.isFinite(pool.targetPrice) && pool.targetPrice > 0) {
    return pool.inputTokenUsdPrice / pool.targetPrice
  }

  return null
}

module.exports = {
  MAX_LADDER_DROP_PCT,
  LADDER_TARGET_PRICE_STEP,
  MAX_ADAPTIVE_ROWS,
  DEFAULT_PRESET_DROPS,
  METEORA_REFERENCE_LADDER,
  clampDropTarget,
  deriveSegmentCount,
  buildAdaptivePresetDrops,
  estimatePlannedLossPct,
  STABLE_SYMBOLS,
  buildTemplateSegments,
  buildActiveSegments,
  buildLadderRows,
  inferDepositTokenUsdPrice
}
