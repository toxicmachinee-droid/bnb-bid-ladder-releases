'use strict'

const CODEX_GRAPHQL_URL = 'https://graph.codex.io/graphql'

function resolveCodexApiKey(apiKey = null) {
  return String(
    apiKey
    || process.env.DEFINED_CODEX_API_KEY
    || process.env.CODEX_API_KEY
    || process.env.DEFINED_API_KEY
    || ''
  ).trim()
}

function hasCodexApiKey(apiKey = null) {
  return Boolean(resolveCodexApiKey(apiKey))
}

function toNumber(value) {
  const numeric = Number(value || 0)
  return Number.isFinite(numeric) ? numeric : 0
}

async function codexQuery(query, variables = {}, {
  fetchImpl = fetch,
  apiKey = null
} = {}) {
  const authorization = resolveCodexApiKey(apiKey)
  if (!authorization) {
    throw new Error('codex api key is not configured')
  }

  const response = await fetchImpl(CODEX_GRAPHQL_URL, {
    method: 'POST',
    headers: {
      Authorization: authorization,
      'Content-Type': 'application/json',
      accept: 'application/json'
    },
    body: JSON.stringify({
      query,
      variables
    })
  })

  if (!response.ok) {
    throw new Error(`codex request failed: ${response.status}`)
  }

  const payload = await response.json()
  if (Array.isArray(payload?.errors) && payload.errors.length) {
    throw new Error(payload.errors[0]?.message || 'codex graphql error')
  }

  return payload?.data || {}
}

function normalizePairMetadata(entry = {}) {
  return {
    pairId: entry.id || null,
    pairAddress: entry.pairAddress || null,
    networkId: Number(entry.networkId || 0) || null,
    exchangeId: entry.exchangeId || null,
    feeBps: Number(entry.fee || 0) || null,
    quoteToken: entry.quoteToken || null,
    liquidityUsd: toNumber(entry.liquidity),
    priceUsd: toNumber(entry.price),
    priceUsdNonQuoteToken: toNumber(entry.priceNonQuoteToken),
    volume5mUsd: toNumber(entry.volume5m),
    volume1hUsd: toNumber(entry.volume1),
    volume4hUsd: toNumber(entry.volume4),
    volume12hUsd: toNumber(entry.volume12),
    volume24hUsd: toNumber(entry.volume24),
    priceChange1hPct: Number(entry.priceChange1 || 0),
    priceChange4hPct: Number(entry.priceChange4 || 0),
    priceChange12hPct: Number(entry.priceChange12 || 0),
    priceChange24hPct: Number(entry.priceChange24 || 0),
    tickSpacing: Number(entry.tickSpacing || 0) || null,
    token0: entry.token0 ? {
      address: entry.token0.address || null,
      symbol: entry.token0.symbol || null,
      name: entry.token0.name || null,
      decimals: Number(entry.token0.decimals || 0) || null,
      pooled: toNumber(entry.token0.pooled),
      priceUsd: toNumber(entry.token0.price)
    } : null,
    token1: entry.token1 ? {
      address: entry.token1.address || null,
      symbol: entry.token1.symbol || null,
      name: entry.token1.name || null,
      decimals: Number(entry.token1.decimals || 0) || null,
      pooled: toNumber(entry.token1.pooled),
      priceUsd: toNumber(entry.token1.price)
    } : null
  }
}

function normalizeListPairsEntry(entry = {}) {
  return {
    pairAddress: entry?.pair?.address || null,
    pairId: entry?.pair?.id || null,
    networkId: Number(entry?.pair?.networkId || 0) || null,
    protocol: entry?.pair?.protocol || null,
    feeBps: Number(entry?.pair?.fee || 0) || null,
    tickSpacing: Number(entry?.pair?.tickSpacing || 0) || null,
    createdAt: Number(entry?.pair?.createdAt || 0) || null,
    exchangeName: entry?.exchange?.name || null,
    exchangeId: entry?.exchange?.id || null,
    liquidityUsd: toNumber(entry?.liquidity),
    volumeUsd: toNumber(entry?.volume),
    quoteToken: entry?.quoteToken || null,
    token: entry?.token ? {
      address: entry.token.address || null,
      symbol: entry.token.symbol || null,
      name: entry.token.name || null,
      createdAt: Number(entry.token.createdAt || 0) || null
    } : null,
    backingToken: entry?.backingToken ? {
      address: entry.backingToken.address || null,
      symbol: entry.backingToken.symbol || null,
      name: entry.backingToken.name || null,
      createdAt: Number(entry.backingToken.createdAt || 0) || null
    } : null
  }
}

async function fetchPairMetadata(pairAddress, {
  networkId = 56,
  quoteToken = null,
  statsType = 'UNFILTERED',
  fetchImpl = fetch,
  apiKey = null
} = {}) {
  if (!String(pairAddress || '').trim()) {
    return null
  }

  const data = await codexQuery(`
    query PairMetadata($pairId: String!, $quoteToken: QuoteToken, $statsType: TokenPairStatisticsType) {
      pairMetadata(pairId: $pairId, quoteToken: $quoteToken, statsType: $statsType) {
        exchangeId
        fee
        id
        quoteToken
        networkId
        liquidity
        pairAddress
        price
        priceNonQuoteToken
        priceChange1
        priceChange4
        priceChange12
        priceChange24
        tickSpacing
        volume5m
        volume1
        volume4
        volume12
        volume24
        token0 {
          address
          decimals
          name
          pooled
          price
          symbol
        }
        token1 {
          address
          decimals
          name
          pooled
          price
          symbol
        }
      }
    }
  `, {
    pairId: `${String(pairAddress).toLowerCase()}:${Number(networkId || 56)}`,
    quoteToken,
    statsType
  }, {
    fetchImpl,
    apiKey
  })

  return data?.pairMetadata ? normalizePairMetadata(data.pairMetadata) : null
}

async function listPairsWithMetadataForToken(tokenAddress, {
  networkId = 56,
  limit = 12,
  fetchImpl = fetch,
  apiKey = null
} = {}) {
  if (!String(tokenAddress || '').trim()) {
    return []
  }

  const data = await codexQuery(`
    query ListPairsWithMetadataForToken($networkId: Int!, $tokenAddress: String!, $limit: Int) {
      listPairsWithMetadataForToken(networkId: $networkId, tokenAddress: $tokenAddress, limit: $limit) {
        results {
          volume
          liquidity
          quoteToken
          exchange {
            id
            name
          }
          pair {
            address
            id
            networkId
            fee
            protocol
            tickSpacing
            createdAt
          }
          token {
            address
            symbol
            name
            createdAt
          }
          backingToken {
            address
            symbol
            name
            createdAt
          }
        }
      }
    }
  `, {
    networkId: Number(networkId || 56),
    tokenAddress: String(tokenAddress).toLowerCase(),
    limit: Math.max(1, Math.min(24, Number(limit || 12)))
  }, {
    fetchImpl,
    apiKey
  })

  return (data?.listPairsWithMetadataForToken?.results || []).map((entry) => normalizeListPairsEntry(entry))
}

module.exports = {
  CODEX_GRAPHQL_URL,
  hasCodexApiKey,
  fetchPairMetadata,
  listPairsWithMetadataForToken
}
