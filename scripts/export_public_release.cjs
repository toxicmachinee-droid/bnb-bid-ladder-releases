#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const {
  auditPublicPrivateSplit,
  isPublicReleaseFilePath,
  listAuditFiles
} = require('./audit_public_private_split.cjs')
const {
  MANIFEST_FILE,
  writePublicReleaseManifest,
  verifyPublicReleaseManifest
} = require('./verify_public_release_manifest.cjs')

function parseArgs(argv) {
  const args = {
    dryRun: false,
    targetDir: null
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--dry-run') {
      args.dryRun = true
    } else if (arg === '--target') {
      args.targetDir = argv[index + 1] || null
      index += 1
    } else {
      throw new Error(`unknown argument: ${arg}`)
    }
  }
  return args
}

function assertSafeTarget(repoRoot, targetDir) {
  const resolvedTarget = path.resolve(targetDir)
  const distRoot = path.resolve(repoRoot, 'dist')
  const relative = path.relative(distRoot, resolvedTarget)
  if (relative.startsWith('..') || path.isAbsolute(relative) || !relative) {
    throw new Error(`public release target must be inside ${distRoot}`)
  }
  return resolvedTarget
}

function rewritePackageJsonForPublicRelease(sourcePath, targetPath) {
  const body = JSON.parse(fs.readFileSync(sourcePath, 'utf8'))
  body.scripts = {
    'audit:public-private': 'powershell -NoProfile -Command "$env:STRICT_PUBLIC_RELEASE=\'1\'; $env:PUBLIC_RELEASE_EXPORT=\'1\'; node ./scripts/audit_public_private_split.cjs"',
    'audit:public-release-boundary': 'node ./scripts/audit_public_release_boundary.cjs',
    'audit:public-manifest': 'node ./scripts/verify_public_release_manifest.cjs'
  }
  fs.mkdirSync(path.dirname(targetPath), { recursive: true })
  fs.writeFileSync(targetPath, `${JSON.stringify(body, null, 2)}\n`)
}

function copyPublicReleaseFiles({
  repoRoot = path.resolve(__dirname, '..'),
  targetDir = null,
  dryRun = false
} = {}) {
  targetDir = targetDir || path.resolve(repoRoot, 'dist', 'public-release')
  const safeTargetDir = assertSafeTarget(repoRoot, targetDir)
  const releaseCandidateFiles = listAuditFiles(repoRoot)
  const releaseFiles = releaseCandidateFiles.filter(isPublicReleaseFilePath)

  auditPublicPrivateSplit({
    repoRoot,
    trackedFiles: releaseCandidateFiles,
    publicReleaseExport: true
  })

  if (dryRun) {
    return {
      repoRoot: path.resolve(repoRoot),
      targetDir: safeTargetDir,
      copiedFiles: 0,
      releaseFiles
    }
  }

  fs.rmSync(safeTargetDir, { recursive: true, force: true })
  fs.mkdirSync(safeTargetDir, { recursive: true })

  for (const relativePath of releaseFiles) {
    const sourcePath = path.join(repoRoot, relativePath)
    const targetPath = path.join(safeTargetDir, relativePath)
    if (relativePath === 'package.json') {
      rewritePackageJsonForPublicRelease(sourcePath, targetPath)
      continue
    }
    fs.mkdirSync(path.dirname(targetPath), { recursive: true })
    fs.copyFileSync(sourcePath, targetPath)
  }

  auditPublicPrivateSplit({
    repoRoot: safeTargetDir,
    ignoredPaths: [],
    artifactBoundary: true
  })
  writePublicReleaseManifest({
    repoRoot,
    targetDir: safeTargetDir
  })
  verifyPublicReleaseManifest({
    targetDir: safeTargetDir
  })

  return {
    repoRoot: path.resolve(repoRoot),
    targetDir: safeTargetDir,
    copiedFiles: releaseFiles.length + 1,
    releaseFiles: [...releaseFiles, MANIFEST_FILE].sort()
  }
}

if (require.main === module) {
  try {
    const args = parseArgs(process.argv.slice(2))
    const result = copyPublicReleaseFiles(args)
    console.log(JSON.stringify({
      ok: true,
      targetDir: result.targetDir,
      copiedFiles: result.copiedFiles,
      releaseFiles: result.releaseFiles.length
    }, null, 2))
  } catch (error) {
    console.error(error && error.message ? error.message : String(error))
    process.exitCode = 1
  }
}

module.exports = {
  copyPublicReleaseFiles
}
