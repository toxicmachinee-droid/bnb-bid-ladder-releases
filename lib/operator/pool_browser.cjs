'use strict'

const { formatCompactUsd } = require('./pool_search.cjs')
const { decoratePoolWithProtocolIdentity } = require('./pool_identity.cjs')

const DEFAULT_FEE_TVL_INTERVAL = '4h'

function toPercentString(value) {
  const numeric = Number(value || 0)
  return Number.isFinite(numeric) ? `${numeric.toFixed(2)}%` : 'n/a'
}

function formatFeePctLabel(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return 'n/a'
  }
  if (numeric >= 0.01) {
    return `${numeric.toFixed(2)}%`
  }
  return `${numeric.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')}%`
}

function computeFeeRate(fee) {
  const numeric = Number(fee || 0)
  return Number.isFinite(numeric) ? numeric / 1_000_000 : 0
}

function computeAgeHours(pairCreatedAt) {
  const createdAt = Number(pairCreatedAt || 0)
  if (!Number.isFinite(createdAt) || createdAt <= 0) {
    return null
  }

  return Math.max(0, (Date.now() - createdAt) / (60 * 60 * 1000))
}

function sumVolumes(entries, hours) {
  return (entries || []).slice(0, hours).reduce((sum, entry) => sum + Number(entry.volume || 0), 0)
}

function hasFiniteBucket(source, key) {
  return source
    && Object.prototype.hasOwnProperty.call(source, key)
    && Number.isFinite(Number(source[key]))
}

function unavailableIntervalEntry() {
  return {
    volumeUsd: null,
    feesUsd: null,
    feeTvlPct: null,
    estimated: true,
    source: 'unavailable'
  }
}

function buildIntervalEntry(volumeUsd, feeRate, liquidityUsd, source) {
  const volume = Number(volumeUsd)
  const liquidity = Number(liquidityUsd || 0)
  if (!Number.isFinite(volume)) {
    return unavailableIntervalEntry()
  }

  const feesUsd = volume * feeRate
  return {
    volumeUsd: volume,
    feesUsd,
    feeTvlPct: liquidity > 0 ? feesUsd / liquidity * 100 : null,
    estimated: false,
    source
  }
}

function buildEstimatedIntervalEntry(volumeUsd, feeRate, liquidityUsd, source) {
  const entry = buildIntervalEntry(volumeUsd, feeRate, liquidityUsd, source)
  if (entry.source === 'unavailable') {
    return entry
  }
  return {
    ...entry,
    estimated: true
  }
}

function buildIntervalMetrics({
  feeRate,
  liquidityUsd,
  dexVolume = {},
  hourlyOhlcv = [],
  minuteOhlcv = []
}) {
  const liquidity = Number(liquidityUsd || 0)
  const safeLiquidity = liquidity > 0 ? liquidity : 0
  const result = {
    '30m': unavailableIntervalEntry(),
    '1h': unavailableIntervalEntry(),
    '2h': unavailableIntervalEntry(),
    '4h': unavailableIntervalEntry(),
    '6h': unavailableIntervalEntry(),
    '12h': unavailableIntervalEntry(),
    '24h': unavailableIntervalEntry()
  }

  if ((minuteOhlcv || []).length >= 6) {
    result['30m'] = buildIntervalEntry(sumVolumes(minuteOhlcv, 6), feeRate, safeLiquidity, 'minuteOhlcv')
  } else if (hasFiniteBucket(dexVolume, 'm5')) {
    result['30m'] = buildEstimatedIntervalEntry(Number(dexVolume.m5) * 6, feeRate, safeLiquidity, 'dexVolume.m5*6')
  }

  if (hasFiniteBucket(dexVolume, 'h1')) {
    result['1h'] = buildIntervalEntry(dexVolume.h1, feeRate, safeLiquidity, 'dexVolume.h1')
  } else if ((hourlyOhlcv || []).length >= 1) {
    result['1h'] = buildIntervalEntry(sumVolumes(hourlyOhlcv, 1), feeRate, safeLiquidity, 'hourlyOhlcv')
  } else if (hasFiniteBucket(dexVolume, 'm5')) {
    result['1h'] = buildEstimatedIntervalEntry(Number(dexVolume.m5) * 12, feeRate, safeLiquidity, 'dexVolume.m5*12')
  } else if (hasFiniteBucket(dexVolume, 'h24')) {
    result['1h'] = buildEstimatedIntervalEntry(Number(dexVolume.h24) / 24, feeRate, safeLiquidity, 'dexVolume.h24/24')
  }

  for (const hours of [2, 4, 12]) {
    if ((hourlyOhlcv || []).length >= hours) {
      result[`${hours}h`] = buildIntervalEntry(sumVolumes(hourlyOhlcv, hours), feeRate, safeLiquidity, 'hourlyOhlcv')
    }
  }

  if (result['2h'].source === 'unavailable') {
    if (hasFiniteBucket(dexVolume, 'h1')) {
      result['2h'] = buildEstimatedIntervalEntry(Number(dexVolume.h1) * 2, feeRate, safeLiquidity, 'dexVolume.h1*2')
    } else if (hasFiniteBucket(dexVolume, 'h6')) {
      result['2h'] = buildEstimatedIntervalEntry(Number(dexVolume.h6) / 3, feeRate, safeLiquidity, 'dexVolume.h6/3')
    } else if (hasFiniteBucket(dexVolume, 'h24')) {
      result['2h'] = buildEstimatedIntervalEntry(Number(dexVolume.h24) / 12, feeRate, safeLiquidity, 'dexVolume.h24/12')
    }
  }

  if (result['4h'].source === 'unavailable') {
    if (hasFiniteBucket(dexVolume, 'h1')) {
      result['4h'] = buildEstimatedIntervalEntry(Number(dexVolume.h1) * 4, feeRate, safeLiquidity, 'dexVolume.h1*4')
    } else if (hasFiniteBucket(dexVolume, 'h6')) {
      result['4h'] = buildEstimatedIntervalEntry(Number(dexVolume.h6) * (4 / 6), feeRate, safeLiquidity, 'dexVolume.h6*(4/6)')
    } else if (hasFiniteBucket(dexVolume, 'h24')) {
      result['4h'] = buildEstimatedIntervalEntry(Number(dexVolume.h24) / 6, feeRate, safeLiquidity, 'dexVolume.h24/6')
    }
  }

  if (hasFiniteBucket(dexVolume, 'h6')) {
    result['6h'] = buildIntervalEntry(dexVolume.h6, feeRate, safeLiquidity, 'dexVolume.h6')
  } else if ((hourlyOhlcv || []).length >= 6) {
    result['6h'] = buildIntervalEntry(sumVolumes(hourlyOhlcv, 6), feeRate, safeLiquidity, 'hourlyOhlcv')
  } else if (hasFiniteBucket(dexVolume, 'h1')) {
    result['6h'] = buildEstimatedIntervalEntry(Number(dexVolume.h1) * 6, feeRate, safeLiquidity, 'dexVolume.h1*6')
  } else if (hasFiniteBucket(dexVolume, 'h24')) {
    result['6h'] = buildEstimatedIntervalEntry(Number(dexVolume.h24) / 4, feeRate, safeLiquidity, 'dexVolume.h24/4')
  }

  if (result['12h'].source === 'unavailable') {
    if (hasFiniteBucket(dexVolume, 'h6')) {
      result['12h'] = buildEstimatedIntervalEntry(Number(dexVolume.h6) * 2, feeRate, safeLiquidity, 'dexVolume.h6*2')
    } else if (hasFiniteBucket(dexVolume, 'h1')) {
      result['12h'] = buildEstimatedIntervalEntry(Number(dexVolume.h1) * 12, feeRate, safeLiquidity, 'dexVolume.h1*12')
    } else if (hasFiniteBucket(dexVolume, 'h24')) {
      result['12h'] = buildEstimatedIntervalEntry(Number(dexVolume.h24) / 2, feeRate, safeLiquidity, 'dexVolume.h24/2')
    }
  }

  if (hasFiniteBucket(dexVolume, 'h24')) {
    result['24h'] = buildIntervalEntry(dexVolume.h24, feeRate, safeLiquidity, 'dexVolume.h24')
  } else if ((hourlyOhlcv || []).length >= 24) {
    result['24h'] = buildIntervalEntry(sumVolumes(hourlyOhlcv, 24), feeRate, safeLiquidity, 'hourlyOhlcv')
  } else if (hasFiniteBucket(dexVolume, 'h6')) {
    result['24h'] = buildEstimatedIntervalEntry(Number(dexVolume.h6) * 4, feeRate, safeLiquidity, 'dexVolume.h6*4')
  } else if (hasFiniteBucket(dexVolume, 'h1')) {
    result['24h'] = buildEstimatedIntervalEntry(Number(dexVolume.h1) * 24, feeRate, safeLiquidity, 'dexVolume.h1*24')
  }

  return result
}

function computeFromAthPct(currentPrice, hourlyOhlcv = []) {
  const price = Number(currentPrice || 0)
  const ath = Math.max(price, ...(hourlyOhlcv || []).map((entry) => Number(entry.high || 0)).filter((value) => Number.isFinite(value) && value > 0))

  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(ath) || ath <= 0) {
    return null
  }

  return (ath - price) / ath * 100
}

function buildPoolBrowserCard({
  candidate,
  tokenResolution,
  dexMetrics = {},
  tokenMarketCapUsd = null,
  feeTvlInterval = DEFAULT_FEE_TVL_INTERVAL
}) {
  const resolutionSymbol = String(tokenResolution?.token?.symbol || '').trim()
  const resolutionName = String(tokenResolution?.token?.name || '').trim()
  const preferredCandidateSymbol = candidate.tokenSymbol || dexMetrics.baseToken?.symbol || 'UNKNOWN'
  const preferredCandidateName = candidate.tokenName || dexMetrics.baseToken?.name || preferredCandidateSymbol || 'Unknown token'
  const resolvedTokenSymbol = tokenResolution?.type === 'market'
    ? preferredCandidateSymbol
    : ((resolutionSymbol && resolutionSymbol !== 'UNKNOWN') ? resolutionSymbol : preferredCandidateSymbol)
  const resolvedTokenName = tokenResolution?.type === 'market'
    ? preferredCandidateName
    : ((resolutionName && resolutionName !== 'Address input' && resolutionName !== 'UNKNOWN') ? resolutionName : preferredCandidateName)

  const feeRate = computeFeeRate(candidate.fee)
  const effectiveLiquidityUsd = Number(dexMetrics.liquidityUsd || candidate.liquidityUsd || 0)
  const effectiveDexVolume = (dexMetrics.volume && Object.keys(dexMetrics.volume).length)
    ? dexMetrics.volume
    : (candidate.volume || {})
  const intervals = buildIntervalMetrics({
    feeRate,
    liquidityUsd: effectiveLiquidityUsd,
    dexVolume: effectiveDexVolume,
    hourlyOhlcv: [],
    minuteOhlcv: []
  })
  const fromAthPct = null
  const ageHours = computeAgeHours(dexMetrics.pairCreatedAt || candidate.pairCreatedAt)
  const marketCapUsd = Number(
    dexMetrics.marketCap
    || dexMetrics.fdv
    || candidate.marketCapUsd
    || candidate.fdvUsd
    || tokenMarketCapUsd
    || 0
  )

  return decoratePoolWithProtocolIdentity({
    id: candidate.id,
    pairAddress: candidate.pairAddress || dexMetrics.pairAddress || candidate.id.split(':')[1] || null,
    tokenAddress: tokenResolution?.type === 'market'
      ? (candidate.tokenAddress || dexMetrics.baseToken?.address || null)
      : (tokenResolution?.token?.address || candidate.tokenAddress || null),
    tokenSymbol: resolvedTokenSymbol,
    tokenName: resolvedTokenName,
    quoteTokenSymbol: candidate.quoteSymbol || dexMetrics.quoteToken?.symbol || null,
    quoteAddress: candidate.quoteAddress || dexMetrics.quoteToken?.address || null,
    dex: candidate.dex,
    protocol: candidate.protocol || candidate.dexDisplay || candidate.dexLabel || candidate.dex,
    protocolVersion: candidate.protocolVersion || null,
    dexLabel: candidate.dexLabel || String(candidate.dex || '').replace(/^\w/, (char) => char.toUpperCase()),
    dexDisplay: candidate.dexDisplay || candidate.dexLabel || String(candidate.dex || '').replace(/^\w/, (char) => char.toUpperCase()),
    dexUrl: candidate.dexUrl || dexMetrics.url || null,
    fee: Number(candidate.fee || 0),
    tickSpacing: candidate.tickSpacing ?? null,
    poolManager: candidate.poolManager || null,
    hooks: candidate.hooks || null,
    parameters: candidate.parameters || null,
    sqrtPriceX96: candidate.sqrtPriceX96 || null,
    feeTierLabel: formatFeePctLabel(Number(candidate.fee || 0) / 10_000),
    baseFeePct: Number(candidate.fee || 0) / 10_000,
    poolPrice: Number(candidate.price || dexMetrics.priceUsd || 0),
    priceUsd: Number(dexMetrics.priceUsd || candidate.price || 0),
    liquidityUsd: effectiveLiquidityUsd,
    liquidityLabel: formatCompactUsd(effectiveLiquidityUsd),
    marketCapUsd,
    marketCapLabel: formatCompactUsd(marketCapUsd),
    totalQuoteLiquidityUsd: Number(dexMetrics.liquidityQuoteUsd || candidate.totalQuoteLiquidityUsd || effectiveLiquidityUsd || 0),
    ageHours,
    ageLabel: ageHours == null ? 'n/a' : `${Math.round(ageHours)} hours`,
    holders: null,
    holdersLabel: 'n/a',
    fromAthPct,
    fromAthLabel: fromAthPct == null ? 'n/a' : toPercentString(fromAthPct),
    volume1hUsd: intervals['1h'].volumeUsd,
    fees1hUsd: intervals['1h'].feesUsd,
    volume24hUsd: intervals['24h'].volumeUsd,
    fees24hUsd: intervals['24h'].feesUsd,
    totalVolume: {
      h24: intervals['24h'].volumeUsd,
      h12: intervals['12h'].volumeUsd,
      h6: intervals['6h'].volumeUsd,
      h4: intervals['4h'].volumeUsd,
      h2: intervals['2h'].volumeUsd,
      h1: intervals['1h'].volumeUsd
    },
    feeTvl: intervals,
    activeFeeTvlInterval: feeTvlInterval,
    activeFeeTvlPct: intervals[feeTvlInterval]?.feeTvlPct ?? null,
    decision: candidate.decision?.action || 'unknown',
    decisionReason: candidate.decision?.reason || 'no decision',
    divergenceBps: candidate.sanity?.divergenceBps == null ? null : Number(candidate.sanity.divergenceBps.toFixed(2)),
    reference: candidate.reference === true,
    sourceCoverage: {
      ...(candidate.sourceCoverage || {}),
      dexScreener: Boolean(dexMetrics.pairAddress || candidate.sourceCoverage?.dexScreener),
      geckoTerminal: Boolean(candidate.sourceCoverage?.geckoTerminal)
    }
  }, { protocol: candidate.protocol || candidate.dexDisplay || candidate.dexLabel || candidate.dex })
}

function applyPoolBrowserFilters(cards, filters = {}) {
  return (cards || []).filter((card) => {
    const checks = [
      ['marketCapUsd', filters.minMarketCapM, 1_000_000, 'min'],
      ['marketCapUsd', filters.maxMarketCapM, 1_000_000, 'max'],
      ['ageHours', filters.minAgeHr, 1, 'min'],
      ['ageHours', filters.maxAgeHr, 1, 'max'],
      ['liquidityUsd', filters.minLiquidityK, 1_000, 'min'],
      ['liquidityUsd', filters.maxLiquidityK, 1_000, 'max'],
      ['volume24hUsd', filters.min24hVolK, 1_000, 'min'],
      ['volume24hUsd', filters.max24hVolK, 1_000, 'max'],
      ['fees24hUsd', filters.min24hFeesK, 1_000, 'min'],
      ['fees24hUsd', filters.max24hFeesK, 1_000, 'max'],
      ['fromAthPct', filters.minFromAthPct, 1, 'min'],
      ['fromAthPct', filters.maxFromAthPct, 1, 'max'],
      ['baseFeePct', filters.minBaseFeePct, 1, 'min'],
      ['baseFeePct', filters.maxBaseFeePct, 1, 'max']
    ]

    for (const [field, value, multiplier, type] of checks) {
      if (value === '' || value == null) {
        continue
      }

      const threshold = Number(value) * multiplier
      const fieldValue = Number(card[field])

      if (!Number.isFinite(fieldValue)) {
        return false
      }

      if (type === 'min' && fieldValue < threshold) {
        return false
      }

      if (type === 'max' && fieldValue > threshold) {
        return false
      }
    }

    if (filters.quoteToken && filters.quoteToken !== 'all') {
      const quote = String(card.quoteTokenSymbol || '').toLowerCase()
      if (filters.quoteToken === 'bnb' && !['bnb', 'wbnb'].includes(quote)) {
        return false
      }
      if (filters.quoteToken === 'usdt' && quote !== 'usdt') {
        return false
      }
    }

    return true
  })
}

function sortPoolBrowserCards(cards, { sortBy = 'feeTvl', feeTvlInterval = DEFAULT_FEE_TVL_INTERVAL } = {}) {
  const copy = [...(cards || [])]
  return copy.sort((left, right) => {
    if (sortBy === 'marketCap') {
      return Number(right.marketCapUsd || 0) - Number(left.marketCapUsd || 0)
    }

    if (sortBy === 'age') {
      return Number(left.ageHours || 0) - Number(right.ageHours || 0)
    }

    if (sortBy === 'volume') {
      return Number(right.volume24hUsd || 0) - Number(left.volume24hUsd || 0)
    }

    if (sortBy === 'liquidity') {
      return Number(right.liquidityUsd || 0) - Number(left.liquidityUsd || 0)
    }

    return Number(right.feeTvl?.[feeTvlInterval]?.feeTvlPct || -Infinity) - Number(left.feeTvl?.[feeTvlInterval]?.feeTvlPct || -Infinity)
  })
}

function buildPoolBrowserViewModel({
  workflow,
  tokenResolution,
  dexMetricsByPair = {},
  tokenMarketCapsByAddress = {},
  feeTvlInterval = DEFAULT_FEE_TVL_INTERVAL
}) {
  const candidates = (workflow?.shortlist?.candidates || []).map((candidate) => ({
    ...candidate,
    reference: workflow?.shortlist?.referencePool?.id === candidate.id
  }))

  const cards = candidates.map((candidate) => {
    const pairAddress = String(candidate.id.split(':')[1] || '').toLowerCase()
    return buildPoolBrowserCard({
      candidate,
      tokenResolution,
      dexMetrics: dexMetricsByPair[pairAddress] || {},
      tokenMarketCapUsd: tokenMarketCapsByAddress[String(candidate.tokenAddress || '').toLowerCase()] || null,
      feeTvlInterval
    })
  })

  return {
    generatedAt: workflow?.generatedAt || new Date().toISOString(),
    token: tokenResolution?.token || null,
    queryType: tokenResolution?.type || null,
    summary: workflow?.shortlist?.summary || { accepted: 0, warned: 0, blocked: 0 },
    referencePool: workflow?.shortlist?.referencePool || null,
    feeTvlInterval,
    cards
  }
}

module.exports = {
  DEFAULT_FEE_TVL_INTERVAL,
  computeFeeRate,
  formatFeePctLabel,
  computeAgeHours,
  buildIntervalMetrics,
  computeFromAthPct,
  buildPoolBrowserCard,
  applyPoolBrowserFilters,
  sortPoolBrowserCards,
  buildPoolBrowserViewModel
}
