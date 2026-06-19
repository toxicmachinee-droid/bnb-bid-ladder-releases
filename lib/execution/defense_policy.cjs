'use strict'

const STABLE_SYMBOLS = new Set(['USDT', 'USDC', 'BUSD', 'DAI', 'FDUSD', 'TUSD'])
const MAJOR_SYMBOLS = new Set(['WBNB', 'BNB', 'BTCB', 'BTC', 'ETH', 'WETH'])
const OPEN_ACTIONS = new Set(['open'])
const CLOSE_ACTIONS = new Set(['close', 'collect_close', 'post_exit_autoswap'])

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) {
    return fallback
  }
  return Math.min(max, Math.max(min, numeric))
}

function normalizeSymbol(value) {
  return String(value || '').trim().toUpperCase()
}

function classifyPairRisk({
  tokenInSymbol = null,
  tokenOutSymbol = null,
  depositTokenSymbol = null,
  inputTokenSymbol = null
} = {}) {
  const left = normalizeSymbol(tokenInSymbol || inputTokenSymbol)
  const right = normalizeSymbol(tokenOutSymbol || depositTokenSymbol)

  if (STABLE_SYMBOLS.has(left) && STABLE_SYMBOLS.has(right)) {
    return 'stable'
  }

  if (MAJOR_SYMBOLS.has(left) && (STABLE_SYMBOLS.has(right) || MAJOR_SYMBOLS.has(right))) {
    return 'major'
  }

  if (MAJOR_SYMBOLS.has(right) && (STABLE_SYMBOLS.has(left) || MAJOR_SYMBOLS.has(left))) {
    return 'major'
  }

  return 'shield'
}

function buildShieldBalancedProfile() {
  return {
    profile: 'shield-balanced',
    latencyBudgetMs: 1000,
    defaultPairClass: 'shield',
    priceDeteriorationWarnBps: {
      open: {
        stable: 25,
        major: 110,
        shield: 550
      },
      close: {
        stable: 25,
        major: 80,
        shield: 260
      },
      collect_close: {
        stable: 25,
        major: 80,
        shield: 260
      },
      post_exit_autoswap: {
        stable: 20,
        major: 70,
        shield: 180
      }
    },
    priceDeteriorationBlockBps: {
      open: {
        stable: 45,
        major: 180,
        shield: 1000
      },
      close: {
        stable: 45,
        major: 140,
        shield: 420
      },
      collect_close: {
        stable: 45,
        major: 140,
        shield: 420
      },
      post_exit_autoswap: {
        stable: 35,
        major: 120,
        shield: 260
      }
    },
    immediateImpairmentWarnBps: {
      open: {
        stable: 20,
        major: 120,
        shield: 650
      },
      close: {
        stable: 20,
        major: 90,
        shield: 320
      },
      collect_close: {
        stable: 20,
        major: 90,
        shield: 320
      },
      post_exit_autoswap: {
        stable: 20,
        major: 75,
        shield: 220
      }
    },
    immediateImpairmentBlockBps: {
      open: {
        stable: 40,
        major: 220,
        shield: 1400
      },
      close: {
        stable: 40,
        major: 160,
        shield: 520
      },
      collect_close: {
        stable: 40,
        major: 160,
        shield: 520
      },
      post_exit_autoswap: {
        stable: 35,
        major: 140,
        shield: 320
      }
    },
    fairValueFreshnessMs: {
      stable: 60_000,
      major: 90_000,
      shield: 180_000
    },
    lowConfidenceFloor: {
      open: 0.2,
      close: 0.35,
      post_exit_autoswap: 0.45
    },
    minConfidenceWarn: {
      open: 0.45,
      close: 0.55,
      post_exit_autoswap: 0.6
    },
    gas: {
      open: {
        urgency: 'fast',
        inclusionTtlMs: 15_000,
        replacementTriggerMs: 12_000,
        cancelTriggerMs: 25_000,
        priorityMultiplierBps: 10_000,
        legacyGasPriceFloorWei: 50_000_000n
      },
      close: {
        urgency: 'urgent',
        inclusionTtlMs: 10_000,
        replacementTriggerMs: 8_000,
        cancelTriggerMs: 18_000,
        priorityMultiplierBps: 10_000,
        legacyGasPriceFloorWei: 50_000_000n
      },
      collect_close: {
        urgency: 'urgent',
        inclusionTtlMs: 10_000,
        replacementTriggerMs: 8_000,
        cancelTriggerMs: 18_000,
        priorityMultiplierBps: 10_000,
        legacyGasPriceFloorWei: 50_000_000n
      },
      post_exit_autoswap: {
        urgency: 'urgent',
        inclusionTtlMs: 8_000,
        replacementTriggerMs: 6_000,
        cancelTriggerMs: 15_000,
        priorityMultiplierBps: 10_000,
        legacyGasPriceFloorWei: 50_000_000n
      }
    },
    mempool: {
      enabledByDefault: false,
      warnHostility: 0.45,
      blockHostility: 0.8
    }
  }
}

function buildPreTradeDefensePolicy({
  profile = 'shield-balanced',
  action = 'open',
  pairClass = null
} = {}) {
  const normalizedProfile = String(profile || 'shield-balanced').trim().toLowerCase()
  const baseProfile = buildShieldBalancedProfile()
  if (normalizedProfile !== 'shield-balanced') {
    throw new Error(`Unsupported defense profile: ${profile}`)
  }

  const normalizedAction = String(action || 'open').trim().toLowerCase()
  const normalizedPairClass = ['stable', 'major', 'shield'].includes(String(pairClass || '').trim().toLowerCase())
    ? String(pairClass).trim().toLowerCase()
    : baseProfile.defaultPairClass
  const actionKey = CLOSE_ACTIONS.has(normalizedAction) ? normalizedAction : 'open'

  return {
    ...baseProfile,
    action: normalizedAction,
    pairClass: normalizedPairClass,
    thresholds: {
      deteriorationWarnBps: baseProfile.priceDeteriorationWarnBps[actionKey]?.[normalizedPairClass],
      deteriorationBlockBps: baseProfile.priceDeteriorationBlockBps[actionKey]?.[normalizedPairClass],
      impairmentWarnBps: baseProfile.immediateImpairmentWarnBps[actionKey]?.[normalizedPairClass],
      impairmentBlockBps: baseProfile.immediateImpairmentBlockBps[actionKey]?.[normalizedPairClass],
      freshnessMs: baseProfile.fairValueFreshnessMs[normalizedPairClass],
      minConfidenceWarn: baseProfile.minConfidenceWarn[actionKey] ?? baseProfile.minConfidenceWarn.open,
      lowConfidenceFloor: baseProfile.lowConfidenceFloor[actionKey] ?? baseProfile.lowConfidenceFloor.open
    },
    gasProfile: baseProfile.gas[actionKey] || baseProfile.gas.open
  }
}

function normalizeConfidence(value, fallback = 0.5) {
  return clampNumber(value, 0, 1, fallback)
}

function normalizeRiskScore(value, fallback = 0) {
  return clampNumber(value, 0, 1, fallback)
}

function resolveDefenseVerdict({
  hardBlock = false,
  shouldWarn = false,
  score = 0,
  confidence = 0.5,
  policy
}) {
  const normalizedScore = normalizeRiskScore(score, 0)
  const normalizedConfidence = normalizeConfidence(confidence, 0.5)

  if (hardBlock) {
    return 'block'
  }

  if (normalizedConfidence < Number(policy?.thresholds?.lowConfidenceFloor || 0)) {
    return OPEN_ACTIONS.has(String(policy?.action || 'open')) ? 'warn' : 'block'
  }

  if (shouldWarn || normalizedScore >= 0.45 || normalizedConfidence < Number(policy?.thresholds?.minConfidenceWarn || 0.45)) {
    return 'warn'
  }

  return 'allow'
}

module.exports = {
  STABLE_SYMBOLS,
  MAJOR_SYMBOLS,
  classifyPairRisk,
  buildPreTradeDefensePolicy,
  normalizeConfidence,
  normalizeRiskScore,
  resolveDefenseVerdict
}
