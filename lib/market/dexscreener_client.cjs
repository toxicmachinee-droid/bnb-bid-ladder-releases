'use strict'

const { request: httpsRequest } = require('node:https')
const zlib = require('node:zlib')

const DEXSCREENER_BASE_URL = 'https://api.dexscreener.com'
const DEXSCREENER_PAIR_REQUEST_DELAY_MS = 650
const DEXSCREENER_MAX_RETRIES = 3
const DEXSCREENER_FETCH_TIMEOUT_MS = Math.max(1000, Number(process.env.DEXSCREENER_FETCH_TIMEOUT_MS || 3500))

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function fetchJsonWithHardTimeout(url, timeoutMs = DEXSCREENER_FETCH_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let request = null
    const timer = setTimeout(() => {
      if (request && !request.destroyed) {
        request.destroy(new Error(`dexscreener request timed out after ${timeoutMs}ms`))
      }
    }, Math.max(1, Number(timeoutMs || DEXSCREENER_FETCH_TIMEOUT_MS)))

    request = httpsRequest(new URL(url), {
      headers: {
        accept: 'application/json',
        'accept-language': 'en-US,en;q=0.9',
        'accept-encoding': 'gzip,deflate,br',
        'cache-control': 'no-cache',
        pragma: 'no-cache',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36'
      }
    }, (response) => {
      let stream = response
      const encoding = String(response.headers['content-encoding'] || '').toLowerCase()
      if (encoding === 'br') {
        stream = response.pipe(zlib.createBrotliDecompress())
      } else if (encoding === 'gzip') {
        stream = response.pipe(zlib.createGunzip())
      } else if (encoding === 'deflate') {
        stream = response.pipe(zlib.createInflate())
      }

      let body = ''
      stream.setEncoding('utf8')
      stream.on('data', (chunk) => {
        body += chunk
      })
      stream.on('end', () => {
        clearTimeout(timer)
        if (response.statusCode < 200 || response.statusCode >= 300) {
          const error = new Error(`dexscreener request failed: ${response.statusCode}`)
          error.status = response.statusCode
          error.retryAfter = Number(response.headers['retry-after'] || 0)
          reject(error)
          return
        }

        try {
          resolve(body ? JSON.parse(body) : {})
        } catch (error) {
          reject(error)
        }
      })
      stream.on('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
    })

    request.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    request.on('close', () => clearTimeout(timer))
    request.end()
  })
}

async function fetchJson(url, { fetchImpl = fetch, timeoutMs = DEXSCREENER_FETCH_TIMEOUT_MS } = {}) {
  for (let attempt = 0; attempt < DEXSCREENER_MAX_RETRIES; attempt += 1) {
    if (fetchImpl === fetch) {
      try {
        return await fetchJsonWithHardTimeout(url, timeoutMs)
      } catch (error) {
        if (error?.status === 429 && attempt < DEXSCREENER_MAX_RETRIES - 1) {
          const retryDelayMs = Math.min(
            Number(error.retryAfter || 0) > 0 ? Number(error.retryAfter) * 1000 : 1200 * (attempt + 1),
            1200
          )
          await sleep(retryDelayMs)
          continue
        }
        throw error
      }
    }

    const controller = typeof AbortController === 'function' ? new AbortController() : null
    const timer = controller && Number(timeoutMs || 0) > 0
      ? setTimeout(() => controller.abort(), Number(timeoutMs))
      : null
    let response

    try {
      response = await fetchImpl(url, {
        headers: {
          accept: 'application/json',
          'accept-language': 'en-US,en;q=0.9',
          'cache-control': 'no-cache',
          pragma: 'no-cache',
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36'
        },
        ...(controller ? { signal: controller.signal } : {})
      })
    } finally {
      if (timer) {
        clearTimeout(timer)
      }
    }

    if (response.ok) {
      return response.json()
    }

    if (response.status === 429 && attempt < DEXSCREENER_MAX_RETRIES - 1) {
      const retryAfterHeader = Number(response.headers.get('retry-after') || 0)
      const retryDelayMs = Math.min(
        retryAfterHeader > 0 ? retryAfterHeader * 1000 : 1200 * (attempt + 1),
        1200
      )
      await sleep(retryDelayMs)
      continue
    }

    throw new Error(`dexscreener request failed: ${response.status}`)
  }
  throw new Error('dexscreener request exhausted retries')
}

async function searchPairs(query, {
  fetchImpl = fetch
} = {}) {
  if (!String(query || '').trim()) {
    return []
  }

  const payload = await fetchJson(
    `${DEXSCREENER_BASE_URL}/latest/dex/search?q=${encodeURIComponent(query)}`,
    { fetchImpl }
  ).catch(() => ({ pairs: [] }))

  return (payload.pairs || []).map((pair) => normalizeDexScreenerPair(pair))
}

function normalizeDexScreenerPair(pair = {}) {
  const priceUsd = Number(pair.priceUsd || 0)
  const priceNative = Number(pair.priceNative || 0)
  const quotedTokenUsdPrice = Number(pair.quoteToken?.priceUsd || 0)
  const derivedQuoteTokenUsdPrice = priceUsd > 0 && priceNative > 0
    ? priceUsd / priceNative
    : 0
  return {
    chainId: pair.chainId || null,
    dexId: pair.dexId || null,
    pairAddress: pair.pairAddress || null,
    url: pair.url || null,
    labels: Array.isArray(pair.labels) ? pair.labels : [],
    baseToken: pair.baseToken ? {
      ...pair.baseToken,
      name: pair.baseToken.name || null
    } : null,
    quoteToken: pair.quoteToken ? {
      ...pair.quoteToken,
      name: pair.quoteToken.name || null
    } : null,
    priceUsd,
    priceNative,
    quoteTokenUsdPrice: quotedTokenUsdPrice > 0 ? quotedTokenUsdPrice : derivedQuoteTokenUsdPrice,
    liquidityUsd: Number(pair.liquidity?.usd || 0),
    liquidityBase: Number(pair.liquidity?.base || 0),
    liquidityQuote: Number(pair.liquidity?.quote || 0),
    liquidityQuoteUsd: Number(pair.liquidity?.quote || 0) * Number(pair.quoteToken?.priceUsd || pair.priceUsd || 0),
    marketCap: Number(pair.marketCap || 0),
    fdv: Number(pair.fdv || 0),
    pairCreatedAt: Number(pair.pairCreatedAt || 0),
    priceChange: {
      h1: Number(pair.priceChange?.h1 || 0),
      h6: Number(pair.priceChange?.h6 || 0),
      h24: Number(pair.priceChange?.h24 || 0)
    },
    volume: {
      m5: Number(pair.volume?.m5 || 0),
      h1: Number(pair.volume?.h1 || 0),
      h6: Number(pair.volume?.h6 || 0),
      h24: Number(pair.volume?.h24 || 0)
    },
    txns: {
      h1: pair.txns?.h1 || null,
      h6: pair.txns?.h6 || null,
      h24: pair.txns?.h24 || null
    }
  }
}

async function fetchPairsByAddresses(pairAddresses, {
  chainId = 'bsc',
  fetchImpl = fetch,
  requestDelayMs = DEXSCREENER_PAIR_REQUEST_DELAY_MS,
  concurrency = 1
} = {}) {
  if (!pairAddresses?.length) {
    return []
  }

  const unique = [...new Set(pairAddresses.filter(Boolean))]

  const responses = []
  const resolvedConcurrency = Math.max(1, Math.floor(Number(concurrency || 1)))
  for (let index = 0; index < unique.length; index += resolvedConcurrency) {
    if (index > 0 && Number(requestDelayMs || 0) > 0) {
      await sleep(Number(requestDelayMs))
    }

    const batch = unique.slice(index, index + resolvedConcurrency)
    const batchPath = batch.map((pairAddress) => String(pairAddress || '').trim()).filter(Boolean).join(',')
    const batchResponses = batchPath
      ? [await fetchJson(
          `${DEXSCREENER_BASE_URL}/latest/dex/pairs/${chainId}/${batchPath}`,
          { fetchImpl }
        ).catch(() => ({ pairs: [] }))]
      : []
    responses.push(...batchResponses)
  }

  return responses
    .flatMap((response) => response.pairs || [])
    .map((pair) => normalizeDexScreenerPair(pair))
}

async function fetchTokenPairsByTokenAddress(tokenAddress, {
  chainId = 'bsc',
  fetchImpl = fetch,
  timeoutMs = DEXSCREENER_FETCH_TIMEOUT_MS
} = {}) {
  if (!tokenAddress) {
    return []
  }

  const payload = await fetchJson(
    `${DEXSCREENER_BASE_URL}/token-pairs/v1/${chainId}/${tokenAddress}`,
    { fetchImpl, timeoutMs }
  ).catch(() => [])

  return (Array.isArray(payload) ? payload : []).map((pair) => normalizeDexScreenerPair(pair))
}

async function fetchPairsByTokenAddresses(tokenAddresses, {
  chainId = 'bsc',
  fetchImpl = fetch,
  timeoutMs = DEXSCREENER_FETCH_TIMEOUT_MS,
  batchConcurrency = 6
} = {}) {
  const unique = [...new Set((tokenAddresses || []).filter(Boolean))]

  if (!unique.length) {
    return []
  }

  const batches = []
  for (let index = 0; index < unique.length; index += 30) {
    batches.push(unique.slice(index, index + 30))
  }

  const responses = []
  const concurrency = Math.max(1, Math.floor(Number(batchConcurrency || 1)))
  for (let index = 0; index < batches.length; index += concurrency) {
    const wave = batches.slice(index, index + concurrency)
    const waveResponses = await Promise.all(wave.map((batch) => fetchJson(
      `${DEXSCREENER_BASE_URL}/tokens/v1/${chainId}/${batch.join(',')}`,
      { fetchImpl, timeoutMs }
    ).catch(() => [])))
    responses.push(...waveResponses)
  }

  return responses
    .flatMap((response) => Array.isArray(response) ? response : (response?.pairs || []))
    .map((pair) => normalizeDexScreenerPair(pair))
}

module.exports = {
  DEXSCREENER_BASE_URL,
  normalizeDexScreenerPair,
  fetchPairsByAddresses,
  fetchPairsByTokenAddresses,
  fetchTokenPairsByTokenAddress,
  searchPairs
}
