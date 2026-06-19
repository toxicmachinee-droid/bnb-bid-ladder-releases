'use strict'

const { persistOpenedPositionsFromExecution, persistClosedPositionsFromExecution } = require('./position_lifecycle.cjs')
const { persistMonitorSummary } = require('../monitor/summary.cjs')
const { persistPnlFromSnapshots } = require('../pnl/pipeline.cjs')
const { buildDashboardStateFromStore } = require('../operator/dashboard.cjs')
const { persistOperatorSnapshot } = require('../operator/snapshot.cjs')

function summarizeExecutionResult(executionResult = {}) {
  const hashes = Array.isArray(executionResult.executions)
    ? executionResult.executions.map((execution) => execution?.hash).filter(Boolean)
    : []

  return {
    ok: Boolean(executionResult.ok),
    mode: executionResult.mode || null,
    executionCount: Array.isArray(executionResult.executions) ? executionResult.executions.length : 0,
    preflightOk: Boolean(executionResult.preflight?.ok),
    txHashes: hashes
  }
}

function sumStageDurations(stages = []) {
  return (Array.isArray(stages) ? stages : []).reduce((sum, stage) => {
    return sum + Math.max(0, Number(stage?.durationMs || 0))
  }, 0)
}

function normalizeCloseTiming(timing = {}) {
  const startedAtMs = Number(timing.startedAtMs || 0)
  const completedAtMs = Number(timing.completedAtMs || 0)
  const perPosition = Array.isArray(timing.perPosition) ? timing.perPosition : []
  const stageTotals = {}
  let receiptWaitMs = 0
  let perPositionTotalMs = 0
  let perPositionStageMs = 0

  for (const positionTiming of perPosition) {
    const stages = Array.isArray(positionTiming?.stages) ? positionTiming.stages : []
    const positionTotalMs = Math.max(0, Number(positionTiming?.totalMs || 0))
    perPositionTotalMs += positionTotalMs
    perPositionStageMs += sumStageDurations(stages)
    for (const stage of stages) {
      const name = String(stage?.stage || 'unknown')
      stageTotals[name] = (stageTotals[name] || 0) + Math.max(0, Number(stage?.durationMs || 0))
      receiptWaitMs += Math.max(0, Number(stage?.receiptWaitMs || 0))
    }
  }

  const sortedByStart = perPosition
    .map((item) => ({
      startedAtMs: Number(item?.startedAtMs || 0),
      completedAtMs: Number(item?.completedAtMs || 0)
    }))
    .filter((item) => item.startedAtMs > 0 || item.completedAtMs > 0)
    .sort((a, b) => a.startedAtMs - b.startedAtMs)

  const firstStartedAtMs = sortedByStart[0]?.startedAtMs || startedAtMs
  const lastCompletedAtMs = sortedByStart.reduce((max, item) => Math.max(max, item.completedAtMs), 0)
  const totalMs = Math.max(0, Number(timing.totalMs ?? (completedAtMs - startedAtMs) ?? 0))
  const preLoopMs = startedAtMs > 0 && firstStartedAtMs > startedAtMs
    ? firstStartedAtMs - startedAtMs
    : 0
  const postLoopMs = completedAtMs > 0 && lastCompletedAtMs > 0 && completedAtMs > lastCompletedAtMs
    ? completedAtMs - lastCompletedAtMs
    : 0
  const uninstrumentedMs = Math.max(0, totalMs - preLoopMs - postLoopMs - perPositionStageMs)

  return {
    ...timing,
    totalMs,
    preLoopMs,
    postLoopMs,
    perPositionTotalMs,
    perPositionStageMs,
    receiptWaitMs,
    uninstrumentedMs,
    stageTotals
  }
}

function persistOpenPositionFlow({
  store,
  execution,
  poolRuntime,
  mintedTokenIds,
  onchainPositions,
  executionResult = null,
  alerts = [],
  defenseAssessment = null,
  postTradeVerification = null,
  traceContext = null
}) {
  const openedSnapshots = persistOpenedPositionsFromExecution({
    store,
    execution: {
      ...execution,
      poolRuntime
    },
    mintedTokenIds,
    onchainPositions,
    openedTxHash: executionResult?.mintTxHash || executionResult?.executions?.at(-1)?.hash || null
  })

  const snapshotBook = store.loadPositionSnapshots()
  persistMonitorSummary(store, snapshotBook, alerts, traceContext)
  persistPnlFromSnapshots(store, snapshotBook, { quoteSymbol: execution.plan.depositTokenSymbol }, traceContext)
  if (store?.appendDiagnosticTrace) {
    store.appendDiagnosticTrace({
      kind: 'position_open_flow_persisted',
      traceId: traceContext?.traceId || null,
      dex: execution.plan.dex,
      poolAddress: poolRuntime.poolAddress,
      mintedTokenIds: mintedTokenIds.map(String),
      openedPositions: openedSnapshots.length,
      requestedCapitalUsd: execution.plan.positions.reduce((sum, position) => sum + Number(position.budgetUsd || 0), 0),
      totalCostBasisQuote: Number(snapshotBook.positions
        .filter((position) => openedSnapshots.some((opened) => String(opened.positionId) === String(position.positionId || position.tokenId)))
        .reduce((sum, position) => sum + Number(position.deployedQuote || 0) + Number(position.entryCostsQuote || 0), 0)),
      totalCurrentValueQuote: Number(snapshotBook.positions
        .filter((position) => openedSnapshots.some((opened) => String(opened.positionId) === String(position.positionId || position.tokenId)))
        .reduce((sum, position) => sum + Number(position.currentValueQuote || 0), 0)),
      openedPositionValues: openedSnapshots.map((snapshot) => ({
        positionId: String(snapshot.positionId || snapshot.tokenId),
        deployedQuote: Number(snapshot.deployedQuote || 0),
        currentValueQuote: Number(snapshot.currentValueQuote || 0)
      }))
    })
  }
  store.appendExecutionEntry({
    kind: 'position_open',
    status: 'reconciled',
    txHash: executionResult?.executions?.[0]?.hash || null,
    receiptHash: executionResult?.executions?.at(-1)?.hash || null,
    dex: execution.plan.dex,
    poolAddress: poolRuntime.poolAddress,
    tokenIds: mintedTokenIds.map(String),
    summary: summarizeExecutionResult(executionResult),
    timing: executionResult?.timing || null,
    defense: defenseAssessment,
    postTradeVerification,
    traceId: traceContext?.traceId || null
  })

  const dashboard = buildDashboardStateFromStore(store)
  persistOperatorSnapshot(store, {
    executionJournal: store.loadExecutionJournal(),
    snapshotBook: store.loadPositionSnapshots(),
    monitorSummaryBook: store.loadMonitorSummary(),
    pnlSnapshots: store.loadPnlSnapshots(),
    closeCards: store.loadCloseCards(),
    discoveryReports: store.loadDiscoveryReports(),
    executionExtensionSummaries: store.loadExecutionExtensionSummaries(),
    recoveryActions: []
  })

  return {
    openedSnapshots,
    dashboard
  }
}

function persistClosePositionFlow({
  store,
  openedSnapshots,
  exitArtifacts,
  executionResult = null,
  alerts = [],
  defenseAssessment = null,
  postTradeVerification = null,
  traceContext = null
}) {
  const closeCards = persistClosedPositionsFromExecution({
    store,
    openedSnapshots,
    exitArtifacts
  })

  const snapshotBook = store.loadPositionSnapshots()
  persistMonitorSummary(store, snapshotBook, alerts, traceContext)
  persistPnlFromSnapshots(store, snapshotBook, {
    quoteSymbol: openedSnapshots[0]?.quoteSymbol || 'USDT'
  }, traceContext)
  if (store?.appendDiagnosticTrace) {
    store.appendDiagnosticTrace({
      kind: 'position_close_flow_persisted',
      traceId: traceContext?.traceId || null,
      dex: openedSnapshots[0]?.dex || null,
      poolAddress: openedSnapshots[0]?.poolAddress || null,
      closedPositions: closeCards.length,
      tokenIds: openedSnapshots.map((snapshot) => String(snapshot.tokenId || snapshot.positionId))
    })
  }
  store.appendExecutionEntry({
    kind: 'position_close',
    status: 'reconciled',
    txHash: executionResult?.executions?.[0]?.hash || null,
    receiptHash: executionResult?.executions?.at(-1)?.hash || null,
    dex: openedSnapshots[0]?.dex || null,
    poolAddress: openedSnapshots[0]?.poolAddress || null,
    tokenIds: openedSnapshots.map((snapshot) => String(snapshot.tokenId || snapshot.positionId)),
    summary: summarizeExecutionResult(executionResult),
    timing: executionResult?.timing || null,
    defense: defenseAssessment,
    postTradeVerification,
    traceId: traceContext?.traceId || null
  })

  const dashboard = buildDashboardStateFromStore(store)
  persistOperatorSnapshot(store, {
    executionJournal: store.loadExecutionJournal(),
    snapshotBook: store.loadPositionSnapshots(),
    monitorSummaryBook: store.loadMonitorSummary(),
    pnlSnapshots: store.loadPnlSnapshots(),
    closeCards: store.loadCloseCards(),
    discoveryReports: store.loadDiscoveryReports(),
    executionExtensionSummaries: store.loadExecutionExtensionSummaries(),
    recoveryActions: []
  })

  return {
    closeCards,
    dashboard
  }
}

function persistClaimedFeesFlow({
  store,
  updatedSnapshot,
  executionResult = null,
  alerts = [],
  traceContext = null
}) {
  store.upsertPositionSnapshot(updatedSnapshot)
  const snapshotBook = store.loadPositionSnapshots()
  persistMonitorSummary(store, snapshotBook, alerts, traceContext)
  persistPnlFromSnapshots(store, snapshotBook, {
    quoteSymbol: updatedSnapshot.quoteSymbol || 'USDT'
  }, traceContext)
  if (store?.appendDiagnosticTrace) {
    store.appendDiagnosticTrace({
      kind: 'position_collect_flow_persisted',
      traceId: traceContext?.traceId || null,
      dex: updatedSnapshot.dex || null,
      poolAddress: updatedSnapshot.poolAddress || null,
      tokenIds: [String(updatedSnapshot.tokenId || updatedSnapshot.positionId)]
    })
  }
  store.appendExecutionEntry({
    kind: 'position_collect',
    status: 'reconciled',
    txHash: executionResult?.executions?.[0]?.hash || null,
    receiptHash: executionResult?.executions?.at(-1)?.hash || null,
    dex: updatedSnapshot.dex || null,
    poolAddress: updatedSnapshot.poolAddress || null,
    tokenIds: [String(updatedSnapshot.tokenId || updatedSnapshot.positionId)],
    summary: summarizeExecutionResult(executionResult),
    timing: executionResult?.timing || null,
    traceId: traceContext?.traceId || null
  })

  const dashboard = buildDashboardStateFromStore(store)
  persistOperatorSnapshot(store, {
    executionJournal: store.loadExecutionJournal(),
    snapshotBook: store.loadPositionSnapshots(),
    monitorSummaryBook: store.loadMonitorSummary(),
    pnlSnapshots: store.loadPnlSnapshots(),
    closeCards: store.loadCloseCards(),
    discoveryReports: store.loadDiscoveryReports(),
    executionExtensionSummaries: store.loadExecutionExtensionSummaries(),
    recoveryActions: []
  })

  return {
    dashboard
  }
}

module.exports = {
  summarizeExecutionResult,
  normalizeCloseTiming,
  normalizeCloseTimingForTest: normalizeCloseTiming,
  persistOpenPositionFlow,
  persistClosePositionFlow,
  persistClaimedFeesFlow
}
