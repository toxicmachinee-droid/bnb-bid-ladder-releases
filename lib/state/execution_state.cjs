'use strict'

const path = require('path')
const { readJsonFile, writeJsonFile } = require('./storage.cjs')

const DEFAULT_STATE_DIR = path.resolve(__dirname, '..', '..', 'state')
const EXECUTION_JOURNAL_FILE = 'execution_journal.json'
const POSITION_SNAPSHOTS_FILE = 'position_snapshots.json'
const MONITOR_SUMMARY_FILE = 'monitor_summary.json'
const PNL_SNAPSHOTS_FILE = 'pnl_snapshots.json'
const CLOSE_CARDS_FILE = 'close_cards.json'
const DISCOVERY_REPORTS_FILE = 'discovery_reports.json'
const EXECUTION_EXTENSION_SUMMARIES_FILE = 'execution_extension_summaries.json'
const DASHBOARD_SNAPSHOTS_FILE = 'dashboard_snapshots.json'
const LIVE_APPROVALS_FILE = 'live_approvals.json'
const LIVE_SCENARIO_RUNS_FILE = 'live_scenario_runs.json'
const DIAGNOSTIC_TRACES_FILE = 'diagnostic_traces.json'

function defaultExecutionJournal() {
  return {
    version: 1,
    lastUpdated: null,
    entries: []
  }
}

function defaultPositionSnapshots() {
  return {
    version: 1,
    lastUpdated: null,
    positions: []
  }
}

function defaultMonitorSummary() {
  return {
    version: 1,
    lastUpdated: null,
    summary: {
      openPositions: 0,
      outOfRangePositions: 0,
      stalePositions: 0,
      alerts: []
    }
  }
}

function defaultPnlSnapshots() {
  return {
    version: 1,
    lastUpdated: null,
    positions: [],
    walletSummary: {
      positions: 0,
      totalCostBasisQuote: 0,
      totalCurrentValueQuote: 0,
      totalAccruedFeesQuote: 0,
      totalValueQuote: 0,
      totalUnrealizedPnlQuote: 0
    }
  }
}

function defaultCloseCards() {
  return {
    version: 1,
    lastUpdated: null,
    cards: []
  }
}

function defaultDiscoveryReports() {
  return {
    version: 1,
    lastUpdated: null,
    reports: []
  }
}

function defaultExecutionExtensionSummaries() {
  return {
    version: 1,
    lastUpdated: null,
    summaries: []
  }
}

function defaultDashboardSnapshots() {
  return {
    version: 1,
    lastUpdated: null,
    snapshots: []
  }
}

function defaultLiveApprovals() {
  return {
    version: 1,
    lastUpdated: null,
    approvals: []
  }
}

function defaultLiveScenarioRuns() {
  return {
    version: 1,
    lastUpdated: null,
    activeRunId: null,
    runs: []
  }
}

function defaultDiagnosticTraces() {
  return {
    version: 1,
    lastUpdated: null,
    traces: []
  }
}

function nowIso() {
  return new Date().toISOString()
}

function createExecutionStateStore(stateDir = DEFAULT_STATE_DIR) {
  const executionJournalPath = path.join(stateDir, EXECUTION_JOURNAL_FILE)
  const positionSnapshotsPath = path.join(stateDir, POSITION_SNAPSHOTS_FILE)
  const monitorSummaryPath = path.join(stateDir, MONITOR_SUMMARY_FILE)
  const pnlSnapshotsPath = path.join(stateDir, PNL_SNAPSHOTS_FILE)
  const closeCardsPath = path.join(stateDir, CLOSE_CARDS_FILE)
  const discoveryReportsPath = path.join(stateDir, DISCOVERY_REPORTS_FILE)
  const executionExtensionSummariesPath = path.join(stateDir, EXECUTION_EXTENSION_SUMMARIES_FILE)
  const dashboardSnapshotsPath = path.join(stateDir, DASHBOARD_SNAPSHOTS_FILE)
  const liveApprovalsPath = path.join(stateDir, LIVE_APPROVALS_FILE)
  const liveScenarioRunsPath = path.join(stateDir, LIVE_SCENARIO_RUNS_FILE)
  const diagnosticTracesPath = path.join(stateDir, DIAGNOSTIC_TRACES_FILE)

  function loadExecutionJournal() {
    return readJsonFile(executionJournalPath, defaultExecutionJournal())
  }

  function saveExecutionJournal(journal) {
    const nextJournal = {
      ...journal,
      lastUpdated: nowIso()
    }
    writeJsonFile(executionJournalPath, nextJournal)
    return nextJournal
  }

  function appendExecutionEntry(entry) {
    const journal = loadExecutionJournal()
    const nextEntry = {
      ...entry,
      recordedAt: entry.recordedAt || nowIso()
    }
    journal.entries.push(nextEntry)
    journal.entries = journal.entries.slice(-250)
    return saveExecutionJournal(journal)
  }

  function loadPositionSnapshots() {
    return readJsonFile(positionSnapshotsPath, defaultPositionSnapshots())
  }

  function savePositionSnapshots(snapshotBook) {
    const nextSnapshotBook = {
      ...snapshotBook,
      lastUpdated: nowIso()
    }
    writeJsonFile(positionSnapshotsPath, nextSnapshotBook)
    return nextSnapshotBook
  }

  function upsertPositionSnapshot(snapshot) {
    const snapshotBook = loadPositionSnapshots()
    const nextSnapshot = {
      ...snapshot,
      updatedAt: snapshot.updatedAt || nowIso()
    }
    const positionId = String(nextSnapshot.positionId || nextSnapshot.tokenId)
    const index = snapshotBook.positions.findIndex((item) => String(item.positionId || item.tokenId) === positionId)

    if (index >= 0) {
      snapshotBook.positions[index] = {
        ...snapshotBook.positions[index],
        ...nextSnapshot
      }
    } else {
      snapshotBook.positions.push(nextSnapshot)
    }

    return savePositionSnapshots(snapshotBook)
  }

  function markPositionClosed(positionId, closePatch = {}) {
    return upsertPositionSnapshot({
      positionId,
      status: 'closed',
      closedAt: closePatch.closedAt || nowIso(),
      ...closePatch
    })
  }

  function loadMonitorSummary() {
    return readJsonFile(monitorSummaryPath, defaultMonitorSummary())
  }

  function saveMonitorSummary(summaryBook) {
    const nextSummaryBook = {
      ...summaryBook,
      lastUpdated: nowIso()
    }
    writeJsonFile(monitorSummaryPath, nextSummaryBook)
    return nextSummaryBook
  }

  function loadPnlSnapshots() {
    return readJsonFile(pnlSnapshotsPath, defaultPnlSnapshots())
  }

  function savePnlSnapshots(pnlBook) {
    const nextPnlBook = {
      ...pnlBook,
      lastUpdated: nowIso()
    }
    writeJsonFile(pnlSnapshotsPath, nextPnlBook)
    return nextPnlBook
  }

  function loadCloseCards() {
    return readJsonFile(closeCardsPath, defaultCloseCards())
  }

  function saveCloseCards(closeBook) {
    const nextCloseBook = {
      ...closeBook,
      lastUpdated: nowIso()
    }
    writeJsonFile(closeCardsPath, nextCloseBook)
    return nextCloseBook
  }

  function appendCloseCard(card) {
    const closeBook = loadCloseCards()
    const nextCard = {
      ...card,
      recordedAt: card.recordedAt || nowIso()
    }
    closeBook.cards.push(nextCard)
    closeBook.cards = closeBook.cards.slice(-250)
    return saveCloseCards(closeBook)
  }

  function loadDiscoveryReports() {
    return readJsonFile(discoveryReportsPath, defaultDiscoveryReports())
  }

  function saveDiscoveryReports(reportBook) {
    const nextReportBook = {
      ...reportBook,
      lastUpdated: nowIso()
    }
    writeJsonFile(discoveryReportsPath, nextReportBook)
    return nextReportBook
  }

  function appendDiscoveryReport(report) {
    const reportBook = loadDiscoveryReports()
    const nextReport = {
      ...report,
      recordedAt: report.recordedAt || nowIso()
    }
    reportBook.reports.push(nextReport)
    reportBook.reports = reportBook.reports.slice(-100)
    return saveDiscoveryReports(reportBook)
  }

  function loadExecutionExtensionSummaries() {
    return readJsonFile(executionExtensionSummariesPath, defaultExecutionExtensionSummaries())
  }

  function saveExecutionExtensionSummaries(summaryBook) {
    const nextSummaryBook = {
      ...summaryBook,
      lastUpdated: nowIso()
    }
    writeJsonFile(executionExtensionSummariesPath, nextSummaryBook)
    return nextSummaryBook
  }

  function appendExecutionExtensionSummary(summary) {
    const summaryBook = loadExecutionExtensionSummaries()
    const nextSummary = {
      ...summary,
      recordedAt: summary.recordedAt || nowIso()
    }
    summaryBook.summaries.push(nextSummary)
    summaryBook.summaries = summaryBook.summaries.slice(-250)
    return saveExecutionExtensionSummaries(summaryBook)
  }

  function loadDashboardSnapshots() {
    return readJsonFile(dashboardSnapshotsPath, defaultDashboardSnapshots())
  }

  function saveDashboardSnapshots(snapshotBook) {
    const nextSnapshotBook = {
      ...snapshotBook,
      lastUpdated: nowIso()
    }
    writeJsonFile(dashboardSnapshotsPath, nextSnapshotBook)
    return nextSnapshotBook
  }

  function appendDashboardSnapshot(snapshot) {
    const snapshotBook = loadDashboardSnapshots()
    const nextSnapshot = {
      ...snapshot,
      recordedAt: snapshot.recordedAt || nowIso()
    }
    snapshotBook.snapshots.push(nextSnapshot)
    snapshotBook.snapshots = snapshotBook.snapshots.slice(-100)
    return saveDashboardSnapshots(snapshotBook)
  }

  function loadDiagnosticTraces() {
    return readJsonFile(diagnosticTracesPath, defaultDiagnosticTraces())
  }

  function saveDiagnosticTraces(traceBook) {
    const nextTraceBook = {
      ...traceBook,
      lastUpdated: nowIso()
    }
    writeJsonFile(diagnosticTracesPath, nextTraceBook)
    return nextTraceBook
  }

  function appendDiagnosticTrace(trace) {
    const traceBook = loadDiagnosticTraces()
    const nextTrace = {
      ...trace,
      recordedAt: trace.recordedAt || nowIso()
    }
    traceBook.traces.push(nextTrace)
    traceBook.traces = traceBook.traces.slice(-500)
    return saveDiagnosticTraces(traceBook)
  }

  function loadLiveApprovals() {
    return readJsonFile(liveApprovalsPath, defaultLiveApprovals())
  }

  function saveLiveApprovals(approvalBook) {
    const nextApprovalBook = {
      ...approvalBook,
      lastUpdated: nowIso()
    }
    writeJsonFile(liveApprovalsPath, nextApprovalBook)
    return nextApprovalBook
  }

  function appendLiveApproval(approval) {
    const approvalBook = loadLiveApprovals()
    const nextApproval = {
      ...approval,
      recordedAt: approval.recordedAt || nowIso()
    }
    approvalBook.approvals.push(nextApproval)
    approvalBook.approvals = approvalBook.approvals.slice(-100)
    return saveLiveApprovals(approvalBook)
  }

  function loadLiveScenarioRuns() {
    return readJsonFile(liveScenarioRunsPath, defaultLiveScenarioRuns())
  }

  function saveLiveScenarioRuns(runBook) {
    const nextRunBook = {
      ...runBook,
      lastUpdated: nowIso()
    }
    writeJsonFile(liveScenarioRunsPath, nextRunBook)
    return nextRunBook
  }

  function upsertLiveScenarioRun(run) {
    const runBook = loadLiveScenarioRuns()
    const runId = String(run?.runId || '').trim()

    if (!runId) {
      throw new Error('Live scenario run requires runId')
    }

    const nextRun = {
      ...run,
      runId,
      updatedAt: run.updatedAt || nowIso()
    }
    const index = runBook.runs.findIndex((entry) => String(entry?.runId || '') === runId)
    if (index >= 0) {
      runBook.runs[index] = {
        ...runBook.runs[index],
        ...nextRun
      }
    } else {
      runBook.runs.unshift(nextRun)
    }

    runBook.runs = runBook.runs
      .sort((left, right) => String(right.updatedAt || right.createdAt || '').localeCompare(String(left.updatedAt || left.createdAt || '')))
      .slice(0, 40)

    const activeCandidate = runBook.runs.find((entry) => ['queued', 'preflight', 'opening', 'opened', 'closing', 'autoswapping', 'reconciling'].includes(String(entry?.status || '')))
    runBook.activeRunId = activeCandidate ? String(activeCandidate.runId) : null

    return saveLiveScenarioRuns(runBook)
  }

  function patchLiveScenarioRun(runId, patch = {}) {
    const runBook = loadLiveScenarioRuns()
    const normalizedRunId = String(runId || '').trim()
    const index = runBook.runs.findIndex((entry) => String(entry?.runId || '') === normalizedRunId)

    if (index < 0) {
      throw new Error(`Live scenario run not found: ${normalizedRunId}`)
    }

    runBook.runs[index] = {
      ...runBook.runs[index],
      ...patch,
      runId: normalizedRunId,
      updatedAt: nowIso()
    }

    const activeCandidate = runBook.runs.find((entry) => ['queued', 'preflight', 'opening', 'opened', 'closing', 'autoswapping', 'reconciling'].includes(String(entry?.status || '')))
    runBook.activeRunId = activeCandidate ? String(activeCandidate.runId) : null

    return saveLiveScenarioRuns(runBook).runs[index]
  }

  function getLiveScenarioRun(runId) {
    const runBook = loadLiveScenarioRuns()
    const normalizedRunId = String(runId || '').trim()
    return runBook.runs.find((entry) => String(entry?.runId || '') === normalizedRunId) || null
  }

  function resetAll() {
    saveExecutionJournal(defaultExecutionJournal())
    savePositionSnapshots(defaultPositionSnapshots())
    saveMonitorSummary(defaultMonitorSummary())
    savePnlSnapshots(defaultPnlSnapshots())
    saveCloseCards(defaultCloseCards())
    saveDiscoveryReports(defaultDiscoveryReports())
    saveExecutionExtensionSummaries(defaultExecutionExtensionSummaries())
    saveDashboardSnapshots(defaultDashboardSnapshots())
    saveLiveApprovals(defaultLiveApprovals())
    saveLiveScenarioRuns(defaultLiveScenarioRuns())
    saveDiagnosticTraces(defaultDiagnosticTraces())
  }

  return {
    stateDir,
    executionJournalPath,
    positionSnapshotsPath,
    monitorSummaryPath,
    pnlSnapshotsPath,
    closeCardsPath,
    discoveryReportsPath,
    executionExtensionSummariesPath,
    dashboardSnapshotsPath,
    liveApprovalsPath,
    liveScenarioRunsPath,
    diagnosticTracesPath,
    loadExecutionJournal,
    saveExecutionJournal,
    appendExecutionEntry,
    loadPositionSnapshots,
    savePositionSnapshots,
    upsertPositionSnapshot,
    markPositionClosed,
    loadMonitorSummary,
    saveMonitorSummary,
    loadPnlSnapshots,
    savePnlSnapshots,
    loadCloseCards,
    saveCloseCards,
    appendCloseCard,
    loadDiscoveryReports,
    saveDiscoveryReports,
    appendDiscoveryReport,
    loadExecutionExtensionSummaries,
    saveExecutionExtensionSummaries,
    appendExecutionExtensionSummary,
    loadDashboardSnapshots,
    saveDashboardSnapshots,
    appendDashboardSnapshot,
    loadDiagnosticTraces,
    saveDiagnosticTraces,
    appendDiagnosticTrace,
    loadLiveApprovals,
    saveLiveApprovals,
    appendLiveApproval,
    loadLiveScenarioRuns,
    saveLiveScenarioRuns,
    upsertLiveScenarioRun,
    patchLiveScenarioRun,
    getLiveScenarioRun,
    resetAll
  }
}

module.exports = {
  DEFAULT_STATE_DIR,
  EXECUTION_JOURNAL_FILE,
  POSITION_SNAPSHOTS_FILE,
  MONITOR_SUMMARY_FILE,
  PNL_SNAPSHOTS_FILE,
  CLOSE_CARDS_FILE,
  DISCOVERY_REPORTS_FILE,
  EXECUTION_EXTENSION_SUMMARIES_FILE,
  DASHBOARD_SNAPSHOTS_FILE,
  LIVE_APPROVALS_FILE,
  LIVE_SCENARIO_RUNS_FILE,
  DIAGNOSTIC_TRACES_FILE,
  defaultExecutionJournal,
  defaultPositionSnapshots,
  defaultMonitorSummary,
  defaultPnlSnapshots,
  defaultCloseCards,
  defaultDiscoveryReports,
  defaultExecutionExtensionSummaries,
  defaultDashboardSnapshots,
  defaultLiveApprovals,
  defaultLiveScenarioRuns,
  defaultDiagnosticTraces,
  createExecutionStateStore
}
