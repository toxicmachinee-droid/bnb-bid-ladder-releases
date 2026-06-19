#!/usr/bin/env node
'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const {
  auditPublicPrivateSplit
} = require('./audit_public_private_split.cjs')

function parseArgs(argv = process.argv.slice(2)) {
  const args = {}
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (!arg.startsWith('--')) continue
    const key = arg.slice(2)
    const value = argv[i + 1] && !argv[i + 1].startsWith('--')
      ? argv[++i]
      : '1'
    args[key] = value
  }
  return args
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256')
  hash.update(fs.readFileSync(filePath))
  return hash.digest('hex')
}

function listFiles(dir) {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
}

function parseSha256Sums(body) {
  const sums = new Map()
  for (const line of String(body || '').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const match = trimmed.match(/^([a-fA-F0-9]{64})\s+\*?(.+)$/)
    if (!match) {
      throw new Error(`invalid SHA256SUMS line: ${trimmed}`)
    }
    sums.set(path.basename(match[2].trim()), match[1].toLowerCase())
  }
  return sums
}

function requireOneMatching(files, pattern, label) {
  const matches = files.filter((file) => pattern.test(file))
  if (matches.length !== 1) {
    throw new Error(`release must contain exactly one ${label}; found ${matches.length}`)
  }
  return matches[0]
}

function verifyReleaseArtifacts({
  repoRoot = path.resolve(__dirname, '..'),
  artifactDir = path.resolve(repoRoot, 'dist', 'release'),
  unpackedDir = path.resolve(repoRoot, 'dist', 'release-unpacked')
} = {}) {
  const files = listFiles(artifactDir)
  const setup = requireOneMatching(files, /^BNB\.BitLadder\.Setup\.[^/\\]+\.exe$/i, 'setup exe')
  const portable = requireOneMatching(files, /^BNB\.BitLadder\.Portable\.[^/\\]+\.zip$/i, 'portable zip')
  if (!files.includes('SHA256SUMS.txt')) {
    throw new Error('release must contain SHA256SUMS.txt')
  }
  if (!fs.existsSync(unpackedDir) || !fs.statSync(unpackedDir).isDirectory()) {
    throw new Error(`unpacked release audit directory is missing: ${unpackedDir}`)
  }

  const sums = parseSha256Sums(fs.readFileSync(path.join(artifactDir, 'SHA256SUMS.txt'), 'utf8'))
  for (const artifact of [setup, portable]) {
    const expected = sums.get(artifact)
    if (!expected) {
      throw new Error(`SHA256SUMS.txt is missing ${artifact}`)
    }
    const actual = sha256File(path.join(artifactDir, artifact))
    if (actual !== expected) {
      throw new Error(`sha256 mismatch for ${artifact}`)
    }
  }

  const audit = auditPublicPrivateSplit({
    repoRoot: unpackedDir,
    strictReleaseBoundary: true,
    publicReleaseExport: true,
    artifactBoundary: true,
    ignoredPaths: []
  })

  return {
    ok: true,
    artifactDir,
    unpackedDir,
    setup,
    portable,
    audit
  }
}

if (require.main === module) {
  try {
    const args = parseArgs()
    const result = verifyReleaseArtifacts({
      artifactDir: args['artifact-dir'] ? path.resolve(args['artifact-dir']) : undefined,
      unpackedDir: args['unpacked-dir'] ? path.resolve(args['unpacked-dir']) : undefined
    })
    console.log(JSON.stringify(result, null, 2))
  } catch (error) {
    console.error(error && error.message ? error.message : String(error))
    process.exitCode = 1
  }
}

module.exports = {
  verifyReleaseArtifacts,
  parseSha256Sums
}
