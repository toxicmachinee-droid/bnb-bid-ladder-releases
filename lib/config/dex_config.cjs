'use strict'

const { V2_DEPLOYMENTS, V3_DEPLOYMENTS, V4_DEPLOYMENTS } = require('../bnb_v3_config.cjs')

function getDexConfig(dex, protocolVersion = 'v3') {
  const key = String(dex || '').toLowerCase()
  const version = String(protocolVersion || 'v3').toLowerCase()
  const registry = version === 'v4' ? V4_DEPLOYMENTS : (version === 'v2' ? V2_DEPLOYMENTS : V3_DEPLOYMENTS)

  if (!registry[key]) {
    throw new Error(`unsupported dex "${dex}" for protocol "${version}"`)
  }

  return registry[key]
}

function listDexConfigs() {
  const configs = []

  for (const config of Object.values(V3_DEPLOYMENTS)) {
    configs.push({ ...config, protocolVersion: 'v3' })
  }

  for (const config of Object.values(V2_DEPLOYMENTS)) {
    configs.push({ ...config, protocolVersion: 'v2' })
  }

  for (const config of Object.values(V4_DEPLOYMENTS)) {
    configs.push({ ...config, protocolVersion: 'v4' })
  }

  return configs
}

module.exports = {
  getDexConfig,
  listDexConfigs
}
