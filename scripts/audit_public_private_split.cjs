#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const FORBIDDEN_TRACKED_PATHS = [
  'server/',
  'server-data/',
  'scripts/license_server.cjs',
  'scripts/license_admin.cjs',
  'start admin.cmd',
  'start bot.cmd'
]

const REQUIRED_IGNORED_PRIVATE_PATHS = [
  'server/planner/remote_planner.cjs',
  'server/licensing/http_server.cjs',
  'scripts/license_server.cjs',
  'scripts/license_admin.cjs',
  'start admin.cmd',
  'start bot.cmd'
]

const SECRET_PATTERNS = [
  {
    name: 'pem-private-key',
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/
  },
  {
    name: 'raw-bot-private-key-env',
    pattern: /^BOT_PRIVATE_KEY\s*=\s*(?:0x)?[0-9a-fA-F]{64}\s*$/m
  },
  {
    name: 'literal-license-admin-secret',
    pattern: /^LICENSE_ADMIN_SECRET\s*=\s*\S{16,}\s*$/m
  },
  {
    name: 'literal-license-key-pepper',
    pattern: /^LICENSE_KEY_PEPPER\s*=\s*\S{16,}\s*$/m
  },
  {
    name: 'literal-license-session-pepper',
    pattern: /^LICENSE_SESSION_PEPPER\s*=\s*\S{16,}\s*$/m
  },
  {
    name: 'literal-local-api-token',
    pattern: /^OPERATOR_LOCAL_API_TOKEN\s*=\s*\S{16,}\s*$/m
  }
]

const PRIVATE_RUNTIME_REFERENCE_PATTERNS = [
  {
    name: 'private-server-module-reference',
    pattern: /(?:require\s*\(|import\s*\(|from\s+|["'`])[^"'`\n]*(?:server[\\/](?:planner|licensing)|scripts[\\/]license_(?:admin|server)\.cjs|start (?:admin|bot)\.cmd)/i
  }
]

const PUBLIC_EXECUTABLE_BUILDER_PATTERNS = [
  {
    name: 'open-calldata-builder',
    pattern: /\bbuildMintExecutionRequests\b/
  },
  {
    name: 'close-claim-calldata-builder',
    pattern: /\bbuildExitExecutionRequests\b/
  },
  {
    name: 'setup-to-executable-plan-builder',
    pattern: /\bbuildExecutionPlanFromSetup\b/
  },
  {
    name: 'swap-calldata-builder',
    pattern: /\bbuildSwapExecutionRequests\b|\bbuildAutoswapExecution\b/
  },
  {
    name: 'mint-plan-builder',
    pattern: /\bbuild(?:Mint|SpotMint)TransactionPlan(?:V4|UniswapV4)?\b/
  },
  {
    name: 'premium-calldata-sink',
    pattern: /\.encodeFunctionData\(\s*['"`](?:mint|decreaseLiquidity|collect|burn|modifyLiquidities|exactInput|exactInputSingle|swapExactETHForTokensSupportingFeeOnTransferTokens|swapExactTokensForETHSupportingFeeOnTransferTokens|swapExactTokensForTokensSupportingFeeOnTransferTokens|execute)['"`]/
  }
]

const PUBLIC_DEV_BYPASS_PATTERNS = [
  {
    name: 'insecure-license-transport-env-bypass',
    pattern: /\bOPERATOR_LICENSE_ALLOW_INSECURE_TRANSPORT\b/
  },
  {
    name: 'license-required-disabled-env',
    pattern: /\bOPERATOR_LICENSE_REQUIRED\s*=\s*['"`]?0\b/
  },
  {
    name: 'remote-planner-required-disabled-env',
    pattern: /\bREMOTE_PLANNER_REQUIRED\s*=\s*['"`]?0\b|\bOPERATOR_REMOTE_PLANNER_REQUIRED\s*=\s*['"`]?0\b/
  },
  {
    name: 'license-required-false-literal',
    pattern: /\blicenseRequired\s*:\s*false\b/
  },
  {
    name: 'remote-planner-required-false-literal',
    pattern: /\bremotePlannerRequired\s*:\s*false\b/
  }
]

const PUBLIC_EXECUTABLE_RUNTIME_PATH_PATTERNS = [
  {
    name: 'premium-plan-module',
    pattern: /^lib\/plans\/.+\.cjs$/i
  },
  {
    name: 'premium-request-builders',
    pattern: /^lib\/execution\/request_builders\.cjs$/i
  },
  {
    name: 'premium-setup-bridge',
    pattern: /^lib\/execution\/setup_bridge\.cjs$/i
  },
  {
    name: 'premium-autoswap-execution',
    pattern: /^lib\/execution\/autoswap_execution\.cjs$/i
  },
  {
    name: 'premium-close-bridge',
    pattern: /^lib\/execution\/close_bridge\.cjs$/i
  },
  {
    name: 'premium-fork-actions',
    pattern: /^lib\/execution\/fork_actions\.cjs$/i
  },
  {
    name: 'premium-service-layer',
    pattern: /^lib\/v3_service_layer\.cjs$/i
  }
]

const PUBLIC_RELEASE_SKIP_TOP_LEVEL = new Set([
  '.git',
  '.playwright-cli',
  '.playwright-mcp',
  '.tmp',
  '.tmp-wbnb-open',
  'cache',
  'coverage',
  'dist',
  'build',
  'node_modules',
  'output',
  'search-only',
  'server',
  'server-data',
  'state',
  'status',
  'test-results',
  'tests'
])

const PUBLIC_RELEASE_SKIP_FILE_NAMES = new Set([
  '.env',
  '.env.local',
  'start admin.cmd',
  'start bot.cmd',
  'npm-debug.log',
  'yarn-debug.log',
  'yarn-error.log'
])

const FILESYSTEM_AUDIT_SKIP_DIRS = new Set([
  '.git',
  '.playwright-cli',
  '.playwright-mcp',
  '.tmp',
  'build',
  'cache',
  'coverage',
  'dist',
  'node_modules',
  'output',
  'test-results'
])

const PUBLIC_RELEASE_SKIP_PATH_PATTERNS = [
  /^docs\//i,
  /^docs\/superpowers\//i,
  /^scripts\/serve_operator_ui\.cjs$/i,
  /^scripts\/(?:launch_operator_ui_stack|stop_operator_ui_stack|rpc_proxy_server|serve_rpc_proxy|fork_timeout_profile)\.cjs$/i,
  /^scripts\/(?:validate_|run_).+\.cjs$/i,
  /^scripts\/license_(?:admin|server)\.cjs$/i,
  /^(?!(?:README|SECURITY_RULES)\.md$).*\.md$/i,
  /^.*(?:ENGINEERING_MEMORY|LIVE_EXECUTION_GUARDRAILS|MANAGE_GUARDRAILS|BIDASK_MATH_GUARDRAILS|SWAP_GUARDRAILS|POOL_SEARCH_MASTER_RUNBOOK|LIVE_TEST_GUIDE|PRODUCTION_RUNBOOK|ARCHITECTURE|PLAN|EXECPLAN|RUNBOOK).*\.md$/i,
  /^\.env(?:\.|$)/i,
  /(^|\/)\.env(?:\.|$)/i,
  /\.(?:log|pid|sqlite|sqlite-shm|sqlite-wal)$/i,
  /^search.*\.json$/i,
  /^(?!ui\/app-icon-64\.png$).*\.(?:png|jpe?g)$/i,
  /^swap-.*\.png$/i
]

function normalizeRepoPath(value) {
  return String(value || '').replace(/\\/g, '/')
}

function hasOwnGitMetadata(repoRoot) {
  return fs.existsSync(path.join(repoRoot, '.git'))
}

function listTrackedFiles(repoRoot) {
  const result = spawnSync('git', ['ls-files', '-z'], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 15000
  })
  if (result.status !== 0) {
    throw new Error(`git ls-files failed: ${(result.stderr || result.stdout || '').trim()}`)
  }
  return result.stdout.split('\0').filter(Boolean).map(normalizeRepoPath)
}

function listFilesystemFiles(repoRoot) {
  const files = []
  const root = path.resolve(repoRoot)

  function walk(currentDir, relativeDir = '') {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true })
    for (const entry of entries) {
      const relativePath = normalizeRepoPath(path.join(relativeDir, entry.name))
      if (entry.isDirectory()) {
        const [top] = relativePath.split('/')
        if (FILESYSTEM_AUDIT_SKIP_DIRS.has(top) || FILESYSTEM_AUDIT_SKIP_DIRS.has(entry.name)) {
          continue
        }
        walk(path.join(currentDir, entry.name), relativePath)
        continue
      }
      if (entry.isFile()) {
        files.push(relativePath)
      }
    }
  }

  walk(root)
  return files
}

function listNonIgnoredUntrackedFiles(repoRoot) {
  const result = spawnSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 15000
  })
  if (result.status !== 0) {
    throw new Error(`git ls-files --others failed: ${(result.stderr || result.stdout || '').trim()}`)
  }
  return result.stdout.split('\0').filter(Boolean).map(normalizeRepoPath)
}

function listAuditFiles(repoRoot) {
  if (!hasOwnGitMetadata(repoRoot)) {
    return listFilesystemFiles(repoRoot)
  }
  return [...new Set([
    ...listTrackedFiles(repoRoot),
    ...listNonIgnoredUntrackedFiles(repoRoot)
  ])]
}

function defaultIsIgnored(repoRoot, relativePath) {
  const result = spawnSync('git', ['check-ignore', '-q', '--', relativePath], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 15000
  })
  return result.status === 0
}

function defaultReadFile(repoRoot, relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')
}

function isForbiddenTrackedPath(relativePath) {
  const normalized = normalizeRepoPath(relativePath)
  return FORBIDDEN_TRACKED_PATHS.some((forbiddenPath) => {
    const forbidden = normalizeRepoPath(forbiddenPath)
    return forbidden.endsWith('/')
      ? normalized.startsWith(forbidden)
      : normalized === forbidden
  })
}

function isRuntimeAuditFile(relativePath) {
  const normalized = normalizeRepoPath(relativePath)
  if (!normalized) return false
  if (normalized.startsWith('tests/')) return false
  if (normalized.startsWith('docs/')) return false
  if (normalized === 'scripts/audit_public_private_split.cjs') return false
  if (/\.md$/i.test(normalized)) return false
  if (/package-lock\.json$/i.test(normalized)) return false
  return /\.(?:cjs|mjs|js|html|json)$/i.test(normalized) || normalized === 'package.json'
}

function isForbiddenPublicReleaseRuntimePath(relativePath) {
  const normalized = normalizeRepoPath(relativePath)
  return PUBLIC_EXECUTABLE_RUNTIME_PATH_PATTERNS.find((entry) => entry.pattern.test(normalized)) || null
}

function isPublicReleaseFilePath(relativePath) {
  const normalized = normalizeRepoPath(relativePath).replace(/^\/+/, '')
  if (!normalized) return false
  const [top] = normalized.split('/')
  if (PUBLIC_RELEASE_SKIP_TOP_LEVEL.has(top)) return false
  if (PUBLIC_RELEASE_SKIP_FILE_NAMES.has(path.basename(normalized))) return false
  if (isForbiddenTrackedPath(normalized)) return false
  if (isForbiddenPublicReleaseRuntimePath(normalized)) return false
  if (PUBLIC_RELEASE_SKIP_PATH_PATTERNS.some((pattern) => pattern.test(normalized))) return false
  return true
}

function auditPublicPrivateSplit({
  repoRoot = path.resolve(__dirname, '..'),
  trackedFiles = listAuditFiles(repoRoot),
  ignoredPaths = null,
  readFile = (relativePath) => defaultReadFile(repoRoot, relativePath),
  isIgnored = (relativePath) => defaultIsIgnored(repoRoot, relativePath),
  strictReleaseBoundary = process.env.STRICT_PUBLIC_RELEASE === '1',
  publicReleaseExport = process.env.PUBLIC_RELEASE_EXPORT === '1',
  artifactBoundary = null
} = {}) {
  const effectiveArtifactBoundary = artifactBoundary == null
    ? !hasOwnGitMetadata(repoRoot)
    : Boolean(artifactBoundary)
  const effectiveIgnoredPaths = ignoredPaths == null
    ? (hasOwnGitMetadata(repoRoot) ? REQUIRED_IGNORED_PRIVATE_PATHS : [])
    : ignoredPaths
  const listedTrackedFiles = trackedFiles.map(normalizeRepoPath)
  const normalizedTrackedFiles = publicReleaseExport
    ? listedTrackedFiles.filter(isPublicReleaseFilePath)
    : listedTrackedFiles
  const trackedPrivatePaths = listedTrackedFiles.filter(isForbiddenTrackedPath)
  if (!publicReleaseExport && trackedPrivatePaths.length) {
    throw new Error(`private paths are tracked in the public repo: ${trackedPrivatePaths.join(', ')}`)
  }

  if (publicReleaseExport && effectiveArtifactBoundary) {
    const forbiddenPublicRuntimePaths = listedTrackedFiles
      .map((relativePath) => ({
        relativePath,
        forbiddenRuntimePath: isForbiddenPublicReleaseRuntimePath(relativePath)
      }))
      .filter((entry) => entry.forbiddenRuntimePath)
      .map((entry) => `${entry.relativePath}:${entry.forbiddenRuntimePath.name}`)
    if (forbiddenPublicRuntimePaths.length) {
      throw new Error(`forbidden runtime paths were found in public release files: ${forbiddenPublicRuntimePaths.join(', ')}`)
    }
  }

  const missingIgnores = publicReleaseExport
    ? []
    : effectiveIgnoredPaths
    .map(normalizeRepoPath)
    .filter((relativePath) => !isIgnored(relativePath))
  if (missingIgnores.length) {
    throw new Error(`private paths are not ignored: ${missingIgnores.join(', ')}`)
  }

  const secretFindings = []
  for (const relativePath of listedTrackedFiles) {
    let content
    try {
      content = readFile(relativePath)
    } catch {
      continue
    }
    for (const secretPattern of SECRET_PATTERNS) {
      if (secretPattern.pattern.test(content)) {
        secretFindings.push(`${relativePath}:${secretPattern.name}`)
      }
    }
  }
  if (secretFindings.length) {
    throw new Error(`literal secrets were found in tracked files: ${secretFindings.join(', ')}`)
  }

  const privateRuntimeReferenceFindings = []
  for (const relativePath of normalizedTrackedFiles.filter(isRuntimeAuditFile)) {
    let content
    try {
      content = readFile(relativePath)
    } catch {
      continue
    }
    for (const referencePattern of PRIVATE_RUNTIME_REFERENCE_PATTERNS) {
      if (referencePattern.pattern.test(content)) {
        privateRuntimeReferenceFindings.push(`${relativePath}:${referencePattern.name}`)
      }
    }
  }
  if (privateRuntimeReferenceFindings.length) {
    throw new Error(`private runtime references were found in tracked files: ${privateRuntimeReferenceFindings.join(', ')}`)
  }

  if (strictReleaseBoundary) {
    const executableBuilderFindings = []
    for (const relativePath of normalizedTrackedFiles.filter(isRuntimeAuditFile)) {
      const forbiddenRuntimePath = isForbiddenPublicReleaseRuntimePath(relativePath)
      if (forbiddenRuntimePath) {
        executableBuilderFindings.push(`${relativePath}:${forbiddenRuntimePath.name}`)
      }

      let content
      try {
        content = readFile(relativePath)
      } catch {
        continue
      }
      for (const builderPattern of PUBLIC_EXECUTABLE_BUILDER_PATTERNS) {
        if (builderPattern.pattern.test(content)) {
          executableBuilderFindings.push(`${relativePath}:${builderPattern.name}`)
        }
      }
      for (const bypassPattern of PUBLIC_DEV_BYPASS_PATTERNS) {
        if (bypassPattern.pattern.test(content)) {
          executableBuilderFindings.push(`${relativePath}:${bypassPattern.name}`)
        }
      }
    }
    if (executableBuilderFindings.length) {
      throw new Error(`executable transaction builders were found in public runtime files: ${executableBuilderFindings.join(', ')}`)
    }
  }

  return {
    ok: true,
    checkedTrackedFiles: normalizedTrackedFiles.length,
    listedTrackedFiles: listedTrackedFiles.length,
    checkedIgnoredPaths: effectiveIgnoredPaths.length,
    strictReleaseBoundary: Boolean(strictReleaseBoundary),
    publicReleaseExport: Boolean(publicReleaseExport),
    artifactBoundary: Boolean(effectiveArtifactBoundary)
  }
}

if (require.main === module) {
  try {
    const result = auditPublicPrivateSplit()
    console.log(JSON.stringify(result, null, 2))
  } catch (error) {
    console.error(error && error.message ? error.message : String(error))
    process.exitCode = 1
  }
}

module.exports = {
  auditPublicPrivateSplit,
  listAuditFiles,
  listNonIgnoredUntrackedFiles,
  isForbiddenPublicReleaseRuntimePath,
  isPublicReleaseFilePath
}
