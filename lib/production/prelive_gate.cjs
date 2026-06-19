'use strict'

const { validateEnvironment } = require('./env_policy.cjs')
const { buildLiveReadinessReport } = require('./readiness.cjs')
const { buildCanaryLimitsReport } = require('./canary_limits.cjs')

function buildPreLiveAssessment({
  mode,
  env,
  validations = {},
  workflow = {},
  actions = {},
  recoveryActions = [],
  signerMetadata = {},
  canaryLimits = null,
  executionIntent = null
}) {
  const envReport = validateEnvironment(env, { mode })
  const canaryReport = buildCanaryLimitsReport({
    mode,
    canaryLimits,
    executionIntent
  })
  const readiness = buildLiveReadinessReport({
    validations,
    workflow,
    actions,
    signerMetadata,
    canaryLimits: canaryReport,
    requiredEnv: envReport.requiredKeys.reduce((result, key) => {
      result[key] = env?.[key]
      return result
    }, {}),
    recoveryActions
  })

  return {
    mode: envReport.mode,
    envReport,
    canaryReport,
    readiness,
    ready: envReport.ok && readiness.ready
  }
}

function assertPreLiveReady(payload) {
  const assessment = buildPreLiveAssessment(payload)

  if (!assessment.ready) {
    throw new Error(`pre-live gate blocked: ${assessment.readiness.blockers.join(', ') || assessment.envReport.missingKeys.join(', ')}`)
  }

  return assessment
}

module.exports = {
  buildPreLiveAssessment,
  assertPreLiveReady
}
