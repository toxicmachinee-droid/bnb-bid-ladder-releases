'use strict'

function nowIso() {
  return new Date().toISOString()
}

function buildFamilyKey(dex, protocolVersion = 'v3') {
  return `${String(dex || '').toLowerCase()}:${String(protocolVersion || 'v3').toLowerCase()}`
}

function isNonexistentPositionTokenError(error) {
  const message = String(error?.message || error || '').toLowerCase()
  return message.includes('invalid token id')
    || message.includes('nonexistent token')
    || message.includes('not_minted')
    || message.includes('not minted')
    || message.includes('owner query for nonexistent token')
    || message.includes('erc721: owner query for nonexistent token')
}

function normalizeAddress(value) {
  return String(value || '').toLowerCase()
}

function getTrackedOwnerAddress(trackedPosition = {}) {
  const candidates = [
    trackedPosition.ownerAddress,
    trackedPosition.walletAddress,
    trackedPosition.openedWalletAddress,
    trackedPosition.recipient,
    trackedPosition.executionRecipient,
    trackedPosition.fundingAddress
  ]
  for (const candidate of candidates) {
    const normalized = normalizeAddress(candidate)
    if (/^0x[a-f0-9]{40}$/.test(normalized)) {
      return normalized
    }
  }
  return ''
}

function buildOpenSnapshotPatch({
  trackedPosition,
  refreshedSnapshot,
  observedAt = nowIso(),
  ownerAddress = null,
  reconciliationStatus = 'onchain_owned'
}) {
  const reopenedFromClosed = String(trackedPosition?.status || '').toLowerCase() === 'closed'
  const refreshedCurrentValue = Number(
    refreshedSnapshot?.currentValueQuote
    ?? refreshedSnapshot?.totalValueQuote
    ?? trackedPosition?.currentValueQuote
    ?? 0
  )
  const preservedDeployedQuote = Number(
    trackedPosition?.deployedQuote
    ?? refreshedSnapshot?.deployedQuote
    ?? 0
  )
  const preservedEntryCostsQuote = Number(
    trackedPosition?.entryCostsQuote
    ?? refreshedSnapshot?.entryCostsQuote
    ?? 0
  )
  const resolvedDeployedQuote = reopenedFromClosed && refreshedCurrentValue > 0
    ? refreshedCurrentValue
    : preservedDeployedQuote
  const resolvedEntryCostsQuote = reopenedFromClosed && refreshedCurrentValue > 0
    ? 0
    : preservedEntryCostsQuote

  return {
    ...(trackedPosition || {}),
    ...(refreshedSnapshot || {}),
    deployedQuote: resolvedDeployedQuote,
    entryCostsQuote: resolvedEntryCostsQuote,
    currentValueQuote: refreshedCurrentValue > 0
      ? refreshedCurrentValue
      : Number(refreshedSnapshot?.currentValueQuote ?? trackedPosition?.currentValueQuote ?? resolvedDeployedQuote ?? 0),
    status: 'open',
    closedAt: null,
    closeTxHash: null,
    ownerAddress: ownerAddress || refreshedSnapshot?.ownerAddress || trackedPosition?.ownerAddress || null,
    monitorError: null,
    reconciliationStatus,
    reconciliationTrace: {
      reconciledAt: observedAt,
      source: 'onchain_ownerOf'
    }
  }
}

function buildClosedSnapshotPatch({
  trackedPosition,
  observedAt = nowIso(),
  reason = 'closed_onchain_not_owned'
}) {
  return {
    ...(trackedPosition || {}),
    status: 'closed',
    closedAt: observedAt,
    closeTxHash: trackedPosition?.closeTxHash || null,
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
    monitorError: null,
    reconciliationStatus: reason,
    reconciliationTrace: {
      reconciledAt: observedAt,
      source: 'onchain_ownerOf'
    }
  }
}

async function syncTrackedPositionsWithOnchainOwnership({
  trackedPositions = [],
  ownerAddress,
  families = null,
  resolveOwner,
  refreshTrackedPosition,
  upsertPositionSnapshot,
  markPositionClosed,
  onClosedPosition = null,
  observedAt = nowIso(),
  logger = null,
  concurrency = 6
}) {
  const requestedFamilies = Array.isArray(families) && families.length > 0
    ? new Set(families.map((family) => {
      if (typeof family === 'string') {
        return family.toLowerCase()
      }
      return buildFamilyKey(family?.dex, family?.protocolVersion)
    }))
    : null
  const normalizedOwner = normalizeAddress(ownerAddress)
  const openPositionIds = []
  const closedPositionIds = []
  const skippedPositionIds = []
  const scannedFamilies = []
  const seenFamilies = new Set()
  const batchSize = Math.max(1, Math.min(12, Number(concurrency || 6)))

  for (let index = 0; index < (trackedPositions || []).length; index += batchSize) {
    const batch = trackedPositions.slice(index, index + batchSize)
    const batchResults = await Promise.all(batch.map(async (trackedPosition) => {
    const familyKey = buildFamilyKey(trackedPosition?.dex, trackedPosition?.protocolVersion || 'v3')
    if (requestedFamilies && !requestedFamilies.has(familyKey)) {
      return {
        tokenId: String(trackedPosition?.tokenId || trackedPosition?.positionId || '').trim(),
        familyKey,
        skipped: true,
        reason: 'family_filtered'
      }
    }

    if (!seenFamilies.has(familyKey)) {
      seenFamilies.add(familyKey)
      scannedFamilies.push(familyKey)
    }

    const tokenId = String(trackedPosition?.tokenId || trackedPosition?.positionId || '').trim()
    if (!tokenId) {
      return {
        tokenId: String(trackedPosition?.positionId || trackedPosition?.tokenId || ''),
        familyKey,
        skipped: true,
        reason: 'missing_token_id'
      }
    }

    const trackedOwner = getTrackedOwnerAddress(trackedPosition)
    if (trackedOwner && trackedOwner !== normalizedOwner) {
      return {
        tokenId,
        familyKey,
        skipped: true,
        reason: 'different_tracked_owner'
      }
    }

    let ownershipResult
    try {
      ownershipResult = await resolveOwner({
        trackedPosition,
        tokenId,
        ownerAddress: normalizedOwner
      })
    } catch (error) {
      ownershipResult = { error }
    }

    const actualOwner = normalizeAddress(ownershipResult?.owner)
    const ownershipError = ownershipResult?.error || null

    if (ownershipError && !isNonexistentPositionTokenError(ownershipError)) {
      return {
        tokenId,
        familyKey,
        skipped: true,
        reason: ownershipError.message || String(ownershipError)
      }
    }

    if (!ownershipError && actualOwner === normalizedOwner) {
      let refreshedSnapshot = null
      try {
        refreshedSnapshot = await refreshTrackedPosition({
          trackedPosition,
          tokenId,
          ownerAddress: normalizedOwner
        })
      } catch (error) {
        refreshedSnapshot = {
          ...trackedPosition,
          monitorError: error?.message || String(error || 'refresh failed')
        }
      }

      return {
        tokenId,
        familyKey,
        kind: 'open',
        snapshot: buildOpenSnapshotPatch({
          trackedPosition,
          refreshedSnapshot,
          observedAt,
          ownerAddress: ownershipResult?.owner || normalizedOwner,
          reconciliationStatus: 'onchain_owned'
        })
      }
    }

    if (!ownershipError && actualOwner && actualOwner !== normalizedOwner && !trackedOwner) {
      let refreshedSnapshot = null
      try {
        refreshedSnapshot = await refreshTrackedPosition({
          trackedPosition,
          tokenId,
          ownerAddress: actualOwner
        })
      } catch (error) {
        refreshedSnapshot = {
          ...trackedPosition,
          monitorError: error?.message || String(error || 'refresh failed')
        }
      }

      return {
        tokenId,
        familyKey,
        kind: 'open',
        snapshot: buildOpenSnapshotPatch({
          trackedPosition,
          refreshedSnapshot,
          observedAt,
          ownerAddress: ownershipResult.owner || actualOwner,
          reconciliationStatus: 'onchain_owned_foreign_wallet'
        })
      }
    }

    return {
      tokenId,
      familyKey,
      kind: 'closed',
      snapshot: buildClosedSnapshotPatch({
        trackedPosition,
        observedAt,
        reason: isNonexistentPositionTokenError(ownershipError)
          ? 'closed_onchain_token_absent'
          : 'closed_onchain_not_owned'
      })
    }
  }))

    for (const result of batchResults) {
      if (!result) {
        continue
      }
      if (result.skipped) {
        if (result.tokenId) {
          skippedPositionIds.push(result.tokenId)
        }
        if (logger) {
          logger({
            kind: 'onchain_ownership_sync_skipped',
            tokenId: result.tokenId || null,
            reason: result.reason || 'skipped'
          })
        }
        continue
      }

      if (result.kind === 'open') {
        upsertPositionSnapshot(result.snapshot)
        openPositionIds.push(result.tokenId)
        if (logger) {
          logger({
            kind: 'onchain_ownership_sync_open',
            tokenId: result.tokenId,
            familyKey: result.familyKey
          })
        }
        continue
      }

      if (result.kind === 'closed') {
        markPositionClosed(result.snapshot.positionId || result.snapshot.tokenId, result.snapshot)
        if (typeof onClosedPosition === 'function') {
          onClosedPosition(result.snapshot, result)
        }
        closedPositionIds.push(result.tokenId)
        if (logger) {
          logger({
            kind: 'onchain_ownership_sync_closed',
            tokenId: result.tokenId,
            familyKey: result.familyKey,
            reason: result.snapshot.reconciliationStatus
          })
        }
      }
    }
  }

  return {
    ok: true,
    openPositionIds,
    closedPositionIds,
    skippedPositionIds,
    scannedFamilies
  }
}

module.exports = {
  buildClosedSnapshotPatch,
  buildOpenSnapshotPatch,
  isNonexistentPositionTokenError,
  syncTrackedPositionsWithOnchainOwnership
}
