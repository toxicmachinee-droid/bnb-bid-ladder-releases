'use strict'

function toTimestamp(value) {
  const timestamp = Date.parse(value || '')
  return Number.isFinite(timestamp) ? timestamp : 0
}

function buildExecutionTimeline({
  executionJournal,
  closeCards,
  discoveryReports,
  executionExtensionSummaries
}) {
  const entries = []

  for (const entry of executionJournal?.entries || []) {
    entries.push({
      type: 'execution',
      at: entry.recordedAt || null,
      sortKey: toTimestamp(entry.recordedAt),
      status: entry.status,
      executionId: entry.executionId,
      txHash: entry.txHash || null
    })
  }

  for (const card of closeCards?.cards || []) {
    entries.push({
      type: 'close_card',
      at: card.closedAt || card.recordedAt || null,
      sortKey: toTimestamp(card.closedAt || card.recordedAt),
      positionId: card.positionId,
      tokenId: card.tokenId || null,
      realizedPnlQuote: Number(card.realizedPnlQuote || 0)
    })
  }

  for (const report of discoveryReports?.reports || []) {
    const at = report.generatedAt || report.recordedAt || null
    entries.push({
      type: 'discovery',
      at,
      sortKey: toTimestamp(at),
      tokenAddress: report.tokenAddress || null,
      poolCount: Number(report.poolCount || 0),
      accepted: Number(report.shortlist?.summary?.accepted || 0),
      warned: Number(report.shortlist?.summary?.warned || 0),
      blocked: Number(report.shortlist?.summary?.blocked || 0)
    })
  }

  for (const summary of executionExtensionSummaries?.summaries || []) {
    const at = summary.generatedAt || summary.recordedAt || null
    entries.push({
      type: 'execution_extension',
      at,
      sortKey: toTimestamp(at),
      actionableCount: Number(summary.actionableCount || 0),
      blockerCount: Number(summary.blockerCount || 0),
      readyToExecute: Boolean(summary.readyToExecute)
    })
  }

  return entries
    .sort((left, right) => right.sortKey - left.sortKey)
    .map(({ sortKey, ...entry }) => entry)
}

module.exports = {
  buildExecutionTimeline
}
