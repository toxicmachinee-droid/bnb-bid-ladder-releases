'use strict'

const {
  normalizeDexScreenerPair,
  searchPairs: defaultSearchPairs
} = require('../market/dexscreener_client.cjs')
const {
  buildPoolBrowserViewModel,
  DEFAULT_FEE_TVL_INTERVAL
} = require('../operator/pool_browser.cjs')

const BSC_CHAIN_ID = 'bsc'
const DEFAULT_PUBLIC_SEARCH_LIMIT = 48
const DEFAULT_POOL_FEE = 2500
const SUPPORTED_QUOTES = new Set([
  '0x55d398326f99059ff775485246999027b3197955',
  '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d',
  '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c'
])

function normalizeAddress(value) {
  return String(value || '').trim().toLowerCase()
}

function inferFeeFromPair(pair = {}) {
  const labels = Array.isArray(pair.labels) ? pair.labels : []
  for (const label of labels) {
    const match = /(\d+(?:\.\d+)?)\s*%/.exec(String(label || ''))
    if (match) {
      const pct = Number(match[1])
      if (Number.isFinite(pct) && pct > 0) {
        return Math.round(pct * 10_000)
      }
    }
  }
  return DEFAULT_POOL_FEE
}

function resolvePublicQuotePair(pair = {}) {
  const baseAddress = normalizeAddress(pair.baseToken?.address)
  const quoteAddress = normalizeAddress(pair.quoteToken?.address)
  if (!baseAddress || !quoteAddress) return null

  if (SUPPORTED_QUOTES.has(quoteAddress)) {
    return {
      tokenAddress: baseAddress,
      tokenSymbol: pair.baseToken?.symbol || 'TOKEN',
      tokenName: pair.baseToken?.name || pair.baseToken?.symbol || 'Token',
      quoteAddress,
      quoteSymbol: pair.quoteToken?.symbol || 'QUOTE'
    }
  }

  if (SUPPORTED_QUOTES.has(baseAddress)) {
    return {
      tokenAddress: quoteAddress,
      tokenSymbol: pair.quoteToken?.symbol || 'TOKEN',
      tokenName: pair.quoteToken?.name || pair.quoteToken?.symbol || 'Token',
      quoteAddress: baseAddress,
      quoteSymbol: pair.baseToken?.symbol || 'QUOTE'
    }
  }

  return null
}

function mapPairToCandidate(pair = {}) {
  const normalized = normalizeDexScreenerPair(pair)
  if (normalized.chainId && normalized.chainId !== BSC_CHAIN_ID) return null
  if (!normalized.pairAddress) return null
  const resolved = resolvePublicQuotePair(normalized)
  if (!resolved) return null

  return {
    id: `${normalized.dexId || 'dex'}:${normalizeAddress(normalized.pairAddress)}`,
    pairAddress: normalized.pairAddress,
    dex: normalized.dexId || 'dex',
    dexLabel: normalized.dexId || 'DEX',
    dexDisplay: normalized.dexId || 'DEX',
    dexUrl: normalized.url || null,
    protocol: normalized.dexId || 'DEX',
    protocolVersion: 'read-only',
    fee: inferFeeFromPair(normalized),
    tickSpacing: null,
    tokenAddress: resolved.tokenAddress,
    tokenSymbol: resolved.tokenSymbol,
    tokenName: resolved.tokenName,
    quoteAddress: resolved.quoteAddress,
    quoteSymbol: resolved.quoteSymbol,
    price: Number(normalized.priceUsd || 0),
    liquidityUsd: Number(normalized.liquidityUsd || 0),
    marketCapUsd: Number(normalized.marketCap || normalized.fdv || 0),
    fdvUsd: Number(normalized.fdv || 0),
    pairCreatedAt: Number(normalized.pairCreatedAt || 0),
    volume: normalized.volume || {},
    sourceCoverage: {
      dexScreener: true,
      geckoTerminal: false
    },
    decision: {
      action: 'read-only',
      reason: 'Public Pool Search preview only'
    }
  }
}

function buildEmptyPayload({ query, generatedAt = new Date().toISOString() } = {}) {
  return {
    generatedAt,
    query: String(query || ''),
    queryType: 'public-read-only',
    workflow: {
      mode: 'public-read-only',
      remotePlannerRequired: true
    },
    summary: {
      accepted: 0,
      warned: 0,
      blocked: 0
    },
    referencePool: null,
    feeTvlInterval: DEFAULT_FEE_TVL_INTERVAL,
    cards: []
  }
}

async function buildReadOnlyPoolSearchPayload({
  query,
  searchPairs = defaultSearchPairs,
  limit = DEFAULT_PUBLIC_SEARCH_LIMIT
} = {}) {
  const trimmedQuery = String(query || '').trim()
  if (!trimmedQuery) {
    return {
      ok: true,
      payload: buildEmptyPayload({ query: trimmedQuery })
    }
  }

  const pairs = await searchPairs(trimmedQuery).catch(() => [])
  const candidates = [...new Map((pairs || [])
    .map(mapPairToCandidate)
    .filter(Boolean)
    .sort((left, right) => Number(right.liquidityUsd || 0) - Number(left.liquidityUsd || 0))
    .slice(0, Math.max(1, Number(limit || DEFAULT_PUBLIC_SEARCH_LIMIT)))
    .map((candidate) => [normalizeAddress(candidate.pairAddress), candidate])).values()]
  const generatedAt = new Date().toISOString()
  const payload = buildPoolBrowserViewModel({
    workflow: {
      tokenAddress: candidates[0]?.tokenAddress || null,
      generatedAt,
      poolCount: candidates.length,
      pools: candidates,
      shortlist: {
        generatedAt,
        summary: {
          accepted: candidates.length,
          warned: 0,
          blocked: 0
        },
        referencePool: candidates[0] || null,
        candidates
      }
    },
    tokenResolution: {
      ok: true,
      type: 'public-read-only',
      token: candidates[0]
        ? {
            address: candidates[0].tokenAddress,
            symbol: candidates[0].tokenSymbol,
            name: candidates[0].tokenName
          }
        : null
    },
    dexMetricsByPair: Object.fromEntries(candidates.map((candidate) => [normalizeAddress(candidate.pairAddress), {
      pairAddress: candidate.pairAddress,
      url: candidate.dexUrl,
      liquidityUsd: candidate.liquidityUsd,
      marketCap: candidate.marketCapUsd,
      fdv: candidate.fdvUsd,
      priceUsd: candidate.price,
      pairCreatedAt: candidate.pairCreatedAt,
      volume: candidate.volume,
      baseToken: {
        address: candidate.tokenAddress,
        symbol: candidate.tokenSymbol,
        name: candidate.tokenName
      },
      quoteToken: {
        address: candidate.quoteAddress,
        symbol: candidate.quoteSymbol
      }
    }])),
    tokenMarketCapsByAddress: Object.fromEntries(candidates.map((candidate) => [normalizeAddress(candidate.tokenAddress), candidate.marketCapUsd])),
    feeTvlInterval: DEFAULT_FEE_TVL_INTERVAL
  })

  return {
    ok: true,
    payload: {
      ...payload,
      query: trimmedQuery,
      queryType: 'public-read-only',
      workflow: {
        mode: 'public-read-only',
        remotePlannerRequired: true
      }
    }
  }
}

module.exports = {
  DEFAULT_PUBLIC_SEARCH_LIMIT,
  buildReadOnlyPoolSearchPayload,
  mapPairToCandidate
}
