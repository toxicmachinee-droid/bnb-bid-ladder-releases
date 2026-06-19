(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory()
  } else {
    root.PositionSetupShared = factory()
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict'

  const MAX_LADDER_DROP_PCT = 99
  const LADDER_TARGET_PRICE_STEP = 1.5
  const MAX_ADAPTIVE_ROWS = 48
  const METEORA_REFERENCE_LADDER = Object.freeze([
    { rangePct: 0, lossPct: 0 },
    { rangePct: 12.70, lossPct: 4.38 },
    { rangePct: 23.95, lossPct: 8.53 },
    { rangePct: 28.76, lossPct: 10.40 },
    { rangePct: 33.74, lossPct: 12.41 },
    { rangePct: 41.83, lossPct: 15.83 },
    { rangePct: 42.27, lossPct: 16.05 },
    { rangePct: 49.17, lossPct: 19.16 },
    { rangePct: 49.50, lossPct: 19.34 },
    { rangePct: 49.71, lossPct: 19.45 },
    { rangePct: 56.18, lossPct: 22.64 },
    { rangePct: 61.83, lossPct: 25.64 },
    { rangePct: 64.21, lossPct: 26.96 },
    { rangePct: 66.43, lossPct: 28.24 },
    { rangePct: 66.74, lossPct: 28.46 },
    { rangePct: 71.03, lossPct: 31.11 },
    { rangePct: 73.99, lossPct: 32.95 },
    { rangePct: 74.42, lossPct: 33.31 },
    { rangePct: 74.63, lossPct: 33.49 },
    { rangePct: 74.76, lossPct: 33.60 },
    { rangePct: 80.63, lossPct: 37.95 },
    { rangePct: 93.05, lossPct: 50.83 }
  ])

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

  function clampNumber(value, fallback, min, max) {
    const numeric = Number(value)
    if (!Number.isFinite(numeric)) {
      return fallback
    }
    return Math.min(Math.max(numeric, min), max)
  }

  function computePriceFromPct(currentPrice, pct) {
    if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
      return 0
    }
    return currentPrice * (1 + pct / 100)
  }

  function computePctFromPrice(currentPrice, price) {
    if (!Number.isFinite(currentPrice) || currentPrice <= 0 || !Number.isFinite(price) || price <= 0) {
      return 0
    }
    return (price / currentPrice - 1) * 100
  }

  function formatPctWithPrecision(value, companionValue = null) {
    const numeric = Number(value)
    if (!Number.isFinite(numeric)) {
      return 'n/a'
    }

    const companion = Number(companionValue)
    let digits = 2
    if (Number.isFinite(companion)) {
      const gap = Math.abs(numeric - companion)
      if (gap < 0.01) {
        digits = 4
      } else if (gap < 0.1) {
        digits = 3
      }
    }

    return `${numeric.toFixed(digits)}%`
  }

  function formatPctRangeWithPrecision(lowerPct, upperPct) {
    const lower = Number(lowerPct)
    const upper = Number(upperPct)
    if (!Number.isFinite(lower) || !Number.isFinite(upper)) {
      return 'n/a'
    }

    const gap = Math.abs(lower - upper)
    const digits = gap < 0.01 ? 4 : gap < 0.1 ? 3 : 2
    return `${lower.toFixed(digits)}%  ..  ${upper.toFixed(digits)}%`
  }

  function buildActiveDrops(targetDropAbs, presetDrops = null) {
    if (!Number.isFinite(targetDropAbs) || targetDropAbs <= 0) {
      return []
    }

    const normalizedTarget = clampDropTarget(targetDropAbs, 0)
    const sourceDrops = Array.isArray(presetDrops) && presetDrops.length
      ? presetDrops
      : buildAdaptivePresetDrops(normalizedTarget)
    const drops = []
    for (const drop of sourceDrops) {
      if (drop < normalizedTarget) {
        drops.push(drop)
        continue
      }

      drops.push(normalizedTarget)
      if (drop >= normalizedTarget) {
        break
      }
    }

    if (!drops.length || drops[drops.length - 1] < normalizedTarget) {
      drops.push(normalizedTarget)
    }

    return drops
  }

  function estimateRowBaseTokens(capitalUsd, upperPrice, lowerPrice) {
    if (!Number.isFinite(capitalUsd) || capitalUsd <= 0) {
      return 0
    }

    const upper = Math.max(Number(upperPrice || 0), 0)
    const lower = Math.max(Number(lowerPrice || 0), 0)
    if (upper <= 0 || lower <= 0) {
      return 0
    }

    return capitalUsd / Math.sqrt(upper * lower)
  }

  function interpolateReferenceLoss(rangePct) {
    const targetRange = clampDropTarget(rangePct, 0)
    if (targetRange <= 0) {
      return 0
    }

    for (let index = 1; index < METEORA_REFERENCE_LADDER.length; index += 1) {
      const previous = METEORA_REFERENCE_LADDER[index - 1]
      const current = METEORA_REFERENCE_LADDER[index]
      if (targetRange > current.rangePct) {
        continue
      }

      const span = current.rangePct - previous.rangePct
      if (!(span > 0)) {
        return current.lossPct
      }
      const progress = (targetRange - previous.rangePct) / span
      return previous.lossPct + (current.lossPct - previous.lossPct) * progress
    }

    const previous = METEORA_REFERENCE_LADDER[METEORA_REFERENCE_LADDER.length - 2]
    const current = METEORA_REFERENCE_LADDER[METEORA_REFERENCE_LADDER.length - 1]
    const slope = (current.lossPct - previous.lossPct) / (current.rangePct - previous.rangePct)
    return current.lossPct + (targetRange - current.rangePct) * slope
  }

  function estimatePlannedLossPct(targetDropAbs) {
    return Number(Math.max(0, interpolateReferenceLoss(targetDropAbs)).toFixed(2))
  }

  function buildBidAskPreview(config) {
    const currentPrice = clampNumber(config.currentPrice, 0, 0, Number.MAX_SAFE_INTEGER)
    const capitalUsd = clampNumber(config.capitalUsd, 0, 0, Number.MAX_SAFE_INTEGER)
    const minPct = config.minPct === '' || config.minPct == null
      ? null
      : Math.min(clampNumber(config.minPct, -12, -99, 0), 0)
    const maxPct = config.maxPct === '' || config.maxPct == null
      ? null
      : clampNumber(config.maxPct, 0, -50, 50)
    const minPrice = minPct == null ? null : computePriceFromPct(currentPrice, minPct)
    const maxPrice = maxPct == null ? null : computePriceFromPct(currentPrice, maxPct)

    if (minPct == null || maxPct == null) {
      return {
        mode: 'bidask',
        currentPrice,
        minPct,
        maxPct,
        minPrice,
        maxPrice,
        positions: 0,
        rows: [],
        summary: {
          ready: false,
          totalCapitalUsd: capitalUsd,
          averageCapitalUsd: 0,
          firstLossPct: 0,
          worstLossPct: 0,
          currentPrice
        }
      }
    }

    if (!(minPct < maxPct)) {
      return {
        mode: 'bidask',
        currentPrice,
        minPct,
        maxPct,
        minPrice,
        maxPrice,
        positions: 0,
        rows: [],
        summary: {
          ready: false,
          totalCapitalUsd: capitalUsd,
          averageCapitalUsd: 0,
          firstLossPct: 0,
          worstLossPct: 0,
          currentPrice
        }
      }
    }

    const anchorPrice = computePriceFromPct(currentPrice, maxPct)
    const targetDropAbs = Math.abs(minPct - maxPct)
    const drops = buildActiveDrops(Math.max(targetDropAbs, 0.0001))

    const weights = drops.map((drop, index) => {
      const startDrop = index === 0 ? 0 : drops[index - 1]
      const midpoint = (startDrop + drop) / 2
      return midpoint ** 2
    })
    const totalWeight = weights.reduce((sum, value) => sum + value, 0) || 1

    const rows = drops.map((drop, index) => {
      const startDrop = index === 0 ? 0 : drops[index - 1]
      const upperPct = maxPct - startDrop
      const lowerPct = maxPct - drop
      const upperPrice = anchorPrice * (1 - startDrop / 100)
      const lowerPrice = anchorPrice * (1 - drop / 100)
      const capitalShareUsd = capitalUsd * (weights[index] / totalWeight)
      const sharePct = capitalUsd > 0 ? capitalShareUsd / capitalUsd * 100 : 0

      return {
        index: index + 1,
        upperPct,
        lowerPct,
        upperPrice,
        lowerPrice,
        capitalUsd: capitalShareUsd,
        sharePct,
        expectedTokens: estimateRowBaseTokens(capitalShareUsd, upperPrice, lowerPrice),
        plannedLossPct: estimatePlannedLossPct(drop),
        lossAtLevel: 0
      }
    })

    let runningWorstLoss = 0
    for (let index = 0; index < rows.length; index += 1) {
      const nextLoss = Number(rows[index].plannedLossPct || 0)
      runningWorstLoss = Math.max(runningWorstLoss, nextLoss)
      rows[index].lossAtLevel = runningWorstLoss
      rows[index].plannedLossPct = runningWorstLoss
    }

    return {
      mode: 'bidask',
      currentPrice,
      anchorPrice,
      minPct,
      maxPct,
      minPrice,
      maxPrice,
      positions: rows.length,
      rows,
      summary: {
        ready: true,
        totalCapitalUsd: capitalUsd,
        averageCapitalUsd: rows.length ? capitalUsd / rows.length : 0,
        firstLossPct: rows[0]?.lossAtLevel || 0,
        worstLossPct: rows[rows.length - 1]?.lossAtLevel || 0,
        currentPrice,
        anchorPrice,
        targetDropAbs
      }
    }
  }

  function buildSpotPreview(config) {
    const currentPrice = clampNumber(config.currentPrice, 0, 0, Number.MAX_SAFE_INTEGER)
    const capitalUsd = clampNumber(config.capitalUsd, 0, 0, Number.MAX_SAFE_INTEGER)
    const minPct = config.minPct === '' || config.minPct == null
      ? -5
      : clampNumber(config.minPct, -5, -99, 99)
    const maxPct = config.maxPct === '' || config.maxPct == null
      ? 5
      : clampNumber(config.maxPct, 5, -99, 99)
    const lowerPct = Math.min(minPct, maxPct)
    const upperPct = Math.max(minPct, maxPct)
    const lowerPrice = computePriceFromPct(currentPrice, lowerPct)
    const upperPrice = computePriceFromPct(currentPrice, upperPct)
    const estimatedUnits = currentPrice > 0 ? capitalUsd / currentPrice : 0
    const rangeShape = upperPct <= 0
      ? 'below'
      : (lowerPct >= 0 ? 'above' : 'around')

    return {
      mode: 'spot',
      currentPrice,
      minPct: lowerPct,
      maxPct: upperPct,
      minPrice: lowerPrice,
      maxPrice: upperPrice,
      positions: 1,
      rows: [{
        index: 1,
        rangeShape,
        capitalUsd,
        estimatedUnits,
        referencePrice: currentPrice,
        lowerPct,
        upperPct,
        lowerPrice,
        upperPrice
      }],
      summary: {
        ready: currentPrice > 0 && capitalUsd > 0 && lowerPct < upperPct,
        totalCapitalUsd: capitalUsd,
        estimatedUnits,
        rangeShape,
        currentPrice,
        lowerPrice,
        upperPrice
      }
    }
  }

  function buildPositionSetupPreview(config) {
    if ((config.mode || 'bidask') === 'spot') {
      return buildSpotPreview(config)
    }

    return buildBidAskPreview(config)
  }

  return {
    computePriceFromPct,
    computePctFromPrice,
    LADDER_TARGET_PRICE_STEP,
    MAX_ADAPTIVE_ROWS,
    METEORA_REFERENCE_LADDER,
    buildAdaptivePresetDrops,
    estimatePlannedLossPct,
    buildBidAskPreview,
    buildSpotPreview,
    buildPositionSetupPreview,
    formatPctWithPrecision,
    formatPctRangeWithPrecision
  }
}))
