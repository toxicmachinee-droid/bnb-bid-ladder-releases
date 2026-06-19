'use strict'

const { ethers } = require('ethers')

const ERC20_APPROVE_SELECTOR = '0x095ea7b3'
const PERMIT2_APPROVE_SELECTOR = '0x87517c45'

function txRequestSelector(request = {}) {
  const data = String(request.data || '0x').toLowerCase()
  if (data === '0x') return '0x00000000'
  if (!/^0x[0-9a-f]*$/.test(data) || data.length < 10) {
    throw new Error('tx request calldata is malformed')
  }
  return data.slice(0, 10)
}

function decodeTxRequestApprovalSpender(request = {}) {
  const selector = txRequestSelector(request)
  const data = String(request.data || '0x')
  const abiCoder = ethers.AbiCoder.defaultAbiCoder()
  if (selector === ERC20_APPROVE_SELECTOR) {
    const [spender] = abiCoder.decode(['address', 'uint256'], `0x${data.slice(10)}`)
    return ethers.getAddress(spender)
  }
  if (selector === PERMIT2_APPROVE_SELECTOR) {
    const [, spender] = abiCoder.decode(['address', 'address', 'uint160', 'uint48'], `0x${data.slice(10)}`)
    return ethers.getAddress(spender)
  }
  return null
}

function normalizeAddressList(values = []) {
  return (values || [])
    .filter(Boolean)
    .map((item) => ethers.getAddress(item))
}

function buildRemotePlannerTxPolicyFromRequests(txRequests = [], {
  approvalSpenders = [],
  allowNativeValue = false
} = {}) {
  const selectorsByTarget = new Map()
  let maxNativeValueWei = 0n
  let maxTotalNativeValueWei = 0n
  const fallbackApprovalSpenders = normalizeAddressList(approvalSpenders)

  for (const requestItem of txRequests || []) {
    const target = ethers.getAddress(requestItem.to)
    const selector = txRequestSelector(requestItem)
    if (!selectorsByTarget.has(target)) {
      selectorsByTarget.set(target, new Set())
    }
    selectorsByTarget.get(target).add(selector)
    const nativeValue = BigInt(String(requestItem.value ?? '0'))
    if (nativeValue > maxNativeValueWei) {
      maxNativeValueWei = nativeValue
    }
    maxTotalNativeValueWei += nativeValue
  }

  const requestPattern = (txRequests || []).map((requestItem, index) => {
    const target = ethers.getAddress(requestItem.to)
    const selector = txRequestSelector(requestItem)
    const nativeValue = BigInt(String(requestItem.value ?? '0'))
    const approvalSpender = decodeTxRequestApprovalSpender(requestItem)
    return {
      to: target,
      selectors: [selector],
      maxNativeValueWei: nativeValue.toString(),
      ...(approvalSpender
        ? { allowedApprovalSpenders: [approvalSpender] }
        : (fallbackApprovalSpenders[index] ? { allowedApprovalSpenders: [fallbackApprovalSpenders[index]] } : {}))
    }
  })

  return {
    maxTxCount: Array.isArray(txRequests) ? txRequests.length : 0,
    allowNativeValue: Boolean(allowNativeValue),
    maxNativeValueWei: maxNativeValueWei.toString(),
    maxTotalNativeValueWei: maxTotalNativeValueWei.toString(),
    allowedSelectorsByTarget: Object.fromEntries([...selectorsByTarget.entries()]
      .map(([target, selectors]) => [target, [...selectors].sort()])),
    allowedApprovalSpenders: [...new Set(fallbackApprovalSpenders)]
      .sort((a, b) => a.localeCompare(b)),
    requestPattern
  }
}

module.exports = {
  buildRemotePlannerTxPolicyFromRequests,
  decodeTxRequestApprovalSpender,
  txRequestSelector
}
