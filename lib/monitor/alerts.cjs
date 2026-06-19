'use strict'

function deriveMonitorAlerts(snapshotBook, { staleAfterMs = 15 * 60 * 1000 } = {}) {
  const now = Date.now()
  const positions = snapshotBook?.positions || []
  const alerts = []

  for (const position of positions) {
    const positionId = String(position.positionId || position.tokenId)

    if (position.status === 'open' && position.outOfRange) {
      alerts.push({
        type: 'position_out_of_range',
        severity: 'warning',
        positionId
      })
    }

    if (position.status === 'open' && position.lastSeenAt) {
      const ageMs = now - Date.parse(position.lastSeenAt)
      if (Number.isFinite(ageMs) && ageMs > staleAfterMs) {
        alerts.push({
          type: 'position_snapshot_stale',
          severity: 'warning',
          positionId
        })
      }
    }
  }

  return alerts
}

module.exports = {
  deriveMonitorAlerts
}
