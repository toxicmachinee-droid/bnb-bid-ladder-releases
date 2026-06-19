'use strict'

function shouldSkipPreflight(request) {
  return request?.preflightPolicy === 'skip'
}

async function simulateTransactionRequest(signer, request) {
  const result = await signer.call(request)

  return {
    ok: true,
    result
  }
}

async function preflightExecutionPlan({ signer, requests }) {
  const results = []

  for (const [index, request] of requests.entries()) {
    if (shouldSkipPreflight(request)) {
      results.push({
        index,
        ok: true,
        skipped: true,
        request,
        simulation: {
          ok: true,
          skipped: true,
          reason: request.preflightReason || 'request requires prior state changes'
        }
      })
      continue
    }

    try {
      const simulation = await simulateTransactionRequest(signer, request)
      results.push({
        index,
        ok: true,
        request,
        simulation
      })
    } catch (error) {
      results.push({
        index,
        ok: false,
        request,
        error: error.message
      })
    }
  }

  return {
    ok: results.every((result) => result.ok),
    results
  }
}

module.exports = {
  shouldSkipPreflight,
  simulateTransactionRequest,
  preflightExecutionPlan
}
