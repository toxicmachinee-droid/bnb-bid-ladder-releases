'use strict'

const { ethers } = require('ethers')
const { COMMON_TOKENS } = require('../bnb_v3_config.cjs')

function buildDefaultTokenRegistry() {
  return Object.values(COMMON_TOKENS).map((token) => ({
    symbol: token.symbol,
    name: token.symbol,
    address: token.address,
    decimals: token.decimals
  }))
}

function isAddressQuery(query) {
  return typeof query === 'string' && /^0x[a-fA-F0-9]{40}$/.test(query.trim())
}

function resolveTokenQuery(query, registry = buildDefaultTokenRegistry()) {
  const normalizedQuery = String(query || '').trim()

  if (!normalizedQuery) {
    return {
      ok: false,
      reason: 'empty_query',
      matches: []
    }
  }

  if (isAddressQuery(normalizedQuery)) {
    return {
      ok: true,
      type: 'address',
      query: normalizedQuery,
      token: {
        symbol: 'UNKNOWN',
        name: 'Address input',
        address: ethers.getAddress(normalizedQuery),
        decimals: null
      },
      matches: []
    }
  }

  const lowerQuery = normalizedQuery.toLowerCase()
  const matches = registry.filter((token) => {
    return String(token.symbol || '').toLowerCase().includes(lowerQuery) ||
      String(token.name || '').toLowerCase().includes(lowerQuery)
  })

  if (!matches.length) {
    return {
      ok: false,
      reason: 'no_registry_match',
      query: normalizedQuery,
      matches: []
    }
  }

  return {
    ok: true,
    type: 'symbol',
    query: normalizedQuery,
    token: matches[0],
    matches
  }
}

module.exports = {
  buildDefaultTokenRegistry,
  isAddressQuery,
  resolveTokenQuery
}
