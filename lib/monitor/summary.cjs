'use strict'

function buildMonitorSummary(snapshotBook, alerts) {
  const positions = snapshotBook?.positions || []
  const openPositions = positions.filter((position) => position.status === 'open')
  const stalePositions = alerts.filter((alert) => alert.type === 'position_snapshot_stale').length
  const outOfRangePositions = openPositions.filter((position) => position.outOfRange).length

  return {
    openPositions: openPositions.length,
    outOfRangePositions,
    stalePositions,
    alerts
  }
}

function persistMonitorSummary(store, snapshotBook, alerts, traceContext = null) {
  const summaryBook = store.saveMonitorSummary({
    version: 1,
    summary: buildMonitorSummary(snapshotBook, alerts)
  })

  if (store?.appendDiagnosticTrace) {
    store.appendDiagnosticTrace({
      kind: 'monitor_summary_persisted',
      traceId: traceContext?.traceId || null,
      openPositions: Number(summaryBook.summary?.openPositions || 0),
      outOfRangePositions: Number(summaryBook.summary?.outOfRangePositions || 0),
      stalePositions: Number(summaryBook.summary?.stalePositions || 0),
      alertTypes: (summaryBook.summary?.alerts || []).map((alert) => alert.type).slice(0, 20)
    })
  }

  return summaryBook
}

module.exports = {
  buildMonitorSummary,
  persistMonitorSummary
}
