#!/usr/bin/env node
'use strict'

const path = require('path')

const {
  copyPublicReleaseFiles
} = require('./export_public_release.cjs')

function auditPublicReleaseBoundary({
  repoRoot = path.resolve(__dirname, '..'),
  targetDir = path.resolve(repoRoot, 'dist', 'public-release-audit')
} = {}) {
  process.env.STRICT_PUBLIC_RELEASE = '1'
  process.env.PUBLIC_RELEASE_EXPORT = '1'
  return copyPublicReleaseFiles({
    repoRoot,
    targetDir
  })
}

if (require.main === module) {
  try {
    const result = auditPublicReleaseBoundary()
    console.log(JSON.stringify({
      ok: true,
      targetDir: result.targetDir,
      releaseFiles: result.releaseFiles.length,
      copiedFiles: result.copiedFiles
    }, null, 2))
  } catch (error) {
    console.error(error && error.message ? error.message : String(error))
    process.exit(1)
  }
}

module.exports = {
  auditPublicReleaseBoundary
}
