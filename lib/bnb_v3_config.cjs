'use strict'

const { ethers } = require('ethers')

const COMMON_TOKENS = {
  WBNB: {
    symbol: 'WBNB',
    address: ethers.getAddress('0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c'),
    decimals: 18
  },
  USDT: {
    symbol: 'USDT',
    address: ethers.getAddress('0x55d398326f99059fF775485246999027B3197955'),
    decimals: 18
  },
  USDC: {
    symbol: 'USDC',
    address: ethers.getAddress('0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d'),
    decimals: 18
  }
}

const V3_DEPLOYMENTS = {
  pancakeswap: {
    key: 'pancakeswap',
    label: 'PancakeSwap V3',
    chainId: 56,
    factory: ethers.getAddress('0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865'),
    positionManager: ethers.getAddress('0x46A15B0b27311cedF172AB29E4f4766fbE7F4364'),
    quoter: ethers.getAddress('0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997'),
    tickLens: ethers.getAddress('0x9a489505a00cE272eAa5e07Dba6491314CaE3796'),
    router: ethers.getAddress('0x1b81D678ffb9C0263b24A97847620C99d213eB14'),
    supportedFees: [100, 500, 2000, 2500, 3000, 5000, 10000, 20000, 30000, 40000, 50000]
  },
  uniswap: {
    key: 'uniswap',
    label: 'Uniswap V3',
    chainId: 56,
    factory: ethers.getAddress('0xdB1d10011AD0Ff90774D0C6Bb92e5C5c8b4461F7'),
    positionManager: ethers.getAddress('0x7b8A01B39D58278b5DE7e48c8449c9f4F5170613'),
    quoter: ethers.getAddress('0x78D78E420Da98ad378D7799bE8f4AF69033EB077'),
    tickLens: ethers.getAddress('0xD9270014D396281579760619CCf4c3af0501A47C'),
    router: ethers.getAddress('0xB971eF87ede563556b2ED4b1C0b0019111Dd85d2'),
    supportedFees: [100, 500, 2000, 2500, 3000, 5000, 10000, 20000, 30000, 40000, 50000]
  }
}

const V2_DEPLOYMENTS = {
  pancakeswap: {
    key: 'pancakeswap-v2',
    label: 'PancakeSwap V2',
    chainId: 56,
    factory: ethers.getAddress('0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73'),
    router: ethers.getAddress('0x10ED43C718714eb63d5aA57B78B54704E256024E'),
    feeBps: 25
  }
}

const V4_DEPLOYMENTS = {
  pancakeswap: {
    key: 'pancakeswap',
    label: 'PancakeSwap V4',
    chainId: 56,
    protocolVersion: 'v4',
    permit2: ethers.getAddress('0x31c2F6fcFf4F8759b3Bd5Bf0e1084A055615c768'),
    universalRouter: ethers.getAddress('0xd9c500dff816a1da21a48a732d3498bf09dc9aeb'),
    poolManager: ethers.getAddress('0xa0FfB9c1CE1Fe56963B0321B32E7A0302114058b'),
    positionManager: ethers.getAddress('0x55f4c8abA71A1e923edC303eb4fEfF14608cC226'),
    quoter: ethers.getAddress('0xd0737C9762912dD34c3271197E362Aa736Df0926'),
    tickLens: ethers.getAddress('0x8BcF30285413F25032fb983C2bF4deFe29a33f3a')
  },
  uniswap: {
    key: 'uniswap',
    label: 'Uniswap V4',
    chainId: 56,
    protocolVersion: 'v4',
    permit2: ethers.getAddress('0x000000000022D473030F116dDEE9F6B43aC78BA3'),
    universalRouter: ethers.getAddress('0x1906c1d672b88cd1b9ac7593301ca990f94eae07'),
    poolManager: ethers.getAddress('0x28e2ea090877bf75740558f6bfb36a5ffee9e9df'),
    positionManager: ethers.getAddress('0x7a4a5c919ae2541aed11041a1aeee68f1287f95b'),
    quoter: ethers.getAddress('0x9f75dd27d6664c475b90e105573e550ff69437b0'),
    stateView: ethers.getAddress('0xd13dd3d6e93f276fafc9db9e6bb47c1180aee0c4')
  }
}

module.exports = {
  COMMON_TOKENS,
  V2_DEPLOYMENTS,
  V3_DEPLOYMENTS,
  V4_DEPLOYMENTS
}
