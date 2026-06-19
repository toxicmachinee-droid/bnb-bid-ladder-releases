'use strict'

const form = document.getElementById('license-form')
const input = document.getElementById('license-key')
const button = document.getElementById('license-submit')
const statusLine = document.getElementById('license-status')
const expiryLine = document.getElementById('license-expiry')

function setStatus(message, kind = '') {
  statusLine.textContent = message
  statusLine.className = `status-line ${kind}`.trim()
}

function formatDateTime(isoString) {
  const date = new Date(isoString || '')
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function formatRemaining(isoString) {
  const date = new Date(isoString || '')
  if (Number.isNaN(date.getTime())) return ''
  const remainingMs = date.getTime() - Date.now()
  if (remainingMs <= 0) return 'expired'
  const days = Math.floor(remainingMs / 86400000)
  const hours = Math.floor((remainingMs % 86400000) / 3600000)
  return days > 0 ? `${days}d ${hours}h left` : `${Math.max(1, hours)}h left`
}

function setExpiry(payload) {
  const expiresAt = payload?.licenseExpiresAt || payload?.expiresAt
  const formatted = formatDateTime(expiresAt)
  expiryLine.textContent = formatted
    ? `License valid until ${formatted} (${formatRemaining(expiresAt)}).`
    : ''
}

async function fetchJson(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(options.headers || {})
    }
  })
  const payload = await response.json()
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || payload.reason || `Request failed (${response.status})`)
  }
  return payload
}

async function refreshStatus() {
  try {
    const payload = await fetchJson('/api/license-status')
    if (payload.unlocked) {
      setExpiry(payload)
      setStatus('License active. Opening app...', 'ok')
      window.location.replace('/')
      return
    }
    setExpiry(payload)
    setStatus(payload.reason || 'Enter your license key to activate this device.')
  } catch (error) {
    setStatus(error.message || 'License server is unreachable.', 'error')
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault()
  const licenseKey = input.value.trim()
  if (!licenseKey) {
    setStatus('Enter a license key.', 'error')
    return
  }
  button.disabled = true
  setStatus('Activating...')
  try {
    const payload = await fetchJson('/api/license-activate', {
      method: 'POST',
      body: JSON.stringify({ licenseKey })
    })
    if (payload.unlocked) {
      input.value = ''
      setExpiry(payload)
      setStatus('License active. Opening app...', 'ok')
      window.location.replace('/')
      return
    }
    setStatus(payload.reason || 'Activation failed.', 'error')
  } catch (error) {
    setStatus(error.message || 'Activation failed.', 'error')
  } finally {
    button.disabled = false
  }
})

refreshStatus()
