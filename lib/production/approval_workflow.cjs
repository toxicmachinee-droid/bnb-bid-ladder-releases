'use strict'

const { issueLivePermit, isLivePermitValid } = require('./live_gate.cjs')

function buildLiveApprovalRecord({
  approver,
  reason,
  validations = {},
  workflow = {},
  actions = {},
  recoveryActions = [],
  ttlMs,
  issuedAt
}) {
  const permit = issueLivePermit({
    approver,
    reason,
    ttlMs,
    issuedAt
  })

  return {
    approver: permit.approver,
    reason: permit.reason,
    issuedAt: permit.issuedAt,
    expiresAt: permit.expiresAt,
    validations,
    workflow,
    actions,
    recoveryActionsCount: recoveryActions.length,
    validAtIssue: !workflow.blocked && actions.canExecute !== false && recoveryActions.length === 0
  }
}

function persistLiveApproval(store, payload) {
  if (!store?.appendLiveApproval) {
    throw new Error('persistLiveApproval requires a state store with appendLiveApproval')
  }

  const approval = buildLiveApprovalRecord(payload)
  return {
    approval,
    approvalBook: store.appendLiveApproval(approval)
  }
}

function getLatestLiveApproval(store) {
  const approvalBook = store.loadLiveApprovals()
  return approvalBook.approvals.length ? approvalBook.approvals[approvalBook.approvals.length - 1] : null
}

function buildApprovalAuditSummary(store, now = new Date().toISOString()) {
  const approvalBook = store.loadLiveApprovals()
  const latestApproval = approvalBook.approvals.length ? approvalBook.approvals[approvalBook.approvals.length - 1] : null

  return {
    count: approvalBook.approvals.length,
    latestApproval,
    hasValidApproval: latestApproval ? isLivePermitValid(latestApproval, now) : false
  }
}

module.exports = {
  buildLiveApprovalRecord,
  persistLiveApproval,
  getLatestLiveApproval,
  buildApprovalAuditSummary
}
