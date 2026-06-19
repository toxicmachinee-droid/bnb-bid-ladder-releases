'use strict'

const crypto = require('crypto')

function generateLicenseKey({ prefix = 'LL' } = {}) {
  const raw = crypto.randomBytes(16).toString('hex').toUpperCase()
  const groups = raw.match(/.{1,8}/g) || []
  const licenseKey = `${prefix}-${groups.join('-')}`
  return {
    licenseKey,
    keyPrefix: licenseKey.slice(0, 11)
  }
}

function assertPepper(pepper) {
  if (!pepper || String(pepper).length < 8) {
    throw new Error('license key pepper must be configured')
  }
}

function hashLicenseKey(licenseKey, pepper) {
  assertPepper(pepper)
  return crypto
    .createHmac('sha256', String(pepper))
    .update(String(licenseKey || '').trim())
    .digest('hex')
}

function verifyLicenseKeyHash(licenseKey, pepper, expectedHash) {
  const actual = Buffer.from(hashLicenseKey(licenseKey, pepper), 'hex')
  const expected = Buffer.from(String(expectedHash || ''), 'hex')
  if (actual.length !== expected.length) {
    return false
  }
  return crypto.timingSafeEqual(actual, expected)
}

module.exports = {
  generateLicenseKey,
  hashLicenseKey,
  verifyLicenseKeyHash
}
