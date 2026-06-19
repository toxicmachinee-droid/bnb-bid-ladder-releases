'use strict'

const { buildSwapPolicy, assessSwapRoute } = require('../execution/swap_policy.cjs')
const { deriveRecoveryActions } = require('../state/recovery.cjs')
const { buildDashboardState } = require('../operator/dashboard.cjs')
const { buildRestartRecoverySnapshot } = require('../production/restart_recovery.cjs')
const { issueLivePermit, assertLiveExecutionGate } = require('../production/live_gate.cjs')
const { evaluatePoolCandidates } = require('../discovery/evaluation.cjs')
const { preflightExecutionPlan } = require('../execution/preflight.cjs')

async function runScenarioSuite() {
  const scenarios = []

  const blockedAutoswapPolicy = buildSwapPolicy({
    enabled: true,
    maxSlippageBps: 200,
    minRouteLiquidityUsd: 10_000,
    allowFallbackHold: false
  })
  const blockedAutoswap = assessSwapRoute({
    liquidityUsd: 2_000,
    priceImpactBps: 600
  }, blockedAutoswapPolicy)
  scenarios.push({
    name: 'blocked_autoswap_route',
    ok: blockedAutoswap.action === 'block',
    details: blockedAutoswap
  })

  const preflight = await preflightExecutionPlan({
    signer: {
      async call(request) {
        if (request.to === '0xdead') {
          throw new Error('simulated revert')
        }

        return '0x'
      }
    },
    requests: [
      { to: '0xgood' },
      { to: '0xdead' }
    ]
  })
  scenarios.push({
    name: 'partial_preflight_failure',
    ok: preflight.ok === false && preflight.results.filter((result) => result.ok).length === 1,
    details: {
      ok: preflight.ok,
      results: preflight.results.map((result) => ({ index: result.index, ok: result.ok }))
    }
  })

  const evaluation = evaluatePoolCandidates([
    { id: 'ref', liquidityUsd: 50_000, price: 1.0 },
    { id: 'bad-1', liquidityUsd: 30_000, price: 1.2 },
    { id: 'bad-2', liquidityUsd: 20_000, price: 1.15 }
  ], {
    minLiquidityUsd: 1_000,
    warningThresholdBps: 300,
    blockThresholdBps: 1_000
  })
  scenarios.push({
    name: 'discovery_all_candidates_blocked_except_reference',
    ok: evaluation.accepted.length === 1 && evaluation.blocked.length === 2,
    details: {
      accepted: evaluation.accepted.length,
      blocked: evaluation.blocked.length
    }
  })

  const recoveryActions = deriveRecoveryActions({
    executionJournal: {
      entries: [
        { executionId: 'exec-1', status: 'submitted', txHash: '0xabc' }
      ]
    },
    positionSnapshots: {
      positions: [
        { positionId: 'pos-1', status: 'open' }
      ]
    }
  })
  const dashboard = buildDashboardState({
    executionJournal: {
      entries: [
        { executionId: 'exec-1', status: 'submitted', txHash: '0xabc' }
      ]
    },
    snapshotBook: {
      positions: [
        { positionId: 'pos-1', tokenId: '1', status: 'open', dex: 'pancakeswap', poolAddress: '0xpool', outOfRange: true }
      ]
    },
    monitorSummaryBook: {
      summary: {
        openPositions: 1,
        outOfRangePositions: 1,
        stalePositions: 0,
        alerts: [{ type: 'position_out_of_range', severity: 'warning', positionId: 'pos-1' }]
      }
    },
    pnlSnapshots: {
      positions: [],
      walletSummary: {
        positions: 1,
        totalCostBasisQuote: 1000,
        totalCurrentValueQuote: 900,
        totalAccruedFeesQuote: 0,
        totalValueQuote: 900,
        totalUnrealizedPnlQuote: -100
      }
    },
    closeCards: { cards: [] },
    discoveryReports: { reports: [] },
    executionExtensionSummaries: { summaries: [] },
    recoveryActions
  })
  const restart = buildRestartRecoverySnapshot({
    executionJournal: {
      entries: [
        { executionId: 'exec-1', status: 'submitted', txHash: '0xabc' }
      ]
    },
    positionSnapshots: {
      positions: [
        { positionId: 'pos-1', status: 'open' }
      ]
    },
    dashboard
  })
  scenarios.push({
    name: 'restart_recovery_blocks_execution_on_pending_work',
    ok: restart.blocked === true && dashboard.actions.canExecute === false,
    details: {
      blocked: restart.blocked,
      recoveryActions: restart.recoveryActions.length,
      canExecute: dashboard.actions.canExecute
    }
  })

  const expiredPermit = issueLivePermit({
    approver: 'operator',
    reason: 'expired',
    ttlMs: 1,
    issuedAt: '2026-04-01T00:00:00.000Z'
  })
  let expiredPermitBlocked = false

  try {
    assertLiveExecutionGate({
      mode: 'live',
      env: {
        BSC_RPC_URL: 'https://rpc.example',
        BOT_KEYSTORE_WALLET_ID: 'wallet-live',
        BOT_WALLET_ADDRESS: '0x000000000000000000000000000000000000dEaD'
      },
      validations: {
        service: true,
        operator: true,
        fork: true
      },
      workflow: {
        blocked: false,
        blockers: []
      },
      actions: {
        canExecute: true
      },
      recoveryActions: [],
      signerMetadata: {
        source: 'keystore',
        expectedWalletAddress: '0x000000000000000000000000000000000000dEaD',
        actualWalletAddress: '0x000000000000000000000000000000000000dEaD',
        expectedKeystoreWalletId: 'wallet-live',
        actualKeystoreWalletId: 'wallet-live'
      },
      livePermit: expiredPermit,
      now: '2026-04-01T00:00:30.000Z'
    })
  } catch (_) {
    expiredPermitBlocked = true
  }

  scenarios.push({
    name: 'expired_live_permit_blocks_execution',
    ok: expiredPermitBlocked,
    details: {
      expiredPermitBlocked
    }
  })

  return {
    ok: scenarios.every((scenario) => scenario.ok),
    scenarios
  }
}

module.exports = {
  runScenarioSuite
}
