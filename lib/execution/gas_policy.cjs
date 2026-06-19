'use strict'

const ESTIMATE_GAS_RETRY_DELAYS_MS = [300, 800]
const DEFAULT_ESTIMATE_GAS_TIMEOUT_MS = 2_000
const DEFAULT_MAX_GAS_LIMIT = 3_000_000n

function normalizeBigInt(value, fallback = undefined) {
  if (value === undefined || value === null || value === '') {
    return fallback
  }

  return BigInt(value)
}

function buildGasPolicy({
  maxFeePerGas,
  maxPriorityFeePerGas,
  gasLimitMultiplier = 12000,
  legacyGasPrice,
  estimateTimeoutMs = DEFAULT_ESTIMATE_GAS_TIMEOUT_MS,
  maxGasLimit = DEFAULT_MAX_GAS_LIMIT
} = {}) {
  return {
    maxFeePerGas: normalizeBigInt(maxFeePerGas),
    maxPriorityFeePerGas: normalizeBigInt(maxPriorityFeePerGas),
    gasLimitMultiplier: Number.isFinite(gasLimitMultiplier) && gasLimitMultiplier > 0 ? gasLimitMultiplier : 12000,
    legacyGasPrice: normalizeBigInt(legacyGasPrice),
    estimateTimeoutMs: Number.isFinite(Number(estimateTimeoutMs)) && Number(estimateTimeoutMs) > 0
      ? Number(estimateTimeoutMs)
      : DEFAULT_ESTIMATE_GAS_TIMEOUT_MS,
    maxGasLimit: normalizeBigInt(maxGasLimit)
  }
}

function applyGasPolicyToEstimate(estimatedGas, gasPolicy) {
  const multiplier = BigInt(gasPolicy.gasLimitMultiplier)
  return BigInt(estimatedGas) * multiplier / 10000n
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function withTimeout(promise, timeoutMs, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`${label || 'operation'} timed out after ${timeoutMs}ms`)), timeoutMs)
    })
  ])
}

function isTransientRpcError(error) {
  const message = String(
    error?.shortMessage
      || error?.info?.error?.message
      || error?.error?.message
      || error?.message
      || error
      || ''
  ).toLowerCase()

  return (
    message.includes('econnreset')
    || message.includes('socket hang up')
    || message.includes('timeout')
    || message.includes('timed out')
    || message.includes('network error')
    || message.includes('missing response')
    || message.includes('failed to fetch')
    || message.includes('connection closed')
    || message.includes('503')
    || message.includes('502')
    || message.includes('504')
  )
}

async function estimateGasWithRetry(signer, request, { timeoutMs = DEFAULT_ESTIMATE_GAS_TIMEOUT_MS, retryDelaysMs = ESTIMATE_GAS_RETRY_DELAYS_MS } = {}) {
  let lastError = null
  const retryDelays = Array.isArray(retryDelaysMs) ? retryDelaysMs : ESTIMATE_GAS_RETRY_DELAYS_MS

  for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
    try {
      return await withTimeout(
        signer.estimateGas(request),
        timeoutMs,
        'estimateGas'
      )
    } catch (error) {
      lastError = error
      if (!isTransientRpcError(error) || attempt >= retryDelays.length) {
        throw error
      }
      await sleep(retryDelays[attempt])
    }
  }

  throw lastError || new Error('estimateGas failed')
}

async function attachGasPolicy(request, signer, gasPolicy = buildGasPolicy()) {
  const nextRequest = { ...request }
  if (nextRequest.gasLimit === undefined || nextRequest.gasLimit === null) {
    const estimatedGas = await estimateGasWithRetry(signer, nextRequest, {
      timeoutMs: gasPolicy.estimateTimeoutMs
    })
    nextRequest.gasLimit = applyGasPolicyToEstimate(estimatedGas, gasPolicy)
  } else if (nextRequest.gasLimitPolicy === 'estimate-cap') {
    const explicitLimit = BigInt(nextRequest.gasLimit)
    const requestForEstimate = { ...nextRequest }
    delete requestForEstimate.gasLimit
    delete requestForEstimate.gasLimitPolicy
    try {
      const estimatedGas = await estimateGasWithRetry(signer, requestForEstimate, {
        timeoutMs: gasPolicy.estimateTimeoutMs,
        retryDelaysMs: []
      })
      const estimatedLimit = applyGasPolicyToEstimate(estimatedGas, gasPolicy)
      nextRequest.gasLimit = estimatedLimit < explicitLimit ? estimatedLimit : explicitLimit
      if (gasPolicy.maxGasLimit !== undefined && BigInt(nextRequest.gasLimit) > gasPolicy.maxGasLimit) {
        throw new Error(`estimated gas limit exceeds live gas cap (${nextRequest.gasLimit} > ${gasPolicy.maxGasLimit})`)
      }
    } catch (error) {
      if (!isTransientRpcError(error)) {
        throw error
      }
      if (gasPolicy.maxGasLimit !== undefined && explicitLimit > gasPolicy.maxGasLimit) {
        throw new Error(`estimate-cap fallback blocked: explicit gas limit exceeds live gas cap (${explicitLimit} > ${gasPolicy.maxGasLimit})`)
      }
      nextRequest.gasLimit = explicitLimit
    }
  } else {
    nextRequest.gasLimit = BigInt(nextRequest.gasLimit)
  }
  delete nextRequest.gasLimitPolicy

  if (gasPolicy.legacyGasPrice !== undefined) {
    delete nextRequest.maxFeePerGas
    delete nextRequest.maxPriorityFeePerGas
    nextRequest.gasPrice = gasPolicy.legacyGasPrice
    return nextRequest
  }

  if (gasPolicy.maxFeePerGas !== undefined) {
    delete nextRequest.gasPrice
    nextRequest.maxFeePerGas = gasPolicy.maxFeePerGas
  }

  if (gasPolicy.maxPriorityFeePerGas !== undefined) {
    nextRequest.maxPriorityFeePerGas = gasPolicy.maxPriorityFeePerGas
  }

  return nextRequest
}

module.exports = {
  buildGasPolicy,
  applyGasPolicyToEstimate,
  attachGasPolicy,
  estimateGasWithRetry
}
