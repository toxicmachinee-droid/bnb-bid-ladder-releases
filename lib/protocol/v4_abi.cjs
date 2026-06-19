'use strict'

const { ethers } = require('ethers')

const V4_CL_POOL_MANAGER_ABI = [
  'function poolIdToPoolKey(bytes32 id) view returns ((address currency0,address currency1,address hooks,address poolManager,uint24 fee,bytes32 parameters))',
  'function getSlot0(bytes32 id) view returns (uint160 sqrtPriceX96,int24 tick,uint24 protocolFee,uint24 lpFee)',
  'function getLiquidity(bytes32 id) view returns (uint128 liquidity)'
]

const V4_CL_POSITION_MANAGER_ABI = [
  'function modifyLiquidities(bytes payload,uint256 deadline) payable',
  'function positions(uint256 tokenId) view returns ((address currency0,address currency1,address hooks,address poolManager,uint24 fee,bytes32 parameters),int24 tickLower,int24 tickUpper,uint128 liquidity,uint256 feeGrowthInside0LastX128,uint256 feeGrowthInside1LastX128,address subscriber)',
  'function getPoolAndPositionInfo(uint256 tokenId) view returns ((address currency0,address currency1,address hooks,address poolManager,uint24 fee,bytes32 parameters),uint256 positionInfo)',
  'function getPositionLiquidity(uint256 tokenId) view returns (uint128 liquidity)',
  'function balanceOf(address owner) view returns (uint256)',
  'function tokenOfOwnerByIndex(address owner,uint256 index) view returns (uint256)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)',
  'event MintPosition(uint256 indexed tokenId)'
]

const UNISWAP_V4_POOL_MANAGER_ABI = [
  'event Initialize(bytes32 indexed id,address indexed currency0,address indexed currency1,uint24 fee,int24 tickSpacing,address hooks,uint160 sqrtPriceX96,int24 tick)'
]

const UNISWAP_V4_STATE_VIEW_ABI = [
  'function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96,int24 tick,uint24 protocolFee,uint24 lpFee)',
  'function getPositionInfo(bytes32 poolId,bytes32 positionId) view returns (uint128 liquidity,uint256 feeGrowthInside0LastX128,uint256 feeGrowthInside1LastX128)',
  'function getPositionLiquidity(bytes32 poolId,bytes32 positionId) view returns (uint128 liquidity)',
  'function getFeeGrowthInside(bytes32 poolId,int24 tickLower,int24 tickUpper) view returns (uint256 feeGrowthInside0X128,uint256 feeGrowthInside1X128)'
]

const UNISWAP_V4_POSITION_MANAGER_ABI = [
  'function modifyLiquidities(bytes payload,uint256 deadline) payable',
  'function getPoolAndPositionInfo(uint256 tokenId) view returns ((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks),uint256 positionInfo)',
  'function getPositionLiquidity(uint256 tokenId) view returns (uint128 liquidity)',
  'function positionInfo(uint256 tokenId) view returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)'
]

const v4ClPoolManagerInterface = new ethers.Interface(V4_CL_POOL_MANAGER_ABI)
const v4ClPositionManagerInterface = new ethers.Interface(V4_CL_POSITION_MANAGER_ABI)
const uniswapV4PoolManagerInterface = new ethers.Interface(UNISWAP_V4_POOL_MANAGER_ABI)
const uniswapV4StateViewInterface = new ethers.Interface(UNISWAP_V4_STATE_VIEW_ABI)
const uniswapV4PositionManagerInterface = new ethers.Interface(UNISWAP_V4_POSITION_MANAGER_ABI)

module.exports = {
  V4_CL_POOL_MANAGER_ABI,
  V4_CL_POSITION_MANAGER_ABI,
  UNISWAP_V4_POOL_MANAGER_ABI,
  UNISWAP_V4_STATE_VIEW_ABI,
  UNISWAP_V4_POSITION_MANAGER_ABI,
  v4ClPoolManagerInterface,
  v4ClPositionManagerInterface,
  uniswapV4PoolManagerInterface,
  uniswapV4StateViewInterface,
  uniswapV4PositionManagerInterface
}
