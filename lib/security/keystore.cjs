'use strict'

const crypto = require('crypto')
const fs = require('fs')
const http = require('http')
const https = require('https')
const os = require('os')
const path = require('path')
const { ethers } = require('ethers')
const { ensureDirectory, readJsonFile, writeJsonFile } = require('../state/storage.cjs')
const { createAlchemyHttpsProxyAgent, installEthersAlchemyProxySupport } = require('../net/alchemy_proxy.cjs')
installEthersAlchemyProxySupport(ethers)
const ALCHEMY_HTTPS_PROXY_AGENT = createAlchemyHttpsProxyAgent()

const DEFAULT_KEYSTORE_DIR = path.join(os.homedir(), '.bnb-v3-bid-ladder', 'keystore')
const KEYSTORE_INDEX_FILE = 'wallets.json'
const KEYSTORE_VERSION = 1
const KEYSTORE_ALGORITHM = 'aes-256-gcm'
const KDF_NAME = 'scrypt'
const SCRYPT_PARAMS = Object.freeze({
  N: 1 << 15,
  r: 8,
  p: 1,
  maxmem: 128 * 1024 * 1024
})
const SALT_BYTES = 16
const IV_BYTES = 12
const KEY_BYTES = 32
const RELIABLE_SEND_RETRY_LIMIT = 3
const RELIABLE_SEND_RETRY_DELAYS_MS = [400, 900]
const POPULATE_RETRY_DELAYS_MS = [250, 700]
const RELIABLE_SEND_RPC_TIMEOUT_MS = 3_000
const RELIABLE_SEND_FAST_NONCE_TIMEOUT_MS = 900
const RELIABLE_SEND_NONCE_TIMEOUT_MS = 6_000

function nowIso() {
  return new Date().toISOString()
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function withLocalTimeout(promise, timeoutMs, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`${label || 'rpc call'} timed out after ${timeoutMs}ms`)), timeoutMs)
    })
  ])
}

function getProviderRpcUrl(provider) {
  if (!provider) {
    return null
  }
  if (provider.__rpcUrl) {
    return String(provider.__rpcUrl)
  }
  try {
    const connection = typeof provider._getConnection === 'function' ? provider._getConnection() : null
    return connection?.url ? String(connection.url) : null
  } catch (_) {
    return null
  }
}

async function readRawJsonRpc(url, method, params, timeoutMs, label) {
  const timeout = Math.max(1, Number(timeoutMs || RELIABLE_SEND_RPC_TIMEOUT_MS))
  const requestBody = JSON.stringify({
    jsonrpc: '2.0',
    id: Date.now(),
    method,
    params
  })

  const payload = await new Promise((resolve, reject) => {
    let settled = false
    const target = new URL(String(url || ''))
    const transport = target.protocol === 'http:' ? http : https
    const req = transport.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || undefined,
      path: `${target.pathname || '/'}${target.search || ''}`,
      method: 'POST',
      agent: target.protocol === 'https:' ? (ALCHEMY_HTTPS_PROXY_AGENT || undefined) : undefined,
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(requestBody)
      },
      timeout
    }, (response) => {
      const chunks = []
      response.on('data', (chunk) => chunks.push(chunk))
      response.on('end', () => {
        if (settled) {
          return
        }
        settled = true
        const text = Buffer.concat(chunks).toString('utf8')
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`${label || method} http ${response.statusCode}`))
          return
        }
        try {
          resolve(JSON.parse(text))
        } catch (error) {
          reject(new Error(`${label || method} returned invalid json: ${error.message}`))
        }
      })
    })

    req.on('timeout', () => {
      if (!settled) {
        settled = true
        const timeoutError = new Error(`${label || method} timed out after ${timeout}ms`)
        reject(timeoutError)
        req.destroy(timeoutError)
      }
    })
    req.on('error', (error) => {
      if (!settled) {
        settled = true
        reject(error)
      }
    })
    req.end(requestBody)
  })

  if (payload?.error) {
    throw new Error(`${label || method} rpc error: ${payload.error.message || payload.error.code || 'unknown'}`)
  }
  return payload?.result
}

function isTransientBroadcastError(error) {
  const message = String(error?.message || error || '').toLowerCase()
  return (
    message.includes('econnreset')
    || message.includes('socket hang up')
    || message.includes('timeout')
    || message.includes('timed out')
    || message.includes('network error')
    || message.includes('missing response')
    || message.includes('failed to fetch')
    || message.includes('connection closed')
  )
}

function isKnownBroadcastError(error) {
  const message = String(error?.message || error || '').toLowerCase()
  return (
    message.includes('already known')
    || message.includes('known transaction')
    || message.includes('nonce too low')
    || message.includes('replacement transaction underpriced')
  )
}

function buildBroadcastFallbackResponse(provider, rawTx, txHash) {
  const parsed = ethers.Transaction.from(rawTx)
  return {
    hash: txHash,
    nonce: parsed.nonce,
    from: parsed.from,
    to: parsed.to,
    data: parsed.data,
    value: parsed.value,
    wait: async (confirms = 1) => provider.waitForTransaction(txHash, confirms)
  }
}

function attachReliableSendTiming(response, timing) {
  if (!response || !timing) {
    return response
  }

  try {
    Object.defineProperty(response, '__reliableSendTiming', {
      value: timing,
      enumerable: false,
      configurable: true
    })
  } catch (_) {
    response.__reliableSendTiming = timing
  }

  return response
}

async function findBroadcastedTransaction(provider, txHash, rawTx, {
  attempts = 6,
  timeoutMs = RELIABLE_SEND_RPC_TIMEOUT_MS,
  delayMs = 350
} = {}) {
  const maxAttempts = Math.max(1, Number(attempts || 1))
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const [existing, receipt] = await Promise.all([
      withLocalTimeout(
        provider.getTransaction(txHash),
        timeoutMs,
        'lookup broadcasted transaction'
      ).catch(() => null),
      withLocalTimeout(
        provider.getTransactionReceipt(txHash),
        timeoutMs,
        'lookup broadcasted transaction receipt'
      ).catch(() => null)
    ])
    if (existing) {
      return existing
    }
    if (receipt) {
      return buildBroadcastFallbackResponse(provider, rawTx, txHash)
    }

    if (attempt < maxAttempts - 1) {
      await sleep(delayMs)
    }
  }

  return null
}

async function populateTransactionWithRetry(signer, txRequest) {
  let lastError = null

  for (let attempt = 0; attempt <= POPULATE_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await signer.populateTransaction(txRequest)
    } catch (error) {
      lastError = error
      if (!isTransientBroadcastError(error) || attempt >= POPULATE_RETRY_DELAYS_MS.length) {
        throw error
      }
      await sleep(POPULATE_RETRY_DELAYS_MS[attempt])
    }
  }

  throw lastError || new Error('populateTransaction failed')
}

function canFastPopulateTransaction(txRequest = {}) {
  return Boolean(
    txRequest
    && txRequest.to
    && txRequest.gasLimit !== undefined
    && txRequest.gasLimit !== null
    && (
      txRequest.gasPrice !== undefined
      || txRequest.maxFeePerGas !== undefined
      || txRequest.maxPriorityFeePerGas !== undefined
    )
  )
}

async function fastPopulatePreparedTransaction(signer, txRequest) {
  const from = await signer.getAddress()
  const rpcUrl = getProviderRpcUrl(signer.provider)
  const readNonceByTag = async (blockTag, timeoutMs = RELIABLE_SEND_NONCE_TIMEOUT_MS) => {
    const reads = []
    if (rpcUrl) {
      reads.push(
        readRawJsonRpc(
          rpcUrl,
          'eth_getTransactionCount',
          [from, blockTag],
          timeoutMs,
          `nonce ${blockTag} raw`
        )
      )
    }
    if (typeof signer.provider?.send === 'function') {
      reads.push(withLocalTimeout(
        signer.provider.send('eth_getTransactionCount', [from, blockTag]),
        timeoutMs,
        `nonce ${blockTag} provider send`
      ))
    }
    if (typeof signer.provider?.getTransactionCount === 'function') {
      reads.push(withLocalTimeout(
        signer.provider.getTransactionCount(from, blockTag),
        timeoutMs,
        `nonce ${blockTag} provider read`
      ))
    }
    if (!reads.length) {
      throw new Error(`nonce ${blockTag} read path unavailable`)
    }

    const raw = await Promise.any(reads).catch((error) => {
      const first = error?.errors?.[0] || error
      throw first
    })
    if (typeof raw === 'number') {
      return raw
    }
    if (typeof raw === 'bigint') {
      return Number(raw)
    }
    if (raw !== null && raw !== undefined) {
      return Number(BigInt(raw || 0))
    }
    throw new Error(`nonce ${blockTag} returned empty result`)
  }
  const readFastNonce = async () => {
    const [latestNonce, pendingNonce] = await Promise.allSettled([
      readNonceByTag('latest', RELIABLE_SEND_FAST_NONCE_TIMEOUT_MS),
      readNonceByTag('pending', RELIABLE_SEND_FAST_NONCE_TIMEOUT_MS)
    ])

    if (latestNonce.status === 'fulfilled' && pendingNonce.status === 'fulfilled') {
      return Math.max(latestNonce.value, pendingNonce.value)
    }
    if (pendingNonce.status === 'fulfilled') {
      return pendingNonce.value
    }
    if (latestNonce.status === 'fulfilled') {
      return latestNonce.value
    }
    return null
  }
  const readPendingNonce = async () => {
    const fastNonce = await readFastNonce()
    if (fastNonce !== null) {
      return fastNonce
    }

    let lastError = null
    const tags = ['pending', 'latest']
    for (let attempt = 0; attempt < tags.length; attempt += 1) {
      try {
        return await readNonceByTag(tags[attempt])
      } catch (error) {
        lastError = error
        if (!isTransientBroadcastError(error) || attempt >= tags.length - 1) {
          throw error
        }
        await sleep(250)
      }
    }
    throw lastError || new Error('pending nonce read failed')
  }
  const nonce = txRequest.nonce !== undefined && txRequest.nonce !== null
    ? Number(txRequest.nonce)
    : await readPendingNonce()
  const chainId = txRequest.chainId !== undefined && txRequest.chainId !== null
    ? BigInt(txRequest.chainId)
    : 56n
  const populated = {
    to: txRequest.to,
    data: txRequest.data || '0x',
    value: txRequest.value === undefined || txRequest.value === null ? 0n : BigInt(txRequest.value),
    gasLimit: BigInt(txRequest.gasLimit),
    nonce,
    chainId
  }

  if (txRequest.gasPrice !== undefined && txRequest.gasPrice !== null) {
    populated.type = 0
    populated.gasPrice = BigInt(txRequest.gasPrice)
  } else {
    if (txRequest.type !== undefined && txRequest.type !== null) {
      populated.type = Number(txRequest.type)
    }
    if (txRequest.maxFeePerGas !== undefined && txRequest.maxFeePerGas !== null) {
      populated.maxFeePerGas = BigInt(txRequest.maxFeePerGas)
    }
    if (txRequest.maxPriorityFeePerGas !== undefined && txRequest.maxPriorityFeePerGas !== null) {
      populated.maxPriorityFeePerGas = BigInt(txRequest.maxPriorityFeePerGas)
    }
  }

  return populated
}

function attachReliableSendTransaction(signer) {
  if (!signer || signer.__reliableSendAttached === true) {
    return signer
  }

  signer.__reliableSendAttached = true
  signer.__rawSendTransaction = signer.sendTransaction.bind(signer)

  signer.sendTransaction = async function sendTransactionWithRetry(txRequest) {
    const timingStartedAtMs = Date.now()
    const timing = {
      startedAtMs: timingStartedAtMs,
      populateMs: 0,
      signMs: 0,
      broadcastMs: 0,
      knownLookupMs: 0,
      retryDelayMs: 0,
      attempts: 0,
      fallback: false
    }
    const provider = signer.provider
    if (!provider) {
      return signer.__rawSendTransaction(txRequest)
    }

    const populateStartedAtMs = Date.now()
    let populated
    if (canFastPopulateTransaction(txRequest)) {
      populated = await fastPopulatePreparedTransaction(signer, txRequest)
      timing.populateMode = 'fast-prepared'
    } else {
      populated = await populateTransactionWithRetry(signer, txRequest)
      timing.populateMode = 'ethers-populate'
    }
    timing.populateMs = Math.max(0, Date.now() - populateStartedAtMs)
    const signStartedAtMs = Date.now()
    const rawTx = await signer.signTransaction(populated)
    timing.signMs = Math.max(0, Date.now() - signStartedAtMs)
    const txHash = ethers.keccak256(rawTx)
    const rpcUrl = getProviderRpcUrl(provider)

    for (let attempt = 0; attempt < RELIABLE_SEND_RETRY_LIMIT; attempt += 1) {
      timing.attempts = attempt + 1
      const broadcastStartedAtMs = Date.now()
      try {
        let response = null
        if (rpcUrl) {
          const broadcastHash = await readRawJsonRpc(
            rpcUrl,
            'eth_sendRawTransaction',
            [rawTx],
            RELIABLE_SEND_RPC_TIMEOUT_MS,
            'eth_sendRawTransaction raw'
          )
          if (String(broadcastHash || '').toLowerCase() !== txHash.toLowerCase()) {
            throw new Error(`broadcast returned unexpected tx hash ${broadcastHash}`)
          }
          timing.broadcastMode = 'raw-http-eth_sendRawTransaction'
          response = buildBroadcastFallbackResponse(provider, rawTx, txHash)
        } else if (typeof provider.send === 'function') {
          const broadcastHash = await withLocalTimeout(
            provider.send('eth_sendRawTransaction', [rawTx]),
            RELIABLE_SEND_RPC_TIMEOUT_MS,
            'eth_sendRawTransaction'
          )
          if (String(broadcastHash || '').toLowerCase() !== txHash.toLowerCase()) {
            throw new Error(`broadcast returned unexpected tx hash ${broadcastHash}`)
          }
          timing.broadcastMode = 'provider-eth_sendRawTransaction'
          response = buildBroadcastFallbackResponse(provider, rawTx, txHash)
        } else {
          response = await withLocalTimeout(
            provider.broadcastTransaction(rawTx),
            RELIABLE_SEND_RPC_TIMEOUT_MS,
            'broadcastTransaction'
          )
          timing.broadcastMode = 'ethers-broadcastTransaction'
        }
        timing.broadcastMs += Math.max(0, Date.now() - broadcastStartedAtMs)
        timing.totalMs = Math.max(0, Date.now() - timingStartedAtMs)
        return attachReliableSendTiming(response || buildBroadcastFallbackResponse(provider, rawTx, txHash), timing)
      } catch (error) {
        timing.broadcastMs += Math.max(0, Date.now() - broadcastStartedAtMs)
        const knownBroadcast = isKnownBroadcastError(error)
        const transient = isTransientBroadcastError(error)

        if (knownBroadcast) {
          timing.totalMs = Math.max(0, Date.now() - timingStartedAtMs)
          return attachReliableSendTiming(buildBroadcastFallbackResponse(provider, rawTx, txHash), timing)
        }

        if (!transient) {
          throw error
        }

        const lookupStartedAtMs = Date.now()
        const broadcastedTx = await findBroadcastedTransaction(provider, txHash, rawTx, {
          attempts: 2,
          timeoutMs: 700,
          delayMs: 150
        })
        timing.knownLookupMs += Math.max(0, Date.now() - lookupStartedAtMs)
        if (broadcastedTx) {
          timing.broadcastMode = `${timing.broadcastMode || 'broadcast'}-recovered`
          timing.fallback = true
          timing.totalMs = Math.max(0, Date.now() - timingStartedAtMs)
          return attachReliableSendTiming(broadcastedTx, timing)
        }

        if (attempt >= RELIABLE_SEND_RETRY_LIMIT - 1) {
          timing.fallback = true
          timing.totalMs = Math.max(0, Date.now() - timingStartedAtMs)
          return attachReliableSendTiming(buildBroadcastFallbackResponse(provider, rawTx, txHash), timing)
        }

        const delayMs = RELIABLE_SEND_RETRY_DELAYS_MS[attempt] || 1400
        timing.retryDelayMs += delayMs
        await sleep(delayMs)
      }
    }

    timing.fallback = true
    timing.totalMs = Math.max(0, Date.now() - timingStartedAtMs)
    return attachReliableSendTiming(buildBroadcastFallbackResponse(provider, rawTx, txHash), timing)
  }

  return signer
}

function maskWalletId(value) {
  if (!value) {
    return null
  }

  const text = String(value)
  if (text.length <= 10) {
    return text
  }

  return `${text.slice(0, 6)}...${text.slice(-4)}`
}

function defaultKeystoreIndex() {
  return {
    version: 1,
    lastUpdated: null,
    wallets: []
  }
}

function resolveKeystoreFilePath(keystoreDir = DEFAULT_KEYSTORE_DIR) {
  return path.join(keystoreDir, KEYSTORE_INDEX_FILE)
}

function deriveScryptKey(password, salt) {
  return crypto.scryptSync(password, salt, KEY_BYTES, SCRYPT_PARAMS)
}

function encryptPrivateKey(privateKey, password) {
  if (!privateKey) {
    throw new Error('privateKey is required')
  }

  if (!password) {
    throw new Error('password is required')
  }

  const wallet = new ethers.Wallet(privateKey)
  const normalizedPrivateKey = wallet.privateKey
  const salt = crypto.randomBytes(SALT_BYTES)
  const iv = crypto.randomBytes(IV_BYTES)
  const key = deriveScryptKey(password, salt)
  const cipher = crypto.createCipheriv(KEYSTORE_ALGORITHM, key, iv)
  const ciphertext = Buffer.concat([
    cipher.update(normalizedPrivateKey, 'utf8'),
    cipher.final()
  ])
  const authTag = cipher.getAuthTag()

  return {
    version: KEYSTORE_VERSION,
    algorithm: KEYSTORE_ALGORITHM,
    kdf: {
      name: KDF_NAME,
      params: { ...SCRYPT_PARAMS },
      salt: salt.toString('base64')
    },
    cipher: {
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
      ciphertext: ciphertext.toString('base64')
    }
  }
}

function decryptPrivateKey(encryptedPayload, password) {
  if (!encryptedPayload) {
    throw new Error('encryptedPayload is required')
  }

  if (!password) {
    throw new Error('password is required')
  }

  try {
    const salt = Buffer.from(encryptedPayload.kdf.salt, 'base64')
    const iv = Buffer.from(encryptedPayload.cipher.iv, 'base64')
    const authTag = Buffer.from(encryptedPayload.cipher.authTag, 'base64')
    const ciphertext = Buffer.from(encryptedPayload.cipher.ciphertext, 'base64')
    const key = deriveScryptKey(password, salt)
    const decipher = crypto.createDecipheriv(KEYSTORE_ALGORITHM, key, iv)
    decipher.setAuthTag(authTag)
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final()
    ]).toString('utf8')
    return new ethers.Wallet(plaintext).privateKey
  } catch (error) {
    throw new Error('keystore decryption failed')
  }
}

function createKeystoreStore(keystoreDir = DEFAULT_KEYSTORE_DIR) {
  const keystoreFilePath = resolveKeystoreFilePath(keystoreDir)

  function loadIndex() {
    return readJsonFile(keystoreFilePath, defaultKeystoreIndex())
  }

  function saveIndex(index) {
    ensureDirectory(keystoreDir)
    const nextIndex = {
      ...index,
      lastUpdated: nowIso()
    }
    writeJsonFile(keystoreFilePath, nextIndex)
    return nextIndex
  }

  function listWallets() {
    const index = loadIndex()
    return index.wallets.map((wallet) => ({
      walletId: wallet.walletId,
      address: wallet.address,
      label: wallet.label || null,
      createdAt: wallet.createdAt,
      updatedAt: wallet.updatedAt,
      walletIdMasked: maskWalletId(wallet.walletId)
    }))
  }

  function getWallet(walletId) {
    const index = loadIndex()
    return index.wallets.find((wallet) => wallet.walletId === String(walletId)) || null
  }

  function importPrivateKey({ privateKey, password, label = null, walletId = crypto.randomUUID() }) {
    const normalizedWalletId = String(walletId)
    const wallet = new ethers.Wallet(privateKey)
    const address = wallet.address
    const index = loadIndex()

    if (index.wallets.some((item) => item.walletId === normalizedWalletId)) {
      throw new Error(`wallet "${normalizedWalletId}" already exists in keystore`)
    }

    const encryptedPayload = encryptPrivateKey(wallet.privateKey, password)
    const recordedAt = nowIso()
    index.wallets.push({
      walletId: normalizedWalletId,
      address,
      label,
      encryptedPayload,
      createdAt: recordedAt,
      updatedAt: recordedAt
    })
    saveIndex(index)

    return {
      walletId: normalizedWalletId,
      address,
      label
    }
  }

  function removeWallet(walletId) {
    const index = loadIndex()
    const nextWallets = index.wallets.filter((wallet) => wallet.walletId !== String(walletId))

    if (nextWallets.length === index.wallets.length) {
      return false
    }

    return saveIndex({
      ...index,
      wallets: nextWallets
    })
  }

  function unlockWallet({
    walletId,
    password,
    provider,
    sessionTtlMs = 5 * 60 * 1000,
    sessionBound = false,
    sessionOrigin = null
  }) {
    const wallet = getWallet(walletId)

    if (!wallet) {
      throw new Error(`wallet "${walletId}" was not found in keystore`)
    }

    const privateKey = decryptPrivateKey(wallet.encryptedPayload, password)
    const signer = new ethers.Wallet(privateKey, provider)
    signer.__signerSource = 'keystore'
    signer.__keystoreWalletId = wallet.walletId
    signer.__keystoreAddress = wallet.address
    signer.__unlockExpiresAt = new Date(Date.now() + Math.max(1, Number(sessionTtlMs || 0))).toISOString()
    signer.__keystoreSessionBound = Boolean(sessionBound)
    signer.__keystoreSessionOrigin = sessionOrigin ? String(sessionOrigin) : null
    attachReliableSendTransaction(signer)

    return {
      walletId: wallet.walletId,
      address: wallet.address,
      signer,
      expiresAt: signer.__unlockExpiresAt
    }
  }

  return {
    keystoreDir,
    keystoreFilePath,
    loadIndex,
    saveIndex,
    listWallets,
    getWallet,
    importPrivateKey,
    removeWallet,
    unlockWallet
  }
}

function createKeystoreSigner({
  keystoreDir = DEFAULT_KEYSTORE_DIR,
  walletId,
  password,
  provider,
  sessionTtlMs
}) {
  const store = createKeystoreStore(keystoreDir)
  const unlocked = store.unlockWallet({
    walletId,
    password,
    provider,
    sessionTtlMs
  })

  return unlocked.signer
}

module.exports = {
  DEFAULT_KEYSTORE_DIR,
  KEYSTORE_INDEX_FILE,
  KEYSTORE_VERSION,
  KEYSTORE_ALGORITHM,
  KDF_NAME,
  SCRYPT_PARAMS,
  defaultKeystoreIndex,
  resolveKeystoreFilePath,
  maskWalletId,
  encryptPrivateKey,
  decryptPrivateKey,
  attachReliableSendTransaction,
  populateTransactionWithRetry,
  getProviderRpcUrl,
  readRawJsonRpc,
  createKeystoreStore,
  createKeystoreSigner
}
