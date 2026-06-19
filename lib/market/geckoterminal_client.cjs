'use strict'

const GECKOTERMINAL_BASE_URL = 'https://api.geckoterminal.com/api/v2'
const GECKOTERMINAL_WEB_BASE_URL = 'https://www.geckoterminal.com'

async function fetchJson(url, { fetchImpl = fetch } = {}) {
  const response = await fetchImpl(url, {
    headers: {
      accept: 'application/json'
    }
  })

  if (!response.ok) {
    throw new Error(`geckoterminal request failed: ${response.status}`)
  }

  return response.json()
}

async function fetchText(url, { fetchImpl = fetch } = {}) {
  const response = await fetchImpl(url, {
    headers: {
      accept: 'text/html,application/json'
    }
  })

  if (!response.ok) {
    throw new Error(`geckoterminal text request failed: ${response.status}`)
  }

  return response.text()
}

function parseCompactNumber(value) {
  const raw = String(value || '').trim().replace(/,/g, '')

  if (!raw) {
    return null
  }

  const suffix = raw.slice(-1).toUpperCase()
  const numeric = Number(['K', 'M', 'B'].includes(suffix) ? raw.slice(0, -1) : raw)

  if (!Number.isFinite(numeric)) {
    return null
  }

  if (suffix === 'K') {
    return numeric * 1_000
  }

  if (suffix === 'M') {
    return numeric * 1_000_000
  }

  if (suffix === 'B') {
    return numeric * 1_000_000_000
  }

  return numeric
}

function extractHtmlMetric(html, label) {
  const pattern = new RegExp(`${label}[^0-9A-Za-z$%-]*([0-9.,]+(?:[KMB])?(?:\\/100)?|\\$[0-9.,]+(?:[KMB])?)`, 'i')
  const match = html.match(pattern)
  return match ? match[1] : null
}

async function fetchPoolPageMetrics(pairAddress, {
  network = 'bsc',
  fetchImpl = fetch
} = {}) {
  const html = await fetchText(`${GECKOTERMINAL_WEB_BASE_URL}/${network}/pools/${pairAddress}`, { fetchImpl })
  const holdersRaw = extractHtmlMetric(html, 'Holders')
  const gtScoreRaw = extractHtmlMetric(html, 'GT Score')
  const marketCapRaw = extractHtmlMetric(html, 'Market Cap')

  return {
    holders: parseCompactNumber(holdersRaw),
    gtScore: gtScoreRaw ? Number(String(gtScoreRaw).split('/')[0]) : null,
    marketCapUsd: marketCapRaw ? parseCompactNumber(String(marketCapRaw).replace('$', '')) : null
  }
}

async function fetchPoolApiMetrics(pairAddress, {
  network = 'bsc',
  fetchImpl = fetch
} = {}) {
  const payload = await fetchJson(
    `${GECKOTERMINAL_BASE_URL}/networks/${network}/pools/${pairAddress}`,
    { fetchImpl }
  )

  const attributes = payload?.data?.attributes || {}
  const relationships = payload?.data?.relationships || {}
  const baseTokenId = String(relationships?.base_token?.data?.id || '')
  const quoteTokenId = String(relationships?.quote_token?.data?.id || '')
  const extractAddress = (value) => {
    const parts = String(value || '').split('_')
    return parts.length > 1 ? parts.slice(1).join('_') : null
  }

  return {
    pairAddress: attributes.address || pairAddress || null,
    tokenAddress: extractAddress(baseTokenId),
    quoteAddress: extractAddress(quoteTokenId),
    tokenSymbol: String(attributes.name || '').split('/')[0].trim() || null,
    quoteTokenSymbol: String(attributes.name || '').split('/')[1].trim() || null,
    priceUsd: Number(attributes.base_token_price_usd || 0),
    liquidityUsd: Number(attributes.reserve_in_usd || 0),
    marketCapUsd: (() => {
      const marketCapUsd = Number(attributes.market_cap_usd || 0)
      if (Number.isFinite(marketCapUsd) && marketCapUsd > 0) {
        return marketCapUsd
      }
      const fdvUsd = Number(attributes.fdv_usd || 0)
      return Number.isFinite(fdvUsd) ? fdvUsd : 0
    })(),
    pairCreatedAt: attributes.pool_created_at ? Date.parse(attributes.pool_created_at) : null,
    volumeUsd: {
      m5: Number(attributes.volume_usd?.m5 || 0),
      h1: Number(attributes.volume_usd?.h1 || 0),
      h6: Number(attributes.volume_usd?.h6 || 0),
      h24: Number(attributes.volume_usd?.h24 || 0)
    },
    transactions: attributes.transactions || null
  }
}

function extractRelationshipAddress(relationship = {}) {
  const rawId = String(relationship?.data?.id || '')
  const parts = rawId.split('_')
  return parts.length > 1 ? parts.slice(1).join('_') : null
}

function buildIncludedTokenMap(included = []) {
  return new Map(
    (included || [])
      .filter((entry) => entry?.type === 'token' && entry?.attributes?.address)
      .map((entry) => [String(entry.id || ''), entry.attributes])
  )
}

function extractRelationshipId(relationship = {}) {
  return String(relationship?.data?.id || '').toLowerCase() || null
}

function parseFeePctFromPoolName(name) {
  const match = String(name || '').match(/([0-9.]+)%\s*$/)
  const feePct = match ? Number(match[1]) : null
  return Number.isFinite(feePct) ? feePct : null
}

function normalizePoolApiEntry(entry = {}, includedTokenMap = new Map()) {
  const attributes = entry?.attributes || {}
  const relationships = entry?.relationships || {}
  const baseToken = includedTokenMap.get(String(relationships?.base_token?.data?.id || '')) || {}
  const quoteToken = includedTokenMap.get(String(relationships?.quote_token?.data?.id || '')) || {}

  return {
    pairAddress: attributes.address || extractRelationshipAddress({ data: entry?.id }) || null,
    tokenAddress: baseToken.address || extractRelationshipAddress(relationships.base_token),
    quoteAddress: quoteToken.address || extractRelationshipAddress(relationships.quote_token),
    tokenSymbol: baseToken.symbol || String(attributes.name || '').split('/')[0].trim() || null,
    quoteTokenSymbol: quoteToken.symbol || String(attributes.name || '').split('/')[1].trim() || null,
    priceUsd: Number(attributes.base_token_price_usd || 0),
    quoteTokenPriceUsd: Number(attributes.quote_token_price_usd || 0),
    liquidityUsd: Number(attributes.reserve_in_usd || 0),
    marketCapUsd: (() => {
      const marketCapUsd = Number(attributes.market_cap_usd || 0)
      if (Number.isFinite(marketCapUsd) && marketCapUsd > 0) {
        return marketCapUsd
      }
      const fdvUsd = Number(attributes.fdv_usd || 0)
      return Number.isFinite(fdvUsd) ? fdvUsd : 0
    })(),
    pairCreatedAt: attributes.pool_created_at ? Date.parse(attributes.pool_created_at) : null,
    volumeUsd: {
      m5: Number(attributes.volume_usd?.m5 || 0),
      h1: Number(attributes.volume_usd?.h1 || 0),
      h6: Number(attributes.volume_usd?.h6 || 0),
      h24: Number(attributes.volume_usd?.h24 || 0)
    },
    transactions: attributes.transactions || null,
    dexId: extractRelationshipId(relationships.dex),
    feePct: parseFeePctFromPoolName(attributes.name)
  }
}

async function fetchTokenPoolsApiMetrics(tokenAddress, {
  network = 'bsc',
  page = 1,
  fetchImpl = fetch
} = {}) {
  const normalizedTokenAddress = String(tokenAddress || '').trim().toLowerCase()
  if (!normalizedTokenAddress) {
    return []
  }

  const query = new URLSearchParams({
    include: 'base_token,quote_token',
    page: String(Math.max(1, Number(page || 1)))
  })
  const payload = await fetchJson(
    `${GECKOTERMINAL_BASE_URL}/networks/${network}/tokens/${normalizedTokenAddress}/pools?${query.toString()}`,
    { fetchImpl }
  )

  const includedTokenMap = buildIncludedTokenMap(payload?.included || [])
  return (payload?.data || [])
    .map((entry) => normalizePoolApiEntry(entry, includedTokenMap))
    .filter((entry) => entry?.pairAddress)
}

async function fetchPoolsApiMetricsMulti(pairAddresses, {
  network = 'bsc',
  batchSize = 25,
  concurrency = 4,
  fetchImpl = fetch
} = {}) {
  const unique = [...new Set((pairAddresses || []).filter(Boolean).map((value) => String(value).toLowerCase()))]
  if (!unique.length) {
    return []
  }

  const normalizedBatchSize = Math.max(1, Math.min(50, Number(batchSize || 25)))
  const batches = []
  for (let index = 0; index < unique.length; index += normalizedBatchSize) {
    batches.push(unique.slice(index, index + normalizedBatchSize))
  }

  const results = []
  const normalizedConcurrency = Math.max(1, Math.min(8, Number(concurrency || 4)))
  for (let index = 0; index < batches.length; index += normalizedConcurrency) {
    const wave = batches.slice(index, index + normalizedConcurrency)
    const payloads = await Promise.all(wave.map((batch) => fetchJson(
      `${GECKOTERMINAL_BASE_URL}/networks/${network}/pools/multi/${batch.join(',')}?include=base_token,quote_token`,
      { fetchImpl }
    ).catch(() => null)))

    for (const payload of payloads) {
      if (!payload) {
        continue
      }

      const includedTokenMap = buildIncludedTokenMap(payload?.included || [])
      for (const entry of payload?.data || []) {
        results.push(normalizePoolApiEntry(entry, includedTokenMap))
      }
    }
  }

  return results
}

async function fetchTokensApiMetricsMulti(tokenAddresses, {
  network = 'bsc',
  batchSize = 25,
  concurrency = 4,
  fetchImpl = fetch
} = {}) {
  const unique = [...new Set((tokenAddresses || []).filter(Boolean).map((value) => String(value).toLowerCase()))]
  if (!unique.length) {
    return []
  }

  const normalizedBatchSize = Math.max(1, Math.min(50, Number(batchSize || 25)))
  const batches = []
  for (let index = 0; index < unique.length; index += normalizedBatchSize) {
    batches.push(unique.slice(index, index + normalizedBatchSize))
  }

  const results = []
  const normalizedConcurrency = Math.max(1, Math.min(8, Number(concurrency || 4)))
  for (let index = 0; index < batches.length; index += normalizedConcurrency) {
    const wave = batches.slice(index, index + normalizedConcurrency)
    const payloads = await Promise.all(wave.map((batch) => fetchJson(
      `${GECKOTERMINAL_BASE_URL}/networks/${network}/tokens/multi/${batch.join(',')}`,
      { fetchImpl }
    ).catch(() => null)))

    for (const payload of payloads) {
      if (!payload) {
        continue
      }

      for (const entry of payload?.data || []) {
        const attributes = entry?.attributes || {}
        results.push({
          address: String(attributes.address || '').toLowerCase() || null,
          symbol: attributes.symbol || null,
          name: attributes.name || null,
          priceUsd: Number(attributes.price_usd || 0),
          marketCapUsd: (() => {
            const marketCapUsd = Number(attributes.market_cap_usd || 0)
            if (Number.isFinite(marketCapUsd) && marketCapUsd > 0) {
              return marketCapUsd
            }
            const fdvUsd = Number(attributes.fdv_usd || 0)
            return Number.isFinite(fdvUsd) ? fdvUsd : 0
          })()
        })
      }
    }
  }

  return results
}

function normalizeOhlcvList(payload) {
  const list = payload?.data?.attributes?.ohlcv_list || []
  return list.map((entry) => ({
    timestamp: Number(entry[0] || 0),
    open: Number(entry[1] || 0),
    high: Number(entry[2] || 0),
    low: Number(entry[3] || 0),
    close: Number(entry[4] || 0),
    volume: Number(entry[5] || 0)
  }))
}

async function fetchPoolOhlcv(pairAddress, {
  network = 'bsc',
  timeframe = 'hour',
  aggregate = 1,
  limit = 24,
  currency = 'usd',
  fetchImpl = fetch
} = {}) {
  const query = new URLSearchParams({
    aggregate: String(aggregate),
    limit: String(limit),
    currency
  })
  const payload = await fetchJson(
    `${GECKOTERMINAL_BASE_URL}/networks/${network}/pools/${pairAddress}/ohlcv/${timeframe}?${query.toString()}`,
    { fetchImpl }
  )

  return normalizeOhlcvList(payload)
}

module.exports = {
  GECKOTERMINAL_BASE_URL,
  GECKOTERMINAL_WEB_BASE_URL,
  fetchPoolApiMetrics,
  fetchPoolsApiMetricsMulti,
  fetchTokenPoolsApiMetrics,
  parseCompactNumber,
  fetchPoolPageMetrics,
  fetchPoolOhlcv,
  fetchTokensApiMetricsMulti
}
