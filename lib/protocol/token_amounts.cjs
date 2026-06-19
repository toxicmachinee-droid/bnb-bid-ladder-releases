'use strict'

const { ethers } = require('ethers')
const { normalizeAddress } = require('./address.cjs')

function decimalToString(value, decimals) {
  return new Intl.NumberFormat('en-US', {
    useGrouping: false,
    maximumFractionDigits: Math.min(Math.max(decimals, 0), 18)
  }).format(value)
}

function usdToTokenAmount(amountUsd, tokenUsdPrice, decimals) {
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
    return 0n
  }

  if (!Number.isFinite(tokenUsdPrice) || tokenUsdPrice <= 0) {
    throw new Error('tokenUsdPrice is required to convert USD budget into token amount')
  }

  const tokenAmount = amountUsd / tokenUsdPrice
  return ethers.parseUnits(decimalToString(tokenAmount, decimals), decimals)
}

function resolveDepositSide(pool, normalizeAddressFn = normalizeAddress) {
  const depositTokenAddress = normalizeAddressFn(pool.depositTokenAddress)
  const token0Address = normalizeAddressFn(pool.token0Address)
  const token1Address = normalizeAddressFn(pool.token1Address)

  if (depositTokenAddress.toLowerCase() === token0Address.toLowerCase()) {
    return 'token0'
  }

  if (depositTokenAddress.toLowerCase() === token1Address.toLowerCase()) {
    return 'token1'
  }

  throw new Error('depositTokenAddress must match token0 or token1')
}

function formatTokenAmount(amount, decimals) {
  return ethers.formatUnits(BigInt(amount), decimals)
}

module.exports = {
  decimalToString,
  usdToTokenAmount,
  resolveDepositSide,
  formatTokenAmount
}
