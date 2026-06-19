'use strict'

const { buildGasPolicy, attachGasPolicy } = require('./gas_policy.cjs')
const { createNonceManager } = require('./nonce_policy.cjs')
const { preflightExecutionPlan } = require('./preflight.cjs')
const { EXECUTION_MODES, normalizeExecutionMode } = require('./modes.cjs')
const { assertLiveExecutionGate } = require('../production/live_gate.cjs')

const FAST_RECEIPT_POLL_INTERVAL_MS = 500
const FAST_RECEIPT_POLL_ATTEMPTS = 24
const RECEIPT_READ_TIMEOUT_MS = 1_200
const TX_WAIT_RECEIPT_TIMEOUT_MS = 15_000

function withTimeout(promise, timeoutMs, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`${label || 'operation'} timed out after ${timeoutMs}ms`)), timeoutMs)
    })
  ])
}

function isTransientExecutionRpcError(error) {
  const message = String(
    error?.shortMessage
      || error?.info?.error?.message
      || error?.error?.message
      || error?.message
      || ''
  ).toLowerCase()

  return [
    'econnreset',
    'socket hang up',
    'timeout',
    'timed out',
    'missing response',
    'network error',
    'failed to fetch',
    'connection closed',
    '503',
    '502',
    '504'
  ].some((needle) => message.includes(needle))
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function readReceiptFromProvider(provider, txHash) {
  if (!provider || !txHash) {
    return null
  }

  try {
    return await withTimeout(
      provider.getTransactionReceipt(txHash),
      RECEIPT_READ_TIMEOUT_MS,
      'transaction receipt read'
    )
  } catch (_) {
    return null
  }
}

async function waitForFastReceipt(tx, context) {
  const primaryReceiptProvider = tx.provider || context.receiptProvider || context.signer?.provider || null
  for (let attempt = 0; attempt < FAST_RECEIPT_POLL_ATTEMPTS; attempt += 1) {
    const directReceipt = await readReceiptFromProvider(primaryReceiptProvider, tx.hash)
    if (directReceipt) {
      return {
        receipt: directReceipt,
        source: 'fast_provider_poll',
        attempts: attempt + 1
      }
    }

    if (typeof context.receiptProviderFactory === 'function') {
      const fallbackProvider = context.receiptProviderFactory()
      try {
        const fallbackReceipt = await readReceiptFromProvider(fallbackProvider, tx.hash)
        if (fallbackReceipt) {
          return {
            receipt: fallbackReceipt,
            source: 'fast_fallback_poll',
            attempts: attempt + 1
          }
        }
      } finally {
        if (fallbackProvider && typeof fallbackProvider.destroy === 'function') {
          try {
            fallbackProvider.destroy()
          } catch (_) {
          }
        }
      }
    }

    await sleep(FAST_RECEIPT_POLL_INTERVAL_MS)
  }

  return null
}

async function waitForReceiptWithRecovery(tx, context) {
  const fastReceipt = await waitForFastReceipt(tx, context)
  if (fastReceipt?.receipt) {
    return fastReceipt
  }

  try {
    return {
      receipt: await withTimeout(
        tx.wait(),
        TX_WAIT_RECEIPT_TIMEOUT_MS,
        'transaction receipt wait'
      ),
      source: 'tx_wait',
      attempts: null
    }
  } catch (error) {
    if (!isTransientExecutionRpcError(error)) {
      throw error
    }

    for (let attempt = 0; attempt < 12; attempt += 1) {
      const directReceipt = await readReceiptFromProvider(tx.provider || context.receiptProvider || context.signer?.provider, tx.hash)
      if (directReceipt) {
        return {
          receipt: directReceipt,
          source: 'recovery_provider_poll',
          attempts: attempt + 1
        }
      }

      if (typeof context.receiptProviderFactory === 'function') {
        const fallbackProvider = context.receiptProviderFactory()
        try {
          const fallbackReceipt = await readReceiptFromProvider(fallbackProvider, tx.hash)
          if (fallbackReceipt) {
            return {
              receipt: fallbackReceipt,
              source: 'recovery_fallback_poll',
              attempts: attempt + 1
            }
          }
        } finally {
          if (fallbackProvider && typeof fallbackProvider.destroy === 'function') {
            try {
              fallbackProvider.destroy()
            } catch (_) {
            }
          }
        }
      }

      await sleep(2500)
    }

    throw error
  }
}

async function sendTransactionWithRecovery(context, preparedRequest) {
  const maxAttempts = context.mode === EXECUTION_MODES.LIVE ? 3 : 1
  let lastError = null

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await context.signer.sendTransaction(preparedRequest)
    } catch (error) {
      lastError = error
      if (attempt >= maxAttempts || !isTransientExecutionRpcError(error)) {
        throw new Error(`send transaction failed for ${String(preparedRequest.to || 'unknown-target')} (attempt ${attempt}/${maxAttempts}): ${error.message}`)
      }
      await sleep(800 * attempt)
    }
  }

  throw lastError
}

async function executeTransactionRequest(context, request) {
  const startedAtMs = Date.now()
  const nonceManager = context.nonceManager || createNonceManager(context.signer)
  const gasPolicy = context.gasPolicy || buildGasPolicy()
  const preparedRequest = await attachGasPolicy(request, context.signer, gasPolicy)
  preparedRequest.nonce = Number(await nonceManager.allocate())
  const preparedAtMs = Date.now()

  if (context.mode === EXECUTION_MODES.DRY_RUN) {
    return {
      mode: context.mode,
      sent: false,
      request: preparedRequest
    }
  }

  const tx = await sendTransactionWithRecovery(context, preparedRequest)
  const reliableSendTiming = tx?.__reliableSendTiming || null
  const submittedAtMs = Date.now()
  let receiptResult
  try {
    receiptResult = await waitForReceiptWithRecovery(tx, context)
  } catch (error) {
    throw new Error(`wait for receipt failed for ${tx.hash}: ${error.message}`)
  }
  const receiptAtMs = Date.now()

  return {
    mode: context.mode,
    sent: true,
    hash: tx.hash,
    receipt: receiptResult.receipt,
    request: preparedRequest,
    timing: {
      prepareMs: preparedAtMs - startedAtMs,
      submitMs: submittedAtMs - preparedAtMs,
      receiptWaitMs: receiptAtMs - submittedAtMs,
      totalMs: receiptAtMs - startedAtMs,
      receiptSource: receiptResult.source || null,
      receiptAttempts: receiptResult.attempts ?? null,
      reliableSendTiming
    }
  }
}

async function executePlan(context, requests) {
  const normalizedMode = normalizeExecutionMode(context.mode)
  const nextContext = {
    ...context,
    mode: normalizedMode,
    nonceManager: context.nonceManager || createNonceManager(context.signer)
  }

  if (normalizedMode === EXECUTION_MODES.LIVE) {
    nextContext.liveGate = assertLiveExecutionGate({
      mode: normalizedMode,
      env: nextContext.env,
      validations: nextContext.validations,
      workflow: nextContext.workflow,
      actions: nextContext.actions,
      recoveryActions: nextContext.recoveryActions,
      signerMetadata: nextContext.signerMetadata,
      canaryLimits: nextContext.canaryLimits,
      executionIntent: nextContext.executionIntent,
      livePermit: nextContext.livePermit,
      now: nextContext.liveGateNow
    })
  }

  const preflight = await preflightExecutionPlan({
    signer: nextContext.signer,
    requests
  })

  if (!preflight.ok) {
    return {
      mode: normalizedMode,
      ok: false,
      preflight,
      executions: []
    }
  }

  const executions = []

  for (const request of requests) {
    executions.push(await executeTransactionRequest(nextContext, request))
  }

  return {
    mode: normalizedMode,
    ok: true,
    preflight,
    executions
  }
}

module.exports = {
  executeTransactionRequest,
  executePlan
}
