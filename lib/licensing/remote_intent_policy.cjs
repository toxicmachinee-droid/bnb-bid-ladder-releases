'use strict'

const { ethers } = require('ethers')

const { getDexConfig } = require('../config/dex_config.cjs')
const {
  erc20Interface,
  permit2AllowanceTransferInterface,
  positionManagerInterface,
  swapRouterInterface,
  swapRouterWithDeadlineInterface,
  swapRouterExactInputInterface,
  swapRouterExactInputWithDeadlineInterface,
  v2RouterInterface
} = require('../protocol/abi.cjs')
const { v4ClPositionManagerInterface } = require('../protocol/v4_abi.cjs')

const wbnbDepositInterface = new ethers.Interface(['function deposit() payable'])
const wbnbWithdrawInterface = new ethers.Interface(['function withdraw(uint256 wad)'])
const routerMulticallInterface = new ethers.Interface([
  'function multicall(bytes[] data) payable returns (bytes[] results)',
  'function unwrapWETH9(uint256 amountMinimum,address recipient) payable'
])
const universalRouterInterface = new ethers.Interface([
  'function execute(bytes commands, bytes[] inputs, uint256 deadline) payable'
])

const ERC20_APPROVE_SELECTOR = erc20Interface.getFunction('approve').selector
const PERMIT2_APPROVE_SELECTOR = permit2AllowanceTransferInterface.getFunction('approve').selector
const V3_MINT_SELECTOR = positionManagerInterface.getFunction('mint').selector
const V3_EXIT_SELECTOR = positionManagerInterface.getFunction('multicall').selector
const V4_MODIFY_LIQUIDITIES_SELECTOR = v4ClPositionManagerInterface.getFunction('modifyLiquidities').selector
const WBNB_DEPOSIT_SELECTOR = wbnbDepositInterface.getFunction('deposit').selector
const WBNB_WITHDRAW_SELECTOR = wbnbWithdrawInterface.getFunction('withdraw').selector
const ROUTER_MULTICALL_SELECTOR = routerMulticallInterface.getFunction('multicall').selector
const UNIVERSAL_ROUTER_EXECUTE_SELECTOR = universalRouterInterface.getFunction('execute').selector
const V3_EXACT_INPUT_SINGLE_SELECTOR = swapRouterInterface.getFunction('exactInputSingle').selector
const V3_EXACT_INPUT_SINGLE_DEADLINE_SELECTOR = swapRouterWithDeadlineInterface.getFunction('exactInputSingle').selector
const V3_EXACT_INPUT_SELECTOR = swapRouterExactInputInterface.getFunction('exactInput').selector
const V3_EXACT_INPUT_DEADLINE_SELECTOR = swapRouterExactInputWithDeadlineInterface.getFunction('exactInput').selector
const V2_TOKEN_TO_TOKEN_SELECTOR = v2RouterInterface.getFunction('swapExactTokensForTokensSupportingFeeOnTransferTokens').selector
const V2_NATIVE_IN_SELECTOR = v2RouterInterface.getFunction('swapExactETHForTokensSupportingFeeOnTransferTokens').selector
const V2_NATIVE_OUT_SELECTOR = v2RouterInterface.getFunction('swapExactTokensForETHSupportingFeeOnTransferTokens').selector

function normalizeSnapshots({ positionSnapshot = null, positionSnapshots = [] } = {}) {
  const snapshots = Array.isArray(positionSnapshots) && positionSnapshots.length
    ? positionSnapshots
    : (positionSnapshot ? [positionSnapshot] : [])
  if (!snapshots.length) {
    throw new Error('position snapshot is required')
  }
  return snapshots
}

function buildCloseClaimSelector(protocolVersion) {
  return String(protocolVersion || 'v3').toLowerCase() === 'v4'
    ? V4_MODIFY_LIQUIDITIES_SELECTOR
    : V3_EXIT_SELECTOR
}

function normalizeApprovalActions(plan = {}) {
  return Array.isArray(plan.approveActions)
    ? plan.approveActions
    : (plan.approveAction ? [plan.approveAction] : [])
}

function approvalSelector(approval = {}) {
  return String(approval.kind || '').toLowerCase() === 'permit2_approve'
    ? PERMIT2_APPROVE_SELECTOR
    : ERC20_APPROVE_SELECTOR
}

function buildApprovalPatternEntry(approval = {}) {
  const target = ethers.getAddress(approval.target || approval.token)
  const spender = ethers.getAddress(approval.spender)
  return {
    to: target,
    selectors: [approvalSelector(approval)],
    maxNativeValueWei: '0',
    allowedApprovalSpenders: [spender]
  }
}

function buildSelectorMapFromPattern(pattern = []) {
  const selectorsByTarget = new Map()
  for (const entry of pattern) {
    const target = ethers.getAddress(entry.to)
    if (!selectorsByTarget.has(target)) {
      selectorsByTarget.set(target, new Set())
    }
    for (const selector of entry.selectors || []) {
      selectorsByTarget.get(target).add(String(selector).toLowerCase())
    }
  }
  return Object.fromEntries([...selectorsByTarget.entries()]
    .map(([target, selectors]) => [target, [...selectors].sort()]))
}

function buildPolicyFromPattern(pattern = []) {
  let maxNativeValueWei = 0n
  let maxTotalNativeValueWei = 0n
  const approvalSpenders = new Set()
  for (const entry of pattern) {
    const nativeValue = BigInt(String(entry.maxNativeValueWei || '0'))
    if (nativeValue > maxNativeValueWei) {
      maxNativeValueWei = nativeValue
    }
    maxTotalNativeValueWei += nativeValue
    for (const spender of entry.allowedApprovalSpenders || []) {
      approvalSpenders.add(ethers.getAddress(spender))
    }
  }
  return {
    maxTxCount: pattern.length,
    allowNativeValue: maxTotalNativeValueWei > 0n,
    maxNativeValueWei: maxNativeValueWei.toString(),
    maxTotalNativeValueWei: maxTotalNativeValueWei.toString(),
    allowedSelectorsByTarget: buildSelectorMapFromPattern(pattern),
    allowedApprovalSpenders: [...approvalSpenders].sort((a, b) => a.localeCompare(b)),
    requestPattern: pattern
  }
}

function buildRemoteOpenPolicyFromExecutionPlan({ executionPlan } = {}) {
  const plan = executionPlan || {}
  if (!plan.positionManager) {
    throw new Error('remote open policy requires positionManager')
  }
  const positionManager = ethers.getAddress(plan.positionManager)
  const protocolVersion = String(plan.protocolVersion || 'v3').toLowerCase()
  const selector = protocolVersion === 'v4'
    ? V4_MODIFY_LIQUIDITIES_SELECTOR
    : (String(plan.mode || '').toLowerCase() === 'spot' ? V3_MINT_SELECTOR : V3_EXIT_SELECTOR)
  const pattern = [
    ...normalizeApprovalActions(plan).map(buildApprovalPatternEntry),
    {
      to: positionManager,
      selectors: [selector],
      maxNativeValueWei: '0'
    }
  ]
  return buildPolicyFromPattern(pattern)
}

function buildSwapSelector(plan = {}) {
  const routeKind = String(plan.routeKind || '').toLowerCase()
  const dex = String(plan.dex || '').toLowerCase()
  if (plan.swapAction?.settlesNativeOut) {
    return [ROUTER_MULTICALL_SELECTOR]
  }
  if (routeKind === 'v4-direct' || dex.includes('v4')) {
    return [UNIVERSAL_ROUTER_EXECUTE_SELECTOR]
  }
  if (routeKind === 'multi-hop') {
    return [dex === 'pancakeswap' ? V3_EXACT_INPUT_DEADLINE_SELECTOR : V3_EXACT_INPUT_SELECTOR]
  }
  if (routeKind === 'v2-direct') {
    if (BigInt(String(plan.swapAction?.value || 0)) > 0n) {
      return [V2_NATIVE_IN_SELECTOR]
    }
    return [V2_TOKEN_TO_TOKEN_SELECTOR, V2_NATIVE_OUT_SELECTOR]
  }
  return [dex === 'pancakeswap' ? V3_EXACT_INPUT_SINGLE_DEADLINE_SELECTOR : V3_EXACT_INPUT_SINGLE_SELECTOR]
}

function buildRemoteSwapPolicyFromExecutionPlan({ executionPlan } = {}) {
  const plan = executionPlan || {}
  if (!plan.swapAction?.router) {
    throw new Error('remote swap policy requires swapAction.router')
  }
  const pattern = []
  if (plan.wrapNativeIn && plan.wrapAction?.token) {
    pattern.push({
      to: ethers.getAddress(plan.wrapAction.token),
      selectors: [WBNB_DEPOSIT_SELECTOR],
      maxNativeValueWei: String(plan.wrapAction.amount || plan.amountIn || '0')
    })
  }

  pattern.push(...normalizeApprovalActions(plan).map(buildApprovalPatternEntry))
  pattern.push({
    to: ethers.getAddress(plan.swapAction.router),
    selectors: buildSwapSelector(plan),
    maxNativeValueWei: String(plan.swapAction.value || '0')
  })

  if (plan.unwrapNativeOut && !plan.swapAction?.settlesNativeOut && plan.unwrapAction?.token) {
    pattern.push({
      to: ethers.getAddress(plan.unwrapAction.token),
      selectors: [plan.unwrapAction.mode === 'router-multicall' ? ROUTER_MULTICALL_SELECTOR : WBNB_WITHDRAW_SELECTOR],
      maxNativeValueWei: '0'
    })
  }

  return buildPolicyFromPattern(pattern)
}

function mergeSelectorMaps(policies = []) {
  const merged = new Map()
  for (const policy of policies) {
    for (const [target, selectors] of Object.entries(policy.allowedSelectorsByTarget || {})) {
      const normalizedTarget = ethers.getAddress(target)
      if (!merged.has(normalizedTarget)) {
        merged.set(normalizedTarget, new Set())
      }
      for (const selector of selectors || []) {
        merged.get(normalizedTarget).add(String(selector).toLowerCase())
      }
    }
  }
  return Object.fromEntries([...merged.entries()]
    .map(([target, selectors]) => [target, [...selectors].sort()]))
}

function buildReusableAllowanceSwapPolicy({ executionPlan, executionPlanWithoutApproval } = {}) {
  const withApprovalPolicy = buildRemoteSwapPolicyFromExecutionPlan({ executionPlan })
  const withoutApprovalPolicy = buildRemoteSwapPolicyFromExecutionPlan({
    executionPlan: executionPlanWithoutApproval || {
      ...(executionPlan || {}),
      approveAction: null,
      approveActions: []
    }
  })
  const policies = [withoutApprovalPolicy, withApprovalPolicy]
  const approvalSpenders = new Set()
  for (const policy of policies) {
    for (const spender of policy.allowedApprovalSpenders || []) {
      approvalSpenders.add(ethers.getAddress(spender))
    }
  }
  const maxNativeValueWei = policies
    .map((policy) => BigInt(String(policy.maxNativeValueWei || '0')))
    .reduce((max, value) => value > max ? value : max, 0n)
  const maxTotalNativeValueWei = policies
    .map((policy) => BigInt(String(policy.maxTotalNativeValueWei || '0')))
    .reduce((max, value) => value > max ? value : max, 0n)
  return {
    maxTxCount: Math.max(...policies.map((policy) => Number(policy.maxTxCount || 0))),
    allowNativeValue: policies.some((policy) => Boolean(policy.allowNativeValue)),
    maxNativeValueWei: maxNativeValueWei.toString(),
    maxTotalNativeValueWei: maxTotalNativeValueWei.toString(),
    allowedSelectorsByTarget: mergeSelectorMaps(policies),
    allowedApprovalSpenders: [...approvalSpenders].sort((a, b) => a.localeCompare(b)),
    requestPattern: withoutApprovalPolicy.requestPattern,
    requestPatterns: policies.map((policy) => policy.requestPattern)
  }
}

function buildRemoteCloseClaimPolicyFromSnapshots({
  action,
  positionSnapshot = null,
  positionSnapshots = []
} = {}) {
  const normalizedAction = String(action || '').toLowerCase()
  if (!['close', 'claim'].includes(normalizedAction)) {
    throw new Error('remote close/claim policy requires close or claim action')
  }
  const snapshots = normalizeSnapshots({ positionSnapshot, positionSnapshots })
  const [firstSnapshot] = snapshots
  const protocolVersion = String(firstSnapshot.protocolVersion || 'v3').toLowerCase()
  const dex = String(firstSnapshot.dex || '').toLowerCase()
  const poolAddress = String(firstSnapshot.poolAddress || '').toLowerCase()
  if (!dex) {
    throw new Error('position snapshot dex is required')
  }
  if (!poolAddress) {
    throw new Error('position snapshot poolAddress is required')
  }

  for (const snapshot of snapshots) {
    if (String(snapshot.dex || '').toLowerCase() !== dex) {
      throw new Error('remote close/claim policy requires one dex family')
    }
    if (String(snapshot.protocolVersion || 'v3').toLowerCase() !== protocolVersion) {
      throw new Error('remote close/claim policy requires one protocol family')
    }
    if (String(snapshot.poolAddress || '').toLowerCase() !== poolAddress) {
      throw new Error('remote close/claim policy requires one pool')
    }
  }

  const dexConfig = getDexConfig(firstSnapshot.dex, protocolVersion)
  const positionManager = ethers.getAddress(dexConfig.positionManager)
  const selector = buildCloseClaimSelector(protocolVersion)

  return {
    maxTxCount: 1,
    allowNativeValue: false,
    maxNativeValueWei: '0',
    maxTotalNativeValueWei: '0',
    allowedSelectorsByTarget: {
      [positionManager]: [selector]
    },
    allowedApprovalSpenders: [],
    requestPattern: [{
      to: positionManager,
      selectors: [selector],
      maxNativeValueWei: '0'
    }]
  }
}

module.exports = {
  buildRemoteCloseClaimPolicyFromSnapshots,
  buildRemoteOpenPolicyFromExecutionPlan,
  buildRemoteSwapPolicyFromExecutionPlan,
  buildReusableAllowanceSwapPolicy
}
