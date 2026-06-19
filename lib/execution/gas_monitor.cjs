'use strict'

const { ethers } = require('ethers')

const BSC_STANDARD_GAS_PRICE_WEI = 50_000_000n
const BSC_FAST_MIN_PRIORITY_FEE_WEI = BSC_STANDARD_GAS_PRICE_WEI
const BSC_URGENT_MIN_PRIORITY_FEE_WEI = BSC_STANDARD_GAS_PRICE_WEI
const GAS_ENVELOPE_READ_TIMEOUT_MS = 1500
const LEGACY_GAS_CHAIN_IDS = new Set([56, 97])

function withTimeout(promise, timeoutMs, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`${label || 'operation'} timed out after ${timeoutMs}ms`)), timeoutMs)
    })
  ])
}

function percentile(values, ratio) {
  const filtered = values.map((value) => Number(value)).filter((value) => Number.isFinite(value) && value >= 0)
  if (!filtered.length) {
    return null
  }
  filtered.sort((left, right) => left - right)
  const index = Math.min(filtered.length - 1, Math.max(0, Math.floor((filtered.length - 1) * ratio)))
  return filtered[index]
}

function normalizePositiveBigInt(value, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback
  }

  try {
    const normalized = BigInt(value)
    return normalized > 0n ? normalized : fallback
  } catch (_) {
    return fallback
  }
}

async function isLegacyGasChain(provider) {
  if (!provider || typeof provider.getNetwork !== 'function') {
    return false
  }

  try {
    const network = await withTimeout(provider.getNetwork(), GAS_ENVELOPE_READ_TIMEOUT_MS, 'network').catch(() => null)
    const chainId = Number(network?.chainId)
    return Number.isFinite(chainId) && LEGACY_GAS_CHAIN_IDS.has(chainId)
  } catch (_) {
    return false
  }
}

async function buildGasEnvelope({
  provider,
  profile,
  action = 'open',
  urgency = null
} = {}) {
  if (!provider) {
    throw new Error('buildGasEnvelope requires provider')
  }

  const gasProfile = profile?.gasProfile || profile?.gas?.[action] || {}
  const effectiveUrgency = urgency || gasProfile.urgency || 'fast'
  const [feeData, feeHistory] = await Promise.all([
    withTimeout(provider.getFeeData(), GAS_ENVELOPE_READ_TIMEOUT_MS, 'fee data').catch(() => null),
    withTimeout(provider.send('eth_feeHistory', [5, 'latest', [50, 75, 90]]), GAS_ENVELOPE_READ_TIMEOUT_MS, 'fee history').catch(() => null)
  ])
  const forceLegacyGas = await isLegacyGasChain(provider)

  const prioritySamples = Array.isArray(feeHistory?.reward)
    ? feeHistory.reward.flat().map((value) => Number(BigInt(value)))
    : []
  const priorityHint = percentile(prioritySamples, effectiveUrgency === 'urgent' ? 0.8 : 0.6)
  const priorityFloor = effectiveUrgency === 'urgent'
    ? BSC_URGENT_MIN_PRIORITY_FEE_WEI
    : BSC_FAST_MIN_PRIORITY_FEE_WEI
  const legacyGasPriceFloor = normalizePositiveBigInt(gasProfile.legacyGasPriceFloorWei, priorityFloor)
  const maxPriorityFeePerGas = priorityHint != null && priorityHint > 0
    ? BigInt(Math.max(priorityHint, Number(feeData?.maxPriorityFeePerGas || 0n), Number(priorityFloor)))
    : (feeData?.maxPriorityFeePerGas != null
        ? BigInt(Math.max(Number(feeData.maxPriorityFeePerGas), Number(priorityFloor)))
        : priorityFloor)
  const latestBaseFee = Array.isArray(feeHistory?.baseFeePerGas) && feeHistory.baseFeePerGas.length
    ? BigInt(feeHistory.baseFeePerGas[feeHistory.baseFeePerGas.length - 1])
    : undefined
  const multiplierBps = BigInt(Number(gasProfile.priorityMultiplierBps || 10_000))
  const legacyGasPrice = (() => {
    if (feeData?.gasPrice == null) {
      return legacyGasPriceFloor
    }
    const suggested = BigInt(feeData.gasPrice) * multiplierBps / 10_000n
    return suggested > legacyGasPriceFloor ? suggested : legacyGasPriceFloor
  })()
  const maxFeePerGas = !forceLegacyGas && latestBaseFee != null && maxPriorityFeePerGas != null
    ? (latestBaseFee + maxPriorityFeePerGas) * multiplierBps / 10_000n
    : (!forceLegacyGas && feeData?.maxFeePerGas != null ? BigInt(feeData.maxFeePerGas) : undefined)

  return {
    action,
    urgency: effectiveUrgency,
    maxFeePerGas: forceLegacyGas ? undefined : maxFeePerGas,
    maxPriorityFeePerGas: forceLegacyGas ? undefined : maxPriorityFeePerGas,
    legacyGasPrice: forceLegacyGas ? legacyGasPrice : (maxFeePerGas == null ? legacyGasPrice : undefined),
    inclusionTtlMs: Number(gasProfile.inclusionTtlMs || 15_000),
    replacementTriggerMs: Number(gasProfile.replacementTriggerMs || 12_000),
    cancelTriggerMs: Number(gasProfile.cancelTriggerMs || 25_000),
    source: forceLegacyGas ? 'feeData-legacy' : (feeHistory ? 'feeHistory' : 'feeData')
  }
}

async function monitorPendingExecution({
  txHash,
  nonce,
  action = 'open',
  expectedEnvelope,
  provider,
  signer,
  submittedAtMs = Date.now()
} = {}) {
  void signer
  if (!provider || !txHash) {
    throw new Error('monitorPendingExecution requires provider and txHash')
  }

  const receipt = await provider.getTransactionReceipt(txHash).catch(() => null)
  if (receipt) {
    return {
      status: 'confirmed',
      replacementSuggested: false,
      cancelSuggested: false,
      nonce: nonce == null ? null : Number(nonce),
      reason: 'receipt_found'
    }
  }

  const ageMs = Math.max(0, Date.now() - Number(submittedAtMs || Date.now()))
  const replacementSuggested = ageMs >= Number(expectedEnvelope?.replacementTriggerMs || 0)
  const cancelSuggested = ageMs >= Number(expectedEnvelope?.cancelTriggerMs || 0)

  return {
    status: 'pending',
    replacementSuggested,
    cancelSuggested,
    nonce: nonce == null ? null : Number(nonce),
    reason: cancelSuggested
      ? `${action}_pending_beyond_cancel_ttl`
      : replacementSuggested
        ? `${action}_pending_beyond_replacement_ttl`
        : 'awaiting_inclusion'
  }
}

function buildGasPolicyFromEnvelope(envelope) {
  if (!envelope) {
    return {}
  }

  return {
    maxFeePerGas: envelope.maxFeePerGas,
    maxPriorityFeePerGas: envelope.maxPriorityFeePerGas,
    legacyGasPrice: envelope.legacyGasPrice
  }
}

module.exports = {
  buildGasEnvelope,
  monitorPendingExecution,
  buildGasPolicyFromEnvelope
}
