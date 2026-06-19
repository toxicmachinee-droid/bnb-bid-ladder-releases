'use strict'

function formatCompactUsd(value) {
  const numeric = Number(value || 0)

  if (!Number.isFinite(numeric)) {
    return '$0'
  }

  if (numeric >= 1_000_000) {
    return `$${(numeric / 1_000_000).toFixed(2)}M`
  }

  if (numeric >= 1_000) {
    return `$${(numeric / 1_000).toFixed(1)}K`
  }

  return `$${numeric.toFixed(0)}`
}

function formatFeePctLabel(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return 'n/a'
  }
  if (numeric >= 0.01) {
    return `${numeric.toFixed(2)}%`
  }
  return `${numeric.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')}%`
}

function buildPoolSearchCards(workflow, { tokenResolution } = {}) {
  const shortlist = workflow?.shortlist || { candidates: [], summary: {} }

  return shortlist.candidates.map((candidate, index) => ({
    id: candidate.id,
    rank: index + 1,
    tokenSymbol: tokenResolution?.token?.symbol || 'UNKNOWN',
    queryType: tokenResolution?.type || 'unknown',
    dex: candidate.dex,
    fee: candidate.fee,
    liquidityUsd: Number(candidate.liquidityUsd || 0),
    liquidityLabel: formatCompactUsd(candidate.liquidityUsd),
    price: Number(candidate.price || 0),
    decision: candidate.decision?.action || 'unknown',
    decisionReason: candidate.decision?.reason || 'no decision',
    divergenceBps: candidate.sanity?.divergenceBps == null ? null : Number(candidate.sanity.divergenceBps.toFixed(2)),
    feeTierLabel: formatFeePctLabel(Number(candidate.fee || 0) / 10_000),
    reference: workflow?.shortlist?.referencePool?.id === candidate.id
  }))
}

function buildPoolSearchViewModel({
  workflow,
  tokenResolution
}) {
  return {
    generatedAt: workflow?.generatedAt || new Date().toISOString(),
    token: tokenResolution?.token || null,
    queryType: tokenResolution?.type || null,
    summary: workflow?.shortlist?.summary || {
      accepted: 0,
      warned: 0,
      blocked: 0
    },
    referencePool: workflow?.shortlist?.referencePool || null,
    cards: buildPoolSearchCards(workflow, { tokenResolution })
  }
}

module.exports = {
  formatCompactUsd,
  formatFeePctLabel,
  buildPoolSearchCards,
  buildPoolSearchViewModel
}
