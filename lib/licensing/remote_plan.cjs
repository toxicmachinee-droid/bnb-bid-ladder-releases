'use strict'

const crypto = require('crypto')
const { ethers } = require('ethers')

const ERC20_APPROVE_SELECTOR = '0x095ea7b3'
const PERMIT2_APPROVE_SELECTOR = '0x87517c45'
const abiCoder = ethers.AbiCoder.defaultAbiCoder()

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item))
  }
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((acc, key) => {
      const entry = value[key]
      if (entry !== undefined) {
        acc[key] = canonicalize(entry)
      }
      return acc
    }, {})
  }
  if (typeof value === 'bigint') {
    return value.toString()
  }
  return value
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value))
}

function normalizeTxRequest(request = {}) {
  return {
    to: ethers.getAddress(request.to),
    data: String(request.data || '0x'),
    value: String(request.value ?? '0'),
    gasLimit: String(request.gasLimit ?? ''),
    ...(request.gasPrice != null ? { gasPrice: String(request.gasPrice) } : {}),
    ...(request.maxFeePerGas != null ? { maxFeePerGas: String(request.maxFeePerGas) } : {}),
    ...(request.maxPriorityFeePerGas != null ? { maxPriorityFeePerGas: String(request.maxPriorityFeePerGas) } : {})
  }
}

function unsignedPlanPayload(plan = {}) {
  const { planHash, serverSignature, ...payload } = plan
  void planHash
  void serverSignature
  return {
    ...payload,
    walletAddress: ethers.getAddress(payload.walletAddress),
    chainId: Number(payload.chainId),
    txRequests: (payload.txRequests || []).map(normalizeTxRequest)
  }
}

function computeRemotePlanHash(plan) {
  return crypto.createHash('sha256').update(canonicalJson(unsignedPlanPayload(plan))).digest('hex')
}

function generateServerSigningKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
  return {
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' })
  }
}

function getRemotePlanSignatureAlgorithm(keyPem, kind) {
  const keyObject = kind === 'private'
    ? crypto.createPrivateKey(keyPem)
    : crypto.createPublicKey(keyPem)
  const keyType = String(keyObject.asymmetricKeyType || '').toLowerCase()
  return keyType === 'ed25519' || keyType === 'ed448' ? null : 'sha256'
}

function signRemoteTxPlan(plan, privateKeyPem) {
  if (!privateKeyPem) {
    throw new Error('server signing private key is required')
  }
  const normalized = unsignedPlanPayload(plan)
  const planHash = computeRemotePlanHash(normalized)
  const signature = crypto.sign(
    getRemotePlanSignatureAlgorithm(privateKeyPem, 'private'),
    Buffer.from(planHash, 'utf8'),
    privateKeyPem
  ).toString('base64url')
  return {
    ...normalized,
    planHash,
    serverSignature: signature
  }
}

function verifyRemoteTxPlan(plan, publicKeyPem) {
  if (!publicKeyPem) {
    return { ok: false, error: 'server signing public key is required' }
  }
  try {
    const expectedHash = computeRemotePlanHash(plan)
    if (String(plan?.planHash || '') !== expectedHash) {
      return { ok: false, error: 'remote plan hash mismatch' }
    }
    const ok = crypto.verify(
      getRemotePlanSignatureAlgorithm(publicKeyPem, 'public'),
      Buffer.from(expectedHash, 'utf8'),
      publicKeyPem,
      Buffer.from(String(plan.serverSignature || ''), 'base64url')
    )
    return ok ? { ok: true, planHash: expectedHash } : { ok: false, error: 'remote plan signature mismatch' }
  } catch (error) {
    return { ok: false, error: error.message }
  }
}

function normalizeSelector(value) {
  const selector = String(value || '').toLowerCase()
  if (!/^0x[0-9a-f]{8}$/.test(selector)) {
    throw new Error(`invalid remote plan selector policy: ${value}`)
  }
  return selector
}

function normalizeAddressSet(values = []) {
  return new Set((values || []).map((item) => ethers.getAddress(item).toLowerCase()))
}

function normalizeSelectorPolicy(policy = {}) {
  const byTarget = new Map()
  for (const [target, selectors] of Object.entries(policy.allowedSelectorsByTarget || {})) {
    byTarget.set(
      ethers.getAddress(target).toLowerCase(),
      new Set((selectors || []).map(normalizeSelector))
    )
  }
  const normalizePattern = (pattern = []) => pattern.map((entry) => ({
    ...(entry.to ? { to: ethers.getAddress(entry.to).toLowerCase() } : {}),
    selectors: new Set((entry.selectors || entry.allowedSelectors || []).map(normalizeSelector)),
    maxNativeValueWei: entry.maxNativeValueWei == null ? null : BigInt(String(entry.maxNativeValueWei)),
    allowedApprovalSpenders: normalizeAddressSet(entry.allowedApprovalSpenders || [])
  }))
  const requestPattern = Array.isArray(policy.requestPattern)
    ? normalizePattern(policy.requestPattern)
    : null
  const requestPatterns = Array.isArray(policy.requestPatterns)
    ? policy.requestPatterns.map((pattern) => normalizePattern(pattern))
    : (requestPattern ? [requestPattern] : null)
  return {
    maxTxCount: policy.maxTxCount == null ? null : Number(policy.maxTxCount),
    allowNativeValue: Boolean(policy.allowNativeValue),
    maxNativeValueWei: policy.maxNativeValueWei == null ? null : BigInt(String(policy.maxNativeValueWei)),
    maxTotalNativeValueWei: policy.maxTotalNativeValueWei == null ? null : BigInt(String(policy.maxTotalNativeValueWei)),
    allowedSelectors: new Set((policy.allowedSelectors || []).map(normalizeSelector)),
    allowedSelectorsByTarget: byTarget,
    allowedApprovalSpenders: normalizeAddressSet(policy.allowedApprovalSpenders || []),
    requestPattern,
    requestPatterns
  }
}

function requestSelector(request = {}) {
  const data = String(request.data || '0x').toLowerCase()
  if (data === '0x') return '0x00000000'
  if (!/^0x[0-9a-f]*$/.test(data) || data.length < 10) {
    throw new Error('remote plan calldata is malformed')
  }
  return data.slice(0, 10)
}

function decodeApprovalSpender(request = {}, selector) {
  const data = String(request.data || '0x')
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

function requestMatchesPattern(request = {}, pattern = null) {
  if (!pattern) {
    return true
  }
  const target = ethers.getAddress(request.to).toLowerCase()
  if (pattern.to && target !== pattern.to) {
    return false
  }
  const selector = requestSelector(request)
  if (pattern.selectors?.size && !pattern.selectors.has(selector)) {
    return false
  }
  const value = BigInt(String(request.value ?? '0'))
  if (pattern.maxNativeValueWei != null && value > pattern.maxNativeValueWei) {
    return false
  }
  const approvalSpender = decodeApprovalSpender(request, selector)
  if (approvalSpender && pattern.allowedApprovalSpenders?.size && !pattern.allowedApprovalSpenders.has(approvalSpender.toLowerCase())) {
    return false
  }
  return true
}

function selectRequestPattern(policy, requests = []) {
  if (!policy.requestPatterns) {
    return null
  }
  for (const pattern of policy.requestPatterns) {
    if (!Array.isArray(pattern) || pattern.length !== requests.length) {
      continue
    }
    if (requests.every((request, index) => requestMatchesPattern(request, pattern[index]))) {
      return pattern
    }
  }
  return undefined
}

function assertRemotePlanPolicy(plan = {}, txPolicy = null) {
  if (!txPolicy) {
    return { ok: true }
  }
  const policy = normalizeSelectorPolicy(txPolicy)
  const requests = Array.isArray(plan.txRequests) ? plan.txRequests : []
  if (policy.maxTxCount != null && requests.length > policy.maxTxCount) {
    throw new Error(`remote plan has too many tx requests: ${requests.length}`)
  }
  let selectedRequestPattern = selectRequestPattern(policy, requests)
  if (selectedRequestPattern === undefined) {
    const expectedLengths = [...new Set(policy.requestPatterns.map((pattern) => pattern.length))].sort((a, b) => a - b)
    const sameLengthPatterns = policy.requestPatterns.filter((pattern) => pattern.length === requests.length)
    if (sameLengthPatterns.length === 1) {
      selectedRequestPattern = sameLengthPatterns[0]
    } else if (expectedLengths.length === 1) {
      throw new Error(`remote plan request sequence length mismatch: expected ${expectedLengths[0]}, got ${requests.length}`)
    } else {
      throw new Error(`remote plan request sequence does not match any allowed pattern: expected ${expectedLengths.join(' or ')}, got ${requests.length}`)
    }
  }
  let totalNativeValue = 0n
  for (let index = 0; index < requests.length; index += 1) {
    const request = requests[index]
    const pattern = selectedRequestPattern?.[index] || null
    const target = ethers.getAddress(request.to).toLowerCase()
    const value = BigInt(String(request.value ?? '0'))
    totalNativeValue += value
    if (!policy.allowNativeValue && value > 0n) {
      throw new Error('remote plan native value is not allowed')
    }
    if (policy.maxNativeValueWei != null && value > policy.maxNativeValueWei) {
      throw new Error('remote plan native value exceeds policy')
    }
    if (pattern?.maxNativeValueWei != null && value > pattern.maxNativeValueWei) {
      throw new Error(`remote plan request ${index} native value exceeds policy`)
    }
    const selector = requestSelector(request)
    if (pattern?.to && target !== pattern.to) {
      throw new Error(`remote plan request ${index} sequence target mismatch`)
    }
    const targetSelectors = policy.allowedSelectorsByTarget.get(target)
    const selectorAllowed = pattern?.selectors?.size
      ? pattern.selectors.has(selector)
      : ((targetSelectors && targetSelectors.has(selector)) || policy.allowedSelectors.has(selector))
    if (!selectorAllowed) {
      throw new Error(`remote plan selector not allowed: ${selector}`)
    }
    const approvalSpender = decodeApprovalSpender(request, selector)
    const allowedApprovalSpenders = pattern?.allowedApprovalSpenders?.size
      ? pattern.allowedApprovalSpenders
      : policy.allowedApprovalSpenders
    if (approvalSpender && allowedApprovalSpenders.size > 0 && !allowedApprovalSpenders.has(approvalSpender.toLowerCase())) {
      throw new Error(`remote plan approval spender not allowed: ${approvalSpender}`)
    }
  }
  if (policy.maxTotalNativeValueWei != null && totalNativeValue > policy.maxTotalNativeValueWei) {
    throw new Error('remote plan native value total exceeds policy')
  }
  return { ok: true }
}

function assertRemotePlanExecutable(plan, {
  publicKeyPem,
  walletAddress,
  chainId = 56,
  allowedTargets = [],
  txPolicy = null,
  expectedAction = null,
  now = new Date(),
  maxFutureIssuedAtSkewMs = 30_000,
  maxPlanTtlMs = 5 * 60 * 1000
} = {}) {
  const verified = verifyRemoteTxPlan(plan, publicKeyPem)
  if (!verified.ok) {
    throw new Error(verified.error)
  }
  if (expectedAction && String(plan.action || '').toLowerCase() !== String(expectedAction || '').toLowerCase()) {
    throw new Error('remote plan action mismatch')
  }
  if (ethers.getAddress(plan.walletAddress) !== ethers.getAddress(walletAddress)) {
    throw new Error('remote plan wallet mismatch')
  }
  if (Number(plan.chainId) !== Number(chainId)) {
    throw new Error('remote plan chain mismatch')
  }
  const nowMs = new Date(now).getTime()
  const issuedAtMs = new Date(plan.issuedAt).getTime()
  const expiresAtMs = new Date(plan.expiresAt).getTime()
  if (!Number.isFinite(issuedAtMs) || !Number.isFinite(expiresAtMs)) {
    throw new Error('remote plan time bounds are invalid')
  }
  if (issuedAtMs - nowMs > Number(maxFutureIssuedAtSkewMs || 0)) {
    throw new Error('remote plan was issued in the future')
  }
  if (expiresAtMs <= nowMs) {
    throw new Error('remote plan expired')
  }
  if (expiresAtMs <= issuedAtMs) {
    throw new Error('remote plan expiry is not after issue time')
  }
  if (Number(maxPlanTtlMs || 0) > 0 && expiresAtMs - issuedAtMs > Number(maxPlanTtlMs)) {
    throw new Error('remote plan ttl exceeds policy')
  }
  if (!Array.isArray(plan.txRequests) || plan.txRequests.length === 0) {
    throw new Error('remote plan has no transaction requests')
  }
  const allowed = new Set((allowedTargets || []).map((item) => ethers.getAddress(item).toLowerCase()))
  for (const request of plan.txRequests || []) {
    const target = ethers.getAddress(request.to).toLowerCase()
    if (allowed.size > 0 && !allowed.has(target)) {
      throw new Error(`remote plan target not allowed: ${request.to}`)
    }
  }
  assertRemotePlanPolicy(plan, txPolicy)
  return { ok: true, planHash: verified.planHash }
}

module.exports = {
  canonicalJson,
  computeRemotePlanHash,
  generateServerSigningKeyPair,
  signRemoteTxPlan,
  verifyRemoteTxPlan,
  assertRemotePlanExecutable,
  assertRemotePlanPolicy
}
