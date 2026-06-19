'use strict'

const { ethers } = require('ethers')

function assertMintPlanSafety(plan) {
  if (!plan?.positionManager) {
    throw new Error('mint plan positionManager is required')
  }

  if (!plan?.depositTokenAddress && !Array.isArray(plan?.depositTokenAddresses)) {
    throw new Error('mint plan depositTokenAddress is required')
  }

  if (!Array.isArray(plan.approveActions) || plan.approveActions.length < 1) {
    throw new Error('mint plan must contain at least one approve action')
  }

  for (const approval of plan.approveActions) {
    const approvedToken = String(approval.token || '').toLowerCase()
    const allowedTokens = Array.isArray(plan.depositTokenAddresses) && plan.depositTokenAddresses.length
      ? plan.depositTokenAddresses.map((token) => String(token || '').toLowerCase())
      : [String(plan.depositTokenAddress || '').toLowerCase()]
    if (!allowedTokens.includes(approvedToken)) {
      throw new Error('approve token must match mint plan deposit token')
    }

    const minimumAmount = BigInt(approval.minimumAmount || 0)
    if (BigInt(approval.amount || 0) < minimumAmount) {
      throw new Error('approve amount must satisfy mint plan minimum deposit coverage')
    }

    if (!approval?.calldata) {
      throw new Error('approve calldata is required')
    }

    if (!approval?.target && !approval?.token) {
      throw new Error('approve target is required')
    }
  }

  if (BigInt(plan.totalDepositAmount || 0) <= 0n) {
    throw new Error('mint plan total deposit amount must be positive')
  }

  return {
    ok: true,
    approval: plan.approveActions[plan.approveActions.length - 1]
  }
}

function assertExecutionRecipientMatchesSigner(plan, signerAddress) {
  const planRecipient = String(plan?.recipient || '')
  const executionSigner = String(signerAddress || '')

  if (!planRecipient || !executionSigner) {
    throw new Error('execution recipient and signer address are required')
  }

  if (ethers.getAddress(planRecipient) !== ethers.getAddress(executionSigner)) {
    throw new Error(`execution recipient mismatch: expected signer ${executionSigner}, got plan recipient ${planRecipient}`)
  }

  return {
    ok: true,
    recipient: ethers.getAddress(planRecipient)
  }
}

module.exports = {
  assertMintPlanSafety,
  assertExecutionRecipientMatchesSigner
}
