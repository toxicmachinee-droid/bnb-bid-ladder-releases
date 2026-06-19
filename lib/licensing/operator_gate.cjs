'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const {
  generateDeviceIdentity
} = require('./device_identity.cjs')
const {
  createLicenseClient
} = require('./client_session.cjs')

const PRIVATE_LICENSE_FILE_MODE = 0o600
const ELECTRON_SAFE_STORAGE_FORMAT = 'electron-safe-storage-json-v1'

function ensureDirFor(filePath) {
  fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true })
}

function createElectronSafeStorageFileCodec() {
  try {
    const electron = require('electron')
    const safeStorage = electron && electron.safeStorage
    if (!safeStorage || typeof safeStorage.isEncryptionAvailable !== 'function' || !safeStorage.isEncryptionAvailable()) {
      return null
    }
    return {
      encodeJson(payload) {
        const ciphertext = safeStorage.encryptString(JSON.stringify(payload))
        return JSON.stringify({
          format: ELECTRON_SAFE_STORAGE_FORMAT,
          ciphertext: Buffer.from(ciphertext).toString('base64')
        }, null, 2)
      },
      decodeJson(raw) {
        const parsed = JSON.parse(raw)
        if (parsed && parsed.format === ELECTRON_SAFE_STORAGE_FORMAT && parsed.ciphertext) {
          const plaintext = safeStorage.decryptString(Buffer.from(String(parsed.ciphertext), 'base64'))
          return JSON.parse(plaintext)
        }
        return parsed
      }
    }
  } catch {
    return null
  }
}

function readJsonFile(filePath, fallback, fileCodec = null) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8')
    return fileCodec && typeof fileCodec.decodeJson === 'function'
      ? fileCodec.decodeJson(raw)
      : JSON.parse(raw)
  } catch {
    return fallback
  }
}

function writeJsonFile(filePath, payload, fileCodec = null) {
  ensureDirFor(filePath)
  const body = fileCodec && typeof fileCodec.encodeJson === 'function'
    ? fileCodec.encodeJson(payload)
    : JSON.stringify(payload, null, 2)
  fs.writeFileSync(filePath, body, { mode: PRIVATE_LICENSE_FILE_MODE })
  try {
    fs.chmodSync(filePath, PRIVATE_LICENSE_FILE_MODE)
  } catch {
  }
}

function isValidDeviceIdentity(identity = {}) {
  if (!identity || !identity.installId || !identity.hwidHash || !identity.publicKeyPem || !identity.privateKeyPem) {
    return false
  }
  try {
    const privateKey = crypto.createPrivateKey(identity.privateKeyPem)
    const publicKey = crypto.createPublicKey(identity.publicKeyPem)
    if (privateKey.asymmetricKeyType !== publicKey.asymmetricKeyType) {
      return false
    }
    const probe = Buffer.from('bnb-bid-ladder-device-identity-self-test')
    const signature = crypto.sign(null, probe, privateKey)
    return crypto.verify(null, probe, publicKey, signature)
  } catch {
    return false
  }
}

function loadOrCreateDeviceIdentity(deviceFile, fileCodec = null) {
  const existing = readJsonFile(deviceFile, null, fileCodec)
  if (isValidDeviceIdentity(existing)) {
    return existing
  }
  const created = generateDeviceIdentity()
  writeJsonFile(deviceFile, created, fileCodec)
  return created
}

function isLicenseGateBypassPath(method, pathname) {
  const upperMethod = String(method || '').toUpperCase()
  const pathName = String(pathname || '')
  if (upperMethod === 'GET' && pathName === '/api/license-status') return true
  if (upperMethod === 'POST' && pathName === '/api/license-activate') return true
  if (upperMethod === 'POST' && pathName === '/api/license-heartbeat') return true
  if (upperMethod === 'GET' && /^\/ui\/license_gate\.(html|css|js)$/.test(pathName)) return true
  if (upperMethod === 'GET' && /^\/ui\/desktop_window\.(css|js)$/.test(pathName)) return true
  if (upperMethod === 'GET' && pathName === '/ui/app-icon-64.png') return true
  if (upperMethod === 'GET' && pathName === '/favicon.ico') return true
  return false
}

function publicLockedStatus(reason, extra = {}) {
  return {
    ok: true,
    required: true,
    unlocked: false,
    reason,
    ...extra
  }
}

function publicUnlockedStatus(session, extra = {}) {
  return {
    ok: true,
    required: true,
    unlocked: true,
    keyPrefix: session.keyPrefix || null,
    sessionExpiresAt: session.sessionExpiresAt || null,
    licenseExpiresAt: session.licenseExpiresAt || session.expiresAt || null,
    ...extra
  }
}

function summarizeSavedSession(session) {
  if (!session || !session.sessionToken) return {}
  return {
    savedSession: true,
    keyPrefix: session.keyPrefix || null,
    sessionExpiresAt: session.sessionExpiresAt || null,
    licenseExpiresAt: session.licenseExpiresAt || session.expiresAt || null
  }
}

function formatUnreachableError(error, serverUrl) {
  const detail = error && error.message ? error.message : String(error || '')
  const suffix = detail ? ` (${detail})` : ''
  return `Cannot reach license server${serverUrl ? ` at ${serverUrl}` : ''}${suffix}`
}

function createOperatorLicenseGate({
  required = true,
  serverUrl,
  stateFile,
  deviceFile,
  fetchImpl,
  timeoutMs = 5000,
  plannerTimeoutMs = Math.max(20_000, Number(timeoutMs || 5000)),
  executionReportTimeoutMs = Math.max(5_000, Number(timeoutMs || 5000)),
  statusCacheTtlMs = 30_000,
  allowInsecureTransport = process.env.OPERATOR_LICENSE_ALLOW_INSECURE_TRANSPORT === '1',
  now = () => new Date(),
  nonce,
  fileCodec = createElectronSafeStorageFileCodec()
} = {}) {
  if (!required) {
    return {
      required: false,
      isUnlocked: () => true,
      refreshStatus: async () => ({ ok: true, required: false, unlocked: true }),
      activate: async () => ({ ok: true, required: false, unlocked: true }),
      heartbeat: async () => ({ ok: true, required: false, unlocked: true }),
      requestPlan: async () => ({ ok: false, error: 'License planner is disabled because licensing is not required' })
    }
  }
  if (!stateFile) throw new Error('operator license stateFile is required')
  if (!deviceFile) throw new Error('operator license deviceFile is required')

  const deviceIdentity = loadOrCreateDeviceIdentity(deviceFile, fileCodec)
  const client = serverUrl
    ? createLicenseClient({
        baseUrl: serverUrl,
        deviceIdentity,
        fetchImpl,
        timeoutMs,
        plannerTimeoutMs,
        executionReportTimeoutMs,
        allowInsecureTransport,
        now,
        nonce
      })
    : null
  let lastStatus = publicLockedStatus(serverUrl ? 'License activation required' : 'License server URL is not configured')
  let lastStatusCheckedAtMs = 0

  function loadSession() {
    return readJsonFile(stateFile, null, fileCodec)
  }

  function saveSession(session) {
    writeJsonFile(stateFile, {
      keyPrefix: session.keyPrefix || null,
      sessionToken: session.sessionToken,
      sessionExpiresAt: session.sessionExpiresAt || null,
      licenseExpiresAt: session.licenseExpiresAt || session.expiresAt || null,
      savedAt: new Date(now()).toISOString()
    }, fileCodec)
  }

  function removeSession() {
    try {
      fs.unlinkSync(stateFile)
    } catch {
    }
  }

  async function heartbeatWithSession(session) {
    if (!client) return publicLockedStatus('License server URL is not configured')
    if (!session || !session.sessionToken) return publicLockedStatus('License activation required')
    client._restoreSessionForOperatorGate?.(session.sessionToken)
    const result = await client.heartbeat()
    if (!result.ok) {
      removeSession()
      return publicLockedStatus(result.error || 'License server rejected the session')
    }
    const merged = {
      ...session,
      ...result,
      sessionToken: session.sessionToken
    }
    saveSession(merged)
    lastStatusCheckedAtMs = new Date(now()).getTime()
    return publicUnlockedStatus(merged)
  }

  function canReuseCachedStatus({ force = false } = {}) {
    if (force) return false
    if (!lastStatus || !lastStatus.unlocked) return false
    const checkedAt = Number(lastStatusCheckedAtMs || 0)
    if (!Number.isFinite(checkedAt) || checkedAt <= 0) return false
    const ttl = Number(statusCacheTtlMs || 0)
    if (!Number.isFinite(ttl) || ttl <= 0) return false
    return new Date(now()).getTime() - checkedAt < ttl
  }

  return {
    required: true,

    isUnlocked() {
      return Boolean(lastStatus && lastStatus.unlocked)
    },

    async refreshStatus(options = {}) {
      if (canReuseCachedStatus(options)) {
        return lastStatus
      }
      try {
        lastStatus = await heartbeatWithSession(loadSession())
      } catch (error) {
        const savedSession = loadSession()
        lastStatus = publicLockedStatus('License server is unreachable', {
          serverReachable: false,
          error: formatUnreachableError(error, serverUrl),
          ...summarizeSavedSession(savedSession)
        })
      }
      return lastStatus
    },

    async activate(licenseKey) {
      if (!client) {
        lastStatus = publicLockedStatus('License server URL is not configured')
        return lastStatus
      }
      if (!licenseKey) {
        lastStatus = publicLockedStatus('License key is required')
        return lastStatus
      }
      try {
        const result = await client.activate(licenseKey)
        if (!result.ok) {
          lastStatus = publicLockedStatus(result.error || 'License activation failed')
          return lastStatus
        }
        saveSession(result)
        lastStatus = publicUnlockedStatus(result)
        lastStatusCheckedAtMs = new Date(now()).getTime()
        return lastStatus
      } catch (error) {
        lastStatus = publicLockedStatus('License server is unreachable', {
          serverReachable: false,
          error: formatUnreachableError(error, serverUrl),
          ...summarizeSavedSession(loadSession())
        })
        return lastStatus
      }
    },

    async heartbeat() {
      return this.refreshStatus({ force: true })
    },

    async requestPlan(action, intent = {}) {
      if (!client) {
        return { ok: false, error: 'License server URL is not configured' }
      }
      const session = loadSession()
      if (!session || !session.sessionToken) {
        return { ok: false, error: 'License activation required' }
      }
      client._restoreSessionForOperatorGate?.(session.sessionToken)
      try {
        return await client.requestPlan(action, intent)
      } catch (error) {
        return {
          ok: false,
          error: error && error.message ? error.message : String(error)
        }
      }
    },

    async reportExecution(report = {}) {
      if (!client) {
        return { ok: false, error: 'License server URL is not configured' }
      }
      const session = loadSession()
      if (!session || !session.sessionToken) {
        return { ok: false, error: 'License activation required' }
      }
      client._restoreSessionForOperatorGate?.(session.sessionToken)
      try {
        return await client.reportExecution(report)
      } catch (error) {
        return {
          ok: false,
          error: error && error.message ? error.message : String(error)
        }
      }
    }
  }
}

module.exports = {
  createOperatorLicenseGate,
  isLicenseGateBypassPath,
  PRIVATE_LICENSE_FILE_MODE,
  createElectronSafeStorageFileCodec
}
