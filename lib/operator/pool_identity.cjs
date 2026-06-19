'use strict'

function compactProtocol(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_./-]+/g, '')
}

function normalizeDex(value) {
  const compact = compactProtocol(value)
  if (compact.startsWith('pancake')) return 'pancakeswap'
  if (compact.startsWith('uniswap')) return 'uniswap'
  if (compact.startsWith('sushi')) return 'sushiswap'
  if (compact.startsWith('thena')) return 'thena'
  if (compact.startsWith('topaz')) return 'topaz'
  if (compact.startsWith('unchainx')) return 'unchain-x'
  if (compact.startsWith('bakery')) return 'bakeryswap'
  if (compact.startsWith('mdex')) return 'mdex'
  if (compact.startsWith('biswap')) return 'biswap'
  if (compact.startsWith('babydoge')) return 'babydogeswap'
  if (compact.startsWith('babyswap') || compact === 'baby') return 'babyswap'
  if (compact.startsWith('dinosauregg')) return 'dinosaureggs'
  if (compact.startsWith('wault')) return 'waultswap'
  if (compact.startsWith('gibx')) return 'gibxswap'
  if (compact.startsWith('coinswap')) return 'coinswap'
  if (compact.startsWith('apeswap')) return 'apeswap'
  if (compact.startsWith('definix')) return 'definix'
  if (compact.startsWith('nomiswap')) return 'nomiswap'
  if (compact === '0x877fe7f4e22e21be397cd9364fafd4af4e15edb6') return 'pancakeswap-v1'
  if (compact === '0x01bf7c66c6bd861915cdaae475042d3c4bae16a7') return 'bakeryswap'
  if (compact === '0x9a272d734c5a0d7d84e0a892e891a553e8066dce') return 'mdex'
  if (compact === '0x97bcd9bb482144291d77ee53bfa99317a82066e8') return 'gibxswap'
  if (compact === '0xb42e3fe71b7e0673335b3331b3e1053bd9822570') return 'waultswap'
  if (compact === '0xc2d8d27f3196d9989abf366230a47384010440c0') return 'coinswap'
  if (compact === '0x8fdedcab6ff497f75a65b085ce0c5d497f23fbd7') return 'generic-v2'
  if (compact === '0xdb1d10011ad0ff90774d0c6bb92e5c5c8b4461f7') return 'uniswap'
  if (compact === '0x73dc984d9490286e735548f61dfccec67af82ed9') return 'topaz'
  if (compact === '0xc6b7ee49d386bae4fd501f2d2f8d18828f1f6285') return 'nomiswap'
  if (compact === '0xd6715a8be3944ec72738f0bfdc739d48c3c29349') return 'nomiswap'
  if (compact === '0x858e3312ed3a876947ea49d572a7c42de08af7ee') return 'biswap'
  if (compact === '0x86407bea2078ea5f5eb5a52b2caa963bc1f889da') return 'babyswap'
  if (compact === '0x0841bd0b734e4f5853f0dd8d7ea041c241fb0da6') return 'apeswap'
  if (compact === '0x43ebb0cb9bd53a3ed928dd662095ace1cef92d19') return 'definix'
  return compact || null
}

function baseDexLabel(dex) {
  if (dex === 'pancakeswap') return 'Pancake'
  if (dex === 'uniswap') return 'Uniswap'
  if (dex === 'sushiswap') return 'Sushi'
  if (dex === 'thena') return 'Thena'
  if (dex === 'topaz') return 'Topaz'
  if (dex === 'unchain-x') return 'Unchain X'
  if (dex === 'bakeryswap') return 'BakerySwap'
  if (dex === 'mdex') return 'MDEX'
  if (dex === 'biswap') return 'Biswap'
  if (dex === 'babydogeswap') return 'BabyDogeSwap'
  if (dex === 'babyswap') return 'BabySwap'
  if (dex === 'dinosaureggs') return 'Dinosaur Eggs'
  if (dex === 'waultswap') return 'Wault'
  if (dex === 'gibxswap') return 'GIBX'
  if (dex === 'coinswap') return 'CoinSwap'
  if (dex === 'apeswap') return 'ApeSwap'
  if (dex === 'definix') return 'Definix'
  if (dex === 'nomiswap') return 'Nomiswap'
  if (dex === 'pancakeswap-v1') return 'Pancake'
  if (dex === 'generic-v2') return 'DEX'
  return dex ? dex.replace(/(^\w)|([ -]\w)/g, (match) => match.toUpperCase()) : null
}

function versionFromProtocol(protocol) {
  const compact = compactProtocol(protocol)
  const embedded = compact.match(/v([1234])(?:bsc|bnb|chain|mainnet|testnet)?$/)
    || compact.match(/v([1234])(?=[a-z]|$)/)
  if (embedded) {
    return `v${embedded[1]}`
  }
  const match = compact.match(/(?:^|[^a-z0-9])?v?([1234])$/) || compact.match(/(v[1234]|[1234])$/)
  if (!match) return null
  const raw = String(match[1] || '').replace(/^v/i, '')
  return raw ? `v${raw}` : null
}

function inferPoolDexFromName(poolName, fallbackDex = null) {
  const normalized = compactProtocol(poolName)
  if (normalized.includes('nomiswap')) return 'nomiswap'
  if (normalized.includes('biswap')) return 'biswap'
  if (normalized.includes('baby')) return 'babyswap'
  if (normalized.includes('apeswap')) return 'apeswap'
  if (normalized.includes('definix')) return 'definix'
  if (normalized.includes('pancake')) return 'pancakeswap'
  return fallbackDex
}

function buildV2PoolTypeLabel(labelBase, poolName) {
  const normalizedName = String(poolName || '').trim()
  if (/nomiswap stable lps/i.test(normalizedName)) return 'Nomiswap Stable LP'
  if (/nomiswap lps/i.test(normalizedName)) return 'Nomiswap V2 Pool'
  if (/biswap lps/i.test(normalizedName)) return 'Biswap V2 Pool'
  if (/baby ?doge/i.test(normalizedName)) return 'BabyDogeSwap V2 Pool'
  if (/baby lps/i.test(normalizedName)) return 'BabySwap V2 Pool'
  if (/dinosaur/i.test(normalizedName)) return 'Dinosaur Eggs V2 Pool'
  if (/bakery/i.test(normalizedName)) return 'BakerySwap V2 Pool'
  if (/mdex/i.test(normalizedName)) return 'MDEX V2 Pool'
  if (/wault/i.test(normalizedName)) return 'Wault V2 Pool'
  if (/gibx/i.test(normalizedName)) return 'GIBX V2 Pool'
  if (/coinswap/i.test(normalizedName)) return 'CoinSwap V2 Pool'
  if (/apeswapfinance lps/i.test(normalizedName)) return 'ApeSwap V2 Pool'
  if (/definix lps/i.test(normalizedName)) return 'Definix V2 Pool'
  if (/pancake lps/i.test(normalizedName)) return 'Pancake V2 Pool'
  return `${labelBase || 'DEX'} V2 Pool`
}

function buildProductPoolTypeLabel(protocolVersion, { dex = '', poolModel = '' } = {}) {
  const version = String(protocolVersion || '').toLowerCase()
  if (String(dex || '').toLowerCase() === 'pancakeswap' && version === 'v4') return 'Infinity'
  if (version === 'fusion') return 'V3'
  if (version === 'v4') return 'V4'
  if (version === 'v3') return 'V3'
  if (version === 'v2' || version === 'v1') return 'V2'
  const model = String(poolModel || '').toLowerCase()
  if (model === 'algebra-cl' || model === 'cl') return 'V3'
  if (model === 'xyk' || model === 'stable-v2') return 'V2'
  return null
}

function classifyPoolProtocol(source = {}) {
  const protocol = source.protocol || source.dexDisplay || source.dexLabel || source.quoteChip || source.dex || ''
  const compact = compactProtocol(protocol)
  const namedDex = inferPoolDexFromName(source.poolName || source.name, null)
  const dex = namedDex || normalizeDex(source.dex || protocol)
  const poolName = source.poolName || source.name || ''
  const detectedKind = String(source.onchainPoolKind || source.poolProtocolKind || '').toLowerCase()

  if (compact === 'thena') {
    return {
      dex: 'thena',
      protocolVersion: 'fusion',
      dexLabel: 'Thena Fusion',
      dexDisplay: 'Thena Fusion',
      poolProtocolLabel: 'Thena Fusion',
      poolTypeLabel: 'V3',
      poolModel: 'algebra-cl',
      supportsBidAsk: false,
      supportsSpot: false
    }
  }

  const explicitVersion = ['v1', 'v2', 'v3', 'v4', 'fusion'].includes(String(source.protocolVersion || '').toLowerCase())
    ? String(source.protocolVersion).toLowerCase()
    : null
  const version = explicitVersion || versionFromProtocol(protocol)
  const labelBase = baseDexLabel(dex)
  const v2OnlyDexes = new Set([
    'nomiswap',
    'biswap',
    'bakeryswap',
    'mdex',
    'babydogeswap',
    'babyswap',
    'apeswap',
    'definix',
    'dinosaureggs',
    'waultswap',
    'gibxswap',
    'coinswap',
    'generic-v2'
  ])

  if (!version && v2OnlyDexes.has(dex)) {
    return {
      dex,
      protocolVersion: 'v2',
      dexLabel: `${labelBase || 'DEX'} V2`,
      dexDisplay: `${labelBase || 'DEX'} V2`,
      poolProtocolLabel: buildV2PoolTypeLabel(labelBase, poolName),
      poolTypeLabel: 'V2',
      poolModel: /stable/i.test(String(poolName || '')) ? 'stable-v2' : 'xyk',
      supportsBidAsk: false,
      supportsSpot: true
    }
  }

  if (!version && dex === 'pancakeswap-v1') {
    return {
      dex,
      protocolVersion: 'v1',
      dexLabel: 'Pancake V1',
      dexDisplay: 'Pancake V1',
      poolProtocolLabel: 'Pancake V1',
      poolTypeLabel: 'V2',
      poolModel: 'xyk',
      supportsBidAsk: false,
      supportsSpot: false
    }
  }

  if (detectedKind === 'v2' || detectedKind === 'xyk') {
    return {
      dex,
      protocolVersion: 'v2',
      dexLabel: labelBase || 'DEX',
      dexDisplay: labelBase || 'DEX',
      poolProtocolLabel: buildV2PoolTypeLabel(labelBase, poolName),
      poolTypeLabel: 'V2',
      poolModel: /stable/i.test(String(poolName || '')) ? 'stable-v2' : 'xyk',
      supportsBidAsk: false,
      supportsSpot: true
    }
  }

  if (detectedKind === 'cl' || compact === 'topaz' || dex === 'topaz' || dex === 'unchain-x') {
    return {
      dex,
      protocolVersion: 'v3',
      dexLabel: labelBase || 'CL Factory',
      dexDisplay: labelBase || 'CL Factory',
      poolProtocolLabel: dex === 'topaz' ? 'Topaz CL' : `${labelBase || 'Factory'} CL`,
      poolTypeLabel: 'V3',
      poolModel: 'cl',
      supportsBidAsk: dex === 'uniswap' || dex === 'pancakeswap',
      supportsSpot: dex === 'uniswap' || dex === 'pancakeswap'
    }
  }

  if ((compact === 'uniswap' || dex === 'uniswap') && !version) {
    return {
      dex: 'uniswap',
      protocolVersion: 'v3',
      dexLabel: 'Uniswap V3',
      dexDisplay: 'Uniswap V3',
      poolProtocolLabel: 'Uniswap V3',
      poolTypeLabel: 'V3',
      poolModel: 'cl',
      supportsBidAsk: true,
      supportsSpot: true
    }
  }

  if (dex === 'pancakeswap' && version === 'v4') {
    return {
      dex,
      protocolVersion: 'v4',
      dexLabel: 'Pancake Infinity',
      dexDisplay: 'Pancake Infinity',
      poolProtocolLabel: 'Pancake Infinity',
      poolTypeLabel: 'Infinity',
      poolModel: 'cl',
      supportsBidAsk: false,
      supportsSpot: true
    }
  }

  if (version === 'v1') {
    return {
      dex,
      protocolVersion: 'v1',
      dexLabel: `${labelBase || 'DEX'} V1`,
      dexDisplay: `${labelBase || 'DEX'} V1`,
      poolProtocolLabel: `${labelBase || 'DEX'} V1`,
      poolTypeLabel: 'V2',
      poolModel: 'xyk',
      supportsBidAsk: false,
      supportsSpot: false
    }
  }

  if (version === 'v2') {
    return {
      dex,
      protocolVersion: 'v2',
      dexLabel: `${labelBase || 'DEX'} V2`,
      dexDisplay: `${labelBase || 'DEX'} V2`,
      poolProtocolLabel: buildV2PoolTypeLabel(labelBase, poolName),
      poolTypeLabel: 'V2',
      poolModel: 'xyk',
      supportsBidAsk: false,
      supportsSpot: true
    }
  }

  if (version === 'v3' || version === 'v4') {
    return {
      dex,
      protocolVersion: version,
      dexLabel: `${labelBase || 'DEX'} ${version.toUpperCase()}`,
      dexDisplay: `${labelBase || 'DEX'} ${version.toUpperCase()}`,
      poolProtocolLabel: `${labelBase || 'DEX'} ${version.toUpperCase()}`,
      poolTypeLabel: buildProductPoolTypeLabel(version, { dex, poolModel: 'cl' }),
      poolModel: 'cl',
      supportsBidAsk: true,
      supportsSpot: true
    }
  }

  if (String(source.poolModel || '').toLowerCase() === 'xyk') {
    return {
      dex,
      protocolVersion: 'v2',
      dexLabel: `${labelBase || 'DEX'} V2`,
      dexDisplay: `${labelBase || 'DEX'} V2`,
      poolProtocolLabel: `${labelBase || 'DEX'} V2 Pool`,
      poolTypeLabel: 'V2',
      poolModel: 'xyk',
      supportsBidAsk: false,
      supportsSpot: true
    }
  }

  return {
    dex,
    protocolVersion: null,
    dexLabel: labelBase || null,
    dexDisplay: labelBase || null,
    poolProtocolLabel: null,
    poolTypeLabel: null,
    poolModel: null,
    supportsBidAsk: false,
    supportsSpot: false,
    classificationError: 'unclassified-pool-protocol'
  }
}

function decoratePoolWithProtocolIdentity(pool = {}, source = {}) {
  const identity = classifyPoolProtocol({
    ...pool,
    ...source,
    protocol: source.protocol || pool.protocol || pool.dexDisplay || pool.dexLabel || pool.quoteChip || pool.dex
  })

  return {
    ...pool,
    dex: identity.dex || pool.dex,
    protocolVersion: identity.protocolVersion,
    dexLabel: identity.dexLabel || pool.dexLabel,
    dexDisplay: identity.dexDisplay || pool.dexDisplay,
    poolProtocolLabel: identity.poolProtocolLabel,
    poolTypeLabel: identity.poolTypeLabel,
    poolModel: identity.poolModel,
    supportsBidAsk: identity.supportsBidAsk,
    supportsSpot: identity.supportsSpot,
    classificationError: identity.classificationError || null
  }
}

module.exports = {
  classifyPoolProtocol,
  decoratePoolWithProtocolIdentity,
  buildProductPoolTypeLabel
}
