'use strict'

const { ethers } = require('ethers')
const { getDexConfig } = require('../config/dex_config.cjs')
const {
  normalizeDexScreenerPair,
  searchPairs: defaultSearchPairs
} = require('../market/dexscreener_client.cjs')
const {
  factoryInterface,
  poolInterface,
  erc20Interface
} = require('../protocol/abi.cjs')
const { normalizeAddress: normalizeEvmAddress } = require('../protocol/address.cjs')
const { computeReadablePrice } = require('../protocol/ticks.cjs')
const {
  buildPoolBrowserViewModel,
  DEFAULT_FEE_TVL_INTERVAL
} = require('../operator/pool_browser.cjs')

const BSC_CHAIN_ID = 'bsc'
const DEFAULT_PUBLIC_SEARCH_LIMIT = 48
const DEFAULT_POOL_FEE = 2500
const DEFAULT_CHAIN_ID = 56
const DEFAULT_VIEW_CALL_TIMEOUT_MS = 2500
const DEFAULT_V3_ENRICHMENT_FEE_HINTS = Object.freeze([100, 500, 2500, 3000, 10000])
const DEFAULT_PUBLIC_DISCOVERY_QUERIES = Object.freeze([
  'USDT',
  'BNB',
  'CAKE',
  'VRA',
  'SIREN'
])
const SUPPORTED_QUOTES = new Set([
  '0x55d398326f99059ff775485246999027b3197955',
  '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d',
  '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c'
])

function normalizeAddress(value) {
  return String(value || '').trim().toLowerCase()
}

function createDefaultProvider(rpcUrl = process.env.BSC_RPC_URL || process.env.BSC_SEARCH_RPC_URL || process.env.ALCHEMY_BSC_RPC_URL || '') {
  const url = String(rpcUrl || '').trim()
  return url
    ? new ethers.JsonRpcProvider(url, DEFAULT_CHAIN_ID, { staticNetwork: ethers.Network.from(DEFAULT_CHAIN_ID) })
    : null
}

function isEvmAddress(value) {
  try {
    ethers.getAddress(value)
    return true
  } catch {
    return false
  }
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

function withTimeout(promise, timeoutMs, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`${label || 'operation'} timed out after ${timeoutMs}ms`)), Math.max(1, Number(timeoutMs || DEFAULT_VIEW_CALL_TIMEOUT_MS))).unref?.()
    })
  ])
}

async function callView(provider, { to, data }, label, timeoutMs = DEFAULT_VIEW_CALL_TIMEOUT_MS) {
  if (!provider) throw new Error(`${label || 'rpc call'} requires provider`)
  return withTimeout(provider.call({ to, data }), timeoutMs, label || 'rpc call')
}

async function readErc20Meta(provider, tokenAddress, fallback = {}) {
  const address = ethers.getAddress(tokenAddress)
  const [decimalsRaw, symbolRaw] = await Promise.all([
    callView(provider, {
      to: address,
      data: erc20Interface.encodeFunctionData('decimals')
    }, 'erc20 decimals').then((result) => erc20Interface.decodeFunctionResult('decimals', result)[0]).catch(() => fallback.decimals ?? 18),
    callView(provider, {
      to: address,
      data: erc20Interface.encodeFunctionData('symbol')
    }, 'erc20 symbol').then((result) => erc20Interface.decodeFunctionResult('symbol', result)[0]).catch(() => fallback.symbol || 'TOKEN')
  ])
  return {
    address,
    decimals: Number(decimalsRaw ?? fallback.decimals ?? 18),
    symbol: String(symbolRaw || fallback.symbol || 'TOKEN')
  }
}

async function resolveV3PoolAddress(provider, { dex, tokenA, tokenB, fee }) {
  const config = getDexConfig(dex, 'v3')
  const result = await callView(provider, {
    to: config.factory,
    data: factoryInterface.encodeFunctionData('getPool', [
      ethers.getAddress(tokenA),
      ethers.getAddress(tokenB),
      Number(fee)
    ])
  }, `${dex} v3 getPool`)
  const [poolAddress] = factoryInterface.decodeFunctionResult('getPool', result)
  return ethers.getAddress(poolAddress)
}

async function readV3PoolRuntime(provider, {
  dex,
  poolAddress,
  tokenAddress,
  quoteAddress,
  marketCandidate = {}
}) {
  const config = getDexConfig(dex, 'v3')
  const pool = ethers.getAddress(poolAddress)
  const [token0Raw, token1Raw, feeRaw, tickSpacingRaw, slot0Raw, inputTokenMeta, depositTokenMeta] = await Promise.all([
    callView(provider, { to: pool, data: poolInterface.encodeFunctionData('token0') }, 'v3 token0')
      .then((result) => poolInterface.decodeFunctionResult('token0', result)[0]),
    callView(provider, { to: pool, data: poolInterface.encodeFunctionData('token1') }, 'v3 token1')
      .then((result) => poolInterface.decodeFunctionResult('token1', result)[0]),
    callView(provider, { to: pool, data: poolInterface.encodeFunctionData('fee') }, 'v3 fee')
      .then((result) => poolInterface.decodeFunctionResult('fee', result)[0]),
    callView(provider, { to: pool, data: poolInterface.encodeFunctionData('tickSpacing') }, 'v3 tickSpacing')
      .then((result) => poolInterface.decodeFunctionResult('tickSpacing', result)[0]),
    callView(provider, { to: pool, data: poolInterface.encodeFunctionData('slot0') }, 'v3 slot0')
      .then((result) => poolInterface.decodeFunctionResult('slot0', result)),
    readErc20Meta(provider, tokenAddress, {
      symbol: marketCandidate.tokenSymbol,
      decimals: marketCandidate.tokenDecimals || 18
    }),
    readErc20Meta(provider, quoteAddress, {
      symbol: marketCandidate.quoteSymbol,
      decimals: marketCandidate.quoteDecimals || 18
    })
  ])
  const token0 = ethers.getAddress(token0Raw)
  const token1 = ethers.getAddress(token1Raw)
  const inputAddress = ethers.getAddress(tokenAddress)
  const depositAddress = ethers.getAddress(quoteAddress)
  const token0Decimals = normalizeAddress(token0) === normalizeAddress(inputAddress)
    ? inputTokenMeta.decimals
    : depositTokenMeta.decimals
  const token1Decimals = normalizeAddress(token1) === normalizeAddress(inputAddress)
    ? inputTokenMeta.decimals
    : depositTokenMeta.decimals
  const targetPrice = computeReadablePrice({
    sqrtPriceX96: slot0Raw.sqrtPriceX96,
    token0Decimals,
    token1Decimals,
    token0Address: token0,
    token1Address: token1,
    targetAddress: inputAddress,
    normalizeAddress: normalizeEvmAddress
  })

  return {
    id: `${dex}:${pool}`,
    pairAddress: pool,
    poolAddress: pool,
    dex,
    dexLabel: config.label,
    dexDisplay: config.label,
    protocol: config.label,
    protocolVersion: 'v3',
    chainId: DEFAULT_CHAIN_ID,
    positionManager: config.positionManager,
    fee: Number(feeRaw),
    tickSpacing: Number(tickSpacingRaw),
    tick: Number(slot0Raw.tick),
    sqrtPriceX96: BigInt(slot0Raw.sqrtPriceX96).toString(),
    token0Address: token0,
    token1Address: token1,
    token0Decimals,
    token1Decimals,
    inputTokenAddress: inputAddress,
    inputTokenSymbol: inputTokenMeta.symbol,
    tokenAddress: inputAddress,
    tokenSymbol: inputTokenMeta.symbol,
    tokenName: marketCandidate.tokenName || inputTokenMeta.symbol,
    depositTokenAddress: depositAddress,
    depositTokenSymbol: depositTokenMeta.symbol,
    quoteAddress: depositAddress,
    quoteSymbol: depositTokenMeta.symbol,
    price: Number(targetPrice || marketCandidate.price || 0),
    targetPrice: Number(targetPrice || marketCandidate.price || 0),
    poolPrice: Number(targetPrice || marketCandidate.price || 0),
    inputTokenUsdPrice: Number(marketCandidate.price || targetPrice || 0),
    depositTokenUsdPrice: ['USDT', 'USDC', 'FDUSD', 'BUSD', 'USDE'].includes(String(depositTokenMeta.symbol || '').toUpperCase()) ? 1 : 0,
    liquidityUsd: Number(marketCandidate.liquidityUsd || 0),
    marketCapUsd: Number(marketCandidate.marketCapUsd || 0),
    fdvUsd: Number(marketCandidate.fdvUsd || 0),
    pairCreatedAt: Number(marketCandidate.pairCreatedAt || 0),
    volume: marketCandidate.volume || {},
    sourceCoverage: {
      ...(marketCandidate.sourceCoverage || {}),
      onChainV3: true
    },
    decision: {
      action: 'read-only-executable',
      reason: 'Public read-only V3 pool runtime'
    }
  }
}

async function enrichCandidatesWithV3Runtime({
  provider,
  candidates,
  maxPerToken = 2,
  feeHints = DEFAULT_V3_ENRICHMENT_FEE_HINTS
} = {}) {
  if (!provider || !Array.isArray(candidates) || !candidates.length) {
    return candidates || []
  }
  const byPair = new Map()
  for (const candidate of candidates) {
    byPair.set(normalizeAddress(candidate.pairAddress || candidate.id), candidate)
  }
  const tokenQuotePairs = [...new Map(candidates
    .filter((candidate) => isEvmAddress(candidate.tokenAddress) && isEvmAddress(candidate.quoteAddress))
    .map((candidate) => [`${normalizeAddress(candidate.tokenAddress)}:${normalizeAddress(candidate.quoteAddress)}`, candidate])).values()]
    .slice(0, Math.max(1, Number(maxPerToken || 6)))

  const enriched = []
  await Promise.all(tokenQuotePairs.map(async (candidate) => {
    for (const dex of ['pancakeswap', 'uniswap']) {
      let config
      try {
        config = getDexConfig(dex, 'v3')
      } catch {
        continue
      }
      const candidateFeeHints = [
        Number(candidate.fee || 0),
        ...(feeHints || [])
      ].filter((fee, index, list) => Number.isFinite(fee) && fee > 0 && list.indexOf(fee) === index)
        .filter((fee) => !Array.isArray(config.supportedFees) || config.supportedFees.includes(fee))
      const matches = await Promise.all(candidateFeeHints.map(async (fee) => {
        try {
          const poolAddress = await resolveV3PoolAddress(provider, {
            dex,
            tokenA: candidate.tokenAddress,
            tokenB: candidate.quoteAddress,
            fee
          })
          if (!poolAddress || poolAddress === ethers.ZeroAddress) return null
          return await readV3PoolRuntime(provider, {
            dex,
            poolAddress,
            tokenAddress: candidate.tokenAddress,
            quoteAddress: candidate.quoteAddress,
            marketCandidate: candidate
          })
        } catch {
          return null
        }
      }))
      for (const match of matches.filter(Boolean)) {
        if (!byPair.has(normalizeAddress(match.pairAddress))) {
          byPair.set(normalizeAddress(match.pairAddress), match)
          enriched.push(match)
        }
      }
    }
  }))

  const executable = enriched.sort((left, right) => Number(right.liquidityUsd || 0) - Number(left.liquidityUsd || 0))
  const fallback = candidates.filter((candidate) => !executable.some((item) => normalizeAddress(item.pairAddress) === normalizeAddress(candidate.pairAddress)))
  return [...executable, ...fallback]
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
  limit = DEFAULT_PUBLIC_SEARCH_LIMIT,
  defaultQueries = DEFAULT_PUBLIC_DISCOVERY_QUERIES,
  provider = null
} = {}) {
  const trimmedQuery = String(query || '').trim()
  const queries = trimmedQuery
    ? [trimmedQuery]
    : (defaultQueries || []).map((item) => String(item || '').trim()).filter(Boolean)
  if (!queries.length) {
    return { ok: true, payload: buildEmptyPayload({ query: trimmedQuery }) }
  }
  const pairGroups = await Promise.all(queries.map((searchQuery) => searchPairs(searchQuery).catch(() => [])))
  const pairs = pairGroups.flat()
  const marketCandidates = [...new Map((pairs || [])
    .map(mapPairToCandidate)
    .filter(Boolean)
    .sort((left, right) => Number(right.liquidityUsd || 0) - Number(left.liquidityUsd || 0))
    .slice(0, Math.max(1, Number(limit || DEFAULT_PUBLIC_SEARCH_LIMIT)))
    .map((candidate) => [normalizeAddress(candidate.pairAddress), candidate])).values()]
  const candidates = await enrichCandidatesWithV3Runtime({
    provider,
    candidates: marketCandidates
  })
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
  DEFAULT_PUBLIC_DISCOVERY_QUERIES,
  buildReadOnlyPoolSearchPayload,
  enrichCandidatesWithV3Runtime,
  mapPairToCandidate
}
