'use strict'

const { ethers } = require('ethers')
const { V4_DEPLOYMENTS } = require('../bnb_v3_config.cjs')
const { normalizeAddress } = require('./address.cjs')
const { computeReadablePrice } = require('./ticks.cjs')
const { decodeClTickSpacing } = require('./v4_math.cjs')
const { V4_CL_POOL_MANAGER_ABI, V4_CL_POSITION_MANAGER_ABI } = require('./v4_abi.cjs')
const { ERC20_ABI } = require('./abi.cjs')

function isBytes32PoolId(value) {
  return /^0x[a-fA-F0-9]{64}$/.test(String(value || '').trim())
}

function buildPoolIdFromKey(poolKey) {
  return ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
    ['tuple(address currency0,address currency1,address hooks,address poolManager,uint24 fee,bytes32 parameters)'],
    [[poolKey.currency0, poolKey.currency1, poolKey.hooks, poolKey.poolManager, poolKey.fee, poolKey.parameters]]
  ))
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

async function readPancakeClV4PoolRuntime(provider, {
  poolAddress,
  inputTokenAddress,
  depositTokenAddress
}) {
  if (!isBytes32PoolId(poolAddress)) {
    throw new Error('Pancake V4 runtime expects a bytes32 pool id')
  }

  const config = V4_DEPLOYMENTS.pancakeswap
  const poolManager = new ethers.Contract(config.poolManager, V4_CL_POOL_MANAGER_ABI, provider)
  const [poolKey, slot0, inputTokenMeta, depositTokenMeta] = await Promise.all([
    poolManager.poolIdToPoolKey(poolAddress),
    poolManager.getSlot0(poolAddress),
    fetchTokenMetadata(provider, inputTokenAddress),
    fetchTokenMetadata(provider, depositTokenAddress)
  ])

  const token0 = normalizeAddress(poolKey.currency0)
  const token1 = normalizeAddress(poolKey.currency1)
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
    quoter: config.quoter,
    tickLens: config.tickLens,
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
    fee: Number(poolKey.fee),
    lpFee: Number(slot0.lpFee),
    protocolFee: Number(slot0.protocolFee),
    tickSpacing: decodeClTickSpacing(poolKey.parameters),
    tick: Number(slot0.tick),
    sqrtPriceX96: BigInt(slot0.sqrtPriceX96).toString(),
    targetPrice,
    hooks: normalizeAddress(poolKey.hooks),
    parameters: poolKey.parameters
  }
}

async function readPancakeClV4Position(provider, { tokenId }) {
  const config = V4_DEPLOYMENTS.pancakeswap
  const positionManager = new ethers.Contract(config.positionManager, V4_CL_POSITION_MANAGER_ABI, provider)
  const position = await positionManager.positions(BigInt(tokenId))

  return {
    dex: config.key,
    protocolVersion: 'v4',
    positionManager: config.positionManager,
    tokenId: BigInt(tokenId),
    token0: normalizeAddress(position[0].currency0),
    token1: normalizeAddress(position[0].currency1),
    fee: Number(position[0].fee),
    tickLower: Number(position[1]),
    tickUpper: Number(position[2]),
    liquidity: BigInt(position[3]),
    feeGrowthInside0LastX128: BigInt(position[4]),
    feeGrowthInside1LastX128: BigInt(position[5]),
    tokensOwed0: 0n,
    tokensOwed1: 0n,
    hooks: normalizeAddress(position[0].hooks),
    poolManager: normalizeAddress(position[0].poolManager),
    parameters: position[0].parameters,
    poolId: buildPoolIdFromKey({
      currency0: position[0].currency0,
      currency1: position[0].currency1,
      hooks: position[0].hooks,
      poolManager: position[0].poolManager,
      fee: position[0].fee,
      parameters: position[0].parameters
    })
  }
}

module.exports = {
  isBytes32PoolId,
  buildPoolIdFromKey,
  readPancakeClV4PoolRuntime,
  readPancakeClV4Position
}
