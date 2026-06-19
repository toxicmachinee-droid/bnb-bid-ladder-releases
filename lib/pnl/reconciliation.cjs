'use strict'

const { buildCloseCardFromState } = require('./close_pipeline.cjs')

function closeCardIdentity(card = {}) {
  const tokenId = String(card.tokenId || '').trim()
  if (tokenId) {
    return `token:${tokenId}`
  }
  const positionId = String(card.positionId || '').trim()
  return positionId ? `position:${positionId}` : null
}

function normalizeExecutionArtifact(executionArtifact = {}) {
  const reconciliationStatus = executionArtifact.reconciliationStatus || 'reconciled'
  return {
    exitValueQuote: Number(executionArtifact.exitValueQuote || 0),
    accruedFeesQuote: executionArtifact.accruedFeesQuote === undefined
      ? undefined
      : Number(executionArtifact.accruedFeesQuote || 0),
    autoswapDeltaQuote: Number(executionArtifact.autoswapDeltaQuote || 0),
    closeCostsQuote: Number(executionArtifact.closeCostsQuote || 0),
    exitValueIncludesAccruedFees: executionArtifact.exitValueIncludesAccruedFees === undefined
      ? reconciliationStatus === 'reconciled_receipt_transfers'
      : Boolean(executionArtifact.exitValueIncludesAccruedFees),
    txHash: executionArtifact.txHash || null,
    closedAt: executionArtifact.closedAt || new Date().toISOString(),
    reconciliationStatus,
    autoswapDecision: executionArtifact.autoswapDecision || null,
    autoswapRoute: executionArtifact.autoswapRoute || null,
    receivedQuoteAmount: executionArtifact.receivedQuoteAmount || null,
    receivedInputAmount: executionArtifact.receivedInputAmount || null,
    proceedsEstimated: Boolean(executionArtifact.proceedsEstimated),
    closeValuationWarning: executionArtifact.closeValuationWarning || null
  }
}

function buildCloseCardFromExecutionArtifact({
  positionSnapshot,
  executionArtifact
}) {
  const normalizedArtifact = normalizeExecutionArtifact(executionArtifact)
  const closeCard = buildCloseCardFromState({
    positionSnapshot,
    exitValueQuote: normalizedArtifact.exitValueQuote,
    accruedFeesQuote: executionArtifact?.accruedFeesQuote === undefined
      ? Number(positionSnapshot.accruedFeesQuote || 0)
      : normalizedArtifact.accruedFeesQuote,
    claimedFeesQuote: Number(positionSnapshot.claimedFeesQuote || 0),
    autoswapDeltaQuote: normalizedArtifact.autoswapDeltaQuote,
    closeCostsQuote: normalizedArtifact.closeCostsQuote,
    exitValueIncludesAccruedFees: normalizedArtifact.exitValueIncludesAccruedFees,
    closedAt: normalizedArtifact.closedAt
  })

  return {
    ...closeCard,
    txHash: normalizedArtifact.txHash,
    reconciliationStatus: normalizedArtifact.reconciliationStatus,
    autoswapDecision: normalizedArtifact.autoswapDecision,
    autoswapRoute: normalizedArtifact.autoswapRoute,
    receivedQuoteAmount: normalizedArtifact.receivedQuoteAmount,
    receivedInputAmount: normalizedArtifact.receivedInputAmount,
    proceedsEstimated: normalizedArtifact.proceedsEstimated,
    closeValuationWarning: normalizedArtifact.closeValuationWarning
  }
}

function buildReconcilingCloseCardFromSubmittedTx({
  positionSnapshot,
  txHash,
  submittedAt = new Date().toISOString()
}) {
  const closeCard = buildCloseCardFromState({
    positionSnapshot,
    exitValueQuote: 0,
    accruedFeesQuote: 0,
    claimedFeesQuote: Number(positionSnapshot.claimedFeesQuote || 0),
    autoswapDeltaQuote: 0,
    closeCostsQuote: 0,
    closedAt: submittedAt
  })

  return {
    ...closeCard,
    txHash: txHash || null,
    reconciliationStatus: 'reconciling_close_receipt',
    proceedsEstimated: true,
    closeValuationWarning: 'close transaction submitted; waiting for receipt transfer reconciliation',
    receivedQuoteAmount: null,
    receivedInputAmount: null
  }
}

function reconcileClosedPositionFromExecution({
  store,
  positionSnapshot,
  executionArtifact
}) {
  const closeCard = buildCloseCardFromExecutionArtifact({
    positionSnapshot,
    executionArtifact
  })

  store.markPositionClosed(positionSnapshot.positionId || positionSnapshot.tokenId, {
    status: 'closed',
    closedAt: closeCard.closedAt,
    closeTxHash: closeCard.txHash,
    liquidity: '0',
    tokensOwed0: '0',
    tokensOwed1: '0',
    feeGrowthDelta0: '0',
    feeGrowthDelta1: '0',
    currentValueQuote: 0,
    totalValueQuote: 0,
    accruedFeesQuote: 0,
    currentTick: null,
    outOfRange: false,
    realizedPnlQuote: closeCard.realizedPnlQuote,
    reconciliationStatus: closeCard.reconciliationStatus
  })
  upsertCloseCard(store, closeCard)

  return closeCard
}

function upsertCloseCard(store, closeCard) {
  if (!store?.loadCloseCards || !store?.saveCloseCards) {
    return store.appendCloseCard(closeCard)
  }

  const key = closeCardIdentity(closeCard)
  if (!key) {
    return store.appendCloseCard(closeCard)
  }

  const closeBook = store.loadCloseCards()
  const now = new Date().toISOString()
  const nextCard = {
    ...closeCard,
    recordedAt: closeCard.recordedAt || now
  }
  let mergedCard = nextCard
  const retainedCards = []

  for (const existingCard of closeBook.cards || []) {
    if (closeCardIdentity(existingCard) !== key) {
      retainedCards.push(existingCard)
      continue
    }

    mergedCard = {
      ...existingCard,
      ...mergedCard,
      txHash: mergedCard.txHash || existingCard.txHash || null,
      recordedAt: mergedCard.recordedAt || existingCard.recordedAt || now
    }
  }

  closeBook.cards = retainedCards.concat(mergedCard).slice(-250)
  return store.saveCloseCards(closeBook)
}

module.exports = {
  normalizeExecutionArtifact,
  buildCloseCardFromExecutionArtifact,
  buildReconcilingCloseCardFromSubmittedTx,
  reconcileClosedPositionFromExecution,
  upsertCloseCard
}
