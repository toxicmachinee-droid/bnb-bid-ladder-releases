'use strict'

const { ethers } = require('ethers')

const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/

function normalizeOwnerAddress(value) {
  const raw = String(value || '').trim()
  if (!raw) {
    return null
  }
  try {
    return ethers.getAddress(raw)
  } catch (_) {
    return raw.toLowerCase()
  }
}

function normalizeTxHash(value) {
  const raw = String(value || '').trim()
  return TX_HASH_RE.test(raw) ? raw.toLowerCase() : null
}

function hasOwnerAddress(entry = {}) {
  return Boolean(normalizeOwnerAddress(entry?.ownerAddress || entry?.walletAddress || entry?.owner))
}

function getCandidateOwnerTxHashes(card = {}, snapshot = {}) {
  const fields = [
    card.openedTxHash,
    snapshot.openedTxHash,
    card.openTxHash,
    snapshot.openTxHash,
    card.mintTxHash,
    snapshot.mintTxHash,
    card.txHash,
    card.closeTxHash,
    snapshot.closeTxHash
  ]
  return [...new Set(fields.map(normalizeTxHash).filter(Boolean))]
}

function getTxOwner(txOwnersByHash, txHash) {
  if (!txOwnersByHash || !txHash) {
    return null
  }
  if (txOwnersByHash instanceof Map) {
    return normalizeOwnerAddress(txOwnersByHash.get(txHash) || txOwnersByHash.get(String(txHash).toLowerCase()))
  }
  return normalizeOwnerAddress(txOwnersByHash[txHash] || txOwnersByHash[String(txHash).toLowerCase()])
}

function applyLegacyCloseOwnerBackfill({
  closeBook = { cards: [] },
  snapshotBook = { positions: [] },
  ownerAddress,
  txOwnersByHash
} = {}) {
  const activeOwner = normalizeOwnerAddress(ownerAddress)
  if (!activeOwner) {
    return {
      closeBook,
      snapshotBook,
      changedCloseCards: 0,
      changedPositionSnapshots: 0
    }
  }

  const snapshotsByPositionId = new Map((snapshotBook.positions || []).map((snapshot) => [
    String(snapshot.positionId || snapshot.tokenId || ''),
    snapshot
  ]))

  const ownerByPositionId = new Map()
  function findMatchingOwnerFromHashes(card = {}, snapshot = {}) {
    return getCandidateOwnerTxHashes(card, snapshot)
      .map((hash) => ({ hash, owner: getTxOwner(txOwnersByHash, hash) }))
      .find((entry) => entry.owner && entry.owner.toLowerCase() === activeOwner.toLowerCase())
  }

  let changedCloseCards = 0
  const nextCards = (closeBook.cards || []).map((card) => {
    if (hasOwnerAddress(card)) {
      return card
    }
    const key = String(card.positionId || card.tokenId || '')
    const snapshot = snapshotsByPositionId.get(key) || {}
    const candidateOwner = findMatchingOwnerFromHashes(card, snapshot)

    if (!candidateOwner) {
      return card
    }

    changedCloseCards += 1
    ownerByPositionId.set(key, {
      ownerAddress: activeOwner,
      ownerBackfillTxHash: candidateOwner.hash
    })
    return {
      ...card,
      ownerAddress: activeOwner,
      ownerBackfilledAt: card.ownerBackfilledAt || new Date().toISOString(),
      ownerBackfillSource: card.ownerBackfillSource || 'tx_from',
      ownerBackfillTxHash: card.ownerBackfillTxHash || candidateOwner.hash
    }
  })

  let changedPositionSnapshots = 0
  const nextPositions = (snapshotBook.positions || []).map((snapshot) => {
    if (hasOwnerAddress(snapshot)) {
      return snapshot
    }
    const key = String(snapshot.positionId || snapshot.tokenId || '')
    const ownerPatch = ownerByPositionId.get(key)
      || (() => {
        const candidateOwner = findMatchingOwnerFromHashes({}, snapshot)
        return candidateOwner
          ? {
              ownerAddress: activeOwner,
              ownerBackfillTxHash: candidateOwner.hash
            }
          : null
      })()
    if (!ownerPatch) {
      return snapshot
    }
    changedPositionSnapshots += 1
    return {
      ...snapshot,
      ownerAddress: ownerPatch.ownerAddress,
      ownerBackfilledAt: snapshot.ownerBackfilledAt || new Date().toISOString(),
      ownerBackfillSource: snapshot.ownerBackfillSource || 'tx_from',
      ownerBackfillTxHash: snapshot.ownerBackfillTxHash || ownerPatch.ownerBackfillTxHash
    }
  })

  return {
    closeBook: {
      ...closeBook,
      cards: nextCards
    },
    snapshotBook: {
      ...snapshotBook,
      positions: nextPositions
    },
    changedCloseCards,
    changedPositionSnapshots
  }
}

function collectLegacyCloseOwnerTxHashes({ closeBook = { cards: [] }, snapshotBook = { positions: [] }, maxCards = 250, maxTxReads = 96 } = {}) {
  const snapshotsByPositionId = new Map((snapshotBook.positions || []).map((snapshot) => [
    String(snapshot.positionId || snapshot.tokenId || ''),
    snapshot
  ]))
  const hashes = []
  const cards = (closeBook.cards || []).slice(-Math.max(1, maxCards)).reverse()
  for (const card of cards) {
    if (hasOwnerAddress(card)) {
      continue
    }
    const snapshot = snapshotsByPositionId.get(String(card.positionId || card.tokenId || '')) || {}
    for (const hash of getCandidateOwnerTxHashes(card, snapshot)) {
      if (!hashes.includes(hash)) {
        hashes.push(hash)
      }
      if (hashes.length >= maxTxReads) {
        return hashes
      }
    }
  }
  const closedSnapshots = (snapshotBook.positions || [])
    .filter((snapshot) => String(snapshot?.status || '').toLowerCase() === 'closed')
    .filter((snapshot) => !hasOwnerAddress(snapshot))
    .slice(-Math.max(1, maxCards))
    .reverse()
  for (const snapshot of closedSnapshots) {
    for (const hash of getCandidateOwnerTxHashes({}, snapshot)) {
      if (!hashes.includes(hash)) {
        hashes.push(hash)
      }
      if (hashes.length >= maxTxReads) {
        return hashes
      }
    }
  }
  return hashes
}

async function withTimeout(promise, timeoutMs, label) {
  let timer = null
  try {
    return await Promise.race([
      promise,
      new Promise((resolve) => {
        timer = setTimeout(() => resolve({ timedOut: true, label }), timeoutMs)
      })
    ])
  } finally {
    if (timer) {
      clearTimeout(timer)
    }
  }
}

async function readTxOwnersByHash({ provider, readTransactionOwner, txHashes = [], batchSize = 8, perTxTimeoutMs = 1500 } = {}) {
  const txOwnersByHash = new Map()
  const hashes = txHashes.map(normalizeTxHash).filter(Boolean)
  for (let index = 0; index < hashes.length; index += batchSize) {
    const batch = hashes.slice(index, index + batchSize)
    const results = await Promise.all(batch.map(async (hash) => {
      const owner = typeof readTransactionOwner === 'function'
        ? await withTimeout(
            Promise.resolve(readTransactionOwner(hash)).catch(() => null),
            perTxTimeoutMs,
            `legacy close owner tx ${hash}`
          )
        : null
      const tx = owner ? null : await withTimeout(
          provider?.getTransaction?.(hash).catch(() => null),
          perTxTimeoutMs,
          `legacy close owner tx ${hash}`
        )
      const txOwner = owner || tx?.from
      if (!txOwner || tx?.timedOut || owner?.timedOut) {
        return null
      }
      return [hash, txOwner]
    }))
    for (const result of results) {
      if (result) {
        txOwnersByHash.set(result[0], result[1])
      }
    }
  }
  return txOwnersByHash
}

async function backfillLegacyCloseCardOwners({
  store,
  provider,
  readTransactionOwner,
  ownerAddress,
  maxCards = 250,
  maxTxReads = 96,
  batchSize = 8,
  perTxTimeoutMs = 1500
} = {}) {
  if (!store?.loadCloseCards || !store?.saveCloseCards || !store?.loadPositionSnapshots || !store?.savePositionSnapshots || (!provider && typeof readTransactionOwner !== 'function') || !ownerAddress) {
    return {
      ok: false,
      changedCloseCards: 0,
      changedPositionSnapshots: 0,
      txReads: 0
    }
  }

  const closeBook = store.loadCloseCards()
  const snapshotBook = store.loadPositionSnapshots()
  const txHashes = collectLegacyCloseOwnerTxHashes({ closeBook, snapshotBook, maxCards, maxTxReads })
  if (!txHashes.length) {
    return {
      ok: true,
      changedCloseCards: 0,
      changedPositionSnapshots: 0,
      txReads: 0
    }
  }

  const txOwnersByHash = await readTxOwnersByHash({ provider, readTransactionOwner, txHashes, batchSize, perTxTimeoutMs })
  const result = applyLegacyCloseOwnerBackfill({
    closeBook,
    snapshotBook,
    ownerAddress,
    txOwnersByHash
  })

  if (result.changedCloseCards > 0) {
    store.saveCloseCards(result.closeBook)
  }
  if (result.changedPositionSnapshots > 0) {
    store.savePositionSnapshots(result.snapshotBook)
  }

  return {
    ok: true,
    changedCloseCards: result.changedCloseCards,
    changedPositionSnapshots: result.changedPositionSnapshots,
    txReads: txHashes.length,
    txOwners: txOwnersByHash.size
  }
}

module.exports = {
  normalizeOwnerAddress,
  normalizeTxHash,
  getCandidateOwnerTxHashes,
  collectLegacyCloseOwnerTxHashes,
  applyLegacyCloseOwnerBackfill,
  backfillLegacyCloseCardOwners
}
