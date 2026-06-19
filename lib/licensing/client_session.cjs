'use strict'

const crypto = require('crypto')

const {
  buildDeviceBinding,
  signDeviceRequest
} = require('./device_identity.cjs')

function sha256Json(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value || {})).digest('hex')
}

function isLoopbackHostname(hostname) {
  const normalized = String(hostname || '').toLowerCase()
  return normalized === 'localhost' ||
    normalized === '127.0.0.1' ||
    normalized === '::1' ||
    normalized === '[::1]'
}

function normalizeBaseUrl(baseUrl, { allowInsecureTransport = false } = {}) {
  if (!baseUrl) throw new Error('license server baseUrl is required')
  const parsed = new URL(String(baseUrl))
  const isSecure = parsed.protocol === 'https:'
  const isLocalHttp = parsed.protocol === 'http:' && isLoopbackHostname(parsed.hostname)
  if (!isSecure && !isLocalHttp && !allowInsecureTransport) {
    throw new Error('https is required for remote license server transport')
  }
  return String(baseUrl).replace(/\/+$/, '')
}

function createLicenseClient({
  baseUrl,
  deviceIdentity,
  fetchImpl = globalThis.fetch,
  timeoutMs = 5000,
  plannerTimeoutMs = timeoutMs,
  executionReportTimeoutMs = timeoutMs,
  allowInsecureTransport = false,
  now = () => new Date(),
  nonce = () => crypto.randomUUID()
} = {}) {
  if (!fetchImpl) throw new Error('fetch implementation is required')
  if (!deviceIdentity || !deviceIdentity.privateKeyPem) {
    throw new Error('device identity with privateKeyPem is required')
  }
  const root = normalizeBaseUrl(baseUrl, { allowInsecureTransport })
  const device = buildDeviceBinding(deviceIdentity)
  let sessionToken = null

  async function postJson(path, body, requestTimeoutMs = timeoutMs) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), Math.max(1, Number(requestTimeoutMs || timeoutMs)))
    try {
      const response = await fetchImpl(`${root}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body || {}),
        signal: controller.signal
      })
      const payload = await response.json()
      return {
        httpStatus: response.status,
        ...payload
      }
    } finally {
      clearTimeout(timer)
    }
  }

  function rememberSession(result) {
    if (result && result.ok && result.sessionToken) {
      sessionToken = result.sessionToken
    }
    return result
  }

  function buildSignedEnvelope(path, payload, payloadKey = 'intent') {
    if (!sessionToken) throw new Error('license session is required before planner requests')
    const timestamp = new Date(now()).toISOString()
    const requestNonce = String(nonce())
    const bodyHash = sha256Json(payload)
    const { signature } = signDeviceRequest({
      privateKeyPem: deviceIdentity.privateKeyPem,
      method: 'POST',
      path,
      timestamp,
      nonce: requestNonce,
      bodyHash
    })
    return {
      sessionToken,
      device,
      [payloadKey]: payload,
      clientRequest: {
        timestamp,
        nonce: requestNonce,
        bodyHash,
        signature
      }
    }
  }

  function buildPlannerEnvelope(path, intent) {
    return buildSignedEnvelope(path, intent, 'intent')
  }

  function buildExecutionReportEnvelope(report) {
    return buildSignedEnvelope('/v1/executions/report', report, 'report')
  }

  return {
    _restoreSessionForOperatorGate(token) {
      sessionToken = token || null
    },
    get sessionToken() {
      return sessionToken
    },
    get device() {
      return { ...device }
    },
    async activate(licenseKey, requestNonce = nonce()) {
      return rememberSession(await postJson('/v1/licenses/activate', {
        licenseKey,
        device,
        nonce: requestNonce
      }))
    },
    async createSession(licenseKey, requestNonce = nonce()) {
      return rememberSession(await postJson('/v1/licenses/session', {
        licenseKey,
        device,
        nonce: requestNonce
      }))
    },
    async heartbeat() {
      if (!sessionToken) throw new Error('license session is required before heartbeat')
      return postJson('/v1/licenses/heartbeat', {
        sessionToken,
        device
      })
    },
    buildPlannerEnvelope,
    buildExecutionReportEnvelope,
    async requestPlan(action, intent) {
      const path = `/v1/plans/${String(action || '').replace(/^\/+/, '')}`
      return postJson(path, buildPlannerEnvelope(path, intent), plannerTimeoutMs)
    },
    async reportExecution(report) {
      return postJson('/v1/executions/report', buildExecutionReportEnvelope(report), executionReportTimeoutMs)
    }
  }
}

module.exports = {
  createLicenseClient,
  sha256Json,
  normalizeBaseUrl
}
