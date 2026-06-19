'use strict'

const http = require('http')
const https = require('https')
const { AbiCoder, ethers } = require('ethers')
const { V4_DEPLOYMENTS } = require('../bnb_v3_config.cjs')
const { normalizeAddress } = require('./address.cjs')
const { computeReadablePrice } = require('./ticks.cjs')
const { createAlchemyHttpsProxyAgent } = require('../net/alchemy_proxy.cjs')
const {
  UNISWAP_V4_POOL_MANAGER_ABI,
  UNISWAP_V4_STATE_VIEW_ABI,
  UNISWAP_V4_POSITION_MANAGER_ABI
} = require('./v4_abi.cjs')
const { ERC20_ABI } = require('./abi.cjs')

const abiCoder = AbiCoder.defaultAbiCoder()
const poolKeyCache = new Map()
const RAW_RPC_CALL_TIMEOUT_MS = 5000
const Q128 = 1n << 128n
const UINT256_MOD = 1n << 256n
const ALCHEMY_HTTPS_PROXY_AGENT = createAlchemyHttpsProxyAgent()
const erc20Interface = new ethers.Interface(ERC20_ABI)
const uniswapV4StateViewInterface = new ethers.Interface(UNISWAP_V4_STATE_VIEW_ABI)
const COMMON_TICK_SPACING_CANDIDATES = [
  1, 2, 4, 5, 8, 10, 16, 20, 25, 30, 40, 42, 50, 60, 80, 100, 120, 125, 150, 200, 250, 300, 400, 500, 600, 800, 1000, 2000
]
const LOG_RPC_CANDIDATES = [
  { url: process.env.BSC_SEARCH_RPC_URL, maxRange: 500_000 },
  { url: process.env.BSC_MAINNET_RPC_URL, maxRange: 50_000 },
  { url: process.env.BSC_ARCHIVE_RPC_URL, maxRange: 50_000 },
  { url: process.env.BSC_RPC_URL, maxRange: 50_000 }
].filter((entry) => String(entry?.url || '').trim())

function isBytes32PoolId(value) {
  return /^0x[a-fA-F0-9]{64}$/.test(String(value || '').trim())
}

function buildUniswapV4PoolIdFromKey(poolKey) {
  return ethers.keccak256(abiCoder.encode(
    ['tuple(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)'],
    [[
      normalizeAddress(poolKey.currency0),
      normalizeAddress(poolKey.currency1),
      Number(poolKey.fee),
      Number(poolKey.tickSpacing),
      normalizeAddress(poolKey.hooks || ethers.ZeroAddress)
    ]]
  ))
}

function buildUniswapV4PoolKeyCandidates({
  inputTokenAddress,
  depositTokenAddress,
  fee,
  hooks
}) {
  const input = String(inputTokenAddress || '').trim()
  const deposit = String(depositTokenAddress || '').trim()
  if (!input || !deposit || !Number.isFinite(Number(fee)) || Number(fee) <= 0) {
    return []
  }

  const normalizedInput = normalizeAddress(input)
  const normalizedDeposit = normalizeAddress(deposit)
  const hookAddress = normalizeAddress(hooks || ethers.ZeroAddress)
  return [
    {
      currency0: normalizedDeposit,
      currency1: normalizedInput,
      fee: Number(fee),
      hooks: hookAddress,
      ordering: 'deposit/input'
    },
    {
      currency0: normalizedInput,
      currency1: normalizedDeposit,
      fee: Number(fee),
      hooks: hookAddress,
      ordering: 'input/deposit'
    }
  ]
}

function normalizeUniswapV4PoolKeyHint(poolKey) {
  let raw = null
  if (Array.isArray(poolKey) && poolKey.length >= 5) {
    raw = {
      currency0: poolKey[0],
      currency1: poolKey[1],
      fee: poolKey[2],
      tickSpacing: poolKey[3],
      hooks: poolKey[4]
    }
  } else if (poolKey && typeof poolKey === 'object') {
    raw = {
      currency0: poolKey.currency0 || poolKey.token0Address,
      currency1: poolKey.currency1 || poolKey.token1Address,
      fee: poolKey.fee,
      tickSpacing: poolKey.tickSpacing,
      hooks: poolKey.hooks
    }
  }

  if (!raw?.currency0 || !raw?.currency1 || !Number.isFinite(Number(raw.fee)) || Number(raw.fee) <= 0 || !Number.isFinite(Number(raw.tickSpacing)) || Number(raw.tickSpacing) <= 0) {
    return null
  }

  return {
    currency0: normalizeAddress(raw.currency0),
    currency1: normalizeAddress(raw.currency1),
    fee: Number(raw.fee),
    tickSpacing: Number(raw.tickSpacing),
    hooks: normalizeAddress(raw.hooks || ethers.ZeroAddress)
  }
}

function bruteForceUniswapV4PoolKey(poolId, hints = {}) {
  const exactPoolKey = normalizeUniswapV4PoolKeyHint(hints.poolKey)
  if (exactPoolKey && buildUniswapV4PoolIdFromKey(exactPoolKey).toLowerCase() === String(poolId || '').toLowerCase()) {
    return exactPoolKey
  }

  const candidates = buildUniswapV4PoolKeyCandidates(hints)
  if (!candidates.length) {
    return null
  }

  const expandedTickSpacings = new Set()
  if (exactPoolKey?.tickSpacing) {
    expandedTickSpacings.add(Number(exactPoolKey.tickSpacing))
  }
  if (Number.isFinite(Number(hints.tickSpacing)) && Number(hints.tickSpacing) > 0) {
    expandedTickSpacings.add(Number(hints.tickSpacing))
  }
  for (const spacing of COMMON_TICK_SPACING_CANDIDATES) {
    expandedTickSpacings.add(spacing)
  }
  for (let spacing = 1; spacing <= 2000; spacing += 1) {
    expandedTickSpacings.add(spacing)
  }

  for (const candidate of candidates) {
    for (const tickSpacing of expandedTickSpacings) {
      const poolKey = {
        currency0: candidate.currency0,
        currency1: candidate.currency1,
        fee: candidate.fee,
        tickSpacing,
        hooks: candidate.hooks
      }
      if (buildUniswapV4PoolIdFromKey(poolKey).toLowerCase() === String(poolId || '').toLowerCase()) {
        return poolKey
      }
    }
  }

  return null
}

function decodeUniswapV4PositionInfo(positionInfo) {
  const raw = BigInt(positionInfo || 0)
  const tickLowerRaw = (raw >> 8n) & 0xffffffn
  const tickUpperRaw = (raw >> 32n) & 0xffffffn
  const poolIdTruncated = (raw >> 56n) & ((1n << 200n) - 1n)
  const tickLower = Number(tickLowerRaw >= 0x800000n ? tickLowerRaw - 0x1000000n : tickLowerRaw)
  const tickUpper = Number(tickUpperRaw >= 0x800000n ? tickUpperRaw - 0x1000000n : tickUpperRaw)

  return {
    tickLower,
    tickUpper,
    poolIdTruncated: `0x${poolIdTruncated.toString(16).padStart(50, '0')}`
  }
}

function buildUniswapV4PositionKey(positionManagerAddress, tokenId, tickLower, tickUpper) {
  return ethers.solidityPackedKeccak256(
    ['address', 'int24', 'int24', 'bytes32'],
    [
      normalizeAddress(positionManagerAddress),
      Number(tickLower),
      Number(tickUpper),
      ethers.zeroPadValue(ethers.toBeHex(BigInt(tokenId)), 32)
    ]
  )
}

function calculateUniswapV4UnclaimedFees({
  liquidity,
  feeGrowthInside0LastX128,
  feeGrowthInside1LastX128,
  currentFeeGrowthInside0X128,
  currentFeeGrowthInside1X128
}) {
  const activeLiquidity = BigInt(liquidity || 0)
  if (activeLiquidity <= 0n) {
    return {
      tokensOwed0: 0n,
      tokensOwed1: 0n
    }
  }

  const last0 = BigInt(feeGrowthInside0LastX128 || 0)
  const last1 = BigInt(feeGrowthInside1LastX128 || 0)
  const current0 = BigInt(currentFeeGrowthInside0X128 || 0)
  const current1 = BigInt(currentFeeGrowthInside1X128 || 0)
  const delta0 = (current0 - last0 + UINT256_MOD) % UINT256_MOD
  const delta1 = (current1 - last1 + UINT256_MOD) % UINT256_MOD

  return {
    tokensOwed0: (activeLiquidity * delta0) / Q128,
    tokensOwed1: (activeLiquidity * delta1) / Q128
  }
}

function buildUniswapV4PositionFeeState({
  fallbackLiquidity,
  positionState,
  currentFeeGrowthInside
}) {
  const hasPositionCheckpoint = Array.isArray(positionState)
  const hasCurrentFeeGrowth = Array.isArray(currentFeeGrowthInside)
  const activeLiquidity = BigInt(positionState?.[0] ?? fallbackLiquidity ?? 0)
  const feeGrowthInside0LastX128 = hasPositionCheckpoint ? BigInt(positionState?.[1] ?? 0) : 0n
  const feeGrowthInside1LastX128 = hasPositionCheckpoint ? BigInt(positionState?.[2] ?? 0) : 0n
  const unclaimedFees = hasPositionCheckpoint && hasCurrentFeeGrowth
    ? calculateUniswapV4UnclaimedFees({
      liquidity: activeLiquidity,
      feeGrowthInside0LastX128,
      feeGrowthInside1LastX128,
      currentFeeGrowthInside0X128: currentFeeGrowthInside?.[0] ?? feeGrowthInside0LastX128,
      currentFeeGrowthInside1X128: currentFeeGrowthInside?.[1] ?? feeGrowthInside1LastX128
    })
    : { tokensOwed0: 0n, tokensOwed1: 0n }

  return {
    activeLiquidity,
    feeGrowthInside0LastX128,
    feeGrowthInside1LastX128,
    tokensOwed0: unclaimedFees.tokensOwed0,
    tokensOwed1: unclaimedFees.tokensOwed1
  }
}

async function readUniswapV4PositionFeeInputsRaw(provider, {
  stateViewAddress,
  poolId,
  positionId,
  tickLower,
  tickUpper
}) {
  const [positionStateRaw, currentFeeGrowthInsideRaw] = await Promise.all([
    rawRpcEthCall(provider, {
      to: stateViewAddress,
      data: uniswapV4StateViewInterface.encodeFunctionData('getPositionInfo(bytes32,bytes32)', [poolId, positionId]),
      label: 'uniswap v4 position fee state'
    }),
    rawRpcEthCall(provider, {
      to: stateViewAddress,
      data: uniswapV4StateViewInterface.encodeFunctionData('getFeeGrowthInside', [poolId, Number(tickLower), Number(tickUpper)]),
      label: 'uniswap v4 fee growth inside'
    })
  ])

  return {
    positionState: uniswapV4StateViewInterface.decodeFunctionResult('getPositionInfo(bytes32,bytes32)', positionStateRaw),
    currentFeeGrowthInside: uniswapV4StateViewInterface.decodeFunctionResult('getFeeGrowthInside', currentFeeGrowthInsideRaw)
  }
}

function resolveProviderRpcUrl(provider) {
  if (typeof provider?._getConnection === 'function') {
    const connection = provider._getConnection()
    if (connection?.url) {
      return String(connection.url)
    }
  }

  throw new Error('provider RPC URL is unavailable for raw call')
}

function toRpcQuantity(value) {
  return ethers.toQuantity(BigInt(value))
}

function normalizeTimestampMs(value) {
  if (value == null) {
    return null
  }
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value < 10_000_000_000 ? value * 1000 : value
  }
  const parsed = Date.parse(String(value))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

async function rawRpcRequest(provider, {
  method,
  params = [],
  timeoutMs = RAW_RPC_CALL_TIMEOUT_MS,
  label = 'raw rpc request',
  allowEmptyResult = true
}) {
  const url = resolveProviderRpcUrl(provider)
  const endpoint = new URL(url)
  const controller = new AbortController()
  const callLabel = String(label || 'raw rpc call')
  const requestBody = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method,
    params
  })
  const transport = endpoint.protocol === 'http:' ? http : https

  return new Promise((resolve, reject) => {
    let settled = false
    let timedOut = false
    const fail = (error) => {
      if (settled) {
        return
      }
      settled = true
      reject(error)
    }
    const succeed = (value) => {
      if (settled) {
        return
      }
      settled = true
      resolve(value)
    }
    const request = transport.request({
      protocol: endpoint.protocol,
      hostname: endpoint.hostname,
      port: endpoint.port || undefined,
      path: `${endpoint.pathname}${endpoint.search}`,
      method: 'POST',
      agent: endpoint.protocol === 'https:' ? (ALCHEMY_HTTPS_PROXY_AGENT || undefined) : undefined,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(requestBody)
      },
      timeout: timeoutMs,
      signal: controller.signal
    }, (response) => {
      let responseBody = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => {
        responseBody += chunk
      })
      response.on('end', () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          fail(new Error(`${callLabel} failed with HTTP ${response.statusCode}`))
          return
        }

        let payload
        try {
          payload = JSON.parse(responseBody)
        } catch (error) {
          fail(new Error(`${callLabel} returned invalid JSON: ${error.message}`))
          return
        }

        if (payload?.error) {
          fail(new Error(`${callLabel} reverted: ${payload.error.message || 'unknown rpc error'}`))
          return
        }
        if (!allowEmptyResult && (!payload?.result || payload.result === '0x')) {
          fail(new Error(`${callLabel} returned empty data`))
          return
        }

        succeed(payload.result)
      })
    })

    const timeout = setTimeout(() => {
      timedOut = true
      controller.abort()
      request.destroy(new Error(`${callLabel} timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    request.on('error', (error) => {
      clearTimeout(timeout)
      if (timedOut || error?.name === 'AbortError' || error?.code === 'ABORT_ERR' || String(error?.message || '').toLowerCase().includes('aborted')) {
        fail(new Error(`${callLabel} timed out after ${timeoutMs}ms`))
        return
      }
      fail(new Error(`${callLabel} failed: ${error.message}`))
    })
    request.on('close', () => {
      clearTimeout(timeout)
    })
    request.write(requestBody)
    request.end()
  })
}

async function rawRpcEthCall(provider, { to, data, blockTag = 'latest', timeoutMs = RAW_RPC_CALL_TIMEOUT_MS, label = 'raw rpc call' }) {
  return rawRpcRequest(provider, {
    method: 'eth_call',
    params: [
      {
        to: normalizeAddress(to),
        data
      },
      blockTag
    ],
    timeoutMs,
    label,
    allowEmptyResult: false
  })
}

async function rawRpcBlockNumber(provider, { timeoutMs = RAW_RPC_CALL_TIMEOUT_MS } = {}) {
  const result = await rawRpcRequest(provider, {
    method: 'eth_blockNumber',
    params: [],
    timeoutMs,
    label: 'eth_blockNumber'
  })
  return Number(BigInt(result))
}

async function rawRpcGetBlockByNumber(provider, blockNumber, { timeoutMs = RAW_RPC_CALL_TIMEOUT_MS } = {}) {
  return rawRpcRequest(provider, {
    method: 'eth_getBlockByNumber',
    params: [toRpcQuantity(blockNumber), false],
    timeoutMs,
    label: 'eth_getBlockByNumber',
    allowEmptyResult: false
  })
}

async function rawRpcGetLogs(provider, filter, { timeoutMs = RAW_RPC_CALL_TIMEOUT_MS } = {}) {
  return rawRpcRequest(provider, {
    method: 'eth_getLogs',
    params: [{
      ...filter,
      fromBlock: typeof filter.fromBlock === 'number' ? toRpcQuantity(filter.fromBlock) : filter.fromBlock,
      toBlock: typeof filter.toBlock === 'number' ? toRpcQuantity(filter.toBlock) : filter.toBlock
    }],
    timeoutMs,
    label: 'eth_getLogs'
  })
}

async function findBlockAtOrAfterTimestamp(provider, targetTimestampSec, {
  latestBlock = null,
  searchWindowBlocks = 500_000,
  timeoutMs = RAW_RPC_CALL_TIMEOUT_MS
} = {}) {
  const latest = Number.isFinite(Number(latestBlock))
    ? Number(latestBlock)
    : await rawRpcBlockNumber(provider, { timeoutMs })
  let low = Math.max(0, latest - Math.max(1, Number(searchWindowBlocks || 500_000)))
  let high = latest
  let reads = 0

  while (low < high && reads < 32) {
    reads += 1
    const mid = Math.floor((low + high) / 2)
    const block = await rawRpcGetBlockByNumber(provider, mid, { timeoutMs })
    const timestamp = Number(BigInt(block?.timestamp || 0))
    if (timestamp < targetTimestampSec) {
      low = mid + 1
    } else {
      high = mid
    }
  }

  return low
}

async function estimateBlockAtTimestamp(provider, targetTimestampSec, {
  latestBlock = null,
  sampleDistanceBlocks = 20_000,
  timeoutMs = RAW_RPC_CALL_TIMEOUT_MS
} = {}) {
  const latest = Number.isFinite(Number(latestBlock))
    ? Number(latestBlock)
    : await rawRpcBlockNumber(provider, { timeoutMs })
  const sample = Math.max(0, latest - Math.max(1, Number(sampleDistanceBlocks || 20_000)))
  if (sample === latest) {
    return latest
  }

  const [latestData, sampleData] = await Promise.all([
    rawRpcGetBlockByNumber(provider, latest, { timeoutMs }),
    rawRpcGetBlockByNumber(provider, sample, { timeoutMs })
  ])
  const latestTimestamp = Number(BigInt(latestData?.timestamp || 0))
  const sampleTimestamp = Number(BigInt(sampleData?.timestamp || 0))
  const seconds = latestTimestamp - sampleTimestamp
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return null
  }

  const blocksPerSecond = (latest - sample) / seconds
  const estimate = Math.round(latest - ((latestTimestamp - targetTimestampSec) * blocksPerSecond))
  return Math.max(0, Math.min(latest, estimate))
}

async function readUniswapV4Slot0(provider, stateViewAddress, poolId) {
  const data = uniswapV4StateViewInterface.encodeFunctionData('getSlot0', [String(poolId)])
  const raw = await rawRpcEthCall(provider, {
    to: stateViewAddress,
    data,
    label: 'uniswap v4 slot0'
  })
  return uniswapV4StateViewInterface.decodeFunctionResult('getSlot0', raw)
}

function decodeErc20Symbol(raw) {
  try {
    return String(erc20Interface.decodeFunctionResult('symbol', raw)[0] || 'UNKNOWN')
  } catch (_) {
  }

  try {
    return ethers.decodeBytes32String(abiCoder.decode(['bytes32'], raw)[0])
  } catch (_) {
  }

  return 'UNKNOWN'
}

async function fetchTokenMetadataFast(provider, tokenAddress) {
  const address = normalizeAddress(tokenAddress)
  const [decimalsRaw, symbolRaw] = await Promise.all([
    rawRpcEthCall(provider, {
      to: address,
      data: erc20Interface.encodeFunctionData('decimals'),
      label: `erc20 decimals ${address}`
    }),
    rawRpcEthCall(provider, {
      to: address,
      data: erc20Interface.encodeFunctionData('symbol'),
      label: `erc20 symbol ${address}`
    }).catch(() => null)
  ])

  return {
    address,
    decimals: Number(erc20Interface.decodeFunctionResult('decimals', decimalsRaw)[0]),
    symbol: symbolRaw ? decodeErc20Symbol(symbolRaw) : 'UNKNOWN'
  }
}

async function fetchTokenMetadata(provider, tokenAddress) {
  const token = new ethers.Contract(normalizeAddress(tokenAddress), ERC20_ABI, provider)
  const [decimals, symbol] = await Promise.all([
    token.decimals(),
    token.symbol().catch(() => 'UNKNOWN')
  ])

  return {
    address: normalizeAddress(tokenAddress),
    decimals: Number(decimals),
    symbol
  }
}

async function resolveUniswapV4PoolKey(provider, poolId, hints = {}) {
  const cacheKey = String(poolId || '').toLowerCase()
  if (poolKeyCache.has(cacheKey)) {
    return poolKeyCache.get(cacheKey)
  }

  const hintedPoolKey = bruteForceUniswapV4PoolKey(poolId, hints)
  if (hintedPoolKey) {
    poolKeyCache.set(cacheKey, hintedPoolKey)
    return hintedPoolKey
  }

  const config = V4_DEPLOYMENTS.uniswap
  const poolManager = new ethers.Contract(config.poolManager, UNISWAP_V4_POOL_MANAGER_ABI, provider)
  const initializeTopic = poolManager.interface.getEvent('Initialize').topicHash
  const readLogsWindow = async (logProvider, fromBlock, toBlock) => {
    const filter = {
      address: config.poolManager,
      fromBlock,
      toBlock,
      topics: [initializeTopic, String(poolId)]
    }
    const logs = await rawRpcGetLogs(logProvider, filter).catch(() => logProvider.getLogs(filter))
    return logs.length ? logs[logs.length - 1] : null
  }
  const readLogsAroundCreatedAt = async (logProvider, latest) => {
    const createdAtMs = normalizeTimestampMs(hints.pairCreatedAt || hints.createdAt || hints.poolCreatedAt)
    if (!createdAtMs) {
      return null
    }
    const targetTimestampSec = Math.floor(createdAtMs / 1000)
    let centerBlock = await estimateBlockAtTimestamp(logProvider, targetTimestampSec, {
      latestBlock: latest
    }).catch(() => null)
    const scanRadiusBlocks = Math.max(50, Math.min(500, Number(hints.createdAtScanRadiusBlocks || 200)))
    if (centerBlock != null) {
      for (let offset = 0; offset <= scanRadiusBlocks; offset += 10) {
        const directions = offset === 0 ? [0] : [-1, 1]
        for (const direction of directions) {
          const fromBlock = Math.max(0, centerBlock + (direction * offset))
          const initializeLog = await readLogsWindow(logProvider, fromBlock, fromBlock + 9)
          if (initializeLog) {
            return initializeLog
          }
        }
      }
    }

    centerBlock = await findBlockAtOrAfterTimestamp(logProvider, targetTimestampSec, {
      latestBlock: latest,
      searchWindowBlocks: 500_000
    })
    for (let offset = 0; offset <= scanRadiusBlocks; offset += 10) {
      const directions = offset === 0 ? [0] : [-1, 1]
      for (const direction of directions) {
        const fromBlock = Math.max(0, centerBlock + (direction * offset))
        const initializeLog = await readLogsWindow(logProvider, fromBlock, fromBlock + 9)
        if (initializeLog) {
          return initializeLog
        }
      }
    }
    return null
  }
  const readLogs = async (logProvider, maxRange = 500_000) => {
    const latest = await rawRpcBlockNumber(logProvider).catch(() => logProvider.getBlockNumber())
    const createdAtLog = await readLogsAroundCreatedAt(logProvider, latest).catch(() => null)
    if (createdAtLog) {
      return createdAtLog
    }

    for (let toBlock = latest; toBlock >= 0; toBlock -= maxRange) {
      const fromBlock = Math.max(0, toBlock - maxRange + 1)
      const initializeLog = await readLogsWindow(logProvider, fromBlock, toBlock)
      if (initializeLog) {
        return initializeLog
      }
      if (fromBlock === 0) {
        break
      }
    }

    return null
  }

  const hintedAgeHours = Number(hints.ageHours || 0)
  const firstRange = Number.isFinite(hintedAgeHours) && hintedAgeHours > 0
    ? Math.max(2_000, Math.min(50_000, Math.ceil(hintedAgeHours * 1_400) + 5_000))
    : 50_000
  let initializeLog = await readLogs(provider, firstRange).catch(() => null)

  for (const candidate of LOG_RPC_CANDIDATES) {
    if (initializeLog) {
      break
    }
    const logProvider = new ethers.JsonRpcProvider(candidate.url, 56, { staticNetwork: true })
    try {
      initializeLog = await readLogs(logProvider, candidate.maxRange)
    } catch (_) {
    } finally {
      if (typeof logProvider.destroy === 'function') {
        logProvider.destroy()
      }
    }
  }

  if (!initializeLog) {
    throw new Error(`Uniswap V4 pool key not found for ${poolId}`)
  }

  const parsed = poolManager.interface.parseLog(initializeLog)
  const poolKey = {
    currency0: normalizeAddress(parsed.args.currency0),
    currency1: normalizeAddress(parsed.args.currency1),
    fee: Number(parsed.args.fee),
    tickSpacing: Number(parsed.args.tickSpacing),
    hooks: normalizeAddress(parsed.args.hooks)
  }
  poolKeyCache.set(cacheKey, poolKey)
  return poolKey
}

async function readUniswapV4PoolRuntime(provider, {
  poolAddress,
  inputTokenAddress,
  depositTokenAddress,
  fee = null,
  hooks = null,
  poolKey = null,
  tickSpacing = null,
  pairCreatedAt = null,
  createdAt = null,
  ageHours = null
}) {
  if (!isBytes32PoolId(poolAddress)) {
    throw new Error('Uniswap V4 runtime expects a bytes32 pool id')
  }

  const config = V4_DEPLOYMENTS.uniswap
  const exactPoolKey = normalizeUniswapV4PoolKeyHint(poolKey)
  const resolvedPoolKey = exactPoolKey && buildUniswapV4PoolIdFromKey(exactPoolKey).toLowerCase() === String(poolAddress).toLowerCase()
    ? exactPoolKey
    : await resolveUniswapV4PoolKey(provider, poolAddress, {
    inputTokenAddress,
    depositTokenAddress,
    fee,
    hooks,
    tickSpacing,
    poolKey,
    pairCreatedAt,
    createdAt,
    ageHours
  })
  const [slot0, inputTokenMeta, depositTokenMeta] = await Promise.all([
    readUniswapV4Slot0(provider, config.stateView, poolAddress),
    fetchTokenMetadataFast(provider, inputTokenAddress),
    fetchTokenMetadataFast(provider, depositTokenAddress)
  ])

  const token0 = normalizeAddress(resolvedPoolKey.currency0)
  const token1 = normalizeAddress(resolvedPoolKey.currency1)
  const inputAddress = normalizeAddress(inputTokenAddress)
  const depositAddress = normalizeAddress(depositTokenAddress)
  const token0Decimals = token0.toLowerCase() === inputAddress.toLowerCase() ? inputTokenMeta.decimals : depositTokenMeta.decimals
  const token1Decimals = token1.toLowerCase() === inputAddress.toLowerCase() ? inputTokenMeta.decimals : depositTokenMeta.decimals
  const targetPrice = computeReadablePrice({
    sqrtPriceX96: slot0.sqrtPriceX96,
    token0Decimals,
    token1Decimals,
    token0Address: token0,
    token1Address: token1,
    targetAddress: inputAddress,
    normalizeAddress
  })

  return {
    dex: config.key,
    protocolVersion: 'v4',
    poolAddress: String(poolAddress),
    poolId: String(poolAddress),
    poolManager: config.poolManager,
    positionManager: config.positionManager,
    stateView: config.stateView,
    quoter: config.quoter,
    token0Address: token0,
    token1Address: token1,
    token0Decimals,
    token1Decimals,
    token0Symbol: token0.toLowerCase() === inputAddress.toLowerCase() ? inputTokenMeta.symbol : depositTokenMeta.symbol,
    token1Symbol: token1.toLowerCase() === inputAddress.toLowerCase() ? inputTokenMeta.symbol : depositTokenMeta.symbol,
    inputTokenAddress: inputAddress,
    depositTokenAddress: depositAddress,
    inputTokenSymbol: inputTokenMeta.symbol,
    depositTokenSymbol: depositTokenMeta.symbol,
    fee: Number(resolvedPoolKey.fee),
    lpFee: Number(slot0.lpFee),
    protocolFee: Number(slot0.protocolFee),
    tickSpacing: Number(resolvedPoolKey.tickSpacing),
    poolKey: [
      token0,
      token1,
      Number(resolvedPoolKey.fee),
      Number(resolvedPoolKey.tickSpacing),
      normalizeAddress(resolvedPoolKey.hooks || ethers.ZeroAddress)
    ],
    tick: Number(slot0.tick),
    sqrtPriceX96: BigInt(slot0.sqrtPriceX96).toString(),
    targetPrice,
    hooks: normalizeAddress(resolvedPoolKey.hooks || ethers.ZeroAddress)
  }
}

async function readUniswapV4Position(provider, { tokenId }) {
  const config = V4_DEPLOYMENTS.uniswap
  const positionManager = new ethers.Contract(config.positionManager, UNISWAP_V4_POSITION_MANAGER_ABI, provider)
  const stateView = new ethers.Contract(config.stateView, UNISWAP_V4_STATE_VIEW_ABI, provider)
  const [[poolKey, positionInfo], liquidity] = await Promise.all([
    positionManager.getPoolAndPositionInfo(BigInt(tokenId)),
    positionManager.getPositionLiquidity(BigInt(tokenId))
  ])
  const decoded = decodeUniswapV4PositionInfo(positionInfo)
  const fullPoolId = buildUniswapV4PoolIdFromKey(poolKey)
  const positionId = buildUniswapV4PositionKey(config.positionManager, tokenId, decoded.tickLower, decoded.tickUpper)
  let [positionState, currentFeeGrowthInside] = await Promise.all([
    stateView.getPositionInfo(fullPoolId, positionId).catch(() => null),
    stateView.getFeeGrowthInside(fullPoolId, decoded.tickLower, decoded.tickUpper).catch(() => null)
  ])
  const stateLiquidity = Array.isArray(positionState) ? BigInt(positionState?.[0] ?? 0) : 0n
  const needsRawFeeRead = !Array.isArray(positionState)
    || !Array.isArray(currentFeeGrowthInside)
    || (BigInt(liquidity || 0) > 0n && stateLiquidity <= 0n)
  if (needsRawFeeRead) {
    const rawFeeInputs = await readUniswapV4PositionFeeInputsRaw(provider, {
      stateViewAddress: config.stateView,
      poolId: fullPoolId,
      positionId,
      tickLower: decoded.tickLower,
      tickUpper: decoded.tickUpper
    })
    if (!Array.isArray(positionState) || stateLiquidity <= 0n) {
      positionState = rawFeeInputs.positionState
    }
    if (!Array.isArray(currentFeeGrowthInside)) {
      currentFeeGrowthInside = rawFeeInputs.currentFeeGrowthInside
    }
  }
  const feeState = buildUniswapV4PositionFeeState({
    fallbackLiquidity: liquidity,
    positionState,
    currentFeeGrowthInside
  })

  return {
    dex: config.key,
    protocolVersion: 'v4',
    positionManager: config.positionManager,
    tokenId: BigInt(tokenId),
    token0: normalizeAddress(poolKey.currency0),
    token1: normalizeAddress(poolKey.currency1),
    fee: Number(poolKey.fee),
    tickLower: decoded.tickLower,
    tickUpper: decoded.tickUpper,
    liquidity: feeState.activeLiquidity,
    feeGrowthInside0LastX128: feeState.feeGrowthInside0LastX128,
    feeGrowthInside1LastX128: feeState.feeGrowthInside1LastX128,
    tokensOwed0: feeState.tokensOwed0,
    tokensOwed1: feeState.tokensOwed1,
    hooks: normalizeAddress(poolKey.hooks || ethers.ZeroAddress),
    tickSpacing: Number(poolKey.tickSpacing),
    poolId: fullPoolId
  }
}

module.exports = {
  isBytes32PoolId,
  buildUniswapV4PoolIdFromKey,
  bruteForceUniswapV4PoolKey,
  decodeUniswapV4PositionInfo,
  buildUniswapV4PositionKey,
  calculateUniswapV4UnclaimedFees,
  buildUniswapV4PositionFeeState,
  resolveUniswapV4PoolKey,
  readUniswapV4PoolRuntime,
  readUniswapV4Position
}
