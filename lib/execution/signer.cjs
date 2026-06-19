'use strict'

const { ethers } = require('ethers')
const { normalizeExecutionMode, assertLiveExecutionAllowed } = require('./modes.cjs')
const { assertLiveExecutionGate } = require('../production/live_gate.cjs')
const { createKeystoreSigner: createManagedKeystoreSigner } = require('../security/keystore.cjs')

function createWalletSigner({ privateKey, provider }) {
  if (!privateKey) {
    throw new Error('privateKey is required to create wallet signer')
  }

  const signer = new ethers.Wallet(privateKey, provider)
  signer.__signerSource = 'raw-private-key'
  return signer
}

function createKeystoreSigner({
  keystoreDir,
  walletId,
  password,
  provider,
  sessionTtlMs
}) {
  return createManagedKeystoreSigner({
    keystoreDir,
    walletId,
    password,
    provider,
    sessionTtlMs
  })
}

function getSignerMetadata(signer) {
  return {
    source: signer?.__signerSource || 'unknown',
    keystoreWalletId: signer?.__keystoreWalletId || null,
    keystoreAddress: signer?.__keystoreAddress || null,
    unlockExpiresAt: signer?.__unlockExpiresAt || null,
    sessionBound: signer?.__keystoreSessionBound === true,
    sessionOrigin: signer?.__keystoreSessionOrigin || null
  }
}

async function createExecutionContext({
  provider,
  signer,
  mode,
  approved = false,
  validationPassed = false,
  gasPolicy,
  nonceManager,
  env,
  validations,
  workflow,
  actions,
  recoveryActions,
  livePermit,
  liveGateNow,
  signerMetadata,
  canaryLimits,
  executionIntent
}) {
  const normalizedMode = normalizeExecutionMode(mode)
  assertLiveExecutionAllowed({
    mode: normalizedMode,
    approved,
    validationPassed
  })
  const address = signer ? await signer.getAddress() : null
  const resolvedSignerMetadata = {
    ...getSignerMetadata(signer),
    ...(signerMetadata || {})
  }
  const liveGate = assertLiveExecutionGate({
    mode: normalizedMode,
    env,
    validations,
    workflow,
    actions,
    recoveryActions,
    livePermit,
    canaryLimits,
    executionIntent,
    signerMetadata: {
      ...resolvedSignerMetadata,
      expectedWalletAddress: env?.BOT_WALLET_ADDRESS || null,
      actualWalletAddress: address,
      expectedKeystoreWalletId: env?.BOT_KEYSTORE_WALLET_ID || null,
      actualKeystoreWalletId: resolvedSignerMetadata.keystoreWalletId || null
    },
    now: liveGateNow
  })

  return {
    provider,
    signer,
    signerMetadata: resolvedSignerMetadata,
    mode: normalizedMode,
    approved,
    validationPassed,
    gasPolicy,
    nonceManager,
    address,
    env,
    validations,
    workflow,
    actions,
    recoveryActions,
    livePermit,
    canaryLimits,
    executionIntent,
    liveGate,
    liveGateNow
  }
}

module.exports = {
  createWalletSigner,
  createKeystoreSigner,
  getSignerMetadata,
  createExecutionContext
}
