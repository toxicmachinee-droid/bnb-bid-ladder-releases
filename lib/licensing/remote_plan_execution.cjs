'use strict'

const { ethers } = require('ethers')

const { executePlan } = require('../execution/runner.cjs')
const { assertRemotePlanExecutable } = require('./remote_plan.cjs')

function normalizeComparableTxRequest(request = {}) {
  return {
    to: ethers.getAddress(request.to),
    data: String(request.data || '0x').toLowerCase(),
    value: String(request.value ?? '0'),
    gasLimit: String(request.gasLimit ?? '')
  }
}

function assertTxRequestsMatch(actualRequests = [], expectedRequests = []) {
  if (!Array.isArray(expectedRequests) || expectedRequests.length === 0) {
    return { ok: true }
  }
  if (!Array.isArray(actualRequests) || actualRequests.length !== expectedRequests.length) {
    throw new Error(`remote plan request mismatch: expected ${expectedRequests.length}, got ${Array.isArray(actualRequests) ? actualRequests.length : 0}`)
  }
  for (let index = 0; index < expectedRequests.length; index += 1) {
    const actual = normalizeComparableTxRequest(actualRequests[index])
    const expected = normalizeComparableTxRequest(expectedRequests[index])
    if (actual.to !== expected.to ||
      actual.data !== expected.data ||
      actual.value !== expected.value ||
      actual.gasLimit !== expected.gasLimit) {
      throw new Error(`remote plan request mismatch at index ${index}`)
    }
  }
  return { ok: true }
}

async function resolveSignerAddress(signer) {
  if (!signer || typeof signer.getAddress !== 'function') {
    return null
  }
  return ethers.getAddress(await signer.getAddress())
}

async function executeVerifiedRemotePlan({
  plan,
  publicKeyPem,
  walletAddress,
  chainId = 56,
  allowedTargets = [],
  txPolicy = null,
  expectedTxRequests = [],
  now = new Date(),
  context,
  executePlanImpl = executePlan
} = {}) {
  if (!context || !context.signer) {
    throw new Error('remote plan execution requires a local signer context')
  }
  const normalizedWallet = ethers.getAddress(walletAddress || plan?.walletAddress)
  const signerAddress = await resolveSignerAddress(context.signer)
  if (signerAddress && signerAddress !== normalizedWallet) {
    throw new Error('remote plan signer mismatch')
  }
  const verification = assertRemotePlanExecutable(plan, {
    publicKeyPem,
    walletAddress: normalizedWallet,
    chainId,
    allowedTargets,
    txPolicy,
    now
  })
  assertTxRequestsMatch(plan.txRequests, expectedTxRequests)
  const result = await executePlanImpl({
    ...context,
    executionIntent: {
      ...(context.executionIntent || {}),
      remotePlanId: plan.planId || null,
      remotePlanHash: verification.planHash,
      remotePlanAction: plan.action || null
    }
  }, plan.txRequests)
  return {
    ok: Boolean(result?.ok),
    remotePlan: {
      planId: plan.planId || null,
      action: plan.action || null,
      planHash: verification.planHash,
      expiresAt: plan.expiresAt || null
    },
    executionResult: result
  }
}

module.exports = {
  executeVerifiedRemotePlan,
  assertTxRequestsMatch,
  normalizeComparableTxRequest
}
