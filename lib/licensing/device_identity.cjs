'use strict'

const crypto = require('crypto')
const os = require('os')

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex')
}

function generateDeviceIdentity({
  installId = crypto.randomUUID(),
  hwidHash = null,
  hostname = os.hostname(),
  platform = process.platform,
  arch = process.arch
} = {}) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
  const resolvedHwidHash = hwidHash || sha256([hostname, platform, arch].join('|'))
  return {
    installId,
    hwidHash: resolvedHwidHash,
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' })
  }
}

function buildDeviceFingerprint({ installId, hwidHash, publicKeyPem }) {
  if (!installId || !hwidHash || !publicKeyPem) {
    throw new Error('device identity requires installId, hwidHash, and publicKeyPem')
  }
  return sha256(`${String(hwidHash).toLowerCase()}|${String(installId)}|${String(publicKeyPem).trim()}`)
}

function buildDeviceBinding(identity = {}) {
  const binding = {
    installId: String(identity.installId || ''),
    hwidHash: String(identity.hwidHash || '').toLowerCase(),
    publicKeyPem: String(identity.publicKeyPem || '').trim()
  }
  return {
    ...binding,
    fingerprint: buildDeviceFingerprint(binding)
  }
}

function deviceRequestPayload({ method, path, timestamp, nonce, bodyHash }) {
  return JSON.stringify({
    method: String(method || '').toUpperCase(),
    path: String(path || ''),
    timestamp: String(timestamp || ''),
    nonce: String(nonce || ''),
    bodyHash: String(bodyHash || '')
  })
}

function signDeviceRequest({ privateKeyPem, method, path, timestamp, nonce, bodyHash }) {
  if (!privateKeyPem) throw new Error('device private key is required')
  const signature = crypto.sign(
    null,
    Buffer.from(deviceRequestPayload({ method, path, timestamp, nonce, bodyHash })),
    privateKeyPem
  )
  return {
    signature: signature.toString('base64url')
  }
}

function verifyDeviceRequestSignature({ publicKeyPem, signature, method, path, timestamp, nonce, bodyHash }) {
  if (!publicKeyPem || !signature) return false
  try {
    return crypto.verify(
      null,
      Buffer.from(deviceRequestPayload({ method, path, timestamp, nonce, bodyHash })),
      publicKeyPem,
      Buffer.from(String(signature), 'base64url')
    )
  } catch {
    return false
  }
}

module.exports = {
  generateDeviceIdentity,
  buildDeviceFingerprint,
  buildDeviceBinding,
  signDeviceRequest,
  verifyDeviceRequestSignature
}
