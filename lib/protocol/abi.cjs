'use strict'

const { ethers } = require('ethers')

const FACTORY_ABI = [
  'function getPool(address tokenA, address tokenB, uint24 fee) view returns (address pool)'
]

const POOL_ABI = [
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function fee() view returns (uint24)',
  'function tickSpacing() view returns (int24)',
  'function slot0() view returns (uint160 sqrtPriceX96,int24 tick,uint16 observationIndex,uint16 observationCardinality,uint16 observationCardinalityNext,uint8 feeProtocol,bool unlocked)'
]

const ERC20_ABI = [
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function approve(address spender, uint256 value) returns (bool)',
  'function transfer(address to, uint256 value) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)'
]

const PERMIT2_ALLOWANCE_TRANSFER_ABI = [
  'function approve(address token,address spender,uint160 amount,uint48 expiration)',
  'function allowance(address user,address token,address spender) view returns (uint160 amount,uint48 expiration,uint48 nonce)'
]

const POSITION_MANAGER_ABI = [
  'function mint((address token0,address token1,uint24 fee,int24 tickLower,int24 tickUpper,uint256 amount0Desired,uint256 amount1Desired,uint256 amount0Min,uint256 amount1Min,address recipient,uint256 deadline)) payable returns (uint256 tokenId,uint128 liquidity,uint256 amount0,uint256 amount1)',
  'function multicall(bytes[] data) payable returns (bytes[] results)',
  'function positions(uint256 tokenId) view returns (uint96 nonce,address operator,address token0,address token1,uint24 fee,int24 tickLower,int24 tickUpper,uint128 liquidity,uint256 feeGrowthInside0LastX128,uint256 feeGrowthInside1LastX128,uint128 tokensOwed0,uint128 tokensOwed1)',
  'function balanceOf(address owner) view returns (uint256)',
  'function tokenOfOwnerByIndex(address owner,uint256 index) view returns (uint256)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function decreaseLiquidity((uint256 tokenId,uint128 liquidity,uint256 amount0Min,uint256 amount1Min,uint256 deadline)) returns (uint256 amount0,uint256 amount1)',
  'function collect((uint256 tokenId,address recipient,uint128 amount0Max,uint128 amount1Max)) returns (uint256 amount0,uint256 amount1)',
  'function burn(uint256 tokenId)',
  'event DecreaseLiquidity(uint256 indexed tokenId,uint128 liquidity,uint256 amount0,uint256 amount1)',
  'event Collect(uint256 indexed tokenId,address recipient,uint256 amount0,uint256 amount1)',
  'event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)'
]

const WBNB_ABI = [
  'function deposit() payable',
  'function withdraw(uint256 wad)',
  'function approve(address guy, uint256 wad) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)'
]

const SWAP_ROUTER_ABI = [
  'function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns (uint256 amountOut)'
]

const SWAP_ROUTER_ABI_WITH_DEADLINE = [
  'function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 deadline,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns (uint256 amountOut)'
]

const SWAP_ROUTER_EXACT_INPUT_ABI = [
  'function exactInput((bytes path,address recipient,uint256 amountIn,uint256 amountOutMinimum)) payable returns (uint256 amountOut)'
]

const SWAP_ROUTER_EXACT_INPUT_WITH_DEADLINE_ABI = [
  'function exactInput((bytes path,address recipient,uint256 deadline,uint256 amountIn,uint256 amountOutMinimum)) payable returns (uint256 amountOut)'
]

const QUOTER_V2_ABI = [
  'function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)'
]

const LEGACY_QUOTER_ABI = [
  'function quoteExactInputSingle(address tokenIn,address tokenOut,uint24 fee,uint256 amountIn,uint160 sqrtPriceLimitX96) returns (uint256 amountOut)'
]

const V2_FACTORY_ABI = [
  'function getPair(address tokenA,address tokenB) view returns (address pair)'
]

const V2_ROUTER_ABI = [
  'function getAmountsOut(uint256 amountIn,address[] path) view returns (uint256[] amounts)',
  'function swapExactTokensForTokensSupportingFeeOnTransferTokens(uint256 amountIn,uint256 amountOutMin,address[] path,address to,uint256 deadline)',
  'function swapExactETHForTokensSupportingFeeOnTransferTokens(uint256 amountOutMin,address[] path,address to,uint256 deadline) payable',
  'function swapExactTokensForETHSupportingFeeOnTransferTokens(uint256 amountIn,uint256 amountOutMin,address[] path,address to,uint256 deadline)'
]

const factoryInterface = new ethers.Interface(FACTORY_ABI)
const poolInterface = new ethers.Interface(POOL_ABI)
const erc20Interface = new ethers.Interface(ERC20_ABI)
const permit2AllowanceTransferInterface = new ethers.Interface(PERMIT2_ALLOWANCE_TRANSFER_ABI)
const positionManagerInterface = new ethers.Interface(POSITION_MANAGER_ABI)
const swapRouterInterface = new ethers.Interface(SWAP_ROUTER_ABI)
const swapRouterWithDeadlineInterface = new ethers.Interface(SWAP_ROUTER_ABI_WITH_DEADLINE)
const swapRouterExactInputInterface = new ethers.Interface(SWAP_ROUTER_EXACT_INPUT_ABI)
const swapRouterExactInputWithDeadlineInterface = new ethers.Interface(SWAP_ROUTER_EXACT_INPUT_WITH_DEADLINE_ABI)
const quoterV2Interface = new ethers.Interface(QUOTER_V2_ABI)
const legacyQuoterInterface = new ethers.Interface(LEGACY_QUOTER_ABI)
const v2FactoryInterface = new ethers.Interface(V2_FACTORY_ABI)
const v2RouterInterface = new ethers.Interface(V2_ROUTER_ABI)

module.exports = {
  FACTORY_ABI,
  POOL_ABI,
  ERC20_ABI,
  PERMIT2_ALLOWANCE_TRANSFER_ABI,
  POSITION_MANAGER_ABI,
  WBNB_ABI,
  SWAP_ROUTER_ABI,
  SWAP_ROUTER_ABI_WITH_DEADLINE,
  SWAP_ROUTER_EXACT_INPUT_ABI,
  SWAP_ROUTER_EXACT_INPUT_WITH_DEADLINE_ABI,
  QUOTER_V2_ABI,
  LEGACY_QUOTER_ABI,
  V2_FACTORY_ABI,
  V2_ROUTER_ABI,
  factoryInterface,
  poolInterface,
  erc20Interface,
  permit2AllowanceTransferInterface,
  positionManagerInterface,
  swapRouterInterface,
  swapRouterWithDeadlineInterface,
  swapRouterExactInputInterface,
  swapRouterExactInputWithDeadlineInterface,
  quoterV2Interface,
  legacyQuoterInterface,
  v2FactoryInterface,
  v2RouterInterface
}
