'use strict'

const { ethers } = require('ethers')

function normalizeInventoryAddress(value) {
  const text = String(value || '').trim()
  return /^0x[a-fA-F0-9]{40}$/.test(text) ? text.toLowerCase() : ''
}

function buildTrustWalletSmartchainLogoUrl(address) {
  try {
    const checksumAddress = ethers.getAddress(String(address || '').trim())
    return `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/smartchain/assets/${checksumAddress}/logo.png`
  } catch (_) {
    return ''
  }
}

function normalizeSwapTokenLogoUrl(metadata = {}) {
  const candidates = [
    metadata.logo,
    metadata.logoUrl,
    metadata.icon,
    metadata.iconUrl,
    metadata.image,
    metadata.imageUrl,
    metadata.thumbnail
  ]
  const value = candidates
    .map((item) => String(item || '').trim())
    .find(Boolean)
  return /^(https?:\/\/|data:image\/)/i.test(value || '') ? value : ''
}

function parseTokenBalanceRaw(value) {
  try {
    return BigInt(value || 0)
  } catch (_) {
    return 0n
  }
}

function normalizeAlchemyTokenBalanceRows(payload = {}) {
  return (payload.tokenBalances || [])
    .map((item) => {
      const address = normalizeInventoryAddress(item.contractAddress || item.address)
      const balanceRaw = parseTokenBalanceRaw(item.tokenBalance || item.balance || 0)
      return address ? { address, balanceRaw } : null
    })
    .filter((item) => item && item.balanceRaw > 0n)
}

function normalizeAlchemyTokenMetadata(metadata = {}, fallbackAddress = '') {
  const decimals = Number(metadata.decimals)
  const address = normalizeInventoryAddress(metadata.address || fallbackAddress)
  return {
    address,
    symbol: String(metadata.symbol || '').trim() || 'UNKNOWN',
    name: String(metadata.name || metadata.symbol || '').trim() || 'Unknown token',
    decimals: Number.isFinite(decimals) && decimals >= 0 ? decimals : 18,
    logoUrl: normalizeSwapTokenLogoUrl(metadata) || buildTrustWalletSmartchainLogoUrl(address),
    verified: false,
    standard: 'BEP20'
  }
}

function getSwapInventoryTokenPriceUsd(token = {}, priceSnapshot = null) {
  const symbol = String(token?.symbol || priceSnapshot?.symbol || '').trim().toUpperCase()
  if (['USDT', 'USDC', 'BUSD', 'FDUSD', 'USDE'].includes(symbol)) {
    return 1
  }
  return Number(priceSnapshot?.priceUsd || token?.priceUsd || 0)
}

function buildSwapWalletInventoryRowsFromAlchemy({
  nativeToken = null,
  nativeBalanceRaw = 0n,
  tokenBalances = [],
  metadataByAddress = new Map(),
  toDisplayAmount = null,
  priceByAddress = new Map()
} = {}) {
  const displayAmount = typeof toDisplayAmount === 'function'
    ? toDisplayAmount
    : ((raw, decimals) => Number(raw) / (10 ** Number(decimals || 18)))
  const rows = []

  const nativeRaw = parseTokenBalanceRaw(nativeBalanceRaw)
  if (nativeToken?.address && nativeRaw > 0n) {
    const price = getSwapInventoryTokenPriceUsd(nativeToken, priceByAddress.get(String(nativeToken.address).toLowerCase()))
    const balance = displayAmount(nativeRaw, nativeToken.decimals)
    rows.push({
      ...nativeToken,
      balanceKey: 'native:bnb',
      balance,
      balanceRaw: nativeRaw.toString(),
      balanceUsd: price > 0 ? balance * price : 0,
      hasBalance: true,
      source: 'wallet-inventory'
    })
  }

  for (const item of tokenBalances || []) {
    const address = normalizeInventoryAddress(item.address || item.contractAddress)
    if (!address) continue
    const balanceRaw = parseTokenBalanceRaw(item.balanceRaw || item.tokenBalance || item.balance || 0)
    if (balanceRaw <= 0n) continue
    const metadata = normalizeAlchemyTokenMetadata(metadataByAddress.get(address) || {}, address)
    const price = getSwapInventoryTokenPriceUsd(metadata, priceByAddress.get(address))
    const balance = displayAmount(balanceRaw, metadata.decimals)
    rows.push({
      ...metadata,
      balance,
      balanceRaw: balanceRaw.toString(),
      balanceUsd: price > 0 ? balance * price : 0,
      hasBalance: true,
      source: 'wallet-inventory'
    })
  }

  return rows.sort((left, right) => {
    const usdDiff = Number(right.balanceUsd || 0) - Number(left.balanceUsd || 0)
    if (usdDiff !== 0) return usdDiff
    return Number(right.balance || 0) - Number(left.balance || 0)
  })
}

module.exports = {
  normalizeAlchemyTokenBalanceRows,
  buildTrustWalletSmartchainLogoUrl,
  normalizeSwapTokenLogoUrl,
  normalizeAlchemyTokenMetadata,
  getSwapInventoryTokenPriceUsd,
  buildSwapWalletInventoryRowsFromAlchemy
}
