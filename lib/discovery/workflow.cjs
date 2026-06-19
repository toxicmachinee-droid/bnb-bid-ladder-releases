'use strict'

const { discoverPoolsForToken } = require('./pool_lookup.cjs')
const { buildShortlistOutput } = require('./shortlist_output.cjs')

async function buildDiscoveryWorkflow(provider, {
  tokenAddress,
  dexes,
  quoteTokens,
  evaluation = {},
  findFirstExistingPool,
  readPoolRuntime
}) {
  const pools = await discoverPoolsForToken(provider, {
    tokenAddress,
    dexes,
    quoteTokens,
    findFirstExistingPool,
    readPoolRuntime
  })
  const shortlist = buildShortlistOutput(pools, evaluation)

  return {
    tokenAddress,
    generatedAt: shortlist.generatedAt,
    poolCount: pools.length,
    pools,
    shortlist
  }
}

function persistDiscoveryWorkflow(store, workflow) {
  if (!store?.appendDiscoveryReport) {
    throw new Error('persistDiscoveryWorkflow requires a state store with appendDiscoveryReport')
  }

  return store.appendDiscoveryReport(workflow)
}

module.exports = {
  buildDiscoveryWorkflow,
  persistDiscoveryWorkflow
}
