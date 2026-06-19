'use strict'

const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const { DEFAULT_KEYSTORE_DIR, createKeystoreStore } = require('./keystore.cjs')

const DEFAULT_SESSION_TTL_MS = 2 * 60 * 60 * 1000

function nowIso() {
  return new Date().toISOString()
}

function toSafePositiveInteger(value, fallback) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return fallback
  }

  return Math.max(1, Math.floor(numeric))
}

function scrubExpiredSession(state, now = Date.now()) {
  if (!state.activeSession) {
    return null
  }

  const expiresAtMs = Date.parse(state.activeSession.expiresAt || '')
  if (Number.isFinite(expiresAtMs) && now <= expiresAtMs) {
    return state.activeSession
  }

  if (state.activeSession.provider && typeof state.activeSession.provider.destroy === 'function') {
    try {
      state.activeSession.provider.destroy()
    } catch (_) {
    }
  }

  state.activeSession = null
  return null
}

function buildSessionStatus(store, state, now = Date.now()) {
  const activeSession = scrubExpiredSession(state, now)
  const wallets = store.listWallets()

  if (!activeSession) {
    return {
      unlocked: false,
      active: false,
      walletId: null,
      walletIdMasked: null,
      address: null,
      label: null,
      unlockedAt: null,
      expiresAt: null,
      remainingMs: 0,
      availableWallets: wallets.length,
      persistentUnlock: Boolean(state.persistUnlock)
    }
  }

  const remainingMs = Math.max(0, Date.parse(activeSession.expiresAt) - now)
  return {
    unlocked: true,
    active: true,
    walletId: activeSession.walletId,
    walletIdMasked: activeSession.walletIdMasked,
    address: activeSession.address,
    label: activeSession.label || null,
    unlockedAt: activeSession.unlockedAt,
    expiresAt: activeSession.expiresAt,
    remainingMs,
    availableWallets: wallets.length,
    persistentUnlock: Boolean(state.persistUnlock),
    restoredFromPersistentUnlock: Boolean(activeSession.restoredFromPersistentUnlock)
  }
}

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true })
}

function writeJsonFile(filePath, payload) {
  ensureDirectory(path.dirname(filePath))
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 })
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function createWindowsDpapiProtector() {
  const runPowerShell = (script, input) => execFileSync('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    script
  ], {
    input,
    encoding: 'utf8',
    timeout: 3000,
    windowsHide: true
  }).trim()

  return {
    available: process.platform === 'win32',
    protect(secret) {
      if (process.platform !== 'win32') {
        throw new Error('persistent unlock requires Windows DPAPI on this build')
      }
      return runPowerShell(`
$plain = [Console]::In.ReadToEnd()
$secure = ConvertTo-SecureString -String $plain -AsPlainText -Force
ConvertFrom-SecureString -SecureString $secure
`, String(secret || ''))
    },
    unprotect(payload) {
      if (process.platform !== 'win32') {
        throw new Error('persistent unlock requires Windows DPAPI on this build')
      }
      return runPowerShell(`
$encrypted = [Console]::In.ReadToEnd().Trim()
$secure = ConvertTo-SecureString -String $encrypted
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
}
`, String(payload || ''))
    }
  }
}

function createKeystoreSessionManager({
  keystoreDir = DEFAULT_KEYSTORE_DIR,
  providerFactory = null,
  defaultSessionTtlMs = DEFAULT_SESSION_TTL_MS,
  sessionOrigin = 'operator-ui-local',
  persistUnlock = false,
  persistentSessionFile = path.join(keystoreDir, 'operator-session.json'),
  sessionProtector = createWindowsDpapiProtector()
} = {}) {
  const store = createKeystoreStore(keystoreDir)
  const state = {
    activeSession: null,
    persistUnlock: Boolean(persistUnlock && sessionProtector?.available !== false)
  }

  function clearPersistedUnlock() {
    try {
      fs.rmSync(persistentSessionFile, { force: true })
    } catch (_) {
    }
  }

  function persistUnlockSession({ walletId, password, expiresAt }) {
    if (!state.persistUnlock || !password || !walletId || !expiresAt) {
      return false
    }

    try {
      writeJsonFile(persistentSessionFile, {
        version: 1,
        walletId: String(walletId),
        protectedPassword: sessionProtector.protect(String(password)),
        expiresAt,
        createdAt: nowIso(),
        protection: 'windows-dpapi-current-user'
      })
      return true
    } catch (_) {
      clearPersistedUnlock()
      return false
    }
  }

  function restorePersistedUnlock() {
    if (!state.persistUnlock || !fs.existsSync(persistentSessionFile)) {
      return false
    }

    try {
      const persisted = readJsonFile(persistentSessionFile)
      const expiresAtMs = Date.parse(persisted.expiresAt || '')
      const createdAtMs = Date.parse(persisted.createdAt || '')
      const defaultExpiresAtMs = Number.isFinite(createdAtMs)
        ? createdAtMs + toSafePositiveInteger(defaultSessionTtlMs, DEFAULT_SESSION_TTL_MS)
        : expiresAtMs
      const effectiveExpiresAtMs = Math.min(expiresAtMs, defaultExpiresAtMs)
      const remainingMs = effectiveExpiresAtMs - Date.now()
      if (!Number.isFinite(expiresAtMs) || !Number.isFinite(effectiveExpiresAtMs) || remainingMs <= 0) {
        clearPersistedUnlock()
        return false
      }

      const status = unlock({
        walletId: persisted.walletId,
        password: sessionProtector.unprotect(persisted.protectedPassword),
        sessionTtlMs: remainingMs,
        persist: false,
        restoredFromPersistentUnlock: true
      })
      return Boolean(status?.unlocked)
    } catch (_) {
      clearPersistedUnlock()
      return false
    }
  }

  function listWallets() {
    const activeSession = scrubExpiredSession(state)
    return store.listWallets().map((wallet) => ({
      ...wallet,
      active: Boolean(activeSession && activeSession.walletId === wallet.walletId)
    }))
  }

  function importPrivateKey({ privateKey, password, label = null, walletId = null }) {
    const imported = store.importPrivateKey({
      privateKey,
      password,
      label,
      walletId: walletId || undefined
    })

    return {
      ...imported,
      walletIdMasked: listWallets().find((wallet) => wallet.walletId === imported.walletId)?.walletIdMasked || null
    }
  }

  function unlock({
    walletId,
    password,
    sessionTtlMs = defaultSessionTtlMs,
    persist = true,
    restoredFromPersistentUnlock = false
  }) {
    const provider = typeof providerFactory === 'function' ? providerFactory() : null
    try {
      const unlocked = store.unlockWallet({
        walletId,
        password,
        provider,
        sessionTtlMs: toSafePositiveInteger(sessionTtlMs, DEFAULT_SESSION_TTL_MS),
        sessionBound: true,
        sessionOrigin
      })
      const walletRecord = store.getWallet(unlocked.walletId)
      state.activeSession = {
        walletId: unlocked.walletId,
        walletIdMasked: walletRecord?.walletIdMasked || listWallets().find((wallet) => wallet.walletId === unlocked.walletId)?.walletIdMasked || null,
        address: unlocked.address,
        label: walletRecord?.label || null,
        signer: unlocked.signer,
        provider,
        unlockedAt: nowIso(),
        expiresAt: unlocked.expiresAt,
        restoredFromPersistentUnlock
      }
      if (persist) {
        persistUnlockSession({
          walletId: unlocked.walletId,
          password,
          expiresAt: unlocked.expiresAt
        })
      }
      return buildSessionStatus(store, state)
    } catch (error) {
      if (provider && typeof provider.destroy === 'function') {
        try {
          provider.destroy()
        } catch (_) {
        }
      }
      throw error
    }
  }

  function lock() {
    const hadActiveSession = Boolean(scrubExpiredSession(state))
    scrubExpiredSession(state, Number.POSITIVE_INFINITY)
    clearPersistedUnlock()
    return {
      locked: true,
      hadActiveSession
    }
  }

  function getStatus() {
    return buildSessionStatus(store, state)
  }

  function getActiveSigner() {
    const activeSession = scrubExpiredSession(state)
    if (!activeSession?.signer) {
      return null
    }

    return activeSession.signer
  }

  restorePersistedUnlock()

  return {
    keystoreDir,
    store,
    listWallets,
    importPrivateKey,
    unlock,
    lock,
    getStatus,
    getActiveSigner,
    clearPersistedUnlock,
    restorePersistedUnlock
  }
}

module.exports = {
  DEFAULT_SESSION_TTL_MS,
  createKeystoreSessionManager
}
