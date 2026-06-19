#!/usr/bin/env node
'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const MANIFEST_FILE = 'PUBLIC_RELEASE_MANIFEST.json'
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist'])

function normalizeRepoPath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\/+/, '')
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function fileBytes(filePath) {
  return fs.statSync(filePath).size
}

function listReleaseFiles(targetDir) {
  const root = path.resolve(targetDir)
  const files = []

  function walk(currentDir, relativeDir = '') {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true })
    for (const entry of entries) {
      const relativePath = normalizeRepoPath(path.join(relativeDir, entry.name))
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue
        walk(path.join(currentDir, entry.name), relativePath)
        continue
      }
      if (entry.isFile() && relativePath !== MANIFEST_FILE) {
        files.push(relativePath)
      }
    }
  }

  walk(root)
  return files.sort()
}

function gitValue(repoRoot, args) {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 10_000
  })
  if (result.status !== 0) return null
  return String(result.stdout || '').trim() || null
}

function buildPublicReleaseManifest({
  repoRoot = path.resolve(__dirname, '..'),
  targetDir,
  generatedAt = new Date().toISOString()
} = {}) {
  if (!targetDir) throw new Error('public release targetDir is required')
  const resolvedTarget = path.resolve(targetDir)
  const files = listReleaseFiles(resolvedTarget).map((relativePath) => {
    const filePath = path.join(resolvedTarget, relativePath)
    return {
      path: relativePath,
      bytes: fileBytes(filePath),
      sha256: sha256File(filePath)
    }
  })

  return {
    schemaVersion: 1,
    generatedAt,
    sourceCommit: gitValue(repoRoot, ['rev-parse', 'HEAD']),
    sourceBranch: gitValue(repoRoot, ['branch', '--show-current']),
    fileCount: files.length,
    files
  }
}

function writePublicReleaseManifest(options = {}) {
  const manifest = buildPublicReleaseManifest(options)
  const targetDir = path.resolve(options.targetDir)
  fs.writeFileSync(
    path.join(targetDir, MANIFEST_FILE),
    `${JSON.stringify(manifest, null, 2)}\n`
  )
  return manifest
}

function verifyPublicReleaseManifest({ targetDir = process.cwd() } = {}) {
  const resolvedTarget = path.resolve(targetDir)
  const manifestPath = path.join(resolvedTarget, MANIFEST_FILE)
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`${MANIFEST_FILE} is missing`)
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  if (!manifest || manifest.schemaVersion !== 1 || !Array.isArray(manifest.files)) {
    throw new Error(`${MANIFEST_FILE} format is invalid`)
  }

  const actualFiles = listReleaseFiles(resolvedTarget)
  const expectedFiles = manifest.files.map((entry) => normalizeRepoPath(entry.path)).sort()
  const missing = expectedFiles.filter((relativePath) => !actualFiles.includes(relativePath))
  const extra = actualFiles.filter((relativePath) => !expectedFiles.includes(relativePath))
  if (missing.length || extra.length) {
    throw new Error(`public release file drift detected; missing=${missing.join(',') || '-'} extra=${extra.join(',') || '-'}`)
  }

  for (const entry of manifest.files) {
    const relativePath = normalizeRepoPath(entry.path)
    const filePath = path.join(resolvedTarget, relativePath)
    const actualSha = sha256File(filePath)
    if (actualSha !== entry.sha256) {
      throw new Error(`sha256 mismatch for ${relativePath}`)
    }
    const actualBytes = fileBytes(filePath)
    if (actualBytes !== entry.bytes) {
      throw new Error(`byte size mismatch for ${relativePath}`)
    }
  }

  return {
    ok: true,
    targetDir: resolvedTarget,
    files: manifest.files.length,
    sourceCommit: manifest.sourceCommit || null
  }
}

function parseArgs(argv) {
  const args = { targetDir: process.cwd() }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--target') {
      args.targetDir = argv[index + 1] || null
      index += 1
    } else {
      throw new Error(`unknown argument: ${arg}`)
    }
  }
  return args
}

if (require.main === module) {
  try {
    const result = verifyPublicReleaseManifest(parseArgs(process.argv.slice(2)))
    console.log(JSON.stringify(result, null, 2))
  } catch (error) {
    console.error(error && error.message ? error.message : String(error))
    process.exitCode = 1
  }
}

module.exports = {
  MANIFEST_FILE,
  buildPublicReleaseManifest,
  writePublicReleaseManifest,
  verifyPublicReleaseManifest
}
